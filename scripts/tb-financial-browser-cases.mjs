import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyFinancial(
  page,
  url,
  out = 'work/tb-financial/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Trial balance and financial position',
      exact: true,
    })
    .click();
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
  const download = async (name, file) => {
    const p = page.waitForEvent('download');
    await button(name).click();
    await (await p).saveAs(`${out}/${file}`);
    await wait();
  };
  await button('Synthetic example').click();
  await status.waitFor();
  await wait();
  assert.equal(await status.innerText(), 'needs-review');
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
  assert.equal(await status.innerText(), 'consistent-with-evidence');
  await download('Export evidence', 'ui-accepted.xlsx');
  await download('Save session', 'ui-session.json');
  const saved = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(saved.events.length, 6);
  assert.equal(saved.events[1].mappingIds.length, 2);
  assert.equal(saved.files.length, 4);
  assert.ok(saved.files.every((f) => !Object.hasOwn(f, 'sheets')));
  await button('Undo decision').nth(1).click();
  await wait();
  assert.equal(await status.innerText(), 'needs-review');
  await download('Export evidence', 'ui-undo.xlsx');
  await button('Reject whole line').nth(1).click();
  await wait();
  assert.equal(await status.innerText(), 'needs-review');
  await download('Export evidence', 'ui-reject.xlsx');
  await w
    .getByLabel('Restore session', { exact: true })
    .setInputFiles(`${out}/ui-session.json`);
  await wait();
  assert.equal(await status.innerText(), 'consistent-with-evidence');
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
  assert.equal(await status.innerText(), 'consistent-with-evidence');
  // Changing an original invalidates both results and decisions, never reuses an approval.
  await w
    .getByLabel('Proposed mapping', { exact: true })
    .setInputFiles('audit/tb-financial/frozen/wrong-lines-equal-totals-1.csv');
  await wait();
  assert.equal(await status.count(), 0);
  const original = w.locator('fieldset:has(input[type="file"])').nth(1);
  await original.getByRole('checkbox').check();
  await w
    .getByLabel(
      'I reviewed completeness of supplied accounts, dimensions, mappings, evidence and statement lines',
      { exact: true },
    )
    .check();
  await button('Check mapping and amounts').click();
  await wait();
  assert.equal(await status.innerText(), 'source-error');
  assert.equal(await button('Accept whole line').first().isEnabled(), false);
  // Whole-line and two-column controls remain usable on mobile, both languages.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await w.getByRole('button', { name: 'AR العربية', exact: true }).click();
    await page.screenshot({ path: `${out}/ar-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'Arabic page must not overflow',
    );
    await w.getByRole('button', { name: 'EN English', exact: true }).click();
    await page.screenshot({ path: `${out}/en-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'English page must not overflow',
    );
  }
  return {
    downloads: 5,
    wholeLineMembers: 2,
    languages: 2,
    mobileWidths: [320, 390],
    restoreFailurePreserved: true,
    sourceChangeInvalidated: true,
  };
}
