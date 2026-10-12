// Maintained actual-App gate; created locally without executing Chrome.
// Observes untouched native Worker replies; truth is frozen before the browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  readdir,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { assetCopy } from '../lib/i18n/fixed-assets.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
assert.equal(process.argv.length, 2, 'No bypass/preflight/routed-assets mode');
const repo = path.resolve(import.meta.dirname, '..');
const dist = await realpath(
  process.env.MIZAN_DIST_DIR ?? path.join(repo, 'dist'),
);
const parent = path.resolve(
  process.env.ASSET_LONG_BROWSER_DIR ??
    path.join(repo, '../evidence/asset-long-browser'),
);
await mkdir(parent, { recursive: true });
const out = await mkdtemp(path.join(parent, 'attempt-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ids = [
  '01-two-assets-separated',
  '10-all-zero-members-retained',
  '20-blank-amount-not-zero',
  '29-missing-zero-mapping',
  '39-net-equal-component-differences',
  '42-malformed-last-row-width',
];
const facts = new Map();
const freeze = {
  syntheticOnly: true,
  truthFromProduct: false,
  sourceFiles: {},
  buildFiles: {},
  driverSha256: sha(await readFile(import.meta.filename)),
};
for (const id of ids) {
  const folder = path.join(repo, 'audit/fixed-assets-long/frozen', id);
  const meta = await readFile(path.join(folder, 'case.json'));
  const originals = await Promise.all(
    [0, 1, 2, 3].map((i) => readFile(path.join(folder, `source-${i}.csv`))),
  );
  facts.set(id, { meta: JSON.parse(meta), originals });
  freeze.sourceFiles[`${id}/case.json`] = sha(meta);
  originals.forEach((b, i) => {
    freeze.sourceFiles[`${id}/source-${i}.csv`] = sha(b);
  });
}
async function inventory(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await inventory(file);
    else
      freeze.buildFiles[path.relative(dist, file)] = sha(await readFile(file));
  }
}
await inventory(dist);
await writeFile(
  path.join(out, 'FROZEN-INPUTS.json'),
  JSON.stringify(freeze, null, 2),
);
const report = {
  syntheticOnly: true,
  actualBrowser: false,
  browserRun: true,
  expectedFromProduct: false,
  passed: false,
  entries: [],
  pageErrors: [],
  externalRequests: [],
  failedRequests: [],
  cancellation: [],
  keyboard: [],
  review: [],
  invalidation: [],
  geometry: [],
  blockedReview: [],
  frozenInputsSha256: sha(await readFile(path.join(out, 'FROZEN-INPUTS.json'))),
};
const save = () =>
  writeFile(
    path.join(out, 'BROWSER-PROOF.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
let server, browser;
function observe() {
  globalThis.assetLongReplies = [];
  globalThis.assetLongWorkerMessages = [];
  globalThis.assetLongWorkerTerminations = 0;
  globalThis.assetLongTerminatedWorkerIds = [];
  const workerIds = new WeakMap();
  let serial = 0;
  const identity = (worker) => {
    if (!workerIds.has(worker)) workerIds.set(worker, ++serial);
    return workerIds.get(worker);
  };
  const watched = new WeakSet();
  // Preserve native receiver; never replace requests or replies.
  // oxlint-disable-next-line typescript/unbound-method
  const post = Worker.prototype.postMessage;
  // oxlint-disable-next-line typescript/unbound-method
  const terminate = Worker.prototype.terminate;
  Worker.prototype.terminate = function (...args) {
    const workerId = identity(this);
    globalThis.assetLongWorkerTerminations++;
    globalThis.assetLongTerminatedWorkerIds.push(workerId);
    globalThis.assetLongWorkerMessages.push({
      direction: 'terminate',
      workerId,
    });
    return terminate.call(this, ...args);
  };
  Worker.prototype.postMessage = function (message, ...rest) {
    const workerId = identity(this);
    if (!watched.has(this)) {
      watched.add(this);
      this.addEventListener('message', ({ data }) => {
        if (
          data?.channel === 'mizan-accounting-v1' &&
          typeof data.ok === 'boolean'
        )
          globalThis.assetLongWorkerMessages.push({
            direction: 'reply',
            workerId,
            id: data.id,
            action: data.action,
            ok: data.ok,
            financial: data.value?.result?.financial,
          });
        if (
          data?.ok &&
          data.channel === 'mizan-accounting-v1' &&
          data.action?.startsWith('asset-') &&
          data.value?.result
        )
          globalThis.assetLongReplies.push({
            workerId,
            id: data.id,
            action: data.action,
            result: structuredClone(data.value.result),
          });
      });
    }
    if (message?.channel === 'mizan-accounting-v1')
      globalThis.assetLongWorkerMessages.push({
        direction: 'request',
        workerId,
        id: message.id,
        action: message.action,
      });
    return post.call(this, message, ...rest);
  };
}
async function download(page, panel, label, file) {
  const event = page.waitForEvent('download');
  await panel.getByRole('button', { name: label, exact: true }).click();
  const d = await event;
  await d.saveAs(file);
  assert.equal(await d.failure(), null);
}
function assertAssetGeometry(width, dimensions) {
  assert(
    dimensions.viewport === width && dimensions.visible === true && dimensions.visiblePanels === 1 &&
      dimensions.panel > 0 && dimensions.panelHeight > 0 &&
      dimensions.document <= width + 1 && dimensions.body <= width + 1 && dimensions.panel <= width + 1,
    JSON.stringify({ width, ...dimensions }),
  );
}
async function idle(panel) {
  await panel.locator('xpath=self::*[@aria-busy="false"]').waitFor();
}
async function latest(page, action) {
  return page.evaluate(
    (a) =>
      globalThis.assetLongReplies.filter((r) => r.action === a).at(-1)?.result,
    action,
  );
}
try {
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'GET');
      const url = new URL(req.url, 'http://local');
      const file = await realpath(
        path.resolve(
          dist,
          '.' +
            (url.pathname === '/'
              ? '/index.html'
              : decodeURIComponent(url.pathname)),
        ),
      );
      assert(file.startsWith(dist + path.sep));
      const body = await readFile(file);
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.wasm': 'application/wasm',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] ?? 'application/octet-stream',
      );
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.MIZAN_CHROMIUM,
    headless: true,
  });
  report.actualBrowser = true;
  for (const lang of ['ar', 'en'])
    for (const width of [1440, 390, 320]) {
      for (const id of ids) {
        const { meta, originals } = facts.get(id);
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
          acceptDownloads: true,
        });
        try {
          await context.addInitScript(observe);
          const page = await context.newPage();
          page.on('pageerror', (e) => report.pageErrors.push(String(e)));
          page.on('requestfailed', (r) => report.failedRequests.push(r.url()));
          page.on('request', (r) => {
            if (
              !r.url().startsWith(origin + '/') &&
              !r.url().startsWith('blob:') &&
              !r.url().startsWith('data:')
            )
              report.externalRequests.push(r.url());
          });
          await page.goto(origin + '/', { waitUntil: 'networkidle' });
          if (
            (await page.evaluate(() => document.documentElement.lang)) !== lang
          )
            await page
              .locator(`.language-switch button[lang="${lang}"]:visible`)
              .first()
              .click();
          await page.waitForFunction(
            (value) => document.documentElement.lang === value,
            lang,
          );
          await openDomainWorkspace(page, 'assets');
          const panel = page.locator('[data-asset-workspace]:visible'),
            copy = assetCopy[lang];
          await panel.waitFor();
          await panel
            .getByLabel(copy.registerFormat, { exact: true })
            .selectOption('fixed-assets-long-components-gl-1');
          for (const [i, b] of originals.entries()) {
            await panel
              .getByLabel(copy.roles[i], { exact: true })
              .setInputFiles({
                name: `source-${i}.csv`,
                mimeType: 'text/csv',
                buffer: b,
              });
            await idle(panel);
          }
          for (const [key, label] of Object.entries(copy.scope))
            await panel
              .getByLabel(copy.scopePrefix + label, { exact: true })
              .fill(meta.scope[key]);
          const confirms = panel.getByLabel(copy.roleConfirm, { exact: true });
          assert.equal(await confirms.count(), 4);
          for (let i = 0; i < 4; i++) await confirms.nth(i).check();
          await panel.getByLabel(copy.scopeConfirm, { exact: true }).check();
          await panel
            .getByRole('button', { name: copy.compare, exact: true })
            .focus();
          await page.keyboard.press('Enter');
          await panel.locator('[data-asset-status]').waitFor();
          await idle(panel);
          report.keyboard.push({ lang, width, id, operation: 'compare-enter' });
          const direct = await latest(page, 'asset-reconcile');
          assert(direct);
          assert.equal(direct.financial, meta.expectedFinancial);
          if (meta.assertions?.totals)
            assert.deepEqual(direct.totals, meta.assertions.totals);
          const folderName = `${lang}-${width}-${id}`,
            folder = path.join(out, folderName);
          await mkdir(folder);
          for (const [i, b] of originals.entries())
            await writeFile(path.join(folder, `source-${i}.csv`), b);
          await writeFile(
            path.join(folder, 'case.json'),
            JSON.stringify({ scope: meta.scope }),
          );
          await download(
            page,
            panel,
            copy.save,
            path.join(folder, 'session.json'),
          );
          await idle(panel);
          await download(
            page,
            panel,
            copy.export,
            path.join(folder, 'direct.xlsx'),
          );
          await idle(panel);
          await panel
            .getByLabel(copy.restore, { exact: true })
            .setInputFiles(path.join(folder, 'session.json'));
          await idle(panel);
          const restored = await latest(page, 'asset-restore');
          assert.deepEqual(restored, direct);
          await download(
            page,
            panel,
            copy.export,
            path.join(folder, 'restored.xlsx'),
          );
          await idle(panel);
          await writeFile(
            path.join(folder, 'direct-result.json'),
            JSON.stringify(direct),
          );
          await writeFile(
            path.join(folder, 'restored-result.json'),
            JSON.stringify(restored),
          );
          const artifacts = {};
          for (const file of await readdir(folder)) {
            const b = await readFile(path.join(folder, file));
            artifacts[file] = { bytes: b.length, sha256: sha(b) };
          }
          report.entries.push({
            folder: folderName,
            truthCase: id,
            phase: 'browser-unreviewed',
            context: direct.context,
            lang,
            width,
            artifacts,
          });
          if (id === '01-two-assets-separated') {
            assert.equal(
              await panel
                .locator('summary')
                .filter({ hasText: copy.componentEvidence })
                .count(),
              1,
            );
            await panel.getByLabel(copy.complete, { exact: true }).check();
            await panel
              .getByLabel(copy.completeReference, { exact: true })
              .fill('SYN-COMPLETE');
            await panel
              .getByLabel(copy.completeNote, { exact: true })
              .fill('Synthetic browser original review');
            await panel
              .getByRole('button', { name: copy.compare, exact: true })
              .click();
            await idle(panel);
            await panel
              .getByLabel(copy.reference, { exact: true })
              .fill('SYN-REVIEW');
            await panel
              .getByLabel(copy.note, { exact: true })
              .fill('Synthetic full component review');
            await panel
              .getByRole('button', { name: copy.accept, exact: true })
              .click();
            await idle(panel);
            assert.equal(
              (await latest(page, 'asset-reconcile')).review,
              'accepted',
            );
            await panel
              .getByRole('button', { name: copy.undo, exact: true })
              .click();
            await idle(panel);
            assert.equal(
              (await latest(page, 'asset-reconcile')).review,
              'needs-review',
            );
            report.review.push({ lang, width, id, acceptedAndUndone: true });
            if (width === 1440) {
              await panel
                .getByLabel(copy.scopeConfirm, { exact: true })
                .uncheck();
              await panel
                .getByLabel(copy.scopeConfirm, { exact: true })
                .check();
              assert.equal(
                await panel.locator('.workspace-results').count(),
                0,
              );
              const start = await page.evaluate(
                () => globalThis.assetLongWorkerMessages.length,
              );
              const cancelled = await page.evaluate(
                async (labels) => {
                  const requests = () =>
                    globalThis.assetLongWorkerMessages.filter(
                      (message) =>
                        message.direction === 'request' &&
                        message.action === 'asset-reconcile',
                    );
                  const before = requests().length;
                  const terminations = globalThis.assetLongWorkerTerminations;
                  const buttons = () => [
                    ...document.querySelectorAll(
                      '[data-asset-workspace] button',
                    ),
                  ];
                  buttons()
                    .find(
                      (button) => button.textContent.trim() === labels.compare,
                    )
                    .click();
                  await new Promise((resolve) => setTimeout(resolve, 0));
                  const control = buttons().find(
                    (button) =>
                      button.textContent.trim() === labels.cancel &&
                      button.getClientRects().length,
                  );
                  const request = requests().at(-1);
                  const submitted = requests().length > before;
                  if (!control)
                    return { cancelled: false, submitted, terminated: false };
                  control.click();
                  return {
                    cancelled: true,
                    submitted,
                    terminated:
                      globalThis.assetLongWorkerTerminations > terminations &&
                      globalThis.assetLongTerminatedWorkerIds.includes(
                        request?.workerId,
                      ),
                    workerId: request?.workerId,
                    requestId: request?.id,
                  };
                },
                { compare: copy.compare, cancel: copy.cancel },
              );
              assert.equal(
                cancelled.cancelled,
                true,
                'visible actual asset cancel control',
              );
              assert.equal(
                cancelled.submitted,
                true,
                'native asset request submitted',
              );
              assert.equal(
                cancelled.terminated,
                true,
                'specific requested native worker terminated',
              );
              await idle(panel);
              assert.equal(
                await panel.locator('.workspace-results').count(),
                0,
              );
              assert.equal(
                await panel
                  .getByRole('button', { name: copy.export, exact: true })
                  .isDisabled(),
                true,
              );
              await page.waitForTimeout(100);
              assert.equal(
                await panel.locator('.workspace-results').count(),
                0,
                'bounded observation: no cancelled result installed',
              );
              assert.equal(
                await panel
                  .getByRole('button', { name: copy.export, exact: true })
                  .isDisabled(),
                true,
              );
              const retryStart = await page.evaluate(
                () => globalThis.assetLongWorkerMessages.length,
              );
              await panel
                .getByRole('button', { name: copy.compare, exact: true })
                .click();
              await idle(panel);
              assert.equal(
                (await latest(page, 'asset-reconcile')).financial,
                'ready',
              );
              const retry = await page.evaluate(
                (offset) => globalThis.assetLongWorkerMessages.slice(offset),
                retryStart,
              );
              const request = retry.find(
                (message) =>
                  message.direction === 'request' &&
                  message.action === 'asset-reconcile',
              );
              const reply = retry.find(
                (message) =>
                  message.direction === 'reply' &&
                  message.action === 'asset-reconcile' &&
                  message.ok,
              );
              assert(request && reply, 'genuine successful native asset retry');
              assert.notEqual(
                request.workerId,
                cancelled.workerId,
                'fresh native retry worker',
              );
              assert.equal(reply.workerId, request.workerId);
              assert.equal(reply.id, request.id);
              assert.equal(reply.financial, 'ready');
              report.cancellation.push({
                lang,
                width,
                id,
                cancelledAndRetried: true,
                ...cancelled,
                resultAbsent: true,
                exportDisabled: true,
                lateResultAbsent: true,
                lateResultAbsentObservationMs: 100,
                retryWorkerId: request.workerId,
                retryRequestId: request.id,
                retryFinancial: reply.financial,
                nativeTelemetry: await page.evaluate(
                  (offset) => globalThis.assetLongWorkerMessages.slice(offset),
                  start,
                ),
              });
            }
          } else if (meta.expectedFinancial !== 'ready') {
            // Complete every non-financial prerequisite first: a blank review
            // form would also disable Accept for a financially ready source.
            await panel.getByLabel(copy.complete, { exact: true }).check();
            await panel
              .getByLabel(copy.completeReference, { exact: true })
              .fill('SYN-COMPLETE');
            await panel
              .getByLabel(copy.completeNote, { exact: true })
              .fill('Synthetic negative financial control');
            await panel
              .getByRole('button', { name: copy.compare, exact: true })
              .click();
            await idle(panel);
            await panel
              .getByLabel(copy.reference, { exact: true })
              .fill('SYN-REVIEW');
            await panel
              .getByLabel(copy.note, { exact: true })
              .fill('All review prerequisites supplied');
            assert.equal(
              (await latest(page, 'asset-reconcile')).financial,
              meta.expectedFinancial,
            );
            assert(
              await panel
                .getByRole('button', { name: copy.accept, exact: true })
                .isDisabled(),
            );
            report.blockedReview.push({
              lang,
              width,
              id,
              financial: meta.expectedFinancial,
              blockedAfterPrerequisites: true,
            });
          }
          await panel.waitFor({ state: 'visible' });
          const visiblePanels = await panel.count();
          assert.equal(visiblePanels, 1, 'one visible native asset workspace');
          const dimensions = await page.evaluate(
            (element) => ({
              viewport: window.innerWidth,
              document: document.documentElement.scrollWidth,
              body: document.body.scrollWidth,
              panel: element.getBoundingClientRect().width,
              panelHeight: element.getBoundingClientRect().height,
              panelTag: element.tagName,
              panelClass: element.getAttribute('class'),
            }),
            await panel.elementHandle(),
          );
          Object.assign(dimensions, {
            visiblePanels,
            visible: await panel.isVisible(),
            selector: '[data-asset-workspace]:visible',
          });
          assertAssetGeometry(width, dimensions);
          report.geometry.push({
            lang,
            width,
            id,
            phase: 'result-before-family-reset',
            ...dimensions,
          });
          await page.screenshot({
            path: path.join(out, `${folderName}.png`),
            fullPage: true,
          });
          await panel
            .getByLabel(copy.registerFormat, { exact: true })
            .selectOption('fixed-assets-posted-components-gl-1');
          assert.equal(await panel.locator('[data-asset-status]').count(), 0);
          assert.equal(await confirms.nth(0).isChecked(), false);
          assert(
            await panel
              .getByRole('button', { name: copy.export, exact: true })
              .isDisabled(),
          );
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          report.invalidation.push({
            lang,
            width,
            id,
            layoutInvalidated: true,
          });
          await save();
        } finally {
          await context.close();
        }
      }
    }
  assert.equal(report.entries.length, 36);
  assert.equal(report.cancellation.length, 2);
  assert.deepEqual(
    report.cancellation.map((entry) => entry.lang),
    ['ar', 'en'],
  );
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.failedRequests, []);
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(repo, 'scripts/check-fixed-assets-long-browser.py'), out],
    { stdio: 'inherit' },
  );
  report.passed = true;
} catch (e) {
  report.error = String(e);
  throw e;
} finally {
  await save();
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
