import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import {
  runningBalanceCopy,
  runningDiagnostic,
} from '../lib/i18n/running-balance-review.ts';

const root = path.resolve(
  process.env.RUNNING_BROWSER_REPORT_DIR || '../evidence/running-browser',
);
const frozen = path.resolve('audit/running-balance/frozen');
const dist = path.resolve('dist');
await mkdir(root, { recursive: true });
const hash = (b) => createHash('sha256').update(b).digest('hex');
const ids = [
  'P01-two-pages-two-sections',
  'P02-three-pages-sign-crossing',
  'P03-zero-and-identical-movements',
  'P04-posting-order-not-date-order',
  'P05-page-boundary-between-sections',
  'P06-inclusive-money-limit',
  'P07-zero-only-negative-opening',
  'P08-literal-decimal-forms',
  'N15-equal-net-two-movements-lost',
  'N16-missing-zero-movement',
  'unicode',
];
const fixtures = new Map();
for (const id of ids) {
  const fixtureRoot = id === 'unicode' ? path.dirname(frozen) : frozen;
  const bytes = await readFile(path.join(fixtureRoot, id, 'source.pdf'));
  const truth = JSON.parse(
    await readFile(path.join(fixtureRoot, id, 'facts.json')),
  );
  assert.equal(hash(bytes), truth.sourceSha256);
  fixtures.set(id, {
    bytes,
    truth,
    csv: truth.accepted
      ? await readFile(path.join(fixtureRoot, id, 'expected.csv'))
      : null,
  });
}
const report = {
  syntheticOnly: true,
  expectedFromProduct: false,
  cases: [],
  pageErrors: [],
  externalRequests: [],
  nonGetRequests: [],
  failedRequests: [],
  passed: false,
};
const save = () =>
  writeFile(
    path.join(root, 'BROWSER-PROOF.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
let server, browser, activePage;
async function choose(page, control, value, label) {
  if ((await control.evaluate((el) => el.tagName)) === 'SELECT')
    await control.selectOption(value);
  else {
    await control.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
}
async function idle(panel) {
  await panel.getByTestId('running-balance-inspect').waitFor();
  await panel
    .page()
    .waitForFunction(
      () => !document.querySelector('[data-testid="running-balance-cancel"]'),
    );
}
async function obtain(page, control, destination) {
  const pending = page.waitForEvent('download');
  await control.click();
  const download = await pending;
  await download.saveAs(destination);
  return readFile(destination);
}
async function measurements(page, panel, directory, phase, capture) {
  const result = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const sizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      panel: document
        .querySelector('[data-testid="running-balance-panel"]')
        .getBoundingClientRect().width,
    }));
    assert(
      sizes.document <= width + 1 &&
        sizes.body <= width + 1 &&
        sizes.panel <= width + 1,
      `${width} ${JSON.stringify(sizes)}`,
    );
    if (capture) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(directory, `${phase}-${width}.png`),
        fullPage: true,
      });
    }
    result.push({ width, ...sizes });
  }
  return result;
}
try {
  assert(
    process.env.MIZAN_CHROMIUM,
    'MIZAN_CHROMIUM must select the available browser',
  );
  server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    const filename = path.resolve(
      dist,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (!filename.startsWith(dist + path.sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(filename)] || 'application/octet-stream',
    );
    const stream = createReadStream(filename);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MIZAN_CHROMIUM,
  });
  report.browser = browser.version();
  for (const lang of ['ar', 'en'])
    for (const id of ids) {
      const fixture = fixtures.get(id);
      const locale = lang === 'ar' ? ar : en;
      const t = runningBalanceCopy[lang];
      const directory = path.join(root, lang, id);
      await mkdir(directory, { recursive: true });
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin) {
          report.externalRequests.push(request.url());
          return route.abort();
        }
        if (request.method() !== 'GET')
          report.nonGetRequests.push({
            method: request.method(),
            url: request.url(),
          });
        return route.continue();
      });
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', (error) =>
        report.pageErrors.push({ lang, id, error: error.message }),
      );
      page.on('requestfailed', (request) =>
        report.failedRequests.push({
          lang,
          id,
          url: request.url(),
          error: request.failure()?.errorText,
        }),
      );
      await page.goto(`${origin}/mizan-test/`);
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.source-card input[type="file"]')].some(
          (input) => !input.disabled,
        ),
      );
      if (lang === 'en')
        await page
          .locator('.language-switch button[lang="en"]:visible')
          .first()
          .click();
      for (let side = 0; side < 2; side++) {
        await page
          .getByLabel(locale.app.sides[side], { exact: true })
          .setInputFiles({
            name: `${id}-${side}.pdf`,
            mimeType: 'application/pdf',
            buffer: fixture.bytes,
          });
        await page
          .locator('.source-card__description')
          .getByText(`${id}-${side}.pdf`, { exact: true })
          .waitFor();
        await page.waitForFunction(
          () => !document.querySelector('.notice.loading'),
        );
      }
      await page
        .getByRole('button', { name: locale.app.upload.next, exact: true })
        .click();
      let currency = page.getByLabel(locale.app.scope.currencyLabel, {
        exact: true,
      });
      if (!(await currency.count()))
        await page
          .getByRole('button', { name: locale.app.scope.edit, exact: true })
          .click();
      currency = page.getByLabel(locale.app.scope.currencyLabel, {
        exact: true,
      });
      await currency.fill('SAR');
      await choose(
        page,
        page.getByLabel(locale.app.scope.decimals, { exact: true }),
        '2',
        locale.app.scope.decimalsTwo,
      );
      await page.getByTestId('running-balance-toggle').click();
      const panel = page.getByTestId('running-balance-panel');
      await panel.getByTestId('running-balance-source').selectOption('0');
      await panel.getByTestId('running-balance-cuts-ack').check();
      const cancelled = await page.evaluate(async () => {
        document
          .querySelector('[data-testid="running-balance-inspect"]')
          .click();
        await new Promise((resolve) => queueMicrotask(resolve));
        const cancel = document.querySelector(
          '[data-testid="running-balance-cancel"]',
        );
        if (!cancel) return false;
        cancel.click();
        return true;
      });
      if (cancelled) {
        assert.equal(
          await panel.getByTestId('running-balance-receipt').count(),
          0,
        );
        assert.equal(
          await panel.getByTestId('running-balance-artifact').count(),
          0,
        );
      }
      await panel.getByTestId('running-balance-inspect').click();
      await idle(panel);
      const actualRows = await panel
        .getByTestId('running-balance-inventory')
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) =>
            [...row.querySelectorAll('td')].map((td) => td.textContent),
          ),
        );
      const inventory = fixture.truth.pages.flatMap((rows, p) =>
        rows.map((values) => ({ page: p + 1, values })),
      );
      assert.deepEqual(
        actualRows,
        inventory
          .slice(0, 20)
          .map((r, i) => [String(i + 1), String(r.page), ...r.values]),
      );
      const observation = {
        lang,
        id,
        exactFirstInventoryPage: true,
        cancelledWithoutOutput: cancelled,
        measurements: await measurements(
          page,
          panel,
          directory,
          'review',
          id.startsWith('P01'),
        ),
        passed: false,
      };
      report.cases.push(observation);
      if (fixture.truth.accepted) {
        assert.equal(
          await panel.getByTestId('running-balance-status').innerText(),
          t.ready,
        );
        await panel.getByTestId('running-balance-select-all').click();
        await idle(panel);
        const first = panel.getByTestId('running-balance-movement').first();
        await first.locator('summary').focus();
        await first.locator('summary').press('Enter');
        assert((await first.locator('.running-review__proof').count()) >= 8);
        await first.locator('summary').press('Enter');
        await panel
          .getByTestId('running-balance-reviewer')
          .fill('Synthetic browser reviewer');
        await panel
          .getByTestId('running-balance-rationale')
          .fill(
            'Original seven fields, source order, zero movements and provided controls reviewed.',
          );
        for (const key of [
          'originalRowsReviewed',
          'referenceRolesReviewed',
          'separateAmountsReviewed',
          'perspectiveReviewed',
          'currencyReviewed',
          'balancesReviewed',
          'sequenceReviewed',
          'totalsReviewed',
          'derivedSourceUnderstood',
        ])
          await panel.getByTestId(`running-balance-ack-${key}`).check();
        await panel.getByTestId('running-balance-accept').click();
        await panel.getByTestId('running-balance-receipt').waitFor();
        // Reviewer edits invalidate a concrete live receipt; a fresh decision is required.
        await panel
          .getByTestId('running-balance-rationale')
          .fill(
            'All supplied monetary roles and count controls independently reviewed.',
          );
        assert.equal(
          await panel.getByTestId('running-balance-receipt').count(),
          0,
        );
        await panel.getByTestId('running-balance-accept').click();
        await panel.getByTestId('running-balance-receipt').waitFor();
        await panel.getByTestId('running-balance-apply').click();
        await panel.getByTestId('running-balance-artifact').waitFor();
        const csv = await obtain(
          page,
          panel.getByTestId('running-balance-download-csv'),
          path.join(directory, 'derived.csv'),
        );
        assert.deepEqual(csv, fixture.csv);
        const pdf = await obtain(
          page,
          panel.getByTestId('running-balance-download-pdf'),
          path.join(directory, 'original.pdf'),
        );
        assert.deepEqual(pdf, fixture.bytes);
        await obtain(
          page,
          panel.getByTestId('running-balance-save'),
          path.join(directory, 'archive.json'),
        );
        await obtain(
          page,
          panel.getByTestId('running-balance-excel'),
          path.join(directory, 'direct.xlsx'),
        );
        observation.measurements.push(
          ...(await measurements(
            page,
            panel,
            directory,
            'artifact',
            id.startsWith('P01'),
          )),
        );
        const restore = panel.getByTestId('running-balance-restore');
        await restore
          .locator('xpath=ancestor::details[1]')
          .locator('summary')
          .click();
        await restore.setInputFiles(path.join(directory, 'archive.json'));
        await page.getByText(t.historical, { exact: true }).first().waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-testid="running-balance-cancel"]'),
        );
        assert.equal(
          await panel.getByTestId('running-balance-receipt').count(),
          0,
        );
        assert.equal(
          await panel.getByTestId('running-balance-apply').count(),
          0,
        );
        await obtain(
          page,
          panel.getByTestId('running-balance-excel'),
          path.join(directory, 'restored.xlsx'),
        );
        observation.measurements.push(
          ...(await measurements(
            page,
            panel,
            directory,
            'historical',
            id.startsWith('P01'),
          )),
        );
        observation.exactCsvAndPdf = true;
        observation.reviewerEditInvalidatedReceipt = true;
        observation.historicalWithoutAuthority = true;
        observation.workbooks = 2;
      } else {
        assert.equal(
          await panel.getByTestId('running-balance-status').innerText(),
          t.blocked,
        );
        assert(
          (
            await panel.getByTestId('running-balance-diagnostics').innerText()
          ).includes(runningDiagnostic[lang][fixture.truth.requiredDiagnostic]),
        );
        assert.equal(
          await panel.getByTestId('running-balance-apply').count(),
          0,
        );
        assert.equal(
          await panel.getByTestId('running-balance-artifact').count(),
          0,
        );
        observation.blockedWithoutOutput = true;
      }
      await panel.getByTestId('running-balance-source').selectOption('1');
      assert.equal(
        await panel.getByTestId('running-balance-receipt').count(),
        0,
      );
      assert.equal(
        await panel.getByTestId('running-balance-artifact').count(),
        0,
      );
      assert.equal(await page.locator('.metric').count(), 0);
      observation.sourceChangeClearsAuthority = true;
      observation.noAutomaticComparison = true;
      observation.passed = true;
      await save();
      await context.close();
    }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(report.failedRequests, []);
  assert.equal(report.cases.length, 22);
  report.passed = true;
  await save();
  console.log(JSON.stringify({ passed: true, cases: 22, workbooks: 36 }));
} catch (error) {
  report.failure = String(error);
  await save();
  if (activePage && !activePage.isClosed()) {
    await activePage
      .screenshot({ path: path.join(root, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(root, 'failure.txt'),
      await activePage
        .locator('body')
        .innerText()
        .catch(() => 'unavailable'),
    );
  }
  throw error;
} finally {
  await browser?.close();
  if (server)
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
}
