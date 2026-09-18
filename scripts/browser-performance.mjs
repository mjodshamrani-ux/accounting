/** Full product benchmark. Synthetic files are prepared BEFORE the clock starts.
 * Worker action time includes structured cloning; UI/export time is separate.
 * RSS is sampled for this Chromium instance, not JS engine object memory. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { verifyPerformanceExport } from './verify-performance-export.mjs';
const args = process.argv.slice(2),
  option = (key, fallback) =>
    args.find((x) => x.startsWith(key + '='))?.slice(key.length + 1) ??
    fallback;
const dist = path.resolve(option('--dist', 'dist'));
const output = path.resolve(option('--output', 'work/browser-performance-046'));
const sizes = option('--sizes', '100,1000,5000,20000').split(',').map(Number);
const formats = option('--formats', 'csv,xlsx').split(',');
const shell = promisify(execFile);
await mkdir(output, { recursive: true });
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
      paths = [];
    for (const [side, source] of sources.entries()) {
      const file = path.join(output, `synthetic-${size}-${side}.${format}`);
      const bytes = await encode(source.table, format);
      await writeFile(file, bytes);
      paths.push(file);
    }
    const totals = sources.map((source) =>
      source.rows
        .reduce((sum, row) => sum + BigInt(row[7].replace('.', '')), 0n)
        .toString(),
    );
    prepared.push({ size, format, sources, paths, totals });
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
  schema: 'tarasuf-browser-performance-1',
  createdAt: new Date().toISOString(),
  dist,
  node: process.version,
  memoryMeasurement:
    'Sum of RSS for this Chromium instance via SystemInfo.getProcessInfo and ps, sampled every 500ms; includes browser, renderer and worker processes, may double-count shared pages. Excludes Node fixture creation and offline export verification.',
  timingDefinition:
    'Files generated before measurement. UI upload/comparison/export wall time. Worker action timings include serialization and dispatch. Reconciliation includes normalization plus matching; export includes original re-read/recomputation, workbook construction and ZIP serialization.',
  runs: [],
};
try {
  for (const run of prepared) {
    const entry = {
      rowsPerSide: run.size,
      format: run.format,
      sourceBytes: await Promise.all(
        run.paths.map(async (p) => (await readFile(p)).length),
      ),
      stages: {},
      workerActions: [],
      networkViolations: [],
      errors: [],
      peakChromiumRssBytes: 0,
      completed: false,
    };
    let browser,
      context,
      page,
      sampleTimer,
      sampling = false,
      downloadPath;
    try {
      browser = await chromium.launch({ headless: true });
      report.browser = browser.version();
      const cdp = await browser.newBrowserCDPSession();
      const sample = async () => {
        if (sampling) return;
        sampling = true;
        try {
          const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
          const ids = processInfo.map((p) => p.id).join(',');
          const { stdout } = await shell('ps', ['-o', 'rss=', '-p', ids]);
          const rss = stdout
            .trim()
            .split(/\s+/)
            .reduce((a, x) => a + Number(x) * 1024, 0);
          entry.peakChromiumRssBytes = Math.max(
            entry.peakChromiumRssBytes,
            rss,
          );
        } catch {
        } finally {
          sampling = false;
        }
      };
      sampleTimer = setInterval(sample, 500);
      await sample();
      context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true,
      });
      context.setDefaultTimeout(55000);
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
          gaps: [],
          completed: [],
          last: performance.now(),
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.requests = new Map();
            this.addEventListener('message', (e) => {
              const d = e.data;
              if (d?.channel !== 'mizan-accounting-v1') return;
              const start = this.requests.get(d.id);
              if (start) {
                window.__bench.actions.push({
                  action: start.action,
                  ms: performance.now() - start.time,
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
                  members: r.cases.reduce(
                    (a, c) =>
                      a + c.supplierMembers.length + c.ledgerMembers.length,
                    0,
                  ),
                });
              }
            });
          }
          postMessage(message, ...rest) {
            if (message?.channel === 'mizan-accounting-v1')
              this.requests.set(message.id, {
                action: message.action,
                time: performance.now(),
              });
            return super.postMessage(message, ...rest);
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
      await page.waitForFunction(
        () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
      );
      await context.setOffline(true);
      const t = performance.now();
      for (const [i, label] of [
        'كشف المورد',
        'تقرير الحسابات الدائنة',
      ].entries()) {
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
      await compare.click();
      await page
        .getByRole('heading', { name: 'مساحة المراجعة', exact: true })
        .waitFor();
      entry.stages.reconcileAndReviewMs = performance.now() - compareStart;
      const prepareStart = performance.now();
      await page
        .getByRole('button', { name: 'إعداد ورقة العمل', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
        .waitFor();
      entry.stages.prepareExportScreenMs = performance.now() - prepareStart;
      const exportStart = performance.now();
      const download = page.waitForEvent('download', { timeout: 55000 });
      await page
        .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
        .click();
      const saved = await download;
      downloadPath = path.join(output, `export-${run.size}-${run.format}.xlsx`);
      await saved.saveAs(downloadPath);
      entry.stages.exportToDownloadMs = performance.now() - exportStart;
      entry.stages.totalUiMs = performance.now() - t;
      const telemetry = await page.evaluate(() => window.__bench);
      entry.workerActions = telemetry.actions;
      entry.results = telemetry.completed;
      entry.maxMainThreadHeartbeatGapMs = Math.max(...telemetry.gaps);
      entry.completed = true;
      assert.equal(entry.results.at(-1).members, run.size * 2);
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
      if (
        option('--lifecycle', 'no') === 'yes' &&
        run.size === 20000 &&
        run.format === 'xlsx'
      ) {
        entry.peakBeforeLifecycleRssBytes = entry.peakChromiumRssBytes;
        let unexpectedDownloads = 0;
        const countDownload = () => unexpectedDownloads++;
        page.on('download', countDownload);
        await page
          .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
          .click();
        await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
        await page.getByText('أُلغيت العملية.', { exact: true }).waitFor();
        await page.waitForTimeout(250);
        assert.equal(
          unexpectedDownloads,
          0,
          'cancelled export must not publish a late workbook',
        );
        page.off('download', countDownload);
        const retry = page.waitForEvent('download', { timeout: 55000 });
        await page
          .getByRole('button', { name: 'تنزيل مسودة Excel', exact: true })
          .click();
        await (
          await retry
        ).saveAs(path.join(output, 'cancel-recovery-20000.xlsx'));
        entry.cancelAndExportRecovery = true;
        entry.peakIncludingLifecycleRssBytes = entry.peakChromiumRssBytes;
        entry.peakChromiumRssBytes = entry.peakBeforeLifecycleRssBytes;
      }
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
        if (entry.cancelAndExportRecovery) {
          await verifyPerformanceExport(
            await readFile(path.join(output, 'cancel-recovery-20000.xlsx')),
            run.sources,
            run.totals,
          );
          entry.independentRecoveryExportCheck = true;
        }
      } catch (e) {
        entry.independentExportSourceCheck = false;
        entry.exportError = String(e.stack ?? e).slice(0, 1300);
      }
    }
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
  report.runs.some(
    (r) => !r.completed || r.independentExportSourceCheck !== true,
  )
)
  process.exitCode = 1;
