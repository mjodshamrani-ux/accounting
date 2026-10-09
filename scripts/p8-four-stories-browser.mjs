// Real App / native Worker / native exports. Frozen economic truth is external.
// No AI runtime; real reply timing is deliberately held, never fabricated.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const frozen = path.join(repo, 'audit/p8-non-ai-four-story-v1/frozen');
const dist = path.join(repo, 'dist');
const proofRoot = path.join(repo, 'audit/p8-non-ai-four-story-v1/validation');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const contract = await json(path.join(frozen, 'CONTRACT.json'));
const truth = await json(path.join(frozen, 'FINANCIAL-TRUTH.json'));
const format = await json(path.join(frozen, 'FORMAT-EXPECTATIONS.json'));
for (const entry of (await json(path.join(frozen, 'MANIFEST.json'))).files) {
  const bytes = await readFile(path.join(frozen, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha(bytes), entry.sha256, entry.path);
}
for (const entry of (await json(path.join(frozen, 'SOURCE-PINS.json'))).sourcePins) {
  const bytes = await readFile(path.join(repo, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha(bytes), entry.sha256, entry.path);
}
await mkdir(proofRoot, { recursive: true });
const sealFile = path.join(proofRoot, 'PREEXECUTION-SEAL.json');
const executablePath = process.env.MIZAN_CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function pins(root, relative = '') {
  const rows = [];
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, item.name);
    if (item.isDirectory()) rows.push(...await pins(root, file));
    else {
      const bytes = await readFile(path.join(root, file));
      rows.push({ file, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file));
}
const seal = {
  id: 'P8-PREEXECUTION-DRIVER-EVALUATOR-BUILD-V1',
  scripts: await Promise.all(['scripts/p8-four-stories-browser.mjs', 'scripts/p8-workbook-check.py'].map(async (file) => ({ file, sha256: sha(await readFile(path.join(repo, file))) }))),
  productSources: await Promise.all(['lib/reconciliation/supplier-overlap-review.ts', 'lib/reconciliation/types.ts', 'tests/supplier-overlap-review.test.ts'].map(async (file) => ({ file, sha256: sha(await readFile(path.join(repo, file))) }))),
  frozenManifestSha256: sha(await readFile(path.join(frozen, 'MANIFEST.json'))),
  engineVersion: (await readFile(path.join(repo, 'lib/reconciliation/types.ts'), 'utf8')).match(/^export const ENGINE_VERSION = '([^']+)';/)[1],
  dist: await pins(dist),
  device: { platform: os.platform(), osRelease: os.release(), architecture: os.arch(), cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), browserExecutable: executablePath },
  matrix: contract.plannedExecutionMatrix,
  pdfCutConvention: 'Owner statically checked pdf.ts x/pageWidth*100: frozen absolute page-width percentages apply directly.',
  networkScope: 'Browser route denies nonlocal traffic; loopback static assets/blob/data allowed. External-network simulation, not disconnected loopback reload or physical weak hardware.',
  timingScope: 'SYNTHETIC_REPLY_TIMING: preserve one exact real parsed read MessageEvent closure and release after UI cancellation.',
};
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--seal-only') {
  await save(sealFile, seal);
  console.log('Sealed driver/evaluator/dist before execution: ' + sealFile);
  process.exit(0);
}
assert.deepEqual(args, [], 'Only --seal-only or complete 12-case execution supported');
assert.deepEqual(await json(sealFile), seal, 'Preexecution seal changed; preserve review and create a new seal before execution');
const approval = await json(path.join(proofRoot, 'PREEXECUTION-REVIEW.json'));
assert.equal(approval.status, 'ACCEPT_DRIVER_EVALUATOR_FOR_EXECUTION');
assert.equal(approval.sealSha256, sha(await readFile(sealFile)));
const out = await mkdtemp(path.join(proofRoot, 'attempt-'));
console.log('P8 actual browser attempt: ' + out);
await save(path.join(out, 'preexecution-seal.json'), seal);
await save(path.join(out, 'preexecution-review.json'), approval);
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const { en } = await import(pathToFileURL(path.join(repo, 'lib/i18n/locales/en.ts')));
const { ar } = await import(pathToFileURL(path.join(repo, 'lib/i18n/locales/ar.ts')));
const { invoiceOverlapIntegratedCopy } = await import(pathToFileURL(path.join(repo, 'lib/i18n/invoice-overlap-review.ts')));
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'GET');
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    assert.ok(file.startsWith(dist + path.sep));
    const bytes = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream');
    res.end(bytes);
  } catch { res.statusCode = 404; res.end('Missing static resource'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath, headless: true });
