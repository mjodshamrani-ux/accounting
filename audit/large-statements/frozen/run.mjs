import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contracts,evaluateContract,verifyFrozen } from './checks.mjs';
const args=process.argv.slice(2),arg=(name)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
assert.ok(arg('--engine-root')&&arg('--out'),'Required --engine-root and --out');
const root=path.resolve(arg('--engine-root')),out=path.resolve(arg('--out')),here=path.dirname(fileURLToPath(import.meta.url));
assert.ok(!out.startsWith(here+path.sep),'Results must remain outside frozen');
const sha=(b)=>createHash('sha256').update(b).digest('hex');
async function libHashes(directory,prefix=''){const hashes={};for(const item of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(item.isDirectory())Object.assign(hashes,await libHashes(path.join(directory,item.name),prefix+item.name+'/'));else if(item.isFile())hashes[prefix+item.name]=sha(await readFile(path.join(directory,item.name)));}return hashes;}
const commit=()=>{try{return execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
const manifest=await verifyFrozen(),before={commit:commit(),libFiles:await libHashes(path.join(root,'lib'))};
const results=[];
for(const c of contracts.cases){const result=await evaluateContract(root,c.id);results.push(result);console.log(JSON.stringify({id:c.id,pass:result.pass,failures:result.failures.map((f)=>f.label),timings:result.timings}));}
const after={commit:commit(),libFiles:await libHashes(path.join(root,'lib'))};
const unchanged=JSON.stringify(before.libFiles)===JSON.stringify(after.libFiles);
const report={purpose:contracts.purpose,engineRoot:root,generatedAt:new Date().toISOString(),frozenManifestSha256:manifest,before,after,engineLibFilesUnchanged:unchanged,cases:results.length,passed:results.filter((r)=>r.pass).length,failed:results.filter((r)=>!r.pass).length,performanceScope:'Synthetic native PDF plus CSV, explicit mappings, Node process. Read/normalize and roundtrip/export timings separated; memory peak is cumulative for this process, not per-case, no field claim or SLA.',results};
await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,passed:report.passed,failed:report.failed,engineLibFilesUnchanged:unchanged,output:out}));process.exitCode=report.failed||!unchanged?1:0;
