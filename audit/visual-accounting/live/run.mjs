import { chromium } from 'playwright';
import { verifyVisualAccounting } from '../../../scripts/visual-accounting-browser-cases.mjs';
import { readFile,writeFile,copyFile,mkdir } from 'node:fs/promises';
const url='https://mjodshamrani-ux.github.io/accounting/?v=0.4.24';
await mkdir('work/visual-accounting-live',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({acceptDownloads:true});
 const page=await context.newPage();await page.goto(url);
 await page.getByRole('button',{name:'جرّب المثال',exact:true}).waitFor();
 const version=await page.locator('.version-badge').innerText();
 if(!version.includes('0.4.24'))throw Error('Published version is '+version);
 const report=await verifyVisualAccounting(page,url);
 const files=['source.json','source.png','ar.xlsx','en.xlsx','restored.xlsx','report.json','session.json'];
 for(const name of files)await copyFile('work/qa/p6-accounting-'+name,'work/visual-accounting-live/'+name);
 await writeFile('work/visual-accounting-live/live.json',JSON.stringify({url,version,headlessChromium:true,...report},null,2)+'\n');
 console.log(JSON.stringify({url,version,passed:true}));
}finally{await browser.close();}
