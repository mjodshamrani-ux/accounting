import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {writeFile} from 'node:fs/promises';
import {finishedAdjustment} from '../../../audit/bank-adjustment/fixtures.ts';
import {createWorkerClient} from '../../../lib/reconciliation/worker-client.ts';
const ports=[];
class Port {
 onmessage=null;onerror=null;onmessageerror=null;terminated=false;mode='normal';held=null;
 constructor(){this.worker=new Worker(new URL('./worker_thread_bootstrap.mjs',import.meta.url),{execArgv:['--experimental-strip-types']});ports.push(this);this.worker.on('message',data=>{
   const handler=this.onmessage;
   if(this.mode==='hold'){this.held={handler,data};return;}
   if(this.mode==='wrong-action')data.action='bank-reconcile';
   if(this.mode==='bad-buffer')data.value=new Uint8Array(data.value);
   if(this.mode==='wrong-id'){handler?.({data:{...data,id:data.id+999}});this.mode='normal';}
   handler?.({data});
 });this.worker.on('error',e=>this.onerror?.(e));}
 postMessage(message){this.worker.postMessage(message);}
 terminate(){this.terminated=true;void this.worker.terminate();}
}
const client=createWorkerClient(()=>new Port(),10000);
const {state,result}=await finishedAdjustment();const checks=[];
try {
 await client.prepare();
 for(let source=0;source<6;source++){
   const forged=structuredClone(state);const files=[...forged.balance.bank.files,...forged.balance.files,...forged.files];files[source].sheets[0].rows[0][0]='FORGED-CACHE-HEADER';
   const value=await client.request('bank-adjustment-reconcile',forged);assert.deepEqual(value.result,result);assert.equal([...value.state.balance.bank.files,...value.state.balance.files,...value.state.files][source].sheets[0].rows[0][0],'Record ID' /* bank/balance */ === 'x' ? '' : source<4?'Record ID':source===4?'Item ID':'Evidence ID');
   checks.push({probe:'actual-worker-reread-'+source,source,passed:true,status:value.result.status});
 }
 const data=await client.request('bank-adjustment-save',state);assert(data instanceof ArrayBuffer);
 const restored=await client.request('bank-adjustment-restore',{buffer:data});assert.deepEqual(restored.result,result);assert.deepEqual(restored.state.events,state.events);
 const exported=await client.request('bank-adjustment-export',{state:restored.state,result:restored.result});assert(exported instanceof ArrayBuffer);assert(new Uint8Array(exported)[0]===80&&new Uint8Array(exported)[1]===75);
 await writeFile('work/independent-review/b22-product-evidence/7b84ff4-actual-worker-export.xlsx',new Uint8Array(exported));
 checks.push({probe:'actual-worker-session-restore-export',passed:true,sessionBytes:data.byteLength,exportBytes:exported.byteLength,arrayBuffer:true,events:restored.result.events.length});
 let port=ports.at(-1);port.mode='wrong-id';assert.deepEqual((await client.request('bank-adjustment-reconcile',state)).result,result);checks.push({probe:'wrong-id-ignored',passed:true});
 port.mode='wrong-action';await assert.rejects(()=>client.request('bank-adjustment-reconcile',state));assert(port.terminated);checks.push({probe:'wrong-action-rejected',passed:true});
 await client.prepare();port=ports.at(-1);port.mode='bad-buffer';await assert.rejects(()=>client.request('bank-adjustment-export',{state,result}));assert(port.terminated);checks.push({probe:'typed-array-download-rejected',passed:true});
 await client.prepare();port=ports.at(-1);port.mode='hold';const controller=new AbortController();const pending=client.request('bank-adjustment-reconcile',state,controller.signal).catch(e=>e);
 const start=Date.now();while(!port.held){if(Date.now()-start>10000)throw Error('Worker did not reply');await new Promise(r=>setTimeout(r,5));}
 controller.abort();assert((await pending) instanceof Error);assert(port.terminated);const old=port.held;old.handler?.({data:old.data});
 const fresh=await client.request('bank-adjustment-reconcile',state);assert.deepEqual(fresh.result,result);checks.push({probe:'cancel-discards-actual-late-result-and-fresh-worker-recovers',passed:true});
 await writeFile('work/independent-review/b22-product-evidence/7b84ff4-worker-probes.json',JSON.stringify({sha:'7b84ff403afa25df49924b64e4f4077b1c793e06',actualWorkerModule:true,transport:'Node worker_threads with Web Worker self bridge',browserWorker:false,allPassed:true,checks},null,2)+'\n');console.log({workerProbes:checks.length,allPassed:true});
}finally{ports.forEach(p=>p.terminate());}
