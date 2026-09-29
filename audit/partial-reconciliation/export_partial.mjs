// Supplemental artifact capture after a caller explicitly selects a frozen engine.
// Financial/source expectations stay in the original frozen PR01 contract.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name)=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
assert.ok(arg('--engine-root')&&arg('--out-dir'),'Required --engine-root immutable/archive --out-dir new/directory');
const root=path.resolve(arg('--engine-root')),out=path.resolve(arg('--out-dir'));
await mkdir(out,{recursive:false});
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const hashes=async(dir,prefix='')=>{const result={};for(const e of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const key=prefix+e.name;if(e.isDirectory())Object.assign(result,await hashes(path.join(dir,e.name),key+'/'));else if(e.isFile())result[key]=sha(await readFile(path.join(dir,e.name)));}return result;};
const manifest=await readFile(path.join(here,'frozen/SHA256SUMS'));
assert.equal(sha(manifest),'0b10b982659d984e9298082c0a76bb183fcd6d30abb8c34a5be520fed9a57e7e');
for(const line of manifest.toString().trim().split('\n')){const [expected,name]=line.split('  ');assert.equal(sha(await readFile(path.join(here,'frozen',name))),expected,name);}
const before=await hashes(path.join(root,'lib'));
const mod=(name)=>pathToFileURL(path.join(root,'lib/reconciliation',name)).href;
const {readFile:readSource,exportWorkbook}=await import(mod('io.ts'));
const {reconcileSupplierStatement}=await import(mod('supplier-reconciliation.ts'));
const {ENGINE_VERSION}=await import(mod('types.ts'));
const definitions=JSON.parse(await readFile(path.join(here,'frozen/contracts.json'),'utf8'));
const contract=definitions.cases.find(c=>c.id==='PR01');
const files=[];
for(const side of ['supplier','ledger']){const f=contract[side],bytes=await readFile(path.join(here,'frozen',f.file));files.push(await readSource(path.basename(f.file),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));}
const mappings=[contract.supplier.mapping,contract.ledger.mapping].map(m=>structuredClone(m));
const scope=structuredClone(definitions.scope);
// These supplemental manual entries intentionally equal only the literal
// readable subtotals. They must not cure the unknown original supplier amount.
if(process.argv.includes('--affirm-processed-balances')){
 scope.coverageConfirmed=true;
 mappings[0].opening='0.00';mappings[0].closing='85.50';
 mappings[1].opening='0.00';mappings[1].closing='97.84';
}
const review={checked:true,name:'Synthetic independent partial reviewer',notes:'Reviewed visible rows; unread original amount remains unresolved. No completion approval.'};
const report={engineRoot:root,engineVersion:ENGINE_VERSION,startedAt:new Date().toISOString(),contract:'PR01',frozenManifestSha256:sha(manifest),supplementalManualBalanceConfirmation:process.argv.includes('--affirm-processed-balances'),scope,mappings,review,libSha256Before:before};
try{
 const {result}=reconcileSupplierStatement({files,mappings,scope,decisions:[],rejected:[]});
 const xlsx=await exportWorkbook(result,files,review);
 const bytes=new Uint8Array(xlsx);await writeFile(path.join(out,'PR01-reviewed.xlsx'),bytes,{flag:'wx'});
 report.workbookSha256=sha(bytes);report.workbookBytes=bytes.byteLength;
 report.resultObservation={matches:result.matches.length,errors:{supplier:result.supplier.errors,ledger:result.ledger.errors},balanceComparable:result.balanceComparable,bridge:result.bridge};
 report.completed=true;
}catch(error){report.completed=false;report.error={name:error.name,message:error.message,stack:error.stack};}
report.libSha256After=await hashes(path.join(root,'lib'));
report.engineUnchanged=JSON.stringify(before)===JSON.stringify(report.libSha256After);
report.finishedAt=new Date().toISOString();
await writeFile(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completed:report.completed,engineUnchanged:report.engineUnchanged,engine:ENGINE_VERSION,out,error:report.error?.message},null,2));
process.exitCode=report.completed&&report.engineUnchanged?0:1;
