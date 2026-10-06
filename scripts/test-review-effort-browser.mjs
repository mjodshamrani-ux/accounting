import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyReviewEffort } from './review-effort-browser-cases.mjs';
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    let rel = new URL(req.url, 'http://localhost').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    if (rel === '/') rel = '/index.html';
    const filename = path.resolve(root, '.' + rel);
    if (!filename.startsWith(root + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(filename)] ?? 'application/octet-stream',
    );
    res.end(await readFile(filename));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  await verifyReviewEffort(
    await context.newPage(),
    `http://127.0.0.1:${server.address().port}/mizan-test/`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
