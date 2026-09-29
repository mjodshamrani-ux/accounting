// Browser acceptance of a large native-PDF build. No engine imports or application writes.
// MIZAN_CHROMIUM=... node audit/large-statements/browser/run.mjs candidate-name
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
const out = path.resolve('audit/large-statements/browser', runName);
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
    'Synthetic browser acceptance of native PDF progress, bounded page navigation, late-page failure/cancellation recovery, and a 70-page reconciliation/export/session. Worker observation records counters only; no financial responses are injected.',
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
  context.setDefaultTimeout(200000);
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
  await installObservation(context);
  const page = (currentPage = await context.newPage());
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (lang === 'en')
    await page.locator('.language-switch button[lang="en"]').click();
  assert.match(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content'),
    /connect-src 'none'/,
  );
  return { page, context };
}
async function switchLanguage(page, lang) {
  await page.locator(`.language-switch button[lang="${lang}"]`).click();
  await page.waitForFunction(
    (wanted) => document.documentElement.lang === wanted,
    lang,
  );
}

const fixtureRoot = path.resolve('audit/large-statements/frozen/fixtures');
const fixture = (name) => path.join(fixtureRoot, name);
const oracle70 = JSON.parse(await readFile(fixture('oracle-70.json'), 'utf8'));
const oracle100 = JSON.parse(await readFile(fixture('oracle-100.json'), 'utf8'));
report.fixtureHashes = await fingerprint(fixtureRoot);
report.observations = [];
report.manualChoices = [];

