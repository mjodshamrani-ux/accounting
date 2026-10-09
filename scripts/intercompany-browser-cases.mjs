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
  await page
    .getByRole('button', {
      name: 'Intercompany transaction evidence',
      exact: true,
    })
    .click();
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
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
  };
  await button('Open a synthetic intercompany example').click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'Whole pair review required');
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
  await w.locator('fieldset:has(input[type="file"])').nth(2).getByRole('checkbox').check();
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
  await w.locator('fieldset:has(input[type="file"])').nth(0).getByRole('checkbox').check();
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
  await w
    .getByLabel('Intercompany scope Policy version', { exact: true })
    .fill('CHANGED');
  assert.equal(await status.count(), 0);
  await button('Open a synthetic intercompany example').click();
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
      'Arabic page overflow',
    );
    await w.getByRole('button', { name: 'EN English', exact: true }).click();
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
    downloads: 6,
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
