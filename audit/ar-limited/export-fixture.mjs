import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { arDemoReadings, arDemoScope } from '../../lib/reconciliation/ar-demo.ts';
import { replayAr, saveAr, restoreAr, exportAr } from '../../lib/reconciliation/ar-io.ts';
await mkdir('work/ar-limited',{recursive:true});
for(const name of ['positive','amount-difference','type-collision','receipt-is-not-invoice-allocation','duplicate-own-document']){
 const files=await Promise.all(['ledger','statement'].map(async side=>readFile(`${name}-${side}.csv`,new Uint8Array(await fsRead(`audit/ar-limited/frozen/${name}-${side}.csv`)).buffer)));
 const input={files,readings:arDemoReadings,scope:arDemoScope,events:[]};
 const {result}=await replayAr(input);
 await writeFile(`work/ar-limited/${name}-direct.xlsx`,new Uint8Array(await exportAr(input,result)));
 const session=await saveAr(input),restored=await restoreAr(session);
 await writeFile(`work/ar-limited/${name}-restored.xlsx`,new Uint8Array(await exportAr(restored.state,restored.result)));
 if(name==='positive'){
  await writeFile('work/ar-limited/positive-session.json',new Uint8Array(session));
  const first=result.cases[0];input.events=[{context:result.context,at:'2026-10-06T00:00:00.000Z',action:'reopen',ids:first.ids,note:'Synthetic document correspondence reopened for review'}];
  const opened=await replayAr(input);await writeFile('work/ar-limited/positive-reopened.xlsx',new Uint8Array(await exportAr(opened.state,opened.result)));
  const restoredOpen=await restoreAr(await saveAr(input));await writeFile('work/ar-limited/positive-reopened-restored.xlsx',new Uint8Array(await exportAr(restoredOpen.state,restoredOpen.result)));
  input.events.push({context:result.context,at:'2026-10-06T00:00:00.000Z',action:'accept',ids:first.ids,note:'Synthetic source documents independently rechecked'});
  const accepted=await replayAr(input);await writeFile('work/ar-limited/positive-reconfirmed.xlsx',new Uint8Array(await exportAr(accepted.state,accepted.result)));
 }
}
console.log('AR original source and replay workbooks generated.');
