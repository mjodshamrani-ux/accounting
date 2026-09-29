import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name)=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
assert.ok(arg('--engine-root')&&arg('--out'),'Required --engine-root /immutable/archive --out /new/result.json');
const engineRoot=path.resolve(arg('--engine-root')),out=path.resolve(arg('--out'));
assert.ok(!out.startsWith(here+path.sep),'Results must remain outside frozen');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const hashTree=async(dir,prefix='')=>{const entries={};for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=prefix+e.name;if(e.isDirectory())Object.assign(entries,await hashTree(path.join(dir,e.name),rel+'/'));else if(e.isFile())entries[rel]=sha(await readFile(path.join(dir,e.name)));}return entries;};
const manifest=await readFile(path.join(here,'SHA256SUMS'));
const verifyFrozen=async()=>{for(const line of manifest.toString().trim().split('\n')){const [hash,name]=line.split('  ');assert.equal(sha(await readFile(path.join(here,name))),hash,`Frozen input changed: ${name}`);}};
await verifyFrozen();
const before=await hashTree(path.join(engineRoot,'lib'));
const contracts=JSON.parse(await readFile(path.join(here,'contracts.json'),'utf8'));
const moduleAt=(name)=>pathToFileURL(path.join(engineRoot,'lib/reconciliation',name)).href;
const {readFile:readSource,exportWorkbook}=await import(moduleAt('io.ts'));
const {reconcileSupplierStatement}=await import(moduleAt('supplier-reconciliation.ts'));
const {saveSession,restoreSession}=await import(moduleAt('session.ts'));
const {formatChoice}=await import(moduleAt('input-readiness.ts'));
const {ENGINE_VERSION}=await import(moduleAt('types.ts'));
const {default:ExcelJS}=await import(pathToFileURL(path.join(engineRoot,'node_modules/exceljs/excel.js')).href);
const key=(g)=>`S:${[...g.supplierRows].sort((a,b)=>a-b).join(',')}|L:${[...g.ledgerRows].sort((a,b)=>a-b).join(',')}`;
const sorted=(xs)=>[...xs].sort((a,b)=>a-b);
const errorText=(e)=>e?.stack??String(e);

