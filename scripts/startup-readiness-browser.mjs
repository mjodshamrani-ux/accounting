// Synthetic native App startup prerequisite regression. Only delivery of the
// untouched real ready Worker reply is held; no financial response is invented.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gatewayCopy } from '../lib/i18n/payment-gateway.ts';
import { holdOriginalWorkerReplies } from './supplier-main-pending-browser.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(
  process.env.MIZAN_DIST_DIR ?? path.join(repo, 'dist'),
);
const proofRoot = path.resolve(
  process.env.MIZAN_PROOF_DIR ?? path.join(repo, 'work/qa-startup-readiness'),
);
if (process.argv.length !== 2)
  throw Error(
    'Startup readiness driver uses MIZAN_PROOF_DIR and MIZAN_DIST_DIR; positional arguments are not supported.',
  );
await mkdir(proofRoot, { recursive: true });
const out = await mkdtemp(path.join(proofRoot, 'attempt-'));
console.log('Native startup proof directory: ' + out);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contractBytes = await readFile(
  path.join(
    repo,
    'audit/integration-continuation-v1/frozen/domain-startup-readiness.json',
  ),
);
const contract = JSON.parse(contractBytes.toString('utf8'));
assert.equal(contract.domains.length, 11);
assert.deepEqual(contract.languages, ['ar', 'en']);
const binding = {
  indexSha256: sha(await readFile(path.join(dist, 'index.html'))),
  contractSha256: sha(contractBytes),
  appSha256: sha(await readFile(path.join(repo, 'app/page.tsx'))),
};
await writeFile(
  path.join(out, 'build-contract-binding.json'),
  JSON.stringify(binding, null, 2),
);
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const server = createServer(async (req, res) => {
  try {
    let rel = new URL(req.url, 'http://local').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(dist, '.' + rel);
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
const cases = [];
let active;
try {
  for (const lang of contract.languages) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    await context.addInitScript(holdOriginalWorkerReplies);
    await context.addInitScript(() => {
      globalThis.holdOriginalWorkerAction = 'ready';
      globalThis.startupRequests = [];
      const nativePost = Object.getOwnPropertyDescriptor(
        Worker.prototype,
        'postMessage',
      ).value;
      Worker.prototype.postMessage = function (message, ...args) {
        globalThis.startupRequests.push({
          time: performance.now(),
          action: message?.action,
          id: message?.id,
        });
        return nativePost.call(this, message, ...args);
      };
    });
    const page = await context.newPage();
    active = page;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
    await page
      .locator(`.language-switch button[lang="${lang}"]:visible`)
      .first()
      .click();
    await page.waitForFunction(
      () => globalThis.heldOriginalWorkerReplies.length === 1,
    );
    const nav = page.locator('[data-domain-navigation]');
    const buttons = nav.getByRole('button');
    assert.equal(await buttons.count(), 12);
    const disabled = [];
    for (const button of await buttons.all()) {
      assert.equal(await button.isDisabled(), true);
      disabled.push(await button.innerText());
      await button.evaluate((el) => el.click());
    }
    // App preserves mounted domain state in hidden workspaces. A disabled
    // navigation click must not expose a workspace or publish visible metrics.
    assert.equal(await page.locator('[data-gateway-workspace]:visible').count(), 0);
    assert.equal(await page.locator('.metric:visible').count(), 0);
    const heldRequests = await page.evaluate(() => globalThis.startupRequests);
    assert.deepEqual(
      heldRequests.map((x) => x.action),
      ['ready'],
    );
    await page.screenshot({
      path: path.join(out, lang + '-ready-held.png'),
      fullPage: true,
    });
    await page.evaluate(() =>
      globalThis.heldOriginalWorkerReplies
        .splice(0)
        .forEach((release) => release()),
    );
    await buttons.first().waitFor();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll('[data-domain-navigation] button'),
      ).every((b) => !b.disabled),
    );
    for (const button of await buttons.all())
      assert.equal(await button.isEnabled(), true);
    const copy = gatewayCopy[lang];
    await nav.getByRole('button', { name: copy.title, exact: true }).click();
    const workspace = page.locator('[data-gateway-workspace]');
    await workspace
      .getByRole('button', { name: copy.demo, exact: true })
      .click();
    await workspace.locator('[data-gateway-status]').waitFor();
    assert.equal(
      await workspace.locator('[data-gateway-status]').innerText(),
      copy.status['needs-review'],
    );
    const pending = page.waitForEvent('download');
    await workspace
      .getByRole('button', { name: copy.save, exact: true })
      .click();
    const downloaded = await pending;
    const sessionFile = path.join(
      out,
      lang + '-gateway-unaccepted.session.json',
    );
    await downloaded.saveAs(sessionFile);
    const session = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(session.files.length, 4);
    assert.deepEqual(session.events, []);
    assert.ok(session.files.every((f) => !Object.hasOwn(f, 'sheets')));
    const requests = await page.evaluate(() => globalThis.startupRequests);
    assert.equal(requests.filter((x) => x.action === 'gateway-read').length, 4);
    assert.equal(
      requests.filter((x) => x.action === 'gateway-reconcile').length,
      1,
    );
    assert.deepEqual(pageErrors, []);
    await page.screenshot({
      path: path.join(out, lang + '-gateway-ready.png'),
      fullPage: true,
    });
    cases.push({
      lang,
      disabledDomainNames: disabled,
      allTwelveDisabled: true,
      heldRequests,
      allTwelveAvailableAfterRealReady: true,
      originalGatewayFiles: session.files.map((f) => f.name),
      acceptedFinancialEvents: session.events.length,
      status: await workspace.locator('[data-gateway-status]').innerText(),
      requests,
      pageErrors,
    });
    await writeFile(
      path.join(out, 'report.partial.json'),
      JSON.stringify({ binding, cases }, null, 2),
    );
    await context.close();
  }
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ binding, cases }, null, 2),
  );
  console.log(JSON.stringify({ binding, cases }));
} catch (error) {
  await writeFile(path.join(out, 'failure.txt'), String(error.stack));
  if (active && !active.isClosed()) {
    await writeFile(
      path.join(out, 'failure-body.txt'),
      await active.locator('body').innerText(),
    );
    await active.screenshot({
      path: path.join(out, 'failure.png'),
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
