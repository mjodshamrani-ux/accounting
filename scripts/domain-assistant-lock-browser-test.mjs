import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve('dist'),
  out = path.resolve(
    process.argv.find((a) => a.startsWith('--out='))?.slice(6) ??
      'work/domain-assistant/bank-lock-closure',
  );
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(rel === '/' ? '/index.html' : rel),
    );
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const external = [],
  posts = [],
  errors = [],
  checks = {};
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MIZAN_CHROMIUM,
  });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(30000);
  ctx.on('request', (r) => {
    if (
      !r.url().startsWith(url) &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:')
    )
      external.push(r.url());
    if (r.method() === 'POST') posts.push(r.url());
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const nativePost = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      'postMessage',
    ).value;
    globalThis.reviewWorkerDelay = 0;
    Worker.prototype.postMessage = function (...args) {
      if (globalThis.reviewWorkerDelay)
        setTimeout(
          () => nativePost.apply(this, args),
          globalThis.reviewWorkerDelay,
        );
      else nativePost.apply(this, args);
    };
  });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Payment gateway batch evidence',
      exact: true,
    })
    .click();
  const demo = page.getByRole('button', {
    name: 'Open a synthetic gateway example',
    exact: true,
  });
  await demo.click();
  const a = page.locator('[data-domain-evidence-assistant]');
  await a.waitFor();
  await a.locator('[data-evidence-question="amounts"]').click();
  await a
    .getByLabel('Question about the result', { exact: true })
    .fill('What is the next step?');
  assert.equal(
    await a.locator('[data-evidence-answer] h4').innerText(),
    'What are the recorded amounts?',
  );
  checks.headingTracksAnsweredPreset = true;
  await page.evaluate(() => (globalThis.reviewWorkerDelay = 600));
  await demo.click();
  await page.waitForFunction(() =>
    document.querySelector('[data-gateway-workspace][aria-busy="true"]'),
  );
  assert.equal(await a.locator('button:enabled').count(), 0);
  assert.equal(await a.locator('input:enabled').count(), 0);
  checks.gatewayBusyDisablesQuestions = true;
  await page.waitForFunction(
    () => !document.querySelector('[data-gateway-workspace][aria-busy="true"]'),
  );
  assert.equal(await a.locator('[data-evidence-answer]').count(), 0);
  assert.equal(
    await a
      .getByLabel('Question about the result', { exact: true })
      .inputValue(),
    '',
  );
  checks.resultReplacementClearsSynchronously = true;
  await a.locator('[data-evidence-question="sources"]').click();
  await page
    .getByLabel('Gateway scope Policy version', { exact: true })
    .fill('Changed scope');
  assert.equal(
    await page.locator('[data-domain-evidence-assistant]').count(),
    0,
  );
  checks.invalidScopeUnmounts = true;
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', { name: 'Bank movements', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Open synthetic bank movement example',
      exact: true,
    })
    .click();
  const b1 = page.locator('[data-domain-evidence-assistant]').first();
  await b1.waitFor();
  await b1.locator('[data-evidence-question="status"]').click();
  await page.evaluate(() => (globalThis.reviewWorkerDelay = 600));
  await page
    .getByRole('button', {
      name: 'Open a synthetic balance reconciliation example',
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-testid="bank-balance-workspace"][aria-busy="true"]',
    ),
  );
  checks.bankB1EnabledQuestionsDuringB2Busy = await b1
    .locator('button:enabled')
    .count();
  checks.bankB1EnabledInputDuringB2Busy = await b1
    .locator('input:enabled')
    .count();
  checks.browserVersion = browser.version();
  assert.equal(checks.bankB1EnabledQuestionsDuringB2Busy, 0);
  assert.equal(checks.bankB1EnabledInputDuringB2Busy, 0);
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-testid="bank-balance-workspace"][aria-busy="true"]',
      ),
  );
  assert.equal(await b1.locator('button:enabled').count(), 4);
  checks.bankUnlocksAfterCompletion = true;
  await page.evaluate(() => (globalThis.reviewWorkerDelay = 2000));
  await page
    .getByRole('button', {
      name: 'Open a synthetic balance reconciliation example',
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-testid="bank-balance-workspace"][aria-busy="true"]',
    ),
  );
  await page
    .getByRole('button', { name: 'Cancel balance processing', exact: true })
    .click();
  assert.equal(await b1.locator('button:enabled').count(), 4);
  assert.equal(await b1.locator('input:enabled').count(), 1);
  checks.bankUnlocksAfterCancel = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(posts, []);
  await writeFile(
    path.join(out, 'ui-probes-result.json'),
    JSON.stringify({ checks, errors, external, posts }, null, 2) + '\n',
  );
  console.log(JSON.stringify(checks));
  assert.equal(
    checks.bankB1EnabledQuestionsDuringB2Busy,
    0,
    'P2: B1 questions must be disabled while B2 processing locks the shared bank workspace',
  );
  assert.equal(checks.bankB1EnabledInputDuringB2Busy, 0);
} catch (error) {
  await writeFile(
    path.join(out, 'ui-probes-failure-fourth.json'),
    JSON.stringify(
      { checks, errors, external, posts, error: String(error) },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
