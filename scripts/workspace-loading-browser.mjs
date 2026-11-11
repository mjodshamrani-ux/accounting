// UX-9(c) browser acceptance on the built page: the code of a workspace is
// not requested before its type is chosen; the first choice requests it, its
// heading takes the focus when it appears, and a second choice requests
// nothing; a load that fails says so under a heading that takes the focus
// and offers to reload the page, after which the type opens. Kept work
// across types is proven by test:browser:unified-workspace.
//   MIZAN_CHROMIUM=... node scripts/workspace-loading-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';

const repo = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(
  process.env.MIZAN_DIST_DIR ?? path.join(repo, 'dist'),
);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(dist, '.' + rel);
    if (!file.startsWith(dist + path.sep)) throw Error('outside');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
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
const WORKSPACE_CHUNK =
  /\/assets\/(payroll|fixed-assets|inventory-register|payment-gateway|intercompany|tb-financial|bank|allocation|gl-tb|ar|clearing)-workspace-[\w-]+\.js$/;
const results = [];

// A wait that runs out fails as an assertion naming what did not happen,
// not as a timeout (DEV-22).
async function within(promise, message) {
  try {
    return await promise;
  } catch (error) {
    if (error?.name === 'TimeoutError') assert.fail(message);
    throw error;
  }
}

async function open(language, width, failFirst) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  await context.addInitScript((lang) => {
    try {
      localStorage.setItem('tarasuf.lang', lang);
    } catch {
      /* The default language is Arabic. */
    }
  }, language);
  const requested = [];
  let failed = 0;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(base)) return route.abort();
    const chunk = WORKSPACE_CHUNK.exec(new URL(url).pathname);
    if (chunk) requested.push(chunk[1]);
    if (chunk && chunk[1] === failFirst && failed === 0) {
      failed++;
      return route.abort('internetdisconnected');
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(base + '/');
  await page.waitForFunction(
    () =>
      !document.querySelector('.startup-readiness') &&
      [...document.querySelectorAll('input[type=file]')].some(
        (x) => !x.disabled,
      ),
    null,
    { timeout: 120000 },
  );
  return { context, page, requested, errors };
}

async function choose(page, domain) {
  const select = page.locator(
    'select[data-reconciliation-type-select]:visible',
  );
  await page.waitForFunction(
    (el) => !el.disabled,
    await select.elementHandle(),
  );
  await select.selectOption(domain);
}

const focusedHeading = (page, domain) =>
  within(
    page.waitForFunction(
      (id) => {
        const el = document.activeElement;
        return (
          !!el &&
          el.matches('h1, h2') &&
          !!el.closest(`[data-domain-panel="${id}"]`) &&
          el.textContent.trim()
        );
      },
      domain,
      { timeout: 30000 },
    ),
    `${domain}: the workspace heading takes the focus`,
  );

for (const { language, width, copy } of [
  { language: 'ar', width: 1440, copy: ar },
  { language: 'en', width: 390, copy: en },
]) {
  // First choice, second choice, return.
  {
    const { context, page, requested, errors } = await open(language, width);
    assert.deepEqual(
      requested,
      [],
      `${language}: no workspace code before a type is chosen`,
    );
    await choose(page, 'bank');
    const heading = await focusedHeading(page, 'bank');
    assert.ok(
      await heading.jsonValue(),
      `${language}: the bank heading takes the focus`,
    );
    assert.deepEqual(
      requested,
      ['bank'],
      `${language}: the first choice requests the bank code`,
    );
    assert.equal(
      await page
        .locator('[data-domain-panel="bank"] [data-workspace-loading]')
        .count(),
      0,
      `${language}: no loading line stays once the workspace is there`,
    );
    await choose(page, 'payroll');
    await focusedHeading(page, 'payroll');
    await choose(page, 'bank');
    await focusedHeading(page, 'bank');
    assert.deepEqual(
      requested,
      ['bank', 'payroll'],
      `${language}: a type chosen again requests nothing`,
    );
    assert.deepEqual(errors, [], `${language}: no page error`);
    results.push({
      language,
      width,
      case: 'first choice',
      requested: [...requested],
    });
    await context.close();
  }
  // A failed load, then a reload.
  {
    const { context, page, requested, errors } = await open(
      language,
      width,
      'clearing',
    );
    await choose(page, 'clearing');
    const failed = page.locator(
      '[data-domain-panel="clearing"] [data-workspace-load-failed]',
    );
    await within(
      failed.waitFor({ state: 'visible', timeout: 30000 }),
      `${language}: a failed load is shown in the panel`,
    );
    assert.equal(
      (await failed.locator('h2').textContent()).trim(),
      copy.app.shell.workspaceLoadFailedTitle,
      `${language}: the failure is named under its heading`,
    );
    await within(
      page.waitForFunction(
        () =>
          document.activeElement
            ?.closest('[data-workspace-load-failed]')
            ?.querySelector('h2') === document.activeElement,
        null,
        { timeout: 10000 },
      ),
      `${language}: the failure heading takes the focus`,
    );
    assert.equal(
      (await failed.locator('[role="alert"]').textContent()).trim(),
      copy.app.shell.workspaceLoadFailed,
      `${language}: the failure says what to do`,
    );
    assert.deepEqual(
      requested,
      ['clearing'],
      `${language}: the failed load was requested once`,
    );
    // The command reloads the page; with nothing unsaved it asks nothing.
    const reload = failed.getByRole('button', {
      name: copy.app.shell.workspaceReload,
    });
    await reload.focus();
    await within(
      Promise.all([
        page.waitForEvent('load', { timeout: 30000 }),
        page.keyboard.press('Enter'),
      ]),
      `${language}: the command reloads the page`,
    );
    await page.waitForFunction(
      () =>
        !document.querySelector('.startup-readiness') &&
        [...document.querySelectorAll('input[type=file]')].some(
          (x) => !x.disabled,
        ),
      null,
      { timeout: 120000 },
    );
    await choose(page, 'clearing');
    await focusedHeading(page, 'clearing');
    assert.equal(
      await failed.count(),
      0,
      `${language}: after the reload the type opens`,
    );
    assert.deepEqual(
      requested,
      ['clearing', 'clearing'],
      `${language}: the reloaded page requests the code again`,
    );
    assert.deepEqual(errors, [], `${language}: no page error`);
    results.push({
      language,
      width,
      case: 'failed load, reload',
      requested: [...requested],
    });
    await context.close();
  }
}
console.log(JSON.stringify({ workspaceLoading: 'passed', cases: results }));
await browser.close();
server.close();
