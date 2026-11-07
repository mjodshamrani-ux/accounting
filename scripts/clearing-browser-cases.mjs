import assert from 'node:assert/strict';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { stripGap } from './alignment-strip-read.mjs';
import ExcelJS from 'exceljs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function verifyClearing(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await openDomainWorkspace(page, 'clearing');
  await page
    .getByRole('heading', { name: 'مقاصة داخل حساب واحد', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Single-account clearing', exact: true })
    .waitFor();
  const panel = page.locator('[data-domain-panel="clearing"]:visible'),
    card = panel.locator('[data-scope-card]');
  // The card «ما فهمناه من ملفاتك» (UX-5(d)), against the source's bytes read
  // with this check's own split: the account and the currency are the
  // values its mapped columns write on every row; nothing names the entity,
  // the ledger or the period.
  const source = await readFile('audit/clearing/frozen/source.csv', 'utf8');
  assert.ok(!source.includes('"'), 'the clearing source here is unquoted');
  const [head, ...body] = source
    .split(/\r?\n/u)
    .map((line) => line.split(','))
    .filter((cells) => cells.some((cell) => cell.trim()));
  const written = (name) => {
    const values = new Set(
      body.map((r) => (r[head.indexOf(name)] ?? '').trim()),
    );
    assert.equal(values.size, 1, `one ${name} on every row of the source`);
    return [...values][0];
  };
  const fileName = 'Clearing movements file';
  async function cardField(key) {
    const field = card.locator(`[data-scope-field="${key}"]`);
    return {
      origin: await field.getAttribute('data-origin'),
      value: await field.locator('input').inputValue(),
      // textContent: the fields are folded when nothing is asked.
      hint: (await field.locator('.hint').textContent()).trim(),
    };
  }
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  const confirmBox = () =>
    panel.getByLabel('I reviewed the column meanings and scope:', {
      exact: false,
    });
  const runButton = () =>
    panel.getByRole('button', { name: 'Check clearing', exact: true });
  async function fromColumns(when) {
    for (const [key, name] of [
      ['account', 'Account'],
      ['currency', 'Currency'],
    ])
      assert.deepEqual(
        Object.values(await cardField(key)),
        [
          'file',
          written(name),
          `From the file: column ${name} · ${fileName}: rows ${body.length}`,
        ],
        `${when}: the ${key} from its mapped column`,
      );
  }
  async function asked(keys, when) {
    for (const key of keys)
      assert.deepEqual(
        Object.values(await cardField(key)),
        ['question', '', 'Not in the files, so enter the value'],
        `${when}: the ${key} is asked`,
      );
  }
  async function sentence(scope, rows, when) {
    const v = (key) => scope[key] || '?';
    assert.equal(
      await card.locator('[data-scope-summary]').innerText(),
      `${v('entity')}, ${v('ledger')}, account ${v('account')}, ${v('start')} to ${v('end')}, in ${v('currency')}; ${rows} rows read from the movements file.`,
      `${when}: the sentence says the scope and the rows read`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      6,
      'each value in the sentence is isolated from the words around it',
    );
  }
  // The example: its file is the frozen source, read as the example maps it;
  // its entity, ledger and period are the example's, none from the file.
  await page
    .getByRole('button', {
      name: 'Open synthetic clearing example',
      exact: true,
    })
    .click();
  await page
    .getByRole('heading', { name: 'synthetic-clearing.csv', exact: true })
    .waitFor();
  assert.equal(
    await card.count(),
    1,
    'after the example: the file shows the card «ما فهمناه من ملفاتك»',
  );
  await fromColumns('after the example');
  const example = {
    entity: 'Synthetic Entity',
    ledger: 'Synthetic Ledger',
    start: '2026-09-01',
    end: '2026-09-30',
  };
  for (const [key, value] of Object.entries(example))
    assert.deepEqual(
      [(await cardField(key)).origin, (await cardField(key)).value],
      ['user', value],
      `after the example: the ${key} is the example's, not the file's`,
    );
  await sentence(
    { ...example, account: written('Account'), currency: written('Currency') },
    body.length,
    'after the example',
  );
  assert.equal(
    await confirmBox().isChecked(),
    true,
    'the example is confirmed',
  );
  // A new file starts the card afresh: nothing is read from a column not
  // mapped yet, though the file has one named Account; the currency is the
  // default; the box is unchecked and the check closed.
  await page
    .getByLabel(fileName, { exact: true })
    .setInputFiles('audit/clearing/frozen/source.csv');
  await page
    .getByRole('heading', { name: 'source.csv', exact: true })
    .waitFor();
  await asked(['entity', 'ledger', 'account', 'start', 'end'], 'a new file');
  assert.deepEqual(
    Object.values(await cardField('currency')),
    ['default', 'SAR', 'Default, not in the files'],
    'a new file: the currency is the default until a column writes it',
  );
  await sentence({ currency: 'SAR' }, 0, 'a new file');
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a new file is unconfirmed',
  );
  assert.equal(await runButton().isDisabled(), true, 'the check waits');
  const columns = {
    'Unique posting ID': '0',
    'Clearing reference': '1',
    'Movement date': '2',
    'Signed amount': '3',
    Description: '6',
    Account: '4',
    Currency: '5',
  };
  const select = (label) =>
    page
      .getByLabel(label, { exact: true })
      .filter({ has: page.locator('option') });
  for (const [label, value] of Object.entries(columns)) {
    if (label === 'Account')
      await asked(
        ['account'],
        'every column but the account and currency mapped',
      );
    await select(label).selectOption(value);
  }
  await fromColumns('the columns mapped');
  // The account mapped to another column whose rows differ is a question.
  await select('Account').selectOption('6');
  assert.deepEqual(
    Object.values(await cardField('account')),
    ['question', '', 'The rows disagree, so enter the value'],
    'the account mapped to a column whose rows differ is asked',
  );
  await select('Account').selectOption('4');
  await fromColumns('the mapping put back');
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a suggestion never confirms',
  );
  await openFields();
  for (const [label, value] of Object.entries({
    Entity: 'Synthetic Entity',
    Ledger: 'Synthetic Ledger',
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  }))
    await card.getByLabel(label, { exact: true }).fill(value);
  await sentence(
    { ...example, account: written('Account'), currency: written('Currency') },
    body.length,
    'the scope entered',
  );
  assert.equal(
    await runButton().isDisabled(),
    true,
    'the check waits for the box',
  );
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
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  // The grid's figures, then the account's net, which the alignment strip
  // says as its gap and the grid no longer repeats (UX-4).
  const metric = async () => [
    ...(await page
      .getByTestId('clearing-metrics')
      .locator('strong')
      .allTextContents()),
    await stripGap(page.locator('[aria-labelledby="clearing-result-title"]')),
  ];
  assert.deepEqual(await metric(), ['9', '5', '0', '10.00']);
  assert.equal(await page.getByTestId('clearing-case').count(), 5);
  await page.getByLabel('Members: P006', { exact: true }).check();
  await page.getByLabel('Members: P007', { exact: true }).check();
  await page
    .getByLabel('Review decision reason', { exact: true })
    .fill(
      'Synthetic external advice confirms these two postings offset; human decision only.',
    );
  await page
    .getByRole('button', {
      name: 'Record human clearing for selected members',
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="clearing-metrics"]')
      ?.textContent.includes('Cleared movements7'),
  );
  const save = async (button, path) => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await event).saveAs(path);
  };
  await save('Download clearing workpaper', `${out}/clearing-manual.xlsx`);
  await page
    .getByTestId('clearing-case')
    .filter({ hasText: 'P001, P002, P003' })
    .getByRole('button', { name: 'Reopen cleared group', exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="clearing-metrics"]')
      ?.textContent.includes('Cleared movements4'),
  );
  await save('Save clearing session', `${out}/clearing-session.json`);
  await save('Download clearing workpaper', `${out}/clearing-reopened.xlsx`);
  // Both domain workspaces retain their local state across navigation.
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'clearing');
  assert.deepEqual(await metric(), ['9', '4', '0', '10.00']);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('heading', { name: 'نتيجة المقاصة', exact: true })
    .waitFor();
  assert.deepEqual(await metric(), ['9', '4', '0', '10.00']);
  await page.screenshot({ path: `${out}/clearing-ar.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'mobile clearing must not overflow page',
  );
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page.screenshot({
    path: `${out}/clearing-en-mobile.png`,
    fullPage: true,
  });
  // A fresh page re-reads the saved native bytes and replays both decisions.
  await page.reload();
  await openDomainWorkspace(page, 'clearing');
  await page
    .getByLabel('Restore clearing session', { exact: true })
    .setInputFiles(`${out}/clearing-session.json`);
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  assert.deepEqual(await metric(), ['9', '4', '0', '10.00']);
  // A restored session is read with its own file and mapping, not with what
  // the page held before it: the account and the currency from their
  // columns, the session's scope confirmed.
  await fromColumns('after the session is restored');
  assert.equal(
    await confirmBox().isChecked(),
    true,
    'the restored session is confirmed',
  );
  await save('Download clearing workpaper', `${out}/clearing-restored.xlsx`);
  await openFields();
  await card.getByLabel('Ledger', { exact: true }).fill('Changed ledger');
  assert.equal(
    await page
      .getByRole('heading', { name: 'Clearing result', exact: true })
      .count(),
    0,
    'changing scope must invalidate the previous result and decisions',
  );
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'an entry drops the one confirmation',
  );
  assert.equal((await cardField('ledger')).origin, 'user');
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'confirmed again');
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  assert.deepEqual(await metric(), ['9', '5', '0', '10.00']);
  // A column the card does not read, mapped otherwise, still drops the
  // result and the one confirmation; so does the amount layout.
  await select('Description').selectOption('-1');
  assert.equal(
    await page
      .getByRole('heading', { name: 'Clearing result', exact: true })
      .count(),
    0,
    'a column change drops the result',
  );
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a column the card does not read drops the one confirmation',
  );
  await select('Description').selectOption('6');
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'confirmed again');
  // The layout select is named by its wrapping label only: found by its
  // options.
  const layout = panel
    .locator('select')
    .filter({ has: page.locator('option[value="split"]') });
  await layout.selectOption('split');
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'the amount layout drops the one confirmation',
  );
  await layout.selectOption('signed');
  await select('Signed amount').selectOption('3');
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'confirmed again');
  const bad =
    (await readFile('audit/clearing/frozen/source.csv', 'utf8')) +
    'P010,C001,2026-09-08,unread,2150,SAR,Unread competitor\n';
  await writeFile(`${out}/clearing-bad.csv`, bad);
  await page
    .getByLabel('Clearing movements file', { exact: true })
    .setInputFiles(`${out}/clearing-bad.csv`);
  await page
    .getByRole('heading', { name: 'clearing-bad.csv', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('heading', { name: 'Clearing result', exact: true })
      .count(),
    0,
    'replacement must not retain old result',
  );
  await asked(
    ['entity', 'ledger', 'account', 'start', 'end'],
    'a replaced file',
  );
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a replaced file drops the one confirmation',
  );
  // A sheet or header row change drops the one confirmation by itself:
  // no value the card holds here comes from a column, so none changes with
  // the reading.
  const sheets = new ExcelJS.Workbook();
  sheets.addWorksheet('Movements').addRows([head, ...body]);
  sheets.addWorksheet('Notes').addRows([['Note'], ['Synthetic note']]);
  await writeFile(
    `${out}/clearing-sheets.xlsx`,
    new Uint8Array(await sheets.xlsx.writeBuffer()),
  );
  await page
    .getByLabel(fileName, { exact: true })
    .setInputFiles(`${out}/clearing-sheets.xlsx`);
  await page
    .getByRole('heading', { name: 'clearing-sheets.xlsx', exact: true })
    .waitFor();
  // The account and currency columns are left unmapped here, so the
  // account is the accountant's and the currency the default.
  for (const [label, value] of Object.entries(columns))
    if (label !== 'Account' && label !== 'Currency')
      await select(label).selectOption(value);
  await openFields();
  const entered = {
    Entity: 'Synthetic Entity',
    Ledger: 'Synthetic Ledger',
    Account: written('Account'),
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  };
  for (const [label, value] of Object.entries(entered))
    await card.getByLabel(label, { exact: true }).fill(value);
  assert.deepEqual(
    [(await cardField('account')).origin, (await cardField('currency')).origin],
    ['user', 'default'],
    'the account entered, the currency the default',
  );
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'every field given');
  // Like the layout, the sheet select's label holds its options' text:
  // found by its options.
  await panel
    .locator('select')
    .filter({ has: page.locator('option', { hasText: /^Notes$/u }) })
    .selectOption({ label: 'Notes' });
  assert.deepEqual(
    [(await cardField('account')).origin, (await cardField('account')).value],
    ['user', written('Account')],
    'a sheet change keeps what was entered',
  );
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a sheet change drops the one confirmation',
  );
  await confirmBox().click();
  assert.equal(await confirmBox().isChecked(), true, 'confirmed again');
  await panel.getByLabel('Header row', { exact: true }).fill('2');
  assert.equal(
    await confirmBox().isChecked(),
    false,
    'a header row change drops the one confirmation',
  );
  await writeFile(
    `${out}/clearing-browser.json`,
    JSON.stringify(
      {
        passed: true,
        sample: 'synthetic-development-not-field',
        checks: [
          'scope card: the example, a new file, columns mapped, unmapped and mis-mapped',
          'native CSV upload and explicit mapping',
          'positive complete groups',
          'amount-only stays review',
          'human decision',
          'reopen',
          'domain navigation retains state',
          'AR/EN and mobile',
          'native session replay',
          'scope invalidation',
          'file replacement',
          'sheet and header row changes',
        ],
        files: [
          'clearing-manual.xlsx',
          'clearing-reopened.xlsx',
          'clearing-restored.xlsx',
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
    const page = await context.newPage();
    const errors = [],
      network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    context.on('request', (request) => {
      if (
        (!/^(blob:|data:)/.test(request.url()) &&
          !request
            .url()
            .startsWith(process.env.CLEARING_URL ?? 'http://127.0.0.1:4173')) ||
        request.method() !== 'GET'
      )
        network.push(request.url());
    });
    try {
      await verifyClearing(
        page,
        process.env.CLEARING_URL ?? 'http://127.0.0.1:4173/mizan-test/',
      );
    } catch (error) {
      await page.screenshot({
        path: 'work/qa/clearing-failure.png',
        fullPage: true,
      });
      console.error((await page.locator('body').innerText()).slice(-6000));
      throw error;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'Clearing browser lifecycle passed; no observed external or non-GET requests.',
    );
  } finally {
    await browser.close();
  }
}
