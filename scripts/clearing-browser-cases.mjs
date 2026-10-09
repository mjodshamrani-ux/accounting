import assert from 'node:assert/strict';
import { revealDomainEntry } from './domain-navigation-support.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function verifyClearing(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('button', { name: 'مقاصة داخل حساب', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'مقاصة داخل حساب واحد', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Single-account clearing', exact: true })
    .waitFor();
  await page
    .getByLabel('Clearing movements file', { exact: true })
    .setInputFiles('audit/clearing/frozen/source.csv');
  await page
    .getByRole('heading', { name: 'source.csv', exact: true })
    .waitFor();
  const columns = {
    'Unique posting ID': '0',
    'Clearing reference': '1',
    'Movement date': '2',
    'Signed amount': '3',
    Account: '4',
    Currency: '5',
    Description: '6',
  };
  for (const [label, value] of Object.entries(columns))
    await page
      .getByLabel(label, { exact: true })
      .filter({ has: page.locator('option') })
      .selectOption(value);
  for (const [label, value] of Object.entries({
    Entity: 'Synthetic Entity',
    Ledger: 'Synthetic Ledger',
    Account: '2150',
    Currency: 'SAR',
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  }))
    await page
      .getByLabel(label, { exact: true })
      .filter({ visible: true })
      .filter({ hasNot: page.locator('option') })
      .fill(value);
  await page
    .getByLabel('I reviewed the column meanings and scope:', { exact: false })
    .check();
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  const metric = () => page.getByTestId('clearing-metrics').locator('strong');
  assert.deepEqual(await metric().allTextContents(), ['9', '5', '0', '10.00']);
  assert.equal(await page.getByTestId('clearing-case').count(), 5);
  await page.getByLabel('Members: P006', { exact: true }).check();
  await page.getByLabel('Members: P007', { exact: true }).check();
  await page
    .getByLabel('Review decision reason', { exact: true })
    .fill(
      'Synthetic external advice confirms these two postings offset; human decision only.',
    );
  await page
    .getByRole('button', {
      name: 'Record human clearing for selected members',
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="clearing-metrics"]')
      ?.textContent.includes('Cleared movements7'),
  );
  const save = async (button, path) => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await event).saveAs(path);
  };
  await save('Download clearing workpaper', `${out}/clearing-manual.xlsx`);
  await page
    .getByTestId('clearing-case')
    .filter({ hasText: 'P001, P002, P003' })
    .getByRole('button', { name: 'Reopen cleared group', exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="clearing-metrics"]')
      ?.textContent.includes('Cleared movements4'),
  );
  await save('Save clearing session', `${out}/clearing-session.json`);
  await save('Download clearing workpaper', `${out}/clearing-reopened.xlsx`);
  // Both domain workspaces retain their local state across navigation.
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'clearing');
  await page
    .getByRole('button', { name: 'Single-account clearing', exact: true })
    .click();
  assert.deepEqual(await metric().allTextContents(), ['9', '4', '0', '10.00']);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('heading', { name: 'نتيجة المقاصة', exact: true })
    .waitFor();
  assert.deepEqual(await metric().allTextContents(), ['9', '4', '0', '10.00']);
  await page.screenshot({ path: `${out}/clearing-ar.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'mobile clearing must not overflow page',
  );
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page.screenshot({
    path: `${out}/clearing-en-mobile.png`,
    fullPage: true,
  });
  // A fresh page re-reads the saved native bytes and replays both decisions.
  await page.reload();
  await page
    .getByRole('button', { name: 'Single-account clearing', exact: true })
    .click();
  await page
    .getByLabel('Restore clearing session', { exact: true })
    .setInputFiles(`${out}/clearing-session.json`);
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  assert.deepEqual(await metric().allTextContents(), ['9', '4', '0', '10.00']);
  await save('Download clearing workpaper', `${out}/clearing-restored.xlsx`);
  await page.getByLabel('Ledger', { exact: true }).fill('Changed ledger');
  assert.equal(
    await page
      .getByRole('heading', { name: 'Clearing result', exact: true })
      .count(),
    0,
    'changing scope must invalidate the previous result and decisions',
  );
  await page
    .getByLabel('I reviewed the column meanings and scope:', { exact: false })
    .check();
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Clearing result', exact: true })
    .waitFor();
  assert.deepEqual(await metric().allTextContents(), ['9', '5', '0', '10.00']);
  const bad =
    (await readFile('audit/clearing/frozen/source.csv', 'utf8')) +
    'P010,C001,2026-09-08,unread,2150,SAR,Unread competitor\n';
  await writeFile(`${out}/clearing-bad.csv`, bad);
  await page
    .getByLabel('Clearing movements file', { exact: true })
    .setInputFiles(`${out}/clearing-bad.csv`);
  await page
    .getByRole('heading', { name: 'clearing-bad.csv', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('heading', { name: 'Clearing result', exact: true })
      .count(),
    0,
    'replacement must not retain old result',
  );
  await writeFile(
    `${out}/clearing-browser.json`,
    JSON.stringify(
      {
        passed: true,
        sample: 'synthetic-development-not-field',
        checks: [
          'native CSV upload and explicit mapping',
          'positive complete groups',
          'amount-only stays review',
          'human decision',
          'reopen',
          'domain navigation retains state',
          'AR/EN and mobile',
          'native session replay',
          'scope invalidation',
          'file replacement',
        ],
        files: [
          'clearing-manual.xlsx',
          'clearing-reopened.xlsx',
          'clearing-restored.xlsx',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}

if (process.argv[1] === resolve(import.meta.filename)) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    context.on('request', (request) => {
      if (
        (!/^(blob:|data:)/.test(request.url()) &&
          !request
            .url()
            .startsWith(process.env.CLEARING_URL ?? 'http://127.0.0.1:4173')) ||
        request.method() !== 'GET'
      )
        network.push(request.url());
    });
    try {
      await verifyClearing(
        page,
        process.env.CLEARING_URL ?? 'http://127.0.0.1:4173/mizan-test/',
      );
    } catch (error) {
      await page.screenshot({
        path: 'work/qa/clearing-failure.png',
        fullPage: true,
      });
      console.error((await page.locator('body').innerText()).slice(-6000));
      throw error;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'Clearing browser lifecycle passed; no observed external or non-GET requests.',
    );
  } finally {
    await browser.close();
  }
}
