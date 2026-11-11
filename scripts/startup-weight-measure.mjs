// UX-9 measurement driver: what the first page requests before the tool is
// ready, and when it paints and is ready. Diagnostic, not a gate: its numbers
// go into the UX-9 record before and after each part. Arabic, median of N runs.
//
//   node scripts/startup-weight-measure.mjs [dist] [runs] [out.json]
//
// Default: 390 and 1440 px at 1x and 4x CPU, files sent as they are.
// PHONE=1: 390 px at 4x CPU, files sent gzip-encoded as GitHub Pages sends
// them, over Lighthouse's mobile network (150 ms round trip, 1.6 Mbps down).
// Sizes are of every file requested before readiness: raw, gzip -9, brotli 11.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';
import { chromium } from 'playwright';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.argv[2] ?? path.join(repo, 'dist'));
const runs = Number(process.argv[3] ?? 5);
const outFile = path.resolve(
  process.argv[4] ?? path.join(repo, 'work/ux9/startup-weight.json'),
);
const phone = process.env.PHONE === '1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.png': 'image/png',
};
const zipped = new Set(['.html', '.js', '.css', '.svg', '.json']);
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw Error('outside');
    const body = await readFile(file);
    const z = phone && zipped.has(path.extname(file));
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      ...(z ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(z ? gzipSync(body, { level: 9 }) : body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const out = { root, runs, phone, requests: null, timings: {} };
const sizes = phone
  ? [[390, 844]]
  : [
      [390, 844],
      [1440, 900],
    ];
const cpus = phone ? [4] : [1, 4];
for (const [width, height] of sizes)
  for (const cpu of cpus) {
    const series = [];
    for (let i = 0; i < runs; i++) {
      const ctx = await browser.newContext({ viewport: { width, height } });
      // Nothing leaves the machine: only the local server, blob: and data:.
      await ctx.route('**/*', (r) =>
        /^(blob:|data:)/.test(r.request().url()) ||
        r.request().url().startsWith(base)
          ? r.continue()
          : r.abort(),
      );
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      if (phone) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 150,
          downloadThroughput: 204800,
          uploadThroughput: 96000,
        });
      }
      const requests = [];
      page.on('requestfinished', (q) => {
        const u = q.url();
        if (u.startsWith(base))
          requests.push({
            path: new URL(u).pathname,
            type: q.resourceType(),
            at: Date.now(),
          });
      });
      await page.addInitScript(() => {
        globalThis.__long = 0;
        globalThis.__longCount = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              globalThis.__long += e.duration;
              globalThis.__longCount++;
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch {
          /* Long tasks are reported as zero where unsupported. */
        }
      });
      const started = Date.now();
      await page.goto(base + '/');
      // Ready: the startup line is gone and a file input can be used.
      await page.waitForFunction(
        () =>
          !document.querySelector('.startup-readiness') &&
          [...document.querySelectorAll('input[type=file]')].some(
            (x) => !x.disabled,
          ),
        null,
        { timeout: 180000, polling: 'raf' },
      );
      const t = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return {
          ready: performance.now(),
          dcl: nav.domContentLoadedEventEnd,
          fcp: fcp ? fcp.startTime : null,
          longTotal: globalThis.__long,
          longCount: globalThis.__longCount,
        };
      });
      // First choice: from choosing the bank type to its workspace heading
      // holding focus, the moment the accountant can read where they are.
      t.firstChoice = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const select = document.querySelector(
              'select[data-reconciliation-type-select]',
            );
            const start = performance.now();
            select.value = 'bank';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            const tick = () => {
              const focused = document.activeElement;
              if (
                focused?.matches('h1, h2') &&
                focused.closest('[data-domain-panel="bank"]')
              )
                resolve(performance.now() - start);
              else requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      series.push(t);
      if (!out.requests && (phone || (width === 1440 && cpu === 1)))
        out.requests = requests.map((r) => ({
          path: r.path,
          type: r.type,
          beforePaint: r.at - started <= (t.fcp ?? Infinity),
        }));
      await ctx.close();
    }
    const key = `${width}/cpu${cpu}${phone ? '/phone-net' : ''}`;
    out.timings[key] = Object.fromEntries(
      ['fcp', 'dcl', 'ready', 'longTotal', 'longCount', 'firstChoice'].map(
        (k) => [k, Math.round(median(series.map((s) => s[k] ?? 0)))],
      ),
    );
    console.log(key, JSON.stringify(out.timings[key]));
  }
const rows = [];
const totals = {};
for (const r of out.requests) {
  const rel = r.path === '/' ? '/index.html' : r.path;
  let body;
  try {
    body = await readFile(path.join(root, rel));
  } catch {
    continue;
  }
  const gzip = gzipSync(body, { level: 9 }).length;
  const brotli = brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  rows.push({ path: rel, type: r.type, raw: body.length, gzip, brotli });
  totals[r.type] ??= { count: 0, raw: 0, gzip: 0, brotli: 0 };
  totals[r.type].count++;
  totals[r.type].raw += body.length;
  totals[r.type].gzip += gzip;
  totals[r.type].brotli += brotli;
}
out.rows = rows.sort((a, b) => b.raw - a.raw);
out.totals = totals;
out.all = rows.reduce(
  (s, r) => ({
    count: s.count + 1,
    raw: s.raw + r.raw,
    gzip: s.gzip + r.gzip,
    brotli: s.brotli + r.brotli,
  }),
  { count: 0, raw: 0, gzip: 0, brotli: 0 },
);
console.log('totals', JSON.stringify(totals));
console.log('all', JSON.stringify(out.all));
for (const r of out.rows.slice(0, 16))
  console.log(
    r.type.padEnd(10),
    String(r.raw).padStart(9),
    String(r.gzip).padStart(8),
    r.path,
  );
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(out, null, 2));
await browser.close();
server.close();
