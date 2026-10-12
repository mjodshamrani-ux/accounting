import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
assert(process.argv.slice(2).every((x) => x === '--quick'));
const quick = process.argv.includes('--quick');
const fixtures = path.join(root, 'audit/ar-scope-details/fixtures');
const truths = JSON.parse(
  await readFile(path.join(fixtures, 'TRUTHS.json'), 'utf8'),
);
const outputParent = path.resolve(
  process.env.AR_SCOPE_BROWSER_DIR ?? '../evidence/browser',
);
await mkdir(outputParent, { recursive: true });
const output = await mkdtemp(path.join(outputParent, 'attempt-'));
const dist = path.join(root, 'dist');
const version = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
).version;
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(
      dist,
      '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)),
    );
    assert(file.startsWith(dist + path.sep));
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const names = [
  'three-document-kinds',
  'same-open-different-original',
  'late-invalid-competitor',
  'wrong-customer',
  'missing-original',
  'missing-parent',
  'duplicate-own-document',
  'empty-source-review',
  'native-inline-three-kinds',
  'native-shared-three-kinds',
  'mixed-new-canonical',
  'blanks-and-multiline-description',
  'jpy-invoice-credit',
  'kwd-three-decimal',
  'detail-column-order',
  'map-open-as-original',
];
const cases = [],
  artifacts = [],
  errors = [],
  external = [],
  nonGet = [],
  lifecycle = [];