const report = { status: 'RUNNING', sealSha256: sha(await readFile(sealFile)), browserVersion: browser.version(), device: seal.device, synthetic: true, fieldAcceptance: false, AIInferenceRuns: 0, runs: [], limits: contract.limits, fullP8ClaimBoundary: contract.fullP8ClaimBoundary };

// Read-only instrumentation of genuine requests/replies, except exact delivery timing.
function observeRealWorkers() {
  globalThis.p8WorkerRequests = [];
  globalThis.p8WorkerReplies = [];
  globalThis.p8HeldReplies = [];
  const post = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage').value;
  Worker.prototype.postMessage = function (...args) {
    const d = args[0];
    globalThis.p8WorkerRequests.push({ action: d?.action, id: d?.id, name: d?.payload?.name, at: performance.now() });
    return post.apply(this, args);
  };
  const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
  if (!descriptor?.set) throw Error('Native onmessage descriptor missing');
  const handlers = new WeakMap();
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: descriptor.configurable, enumerable: descriptor.enumerable,
    get() { return handlers.get(this) ?? null; },
    set(handler) {
      handlers.set(this, handler);
      descriptor.set.call(this, typeof handler === 'function' ? function (event) {
        const d = event.data;
        if (Object.hasOwn(d ?? {}, 'value')) {
          const value = d.value;
          const provenance = { action: d.action, id: d.id, at: performance.now(), engine: value?.engine, ready: value?.ready, name: value?.name, sha256: value?.sha256, originalByteLength: value?.original?.byteLength, sheets: value?.sheets?.map((s) => ({ name: s.name, rows: s.rows })), files: value?.files?.map((f) => ({ name: f.name, sha256: f.sha256, sheets: f.sheets?.map((s) => ({ name: s.name, rows: s.rows })) })) };
          globalThis.p8WorkerReplies.push(provenance);
          if (d.action === 'read' && globalThis.p8HoldRead) {
            globalThis.p8HoldRead = false;
            globalThis.p8HeldReplies.push({ provenance, release: () => handler.call(this, event) });
            return;
          }
        }
        return handler.call(this, event);
      } : handler);
    },
  });
}
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
}
async function ready(page, language) {
  await page.goto(origin);
  await idle(page);
  await page.locator(`.language-switch button[lang="${language}"]:visible`).first().click();
  await page.locator('.file-grid .source-card input[type=file]').first().waitFor();
  assert.equal(await page.locator('.file-grid input[type=file]:disabled').count(), 0);
  await page.evaluate(() => document.fonts.ready);
}
async function download(page, control, file) {
  const pending = page.waitForEvent('download');
  await control.click();
  const d = await pending;
  await d.saveAs(file);
  await idle(page);
  return file;
}
async function financialEmpty(page) {
  assert.equal(await page.locator('.source-card.has-file').count(), 0);
  assert.equal(await page.locator('.metric').count(), 0);
  assert.equal(await page.locator('[data-overlap-active-receipt]').count(), 0);
}
async function cancelRead(page, t, source, run, assist) {
  const bytes = await readFile(source.file);
  await page.evaluate(() => { globalThis.p8HoldRead = true; });
  await page.getByLabel(t.app.sides[0], { exact: true }).setInputFiles({ name: source.name, buffer: bytes, mimeType: source.mime });
  assist('upload', 1, 'Cancellation input: exact original bytes ' + source.name);
  await page.waitForFunction(() => globalThis.p8HeldReplies.length === 1);
  const provenance = await page.evaluate(() => globalThis.p8HeldReplies[0].provenance);
  assert.equal(provenance.name, source.name);
  assert.equal(provenance.sha256, sha(bytes));
  assert.equal(provenance.originalByteLength, bytes.length);
  const loading = page.locator('.notice.loading');
  assert.equal(await loading.count(), 1);
  await button(loading, t.common.cancel).click();
  assist('cancel', 1, 'Cancel genuine parsed Worker read job ' + provenance.id);
  await idle(page);
  await financialEmpty(page);
  await page.evaluate(() => globalThis.p8HeldReplies.splice(0).forEach((held) => held.release()));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await financialEmpty(page);
  run.lifecycle.cancelledRealRead = { ...provenance, timing: 'SYNTHETIC_REPLY_TIMING', releasedExactEvent: true, staleIgnored: true };
}
async function upload(page, t, sources, assist, recovery = false) {
  for (const [index, source] of sources.entries()) {
    const bytes = await readFile(source.file);
    await page.getByLabel(t.app.sides[index], { exact: true }).setInputFiles({ name: source.name, buffer: bytes, mimeType: source.mime });
    await page.locator('.source-card__description').getByText(source.name, { exact: true }).waitFor();
    await idle(page);
    assist(recovery ? 'recovery-reupload' : (source.derived ? 'financial-derived-upload' : 'upload'), 1, 'Explicit financial source upload ' + source.name);
  }
  await button(page, t.app.upload.next).click();
  assist('mapping-field', 1, 'Confirm uploaded source configuration');
}
async function choose(page, control, wantedIndex, expectedText) {
  await control.press('Enter');
  const options = page.getByRole('option');
  await options.first().waitFor({ state: 'visible' });
  // ItemText is the first direct DIV in the pinned native SelectItem source;
  // ItemIndicator/Icon may contain decorative glyphs, outside the chosen label.
  const labels = await options.evaluateAll((items) => items.map((item) => item.querySelector(':scope > div')?.textContent?.trim()));
  const expected = expectedText ?? labels[wantedIndex];
  const index = wantedIndex ?? labels.indexOf(expectedText.trim());
  assert.ok(index >= 0, 'Frozen option unavailable: ' + expectedText);
  assert.ok(typeof expected === 'string', 'Native item label unavailable');
  // Native keyboard movement avoids pointer/backdrop races during long-page
  // automatic scrolling. No force clicks, DOM value injection, or fake replies.
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
  const focused = async (i) => page.waitForFunction((element) => document.activeElement === element, await options.nth(i).elementHandle());
  await page.keyboard.press('Home');
  await focused(0);
  for (let i = 0; i < index; i++) {
    await page.keyboard.press('ArrowDown');
    await focused(i + 1);
  }
  await page.keyboard.press('Enter');
  await options.first().waitFor({ state: 'hidden' });
  assert.equal((await control.locator('[data-slot="select-value"]').textContent()).trim(), expected.trim());
  return 3 + index;
}
async function configure(page, t, definition, sources, assist) {
  for (const [side, source] of sources.entries()) {
    const section = page.locator('section.surface.pad.stack').filter({ has: page.getByRole('heading', { name: t.app.sides[side], exact: true }) });
    const c = t.app.source;
    if (source.name.endsWith('.pdf')) {
      await button(section, t.pdfReview.editCuts).click();
      const layout = format.layouts.find((l) => l.path === 'story1/P2D06-ledger.pdf');
      await section.getByLabel(t.pdfReview.cutsLabel, { exact: true }).fill(layout.pdfManualCutsPercent.join(', '));
      assist('pdf-column-cut', 1, 'Fill frozen absolute page-width cuts, no inferred truth');
      await button(section, t.pdfReview.applyCuts).click();
      assist('pdf-column-cut', 1, 'Apply frozen cuts through actual native PDF reader');
      await idle(page);
      await section.getByRole('checkbox', { name: t.pdfReview.reviewed, exact: true }).check();
      assist('source-review', 1, 'Acknowledge scripted PDF row/column review; no field-human claim');
    }
    await button(section, c.edit(side)).click();
    assist('mapping-field', 1, 'Open source mapping ' + side);
    const mapping = definition.originalCase?.[side === 0 ? 'supplier' : 'ledger']?.mapping;
    const columns = mapping ? { date: mapping.date, reference: mapping.reference, description: mapping.description, amount: mapping.amount, currencyColumn: mapping.currencyColumn } : (definition.id === 'native-main-A' ? { date: 2, reference: 0, amount: 1, description: -1, currencyColumn: -1 } : { date: 0, reference: 1, amount: 2, currencyColumn: 3, description: 4 });
    const labels = { date: c.dateColumn, reference: c.referenceColumn, amount: c.amountColumn, description: c.descriptionColumn, currencyColumn: c.currencyColumn };
    for (const [field, column] of Object.entries(columns)) {
      const index = column + 1;
      const actions = await choose(page, section.getByRole('combobox', { name: labels[field], exact: true }), index);
      assist('mapping-field', actions, `Choose frozen ${side}/${field} column ${column} with native keyboard`);
    }
    await section.locator('summary').getByText(c.readingSettings, { exact: true }).click();
    for (const [label, option] of [[c.reportType, c.transactions], [c.direction, c.positiveIncreases], [c.numberFormat, c.decimalPoint], [c.dateFormat, t.app.dateFormats.ymd]]) {
      const actions = await choose(page, section.getByRole('combobox', { name: label, exact: true }), null, option);
      assist('mapping-field', actions, 'Explicit frozen reading setting: ' + label);
    }
  }
}
async function scopeAndCompare(page, t, definition, assist) {
  if (!(await page.getByLabel(t.app.scope.cutoffLabel, { exact: true }).isVisible())) {
    await button(page, t.app.scope.edit).click();
    assist('scope-field', 1, 'Open scope fields');
  }
  await page.getByRole('checkbox', { name: t.app.scope.balanceMode, exact: true }).check();
  assist('scope-field', 1, 'Expose entity/account fields');
  const scope = definition.scope;
  for (const [label, value] of [[t.app.scope.cutoffLabel, scope.cutoff], [t.app.scope.currencyLabel, scope.currency], [t.app.scope.supplierLabel, scope.supplier], [t.app.scope.entityLabel, scope.entity], [t.app.scope.accountLabel, scope.account]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    assist('scope-field', 1, 'Set frozen scope: ' + label);
  }
  await page.getByRole('checkbox', { name: t.app.scope.balanceMode, exact: true }).uncheck();
  assist('scope-field', 1, 'Transaction-only mode; no balance coverage claim');
  const actions = await choose(page, page.getByRole('combobox', { name: t.app.scope.dateWindowField, exact: true }), null, t.app.scope.days(scope.dateWindow));
  assist('scope-field', actions, 'Frozen date window ' + scope.dateWindow);
  await button(page, t.app.compare.run).click();
  assist('scope-field', 1, 'Explicit compare action');
  await page.locator('.metric').first().waitFor();
  await idle(page);
}
async function metricCounts(page, t, automatic, manual) {
  for (const [label, count] of [[t.app.results.autoMatches, automatic], [t.app.results.manualMatches, manual]]) {
    const item = page.locator('.metric').filter({ has: page.locator('span').getByText(label, { exact: true }) });
    await item.locator('strong').getByText(String(count), { exact: true }).waitFor();
  }
}
async function manualReview(page, language, definition, assist, phase) {
  const ot = invoiceOverlapIntegratedCopy(language);
  await button(page, ot.open).click();
  const panel = page.getByTestId('invoice-overlap-review');
  await panel.locator('[data-overlap-scope-ack]').check();
  assist('source-review', 1, 'Acknowledge component scope');
  await button(panel, ot.inspect).click();
  assist('source-review', 1, 'Inspect real independently scoped candidate component');
  await panel.locator('[data-overlap-component]').waitFor();
  assert.equal(await panel.locator('[data-overlap-active-receipt]').count(), 0);
  const candidates = panel.locator('[data-overlap-candidate]');
  assert.equal(await candidates.count(), definition.originalCase.candidateCount);
  await panel.locator('[data-overlap-reviewer]').fill('P8 synthetic reviewer ' + phase);
  assist('source-reviewer-label', 1, 'Fill separate manual reviewer label');
  await panel.locator('[data-overlap-rationale]').fill('Scripted review of each original row and both alternatives against independently frozen source truth.');
  assist('source-rationale', 1, 'Fill manual component rationale');
  const choices = [];
  for (const candidate of await candidates.all()) {
    const paragraphs = await candidate.locator(':scope > p').allTextContents();
    const count = Number(await candidate.getAttribute('data-overlap-supplier-members')) + Number(await candidate.getAttribute('data-overlap-ledger-members'));
    const keys = paragraphs.slice(2, 2 + count).map((line) => {
      const row = Number(line.match(new RegExp(ot.row + '\\s+(\\d+)'))?.[1]);
      assert.ok(row >= 2, line);
      return (line.includes(ot.supplier + ' ·') ? 's' : 'l') + (row - 1);
    }).sort((a, b) => a.localeCompare(b));
    const accepted = definition.originalCase.accept.some((group) => JSON.stringify([...group].sort((a, b) => a.localeCompare(b))) === JSON.stringify(keys));
    const rejected = definition.originalCase.reject.some((group) => JSON.stringify([...group].sort((a, b) => a.localeCompare(b))) === JSON.stringify(keys));
    assert.notEqual(accepted, rejected, 'Unexpected or both-authority candidate');
    await candidate.locator('[data-overlap-decision]').selectOption(accepted ? 'accepted' : 'rejected');
    await candidate.locator('[data-overlap-decision-rationale]').fill(accepted ? 'Explicitly reviewed whole invoice members; no pairwise allocation inferred.' : 'Rejected competing whole group using frozen independent membership evidence.');
    assist(accepted ? 'human-candidate-accept' : 'human-candidate-reject', 2, 'Separate manual choice and rationale: ' + keys.join('/'), 'manual reviewer decision');
    choices.push({ keys, accepted });
  }
  assert.equal(choices.filter((c) => c.accepted).length, 1);
  for (const field of ['rows', 'decisions']) {
    await panel.locator(`[data-overlap-${field}-ack]`).check();
    assist('source-review', 1, 'Acknowledge reviewed component ' + field);
  }
  await button(panel, ot.commit).click();
  assist(phase === 'restore' ? 'fresh-reaccept' : 'source-review', 1, 'Commit separate manual whole component', 'manual approval only');
  await metricCounts(page, language === 'en' ? en : ar, 0, 1);
  await button(page, ot.close).click();
  assist('source-review', 1, 'Close component reviewer');
  return choices;
}
async function undo(page, language, assist) {
  const ot = invoiceOverlapIntegratedCopy(language);
  await button(page, ot.open).click();
  const panel = page.getByTestId('invoice-overlap-review');
  await panel.locator('[data-overlap-scope-ack]').check();
  await button(panel, ot.inspect).click();
  assist('source-review', 3, 'Open/ack/inspect active receipt before full undo');
  await panel.locator('[data-overlap-active-receipt]').waitFor();
  await panel.locator('[data-overlap-reviewer]').fill('P8 synthetic undo reviewer');
  await panel.locator('[data-overlap-undo-rationale]').fill('Withdraw every member of the reviewed component; retain source occurrences and require new approval.');
  await panel.locator('[data-overlap-undo-ack]').check();
  assist('source-reviewer-label', 1, 'Undo reviewer');
  assist('source-rationale', 1, 'Whole component withdrawal reason');
  assist('source-review', 1, 'Undo acknowledgment');
  await button(panel, ot.undo).click();
  assist('whole-component-undo', 1, 'Undo complete original component', 'remove manual approval');
  await panel.locator('[data-overlap-active-receipt]').waitFor({ state: 'detached' });
  await metricCounts(page, language === 'en' ? en : ar, 0, 0);
  await button(page, ot.close).click();
  assist('source-review', 1, 'Close undo reviewer');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
async function sourceReview(page, definition, run, assist, phase) {
  const ui = page.locator('[data-multiline-source-review]');
  await ui.locator('[data-source-review-toggle]').click();
  assist('source-review', 1, 'Open deterministic source reviewer');
  assert.equal(await ui.locator('[data-source-review-recorded-review]').count(), 0);
  assert.equal(await ui.locator('[data-source-review-state="empty"]').count(), 1);
  const pageLifetime = await page.evaluate(() => performance.timeOrigin);
  const file = path.join(frozen, 'story4', definition.original);
  const bytes = await readFile(file);
  assert.equal(sha(bytes), definition.expectedOriginalSha256);
  const text = bytes.toString('utf8');
  await ui.locator('[data-source-review-file]').setInputFiles({ name: path.basename(file), buffer: bytes, mimeType: 'text/plain' });
  assist(phase === 'restore' ? 'recovery-reupload' : 'upload', 1, 'Original TXT upload; source review only');
  await ui.locator('[data-source-review-state="candidate"]').waitFor();
  assert.equal(await ui.locator('[data-source-review-original]').textContent(), text);
  assert.equal(await ui.locator('[data-source-review-hash]').textContent(), definition.expectedOriginalSha256);
  const extractionRevision = await ui.locator('[data-source-review-revision]').textContent();
  const spans = {};
  for (const field of ['date', 'reference', 'amount', 'currency']) {
    assert.equal(await ui.locator(`[data-source-review-literal="${field}"]`).textContent(), definition.reviewOracle.fields[field]);
    spans[field] = {};
    for (const kind of ['value', 'role']) {
      const span = ui.locator(`[data-source-span="${kind}"][data-source-fields~="${field}"]`);
      const startUtf16 = Number(await span.getAttribute('data-start-utf16'));
      const endUtf16 = Number(await span.getAttribute('data-end-utf16'));
      const literal = await span.textContent();
      spans[field][kind] = { startUtf16, endUtf16, startByte: Buffer.byteLength(text.slice(0, startUtf16)), endByte: Buffer.byteLength(text.slice(0, endUtf16)), literal };
      assert.equal(text.slice(startUtf16, endUtf16), literal);
    }
  }
  assert.deepEqual(spans, definition.reviewOracle.evidence);
  const unchanged = async () => {
    await financialEmpty(page);
    assert.deepEqual(await page.locator('.file-grid input[type=file]').evaluateAll((inputs) => inputs.map((input) => input.files.length)), [0, 0]);
  };
  await unchanged();
  const separateReviewerLabel = 'P8 scripted TXT reviewer ' + phase;
  const separateRationale = 'Separate scripted review of original literal and role spans; deterministic known labels only, no AI or field trial.';
  await ui.locator('[data-source-review-reviewer]').fill(separateReviewerLabel);
  assist('source-reviewer-label', 1, 'Separate TXT reviewer label');
  await ui.locator('[data-source-review-rationale]').fill(separateRationale);
  assist('source-rationale', 1, 'Separate TXT rationale');
  await ui.locator('[data-source-review-acknowledge]').check();
  assist('source-review', 1, 'Acknowledge original TXT evidence');
  await ui.locator('[data-source-review-accept]').click();
  assist('source-review', 1, 'Accept source reading only', 'source-reading approval, no financial import');
  await ui.locator('[data-source-review-state="approved"]').waitFor();
  await unchanged();
  await ui.locator('[data-source-review-apply]').click();
  assist('source-apply-derived', 1, 'Explicit derived source action', 'derived source only; no financial import');
  await ui.locator('[data-source-review-state="applied"]').waitFor();
  await unchanged();
  const derivedCsvFile = await download(page, ui.locator('[data-source-review-download]'), path.join(run.directory, phase + '-derived.csv'));
  const derived = await readFile(derivedCsvFile);
  assert.equal(sha(derived), definition.derivedSourceExpected.expectedSerializedCsvSha256);
  assert.deepEqual(derived, await readFile(path.join(frozen, definition.derivedSourceExpected.expectedSerializedCsvArtifact)));
  const selections = Object.keys(spans).sort().map((field) => ({ field, ...spans[field], sourceSha256: definition.expectedOriginalSha256, extractionRevision }));
  const proof = { originalTxtName: path.basename(file), originalTxtSha256: sha(bytes), extractionRevision, pageLifetime, freshEmptyReviewObserved: true, revisionScope: 'Controller/page-local counter, bound to distinct actual page performance.timeOrigin; raw string need not differ across fresh pages.', selectionSha256: sha(canonical(selections)), selectionHashBasis: 'Canonical observed UI spans + original-byte offsets/hash + observed revision; independently reconstructed, not an exported authority capability.', separateReviewerLabel, separateRationale, derivedCsvName: 'multiline-explicitly-derived-invoice.csv', derivedCsvFile, derivedCsvSha256: sha(derived), explicitFinancialImportAction: false, financialStateUnchangedThroughSourceApply: true, spans, selections, recordedReviewText: await ui.locator('[data-source-review-recorded-review]').textContent() };
  const proofFile = path.join(run.directory, phase + '-txt-provenance.json');
  await save(proofFile, proof);
  run.sourceReviewProofs.push({ file: proofFile, extractionRevision, pageLifetime });
  await ui.screenshot({ path: path.join(run.directory, phase + '-txt-review.png') });
  return { file: derivedCsvFile, name: proof.derivedCsvName, mime: 'text/csv', derived: true, proof, proofFile };
}
async function decoyExplanation(page, t, definition, run, assist) {
  await page.getByRole('tab', { name: t.app.results.tabUnmatched, exact: true }).click();
  await button(page, t.app.results.caseDetails).click();
  assist('source-review', 2, 'Inspect sole unmatched INV-C in existing deterministic source explanation');
  const detail = page.getByRole('region', { name: t.transactionReview.region, exact: true });
  await detail.waitFor();
  const visibleText = await detail.innerText();
  assert.ok(visibleText.includes('INV-C'));
  await detail.screenshot({ path: path.join(run.directory, 'inv-c-existing-explanation.png') });
  const explanation = {
    case: 'P2D06', authority: 'Source-supported independent narration plus captured existing deterministic UI; no AI or financial approval',
    visibleExistingExplanation: visibleText,
    independentFrozenRationale: definition.originalCase.rationale,
    sourceCitations: [
      { side: 'supplier', row: 2, reference: 'INV-A', po: 'PO-A', amountMinor: 100000 },
      { side: 'ledger', row: 2, reference: 'INV-B', po: 'PO-B', amountMinor: 50000 },
      { side: 'ledger', row: 5, reference: 'INV-C', po: 'PO-C', amountMinor: 50000 },
    ],
    explanation: 'INV-B + INV-C equals INV-A numerically (500+500=1000), but the literal chosen references and PO values are different. The proven INV-A group uses only ledger rows3/4 (400+600); INV-C row5 remains unapproved. Shared Document No alone does not override these source identities.',
    evidenceWorkbook: path.join(run.directory, 'initial.xlsx'),
  };
  const file = path.join(run.directory, 'story1-decoy-explanation.json');
  await save(file, explanation);
  run.decoyExplanation = { file, sha256: sha(await readFile(file)) };
  await button(detail, t.transactionReview.close).click();
  assist('source-review', 1, 'Close source explanation without financial decision');
}
async function workbook(page, t, run, phase) {
  await button(page, t.app.results.prepareWorkpaper).click();
  const file = await download(page, button(page, t.app.finish.downloadDraft), path.join(run.directory, phase + '.xlsx'));
  run.workbooks.push(file);
  // Workpaper back returns the same live comparison; no reviewer authority added.
  await button(page, t.app.finish.backToReview).click();
  await page.locator('.metric').first().waitFor();
}
function baseSources(definition) {
  let supplier, ledger;
  if (definition.id === 'P2D06') [supplier, ledger] = ['story1/P2D06-supplier.xlsx', 'story1/P2D06-ledger.pdf'];
  else if (definition.id.startsWith('P2V2')) [supplier, ledger] = ['supplier', 'ledger'].map((side) => `story2/${definition.id.slice(-3)}/${definition.id}-${side}.csv`);
  else [supplier, ledger] = ['supplier', 'ledger'].map((side) => `story3/native-main-A-${side}.csv`);
  return [supplier, ledger].map((rel) => ({ file: path.join(frozen, rel), name: path.basename(rel), mime: rel.endsWith('.pdf') ? 'application/pdf' : rel.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' }));
}
let active;
try {
  const definitions = [...truth.stories.slice(0, 4), ...truth.stories[4].cases.map((c) => ({ ...c, story: 'story4' }))];
  for (const definition of definitions) for (const matrix of contract.plannedExecutionMatrix.perCase) {
    const language = matrix.uiLanguage;
    const viewport = { width: matrix.viewport[0], height: matrix.viewport[1] };
    const directory = path.join(out, definition.id + '-' + language);
    await mkdir(directory);
    const run = { case: definition.id, story: definition.story, language, viewport: matrix.viewport, status: 'RUNNING', directory, lifecycle: {}, assistance: [], sourceReviewProofs: [], workbooks: [], pageErrors: [] };
    report.runs.push(run);
    let phase = 'initial';
    const assist = (kind, count, detail, authorityEffect = 'No automatic financial approval') => run.assistance.push({ story: definition.story, case: definition.id, phase, kind, count, detail, scriptedSynthetic: true, authorityEffect });
    const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block' });
    await context.addInitScript(observeRealWorkers);
    const nonlocalAttempts = [], resources = [];
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || /^(blob:|data:)/.test(url)) return route.continue();
      nonlocalAttempts.push(url);
      return route.abort();
    });
    context.on('request', (request) => resources.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(), at: Date.now() }));
    let page = await context.newPage();
    active = page;
    page.on('pageerror', (error) => run.pageErrors.push(error.message));
    const t = language === 'en' ? en : ar;
    try {
      await ready(page, language);
      assist('language-switch', 1, 'Set actual UI language ' + language);
      run.lifecycle.staticReady = { actualReadyReply: await page.evaluate(() => globalThis.p8WorkerReplies.some((r) => r.action === 'ready' && r.ready === true)), actualReadyReplies: await page.evaluate(() => globalThis.p8WorkerReplies.filter((r) => r.action === 'ready')), fontsReady: true, resourcesAtReady: [...resources], distIndexSha256: seal.dist.find((x) => x.file === 'index.html').sha256 };
      assert.equal(run.lifecycle.staticReady.actualReadyReply, true);
      assert.ok(run.lifecycle.staticReady.actualReadyReplies.every((r) => r.engine === seal.engineVersion));
      let sources = baseSources(definition);
      if (definition.story === 'story4') {
        const derived = await sourceReview(page, definition, run, assist, 'initial');
        sources = [derived, { file: path.join(frozen, definition.counterpart), name: path.basename(definition.counterpart), mime: 'text/csv' }];
      }
      await cancelRead(page, t, sources[0], run, assist);
      await upload(page, t, sources, assist);
      if (sources[0].derived) {
        sources[0].proof.explicitFinancialImportAction = true;
        await save(sources[0].proofFile, sources[0].proof);
      }
      await configure(page, t, definition, sources, assist);
      await scopeAndCompare(page, t, definition, assist);
      const expected = definition.nativeExportExpected;
      await metricCounts(page, t, expected.automaticGroups, 0);
      if (definition.id === 'native-main-A') run.initialManualChoices = await manualReview(page, language, definition, assist, 'initial');
      await metricCounts(page, t, expected.automaticGroups, expected.manualGroups);
      if (definition.id === 'P2D06') await decoyExplanation(page, t, definition, run, assist);
      const session = await download(page, button(page, t.app.results.saveSession), path.join(directory, 'session.json'));
      run.session = { file: session, sha256: sha(await readFile(session)) };
      await workbook(page, t, run, 'initial');
      await page.screenshot({ path: path.join(directory, 'initial-result.png'), fullPage: true });
      if (definition.id === 'native-main-A') {
        await undo(page, language, assist);
        run.lifecycle.undo = { matchedSourceRows: 0, manualGroups: 0, automaticGroups: 0, activeReceipts: 0, originalRowsReplayed: true };
        await workbook(page, t, run, 'undone');
        run.undoWorkbook = run.workbooks.pop();
      }
      run.initialWorkerRequests = await page.evaluate(() => globalThis.p8WorkerRequests);
      await page.close();
      phase = 'restore';
      page = await context.newPage();
      active = page;
      page.on('pageerror', (error) => run.pageErrors.push(error.message));
      await ready(page, language);
      assist('language-switch', 1, 'Fresh-page UI language');
      assert.equal(await page.locator('[data-source-review-recorded-review]').count(), 0);
      await page.getByLabel(t.app.upload.resumeLabel, { exact: true }).setInputFiles(session);
      assist('archive-restore', 1, 'Load actual saved session on a fresh browser page', 'Historical archive is not an active manual receipt');
      await page.locator('.metric').first().waitFor();
      await idle(page);
      await metricCounts(page, t, expected.automaticGroups, 0);
      run.lifecycle.restoredSession = { freshPage: true, file: session, sha256: run.session.sha256, activeOldReceipts: 0, sourceReviewAuthorityRestored: false, actualRestoreReplies: await page.evaluate(() => globalThis.p8WorkerReplies.filter((r) => r.action === 'restore-session')) };
      assert.ok(run.lifecycle.restoredSession.actualRestoreReplies.length);
      if (definition.id === 'native-main-A') run.restoredManualChoices = await manualReview(page, language, definition, assist, 'restore');
      if (definition.story === 'story4') {
        await button(page, t.app.shell.newReconciliation).click();
        await button(page.getByRole('alertdialog'), t.app.shell.resetConfirm).click();
        assist('source-review', 2, 'Reset restored comparison to require new original TXT review', 'Clear loaded financial session; no retained source-reading authority');
        await financialEmpty(page);
        const derived = await sourceReview(page, definition, run, assist, 'restore');
        sources[0] = derived;
        await upload(page, t, sources, assist, true);
        derived.proof.explicitFinancialImportAction = true;
        await save(derived.proofFile, derived.proof);
        await configure(page, t, definition, sources, assist);
        await scopeAndCompare(page, t, definition, assist);
      }
      await metricCounts(page, t, expected.automaticGroups, expected.manualGroups);
      await workbook(page, t, run, 'restored');
      await page.screenshot({ path: path.join(directory, 'restored-result.png'), fullPage: true });
      run.restoredWorkerRequests = await page.evaluate(() => globalThis.p8WorkerRequests);
      run.lifecycle.network = { mode: seal.networkScope, nonlocalAttempts, requestedResources: resources };
      assert.deepEqual(nonlocalAttempts, []);
      assert.ok(resources.every((r) => r.method === 'GET'), 'No external sends or POST');
      assert.deepEqual(run.pageErrors, []);
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(overflow.document <= viewport.width + 1 && overflow.body <= viewport.width + 1, JSON.stringify(overflow));
      run.visibility = overflow;
      run.assistanceTotal = run.assistance.reduce((sum, entry) => sum + entry.count, 0);
      for (const proof of run.sourceReviewProofs) proof.sha256 = sha(await readFile(proof.file));
      run.status = 'PASS';
      console.log('PASS ' + run.case + ' / ' + language + ' / assists=' + run.assistanceTotal);
    } catch (error) {
      run.status = 'FAIL';
      run.failure = String(error.stack);
      await writeFile(path.join(directory, 'failure-body.txt'), await page.locator('body').innerText());
      await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true });
      throw error;
    } finally {
      await save(path.join(out, 'REPORT.partial.json'), report);
      await context.close();
    }
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error.stack);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await save(path.join(out, 'REPORT.json'), report);
  if (active && !active.isClosed()) await active.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log('P8 report: ' + path.join(out, 'REPORT.json'));
}
