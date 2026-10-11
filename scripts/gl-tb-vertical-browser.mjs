import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { revealDomainEntry } from './domain-navigation-support.mjs';

// Expectations are authored by the independent Python CSV/Decimal oracle.
// No reconciliation implementation is imported into this browser proof.
assert(
  process.argv.slice(2).every((argument) => argument === '--routed-assets'),
);
const routedAssets = process.argv.includes('--routed-assets');
const baseRoot = path.resolve(
  process.env.GL_TB_VERTICAL_BROWSER_DIR || '../evidence/vertical-browser',
);
await mkdir(baseRoot, { recursive: true });
const out = await mkdtemp(path.join(baseRoot, 'attempt-'));
const proof = path.resolve(
  process.env.GL_TB_VERTICAL_PROOF_DIR || '../evidence/proof',
);
const expected = JSON.parse(
  await readFile(path.join(proof, 'source-expectations.json'), 'utf8'),
);
assert.equal(expected.independent, true);
assert.equal(expected.productImports, false);
const ids = [
  'P01-two-sided-six-components',
  'P04-zero-period-must-exist',
  'P05-role-column-permutation',
  'N01-missing-zero-period',
  'N02-identical-period-duplicate',
  'N08-empty-credit-not-zero',
  'N16-tb-bridge-broken',
  'N17-equal-net-hidden-gross-difference',
  'N20-gl-bridge-independent',
];
const fixtures = path.resolve('tests/fixtures/gl-tb-vertical');
const dist = await realpath(path.resolve('dist'));
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const report = {
  syntheticOnly: true,
  expectedFromProduct: false,
  attempt: out,
  transport: routedAssets
    ? 'playwright-pinned-dist-route'
    : 'local-http-server',
  realHttpTransportTested: !routedAssets,
  transportLimitations: routedAssets
    ? [
        'HTTP server binding, socket transport and response headers are not tested. Built HTML and its CSP are fulfilled byte-for-byte; browser security is enabled.',
      ]
    : [],
  priorHttpApprovalBlocker: JSON.parse(
    await readFile(path.join(baseRoot, 'BLOCKER.json'), 'utf8').catch(
      () => 'null',
    ),
  ),
  routedAssetRequests: 0,
  routedAssets: {},
  cases: [],
  lifecycle: [],
  pageErrors: [],
  externalRequests: [],
  nonGetRequests: [],
  failedRequests: [],
  passed: false,
};
const save = () =>
  writeFile(
    path.join(out, 'BROWSER-PROOF.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
let server, browser, activePage;
async function asset(url) {
  const pathname = new URL(url, 'http://local').pathname.replace(
    /^\/mizan-test\//,
    '/',
  );
  const file = await realpath(
    path.resolve(
      dist,
      '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)),
    ),
  );
  if (!file.startsWith(dist + path.sep))
    throw Error('Asset escapes pinned dist root');
  return {
    body: await readFile(file),
    contentType:
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.ico': 'image/x-icon',
        '.wasm': 'application/wasm',
      }[path.extname(file)] || 'application/octet-stream',
    relativePath: path.relative(dist, file),
  };
}
async function idle(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('main.gl-tb-workspace')?.getAttribute('aria-busy') ===
      'false',
  );
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function obtain(page, name, dest) {
  const pending = page.waitForEvent('download');
  await button(page, name).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  await download.saveAs(dest);
  await idle(page);
  return {
    suggestedFilename: download.suggestedFilename(),
    sha256: sha(await readFile(dest)),
  };
}
async function noOutput(page, t) {
  assert.equal(await page.getByTestId('gl-tb-result').count(), 0);
  assert.equal(await button(page, t.export).count(), 0);
  assert.equal(await button(page, t.save).count(), 0);
}
async function compare(page, t) {
  await button(page, t.compare).click();
  await idle(page);
  await page.getByTestId('gl-tb-result').waitFor();
}
async function upload(page, t, id, format, facts) {
  for (const side of [0, 1]) {
    const filename = side ? 'tb-vertical' : 'gl';
    const file =
      format === 'csv'
        ? path.join(fixtures, id, filename + '.csv')
        : path.join(proof, id, 'native', filename + '.xlsx');
    await page.getByLabel(t.sides[side], { exact: true }).setInputFiles(file);
    await idle(page);
    await page
      .getByTestId(`gl-tb-source-${side}`)
      .getByRole('heading', { name: path.basename(file), exact: true })
      .waitFor();
  }
  const family = page.getByTestId('gl-tb-family');
  await family.focus();
  assert.equal(
    await family.evaluate((el) => el === document.activeElement),
    true,
  );
  await family.selectOption('GL_TB_VERTICAL_BALANCES_V1');
  for (const side of [0, 1])
    await page
      .getByLabel(`${t.sides[side]}: ${t.sourceConfirm}`, { exact: true })
      .check();
  for (const [key, value] of Object.entries(facts.scope)) {
    if (key === 'confirmed') continue;
    const control = page.getByLabel(t.fields[key], { exact: true });
    if ((await control.evaluate((el) => el.tagName)) === 'SELECT')
      await control.selectOption(value);
    else await control.fill(value);
  }
  await page.getByLabel(t.scopeConfirm, { exact: true }).check();
  await compare(page, t);
}
function assertGeometry(width, dimensions) {
  assert(
    dimensions.viewport === width && dimensions.visible === true && dimensions.visiblePanels === 1 &&
      dimensions.panel > 0 && dimensions.panelHeight > 0 &&
      dimensions.document <= width + 1 &&
      dimensions.body <= width + 1 &&
      dimensions.panel <= width + 1,
    JSON.stringify({ width, ...dimensions }),
  );
}
async function measure(page, directory, phase, capture) {
  const measurements = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const panel = page.locator('main.gl-tb-workspace:visible');
    await panel.waitFor({ state: 'visible' });
    assert.equal(await panel.count(), 1, 'one visible native GL-TB workspace');
    const dimensions = await page.evaluate((element) => ({
      viewport: window.innerWidth,
      panelTag: element.tagName,
      panelClass: element.getAttribute('class'),
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      panel: element.getBoundingClientRect().width,
      panelHeight: element.getBoundingClientRect().height,
    }), await panel.elementHandle());
    Object.assign(dimensions, { visiblePanels: await panel.count(), visible: await panel.isVisible(), selector: 'main.gl-tb-workspace:visible' });
    assertGeometry(width, dimensions);
    if (capture)
      await page.screenshot({
        path: path.join(directory, `${phase}-${width}.png`),
        fullPage: true,
      });
    measurements.push({ width, ...dimensions });
  }
  return measurements;
}
async function evidence(page, t, facts) {
  assert.equal(
    await page.getByTestId('gl-tb-status').innerText(),
    t.status[facts.requiredStatus],
  );
  const inventory = await page
    .getByTestId('gl-tb-inventory')
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        side: row.querySelector('td').textContent,
        row: row.querySelectorAll('td')[1].textContent,
        values: JSON.parse(row.querySelector('pre').textContent),
      })),
    );
  assert.deepEqual(
    inventory,
    ['gl', 'tb'].flatMap((key, side) =>
      facts.inventory[key].map((values, i) => ({
        side: t.sides[side],
        row: String(i + 1),
        values,
      })),
    ),
  );
  const cards = page.getByTestId('gl-tb-role-evidence').locator('article');
  assert.equal(await cards.count(), 3);
  if (
    facts.financialExpectationsApplicable ||
    facts.requiredStatus === 'missing'
  ) {
    const header = facts.inventory.tb[0];
    for (const [index, role] of ['opening', 'period', 'closing'].entries()) {
      const rowIndex = facts.inventory.tb.findIndex(
        (row, i) =>
          i > 0 && row[header.indexOf('Balance role')]?.trim() === role,
      );
      const card = cards.nth(index);
      assert.equal(await card.getByRole('heading').innerText(), t.kinds[role]);
      if (rowIndex < 0) {
        assert((await card.innerText()).includes(t.missing));
        continue;
      }
      const row = facts.inventory.tb[rowIndex];
      assert.deepEqual(await card.locator('p bdi').allTextContents(), [
        row[header.indexOf('Snapshot ID')].trim(),
        String(rowIndex + 1),
      ]);
      assert.deepEqual(await card.locator('dd bdi').allTextContents(), [
        row[header.indexOf('Debit')],
        row[header.indexOf('Credit')],
      ]);
      assert.deepEqual(
        await card.locator('dd small').allTextContents(),
        ['Debit', 'Credit'].map(
          (key) => `${t.column} ${header.indexOf(key) + 1}`,
        ),
      );
    }
  }
  if (facts.financialExpectationsApplicable) {
    const format = (minor) => {
      const value = (Number(minor) / 10 ** facts.decimals).toFixed(
        facts.decimals,
      );
      const [integer, fraction] = value.split('.');
      return (
        integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
        (fraction === undefined ? '' : '.' + fraction)
      );
    };
    const fields = [
      'openingDebit',
      'openingCredit',
      'periodDebit',
      'periodCredit',
      'closingDebit',
      'closingCredit',
    ];
    assert.deepEqual(
      await page
        .getByTestId('gl-tb-balances')
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) =>
            [...row.querySelectorAll('td')].map((td) => td.textContent),
          ),
        ),
      fields.map((key) => [
        format(facts.glComponentsMinor[key]),
        format(facts.tbAuthoredComponentsMinor[key]),
        format(facts.componentDifferencesMinor[key]),
      ]),
    );
  }
  const summary = page
    .getByTestId('gl-tb-inventory')
    .locator('summary')
    .first();
  await summary.focus();
  await summary.press('Enter');
  assert.equal(await summary.evaluate((el) => el.parentElement.open), true);
  await summary.press('Enter');
}
function independentlyCheck(directory, id, format) {
  const script =
    "import importlib.util,json,pathlib,sys,base64,hashlib; spec=importlib.util.spec_from_file_location('check',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); case=next(c for c in json.loads(pathlib.Path(sys.argv[2]).read_text())['cases'] if c['id']==sys.argv[3]); p=pathlib.Path(sys.argv[4]); fmt=sys.argv[5]; results=[m.check_export(p/name,case,fmt) for name in ['direct.xlsx','restored.xlsx']]; session=m.check_session(p/'session.json',case,fmt); (p/'independent-check.json').write_text(json.dumps({'passed':True,'exports':results,'sessionFamilyAndOriginalBytesVerified':True,'session':session},indent=2))";
  execFileSync(
    'python3',
    [
      '-c',
      script,
      path.resolve('scripts/check-gl-tb-vertical-exports.py'),
      path.join(proof, 'source-expectations.json'),
      id,
      directory,
      format,
    ],
    { stdio: 'pipe' },
  );
}
try {
  let origin = 'http://127.0.0.1';
  if (!routedAssets) {
    server = createServer(async (req, res) => {
      try {
        const response = await asset(req.url);
        res.setHeader('Content-Type', response.contentType);
        res.end(response.body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await chromium.launch({
    headless: true,
    ...(routedAssets ? { chromiumSandbox: true } : {}),
    executablePath:
      process.env.MIZAN_CHROMIUM ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  report.browser = browser.version();
  report.distIndexSha256 = sha(await readFile(path.join(dist, 'index.html')));
  for (const lang of ['ar', 'en'])
    for (const id of ids)
      for (const format of ['csv', 'xlsx']) {
        const facts = expected.cases.find((c) => c.id === id).facts;
        const t = (lang === 'ar' ? ar : en).glTb;
        const directory = path.join(out, lang, id, format);
        await mkdir(directory, { recursive: true });
        const observation = { lang, id, format, passed: false };
        report.cases.push(observation);
        const context = await browser.newContext({
          acceptDownloads: true,
          viewport: { width: 1440, height: 1000 },
          serviceWorkers: 'block',
        });
        await context.addInitScript(() => {
          window.__verticalStorageWrites = [];
          window.__verticalWorkerActions = [];
          window.__verticalWorkerRequests = [];
          window.__verticalWorkerReplies = [];
          window.__verticalWorkerTerminations = 0;
          const watched = new WeakSet();
          const postMessage = Reflect.get(Worker.prototype, 'postMessage');
          Worker.prototype.postMessage = function (message, ...options) {
            if (!watched.has(this)) {
              watched.add(this);
              this.addEventListener('message', ({ data }) => {
                if (
                  data?.channel === 'mizan-accounting-v1' &&
                  typeof data.ok === 'boolean'
                )
                  window.__verticalWorkerReplies.push({
                    id: data.id,
                    action: data.action,
                    ok: data.ok,
                    error: data.error,
                  });
              });
            }
            window.__verticalWorkerActions.push(message.action);
            if (message?.channel === 'mizan-accounting-v1')
              window.__verticalWorkerRequests.push({
                id: message.id,
                action: message.action,
              });
            return Reflect.apply(postMessage, this, [message, ...options]);
          };
          const terminate = Reflect.get(Worker.prototype, 'terminate');
          Worker.prototype.terminate = function () {
            window.__verticalWorkerTerminations++;
            return Reflect.apply(terminate, this, []);
          };
          const setItem = Reflect.get(Storage.prototype, 'setItem');
          Storage.prototype.setItem = function (key, value) {
            window.__verticalStorageWrites.push({ key, value });
            return setItem.call(this, key, value);
          };
        });
        await context.route('**/*', async (route) => {
          const request = route.request();
          if (
            !request.url().startsWith(origin + '/') &&
            !request.url().startsWith('blob:') &&
            !request.url().startsWith('data:')
          ) {
            report.externalRequests.push(request.url());
            return route.abort();
          }
          if (request.method() !== 'GET')
            report.nonGetRequests.push({
              url: request.url(),
              method: request.method(),
            });
          if (routedAssets) {
            if (request.method() !== 'GET') return route.abort();
            if (
              request.url().startsWith('blob:') ||
              request.url().startsWith('data:')
            )
              return route.continue();
            try {
              const response = await asset(request.url());
              report.routedAssetRequests++;
              report.routedAssets[response.relativePath] = sha(response.body);
              return route.fulfill({
                status: 200,
                contentType: response.contentType,
                body: response.body,
              });
            } catch {
              return route.abort('failed');
            }
          }
          return route.continue();
        });
        const page = await context.newPage();
        activePage = page;
        const downloads = [];
        page.on('download', (download) =>
          downloads.push(download.suggestedFilename()),
        );
        page.on('pageerror', (error) =>
          report.pageErrors.push({ lang, id, format, error: error.message }),
        );
        page.on('requestfailed', (request) =>
          report.failedRequests.push({
            url: request.url(),
            error: request.failure()?.errorText,
          }),
        );
        await page.goto(`${origin}/mizan-test/`);
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[data-domain-entry]')].some(
            (el) => !el.disabled,
          ),
        );
        if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
          await page
            .locator(`.language-switch button[lang="${lang}"]:visible`)
            .first()
            .click();
        await revealDomainEntry(page, 'gl-tb');
        const entry = page.locator('[data-domain-entry="gl-tb"]');
        await entry.focus();
        await entry.press('Enter');
        await page
          .getByRole('heading', { name: t.title, exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole('heading', { name: t.title, exact: true })
            .evaluate((el) => document.activeElement === el),
          true,
        );
        await upload(page, t, id, format, facts);
        await evidence(page, t, facts);
        observation.measurements = await measure(
          page,
          directory,
          'result',
          id.startsWith('P01') || id.startsWith('P05'),
        );
        observation.downloads = [];
        for (const [label, filename] of [
          [t.export, 'direct.xlsx'],
          [t.save, 'session.json'],
        ])
          observation.downloads.push(
            await obtain(page, label, path.join(directory, filename)),
          );
        await page
          .getByLabel(t.restore, { exact: true })
          .setInputFiles(path.join(directory, 'session.json'));
        await idle(page);
        await evidence(page, t, facts);
        observation.downloads.push(
          await obtain(page, t.export, path.join(directory, 'restored.xlsx')),
        );
        independentlyCheck(directory, id, format);
        observation.independentExportsAndSessionVerified = true;
        if (id.startsWith('P01') && format === 'xlsx') {
          const multi = path.join(directory, 'two-native-sheets.xlsx');
          execFileSync('python3', [
            '-c',
            "import zipfile,sys; src=zipfile.ZipFile(sys.argv[1]); out=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); replacements={'xl/workbook.xml':('<sheets>','<sheets><sheet name=\"Second native\" sheetId=\"2\" r:id=\"rId2\"/>'),'xl/_rels/workbook.xml.rels':('</Relationships>','<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/></Relationships>'),'[Content_Types].xml':('</Types>','<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>')}; [out.writestr(n,src.read(n).decode().replace(*replacements[n]) if n in replacements else src.read(n)) for n in src.namelist()]; out.writestr('xl/worksheets/sheet2.xml',src.read('xl/worksheets/sheet1.xml')); out.close()",
            path.join(proof, id, 'native', 'tb-vertical.xlsx'),
            multi,
          ]);
          await page
            .getByLabel(t.sides[1], { exact: true })
            .setInputFiles(multi);
          await idle(page);
          await page
            .getByTestId('gl-tb-source-1')
            .getByRole('heading', { name: path.basename(multi), exact: true })
            .waitFor({ state: 'visible' });
          const sheetSelector = page.getByTestId('gl-tb-source-1').getByLabel(`${t.sides[1]}: ${t.sheet}`, { exact: false });
          assert.equal(await sheetSelector.count(), 1);
          await page.waitForFunction(
            (select) => select.options.length === 2,
            await sheetSelector.elementHandle(),
          );
          assert.equal(await sheetSelector.locator('option').count(), 2);
          await noOutput(page, t);
          await page
            .getByTestId('gl-tb-family')
            .selectOption('GL_TB_VERTICAL_BALANCES_V1');
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          await compare(page, t);
          await sheetSelector.selectOption('1');
          await page.waitForFunction(
            (input) => !input.checked,
            await page.getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true }).elementHandle(),
          );
          await noOutput(page, t);
          assert.equal(
            await page
              .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
              .isChecked(),
            false,
          );
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          await compare(page, t);
          await evidence(page, t, facts);
          report.lifecycle.push({
            lang,
            nativeSheetInvalidation: true,
            nativeReplacementInvalidation: true,
            secondSheetRecovery: true,
          });
        }
        if (id.startsWith('P01') && format === 'csv') {
          const other = lang === 'ar' ? 'en' : 'ar';
          await page
            .locator(`.language-switch button[lang="${other}"]:visible`)
            .first()
            .click();
          await evidence(page, (other === 'ar' ? ar : en).glTb, facts);
          await page
            .locator(`.language-switch button[lang="${lang}"]:visible`)
            .first()
            .click();
          await evidence(page, t, facts);
          const family = page.getByTestId('gl-tb-family');
          await family.selectOption('gl-tb-canonical-1');
          await noOutput(page, t);
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          const wrongFamilyStart = await page.evaluate(() => ({
            requests: window.__verticalWorkerRequests.length,
            replies: window.__verticalWorkerReplies.length,
          }));
          await button(page, t.compare).click();
          await idle(page);
          await page.getByRole('alert').waitFor();
          assert.equal(await page.getByRole('alert').innerText(), t.failure);
          await noOutput(page, t);
          const wrongFamily = await page.evaluate(
            (offset) => ({
              requests: window.__verticalWorkerRequests
                .slice(offset.requests)
                .filter((message) => message.action === 'gl-tb-reconcile'),
              replies: window.__verticalWorkerReplies
                .slice(offset.replies)
                .filter((message) => message.action === 'gl-tb-reconcile'),
            }),
            wrongFamilyStart,
          );
          assert.equal(wrongFamily.requests.length, 1);
          assert.deepEqual(
            wrongFamily.replies,
            [
              {
                id: wrongFamily.requests[0].id,
                action: 'gl-tb-reconcile',
                ok: false,
                error: 'GL_TB_COLUMNS',
              },
            ],
            'wrong family must cause native structural refusal for this request',
          );
          await family.selectOption('GL_TB_VERTICAL_BALANCES_V1');
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          await compare(page, t);
          await page.getByLabel(t.scopeConfirm, { exact: true }).uncheck();
          await noOutput(page, t);
          await page.getByLabel(t.scopeConfirm, { exact: true }).check();
          await compare(page, t);
          await page
            .getByLabel(t.fields.account, { exact: true })
            .fill('001101');
          await noOutput(page, t);
          await page
            .getByLabel(t.fields.account, { exact: true })
            .fill(facts.scope.account);
          await page.getByLabel(t.scopeConfirm, { exact: true }).check();
          await compare(page, t);
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .uncheck();
          await noOutput(page, t);
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          await compare(page, t);
          const cancelled = await page.evaluate(
            async (label) => {
              const before = window.__verticalWorkerActions.filter(
                (action) => action === 'gl-tb-reconcile',
              ).length;
              const terminations = window.__verticalWorkerTerminations;
              [...document.querySelector('main.gl-tb-workspace').querySelectorAll('button')]
                .find((el) => el.textContent.trim() === label.compare)
                .click();
              await new Promise((resolve) => setTimeout(resolve, 0));
              const control = [...document.querySelector('main.gl-tb-workspace').querySelectorAll('button')].find(
                (el) => el.textContent.trim() === label.cancel,
              );
              if (!control || !control.getClientRects().length)
                return {
                  cancelled: false,
                  submitted: false,
                  terminated: false,
                };
              const submitted =
                window.__verticalWorkerActions.filter(
                  (action) => action === 'gl-tb-reconcile',
                ).length > before;
              control.click();
              return {
                cancelled: true,
                submitted,
                terminated: window.__verticalWorkerTerminations > terminations,
              };
            },
            { compare: t.compare, cancel: t.cancel },
          );
          assert.deepEqual(
            cancelled,
            { cancelled: true, submitted: true, terminated: true },
            'actual in-flight worker cancellation observed',
          );
          await idle(page);
          await noOutput(page, t);
          await page
            .getByLabel(t.sides[1], { exact: true })
            .setInputFiles(path.join(fixtures, id, 'tb-vertical.csv'));
          await idle(page);
          await noOutput(page, t);
          await family.selectOption('GL_TB_VERTICAL_BALANCES_V1');
          await page
            .getByLabel(`${t.sides[1]}: ${t.sourceConfirm}`, { exact: true })
            .check();
          await compare(page, t);
          await evidence(page, t, facts);
          await button(page, t.sample).click();
          await idle(page);
          await page.getByTestId('gl-tb-role-evidence').waitFor({ state: 'hidden' });
          assert.equal(
            await page.getByTestId('gl-tb-status').innerText(),
            t.status.consistent,
          );
          assert.equal(
            await page.getByTestId('gl-tb-role-evidence').count(),
            0,
          );
          await button(page, t.sampleVertical).click();
          await idle(page);
          await page.getByTestId('gl-tb-role-evidence').waitFor({ state: 'visible' });
          await page.getByTestId('gl-tb-role-evidence').locator('article').first().waitFor({ state: 'visible' });
          assert.equal(
            await page
              .getByTestId('gl-tb-role-evidence')
              .locator('article')
              .count(),
            3,
          );
          report.lifecycle.push({
            lang,
            languageChangePreservesResult: true,
            wrongFamilyStructuralRefusal: true,
            wrongFamilyNativeReceipt: wrongFamily,
            familyInvalidation: true,
            scopeConfirmationInvalidation: true,
            scopeEditInvalidation: true,
            sourceConfirmationInvalidation: true,
            cancelledActualWorker: true,
            rereadRecovery: true,
            replacementInvalidation: true,
            horizontalDemoWorks: true,
            verticalDemoWorks: true,
          });
        }
        const storage = await page.evaluate(() => ({
          writes: window.__verticalStorageWrites,
          local: Object.entries(localStorage),
          session: Object.entries(sessionStorage),
        }));
        assert(
          storage.writes.every(
            ({ key, value }) =>
              !/source|session|file|snapshot|TB-SNAP|G-OPEN|data:|base64/i.test(
                key + value,
              ),
          ),
          'source/file data written to browser storage',
        );
        observation.storage = storage;
        observation.workerActions = await page.evaluate(
          () => window.__verticalWorkerActions,
        );
        for (const action of [
          'read',
          'gl-tb-reconcile',
          'gl-tb-save',
          'gl-tb-restore',
          'gl-tb-export',
        ])
          assert(
            observation.workerActions.includes(action),
            `real worker ${action} was not observed`,
          );
        assert.deepEqual(
          downloads,
          observation.downloads.map((download) => download.suggestedFilename),
        );
        observation.downloadModelVerified = true;
        observation.passed = true;
        await save();
        await context.close();
      }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.nonGetRequests, []);
  assert.deepEqual(report.failedRequests, []);
  assert.equal(report.cases.length, ids.length * 4);
  report.passed = true;
  await save();
  console.log(
    JSON.stringify({
      passed: true,
      cases: report.cases.length,
      exports: report.cases.length * 2,
      out,
    }),
  );
} catch (error) {
  report.failure = { message: String(error), stack: error.stack };
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
