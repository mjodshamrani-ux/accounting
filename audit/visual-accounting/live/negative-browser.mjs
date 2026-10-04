import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const url='https://mjodshamrani-ux.github.io/accounting/?v=0.4.24';
const cases=JSON.parse(await readFile('work/visual-accounting-live/negative-contract.json','utf8'));
const browser=await chromium.launch({headless:true}),reports=[];
try{
 for(const test of cases){
  const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
  const violations=[],errors=[];
  context.on('request',r=>{const u=new URL(r.url());if(r.method()!=='GET'||(!['data:','blob:'].includes(u.protocol)&&u.origin!==new URL(url).origin))violations.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByRole('button',{name:'جرّب المثال',exact:true}).waitFor();
  assert.ok((await page.locator('.version-badge').innerText()).includes('0.4.24'));
  await page.waitForFunction(() => !document.querySelector('.dropzone')?.textContent.includes('نجهّز أداة القراءة'));
  await page.waitForFunction(() => !document.querySelector('input[aria-label="استئناف جلسة محلية"]')?.disabled);
  await page.getByLabel('استئناف جلسة محلية',{exact:true}).setInputFiles('work/visual-accounting-live/'+test.case+'.json');
  try { await page.getByRole('heading',{name:'مساحة المراجعة',exact:true}).waitFor(); } catch(e) { await writeFile('work/visual-accounting-live/'+test.case+'-failure.txt',await page.locator('body').innerText());await page.screenshot({path:'work/visual-accounting-live/'+test.case+'-failure.png',fullPage:true});throw e; }
  const matches=await page.locator('.metric').first().locator('strong').innerText();assert.equal(matches,'0');
  await page.getByRole('button',{name:'إعداد ورقة العمل',exact:true}).click();
  await writeFile('work/visual-accounting-live/'+test.case+'-workpaper.txt',await page.locator('body').innerText());
  console.log(JSON.stringify({case:test.case,buttons:await page.getByRole('button').allTextContents()}));
  const label=test.case==='unproved-footer'?'تنزيل ورقة عمل جزئية':'تنزيل مسودة Excel';
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.getByRole('button',{name:label,exact:true}).click()]);
  await download.saveAs('work/visual-accounting-live/'+test.case+'.xlsx');
  await page.screenshot({path:'work/visual-accounting-live/'+test.case+'.png',fullPage:true});
  assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  reports.push({...test,publicMatches:Number(matches),sessionRecalculated:true,workpaperDownloaded:true,networkViolations:violations,pageErrors:errors});await context.close();
 }
 await writeFile('work/visual-accounting-live/negative-live.json',JSON.stringify({url,version:'0.4.24',adversarialReviewedRecords:true,automaticOCR:false,cases:reports},null,2)+'\n');
 console.log(JSON.stringify({passed:true,cases:reports.length}));
}finally{await browser.close();}
