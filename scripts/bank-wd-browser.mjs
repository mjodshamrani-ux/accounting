// Maintained actual-App browser gate. Synthetic frozen facts are the oracle;
// native Worker replies are observed, never replaced with fabricated results.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { revealDomainEntry } from './domain-navigation-support.mjs';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { readFile as readNativeFile } from '../lib/reconciliation/io.ts';

assert(
  process.argv.slice(2).every((arg) => arg === '--preflight'),
  'Only --preflight is supported; artifact/build/browser paths use environment variables.',
);
const preflight = process.argv.includes('--preflight');
const repo = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(
  process.env.MIZAN_DIST_DIR ?? path.join(repo, 'dist'),
);
const root = path.resolve(
  process.env.BANK_WD_BROWSER_DIR ??
    path.join(repo, '../evidence/bank-wd-browser'),
);
await mkdir(root, { recursive: true });
const out = await mkdtemp(path.join(root, 'attempt-'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const wdFamily = 'bank-withdrawal-deposit-1',
  canonicalFamily = 'bank-cash-movements-1';
const specs = [
  ['58-native-text-xlsx', false],
  ['59-native-numeric-xlsx', false],
  ['01-bank-wd-cash-canonical', false],
  ['02-bank-canonical-cash-wd', false],
  ['61-native-hidden-row', false],
  ['62-native-rounded-money', false],
  ['64-native-rounded-canonical-peer', false],
  ['66-isolated-native-canonical-peer', true],
];
const frozen = path.join(repo, 'audit/bank-withdrawal-deposit');
const report = {
  syntheticOnly: true,
  fieldAcceptance: false,
  expectedFromProduct: false,
  actualBrowser: false,
  passed: false,
  stage: 'preparing',
  out,
  startedAt: new Date().toISOString(),
  cases: [],
  cancellation: [],
  workerMessages: [],
  pageErrors: [],
  externalRequests: [],
  nonGetRequests: [],
  failedRequests: [],
};
const save = () =>
  writeFile(
    path.join(out, 'BROWSER-PROOF.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
let server, browser, activePage;
const fixtures = [];
const freeze = {
  truthOrigin:
    'Byte-exact precode frozen facts and native originals; signed amounts and statuses never derived from reconciliation output.',
  createdBeforeBrowserLaunch: true,
  sourceFiles: {},
  buildFiles: {},
  driverSHA256: sha(await readFile(import.meta.filename)),
  languages: ['ar', 'en'],
  viewportWidths: [1440, 390, 320],
  cases: [],
};
async function freezeFile(file) {
  const bytes = await readFile(file);
  freeze.sourceFiles[path.relative(repo, file)] = sha(bytes);
  return bytes;
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else
      freeze.buildFiles[path.relative(dist, file)] = sha(await readFile(file));
  }
}
function observeActualWorkers() {
  globalThis.bankWDWorkerMessages = [];
  globalThis.bankWDWorkerTerminations = 0;
  globalThis.bankWDTerminatedWorkerIds = [];
  const workerIds = new WeakMap();
  let serial = 0;
  const identity = (worker) => {
    if (!workerIds.has(worker)) workerIds.set(worker, ++serial);
    return workerIds.get(worker);
  };
  // Preserve the native receiver when forwarding the untouched request.
  // oxlint-disable-next-line typescript/unbound-method
  const post = Worker.prototype.postMessage;
  // oxlint-disable-next-line typescript/unbound-method
  const terminate = Worker.prototype.terminate;
  Worker.prototype.terminate = function (...args) {
    globalThis.bankWDWorkerTerminations++;
    globalThis.bankWDTerminatedWorkerIds.push(identity(this));
    return terminate.call(this, ...args);
  };
  const watched = new WeakSet();
  Worker.prototype.postMessage = function (message, ...args) {
    const workerId = identity(this);
    if (!watched.has(this)) {
      watched.add(this);
      this.addEventListener('message', ({ data }) => {
        if (
          data?.channel !== 'mizan-accounting-v1' ||
          typeof data.ok !== 'boolean'
        )
          return;
        globalThis.bankWDWorkerMessages.push({
          direction: 'reply',
          workerId,
          id: data.id,
          action: data.action,
          ok: data.ok,
          error: data.error,
          bytes:
            data.value instanceof ArrayBuffer
              ? data.value.byteLength
              : undefined,
          context: data.value?.result?.context,
          status: data.value?.result?.status,
          families: data.value?.state?.readings?.map((r) => r.family),
        });
      });
    }
    if (message?.channel === 'mizan-accounting-v1')
      globalThis.bankWDWorkerMessages.push({
        direction: 'request',
        workerId,
        id: message.id,
        action: message.action,
      });
    return post.call(this, message, ...args);
  };
}
const table = (panel, heading) =>
  panel
    .getByRole('heading', { name: heading, exact: true })
    .locator('..')
    .locator('table');
async function idle(page) {
  await page.waitForFunction(
    () =>
      document
        .querySelector('main.bank-workspace')
        ?.getAttribute('aria-busy') === 'false',
  );
}
async function obtain(page, button, directory, filename) {
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  const file = path.join(directory, filename);
  await download.saveAs(file);
  await idle(page);
  return {
    filename,
    suggestedFilename: download.suggestedFilename(),
    bytes: await readFile(file),
  };
}
function assertBankGeometry(width, sizes) {
  assert(
    sizes.viewport === width && sizes.visible === true && sizes.visiblePanels === 1 &&
      sizes.panel > 0 && sizes.panelHeight > 0 &&
      sizes.document <= width + 1 && sizes.body <= width + 1 && sizes.panel <= width + 1,
    JSON.stringify({ width, ...sizes }),
  );
}
async function responsive(page, directory, phase) {
  const measurements = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const panel = page.locator('main.bank-workspace:visible');
    await panel.waitFor({ state: 'visible' });
    const visiblePanels = await panel.count();
    assert.equal(visiblePanels, 1, 'one visible native bank workspace');
    const sizes = await page.evaluate((element) => ({
      viewport: window.innerWidth,
      panel: element.getBoundingClientRect().width,
      panelHeight: element.getBoundingClientRect().height,
      panelTag: element.tagName,
      panelClass: element.getAttribute('class'),
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }), await panel.elementHandle());
    Object.assign(sizes, { visiblePanels, visible: await panel.isVisible(), selector: 'main.bank-workspace:visible' });
    assertBankGeometry(width, sizes);
    await page.screenshot({
      path: path.join(directory, `${phase}-${width}.png`),
      fullPage: true,
    });
    measurements.push({ width, ...sizes });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return measurements;
}
async function setup(page, panel, t, fixture) {
  for (const side of [0, 1]) {
    const source = panel.getByTestId(`bank-source-${side}`),
      file = fixture.sources[side];
    await source.getByLabel(t.sides[side], { exact: true }).setInputFiles({
      name: file.uploadName,
      mimeType: file.name.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      buffer: file.bytes,
    });
    await source.getByText(file.uploadName, { exact: true }).waitFor();
    await idle(page);
    const family = source.getByLabel(`${t.sides[side]} ${t.sourceFamily}`, {
      exact: true,
    });
    assert.equal(
      await family.inputValue(),
      canonicalFamily,
      'Upload never guesses WD from filenames/amounts.',
    );
    const expected =
      fixture.facts.families[side] === 'wd' ? wdFamily : canonicalFamily;
    await family.focus();
    assert.equal(
      await family.evaluate((el) => document.activeElement === el),
      true,
    );
    await family.selectOption(expected);
    assert.equal(await family.inputValue(), expected);
    await source
      .getByLabel(`${t.sides[side]} ${t.sourceConfirm}`, { exact: true })
      .check();
  }
  for (const [key, label] of Object.entries(t.fields))
    await panel
      .getByLabel(label, { exact: true })
      .fill(fixture.facts.scope[key]);
  await panel.getByLabel(t.scopeConfirm, { exact: true }).check();
  const compare = panel.getByRole('button', { name: t.compare, exact: true });
  assert.equal(await compare.isEnabled(), true);
  await compare.focus();
  await page.keyboard.press('Enter');
  await idle(page);
}
function verifySession(bytes, fixture, expectedEvents) {
  const saved = JSON.parse(bytes.toString('utf8'));
  assert.equal(saved.format, 'tarasuf-bank-session');
  assert.equal(saved.version, canonicalFamily);
  assert.equal('result' in saved, false);
  assert.equal(saved.events.length, expectedEvents);
  assert.deepEqual(
    saved.readings.map((r) => r.family),
    fixture.facts.families.map((f) =>
      f === 'wd' ? wdFamily : canonicalFamily,
    ),
  );
  assert.deepEqual(saved.scope, fixture.facts.scope);
  for (const [side, f] of saved.files.entries()) {
    const original = fixture.sources[side];
    assert.equal(f.name, original.uploadName);
    assert.equal(f.sha256, original.sha256);
    assert.deepEqual(Buffer.from(f.data, 'base64'), original.bytes);
  }
  if (expectedEvents === 2) {
    assert.deepEqual(
      saved.events.map((e) => e.type),
      ['undo', 'accept'],
    );
    assert.deepEqual(saved.events[0].bankIds, saved.events[1].bankIds);
    assert.deepEqual(saved.events[0].cashIds, saved.events[1].cashIds);
    const first = saved.events[0];
    let settlement;
    for (const [side, memberKey] of [
      [0, 'bankIds'],
      [1, 'cashIds'],
    ]) {
      const source = fixture.sources[side],
        data = source.parsed.sheets[0].rows;
      const settlementColumn = data[0].indexOf('Settlement ID');
      const firstRow = Number(first[memberKey][0].split(':').at(-1));
      settlement ??= data[firstRow - 1][settlementColumn];
      const expectedIds = data
        .slice(1)
        .flatMap((row, index) =>
          row[settlementColumn] === settlement
            ? [`${side}:${source.sha256}:0:${index + 2}`]
            : [],
        );
      assert.deepEqual(
        [...first[memberKey]].sort((a, b) => a.localeCompare(b)),
        expectedIds.sort((a, b) => a.localeCompare(b)),
        'Review retains whole original source settlement membership.',
      );
    }
  }
  return saved;
}
async function verifyWorkbook(bytes, fixture, expectedEvents) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Uint8Array.from(bytes).buffer);
  const rows = (name) => {
    const s = book.getWorksheet(name);
    assert(s, `Missing ${name}`);
    return (
      s
        .getRows(2, Math.max(0, s.rowCount - 1))
        ?.map((r) => r.values.slice(1)) ?? []
    );
  };
  const reading = rows('Reading');
  assert.deepEqual(
    reading.map((r) => r[3]),
    fixture.facts.families.map((f) =>
      f === 'wd' ? wdFamily : canonicalFamily,
    ),
  );
  const summary = Object.fromEntries(rows('Summary'));
  assert.equal(summary.Status, fixture.facts.expected.status);
  const movement = rows('Movements');
  for (const side of [0, 1])
    assert.deepEqual(
      movement.filter((r) => r[1] === side).map((r) => r[14]),
      fixture.facts.expected.signedMinor[side],
    );
  const sources = rows('Sources');
  for (const side of [0, 1]) {
    const chunks = sources
      .filter((r) => r[0] === side)
      .sort((a, b) => a[3] - b[3]);
    assert(
      chunks.every(
        (r) =>
          r[1] === fixture.sources[side].uploadName &&
          r[2] === fixture.sources[side].sha256,
      ),
    );
    assert.deepEqual(
      Buffer.from(chunks.map((r) => r[4]).join(''), 'base64'),
      fixture.sources[side].bytes,
    );
  }
  const evidence = rows('Withdrawal Deposit evidence');
  const expectedCells = fixture.sources.flatMap((source, side) => {
    if (fixture.facts.families[side] !== 'wd') return [];
    const data = source.parsed.sheets[0].rows,
      headers = data[0];
    return data.slice(1).flatMap((values, offset) =>
      ['Withdrawal', 'Deposit'].map((field) => {
        const column = headers.indexOf(field);
        assert(column >= 0);
        return {
          side,
          row: offset + 2,
          field,
          column: column + 1,
          text: values[column],
        };
      }),
    );
  });
  assert.deepEqual(
    evidence.map((r) => ({
      side: r[1],
      row: r[4],
      field: r[5],
      column: r[6],
      text: String(r[7] ?? ''),
    })),
    expectedCells,
  );
  assert.equal(rows('Events').length, expectedEvents);
  assert(
    book
      .getWorksheet('Movements')
      .getRow(1)
      .values.includes('Calculated signed minor units'),
  );
  return {
    worksheets: book.worksheets.map((s) => s.name),
    movementRows: movement.length,
    withdrawalDepositCells: evidence.length,
    sourceBytesVerified: true,
    eventRows: expectedEvents,
  };
}
try {
  const manifestBytes = await freezeFile(
    path.join(frozen, 'frozen/INPUT-MANIFEST.json'),
  );
  const manifest = JSON.parse(manifestBytes).files;
  for (const [id, supplemental] of specs) {
    const folder = path.join(
      frozen,
      supplemental ? 'supplemental' : 'frozen',
      id,
    );
    const localManifest = supplemental
      ? JSON.parse(await freezeFile(path.join(folder, 'INPUT-MANIFEST.json')))
          .files
      : manifest;
    const factsPath = path.join(folder, 'facts.json'),
      factsBytes = await freezeFile(factsPath);
    const expectedFactHash = localManifest.find(
      (f) => f.path === (supplemental ? 'facts.json' : `${id}/facts.json`),
    );
    assert(
      expectedFactHash && sha(factsBytes) === expectedFactHash.sha256,
      `${id}: frozen facts`,
    );
    const facts = JSON.parse(factsBytes);
    assert.equal(facts.syntheticOnly, true);
    const sources = [];
    for (const [side, name] of facts.files.entries()) {
      const bytes = await freezeFile(path.join(folder, name));
      const expectedHash = localManifest.find(
        (f) => f.path === (supplemental ? name : `${id}/${name}`),
      );
      assert(
        expectedHash && sha(bytes) === expectedHash.sha256,
        `${id}/${name}: frozen original`,
      );
      const parsed = await readNativeFile(name, Uint8Array.from(bytes).buffer);
      sources.push({
        name,
        bytes,
        sha256: sha(bytes),
        parsed,
        uploadName: `${id}-${side}${path.extname(name)}`,
      });
    }
    fixtures.push({ id, facts, sources });
    freeze.cases.push({
      id,
      facts,
      sources: sources.map(({ parsed: _p, bytes: _b, ...v }) => v),
    });
  }
  await walk(dist);
  assert(
    freeze.buildFiles['index.html'],
    'Build dist before executing browser gate.',
  );
  await writeFile(
    path.join(out, 'freeze.json'),
    JSON.stringify(freeze, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(
    path.join(out, 'driver-snapshot.mjs'),
    await readFile(import.meta.filename),
    { flag: 'wx' },
  );
  report.stage = preflight ? 'prepared-not-executed' : 'launching';
  await save();
  if (preflight)
    console.log(
      JSON.stringify({
        out,
        prepared: true,
        actualBrowser: false,
        passed: false,
        cases: fixtures.length * 2,
      }),
    );
  else {
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://local').pathname;
        const file = path.resolve(
          dist,
          '.' + (pathname === '/' ? '/index.html' : pathname),
        );
        if (!file.startsWith(dist + path.sep)) throw Error('path');
        response.setHeader(
          'Content-Type',
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2',
          }[path.extname(file)] ?? 'application/octet-stream',
        );
        response.end(await readFile(file));
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.MIZAN_CHROMIUM,
    });
    report.actualBrowser = true;
    report.browser = browser.version();
    report.stage = 'executing';
    for (const lang of ['ar', 'en'])
      for (const fixture of fixtures) {
        const t = (lang === 'ar' ? ar : en).bank,
          directory = path.join(out, lang, fixture.id);
        await mkdir(directory, { recursive: true });
        for (const file of fixture.sources)
          await writeFile(path.join(directory, file.uploadName), file.bytes, {
            flag: 'wx',
          });
        const context = await browser.newContext({
          acceptDownloads: true,
          viewport: { width: 1440, height: 1000 },
          serviceWorkers: 'block',
        });
        await context.addInitScript(observeActualWorkers);
        await context.route('**/*', (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (['blob:', 'data:'].includes(url.protocol))
            return route.continue();
          if (url.origin !== origin) {
            report.externalRequests.push(url.href);
            return route.abort();
          }
          if (request.method() !== 'GET') {
            report.nonGetRequests.push({
              method: request.method(),
              url: url.href,
            });
            return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        activePage = page;
        page.on('pageerror', (error) =>
          report.pageErrors.push({
            lang,
            id: fixture.id,
            error: error.message,
          }),
        );
        page.on('requestfailed', (request) =>
          report.failedRequests.push({
            lang,
            id: fixture.id,
            url: request.url(),
            error: request.failure()?.errorText,
          }),
        );
        await page.goto(origin);
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
          await page
            .locator(`.language-switch button[lang="${lang}"]:visible`)
            .first()
            .click();
        await revealDomainEntry(page, 'bank');
        const entry = page.locator('[data-domain-entry="bank"]');
        await entry.waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-domain-entry="bank"]').disabled,
        );
        await entry.focus();
        await page.keyboard.press('Enter');
        const panel = page.locator('main.bank-workspace:visible').first();
        await panel
          .getByRole('heading', { name: t.title, exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.dir),
          lang === 'ar' ? 'rtl' : 'ltr',
        );
        await setup(page, panel, t, fixture);
        const observation = {
          lang,
          id: fixture.id,
          expected: fixture.facts.expected,
          passed: false,
        };
        report.cases.push(observation);
        if (fixture.facts.expected.status === 'structural-refusal') {
          assert.equal(await panel.getByTestId('bank-result').count(), 0);
          assert.equal(
            await panel.getByRole('alert').innerText(),
            t.displayFailed,
          );
          assert.equal(
            await panel
              .getByRole('button', { name: t.save, exact: true })
              .count(),
            0,
          );
          assert.equal(
            await panel
              .getByRole('button', { name: t.export, exact: true })
              .count(),
            0,
          );
          observation.refusedWithoutResultOrDownload = true;
          observation.measurements = await responsive(
            page,
            directory,
            'native-refusal',
          );
        } else {
          const status = panel.getByTestId('bank-result');
          await status.waitFor();
          assert.equal(
            await status.innerText(),
            t.status[fixture.facts.expected.status],
          );
          await panel
            .getByRole('button', { name: t.reviewCells, exact: true })
            .first()
            .click();
          const evidence = panel
            .getByRole('heading')
            .filter({ hasText: t.evidence })
            .locator('..')
            .locator('tbody tr');
          const visibleEvidence = await evidence.evaluateAll((rows) =>
            rows.map((r) =>
              [...r.querySelectorAll('td')].map((c) => c.textContent),
            ),
          );
          const wdSide = fixture.facts.families.findIndex((f) => f === 'wd');
          // Review the WD side explicitly; the first row may be the canonical peer.
          if (wdSide === 1)
            await table(panel, t.movements)
              .locator('tbody tr')
              .filter({ hasText: t.sides[1] })
              .first()
              .getByRole('button', { name: t.reviewCells, exact: true })
              .click();
          // Arabic translated field names are compared using the catalogue, not English literals.
          const wdEvidence = await evidence.evaluateAll((rows) =>
            rows.map((r) =>
              [...r.querySelectorAll('td')].map((c) => c.textContent),
            ),
          );
          assert(wdEvidence.some((r) => r[0] === t.sourceFields.Withdrawal));
          assert(wdEvidence.some((r) => r[0] === t.sourceFields.Deposit));
          const originalRows = fixture.sources[wdSide].parsed.sheets[0].rows;
          for (const field of ['Withdrawal', 'Deposit']) {
            const column = originalRows[0].indexOf(field),
              originalText = originalRows[1][column];
            const state =
              originalText === ''
                ? 'blank-inactive'
                : Number(originalText) === 0
                  ? 'explicit-zero-inactive'
                  : 'active';
            assert.deepEqual(
              wdEvidence.find((r) => r[0] === t.sourceFields[field]),
              [
                t.sourceFields[field],
                String(column + 1),
                originalText,
                t.cashCellStates[state],
              ],
              'UI retains each active/inactive money cell and its original source coordinate.',
            );
          }
          observation.cellEvidence = wdEvidence;
          observation.initialEvidenceRows = visibleEvidence.length;
          observation.measurements = await responsive(
            page,
            directory,
            'source-evidence',
          );
          await panel
            .getByLabel(t.reference, { exact: true })
            .fill('Synthetic frozen WD browser original');
          await panel
            .getByLabel(t.reason, { exact: true })
            .fill(
              'Complete source identity and both original money cells reviewed.',
            );
          await panel
            .getByRole('button', { name: t.undo, exact: true })
            .first()
            .click();
          await idle(page);
          assert.equal(await status.innerText(), t.status['needs-review']);
          await panel
            .getByRole('button', { name: t.approve, exact: true })
            .first()
            .click();
          await idle(page);
          assert.equal(
            await status.innerText(),
            t.status['movements-consistent'],
          );
          const direct = await obtain(
            page,
            panel.getByRole('button', { name: t.export, exact: true }),
            directory,
            'direct.xlsx',
          );
          observation.direct = {
            sha256: sha(direct.bytes),
            ...(await verifyWorkbook(direct.bytes, fixture, 2)),
          };
          const archive = await obtain(
            page,
            panel.getByRole('button', { name: t.save, exact: true }),
            directory,
            'session.json',
          );
          const session = verifySession(archive.bytes, fixture, 2);
          observation.sessionSHA256 = sha(archive.bytes);
          const family = panel
            .getByTestId(`bank-source-${wdSide}`)
            .getByLabel(`${t.sides[wdSide]} ${t.sourceFamily}`, {
              exact: true,
            });
          await family.selectOption(canonicalFamily);
          assert.equal(await panel.getByTestId('bank-result').count(), 0);
          assert.equal(
            await panel
              .getByTestId(`bank-source-${wdSide}`)
              .getByLabel(`${t.sides[wdSide]} ${t.sourceConfirm}`, {
                exact: true,
              })
              .isChecked(),
            false,
          );
          assert.equal(
            await panel
              .getByRole('button', { name: t.compare, exact: true })
              .isDisabled(),
            true,
          );
          observation.familyChangeClearsConfirmationAndResult = true;
          await panel
            .getByLabel(t.restore, { exact: true })
            .setInputFiles(path.join(directory, archive.filename));
          await idle(page);
          await status.waitFor();
          assert.equal(
            await status.innerText(),
            t.status['movements-consistent'],
          );
          for (const side of [0, 1])
            assert.equal(
              await panel
                .getByTestId(`bank-source-${side}`)
                .getByLabel(`${t.sides[side]} ${t.sourceFamily}`, {
                  exact: true,
                })
                .inputValue(),
              session.readings[side].family,
            );
          const restored = await obtain(
            page,
            panel.getByRole('button', { name: t.export, exact: true }),
            directory,
            'restored.xlsx',
          );
          observation.restored = {
            sha256: sha(restored.bytes),
            ...(await verifyWorkbook(restored.bytes, fixture, 2)),
          };
          observation.restoredMeasurements = await responsive(
            page,
            directory,
            'restored',
          );
          if (fixture.id === '58-native-text-xlsx') {
            // Invalidate the previous result through the actual scope control.
            await panel.getByLabel(t.scopeConfirm, { exact: true }).uncheck();
            await panel.getByLabel(t.scopeConfirm, { exact: true }).check();
            assert.equal(await panel.getByTestId('bank-result').count(), 0);
            const cancelled = await page.evaluate(
              async (labels) => {
                const requests = () =>
                  globalThis.bankWDWorkerMessages.filter(
                    (message) =>
                      message.direction === 'request' &&
                      message.action === 'bank-reconcile',
                  );
                const before = requests().length;
                const terminations = globalThis.bankWDWorkerTerminations;
                const buttons = () => [
                  ...document.querySelectorAll('main.bank-workspace button'),
                ];
                buttons()
                  .find(
                    (button) => button.textContent.trim() === labels.compare,
                  )
                  .click();
                await new Promise((resolve) => setTimeout(resolve, 0));
                const control = buttons().find(
                  (button) =>
                    button.textContent.trim() === labels.cancel &&
                    button.getClientRects().length,
                );
                const request = requests().at(-1);
                const submitted = requests().length > before;
                if (!control)
                  return { cancelled: false, submitted, terminated: false };
                control.click();
                return {
                  cancelled: true,
                  submitted,
                  terminated:
                    globalThis.bankWDWorkerTerminations > terminations &&
                    globalThis.bankWDTerminatedWorkerIds.includes(
                      request?.workerId,
                    ),
                  workerId: request?.workerId,
                  requestId: request?.id,
                };
              },
              { compare: t.compare, cancel: t.cancel },
            );
            assert.equal(
              cancelled.cancelled,
              true,
              'visible actual UI cancellation',
            );
            assert.equal(
              cancelled.submitted,
              true,
              'native reconcile request submitted',
            );
            assert.equal(
              cancelled.terminated,
              true,
              'requested native worker terminated',
            );
            await idle(page);
            assert.equal(await panel.getByTestId('bank-result').count(), 0);
            assert.equal(
              await panel
                .getByRole('button', { name: t.export, exact: true })
                .count(),
              0,
            );
            await page.waitForTimeout(100);
            assert.equal(
              await panel.getByTestId('bank-result').count(),
              0,
              'late reply cannot install a result',
            );
            assert.equal(
              await panel
                .getByRole('button', { name: t.export, exact: true })
                .count(),
              0,
            );
            const beforeRetry = await page.evaluate(
              () => globalThis.bankWDWorkerMessages.length,
            );
            await panel
              .getByRole('button', { name: t.compare, exact: true })
              .click();
            await idle(page);
            await status.waitFor();
            assert.equal(
              await status.innerText(),
              t.status['movements-consistent'],
            );
            const retry = await page.evaluate(
              (offset) => globalThis.bankWDWorkerMessages.slice(offset),
              beforeRetry,
            );
            const request = retry.find(
              (message) =>
                message.direction === 'request' &&
                message.action === 'bank-reconcile',
            );
            const reply = retry.find(
              (message) =>
                message.direction === 'reply' &&
                message.action === 'bank-reconcile' &&
                message.ok,
            );
            assert(request && reply, 'genuine successful native retry');
            assert.notEqual(
              request.workerId,
              cancelled.workerId,
              'retry uses a fresh native worker',
            );
            assert.equal(reply.workerId, request.workerId);
            assert.equal(reply.id, request.id);
            assert.equal(reply.status, 'movements-consistent');
            report.cancellation.push({
              lang,
              id: fixture.id,
              ...cancelled,
              lateResultAbsent: true,
              lateResultAbsentObservationMs: 100,
              exportAbsent: true,
              retryWorkerId: request.workerId,
              retryRequestId: request.id,
              retryStatus: reply.status,
            });
          }
        }
        const messages = await page.evaluate(
          () => globalThis.bankWDWorkerMessages,
        );
        const replies = messages.filter((m) => m.direction === 'reply');
        assert(
          replies.some(
            (m) =>
              m.action === 'bank-reconcile' &&
              m.ok === (fixture.facts.expected.status !== 'structural-refusal'),
          ),
        );
        if (fixture.facts.expected.status !== 'structural-refusal')
          for (const action of ['bank-save', 'bank-restore', 'bank-export'])
            assert(replies.some((m) => m.action === action && m.ok));
        observation.actualWorkerActions = replies;
        report.workerMessages.push({ lang, id: fixture.id, messages });
        observation.passed = true;
        await save();
        await context.close();
        activePage = null;
      }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.nonGetRequests, []);
    assert.deepEqual(report.failedRequests, []);
    assert.equal(report.cases.length, fixtures.length * 2);
    assert.deepEqual(
      report.cancellation.map((entry) => entry.lang),
      ['ar', 'en'],
    );
    report.passed = true;
    report.stage = 'passed';
    await save();
    console.log(
      JSON.stringify({
        out,
        passed: true,
        actualBrowser: true,
        cases: report.cases.length,
      }),
    );
  }
} catch (error) {
  report.failure = String(error);
  report.stage = preflight ? 'preflight-failed' : 'failed';
  await save();
  if (activePage && !activePage.isClosed()) {
    await activePage
      .screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(out, 'failure.txt'),
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
