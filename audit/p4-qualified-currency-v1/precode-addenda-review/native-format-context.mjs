import {readFile as bytes,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readFile} from '../../../p5-browser-source-contract/lib/reconciliation/io.ts';
import {defaultMapping} from '../../../p5-browser-source-contract/lib/reconciliation/types.ts';
import {formatChoice} from '../../../p5-browser-source-contract/lib/reconciliation/input-readiness.ts';
import {suggestFormats} from '../../../p5-browser-source-contract/lib/reconciliation/format-inference.ts';
const contracts=new URL('../next-contracts/',import.meta.url);
const frozen=new URL('p4-qualified-currency-v1/frozen/',contracts);
const contract=JSON.parse(await bytes(new URL('contract.json',frozen),'utf8'));
const truth=JSON.parse(await bytes(new URL('p4-qualified-currency-format-addendum-v1/manual-number-format-truth.json',contracts),'utf8'));
const mapping={...defaultMapping(),...contract.mapping};
const result=[];
for(const c of contract.cases.filter(c=>c.outcome==='derived'||['jpy-fractional','kwd-excess-fraction'].includes(c.id))){
 const e=JSON.parse(await bytes(new URL(c.expected,frozen),'utf8'));
 const decimals=e.currencyContext?.decimals??(c.id.startsWith('jpy')?0:3);
 const pdfBytes=await bytes(new URL(c.original,frozen));
 const original=await readFile(c.original,Uint8Array.from(pdfBytes).buffer,e.cuts);
 const originalFormat=suggestFormats(original,mapping,decimals);
 const originalChoice=formatChoice(original,mapping,'numberFormat','dot',originalFormat.numberFormat.candidates,decimals);
 let csvContext;
 if(c.outcome==='derived'){
  const csvBytes=await bytes(new URL(c.id+'.csv',frozen));
  const csvSource=await readFile(c.id+'.csv',Uint8Array.from(csvBytes).buffer);
  const csvMapping={...mapping,pdfReviewed:undefined};
  const formats=suggestFormats(csvSource,csvMapping,decimals);
  const choice=formatChoice(csvSource,csvMapping,'numberFormat','dot',formats.numberFormat.candidates,decimals);
  csvContext={sha256:csvSource.sha256,formats,choice};
  if(c.id.startsWith('kwd')){
   const t=truth.cases.find(t=>t.id===c.id);
   assert.deepEqual(originalChoice,t.originalNumberFormatChoice);
   assert.deepEqual(choice,t.derivedNumberFormatChoice);
   assert.equal(originalFormat.numberFormat.status,'ambiguous');
   assert.equal(formats.numberFormat.status,'ambiguous');
  }else{assert.equal(originalFormat.numberFormat.status,'proven');assert.equal(formats.numberFormat.status,'proven');}
 }
 result.push({id:c.id,originalSha256:original.sha256,originalFormat,originalChoice,csvContext});
 console.log(JSON.stringify({id:c.id,originalStatus:originalFormat.numberFormat.status,originalCandidates:originalFormat.numberFormat.candidates,unreadRows:originalFormat.numberFormat.unreadRows,csvStatus:csvContext?.formats.numberFormat.status}));
}
await writeFile(new URL('native-format-context.json',import.meta.url),JSON.stringify({outcome:'PASS-FORMAT-CONTEXT-COMPARISON',claims:'Native format observations only; financial truth remains independently frozen.',cases:result},null,2)+'\n');
