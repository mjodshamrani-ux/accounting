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
  await page
    .getByRole('button', {
      name: 'Payment gateway batch evidence',
      exact: true,
    })
    .click();
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
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
  await w
    .getByLabel(
      'I reviewed all supplied transactions, independent fee detail, settlement and bank credit.',
      { exact: true },
    )
    .check();
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
  await w.locator('fieldset:has(input[type="file"])').nth(1).getByRole('checkbox').check();
  await w
    .getByLabel(
      'I reviewed all supplied transactions, independent fee detail, settlement and bank credit.',
      { exact: true },
    )
    .check();
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
  await w.locator('fieldset:has(input[type="file"])').nth(2).getByRole('checkbox').check();
  await w
    .getByLabel(
      'I reviewed all supplied transactions, independent fee detail, settlement and bank credit.',
      { exact: true },
    )
    .check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'A batch difference remains');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await download('Export gateway evidence', 'ui-gross-cancel.xlsx');
  // The declared comma reader must inventory semicolon-containing malformed
  // one-field records rather than attempting delimiter inference first.
  await button('Open a synthetic gateway example').click();
  await wait();
  await w.getByLabel('Gateway sales and refunds', { exact: true }).setInputFiles('audit/payment-gateway/comma-provenance/source-0.csv');
  await wait();
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
  await w.getByLabel('I reviewed all supplied transactions, independent fee detail, settlement and bank credit.', { exact: true }).check();
  await button('Check gateway batch').click();
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await button('Reject whole batch').click();
  await wait();
  await download('Export gateway evidence', 'ui-declared-comma-reject.xlsx');
  await download('Save gateway session', 'ui-declared-comma-reject-session.json');
  const declared = JSON.parse(await readFile(`${out}/ui-declared-comma-reject-session.json`, 'utf8'));
  assert.equal(declared.events[0].memberIds.length, 11);
  await w.getByLabel('Restore gateway session', { exact: true }).setInputFiles(`${out}/ui-declared-comma-reject-session.json`);
  await wait();
  assert.equal(await status.innerText(), 'Source evidence is invalid');
  assert.equal(await button('Approve whole batch').isEnabled(), false);
  await w
    .getByLabel('Gateway scope Policy version', { exact: true })
    .fill('changed');
  assert.equal(await status.count(), 0);
  await button('Open a synthetic gateway example').click();
  await wait();
  await status.waitFor();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await w.getByRole('button', { name: 'AR العربية', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await page.screenshot({ path: `${out}/ar-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'Arabic overflow',
    );
    await w.getByRole('button', { name: 'EN English', exact: true }).click();
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
