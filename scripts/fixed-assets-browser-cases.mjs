import { openDomainWorkspace } from './domain-navigation-support.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyAsset(
  page,
  url,
  out = 'work/fixed-assets/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, 'assets');
  const w = page.locator('[data-asset-workspace]'),
    status = w.locator('[data-asset-status]'),
    button = (name) => w.getByRole('button', { name, exact: true });
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-asset-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
  };
  const sample = async () => {
    await button('Open a synthetic asset example').click();
    await status.waitFor();
    await wait();
  };
  const attestation = () =>
    w.getByLabel(
      'I reviewed all supplied assets, the cost/depreciation/impairment mappings and evidence, and every selected GL account including zero components and accounts.',
      { exact: true },
    );
  const reference = () =>
      w.getByLabel('Asset decision reference', { exact: true }),
    note = () => w.getByLabel('Asset decision explanation', { exact: true });
  const roles = [
    'Posted asset component register',
    'Proposed asset component / GL mapping',
    'Independent supplied asset policy evidence',
    'Selected asset GL balances',
  ];
  const card = w.locator('[data-scope-card]');
  // The card's one confirmation (UX-5(d)) carries the four source
  // attestations and the scope attestation; its label names the four roles.
  const confirmBox = () =>
    w.getByLabel(
      'I reviewed the posted asset component register, the proposed asset component / GL mapping, the independent supplied asset policy evidence and the selected asset GL balances',
      { exact: false },
    );
  const runButton = () => button('Check asset components / GL');
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
  // (audit/fixed-assets/reference.py), and every case's expected scope from
  // its expected.json.
  const cases = 'audit/fixed-assets/cases';
  const referenceText = await readFile('audit/fixed-assets/reference.py', 'utf8');
  const listOf = (name) =>
    JSON.parse(
      new RegExp(`^${name} = (\\[[^\\]]*\\])`, 'mu')
        .exec(referenceText)[1]
        .replaceAll("'", '"'),
    );
  const keys = listOf('FIELDS'),
    headers = listOf('SCOPE_HEADERS');
  assert.equal(keys.length, 12, 'twelve scope fields');
  assert.equal(headers.length, keys.length, 'one header per field');
  const scopeHeaders = Object.fromEntries(keys.map((k, i) => [k, headers[i]]));
  const set = (name) =>
    roles.map((_, source) => `${cases}/${name}/source-${source}.csv`);
  async function filesSay(paths) {
    const tables = [];
    for (const [source, label] of roles.entries()) {
      const text = await readFile(paths[source], 'utf8');
      assert.ok(!text.includes('"'), 'the asset sources here are unquoted');
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
      assert.equal(counts.size, 1, `${when}: one ${key} in the four files`);
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
      `${one('entity')}, ${one('assetLedger')} against ${one('glLedger')}, as of ${one('asOf')}, in ${one('currency')}; ${said.currency.rows} rows read from the four files.`,
      `${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      5,
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
  // Rewrites the four originals of a case by column, as a writer would.
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
  assert.equal(await status.innerText(), 'Whole asset review required');
  // The example's four files hold its scope, so the card shows every value
  // as theirs; the example confirmed.
  await cardSaysFiles(
    set('three-components-positive'),
    'after the example',
    await oracleScope('three-components-positive'),
  );
  assert.equal(await confirmBox().isChecked(), true);
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-pending.xlsx');
  await reference().fill('SYN-REVIEW');
  await note().fill('Synthetic whole asset component scope');
  await button('Approve whole asset scope').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export asset evidence', 'ui-accepted.xlsx');
  await download('Save asset session', 'ui-session.json');
  const session = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].memberIds.length, 17);
  assert.equal(session.files.length, 4);
  assert.ok(session.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo asset decision').click();
  await wait();
  assert.equal(await status.innerText(), 'Whole asset review required');
  await download('Export asset evidence', 'ui-undo.xlsx');
  await button('Reject whole asset scope').click();
  await wait();
  await download('Export asset evidence', 'ui-reject.xlsx');
  await w
    .getByLabel('Restore asset session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export asset evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...session,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore asset session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await writeFile(`${out}/bad-encoding.csv`, Buffer.from([0xc0, 0xaf]));
  await w
    .getByLabel('Posted asset component register', { exact: true })
    .setInputFiles(`${out}/bad-encoding.csv`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await w
    .getByLabel('Posted asset component register', { exact: true })
    .setInputFiles(
      'audit/fixed-assets/cases/malformed-register-competitor-full-member/source-0.csv',
    );
  await wait();
  assert.equal(await status.count(), 0);
  await reconfirm();
  await attestation().check();
  await button('Check asset components / GL').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Source blocked; financial totals withheld',
  );
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await button('Reject whole asset scope').click();
  await wait();
  await download('Export asset evidence', 'ui-malformed-reject.xlsx');
  await sample();
  await w
    .getByLabel('Selected asset GL balances', { exact: true })
    .setInputFiles(
      'audit/fixed-assets/cases/unmapped-zero-cost-account-not-dropped/source-3.csv',
    );
  await wait();
  await reconfirm();
  await attestation().check();
  await button('Check asset components / GL').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Component evidence or account coverage missing',
  );
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-unmapped-zero.xlsx');
  await sample();
  for (let i = 0; i < 4; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/fixed-assets/cases/opposite-cost-differences-zero-grand/source-${i}.csv`,
      );
    await wait();
  }
  await reconfirm();
  await attestation().check();
  await button('Check asset components / GL').click();
  await wait();
  assert.equal(await status.innerText(), 'Per-component account difference');
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-opposite-differences.xlsx');
  // UX-5(d): four new files fill the card; nothing is confirmed and the
  // check stays closed until the accountant confirms with the one box.
  await sample();
  if ((await card.locator('details').getAttribute('open')) !== null)
    await card.locator('details > summary').click();
  const fresh = set('component-differences-masked-by-net');
  await load(fresh);
  await cardSaysFiles(
    fresh,
    'four new originals',
    await oracleScope('component-differences-masked-by-net'),
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
  assert.equal(await status.innerText(), 'Per-component account difference');
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-net-masked-components.xlsx');
  await cardSaysFiles(fresh, 'after the run');
  // The accountant's entry stays theirs: new files never write over it.
  await openFields();
  const map = w.getByLabel('Asset scope Map version', { exact: true });
  await map.fill('Typed map');
  assert.equal(await status.count(), 0, 'an edited scope clears the result');
  assert.equal((await cardField('mapVersion')).origin, 'user');
  // One GL row names another account set: that field is a question.
  const otherSet = await variant('three-components-positive', (source, head, body) => {
    if (source === 3)
      body[0][head.indexOf(scopeHeaders.assetAccountSetVersion)] = 'ASSET-SET-2';
  });
  await load(otherSet);
  const typed = await cardField('mapVersion');
  assert.equal(typed.value, 'Typed map', 'the entry is kept');
  assert.equal(typed.hint, 'Your entry');
  const mixed = await filesSay(otherSet);
  assert.equal(
    mixed.assetAccountSetVersion.counts.size,
    2,
    'the files differ in the account set',
  );
  const accountSet = await cardField('assetAccountSetVersion');
  assert.equal(accountSet.origin, 'question');
  assert.equal(accountSet.value, '', 'a disagreement is never filled');
  assert.equal(accountSet.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(
    accountSet.values,
    listed(mixed.assetAccountSetVersion.counts),
  );
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await w
    .getByLabel('Asset scope Asset account set version', { exact: true })
    .fill([...mixed.assetAccountSetVersion.counts.keys()][0]);
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
  const basis = await variant('three-components-positive', (source, head, body) => {
    const at = head.indexOf(scopeHeaders.currencyBasis);
    for (const row of body) row[at] = 'transaction';
  });
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
  // writes the four files with the as-of date as DD/MM/YYYY, by column.
  const layout = await variant('three-components-positive', (source, head, body) => {
    const at = head.indexOf(scopeHeaders.asOf);
    for (const row of body) row[at] = row[at].split('-').reverse().join('/');
  });
  await load(layout);
  const [written] = (await filesSay(layout)).asOf.counts.keys();
  assert.match(written, /^\d{2}\/\d{2}\/\d{4}$/u);
  const asOf = await cardField('asOf');
  assert.equal(asOf.origin, 'question');
  assert.equal(asOf.value, '', 'another layout is never put in a date field');
  assert.equal(
    asOf.hint,
    `The files hold “${written}”, which this field does not take, so enter the value`,
  );
  await sample();
  const figures = await w.locator('td').allTextContents();
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.equal(await status.innerText(), 'مراجعة كامل الأصول مطلوبة');
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
    .getByLabel('Asset scope Map version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  assert.equal(await button('Export asset evidence').isEnabled(), false);
  const result = {
    scopeCard: true,
    downloadedBooks: 9,
    wholeMembers: 17,
    malformedMembers: 18,
    componentsSeparate: true,
    netDoesNotMaskComponents: true,
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