function inspectResult(contract,result,files,check,prefix=''){
 const expected=contract.requiredAutoGroups.map(key).sort();
 const all=result.matches.map(m=>({supplierRows:(m.supplierIds??[m.supplierId]).map(id=>{const t=result.supplier.transactions.find(t=>t.id===id);assert.ok(t,`Unknown supplier match ID ${id}`);return t.row;}),ledgerRows:(m.ledgerIds??[m.ledgerId]).map(id=>{const t=result.ledger.transactions.find(t=>t.id===id);assert.ok(t,`Unknown ledger match ID ${id}`);return t.row;}),kind:m.kind}));
 const auto=all.filter(m=>m.kind==='auto');
 const actual=auto.map(key).sort();
 check(prefix+'all and only required automatic sets',()=>assert.deepEqual(actual,expected));
 check(prefix+'no invented manual approvals',()=>assert.ok(all.every(m=>m.kind==='auto')));
 const cases=result.cases.filter(c=>c.status==='Matched');
 check(prefix+'matched cases agree exactly',()=>assert.deepEqual(cases.map(c=>key({supplierRows:c.supplierMembers.map(t=>t.row),ledgerRows:c.ledgerMembers.map(t=>t.row)})).sort(),expected));
 for(const g of contract.requiredAutoGroups){const k=key(g),c=cases.find(c=>key({supplierRows:c.supplierMembers.map(t=>t.row),ledgerRows:c.ledgerMembers.map(t=>t.row)})===k);check(prefix+`required totals ${k}`,()=>{assert.ok(c,'Missing required case');assert.equal(c.supplierTotal,g.supplierTotalMinor);assert.equal(c.ledgerTotal,g.ledgerTotalMinor);assert.equal(c.variance,0);});}
 for(const [i,side] of ['supplier','ledger'].entries()){
  const source=result[side],definition=contract[side],facts=definition.expectedRows;
  const rows=files[i].sheets[definition.mapping.sheet].rows;
  check(prefix+`${side} literal original rows`,()=>assert.deepEqual(rows,[definition.header,...facts.map(f=>f.values)]));
  const tx=facts.filter(f=>f.disposition==='transaction'),errors=facts.filter(f=>f.disposition==='error'),excluded=facts.filter(f=>f.disposition==='excluded');
  check(prefix+`${side} exact readable row set`,()=>assert.deepEqual(sorted(source.transactions.map(t=>t.row)),sorted(tx.map(f=>f.row))));
  check(prefix+`${side} exact invalid row set`,()=>assert.deepEqual(sorted(new Set(source.errors.map(e=>e.row))),sorted(errors.map(f=>f.row))));
  check(prefix+`${side} exact excluded row set`,()=>assert.deepEqual(sorted(source.excluded.map(e=>e.row)),sorted([1,...excluded.map(f=>f.row)])));
  check(prefix+`${side} all invalid reasons visible`,()=>assert.ok(source.errors.every(e=>typeof e.message==='string'&&e.message.trim())));
  check(prefix+`${side} raw excluded rows retained`,()=>{for(const e of source.excluded){assert.ok(e.reason.trim());assert.deepEqual(e.values,rows[e.row-1]);}});
  check(prefix+`${side} full row conservation`,()=>{const classified=[...source.transactions.map(t=>t.row),...new Set(source.errors.map(e=>e.row)),...source.excluded.map(e=>e.row)];assert.deepEqual(sorted(classified),rows.map((_,i)=>i+1));});
  for(const f of tx){const t=source.transactions.find(t=>t.row===f.row);check(prefix+`${side}/${f.row} exact facts`,()=>{assert.ok(t);assert.equal(t.amount,f.amountMinor);assert.equal(t.date,f.date);assert.equal(t.chosenReference,f.reference);assert.equal(t.currency,f.currency);assert.equal(t.originalAmount,f.values[definition.mapping.amount]);});}
 }
 const readableIds=[...result.supplier.transactions,...result.ledger.transactions].map(t=>t.id);
 check(prefix+'unique generated row identities',()=>assert.equal(new Set(readableIds).size,readableIds.length));
 check(prefix+'all readable rows appear once in cases',()=>assert.deepEqual(result.cases.flatMap(c=>c.sourceTrace.map(t=>t.sourceRowId)).sort(),[...readableIds].sort()));
 check(prefix+'partial work does not certify balance',()=>{assert.equal(result.balanceComparable,false);assert.equal(result.bridge,null);});
 return {automatic:auto,requiredSatisfied:expected.filter(k=>actual.includes(k)).length,missing:expected.filter(k=>!actual.includes(k)),falseApprovals:actual.filter(k=>!expected.includes(k)),invalidRows:{supplier:result.supplier.errors,ledger:result.ledger.errors},caseSummary:result.cases.map(c=>({status:c.status,classification:c.classification,supplierRows:c.supplierMembers.map(t=>t.row),ledgerRows:c.ledgerMembers.map(t=>t.row),evidence:c.evidence})),diagnostics:result.diagnostics};
}

