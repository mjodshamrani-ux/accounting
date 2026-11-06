import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
export async function verifyGlTb(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await openDomainWorkspace(page, 'gl-tb');
  await page
    .getByRole('heading', { name: 'اتساق الأستاذ وميزان المراجعة', exact: true })
    .waitFor();
  await page
    .getByRole('button', {
      name: 'افتح مثالًا اصطناعيًا للأستاذ والميزان',
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
  // The card's one confirmation (UX-5(d)) carries both source attestations
  // and the scope attestation; its label names the scope it confirms.
  const confirmLabel =
    'I reviewed the GL detail and balances and the trial balance source';
  const sideNames = ['GL detail and balances', 'Trial balance source'];
  async function uploadPair(name) {
    for (const [side, label] of sideNames.entries()) {
      const file = `${name}-${side ? 'tb' : 'gl'}.csv`;
      await page
        .getByLabel(label, { exact: true })
        .setInputFiles('audit/gl-tb/frozen/' + file);
      await page.getByRole('heading', { name: file, exact: true }).waitFor();
    }
    // The card fills after the file is shown; wait for that paint to pass.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
  // The fields fold under the card's sentence when nothing is asked; an
  // accountant opens them to change one.
  async function openFields() {
    const fields = page.locator('[data-scope-card] details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  async function uploadContract(name, fill = true) {
    await uploadPair(name);
    if (fill) await openFields();
    if (fill)
      for (const [key, label] of Object.entries(labels)) {
        assert.equal(
          await page.locator('[data-scope-card] details').getAttribute('open'),
          '',
          `${key}: the fields stay open while the scope is typed`,
        );
        await page.getByLabel(label, { exact: true }).fill(truth.scope[key]);
      }
    await page.getByLabel(confirmLabel, { exact: false }).check();
    await page
      .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
      .click();
    await page.getByTestId('gl-tb-result').waitFor();
    // The run puts the files back on the screen; what was typed stays.
    if (fill)
      for (const [key, label] of Object.entries(labels))
        assert.equal(
          await page.getByLabel(label, { exact: true }).inputValue(),
          truth.scope[key],
          `${key}: the typed scope is kept after the run`,
        );
  }
  async function exportBook(name) {
    const request = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download GL/TB workpaper', exact: true })
      .click();
    await (await request).saveAs(out + '/' + name);
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader: every non-blank data row of
  // both files, the ten scope columns by header.
  const scopeHeaders = {
    entity: 'Entity',
    ledger: 'Ledger',
    account: 'Account',
    dimensions: 'Complete dimensions',
    currency: 'Currency',
    currencyBasis: 'Currency basis',
    postingStatus: 'Posting status',
    postingLayer: 'Posting layer',
    start: 'Period start',
    end: 'Period end',
  };
  async function filesSay(name) {
    const tables = [];
    for (const [side, label] of sideNames.entries()) {
      const text = await readFile(
        `audit/gl-tb/frozen/${name}-${side ? 'tb' : 'gl'}.csv`,
        'utf8',
      );
      assert.ok(!text.includes('"'), 'the frozen GL/TB sources are unquoted');
      const [head, ...rows] = text
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => line.split(','));
      tables.push({ label, head, rows });
    }
    return Object.fromEntries(
      Object.entries(scopeHeaders).map(([key, header]) => {
        const counts = new Map(),
          read = [];
        let rows = 0;
        for (const { label, head, rows: body } of tables) {
          const at = head.indexOf(header);
          assert.ok(at >= 0, `${header} is a column of ${label}`);
          read.push(`${label}: rows ${body.length}`);
          for (const row of body) {
            rows += 1;
            const value = (row[at] ?? '').trim(),
              bySide = counts.get(value) ?? new Map();
            bySide.set(label, (bySide.get(label) ?? 0) + 1);
            counts.set(value, bySide);
          }
        }
        return [key, { header, rows, read, counts }];
      }),
    );
  }
  async function cardField(key) {
    const field = page.locator(`[data-scope-field="${key}"]`);
    return {
      origin: await field.getAttribute('data-origin'),
      value: await field.locator('input, select').inputValue(),
      // textContent: the fields are folded when nothing is asked.
      hint: (await field.locator('.hint').textContent()).trim(),
      values: (await field.locator('li').allTextContents()).map((t) =>
        t.trim(),
      ),
    };
  }
  // After the example, the two files alone fill the card; nothing is
  // confirmed until the accountant confirms, and the run stays closed.
  await uploadPair('positive');
  assert.equal(
    await page.locator('[data-scope-card]').count(),
    1,
    'the two files show the card «ما فهمناه من ملفاتك»',
  );
  const positive = await filesSay('positive');
  for (const [key, said] of Object.entries(positive)) {
    assert.equal(said.counts.size, 1, `${key}: one value in the positive pair`);
    const [value] = said.counts.keys(),
      shown = await cardField(key);
    assert.equal(shown.value, value, `${key}: the card holds the files' value`);
    assert.equal(shown.origin, 'file', `${key}: shown as from the file`);
    assert.equal(
      shown.hint,
      `From the file: column ${said.header} · ${said.read.join(' · ')}`,
      `${key}: the card names the column and, for each file, the rows it read`,
    );
  }
  const card = page.locator('[data-scope-card]');
  assert.equal(
    await card.locator('[data-scope-summary]').innerText(),
    `${positive.entity.counts.keys().next().value}, account ${positive.account.counts.keys().next().value}, ${positive.start.counts.keys().next().value} to ${positive.end.counts.keys().next().value}, in ${positive.currency.counts.keys().next().value}; ${positive.entity.rows} rows read from the two files.`,
  );
  assert.equal(
    await card.locator('[data-scope-summary] bdi').count(),
    5,
    'each value in the sentence is isolated from the words around it',
  );
  assert.equal(
    await card.locator('details').getAttribute('open'),
    null,
    'with nothing to ask, the fields stay folded',
  );
  assert.equal(
    await page.getByLabel(confirmLabel, { exact: false }).isChecked(),
    false,
    'a suggestion never confirms',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
      .isDisabled(),
    true,
  );
  await uploadContract('positive', false);
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
  }
  await page.getByLabel(confirmLabel, { exact: false }).check();
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
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'ar');
  await page
    .getByRole('button', { name: 'Open synthetic AR example', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'gl-tb');
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
  await openDomainWorkspace(page, 'gl-tb');
  await page
    .getByLabel('Restore GL/TB session', { exact: true })
    .setInputFiles(out + '/gl-tb-session.json');
  await page.getByTestId('gl-tb-result').waitFor();
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    'Consistent in the declared scope',
  );
  await exportBook('gl-tb-native-restored.xlsx');
  await openFields();
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
  // Rows that disagree leave the field a question: emptied, its fields open,
  // each value shown with its source and count, and no majority wins. A file
  // replaced after the confirmation drops it, and keeps what was typed.
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'gl-tb');
  await uploadPair('dimensions-mismatch');
  const mismatch = await filesSay('dimensions-mismatch');
  for (const [key, said] of Object.entries(mismatch)) {
    const shown = await cardField(key);
    if (said.counts.size === 1) {
      assert.equal(shown.origin, 'file', `${key}: agreed, so from the file`);
      continue;
    }
    assert.equal(key, 'dimensions', 'only the dimensions disagree');
    assert.equal(shown.origin, 'question');
    assert.equal(shown.value, '', 'a disagreement is never filled');
    assert.equal(shown.hint, 'The rows disagree, so enter the value');
    assert.deepEqual(
      shown.values,
      [...said.counts].flatMap(([value, bySide]) =>
        [...bySide].map(([side, n]) => `“${value}” in ${side}: ${n}`),
      ),
    );
  }
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(
    await page.getByLabel(confirmLabel, { exact: false }).isChecked(),
    false,
    'a suggestion never confirms',
  );
  // A value neither file holds, so writing over it would show.
  const typed = 'CostCentre=CC03|Department=D01';
  await page.getByLabel('Complete dimensions', { exact: true }).fill(typed);
  assert.equal((await cardField('dimensions')).origin, 'user');
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await page.getByLabel(confirmLabel, { exact: false }).check();
  assert.equal(
    await page
      .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
      .isEnabled(),
    true,
  );
  await page
    .getByLabel('Trial balance source', { exact: true })
    .setInputFiles('audit/gl-tb/frozen/positive-tb.csv');
  await page
    .getByRole('heading', { name: 'positive-tb.csv', exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel(confirmLabel, { exact: false }).isChecked(),
    false,
    'a replaced file drops the confirmation',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.getByLabel('Complete dimensions', { exact: true }).inputValue(),
    typed,
    'what the accountant typed is kept',
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
