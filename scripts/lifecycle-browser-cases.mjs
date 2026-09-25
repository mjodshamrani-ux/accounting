import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

export async function verifyTemplateLifecycle(context, url) {
  const page = await context.newPage();
  await page.bringToFront();
  await page.addInitScript(() => {
    localStorage.setItem(
      'mizan.mapping.0.v1',
      JSON.stringify({
        sheet: 0,
        header: 0,
        date: 0,
        reference: 1,
        description: 2,
        amount: 3,
        debit: -1,
        credit: -1,
        currencyColumn: 4,
        mode: 'signed',
        multiplier: -1,
        numberFormat: 'comma',
        dateFormat: 'mdy',
        reportType: 'open-items',
        opening: '90000',
        closing: '90000',
        periodStart: '2020-01-01',
        excluded: { 2: 'old source financial note' },
        pdfReviewed: true,
        directionEvidence: {
          multiplier: -1,
          balanceColumn: 3,
          checkedRows: 9000,
          reason: 'old source',
        },
      }),
    );
  });
  await page.goto(url);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('mizan.mapping.0.v1') ?? '{}').version ===
      2,
  );
  // Migration runs before the accounting worker is ready. Native file inputs
  // are still disabled then; setInputFiles can bypass that browser affordance.
  // Wait for the same ready state an accountant must reach before upload.
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="كشف المورد"]');
    return input && !input.disabled;
  });
  const saved = await page.evaluate(() =>
    localStorage.getItem('mizan.mapping.0.v1'),
  );
  assert.ok(
    !/90000|old source|directionEvidence|multiplier|numberFormat|dateFormat|reportType/.test(
      saved,
    ),
  );
  await context.setOffline(true);
  for (let run = 1; run <= 3; run++) {
    console.log(`[browser] template cycle ${run}`);
    const amount = (120 + run).toFixed(2);
    const text = `Date,Reference,Description,Amount,Currency\n2026-07-15,TPL-${run},Synthetic invoice,${amount},SAR\n2026-07-16,PAY-${run},Synthetic payment,-20.00,SAR`;
    // The ledger is its own export of the same entries (a final line break);
    // one file on both sides would be a self-comparison.
    for (const [index, label] of [
      'كشف المورد',
      'تقرير الحسابات الدائنة',
    ].entries()) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: `synthetic-cycle-${run}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(text + (index ? '\n' : '')),
      });
      await page
        .locator('.dropzone')
        .filter({ hasText: label })
        .getByText(`synthetic-cycle-${run}.csv`, { exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'إلغاء', exact: true })
        .waitFor({ state: 'hidden' });
    }
    await page
      .getByRole('button', { name: 'تأكيد البيانات', exact: true })
      .click();
    if (run === 1) {
      await page
        .getByRole('button', { name: 'تعديل كشف المورد', exact: true })
        .click();
      const card = page.locator('section.surface').filter({
        has: page.getByRole('heading', { name: 'كشف المورد', exact: true }),
      });
      await card
        .getByText('إعدادات القراءة ونوع التقرير', { exact: true })
        .click();
      await card
        .getByRole('button', { name: 'استعادة القالب', exact: true })
        .click();
      await page
        .getByText(
          'استعدنا مواضع الأعمدة فقط. يُفحص اتجاه المبالغ وصيغتها من الملف الحالي.',
          { exact: true },
        )
        .waitFor();
    }
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
    await page
      .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.metric').nth(0).locator('strong').innerText(),
      '2',
    );
    await page
      .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
      .click();
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
      .click();
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await (await pending).path());
    for (const name of ['Supplier transactions', 'Ledger transactions']) {
      assert.equal(
        book.getWorksheet(name).getCell('H2').value,
        Number(amount),
        'old negative multiplier cannot survive restoration',
      );
      assert.equal(
        book.getWorksheet(name).getCell('E2').value,
        `TPL-${run}`,
        'fresh session must not export stale rows',
      );
      assert.equal(book.getWorksheet(name).rowCount, 3);
    }
    await page
      .getByRole('button', { name: 'تسوية جديدة', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'مسح الجلسة والبدء من جديد', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'جرّب المثال', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByText(`TPL-${run}`, { exact: true }).count(),
      0,
    );
  }
  await page.close();
}
