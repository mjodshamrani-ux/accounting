import { openDomainWorkspace } from './domain-navigation-support.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { financialSheetSaysScreen } from './reconciliation-sheet-browser.mjs';
export async function verifyFinancial(
  page,
  url,
  out = 'work/tb-financial/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'tb-financial');
  const w = page.locator('[data-financial-workspace]'),
    status = w.locator('[data-financial-status]');
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-financial-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  const button = (name) => w.getByRole('button', { name, exact: true });
  const card = w.locator('[data-scope-card]'),
    roles = [
      'Trial balance',
      'Proposed mapping',
      'Independent presentation evidence',
      'Financial position',
    ];
  // The card's one confirmation (UX-5(d)) carries the four source
  // attestations and the scope attestation; its label names the four roles.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the trial balance, the proposed mapping, the independent presentation evidence and the financial position',
      { exact: false },
    );
  const runButton = () => button('Check mapping and amounts');
  // The fields fold under the card's sentence when nothing is asked; an
  // accountant opens them to change one.
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader: every non-blank data row
  // of the four files, each scope column by the header the frozen oracle
  // pairs with the field.
  const truth = JSON.parse(
    await readFile('audit/tb-financial/frozen/expected.json', 'utf8'),
  );
  const scopeHeaders = Object.fromEntries(
    Object.keys(truth.scope).map((key, i) => [key, truth.scopeHeaders[i]]),
  );
  assert.equal(Object.keys(scopeHeaders).length, 12, 'twelve scope fields');
  const frozen = 'audit/tb-financial/frozen';
  async function filesSay(name, dir = frozen) {
    const tables = [];
    for (const [source, label] of roles.entries()) {
      const text = await readFile(`${dir}/${name}-${source}.csv`, 'utf8');
      assert.ok(!text.includes('"'), 'the financial sources are unquoted');
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
          assert.ok(at >= 0, `${header} is a column of ${label}`);
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
  // Every field the files agree on holds their value, marked from the file
  // with its column and each file's rows; the sentence says the same.
  async function cardSaysFiles(name, when) {
    assert.equal(
      await card.count(),
      1,
      `${name} ${when}: the files show the card «ما فهمناه من ملفاتك»`,
    );
    const said = await filesSay(name);
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
      `${one('entity')}, ledger ${one('ledger')}, ${one('start')} to ${one('end')}, in ${one('currency')}; ${said.entity.rows} rows read from the four files.`,
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
    // The card fills after the file is shown; wait for that paint to pass.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
  // The heading shows the engine's status as a word, and keeps the status
  // itself in its data attribute.
  const LABEL = {
    'needs-review': 'Needs review',
    'consistent-with-evidence': 'Consistent with the evidence provided',
    'source-error': 'Source evidence is invalid',
  };
  const shows = async (key) => {
    assert.equal(await status.getAttribute('data-financial-status'), key);
    assert.equal(await status.innerText(), LABEL[key]);
  };
  // UX-6(c): each workpaper opens on the reconciliation sheet, in the
  // interface's language, and it says what this page shows.
  const sheets = [];
  const download = async (name, file, lang = 'en') => {
    const p = page.waitForEvent('download');
    await button(name).click();
    await (await p).saveAs(`${out}/${file}`);
    await wait();
    if (file.endsWith('.xlsx'))
      sheets.push({
        file,
        ...(await financialSheetSaysScreen(page, {
          file: `${out}/${file}`,
          lang,
        })),
      });
  };
  await button('Open a synthetic example').click();
  await status.waitFor();
  await wait();
  await shows('needs-review');
  // The example's four files hold its scope, so the card shows each value
  // as theirs; the example confirmed it.
  await cardSaysFiles('whole-post-closing', 'after the example');
  assert.equal(await confirmBox().isChecked(), true);
  assert.equal(await button('Accept whole line').first().isEnabled(), false);
  await download('Export evidence', 'ui-pending.xlsx');
  await w
    .getByLabel('Decision reference', { exact: true })
    .fill('Synthetic independent browser reference');
  await w
    .getByLabel('Decision reason', { exact: true })
    .fill(
      'Original whole-line accounts and independent presentation evidence reviewed',
    );
  for (let i = 0; i < 6; i++) {
    await button('Accept whole line').nth(i).click();
    await wait();
  }
  await shows('consistent-with-evidence');
  await download('Export evidence', 'ui-accepted.xlsx');
  await download('Save session', 'ui-session.json');
  const saved = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(saved.events.length, 6);
  assert.equal(saved.events[1].mappingIds.length, 2);
  assert.equal(saved.files.length, 4);
  assert.ok(saved.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo decision').nth(1).click();
  await wait();
  await shows('needs-review');
  await download('Export evidence', 'ui-undo.xlsx');
  await button('Reject whole line').nth(1).click();
  await wait();
  await shows('needs-review');
  await download('Export evidence', 'ui-reject.xlsx');
  // The same result in Arabic: the language changes, the review stays.
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await download('صدّر الأدلة', 'ui-reject-ar.xlsx', 'ar');
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await shows('needs-review');
  await w
    .getByLabel('Restore session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  await shows('consistent-with-evidence');
  await download('Export evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...saved,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  await shows('consistent-with-evidence');
  // Changing an original invalidates both results and decisions, never reuses an approval.
  await w
    .getByLabel('Proposed mapping', { exact: true })
    .setInputFiles('audit/tb-financial/frozen/wrong-lines-equal-totals-1.csv');
  await wait();
  assert.equal(await status.count(), 0);
  // A new original drops the one confirmation; it is given again with it.
  assert.equal(await confirmBox().isChecked(), false);
  assert.equal(await runButton().isEnabled(), false);
  await confirmBox().check();
  await w
    .getByLabel(
      'I reviewed completeness of supplied accounts, dimensions, mappings, evidence and statement lines',
      { exact: true },
    )
    .check();
  await button('Check mapping and amounts').click();
  await wait();
  await shows('source-error');
  assert.equal(await button('Accept whole line').first().isEnabled(), false);
  // UX-5(d): four new files fill the card; nothing is confirmed and the
  // check stays closed until the accountant confirms with the one box.
  await load('partial-line-accept');
  await cardSaysFiles('partial-line-accept', 'loaded');
  assert.equal(
    await card.locator('details').getAttribute('open'),
    null,
    'with nothing to ask, the fields stay folded',
  );
  assert.equal(await confirmBox().isChecked(), false, 'a suggestion never confirms');
  assert.equal(
    await runButton().isEnabled(),
    false,
    'the check waits for the accountant\'s confirmation',
  );
  await confirmBox().check();
  await runButton().click();
  await status.waitFor();
  await wait();
  await cardSaysFiles('partial-line-accept', 'after the run');
  // The accountant's entry stays theirs: new files never write over it.
  await openFields();
  await w
    .getByLabel('Financial scope: Entity', { exact: true })
    .fill('Changed synthetic owner');
  assert.equal(await status.count(), 0, 'an edited scope clears the result');
  assert.equal(await runButton().isEnabled(), false);
  assert.equal((await cardField('entity')).origin, 'user');
  // Rows that disagree leave the field a question: emptied, the fields
  // open, each value shown with its file and count.
  await load('source-wrong-currency');
  const entity = await cardField('entity');
  assert.equal(entity.value, 'Changed synthetic owner', 'the entry is kept');
  assert.equal(entity.origin, 'user');
  assert.equal(entity.hint, 'Your entry');
  const mixed = await filesSay('source-wrong-currency');
  assert.equal(mixed.currency.counts.size, 2, 'the files differ in currency');
  const currency = await cardField('currency');
  assert.equal(currency.origin, 'question');
  assert.equal(currency.value, '', 'a disagreement is never filled');
  assert.equal(currency.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(
    currency.values,
    [...mixed.currency.counts].flatMap(([value, bySource]) =>
      [...bySource].map(([source, n]) => `“${value}” in ${source}: ${n}`),
    ),
  );
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await w
    .getByLabel('Financial scope: Entity', { exact: true })
    .fill(truth.scope.entity);
  await w
    .getByLabel('Financial scope: Currency', { exact: true })
    .fill(truth.scope.currency);
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await confirmBox().check();
  assert.equal(await runButton().isEnabled(), true);
  // A field that takes one value keeps it when every file holds another,
  // and says so: the files are what must change.
  await load('preclosing-unsupported');
  const closing = await filesSay('preclosing-unsupported');
  assert.deepEqual([...closing.closingBasis.counts.keys()], ['pre-closing']);
  const basis = await cardField('closingBasis');
  assert.equal(basis.origin, 'question');
  assert.equal(basis.value, truth.scope.closingBasis, 'the one option stays');
  assert.equal(
    basis.hint,
    'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
  );
  assert.deepEqual(
    basis.values,
    [...closing.closingBasis.counts].flatMap(([value, bySource]) =>
      [...bySource].map(([source, n]) => `“${value}” in ${source}: ${n}`),
    ),
  );
  assert.equal(await confirmBox().isChecked(), false);
  // The scope holds that one value, not only the screen: confirmed, the
  // check opens, and the engine refuses each row holding another, as it
  // always did.
  await confirmBox().check();
  assert.equal(
    await runButton().isEnabled(),
    true,
    'the one value is in the scope, not only on screen',
  );
  await runButton().click();
  await status.waitFor();
  await wait();
  await shows('source-error');
  // A date written in another layout never fills a date field: the check
  // writes the four files with the period start as DD/MM/YYYY, by column.
  for (const source of roles.keys()) {
    const [head, ...body] = (
      await readFile(`${frozen}/partial-line-accept-${source}.csv`, 'utf8')
    )
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => line.split(','));
    const at = head.indexOf(scopeHeaders.start);
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
  assert.equal(await card.locator('details').getAttribute('open'), '');
  // Whole-line and two-column controls remain usable on mobile, both languages.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    await page.screenshot({ path: `${out}/ar-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'Arabic page must not overflow',
    );
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    await page.screenshot({ path: `${out}/en-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'English page must not overflow',
    );
  }
  return {
    scopeCard: true,
    downloads: 6,
    sheets,
    wholeLineMembers: 2,
    languages: 2,
    mobileWidths: [320, 390],
    restoreFailurePreserved: true,
    sourceChangeInvalidated: true,
  };
}