const results=[];
for(const c of contracts.cases){
 const failures=[];const check=(label,f)=>{try{f();}catch(e){failures.push({label,error:errorText(e)});}};
 let observed=null,phase='read';
 try{
  const definitions=c.kind==='read-refusal'?[c.supplier]:[c.supplier,c.ledger];
  const files=[];
  for(const d of definitions){const bytes=await readFile(path.join(here,d.file));files.push(await readSource(path.basename(d.file),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),d.cuts));}
  if(c.kind==='read-refusal'){failures.push({label:'Required whole-source refusal',error:'Source was returned despite incomplete PDF stream'});}
  else {
   phase='reconcile';const scope=structuredClone(c.scope??contracts.scope),mappings=definitions.map(d=>structuredClone(d.mapping));
   const run=()=>reconcileSupplierStatement({files,mappings,scope,decisions:[],rejected:[]});
   if(c.dateChoice){
    let initial;try{run();}catch(e){initial=e;}
    check('Unanswered ambiguous date remains a production gate',()=>{assert.ok(initial,'Missing format question');assert.match(String(initial.message),new RegExp(c.initialRefusalPattern,'i'));});
    const {side,value,candidates}=c.dateChoice;mappings[side].dateFormat=value;
    mappings[side].formatChoice={dateFormat:formatChoice(files[side],mappings[side],'dateFormat',value,candidates,scope.decimals)};
   }
   const computed=run();
   if(c.kind==='operation-refusal'){failures.push({label:'Required production gate',error:'Financial result returned despite source-level ambiguity/unsafe extraction'});observed={matches:computed.result.matches,falseApprovals:computed.result.matches.filter(m=>m.kind==='auto').map(m=>({supplierIds:m.supplierIds??[m.supplierId],ledgerIds:m.ledgerIds??[m.ledgerId]}))};}
   else {
    observed=inspectResult(c,computed.result,files,check);
    if(c.roundtrip){
     phase='session/export';const review={checked:false,name:'Synthetic partial acceptance',notes:'Invalid rows remain unresolved; no balance completion'};
     const saved=await saveSession({files,mappings:computed.mappings??mappings,scope,decisions:[],rejected:[],events:[],review});
     const restored=await restoreSession(saved);
     inspectResult(c,restored.result,restored.files,check,'restored: ');
     const exported=await exportWorkbook(restored.result,restored.files,review);
     const book=new ExcelJS.Workbook();await book.xlsx.load(exported);
     const source=book.getWorksheet('Parsed Supplier Source'),ledger=book.getWorksheet('Parsed Ledger Source');
     check('Workbook retains complete original source cells including invalid row',()=>{for(const [sheet,definition] of [[source,c.supplier],[ledger,c.ledger]]){assert.ok(sheet);assert.equal(sheet.rowCount,definition.expectedRows.length+2);for(const fact of definition.expectedRows){const values=fact.values.map((_,i)=>sheet.getRow(fact.row+1).getCell(i+2).value??'');assert.deepEqual(values,fact.values);}}});
     check('Workbook matches are only the required exact pairs',()=>{const matches=book.getWorksheet('Matches');assert.ok(matches);assert.equal(matches.rowCount,c.requiredAutoGroups.length+1);assert.ok([...Array(matches.rowCount-1)].every((_,i)=>matches.getCell(i+2,17).value==='Auto'));});
     // Existing workbook conventions do not promise a new invalid-row sheet name.
     // Require each original error message to be retained somewhere in the workbook.
     const texts=[];book.eachSheet(s=>s.eachRow(r=>r.eachCell(cell=>{if(typeof cell.value==='string')texts.push(cell.value);})));const allText=texts.join('\n');
     check('Workbook retains every invalid-row reason',()=>{for(const err of [...restored.result.supplier.errors,...restored.result.ledger.errors])assert.ok(allText.includes(err.message),err.message);});
     observed.roundtrip={sessionBytes:saved.byteLength,workbookBytes:exported.byteLength,restored:true,exported:true};
    }
   }
  }
 }catch(e){
  const expected=(c.kind==='read-refusal'&&phase==='read')||(c.kind==='operation-refusal'&&phase==='reconcile');
  if(expected){check('Expected refusal identifies declared fault',()=>assert.match(String(e.message),new RegExp(c.errorPattern,'i')));observed={refused:true,phase,errorType:e.name,message:e.message};}
  else failures.push({label:'Unexpected production operation exception',phase,error:errorText(e)});
 }
 results.push({id:c.id,title:c.title,kind:c.kind,pass:failures.length===0,requiredAutoGroups:c.requiredAutoGroups,failures,observed});
}
await verifyFrozen();
const after=await hashTree(path.join(engineRoot,'lib'));
const unchanged=JSON.stringify(before)===JSON.stringify(after);
const report={schema:1,purpose:contracts.purpose,generatedAt:new Date().toISOString(),engineRoot,engineVersion:ENGINE_VERSION,frozenManifestSha256:sha(manifest),frozenContractsSha256:sha(await readFile(path.join(here,'contracts.json'))),libSha256Before:before,libSha256After:after,engineLibFilesUnchanged:unchanged,cases:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,requiredPositiveSets:contracts.cases.reduce((n,c)=>n+c.requiredAutoGroups.length,0),satisfiedPositiveSets:results.reduce((n,r)=>n+(r.observed?.requiredSatisfied??0),0),falseApprovedSets:results.reduce((n,r)=>n+(r.observed?.falseApprovals?.length??0),0),unexpectedOperationExceptions:results.filter(r=>r.failures.some(f=>f.label==='Unexpected production operation exception')).length,results};
await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:report.cases,passed:report.passed,failed:report.failed,requiredPositiveSets:report.requiredPositiveSets,satisfiedPositiveSets:report.satisfiedPositiveSets,falseApprovedSets:report.falseApprovedSets,unexpectedOperationExceptions:report.unexpectedOperationExceptions,engineLibFilesUnchanged:unchanged,out},null,2));
process.exitCode=report.failed||!unchanged?1:0;
