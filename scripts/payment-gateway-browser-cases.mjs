import { openDomainWorkspace } from './domain-navigation-support.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyGateway(
  page,
  url,
  out = 'work/payment-gateway/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'gateway');
  const w = page.locator('[data-gateway-workspace]'),
    status = w.locator('[data-gateway-status]');
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-gateway-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  const button = (name) => w.getByRole('button', { name, exact: true });
  const card = w.locator('[data-scope-card]'),
    roles = [
      'Gateway sales and refunds',
      'Independent fee evidence',
      'Gateway settlement summary',
      'Bank credit evidence',
    ];
  // The card's one confirmation (UX-5(d)) carries the four source
  // attestations and the scope attestation; its label names the four roles.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the gateway sales and refunds, the independent fee evidence, the gateway settlement summary and the bank credit evidence',
      { exact: false },
    );
  const runButton = () => button('Check gateway batch');
  const completeness = () =>
    w.getByLabel(
      'I reviewed all supplied transactions, independent fee detail, settlement and bank credit.',
      { exact: true },
    );
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // A new original drops the one confirmation; the accountant gives it again.
  async function reconfirm() {
    assert.equal(await confirmBox().isChecked(), false, 'a new original drops the confirmation');
    assert.equal(await runButton().isEnabled(), false);
    // Clicked, not checked: a box that cannot take the confirmation fails
    // here by assertion.
    await confirmBox().click();
    assert.equal(await confirmBox().isChecked(), true, 'the one box takes the confirmation');
    assert.equal(await runButton().isEnabled(), true, 'the one box opens the check');
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader. The scope headers come
  // from the family's frozen oracle; the field names are the card's keys in
  // the same order. Every role writes the same scope columns on every row.
  const frozen = 'audit/payment-gateway/frozen';
  const oracle = JSON.parse(await readFile(`${frozen}/expected.json`, 'utf8'));
  const keys = ['entity', 'gateway', 'merchantAccount', 'bankAccount',
    'dimensions', 'currency', 'currencyBasis', 'fxPolicy', 'start', 'end',
    'asOf', 'policyVersion', 'batchId'];
  assert.deepEqual(oracle.scopeFields, keys, 'the card keys are the oracle fields');
  const scopeHeaders = Object.fromEntries(
    keys.map((key, i) => [key, oracle.scopeHeaders[i]]),
  );
  const set = (name, dir = frozen) =>
    roles.map((_, source) => `${dir}/${name}-${source}.csv`);
  async function filesSay(paths) {
    const tables = [];
    for (const [source, label] of roles.entries()) {
      const text = await readFile(paths[source], 'utf8');
      assert.ok(!text.includes('"'), 'the gateway sources here are unquoted');
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
  async function cardSaysFiles(paths, when) {
    assert.equal(
      await card.count(),
      1,
      `${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(paths);
    for (const [key, { header, read, counts }] of Object.entries(said)) {
      assert.equal(counts.size, 1, `${when}: one ${key} in the four files`);
      const [value] = counts.keys(),
        shown = await cardField(key);
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
      `Batch ${one('batchId')} of ${one('gateway')} for ${one('entity')}, ${one('start')} to ${one('end')}, in ${one('currency')}; ${said.currency.rows} rows read from the four files.`,
      `${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      6,
      'each value in the sentence is isolated from the words around it',
    );
  }
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
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
  };
  await button('Open a synthetic gateway example').click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'Whole batch review required');
  // The example's four files hold its scope, so the card shows every value
  // as theirs; the example confirmed.
  await cardSaysFiles(set('pending'), 'after the example');
  assert.equal(await confirmBox().isChecked(), true);
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await download('Export gateway evidence', 'ui-pending.xlsx');
  await w
    .getByLabel('Gateway decision reference', { exact: true })
    .fill('Synthetic independent browser reference');
  await w
    .getByLabel('Gateway decision explanation', { exact: true })
    .fill('All original batch members and independent fee evidence reviewed');
  await button('Approve whole batch').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export gateway evidence', 'ui-accepted.xlsx');
  await download('Save gateway session', 'ui-session.json');
  const saved = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].memberIds.length, 7);
  assert.equal(saved.files.length, 4);
  assert.ok(saved.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo batch decision').click();
  await wait();
  assert.equal(await status.innerText(), 'Whole batch review required');
  await download('Export gateway evidence', 'ui-undo.xlsx');
  await button('Reject whole batch').click();
  await wait();
  await download('Export gateway evidence', 'ui-reject.xlsx');
  await w
    .getByLabel('Restore gateway session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export gateway evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...saved,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore gateway session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await w
    .getByLabel('Gateway sales and refunds', { exact: true })
    .setInputFiles('audit/payment-gateway/regressions/white-font.xlsx');
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  // A valid source replacement invalidates the entire previous decision context.
  await w
    .getByLabel('Gateway sales and refunds', { exact: true })
    .setInputFiles(
      'audit/payment-gateway/frozen/malformed-competing-transaction-0.csv',
    );
  await wait();
  assert.equal(await status.count(), 0);
  await reconfirm();
  await completeness().check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await button('Reject whole batch').click();
  await wait();
  await download('Export gateway evidence', 'ui-malformed-reject.xlsx');
  await download('Save gateway session', 'ui-malformed-reject-session.json');
  const physical = JSON.parse(
    await readFile(`${out}/ui-malformed-reject-session.json`, 'utf8'),
  );
  assert.equal(physical.events[0].memberIds.length, 8);
  // A fee amount cannot be made true by a net difference or a missing detail file.
  await button('Open a synthetic gateway example').click();
  await wait();
  await w
    .getByLabel('Independent fee evidence', { exact: true })
    .setInputFiles('audit/payment-gateway/frozen/fee-proof-missing-1.csv');
  await wait();
  await reconfirm();
  await completeness().check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'Required evidence is missing');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await download('Export gateway evidence', 'ui-missing-fee.xlsx');
  await button('Open a synthetic gateway example').click();
  await wait();
  await w
    .getByLabel('Gateway settlement summary', { exact: true })
    .setInputFiles(
      'audit/payment-gateway/frozen/gross-errors-net-cancels-2.csv',
    );
  await wait();
  await reconfirm();
  await completeness().check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'A batch difference remains');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await download('Export gateway evidence', 'ui-gross-cancel.xlsx');
  // The declared comma reader must inventory semicolon-containing malformed
  // one-field records rather than attempting delimiter inference first.
  await button('Open a synthetic gateway example').click();
  await wait();
  const comma = [
    'audit/payment-gateway/comma-provenance/source-0.csv',
    ...set('pending').slice(1),
  ];
  await w.getByLabel('Gateway sales and refunds', { exact: true }).setInputFiles(comma[0]);
  await wait();
  // A one-field record has no scope cell, so every field is asked: the card
  // never skips a row it cannot read a scope from. The fixed fields keep
  // their one value; the accountant types the others, reading the card.
  const malformed = await filesSay(comma);
  for (const key of keys) {
    assert.equal(malformed[key].counts.size, 2, `${key}: a blank among the rows`);
    const field = await cardField(key);
    assert.equal(field.origin, 'question', `${key}: asked`);
    assert.deepEqual(field.values, listed(malformed[key].counts));
    const [held] = [...malformed[key].counts.keys()].filter(Boolean);
    if (key === 'currencyBasis' || key === 'fxPolicy') {
      assert.equal(field.value, held, `${key}: the one option stays`);
      assert.equal(
        field.hint,
        'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
      );
      continue;
    }
    assert.equal(field.value, '', `${key}: a disagreement is never filled`);
    assert.equal(field.hint, 'The rows disagree, so enter the value');
    await card.locator(`[data-scope-field="${key}"] input`).fill(held);
  }
  await reconfirm();
  await completeness().check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  // The run returns the same files: the accountant's entries stay theirs,
  // and the confirmation with them.
  for (const key of keys.filter((k) => k !== 'currencyBasis' && k !== 'fxPolicy'))
    assert.equal(
      (await cardField(key)).origin,
      'user',
      `${key}: still the accountant's entry after the run`,
    );
  assert.equal(await confirmBox().isChecked(), true, 'the run keeps the confirmation');
  await button('Reject whole batch').click();
  await wait();
  await download('Export gateway evidence', 'ui-declared-comma-reject.xlsx');
  await download(
    'Save gateway session',
    'ui-declared-comma-reject-session.json',
  );
  const declared = JSON.parse(
    await readFile(`${out}/ui-declared-comma-reject-session.json`, 'utf8'),
  );
  assert.equal(declared.events[0].memberIds.length, 11);
  await w.getByLabel('Restore gateway session', { exact: true }).setInputFiles(`${out}/ui-declared-comma-reject-session.json`);
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await openFields();
  await w
    .getByLabel('Gateway scope Policy version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  await button('Open a synthetic gateway example').click();
  await wait();
  await status.waitFor();
  // UX-5(d): four new files fill the card; nothing is confirmed and the
  // check stays closed until the accountant confirms with the one box.
  // The fields opened above stay open until the accountant folds them;
  // folded, they stay folded while nothing is asked.
  if ((await card.locator('details').getAttribute('open')) !== null)
    await card.locator('details > summary').click();
  const permuted = set('order-permutation');
  await load(permuted);
  await cardSaysFiles(permuted, 'four new originals');
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
  await runButton().click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'Whole batch review required');
  await cardSaysFiles(permuted, 'after the run');
  // Four originals of another currency, loaded one by one: while they
  // disagree the currency is asked and the fields open; once all four agree
  // the card holds theirs, and the confirmation waits for the accountant.
  const yen = set('JPY', 'audit/payment-gateway/currency-contracts');
  await load(yen);
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'a disagreement while loading opens the fields',
  );
  await cardSaysFiles(yen, 'another currency');
  assert.equal(await confirmBox().isChecked(), false);
  await confirmBox().check();
  await runButton().click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'Whole batch review required');
  // The accountant's entry stays theirs: new files never write over it.
  await openFields();
  const policy = w.getByLabel('Gateway scope Policy version', { exact: true });
  await policy.fill('Typed policy');
  assert.equal(await status.count(), 0, 'an edited scope clears the result');
  assert.equal((await cardField('policyVersion')).origin, 'user');
  // One file names another batch: the batch is a question with each value.
  const foreign = set('foreign-batch');
  await load(foreign);
  const typed = await cardField('policyVersion');
  assert.equal(typed.value, 'Typed policy', 'the entry is kept');
  assert.equal(typed.hint, 'Your entry');
  const mixed = await filesSay(foreign);
  assert.equal(mixed.batchId.counts.size, 2, 'the files differ in the batch');
  const batch = await cardField('batchId');
  assert.equal(batch.origin, 'question');
  assert.equal(batch.value, '', 'a disagreement is never filled');
  assert.equal(batch.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(batch.values, listed(mixed.batchId.counts));
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await w
    .getByLabel('Gateway scope Batch ID', { exact: true })
    .fill([...mixed.batchId.counts.keys()][0]);
  await policy.fill('PG-1');
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
  const basis = set('wrong-basis', 'audit/payment-gateway/scope-invalid');
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
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  // A date written in another layout never fills a date field: the check
  // writes the four files with the period start as DD/MM/YYYY, by column.
  const layoutPaths = [];
  for (const [source, from] of set('accepted').entries()) {
    const [head, ...body] = (await readFile(from, 'utf8'))
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => line.split(','));
    const at = head.indexOf(scopeHeaders.start);
    assert.ok(at >= 0, 'every source writes the period start');
    for (const row of body) row[at] = row[at].split('-').reverse().join('/');
    layoutPaths.push(`${out}/date-layout-${source}.csv`);
    await writeFile(
      layoutPaths[source],
      [head, ...body].map((row) => row.join(',')).join('\n') + '\n',
    );
  }
  await load(layoutPaths);
  const layout = await filesSay(layoutPaths);
  const [written] = layout.start.counts.keys();
  assert.match(written, /^\d{2}\/\d{2}\/\d{4}$/u);
  const start = await cardField('start');
  assert.equal(start.origin, 'question');
  assert.equal(start.value, '', 'another layout is never put in a date field');
  assert.equal(
    start.hint,
    `The files hold “${written}”, which this field does not take, so enter the value`,
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await page.screenshot({ path: `${out}/ar-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'Arabic overflow',
    );
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    await page.screenshot({ path: `${out}/en-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'English overflow',
    );
  }
  return {
    scopeCard: true,
    downloads: 9,
    declaredCommaMembers: 11,
    wholeBatchMembers: 7,
    malformedBatchMembers: 8,
    missingFeesPrevented: true,
    grossNetMaskPrevented: true,
    restoreFailurePreserved: true,
    sourceFailurePreserved: true,
    sourceChangeInvalidated: true,
    scopeChangeInvalidated: true,
    languages: 2,
    mobileWidths: [320, 390],
  };
}
