import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyStock(
  page,
  url,
  out = 'work/inventory-register/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Posted inventory register / GL evidence',
      exact: true,
    })
    .click();
  const w = page.locator('[data-stock-workspace]'),
    status = w.locator('[data-stock-status]'),
    button = (name) => w.getByRole('button', { name, exact: true });
  const wait = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-stock-workspace]')
          ?.getAttribute('aria-busy') === 'false',
    );
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
  };
  const sample = async () => {
    await button('Open a synthetic inventory example').click();
    await status.waitFor();
    await wait();
  };
  const attestation = () =>
    w.getByLabel(
      'I reviewed the supplied register, all proposed mappings, policy evidence and every supplied GL account, including zero accounts.',
      { exact: true },
    );
  const reference = () =>
      w.getByLabel('Inventory decision reference', { exact: true }),
    note = () =>
      w.getByLabel('Inventory decision explanation', { exact: true });
  await sample();
  assert.equal(await status.innerText(), 'Whole inventory review required');
  assert.equal(
    await button('Approve whole inventory scope').isEnabled(),
    false,
  );
  await download('Export inventory evidence', 'ui-pending.xlsx');
  await reference().fill('SYNTHETIC');
  await note().fill('Whole supplied scope only');
  await button('Approve whole inventory scope').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export inventory evidence', 'ui-accepted.xlsx');
  await download('Save inventory session', 'ui-session.json');
  const session = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].memberIds.length, 7);
  assert.equal(session.files.length, 4);
  assert.ok(session.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo inventory decision').click();
  await wait();
  assert.equal(await status.innerText(), 'Whole inventory review required');
  await download('Export inventory evidence', 'ui-undo.xlsx');
  await button('Reject whole inventory scope').click();
  await wait();
  await download('Export inventory evidence', 'ui-reject.xlsx');
  await w
    .getByLabel('Restore inventory session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await download('Export inventory evidence', 'ui-restored.xlsx');
  await writeFile(
    `${out}/bad-session.json`,
    JSON.stringify({
      ...session,
      result: { status: 'consistent-with-evidence' },
    }),
  );
  await w
    .getByLabel('Restore inventory session', { exact: true })
    .setInputFiles(`${out}/bad-session.json`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await writeFile(`${out}/bad-encoding.csv`, Buffer.from([0xc0, 0xaf]));
  await w
    .getByLabel('Posted inventory register', { exact: true })
    .setInputFiles(`${out}/bad-encoding.csv`);
  await wait();
  await w.getByRole('alert').waitFor();
  assert.equal(
    await status.innerText(),
    'Consistent within confirmed evidence',
  );
  await w
    .getByLabel('Posted inventory register', { exact: true })
    .setInputFiles(
      'audit/inventory-register/cases/malformed-competitor-still-member/source-0.csv',
    );
  await wait();
  assert.equal(await status.count(), 0);
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
  await attestation().check();
  await button('Check inventory / GL').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Source blocked; financial totals withheld',
  );
  assert.equal(
    await button('Approve whole inventory scope').isEnabled(),
    false,
  );
  await button('Reject whole inventory scope').click();
  await wait();
  await download('Export inventory evidence', 'ui-malformed-reject.xlsx');
  await sample();
  await w
    .getByLabel('Selected inventory GL balances', { exact: true })
    .setInputFiles(
      'audit/inventory-register/cases/unmapped-zero-gl-not-dropped/source-3.csv',
    );
  await wait();
  await w.locator('fieldset:has(input[type="file"])').nth(3).getByRole('checkbox').check();
  await attestation().check();
  await button('Check inventory / GL').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Evidence or account coverage missing',
  );
  assert.equal(
    await button('Approve whole inventory scope').isEnabled(),
    false,
  );
  await download('Export inventory evidence', 'ui-unmapped-zero.xlsx');
  await sample();
  const roles = [
    'Posted inventory register',
    'Proposed item / GL mapping',
    'Independent supplied policy evidence',
    'Selected inventory GL balances',
  ];
  for (let i = 0; i < 4; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/inventory-register/cases/opposite-account-differences-zero-grand/source-${i}.csv`,
      );
    await wait();
    await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
  }
  await attestation().check();
  await button('Check inventory / GL').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Per-account carrying value difference',
  );
  assert.equal(
    await button('Approve whole inventory scope').isEnabled(),
    false,
  );
  await download('Export inventory evidence', 'ui-opposite-differences.xlsx');
  await sample();
  const figures = await w.locator('td').allTextContents();
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.equal(await status.innerText(), 'تلزم مراجعة كامل المخزون');
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
  await w.getByLabel('Inventory scope Map version', { exact: true }).fill('changed');
  assert.equal(await status.count(), 0);
  assert.equal(await button('Export inventory evidence').isEnabled(), false);
  const result = {
    downloadedBooks: 8,
    wholeMembers: 7,
    malformedMembers: 8,
    unitsSeparate: true,
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
