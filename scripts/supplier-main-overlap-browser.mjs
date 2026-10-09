import {
  holdOriginalWorkerReplies,
  verifyActualAllocationPending,
} from './supplier-main-pending-browser.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Actual App regression, synthetic frozen originals only. Build first; each run
// creates a fresh proof directory and never replaces a historical attempt.
// Options: --proof-dir PATH, --dist PATH, --skip-pending-allocation,
// --legacy-allocation (optional repeat of the existing full-browser helper).
const repo = path.resolve(import.meta.dirname, '..');
const options = {
  proofRoot:
    process.env.MIZAN_PROOF_DIR ?? path.join(repo, 'work/qa-main-integration'),
  dist: process.env.MIZAN_DIST_DIR ?? path.join(repo, 'dist'),
  pending: true,
  legacy: false,
};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--proof-dir' || arg === '--dist') {
    const value = process.argv[++i];
    if (!value || value.startsWith('--'))
      throw Error('Missing path for ' + arg);
    options[arg === '--proof-dir' ? 'proofRoot' : 'dist'] = path.resolve(value);
  } else if (arg === '--skip-pending-allocation') options.pending = false;
  else if (arg === '--legacy-allocation') options.legacy = true;
  else throw Error('Unknown native regression argument: ' + arg);
}
const fixtureDir = path.join(
  repo,
  'audit/p2-main-integration-v1/frozen/native-ui-files',
);
const allocationFixtures = path.join(
  repo,
  'audit/allocation-handoff-v1/frozen/native-ui-files',
);
await mkdir(options.proofRoot, { recursive: true });
const out = await mkdtemp(
  path.join(path.resolve(options.proofRoot), 'attempt-'),
);
console.log('Native proof directory: ' + out);
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { en } = await import(
  pathToFileURL(path.join(repo, 'lib/i18n/locales/en.ts'))
);
const { ar } = await import(
  pathToFileURL(path.join(repo, 'lib/i18n/locales/ar.ts'))
);
const { invoiceOverlapIntegratedCopy } = await import(
  pathToFileURL(path.join(repo, 'lib/i18n/invoice-overlap-review.ts'))
);
const { verifyAllocation } = await import(
  pathToFileURL(path.join(repo, 'scripts/allocation-browser-cases.mjs'))
);
const truth = JSON.parse(
  await readFile(
    path.join(
      repo,
      'audit/p2-main-integration-v1/frozen/native-ui-instantiation.json',
    ),
    'utf8',
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(fixtureDir, 'fixture-manifest.json'), 'utf8'),
);
const sha = (x) => createHash('sha256').update(x).digest('hex');
assert.equal(
  sha(
    await readFile(
      path.join(
        repo,
        'audit/p2-main-integration-v1/frozen/native-ui-instantiation.json',
      ),
    ),
  ),
  manifest.truthSha256,
);
await mkdir(out, { recursive: true });
const dist = path.resolve(options.dist);
const servedIndexSha256 = sha(await readFile(path.join(dist, 'index.html')));
await writeFile(
  path.join(out, 'build-binding.json'),
  JSON.stringify(
    { dist, servedIndexSha256, fixtureTruthSha256: manifest.truthSha256 },
    null,
    2,
  ),
);
const server = createServer(async (req, res) => {
  try {
    let rel = new URL(req.url, 'http://local').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    if (rel === '/') rel = '/index.html';
    const f = path.resolve(dist, '.' + rel);
    if (!f.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      }[path.extname(f)] ?? 'application/octet-stream',
    );
    res.end(await readFile(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/mizan-test/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
let active;
const report = {
  servedIndexSha256,
  truthSha256: manifest.truthSha256,
  cases: [],
  widths: [],
  allocationLegacy: false,
};
const button = (p, name) => p.getByRole('button', { name, exact: true });
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
}
async function responsive(page, label) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    const measurement = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      measurement.document <= width + 1 && measurement.body <= width + 1,
      JSON.stringify({ label, width, ...measurement }),
    );
    report.widths.push({ label, width, ...measurement });
  }
  await page.screenshot({
    path: path.join(out, label + '-390.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function download(page, locator, name) {
  const pending = page.waitForEvent('download');
  await locator.click();
  const d = await pending;
  const file = path.join(out, name);
  await d.saveAs(file);
  return file;
}
async function metrics(page, t, expected) {
  for (const [label, value] of [
    [t.app.results.autoMatches, expected.autoMatchedCases],
    [t.app.results.manualMatches, expected.manualMatches],
    [t.app.results.unmatchedCases, expected.unmatchedCases],
  ]) {
    if (value === undefined) continue;
    const item = page
      .locator('.metric')
      .filter({ has: page.locator('span').getByText(label, { exact: true }) });
    await item
      .locator('strong')
      .getByText(String(value), { exact: true })
      .waitFor();
  }
}
async function openInspect(page, t, beforeInspect) {
  await button(page, t.open).click();
  const panel = page.getByTestId('invoice-overlap-review');
  const currency = panel.locator('[data-overlap-scope=currency]');
  assert.equal(await currency.evaluate((el) => el.readOnly), true);
  assert.equal(await currency.inputValue(), 'SAR');
  if (beforeInspect) await beforeInspect(panel);
  await panel.locator('[data-overlap-scope-ack]').check();
  await button(panel, t.inspect).click();
  await panel.locator('[data-overlap-component]').waitFor();
  return panel;
}
async function currencyDriftProbe(
  page,
  panel,
  t,
  ot,
  baselineSnapshot,
  record,
) {
  const currency = panel.locator('[data-overlap-scope=currency]');
  await currency.evaluate((el) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    descriptor.set.call(el, 'JPY');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The acknowledgement causes a real React render. Its resulting value tells
  // whether the dispatched input actually reached owned React state.
  await panel.locator('[data-overlap-scope-ack]').check();
  record.nativeDispatchReachedOwnedState =
    (await currency.inputValue()) === 'JPY';
  if (record.nativeDispatchReachedOwnedState) {
    await button(panel, ot.inspect).click();
    await panel
      .getByRole('alert')
      .filter({ hasText: ot.scopeCurrency })
      .waitFor();
    assert.equal(await panel.locator('[data-overlap-component]').count(), 0);
    assert.equal(
      await panel.locator('[data-overlap-active-receipt]').count(),
      0,
    );
    assert.deepEqual(await mainSnapshot(page, t), baselineSnapshot);
    record.localCurrencyDriftRefused = true;
  } else {
    record.localCurrencyDriftRefused = null;
    record.boundary =
      'Readonly and SAR value asserted; native dispatch did not change owned React currency, so executable drift gate was not reached.';
  }
  await button(page, ot.close).click();
  await button(page, ot.open).click();
  assert.equal(await currency.inputValue(), 'SAR');
}
async function decisions(panel, t, c, beforeCommit) {
  await panel
    .locator('[data-overlap-reviewer]')
    .fill('Native synthetic source reviewer');
  await panel
    .locator('[data-overlap-rationale]')
    .fill(
      'Reviewed every original row, dated invoice member and competing whole group against frozen A/C membership truth.',
    );
  const candidates = panel.locator('[data-overlap-candidate]');
  assert.equal(await candidates.count(), c.candidateCount);
  const choices = [];
  for (const candidate of await candidates.all()) {
    const paragraphs = await candidate.locator(':scope > p').allTextContents();
    const members = paragraphs.slice(
      2,
      2 +
        Number(await candidate.getAttribute('data-overlap-supplier-members')) +
        Number(await candidate.getAttribute('data-overlap-ledger-members')),
    );
    const keys = members
      .map((line) => {
        const supplier = line.includes(t.supplier + ' ·');
        const row = Number(line.match(new RegExp(t.row + '\\s+(\\d+)'))?.[1]);
        assert.ok(row >= 2, line);
        return (supplier ? 's' : 'l') + (row - 1);
      })
      .sort((a, b) => a.localeCompare(b));
    const accepted = c.accept.some(
      (group) =>
        JSON.stringify([...group].sort((a, b) => a.localeCompare(b))) ===
        JSON.stringify(keys),
    );
    choices.push({ keys, accepted });
    await candidate
      .locator('[data-overlap-decision]')
      .selectOption(accepted ? 'accepted' : 'rejected');
    await candidate
      .locator('[data-overlap-decision-rationale]')
      .fill(
        accepted
          ? 'All listed original dated members jointly form this invoice; whole-group equivalence with no pairwise monetary allocation.'
          : 'This competing whole group conflicts with explicitly reviewed accepted original memberships and remains rejected.',
      );
  }
  assert.equal(choices.filter((x) => x.accepted).length, c.accept.length);
  const component = panel.locator('[data-overlap-component]');
  await component.locator('[data-overlap-rows-ack]').check();
  await component.locator('[data-overlap-decisions-ack]').check();
  if (beforeCommit) await beforeCommit();
  await button(component, t.commit).click();
  await panel
    .page()
    .locator('.metric')
    .nth(1)
    .locator('strong')
    .getByText(String(c.accept.length), { exact: true })
    .waitFor();
  await panel.locator('[data-overlap-scope-ack]').check();
  await button(panel, t.inspect).click();
  await panel.locator('[data-overlap-active-receipt]').waitFor();
  return choices;
}
async function workbook(page, panel, t, c, label) {
  const file = await download(
    page,
    button(panel, t.exportWorkbook),
    label + '.xlsx',
  );
  const b = new ExcelJS.Workbook();
  await b.xlsx.readFile(file);
  const orig = b.getWorksheet('Original movements');
  assert.ok(orig);
  const rows = [];
  orig.eachRow((r, n) => {
    if (n > 1)
      rows.push({
        side: r.getCell(1).text,
        id: r.getCell(2).text,
        row: Number(r.getCell(4).value),
        minor: Number(r.getCell(6).value),
        disposition: r.getCell(8).text,
      });
  });
  assert.equal(rows.length, c.supplier.length + c.ledger.length);
  assert.equal(
    rows.filter((r) => r.disposition === 'accepted-aggregate-member').length,
    c.afterCommit.matchedSourceRows,
  );
  for (const side of ['supplier', 'ledger'])
    for (const row of c[side]) {
      const found = rows.find((x) => x.side === side && x.row === row.row);
      assert.equal(found?.minor, row.amountMinor);
    }
  const expectedKeys = new Set(c.accept.flat());
  for (const row of rows) {
    const key = (row.side === 'supplier' ? 's' : 'l') + (row.row - 1);
    assert.equal(
      row.disposition === 'accepted-aggregate-member',
      expectedKeys.has(key),
    );
  }
  const actualGroups = [];
  const aggregates = b.getWorksheet('Accepted aggregates');
  assert.equal(aggregates.rowCount - 1, c.accept.length);
  aggregates.eachRow((r, n) => {
    if (n > 1) {
      const supplierIds = JSON.parse(r.getCell(4).text),
        ledgerIds = JSON.parse(r.getCell(5).text);
      const keys = [
        ...supplierIds.map((id) => {
          const row = rows.find((x) => x.side === 'supplier' && x.id === id);
          assert.ok(row);
          return 's' + (row.row - 1);
        }),
        ...ledgerIds.map((id) => {
          const row = rows.find((x) => x.side === 'ledger' && x.id === id);
          assert.ok(row);
          return 'l' + (row.row - 1);
        }),
      ].sort((a, b) => a.localeCompare(b));
      actualGroups.push(keys);
      assert.equal(r.getCell(6).value, 100);
      assert.equal(r.getCell(7).text, 'group-equivalence');
      assert.equal(r.getCell(8).value, false);
    }
  });
  assert.deepEqual(
    actualGroups
      .map((x) => JSON.stringify(x))
      .sort((a, b) => a.localeCompare(b)),
    c.accept
      .map((x) => JSON.stringify([...x].sort((a, b) => a.localeCompare(b))))
      .sort((a, b) => a.localeCompare(b)),
  );
  const proof = b.getWorksheet('Main aggregate proof');
  assert.ok(proof?.rowCount > 1);
  return { file, rows, actualGroups, sheets: b.worksheets.map((s) => s.name) };
}
async function holdBaselineScalar(page, t, panel, ot) {
  await page.getByRole('tab').nth(2).click();
  await button(page, t.app.results.caseDetails).first().click();
  const review = page.getByRole('region', {
    name: t.transactionReview.region,
    exact: true,
  });
  await review
    .getByRole('combobox', {
      name: t.transactionReview.counterpartLabel,
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'INV-X-1 · 1.00' + t.transactionReview.candidateRow(4),
      exact: true,
    })
    .click();
  await review
    .getByLabel(t.transactionReview.noteLabel, { exact: true })
    .fill(
      'Synthetic pending scalar alternative only: worker reply must lose authority when cancelled before whole-group review.',
    );
  await page.evaluate(() => {
    globalThis.holdOriginalWorkerAction = 'reconcile';
  });
  await button(review, t.transactionReview.link).click();
  await page.waitForFunction(
    () => globalThis.heldOriginalWorkerReplies.length === 1,
  );
  assert.equal(
    await button(panel, ot.commit).isEnabled(),
    false,
    'Root pending financial operation must interlock P2 receipt commit',
  );
  await button(page, t.common.cancel).click();
  assert.equal(await button(panel, ot.commit).isEnabled(), true);
}
async function mainSnapshot(page, t) {
  const section = page.locator('section.surface').filter({
    has: page.getByRole('heading', {
      name: t.app.results.workspace,
      exact: true,
    }),
  });
  const metrics = (await page.locator('.metric').allTextContents()).slice(0, 3);
  const tabs = section.getByRole('tab');
  const labels = await tabs.allTextContents();
  const lists = [];
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    lists.push(
      await section
        .locator('tbody tr')
        .evaluateAll((rs) =>
          rs.map((r) =>
            Array.from(r.querySelectorAll('td')).map((c) =>
              c.textContent?.trim(),
            ),
          ),
        ),
    );
  }
  await tabs.nth(0).click();
  return { metrics, labels, lists };
}
async function undoneWorkbook(page, panel, t, c, label) {
  await panel.locator('[data-overlap-scope-ack]').check();
  await button(panel, t.inspect).click();
  await panel.locator('[data-overlap-component]').waitFor();
  assert.equal(await panel.locator('[data-overlap-active-receipt]').count(), 0);
  const file = await download(
    page,
    button(panel, t.exportWorkbook),
    label + '-undone.xlsx',
  );
  const b = new ExcelJS.Workbook();
  await b.xlsx.readFile(file);
  assert.equal(b.getWorksheet('Accepted aggregates').rowCount, 1);
  assert.equal(b.getWorksheet('Main aggregate proof').rowCount, 1);
  const rows = [];
  b.getWorksheet('Original movements').eachRow((r, n) => {
    if (n > 1)
      rows.push({
        side: r.getCell(1).text,
        row: Number(r.getCell(4).value),
        minor: Number(r.getCell(6).value),
        disposition: r.getCell(8).text,
      });
  });
  assert.equal(rows.length, c.supplier.length + c.ledger.length);
  assert.ok(rows.every((r) => r.disposition !== 'accepted-aggregate-member'));
  for (const side of ['supplier', 'ledger'])
    for (const row of c[side])
      assert.equal(
        rows.find((x) => x.side === side && x.row === row.row)?.minor,
        row.amountMinor,
      );
  if (c.id === 'A')
    assert.equal(
      rows.filter((r) => r.disposition === 'needs-review').length,
      c.afterUndo.needsReviewSourceRows,
    );
  return { file, rows };
}
async function freshScope(page, t) {
  if (
    !(await page
      .getByLabel(t.app.scope.cutoffLabel, { exact: true })
      .isVisible())
  )
    await button(page, t.app.scope.edit).click();
  await page
    .getByRole('checkbox', { name: t.app.scope.balanceMode, exact: true })
    .check();
  for (const [label, value] of [
    [t.app.scope.cutoffLabel, truth.scope.cutoff],
    [t.app.scope.currencyLabel, 'SAR'],
    [t.app.scope.supplierLabel, 'S'],
    [t.app.scope.entityLabel, 'E'],
    [t.app.scope.accountLabel, 'AP'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole('checkbox', { name: t.app.scope.balanceMode, exact: true })
    .uncheck();
  const choice = page.getByRole('combobox', {
    name: t.app.scope.dateWindowField,
    exact: true,
  });
  if (await choice.count()) {
    await choice.click();
    await page
      .getByRole('option', { name: t.app.scope.days(7), exact: true })
      .click();
  }
  await button(page, t.app.compare.run).click();
  await page.locator('.metric').first().waitFor();
}
async function handoff(page, t, label) {
  await page
    .getByTestId('allocation-workflow-handoff')
    .filter({ hasNot: page.locator('h2') })
    .click();
  const workspace = page.locator('[data-allocation-workspace]');
  await workspace.waitFor({ state: 'visible' });
  assert.equal(await workspace.getByTestId('allocation-result').count(), 0);
  assert.equal(await workspace.getByTestId('allocation-event').count(), 0);
  for (let i = 0; i < 3; i++)
    assert.equal(
      await workspace
        .getByTestId('allocation-source-' + i)
        .locator('h3')
        .count(),
      0,
    );
  const copy = t.allocation;
  const ledger = workspace.getByLabel(copy.fields[1], { exact: true });
  assert.equal(await ledger.inputValue(), '');
  assert.equal(
    await workspace.locator('input[type=checkbox]:checked').count(),
    0,
  );
  await responsive(page, label);
  await button(workspace, t.allocation.backToSuppliers).click();
  await page.locator('.metric').first().waitFor({ state: 'visible' });
}
try {
  for (const lang of ['en', 'ar'])
    for (const c of truth.cases) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      await context.addInitScript(holdOriginalWorkerReplies);
      const page = await context.newPage();
      active = page;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const t = lang === 'en' ? en : ar,
        ot = invoiceOverlapIntegratedCopy(lang);
      await page.goto(url);
      await idle(page);
      await page
        .locator(`.language-switch button[lang="${lang}"]:visible`)
        .first()
        .click();
      for (const [i, side] of ['supplier', 'ledger'].entries()) {
        const name = `native-main-${c.id}-${side}.csv`;
        const bytes = await readFile(path.join(fixtureDir, name));
        assert.equal(sha(bytes), manifest.files[name]);
        await page
          .getByLabel(t.app.sides[i], { exact: true })
          .setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
        await page
          .locator('.source-card__description')
          .getByText(name, { exact: true })
          .waitFor();
        await idle(page);
      }
      await button(page, t.app.upload.next).click();
      await freshScope(page, t);
      const baselineSnapshot = await mainSnapshot(page, t);
      await responsive(page, `${c.id}-${lang}-baseline`);
      const currencyBoundary = {
        readonly: true,
        value: 'SAR',
        probeRequested: c.id === 'A' && lang === 'en',
      };
      const panel = await openInspect(
        page,
        ot,
        currencyBoundary.probeRequested
          ? (panel) =>
              currencyDriftProbe(
                page,
                panel,
                t,
                ot,
                baselineSnapshot,
                currencyBoundary,
              )
          : undefined,
      );
      const choices = await decisions(
        panel,
        ot,
        c,
        c.id === 'A' ? () => holdBaselineScalar(page, t, panel, ot) : undefined,
      );
      if (c.id === 'A') {
        await page.evaluate(() =>
          globalThis.heldOriginalWorkerReplies.splice(0).forEach((r) => r()),
        );
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
      }
      await metrics(page, t, c.afterCommit);
      await responsive(page, `${c.id}-${lang}-accepted`);
      const exportProof = await workbook(
        page,
        panel,
        ot,
        c,
        `${c.id}-${lang}-accepted`,
      );
      const session = await download(
        page,
        button(page, t.app.results.saveSession),
        `${c.id}-${lang}.session.json`,
      );
      const saved = JSON.parse(await readFile(session, 'utf8'));
      assert.ok(saved.overlapArchive);
      assert.equal(
        saved.overlapArchive.session.state.activeReceiptIds.length,
        1,
      );
      await button(page, ot.close).click();
      await button(page, ot.open).click();
      await page
        .getByTestId('invoice-overlap-review')
        .locator('[data-overlap-scope-ack]')
        .check();
      await button(
        page.getByTestId('invoice-overlap-review'),
        ot.inspect,
      ).click();
      await page.locator('[data-overlap-active-receipt]').waitFor();
      await metrics(page, t, c.afterCommit);
      await handoff(page, t, `${c.id}-${lang}-handoff`);
      await metrics(page, t, c.afterCommit);
      await page
        .getByRole('tab', { name: t.app.results.tabMatched, exact: true })
        .click();
      await button(page, t.app.results.caseDetails).first().click();
      await button(page, ot.wholeComponentUndo).click();
      await metrics(page, t, c.afterCommit);
      const live = page.getByTestId('invoice-overlap-review');
      if (!(await live.locator('[data-overlap-active-receipt]').count())) {
        await live.locator('[data-overlap-scope-ack]').check();
        await button(live, ot.inspect).click();
        await live.locator('[data-overlap-active-receipt]').waitFor();
      }
      await live
        .locator('[data-overlap-reviewer]')
        .fill('Native undo reviewer');
      await live
        .locator('[data-overlap-undo-rationale]')
        .fill(
          'Withdraw the entire component and replay every original row without any accepted group ownership.',
        );
      await live.locator('[data-overlap-undo-ack]').check();
      await button(live, ot.undo).click();
      await live
        .locator('[data-overlap-active-receipt]')
        .waitFor({ state: 'detached' });
      await metrics(page, t, c.afterUndo);
      const afterUndoSnapshot = await mainSnapshot(page, t);
      assert.deepEqual(afterUndoSnapshot, baselineSnapshot);
      const undoExportProof = await undoneWorkbook(
        page,
        live,
        ot,
        c,
        `${c.id}-${lang}`,
      );
      await page.goto(url);
      await idle(page);
      await page
        .getByLabel(t.app.upload.resumeLabel, { exact: true })
        .setInputFiles(session);
      await page.locator('.metric').first().waitFor();
      await metrics(page, t, { manualMatches: 0, autoMatchedCases: 0 });
      const restored = await openInspect(page, ot);
      assert.equal(
        await restored.locator('[data-overlap-active-receipt]').count(),
        0,
      );
      await decisions(restored, ot, c);
      await metrics(page, t, c.afterCommit);
      assert.deepEqual(errors, []);
      report.cases.push({
        id: c.id,
        lang,
        currencyBoundary,
        choices,
        rootFinancialPendingInterlock: c.id === 'A' ? true : null,
        lateOriginalScalarReplyIgnored: c.id === 'A' ? true : null,
        exportProof,
        baselineSnapshot,
        afterUndoSnapshot,
        undoExportProof,
        checks: [
          'whole-component-accept-main',
          'original-minor-row-ownership',
          'receipt-close-reopen-persistence',
          'whole-component-review-only-unlink',
          'original-replay-undo',
          'native-session-archive-no-authority',
          'fresh-human-reaccept',
          'fresh-independent-handoff',
        ],
        pageErrors: errors,
      });
      await writeFile(
        path.join(out, 'report.partial.json'),
        JSON.stringify(report, null, 2),
      );
      await context.close();
    }
  if (options.legacy) {
    const legacy = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    active = legacy;
    await verifyAllocation(legacy, url, path.join(out, 'existing-allocation'));
    report.allocationLegacy = true;
  }
  if (options.pending)
    report.actualAllocationPending = await verifyActualAllocationPending(
      browser,
      url,
      allocationFixtures,
      out,
      { ar, en },
    );
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
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