let activePage;
let passed = false;
const index = () => ({
  schema: 'ar-scope-details-browser-evidence-1',
  quick,
  syntheticOnly: true,
  fieldOriginals: 0,
  passed,
  fixtures: path.relative(output, fixtures),
  cases,
  artifacts,
  lifecycle,
  errors,
  external,
  nonGet,
  viewportsSimulated: true,
});
try {
  for (const lang of quick ? ['ar'] : ['ar', 'en'])
    for (const width of quick ? [1440] : [1440, 390, 320]) {
      const copy = (lang === 'ar' ? ar : en).arDocuments;
      const dir = path.join(output, `${lang}-${width}`);
      await mkdir(dir, { recursive: true });
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        acceptDownloads: true,
      });
      context.setDefaultTimeout(30000);
      await context.route('**/*', (route) => {
        const request = route.request();
        if (request.method() !== 'GET') nonGet.push(request.url());
        if (
          request.url().startsWith(origin + '/') ||
          request.url().startsWith('blob:') ||
          request.url().startsWith('data:')
        )
          return route.continue();
        external.push(request.url());
        return route.abort();
      });
      await context.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.__arWorkerCount = 0;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            window.__arWorkerCount++;
            this.addEventListener('message', (event) => {
              if (
                window.__arDelay &&
                event.data?.action === 'ar-reconcile' &&
                event.data?.ok
              ) {
                window.__arDelay = false;
                window.__arDelayCaptured = true;
                event.stopImmediatePropagation();
                setTimeout(
                  () =>
                    this.dispatchEvent(
                      new MessageEvent('message', { data: event.data }),
                    ),
                  1500,
                );
              }
            });
          }
        };
      });
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', (error) =>
        errors.push({ lang, width, message: error.message }),
      );
      await page.goto(origin);
      if (lang === 'en')
        await page
          .getByRole('button', { name: 'EN English', exact: true })
          .click();
      assert.equal(
        (await page.locator('footer.footnote').innerText())
          .trim()
          .split('·')
          .at(-1)
          .trim(),
        version,
      );
      await openDomainWorkspace(page, 'ar');
      const w = page.locator('[data-ar-workspace]');
      const button = (name) => w.getByRole('button', { name, exact: true });
      const wait = () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('[data-ar-workspace]')
              ?.getAttribute('aria-busy') === 'false',
        );
      const metric = async (label) =>
        w
          .getByTestId('ar-metrics')
          .locator('div')
          .filter({ has: page.locator('span', { hasText: label }) })
          .locator('strong')
          .innerText();
      const download = async (name, file) => {
        const pending = page.waitForEvent('download');
        await button(name).click();
        await (await pending).saveAs(file);
        await wait();
      };
      const pair = async (name, phase, bundle, expectedMatched) => {
        const workbook = path.join(dir, `${name}-${phase}.xlsx`),
          session = path.join(dir, `${name}-${phase}.json`);
        await download(copy.export, workbook);
        await download(copy.save, session);
        artifacts.push({
          case: name,
          phase,
          lang,
          width,
          bundle: path.relative(output, bundle),
          workbook: path.relative(output, workbook),
          session: path.relative(output, session),
          workbookSHA256: await hash(workbook),
          sessionSHA256: await hash(session),
          expectedMatched,
        });
        return session;
      };
      const load = async (name) => {
        const folder = path.join(fixtures, name),
          bundleFile = path.join(folder, 'bundle.json');
        const bundle = JSON.parse(await readFile(bundleFile, 'utf8'));
        for (const side of [0, 1]) {
          await w
            .getByTestId(`ar-source-${side}`)
            .locator('input[type="file"]')
            .setInputFiles(path.join(folder, bundle.files[side]));
          await wait();
          const source = w.getByTestId(`ar-source-${side}`);
          await source
            .getByLabel(`${copy.sides[side]}: ${copy.family}`, { exact: true })
            .selectOption(bundle.families[side]);
          if (bundle.families[side] === 'ar-limited-1') {
            for (const [position, field] of [
              'posting',
              'kind',
              'document',
              'date',
              'amount',
              'entity',
              'ledger',
              'customer',
              'account',
              'currency',
              'related',
              'description',
            ].entries())
              await source
                .getByLabel(`${copy.sides[side]}: ${copy.fields[field]}`, {
                  exact: true,
                })
                .selectOption(String(position));
          }
          if (bundle.selectedAmountHeaders?.[side] === 'Open balance')
            await source
              .getByLabel(`${copy.sides[side]}: ${copy.fields.amount}`, {
                exact: true,
              })
              .selectOption('7');
          await source.getByRole('checkbox').check();
        }
        for (const field of [
          'entity',
          'ledger',
          'customer',
          'account',
          'currency',
          'start',
          'end',
        ])
          await w
            .getByLabel(
              field === 'start' || field === 'end'
                ? copy[field]
                : copy.fields[field],
              { exact: true },
            )
            .fill(bundle.scope[field]);
        await w.getByLabel(copy.scopeConfirm, { exact: true }).check();
        await button(copy.run).click();
        await wait();
        assert.equal(
          await w.getByRole('alert').count(),
          0,
          `${lang}/${width}/${name}`,
        );
        const truth = truths[name].expected;
        assert.equal(
          Number(await metric(copy.matched)),
          truth.matchedPairCount,
          name,
        );
        if (truth.validRowCounts)
          assert.equal(
            Number(await metric(copy.valid)),
            truth.validRowCounts.reduce((a, b) => a + b),
            name,
          );
        if (truth.status === 'source-error')
          assert(await w.locator('[data-ar-status]').isVisible());
        const overflow = await w.evaluate(
          (element) =>
            element.getBoundingClientRect().width > innerWidth + 1 ||
            document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(overflow, false, `${lang}/${width}/${name} overflow`);
        cases.push({
          name,
          lang,
          width,
          expectedStatus: truth.status,
          matched: truth.matchedPairCount,
          passed: true,
        });
        return bundleFile;
      };
      for (const name of quick ? names.slice(0, 3) : names) {
        const bundle = await load(name);
        await pair(
          name,
          'direct',
          bundle,
          truths[name].expected.matchedPairCount,
        );
        if (name === 'three-document-kinds') {
          await w
            .getByLabel(copy.note, { exact: true })
            .fill('Synthetic independent document review');
          await w
            .getByTestId('ar-case')
            .first()
            .getByRole('button', { name: copy.reopen, exact: true })
            .click();
          await wait();
          assert.equal(Number(await metric(copy.matched)), 2);
          const reopened = await pair(name, 'reopened', bundle, 2);
          await w
            .locator('input[type="file"][accept=".json"]')
            .setInputFiles(reopened);
          await wait();
          assert.equal(Number(await metric(copy.matched)), 2);
          await w
            .getByLabel(copy.note, { exact: true })
            .fill('Synthetic explicit document confirmation');
          await w
            .getByTestId('ar-case')
            .first()
            .getByRole('button', { name: copy.accept, exact: true })
            .click();
          await wait();
          assert.equal(Number(await metric(copy.matched)), 3);
          const accepted = await pair(name, 'accepted', bundle, 3);
          await w
            .locator('input[type="file"][accept=".json"]')
            .setInputFiles(accepted);
          await wait();
          assert.equal(Number(await metric(copy.matched)), 3);
          await pair(name, 'restored', bundle, 3);
          const before = await w.getByTestId('ar-metrics').innerText();
          const workers = await page.evaluate(() => window.__arWorkerCount);
          await page.evaluate(() => {
            window.__arDelay = true;
            window.__arDelayCaptured = false;
          });
          await button(copy.run).click();
          await page.waitForFunction(() => window.__arDelayCaptured);
          await button(copy.cancel).click();
          await wait();
          await page.waitForTimeout(1700);
          assert.equal(await w.getByTestId('ar-metrics').innerText(), before);
          await button(copy.run).click();
          await wait();
          assert.equal(await w.getByTestId('ar-metrics').innerText(), before);
          assert((await page.evaluate(() => window.__arWorkerCount)) > workers);
          lifecycle.push({
            lang,
            width,
            reopenAcceptRestore: true,
            cancelLateReplyRetainedState: true,
            newWorkerRetry: true,
          });
        }
        if (name === 'native-inline-three-kinds' || name === 'missing-parent')
          await page.screenshot({
            path: path.join(dir, name + '.png'),
            fullPage: true,
          });
      }
      await w
        .getByTestId('ar-source-0')
        .getByLabel(`${copy.sides[0]}: ${copy.family}`, { exact: true })
        .focus();
      assert.equal(
        await w
          .getByTestId('ar-source-0')
          .getByLabel(`${copy.sides[0]}: ${copy.family}`, { exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await button(copy.sample).click();
      await wait();
      assert.equal(Number(await metric(copy.matched)), 3);
      assert.equal(
        await w
          .getByTestId('ar-source-0')
          .getByLabel(`${copy.sides[0]}: ${copy.family}`, { exact: true })
          .inputValue(),
        'ar-limited-1',
      );
      lifecycle.push({
        lang,
        width,
        legacyDemoPreserved: true,
        familyKeyboardFocus: true,
      });
      await context.close();
      activePage = undefined;
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(nonGet, []);
  passed = true;
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({ path: path.join(output, 'FAILURE.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, 'FAILURE.html'),
      await activePage.content().catch(() => ''),
    );
  }
  await writeFile(
    path.join(output, 'FAILURE.json'),
    JSON.stringify({ message: String(error), stack: error.stack }, null, 2),
  );
  throw error;
} finally {
  const indexPath = path.join(output, 'evidence-index.json');
  await writeFile(indexPath, JSON.stringify(index(), null, 2));
  await writeFile(
    path.join(outputParent, 'LATEST.json'),
    JSON.stringify(
      {
        attempt: path.basename(output),
        passed,
        indexSHA256: await hash(indexPath),
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify({
      passed,
      quick,
      output,
      contexts: quick ? 1 : 6,
      cases: cases.length,
      artifactPairs: artifacts.length,
      lifecycle: lifecycle.length,
    }),
  );
}
