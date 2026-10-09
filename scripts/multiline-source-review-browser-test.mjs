import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyMultilineSourceReview } from './multiline-source-review-browser-cases.mjs';
const root = path.resolve('dist');
const server = createServer(async (request, response) => {
  try {
    const relative = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(relative === '/' ? '/index.html' : relative),
    );
    if (!file.startsWith(root + path.sep)) throw Error('path');
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const out =
  process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) ??
  'work/multiline-source-review/browser';
let browser;
const errors = [],
  external = [],
  posts = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(30000);
  context.on('request', (request) => {
    if (
      !request.url().startsWith(url) &&
      !request.url().startsWith('blob:') &&
      !request.url().startsWith('data:')
    )
      external.push(request.url());
    if (request.method() === 'POST') posts.push(request.url());
  });
  await context.addInitScript(() => {
    globalThis.multilineReviewDigestDelay = 0;
    globalThis.multilineReviewWorkerActions = [];
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      const delay = globalThis.multilineReviewDigestDelay;
      const result = await nativeDigest(...args);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return result;
    };
    const nativePost = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      'postMessage',
    ).value;
    Worker.prototype.postMessage = function (...args) {
      globalThis.multilineReviewWorkerActions.push(args[0]?.action ?? null);
      return nativePost.apply(this, args);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const report = await verifyMultilineSourceReview(page, url, out);
  const workerActions = await page.evaluate(
    () => globalThis.multilineReviewWorkerActions,
  );
  // prepareWorker() calls request('ready', {}); all financial requests remain absent.
  assert.deepEqual(workerActions, ['ready']);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(posts, []);
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      { ...report, errors, external, posts, workerActions },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      nativeChrome: true,
      cases: report.records.length,
      errors,
      external,
      posts,
      workerActions,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
