import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifySpecializedDomainAssistant } from './specialized-domain-assistant-browser-cases.mjs';
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      rel = url.pathname === '/' ? '/index.html' : url.pathname,
      file = path.resolve(root, '.' + decodeURIComponent(rel));
    if (!file.startsWith(root + path.sep)) throw Error('path');
    const b = await readFile(file);
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
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
  const ctx = await browser.newContext({ acceptDownloads: true });
  ctx.setDefaultTimeout(30000);
  await ctx.route('**/*', (route) => {
    const address = route.request().url();
    return address.startsWith(url) ||
      address.startsWith('blob:') ||
      address.startsWith('data:')
      ? route.continue()
      : route.abort();
  });
  ctx.on('request', (r) => {
    if (
      !r.url().startsWith(url) &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    )
      external.push(r.url());
    if (r.method() === 'POST') posts.push(r.url());
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const out =
    process.argv.find((a) => a.startsWith('--out='))?.slice(6) ??
    'work/specialized-domain-assistant/browser';
  await page.goto(url);
  assert.ok(
    (await page.locator('bdi').allTextContents()).includes(
      JSON.parse(await readFile('package.json', 'utf8')).version,
    ),
    'visible local interface version',
  );
  let result;
  try {
    result = await verifySpecializedDomainAssistant(page, url, out);
  } catch (error) {
    await mkdir(out, { recursive: true });
    await writeFile(
      `${out}/failure-${Date.now()}.json`,
      JSON.stringify(
        {
          error: String(error),
          errors,
          external,
          posts,
          body: await page.locator('body').innerText(),
        },
        null,
        2,
      ),
    );
    throw error;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(posts, []);
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...result,
        browserVersion: browser.version(),
        executablePath: process.env.MIZAN_CHROMIUM ?? 'playwright-default',
        errors,
        external,
        posts,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
