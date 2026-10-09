// Browser acceptance of a partial-input build. No engine imports or application writes.
// MIZAN_CHROMIUM=... node audit/partial-input/browser/run.mjs candidate-name
// LIVE_URL=https://host/path/ uses the same UI audit against an already published build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const runName =
  process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
assert.match(runName, /^[a-zA-Z0-9_-]+$/);
const out = path.resolve('audit/partial-input/browser', runName);
const root = path.resolve(process.env.DIST ?? 'dist');
await mkdir(out, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(dir, prefix = '') {
  const entries = [];
  for (const f of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = path.join(prefix, f.name);
    if (f.isDirectory())
      entries.push(...(await fingerprint(path.join(dir, f.name), rel)));
    else {
      const bytes = await readFile(path.join(dir, f.name));
      entries.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return entries;
}
const report = {
  runName,
  startedAt: new Date().toISOString(),
  sourceRevisionAtStart: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  mode: process.env.LIVE_URL ? 'live' : 'local',
  buildRoot: root,
  buildAssets: await fingerprint(root),
  scope:
    'Synthetic partial-input browser check: real CSV upload, isolated errors, paginated AR/EN issues, balance-mode partial status, export and session restoration. No engine imports or financial injections.',
  requests: [],
  externalRequests: [],
  nonGetRequests: [],
  pageErrors: [],
  workers: [],
  codeErrors: [],
  loadedCode: [],
  checks: [],
};
let server;
let url = process.env.LIVE_URL;
if (!url) {
  server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      ).replace(/^\/mizan-test\//, '/');
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
          }[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/mizan-test/`;
}
const base = new URL(url);
assert.ok(['http:', 'https:'].includes(base.protocol));
report.url = url;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
let currentPage;
const responseChecks = [];
async function open(lang) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1050 },
  });
  context.setDefaultTimeout(45000);
  context.on('page', (p) => {
    p.on('pageerror', (e) => report.pageErrors.push(e.message));
    p.on('worker', (worker) => report.workers.push(worker.url()));
  });
  context.on('request', (r) => {
    const u = new URL(r.url());
    const item = { method: r.method(), url: r.url() };
    report.requests.push(item);
    if (u.origin !== base.origin && !['blob:', 'data:'].includes(u.protocol))
      report.externalRequests.push(item);
    if (r.method() !== 'GET') report.nonGetRequests.push(item);
  });
  context.on('response', (response) => {
    const u = new URL(response.url());
    if (u.origin !== base.origin || !/\.(?:js|css)$/.test(u.pathname)) return;
    // A live run must execute the same frozen code, not merely display its version string.
    responseChecks.push(
      response
        .body()
        .then((bytes) => {
          const rel = u.pathname.slice(u.pathname.lastIndexOf('/assets/') + 1);
          const expected = report.buildAssets.find(
            (asset) => asset.path === rel,
          );
          const hash = sha256(bytes);
          report.loadedCode.push({
            url: response.url(),
            path: rel,
            sha256: hash,
            matchesDist: expected?.sha256 === hash,
          });
          assert.ok(expected, `Unexpected built code asset: ${rel}`);
          assert.equal(
            hash,
            expected.sha256,
            `Loaded code differs from the frozen build: ${rel}`,
          );
        })
        .catch((error) => report.codeErrors.push(error.message)),
    );
  });
  const page = (currentPage = await context.newPage());
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (lang === 'en') await switchLanguage(page, lang);
  // The current directory explicitly opens the retained supplier workflow.
  await page.locator('[data-domain-entry="supplier"]').click();
  await page.locator('.workflow-title:visible').waitFor({ state: 'visible' });
  assert.match(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content'),
    /connect-src 'none'/,
  );
  return { page, context };
}
async function switchLanguage(page, lang) {
  await page.locator(`.language-switch button[lang="${lang}"]:visible`).first().click();
  await page.waitForFunction(
    (wanted) => document.documentElement.lang === wanted,
    lang,
  );
}

const contract = process.argv[3] ?? 'isolated';
assert.ok(['isolated', 'original'].includes(contract));
report.contract = contract;
const fixtures = path.resolve(
  'audit/partial-input/browser',
  contract === 'original' ? 'fixtures' : 'fixtures-isolated',
);
const displacedFixtures = path.resolve('audit/partial-input/browser/fixtures');
const oracle = JSON.parse(
  await readFile(path.join(fixtures, 'oracle.json'), 'utf8'),
);
report.fixtures = await fingerprint(fixtures);
report.displacedFixtures = await fingerprint(displacedFixtures);
const L = {
  ar: {
    partial: 'نتيجة جزئية — توجد ملاحظات تحتاج مراجعة',
    show: 'عرض جميع ملاحظات القراءة (13)',
    table: 'تفاصيل ملاحظات القراءة',
    next: 'الملاحظات التالية',
    previous: 'الملاحظات السابقة',
  },
  en: {
    partial: 'Partial result — some issues need review',
    show: 'Show all reading issues (13)',
    table: 'Reading issue details',
    next: 'Next issues',
    previous: 'Previous issues',
  },
};
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
}
async function upload(page, sourceDirectory = fixtures) {
  for (const [side, label] of [
    ['supplier', 'Supplier statement'],
    ['ledger', 'Accounts payable report'],
  ]) {
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles(path.join(sourceDirectory, `partial-${side}.csv`));
    await idle(page);
  }
  await page.getByRole('button', { name: 'Confirm data', exact: true }).click();
  // Missing currency automatically opens the scope panel after preparation.
  // Wait for that effect; clicking a stale collapsed-state toggle can close it.
  await page
    .getByLabel('Currency', { exact: true })
    .waitFor({ state: 'visible' });
  await page.getByLabel('Currency', { exact: true }).fill('SAR');
  await page.getByLabel('Cut-off date', { exact: true }).fill('2026-07-31');
  // Deliberately enable balance mode to ensure the partial banner is not hidden
  // when the fourth metric is used for balances. No balance proof is asserted.
  await page
    .getByRole('checkbox', { name: 'Also reconcile balances', exact: true })
    .check();
  await page
    .getByLabel('Supplier', { exact: true })
    .fill('Synthetic partial supplier');
  await page
    .getByLabel('Legal entity', { exact: true })
    .fill('Synthetic partial buyer');
  await page.getByLabel('Account scope', { exact: true }).fill('PART-AP');
  await page
    .getByRole('checkbox', {
      name: /I have checked that both reports cover the same period/,
    })
    .check();
  await page
    .getByRole('button', { name: 'Check and compare', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Review workspace', exact: true })
    .waitFor();
}
async function issues(page, lang, tag) {
  const text = L[lang];
  await page.getByText(text.partial, { exact: true }).waitFor();
  const disclosure = page.getByText(text.show, { exact: true });
  const details = disclosure.locator('..');
  if ((await details.getAttribute('open')) === null) await disclosure.click();
  const table = page.getByRole('table', { name: text.table, exact: true });
  await table.waitFor();
  const previous = details.getByRole('button', {
    name: text.previous,
    exact: true,
  });
  if (await previous.isEnabled()) await previous.click();
  await page.waitForFunction(
    (label) =>
      document.querySelector(`table[aria-label="${label}"] tbody`)?.children
        .length === 10,
    text.table,
  );
  assert.equal(await table.locator('tbody tr').count(), 10);
  const wrapped = await table
    .locator('tbody td')
    .evaluateAll((cells) =>
      cells.every(
        (cell) =>
          getComputedStyle(cell).whiteSpace !== 'nowrap' &&
          cell.scrollWidth <= cell.clientWidth + 1,
      ),
    );
  assert.equal(
    wrapped,
    true,
    'All issue reasons and original values wrap without clipped horizontal text',
  );

  let body = await table.innerText();
  assert.ok(
    body.includes('INV-PART-ERR-1') &&
      body.includes('INV-PART-ERR-10') &&
      body.includes('unread'),
  );
  if (lang === 'en') assert.doesNotMatch(body, /[؀-ۿ]/);
  await details.getByRole('button', { name: text.next, exact: true }).click();
  await page.waitForFunction(
    (label) =>
      document.querySelector(`table[aria-label="${label}"] tbody`)?.children
        .length === 3,
    text.table,
  );
  body = await table.innerText();
  assert.ok(
    body.includes('INV-PART-ERR-11') &&
      body.includes('INV-PART-ERR-13') &&
      body.includes('unread'),
  );
  assert.ok(!body.includes('INV-PART-ERR-10'));
  assert.equal(
    await details
      .getByRole('button', { name: text.next, exact: true })
      .isDisabled(),
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: path.join(out, `${tag}.png`), fullPage: true });
  await writeFile(
    path.join(out, `${tag}-visible.txt`),
    await page.locator('body').innerText(),
  );
  report.checks.push({
    check: 'all-reading-issues-paginated',
    lang,
    rows: 13,
    pages: [10, 3],
    balanceModePartialVisible: true,
    fullReasonAndOriginalValuesWrap: true,
  });
}
function records(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map(String);
  return Array.from({ length: sheet.rowCount - 1 }, (_, i) =>
    Object.fromEntries(
      headers.map((h, c) => [h, sheet.getCell(i + 2, c + 1).value]),
    ),
  );
}
try {
  report.stage = 'partial-comparison';
  const active = await open('en');
  await upload(active.page);
  assert.deepEqual(
    (await active.page.locator('.metric strong').allInnerTexts()).slice(0, 3),
    ['2', '0', '0'],
  );
  await issues(active.page, 'en', 'partial-en');
  await switchLanguage(active.page, 'ar');
  await issues(active.page, 'ar', 'partial-ar');
  await switchLanguage(active.page, 'en');
  report.stage = 'assistant';
  await active.page
    .getByRole('button', { name: 'Result assistant', exact: true })
    .click();
  await active.page
    .getByRole('button', { name: 'What should I review next?', exact: true })
    .click();
  await active.page.getByText(/Review the reading issues first/).waitFor();
  assert.ok(
    (await active.page.locator('body').innerText()).includes(
      'Partial result: processed transactions 4; rows needing reading review 13',
    ),
  );
  report.checks.push({
    check: 'assistant-prioritizes-errors-and-discloses-partial',
  });
  report.stage = 'partial-export';
  await active.page
    .getByRole('button', { name: 'Prepare the workpaper', exact: true })
    .click();
  await active.page
    .getByRole('textbox', { name: 'Reviewer name', exact: true })
    .fill('Synthetic partial reviewer');
  await active.page
    .getByRole('checkbox', {
      name: /I have reviewed the workpaper and the remaining cases/,
    })
    .check();
  await active.page.getByText(L.en.partial, { exact: true }).waitFor();
  const download = active.page.waitForEvent('download');
  await active.page
    .getByRole('button', { name: 'Download partial workpaper', exact: true })
    .click();
  const workbookPath = path.join(out, 'partial.xlsx');
  await (await download).saveAs(workbookPath);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(workbookPath);
  const rows = records(book.getWorksheet('Reading Issues'));
  assert.equal(rows.length, 13);
  assert.deepEqual(
    rows.map((r) => JSON.parse(r['Original Values'])),
    oracle.readingIssues.map((i) => i.rawValues),
  );
  assert.deepEqual(
    // oxlint-disable-next-line typescript/require-array-sort-compare -- Fixture membership/verdict canonicalization intentionally retains native UTF-16 and ToString ordering.
    records(book.getWorksheet('Match Evidence'))
      .map((r) => r['Source Row ID'])
      .sort(),
    oracle.requiredPairs.flat().sort(),
  );
  const summary = Object.fromEntries(
    records(book.getWorksheet('Summary')).map((r) => [
      r['Field / الحقل'],
      r['Value / القيمة'],
    ]),
  );
  assert.match(summary['Reading Status'], /Partial/);
  assert.match(summary['Reviewer Status'], /open reading issues/);
  assert.equal(summary['Supplier Processed Transaction Total'], 350);
  assert.equal(summary['Ledger Processed Transaction Total'], 350);
  report.checks.push({
    check: 'partial-export-after-review',
    readingIssues: 13,
    matchedCases: 2,
    exactEvidenceMembers: 4,
    processedTotalMinorEachSide: 35000,
  });
  const saved = active.page.waitForEvent('download');
  await active.page
    .getByRole('button', {
      name: 'Save session to continue later',
      exact: true,
    })
    .click();
  const sessionPath = path.join(out, 'partial-session.json');
  await (await saved).saveAs(sessionPath);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.equal(session.engine, '0.3.26-experimental');
  report.engine = session.engine;
  await active.context.close();
  report.stage = 'restore-partial';
  const restored = await open('en');
  await restored.page
    .getByLabel('Resume a local session', { exact: true })
    .setInputFiles(sessionPath);
  await restored.page
    .getByRole('heading', { name: 'Review workspace', exact: true })
    .waitFor();
  await issues(restored.page, 'en', 'restored-partial-en');
  assert.deepEqual(
    (await restored.page.locator('.metric strong').allInnerTexts()).slice(0, 3),
    ['2', '0', '0'],
  );
  report.checks.push({
    check: 'session-recomputes-partial-originals',
    matchedCases: 2,
    unreadRows: 13,
  });
  await restored.context.close();
  report.stage = 'genuine-format-ambiguity';
  const ambiguous = await open('en');
  for (const [i, label] of [
    'Supplier statement',
    'Accounts payable report',
  ].entries()) {
    await ambiguous.page.getByLabel(label, { exact: true }).setInputFiles({
      name: `ambiguous-${i}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Date,Reference,Amount\r\n03/04/2026,INV-AMB-001,100.00\r\n04/05/2026,INV-AMB-002,200.00',
      ),
    });
    await idle(ambiguous.page);
  }
  await ambiguous.page
    .getByRole('button', { name: 'Confirm data', exact: true })
    .click();
  await ambiguous.page
    .getByLabel('Currency', { exact: true })
    .waitFor({ state: 'visible' });
  await ambiguous.page.getByLabel('Currency', { exact: true }).fill('SAR');
  await ambiguous.page
    .getByLabel('Cut-off date', { exact: true })
    .fill('2026-12-31');
  assert.equal(
    await ambiguous.page
      .getByRole('button', { name: 'Check and compare', exact: true })
      .isDisabled(),
    true,
  );
  assert.ok(
    (await ambiguous.page
      .getByRole('combobox', { name: /Date format in/ })
      .count()) > 0,
  );
  report.checks.push({
    check: 'unresolved-genuine-format-ambiguity-still-blocked',
  });
  await ambiguous.context.close();
  report.stage = 'final-integrity';
  await Promise.all(responseChecks);
  assert.deepEqual(report.codeErrors, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(await fingerprint(root), report.buildAssets);
  assert.deepEqual(await fingerprint(fixtures), report.fixtures);
  assert.deepEqual(
    await fingerprint(displacedFixtures),
    report.displacedFixtures,
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(out, 'failure-visible.txt'),
      await currentPage.locator('body').innerText(),
    ).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled(responseChecks);
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify({
      passed: report.passed,
      stage: report.stage,
      result: path.join(out, 'result.json'),
      error: report.error?.message,
    }),
  );
}
