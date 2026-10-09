/** Full product benchmark. Synthetic files are prepared BEFORE the clock starts.
 * Worker action time includes structured cloning; UI/export time is separate.
 * RSS is sampled for this Chromium instance, not JS engine object memory. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import {
  MAX_ROWS,
  MAX_FILE_BYTES,
  MAX_SHEETS,
  MAX_PDF_PAGES,
} from '../lib/reconciliation/types.ts';
import { verifyPerformanceExport } from './verify-performance-export.mjs';
import { sampleProcessRss, exportMemorySamples } from './process-memory.mjs';
const membershipChecker = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../audit/export-design/check_membership.py',
);
const args = process.argv.slice(2),
  option = (key, fallback) =>
    args.find((x) => x.startsWith(key + '='))?.slice(key.length + 1) ??
    fallback;
const dist = path.resolve(option('--dist', 'dist'));
const output = path.resolve(option('--output', 'work/browser-performance-046'));
const fixturesDir = path.resolve(option('--fixtures-dir', output));
const prepareOnly = option('--prepare-only', 'no') === 'yes';
const fixedClock = option('--fixed-clock', '');
assert.ok(
  !fixedClock || Number.isFinite(Date.parse(fixedClock)),
  'invalid fixed clock',
);
const sizes = option('--sizes', '100,1000,5000,20000').split(',').map(Number);
const formats = option('--formats', 'csv,xlsx').split(',');
assert.ok(
  sizes.every(
    (size) =>
      Number.isSafeInteger(size) &&
      size > 0 &&
      size <= MAX_ROWS &&
      size % 10 === 0,
  ),
  'sizes must be positive multiples of 10 within the current row limit',
);
assert.ok(formats.every((format) => ['csv', 'xlsx'].includes(format)));
const shell = promisify(execFile);
await mkdir(output, { recursive: true });
if (prepareOnly) await mkdir(fixturesDir, { recursive: true });
const header = [
  'Date',
  'Document No',
  'Document Type',
  'Voucher No',
  'PO No',
  'Bank Reference',
  'Description',
  'Amount',
  'Currency',
];
function fixtures(size) {
  const source = [[], []];
  const add = (
    side,
    ref,
    type,
    value,
    {
      voucher = '',
      po = '',
      bank = '',
      description = 'Synthetic commercial entry',
    } = {},
  ) =>
    source[side].push([
      '2026-07-15',
      ref,
      type,
      voucher,
      po,
      bank,
      description,
      (value / 100).toFixed(2),
      'SAR',
    ]);
  for (let base = 0; base < size; base += 10) {
    const id = String(100000 + base);
    for (const side of [0, 1]) {
      const split = side === 1;
      for (const amount of split ? [250000, 225000, 200000] : [675000])
        add(side, 'INV-' + id, 'Invoice', amount, {
          voucher: 'AP-' + id,
          po: 'PO-' + id,
        });
      for (const amount of split ? [675000] : [250000, 225000, 200000])
        add(side, 'INV-' + id + 'B', 'Invoice', amount, {
          voucher: 'AP-' + id + 'B',
          po: 'PO-' + id + 'B',
        });
      for (const amount of split ? [-12300, -17700] : [-30000])
        add(side, 'PAY-' + id, 'Payment', amount, { bank: 'BANK-' + id });
      for (const amount of split ? [-30000] : [-12300, -17700])
        add(side, 'PAY-' + id + 'B', 'Payment', amount, {
          bank: 'BANK-' + id + 'B',
        });
      // Identical candidates must remain unresolved, not paired in input order.
      add(side, 'DUP-' + id, 'Invoice', 8100);
      add(side, 'DUP-' + id, 'Invoice', 8100);
      add(side, 'ONE-' + id, 'Invoice', 12700);
    }
  }
  for (const rows of source) assert.equal(rows.length, size);
  return source.map((rows) => ({
    rows,
    table: [
      ['Supplier', 'Synthetic Performance Vendor'],
      ['Customer', 'Synthetic Performance Buyer'],
      ['Customer Account', 'PERF-ACCOUNT'],
      ['Currency', 'SAR'],
      ['As of', '2026-07-31'],
      header,
      ...rows,
    ],
  }));
}
async function encode(table, format) {
  if (format === 'csv')
    return Buffer.from(
      table
        .map((row) =>
          row.map((x) => '"' + x.replaceAll('"', '""') + '"').join(','),
        )
        .join('\r\n'),
    );
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Statement').addRows(table);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const prepared = [];
for (const size of sizes)
  for (const format of formats) {
    const sources = fixtures(size),
      paths = [],
      sourceSha256 = [];
    for (const [side, source] of sources.entries()) {
      const file = path.join(
        fixturesDir,
        `synthetic-${size}-${side}.${format}`,
      );
      if (prepareOnly || fixturesDir === output)
        await writeFile(file, await encode(source.table, format));
      const bytes = await readFile(file);
      assert.ok(bytes.length > 0, `empty fixture ${file}`);
      assert.ok(
        bytes.length <= MAX_FILE_BYTES,
        `fixture exceeds current byte limit ${file}`,
      );
      sourceSha256.push(createHash('sha256').update(bytes).digest('hex'));
      paths.push(file);
    }
    const totals = sources.map((source) =>
      source.rows
        .reduce((sum, row) => sum + BigInt(row[7].replace('.', '')), 0n)
        .toString(),
    );
    prepared.push({ size, format, sources, paths, totals, sourceSha256 });
  }
if (prepareOnly) {
  console.log(
    JSON.stringify(
      prepared.map(({ size, format, sourceSha256 }) => ({
        size,
        format,
        sourceSha256,
      })),
    ),
  );
  process.exit(0);
}
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    ).replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(dist, '.' + rel);
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    const bytes = await readFile(file);
    const mime =
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  schema: 'tarasuf-browser-performance-3',
  createdAt: new Date().toISOString(),
  dist,
  fixturesDir,
  fixedClock: fixedClock || null,
  node: process.version,
  buildIndexSha256: createHash('sha256')
    .update(await readFile(path.join(dist, 'index.html')))
    .digest('hex'),
  scriptSha256: createHash('sha256')
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest('hex'),
  device: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    executablePath:
      process.env.MIZAN_CHROMIUM ?? 'installed Playwright browser',
  },
  limits: {
    rowsPerSource: MAX_ROWS,
    fileBytes: MAX_FILE_BYTES,
    sheets: MAX_SHEETS,
    textPdfPages: MAX_PDF_PAGES,
  },
  characterization:
    'One sample per requested size/format; no SLA, percentile, improvement, field or weakest-device claim. Two native protocol reads are not1000 distributed accountants.',
  memoryMeasurement:
    'Observed RSS for this Chromium instance via CDP and ps:500ms normally,20ms during export with at most one sample in flight. Includes browser/renderer/worker processes and may double-count shared pages; not a guaranteed peak. A failed partial attempt is retained; only an OS/CDP-proven dead auxiliary process permits one fresh complete sample. Export coverage requires a full sample interval inside an actual Worker export. Excludes Node fixture creation and independent verification.',
  timingDefinition:
    'Files generated before measurement. UI upload/comparison/export wall time. Worker action timings include serialization and dispatch. Reconciliation includes normalization plus matching; export includes original re-read/recomputation, workbook construction and ZIP serialization.',
  runs: [],
};
try {
  for (const run of prepared) {
    const entry = {
      rowsPerSide: run.size,
      format: run.format,
      sourceSha256: run.sourceSha256,
      sourceBytes: await Promise.all(
        run.paths.map(async (p) => (await readFile(p)).length),
      ),
      stages: {},
      workerActions: [],
      networkViolations: [],
      errors: [],
      peakChromiumRssBytes: 0,
      memorySamplesSuccessful: 0,
      memorySamplesDuringExport: 0,
      memorySamplingErrors: 0,
      memorySamplingRetries: 0,
      memorySamplingFailures: [],
      memorySamples: [],
      downloadCompleted: false,
      browserChecksPassed: false,
      lifecycleRequired:
        option('--lifecycle', 'no') === 'yes' &&
        run.size === Math.max(...sizes) &&
        run.format === 'xlsx',
      completed: false,
    };
    /** @type {Promise<void> | undefined} */
    let pendingSample;
    let browser,
      context,
      page,
      sampleTimer,
      exportSampleTimer,
      measuredPhase = 'startup',
      downloadPath;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.MIZAN_CHROMIUM,
      });
      report.browser = browser.version();
      const cdp = await browser.newBrowserCDPSession();
      const measureSample = async () => {
        const phaseAtStart = measuredPhase;
        const sampleStartedMs = performance.now();
        const sampleStartedEpochMs = performance.timeOrigin + sampleStartedMs;
        const trace = { stage: 'cdp-process-list', attempts: [] };
        try {
          const measurement = await sampleProcessRss({
            listProcesses: async () =>
              (await cdp.send('SystemInfo.getProcessInfo')).processInfo,
            readRss: async (ids) =>
              (
                await shell('ps', ['-o', 'pid=,rss=', '-p', ids.join(',')], {
                  timeout: 5000,
                })
              ).stdout,
            isAlive: (id) => {
              try {
                process.kill(id, 0);
                return true;
              } catch (error) {
                if (error.code === 'ESRCH') return false;
                throw error;
              }
            },
            onAttempt: (attempt) => {
              trace.stage = 'pid-rss-validation';
              trace.attempts.push({
                ...attempt,
                stdout: attempt.stdout.slice(0, 8000),
                stdoutTruncated: attempt.stdout.length > 8000,
              });
            },
          });
          const rss = measurement.rssBytes;
          entry.memorySamplesSuccessful += 1;
          entry.memorySamplingRetries += measurement.attempts.length - 1;
          entry.memorySamples.push({
            phaseAtStart,
            phaseAtEnd: measuredPhase,
            hostSampleStartedMs: sampleStartedMs,
            hostSampleEndedMs: performance.now(),
            hostSampleStartedEpochMs: sampleStartedEpochMs,
            hostSampleEndedEpochMs: performance.timeOrigin + performance.now(),
            rssBytes: rss,
            processTrace: structuredClone(trace),
          });
          entry.peakChromiumRssBytes = Math.max(
            entry.peakChromiumRssBytes,
            rss,
          );
        } catch (error) {
          entry.memorySamplingErrors += 1;
          entry.memorySamplingFailures.push({
            phaseAtStart,
            phaseAtEnd: measuredPhase,
            hostSampleStartedMs: sampleStartedMs,
            hostSampleEndedMs: performance.now(),
            processTrace: structuredClone(trace),
            error: String(error?.message ?? error).slice(0, 4000),
            errorTruncated: String(error?.message ?? error).length > 4000,
            code: error?.code ?? null,
            psStdoutOnError: String(error?.stdout ?? '').slice(0, 8000),
            psStderrOnError: String(error?.stderr ?? '').slice(0, 8000),
            psStdoutOnErrorTruncated: String(error?.stdout ?? '').length > 8000,
            psStderrOnErrorTruncated: String(error?.stderr ?? '').length > 8000,
          });
        }
      };
      const sample = () => {
        if (pendingSample) return pendingSample;
        pendingSample = measureSample().finally(() => {
          pendingSample = undefined;
        });
        return pendingSample;
      };
      sampleTimer = setInterval(sample, 500);
      await sample();
      context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true,
      });
      context.setDefaultTimeout(55000);
      await context.route('**/*', (route) => {
        const u = new URL(route.request().url());
        return ['blob:', 'data:'].includes(u.protocol) || u.origin === origin
          ? route.continue()
          : route.abort();
      });
      if (fixedClock)
        await context.addInitScript((iso) => {
          const NativeDate = Date;
          class FrozenDate extends NativeDate {
            constructor(...values) {
              super(...(values.length ? values : [iso]));
            }
            static now() {
              return NativeDate.parse(iso);
            }
          }
          window.Date = FrozenDate;
        }, fixedClock);
      context.on('request', (r) => {
        const u = new URL(r.url());
        if (
          r.method() !== 'GET' ||
          (!['blob:', 'data:'].includes(u.protocol) && u.origin !== origin)
        )
          entry.networkViolations.push({ url: r.url(), method: r.method() });
      });
      await context.addInitScript(() => {
        window.__bench = {
          actions: [],
          requests: [],
          terminations: [],
          workerInstances: 0,
          gaps: [],
          completed: [],
          last: performance.now(),
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.benchInstance = ++window.__bench.workerInstances;
            window.__benchNativeWorker = this;
            this.requests = new Map();
            this.addEventListener('message', (e) => {
              const d = e.data;
              if (d?.channel !== 'mizan-accounting-v1') return;
              if (d.kind === 'progress') return;
              const start = this.requests.get(d.id);
              if (start) {
                window.__bench.actions.push({
                  action: start.action,
                  id: d.id,
                  workerInstance: this.benchInstance,
                  ms: performance.now() - start.time,
                  startedEpochMs: performance.timeOrigin + start.time,
                  endedEpochMs: performance.timeOrigin + performance.now(),
                  ok: d.ok,
                  timings: d.timings ?? null,
                });
                this.requests.delete(d.id);
              }
              if (d.action === 'reconcile' && d.ok) {
                const r = d.value.result;
                window.__bench.completed.push({
                  matches: r.matches.length,
                  groups: r.cases.filter(
                    (c) =>
                      c.status === 'Matched' &&
                      c.supplierMembers.length + c.ledgerMembers.length > 2,
                  ).length,
                  sourceRows: [
                    r.supplier.transactions.length,
                    r.ledger.transactions.length,
                  ],
                  totals: [r.supplier.total, r.ledger.total],
                  allCaseMembers: r.cases.reduce(
                    (a, c) =>
                      a + c.supplierMembers.length + c.ledgerMembers.length,
                    0,
                  ),
                  matchedEvidenceMembers: r.cases
                    .filter((c) => c.status === 'Matched')
                    .reduce(
                      (a, c) =>
                        a + c.supplierMembers.length + c.ledgerMembers.length,
                      0,
                    ),
                });
              }
            });
          }
          postMessage(message, ...rest) {
            if (message?.channel === 'mizan-accounting-v1') {
              window.__bench.requests.push({
                id: message.id,
                action: message.action,
                workerInstance: this.benchInstance,
                time: performance.now(),
              });
              this.requests.set(message.id, {
                action: message.action,
                time: performance.now(),
              });
            }
            return super.postMessage(message, ...rest);
          }
          terminate() {
            window.__bench.terminations.push({
              workerInstance: this.benchInstance,
              time: performance.now(),
              pendingExportIds: [...this.requests]
                .filter(([, request]) => request.action === 'export')
                .map(([id]) => id),
            });
            return super.terminate();
          }
        };
        setInterval(() => {
          const now = performance.now();
          window.__bench.gaps.push(now - window.__bench.last);
          window.__bench.last = now;
        }, 50);
      });
      page = await context.newPage();
      page.on('pageerror', (e) => entry.errors.push(e.message));
      page.on('dialog', (d) =>
        d.type() === 'beforeunload' ? d.accept() : d.dismiss(),
      );
      await page.goto(origin + '/mizan-test/');
      await page.waitForFunction(() =>
        window.__bench.actions.some(
          (action) => action.action === 'ready' && action.ok === true,
        ),
      );
      await page.evaluate(() => document.fonts.ready);
      await context.setOffline(true);
      const t = performance.now();
      for (const [i, label] of [
        'كشف المورد',
        'تقرير الحسابات الدائنة',
      ].entries()) {
        measuredPhase = 'upload' + i;
        const start = performance.now();
        await page
          .getByLabel(label, { exact: true })
          .setInputFiles(run.paths[i]);
        await page.waitForFunction(
          (n) =>
            window.__bench.actions.filter((x) => x.action === 'read').length >=
            n,
          i + 1,
        );
        await page
          .getByLabel(label, { exact: true })
          .waitFor({ state: 'attached' });
        await page
          .getByRole('button', { name: 'إلغاء', exact: true })
          .waitFor({ state: 'hidden' });
        entry.stages['upload' + i + 'Ms'] = performance.now() - start;
      }
      await page
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .click();
      const compare = page.getByRole('button', {
        name: 'تحقق وقارن',
        exact: true,
      });
      await compare.waitFor({ state: 'visible' });
      const compareStart = performance.now();
      measuredPhase = 'compare';
      await compare.click();
      await page
        .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
        .waitFor();
      entry.stages.reconcileAndReviewMs = performance.now() - compareStart;
      const prepareStart = performance.now();
      measuredPhase = 'prepare-export';
      await page
        .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
        .waitFor();
      entry.stages.prepareExportScreenMs = performance.now() - prepareStart;
      const exportStart = performance.now();
      measuredPhase = 'export';
      exportSampleTimer = setInterval(sample, 20);
      const download = page.waitForEvent('download', { timeout: 55000 });
      await page
        .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
        .click();
      const saved = await download;
      downloadPath = path.join(output, `export-${run.size}-${run.format}.xlsx`);
      await saved.saveAs(downloadPath);
      entry.stages.exportToDownloadMs = performance.now() - exportStart;
      clearInterval(exportSampleTimer);
      await pendingSample;
      entry.stages.totalUiMs = performance.now() - t;
      const telemetry = await page.evaluate(() => window.__bench);
      entry.workerActions = telemetry.actions;
      entry.memorySamplesDuringExport = exportMemorySamples(
        entry.memorySamples,
        entry.workerActions,
      ).length;
      entry.results = telemetry.completed;
      entry.maxMainThreadHeartbeatGapMs = Math.max(...telemetry.gaps);
      entry.downloadCompleted = true;
      assert.equal(entry.results.at(-1).allCaseMembers, run.size * 2);
      assert.equal(
        entry.results.at(-1).matchedEvidenceMembers,
        (run.size * 16) / 10,
      );
      assert.deepEqual(entry.results.at(-1).sourceRows, [run.size, run.size]);
      const expectedGroups =
        (Number(option('--expected-groups-per-block', '4')) * run.size) / 10;
      assert.equal(
        entry.results.at(-1).groups,
        expectedGroups,
        'all supported complete groups must actually be matched',
      );
      assert.equal(
        entry.results.at(-1).matches,
        expectedGroups + run.size / 10,
        'duplicate candidates must remain unresolved; clear single rows must match',
      );
      assert.deepEqual(
        entry.results.at(-1).totals.map(String),
        run.totals.map(String),
      );
      assert.equal(entry.networkViolations.length, 0);
      assert.equal(entry.errors.length, 0);
      await sample();
      if (entry.lifecycleRequired) {
        entry.peakBeforeLifecycleRssBytes = entry.peakChromiumRssBytes;
        measuredPhase = 'protocol-overlap';
        const originals = await Promise.all(
          run.paths.map(async (file, index) => ({
            name: path.basename(file),
            base64: (await readFile(file)).toString('base64'),
            sha256: run.sourceSha256[index],
            rowsSha256: createHash('sha256')
              .update(
                JSON.stringify(
                  run.sources[index].table.map((row) =>
                    Array.from(
                      { length: header.length },
                      (_, i) => row[i] ?? '',
                    ),
                  ),
                ),
              )
              .digest('hex'),
          })),
        );
        entry.nativeProtocolOverlap = await page.evaluate(async (inputs) => {
          const worker = window.__benchNativeWorker;
          const ids = inputs.map((_, index) => 1000001 + index);
          const before = JSON.stringify(window.__bench.completed);
          const started = performance.now();
          const replies = await new Promise((resolve, reject) => {
            const received = [];
            const pending = new Set(ids);
            const timer = setTimeout(() => {
              worker.removeEventListener('message', observe);
              reject(new Error('Bounded two-read protocol probe timed out'));
            }, 10000);
            function observe(event) {
              const d = event.data;
              if (
                d?.channel !== 'mizan-accounting-v1' ||
                d.kind === 'progress' ||
                !pending.has(d.id)
              )
                return;
              pending.delete(d.id);
              received.push(d);
              if (!pending.size) {
                clearTimeout(timer);
                worker.removeEventListener('message', observe);
                resolve(received);
              }
            }
            worker.addEventListener('message', observe);
            for (const [index, input] of inputs.entries()) {
              const bytes = Uint8Array.from(atob(input.base64), (char) =>
                char.charCodeAt(0),
              );
              worker.postMessage({
                channel: 'mizan-accounting-v1',
                id: ids[index],
                action: 'read',
                payload: { name: input.name, buffer: bytes.buffer },
              });
            }
          });
          const digest = async (rows) =>
            Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(JSON.stringify(rows)),
                ),
              ),
              (b) => b.toString(16).padStart(2, '0'),
            ).join('');
          const results = [];
          for (const reply of replies) {
            const index = ids.indexOf(reply.id),
              wanted = inputs[index];
            const rows = reply.value?.sheets?.[0]?.rows;
            const rowsSha256 = await digest(rows);
            if (
              reply.ok !== true ||
              reply.action !== 'read' ||
              reply.value.name !== wanted.name ||
              reply.value.sha256 !== wanted.sha256 ||
              rowsSha256 !== wanted.rowsSha256
            )
              throw new Error(
                'Two native read results crossed or changed source rows/bytes',
              );
            results.push({
              id: reply.id,
              name: reply.value.name,
              sha256: reply.value.sha256,
              rows: rows.length,
              rowsSha256,
            });
          }
          if (before !== JSON.stringify(window.__bench.completed))
            throw new Error('Protocol probe changed financial result');
          return {
            status: 'PASS',
            requests: ids.length,
            results,
            elapsedMs: performance.now() - started,
            financialResultsUnchanged: true,
            scope:
              'Two actual native read requests dispatched before awaiting either; no UI-client concurrency claim',
          };
        }, originals);
        assert.equal(entry.nativeProtocolOverlap.requests, 2);
        measuredPhase = 'cancel-recovery';
        let unexpectedDownloads = 0;
        const countDownload = () => unexpectedDownloads++;
        page.on('download', countDownload);
        const lifecycleStart = performance.now();
        const exportsBefore = await page.evaluate(
          () =>
            window.__bench.requests.filter((r) => r.action === 'export').length,
        );
        await page
          .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
          .dblclick();
        const exportsAfter = await page.evaluate(
          () =>
            window.__bench.requests.filter((r) => r.action === 'export').length,
        );
        assert.equal(
          exportsAfter - exportsBefore,
          1,
          'Repeated busy UI click posts only one export',
        );
        entry.repeatedBusyExportRequests = exportsAfter - exportsBefore;
        const cancelledRequest = await page.evaluate(() =>
          window.__bench.requests.filter((r) => r.action === 'export').at(-1),
        );
        const cancelStart = performance.now();
        await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
        await page.getByText('أُلغيت العملية.', { exact: true }).waitFor();
        entry.cancelToVisibleMs = performance.now() - cancelStart;
        const termination = await page.evaluate(
          (request) =>
            window.__bench.terminations.find(
              (t) =>
                t.workerInstance === request.workerInstance &&
                t.pendingExportIds.includes(request.id),
            ),
          cancelledRequest,
        );
        assert.ok(
          termination,
          'Cancel forwards native termination of the worker owning the pending export',
        );
        await page.waitForTimeout(250);
        assert.equal(
          unexpectedDownloads,
          0,
          'cancelled export must not publish a late workbook',
        );
        const retryStart = performance.now();
        const retry = page.waitForEvent('download', { timeout: 55000 });
        await page
          .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
          .click();
        await (
          await retry
        ).saveAs(path.join(output, `cancel-recovery-${run.size}.xlsx`));
        entry.recoveryExportToDownloadMs = performance.now() - retryStart;
        entry.lifecycleMs = performance.now() - lifecycleStart;
        const lifecycleTelemetry = await page.evaluate(() => window.__bench);
        const recoveryRequest = lifecycleTelemetry.requests
          .filter((r) => r.action === 'export')
          .at(-1);
        assert.notEqual(
          recoveryRequest.workerInstance,
          cancelledRequest.workerInstance,
          'Retry uses a fresh native Worker',
        );
        assert.ok(
          lifecycleTelemetry.actions.some(
            (r) =>
              r.action === 'export' &&
              r.id === recoveryRequest.id &&
              r.workerInstance === recoveryRequest.workerInstance &&
              r.ok === true,
          ),
        );
        assert.equal(
          unexpectedDownloads,
          1,
          'Exactly one fresh recovery download; no cancelled publication during retry',
        );
        page.off('download', countDownload);
        entry.cancelledExportTermination = {
          cancelledRequest,
          termination,
          recoveryRequest,
          totalDownloadsThroughRecovery: unexpectedDownloads,
          forwardedNativeTermination: true,
        };
        entry.lifecycleWorkerActions = lifecycleTelemetry.actions;
        entry.actualRequests = lifecycleTelemetry.requests;
        entry.maxMainThreadHeartbeatGapIncludingLifecycleMs = Math.max(
          ...lifecycleTelemetry.gaps,
        );
        entry.cancelAndExportRecovery = true;
      }
      // Include errors and requests produced by cancellation/recovery too.
      assert.equal(entry.networkViolations.length, 0);
      assert.equal(entry.errors.length, 0);
      entry.browserChecksPassed = true;
    } catch (e) {
      entry.error = String(e.stack ?? e).slice(0, 1800);
      if (page) {
        entry.visibleError = await page
          .locator('.error')
          .allTextContents()
          .catch(() => []);
        await page
          .screenshot({
            path: path.join(output, `failure-${run.size}-${run.format}.png`),
          })
          .catch(() => {});
      }
    } finally {
      clearInterval(sampleTimer);
      clearInterval(exportSampleTimer);
      await pendingSample;
      if (entry.peakBeforeLifecycleRssBytes !== undefined) {
        entry.peakIncludingLifecycleRssBytes = entry.peakChromiumRssBytes;
        entry.peakChromiumRssBytes = entry.peakBeforeLifecycleRssBytes;
      }
      await browser?.close().catch(() => {});
    }
    if (downloadPath) {
      try {
        // Independent OOXML reader; verify actual source counts, references,
        // signed amounts and sums after the browser has closed. Not timed above.
        entry.independentExportDetails = await verifyPerformanceExport(
          await readFile(downloadPath),
          run.sources,
          run.totals,
        );
        entry.independentExportSourceCheck = true;
        const membership = async (file) => {
          const { stdout } = await shell(
            'python3',
            [
              membershipChecker,
              file,
              `--rows=${run.size}`,
              `--format=${run.format}`,
            ],
            { maxBuffer: 1024 * 1024 },
          );
          const result = JSON.parse(stdout);
          assert.equal(result.verified, true);
          return result;
        };
        entry.independentMembershipDetails = await membership(downloadPath);
        entry.independentExportMembershipCheck = true;
        if (entry.cancelAndExportRecovery) {
          await verifyPerformanceExport(
            await readFile(
              path.join(output, `cancel-recovery-${run.size}.xlsx`),
            ),
            run.sources,
            run.totals,
          );
          entry.independentRecoveryExportCheck = true;
          entry.independentRecoveryMembershipDetails = await membership(
            path.join(output, `cancel-recovery-${run.size}.xlsx`),
          );
          entry.independentRecoveryMembershipCheck = true;
        }
      } catch (e) {
        entry.independentExportSourceCheck = false;
        entry.exportError = String(e.stack ?? e).slice(0, 1300);
      }
    }
    // A download and intact source sheets do not establish that result or
    // lifecycle assertions passed. Fail closed on any recorded failure.
    entry.completed =
      entry.downloadCompleted &&
      entry.browserChecksPassed &&
      entry.independentExportSourceCheck === true &&
      entry.independentExportMembershipCheck === true &&
      entry.memorySamplesSuccessful > 0 &&
      entry.memorySamplesDuringExport > 0 &&
      entry.memorySamplingErrors === 0 &&
      entry.peakChromiumRssBytes > 0 &&
      (!entry.lifecycleRequired ||
        (entry.cancelAndExportRecovery === true &&
          entry.nativeProtocolOverlap?.status === 'PASS' &&
          entry.repeatedBusyExportRequests === 1 &&
          entry.cancelledExportTermination?.forwardedNativeTermination ===
            true &&
          entry.cancelledExportTermination.totalDownloadsThroughRecovery ===
            1 &&
          entry.independentRecoveryExportCheck === true &&
          entry.independentRecoveryMembershipCheck === true)) &&
      !entry.error &&
      !entry.exportError &&
      entry.networkViolations.length === 0 &&
      entry.errors.length === 0;
    report.runs.push(entry);
    await writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        rows: run.size,
        format: run.format,
        completed: entry.completed,
        exportVerified: entry.independentExportSourceCheck,
        seconds: (entry.stages.totalUiMs ?? 0) / 1000,
        error: entry.error?.slice(0, 180),
        rssMb: entry.peakChromiumRssBytes / 1024 / 1024,
      }),
    );
  }
} finally {
  server.close();
}
if (
  report.runs.length !== prepared.length ||
  report.runs.some((r) => !r.completed)
)
  process.exitCode = 1;
