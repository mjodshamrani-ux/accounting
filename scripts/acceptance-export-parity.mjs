// Workpaper and session parity: the same reconciliation exported from the
// baseline build (BASELINE, built from bb70d89) in Arabic and from ./dist in
// Arabic and English. Cells and session files must match apart from
// timestamps.
//   BASELINE=work/dist-base node scripts/acceptance-export-parity.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const BASELINE = process.env.BASELINE ?? 'work/dist-base';
import ExcelJS from 'exceljs';
function serve(dir) { const root = path.resolve(dir); const s = createServer(async (req, res) => { try { let rel = new URL(req.url, 'http://x').pathname.replace(/^\/mizan-test\//, '/'); if (rel === '/') rel = '/index.html'; const f = path.resolve(root, '.' + rel); res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(f)); } catch { res.writeHead(404); res.end(); } }); return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s))); }
const T = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const browser = await chromium.launch({ executablePath: process.env.MIZAN_CHROMIUM });
async function run(dir, lang) {
  const server = await serve(dir);
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  // Old build has no switcher; in the new build the language is set first.
  if (lang === 'en') await page.locator('.language-switch button[lang="en"]').click();
  const L = lang === 'en'
    ? { demo: 'Try the sample', run: 'Check and compare', ws: 'Review workspace', matched: 'Matched', details: 'Case details', note: 'Reason for the decision', unlink: 'Unlink and return to review', prep: 'Prepare the workpaper', reviewer: 'Reviewer name', notes: 'Review notes', draft: 'Download Excel draft', save: 'Save session to continue later' }
    : { demo: 'جرّب المثال', run: 'تحقق وقارن', ws: 'مساحة المراجعة', matched: 'المطابقات', details: 'تفاصيل الحالة', note: 'سبب القرار', unlink: 'فك الربط وإعادته للمراجعة', prep: 'إعداد ورقة العمل', reviewer: 'اسم المراجع', notes: 'ملاحظات المراجعة', draft: 'تنزيل مسودة Excel', save: 'حفظ الجلسة للمتابعة لاحقًا' };
  await page.getByRole('button', { name: L.demo, exact: true }).click();
  await page.getByRole('button', { name: L.run, exact: true }).click();
  await page.getByRole('heading', { name: L.ws }).waitFor();
  await page.getByRole('tab', { name: L.matched, exact: true }).click();
  await page.getByRole('button', { name: L.details, exact: true }).first().click();
  await page.getByRole('textbox', { name: L.note, exact: true }).fill('parity check — فحص');
  await page.getByRole('button', { name: L.unlink }).click();
  await page.waitForFunction(() => document.querySelector('.metric strong')?.textContent === '1');
  await page.getByRole('button', { name: L.prep }).click();
  await page.getByRole('textbox', { name: L.reviewer, exact: true }).fill('Reviewer — مراجع');
  await page.getByRole('textbox', { name: L.notes, exact: true }).fill('notes — ملاحظات');
  const xe = page.waitForEvent('download');
  await page.getByRole('button', { name: L.draft }).click();
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await (await xe).path());
  const cells = {};
  for (const sheet of wb.worksheets) sheet.eachRow((row, r) => row.eachCell((cell, c) => { cells[`${sheet.name}!${r}:${c}`] = JSON.stringify(cell.value instanceof Date ? cell.value.toISOString() : cell.value).replace(T, '<t>'); }));
  const se = page.waitForEvent('download');
  await page.getByRole('button', { name: L.save }).click();
  const session = (await readFile(await (await se).path(), 'utf8')).replace(T, '<t>');
  await context.close(); server.close();
  return { sheets: wb.worksheets.map((s) => s.name), cells, session };
}
const base = await run(BASELINE, 'ar');
const now = await run('dist', 'ar');
const english = await run('dist', 'en');
const diff = (a, b) => Object.keys({ ...a.cells, ...b.cells }).filter((k) => a.cells[k] !== b.cells[k]);
const summary = {
  cells: Object.keys(base.cells).length,
  sheetsEqual: JSON.stringify(base.sheets) === JSON.stringify(now.sheets) && JSON.stringify(base.sheets) === JSON.stringify(english.sheets),
  arabicVsBaseline: diff(base, now),
  englishVsBaseline: diff(base, english),
  sessionArabicVsBaseline: base.session === now.session,
  sessionEnglishVsBaseline: base.session === english.session,
  sessionBytes: base.session.length,
};
await writeFile('work/export-parity.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
if (summary.arabicVsBaseline.length || summary.englishVsBaseline.length || !summary.sessionArabicVsBaseline || !summary.sessionEnglishVsBaseline || !summary.sheetsEqual) process.exitCode = 1;
await browser.close();
