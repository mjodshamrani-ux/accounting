import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';
import { syntheticStyledPdf } from '../tests/helpers/styled-pdf-fixture.ts';
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(u.pathname).replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const bytes = await readFile(file);
    const mime =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, context;
const errors = [],
  external = [],
  post = [];
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(45000);
  context.setDefaultNavigationTimeout(30000);
  // Cover every page, including actual file uploads and any newly opened page.
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  context.on('request', (r) => {
    const url = new URL(r.url());
    if (
      url.origin !== origin &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'data:'
    )
      external.push(r.url());
    if (r.method() !== 'GET') post.push(r.url());
  });
  const page = await context.newPage();
  await page.goto(`${origin}/mizan-test/`);
  await page.getByRole('button', { name: 'تجربة مثال', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  assert.equal(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')
      .then((x) => x.includes("connect-src 'none'")),
    true,
  );
  await mkdir('work/qa', { recursive: true });
  await page.screenshot({ path: 'work/qa/home.png', fullPage: true });
  // Everything after initial preload must work without a network connection, including first comparison and export.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'تجربة مثال', exact: true }).click();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
  await page
    .getByRole('heading', { name: 'مساحة المراجعة' })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await page.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  assert.equal(
    await page.locator('.metric').nth(2).locator('strong').innerText(),
    '10',
  );
  await page
    .getByRole('button', { name: 'اسأل عن النتيجة — مساعد محلي', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'لماذا يوجد فرق في الأرصدة؟', exact: true })
    .click();
  await page.getByText('فرق الأرصدة الفعلي', { exact: false }).waitFor();
  assert.ok(
    (await page.locator('[aria-live="polite"]').innerText()).includes(
      '3,500.00',
    ),
  );
  await page
    .getByRole('button', { name: 'اسأل عن النتيجة — مساعد محلي', exact: true })
    .click();
  await page.screenshot({ path: 'work/qa/review.png', fullPage: true });
  await page.getByRole('tab', { name: 'المطابقات', exact: true }).click();
  await page.getByRole('button', { name: 'فحص', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'سبب القرار', exact: true })
    .fill('إعادة مراجعة المصدر — اختبار اصطناعي');
  await page.getByRole('button', { name: 'فك الربط وإعادته للمراجعة' }).click();
  await page.waitForFunction(
    () => document.querySelector('.metric strong')?.textContent === '1',
  );
  await page.getByRole('button', { name: 'إعداد ورقة العمل' }).click();
  await page
    .getByRole('textbox', { name: 'ملاحظات المراجعة', exact: true })
    .fill('bad\u0008text');
  await page.getByRole('button', { name: 'تنزيل مسودة Excel' }).click();
  await page.getByRole('alert').filter({ hasText: 'محارف تحكم' }).waitFor();
  assert.equal(
    await page.locator('.metric').nth(0).locator('strong').innerText(),
    '1',
  );
  await page
    .getByRole('textbox', { name: 'ملاحظات المراجعة', exact: true })
    .fill('اختبار اصطناعي — Arabic / English');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل مسودة Excel' }).click();
  const download = await downloadEvent;
  const downloaded = await download.path();
  assert.ok(downloaded);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(downloaded);
  assert.equal(wb.getWorksheet('Matches').rowCount, 2);
  assert.ok(wb.getWorksheet('Summary'));
  assert.ok(wb.getWorksheet('Review history').rowCount >= 3);
  assert.equal(wb.getWorksheet('Supplier source').rowCount, 10);
  await page.screenshot({ path: 'work/qa/export.png', fullPage: true });
  // Changes to input invalidate comparison state and require new attestation.
  await page.getByRole('button', { name: 'العودة للمراجعة' }).click();
  await page.getByRole('button', { name: 'تعديل الإعدادات' }).click();
  assert.equal(
    await page.getByRole('heading', { name: 'مساحة المراجعة' }).count(),
    0,
  );
  await page.getByLabel('المورد', { exact: true }).fill('اسم معدل');
  assert.equal(await page.getByRole('checkbox').nth(0).isChecked(), false);
  assert.equal(
    await page
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'work/qa/mobile.png', fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  assert.equal(overflow, false, 'mobile layout overflow');
  // Re-open independently and exercise an actual CSV file selection, not only in-memory demo data.
  await context.setOffline(false);
  const uploadPage = await context.newPage();
  await uploadPage.goto(`${origin}/mizan-test/`);
  await uploadPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  const csv =
    'date,reference,amount\n2026-08-01,INV-0001,100.00\n2026-08-02,PAY-0001,-20.00';
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await uploadPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await uploadPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await uploadPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  await uploadPage.getByLabel('المورد', { exact: true }).fill('اختبار');
  await uploadPage
    .getByLabel('الجهة القانونية', { exact: true })
    .fill('اختبار');
  await uploadPage.getByLabel('نطاق الحساب', { exact: true }).fill('اختبار');
  await uploadPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
  await uploadPage.getByRole('checkbox').nth(0).check();
  await uploadPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  assert.equal(
    await uploadPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  assert.ok(
    (await uploadPage.locator('body').innerText()).includes('مقارنة حركات فقط'),
  );
  await uploadPage
    .getByRole('button', { name: 'عملية جديدة', exact: true })
    .click();
  await uploadPage.getByRole('alertdialog').waitFor();
  await uploadPage
    .getByRole('button', { name: 'متابعة الجلسة', exact: true })
    .click();
  await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  await uploadPage
    .getByRole('button', { name: 'عملية جديدة', exact: true })
    .click();
  await uploadPage
    .getByRole('button', { name: 'حذف الجلسة والبدء', exact: true })
    .click();
  assert.equal(
    await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  // Regression: real XLSX upload selects the transaction sheet, ignores unused
  // calculations/display formats, and compares both sides completely offline.
  const helperBook = new ExcelJS.Workbook();
  helperBook.addWorksheet('Read me').addRow(['Notes for the accountant']);
  const helperSheet = helperBook.addWorksheet('Transactions');
  helperSheet.addRow(['date', 'reference', 'amount', 'rate', 'running total']);
  helperSheet.addRow([
    '2026-08-01',
    'INV-0001',
    100,
    0.15,
    { formula: 'C2', result: 100 },
  ]);
  helperSheet.addRow([
    '2026-08-02',
    'PAY-0001',
    -20,
    0.15,
    { formula: 'C2+C3', result: 80 },
  ]);
  helperSheet.getColumn(4).numFmt = '0%';
  helperSheet.getColumn(3).numFmt = '#,##0.00;[Red](#,##0.00)';
  helperSheet.addConditionalFormatting({
    ref: 'D2:D3',
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: ['TRUE'],
        style: { numFmt: '0%' },
      },
    ],
  });
  const helperBytes = Buffer.from(await helperBook.xlsx.writeBuffer());
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await uploadPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic-helpers.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: helperBytes,
    });
    await uploadPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await uploadPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  for (const label of ['المورد', 'الجهة القانونية', 'نطاق الحساب'])
    await uploadPage.getByLabel(label, { exact: true }).fill('Synthetic');
  await uploadPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
  await uploadPage.getByRole('checkbox', { name: /أؤكد أن الملفين/ }).check();
  await uploadPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  assert.equal(
    await uploadPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );

  // Upload the synthetic 18-sheet workpaper actually downloaded above. Neither
  // the first Diagnostics sheet nor its old review decision may be restored.
  await context.setOffline(false);
  const workpaperPage = await context.newPage();
  await workpaperPage.goto(`${origin}/mizan-test/`);
  await workpaperPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await workpaperPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic-workpaper.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await readFile(downloaded),
    });
    await workpaperPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
    assert.deepEqual(
      await workpaperPage.getByRole('alert').allTextContents(),
      [],
    );
    await workpaperPage
      .locator('.dropzone')
      .filter({ hasText: label })
      .getByText('synthetic-workpaper.xlsx', { exact: true })
      .waitFor();
  }
  await workpaperPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  assert.match(
    await workpaperPage
      .getByRole('combobox', { name: 'ورقة العمل', exact: true })
      .nth(0)
      .innerText(),
    /Supplier source/,
  );
  assert.match(
    await workpaperPage
      .getByRole('combobox', { name: 'ورقة العمل', exact: true })
      .nth(1)
      .innerText(),
    /Ledger source/,
  );
  assert.equal(
    await workpaperPage
      .getByRole('checkbox', { name: /أؤكد أن الملفين/ })
      .isChecked(),
    false,
  );
  assert.equal(
    await workpaperPage.getByLabel('المورد', { exact: true }).inputValue(),
    '',
  );
  assert.equal(
    await workpaperPage
      .getByLabel('صف العناوين 0', { exact: true })
      .inputValue(),
    '2',
  );
  assert.equal(
    await workpaperPage
      .getByLabel('صف العناوين 1', { exact: true })
      .inputValue(),
    '2',
  );
  for (const label of ['المورد', 'الجهة القانونية', 'نطاق الحساب'])
    await workpaperPage.getByLabel(label, { exact: true }).fill('Synthetic');
  await workpaperPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
  await workpaperPage
    .getByRole('checkbox', { name: /أؤكد أن الملفين/ })
    .check();
  await workpaperPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await workpaperPage
    .getByRole('heading', { name: 'مساحة المراجعة' })
    .waitFor();
  assert.equal(
    await workpaperPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  assert.ok(
    (await workpaperPage.locator('body').innerText()).includes(
      'مقارنة حركات فقط',
    ),
  );
  await context.setOffline(false);
  const pdfPage = await context.newPage();
  await pdfPage.goto(`${origin}/mizan-test/`);
  await pdfPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  await pdfPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'synthetic.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
      syntheticPdf(
        [
          [
            ['date', 'reference', 'amount', 'description'],
            ['2026-08-01', 'INV-0001', '100.00', 'Invoice'],
            ['2026-08-02', 'PAY-0001', '-20.00', 'Payment'],
          ],
        ],
        10,
        'q 0 G 0.5 w 30 700 520 65 re 30 745 m 550 745 l 30 725 m 550 725 l 150 700 m 150 765 l 270 700 m 270 765 l 400 700 m 400 765 l S Q',
      ),
    ),
  });
  await pdfPage.waitForFunction(
    () => !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  await pdfPage
    .getByLabel('تقرير الحسابات الدائنة', { exact: true })
    .setInputFiles({
      name: 'synthetic.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
  await pdfPage.waitForFunction(
    () => !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  await pdfPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  await pdfPage.getByLabel('حدود أعمدة PDF', { exact: true }).fill('25,45,65');
  await pdfPage
    .getByRole('button', {
      name: 'تطبيق حدود الأعمدة وإعادة القراءة',
      exact: true,
    })
    .click();
  await pdfPage.waitForFunction(
    () => !document.body.innerText.includes('إعادة قراءة أعمدة PDF محليًا'),
  );
  for (const label of ['المورد', 'الجهة القانونية', 'نطاق الحساب'])
    await pdfPage.getByLabel(label, { exact: true }).fill('Synthetic');
  await pdfPage.getByLabel('تاريخ القطع', { exact: true }).fill('2026-08-31');
  await pdfPage.getByRole('checkbox', { name: /راجعت جميع صفحات PDF/ }).check();
  await pdfPage.getByRole('checkbox', { name: /أؤكد أن الملفين/ }).check();
  await pdfPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await pdfPage
    .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
    .waitFor();
  assert.equal(
    await pdfPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  await pdfPage
    .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
    .click();
  const pdfExport = pdfPage.waitForEvent('download');
  await pdfPage
    .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
    .click();
  const pdfBook = new ExcelJS.Workbook();
  await pdfBook.xlsx.readFile(await (await pdfExport).path());
  assert.equal(
    pdfBook.getWorksheet('Supplier transactions').getCell('J2').value,
    1,
  );
  // Import recovery is a user workflow: a rejected PDF must not poison the
  // next XLSX or PDF request. Keep the entire sequence offline.
  await context.setOffline(false);
  const recoveryPage = await context.newPage();
  await recoveryPage.goto(`${origin}/mizan-test/`);
  await recoveryPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  await recoveryPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'synthetic-covered.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticStyledPdf(true)),
  });
  await recoveryPage
    .getByRole('alert')
    .filter({ hasText: /يغطي|تغط/ })
    .waitFor();
  await recoveryPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'synthetic-recovered.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: helperBytes,
  });
  await recoveryPage.waitForFunction(
    () =>
      document.body.innerText.includes('synthetic-recovered.xlsx') &&
      !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  assert.equal(await recoveryPage.getByRole('alert').count(), 0);
  await recoveryPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'synthetic-styled.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticStyledPdf()),
  });
  await recoveryPage.waitForFunction(
    () =>
      document.body.innerText.includes('synthetic-styled.pdf') &&
      !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  await recoveryPage
    .getByLabel('تقرير الحسابات الدائنة', { exact: true })
    .setInputFiles({
      name: 'synthetic-july.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,reference,amount\n2026-07-02,SYN-7001,1250.00\n2026-07-12,SYN-CN-2,-150.00',
      ),
    });
  await recoveryPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  await recoveryPage
    .getByLabel('حدود أعمدة PDF', { exact: true })
    .fill('25,45');
  await recoveryPage
    .getByRole('button', {
      name: 'تطبيق حدود الأعمدة وإعادة القراءة',
      exact: true,
    })
    .click();
  await recoveryPage.waitForFunction(
    () => !document.body.innerText.includes('إعادة قراءة أعمدة PDF محليًا'),
  );
  for (const label of ['المورد', 'الجهة القانونية', 'نطاق الحساب'])
    await recoveryPage.getByLabel(label, { exact: true }).fill('Synthetic');
  await recoveryPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-07-31');
  await recoveryPage
    .getByRole('checkbox', { name: /راجعت جميع صفحات PDF/ })
    .check();
  await recoveryPage.getByRole('checkbox', { name: /أؤكد أن الملفين/ }).check();
  await recoveryPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await recoveryPage
    .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
    .waitFor();
  assert.equal(
    await recoveryPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  await recoveryPage
    .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
    .click();
  const recoveredExport = recoveryPage.waitForEvent('download');
  await recoveryPage
    .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
    .click();
  const recoveredBook = new ExcelJS.Workbook();
  await recoveredBook.xlsx.readFile(await (await recoveredExport).path());
  assert.deepEqual(
    [2, 3].map(
      (row) =>
        recoveredBook.getWorksheet('Supplier transactions').getCell(`H${row}`)
          .value,
    ),
    [1250, -150],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(post, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'GitHub subpath assets',
          'production CSP',
          'offline first comparison',
          'engine/io cases run separately',
          'grounded assistant offline',
          'cancel and confirm session reset',
          'reject auto match',
          'Excel download roundtrip',
          'invalid export text rejected and correction retried',
          'mapping invalidation',
          '390px layout',
          'actual CSV upload offline',
          'XLSX upload with helper formulas, percentages and multiple sheets offline',
          '18-sheet workpaper reimport chooses original sources without restoring approvals',
          'bordered PDF upload, review, comparison and Excel export offline',
          'covered PDF rejected, XLSX retry succeeds, colored PDF comparison and numeric export succeed offline',
          'no observed external or POST requests',
        ],
        screenshots: 'work/qa',
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Save only synthetic test pages. Diagnostic capture must not hide the failure.
  await mkdir('work/qa', { recursive: true });
  await Promise.allSettled(
    (context?.pages() ?? []).map((p, i) =>
      p.screenshot({
        path: `work/qa/failure-${i + 1}.png`,
        fullPage: true,
        timeout: 5000,
      }),
    ),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
