// Actual local App proof against immutable, independently prepared synthetic PDF truth.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { splitSectionReviewCopy } from '../lib/i18n/split-section-review.ts';
const root = path.resolve(
  process.env.P4_BROWSER_REPORT_DIR ||
    process.env.P4_REPORT_DIR ||
    `../evidence/browser-${Date.now()}`,
);
await mkdir(root, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ids = [
  'P05-carry-and-component-totals',
  'P02-zero-and-separated-sections',
  'P06-explicit-reference-and-literal-description',
  'N01-double-positive',
  'U01-supplementary-literal',
];
const fixtures = new Map();
const frozen = {};
for (const id of ids) {
  if (id === 'U01-supplementary-literal') {
    const base = 'audit/native-unicode/frozen/letters';
    const bytes = await readFile(`${base}.pdf`);
    const expected = JSON.parse(await readFile(`${base}.json`, 'utf8'));
    assert.equal(hash(bytes), expected.sourceSha256);
    frozen[`${base}.pdf`] = hash(bytes);
    const truth = {
      accepted: true,
      cuts: expected.cuts,
      inventory: expected.rows.map((values, index) => ({
        row: index + 1,
        page: 1,
        values,
      })),
    };
    fixtures.set(id, { bytes, truth, csv: await readFile(`${base}.csv`) });
    continue;
  }
  const base = `audit/split-section/frozen/${id}`;
  const bytes = await readFile(`${base}/source.pdf`);
  const truth = JSON.parse(await readFile(`${base}/oracle.json`, 'utf8'));
  assert.equal(hash(bytes), truth.sourceSha256);
  frozen[`${base}/source.pdf`] = hash(bytes);
  fixtures.set(id, {
    bytes,
    truth,
    csv: truth.accepted ? await readFile(`${base}/expected.csv`) : null,
  });
}
await writeFile(
  path.join(root, 'freeze.json'),
  JSON.stringify(
    {
      beforeBrowser: true,
      syntheticOnly: true,
      expectedFromProduct: false,
      frozen,
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(root, 'driver.mjs'),
  await readFile('scripts/split-section-browser.mjs'),
);
const report = {
  syntheticOnly: true,
  financialApproval: false,
  scopeConfirmed: false,
  expectedFromProduct: false,
  cases: [],
  errors: [],
  passed: false,
};
const save = () =>
  writeFile(
    path.join(root, 'observations.json'),
    JSON.stringify(report, null, 2),
  );
const dist = path.resolve('dist');
let browser, server, activePage;
async function choose(page, control, value, label) {
  if ((await control.evaluate((el) => el.tagName)) === 'SELECT')
    await control.selectOption(value);
  else {
    await control.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
}
async function setup(page, locale, fixture, key) {
  for (let side = 0; side < 2; side++) {
    const name = `${key}-${side}.pdf`;
    await page
      .getByLabel(locale.app.sides[side], { exact: true })
      .setInputFiles({
        name,
        mimeType: 'application/pdf',
        buffer: fixture.bytes,
      });
    await page
      .locator('.source-card__description')
      .getByText(name, { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
  }
  await page
    .getByRole('button', { name: locale.app.upload.next, exact: true })
    .click();
  const currency = page.getByLabel(locale.app.scope.currencyLabel, {
    exact: true,
  });
  if (!(await currency.count()))
    await page
      .getByRole('button', { name: locale.app.scope.edit, exact: true })
      .click();
  await currency.fill('SAR');
  await choose(
    page,
    page.getByLabel(locale.app.scope.decimals, { exact: true }),
    '2',
    locale.app.scope.decimalsTwo,
  );
  for (let side = 0; side < 2; side++) {
    const edit = page.getByRole('button', {
      name: locale.app.source.edit(side),
      exact: true,
    });
    const card = edit.locator('xpath=ancestor::section[1]');
    await card
      .getByRole('button', { name: locale.pdfReview.editCuts, exact: true })
      .click();
    await card
      .getByLabel(locale.pdfReview.cutsLabel, { exact: true })
      .fill(fixture.truth.cuts.join(','));
    const apply = card.getByRole('button', {
      name: locale.pdfReview.applyCuts,
      exact: true,
    });
    if (await apply.isEnabled()) await apply.click();
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
    if ((await edit.getAttribute('aria-expanded')) !== 'true')
      await edit.click();
    await card
      .getByLabel(locale.app.source.headerRowLabel(side), { exact: true })
      .fill('3');
    await choose(
      page,
      card.getByLabel(locale.app.source.amountMode, { exact: true }),
      'split',
      locale.app.source.split,
    );
    for (const [field, column] of [
      ['dateColumn', 0],
      ['referenceColumn', 1],
      ['descriptionColumn', 2],
      ['debitColumn', 3],
      ['creditColumn', 4],
    ]) {
      const literal = ['Date', 'Reference', 'Description', 'Debit', 'Credit'][
        column
      ];
      await choose(
        page,
        card.getByLabel(locale.app.source[field], { exact: true }),
        String(column),
        `${column + 1} · ${literal}`,
      );
    }
    await choose(
      page,
      card.getByLabel(locale.app.source.currencyColumn, { exact: true }),
      '-1',
      locale.app.source.unset,
    );
    await card
      .getByRole('checkbox', { name: locale.pdfReview.reviewed, exact: true })
      .check();
    await edit.click();
  }
}
async function idle(panel) {
  await panel.getByTestId('split-section-inspect').waitFor();
  await panel.getByTestId('split-section-inspect').isEnabled();
  await panel
    .getByTestId('split-section-progress')
    .waitFor({ state: 'detached' });
}
async function responsive(page, key, phase) {
  const result = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const sizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      sizes.document <= width + 1 && sizes.body <= width + 1,
      `${key}/${phase}/${width} overflow ${JSON.stringify(sizes)}`,
    );
    const screenshot = `${key}-${phase}-${width}.png`;
    await page.screenshot({
      path: path.join(root, screenshot),
      fullPage: true,
    });
    result.push({ width, ...sizes, screenshot });
  }
  return result;
}
async function obtain(page, button, name) {
  const awaited = page.waitForEvent('download');
  await button.click();
  const dl = await awaited;
  const destination = path.join(root, name);
  await dl.saveAs(destination);
  return { destination, bytes: await readFile(destination) };
}
try {
  assert.ok(
    process.env.MIZAN_CHROMIUM,
    'Set MIZAN_CHROMIUM to the installed native Chrome executable',
  );
  server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    const file = path.resolve(
      dist,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (!file.startsWith(dist + path.sep)) {
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
      }[path.extname(file)] || 'application/octet-stream',
    );
    const stream = createReadStream(file);
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
      const t = splitSectionReviewCopy(lang);
      const key = `${lang}-${id}`;
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      activePage = page;
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(`${origin}/mizan-test/`);
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
      if (lang === 'en')
        await page
          .locator('.language-switch button[lang="en"]:visible')
          .first()
          .click();
      await setup(page, locale, fixture, key);
      await page.getByTestId('split-section-toggle').click();
      await page.getByTestId('split-section-source').selectOption('0');
      const panel = page.getByTestId('split-section-review');
      await panel.waitFor();
      // Cancellation is requested while native proof is pending, before any receipt/artifact can publish.
      const cancelled = await page.evaluate(async () => {
        document.querySelector('[data-testid="split-section-inspect"]').click();
        await new Promise((resolve) => queueMicrotask(resolve));
        const control = document.querySelector(
          '[data-testid="split-section-abort"]',
        );
        if (!control) return false;
        control.click();
        return true;
      });
      if (cancelled) {
        assert.equal(
          await panel.getByTestId('split-section-artifact').count(),
          0,
        );
        assert.equal(
          await panel.getByTestId('split-section-receipt').count(),
          0,
        );
      }
      await panel.getByTestId('split-section-inspect').click();
      await idle(panel);
      const actualRows = await panel
        .getByTestId('split-section-inventory')
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => {
            const cells = [...row.querySelectorAll('td')].map(
              (cell) => cell.textContent,
            );
            return {
              row: Number(cells[0]),
              page: Number(cells[1]),
              values: cells
                .slice(3)
                .map((value) => (value === '∅' ? '' : value)),
            };
          }),
        );
      assert.deepEqual(
        actualRows,
        fixture.truth.inventory.map((row) => ({
          row: row.row,
          page: row.page,
          values: row.values,
        })),
      );
      const observation = {
        lang,
        id,
        originalSha256: hash(fixture.bytes),
        inventory: actualRows,
        measurements: await responsive(page, key, 'review'),
        cancelledWithoutOutput: cancelled,
      };
      if (fixture.truth.accepted) {
        assert.equal(
          await panel.getByTestId('split-section-status').innerText(),
          t.ready,
        );
        await panel.getByTestId('split-section-select-all').click();
        await idle(panel);
        const movements = panel.getByTestId('split-section-movement');
        for (let i = 0; i < (await movements.count()); i++) {
          await movements.nth(i).locator('summary').focus();
          await movements.nth(i).locator('summary').press('Enter');
          assert.equal(
            await movements.nth(i).getByTestId('split-section-cell').count(),
            5,
          );
        }
        observation.referenceOrigins = await panel
          .getByTestId('split-section-reference-origin')
          .allTextContents();
        observation.proofCells = await panel
          .getByTestId('split-section-cell')
          .allTextContents();
        const proposalDetails = panel.locator('details').filter({
          has: panel.locator('input[data-testid^="split-section-proposal-"]'),
        });
        for (let i = 0; i < (await proposalDetails.count()); i++) {
          await proposalDetails.nth(i).locator('summary').focus();
          await proposalDetails.nth(i).locator('summary').press('Enter');
        }
        observation.totals = await panel
          .getByTestId('split-section-total')
          .allTextContents();
        await panel
          .getByTestId('split-section-reviewer')
          .fill('SYNTHETIC REVIEWER');
        await panel
          .getByTestId('split-section-rationale')
          .fill(
            'Reviewed original rows, parent and continuation roles, both component amounts and all totals.',
          );
        for (const key of [
          'originalRowsReviewed',
          'referenceRolesReviewed',
          'separateAmountsReviewed',
          'perspectiveReviewed',
          'currencyReviewed',
          'totalsReviewed',
          'derivedSourceUnderstood',
        ])
          await panel.getByTestId(`split-section-ack-${key}`).check();
        await panel.getByTestId('split-section-accept').click();
        await idle(panel);
        await panel.getByTestId('split-section-receipt').waitFor();
        await panel.getByTestId('split-section-apply').click();
        await idle(panel);
        await panel.getByTestId('split-section-artifact').waitFor();
        const csv = await obtain(
          page,
          panel.getByTestId('split-section-download-csv'),
          `${key}.csv`,
        );
        await idle(panel);
        assert.deepEqual(csv.bytes, fixture.csv);
        const archive = await obtain(
          page,
          panel.getByTestId('split-section-download-archive'),
          `${key}.json`,
        );
        await idle(panel);
        const workbook = await obtain(
          page,
          panel.getByTestId('split-section-download-workbook'),
          `${key}.xlsx`,
        );
        await idle(panel);
        const original = await obtain(
          page,
          panel.getByTestId('split-section-download-original'),
          `${key}.pdf`,
        );
        await idle(panel);
        assert.deepEqual(original.bytes, fixture.bytes);
        observation.exports = {
          csv: hash(csv.bytes),
          archive: hash(archive.bytes),
          workbook: hash(workbook.bytes),
          original: hash(original.bytes),
        };
        await panel.getByTestId('split-section-clear').click();
        await page
          .getByTestId('split-section-restore')
          .setInputFiles(archive.destination);
        const history = page.getByTestId('split-section-history');
        await history.getByTestId('split-section-historical-only').waitFor();
        assert.equal(
          await history.getByTestId('split-section-apply').count(),
          0,
        );
        assert.equal(
          await history.getByTestId('split-section-receipt').count(),
          0,
        );
        const restoredWorkbook = await obtain(
          page,
          history.getByTestId('split-section-download-workbook'),
          `${key}-restored.xlsx`,
        );
        observation.restoredWorkbookSha256 = hash(restoredWorkbook.bytes);
        observation.historicalWithoutAuthority = true;
        observation.measurements.push(
          ...(await responsive(page, key, 'historical')),
        );
      } else {
        assert.equal(
          await panel.getByTestId('split-section-status').innerText(),
          t.blocked,
        );
        assert.ok(
          (
            await panel
              .getByTestId('split-section-diagnostic')
              .allTextContents()
          ).some((text) => text.includes(fixture.truth.expectedCode)),
        );
        assert.equal(
          await panel.getByTestId('split-section-artifact').count(),
          0,
        );
        assert.equal(await panel.getByTestId('split-section-apply').count(), 0);
        observation.blockedWithoutOutput = true;
      }
      await page.getByTestId('split-section-source').selectOption('1');
      assert.equal(
        await page
          .getByTestId('split-section-review')
          .getByTestId('split-section-receipt')
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByTestId('split-section-review')
          .getByTestId('split-section-artifact')
          .count(),
        0,
      );
      observation.sourceSelectionClearsAuthority = true;
      assert.equal(await page.locator('.metric').count(), 0);
      assert.deepEqual(pageErrors, []);
      report.cases.push(observation);
      await save();
      await context.close();
    }
  report.passed = true;
  await save();
  console.log(
    JSON.stringify({ passed: true, root, cases: report.cases.length }),
  );
} catch (e) {
  report.errors.push(String(e));
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
  await save();
  throw e;
} finally {
  await browser?.close();
  if (server)
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
}