async function installObservation(context) {
  await context.addInitScript(() => {
    const trace = (window.__largePdfAudit = {
      requests: [], progress: [], statuses: [], terminated: [], errors: [],
      cancelNextReadAt: null, cancelClicked: false,
    });
    const NativeWorker = window.Worker;
    let serial = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.auditId = ++serial;
        this.addEventListener('message', (event) => {
          const value = event.data;
          if (value?.channel !== 'mizan-accounting-v1') return;
          if (value.kind === 'progress') {
            trace.progress.push({ worker: this.auditId, id: value.id, action: value.action, ...value.progress });
            if (trace.cancelNextReadAt !== null && value.progress.stage === 'pdf-read' && value.progress.completed >= trace.cancelNextReadAt) {
              trace.cancelNextReadAt = null;
              // Exercise the real Cancel button after real worker progress.
              queueMicrotask(() => {
                const cancel = document.querySelector('.notice.loading button');
                if (cancel) { trace.cancelClicked = true; cancel.click(); }
              });
            }
          } else if (value.ok === false) {
            trace.errors.push({ worker: this.auditId, id: value.id, error: value.error, diagnosis: value.diagnosis });
          }
        });
      }
      postMessage(message, ...args) {
        if (message?.channel === 'mizan-accounting-v1')
          trace.requests.push({ worker: this.auditId, id: message.id, action: message.action, name: message.payload?.name });
        return super.postMessage(message, ...args);
      }
      terminate() {
        trace.terminated.push(this.auditId);
        return super.terminate();
      }
    };
    const observe = () => {
      const status = document.querySelector('.notice.loading')?.textContent?.trim() ?? '';
      if (trace.statuses.at(-1) !== status) trace.statuses.push(status);
    };
    new MutationObserver(observe).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const labels = {
  ar: {
    supplier: 'كشف المورد', ledger: 'تقرير الحسابات الدائنة', confirm: 'تأكيد البيانات',
    pageNumber: 'رقم الصفحة', go: 'انتقال إلى الصفحة', previous: 'الصفحة السابقة',
    pageOf: (n, total) => `صفحة ${n} من ${total}`,
    currency: 'العملة', cutoff: 'تاريخ المقارنة', scope: 'تعديل نطاق المقارنة',
    run: 'تحقق وقارن', workspace: 'مساحة المراجعة',
  },
  en: {
    supplier: 'Supplier statement', ledger: 'Accounts payable report', confirm: 'Confirm data',
    pageNumber: 'Page number', go: 'Go to page', previous: 'Previous page',
    pageOf: (n, total) => `Page ${n} of ${total}`,
    currency: 'Currency', cutoff: 'Cut-off date', scope: 'Edit reconciliation scope',
    run: 'Check and compare', workspace: 'Review workspace',
  },
};
async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector('.notice.loading'), undefined, { timeout: 200000 });
}
async function upload(page, lang, side, name) {
  await page.getByLabel(labels[lang][side], { exact: true }).setInputFiles(fixture(name));
  await waitIdle(page);
}
async function snapshot(page, name) {
  await writeFile(path.join(out, `${name}-visible.txt`), await page.locator('body').innerText());
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
async function observations(page, tag) {
  const trace = await page.evaluate(() => window.__largePdfAudit);
  report.observations.push({ tag, ...trace });
  return trace;
}
function verifyProgress(trace, filename, pages) {
  const request = trace.requests.filter((r) => r.action === 'read' && r.name === filename).at(-1);
  assert.ok(request, filename);
  const progress = trace.progress.filter((p) => p.worker === request.worker && p.id === request.id);
  assert.deepEqual(progress.map(({ stage, completed, total }) => ({ stage, completed, total })),
    ['pdf-read', 'pdf-layout'].flatMap((stage) => Array.from({ length: pages + 1 }, (_, completed) => ({ stage, completed, total: pages }))));
  report.checks.push({ check: 'real-worker-page-progress', filename, pages, messages: progress.length });
}
async function jump(page, lang, n, total, reference) {
  const L = labels[lang];
  await page.getByRole('spinbutton', { name: L.pageNumber, exact: true }).fill(String(n));
  await page.getByRole('button', { name: L.go, exact: true }).click();
  await page.getByText(L.pageOf(n, total), { exact: true }).waitFor();
  if (reference) assert.ok((await page.locator('.panel.stack table').innerText()).includes(reference));
}
async function navigation(page, lang, oracle) {
  const total = oracle.pages, L = labels[lang];
  const review = page.getByRole('checkbox', { name: lang === 'ar' ? /راجعت الجدول في جميع الصفحات/ : /I have reviewed the table on every page/ });
  assert.equal(await review.isChecked(), false, 'reading completion must not approve the PDF');
  await jump(page, lang, total, total, oracle.transactions.at(-1).reference);
  for (const invalid of ['0', String(total + 1), '1.5', '']) {
    const field = page.getByRole('spinbutton', { name: L.pageNumber, exact: true });
    await field.fill(invalid);
    assert.equal(await page.getByRole('button', { name: L.go, exact: true }).isDisabled(), true);
    await field.press('Enter');
    assert.equal(await page.getByText(L.pageOf(total, total), { exact: true }).count(), 1);
  }
  await page.getByRole('button', { name: L.previous, exact: true }).click();
  await page.getByText(L.pageOf(total - 1, total), { exact: true }).waitFor();
  // The displayed page renders before the effect synchronizes the jump draft.
  await page.waitForFunction(({ label, wanted }) => document.querySelector(`input[aria-label="${label}"]`)?.value === wanted,
    { label: L.pageNumber, wanted: String(total - 1) });
  assert.equal(await page.getByRole('spinbutton', { name: L.pageNumber, exact: true }).inputValue(), String(total - 1));
  await jump(page, lang, 1, total, oracle.transactions[0].reference);
  assert.equal(await review.isChecked(), false);
  report.checks.push({ check: 'bounded-page-navigation', lang, pages: total, lastReference: oracle.transactions.at(-1).reference, invalid: ['0', String(total + 1), '1.5', ''], approvalRemainedFalse: true });
}
function records(sheet) {
  assert.ok(sheet);
  const headers = sheet.getRow(1).values.slice(1).map(String);
  return Array.from({ length: sheet.rowCount - 1 }, (_, i) => Object.fromEntries(headers.map((h, c) => [h, sheet.getCell(i + 2, c + 1).value])));
}
async function verifyExport(file) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const matches = records(book.getWorksheet('Matches'));
  const evidence = records(book.getWorksheet('Match Evidence'));
  assert.equal(matches.length, oracle70.requiredPairs);
  assert.equal(evidence.length, oracle70.requiredPairs * 2);
  const expectedIds = oracle70.transactions.flatMap((t) => [`supplier:0:${t.supplierSourceRow}`, `ledger:0:${t.ledgerSourceRow}`]).sort();
  assert.deepEqual(evidence.map((r) => r['Source Row ID']).sort(), expectedIds);
  assert.ok(matches.every((r) => r['Match Type'] === '1:1' && r['Match Decision'] === 'Auto'));
  assert.equal(matches.reduce((sum, r) => sum + Math.round(r['Supplier Amount'] * 100), 0), oracle70.totalMinor);
  assert.equal(matches.reduce((sum, r) => sum + Math.round(r['Ledger Amount'] * 100), 0), oracle70.totalMinor);
  report.checks.push({ check: 'xlsx-full-member-set', file: path.relative(out, file), matches: matches.length, sourceIds: evidence.length, totalMinorEachSide: oracle70.totalMinor });
}
try {
  report.stage = 'native-70-progress-and-navigation';
  const active = await open('ar');
  await upload(active.page, 'ar', 'supplier', 'native-70.pdf');
  assert.equal(await active.page.locator('.notice.error').count(), 0);
  const arTrace = await observations(active.page, 'native-70-ar');
  verifyProgress(arTrace, 'native-70.pdf', 70);
  assert.ok(arTrace.statuses.some((text) => /قراءة الصفحة \d+ من 70/.test(text)), 'Arabic reading status must render');
  await upload(active.page, 'ar', 'ledger', 'ledger-70.csv');
  await active.page.getByRole('button', { name: labels.ar.confirm, exact: true }).click();
  await navigation(active.page, 'ar', oracle70);
  await snapshot(active.page, 'native-70-ar');
  await switchLanguage(active.page, 'en');
  await navigation(active.page, 'en', oracle70);
  // Use the contract's explicit boundaries, recording a real user choice.
  await active.page.getByRole('button', { name: 'Edit column boundaries', exact: true }).click();
  const cuts = active.page.getByLabel('PDF column boundaries', { exact: true });
  const inferredCuts = await cuts.inputValue();
  await cuts.fill('25,49,68');
  const apply = active.page.getByRole('button', { name: 'Apply boundaries and re-read', exact: true });
  if (await apply.isEnabled()) { await apply.click(); await waitIdle(active.page); }
  report.manualChoices.push({ choice: 'PDF column boundaries', inferredCuts, applied: [25, 49, 68] });
  const scope = active.page.getByRole('button', { name: labels.en.scope, exact: true });
  if (await scope.getAttribute('aria-expanded') !== 'true') await scope.click();
  await active.page.getByLabel(labels.en.currency, { exact: true }).fill('SAR');
  await active.page.getByLabel(labels.en.cutoff, { exact: true }).fill('2026-08-31');
  await active.page.getByRole('checkbox', { name: /I have reviewed the table on every page/ }).check();
  report.manualChoices.push({ choice: 'Scope and PDF review', currency: 'SAR', cutoff: '2026-08-31', pdfReviewed: true, note: 'Explicit synthetic audit input; source IDs and totals are independently checked against the frozen oracle in exported output.' });
  await active.page.getByRole('button', { name: labels.en.run, exact: true }).click();
  await active.page.getByRole('heading', { name: labels.en.workspace, exact: true }).waitFor();
  assert.deepEqual((await active.page.locator('.metric strong').allInnerTexts()).map((s) => s.replace(/,/g, '')), [String(oracle70.requiredPairs), '0', '0', '0']);
  await snapshot(active.page, 'native-70-reconciled-en');
  report.checks.push({ check: '70-page-ui-reconciliation', matchedCases: oracle70.requiredPairs, manualMatches: 0, unmatched: 0, unread: 0 });
  report.stage = 'native-70-export-session';
  await active.page.getByRole('button', { name: 'Prepare the workpaper', exact: true }).click();
  await active.page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Synthetic large PDF reviewer');
  const exported = active.page.waitForEvent('download');
  await active.page.getByRole('button', { name: 'Download Excel draft', exact: true }).click();
  const workbookPath = path.join(out, 'native-70.xlsx');
  await (await exported).saveAs(workbookPath);
  await verifyExport(workbookPath);
  const saved = active.page.waitForEvent('download');
  await active.page.getByRole('button', { name: 'Save session to continue later', exact: true }).click();
  const sessionPath = path.join(out, 'native-70-session.json');
  await (await saved).saveAs(sessionPath);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.equal(session.engine, '0.3.21-experimental');
  assert.equal(session.decisions.length, 0);
  assert.equal(session.files[0].name, 'native-70.pdf');
  assert.equal(session.files[0].sha256, sha256(await readFile(fixture('native-70.pdf'))));
  assert.deepEqual(session.files[0].pdfCuts, [25, 49, 68]);
  report.engine = session.engine;
  report.checks.push({ check: 'saved-session', engine: session.engine, originalSource: session.files[0].name, originalHash: session.files[0].sha256, pdfCuts: session.files[0].pdfCuts, decisions: session.decisions.length });
  await observations(active.page, 'completed-70');
  await active.context.close();
  const restored = await open('en');
  await restored.page.getByLabel('Resume a local session', { exact: true }).setInputFiles(sessionPath);
  await restored.page.getByRole('heading', { name: labels.en.workspace, exact: true }).waitFor();
  assert.deepEqual((await restored.page.locator('.metric strong').allInnerTexts()).map((s) => s.replace(/,/g, '')), [String(oracle70.requiredPairs), '0', '0', '0']);
  report.checks.push({ check: 'fresh-page-session-restoration', matchedCases: oracle70.requiredPairs });
  await restored.context.close();

  report.stage = 'late-page-failure-and-cancellation';
  const recovery = await open('en');
  await upload(recovery.page, 'en', 'supplier', 'ledger-70.csv');
  await upload(recovery.page, 'en', 'supplier', 'empty-page-70.pdf');
  await recovery.page.locator('.notice.error').waitFor();
  assert.ok((await recovery.page.locator('body').innerText()).includes('ledger-70.csv'), 'the retained source must survive a late-page failure');
  assert.equal(await recovery.page.getByText('empty-page-70.pdf', { exact: true }).count(), 0);
  assert.equal(await recovery.page.locator('.notice.loading').count(), 0);
  const failedTrace = await observations(recovery.page, 'empty-page-70');
  assert.equal(failedTrace.errors.at(-1).diagnosis.page, 70);
  assert.equal(failedTrace.errors.at(-1).diagnosis.totalPages, 70);
  assert.ok(failedTrace.terminated.includes(failedTrace.errors.at(-1).worker));
  await snapshot(recovery.page, 'late-page-70-failure-en');
  report.checks.push({ check: 'late-page-failure-retains-source', failurePage: 70, retainedFile: 'ledger-70.csv', progressCleared: true, workerTerminated: true });
  await recovery.page.evaluate(() => { window.__largePdfAudit.cancelNextReadAt = 1; });
  await upload(recovery.page, 'en', 'supplier', 'native-100.pdf');
  await recovery.page.getByText('The operation was cancelled.', { exact: true }).waitFor();
  const canceled = await observations(recovery.page, 'native-100-canceled');
  assert.equal(canceled.cancelClicked, true);
  const canceledRequest = canceled.requests.filter((r) => r.name === 'native-100.pdf').at(-1);
  assert.ok(canceled.terminated.includes(canceledRequest.worker));
  assert.equal(await recovery.page.locator('.notice.loading').count(), 0);
  assert.ok((await recovery.page.locator('body').innerText()).includes('ledger-70.csv'));
  report.checks.push({ check: 'cancel-after-real-page-progress', retainedFile: 'ledger-70.csv', progressCleared: true, workerTerminated: true });
  report.stage = 'native-100-recovery-and-navigation';
  await upload(recovery.page, 'en', 'supplier', 'native-100.pdf');
  assert.equal(await recovery.page.locator('.notice.error').count(), 0);
  const recoveredTrace = await observations(recovery.page, 'native-100-recovered');
  verifyProgress(recoveredTrace, 'native-100.pdf', 100);
  const recoveredRequest = recoveredTrace.requests.filter((r) => r.name === 'native-100.pdf').at(-1);
  assert.notEqual(recoveredRequest.worker, canceledRequest.worker);
  assert.ok(recoveredTrace.statuses.some((text) => /Reading page \d+ of 100/.test(text)));
  await upload(recovery.page, 'en', 'ledger', 'ledger-100.csv');
  await recovery.page.getByRole('button', { name: labels.en.confirm, exact: true }).click();
  await navigation(recovery.page, 'en', oracle100);
  await snapshot(recovery.page, 'native-100-recovered-en');
  report.checks.push({ check: 'new-worker-recovers-after-cancel', source: 'native-100.pdf', pages: 100 });
  await recovery.context.close();
  report.stage = 'final-integrity';
  await Promise.all(responseChecks);
  assert.deepEqual(report.codeErrors, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(await fingerprint(root), report.buildAssets, 'dist changed during acceptance');
  assert.deepEqual(await fingerprint(fixtureRoot), report.fixtureHashes, 'frozen fixtures changed during acceptance');
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
