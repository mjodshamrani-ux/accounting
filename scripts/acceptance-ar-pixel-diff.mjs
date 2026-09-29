// Arabic must look exactly as before localisation. Compares full-page Arabic
// screenshots of the baseline build (BASELINE, a dist folder built from
// bb70d89) and ./dist across eleven states at 390 and 1440px. The header,
// where the language switcher was added, is hidden in both.
//   BASELINE=work/dist-base node scripts/acceptance-ar-pixel-diff.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const BASELINE = process.env.BASELINE ?? 'work/dist-base';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';
import { supplierXlsx, ledgerCsv } from '../tests/helpers/bilingual-fixture.mjs';
function serve(dir) {
  const root = path.resolve(dir);
  const server = createServer(async (req, res) => { try { let rel = new URL(req.url, 'http://x').pathname.replace(/^\/mizan-test\//, '/'); if (rel === '/') rel = '/index.html'; const f = path.resolve(root, '.' + rel); res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(f)); } catch { res.writeHead(404); res.end(); } });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const [before, after] = await Promise.all([serve(BASELINE), serve('dist')]);
const browser = await chromium.launch({ executablePath: process.env.MIZAN_CHROMIUM });
async function shot(server, width, screen) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (!['landing', 'diagnosis', 'pdf', 'ambiguity'].includes(screen)) {
    await page.getByRole('button', { name: 'جرّب المثال', exact: true }).click();
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).waitFor();
  }
  if (screen === 'review' || screen === 'export') {
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
    await page.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  }
  if (screen === 'export') {
    await page.getByRole('button', { name: 'إعداد ورقة العمل' }).click();
    await page.getByRole('heading', { name: 'ملاحظات المراجعة وتنزيل الملف' }).waitFor();
  }
  const idle = () => page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (screen === 'options') {
    await page.getByRole('button', { name: 'تعديل نطاق المقارنة', exact: true }).click();
    await page.getByRole('button', { name: 'تعديل كشف المورد', exact: true }).click();
    await page.getByText('استبعاد صف مع توضيح السبب').click();
    await page.getByText('مصادر القيم المقترحة').click().catch(() => {});
  }
  if (screen === 'assistant' || screen === 'case') {
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
    await page.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  }
  if (screen === 'assistant') {
    await page.getByRole('button', { name: 'مساعد فهم النتيجة', exact: true }).click();
    await page.getByRole('button', { name: 'لماذا يوجد فرق في الأرصدة؟', exact: true }).click();
    await page.getByRole('button', { name: 'ما الذي لم يتم التأكد منه؟', exact: true }).click();
    await page.locator('[aria-live="polite"] article').nth(1).waitFor();
  }
  if (screen === 'case') {
    await page.getByRole('button', { name: 'تفاصيل الحالة', exact: true }).first().click();
    await page.locator('.review-detail').waitFor();
  }
  if (screen === 'privacy') await page.locator('.local-pill').click();
  if (screen === 'diagnosis' || screen === 'pdf' || screen === 'ambiguity') {
    await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
    await idle();
  }
  if (screen === 'diagnosis') {
    await page.getByLabel('كشف المورد', { exact: true }).setInputFiles({ name: 'image-only.pdf', mimeType: 'application/pdf', buffer: Buffer.from(syntheticPdf([[]], 10, 'q 30 0 0 30 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ')) });
    await page.getByRole('alert').waitFor();
    await page.locator('#visual-reader summary').click();
  }
  if (screen === 'pdf' || screen === 'ambiguity') {
    await page.getByLabel('كشف المورد', { exact: true }).setInputFiles(
      screen === 'pdf'
        ? { name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(syntheticPdf([[['Date', 'Doc. Ref', 'Narration', 'Value'], ['2026-04-03', 'INV-A101', 'Invoice', '1.250']]])) }
        : { name: 'supplier-april.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await supplierXlsx() },
    );
    await idle();
    await page.getByLabel('تقرير الحسابات الدائنة', { exact: true }).setInputFiles({ name: 'ledger-april.csv', mimeType: 'text/csv', buffer: ledgerCsv });
    await idle();
    await page.getByRole('button', { name: 'تأكيد البيانات', exact: true }).click();
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).waitFor();
  }
  await page.addStyleTag({ content: '.topbar{visibility:hidden!important} *{caret-color:transparent!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.waitForTimeout(400);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return png;
}
const diffPage = await browser.newPage();
async function compare(a, b) {
  return diffPage.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
    const data = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const da = data(ia), db = data(ib);
    let n = 0, minY = Infinity, maxY = -1;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) { n++; const yy = Math.floor(i / 4 / ia.width); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); }
    let crop = null;
    if (n) {
      const top = Math.max(0, minY - 20), h = Math.min(ia.height - top, maxY - minY + 40, 700);
      const c = document.createElement('canvas'); c.width = ia.width; c.height = h * 2 + 10;
      const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(ia, 0, top, ia.width, h, 0, 0, ia.width, h);
      g.drawImage(ib, 0, top, ib.width, h, 0, h + 10, ib.width, h);
      crop = c.toDataURL('image/png');
    }
    return { size: [ia.width, ia.height], differingPixels: n, rows: n ? [minY, maxY] : null, crop };
  }, [a.toString('base64'), b.toString('base64')]);
}
const report = [];
const screens = process.argv[2] ? process.argv[2].split(',') : ['landing', 'confirm', 'review', 'export', 'options', 'assistant', 'case', 'privacy', 'diagnosis', 'pdf', 'ambiguity'];
for (const width of [390, 1440]) for (const screen of screens) {
  const [a, b] = [await shot(before, width, screen), await shot(after, width, screen)];
  const r = { width, screen, ...(await compare(a, b)) };
  if (r.crop) await writeFile(`work/qa/ar-diff-${screen}-${width}.png`, Buffer.from(r.crop.split(',')[1], 'base64'));
  delete r.crop;
  report.push(r); console.log(JSON.stringify(r));
}
await writeFile('work/ar-pixel-diff.json', JSON.stringify(report, null, 2));
if (report.some((r) => r.differingPixels !== 0)) process.exitCode = 1;
await browser.close(); before.close(); after.close();
