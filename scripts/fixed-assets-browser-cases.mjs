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
  await page
    .getByRole('button', {
      name: 'Posted fixed assets / GL component evidence',
      exact: true,
    })
    .click();
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
  await sample();
  assert.equal(await status.innerText(), 'Whole asset review required');
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
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
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
  await w.locator('fieldset:has(input[type="file"])').nth(3).getByRole('checkbox').check();
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
  const roles = [
    'Posted asset component register',
    'Proposed asset component / GL mapping',
    'Independent supplied asset policy evidence',
    'Selected asset GL balances',
  ];
  for (let i = 0; i < 4; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/fixed-assets/cases/opposite-cost-differences-zero-grand/source-${i}.csv`,
      );
    await wait();
    await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
  }
  await attestation().check();
  await button('Check asset components / GL').click();
  await wait();
  assert.equal(await status.innerText(), 'Per-component account difference');
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-opposite-differences.xlsx');
  await sample();
  for (let i = 0; i < 4; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/fixed-assets/cases/component-differences-masked-by-net/source-${i}.csv`,
      );
    await wait();
    await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
  }
  await attestation().check();
  await button('Check asset components / GL').click();
  await wait();
  assert.equal(await status.innerText(), 'Per-component account difference');
  assert.equal(await button('Approve whole asset scope').isEnabled(), false);
  await download('Export asset evidence', 'ui-net-masked-components.xlsx');
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
  await w
    .getByLabel('Asset scope Map version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  assert.equal(await button('Export asset evidence').isEnabled(), false);
  const result = {
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
