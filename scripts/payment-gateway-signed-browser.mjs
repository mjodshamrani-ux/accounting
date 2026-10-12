import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gatewayCopy } from '../lib/i18n/payment-gateway.ts';
import {
  openDomainWorkspace,
  workspaceSource,
} from './domain-navigation-support.mjs';

const root = path.resolve('dist');
const expectedAppVersion = JSON.parse(
  await readFile(path.resolve('package.json'), 'utf8'),
).version;
assert.equal(typeof expectedAppVersion, 'string');
const output = path.resolve(
  process.env.PG_SIGNED_BROWSER_DIR || 'work/payment-gateway-signed/browser',
);
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(
      root,
      '.' +
        (url.pathname === '/'
          ? '/index.html'
          : decodeURIComponent(url.pathname)),
    );
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const cases = [],
  artifacts = [],
  errors = [],
  external = [],
  posts = [];
let activePage;
try {
  for (const lang of ['ar', 'en'])
    for (const width of [1440, 390, 320]) {
      const dir = path.join(output, `${lang}-${width}`);
      await mkdir(dir, { recursive: true });
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width, height: 1000 },
      });
      context.setDefaultTimeout(30000);
      await context.route('**/*', (route) => {
        const request = route.request();
        if (request.method() === 'POST') posts.push(request.url());
        if (
          request.url().startsWith(url + '/') ||
          request.url().startsWith('blob:') ||
          request.url().startsWith('data:')
        )
          return route.continue();
        external.push(request.url());
        return route.abort();
      });
      await context.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', (event) => {
              if (
                window.__pgDelay &&
                event.data?.action === 'gateway-reconcile' &&
                event.data?.ok
              ) {
                window.__pgDelay = false;
                window.__pgDelayCaptured = true;
                event.stopImmediatePropagation();
                setTimeout(
                  () =>
                    this.dispatchEvent(
                      new MessageEvent('message', { data: event.data }),
                    ),
                  1500,
                );
              }
            });
          }
        };
      });
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', (error) =>
        errors.push({ lang, width, message: error.message }),
      );
      await page.goto(url);
      if (lang === 'en')
        await page
          .locator('header.topbar .language-switch')
          .getByRole('button', { name: 'EN English', exact: true })
          .click();
      const displayedAppVersion = (
        await page.locator('footer.footnote').innerText()
      ).trim().split('·').at(-1)?.trim();
      assert.equal(displayedAppVersion, expectedAppVersion);
      const copy = gatewayCopy[lang];
      await openDomainWorkspace(page, 'gateway');
      const w = page.locator('[data-gateway-workspace]'),
        status = w.locator('[data-gateway-status]');
      const button = (name) => w.getByRole('button', { name, exact: true });
      const wait = () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('[data-gateway-workspace]')
              ?.getAttribute('aria-busy') === 'false',
        );
      const download = async (name, destination) => {
        const pending = page.waitForEvent('download');
        await button(name).click();
        await (await pending).saveAs(destination);
        await wait();
      };
      const pair = async (name, phase) => {
        const stem = `${name}-${phase}`,
          workbook = path.join(dir, stem + '.xlsx'),
          session = path.join(dir, stem + '.json');
        await download(copy.export, workbook);
        await download(copy.save, session);
        artifacts.push({
          workbook: path.relative(output, workbook),
          session: path.relative(output, session),
          case: name,
          phase,
        });
        return session;
      };
      const attestSource = async (source) => {
        await workspaceSource(w, copy.roles[source])
          .getByRole('checkbox')
          .check();
        await w.getByLabel(copy.complete, { exact: true }).check();
      };
      await button(copy.signedDemo).click();
      await status.waitFor();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      const family = w.getByLabel(copy.amountFamily, { exact: true });
      assert.equal(await family.inputValue(), 'payment-gateway-signed-kind-1');
      await family.focus();
      assert.equal(
        await family.evaluate((element) => element === document.activeElement),
        true,
      );
      await w
        .locator('details')
        .filter({ has: page.locator('summary', { hasText: copy.roles[0] }) })
        .first()
        .locator('summary')
        .click();
      assert.ok((await w.locator('td').allTextContents()).includes('-20.00'));
      assert.ok((await w.locator('td').allTextContents()).includes('-2000'));
      await pair('sar-mixed', 'pending');
      await w
        .getByLabel(copy.reference, { exact: true })
        .fill('Synthetic browser review');
      await w
        .getByLabel(copy.note, { exact: true })
        .fill('Four supplied originals reviewed; not field evidence');
      await button(copy.accept).click();
      await wait();
      assert.equal(
        await status.innerText(),
        copy.status['consistent-with-evidence'],
      );
      const accepted = await pair('sar-mixed', 'accepted');
      await button(copy.undo).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-mixed', 'undo');
      await button(copy.reject).click();
      await wait();
      await pair('sar-mixed', 'rejected');
      await w.getByLabel(copy.restore, { exact: true }).setInputFiles(accepted);
      await wait();
      assert.equal(
        await status.innerText(),
        copy.status['consistent-with-evidence'],
      );
      await pair('sar-mixed', 'restored');
      // A family change invalidates review and cannot reinterpret the original header.
      await family.selectOption('payment-gateway-batch-1');
      assert.equal(await status.count(), 0);
      await attestSource(0);
      await button(copy.compare).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['source-error']);
      assert.equal(await button(copy.accept).isEnabled(), false);
      await family.selectOption('payment-gateway-signed-kind-1');
      await attestSource(0);
      await button(copy.compare).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      // Valid CSV sign conflict reaches the localized source-error view, never acceptance.
      await w
        .getByLabel(copy.roles[0], { exact: true })
        .setInputFiles(
          'audit/payment-gateway-signed/fixtures/negative-sale-negative/0.csv',
        );
      await wait();
      await attestSource(0);
      await button(copy.compare).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['source-error']);
      assert.equal(await button(copy.accept).isEnabled(), false);
      const issueSummary = w
        .locator('details > summary')
        .filter({ hasText: copy.issues });
      await issueSummary.click();
      await w.getByText(copy.issueReasons.SIGN_KIND, { exact: true }).waitFor();
      await pair('negative-sale-negative', 'source-error');
      await button(copy.signedDemo).click();
      await wait();
      for (let source = 0; source < 4; source++) {
        await w
          .getByLabel(copy.roles[source], { exact: true })
          .setInputFiles(
            `audit/payment-gateway-signed/fixtures/sar-zero-kinds/${source}.csv`,
          );
        await wait();
        await workspaceSource(w, copy.roles[source])
          .getByRole('checkbox')
          .check();
      }
      await w.getByLabel(copy.complete, { exact: true }).check();
      await button(copy.compare).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      const zeroSession = await pair('sar-zero-kinds', 'zero-inventory');
      const zeros = JSON.parse(await readFile(zeroSession, 'utf8'));
      assert.equal(zeros.files.length, 4);
      assert.equal(zeros.readings[0].family, 'payment-gateway-signed-kind-1');
      // Unsupported visible original leaves the prior successful state intact.
      await w
        .getByLabel(copy.roles[0], { exact: true })
        .setInputFiles('audit/payment-gateway/regressions/white-font.xlsx');
      await wait();
      await w.getByRole('alert').waitFor();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-zero-kinds', 'failed-upload-retained');
      // Real UI cancellation, with an actual worker reply deliberately delayed at transport.
      await page.evaluate(() => {
        window.__pgDelay = true;
        window.__pgDelayCaptured = false;
      });
      await button(copy.signedDemo).click();
      await page.waitForFunction(() => window.__pgDelayCaptured === true);
      await button(copy.cancel).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await page.waitForTimeout(1700);
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-zero-kinds', 'cancelled-retained');
      await button(copy.signedDemo).click();
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-mixed', 'retry');
      // A supported native source and native integer dates survive actual worker/session paths.
      await w
        .getByLabel(copy.restore, { exact: true })
        .setInputFiles(
          'work/payment-gateway-signed/exports/supported-native-inline-date14.json',
        );
      await wait();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-blank-row-permutation', 'native-date14-restored');
      // Corrupted session cannot replace the active source context.
      const corrupt = JSON.parse(await readFile(accepted, 'utf8'));
      corrupt.files[0].data = corrupt.files[0].data.slice(4);
      const corruptPath = path.join(dir, 'corrupt-session.json');
      await writeFile(corruptPath, JSON.stringify(corrupt));
      await w
        .getByLabel(copy.restore, { exact: true })
        .setInputFiles(corruptPath);
      await wait();
      await w.getByRole('alert').waitFor();
      assert.equal(await status.innerText(), copy.status['needs-review']);
      await pair('sar-blank-row-permutation', 'corrupt-session-retained');
      await w.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, 'workspace.png') });
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, 'review.png') });
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        direction: getComputedStyle(
          document.querySelector('[data-gateway-workspace]'),
        ).direction,
      }));
      assert.ok(geometry.document <= width + 1, JSON.stringify(geometry));
      assert.equal(geometry.direction, lang === 'ar' ? 'rtl' : 'ltr');
      cases.push({
        lang,
        width,
        nativeDate14: true,
        explicitFamilyMismatch: true,
        signConflict: true,
        zeroInventory: true,
        originalRejectedRetained: true,
        realUICancelAndLateReply: true,
        retry: true,
        corruptSessionRetained: true,
        geometry,
        passed: true,
      });
      await context.close();
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(posts, []);
  await writeFile(
    path.join(output, 'browser-receipt.json'),
    JSON.stringify(
      {
        synthetic: true,
        fieldOriginals: 0,
        stage: 'LOCAL_REAL_BROWSER',
        cases,
        artifacts,
        errors,
        external,
        posts,
        passed: true,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    path.join(output, 'evidence-index.json'),
    JSON.stringify(
      {
        synthetic: true,
        fieldOriginals: 0,
        stage: 'LOCAL_REAL_BROWSER',
        artifacts,
        passed: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: true,
      cases: cases.length,
      workbookSessionPairs: artifacts.length,
      errors: errors.length,
      external: external.length,
      posts: posts.length,
      output,
    }),
  );
} catch (error) {
  await activePage
    ?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify(
      { error: error.stack, cases, artifacts, errors, external, posts },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
