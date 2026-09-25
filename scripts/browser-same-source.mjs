// One file on both sides, through the real interface, in Arabic and in
// English: the comparison is shown with an alert that it is a self-comparison,
// and nothing is counted as matched. Two separate files with the same entries
// still match. Serves ./dist locally; no network.
//   MIZAN_CHROMIUM=... node scripts/browser-same-source.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    let rel = new URL(req.url, 'http://x').pathname.replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.wasm': 'application/wasm',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const csv =
  'date,reference,amount\n2026-08-01,INV-0001,100.00\n2026-08-02,PAY-0001,-20.00';
const text = {
  ar: {
    supplier: 'كشف المورد',
    ledger: 'تقرير الحسابات الدائنة',
    confirm: 'تأكيد البيانات',
    currency: 'العملة',
    cutoff: 'تاريخ المقارنة',
    run: 'تحقق وقارن',
    workspace: 'مساحة المراجعة',
    alert: /مقارنة تشخيصية للمصدر بنفسه/,
  },
  en: {
    supplier: 'Supplier statement',
    ledger: 'Accounts payable report',
    confirm: 'Confirm data',
    currency: 'Currency',
    cutoff: 'Cut-off date',
    run: 'Check and compare',
    workspace: 'Review workspace',
    alert: /diagnostic comparison of a source with itself/,
  },
};
const results = [];
try {
  for (const lang of ['ar', 'en'])
    for (const [label, ledgerBody] of [
      ['same file', csv],
      ['separate files', csv + '\n'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/mizan-test/`);
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
      if (lang === 'en')
        await page.locator('.language-switch button[lang="en"]').click();
      const t = text[lang];
      for (const [field, body] of [
        [t.supplier, csv],
        [t.ledger, ledgerBody],
      ]) {
        await page.getByLabel(field, { exact: true }).setInputFiles({
          name: 'july.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(body),
        });
        await page.waitForFunction(
          () =>
            !/قراءة الملف على جهازك|Reading the file on your device/.test(
              document.body.innerText,
            ),
        );
      }
      await page.getByRole('button', { name: t.confirm, exact: true }).click();
      await page.getByLabel(t.currency, { exact: true }).waitFor();
      await page.getByLabel(t.currency, { exact: true }).fill('SAR');
      await page.getByLabel(t.cutoff, { exact: true }).fill('2026-08-31');
      await page.getByRole('button', { name: t.run, exact: true }).click();
      await page.getByRole('heading', { name: t.workspace }).waitFor();
      const matched = await page
        .locator('.metric')
        .nth(0)
        .locator('strong')
        .innerText();
      const alerts = await page.getByRole('alert').allInnerTexts();
      const flagged = alerts.some((a) => t.alert.test(a));
      if (label === 'same file') {
        assert.ok(flagged, `${lang}: the self-comparison alert is shown`);
        assert.equal(matched, '0', `${lang}: nothing is counted as matched`);
      } else {
        assert.ok(!flagged, `${lang}: separate files are not flagged`);
        assert.equal(matched, '2', `${lang}: separate files still match`);
      }
      assert.deepEqual(errors, []);
      results.push({ lang, case: label, matched, flagged });
      await context.close();
    }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ passed: true, results }, null, 1));
