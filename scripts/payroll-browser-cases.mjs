import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyPayroll(page, url, out = 'work/payroll/browser') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Posted payroll / GL and bank payout evidence',
      exact: true,
    })
    .click();
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
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
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
  await sample();
  assert.equal(await status.innerText(), 'Whole payroll review required');
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
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
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
  await w.locator('fieldset:has(input[type="file"])').nth(3).getByRole('checkbox').check();
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
  const roles = [
    'Posted employee payroll register',
    'Proposed employee component / GL mapping',
    'Independent supplied payroll policy evidence',
    'Selected posted payroll and disbursement GL entries',
    'Independent posted bank payout',
  ];
  for (let i = 0; i < 5; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/payroll/cases/opposed-account-differences-zero-grand/source-${i}.csv`,
      );
    await wait();
    await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
  }
  await attestation().check();
  await button('Check payroll components / GL / bank').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-opposite-differences.xlsx');
  await sample();
  for (let i = 0; i < 5; i++) {
    await w
      .getByLabel(roles[i], { exact: true })
      .setInputFiles(
        `audit/payroll/cases/gross-deduction-differences-net-masked/source-${i}.csv`,
      );
    await wait();
    await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
  }
  await attestation().check();
  await button('Check payroll components / GL / bank').click();
  await wait();
  assert.equal(
    await status.innerText(),
    'Payroll component or bank payout difference',
  );
  assert.equal(await button('Approve whole payroll scope').isEnabled(), false);
  await download('Export payroll evidence', 'ui-net-masked-components.xlsx');
  const loadCase = async (name) => {
    await sample();
    for (let i = 0; i < 5; i++) {
      await w
        .getByLabel(roles[i], { exact: true })
        .setInputFiles(`audit/payroll/cases/${name}/source-${i}.csv`);
      await wait();
      await w.locator('fieldset:has(input[type="file"])').nth(i).getByRole('checkbox').check();
    }
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
  await w
    .getByLabel('Payroll scope Map version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  assert.equal(await button('Export payroll evidence').isEnabled(), false);
  const result = {
    downloadedBooks: 12,
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
