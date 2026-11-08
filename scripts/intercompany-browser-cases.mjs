import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { intercompanySheetSaysScreen } from './reconciliation-sheet-browser.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyIntercompany(
  page,
  url,
  out = 'work/intercompany/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'intercompany');
  const w = page.locator('[data-intercompany-workspace]'),
    status = w.locator('[data-intercompany-status]');
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-intercompany-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  const button = (name) => w.getByRole('button', { name, exact: true });
  const card = w.locator('[data-scope-card]'),
    roles = [
      'Left entity ledger',
      'Right entity ledger',
      'Independent relationship evidence',
      'Independent timing evidence',
    ];
  // The card's one confirmation (UX-5(d)) carries the four source
  // attestations and the scope attestation; its label names the four roles.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the left and right entity ledgers, the independent relationship evidence and the independent timing evidence',
      { exact: false },
    );
  const runButton = () => button('Check reciprocal transactions');
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader. The scope headers come
  // from the family's frozen oracle; the field names are the card's keys in
  // the same order. Each ledger writes its own side under its own columns,
  // as the family's row check reads them: the left ledger is side A and
  // names side B its counterparty, the right ledger the reverse. Spelled
  // out here, apart from the app's list, so a wrong list shows.
  const frozen = 'audit/intercompany/frozen';
  const oracle = JSON.parse(await readFile(`${frozen}/expected.json`, 'utf8'));
  const keys = ['entityA', 'entityB', 'ledgerA', 'ledgerB', 'accountA',
    'accountB', 'dimensionsA', 'dimensionsB', 'currency', 'currencyBasis',
    'fxPolicy', 'postingStatus', 'postingLayer', 'start', 'end', 'asOf',
    'policyVersion'];
  assert.equal(oracle.scopeHeaders.length, keys.length, 'one header per field');
  const scopeHeaders = Object.fromEntries(
    keys.map((key, i) => [key, oracle.scopeHeaders[i]]),
  );
  const own = [
    { entityA: 'Entity', entityB: 'Counterparty', ledgerA: 'Ledger',
      accountA: 'Account ID', dimensionsA: 'Complete dimensions' },
    { entityB: 'Entity', entityA: 'Counterparty', ledgerB: 'Ledger',
      accountB: 'Account ID', dimensionsB: 'Complete dimensions' },
    {},
    {},
  ];
  async function filesSay(name, dir = frozen) {
    const tables = [];
    for (const [source, label] of roles.entries()) {
      const text = await readFile(`${dir}/${name}-${source}.csv`, 'utf8');
      assert.ok(!text.includes('"'), 'the intercompany sources are unquoted');
      const [head, ...body] = text
        .split(/\r?\n/u)
        .map((line) => line.split(','))
        .filter((cells) => cells.some((cell) => cell.trim()));
      tables.push({ label, head, body, own: own[source] });
    }
    return Object.fromEntries(
      Object.entries(scopeHeaders).map(([key, header]) => {
        const counts = new Map(),
          read = [];
        let rows = 0;
        for (const { label, head, body, own } of tables) {
          const name = own[key] ?? header,
            at = head.indexOf(name);
          if (at < 0) continue;
          read.push(
            name === header
              ? `${label}: rows ${body.length}`
              : `${label} (column ${name}): rows ${body.length}`,
          );
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
  async function cardSaysFiles(name, when, dir = frozen) {
    assert.equal(
      await card.count(),
      1,
      `${name} ${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(name, dir);
    for (const [key, { header, read, counts }] of Object.entries(said)) {
      assert.equal(counts.size, 1, `${name}: one ${key} in the four files`);
      const [value] = counts.keys(),
        shown = await cardField(key);
      assert.equal(shown.value, value, `${name} ${when}: ${key} from the files`);
      assert.equal(shown.origin, 'file', `${name} ${when}: ${key} as theirs`);
      assert.equal(
        shown.hint,
        `From the file: column ${header} · ${read.join(' · ')}`,
        `${name} ${when}: ${key} names its column and each file's rows`,
      );
    }
    const one = (key) => said[key].counts.keys().next().value;
    assert.equal(
      await card.locator('[data-scope-summary]').innerText(),
      `${one('entityA')} and ${one('entityB')}, ${one('start')} to ${one('end')}, in ${one('currency')}; ${said.currency.rows} rows read from the four files.`,
      `${name} ${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      5,
      'each value in the sentence is isolated from the words around it',
    );
  }
  async function load(name, dir = frozen) {
    for (const [source, label] of roles.entries()) {
      const file = `${dir}/${name}-${source}.csv`;
      await w
        .locator('.workspace-source')
        .filter({ has: page.getByLabel(label, { exact: true }) })
        .locator('input[type="file"]')
        .setInputFiles(file);
      await wait();
      await w.getByText(file.split('/').at(-1), { exact: true }).waitFor();
    }
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
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
        ...(await intercompanySheetSaysScreen(page, {
          file: `${out}/${file}`,
          lang,
        })),
      });
  };
  await button('Open a synthetic intercompany example').click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'Whole pair review required');
  // The example's four files hold its scope, each ledger under its own
  // columns, so the card shows every value as theirs; the example confirmed.
  await cardSaysFiles('pending', 'after the example');
  assert.equal(await confirmBox().isChecked(), true);
  assert.equal(await button('Approve whole pair').first().isEnabled(), false);
  await download('Export intercompany evidence', 'ui-pending.xlsx');
  await w
    .getByLabel('Intercompany decision reference', { exact: true })
    .fill('Synthetic independent browser reference');
  await w
    .getByLabel('Intercompany decision explanation', { exact: true })
    .fill(
      'Original whole reciprocal transactions and independent relationship evidence reviewed',
    );
  for (let i = 0; i < 3; i++) {
    await button('Approve whole pair').nth(i).click();
    await wait();
  }
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export intercompany evidence', 'ui-accepted.xlsx');
  await download('Save intercompany session', 'ui-session.json');
  const saved = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(saved.events.length, 3);
  assert.ok(saved.events.every((e) => e.memberIds.length === 2));
  assert.equal(saved.files.length, 4);
  assert.ok(saved.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo pair decision').nth(1).click();
  await wait();
  assert.equal(await status.innerText(), 'Whole pair review required');
  await download('Export intercompany evidence', 'ui-undo.xlsx');
  await button('Reject whole pair').nth(1).click();
  await wait();
  assert.equal(await status.innerText(), 'Whole pair review required');
  await download('Export intercompany evidence', 'ui-reject.xlsx');
  // The same result in Arabic: the language changes, the review stays.
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await download('صدّر أدلة معاملات المنشآت', 'ui-reject-ar.xlsx', 'ar');
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.equal(await status.innerText(), 'Whole pair review required');
  await w
    .getByLabel('Restore intercompany session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export intercompany evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...saved,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore intercompany session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await w
    .getByLabel('Left entity ledger', { exact: true })
    .setInputFiles('audit/intercompany/regressions/native-white-font.xlsx');
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  // A valid replacement changes the source identity and invalidates history.
  await w
    .getByLabel('Independent relationship evidence', { exact: true })
    .setInputFiles(
      'audit/intercompany/frozen/relationship-wrong-account-2.csv',
    );
  await wait();
  assert.equal(await status.count(), 0);
  // A new original drops the one confirmation; it is given again with it.
  assert.equal(await confirmBox().isChecked(), false);
  assert.equal(await runButton().isEnabled(), false);
  await confirmBox().check();
  await w
    .getByLabel(
      'I reviewed the complete supplied transactions, relationships and timing evidence.',
      { exact: true },
    )
    .check();
  await button('Check reciprocal transactions').click();
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole pair').first().isEnabled(), false);
  // A rejected relation must contain every raw ledger contender, including
  // the malformed duplicate that cannot contribute a financial amount.
  await button('Open a synthetic intercompany example').click();
  await wait();
  await w
    .getByLabel('Left entity ledger', { exact: true })
    .setInputFiles(
      'audit/intercompany/frozen/malformed-duplicate-contender-0.csv',
    );
  await wait();
  assert.equal(await confirmBox().isChecked(), false);
  await confirmBox().check();
  await w
    .getByLabel(
      'I reviewed the complete supplied transactions, relationships and timing evidence.',
      { exact: true },
    )
    .check();
  await button('Check reciprocal transactions').click();
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  const firstPair = w.locator('[data-intercompany-pair="R-001"]');
  assert.ok(
    (await firstPair.innerText()).includes('Original ledger entries (3)'),
  );
  await w
    .getByLabel('Intercompany decision reference', { exact: true })
    .fill('Synthetic full physical rejection');
  await w
    .getByLabel('Intercompany decision explanation', { exact: true })
    .fill('Includes the malformed competing original record');
  await firstPair
    .getByRole('button', { name: 'Reject whole pair', exact: true })
    .click();
  await wait();
  await download('Export intercompany evidence', 'ui-physical-reject.xlsx');
  await download(
    'Save intercompany session',
    'ui-physical-reject-session.json',
  );
  const physical = JSON.parse(
    await readFile(`${out}/ui-physical-reject-session.json`, 'utf8'),
  );
  assert.equal(physical.events.length, 1);
  assert.equal(physical.events[0].memberIds.length, 3);
  // Scope edits invalidate a displayed result; stored decisions stay discarded.
  await openFields();
  await w
    .getByLabel('Intercompany scope Policy version', { exact: true })
    .fill('CHANGED');
  assert.equal(await status.count(), 0);
  await button('Open a synthetic intercompany example').click();
  await wait();
  await status.waitFor();
  // UX-5(d): four new files fill the card; nothing is confirmed and the
  // check stays closed until the accountant confirms with the one box.
  // The fields opened above stay open until the accountant folds them;
  // folded, they stay folded while nothing is asked.
  if ((await card.locator('details').getAttribute('open')) !== null)
    await card.locator('details > summary').click();
  await load('accept-timing');
  await cardSaysFiles('accept-timing', 'loaded');
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
  await cardSaysFiles('accept-timing', 'after the run');
  // The accountant's entry stays theirs: new files never write over it.
  await openFields();
  const policy = w.getByLabel('Intercompany scope Policy version', {
    exact: true,
  });
  await policy.fill('Typed policy');
  assert.equal(await status.count(), 0, 'an edited scope clears the result');
  assert.equal((await cardField('policyVersion')).origin, 'user');
  // The right ledger names another counterparty in one row: entity A, read
  // there from its Counterparty column, is a question with each value.
  await load('wrong-counterparty');
  const typed = await cardField('policyVersion');
  assert.equal(typed.value, 'Typed policy', 'the entry is kept');
  assert.equal(typed.hint, 'Your entry');
  const mixed = await filesSay('wrong-counterparty');
  assert.equal(mixed.entityA.counts.size, 2, 'the files differ in entity A');
  const entityA = await cardField('entityA');
  assert.equal(entityA.origin, 'question');
  assert.equal(entityA.value, '', 'a disagreement is never filled');
  assert.equal(entityA.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(
    entityA.values,
    [...mixed.entityA.counts].flatMap(([value, bySource]) =>
      [...bySource].map(([source, n]) => `“${value}” in ${source}: ${n}`),
    ),
  );
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await w
    .getByLabel('Intercompany scope Left entity', { exact: true })
    .fill([...mixed.entityA.counts.keys()][0]);
  await policy.fill('IC-1');
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await confirmBox().check();
  assert.equal(await runButton().isEnabled(), true);
  // A field that takes one value keeps it when a file holds another, and
  // the scope holds it too: confirmed, the check runs and the engine
  // refuses the rows that hold another, as it always did.
  await load('draft-row');
  const drafts = await filesSay('draft-row');
  assert.equal(drafts.postingStatus.counts.size, 2, 'a draft row among posted');
  const posting = await cardField('postingStatus');
  assert.equal(posting.origin, 'question');
  assert.equal(posting.value, 'posted', 'the one option stays');
  assert.equal(
    posting.hint,
    'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
  );
  assert.deepEqual(
    posting.values,
    [...drafts.postingStatus.counts].flatMap(([value, bySource]) =>
      [...bySource].map(([source, n]) => `“${value}” in ${source}: ${n}`),
    ),
  );
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
  for (const source of roles.keys()) {
    const [head, ...body] = (
      await readFile(`${frozen}/accept-timing-${source}.csv`, 'utf8')
    )
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => line.split(','));
    const at = head.indexOf(scopeHeaders.start);
    assert.ok(at >= 0, 'every source writes the period start');
    for (const row of body) row[at] = row[at].split('-').reverse().join('/');
    await writeFile(
      `${out}/date-layout-${source}.csv`,
      [head, ...body].map((row) => row.join(',')).join('\n') + '\n',
    );
  }
  await load('date-layout', out);
  const layout = await filesSay('date-layout', out);
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
      'Arabic page overflow',
    );
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    await page.screenshot({ path: `${out}/en-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'English page overflow',
    );
  }
  return {
    scopeCard: true,
    downloads: 7,
    sheets,
    wholePairMembers: 2,
    malformedPhysicalRejectionMembers: 3,
    languages: 2,
    mobileWidths: [320, 390],
    restoreFailurePreserved: true,
    sourceFailurePreserved: true,
    sourceChangeInvalidated: true,
    scopeChangeInvalidated: true,
  };
}
