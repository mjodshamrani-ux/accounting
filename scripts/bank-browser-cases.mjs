import assert from 'node:assert/strict';
import { revealDomainEntry } from './domain-navigation-support.mjs';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
export async function verifyBank(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page.getByRole('button', { name: 'حركات البنك', exact: true }).click();
  await page
    .getByRole('heading', { name: 'حركات البنك ودفتر النقدية', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'افتح مثال حركات بنك اصطناعيًا', exact: true })
    .click();
  await page.getByTestId('bank-result').waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const truth = JSON.parse(
      await readFile('audit/bank/frozen/expected.json', 'utf8'),
    ),
    sides = ['Bank statement', 'Cashbook'],
    scopeLabels = [
      'Entity',
      'Ledger',
      'Bank account',
      'Currency',
      'Period start',
      'Period end',
    ];
  const table = (heading) =>
    page
      .getByRole('heading', { name: heading, exact: true })
      .locator('..')
      .locator('table');
  const rows = (heading) => table(heading).locator('tbody tr');
  async function upload(name, native = false) {
    for (const side of [0, 1]) {
      let file = `audit/bank/frozen/${name}-${side}.csv`;
      if (native) {
        file = `${out}/bank-native-source-${side}.xlsx`;
        await copyFile(`work/bank/exports/${name}-source-${side}.xlsx`, file);
      }
      const source = page.getByTestId(`bank-source-${side}`);
      await source.getByLabel(sides[side], { exact: true }).setInputFiles(file);
      await source.getByText(file.split('/').at(-1), { exact: true }).waitFor();
      await source
        .getByLabel(`${sides[side]} I reviewed this table`, { exact: false })
        .check();
    }
    for (const [i, label] of scopeLabels.entries())
      await page
        .getByLabel(label, { exact: true })
        .fill(Object.values(truth.scope)[i]);
    await page
      .getByLabel(
        'I reviewed the common entity, ledger, bank account, currency and period. This is a movement comparison; it does not close balances.',
        { exact: true },
      )
      .check();
    await page
      .getByRole('button', { name: 'Compare bank movements', exact: true })
      .click();
    await page.getByTestId('bank-result').waitFor();
  }
  async function evidence() {
    await page
      .getByLabel('Evidence reference', { exact: true })
      .fill('Synthetic bank review B1');
    await page
      .getByLabel('Decision or undo reason', { exact: true })
      .fill(
        'Synthetic complete members and dates reviewed; movement comparison only',
      );
  }
  async function download(button, file) {
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await promise).saveAs(`${out}/${file}`);
  }
  async function exportFile(file) {
    await download('Download bank movement workpaper', file);
  }
  async function eventCount(n) {
    await page.waitForFunction(
      ({ heading, n }) => {
        const h = [...document.querySelectorAll('h2')].find(
          (h) => h.textContent === heading,
        );
        return h?.parentElement.querySelectorAll('tbody tr').length === n;
      },
      { heading: 'Dated decisions', n },
    );
  }
  await exportFile('bank-direct.xlsx');
  await download('Save bank movement session', 'bank-session.json');
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'bank');
  await page
    .getByRole('button', { name: 'Bank movements', exact: true })
    .click();
  assert.equal(await rows('Original movements').count(), 4);
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-session.json`);
  await page.getByTestId('bank-result').waitFor();
  await exportFile('bank-restored.xlsx');
  await page
    .getByRole('button', { name: 'Review source cells', exact: true })
    .first()
    .click();
  assert.equal(
    await page
      .getByRole('heading', { name: /Source cell evidence/ })
      .locator('..')
      .locator('tbody tr')
      .count(),
    17,
  );
  await upload('individual');
  await evidence();
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(1);
  assert.ok(
    (await table('Whole movement cases').innerText()).includes(
      'Undone; requires review',
    ),
  );
  await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .click();
  await eventCount(2);
  await exportFile('bank-individual.xlsx');
  await upload('timing-after-cutoff');
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await evidence();
  await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .click();
  await eventCount(1);
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await exportFile('bank-timing-manual.xlsx');
  await download('Save bank movement session', 'bank-timing-session.json');
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-timing-session.json`);
  await eventCount(1);
  await exportFile('bank-timing-restored.xlsx');
  await evidence();
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(2);
  assert.equal(await rows('Value dates outside the period').count(), 1);
  await exportFile('bank-timing-undo.xlsx');
  await upload('no-identity');
  assert.equal(await rows('Whole movement cases').count(), 2);
  await evidence();
  const record = await rows('Original movements').evaluateAll((rows) =>
    rows.map((r) => ({
      side: r.children[0].textContent,
      ref: r.children[2].textContent,
    })),
  );
  assert.equal(record.length, 2);
  await page
    .getByLabel('Bank movement for human review', { exact: true })
    .selectOption({ label: 'B1 · -1,000.00' });
  await page
    .getByLabel('Cashbook movement for human review', { exact: true })
    .selectOption({ label: 'L1 · -1,000.00' });
  await page
    .getByRole('button', {
      name: 'Approve documented one-to-one pairing',
      exact: true,
    })
    .click();
  await eventCount(1);
  assert.equal(await rows('Whole movement cases').count(), 1);
  await exportFile('bank-noidentity-manual.xlsx');
  await page
    .getByRole('button', { name: 'Undo complete movement case', exact: true })
    .click();
  await eventCount(2);
  assert.equal(await rows('Whole movement cases').count(), 2);
  await exportFile('bank-noidentity-undo.xlsx');
  await upload('balanced-extra-members');
  await evidence();
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Approve complete eligible case',
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await exportFile('bank-policy-error.xlsx');
  await upload('wrong-fee-parent');
  await evidence();
  assert.ok(
    (await table('Every original source row').innerText()).includes(
      'Fee has no valid principal in the same group.',
    ),
  );
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.ok(
    (await table('جرد كل صف مصدر أصلي').innerText()).includes(
      'الرسم لا يرتبط بأصل صالح في المجموعة نفسها.',
    ),
  );
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.ok(
    (await page.getByTestId('bank-result').innerText()).includes(
      'Source errors',
    ),
  );
  for (const button of await page
    .getByRole('button', {
      name: 'Approve complete eligible case',
      exact: true,
    })
    .all())
    assert.equal(await button.isEnabled(), false);
  await exportFile('bank-source-error.xlsx');
  await upload('outgoing-fees', true);
  await exportFile('bank-native.xlsx');
  await download('Save bank movement session', 'bank-native-session.json');
  await page
    .getByLabel('Restore bank movement session', { exact: true })
    .setInputFiles(`${out}/bank-native-session.json`);
  await page.getByTestId('bank-result').waitFor();
  await exportFile('bank-native-restored.xlsx');
  await page.getByLabel('Bank statement', { exact: true }).setInputFiles({
    name: 'unsupported.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('synthetic rejected extension'),
  });
  await page.getByRole('alert').waitFor();
  assert.equal(await rows('Original movements').count(), 4);
  assert.ok(
    (await page.getByTestId('bank-result').innerText()).includes(
      'Supplied movements matched',
    ),
  );
  await page
    .getByLabel('Entity', { exact: true })
    .fill('Changed synthetic owner');
  assert.equal(await page.getByTestId('bank-result').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Compare bank movements', exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole('button', {
      name: 'Open synthetic bank movement example',
      exact: true,
    })
    .click();
  await page.getByTestId('bank-result').waitFor();
  for (const [lang, width] of [
    ['ar', 390],
    ['en', 320],
  ]) {
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'bank mobile root overflow',
    );
    await page.screenshot({
      path: `${out}/bank-${lang}-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { downloads: 12, synthetic: true, movementOnly: true };
}
