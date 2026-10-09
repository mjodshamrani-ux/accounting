// Local UX proof only: existing Chrome, no OCR/model execution or external reads.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const proof =
  process.env.MIZAN_PROOF_DIR ??
  path.join(root, 'work/qa-reconciliation-entry');
await mkdir(proof, { recursive: true });
const out = await mkdtemp(path.join(proof, 'attempt-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  machine: 'Connected execution environment',
  execution: {
    platform: process.platform,
    arch: process.arch,
    headless: true,
    executablePolicy:
      process.env.MIZAN_CHROMIUM ?? 'Playwright default installed Chromium',
  },
  synthetic: true,
  fieldAcceptance: false,
  at: new Date().toISOString(),
  scriptSha256: sha(await readFile(import.meta.filename)),
  indexSha256: sha(await readFile(path.join(dist, 'index.html'))),
  cases: [],
  blocked: [],
  errors: [],
};
const ids = [
  'supplier',
  'clearing',
  'ar',
  'gl-tb',
  'allocation',
  'bank',
  'tb-financial',
  'intercompany',
  'gateway',
  'stock',
  'assets',
  'payroll',
];
const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
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
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let failure;
try {
  browser = await chromium.launch({
    executablePath: process.env.MIZAN_CHROMIUM,
    headless: true,
  });
  report.browser = browser.version();
  for (const width of [1440, 320])
    for (const language of ['ar', 'en']) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (
          (url.origin === base || ['blob:', 'data:'].includes(url.protocol)) &&
          !/qwen|onnx|gguf|traineddata|tokenizer/i.test(url.pathname)
        )
          return route.continue();
        report.blocked.push(url.href);
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => report.errors.push(e.message));
      await page.goto(base);
      if (
        (await page.evaluate(() => document.documentElement.lang)) !== language
      )
        await page
          .locator(`.language-switch button[lang="${language}"]:visible`)
          .first()
          .click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-domain-entry]')].every(
          (x) => !x.disabled,
        ),
      );
      await page.evaluate(() => document.fonts.ready);
      const result = { width, language };
      report.cases.push(result);
      assert.deepEqual(
        await page
          .locator('[data-domain-entry]')
          .evaluateAll((xs) =>
            xs
              .map((x) => x.dataset.domainEntry)
              .sort((a, b) => a.localeCompare(b)),
          ),
        [...ids].sort((a, b) => a.localeCompare(b)),
      );
      result.cards = await page
        .locator('.reconciliation-choice')
        .evaluateAll((xs) => xs.map((x) => x.innerText));
      assert.equal(result.cards.length, 12);
      for (const card of await page.locator('.reconciliation-choice').all()) {
        assert.equal(
          await card.locator('[data-domain-entry]').getAttribute('aria-label'),
          (await card.locator('.directory-choice-title').innerText()).trim(),
          'the accessible workflow name matches its visible title',
        );
        assert.ok(
          (
            await card.locator('.directory-choice-description').innerText()
          ).trim(),
          'every workflow explains its purpose',
        );
        const scope = card.locator('details');
        await scope.locator('summary').click();
        assert.ok(
          await scope.locator('p').isVisible(),
          'workflow scope stays available before entry',
        );
        assert.ok((await scope.locator('p').innerText()).trim());
        await scope.locator('summary').click();
      }
      const overflow = () =>
        page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          overflowing: [...document.querySelectorAll('body *')]
            .filter(
              (x) =>
                x.getClientRects().length &&
                (x.getBoundingClientRect().right > innerWidth + 1 ||
                  x.getBoundingClientRect().left < -1),
            )
            .map((x) => ({
              tag: x.tagName,
              cls: x.className,
              text: x.textContent.slice(0, 100),
            }))
            .slice(0, 12),
        }));
      result.landingBounds = await overflow();
      await page.screenshot({
        path: path.join(out, `${language}-${width}-landing.png`),
        fullPage: true,
      });
      await page.screenshot({
        path: path.join(out, `${language}-${width}-viewport.png`),
      });
      assert.ok(
        result.landingBounds.scroll <= width + 1,
        'whole landing has no horizontal overflow',
      );
      result.links = [];
      for (const selector of ['.primary-link', '.nav-start']) {
        const link = page.locator(selector);
        assert.equal(await link.getAttribute('href'), '#reconciliation-types');
        await link.focus();
        await page.keyboard.press('Enter');
        assert.equal(
          await page.evaluate(() => location.hash),
          '#reconciliation-types',
        );
        await page.waitForFunction(
          () => document.activeElement?.id === 'reconciliation-types',
        );
        await page.waitForFunction(() => {
          const y = document
            .getElementById('reconciliation-types')
            .getBoundingClientRect().top;
          return y >= 0 && y < 180;
        });
        result.links.push({
          selector,
          target: 'reconciliation-types',
          focus: true,
        });
      }
      await page.screenshot({
        path: path.join(out, `${language}-${width}-directory.png`),
      });
      const supplier = page.locator('[data-domain-entry="supplier"]');
      await supplier.focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page
          .locator('.workflow-title:visible')
          .evaluate((x) => document.activeElement === x),
        true,
      );
      assert.equal(
        await page.locator('[data-domain-panel]:visible').count(),
        0,
      );
      await page
        .getByRole('button', {
          name: language === 'ar' ? 'جرّب المثال' : 'Try the sample',
          exact: true,
        })
        .click();
      await page.locator('.in-session .workflow-title:visible').waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-domain-entry="supplier"]')?.disabled,
      );
      const state = () =>
        page.evaluate(() => ({
          heading: document.querySelector('.in-session .workflow-title')
            ?.innerText,
          metrics: [...document.querySelectorAll('.metric')]
            .filter((x) => x.getClientRects().length)
            .map((x) => x.innerText),
          source: [
            ...document.querySelectorAll('.source-card__description'),
          ].map((x) => x.innerText),
          values: [...document.querySelectorAll('input')].map((x) => ({
            type: x.type,
            value: x.value,
            checked: x.checked,
          })),
        }));
      result.beforeSupplier = await state();
      assert.equal(
        await page.locator('[data-domain-navigation]').isVisible(),
        false,
        'directory is compact during supplier work',
      );
      await page.locator('.directory-switch').click();
      assert.equal(
        await page.locator('[data-domain-navigation]').isVisible(),
        true,
        'workflow switch opens on demand',
      );
      await supplier.focus();
      await page.keyboard.press('Enter');
      result.afterSupplier = await state();
      assert.deepEqual(
        result.afterSupplier,
        result.beforeSupplier,
        'supplier card retains active session state',
      );
      assert.equal(
        await page
          .locator('.in-session .workflow-title:visible')
          .evaluate((x) => document.activeElement === x),
        true,
      );
      result.sessionBounds = await overflow();
      assert.ok(
        result.sessionBounds.scroll <= width + 1,
        'supplier session has no horizontal overflow',
      );
      assert.equal(
        await page.locator('#how-it-works').count(),
        0,
        'supplier example belongs to landing',
      );
      result.status = 'PASS';
      await context.close();
    }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.blocked, []);
  report.status = 'PASS';
} catch (error) {
  failure = error;
  report.status = 'FAIL';
  report.failure = { message: error.message, stack: error.stack };
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    path.join(out, 'REPORT.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    out,
    status: report.status,
    cases: report.cases.map((x) => ({
      width: x.width,
      language: x.language,
      status: x.status,
      bounds: x.landingBounds,
    })),
  }),
);
if (failure) throw failure;
