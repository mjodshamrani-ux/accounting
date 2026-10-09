import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const base='work/independent-review/b22-product-evidence/';
const session=Array.from(await readFile(base+'two-current-session.json'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4197/');
 const data=await page.evaluate(async raw=>{
  const {createWorkerClient}=await import('/lib/reconciliation/worker-client.ts');
  const {default:LocalWorker}=await import('/lib/reconciliation/worker.ts?worker&inline');
  const ports=[];const checks=[];const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);const ensure=(v,msg)=>{if(!v)throw Error(msg);};
  class Port{
   onmessage=null;onerror=null;onmessageerror=null;terminated=false;mode='normal';held=null;
   constructor(){this.worker=new LocalWorker();ports.push(this);this.worker.onmessage=e=>{const handler=this.onmessage;let data=e.data;if(this.mode==='hold'){this.held={handler,data};return;}if(this.mode==='wrong-id'){handler?.({data:{...data,id:data.id+999}});this.mode='normal';}if(this.mode==='wrong-action')data.action='bank-reconcile';if(this.mode==='bad-buffer')data.value=new Uint8Array(data.value);handler?.({data});};this.worker.onerror=e=>this.onerror?.(e);this.worker.onmessageerror=e=>this.onmessageerror?.(e);}
   postMessage(v){this.worker.postMessage(v);}terminate(){this.terminated=true;this.worker.terminate();}
  }
  const client=createWorkerClient(()=>new Port(),15000);
  try{
   await client.prepare();const restored=await client.request('bank-adjustment-restore',{buffer:new Uint8Array(raw).buffer});const {state,result}=restored;
   ensure(result.status==='reconciled-with-evidence','restore baseline');
   for(let i=0;i<6;i++){
    const forged=structuredClone(state);const fs=[...forged.balance.bank.files,...forged.balance.files,...forged.files];const originalHeader=fs[i].sheets[0].rows[0][0];fs[i].sheets[0].rows[0][0]='FORGED-CACHE-HEADER';
    const value=await client.request('bank-adjustment-reconcile',forged);ensure(eq(value.result,result),'cache result '+i);ensure([...value.state.balance.bank.files,...value.state.balance.files,...value.state.files][i].sheets[0].rows[0][0]===originalHeader,'reread original '+i);checks.push({probe:'actual-browser-worker-reread-'+i,passed:true});
   }
   const saved=await client.request('bank-adjustment-save',state);ensure(saved instanceof ArrayBuffer,'saved buffer');const second=await client.request('bank-adjustment-restore',{buffer:saved});ensure(eq(second.result,result),'full restore result');ensure(eq(second.state.events,state.events),'full restore history');const exported=await client.request('bank-adjustment-export',{state:second.state,result:second.result});ensure(exported instanceof ArrayBuffer&&new Uint8Array(exported)[0]===80,'actual export ArrayBuffer');checks.push({probe:'actual-worker-save-restore-export-atomic-history',passed:true,events:second.result.events.length,sessionBytes:saved.byteLength,exportBytes:exported.byteLength});
   let port=ports.at(-1);port.mode='wrong-id';ensure(eq((await client.request('bank-adjustment-reconcile',state)).result,result),'wrong id ignored');checks.push({probe:'wrong-id-ignored',passed:true});
   const rejects=async run=>{let rejected=false;try{await run();}catch{rejected=true;}ensure(rejected,'expected rejection');};
   port.mode='wrong-action';await rejects(()=>client.request('bank-adjustment-reconcile',state));ensure(port.terminated,'wrong action terminate');checks.push({probe:'wrong-action-rejected',passed:true});
   await client.prepare();port=ports.at(-1);port.mode='bad-buffer';await rejects(()=>client.request('bank-adjustment-export',{state,result}));ensure(port.terminated,'typedarray terminate');checks.push({probe:'typed-array-export-rejected',passed:true});
   await client.prepare();port=ports.at(-1);port.mode='hold';const abort=new AbortController();const pending=client.request('bank-adjustment-reconcile',state,abort.signal).catch(e=>e);const start=Date.now();while(!port.held){if(Date.now()-start>15000)throw Error('hold timeout');await new Promise(r=>setTimeout(r,10));}abort.abort();ensure((await pending) instanceof Error&&port.terminated,'cancel and terminate');port.held.handler?.({data:port.held.data});ensure(eq((await client.request('bank-adjustment-reconcile',state)).result,result),'fresh request after late result');checks.push({probe:'cancellation-real-late-response-and-recovery',passed:true});
   return {actualBrowserWorker:true,allPassed:true,checks,exportBytes:Array.from(new Uint8Array(exported))};
  }finally{ports.forEach(p=>p.terminate());}
 },session);
 await writeFile(base+'6257699-actual-worker-export.xlsx',new Uint8Array(data.exportBytes));delete data.exportBytes;
 await writeFile(base+'6257699-browser-worker-probes.json',JSON.stringify({sha:'6257699e1f4b132d816d15d67493a025942da583',...data},null,2)+'\n');console.log(data);
}finally{await browser.close();}
