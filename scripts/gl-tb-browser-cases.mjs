import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { revealDomainEntry } from './domain-navigation-support.mjs';
export async function verifyGlTb(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('button', { name: 'الأستاذ / ميزان المراجعة', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'اتساق الأستاذ وميزان المراجعة', exact: true })
    .waitFor();
  await page
    .getByRole('button', {
      name: 'فتح مثال اصطناعي للأستاذ والميزان',
      exact: true,
    })
    .click();
  await page
    .getByTestId('gl-tb-status')
    .getByText('متسق ضمن النطاق المعلن', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const truth = JSON.parse(
    await readFile('audit/gl-tb/frozen/expected.json', 'utf8'),
  );
  const labels = {
    entity: 'Entity',
    ledger: 'Ledger',
    account: 'Account',
    dimensions: 'Complete dimensions',
    currency: 'Currency',
    postingLayer: 'Posting layer',
    start: 'Period start',
    end: 'Period end',
  };
  async function uploadContract(name) {
    for (const [side, label] of [
      'GL detail and balances',
      'Trial balance source',
    ].entries()) {
      const file = `${name}-${side ? 'tb' : 'gl'}.csv`;
      await page
        .getByLabel(label, { exact: true })
        .setInputFiles('audit/gl-tb/frozen/' + file);
      await page.getByRole('heading', { name: file, exact: true }).waitFor();
      await page
        .getByLabel(label + ': I reviewed this table:', { exact: false })
        .check();
    }
    for (const [key, label] of Object.entries(labels))
      await page.getByLabel(label, { exact: true }).fill(truth.scope[key]);
    await page
      .getByLabel(
        'I reviewed the common entity, ledger, account, complete dimensions, functional currency, posted scope, layer and period.',
        { exact: false },
      )
      .check();
    await page
      .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
      .click();
    await page.getByTestId('gl-tb-result').waitFor();
  }
  async function exportBook(name) {
    const request = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download GL/TB workpaper', exact: true })
      .click();
    await (await request).saveAs(out + '/' + name);
  }
  await uploadContract('positive');
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Consistent in the declared scope',
  );
  assert.deepEqual(
    await page
      .getByTestId('gl-tb-balances')
      .locator('tbody tr')
      .nth(2)
      .locator('td')
      .allTextContents(),
    ['300.00', '300.00', '0.00'],
  );
  await exportBook('gl-tb-direct.xlsx');
  for (const [side, label] of [
    'GL detail and balances',
    'Trial balance source',
  ].entries()) {
    const rows = (
      await readFile(
        `audit/gl-tb/frozen/positive-${side ? 'tb' : 'gl'}.csv`,
        'utf8',
      )
    )
      .trim()
      .split('\n')
      .map((line) => line.split(','));
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Native source');
    sheet.addRows(rows);
    for (const row of sheet.getRows(2, sheet.rowCount - 1)) {
      for (let c = side ? 12 : 14; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        cell.value = Number(cell.value);
        cell.numFmt = '0.00';
      }
      for (const c of side ? [10, 11] : [3, 12, 13]) {
        const cell = row.getCell(c);
        const text = cell.value;
        if (typeof text !== 'string')
          throw Error('Synthetic source date must be text');
        cell.value = new Date(text + 'T00:00:00.000Z');
        cell.numFmt = 'yyyy-mm-dd';
      }
    }
    const path = `${out}/gl-tb-native-${side ? 'tb' : 'gl'}.xlsx`;
    await writeFile(path, await book.xlsx.writeBuffer());
    await page.getByLabel(label, { exact: true }).setInputFiles(path);
    await page
      .getByRole('heading', {
        name: `gl-tb-native-${side ? 'tb' : 'gl'}.xlsx`,
        exact: true,
      })
      .waitFor();
    await page
      .getByLabel(label + ': I reviewed this table:', { exact: false })
      .check();
  }
  await page
    .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
    .click();
  await page.getByTestId('gl-tb-result').waitFor();
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Consistent in the declared scope',
  );
  await exportBook('gl-tb-native.xlsx');
  const session = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Save GL/TB session', exact: true })
    .click();
  await (await session).saveAs(out + '/gl-tb-session.json');
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'ar');
  await page
    .getByRole('button', { name: 'Customer AR reconciliation', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open synthetic AR example', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'gl-tb');
  await page
    .getByRole('button', { name: 'GL / Trial balance', exact: true })
    .click();
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Consistent in the declared scope',
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
    await page.screenshot({
      path: `${out}/gl-tb-ar-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page
    .getByRole('button', { name: 'GL / Trial balance', exact: true })
    .click();
  await page
    .getByLabel('Restore GL/TB session', { exact: true })
    .setInputFiles(out + '/gl-tb-session.json');
  await page.getByTestId('gl-tb-result').waitFor();
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Consistent in the declared scope',
  );
  await exportBook('gl-tb-native-restored.xlsx');
  await page
    .getByLabel('Complete dimensions', { exact: true })
    .fill('CostCentre=OTHER');
  assert.equal(await page.getByTestId('gl-tb-result').count(), 0);
  for (const [contract, status, name] of [
    [
      'same-net-different-turnover',
      'Separate component differences',
      'gl-tb-turnover.xlsx',
    ],
    ['zero-activity', 'Consistent in the declared scope', 'gl-tb-zero.xlsx'],
    [
      'missing-tb',
      'Required balance evidence is missing',
      'gl-tb-missing.xlsx',
    ],
    [
      'dimensions-mismatch',
      'Source errors block approval',
      'gl-tb-scope-error.xlsx',
    ],
  ]) {
    await uploadContract(contract);
    assert.equal(await page.getByTestId('gl-tb-status').innerText(), status);
    if (contract === 'same-net-different-turnover')
      assert.deepEqual(
        await page
          .getByTestId('gl-tb-balances')
          .locator('tbody tr')
          .nth(2)
          .locator('td')
          .allTextContents(),
        ['300.00', '350.00', '-50.00'],
      );
    assert.equal(
      await page
        .getByRole('button', { name: /accept|confirm correspondence/i })
        .count(),
      0,
    );
    await exportBook(name);
  }
  // Failed replacement must preserve the previously installed native source and result.
  await page
    .getByLabel('GL detail and balances', { exact: true })
    .setInputFiles({
      name: 'invalid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([0xff, 0xff]),
    });
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page
      .getByRole('heading', { name: 'dimensions-mismatch-gl.csv', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Source errors block approval',
  );
  await writeFile(
    out + '/gl-tb-browser.json',
    JSON.stringify(
      {
        synthetic: true,
        passed: true,
        sourceFiles: 'native CSV and native numeric/date XLSX',
        sampleButton: true,
        sessionReplay: true,
        preservedDomains: true,
        mobileWidths: [390, 320],
        languages: ['ar', 'en'],
        exports: [
          'gl-tb-direct.xlsx',
          'gl-tb-native.xlsx',
          'gl-tb-native-restored.xlsx',
          'gl-tb-turnover.xlsx',
          'gl-tb-zero.xlsx',
          'gl-tb-missing.xlsx',
          'gl-tb-scope-error.xlsx',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
if (process.argv[1] === resolve(import.meta.filename)) {
  const { chromium } = await import('playwright'),
    browser = await chromium.launch({
      headless: true,
      ...(process.env.MIZAN_CHROMIUM
        ? { executablePath: process.env.MIZAN_CHROMIUM }
        : {}),
    });
  try {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [],
      network = [];
    const url = process.env.GL_TB_URL ?? 'http://127.0.0.1:4173/';
    page.on('pageerror', (e) => errors.push(e.message));
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (
        (!['blob:', 'data:'].includes(u.protocol) &&
          u.origin !== new URL(url).origin) ||
        r.method() !== 'GET'
      )
        network.push(r.url());
    });
    try {
      await verifyGlTb(page, url);
    } catch (e) {
      await page.screenshot({
        path: 'work/qa/gl-tb-failure.png',
        fullPage: true,
      });
      console.error((await page.locator('body').innerText()).slice(-4000));
      throw e;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'GL/TB browser lifecycle passed; no observed external or non-GET requests.',
    );
  } finally {
    await browser.close();
  }
}
