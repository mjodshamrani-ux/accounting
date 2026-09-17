import { chromium } from 'playwright';
import { verifyVisualReader } from './visual-browser-cases.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';
import { syntheticStyledPdf } from '../tests/helpers/styled-pdf-fixture.ts';

async function waitForScopeInputs(page) {
  // These paths are missing an essential value, so the app opens this panel in
  // an effect (or it was already opened in the demo). A visibility check followed
  // by a toggle click can race that effect and close the panel. Wait for the
  // observable result instead; missing-value auto-opening remains an assertion.
  await page
    .getByLabel('العملة', { exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(
    await page
      .getByRole('button', { name: 'تعديل نطاق المقارنة', exact: true })
      .getAttribute('aria-expanded'),
    'true',
    'missing essentials must reveal the scope inputs without a toggle race',
  );
}

// Only synthetic XML emitted by ExcelJS is edited here. The production parser
// canonicalizes namespaces using an XML parser, never these fixture regexes.
async function prefixedWorkbook(workbook) {
  const zip = await JSZip.loadAsync(
    await workbook.xlsx.writeBuffer({ useSharedStrings: true }),
  );
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships =
    'http://schemas.openxmlformats.org/package/2006/relationships';
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || (!name.endsWith('.xml') && !name.endsWith('.rels')))
      continue;
    let xml = await entry.async('string');
    const namespace = xml.includes(`xmlns="${main}"`)
      ? main
      : xml.includes(`xmlns="${relationships}"`)
        ? relationships
        : undefined;
    if (!namespace) continue;
    const prefix = namespace === main ? 'x' : 'pkg';
    xml = xml
      .replace(`xmlns="${namespace}"`, `xmlns:${prefix}="${namespace}"`)
      .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, `<$1${prefix}:$2`)
      .replace(/xmlns:r=/g, 'xmlns:rel=')
      .replace(/\sr:id=/g, ' rel:id=');
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function directionWorkbook(ap, formulas = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(ap ? 'AP ledger' : 'Supplier statement');
  sheet.addRows([
    ['Supplier', 'Synthetic Direction Vendor'],
    ['Customer', 'Synthetic Direction Buyer'],
    ['Customer Account', 'DIR-TEST'],
    ['Currency', 'SAR'],
    ['Period', '2026-07-01 to 2026-07-31'],
    [
      ap ? 'Posting Date' : 'Date',
      ap ? 'Doc Type' : 'Type',
      ap ? 'Supplier Ref' : 'Reference',
      'Debit (SAR)',
      'Credit (SAR)',
      ap ? 'Running AP Balance' : 'Running Balance',
    ],
    ['2026-07-01', 'Opening Balance', 'B/F', ap ? 0 : 100, ap ? 100 : 0, 100],
    ['2026-07-02', 'Invoice', 'DIR-INV-100', ap ? 0 : 25, ap ? 25 : 0, 125],
    ['2026-07-03', 'Payment', 'DIR-PAY-100', ap ? 10 : 0, ap ? 0 : 10, 115],
    [ap ? 'Closing AP Balance' : 'Closing Balance', '', '', '', '', 115],
  ]);
  for (const column of [4, 5, 6])
    sheet.getColumn(column).numFmt = '#,##0.00;[Red](#,##0.00)';
  if (formulas) {
    sheet.getCell('F7').value = { formula: '100', result: 100 };
    sheet.getCell('F8').value = {
      formula: ap ? 'F7+E8-D8' : 'F7+D8-E8',
      result: 125,
    };
    sheet.getCell('F9').value = {
      formula: ap ? 'F8+E9-D9' : 'F8+D9-E9',
      result: 115,
    };
    sheet.getCell('F10').value = { formula: 'F9', result: 115 };
  }
  return prefixedWorkbook(workbook);
}

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
  // MIZAN_CHROMIUM lets a sandbox with a preinstalled browser point at it; CI
  // leaves it unset and uses the version Playwright manages itself.
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
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
  // Balance reconciliation is opt-in and lives behind the scope card's edit
  // action, so nothing about it is on the default path.
  await page
    .getByRole('button', { name: 'تعديل نطاق المقارنة', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /أريد تسوية الأرصدة/ }).check();
  await page
    .getByRole('checkbox', { name: /أؤكد أن التقريرين يغطيان/ })
    .check();
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
    '5',
  );
  await page
    .getByRole('tab', { name: 'يحتاج مراجعة (2)', exact: true })
    .waitFor();
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
  assert.equal(wb.worksheets[0].name, 'Summary');
  assert.deepEqual(
    wb.worksheets
      .filter((sheet) => sheet.state === 'visible')
      .map((sheet) => sheet.name),
    [
      'Summary',
      'Matches',
      'Needs Review',
      'Unmatched',
      'Reconciliation Bridge',
      'Review Sign-off',
    ],
  );
  assert.ok(wb.getWorksheet('Review History').rowCount >= 3);
  assert.equal(wb.getWorksheet('Parsed Supplier Source').rowCount, 10);
  await page.screenshot({ path: 'work/qa/export.png', fullPage: true });
  // A settings edit discards the previous result: pressing compare is the
  // confirmation, so a stale comparison can never survive an input change.
  await page.getByRole('button', { name: 'العودة للمراجعة' }).click();
  await page.getByRole('button', { name: 'تعديل الإعدادات' }).click();
  assert.equal(
    await page.getByRole('heading', { name: 'مساحة المراجعة' }).count(),
    0,
  );
  await waitForScopeInputs(page);
  await page.getByLabel('المورد', { exact: true }).fill('اسم معدل');
  assert.equal(
    await page.getByRole('heading', { name: 'مساحة المراجعة' }).count(),
    0,
    'an edited scope must not leave the earlier comparison on screen',
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
  await waitForScopeInputs(uploadPage);
  await uploadPage.getByLabel('العملة', { exact: true }).fill('SAR');
  await uploadPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
  await uploadPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  assert.equal(
    await uploadPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  assert.match(
    await uploadPage.locator('.metric').nth(3).innerText(),
    /صفوف لم تُقرأ/,
    'without a verified balance no balance figure may be presented',
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
  await waitForScopeInputs(uploadPage);
  await uploadPage.getByLabel('العملة', { exact: true }).fill('SAR');
  await uploadPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
  await uploadPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await uploadPage.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  assert.equal(
    await uploadPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );

  // Upload the synthetic case workpaper actually downloaded above. Neither
  // its Summary sheet nor its old review decision may be restored.
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
    await workpaperPage.locator('.summary-line').nth(1).innerText(),
    /Parsed Supplier Source/,
  );
  assert.match(
    await workpaperPage.locator('.summary-line').nth(2).innerText(),
    /Parsed Ledger Source/,
  );
  // The per-source details live behind one edit action instead of a stack of
  // disclosures, so open each card to read the header row it picked.
  for (const [index, label] of [
    'تعديل كشف المورد',
    'تعديل تقرير الحسابات الدائنة',
  ].entries()) {
    await workpaperPage
      .getByRole('button', { name: label, exact: true })
      .click();
    assert.equal(
      await workpaperPage
        .getByLabel(`صف العناوين ${index}`, { exact: true })
        .inputValue(),
      '2',
    );
  }
  // Previous approvals are not restored, but the original source columns still
  // prove SAR and provide dates. This complete scope stays collapsed until an
  // explicit edit; it must not use the missing-input auto-opening path.
  const workpaperScope = workpaperPage.getByRole('button', {
    name: 'تعديل نطاق المقارنة',
    exact: true,
  });
  assert.equal(await workpaperScope.getAttribute('aria-expanded'), 'false');
  await workpaperScope.click();
  await waitForScopeInputs(workpaperPage);
  await workpaperPage.getByLabel('العملة', { exact: true }).fill('SAR');
  await workpaperPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-08-31');
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
  assert.match(
    await workpaperPage.locator('.metric').nth(3).innerText(),
    /صفوف لم تُقرأ/,
    'without a verified balance no balance figure may be presented',
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
  await pdfPage
    .getByRole('button', { name: 'تعديل حدود الأعمدة', exact: true })
    .click();
  await pdfPage.getByLabel('حدود أعمدة PDF', { exact: true }).fill('25,45,65');
  await pdfPage
    .getByRole('button', { name: 'تطبيق وإعادة القراءة', exact: true })
    .click();
  await pdfPage.waitForFunction(
    () => !document.body.innerText.includes('إعادة قراءة أعمدة PDF محليًا'),
  );
  await waitForScopeInputs(pdfPage);
  await pdfPage.getByLabel('العملة', { exact: true }).fill('SAR');
  await pdfPage.getByLabel('تاريخ القطع', { exact: true }).fill('2026-08-31');
  await pdfPage.getByRole('checkbox', { name: /راجعت الجدول أعلاه/ }).check();
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
  // Typed worker diagnoses describe only the first failing page. They must not
  // replace the successfully loaded XLSX with a partial or invented PDF table.
  const diagnosisRows = [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-02', 'SYN-DIAG-1', '1250.00'],
  ];
  for (const diagnostic of [
    {
      name: 'synthetic-image-only.pdf',
      bytes: syntheticPdf(
        [[]],
        10,
        'q 30 0 0 30 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ',
      ),
      page: /توقفت القراءة عند الصفحة 1 من 1/,
      kind: /صور دون نص قابل للاستخراج/,
    },
    {
      name: 'synthetic-incomplete-text.pdf',
      bytes: syntheticPdf([diagnosisRows, [], diagnosisRows]),
      page: /توقفت القراءة عند الصفحة 2 من 3/,
      kind: /لا نص قابل للاستخراج؛ لا يمكن الجزم بأنها صورة/,
    },
  ]) {
    await recoveryPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
      name: diagnostic.name,
      mimeType: 'application/pdf',
      buffer: Buffer.from(diagnostic.bytes),
    });
    const diagnosisAlert = recoveryPage.getByRole('alert');
    await diagnosisAlert.filter({ hasText: diagnostic.page }).waitFor();
    assert.match(await diagnosisAlert.innerText(), diagnostic.kind);
    assert.match(await diagnosisAlert.innerText(), /لم تُعتمد قراءة جزئية/);
    assert.match(
      await diagnosisAlert.innerText(),
      /يمكنك تجربة مساعد قراءة الصور أدناه لعرض مسودة غير متحققة/,
    );
    const retainedSource = recoveryPage
      .locator('.dropzone')
      .filter({ hasText: 'كشف المورد' });
    await retainedSource
      .getByText('synthetic-recovered.xlsx', { exact: true })
      .waitFor();
    assert.equal(
      await retainedSource.getByText(diagnostic.name, { exact: true }).count(),
      0,
      'a rejected PDF must not replace the existing source or retain a partial table',
    );
  }
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
  assert.equal(
    await recoveryPage.getByRole('alert').count(),
    0,
    'a subsequent readable PDF must clear the previous typed diagnosis',
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
    .getByRole('button', { name: 'تعديل حدود الأعمدة', exact: true })
    .click();
  await recoveryPage
    .getByLabel('حدود أعمدة PDF', { exact: true })
    .fill('25,45');
  await recoveryPage
    .getByRole('button', { name: 'تطبيق وإعادة القراءة', exact: true })
    .click();
  await recoveryPage.waitForFunction(
    () => !document.body.innerText.includes('إعادة قراءة أعمدة PDF محليًا'),
  );
  await waitForScopeInputs(recoveryPage);
  await recoveryPage.getByLabel('العملة', { exact: true }).fill('SAR');
  await recoveryPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-07-31');
  await recoveryPage
    .getByRole('checkbox', { name: /راجعت الجدول أعلاه/ })
    .check();
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
  // Synthetic, page-scoped browser API double. These assertions exercise the
  // advice boundary and UI workflow, not a real model's accuracy or availability.
  const unfamiliarCsv = [
    'Supplier,Synthetic AI Vendor,',
    'Customer,Synthetic AI Buyer,',
    'Customer Account,AI-TEST,',
    'Currency,SAR,',
    'Period,2026-01-01 to 2026-01-31,',
    'Date,Reference,Settlement face value',
    '2026-01-05,AI-0001,250.00',
    '2026-01-06,AI-0002,75.00',
    '2026-01-07,AI-0003,-30.00',
  ].join('\n');
  for (const providerState of ['absent', 'downloadable', 'available']) {
    await context.setOffline(false);
    const importAiPage = await context.newPage();
    await importAiPage.addInitScript((availability) => {
      const state = {
        syntheticTestProvider: true,
        availabilityChecks: 0,
        creates: 0,
        prompts: 0,
        destroys: 0,
        echoedSourceHash: '',
        proposedFields: [],
      };
      Object.defineProperty(window, '__syntheticImportModel', { value: state });
      Object.defineProperty(window, 'LanguageModel', {
        configurable: true,
        value:
          availability === 'absent'
            ? undefined
            : {
                availability: async () => {
                  state.availabilityChecks++;
                  return availability;
                },
                create: async () => {
                  state.creates++;
                  if (availability !== 'available')
                    throw new Error(
                      'Synthetic test: downloading must never start',
                    );
                  return {
                    prompt: async (prompt, options) => {
                      state.prompts++;
                      const marker = prompt.indexOf('DATA=');
                      if (marker < 0)
                        throw new Error(
                          'Synthetic test: missing source context',
                        );
                      const data = JSON.parse(prompt.slice(marker + 5));
                      if (
                        data.columns[2]?.header.text !==
                          'Settlement face value' ||
                        !data.unresolvedFields.includes('amount') ||
                        data.unresolvedFields.includes('date') ||
                        data.unresolvedFields.includes('reference') ||
                        !options.responseConstraint ||
                        options.signal.aborted
                      )
                        throw new Error(
                          'Synthetic test: unexpected inference context',
                        );
                      state.echoedSourceHash = data.sourceHash;
                      state.proposedFields = ['amount'];
                      return JSON.stringify({
                        sourceHash: data.sourceHash,
                        sheet: data.sheet,
                        header: data.header,
                        baseline: data.baseline,
                        columns: { amount: 2 },
                      });
                    },
                    destroy: () => {
                      state.destroys++;
                    },
                  };
                },
              },
      });
    }, providerState);
    await importAiPage.goto(`${origin}/mizan-test/`);
    await importAiPage.waitForFunction(
      () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
    );
    await context.setOffline(true);
    for (const [side, label] of [
      'كشف المورد',
      'تقرير الحسابات الدائنة',
    ].entries()) {
      const filename = `synthetic-local-model-${providerState}-${side}.csv`;
      await importAiPage.getByLabel(label, { exact: true }).setInputFiles({
        name: filename,
        mimeType: 'text/csv',
        buffer: Buffer.from(
          side === 0
            ? unfamiliarCsv
            : unfamiliarCsv.replace('Settlement face value', 'Amount'),
        ),
      });
      await importAiPage
        .locator('.dropzone')
        .filter({ hasText: label })
        .getByText(filename, { exact: true })
        .waitFor();
      await importAiPage.waitForFunction(
        () => !document.body.innerText.includes('قراءة الملف على جهازك'),
      );
    }
    await importAiPage
      .getByRole('button', { name: 'تأكيد البيانات', exact: true })
      .click();
    const aiSupplier = importAiPage.locator('section').filter({
      has: importAiPage.getByRole('heading', {
        name: 'كشف المورد',
        exact: true,
      }),
    });
    const missingAmount = aiSupplier.getByRole('combobox', {
      name: 'عمود المبلغ',
      exact: true,
    });
    await missingAmount.waitFor();
    assert.match(await missingAmount.innerText(), /غير محدد/);
    assert.match(await aiSupplier.locator('.summary-line').innerText(), /Date/);
    assert.match(
      await aiSupplier.locator('.summary-line').innerText(),
      /Reference/,
    );
    const importAiCompare = importAiPage.getByRole('button', {
      name: 'تحقق وقارن',
      exact: true,
    });
    assert.equal(await importAiCompare.isDisabled(), true);
    const helperButton = importAiPage.getByRole('button', {
      name: 'اقتراح الأعمدة بمساعد الجهاز',
      exact: true,
    });
    if (providerState !== 'absent')
      await importAiPage.waitForFunction(
        () => window.__syntheticImportModel.availabilityChecks > 0,
      );
    if (providerState !== 'available') {
      assert.equal(await helperButton.count(), 0);
      assert.deepEqual(
        await importAiPage.evaluate(() => ({
          creates: window.__syntheticImportModel.creates,
          prompts: window.__syntheticImportModel.prompts,
        })),
        { creates: 0, prompts: 0 },
        'absence or a downloadable model must not create a session or download',
      );
      // Unsupported devices retain the ordinary manual mapping path.
      await missingAmount.click();
      await importAiPage
        .getByRole('option', { name: '3 · Settlement face value', exact: true })
        .click();
    } else {
      await helperButton.waitFor();
      assert.equal(
        await importAiPage.evaluate(
          () => window.__syntheticImportModel.creates,
        ),
        0,
        'checking model readiness must not start inference',
      );
      await helperButton.click();
      const pendingProposal = importAiPage.locator(
        '[aria-label="اقتراح أعمدة يحتاج مراجعة"]',
      );
      await pendingProposal.waitFor();
      assert.match(await pendingProposal.innerText(), /Settlement face value/);
      assert.match(await pendingProposal.innerText(), /250\.00/);
      assert.match(
        await pendingProposal.innerText(),
        /لم تُعتمد أرقام أو مطابقات/,
      );
      assert.match(await missingAmount.innerText(), /غير محدد/);
      assert.equal(await importAiCompare.isDisabled(), true);
      assert.equal(
        await importAiPage
          .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
          .count(),
        0,
        'receiving model advice must neither apply a mapping nor compare',
      );
      const modelState = await importAiPage.evaluate(
        () => window.__syntheticImportModel,
      );
      assert.equal(modelState.syntheticTestProvider, true);
      assert.equal(modelState.creates, 1);
      assert.equal(modelState.prompts, 1);
      assert.equal(modelState.destroys, 1);
      assert.match(modelState.echoedSourceHash, /^[a-f0-9]{64}$/);
      assert.deepEqual(modelState.proposedFields, ['amount']);
      await pendingProposal
        .getByRole('button', {
          name: 'استخدام الأعمدة بعد مراجعتها',
          exact: true,
        })
        .click();
    }
    await missingAmount.waitFor({ state: 'hidden' });
    await importAiPage.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) =>
          button.textContent?.trim() === 'تحقق وقارن' && !button.disabled,
      ),
    );
    assert.equal(await helperButton.count(), 0);
    assert.deepEqual(
      await importAiPage.getByRole('alert').allTextContents(),
      [],
    );
    await importAiCompare.click();
    await importAiPage
      .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
      .waitFor();
    assert.equal(
      await importAiPage
        .locator('.metric')
        .nth(0)
        .locator('strong')
        .innerText(),
      '3',
    );
    assert.equal(
      await importAiPage
        .locator('.metric')
        .nth(2)
        .locator('strong')
        .innerText(),
      '0',
    );
    assert.equal(
      await importAiPage
        .locator('.metric')
        .nth(3)
        .locator('strong')
        .innerText(),
      '0',
    );
  }
  // Metadata + strict format prefill: no names, currency or cutoff are typed.
  await context.setOffline(false);
  const quickPage = await context.newPage();
  await quickPage.goto(`${origin}/mizan-test/`);
  await quickPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  const quickBook = new ExcelJS.Workbook();
  quickBook.addWorksheet('Statement').addRows([
    ['Supplier', 'Synthetic Vendor'],
    ['Customer', 'Synthetic Entity'],
    ['Customer Account', 'SYN-7'],
    ['Period', '2026-06-01 to 2026-06-30'],
    ['date', 'reference', 'amount', 'currency'],
    ['14/06/2026', 'Q-0001', 123.45, 'SAR'],
    ['15/06/2026', 'Q-0002', -20, 'SAR'],
  ]);
  const quickBytes = Buffer.from(await quickBook.xlsx.writeBuffer());
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await quickPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic-prefill.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: quickBytes,
    });
    await quickPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await quickPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  // Everything needed was read from the files, so the confirmation step asks for
  // nothing: no entry field and no attestation box stand between the accountant
  // and the comparison.
  assert.equal(
    await quickPage
      .locator('input:not([type=checkbox]):not([aria-hidden=true]):visible')
      .count(),
    0,
    'a fully inferred scope must present no entry field to fill',
  );
  assert.equal(
    await quickPage.getByRole('checkbox').count(),
    0,
    'the default path must not ask for any attestation',
  );
  assert.equal(
    await quickPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    false,
    'with nothing missing, compare must be available immediately',
  );
  const quickSummary = await quickPage
    .locator('.summary-line')
    .first()
    .innerText();
  assert.match(quickSummary, /2026-06-30/);
  assert.match(quickSummary, /SAR/);
  // The values are inferred, not invented: open the panel and read them back.
  await quickPage
    .getByRole('button', { name: 'تعديل نطاق المقارنة', exact: true })
    .click();
  assert.equal(
    await quickPage.getByLabel('تاريخ القطع', { exact: true }).inputValue(),
    '2026-06-30',
  );
  assert.equal(
    await quickPage.getByLabel('العملة', { exact: true }).inputValue(),
    'SAR',
  );
  await quickPage.getByRole('checkbox', { name: /أريد تسوية الأرصدة/ }).check();
  assert.equal(
    await quickPage.getByLabel('المورد', { exact: true }).inputValue(),
    'Synthetic Vendor',
  );
  assert.equal(
    await quickPage.getByLabel('الجهة القانونية', { exact: true }).inputValue(),
    'Synthetic Entity',
  );
  await quickPage
    .getByRole('checkbox', { name: /أريد تسوية الأرصدة/ })
    .uncheck();
  assert.equal(
    await quickPage.getByLabel('المورد', { exact: true }).isVisible(),
    false,
  );
  await quickPage
    .getByRole('button', { name: 'تعديل نطاق المقارنة', exact: true })
    .click();
  assert.match(
    await quickPage.locator('.summary-line').nth(1).innerText(),
    /التاريخ/,
    'each source card states which column it read the date from',
  );
  await quickPage.screenshot({
    path: 'work/qa/quick-confirmation.png',
    fullPage: true,
  });
  await quickPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await quickPage
    .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
    .waitFor();
  assert.equal(
    await quickPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  await quickPage
    .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
    .click();
  const quickDownload = quickPage.waitForEvent('download');
  await quickPage
    .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
    .click();
  const quickExport = new ExcelJS.Workbook();
  await quickExport.xlsx.readFile(await (await quickDownload).path());
  assert.deepEqual(
    [2, 3].map(
      (row) =>
        quickExport.getWorksheet('Supplier transactions').getCell(`H${row}`)
          .value,
    ),
    [123.45, -20],
  );
  const exportedDate = quickExport
    .getWorksheet('Supplier transactions')
    .getCell('D2');
  assert.ok(exportedDate.value instanceof Date);
  assert.equal(exportedDate.value.toISOString(), '2026-06-14T00:00:00.000Z');
  assert.equal(exportedDate.numFmt, 'yyyy-mm-dd');
  // Two independent ambiguous formats must both remain unresolved until chosen.
  await context.setOffline(false);
  const ambiguityPage = await context.newPage();
  await ambiguityPage.goto(`${origin}/mizan-test/`);
  await ambiguityPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await ambiguityPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic-ambiguous.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,reference,amount,currency\n03/04/2026,Q-AMB-0001,1.234,KWD',
      ),
    });
    await ambiguityPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await ambiguityPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  await waitForScopeInputs(ambiguityPage);
  await ambiguityPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-12-31');
  assert.equal(
    await ambiguityPage.getByLabel('العملة', { exact: true }).inputValue(),
    'KWD',
  );
  assert.equal(
    await ambiguityPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    true,
  );
  for (const side of [0, 1]) {
    await ambiguityPage
      .getByRole('combobox', { name: `حسم صيغة التاريخ ${side}`, exact: true })
      .click();
    await ambiguityPage
      .getByRole('option', { name: 'يوم / شهر / سنة', exact: true })
      .click();
    await ambiguityPage
      .getByRole('combobox', { name: `حسم صيغة المبالغ ${side}`, exact: true })
      .click();
    await ambiguityPage
      .getByRole('option', { name: '1,234.56', exact: true })
      .click();
    assert.ok(
      (
        await ambiguityPage
          .getByRole('combobox', {
            name: `حسم صيغة التاريخ ${side}`,
            exact: true,
          })
          .innerText()
      ).includes('يوم / شهر / سنة'),
    );
  }
  await ambiguityPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await ambiguityPage
    .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
    .waitFor();
  assert.equal(
    await ambiguityPage.locator('.metric').nth(0).locator('strong').innerText(),
    '1',
  );
  await context.setOffline(false);
  const precisionPage = await context.newPage();
  await precisionPage.goto(`${origin}/mizan-test/`);
  await precisionPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  for (const label of ['كشف المورد', 'تقرير الحسابات الدائنة']) {
    await precisionPage.getByLabel(label, { exact: true }).setInputFiles({
      name: 'synthetic-precision.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,reference,amount,currency\n2026-06-01,Q-PREC,100,ZZZ',
      ),
    });
    await precisionPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await precisionPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  await waitForScopeInputs(precisionPage);
  await precisionPage
    .getByLabel('تاريخ القطع', { exact: true })
    .fill('2026-06-30');
  assert.equal(
    await precisionPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    true,
  );
  await precisionPage
    .getByRole('combobox', { name: 'دقة العملة', exact: true })
    .click();
  await precisionPage
    .getByRole('option', { name: 'منزلتان — مثل SAR', exact: true })
    .click();
  assert.equal(
    await precisionPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isEnabled(),
    true,
  );
  // A statement PDF whose header wording is outside the suggestion vocabulary:
  // the columns must come from the page geometry, so the accountant never has to
  // type a percentage to get past this step.
  await context.setOffline(false);
  const autoPdfPage = await context.newPage();
  await autoPdfPage.goto(`${origin}/mizan-test/`);
  await autoPdfPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  const autoRows = [
    ['Date', 'Doc. Ref', 'Narration', 'Value'],
    ['2026-08-01', 'INV-0001', 'Invoice', '100.00'],
    ['2026-08-02', 'PAY-0001', 'Payment', '-20.00'],
    ['2026-08-03', 'INV-0002', 'Invoice', '55.50'],
  ];
  await autoPdfPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'auto-columns.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf([autoRows])),
  });
  await autoPdfPage.waitForFunction(
    () => !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  await autoPdfPage
    .getByLabel('تقرير الحسابات الدائنة', { exact: true })
    .setInputFiles({
      name: 'auto-columns.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,reference,amount\n2026-08-01,INV-0001,100.00\n2026-08-02,PAY-0001,-20.00\n2026-08-03,INV-0002,55.50',
      ),
    });
  await autoPdfPage.waitForFunction(
    () => !document.body.innerText.includes('قراءة الملف على جهازك'),
  );
  await autoPdfPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  // The review box must be reachable without applying a boundary by hand: this
  // is the dead end that used to block the whole flow.
  const autoReview = autoPdfPage.getByRole('checkbox', {
    name: /راجعت الجدول أعلاه/,
  });
  assert.equal(
    await autoReview.isDisabled(),
    false,
    'the PDF review box must never be unreachable',
  );
  await autoReview.check();
  assert.equal(await autoReview.isChecked(), true);
  // Typing a boundary and abandoning it must not latch the box off.
  await autoPdfPage
    .getByRole('button', { name: 'تعديل حدود الأعمدة', exact: true })
    .click();
  const autoCuts = autoPdfPage.getByLabel('حدود أعمدة PDF', { exact: true });
  const appliedCuts = await autoCuts.inputValue();
  assert.ok(appliedCuts.length, 'geometry must have produced boundaries');
  await autoCuts.fill('oops');
  assert.equal(
    await autoPdfPage
      .getByRole('button', { name: 'تطبيق وإعادة القراءة', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await autoPdfPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    true,
    'unapplied PDF edits must block comparison',
  );
  await autoPdfPage
    .getByRole('button', { name: 'التراجع عن التعديل', exact: true })
    .click();
  assert.equal(await autoCuts.inputValue(), appliedCuts);
  await autoCuts.fill(appliedCuts);
  assert.equal(
    await autoReview.isChecked(),
    true,
    'restoring the applied boundaries must leave the review intact',
  );
  await waitForScopeInputs(autoPdfPage);
  await autoPdfPage.getByLabel('العملة', { exact: true }).fill('SAR');
  assert.equal(
    await autoPdfPage
      .getByRole('button', { name: 'تحقق وقارن', exact: true })
      .isDisabled(),
    false,
  );
  await autoPdfPage
    .getByRole('button', { name: 'تحقق وقارن', exact: true })
    .click();
  await autoPdfPage
    .getByRole('heading', { name: 'مساحة المراجعة' })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await autoPdfPage.locator('.metric').nth(0).locator('strong').innerText(),
    '3',
    'all three PDF rows must match the ledger',
  );
  // With balances not requested, the result reports how much of the source
  // never entered the comparison, and says zero when nothing was skipped.
  const skipped = autoPdfPage.locator('.metric').nth(3);
  assert.match(await skipped.innerText(), /صفوف لم تُقرأ/);
  assert.equal(await skipped.locator('strong').innerText(), '0');
  assert.equal(
    (await autoPdfPage.locator('body').innerText()).includes(
      'اتساق الرصيد أو التغطية غير متحقق',
    ),
    false,
    'balance notes must not appear when balances were never requested',
  );
  await autoPdfPage.screenshot({
    path: 'work/qa/auto-columns.png',
    fullPage: true,
  });

  // Namespaced SpreadsheetML must reach the real browser worker. Opposite
  // debit/credit conventions are inferred only from fixed running balances.
  for (const formulas of [false, true]) {
    const directionPhase = formulas ? 'formula balances' : 'fixed balances';
    await context.setOffline(false);
    const directionPage = await context.newPage();
    await directionPage.goto(`${origin}/mizan-test/`);
    await directionPage.waitForFunction(
      () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
    );
    await context.setOffline(true);
    for (const [side, label] of [
      'كشف المورد',
      'تقرير الحسابات الدائنة',
    ].entries()) {
      const name = `synthetic-namespaced-${side}-${formulas ? 'formula' : 'fixed'}.xlsx`;
      await directionPage.getByLabel(label, { exact: true }).setInputFiles({
        name,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await directionWorkbook(side === 1, formulas),
      });
      await directionPage
        .locator('.dropzone')
        .filter({ hasText: label })
        .getByText(name, { exact: true })
        .waitFor();
      await directionPage.waitForFunction(
        () => !document.body.innerText.includes('قراءة الملف على جهازك'),
      );
      assert.deepEqual(
        await directionPage.getByRole('alert').allTextContents(),
        [],
      );
    }
    await directionPage
      .getByRole('button', { name: 'تأكيد البيانات', exact: true })
      .click();
    const directionCompare = directionPage.getByRole('button', {
      name: 'تحقق وقارن',
      exact: true,
    });
    assert.equal(
      // BaseUI Selects render clipped aria-hidden transport inputs. The sign
      // choices are asserted separately below; only actual entry fields count.
      await directionPage
        .locator('input:not([type=checkbox]):not([aria-hidden=true]):visible')
        .count(),
      0,
      `${directionPhase}: known metadata and native numeric cells need no typed fields`,
    );
    assert.equal(await directionPage.getByRole('checkbox').count(), 0);
    const directionQuestion = 'أي عمود يزيد المبلغ المستحق للمورد؟';
    if (formulas) {
      assert.equal(
        await directionPage
          .getByRole('combobox', { name: directionQuestion, exact: true })
          .count(),
        2,
        `${directionPhase}: each source must expose its own direction choice`,
      );
      assert.equal(
        await directionCompare.isDisabled(),
        true,
        'formula caches cannot prove either direction',
      );
      for (const [side, label] of [
        'كشف المورد',
        'تقرير الحسابات الدائنة',
      ].entries()) {
        const card = directionPage.locator('section').filter({
          has: directionPage.getByRole('heading', {
            name: label,
            exact: true,
          }),
        });
        await card
          .getByRole('combobox', { name: directionQuestion, exact: true })
          .click();
        await directionPage
          .getByRole('option', {
            name: side === 0 ? 'المدين يزيد المستحق' : 'الدائن يزيد المستحق',
            exact: true,
          })
          .click();
        if (side === 0)
          assert.equal(
            await directionCompare.isDisabled(),
            true,
            'the AP direction still requires its own answer',
          );
      }
    } else {
      assert.equal(
        await directionPage.getByRole('combobox').count(),
        0,
        `${directionPhase}: every required choice is established by source evidence`,
      );
    }
    const apCard = directionPage.locator('section').filter({
      has: directionPage.getByRole('heading', {
        name: 'تقرير الحسابات الدائنة',
        exact: true,
      }),
    });
    if (!formulas) {
      // A full mapping returned by header selection contains multiplier=+1.
      // That default is not a manual sign decision: the AP proof must win again.
      const editAp = directionPage.getByRole('button', {
        name: 'تعديل تقرير الحسابات الدائنة',
        exact: true,
      });
      await editAp.click();
      const headerRow = directionPage.getByLabel('صف العناوين 1', {
        exact: true,
      });
      assert.equal(await headerRow.inputValue(), '6');
      await headerRow.fill('7');
      await headerRow.fill('6');
      await apCard
        .getByText(/اتجاه المدين والدائن متحقق حسابيًا.*الدائن − المدين/)
        .waitFor();
      assert.equal(
        await apCard
          .getByRole('combobox', { name: directionQuestion, exact: true })
          .count(),
        0,
      );
      await editAp.click();
      assert.equal(
        await directionCompare.isEnabled(),
        true,
        'header selection must restore the proven AP direction, never endorse the mapping default',
      );
    } else {
      // Failed replacement cannot reset an answer attached to the retained file.
      await directionPage
        .getByRole('button', { name: 'العودة للملفات', exact: true })
        .click();
      await directionPage
        .getByLabel('تقرير الحسابات الدائنة', { exact: true })
        .setInputFiles({
          name: 'synthetic-invalid-replacement.xlsx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: Buffer.from('This is not an XLSX ZIP package.'),
        });
      await directionPage.getByRole('alert').waitFor();
      await directionPage
        .locator('.dropzone')
        .filter({ hasText: 'تقرير الحسابات الدائنة' })
        .getByText('synthetic-namespaced-1-formula.xlsx', { exact: true })
        .waitFor();
      await directionPage
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .click();
      assert.match(
        await apCard
          .getByRole('combobox', { name: directionQuestion, exact: true })
          .innerText(),
        /الدائن يزيد المستحق/,
      );
      assert.equal(
        await directionCompare.isEnabled(),
        true,
        'the failed replacement must retain the old AP file and its manual negative multiplier',
      );
    }
    assert.equal(await directionCompare.isEnabled(), true);
    await directionPage.screenshot({
      path: `work/qa/namespaced-${formulas ? 'essential-direction' : 'automatic-direction'}.png`,
      fullPage: true,
    });
    await directionCompare.click();
    await directionPage
      .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
      .waitFor();
    // F7 is the formula "100" in the formula fixture. The restricted balance
    // evaluator accepts cell references joined by +/- only, so neither this
    // cached opening nor its dependent closing proves a balance bridge. Both
    // phases still have an explicit period and two readable transactions.
    const directionMetric = directionPage.locator('.metric').nth(3);
    assert.match(
      await directionMetric.innerText(),
      formulas ? /صفوف لم تُقرأ/ : /فرق الأرصدة/,
      formulas
        ? 'unsupported balance formulas must not turn cached values into a verified bridge'
        : 'fixed source balances support the arithmetic bridge',
    );
    assert.equal(
      await directionPage
        .locator('.metric')
        .nth(0)
        .locator('strong')
        .innerText(),
      '2',
    );
    assert.equal(
      await directionMetric.locator('strong').innerText(),
      formulas ? '0' : '0.00',
    );
    await directionPage
      .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
      .click();
    const directionDownload = directionPage.waitForEvent('download');
    await directionPage
      .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
      .click();
    const directionExport = new ExcelJS.Workbook();
    await directionExport.xlsx.readFile(await (await directionDownload).path());
    assert.equal(directionExport.getWorksheet('Matches').rowCount, 3);
    for (const source of ['Supplier transactions', 'Ledger transactions']) {
      assert.deepEqual(
        [2, 3].map(
          (row) =>
            directionExport.getWorksheet(source).getCell(`H${row}`).value,
        ),
        [25, -10],
      );
      assert.deepEqual(
        [2, 3].map(
          (row) =>
            directionExport.getWorksheet(source).getCell(`E${row}`).value,
        ),
        ['DIR-INV-100', 'DIR-PAY-100'],
      );
    }
  }

  // Each PDF carries its own review approval. A second checkbox must never
  // toggle the first file, and replacing a multi-page file must reset its view.
  await context.setOffline(false);
  const bothPdfPage = await context.newPage();
  await bothPdfPage.goto(`${origin}/mizan-test/`);
  await bothPdfPage.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  await context.setOffline(true);
  const pairHeader = ['Date', 'Reference', 'Amount (SAR)'];
  const pairInvoice = ['2026-07-02', 'PAIR-INV-100', '100.00'];
  const pairPayment = ['2026-07-03', 'PAIR-PAY-100', '-20.00'];
  const onePagePdf = Buffer.from(
    syntheticPdf([[pairHeader, pairInvoice, pairPayment]]),
  );
  const twoPagePdf = Buffer.from(
    syntheticPdf([
      [pairHeader, pairInvoice],
      [pairHeader, pairPayment],
    ]),
  );
  for (const [side, label] of [
    'كشف المورد',
    'تقرير الحسابات الدائنة',
  ].entries()) {
    const name = `synthetic-pair-${side}.pdf`;
    await bothPdfPage.getByLabel(label, { exact: true }).setInputFiles({
      name,
      mimeType: 'application/pdf',
      buffer: side === 0 ? twoPagePdf : onePagePdf,
    });
    await bothPdfPage
      .locator('.dropzone')
      .filter({ hasText: label })
      .getByText(name, { exact: true })
      .waitFor();
    await bothPdfPage.waitForFunction(
      () => !document.body.innerText.includes('قراءة الملف على جهازك'),
    );
  }
  await bothPdfPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  const supplierPdfCard = bothPdfPage.locator('section').filter({
    has: bothPdfPage.getByRole('heading', {
      name: 'كشف المورد',
      exact: true,
    }),
  });
  const ledgerPdfCard = bothPdfPage.locator('section').filter({
    has: bothPdfPage.getByRole('heading', {
      name: 'تقرير الحسابات الدائنة',
      exact: true,
    }),
  });
  const supplierReview = supplierPdfCard.getByRole('checkbox', {
    name: /راجعت الجدول أعلاه/,
  });
  const ledgerReview = ledgerPdfCard.getByRole('checkbox', {
    name: /راجعت الجدول أعلاه/,
  });
  const bothCompare = bothPdfPage.getByRole('button', {
    name: 'تحقق وقارن',
    exact: true,
  });
  assert.equal(
    await bothPdfPage
      .getByRole('checkbox', { name: /راجعت الجدول أعلاه/ })
      .count(),
    2,
  );
  assert.equal(await supplierReview.isChecked(), false);
  assert.equal(await ledgerReview.isChecked(), false);
  assert.equal(await bothCompare.isDisabled(), true);
  await supplierReview.check();
  assert.equal(await supplierReview.isChecked(), true);
  assert.equal(await ledgerReview.isChecked(), false);
  assert.equal(await bothCompare.isDisabled(), true);
  await ledgerReview.check();
  assert.equal(await ledgerReview.isChecked(), true);
  assert.equal(await supplierReview.isChecked(), true);
  assert.equal(await bothCompare.isEnabled(), true);
  await supplierReview.uncheck();
  assert.equal(await ledgerReview.isChecked(), true);
  assert.equal(await bothCompare.isDisabled(), true);
  await supplierReview.check();
  await supplierPdfCard
    .getByRole('button', { name: 'الصفحة التالية', exact: true })
    .click();
  await supplierPdfCard
    .locator('.preview tbody')
    .getByText('PAIR-PAY-100', { exact: true })
    .waitFor();
  await bothPdfPage
    .getByRole('button', { name: 'العودة للملفات', exact: true })
    .click();
  await bothPdfPage.getByLabel('كشف المورد', { exact: true }).setInputFiles({
    name: 'synthetic-replacement-one-page.pdf',
    mimeType: 'application/pdf',
    buffer: onePagePdf,
  });
  await bothPdfPage
    .locator('.dropzone')
    .filter({ hasText: 'كشف المورد' })
    .getByText('synthetic-replacement-one-page.pdf', { exact: true })
    .waitFor();
  await bothPdfPage
    .getByRole('button', { name: 'تأكيد البيانات', exact: true })
    .click();
  assert.equal(
    await supplierPdfCard
      .getByRole('button', { name: 'الصفحة التالية', exact: true })
      .count(),
    0,
  );
  assert.equal(await supplierPdfCard.locator('.preview tbody tr').count(), 2);
  await supplierPdfCard
    .locator('.preview tbody')
    .getByText('PAIR-INV-100', { exact: true })
    .waitFor();
  assert.equal(
    await supplierReview.isChecked(),
    false,
    'a replacement never inherits PDF approval',
  );
  assert.equal(
    await ledgerReview.isChecked(),
    true,
    'the unchanged counterpart keeps its independent review',
  );
  assert.equal(await bothCompare.isDisabled(), true);
  await supplierReview.check();
  await bothCompare.click();
  await bothPdfPage
    .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
    .waitFor();
  assert.equal(
    await bothPdfPage.locator('.metric').nth(0).locator('strong').innerText(),
    '2',
  );
  assert.equal(
    await bothPdfPage.locator('.metric').nth(3).locator('strong').innerText(),
    '0',
  );
  await bothPdfPage.screenshot({
    path: 'work/qa/two-pdf-independent-reviews.png',
    fullPage: true,
  });

  await verifyVisualReader(await context.newPage(), `${origin}/mizan-test/`);
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
          'case workpaper reimport chooses parsed sources without restoring approvals',
          'bordered PDF upload, review, comparison and Excel export offline',
          'covered PDF rejected, XLSX retry succeeds, colored PDF comparison and numeric export succeed offline',
          'typed image-only and first-failing-page PDF diagnoses retain the existing XLSX and recover on the next readable PDF',
          'synthetic ready local-model advice requires explicit Apply before comparison; absent/downloadable providers never create sessions and retain manual mapping',
          'clear files show no mandatory input fields; explicit metadata and unambiguous formats filled and numeric export verified',
          'both ambiguous date and 3-decimal amount formats require independent choices',
          'unknown currency precision requires an explicit choice including the existing two-decimal value',
          'PDF columns detected from geometry with a reachable review box',
          'namespaced XLSX source pairs: zero mandatory fields with proven opposite directions and exact numeric Excel export',
          'formula running balances require separate essential supplier/AP sign choices before comparison',
          'header selection preserves proven AP direction; failed XLSX replacement preserves the retained file manual sign choice',
          'two PDF review approvals remain independent; replacing a multi-page PDF resets its preview and approval',
          'real local PNG/raster-PDF OCR, source hash, word coordinates, cancel/clear, native-source isolation and static-assets-only network',
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
