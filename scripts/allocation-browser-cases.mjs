import assert from 'node:assert/strict';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
export async function verifyAllocation(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await openDomainWorkspace(page, 'allocation');
  await page
    .getByRole('heading', { name: 'تخصيص الدفعات', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'افتح مثال تخصيص اصطناعيًا', exact: true })
    .click();
  await page.getByTestId('allocation-result').waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const sides = ['Available payments', 'Open invoices', 'Proposed remittance'],
    truth = JSON.parse(
      await readFile('audit/allocation/frozen/expected.json', 'utf8'),
    );
  const workspace = page.locator('[data-allocation-workspace]'),
    card = workspace.locator('[data-scope-card]');
  // The card's one confirmation (UX-5(d)) carries the three source
  // attestations and the scope attestation; its label names the sources.
  const confirmBox = () =>
    workspace.getByLabel(
      'I reviewed the available payments, the open invoices and the proposed remittance',
      { exact: false },
    );
  const runButton = () =>
    workspace.getByRole('button', { name: 'Read value ledger', exact: true });
  // The fields fold under the card's sentence when nothing is asked; an
  // accountant opens them to change one.
  async function openFields() {
    const fields = card.locator('details');
    if ((await fields.getAttribute('open')) === null)
      await fields.locator('summary').click();
  }
  // What the card says each field holds, read here from the CSV bytes with
  // this check's own split, not the app's reader: every non-blank data row of
  // the three files, the seven scope columns by header. The native case
  // writes its workbooks from the same CSV text, so the same answer holds.
  const scopeHeaders = {
    entity: 'Entity',
    ledger: 'Ledger',
    party: 'Party',
    account: 'Account',
    currency: 'Currency',
    cutoff: 'Snapshot date',
    basis: 'Allocation basis',
  };
  async function filesSay(name) {
    const tables = [];
    for (const [side, label] of sides.entries()) {
      const text = await readFile(
        `audit/allocation/frozen/${name}-${side}.csv`,
        'utf8',
      );
      assert.ok(
        !text.includes('"'),
        'the frozen allocation sources are unquoted',
      );
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
    const field = card.locator(`[data-scope-field="${key}"]`);
    return {
      origin: await field.getAttribute('data-origin'),
      value: await field.locator('input').inputValue(),
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
      assert.equal(counts.size, 1, `${name}: one ${key} in the three files`);
      const [value] = counts.keys(),
        shown = await cardField(key);
      assert.equal(
        shown.value,
        value,
        `${name} ${when}: ${key} from the files`,
      );
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
      `${one('entity')}, supplier ${one('party')}, account ${one('account')}, snapshot on ${one('cutoff')}, in ${one('currency')}; ${said.entity.rows} rows read from the files.`,
      `${name} ${when}: the sentence says the files' scope`,
    );
    assert.equal(
      await card.locator('[data-scope-summary] bdi').count(),
      5,
      'each value in the sentence is isolated from the words around it',
    );
  }
  async function load(name, native = false) {
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
    }
    // The card fills after the file is shown; wait for that paint to pass.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  }
  // The three files fill the card; nothing is confirmed and the run stays
  // closed until the accountant confirms with the one box.
  async function upload(name, native = false) {
    await load(name, native);
    await cardSaysFiles(name, 'loaded');
    assert.equal(
      await card.locator('details').getAttribute('open'),
      null,
      `${name}: with nothing to ask, the fields stay folded`,
    );
    assert.equal(
      await confirmBox().isChecked(),
      false,
      `${name}: a suggestion never confirms`,
    );
    assert.equal(
      await runButton().isEnabled(),
      false,
      `${name}: the run waits for the accountant's confirmation`,
    );
    await confirmBox().check();
    await runButton().click();
    await page.getByTestId('allocation-result').waitFor();
    // After the run the files are put back; what they hold still shows as
    // theirs.
    await cardSaysFiles(name, 'after the run');
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
    .locator('select[data-reconciliation-type-select]')
    .selectOption('supplier');
  await openDomainWorkspace(page, 'allocation');
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
  await openFields();
  await page.getByLabel('Supplier', { exact: true }).fill('Changed supplier');
  assert.equal(await page.getByTestId('allocation-result').count(), 0);
  assert.equal(await confirmBox().isChecked(), false);
  assert.equal((await cardField('party')).origin, 'user');
  // Rows that disagree leave the field a question: emptied, the fields
  // open, each value shown with its file and count. New files never write
  // over the accountant's entry.
  await load('currency-mismatch');
  const party = await cardField('party');
  assert.equal(party.value, 'Changed supplier', 'the entry is kept');
  assert.equal(party.origin, 'user');
  assert.equal(party.hint, 'Your entry');
  const mixed = await filesSay('currency-mismatch');
  assert.equal(
    mixed.currency.counts.size,
    2,
    'the two files differ in currency',
  );
  const currency = await cardField('currency');
  assert.equal(currency.origin, 'question');
  assert.equal(currency.value, '', 'a disagreement is never filled');
  assert.equal(currency.hint, 'The rows disagree, so enter the value');
  assert.deepEqual(
    currency.values,
    [...mixed.currency.counts].flatMap(([value, bySide]) =>
      [...bySide].map(([side, n]) => `“${value}” in ${side}: ${n}`),
    ),
  );
  assert.equal(await card.locator('details').getAttribute('open'), '');
  assert.equal(await confirmBox().isChecked(), false);
  await page.getByLabel('Supplier', { exact: true }).fill(truth.scope.party);
  await page.getByLabel('Currency', { exact: true }).fill(truth.scope.currency);
  assert.equal(
    await card.locator('details').getAttribute('open'),
    '',
    'answering the last question does not fold the field being typed in',
  );
  await confirmBox().check();
  await runButton().click();
  await page.getByTestId('allocation-result').waitFor();
  assert.equal(
    await page.getByLabel('Currency', { exact: true }).inputValue(),
    truth.scope.currency,
    'the typed scope is kept after the run',
  );
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
  // A field that takes one value only keeps it when the files hold another,
  // and says the comparison takes only that value, so the files are what to
  // correct; the files' values are listed under it.
  for (const side of [0, 1, 2]) {
    const text = await readFile(
        `audit/allocation/frozen/one-to-many-${side}.csv`,
        'utf8',
      ),
      changed = side
        ? text
        : text.replaceAll(
            ',before-proposed-allocation,',
            ',after-proposed-allocation,',
          );
    if (!side) assert.notEqual(changed, text, 'the payments name a basis');
    const file = `${out}/allocation-basis-${side}.csv`;
    await writeFile(file, changed);
    const source = page.getByTestId(`allocation-source-${side}`);
    await source.getByLabel(sides[side], { exact: true }).setInputFiles(file);
    await source
      .getByRole('heading', { name: file.split('/').at(-1), exact: true })
      .waitFor();
  }
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
  );
  const basis = await cardField('basis');
  assert.equal(basis.origin, 'question');
  assert.equal(
    basis.value,
    truth.scope.basis,
    'a field that takes one value keeps it',
  );
  assert.equal(
    basis.hint,
    'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
  );
  assert.deepEqual(basis.values, [
    '“after-proposed-allocation” in Available payments: 1',
    `“${truth.scope.basis}” in Open invoices: 3`,
    `“${truth.scope.basis}” in Proposed remittance: 3`,
  ]);
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
