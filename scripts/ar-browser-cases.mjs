import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { revealDomainEntry } from './domain-navigation-support.mjs';
export async function verifyAr(page, url, out = 'work/qa') {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('button', { name: 'تسوية ذمم العملاء', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'مستندات ذمم العملاء', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open synthetic AR example', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(
    await page.getByTestId('ar-metrics').locator('strong').allTextContents(),
    ['6', '3', '0', '35.00', '35.00'],
  );
  const sides = ['Company AR ledger', 'Company-issued customer statement'];
  const columns = {
    'Unique posting ID': '0',
    'Document type': '1',
    'Own document number': '2',
    'Posting date': '3',
    'Original signed amount': '4',
    Entity: '5',
    Ledger: '6',
    'Customer ID': '7',
    Account: '8',
    Currency: '9',
    'Related invoice': '10',
    Description: '11',
  };
  for (const [side, label] of sides.entries()) {
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles(
        `audit/ar-limited/frozen/positive-${side === 0 ? 'ledger' : 'statement'}.csv`,
      );
    await page
      .getByRole('heading', {
        name: `positive-${side === 0 ? 'ledger' : 'statement'}.csv`,
        exact: true,
      })
      .waitFor();
    for (const [field, index] of Object.entries(columns))
      await page
        .getByLabel(`${label}: ${field}`, { exact: true })
        .selectOption(index);
    await page
      .getByLabel(`${label}: I reviewed this source:`, { exact: false })
      .check();
  }
  for (const [key, value] of Object.entries({
    Entity: 'Synthetic Seller',
    Ledger: 'AR Book',
    'Customer ID': 'C0001',
    Account: '1200',
    Currency: 'SAR',
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  }))
    await page.getByLabel(key, { exact: true }).fill(value);
  await page
    .getByLabel(
      'I reviewed the common entity, ledger, customer, account, currency and period.',
      { exact: false },
    )
    .check();
  await page
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await page
    .getByRole('heading', {
      name: 'AR document comparison result',
      exact: true,
    })
    .waitFor();
  const metrics = () => page.getByTestId('ar-metrics').locator('strong');
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '3',
    '0',
    '35.00',
    '35.00',
  ]);
  async function exportBook(name) {
    const request = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download AR workpaper', exact: true })
      .click();
    await (await request).saveAs(`${out}/${name}`);
  }
  await exportBook('ar-direct.xlsx');
  await page
    .getByLabel('Document review reason', { exact: true })
    .fill('Synthetic original document correspondence reopened for review');
  await page
    .getByTestId('ar-case')
    .filter({
      has: page.getByRole('heading', { name: 'Invoice: I001', exact: true }),
    })
    .getByRole('button', { name: 'Reopen document pair', exact: true })
    .click();
  await page
    .getByText('Approval cancelled; document pair remains for review', {
      exact: false,
    })
    .waitFor();
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '2',
    '0',
    '35.00',
    '35.00',
  ]);
  await exportBook('ar-reopened.xlsx');
  const sessionRequest = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Save AR session', exact: true })
    .click();
  await (await sessionRequest).saveAs(`${out}/ar-session.json`);
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'clearing');
  await page
    .getByRole('button', { name: 'Single-account clearing', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Open synthetic clearing example',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Check clearing', exact: true })
    .click();
  await page.getByTestId('clearing-metrics').waitFor();
  await page
    .getByRole('button', { name: 'Supplier reconciliation', exact: true })
    .click();
  await revealDomainEntry(page, 'ar');
  await page
    .getByRole('button', { name: 'Customer AR reconciliation', exact: true })
    .click();
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '2',
    '0',
    '35.00',
    '35.00',
  ]);
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page
    .getByRole('heading', {
      name: 'نتيجة مقارنة مستندات ذمم العملاء',
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${out}/ar-ar.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({ path: `${out}/ar-en-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.goto(url);
  await page
    .getByRole('button', { name: 'Customer AR reconciliation', exact: true })
    .click();
  await page
    .getByLabel('Restore AR session', { exact: true })
    .setInputFiles(`${out}/ar-session.json`);
  await page
    .getByRole('heading', {
      name: 'AR document comparison result',
      exact: true,
    })
    .waitFor();
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '2',
    '0',
    '35.00',
    '35.00',
  ]);
  await exportBook('ar-restored.xlsx');
  await page
    .getByLabel('Document review reason', { exact: true })
    .fill('Synthetic sources rechecked; confirm exact document counterpart');
  await page
    .getByRole('button', { name: 'Record human confirmation', exact: true })
    .click();
  await page
    .getByText('Human confirmation · Exact correspondence', { exact: false })
    .waitFor();
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '3',
    '0',
    '35.00',
    '35.00',
  ]);
  await exportBook('ar-reconfirmed.xlsx');
  await page.getByLabel('Customer ID', { exact: true }).fill('OTHER');
  assert.equal(await page.getByTestId('ar-metrics').count(), 0);
  assert.equal(
    await page
      .getByLabel(
        'I reviewed the common entity, ledger, customer, account, currency and period.',
        { exact: false },
      )
      .isChecked(),
    false,
  );
  await page.getByLabel('Customer ID', { exact: true }).fill('C0001');
  await page
    .getByLabel(
      'I reviewed the common entity, ledger, customer, account, currency and period.',
      { exact: false },
    )
    .check();
  await page
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(await metrics().allTextContents(), [
    '6',
    '3',
    '0',
    '35.00',
    '35.00',
  ]);
  // Native file replacement invalidates results and the corresponding reading approval.
  await page.getByLabel(sides[0], { exact: true }).setInputFiles({
    name: 'replacement.csv',
    mimeType: 'text/csv',
    buffer: await readFile('audit/ar-limited/frozen/positive-ledger.csv'),
  });
  await page
    .getByRole('heading', { name: 'replacement.csv', exact: true })
    .waitFor();
  assert.equal(await page.getByTestId('ar-metrics').count(), 0);
  assert.equal(
    await page
      .getByLabel(`${sides[0]}: I reviewed this source:`, { exact: false })
      .isChecked(),
    false,
  );
  // An original amount difference remains review-only through the visible workflow.
  for (const [side, label] of sides.entries()) {
    const name = `amount-difference-${side === 0 ? 'ledger' : 'statement'}.csv`;
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles(`audit/ar-limited/frozen/${name}`);
    await page.getByRole('heading', { name, exact: true }).waitFor();
    for (const [field, index] of Object.entries(columns))
      await page
        .getByLabel(`${label}: ${field}`, { exact: true })
        .selectOption(index);
    await page
      .getByLabel(`${label}: I reviewed this source:`, { exact: false })
      .check();
  }
  await page
    .getByLabel(
      'I reviewed the common entity, ledger, customer, account, currency and period.',
      { exact: false },
    )
    .check();
  await page
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await page.getByTestId('ar-metrics').waitFor();
  assert.deepEqual(await metrics().allTextContents(), [
    '2',
    '0',
    '0',
    '90.00',
    '91.00',
  ]);
  assert.equal(
    await page
      .getByRole('button', { name: 'Record human confirmation', exact: true })
      .count(),
    0,
  );
  await exportBook('ar-negative.xlsx');
  await writeFile(
    `${out}/ar-browser.json`,
    JSON.stringify(
      {
        passed: true,
        sample: 'synthetic-development-not-field',
        checks: [
          'native two-file upload and mapping',
          'own-document positive pairs',
          'reopen and human reconfirmation',
          'AP/clearing/AR navigation retains state',
          'Arabic/English/mobile',
          'session original byte replay',
          'scope and replacement invalidation',
          'native amount difference stays review-only',
        ],
        files: [
          'ar-direct.xlsx',
          'ar-reopened.xlsx',
          'ar-restored.xlsx',
          'ar-reconfirmed.xlsx',
          'ar-negative.xlsx',
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
    const page = await context.newPage(),
      errors = [],
      network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (
        (!['blob:', 'data:'].includes(u.protocol) &&
          u.origin !==
            new URL(process.env.AR_URL ?? 'http://127.0.0.1:4173').origin) ||
        r.method() !== 'GET'
      )
        network.push(r.url());
    });
    try {
      await verifyAr(page, process.env.AR_URL ?? 'http://127.0.0.1:4173/');
    } catch (e) {
      await page.screenshot({ path: 'work/qa/ar-failure.png', fullPage: true });
      console.error((await page.locator('body').innerText()).slice(-3500));
      throw e;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'AR browser lifecycle passed; no observed external or non-GET requests.',
    );
  } finally {
    await browser.close();
  }
}
