// Maintained actual-App proof. Expected rows/bytes/citations come only from frozen manual truth.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { sectionDerivedReviewCopy } from '../lib/i18n/section-derived-review.ts';
import { sourceStructureReviewCopy } from '../lib/i18n/source-structure-review.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { ar } from '../lib/i18n/locales/ar.ts';
import { readFile as readNativeFile } from '../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';

const base = 'audit/p4-section-families-browser-v1';
const proofRoot = path.resolve(process.env.MIZAN_SECTION_PROOF_DIR || `${base}/run-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(path.dirname(proofRoot), { recursive: true });
await mkdir(proofRoot); // Existing/failed attempts are immutable; choose a new run directory.
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contract = JSON.parse(await readFile(`${base}/contract.json`, 'utf8'));
const fixtures = new Map();
const frozenFiles = {};
const freezeFile = async (file) => { frozenFiles[file] = sha(await readFile(file)); };
const aliasPath = 'audit/p4-raw-signed-header-v2/vocabulary-alias.json';
await freezeFile(aliasPath);
assert.equal(frozenFiles[aliasPath], 'f1b9776a87521145bf00b43cd6f998389a3f37070f8575c99e567c63fb1dd4c5');
assert.equal(contract.vocabularyAlias.path, aliasPath);
assert.equal(contract.vocabularyAlias.sha256, frozenFiles[aliasPath]);
const alias = JSON.parse(await readFile(aliasPath, 'utf8'));
// Public projection preserves financial truth; historical raw locators stay local.
const scopePath = `${base}/evidence-scope-annotation.json`;
await freezeFile(scopePath);
assert.equal(frozenFiles[scopePath], '279f504f7225adafab049fd06974d4cc945fbca877a76a44484044fb100bd315');
const evidenceScope = JSON.parse(await readFile(scopePath, 'utf8'));
await freezeFile(evidenceScope.preEngineProse.path);
assert.equal(frozenFiles[evidenceScope.preEngineProse.path], evidenceScope.preEngineProse.sha256);
for (const file of [`${base}/contract.json`, 'scripts/section-families-browser.mjs', 'scripts/section-families-check.py',
  'lib/reconciliation/io.ts', 'lib/reconciliation/source-preparation.ts', 'lib/reconciliation/core.ts',
  'lib/reconciliation/supplier-reconciliation.ts', 'components/section-derived-review.tsx', 'components/source-structure-review.tsx']) await freezeFile(file);
assert.equal(frozenFiles[`${base}/contract.json`], evidenceScope.uiContractSha256);
const diagnosticOnly = (spec) => spec.family === evidenceScope.case.family && spec.id === evidenceScope.case.id;
for (const spec of [...contract.positiveCases, ...contract.negativeCases]) {
  const frozen = `audit/${spec.family}/frozen`;
  const sourceFreeze = JSON.parse(await readFile(`${frozen}/freeze.json`, 'utf8'));
  await freezeFile(`${frozen}/freeze.json`);
  assert.equal(frozenFiles[`${frozen}/freeze.json`], contract.familyFreezeSha256[spec.family], 'accepted immutable family freeze');
  const familyContract = JSON.parse(await readFile(`${frozen}/contract.json`, 'utf8'));
  const caseContract = familyContract.cases.find((c) => c.id === spec.id);
  const files = ['contract.json', `${spec.id}.pdf`, `${spec.id}.expected.json`,
    ...(contract.positiveCases.includes(spec) ? [`${spec.id}.csv`] : [])];
  for (const name of files) {
    const file = `${frozen}/${name}`;
    await freezeFile(file);
    assert.equal(frozenFiles[file], sourceFreeze.files[name], `immutable manual truth: ${file}`);
  }
  const pdf = await readFile(`${frozen}/${spec.id}.pdf`);
  const expected = JSON.parse(await readFile(`${frozen}/${spec.id}.expected.json`, 'utf8'));
  assert.equal(sha(pdf), expected.originalSha256);
  if (diagnosticOnly(spec)) {
    assert.equal(frozenFiles[`${frozen}/freeze.json`], evidenceScope.familyFreezeSha256);
    assert.equal(frozenFiles[`${frozen}/${spec.id}.expected.json`], evidenceScope.expectedSha256);
    assert.equal(expected.originalSha256, evidenceScope.originalSha256);
    assert.equal(expected.outcome, 'blocked');
    assert.deepEqual(expected.proposals, []);
    assert.deepEqual(expected.links, []);
  }
  fixtures.set(`${spec.family}/${spec.id}`, { ...spec, pdf, expected, frozen,
    mapping: { ...defaultMapping(), ...familyContract.mapping }, cuts: caseContract?.cuts || familyContract.cuts,
    allowedBands: familyContract.allowedBands });
}
const dist = path.resolve('dist');
const distFiles = {};
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else distFiles[path.relative(dist, file)] = sha(await readFile(file));
  }
};
await walk(dist);
const freeze = { version: contract.version, createdBeforeBrowserLaunch: true, frozenAt: new Date().toISOString(),
  contract, files: frozenFiles, buildFiles: distFiles, expectedFromProduct: false };
const freezeText = JSON.stringify(freeze, null, 2) + '\n';
await writeFile(path.join(proofRoot, 'freeze.json'), freezeText, { flag: 'wx' });
await writeFile(path.join(proofRoot, 'driver-snapshot.mjs'), await readFile('scripts/section-families-browser.mjs'), { flag: 'wx' });
await writeFile(path.join(proofRoot, 'checker-snapshot.py'), await readFile('scripts/section-families-check.py'), { flag: 'wx' });
const report = { version: contract.version, synthetic: true, fieldAcceptance: false, financialMatching: false,
  expectedFromProduct: false, freezeSha256: sha(freezeText), startedAt: new Date().toISOString(),
  processPid: process.pid, browser: null, cases: [], requests: [], errors: [], passed: false };
const save = () => writeFile(path.join(proofRoot, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
let activePage;
let browser;
let server;
const noFinancialResult = async (page) => assert.equal(await page.locator('.metric').count(), 0,
  'source structure/reference review must not create an automatic financial result');
async function responsive(page, key, state) {
  const measurements = [];
  for (const width of contract.viewportWidths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const measured = await page.evaluate(() => ({ viewport: innerWidth,
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    measurements.push({ width, ...measured });
    assert.ok(measured.document <= width + 1 && measured.body <= width + 1, `${key}/${state}: ${JSON.stringify(measured)}`);
  }
  await page.screenshot({ path: path.join(proofRoot, `${key}-${state}-390.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { state, measurements };
}
async function sourceSetup(page, locale, fixture, namePrefix) {
  const choose = async (control, value, label) => {
    if (await control.evaluate((element) => element.tagName) === 'SELECT') await control.selectOption(value);
    else {
      await control.click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
  };
  for (let side = 0; side < 2; side++) {
    const name = `${namePrefix}-${side}.pdf`;
    await page.getByLabel(locale.app.sides[side], { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: fixture.pdf });
    await page.locator('.source-card__description').getByText(name, { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  }
  await page.getByRole('button', { name: locale.app.upload.next, exact: true }).click();
  for (let side = 0; side < 2; side++) {
    const edit = page.getByRole('button', { name: locale.app.source.edit(side), exact: true });
    let card = edit.locator('xpath=ancestor::section[1]');
    await card.getByRole('button', { name: locale.pdfReview.editCuts, exact: true }).click();
    await card.getByLabel(locale.pdfReview.cutsLabel, { exact: true }).fill(fixture.cuts.join(','));
    const apply = card.getByRole('button', { name: locale.pdfReview.applyCuts, exact: true });
    if (await apply.isEnabled()) await apply.click();
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    card = edit.locator('xpath=ancestor::section[1]');
    if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
    await card.getByLabel(locale.app.source.headerRowLabel(side), { exact: true }).fill('1');
    await choose(card.getByLabel(locale.app.source.amountMode, { exact: true }), 'signed', locale.app.source.signed);
    for (const [field, label] of [['date', 'dateColumn'], ['reference', 'referenceColumn'],
      ['description', 'descriptionColumn'], ['amount', 'amountColumn']]) {
      const column = fixture.mapping[field];
      await choose(card.getByLabel(locale.app.source[label], { exact: true }), String(column),
        `${column + 1} · ${fixture.expected.inventory[0].values[column] || locale.app.source.untitled}`);
    }
    await choose(card.getByLabel(locale.app.source.currencyColumn, { exact: true }), '-1', locale.app.source.unset);
    await card.locator('summary').filter({ hasText: locale.app.source.readingSettings }).click();
    assert.equal((await card.getByLabel(locale.app.source.numberFormat, { exact: true }).last().innerText()).trim(),
      fixture.mapping.numberFormat === 'dot' ? locale.app.source.decimalPoint : locale.app.source.decimalComma,
      'the existing inferred number format must match frozen manual reading without a format override');
    assert.equal((await card.getByLabel(locale.app.source.dateFormat, { exact: true }).last().innerText()).trim(),
      locale.app.dateFormats[fixture.mapping.dateFormat],
      'the existing inferred date format must match frozen manual reading without a format override');
    await card.getByRole('checkbox', { name: locale.pdfReview.reviewed, exact: true }).check();
    await edit.click();
  }
}
function proposalCells(proposal, expected, mapping) {
  const target = expected.inventory.find((r) => r.row === proposal.targetRow);
  return [{ row: target.row, page: target.page, column: mapping.reference + 1, literal: target.values[mapping.reference] },
    ...proposal.parentCells, ...proposal.continuationCells.flat(), ...(proposal.headerBands || proposal.headerCells || []).flat()];
}
const shortCell = (cell) => ({ row: cell.row, page: cell.page, column: cell.column, literal: cell.literal });
async function assertCitations(container, attribute, cells) {
  const actual = await container.locator(`[${attribute}]`).evaluateAll((elements, attr) => elements.map((element) => ({
    key: element.getAttribute(attr), literal: element.querySelector('mark')?.textContent,
  })), attribute);
  assert.deepEqual(actual, cells.map((cell) => ({ key: `1:${cell.page}:${cell.row}:${cell.column}`, literal: cell.literal || '∅' })),
    'all physical evidence cells, including role/value spans and all raw-band blanks');
}
async function diagnosticCitations(container, fixture) {
  const displayedHash = await container.locator(':scope > p.break-all > bdi').first().innerText();
  assert.equal(displayedHash, fixture.expected.originalSha256, 'diagnostic source hash is the frozen original');
  const citations = await container.locator('[data-source-cell]').evaluateAll((elements) => elements.map((element) => ({
    key: element.getAttribute('data-source-cell'), literal: element.querySelector('mark')?.textContent,
  })));
  for (const citation of citations) {
    const [sheet, page, row, column] = citation.key.split(':').map(Number);
    assert.equal(sheet, 1);
    const original = fixture.expected.inventory.find((entry) => entry.row === row && entry.page === page);
    assert.ok(original && Number.isInteger(column) && column > 0 && column <= original.values.length,
      'every diagnostic coordinate belongs to the complete frozen physical inventory');
    assert.equal(citation.literal, original.values[column - 1] || '∅', 'exact native diagnostic literal');
  }
  const suggestions = await container.locator('[data-section-proposal]').evaluateAll((elements) => elements.map((element) => ({
    reference: element.getAttribute('data-section-proposal'),
    citationKeys: [...element.querySelectorAll('[data-source-cell]')].map((cell) => cell.getAttribute('data-source-cell')),
  })));
  for (const suggestion of suggestions) {
    assert.ok(suggestion.citationKeys.length > 0, 'each diagnostic suggestion cites original cells');
    assert.ok(suggestion.citationKeys.some((key) => {
      const [sheet, page, row, column] = key.split(':').map(Number);
      return sheet === 1 && column === fixture.mapping.reference + 1 &&
        fixture.expected.inventory.some((entry) => entry.page === page && entry.row === row &&
          entry.values[column - 1] === suggestion.reference);
    }), 'diagnostic reference itself is supported by a cited frozen original reference cell');
  }
  return { acceptedDerivation: false, displayedSourceHash: displayedHash, suggestions, citations };
}
async function assertInventory(container, selector, expected) {
  const summary = container.locator('summary').last();
  if (await summary.count()) await summary.click();
  const rows = await container.locator(selector).evaluateAll((elements) => elements.map((row) => ({
    row: Number(row.getAttribute('data-derived-original-row') || row.getAttribute('data-physical-row')),
    values: [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  })));
  assert.deepEqual(rows, expected.inventory.map((row) => ({ row: row.row, values: row.values })), 'whole physical inventory');
}
async function assertGlobalBands(container, attribute, cellAttribute, fixture) {
  if (!fixture.allowedBands) return;
  const bands = [];
  for (let i = 0; i < fixture.expected.inventory.length - 1; i++) {
    const upper = fixture.expected.inventory[i], lower = fixture.expected.inventory[i + 1];
    if (upper.page !== lower.page || lower.row !== upper.row + 1) continue;
    if (fixture.allowedBands.some((band) => JSON.stringify(band) === JSON.stringify([upper.values, lower.values]))) {
      bands.push([upper, lower].flatMap((row) => row.values.map((literal, column) =>
        ({ row: row.row, page: row.page, column: column + 1, literal }))));
    }
  }
  const details = container.locator(`[${attribute}]`);
  if (bands.length) {
    assert.equal(await details.count(), 1, 'global recognized original header bands remain inspectable');
    await details.locator('summary').click();
    await assertCitations(details, cellAttribute, bands.flat());
  } else assert.equal(await details.locator(`[${cellAttribute}]`).count(), 0, 'no invented recognized header band');
}
async function downloaded(page, button, name) {
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  await download.saveAs(path.join(proofRoot, name));
  return await readFile(path.join(proofRoot, name));
}
async function acknowledge(panel) {
  for (const ack of await panel.locator('[data-derived-ack]').all()) await ack.check();
}
function expectedLinks(fixture, provenance) {
  const links = structuredClone(fixture.expected.links);
  if (fixture.family !== 'p4-raw-signed-header-v2' || fixture.id !== 'own-reference') return links;
  assert.equal(frozenFiles[`${fixture.frozen}/freeze.json`], alias.frozenManifestSha256);
  assert.equal(frozenFiles[`${fixture.frozen}/own-reference.expected.json`], alias.expectedSha256);
  assert.equal(fixture.expected.originalSha256, alias.originalSha256);
  assert.equal(fixture.expected.csvSha256, alias.csvSha256);
  assert.deepEqual(alias.singleAlias, { expectedPath: 'links[0].referenceOrigin', originalRow: 4, page: 1,
    originalColumn: 2, originalLiteral: 'INV-271', derivedRow: 2,
    conceptualFrozenValue: 'explicit-original-cell', acceptedPublicValue: 'explicit-source-cell' });
  assert.deepEqual(links[0], { originalRow: 4, page: 1, derivedRow: 2, reference: 'INV-271', referenceOrigin: 'explicit-original-cell' });
  const nativeCell = provenance.links[0].referenceEvidence;
  assert.deepEqual(shortCell(nativeCell), { row: 4, page: 1, column: 2, literal: 'INV-271' });
  assert.equal(nativeCell.sheet, 1);
  assert.equal(nativeCell.sourceHash, alias.originalSha256);
  assert.equal(fixture.expected.inventory.find((row) => row.row === 4).values[1], 'INV-271');
  assert.equal(links.filter((link) => link.referenceOrigin === 'explicit-original-cell').length, 1);
  links[0].referenceOrigin = 'explicit-source-cell'; // Only the exact accepted annotation; product output is never converted.
  return links;
}
try {
  assert.ok(process.env.MIZAN_CHROMIUM, 'Set MIZAN_CHROMIUM to the installed native Chrome executable');
  console.log(JSON.stringify({ stage: 'launch', processPid: process.pid, proofRoot, contractSha256: frozenFiles[`${base}/contract.json`] }));
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let rel = url.pathname.replace(/^\/mizan-test\//, '/');
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(dist, '.' + rel);
      if (!file.startsWith(dist + path.sep) || url.search || request.method !== 'GET') throw new Error('Unavailable local route');
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
        '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream' });
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.MIZAN_CHROMIUM });
  report.browser = { version: browser.version(), nativeExecutable: process.env.MIZAN_CHROMIUM };
  for (const lang of contract.languages) for (const spec of [...contract.positiveCases, ...contract.negativeCases]) {
    const fixture = fixtures.get(`${spec.family}/${spec.id}`);
    const locale = lang === 'ar' ? ar : en;
    const t = sectionDerivedReviewCopy(lang);
    const st = sourceStructureReviewCopy(lang);
    const key = `${lang}-${spec.id}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const allowed = new URL(request.url()).origin === origin;
      report.requests.push({ key, url: request.url(), allowed });
      if (allowed) await route.continue(); else await route.abort('blockedbyclient');
    });
    const page = await context.newPage(); activePage = page;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/mizan-test/`);
    await page.waitForFunction(() => !document.querySelector('.notice.loading'));
    if (lang === 'en') await page.locator('.language-switch button[lang="en"]:visible').first().click();
    await sourceSetup(page, locale, fixture, key);
    await noFinancialResult(page);
    const measurements = [];
    const diagnostics = {};
    let downloadCount = 0;
    page.on('download', () => { downloadCount++; });
    const structureDisclosure = page.getByTestId('source-structure-review-disclosure');
    await structureDisclosure.getByRole('button', { name: st.open, exact: true }).click();
    const structure = page.getByTestId('source-structure-review');
    for (const [field, value] of Object.entries({ supplier: 'SYNTHETIC', entity: 'ENTITY', account: 'AP', currency: 'SAR', cutoff: '2026-10-31' }))
      await structure.locator(`[data-review-scope="${field}"]`).fill(value);
    await structure.locator('[data-review-scope-attestation]').check();
    await structure.getByRole('button', { name: st.run, exact: true }).click();
    await structure.locator('[data-section-side="supplier"]').waitFor();
    for (const side of ['supplier', 'ledger']) {
      const sourceSection = structure.locator(`[data-section-side="${side}"]`);
      if (diagnosticOnly(spec)) diagnostics[side] = await diagnosticCitations(sourceSection, fixture);
      else {
        assert.equal(await sourceSection.locator('[data-section-proposal]').count(), fixture.expected.proposals.length);
        for (const [index, proposal] of fixture.expected.proposals.entries())
          await assertCitations(sourceSection.locator('[data-section-proposal]').nth(index), 'data-source-cell', proposalCells(proposal, fixture.expected, fixture.mapping));
      }
      await assertGlobalBands(sourceSection, 'data-section-header-bands', 'data-source-cell', fixture);
      await assertInventory(sourceSection, '[data-physical-row]', fixture.expected);
    }
    measurements.push(await responsive(page, key, 'structure'));
    await structureDisclosure.getByRole('button', { name: st.close, exact: true }).click();
    const disclosure = page.getByTestId('section-derived-disclosure');
    assert.equal(await disclosure.locator('input').count(), 0);
    await disclosure.getByRole('button', { name: t.open, exact: true }).click();
    assert.equal(await page.getByTestId('section-derived-review').count(), 0);
    await disclosure.locator('[data-derived-source]').selectOption('supplier');
    const panel = page.getByTestId('section-derived-review');
    const clearedPendingReview = await panel.evaluate((element, labels) => {
      const button = (name) => [...element.querySelectorAll('button')].find((b) => b.textContent === name);
      button(labels.inspect).click();
      button(labels.clear).click();
      return true;
    }, { inspect: t.inspect, clear: t.clear });
    await page.waitForTimeout(150);
    assert.equal(await panel.locator('[data-derived-proposal]').count(), 0, 'clear invalidates pending inspect and late output');
    await panel.getByRole('button', { name: t.inspect, exact: true }).click();
    await panel.getByText(t.busy, { exact: true }).waitFor({ state: 'detached' });
    if (diagnosticOnly(spec)) await panel.getByRole('alert').waitFor();
    else await panel.locator('[data-derived-reviewer]').waitFor();
    assert.equal(await panel.locator('[data-derived-proposal]').count(), fixture.expected.proposals.length);
    for (const [index, proposal] of fixture.expected.proposals.entries())
      await assertCitations(panel.locator('[data-derived-proposal]').nth(index), 'data-derived-cell', proposalCells(proposal, fixture.expected, fixture.mapping));
    if (diagnosticOnly(spec)) {
      assert.equal(await panel.locator('[data-derived-reviewer]').count(), 0, 'refused inspection has no review form or receipt');
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).count(), 0);
      for (const label of [t.downloadCsv, t.downloadProvenance, t.downloadOriginal])
        assert.equal(await panel.getByRole('button', { name: label, exact: true }).count(), 0);
      assert.equal(downloadCount, 0, 'refused native derivation publishes no downloadable bytes');
    } else {
      await assertGlobalBands(panel, 'data-derived-header-bands', 'data-derived-cell', fixture);
      await assertInventory(panel, '[data-derived-original-row]', fixture.expected);
    }
    measurements.push(await responsive(page, key, 'review'));
    const observation = { key, lang, family: spec.family, id: spec.id, outcome: fixture.expected.outcome,
      originalSha256: fixture.expected.originalSha256, explicitSource: true, clearedPendingReview,
      structureInventory: fixture.expected.inventory.length,
      derivativeInventory: diagnosticOnly(spec) ? null : fixture.expected.inventory.length,
      structureSourcesReviewed: ['supplier', 'ledger'],
      proposalCount: fixture.expected.proposals.length, measurements, pageErrors: errors };
    if (diagnosticOnly(spec)) {
      observation.evidenceScopeAnnotationSha256 = frozenFiles[scopePath];
      observation.structuralDiagnosticsOnly = diagnostics;
      observation.acceptedDerivationRefused = true;
      observation.refusal = await panel.getByRole('alert').innerText();
      observation.downloadCount = downloadCount;
    }
    if (fixture.expected.outcome === 'derived') {
      assert.equal(await panel.getByRole('button', { name: t.apply, exact: true }).count(), 0, 'no receipt, no Apply');
      for (const checkbox of await panel.locator('[data-derived-proposal-select]').all()) {
        assert.equal(await checkbox.isChecked(), false);
        await checkbox.check();
        await panel.getByText(t.busy, { exact: true }).waitFor({ state: 'detached' });
      }
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false, 'missing reviewer/rationale/acknowledgements refuse review');
      await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant A');
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false, 'reviewer alone is insufficient');
      await panel.locator('[data-derived-rationale]').fill('Reviewed every native PDF row, each physical parent and continuation cell, original header bands and signed literals. This is source interpretation only.');
      assert.equal(await panel.getByRole('button', { name: t.accept, exact: true }).isEnabled(), false, 'unreviewed acknowledgements refuse review');
      await acknowledge(panel);
      await panel.getByRole('button', { name: t.accept, exact: true }).click();
      await panel.getByRole('button', { name: t.apply, exact: true }).waitFor();
      await panel.locator('[data-derived-reviewer]').fill('Synthetic Accountant B');
      assert.equal(await panel.getByRole('button', { name: t.apply, exact: true }).count(), 0, 'reviewer edit invalidates receipt');
      await acknowledge(panel);
      await panel.getByRole('button', { name: t.accept, exact: true }).click();
      await panel.getByRole('button', { name: t.apply, exact: true }).waitFor();
      const firstSelection = panel.locator('[data-derived-proposal-select]').first();
      await firstSelection.uncheck();
      await panel.getByText(t.busy, { exact: true }).waitFor({ state: 'detached' });
      assert.equal(await panel.getByRole('button', { name: t.apply, exact: true }).count(), 0, 'selection edit invalidates receipt');
      await firstSelection.check();
      await panel.getByText(t.busy, { exact: true }).waitFor({ state: 'detached' });
      await acknowledge(panel);
      await panel.getByRole('button', { name: t.accept, exact: true }).click();
      await panel.getByRole('button', { name: t.apply, exact: true }).click();
      await panel.locator('[data-derived-artifact]').waitFor();
      const downloads = { csv: `${key}.csv`, provenance: `${key}-provenance.json`, original: `${key}-original.pdf` };
      const csv = await downloaded(page, panel.getByRole('button', { name: t.downloadCsv, exact: true }), downloads.csv);
      assert.deepEqual(csv, await readFile(`${fixture.frozen}/${spec.id}.csv`));
      assert.equal(sha(csv), fixture.expected.csvSha256);
      const provenance = JSON.parse(await downloaded(page, panel.getByRole('button', { name: t.downloadProvenance, exact: true }), downloads.provenance));
      assert.equal(provenance.financialApproval, false);
      assert.equal(provenance.originalSha256, fixture.expected.originalSha256);
      assert.equal(provenance.derivedSha256, fixture.expected.csvSha256);
      assert.deepEqual(provenance.inventory.map((row) => ({ row: row.originalRow, page: row.page, values: row.values })), fixture.expected.inventory);
      assert.deepEqual(provenance.links.map(({ originalRow, page, derivedRow, reference, referenceOrigin }) =>
        ({ originalRow, page, derivedRow, reference, referenceOrigin })), expectedLinks(fixture, provenance));
      assert.deepEqual(provenance.links.map((link) => link.amountEvidence.literal), fixture.expected.signedAmounts);
      for (const expected of fixture.expected.proposals) {
        const proposal = provenance.links.find((link) => link.originalRow === expected.targetRow).proposal;
        assert.deepEqual((proposal.parentSpan || [proposal.parent]).map(shortCell), expected.parentCells);
        assert.deepEqual((proposal.continuationSpans || proposal.continuation.map((cell) => [cell])).map((span) => span.map(shortCell)), expected.continuationCells);
        assert.deepEqual((proposal.headerBands || proposal.headers).map((span) => span.map(shortCell)), expected.headerBands || expected.headerCells);
        for (const cell of [proposal.target, ...(proposal.parentSpan || [proposal.parent]),
          ...(proposal.continuationSpans || proposal.continuation.map((cell) => [cell])).flat(), ...(proposal.headerBands || proposal.headers).flat()]) {
          assert.equal(cell.sourceHash, fixture.expected.originalSha256);
          assert.equal(cell.literal, fixture.expected.inventory.find((row) => row.row === cell.row).values[cell.column - 1]);
          assert.equal(cell.page, fixture.expected.inventory.find((row) => row.row === cell.row).page);
        }
      }
      const original = await downloaded(page, panel.getByRole('button', { name: t.downloadOriginal, exact: true }), downloads.original);
      assert.deepEqual(original, fixture.pdf);
      const fresh = await readNativeFile(downloads.csv, Uint8Array.from(csv).buffer);
      const prepared = prepareVerifiedSources([fresh], [{ ...defaultMapping(), ...fixture.mapping, pdfReviewed: false }],
        { supplier: '', entity: '', account: '', currency: 'XXX', decimals: 2, cutoff: '2100-12-31', dateWindow: 0,
          confirmed: false, coverageConfirmed: false }, ['supplier']).sources[0];
      assert.deepEqual(prepared.errors, []);
      assert.deepEqual(fresh.sheets[0].rows, fixture.expected.csvRows);
      assert.deepEqual(prepared.transactions.map((row) => row.amount), fixture.expected.amountMinor);
      assert.deepEqual(prepared.transactions.map((row) => row.originalAmount), fixture.expected.signedAmounts);
      observation.downloads = downloads;
      observation.csvSha256 = sha(csv);
      observation.freshReader = { rows: fresh.sheets[0].rows, amountMinor: prepared.transactions.map((row) => row.amount),
        signedLiterals: prepared.transactions.map((row) => row.originalAmount), errors: prepared.errors };
      observation.reviewerReceiptInvalidation = true;
      observation.selectionReceiptInvalidation = true;
      measurements.push(await responsive(page, key, 'artifact'));
      const edit = page.getByRole('button', { name: locale.app.source.edit(0), exact: true });
      const card = edit.locator('xpath=ancestor::section[1]');
      const boundaryButton = card.getByRole('button', { name: locale.pdfReview.editCuts, exact: true });
      if (await boundaryButton.count()) await boundaryButton.click();
      await card.getByLabel(locale.pdfReview.cutsLabel, { exact: true }).fill(fixture.cuts.map((c, i) => i === 2 ? c + 0.1 : c).join(','));
      await card.getByRole('button', { name: locale.pdfReview.applyCuts, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.notice.loading'));
      assert.equal(await page.getByTestId('section-derived-review').count(), 0, 'fresh native PDF extraction hides stale derivative/receipt');
      assert.equal(await disclosure.locator('[data-derived-source]').inputValue(), '');
      observation.sourceReceiptInvalidation = true;
    } else {
      assert.equal(await panel.locator('[data-derived-artifact]').count(), 0);
      assert.equal(await panel.getByRole('button', { name: t.apply, exact: true }).count(), 0);
      observation.blockedWithoutOutput = true;
    }
    await noFinancialResult(page);
    assert.deepEqual(errors, []);
    report.cases.push(observation);
    await save();
    console.log(JSON.stringify({ completed: key, outcome: observation.outcome }));
    await context.close();
  }
  for (const [file, originalHash] of Object.entries(frozenFiles)) assert.equal(sha(await readFile(file)), originalHash, `read-only source/frozen truth ${file}`);
  report.completedAt = new Date().toISOString();
  report.passed = true;
  await save();
  const python = execFileSync('python3', ['scripts/section-families-check.py', proofRoot], { encoding: 'utf8' });
  console.log(python.trim());
  report.independentPythonPassed = true;
  await save();
} catch (error) {
  report.errors.push(String(error)); report.passed = false;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(proofRoot, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(proofRoot, 'failure-body.txt'), await activePage.locator('body').innerText().catch(() => 'Page unavailable'));
    await writeFile(path.join(proofRoot, 'failure-fulltext.txt'), await activePage.locator('body').textContent().catch(() => 'Page unavailable'));
  }
  await save();
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}
console.log(JSON.stringify({ passed: report.passed, proofRoot, cases: report.cases.length }));
