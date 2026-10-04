import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {knownVisualSource} from '../make_record.mjs';
import {readFile} from '../../../lib/reconciliation/io.ts';
import {editVisualTableRow,confirmVisualTableExclusion,confirmVisualTableCoverage} from '../../../lib/reconciliation/visual-table.ts';
import {createVisualAccountingRecord,saveVisualAccountingRecord,visualAccountingMapping} from '../../../lib/reconciliation/visual-accounting-source.ts';
import {reconcileSupplierStatement} from '../../../lib/reconciliation/supplier-reconciliation.ts';
import {saveSession} from '../../../lib/reconciliation/session.ts';
await mkdir('work/visual-accounting-live',{recursive:true});
const reports=[];
for(const key of ['unproved-footer','excluded-competitor','omitted-reviewed-facts']){
 const f=await knownVisualSource(undefined,key==='unproved-footer'?{noFooterProof:true}:key==='excluded-competitor'?{reference2:'INV-001',amount2:'-250.00'}:{reference2:'INV-999',amount2:'-250.00'});
 let bytes=f.bytes;
 if(key!=='unproved-footer'){
  let table=editVisualTableRow(f.table,1,{disposition:'non-movement',note:'Declared as total by reviewer',cells:key==='excluded-competitor'?['region:9','region:10','region:12',null]:['region:9',null,null,null]});
  table=await confirmVisualTableExclusion(table,1,'2026-10-04T09:00:00.000Z');
  table=await confirmVisualTableCoverage(table,'2026-10-04T09:00:00.000Z');
  const r=await createVisualAccountingRecord(table,f.headers,f.context,'2026-10-04T09:00:00.000Z',f.currencyProof);bytes=await saveVisualAccountingRecord(r);
 }
 const supplier=await readFile(key+'.tarasuf-reviewed.json',bytes.slice().buffer);
 const ledger=await readFile('ledger.csv',new TextEncoder().encode(f.contract.ledger.map(r=>r.join(',')).join('\n')).buffer);
 const c=f.context,sm=visualAccountingMapping(supplier),lm={...sm,reference:0,date:1,amount:2,currencyColumn:3};delete lm.formatChoice;
 const state={files:[supplier,ledger],mappings:[sm,lm],scope:{supplier:c.supplier,entity:c.entity,account:c.account,currency:c.currency,decimals:c.decimals,cutoff:c.cutoff,dateWindow:3,confirmed:true,coverageConfirmed:false},decisions:[],rejected:[],events:[],review:{name:'',notes:'',checked:false}};
 const result=reconcileSupplierStatement(state).result;
 assert.equal(result.matches.length,0);
 const session=await saveSession(state);
 await writeFile('work/visual-accounting-live/'+key+'.json',new Uint8Array(session));
 await writeFile('work/visual-accounting-live/'+key+'-source.json',bytes);
 reports.push({case:key,expectedMatches:0,localMatches:result.matches.length,unknownExclusionRow:key==='unproved-footer'?4:3,manualExclusions:result.supplier.excluded.filter(r=>r.kind==='manual').map(r=>r.row)});
}
await writeFile('work/visual-accounting-live/negative-contract.json',JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports));
