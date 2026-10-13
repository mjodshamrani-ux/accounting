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
      const type = page.locator(
        'select[data-reconciliation-type-select]:visible',
      );
      await type.waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector('select[data-reconciliation-type-select]')
            ?.disabled,
      );
      await page.evaluate(() => document.fonts.ready);
      const result = { width, language };
      report.cases.push(result);
      const sharedSections = await page.evaluateHandle(() =>
        [
          '.landing-intro',
          '.document-scene',
          '.tarasuf-benefits-wrap',
          '#how-it-works',
          '#privacy',
          '#privacy-details',
          '.site-footer',
        ].map((selector) => document.querySelector(selector)),
      );
      async function sharedPage(stage) {
        const evidence = await page.evaluate((initial) => {
          const selectors = [
            '.landing-intro',
            '.document-scene',
            '.tarasuf-benefits-wrap',
            '#how-it-works',
            '#privacy',
            '#privacy-details',
            '.site-footer',
          ];
          return {
            sections: selectors.map((selector, index) => {
              const nodes = document.querySelectorAll(selector);
              return {
                selector,
                count: nodes.length,
                retained: nodes[0] === initial[index],
                rendered: !!nodes[0]?.getClientRects().length,
              };
            }),
            visibleTitles: [...document.querySelectorAll('h1')].filter(
              (heading) =>
                heading.getClientRects().length && !heading.closest('[hidden]'),
            ).length,
            brandTarget: document
              .querySelector('.topbar .brand')
              ?.getAttribute('href'),
            privacyTarget: document
              .querySelector('.site-footer .footer-privacy-link')
              ?.getAttribute('href'),
            papers: [
              ...document.querySelectorAll('.document-scene__paper-title'),
            ].map((paper) => paper.textContent.trim()),
            caption: document.querySelector('.document-scene__caption')
              ?.textContent,
          };
        }, sharedSections);
        assert.equal(
          evidence.sections.every(
            ({ count, retained, rendered }) =>
              count === 1 && retained && rendered,
          ),
          true,
          `${stage}: one continuous page keeps every shared section mounted`,
        );
        assert.equal(evidence.visibleTitles, 1, `${stage}: one visible h1`);
        assert.equal(evidence.brandTarget, '#top');
        assert.equal(evidence.privacyTarget, '#privacy-details');
        assert.equal(evidence.papers.length, 2);
        assert.ok(evidence.papers.every((title) => title.length > 0));
        assert.equal(
          /supplier|AP ledger|المورد/i.test(
            evidence.papers.join(' ') + evidence.caption,
          ),
          false,
          `${stage}: the shared illustration describes reconciliation generally`,
        );
        return evidence;
      }
      result.sharedPage = [await sharedPage('initial supplier entry')];
      assert.equal(
        await type.count(),
        1,
        'one native reconciliation type control is visible',
      );
      result.options = await type.locator('option').evaluateAll((options) =>
        options.map((option) => ({
          id: option.value,
          title: option.textContent.trim(),
        })),
      );
      assert.deepEqual(
        result.options
          .map((option) => option.id)
          .sort((a, b) => a.localeCompare(b)),
        [...ids].sort((a, b) => a.localeCompare(b)),
      );
      assert.equal(result.options.length, 12);
      assert.ok(
        result.options.every((option) => option.title),
        'every workflow retains its visible name',
      );
      assert.ok(
        (await type.getAttribute('aria-label')) ||
          (await type.evaluate((element) => element.labels.length > 0)),
        'type control has an accessible name',
      );
      assert.equal(
        await page.locator('.reconciliation-choice:visible').count(),
        0,
        'type choice uses a compact native control',
      );
      assert.equal(
        await page.locator('.source-card:visible').count(),
        2,
        'supplier source entry retains exactly two upload cards',
      );
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
      await type.focus();
      await type.selectOption('bank');
      const bankHeading = page.locator(
        '[data-domain-panel="bank"]:visible .workspace-intro h1',
      );
      await bankHeading.waitFor();
      assert.equal(
        await bankHeading.evaluate(
          (element) => document.activeElement === element,
        ),
        true,
        'type selection focuses the requested workflow',
      );
      result.sharedPage.push(await sharedPage('bank entry'));
      await page.locator('.topbar .brand').click();
      await page.waitForFunction(() => window.scrollY < 2);
      assert.equal(await type.inputValue(), 'bank');
      await page.locator('.site-footer .footer-privacy-link').click();
      await page.waitForFunction(() => location.hash === '#privacy-details');
      await page.waitForFunction(() => {
        const bounds = document
          .getElementById('privacy-details')
          .getBoundingClientRect();
        return bounds.bottom > 0 && bounds.top < window.innerHeight;
      });
      assert.equal(
        await type.inputValue(),
        'bank',
        'scrolling through the shared page keeps the selected reconciliation',
      );
      await type.selectOption('supplier');
      const supplierHeading = page.locator('.workflow-title:visible').first();
      await supplierHeading.waitFor();
      assert.equal(
        await supplierHeading.evaluate(
          (element) => document.activeElement === element,
        ),
        true,
        'return focuses supplier source entry',
      );
      assert.equal(
        await page
          .locator(
            '[data-domain-panel]:visible:not([data-domain-panel="supplier"])',
          )
          .count(),
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
          !document.querySelector('select[data-reconciliation-type-select]')
            ?.disabled,
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
        true,
        'type selector remains available during supplier work',
      );
      await type.focus();
      await type.selectOption('supplier');
      result.afterSupplier = await state();
      assert.deepEqual(
        result.afterSupplier,
        result.beforeSupplier,
        'choosing the current type retains active supplier session state',
      );
      assert.equal(
        await page
          .locator('select[data-reconciliation-type-select]:visible')
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
        1,
        'the shared process remains available during supplier work',
      );
      result.sharedPage.push(await sharedPage('active supplier session'));
      await sharedSections.dispose();
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
