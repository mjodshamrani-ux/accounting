import assert from 'node:assert/strict';
import { revealDomainEntry } from './domain-navigation-support.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
export async function verifyAllocation(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('button', { name: 'تخصيص الدفعات', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'تخصيص الدفعات', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'فتح مثال تخصيص اصطناعي', exact: true })
    .click();
  await page.getByTestId('allocation-result').waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const sides = ['Available payments', 'Open invoices', 'Proposed remittance'],
    truth = JSON.parse(
      await readFile('audit/allocation/frozen/expected.json', 'utf8'),
    ),
    labels = [
      'Entity',
      'Ledger',
      'Supplier',
      'Payable account',
      'Currency',
      'Snapshot date',
    ];
  async function upload(name, native = false) {
    for (const side of [0, 1, 2]) {
      let file = `audit/allocation/frozen/${name}-${side}.csv`;
      if (native) {
        const rows = (await readFile(file, 'utf8'))
            .trim()
            .split('\n')
            .map((l) => l.split(',')),
          b = new ExcelJS.Workbook(),
          w = b.addWorksheet('Native');
        w.addRows(rows);
        for (let r = 2; r <= w.rowCount; r++)
          for (let c = 1; c <= w.columnCount; c++) {
            const cell = w.getCell(r, c),
              h = w.getCell(1, c).text;
            if (/amount$/i.test(h)) {
              cell.value = Number(cell.value);
              cell.numFmt = '0.00';
            }
            if (/date$/i.test(h)) {
              cell.value = new Date(cell.text + 'T00:00:00.000Z');
              cell.numFmt = 'yyyy-mm-dd';
            }
          }
        file = `${out}/allocation-native-source-${side}.xlsx`;
        await writeFile(file, new Uint8Array(await b.xlsx.writeBuffer()));
      }
      const source = page.getByTestId(`allocation-source-${side}`);
      await source.getByLabel(sides[side], { exact: true }).setInputFiles(file);
      await source
        .getByRole('heading', { name: file.split('/').at(-1), exact: true })
        .waitFor();
      await source
        .getByLabel(`${sides[side]}: I reviewed`, { exact: false })
        .check();
    }
    for (const [i, label] of labels.entries())
      await page
        .getByLabel(label, { exact: true })
        .fill(Object.values(truth.scope)[i]);
    await page
      .getByLabel(
        'I reviewed the entity, ledger, supplier, account, currency and snapshot before these allocations.',
        { exact: true },
      )
      .check();
    await page
      .getByRole('button', { name: 'Read value ledger', exact: true })
      .click();
    await page.getByTestId('allocation-result').waitFor();
  }
  async function approveAdvice() {
    await page
      .getByLabel('Decision or undo reason', { exact: true })
      .fill('Synthetic advice explicitly states this distribution');
    for (const box of await page
      .getByTestId('allocation-proof')
      .locator('input')
      .all())
      if (await box.isEnabled()) await box.check();
    await page
      .getByRole('button', {
        name: 'Approve selected advice atomically',
        exact: true,
      })
      .click();
    await page.getByTestId('allocation-event').first().waitFor();
  }
  const moneyRows = () =>
    page
      .getByTestId('allocation-ledger')
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows.map((r) =>
          Array.from(r.querySelectorAll('td,th')).map((c) => c.textContent),
        ),
      );
  async function download(button, file) {
    const request = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await request).saveAs(out + '/' + file);
  }
  await upload('one-to-many');
  assert.ok((await moneyRows()).every((r) => r[4] === '0.00'));
  await approveAdvice();
  assert.equal((await moneyRows())[0][4], '1,000.00');
  assert.equal((await moneyRows())[0][5], '0.00');
  assert.equal(
    await page
      .getByTestId('allocation-proof')
      .locator('input:disabled')
      .count(),
    3,
  );
  await download('Download allocation workpaper', 'allocation-direct.xlsx');
  await download('Save allocation session', 'allocation-session.json');
  await page
    .getByRole('button', { name: 'Back to suppliers', exact: true })
    .click();
  await revealDomainEntry(page, 'allocation');
  await page
    .getByRole('button', { name: 'Payment allocation', exact: true })
    .click();
  assert.equal((await moneyRows())[0][4], '1,000.00');
  await page
    .getByLabel('Restore allocation session', { exact: true })
    .setInputFiles(out + '/allocation-session.json');
  await page
    .getByRole('button', { name: 'Download allocation workpaper', exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      document
        .querySelector('main.gl-tb-workspace')
        ?.getAttribute('aria-busy') === 'false',
  );
  await download('Download allocation workpaper', 'allocation-restored.xlsx');
  await page
    .getByLabel('Decision or undo reason', { exact: true })
    .fill('Synthetic undo');
  await page
    .getByRole('button', { name: 'Undo decision D1', exact: true })
    .click();
  await page.getByTestId('allocation-event').nth(1).waitFor();
  assert.equal((await moneyRows())[0][4], '0.00');
  assert.equal(
    await page
      .getByTestId('allocation-proof')
      .locator('input:disabled')
      .count(),
    0,
  );
  await upload('undo');
  await approveAdvice();
  await page
    .getByLabel('Decision or undo reason', { exact: true })
    .fill('Synthetic undo of entire decision');
  await page
    .getByRole('button', { name: 'Undo decision D1', exact: true })
    .click();
  await page.getByTestId('allocation-event').nth(1).waitFor();
  await approveAdvice();
  await page.getByTestId('allocation-event').nth(2).waitFor();
  assert.equal((await moneyRows())[0][4], '400.00');
  await download('Download allocation workpaper', 'allocation-undo.xlsx');
  await upload('payment-overrun');
  await page
    .getByLabel('Decision or undo reason', { exact: true })
    .fill('Synthetic split exceeds payment capacity');
  await page
    .getByLabel('Human evidence reference', { exact: true })
    .fill('Synthetic confirmation');
  await page
    .getByRole('button', { name: 'Add allocation link', exact: true })
    .click();
  for (const [index, n] of ['700', '500'].entries()) {
    const d = page.getByTestId('allocation-draft').nth(index);
    await d
      .getByLabel('Available payments', { exact: true })
      .selectOption({ label: 'P1' });
    await d
      .getByLabel('Open invoices', { exact: true })
      .selectOption({ label: `I${index + 1}` });
    await d.getByLabel('Allocation amount', { exact: true }).fill(n);
  }
  await page
    .getByRole('button', {
      name: 'Approve human allocation atomically',
      exact: true,
    })
    .click();
  await page.getByRole('alert').waitFor();
  assert.ok((await moneyRows()).every((r) => r[4] === '0.00'));
  assert.equal(await page.getByTestId('allocation-event').count(), 0);
  await download('Download allocation workpaper', 'allocation-overrun.xlsx');
  await upload('one-to-many', true);
  await approveAdvice();
  await download('Download allocation workpaper', 'allocation-native.xlsx');
  await download('Save allocation session', 'allocation-native-session.json');
  await page
    .getByLabel('Restore allocation session', { exact: true })
    .setInputFiles(out + '/allocation-native-session.json');
  await page.waitForFunction(
    () =>
      document
        .querySelector('main.gl-tb-workspace')
        ?.getAttribute('aria-busy') === 'false',
  );
  await download(
    'Download allocation workpaper',
    'allocation-native-restored.xlsx',
  );
  await page
    .getByTestId('allocation-source-0')
    .getByLabel('Available payments', { exact: true })
    .setInputFiles({
      name: 'not-supported.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('bad'),
    });
  await page.getByRole('alert').waitFor();
  assert.equal((await moneyRows())[0][4], '1,000.00');
  await page.getByLabel('Supplier', { exact: true }).fill('Changed supplier');
  assert.equal(await page.getByTestId('allocation-result').count(), 0);
  assert.equal(
    await page
      .getByLabel(
        'I reviewed the entity, ledger, supplier, account, currency and snapshot before these allocations.',
        { exact: true },
      )
      .isChecked(),
    false,
  );
  await upload('currency-mismatch');
  assert.equal(
    await page.getByTestId('allocation-status').innerText(),
    'Source errors block allocation',
  );
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Approve selected advice atomically',
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await download(
    'Download allocation workpaper',
    'allocation-source-error.xlsx',
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    await page
      .getByRole('heading', { name: 'تخصيص الدفعات', exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${out}/allocation-ar-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log(
    'Allocation browser: native three-source replay, atomic rejection, undo, source invalidation, domain retention, AR/EN and mobile passed.',
  );
}
