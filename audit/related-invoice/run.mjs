import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(process.argv[2] ?? '.');
const out = path.resolve(process.argv[3] ?? 'work/related-invoice');
await mkdir(out, { recursive: true });
const load = (n) => import(pathToFileURL(path.join(root, 'lib/reconciliation', n + '.ts')));
const { readFile: read, exportWorkbook } = await load('io');
const { selectImportMapping } = await load('import-selection');
const { reconcileSupplierStatement } = await load('supplier-reconciliation');
const { saveSession, restoreSession } = await load('session');
const { ENGINE_VERSION } = await load('types');
const contractBytes = await readFile('audit/related-invoice/contract.json');
const contract = JSON.parse(contractBytes);
const observations = [];
const pdf = process.argv[4] === 'pdf';
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
for (const c of contract.cases.filter(c => !pdf || ['own-credit-note','short-own-credit-note','different-credit-notes'].includes(c.id))) {
  const files = await Promise.all([pdf ? 'supplier.pdf' : 'supplier.xlsx','ledger.csv'].map(async suffix => {
    const name = c.id + '-' + suffix;
    return read(name, ab(await readFile('audit/related-invoice/frozen/' + name)), pdf && suffix === 'supplier.pdf' ? [20,41,62,79] : []);
  }));
  const mappings = files.map((f,i) => selectImportMapping(f,i?'ledger':'supplier').mapping);
  if (pdf) mappings[0].pdfReviewed = true;
  const input = { files, mappings, scope: contract.scope };
  const result = reconcileSupplierStatement(input).result;
  const restored = await restoreSession(await saveSession({...input,decisions:[],rejected:[],events:[],review:{name:'',notes:'',checked:false}}));
  const summarize = r => ({
    approved:r.cases.filter(c=>c.status==='Matched').map(c=>({
      supplierRows:c.supplierMembers.map(t=>t.row),ledgerRows:c.ledgerMembers.map(t=>t.row),amountMinor:c.supplierTotal,rule:c.matchingRule,
      primary:c.supplierMembers[0]?.reference
    })),
    movements:[r.supplier,r.ledger].map(s=>s.transactions.map(t=>({row:t.row,primary:t.reference,document:t.documentReference,related:t.relatedInvoiceReference,number:t.documentNumberEvidence,chosen:t.chosenReference,evidence:t.chosenReferenceEvidence,type:t.documentType,amountMinor:t.amount,issues:t.referenceEvidenceIssues}))),
    rowFates:[r.supplier,r.ledger].map(s=>[...s.transactions,...s.errors,...s.excluded].map(t=>t.row).filter(r=>r>0).sort((a,b)=>a-b)),
    fullReconciliation:r.balanceComparable
  });
  const direct=summarize(result),again=summarize(restored.result);
  const approved=direct.approved;
  const passed=approved.length===c.approved && (c.approved===0 || approved.every(m=>m.primary===c.primary && m.amountMinor===c.amountMinor && JSON.stringify(m.supplierRows)===JSON.stringify(c.supplierRows) && JSON.stringify(m.ledgerRows)===JSON.stringify(c.ledgerRows))) && JSON.stringify(direct)===JSON.stringify(again) && !direct.fullReconciliation;
  for(const [name,r,f] of [['direct',result,files],['restored',restored.result,restored.files]]) {
    await writeFile(path.join(out,c.id+'-'+name+'.xlsx'),new Uint8Array(await exportWorkbook(r,f,{name:'',notes:'',checked:false})));
  }
  observations.push({id:c.id,passed,sourceHashes:files.map(f=>f.sha256),mappings,direct,restored:again});
}
const report={sourceFormat:pdf?'native-text-pdf':'xlsx',engine:ENGINE_VERSION,contractSha256:createHash('sha256').update(contractBytes).digest('hex'),observedAtUtc:new Date().toISOString(),passed:observations.filter(o=>o.passed).length,total:observations.length,observations};
await writeFile(path.join(out,'observations.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({engine:report.engine,passed:report.passed,total:report.total,cases:observations.map(o=>({id:o.id,passed:o.passed,approved:o.direct.approved}))}));
if(process.env.REQUIRE_F03_PASS==='1' && report.passed!==report.total) process.exitCode=1;
