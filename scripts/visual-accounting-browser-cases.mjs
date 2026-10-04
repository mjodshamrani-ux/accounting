import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { knownVisualSource } from '../audit/visual-accounting/make_record.mjs';

export async function verifyVisualAccounting(page, baseUrl) {
  const origin = new URL(baseUrl).origin,
    violations = [],
    errors = [];
  const request = (r) => {
    const u = new URL(r.url());
    if (
      r.method() !== 'GET' ||
      (!['blob:', 'data:'].includes(u.protocol) && u.origin !== origin)
    )
      violations.push(r.url());
  };
  const error = (e) => errors.push(e.message);
  page.context().on('request', request);
  page.on('pageerror', error);
  await mkdir('work/qa', { recursive: true });
  try {
    let input = 'work/qa/p6-table-reviewed.json';
    try {
      await readFile(input);
    } catch {
      input = 'audit/visual-table/baseline/reviewed.json';
    }
    const f = await knownVisualSource(input);
    await page.goto(baseUrl);
    await page
      .getByRole('button', { name: 'جرّب المثال', exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('.dropzone')
          ?.textContent.includes('نجهّز أداة القراءة'),
    );
    const panel = page.locator('#visual-reader');
    await panel.locator('summary').first().click();
    await panel
      .getByLabel('ملف سجل مراجعة الصور', { exact: true })
      .setInputFiles({
        name: 'source-review.json',
        mimeType: 'application/json',
        buffer: Buffer.from(f.bytes),
      });
    const table = panel.locator('.visual-table-review');
    await table.getByText('مراجعة النطاق مسجلة', { exact: true }).waitFor();
    if ((await table.getAttribute('open')) === null)
      await table.locator('summary').first().click();
    const form = table.locator('.visual-accounting-review');
    await form.locator('summary').click();
    assert.ok(
      await page
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .isDisabled(),
      'restoring evidence alone must not import accounting data',
    );
    const roles = ['المرجع', 'التاريخ', 'مبلغ الحركة', 'الرصيد'];
    for (const [i, role] of roles.entries())
      await form
        .getByLabel('دليل عنوان ' + role, { exact: true })
        .selectOption(f.headers[i]);
    await form
      .getByLabel('دليل رمز العملة في الصورة', { exact: true })
      .selectOption(f.currencyProof);
    for (const [label, value] of [
      ['المورد في الصورة', 'Synthetic Supplier'],
      ['جهة المقارنة', 'Synthetic Entity'],
      ['عملة الصورة', 'SAR'],
      ['بداية فترة الصورة', '2026-07-01'],
      ['تاريخ المقارنة للصورة', '2026-07-31'],
    ])
      await form.getByLabel(label, { exact: true }).fill(value);
    for (const [label, value] of [
      ['اتجاه مبالغ الصورة', '1'],
      ['فواصل مبالغ الصورة', 'dot'],
      ['ترتيب تواريخ الصورة', 'ymd'],
    ])
      await form.getByLabel(label, { exact: true }).selectOption(value);
    const acknowledgement = form.getByRole('checkbox'),
      transfer = form.getByRole('button', {
        name: 'استخدم القيم المراجعة في المقارنة',
        exact: true,
      });
    await acknowledgement.check();
    await form.getByLabel('عملة الصورة', { exact: true }).fill('USD');
    assert.ok(
      !(await acknowledgement.isChecked()),
      'editing context must revoke acknowledgement',
    );
    await acknowledgement.check();
    await transfer.click();
    await form.getByRole('alert').waitFor();
    assert.ok(
      await page
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .isDisabled(),
      'currency contradiction cannot silently import',
    );
    await form.getByLabel('عملة الصورة', { exact: true }).fill('SAR');
    await acknowledgement.check();
    await transfer.click();
    await page
      .locator('.dropzone.has-file')
      .getByText('statement.tarasuf-reviewed.json', { exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('input[aria-label="تقرير الحسابات الدائنة"]')
          .disabled,
    );
    await page
      .getByLabel('تقرير الحسابات الدائنة', { exact: true })
      .setInputFiles({
        name: 'ledger.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          f.contract.ledger.map((r) => r.join(',')).join('\n'),
        ),
      });
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
    await page
      .getByRole('button', { name: 'تأكيد البيانات', exact: true })
      .click();
    await page.locator('.visual-accounting-bound').waitFor();
    assert.equal(
      await page
        .locator('.visual-accounting-bound')
        .locator('input,select,button')
        .count(),
      0,
      'source meaning is read-only in accounting configuration',
    );
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
    await page
      .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.metric').first().locator('strong').innerText(),
      '1',
    );
    await page.screenshot({
      path: 'work/qa/p6-accounting-ar.png',
      fullPage: true,
    });
    async function download(label, path) {
      const [event] = await Promise.all([page.waitForEvent('download',{timeout:60000}), page.getByRole('button', { name: label, exact: true }).click()]);
      const bytes = await readFile(await event.path());
      await writeFile(path, bytes);
      return bytes;
    }
    await page.getByRole('button', {name:'إعداد ورقة العمل',exact:true}).click();
    await download('تنزيل ورقة عمل جزئية', 'work/qa/p6-accounting-ar.xlsx');
    const session = await download(
      'حفظ الجلسة للمتابعة لاحقًا',
      'work/qa/p6-accounting-session.json',
    );
    const wire = JSON.parse(session.toString('utf8'));
    await writeFile(
      'work/qa/p6-accounting-source.json',
      Buffer.from(wire.files[0].data, 'base64'),
    );
    await writeFile(
      'work/qa/p6-accounting-source.png',
      await readFile('audit/visual-table/fixtures/statement.png'),
    );
    await page.getByRole('button', { name: /^EN\b/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: 'work/qa/p6-accounting-en-mobile.png',
      fullPage: true,
    });
    await download('Download partial workpaper', 'work/qa/p6-accounting-en.xlsx');
    await page.getByRole('button', { name: /^AR\b/ }).click();
    await page
      .getByRole('button', { name: 'تسوية جديدة', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'مسح الجلسة والبدء من جديد', exact: true })
      .click();
    await page
      .getByLabel('استئناف جلسة محلية', { exact: true })
      .setInputFiles({
        name: 'reviewed-session.json',
        mimeType: 'application/json',
        buffer: session,
      });
    await page
      .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.metric').first().locator('strong').innerText(),
      '1',
    );
    await page.getByRole('button', {name:'إعداد ورقة العمل',exact:true}).click();
    await download('تنزيل ورقة عمل جزئية', 'work/qa/p6-accounting-restored.xlsx');
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      knownDevelopmentCase: true,
      training: false,
      automaticOCR: false,
      manuallyReviewedImage: true,
      matches: 1,
      damagedRows: 1,
      fullBalanceReconciliation: false,
      contextEditRevokesReview: true,
      currencyContradictionRejected: true,
      originalsReplayedOnRestore: true,
      languages: ['ar', 'en'],
      mobile: true,
      networkViolations: violations,
      pageErrors: errors,
    };
    await writeFile(
      'work/qa/p6-accounting-report.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      '[browser] reviewed image: explicit transfer, partial match, bound context, currency denial, PNG/record export, AR/EN/mobile and session replay passed',
    );
    return report;
  } catch (e) {
    await page
      .screenshot({ path: 'work/qa/p6-accounting-failure.png', fullPage: true })
      .catch(() => {});
    throw e;
  } finally {
    page.context().off('request', request);
    page.off('pageerror', error);
  }
}
