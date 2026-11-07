import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { stripCount, stripTotals } from './alignment-strip-read.mjs';

// The AR result's figures, read where each is said: the rows read and the
// reading errors in the figure grid; the matched documents and each record's
// total in the alignment strip, which the grid no longer repeats (UX-4).
async function arFigures(page) {
  const w = page.locator('[data-ar-workspace]');
  const [valid, errors] = await w
    .getByTestId('ar-metrics')
    .locator('strong')
    .allTextContents();
  return [
    valid,
    await stripCount(w, 'agreed'),
    errors,
    ...(await stripTotals(w)),
  ];
}
export async function verifyAr(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await openDomainWorkspace(page, 'ar');
  await page
    .getByRole('heading', { name: 'مستندات ذمم العملاء', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open synthetic AR example', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(await arFigures(page), ['6', '3', '0', '35.00', '35.00']);
  const sides = ['Company AR ledger', 'Company-issued customer statement'];
  const columns = {
    'Unique posting ID': '0',
    'Document type': '1',
    'Own document number': '2',
    'Posting date': '3',
    'Original signed amount': '4',
    Entity: '5',
    Ledger: '6',
    'Customer ID': '7',
    Account: '8',
    Currency: '9',
    'Related invoice': '10',
    Description: '11',
  };
  const w = page.locator('[data-ar-workspace]'),
    card = w.locator('[data-scope-card]');
  // The card's one confirmation (UX-5(d)) carries the two reading
  // attestations, the printed statement's and the scope attestation.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the company AR ledger and the company-issued customer statement',
      { exact: false },
    );
  const runButton = () =>
    page.getByRole('button', { name: 'Compare AR documents', exact: true });
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, at the columns this check maps: the card reads
  // a field from the column mapped to it, and the base header is the scope
  // key the family names it by.
  const mappedAs = {
    entity: 'Entity',
    ledger: 'Ledger',
    customer: 'Customer ID',
    account: 'Account',
    currency: 'Currency',
  };
  const baseHeader = {
    entity: 'Entity',
    ledger: 'Ledger',
    customer: 'Customer',
    account: 'Account',
    currency: 'Currency',
  };
  const frozen = (name) => [
    `audit/ar-limited/frozen/${name}-ledger.csv`,
    `audit/ar-limited/frozen/${name}-statement.csv`,
  ];
  // mapped[side] false: that side's columns are not mapped, so not read.
  async function filesSay(paths, mapped = [true, true]) {
    const said = {};
    for (const [key, select] of Object.entries(mappedAs)) {
      const counts = new Map(),
        read = [];
      let rows = 0;
      for (const [side, label] of sides.entries()) {
        if (!mapped[side]) continue;
        const text = await readFile(paths[side], 'utf8');
        assert.ok(!text.includes('"'), 'the AR sources here are unquoted');
        const [head, ...body] = text
          .split(/\r?\n/u)
          .map((line) => line.split(','))
          .filter((cells) => cells.some((cell) => cell.trim()));
        const at = Number(columns[select]),
          own = head[at].trim();
        read.push(
          own === baseHeader[key]
            ? `${label}: rows ${body.length}`
            : `${label} (column ${own}): rows ${body.length}`,
        );
        for (const row of body) {
          rows += 1;
          const value = (row[at] ?? '').trim(),
            bySource = counts.get(value) ?? new Map();
          bySource.set(label, (bySource.get(label) ?? 0) + 1);
          counts.set(value, bySource);
        }
      }
      said[key] = { rows, read, counts };
    }
    return said;
  }
  async function cardField(key) {
    const field = card.locator(`[data-scope-field="${key}"]`);
    return {
      origin: await field.getAttribute('data-origin'),
      value: await field.locator('input, select').inputValue(),
      // textContent: the fields are folded when nothing is asked.
      hint: (await field.locator('.hint').textContent()).trim(),
    };
  }
  async function cardSaysFiles(paths, when, mapped = [true, true]) {
    assert.equal(
      await card.count(),
      1,
      `${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(paths, mapped);
    for (const [key, { read, counts }] of Object.entries(said)) {
      assert.equal(counts.size, 1, `${when}: one ${key} in the mapped columns`);
      const [value] = counts.keys(),
        shown = await cardField(key);
      assert.equal(shown.value, value, `${when}: ${key} from the files`);
      assert.equal(shown.origin, 'file', `${when}: ${key} as theirs`);
      assert.equal(
        shown.hint,
        `From the file: column ${baseHeader[key]} · ${read.join(' · ')}`,
        `${when}: ${key} names its column and each mapped file's rows`,
      );
    }
    const one = (key) => said[key].counts.keys().next().value,
      period = async (key) => (await cardField(key)).value || '?';
    const rowsOn = (side) => {
      if (!mapped[side]) return 0;
      const entry = said.entity.read.find((r) => r.startsWith(sides[side]));
      return Number(/rows (\d+)$/u.exec(entry)[1]);
    };
    assert.equal(
      await card.locator('[data-scope-summary]').innerText(),
      `${one('entity')}, ${one('ledger')}, customer ${one('customer')}, account ${one('account')}, ${await period('start')} to ${await period('end')}, in ${one('currency')}; read from ${sides[0]}: rows ${rowsOn(0)} and ${sides[1]}: rows ${rowsOn(1)}.`,
      `${when}: the sentence says the files' scope and each side's rows`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      7,
      'each value in the sentence is isolated from the words around it',
    );
    return said;
  }
  // The example's two files are the frozen positive pair, so the card shows
  // every mapped value as theirs, and the period the example states; the
  // example confirmed.
  await cardSaysFiles(frozen('positive'), 'after the example');
  assert.equal((await cardField('start')).value, '2026-09-01');
  assert.equal((await cardField('end')).value, '2026-09-30');
  assert.equal(await confirmBox().isChecked(), true);
  for (const [side, label] of sides.entries()) {
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles(
        `audit/ar-limited/frozen/positive-${side === 0 ? 'ledger' : 'statement'}.csv`,
      );
    await page
      .getByRole('heading', {
        name: `positive-${side === 0 ? 'ledger' : 'statement'}.csv`,
        exact: true,
      })
      .waitFor();
    // Before its columns are mapped, a side writes nothing to the card.
    if (side === 0) {
      const unmapped = await cardField('entity');
      const [statementOnly] = (
        await filesSay(frozen('positive'), [false, true])
      ).entity.read;
      assert.equal(
        unmapped.hint,
        `From the file: column Entity · ${statementOnly}`,
        'an unmapped side is not read, even where its header names the field',
      );
      // The sentence counts each side's own rows: none from the side not
      // mapped yet, while the other side's rows stay its own.
      await cardSaysFiles(frozen('positive'), 'one side not mapped yet', [
        false,
        true,
      ]);
    }
    for (const [field, index] of Object.entries(columns))
      await page
        .getByLabel(`${label}: ${field}`, { exact: true })
        .selectOption(index);
  }
  // UX-5(d): the mapped columns fill the card; the period the accountant
  // kept from the example stays theirs, nothing is confirmed, and the check
  // stays closed until the accountant confirms with the one box.
  await cardSaysFiles(frozen('positive'), 'two new files, mapped');
  assert.equal((await cardField('start')).origin, 'user');
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a suggestion never confirms',
  );
  assert.equal(
    await runButton().isDisabled(),
    true,
    "the check waits for the accountant's confirmation",
  );
  // A field no mapped column writes takes its default, marked as one: the
  // currency, when neither side maps it.
  for (const label of sides)
    await page
      .getByLabel(`${label}: Currency`, { exact: true })
      .selectOption('-1');
  const currency = await cardField('currency');
  assert.deepEqual(
    [currency.value, currency.origin, currency.hint],
    ['SAR', 'default', 'Default, not in the files'],
    'no file writes the currency: SAR, marked as the default',
  );
  for (const label of sides)
    await page
      .getByLabel(`${label}: Currency`, { exact: true })
      .selectOption(columns.Currency);
  // A column mapped to another field's column makes that field a question
  // with both values, before any run.
  await page
    .getByLabel(`${sides[1]}: Customer ID`, { exact: true })
    .selectOption(columns.Account);
  const customer = await cardField('customer');
  assert.equal(customer.origin, 'question');
  assert.equal(customer.value, '', 'a disagreement is never filled');
  assert.equal(customer.hint, 'The rows disagree, so enter the value');
  await page
    .getByLabel(`${sides[1]}: Customer ID`, { exact: true })
    .selectOption(columns['Customer ID']);
  await cardSaysFiles(frozen('positive'), 'the mapping put back');
  for (const [key, value] of Object.entries({
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  })) {
    await openFields();
    await page.getByLabel(key, { exact: true }).fill(value);
  }
  await confirmBox().click();
  assert.equal(
    await confirmBox().isChecked(),
    true,
    'the one box takes the click',
  );
  assert.equal(
    await runButton().isEnabled(),
    true,
    'the one box opens the check',
  );
  await runButton().click();
  await page
    .getByRole('heading', {
      name: 'AR document comparison result',
      exact: true,
    })
    .waitFor();
  const metrics = () => arFigures(page);
  assert.deepEqual(await metrics(), ['6', '3', '0', '35.00', '35.00']);
  async function exportBook(name) {
    const request = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download AR workpaper', exact: true })
      .click();
    await (await request).saveAs(`${out}/${name}`);
  }
  await exportBook('ar-direct.xlsx');
  await page
    .getByLabel('Document review reason', { exact: true })
    .fill('Synthetic original document correspondence reopened for review');
  await page
    .getByTestId('ar-case')
    .filter({
      has: page.getByRole('heading', { name: 'Invoice: I001', exact: true }),
    })
    .getByRole('button', { name: 'Reopen document pair', exact: true })
    .click();
  // The reopened pair says so in its own case; the alignment strip above the
  // cases (UX-4) names the same reason as the main one of what waits.
  await page
    .getByTestId('ar-case')
    .filter({
      has: page.getByRole('heading', { name: 'Invoice: I001', exact: true }),
    })
    .getByText('Approval cancelled; document pair remains for review', {
      exact: false,
    })
    .waitFor();
  assert.deepEqual(await metrics(), ['6', '2', '0', '35.00', '35.00']);
  await exportBook('ar-reopened.xlsx');
  const sessionRequest = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Save AR session', exact: true })
    .click();
  await (await sessionRequest).saveAs(`${out}/ar-session.json`);
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'clearing');
  await page
    .getByRole('button', {
      name: 'Open synthetic clearing example',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page.getByTestId('clearing-metrics').waitFor();
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'ar');
  assert.deepEqual(await metrics(), ['6', '2', '0', '35.00', '35.00']);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('heading', {
      name: 'نتيجة مقارنة مستندات ذمم العملاء',
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${out}/ar-ar.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({ path: `${out}/ar-en-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.goto(url);
  await openDomainWorkspace(page, 'ar');
  await page
    .getByLabel('Restore AR session', { exact: true })
    .setInputFiles(`${out}/ar-session.json`);
  await page
    .getByRole('heading', {
      name: 'AR document comparison result',
      exact: true,
    })
    .waitFor();
  assert.deepEqual(await metrics(), ['6', '2', '0', '35.00', '35.00']);
  await exportBook('ar-restored.xlsx');
  await page
    .getByLabel('Document review reason', { exact: true })
    .fill('Synthetic sources rechecked; confirm exact document counterpart');
  await page
    .getByRole('button', { name: 'Record human confirmation', exact: true })
    .click();
  await page
    .getByText('Human confirmation · Exact correspondence', { exact: false })
    .waitFor();
  assert.deepEqual(await metrics(), ['6', '3', '0', '35.00', '35.00']);
  await exportBook('ar-reconfirmed.xlsx');
  await openFields();
  await page.getByLabel('Customer ID', { exact: true }).fill('OTHER');
  assert.equal(await page.getByTestId('ar-metrics').count(), 0);
  assert.equal(await confirmBox().isChecked(), false);
  assert.equal((await cardField('customer')).origin, 'user');
  await page.getByLabel('Customer ID', { exact: true }).fill('C0001');
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'confirmed again');
  await page
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(await metrics(), ['6', '3', '0', '35.00', '35.00']);
  // Native file replacement invalidates results and the corresponding reading approval.
  await page.getByLabel(sides[0], { exact: true }).setInputFiles({
    name: 'replacement.csv',
    mimeType: 'text/csv',
    buffer: await readFile('audit/ar-limited/frozen/positive-ledger.csv'),
  });
  await page
    .getByRole('heading', { name: 'replacement.csv', exact: true })
    .waitFor();
  assert.equal(await page.getByTestId('ar-metrics').count(), 0);
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a new original drops the one confirmation',
  );
  // An original amount difference remains review-only through the visible workflow.
  for (const [side, label] of sides.entries()) {
    const name = `amount-difference-${side === 0 ? 'ledger' : 'statement'}.csv`;
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles(`audit/ar-limited/frozen/${name}`);
    await page.getByRole('heading', { name, exact: true }).waitFor();
    for (const [field, index] of Object.entries(columns))
      await page
        .getByLabel(`${label}: ${field}`, { exact: true })
        .selectOption(index);
  }
  assert.equal(await confirmBox().isChecked(), false);
  await confirmBox().click();
  assert.equal(
    await confirmBox().isChecked(),
    true,
    'the difference pair confirmed',
  );
  await page
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(await metrics(), ['2', '0', '0', '90.00', '91.00']);
  assert.equal(
    await page
      .getByRole('button', { name: 'Record human confirmation', exact: true })
      .count(),
    0,
  );
  await exportBook('ar-negative.xlsx');
  // A period in another layout never fills a date field: on a fresh page, a
  // scope-details pair whose blocks write the period as DD/MM/YYYY, rewritten
  // here by key row from a frozen pair.
  const pairDir = 'audit/ar-scope-details/fixtures/three-document-kinds';
  const layout = [];
  for (const [side, name] of ['ledger.csv', 'statement.csv'].entries()) {
    const text = await readFile(`${pairDir}/${name}`, 'utf8');
    layout.push(`${out}/ddmm-${name}`);
    await writeFile(
      layout[side],
      text
        .split(/\r?\n/u)
        .map((line) =>
          /^Period (start|end),/u.test(line)
            ? line.replace(/,(\d{4})-(\d{2})-(\d{2})$/u, ',$3/$2/$1')
            : line,
        )
        .join('\n'),
    );
  }
  await page.reload();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'ar');
  for (const [side, label] of sides.entries()) {
    await page.getByLabel(label, { exact: true }).setInputFiles(layout[side]);
    await page
      .getByRole('heading', {
        name: layout[side].split('/').at(-1),
        exact: true,
      })
      .waitFor();
    await page
      .getByLabel(`${label}: Source structure`, { exact: true })
      .selectOption('ar-scope-details-1');
  }
  const start = await cardField('start');
  assert.equal(start.origin, 'question');
  assert.equal(start.value, '', 'another layout is never put in a date field');
  assert.equal(
    start.hint,
    'The files hold “01/10/2026”, which this field does not take, so enter the value',
  );
  // The block's other keys are read as written, and said as its block.
  const entity = await cardField('entity');
  assert.equal(entity.origin, 'file');
  assert.equal(
    entity.hint,
    `From the file: column Entity · ${sides[0]}: scope block · ${sides[1]}: scope block`,
  );
  await writeFile(
    `${out}/ar-browser.json`,
    JSON.stringify(
      {
        passed: true,
        sample: 'synthetic-development-not-field',
        checks: [
          'native two-file upload and mapping',
          'own-document positive pairs',
          'reopen and human reconfirmation',
          'AP/clearing/AR navigation retains state',
          'Arabic/English/mobile',
          'session original byte replay',
          'scope and replacement invalidation',
          'the card reads the mapped columns, not unmapped ones',
          'a scope block is read once; a period in another layout is asked',
          'native amount difference stays review-only',
        ],
        files: [
          'ar-direct.xlsx',
          'ar-reopened.xlsx',
          'ar-restored.xlsx',
          'ar-reconfirmed.xlsx',
          'ar-negative.xlsx',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
if (process.argv[1] === resolve(import.meta.filename)) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [],
      network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (
        (!['blob:', 'data:'].includes(u.protocol) &&
          u.origin !==
            new URL(process.env.AR_URL ?? 'http://127.0.0.1:4173').origin) ||
        r.method() !== 'GET'
      )
        network.push(r.url());
    });
    try {
      await verifyAr(page, process.env.AR_URL ?? 'http://127.0.0.1:4173/');
    } catch (e) {
      await page.screenshot({ path: 'work/qa/ar-failure.png', fullPage: true });
      console.error((await page.locator('body').innerText()).slice(-3500));
      throw e;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'AR browser lifecycle passed; no observed external or non-GET requests.',
    );
  } finally {
    await browser.close();
  }
}
