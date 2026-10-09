import assert from 'node:assert/strict';
import {readFile as bytes, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from '../../../p5-browser-source-contract/lib/reconciliation/io.ts';
import {defaultMapping} from '../../../p5-browser-source-contract/lib/reconciliation/types.ts';
import {SectionDerivedReadingSession} from '../../../p5-browser-source-contract/lib/reconciliation/section-derived-reading.ts';
import {formatChoice} from '../../../p5-browser-source-contract/lib/reconciliation/input-readiness.ts';
import {prepareVerifiedSources} from '../../../p5-browser-source-contract/lib/reconciliation/source-preparation.ts';

const base=new URL('../next-contracts/p4-qualified-currency-v1/frozen/',import.meta.url);
const contract=JSON.parse(await bytes(new URL('contract.json',base),'utf8'));
const mapping={...defaultMapping(),...contract.mapping};
const policy={SAR:2,JPY:0,KWD:3};
const revision='independent-precode-qualified-currency-native-v1';
const results=[];
const checks=[];
function check(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.message});}}
for(const c of contract.cases){
 const original=await bytes(new URL(c.original,base));
 const e=JSON.parse(await bytes(new URL(c.expected,base),'utf8'));
 const source=await readFile(c.original,Uint8Array.from(original).buffer,e.cuts);
 const sha=createHash('sha256').update(original).digest('hex');
 const s=source.sheets[0];
 const inventory=s.rows.map((values,i)=>({row:i+1,page:s.rowPages[String(i+1)],values}));
 check(c.id+': source/owned bytes',()=>{assert.equal(sha,e.originalSha256);assert.equal(original.length,e.originalByteLength);assert.equal(source.sha256,sha);assert.deepEqual(Buffer.from(source.original),original);});
 check(c.id+': native inventory and metadata',()=>{assert.equal(source.sheets.length,1);assert.equal(s.name,'PDF');assert.deepEqual(inventory,e.inventory);assert.deepEqual(source.pdf,{cuts:e.cuts,pages:Math.max(...e.inventory.map(x=>x.page))});assert.deepEqual(s.formulaRows,[]);assert.deepEqual(s.hiddenRows,[]);});
 check(c.id+': extraction issues',()=>{for(const field of ['rowIssues','cellIssues','referenceIssues'])assert.ok(!Object.values(s[field]??{}).some(x=>x.length),field);});
 const decimals=e.currencyContext?.decimals??(c.id.startsWith('jpy')?0:c.id.startsWith('kwd')?3:2);
 const session=new SectionDerivedReadingSession(source,mapping,revision,decimals);
 let boundary={};
 try{
  const initial=await session.inspect();
  boundary={stage:'inspect',accepted:true,review:initial.review};
  if(c.outcome==='outside-new-family'){
   const selection=await session.selectProposalIds(initial.review.proposals.map(p=>p.id));
   const receipt=await session.recordReviewerDecision({decision:'accept',reviewerLabel:'Independent synthetic precode reviewer',rationale:'Reviewed original synthetic inventory, source roles and literal amount. No field or financial approval.',reviewedSourceHash:selection.review.sourceHash,reviewedExtractionHash:selection.review.extractionHash,reviewedExtractionRevision:selection.review.extractionRevision,reviewedSelectionHash:selection.selectionHash,acknowledgements:{originalRowsReviewed:true,referenceRolesReviewed:true,signedAmountsPreserved:true,derivedSourceUnderstood:true}});
   const artifact=await session.apply(receipt,source,mapping,revision,decimals);
   boundary={...boundary,artifact:{csv:artifact.csv,provenance:artifact.provenance,financialApproval:artifact.financialApproval,nativeSourceHash:artifact.nativeSource.sha256}};
   check(c.id+': legacy bare family accepted without new currency context',()=>{assert.equal(artifact.financialApproval,false);assert.equal(artifact.provenance.currencyContext,undefined);assert.equal(artifact.nativeSource.sheets[0].rows[1][1],'INV-000271');assert.equal(artifact.nativeSource.sheets[0].rows[1][3],'-12.50');assert.deepEqual(Buffer.from(artifact.originalPdf),original);});
  }
 }catch(error){boundary={stage:'inspect',accepted:false,error:error.message,state:session.state};}
 check(c.id+': current preimplementation boundary',()=>{if(c.outcome==='outside-new-family'){assert.equal(boundary.accepted,true);assert.ok(boundary.artifact);}else{assert.equal(boundary.accepted,false);assert.match(boundary.error,/Unsupported original header, monetary context or source issues/);assert.equal(boundary.state,'empty');assert.equal(session.selection,null);}});
 let csvProof;
 if(c.outcome==='derived'){
  const raw=await bytes(new URL(c.id+'.csv',base));
  const csvSource=await readFile(c.id+'.csv',Uint8Array.from(raw).buffer);
  const currency=e.currencyContext.currency;
  const scope={supplier:'',entity:'',account:'',currency,decimals:policy[currency],cutoff:'2100-12-31',dateWindow:0,confirmed:false,coverageConfirmed:false};
  const csvMapping={...defaultMapping(),sheet:0,header:0,date:0,reference:1,description:2,amount:3,mode:'signed',multiplier:1,numberFormat:'dot',dateFormat:'ymd'};
  let ambiguityBeforeBoundChoice;
  let prepared;
  try { prepared=prepareVerifiedSources([csvSource],[csvMapping],scope,['supplier']).sources[0]; } catch(error) {
   if(error.readiness?.code!=='FORMAT_AMBIGUOUS_UNRESOLVED'||currency!=='KWD')throw error;
   ambiguityBeforeBoundChoice=error.readiness;
   csvMapping.formatChoice={numberFormat:formatChoice(csvSource,csvMapping,'numberFormat','dot',error.readiness.candidates,scope.decimals)};
   prepared=prepareVerifiedSources([csvSource],[csvMapping],scope,['supplier']).sources[0];
  }
  csvProof={source:csvSource.sheets,sha256:csvSource.sha256,scope,csvMapping,ambiguityBeforeBoundChoice,prepared};
  check(c.id+': native CSV exact/header/movements/no approval',()=>{assert.deepEqual(csvSource.sheets[0].rows,e.csvRows);assert.equal(csvSource.sha256,e.csvSha256);assert.deepEqual(Buffer.from(csvSource.original),raw);assert.deepEqual(prepared.errors,[]);assert.deepEqual(prepared.transactions.map(t=>t.amountMinor),e.amountMinor);assert.deepEqual(prepared.transactions.map(t=>t.originalAmount),e.signedAmounts);assert.equal(prepared.excluded.length,1);assert.equal(prepared.excluded[0].row,1);assert.deepEqual(prepared.excluded[0].values,e.csvRows[0]);assert.equal(prepared.excluded[0].kind,'non-movement');assert.equal(scope.confirmed,false);});
 }
 results.push({id:c.id,outcome:c.outcome,sha256:sha,originalByteLength:original.length,pdf:source.pdf,sheets:source.sheets,boundary,csvProof});
 console.log(JSON.stringify({id:c.id,rows:inventory.length,pages:source.pdf.pages,currentBoundary:boundary.accepted?'legacy accepted':'qualified unsupported',failures:checks.filter(x=>!x.pass&&x.name.startsWith(c.id+':'))}));
}
const output={outcome:checks.every(x=>x.pass)?'PASS':'FAIL',claims:'Independent native precode extraction and current unsupported-family boundary only; no future implementation acceptance or financial approval.',contractFreezeSha256:createHash('sha256').update(await bytes(new URL('freeze.json',base))).digest('hex'),checks,cases:results};
await writeFile(new URL('native-results-second.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({outcome:output.outcome,checks:checks.length,failures:checks.filter(x=>!x.pass)}));
process.exitCode=output.outcome==='PASS'?0:1;
