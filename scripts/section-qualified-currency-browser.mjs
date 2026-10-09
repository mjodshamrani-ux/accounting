// Native mounted-App evidence. Manual sealed files alone supply expected output.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { sectionDerivedReviewCopy } from '../lib/i18n/section-derived-review.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { ar } from '../lib/i18n/locales/ar.ts';
import { readFile as readNativeFile } from '../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { formatChoice } from '../lib/reconciliation/input-readiness.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';

const base = 'audit/p4-qualified-currency-v1';
const family = 'p4-qualified-currency-v1';
const proofRoot = path.resolve(process.env.MIZAN_QUALIFIED_CURRENCY_PROOF_DIR ||
  `../work/integration-continuation/qualified-currency-native-gates/run-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(path.dirname(proofRoot), { recursive: true });
await mkdir(proofRoot); // Each attempt is new; failed/native bundles are never reused.
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const contract = await json(`${base}/browser/acceptance-matrix.json`);
const sourceContract = await json(`${base}/draft/frozen/contract.json`);
const dotTruth = await json(`${base}/format-addendum/manual-number-format-truth.json`);
const negativeDot = await json(`${base}/browser-clarification/manual-negative-choice-binding.json`);
// Public metadata projections retain all sealed economic inputs and assertions.
// Original historical logs and seals are preserved locally outside publication.
const manifestPins = {
  draft: '83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79',
  'format-addendum': '1056e5b2a6bf558766475ef53f1c44eee0865528517474b2444df33b044a7852',
  boundaries: '7d045f9fd964e07c78ceda6e6e46143927375815f291f08d27abb9898a724499',
  browser: '94dffd30f325de9e0c755204c22b7a8dfa800f7a69715da58abeccf690518c0d',
  'browser-clarification': '5aca126df4fdd033b1773751e7c8f98a7a92e34f674ff92b1ba53dc02bc06a1c',
  'precode-original': 'f4083b3236d61b971b5359298a6b901cc23aac6cb690a538c1cfe372c59cf561',
  'precode-addenda-review': '2d1ee525fe4803e7fc8476ccfec542bd4aa4f7c888b2d57827b43077909020da',
  'precode-closure': '996336775e7e65cc64e8b13c07e6de673b5a5b2476cb018c5866047e30293710',
};
const files = {};
const freezeFile = async (file) => { files[file] = sha(await readFile(file)); };
for (const [directory, pin] of Object.entries(manifestPins)) {
  const file = `${base}/${directory}/MANIFEST.json`;
  await freezeFile(file);
  assert.equal(files[file], pin, 'sealed independent manifest');
  for (const entry of (await json(file)).files) {
    const payload = `${base}/${directory}/${entry.path}`;
    await freezeFile(payload);
    assert.equal(files[payload], entry.sha256, 'sealed independent payload');
    assert.equal((await readFile(payload)).length, entry.bytes);
  }
}
for (const file of ['scripts/section-qualified-currency-browser.mjs', 'scripts/section-qualified-currency-check.py',
  'app/page.tsx', 'components/section-derived-review.tsx', 'lib/reconciliation/section-derived-reading.ts',
  'lib/reconciliation/section-continuation.ts', 'lib/reconciliation/section-currency-context.ts',
  'lib/i18n/section-derived-review.ts', 'lib/reconciliation/types.ts', 'package.json',
  'lib/reconciliation/input-readiness.ts', 'lib/reconciliation/format-inference.ts',
  'lib/reconciliation/io.ts', 'lib/reconciliation/source-preparation.ts', 'lib/reconciliation/core.ts']) await freezeFile(file);
const dist = path.resolve('dist');
const buildFiles = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else buildFiles[path.relative(dist, file)] = sha(await readFile(file));
  }
}
await walk(dist);
const freeze = { version: 'p4-qualified-currency-native-v1', createdBeforeBrowserLaunch: true,
  frozenAt: new Date().toISOString(), contract, manifestPins, files, buildFiles, expectedFromProduct: false };
const freezeText = JSON.stringify(freeze, null, 2) + '\n';
await writeFile(path.join(proofRoot, 'freeze.json'), freezeText, { flag: 'wx' });
await writeFile(path.join(proofRoot, 'driver-snapshot.mjs'), await readFile('scripts/section-qualified-currency-browser.mjs'), { flag: 'wx' });
await writeFile(path.join(proofRoot, 'checker-snapshot.py'), await readFile('scripts/section-qualified-currency-check.py'), { flag: 'wx' });
const report = { version: 'p4-qualified-currency-native-v1', synthetic: true, fieldAcceptance: false,
  financialMatching: false, financialApproval: false, scopeConfirmed: false, expectedFromProduct: false,
  processPid: process.pid, startedAt: new Date().toISOString(), freezeSha256: sha(freezeText),
  browser: null, cases: [], bareControls: [], requests: [], errors: [], passed: false };
const save = () => writeFile(path.join(proofRoot, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
let browser, server, activePage;

async function choose(page, control, value, label) {
  if (await control.evaluate((element) => element.tagName) === 'SELECT') await control.selectOption(value);
  else {
    await control.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
}
async function scopeSettings(page, locale, currency, decimals) {
  const currencyInput = page.getByLabel(locale.app.scope.currencyLabel, { exact: true });
  if (!await currencyInput.count()) await page.getByRole('button', { name: locale.app.scope.edit, exact: true }).click();
  await currencyInput.fill(currency);
  const precisionLabel = ({ 0: locale.app.scope.decimalsZero, 2: locale.app.scope.decimalsTwo, 3: locale.app.scope.decimalsThree })[decimals];
  await choose(page, page.getByLabel(locale.app.scope.decimals, { exact: true }), String(decimals), precisionLabel);
}
async function sourceSetup(page, locale, fixture, key, decimals, chooseOriginalDot = true) {
  for (let side = 0; side < 2; side++) {
    const name = `${key}-${side}.pdf`;
    await page.getByLabel(locale.app.sides[side], { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: fixture.pdf });
    await page.locator('.source-card__description').getByText(name, { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  }
  await page.getByRole('button', { name: locale.app.upload.next, exact: true }).click();
  await scopeSettings(page, locale, fixture.currency, decimals);
  for (let side = 0; side < 2; side++) {
    const edit = page.getByRole('button', { name: locale.app.source.edit(side), exact: true });
    let card = edit.locator('xpath=ancestor::section[1]');
    await card.getByRole('button', { name: locale.pdfReview.editCuts, exact: true }).click();
    await card.getByLabel(locale.pdfReview.cutsLabel, { exact: true }).fill(fixture.expected.cuts.join(','));
    const apply = card.getByRole('button', { name: locale.pdfReview.applyCuts, exact: true });
    if (await apply.isEnabled()) await apply.click();
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    card = edit.locator('xpath=ancestor::section[1]');
    if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
    await card.getByLabel(locale.app.source.headerRowLabel(side), { exact: true }).fill('1');
    await choose(page, card.getByLabel(locale.app.source.amountMode, { exact: true }), 'signed', locale.app.source.signed);
    for (const [field, label] of [['date', 'dateColumn'], ['reference', 'referenceColumn'], ['description', 'descriptionColumn'], ['amount', 'amountColumn']]) {
      const column = sourceContract.mapping[field];
      await choose(page, card.getByLabel(locale.app.source[label], { exact: true }), String(column),
        `${column + 1} · ${fixture.expected.inventory[0].values[column] || locale.app.source.untitled}`);
    }
    await choose(page, card.getByLabel(locale.app.source.currencyColumn, { exact: true }), '-1', locale.app.source.unset);
    const explicitNumber = card.getByLabel(locale.app.source.numberFormatIn(side), { exact: true });
    if (chooseOriginalDot && await explicitNumber.count()) await choose(page, explicitNumber, 'dot', '1,234.56');
    await card.getByRole('checkbox', { name: locale.pdfReview.reviewed, exact: true }).check();
    await edit.click();
  }
}
async function openReview(page, t) {
  const disclosure = page.getByTestId('section-derived-disclosure');
  const open = disclosure.getByRole('button', { name: t.open, exact: true });
  if (await open.count()) await open.click();
  await disclosure.locator('[data-derived-source]').selectOption('supplier');
  const panel = page.getByTestId('section-derived-review');
  await panel.getByRole('button', { name: t.inspect, exact: true }).click();
  await idle(panel, t);
  return panel;
}
async function idle(panel, t) {
  await panel.getByText(t.busy, { exact: true }).waitFor({ state: 'detached' });
}
async function measure(page, key, state) {
  const measurements = [];
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const actual = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(actual.document <= width + 1 && actual.body <= width + 1, `${key}/${state}/${width} overflow ${JSON.stringify(actual)}`);
    const screenshot = `${key}-${state}-${width}.png`;
    await page.screenshot({ path: path.join(proofRoot, screenshot), fullPage: true });
    measurements.push({ width, ...actual, screenshot });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { state, measurements };
}
async function inventory(panel, expected) {
  const rows = panel.locator('[data-derived-original-row]');
  if (!await rows.count()) await panel.locator('summary').last().click();
  const actual = await rows.evaluateAll((elements) => elements.map((row) => ({
    row: Number(row.getAttribute('data-derived-original-row')),
    page: Number(row.querySelector('th').textContent.match(/\d+/)[0]),
    values: [...row.querySelectorAll('td:not([data-derived-amount-interpretations])')].map((cell) => cell.textContent),
  })));
  assert.deepEqual(actual, expected.inventory, 'complete native UI inventory');
  return actual;
}
async function originalInventory(page, locale, fixture) {
  const card = page.getByRole('button', { name: locale.app.source.edit(0), exact: true }).locator('xpath=ancestor::section[1]');
  const details = card.locator('summary').filter({ hasText: locale.pdfReview.tableSummary }).locator('xpath=..');
  const table = details.locator('table');
  const header = await table.locator('thead th').allTextContents();
  const rows = [{ row: 1, page: 1, values: header.slice(1, -1) }];
  let pageNumber = 1;
  for (;;) {
    const visible = await table.locator('tbody tr').evaluateAll((elements) => elements.map((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
      return { row: Number(cells[0]), values: cells.slice(1, -1) };
    }));
    rows.push(...visible.map((row) => ({ row: row.row, page: pageNumber, values: row.values })));
    const next = details.getByRole('button', { name: locale.pdfReview.nextPage, exact: true });
    if (!await next.count() || !await next.isEnabled()) break;
    await next.click(); pageNumber++;
  }
  const previous = details.getByRole('button', { name: locale.pdfReview.previousPage, exact: true });
  while (await previous.count() && await previous.isEnabled()) await previous.click();
  const native = await readNativeFile(`${fixture.id}-observed-original.pdf`, Uint8Array.from(fixture.pdf).buffer, fixture.expected.cuts);
  const nativeRows = native.sheets[0].rows.map((values, index) => ({ row: index + 1, page: native.sheets[0].rowPages[String(index + 1)], values }));
  assert.deepEqual(rows, nativeRows, 'source-card UI covers every native physical page');
  assert.deepEqual(rows, fixture.expected.inventory, 'source-card inventory equals independently frozen truth');
  return rows;
}
async function ownDotChoice(page, locale) {
  const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
  if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
  const card = edit.locator('xpath=ancestor::section[1]');
  await choose(page, card.getByLabel(locale.app.source.numberFormatIn(0), { exact: true }), 'dot', '1,234.56');
  await edit.click();
}
async function clearOwnChoiceThroughMapping(page, locale) {
  const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
  if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
  const card = edit.locator('xpath=ancestor::section[1]');
  const amount = card.getByLabel(locale.app.source.amountColumn, { exact: true });
  await choose(page, amount, '2', '3 · Description');
  await choose(page, amount, '3', '4 · Signed amount (KWD)');
  await edit.click();
}
async function binding(panel, expected) {
  const paras = panel.locator(':scope > p.break-all');
  const sourceHash = await paras.nth(0).locator('bdi').innerText();
  const extractionHash = await paras.nth(1).locator('bdi').nth(0).innerText();
  const extractionRevision = await paras.nth(1).locator('bdi').nth(1).innerText();
  assert.equal(sourceHash, expected.originalSha256);
  assert.match(extractionHash, /^[0-9a-f]{64}$/);
  assert.ok(extractionRevision);
  return { sourceHash, extractionHash, extractionRevision };
}
async function allCitations(panel, expected) {
  const citations = await panel.locator('[data-derived-cell]').evaluateAll((elements) => elements.map((e) => ({
    key: e.getAttribute('data-derived-cell'), literal: e.querySelector('mark').textContent,
  })));
  for (const c of citations) {
    const [sheet, page, row, column] = c.key.split(':').map(Number);
    const physical = expected.inventory.find((r) => r.row === row && r.page === page);
    assert.equal(sheet, 1); assert.ok(physical && column >= 1 && column <= 4);
    assert.equal(c.literal, physical.values[column - 1] || '∅');
  }
  return citations;
}
async function form(panel, t, dotAck = true, select = true) {
  if (select) for (const check of await panel.locator('[data-derived-proposal-select]').all()) {
    if (!await check.isChecked()) { await check.check(); await idle(panel, t); }
  }
  await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant A');
  await panel.locator('[data-derived-rationale]').fill('Reviewed every physical original cell and source bound interpretation; structural derivation only.');
  for (const check of await panel.locator('[data-derived-ack]').all()) {
    if (await check.getAttribute('data-derived-ack') === 'originalDotInterpretationReviewed' && !dotAck) continue;
    await check.check();
  }
}
async function accept(panel, t) {
  await panel.getByRole('button', { name: t.accept, exact: true }).click();
  await idle(panel, t);
  await panel.getByRole('button', { name: t.apply, exact: true }).waitFor();
}
async function download(page, button, name) {
  const pending = page.waitForEvent('download');
  await button.click();
  await (await pending).saveAs(path.join(proofRoot, name));
  return readFile(path.join(proofRoot, name));
}
async function noOutput(panel, t) {
  assert.equal(await panel.locator('[data-derived-artifact]').count(), 0);
  assert.equal(await panel.getByRole('button', { name: t.apply, exact: true }).count(), 0);
  for (const label of [t.downloadCsv, t.downloadOriginal, t.downloadProvenance])
    assert.equal(await panel.getByRole('button', { name: label, exact: true }).count(), 0);
}
// Hold a genuine WebCrypto reply for this exact original. No accepted data is fabricated.
function installDigestHold() {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  const state = { armedHash: null, heldHash: null, release: null, events: [] };
  window.__qualifiedDigestHold = state;
  crypto.subtle.digest = async (...args) => {
    const result = await original(...args);
    const hash = [...new Uint8Array(result)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (state.armedHash === hash) {
      state.armedHash = null; state.heldHash = hash;
      state.events.push({ phase: 'held', hash, bytes: args[1].byteLength });
      await new Promise((resolve) => { state.release = resolve; });
      state.events.push({ phase: 'released-unmodified', hash });
    }
    return result;
  };
}
async function pendingProbes(page, panel, locale, fixture, t, downloads) {
  const results = {};
  for (const event of ['clear', 'replaceSource', 'updateReviewer']) {
    await form(panel, t); await accept(panel, t);
    const before = downloads();
    await page.evaluate((hash) => { window.__qualifiedDigestHold.armedHash = hash; window.__qualifiedDigestHold.heldHash = null; }, fixture.expected.originalSha256);
    await panel.getByRole('button', { name: t.apply, exact: true }).click();
    await page.waitForFunction(() => window.__qualifiedDigestHold.heldHash !== null);
    const heldOriginalDigest = await page.evaluate(() => window.__qualifiedDigestHold.heldHash);
    if (event === 'clear') await panel.getByRole('button', { name: t.clear, exact: true }).click();
    if (event === 'updateReviewer') await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant B');
    if (event === 'replaceSource') {
      const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
      const card = edit.locator('xpath=ancestor::section[1]');
      await card.getByRole('button', { name: locale.pdfReview.editCuts, exact: true }).click();
      await card.getByLabel(locale.pdfReview.cutsLabel, { exact: true }).fill('25,45,70.1');
      await card.getByRole('button', { name: locale.pdfReview.applyCuts, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    }
    await page.evaluate(() => window.__qualifiedDigestHold.release());
    await page.waitForFunction(() => window.__qualifiedDigestHold.events.some((e) => e.phase === 'released-unmodified'));
    await page.waitForTimeout(150);
    assert.equal(downloads(), before);
    if (event === 'replaceSource') {
      assert.equal(await page.getByTestId('section-derived-review').count(), 0);
      const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
      const card = edit.locator('xpath=ancestor::section[1]');
      const cuts = card.getByLabel(locale.pdfReview.cutsLabel, { exact: true });
      if (!await cuts.count()) await card.getByRole('button', { name: locale.pdfReview.editCuts, exact: true }).click();
      await cuts.fill('25,45,70');
      await card.getByRole('button', { name: locale.pdfReview.applyCuts, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.notice.loading'));
      if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
      const number = card.getByLabel(locale.app.source.numberFormatIn(0), { exact: true });
      if (await number.count()) await choose(page, number, 'dot', '1,234.56');
      await card.getByRole('checkbox', { name: locale.pdfReview.reviewed, exact: true }).check();
      if (await edit.getAttribute('aria-expanded') === 'true') await edit.click();
    } else await noOutput(panel, t);
    results[event] = { heldOriginalDigest, releasedUnmodified: true, noArtifact: true, noUsableReceipt: true,
      downloadCount: downloads() - before, transportEvents: await page.evaluate(() => window.__qualifiedDigestHold.events) };
    panel = await openReview(page, t);
  }
  return { results, panel };
}

try {
  assert.ok(process.env.MIZAN_CHROMIUM, 'Set MIZAN_CHROMIUM to installed native Chrome');
  server = createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let rel = url.pathname.replace(/^\/mizan-test\//, '/');
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(dist, '.' + rel);
      if (!file.startsWith(dist + path.sep) || url.search || request.method !== 'GET') throw Error('Unavailable local route');
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream' });
      const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.MIZAN_CHROMIUM });
  report.browser = { version: browser.version(), nativeExecutable: process.env.MIZAN_CHROMIUM };
  console.log(JSON.stringify({ stage: 'launch', processPid: process.pid, proofRoot }));
  for (const spec of [...contract.positiveCases, ...contract.targetedRefusalCases]) {
    const positive = contract.positiveCases.includes(spec);
    const id = spec.source || spec.id;
    const expected = await json(`${base}/draft/frozen/${id}.expected.json`);
    const currency = expected.currencyContext?.currency || spec.currency;
    const decimals = expected.currencyContext?.decimals ?? spec.policyDecimals;
    const fixture = { id, pdf: await readFile(`${base}/draft/frozen/${id}.pdf`), expected, currency, decimals };
    const locale = spec.lang === 'ar' ? ar : en;
    const t = sectionDerivedReviewCopy(spec.lang);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.addInitScript(installDigestHold);
    await context.route('**/*', async (route) => {
      const allowed = new URL(route.request().url()).origin === origin;
      report.requests.push({ key: spec.key, url: route.request().url(), allowed });
      if (allowed) await route.continue(); else await route.abort('blockedbyclient');
    });
    const page = await context.newPage(); activePage = page;
    const errors = []; let downloadCount = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', () => { downloadCount++; });
    await page.goto(`${origin}/mizan-test/`);
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    if (spec.lang === 'en') await page.locator('.language-switch button[lang="en"]:visible').first().click();
    await sourceSetup(page, locale, fixture, spec.key, spec.wrongSelectedDecimals ?? decimals,
      spec.id !== 'kwd-selected-exponent-and-missing-dot-review');
    const observation = { key: spec.key, lang: spec.lang, family, id: spec.id, outcome: spec.outcome, passed: false,
      originalSha256: expected.originalSha256, cuts: expected.cuts, measurements: [], pageErrors: errors };
    observation.sourceInventory = await originalInventory(page, locale, fixture);
    if (positive) {
      const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
      await edit.click(); observation.measurements.push(await measure(page, spec.key, 'original-source-review')); await edit.click();
    }
    let panel = await openReview(page, t);
    observation.initialReviewSurfaceAvailable = await panel.locator('[data-derived-reviewer]').count() === 1;
    if (observation.initialReviewSurfaceAvailable) {
      observation.derivativeInventory = await inventory(panel, expected);
      observation.originalBinding = await binding(panel, expected);
      observation.displayedCitations = await allCitations(panel, expected);
    } else {
      observation.derivativeInventory = null; observation.originalBinding = null; observation.displayedCitations = [];
      assert.ok((await panel.getByRole('alert').allTextContents()).length, 'Inspect refusal has a real native alert');
    }
    if (await panel.locator('[data-derived-currency-context]').count()) {
      const selectedText = await panel.locator('[data-derived-selected-precision]').innerText();
      const policyText = await panel.locator('[data-derived-policy-precision]').innerText();
      observation.precisionDisplay = { selectedPrecision: Number(selectedText.match(/\d+/)[0]), policyPrecision: Number(policyText.match(/\d+/)[0]) };
      assert.deepEqual(observation.precisionDisplay, { selectedPrecision: spec.wrongSelectedDecimals ?? decimals, policyPrecision: decimals });
    } else {
      const current = (await page.getByLabel(locale.app.scope.decimals, { exact: true }).innerText()).trim();
      const visiblePrecision = new Map([[locale.app.scope.decimalsZero, 0], [locale.app.scope.decimalsTwo, 2], [locale.app.scope.decimalsThree, 3]]).get(current);
      assert.equal(visiblePrecision, spec.wrongSelectedDecimals ?? decimals);
      observation.precisionDisplay = { selectedPrecision: visiblePrecision, policyPrecision: null, surface: 'original-scope-control-inspect-refused' };
    }
    if (positive) {
      assert.equal(observation.initialReviewSurfaceAvailable, true);
      const ctx = panel.locator('[data-derived-currency-context]');
      assert.equal(await ctx.count(), 1);
      observation.currencyCitations = await ctx.locator('[data-derived-cell]').evaluateAll((elements) => elements.map((e) => ({ key: e.getAttribute('data-derived-cell'), literal: e.querySelector('mark').textContent })));
      if (spec.originalDotReviewRequired) {
        const manual = dotTruth.cases.find((c) => c.id === id);
        assert.equal(await panel.locator('[data-derived-original-number-interpretation]').count(), 1);
        const displayed = await panel.locator('[data-derived-amount-interpretations] > div').evaluateAll((elements) => elements.map((e) => [...e.querySelectorAll('bdi')].map((b) => b.textContent)));
        assert.deepEqual(displayed.map((r) => r[0]), manual.signedAmounts);
        assert.deepEqual(displayed.map((r) => Number(r[1])), manual.numericInterpretations.dotDecimalMinor);
        assert.deepEqual(displayed.map((r) => Number(r[2])), manual.numericInterpretations.dotGroupingMinor);
        observation.amountInterpretations = { dotDecimalMinor: displayed.map((r) => Number(r[1])), dotGroupingMinor: displayed.map((r) => Number(r[2])) };
      } else assert.equal(await panel.locator('[data-derived-ack="originalDotInterpretationReviewed"]').count(), 0);
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false);
      await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant A');
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false, 'missing rationale refuses review');
      await panel.locator('[data-derived-rationale]').fill('Reviewed source evidence without ordinary acknowledgements.');
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false, 'missing ordinary acknowledgements refuse review');
      observation.ordinaryFormRefusals = { missingReviewer: true, missingRationale: true, missingAcknowledgements: true };
      // Existing selection completeness is a late Apply boundary: structural review can exist.
      await form(panel, t, true, false); await accept(panel, t);
      const beforeUnselected = downloadCount;
      await panel.getByRole('button', { name: t.apply, exact: true }).click(); await idle(panel, t);
      await noOutput(panel, t); assert.equal(downloadCount, beforeUnselected);
      assert.ok((await panel.getByRole('alert').allTextContents()).length);
      observation.unselectedProposalRefusal = { structuralReceiptMinted: true, lateApplyRefused: true, noArtifact: true, noUsableReceipt: true, downloadCount: 0 };
      await form(panel, t); await accept(panel, t);
      await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant B');
      await noOutput(panel, t); observation.reviewerReceiptInvalidation = true;
      await form(panel, t); await accept(panel, t);
      const selection = panel.locator('[data-derived-proposal-select]').first();
      await selection.uncheck(); await idle(panel, t); await noOutput(panel, t);
      observation.selectionReceiptInvalidation = true;
      await selection.check(); await idle(panel, t);
      if (spec.pendingLifecycleProbe) {
        const pending = await pendingProbes(page, panel, locale, fixture, t, () => downloadCount);
        observation.pendingLifecycle = pending.results; panel = pending.panel;
      }
      observation.originalBinding = await binding(panel, expected);
      observation.measurements.push(await measure(page, spec.key, 'derivative-review'));
      await form(panel, t); await accept(panel, t);
      await panel.getByRole('button', { name: t.apply, exact: true }).click();
      await panel.locator('[data-derived-artifact]').waitFor();
      const names = { csv: `${spec.key}.csv`, original: `${spec.key}-original.pdf`, provenance: `${spec.key}-provenance.json` };
      const csv = await download(page, panel.getByRole('button', { name: t.downloadCsv, exact: true }), names.csv);
      const original = await download(page, panel.getByRole('button', { name: t.downloadOriginal, exact: true }), names.original);
      const provenance = JSON.parse(await download(page, panel.getByRole('button', { name: t.downloadProvenance, exact: true }), names.provenance));
      assert.deepEqual(csv, await readFile(`${base}/draft/frozen/${id}.csv`)); assert.deepEqual(original, fixture.pdf);
      assert.equal(provenance.financialApproval, false); assert.equal(provenance.scopeConfirmed, false);
      assert.deepEqual(observation.originalBinding, { sourceHash: provenance.originalSha256,
        extractionHash: provenance.extractionHash, extractionRevision: provenance.extractionRevision });
      observation.downloads = names;
      const mapping = { ...defaultMapping(), ...sourceContract.mapping, pdfReviewed: undefined };
      const fresh = await readNativeFile(names.csv, Uint8Array.from(csv).buffer);
      if (spec.originalDotReviewRequired) {
        const candidates = suggestFormats(fresh, mapping, decimals).numberFormat.candidates;
        mapping.formatChoice = { numberFormat: formatChoice(fresh, mapping, 'numberFormat', 'dot', candidates, decimals) };
        const replay = await readNativeFile(`${spec.key}-0.pdf`, Uint8Array.from(original).buffer, expected.cuts);
        const originalReading = { ...defaultMapping(), ...sourceContract.mapping };
        const originalFormats = suggestFormats(replay, originalReading, decimals).numberFormat;
        observation.originalNumberChoice = formatChoice(replay, originalReading, 'numberFormat', 'dot', originalFormats.candidates, decimals);
        observation.originalNumberFormat = { status: originalFormats.status, candidates: originalFormats.candidates };
        observation.derivedNumberChoice = mapping.formatChoice.numberFormat;
        observation.derivedNumberFormat = { status: suggestFormats(fresh, mapping, decimals).numberFormat.status, candidates };
      }
      const scope = { supplier: '', entity: '', account: '', currency, decimals, cutoff: '2100-12-31', dateWindow: 0, confirmed: false, coverageConfirmed: false };
      const prepared = prepareVerifiedSources([fresh], [mapping], scope, ['supplier']).sources[0];
      assert.deepEqual(prepared.errors, []);
      assert.deepEqual(prepared.transactions.map((r) => r.amount), expected.amountMinor);
      observation.freshReader = { rows: fresh.sheets[0].rows, amountMinor: prepared.transactions.map((r) => r.amount),
        signedLiterals: prepared.transactions.map((r) => r.originalAmount), errors: prepared.errors, currency, decimals, confirmed: false, coverageConfirmed: false };
      observation.measurements.push(await measure(page, spec.key, 'artifact'));
      if (spec.freshReloadRemountProbe) {
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('.notice.loading'));
        if (spec.lang === 'en' && await page.locator('.language-switch button[lang="en"][aria-pressed="false"]').count())
          await page.locator('.language-switch button[lang="en"]:visible').first().click();
        await sourceSetup(page, locale, fixture, `${spec.key}-remount`, decimals);
        const freshPanel = await openReview(page, t);
        await noOutput(freshPanel, t);
        assert.equal(await freshPanel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false);
        observation.freshReloadRemount = { freshReviewRequired: true, noArtifact: true, noUsableReceipt: true };
      }
    } else {
      if (observation.initialReviewSurfaceAvailable) await form(panel, t);
      if (spec.id === 'kwd-selected-exponent-and-missing-dot-review') {
        observation.extraKwdSubsteps = {};
        await noOutput(panel, t);
        observation.selectedExponentRefusal = { noArtifact: true, noUsableReceipt: true, selectedPrecision: spec.wrongSelectedDecimals,
          alert: await panel.getByRole('alert').allTextContents(), inspectRefused: !observation.initialReviewSurfaceAvailable };
        await scopeSettings(page, locale, currency, decimals);
        await ownDotChoice(page, locale);
        panel = await openReview(page, t);
        observation.originalBinding = await binding(panel, expected);
        observation.derivativeInventory = await inventory(panel, expected);
        observation.displayedCitations = await allCitations(panel, expected);
        await form(panel, t, false); await noOutput(panel, t);
        assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false);
        observation.extraKwdSubsteps['missing-original-dot-acknowledgement'] = true;
        const ack = panel.locator('[data-derived-ack="originalDotInterpretationReviewed"]');
        await ack.check(); await ack.uncheck(); await noOutput(panel, t);
        observation.extraKwdSubsteps['false-original-dot-acknowledgement'] = true;
        await clearOwnChoiceThroughMapping(page, locale);
        panel = await openReview(page, t); await form(panel, t); await noOutput(panel, t);
        observation.originalBinding = await binding(panel, expected);
        observation.derivativeInventory = await inventory(panel, expected);
        observation.displayedCitations = await allCitations(panel, expected);
        assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false);
        observation.extraKwdSubsteps['missing-original-choice'] = true;
      }
      const button = panel.getByRole('button', { name: t.accept, exact: true });
      if (await button.count() && await button.isEnabled()) await button.click();
      await idle(panel, t);
      if (spec.refusalTiming === 'late-apply-validation-preserved') {
        assert.equal(observation.initialReviewSurfaceAvailable, true, 'late semantic fixture has structural Inspect review');
        await panel.getByRole('button', { name: t.apply, exact: true }).waitFor();
        observation.structuralReceiptMinted = true;
        if (id === 'kwd-excess-fraction') {
          const native = await readNativeFile(`${spec.key}-0.pdf`, Uint8Array.from(fixture.pdf).buffer, expected.cuts);
          const reading = { ...defaultMapping(), ...sourceContract.mapping };
          observation.ownOriginalNumberChoice = formatChoice(native, reading, 'numberFormat', 'dot', suggestFormats(native, reading, decimals).numberFormat.candidates, decimals);
          assert.deepEqual(observation.ownOriginalNumberChoice, negativeDot.originalNumberFormatChoice);
          observation.originalDotInterpretationReviewed = await panel.locator('[data-derived-ack="originalDotInterpretationReviewed"]').isChecked();
        }
        await panel.getByRole('button', { name: t.apply, exact: true }).click();
        await idle(panel, t); observation.lateApplyRefused = true;
      } else observation.earlyReceiptRefused = true;
      await noOutput(panel, t);
      assert.equal(downloadCount, 0);
      observation.refusal = await panel.getByRole('alert').allTextContents();
      if (!observation.refusal.length) observation.refusal = ['Native review action disabled until current owned original interpretation is complete.'];
      observation.downloadCount = downloadCount; observation.noArtifact = true; observation.noUsableReceipt = true;
      observation.measurements.push(await measure(page, spec.key, 'refusal'));
    }
    assert.equal(await page.locator('.metric').count(), 0, 'no automatic financial result');
    assert.deepEqual(errors, []);
    observation.noFinancialResult = true; observation.passed = true; report.cases.push(observation);
    await save(); console.log(JSON.stringify({ completed: spec.key, outcome: spec.outcome }));
    await context.close();
  }
  for (const spec of contract.bareControls) for (const lang of spec.languages) {
    const expected = await json(`${base}/draft/frozen/${spec.id}.expected.json`);
    const fixture = { id: spec.id, expected, currency: 'SAR', decimals: 2, pdf: await readFile(`${base}/draft/frozen/${spec.id}.pdf`) };
    const locale = lang === 'ar' ? ar : en;
    const t = sectionDerivedReviewCopy(lang);
    const key = `${lang}-${spec.id}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const allowed = new URL(route.request().url()).origin === origin;
      report.requests.push({ key, url: route.request().url(), allowed });
      if (allowed) await route.continue(); else await route.abort('blockedbyclient');
    });
    const page = await context.newPage(); activePage = page;
    const errors = []; let downloads = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', () => { downloads++; });
    await page.goto(`${origin}/mizan-test/`);
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    if (lang === 'en') await page.locator('.language-switch button[lang="en"]:visible').first().click();
    await sourceSetup(page, locale, fixture, key, 2);
    const panel = await openReview(page, t);
    assert.equal(await panel.locator('[data-derived-currency-context]').count(), 0);
    await noOutput(panel, t);
    assert.equal(downloads, 0); assert.deepEqual(errors, []);
    assert.equal(await page.locator('.metric').count(), 0);
    report.bareControls.push({ key, id: spec.id, lang, outcome: 'outside-new-family', originalSha256: expected.originalSha256,
      newCurrencyContext: false, newCurrencyReceipt: false, derivedCurrencyArtifact: false, downloadCount: downloads, pageErrors: errors });
    await save(); await context.close();
  }
  for (const [file, pin] of Object.entries(files)) assert.equal(sha(await readFile(file)), pin, `read-only bound file ${file}`);
  for (const [file, pin] of Object.entries(buildFiles)) assert.equal(sha(await readFile(path.join(dist, file))), pin, `unchanged served build ${file}`);
  report.passed = true; report.completedAt = new Date().toISOString(); await save();
  console.log(execFileSync('python3', ['scripts/section-qualified-currency-check.py', proofRoot], { encoding: 'utf8' }).trim());
} catch (error) {
  report.errors.push(String(error)); report.passed = false;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(proofRoot, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(proofRoot, 'failure-body.txt'), await activePage.locator('body').innerText().catch(() => 'Page unavailable'));
  }
  await save(); throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, proofRoot }));
