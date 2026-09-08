import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';
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
      syntheticPdf([
        [
          ['date', 'reference', 'amount', 'description'],
          ['2026-08-01', 'INV-0001', '100.00', 'Invoice'],
          ['2026-08-02', 'PAY-0001', '-20.00', 'Payment'],
        ],
      ]),
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
          'PDF upload, review, comparison and Excel export offline',
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
