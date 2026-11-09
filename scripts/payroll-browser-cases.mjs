import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { payrollSheetSaysScreen } from './reconciliation-sheet-browser.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyPayroll(page, url, out = 'work/payroll/browser') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'payroll');
  const w = page.locator('[data-payroll-workspace]'),
    status = w.locator('[data-payroll-status]'),
    button = (name) => w.getByRole('button', { name, exact: true });
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-payroll-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  // UX-6(c): each workpaper opens on the reconciliation sheet, in the
  // interface's language, and it says what this page shows.
  const sheets = [];
  const download = async (name, file, lang = 'en') => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
    if (file.endsWith('.xlsx'))
      sheets.push({
        file,
        ...(await payrollSheetSaysScreen(page, {
          file: `${out}/${file}`,
          lang,
        })),
      });
  };
  const sample = async () => {
    await button('Open a synthetic payroll example').click();
    await status.waitFor();
    await wait();
  };
  const attestation = () =>
    w.getByLabel(
      'I reviewed every supplied employee, all seven component mappings and policy evidence, every GL entry including zero components, and the independent bank payout.',
      { exact: true },
    );
  const reference = () =>
      w.getByLabel('Payroll decision reference', { exact: true }),
    note = () => w.getByLabel('Payroll decision explanation', { exact: true });
  const roles = [
    'Posted employee payroll register',
    'Proposed employee component / GL mapping',
    'Independent supplied payroll policy evidence',
    'Selected posted payroll and disbursement GL entries',
    'Independent posted bank payout',
  ];
  const card = w.locator('[data-scope-card]');
  // The card's one confirmation (UX-5(d)) carries the five source
  // attestations and the scope attestation; its label names the five roles.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the posted employee payroll register, the proposed employee component / GL mapping, the independent supplied payroll policy evidence, the selected posted payroll and disbursement GL entries and the independent posted bank payout',
      { exact: false },
    );
  const runButton = () => button('Check payroll components / GL / bank');
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // A new original drops the one confirmation; a click gives it again.
  async function reconfirm() {
    assert.equal(
      await confirmBox().isChecked(),
      false,
      'a new original drops the confirmation',
    );
    assert.equal(await runButton().isEnabled(), false);
    await confirmBox().click();
    assert.equal(
      await confirmBox().isChecked(),
      true,
      'the one box takes the confirmation',
    );
    assert.equal(
      await runButton().isEnabled(),
      true,
      'the one box opens the check',
    );
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader. The field keys and the
  // scope headers come from the family's independent reference
  // (audit/payroll/reference.py), and every case's expected scope from its
  // expected.json.
  const cases = 'audit/payroll/cases';
  const referenceText = await readFile('audit/payroll/reference.py', 'utf8');
  const listOf = (name) =>
    JSON.parse(
      new RegExp(`^${name} = (\\[[^\\]]*\\])`, 'mu')
        .exec(referenceText)[1]
        .replaceAll("'", '"'),
    );
  const keys = listOf('FIELDS'),
    headers = listOf('SCOPE_HEADERS');
  assert.equal(keys.length, 19, 'nineteen scope fields');
  assert.equal(headers.length, keys.length, 'one header per field');
  const scopeHeaders = Object.fromEntries(keys.map((k, i) => [k, headers[i]]));
  const set = (name) =>
    roles.map((_, source) => `${cases}/${name}/source-${source}.csv`);
  async function filesSay(paths) {
    const tables = [];
    for (const [source, label] of roles.entries()) {
      const text = await readFile(paths[source], 'utf8');
      assert.ok(!text.includes('"'), 'the payroll sources here are unquoted');
      const [head, ...body] = text
        .split(/\r?\n/u)
        .map((line) => line.split(','))
        .filter((cells) => cells.some((cell) => cell.trim()));
      tables.push({ label, head, body });
    }
    return Object.fromEntries(
      Object.entries(scopeHeaders).map(([key, header]) => {
        const counts = new Map(),
          read = [];
        let rows = 0;
        for (const { label, head, body } of tables) {
          const at = head.indexOf(header);
          if (at < 0) continue;
          read.push(`${label}: rows ${body.length}`);
          for (const row of body) {
            rows += 1;
            const value = (row[at] ?? '').trim(),
              bySource = counts.get(value) ?? new Map();
            bySource.set(label, (bySource.get(label) ?? 0) + 1);
            counts.set(value, bySource);
          }
        }
        return [key, { header, rows, read, counts }];
      }),
    );
  }
  const listed = (counts) =>
    [...counts].flatMap(([value, bySource]) =>
      [...bySource].map(
        ([source, n]) => `“${value || 'empty'}” in ${source}: ${n}`,
      ),
    );
  async function cardField(key) {
    const field = card.locator(`[data-scope-field="${key}"]`);
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
  async function cardSaysFiles(paths, when, expected) {
    assert.equal(
      await card.count(),
      1,
      `${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(paths);
    for (const [key, { header, read, counts }] of Object.entries(said)) {
      assert.equal(counts.size, 1, `${when}: one ${key} in the five files`);
      const [value] = counts.keys(),
        shown = await cardField(key);
      if (expected)
        assert.equal(value, expected[key], `${when}: ${key} as the oracle says`);
      assert.equal(shown.value, value, `${when}: ${key} from the files`);
      assert.equal(shown.origin, 'file', `${when}: ${key} as theirs`);
      assert.equal(
        shown.hint,
        `From the file: column ${header} · ${read.join(' · ')}`,
        `${when}: ${key} names its column and each file's rows`,
      );
    }
    const one = (key) => said[key].counts.keys().next().value;
    assert.equal(
      await card.locator('[data-scope-summary]').innerText(),
      `Payroll run ${one('payrollRun')} for ${one('entity')}, ${one('payrollLedger')} against ${one('glLedger')}, ${one('periodStart')} to ${one('periodEnd')}, paid ${one('paymentDate')}, in ${one('currency')}; ${said.currency.rows} rows read from the five files.`,
      `${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      8,
      'each value in the sentence is isolated from the words around it',
    );
  }
  const oracleScope = async (name) =>
    JSON.parse(await readFile(`${cases}/${name}/expected.json`, 'utf8')).scope;
  async function load(paths) {
    for (const [source, label] of roles.entries()) {
      await w.getByLabel(label, { exact: true }).setInputFiles(paths[source]);
      await wait();
      await w
        .getByText(paths[source].split('/').at(-1), { exact: true })
        .first()
        .waitFor();
    }
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
  // Rewrites the five originals of a case by column, as a writer would.
  async function variant(name, edit) {
    const paths = [];
    for (const [source, from] of set(name).entries()) {
      const [head, ...body] = (await readFile(from, 'utf8'))
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => line.split(','));
      edit(source, head, body);
      paths.push(`${out}/${name}-variant-${source}.csv`);
      await writeFile(
        paths[source],
        [head, ...body].map((row) => row.join(',')).join('\n') + '\n',
      );
    }
    return paths;
  }
  await sample();
  assert.equal(await status.innerText(), 'Whole payroll review required');
  // The example's five files hold its scope, so the card shows every value
  // as theirs; the example confirmed.
  await cardSaysFiles(
    set('seven-components-and-bank-positive'),
    'after the example',
    await oracleScope('seven-components-and-bank-positive'),
  );
  assert.equal(await confirmBox().isChecked(), true);
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-pending.xlsx');
  await reference().fill('SYN-REVIEW');
  await note().fill('Synthetic whole payroll component scope');
  await button('Approve whole payroll scope').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export payroll evidence', 'ui-accepted.xlsx');
  await download('Save payroll session', 'ui-session.json');
  const session = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].memberIds.length, 38);
  assert.equal(session.files.length, 5);
  assert.ok(session.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo payroll decision').click();
  await wait();
  assert.equal(await status.innerText(), 'Whole payroll review required');
  await download('Export payroll evidence', 'ui-undo.xlsx');
  await button('Reject whole payroll scope').click();
  await wait();
  await download('Export payroll evidence', 'ui-reject.xlsx');
  // The same result in Arabic: the language changes, the review stays.
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await download('صدّر أدلة الرواتب', 'ui-reject-ar.xlsx', 'ar');
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.equal(await status.innerText(), 'Whole payroll review required');
  await w
    .getByLabel('Restore payroll session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export payroll evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...session,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore payroll session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await writeFile(`${out}/bad-encoding.csv`, Buffer.from([0xc0, 0xaf]));
  await w
    .getByLabel('Posted employee payroll register', { exact: true })
    .setInputFiles(`${out}/bad-encoding.csv`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await w
    .getByLabel('Posted employee payroll register', { exact: true })
    .setInputFiles(
      'audit/payroll/cases/malformed-register-competitor-full-member/source-0.csv',
    );
  await wait();
  assert.equal(await status.count(), 0);
  await reconfirm();
  await attestation().check();
  await button('Check payroll components / GL / bank').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Source blocked; financial totals withheld',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await button('Reject whole payroll scope').click();
  await wait();
  await download('Export payroll evidence', 'ui-malformed-reject.xlsx');
  await sample();
  await w
    .getByLabel('Selected posted payroll and disbursement GL entries', {
      exact: true,
    })
    .setInputFiles('audit/payroll/cases/unmapped-zero-gl-visible/source-3.csv');
  await wait();
  await reconfirm();
  await attestation().check();
  await button('Check payroll components / GL / bank').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Payroll evidence or account coverage missing',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-unmapped-zero.xlsx');
  await sample();
  for (let i = 0; i < 5; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/payroll/cases/opposed-account-differences-zero-grand/source-${i}.csv`,
      );
    await wait();
  }
  await reconfirm();
  await attestation().check();
  await button('Check payroll components / GL / bank').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-opposite-differences.xlsx');
  // UX-5(d): five new files fill the card; nothing is confirmed and the
  // check stays closed until the accountant confirms with the one box.
  await sample();
  if ((await card.locator('details').getAttribute('open')) !== null)
    await card.locator('details > summary').click();
  const fresh = set('gross-deduction-differences-net-masked');
  await load(fresh);
  await cardSaysFiles(
    fresh,
    'five new originals',
    await oracleScope('gross-deduction-differences-net-masked'),
  );
  assert.equal(
    await card.locator('details').getAttribute('open'),
    null,
    'with nothing to ask, the fields stay folded',
  );
  assert.equal(await confirmBox().isChecked(), false, 'a suggestion never confirms');
  assert.equal(
    await runButton().isEnabled(),
    false,
    "the check waits for the accountant's confirmation",
  );
  await confirmBox().check();
  await attestation().check();
  await runButton().click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-net-masked-components.xlsx');
  await cardSaysFiles(fresh, 'after the run');
  const loadCase = async (name) => {
    await sample();
    for (let i = 0; i < 5; i++) {
      await w
        .getByLabel(roles[i], { exact: true })
        .setInputFiles(`audit/payroll/cases/${name}/source-${i}.csv`);
      await wait();
    }
    await reconfirm();
    await attestation().check();
    await button('Check payroll components / GL / bank').click();
    await wait();
  };
  await loadCase('bank-one-minor-difference');
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-bank-difference.xlsx');
  await loadCase('net-liability-cleared-zero-still-two-differences');
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  await download('Export payroll evidence', 'ui-net-cleared.xlsx');
  await loadCase('malformed-bank-competitor-full-member');
  assert.equal(
    await status.innerText(),
    'Source blocked; financial totals withheld',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await button('Reject whole payroll scope').click();
  await wait();
  await download('Export payroll evidence', 'ui-malformed-bank-reject.xlsx');
  // The accountant's entry stays theirs: new files never write over it.
  await sample();
  await openFields();
  const map = w.getByLabel('Payroll scope Map version', { exact: true });
  await map.fill('Typed map');
  assert.equal(await status.count(), 0, 'an edited scope clears the result');
  assert.equal((await cardField('mapVersion')).origin, 'user');
  // One GL row names another account set: that field is a question.
  const otherSet = await variant(
    'seven-components-and-bank-positive',
    (source, head, body) => {
      if (source === 3)
        body[0][head.indexOf(scopeHeaders.accountSetVersion)] = 'ACCOUNT-SET-2';
    },
  );
  await load(otherSet);
  const typed = await cardField('mapVersion');
  assert.equal(typed.value, 'Typed map', 'the entry is kept');
  assert.equal(typed.hint, 'Your entry');
  const mixed = await filesSay(otherSet);
  assert.equal(
    mixed.accountSetVersion.counts.size,
    2,
    'the files differ in the account set',
  );
  const accountSet = await cardField('accountSetVersion');
  assert.equal(accountSet.origin, 'question');
  assert.equal(accountSet.value, '', 'a disagreement is never filled');
  assert.equal(accountSet.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(accountSet.values, listed(mixed.accountSetVersion.counts));
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await w
    .getByLabel('Payroll scope Account set version', { exact: true })
    .fill([...mixed.accountSetVersion.counts.keys()][0]);
  await map.fill('MAP-1');
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await confirmBox().check();
  assert.equal(await runButton().isEnabled(), true);
  // A field that takes one value keeps it when the files hold another, and
  // the scope holds it too: confirmed, the check runs and the engine
  // refuses the rows that hold another, as it always did.
  const basis = await variant(
    'seven-components-and-bank-positive',
    (source, head, body) => {
      const at = head.indexOf(scopeHeaders.currencyBasis);
      for (const row of body) row[at] = 'transaction';
    },
  );
  await load(basis);
  const bases = await filesSay(basis);
  assert.deepEqual([...bases.currencyBasis.counts.keys()], ['transaction']);
  const fixed = await cardField('currencyBasis');
  assert.equal(fixed.origin, 'question');
  assert.equal(fixed.value, 'functional', 'the one option stays');
  assert.equal(
    fixed.hint,
    'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
  );
  assert.deepEqual(fixed.values, listed(bases.currencyBasis.counts));
  assert.equal(await confirmBox().isChecked(), false);
  await confirmBox().check();
  assert.equal(
    await runButton().isEnabled(),
    true,
    'the one value is in the scope, not only on screen',
  );
  await runButton().click();
  await status.waitFor();
  await wait();
  assert.equal(
    await status.innerText(),
    'Source blocked; financial totals withheld',
  );
  // A date written in another layout never fills a date field: the check
  // writes the five files with the payment date as DD/MM/YYYY, by column.
  const layout = await variant(
    'seven-components-and-bank-positive',
    (source, head, body) => {
      const at = head.indexOf(scopeHeaders.paymentDate);
      for (const row of body) row[at] = row[at].split('-').reverse().join('/');
    },
  );
  await load(layout);
  const [written] = (await filesSay(layout)).paymentDate.counts.keys();
  assert.match(written, /^\d{2}\/\d{2}\/\d{4}$/u);
  const paid = await cardField('paymentDate');
  assert.equal(paid.origin, 'question');
  assert.equal(paid.value, '', 'another layout is never put in a date field');
  assert.equal(
    paid.hint,
    `The files hold “${written}”, which this field does not take, so enter the value`,
  );
  await sample();
  const figures = await w.locator('td').allTextContents();
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.equal(await status.innerText(), 'مراجعة كامل الرواتب مطلوبة');
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.deepEqual(await w.locator('td').allTextContents(), figures);
  for (const lang of ['AR العربية', 'EN English']) {
    await page.getByRole('button', { name: lang, exact: true }).click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `${out}/${lang.startsWith('AR') ? 'ar' : 'en'}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openFields();
  await w
    .getByLabel('Payroll scope Map version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  assert.equal(await button('Export payroll evidence').isEnabled(), false);
  assert.equal(sheets.length, 13, 'every downloaded workpaper checked');
  const result = {
    scopeCard: true,
    downloadedBooks: 13,
    sheets,
    wholeMembers: 38,
    malformedMembers: 39,
    componentsSeparate: true,
    netDoesNotMaskComponents: true,
    bankPayoutIndependent: true,
    liabilityClearingDoesNotMask: true,
    zeroAccountPreserved: true,
    oppositeDifferencesNotMasked: true,
    strictSessionAndEncoding: true,
    scopeInvalidates: true,
    arEn: true,
    mobile: [320, 390],
  };
  await writeFile(`${out}/checks.json`, JSON.stringify(result, null, 2) + '\n');
  return result;
}
