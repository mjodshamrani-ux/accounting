import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { verifyVisualReader } from '../scripts/visual-browser-cases.mjs';
const url='https://mjodshamrani-ux.github.io/accounting/?v=0.4.20';
const app=new URL(url), dist=process.env.DIST ?? 'work/ci-pages-0420-main';
for(const name of ['p6-source.png','p6-reviewed.json','p6-review-ar.png','p6-review-ar-mobile.png','p6-review-en-mobile.png'])await rm('work/qa/'+name,{force:true});
const report={url,sourceCommit:'c275b5ade67c06d6dfd4ce651ec20c02cc2d2c49',passed:false,financialPromotion:false,externalRequests:[],nonGetRequests:[],pageErrors:[],assets:[]};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
context.setDefaultTimeout(60000);
const pending=[];
context.on('request', r=>{
 const u=new URL(r.url());
 if(u.origin!==app.origin&&!['blob:','data:'].includes(u.protocol))report.externalRequests.push(r.url());
 if(r.method()!=='GET')report.nonGetRequests.push(r.method()+' '+r.url());
});
context.on('response', r=>{
 const u=new URL(r.url());
 if(u.origin===app.origin&&/\.(?:js|css)$/.test(u.pathname))pending.push((async()=>{
  assert.ok(u.pathname.startsWith(app.pathname));
  const name=u.pathname.slice(app.pathname.length);
  const [bytes,expected]=await Promise.all([r.body(),readFile(dist+'/'+name)]);
  const hash=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(bytes),hash(expected),'executed asset differs from CI artifact: '+name);
  report.assets.push({path:name,sha256:hash(bytes),bytes:bytes.length});
 })());
});
const page=await context.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await verifyVisualReader(page,url);
 await Promise.all(pending);
 const main=report.assets.find(a=>/^assets\/index-.*\.js$/.test(a.path));
 assert.ok(main);
 assert.ok((await readFile(dist+'/'+main.path,'utf8')).includes('0.4.20'));
 assert.ok(report.assets.some(a=>a.path.startsWith('ocr/')));
 assert.deepEqual(report.externalRequests,[]);
 assert.deepEqual(report.nonGetRequests,[]);
 assert.deepEqual(report.pageErrors,[]);
 const bytes=await readFile('work/qa/p6-reviewed.json'), record=JSON.parse(bytes);
 report.recordSha256=createHash('sha256').update(bytes).digest('hex');
 report.originalSha256=record.source.sha256;
 report.reviewedCells=record.cells.filter(c=>c.review).length;
 report.ocrObservation=JSON.parse(await readFile('work/qa/visual-arabic-ocr-observation.json','utf8'));
 assert.equal(report.reviewedCells,2);
 report.passed=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 await browser.close();
 const out='audit/visual-cell-review/live';await mkdir(out,{recursive:true});
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 for(const name of ['p6-source.png','p6-reviewed.json','p6-review-ar.png','p6-review-ar-mobile.png','p6-review-en-mobile.png'])await copyFile('work/qa/'+name,out+'/'+name).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
console.log(JSON.stringify({passed:report.passed,sourceCommit:report.sourceCommit,codeAssets:report.assets.length,reviewedCells:report.reviewedCells,financialPromotion:false,error:report.error?.message}));
