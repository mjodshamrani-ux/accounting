import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';

const contract = JSON.parse(
  await readFile('audit/visual-numeric/fixtures/contract.json', 'utf8'),
);
const image = await readFile('audit/visual-numeric/fixtures/amounts.png');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(image), contract.source.sha256);
// Use the browser's non-SIMD core and exact pinned models used by the site.
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'\">",
      );
    } else {
      assert.match(
        req.url,
        /^\/ocr\/(?:worker|worker-vendor|tesseract-core-lstm.wasm)\.js$/,
      );
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(path.join('public', req.url)));
    }
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const requests = [];
try {
  const page = await browser.newPage();
  page.on('request', (request) => {
    if (!request.url().startsWith('blob:'))
      requests.push({
        method: request.method(),
        url: request.url().replace(base, '$LOCAL'),
      });
  });
  await page.goto(base);
  // This harness submits actual pixels to an actual native Worker. It cannot
  // inject results into React, the production client, or the accounting engine.
  const observation = await page.evaluate(
    async ({ base, png, cells }) => {
      const blob = new Blob(
        [
          `self.__mizanOcrVendorUrl=${JSON.stringify(`${base}/ocr/worker-vendor.js`)};importScripts(${JSON.stringify(`${base}/ocr/worker.js`)});`,
        ],
        { type: 'text/javascript' },
      );
      const objectUrl = URL.createObjectURL(blob);
      const worker = new Worker(objectUrl);
      let seq = 0;
      let pending;
      worker.onmessage = ({ data }) => {
        if (
          !pending ||
          data.workerId !== 'numeric-audit' ||
          data.jobId !== pending.id ||
          data.action !== pending.action
        )
          return;
        if (data.status === 'progress') return;
        const job = pending;
        pending = undefined;
        clearTimeout(job.timer);
        if (data.status === 'resolve') job.resolve(data.data);
        else job.reject(new Error('Native OCR failed'));
      };
      const run = (action, payload) =>
        new Promise((resolve, reject) => {
          if (pending) return reject(new Error('Concurrent audit job'));
          const id = String(++seq);
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Native OCR deadline'));
          }, 60000);
          pending = { id, action, timer, resolve, reject };
          worker.postMessage({
            workerId: 'numeric-audit',
            jobId: id,
            action,
            payload,
          });
        });
      try {
        await run('load', {
          options: {
            lstmOnly: true,
            corePath: `${base}/ocr/tesseract-core-lstm.wasm.js`,
            logging: false,
          },
        });
        await run('loadLanguage', {
          langs: 'eng+ara',
          options: { cacheMethod: 'none', gzip: true, lstmOnly: true },
        });
        await run('initialize', { langs: 'eng+ara', oem: 1, config: {} });
        const image = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const read = async (options) => {
          const start = performance.now();
          const raw = await run('recognize', {
            image,
            options,
            output: { text: true, blocks: true },
          });
          return { milliseconds: performance.now() - start, raw };
        };
        const baseline = await read({});
        const observations = [{ profile: 'whole-page-default', ...baseline }];
        const profiles = [
          ['region-line-7', { tessedit_pageseg_mode: '7' }],
          ['region-raw-line-13', { tessedit_pageseg_mode: '13' }],
          [
            'region-line-7-whitelist',
            {
              tessedit_pageseg_mode: '7',
              tessedit_char_whitelist:
                '0123456789٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹.,٬٫-−+()',
            },
          ],
        ];
        for (const [profile, options] of profiles)
          for (const cell of cells)
            observations.push({
              profile,
              cell: cell.id,
              ...(await read({ ...options, rectangle: cell.rectangle })),
            });
        return observations;
      } finally {
        worker.terminate();
        URL.revokeObjectURL(objectUrl);
      }
    },
    { base, png: image.toString('base64'), cells: contract.cells },
  );
  // Remove only whitespace and directional display controls for this metric.
  // No digit, sign, separator or parentheses repair is permitted.
  const display = (text) =>
    text.replace(/[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
  const words =
    observation[0].raw.blocks?.flatMap((b) =>
      b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)),
    ) || [];
  const comparisons = contract.cells.flatMap((cell) => {
    const r = cell.rectangle;
    const whole = words
      .filter(
        (w) =>
          w.bbox.x0 >= r.left &&
          w.bbox.x1 <= r.left + r.width &&
          w.bbox.y0 >= r.top &&
          w.bbox.y1 <= r.top + r.height,
      )
      .sort((a, b) => a.bbox.x0 - b.bbox.x0)
      .map((w) => w.text)
      .join(' ');
    return [
      { profile: 'whole-page-default', observed: whole },
      ...observation
        .filter((o) => o.cell === cell.id)
        .map((o) => ({ profile: o.profile, observed: o.raw.text })),
    ].map((o) => ({
      cell: cell.id,
      kind: cell.kind,
      expected: cell.expected,
      ...o,
      exactDisplay: display(o.observed) === display(cell.expected),
    }));
  });
  const profileNames = [...new Set(comparisons.map((c) => c.profile))];
  const summary = profileNames.map((profile) => {
    const rows = comparisons.filter((c) => c.profile === profile);
    return {
      profile,
      amountExact: rows.filter((c) => c.kind === 'amount' && c.exactDisplay)
        .length,
      amounts: rows.filter((c) => c.kind === 'amount').length,
      controlExact: rows.filter(
        (c) => c.kind === 'non-amount' && c.exactDisplay,
      ).length,
      controls: rows.filter((c) => c.kind === 'non-amount').length,
    };
  });
  assert.ok(
    requests.every(
      (r) =>
        r.method === 'GET' &&
        /^\$LOCAL\/(?:ocr\/(?:worker|worker-vendor|tesseract-core-lstm.wasm)\.js)?$/.test(
          r.url,
        ),
    ),
    'Unexpected network access',
  );
  const assetHashes = {};
  for (const name of [
    'worker.js',
    'worker-vendor.js',
    'tesseract-core-lstm.wasm.js',
  ])
    assetHashes[name] = sha(await readFile(`public/ocr/${name}`));
  const report = {
    classification: contract.classification,
    sourceSha256: contract.source.sha256,
    browser: browser.version(),
    assetHashes,
    financialPromotion: false,
    requests,
    summary,
    comparisons,
    observation,
  };
  const out = process.env.NUMERIC_OUT || 'work/visual-numeric/replay';
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
