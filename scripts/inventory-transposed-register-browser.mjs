// Real, local, built UI uploads. Synthetic originals only; no injected controls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import {
  openDomainWorkspace,
  openWorkspaceDisclosures,
  workspaceSource,
} from './domain-navigation-support.mjs';
import { stockCopy } from '../lib/i18n/inventory-register.ts';
import {
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  STOCK_VALUES,
} from '../lib/reconciliation/inventory-register.ts';
import { restoreStock } from '../lib/reconciliation/inventory-register-io.ts';
const root = path.resolve(import.meta.dirname, '..');
const outRoot =
  process.env.INV_MATRIX_BROWSER_DIR ?? path.join(root, 'work/inv1c/browser');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-'));
const sources = path.join(out, 'sources'),
  suite = path.join(root, 'audit/inventory-transposed-register');
const python = process.env.PYTHON ?? 'python3';
const independent = (file, args) =>
  execFileSync(python, ['-B', path.join(suite, file), ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
independent('generate.py', ['--output-dir', sources]);
const corpus = JSON.parse(
  await readFile(path.join(sources, 'corpus.json'), 'utf8'),
);
const oracle = JSON.parse(independent('oracle.py', ['--root', sources]));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dist = path.join(root, 'dist');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const file = path.resolve(
      dist,
      '.' +
        decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    assert.ok(file.startsWith(dist + path.sep));
    response.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
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
const errors = [],
  external = [],
  posts = [],
  results = [];
let browser, currentPage;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  for (const [id, lang] of [
    ['INV1C-P03', 'ar'],
    ['INV1C-P04', 'ar'],
    ['INV1C-P05', 'en'],
    ['INV1C-P06', 'en'],
    ['INV1C-N01', 'ar'],
    ['INV1C-N02', 'en'],
  ]) {
    const entry = corpus.cases.find((c) => c.id === id),
      truth = oracle.cases.find((c) => c.id === id);
    const dir = path.join(out, id + '-' + lang);
    await mkdir(dir);
    const ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    });
    ctx.setDefaultTimeout(60000);
    ctx.on('request', (r) => {
      if (
        !r.url().startsWith(origin + '/') &&
        !r.url().startsWith('blob:') &&
        !r.url().startsWith('data:')
      )
        external.push(r.url());
      if (r.method() === 'POST') posts.push(r.url());
    });
    const page = (currentPage = await ctx.newPage());
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      globalThis.invMatrixReplies = [];
      globalThis.Worker = new Proxy(Worker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args);
          worker.addEventListener('message', (e) => {
            if (e.data?.action?.startsWith('stock-'))
              globalThis.invMatrixReplies.push(e.data);
          });
          return worker;
        },
      });
    });
    await page.goto(origin);
    if (lang === 'en')
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
    const w = await openDomainWorkspace(page, 'stock');
    const t = stockCopy[lang],
      button = (name) => w.getByRole('button', { name, exact: true });
    const wait = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('[data-stock-workspace]')
            ?.getAttribute('aria-busy') === 'false',
      );
    const reply = () =>
      page.evaluate(
        () =>
          globalThis.invMatrixReplies
            .filter((r) => r.action === 'stock-reconcile' && r.ok)
            .at(-1)?.value,
      );
    const compare = async () => {
      assert.equal(await button(t.compare).isEnabled(), true);
      await button(t.compare).click();
      await wait();
      assert.equal(await w.getByRole('alert').count(), 0);
      return reply();
    };
    const download = async (name, file) => {
      const pending = page.waitForEvent('download');
      await button(name).click();
      await (await pending).saveAs(path.join(dir, file));
      await wait();
      assert.equal(await w.getByRole('alert').count(), 0);
    };
    for (const i of [0, 3, 1, 2]) {
      await openWorkspaceDisclosures(w);
      const input = w.getByLabel(t.roles[i], { exact: true });
      assert.equal(await input.isEnabled(), true);
      assert.equal(
        await input.getAttribute('accept'),
        i === 0 ? '.csv,.xlsx' : '.csv',
      );
      await input.setInputFiles(path.join(sources, entry.files[i]));
      await wait();
      assert.equal(await w.getByRole('alert').count(), 0);
      await workspaceSource(w, t.roles[i]).getByRole('checkbox').check();
    }
    await openWorkspaceDisclosures(w);
    const expectedScope = truth.sources[0].records[0].scope;
    for (const [i, key] of STOCK_FIELDS.entries())
      assert.equal(
        await w
          .getByLabel(t.scopePrefix + t.scope[key], { exact: true })
          .inputValue(),
        expectedScope[STOCK_SCOPE_HEADERS[i]],
        id + ': source-prefilled scope',
      );
    await w.getByLabel(t.scopeConfirm, { exact: true }).check();
    let fresh = await compare();
    assert.equal(fresh.result.financial, truth.financial);
    assert.equal(fresh.result.review, 'needs-review');
    assert.deepEqual(
      fresh.result.records[0].map((r) => [
        r.values[0],
        r.values[1],
        r.values[2],
        r.values[5],
        r.values[6],
      ]),
      truth.sources[0].records.map((r) => [
        r.raw['Item ID'],
        r.raw['Item dimensions'],
        r.quantityUnits,
        r.postedValueMinor,
        r.raw['Valuation reference'],
      ]),
    );
    // Same amount/text from a neighbour cannot replace actual field ownership.
    const records = fresh.result.matrixEvidence.bands.flatMap((b) => b.records);
    assert.equal(records.length, truth.sources[0].records.length);
    for (const [index, actual] of records.entries()) {
      const expected = truth.sources[0].records[index];
      const record = fresh.result.records[0][index];
      assert.equal(record.row, expected.sourceRow);
      assert.equal(record.column, expected.column);
      assert.deepEqual(JSON.parse(record.id), [
        'inventory-posted-register-gl-1',
        0,
        truth.sources[0].sha256,
        0,
        expected.sourceRow,
        expected.column,
      ]);
      assert.equal(actual.recordId, record.id);
      for (const field of STOCK_VALUES[0]) {
        for (const [kind, cite] of [
          ['value', expected.citations[field]],
          ['role', expected.roleCitations[field]],
        ]) {
          assert.deepEqual(actual.fields[field][kind], {
            sourceHash: truth.sources[0].sha256,
            sheet: 0,
            sheetName: truth.sources[0].sheetName,
            row: cite.row,
            column: cite.column,
            raw: cite.raw,
          });
        }
      }
    }
    await download(t.save, 'pending.json');
    await download(t.export, 'pending.xlsx');
    const pendingBytes = await readFile(path.join(dir, 'pending.json'));
    const session = JSON.parse(pendingBytes);
    assert.equal(session.readings[0].family, 'inventory-transposed-register-1');
    for (const [i, f] of session.files.entries()) {
      assert.equal(sha(Buffer.from(f.data, 'base64')), truth.sources[i].sha256);
      assert.ok(!Object.hasOwn(f, 'sheets'));
    }
    assert.deepEqual(
      (
        await restoreStock(
          pendingBytes.buffer.slice(
            pendingBytes.byteOffset,
            pendingBytes.byteOffset + pendingBytes.byteLength,
          ),
        )
      ).result,
      fresh.result,
    );
    const assistant = w.locator('[data-domain-evidence-assistant]');
    await assistant.locator('[data-evidence-question="amounts"]').click();
    await wait();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-domain-evidence-assistant]')
          ?.getAttribute('aria-busy') === 'false',
    );
    assert.ok(
      (await assistant.innerText()).includes(
        lang === 'ar'
          ? 'القيمة المدعومة بالخريطة والسياسة'
          : 'Value supported by mapping and policy',
      ),
    );
    if (truth.financial !== 'ready') {
      assert.deepEqual(fresh.result.totals, truth.totals);
      if (id === 'INV1C-N01') {
        assert.deepEqual(
          fresh.result.comparisons.map((c) => c.differenceMinor),
          [86655, -86655, 0, 0],
        );
      } else {
        assert.equal(fresh.result.totals.registerMinor, 333567);
        assert.equal(fresh.result.totals.glMinor, 667134);
        assert.equal(
          fresh.result.missing.filter((v) => v.startsWith('evidence:')).length,
          2,
        );
      }
      await w
        .getByLabel(t.reference, { exact: true })
        .fill('INV1C blocked synthetic approval');
      await w
        .getByLabel(t.note, { exact: true })
        .fill('Unproven/different evidence cannot be accepted');
      assert.equal(await button(t.accept).isEnabled(), false);
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'pending.xlsx'),
        '--case-dir',
        path.join(sources, 'cases', id),
      ]);
    } else {
      assert.deepEqual(fresh.result.totals, {
        registerMinor: 667134,
        glMinor: 667134,
      });
      assert.deepEqual(
        fresh.result.comparisons.map((c) => [
          c.account,
          c.dimensions,
          c.registerMinor,
          c.glMinor,
          c.differenceMinor,
        ]),
        [
          ['INV-RM', 'plant=P1;branch=10', 123456, 123456, 0],
          ['INV-RM', 'plant=P2;branch=20', 210111, 210111, 0],
          ['INV-PACK', 'plant=P1;branch=10', 333567, 333567, 0],
          ['INV-PACK', 'plant=P2;branch=20', 0, 0, 0],
        ],
      );
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'pending.xlsx'),
        '--case-dir',
        path.join(sources, 'cases', id),
      ]);
      await w.getByLabel(t.complete, { exact: true }).check();
      await w
        .getByLabel(t.completeReference, { exact: true })
        .fill('INV1C synthetic whole scope');
      await w
        .getByLabel(t.completeNote, { exact: true })
        .fill('Synthetic matrix attestation only');
      assert.equal(
        await w.locator('[data-stock-status]').count(),
        0,
        'changed completeness invalidates result',
      );
      fresh = await compare();
      await w
        .getByLabel(t.reference, { exact: true })
        .fill('INV1C synthetic approval');
      await w
        .getByLabel(t.note, { exact: true })
        .fill('Synthetic matrix review only');
      await button(t.accept).click();
      await wait();
      fresh = await reply();
      assert.equal(fresh.result.review, 'accepted');
      assert.deepEqual(fresh.state.events[0].memberIds, fresh.result.memberIds);
      assert.ok(fresh.result.memberIds.length > 30);
      await download(t.save, 'accepted.json');
      await download(t.export, 'accepted.xlsx');
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'accepted.xlsx'),
        '--case-dir',
        path.join(sources, 'cases', id),
        '--accepted',
        '--session',
        path.join(dir, 'accepted.json'),
      ]);
      await button(t.undo).click();
      await wait();
      assert.equal((await reply()).result.review, 'needs-review');
      await w
        .getByLabel(t.restore, { exact: true })
        .setInputFiles(path.join(dir, 'accepted.json'));
      await wait();
      assert.equal(
        await w.locator('[data-stock-status]').innerText(),
        t.status['consistent-with-evidence'],
      );
      await download(t.export, 'restored.xlsx');
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'restored.xlsx'),
        '--case-dir',
        path.join(sources, 'cases', id),
        '--accepted',
        '--session',
        path.join(dir, 'accepted.json'),
      ]);
    }
    // Return to the normal collapsed evidence view using real summary controls.
    for (const disclosure of (
      await w.locator('details[data-workspace-advanced][open]').all()
    ).reverse()) {
      if (await disclosure.isVisible())
        await disclosure.locator(':scope > summary').click();
    }
    await w.screenshot({ path: path.join(dir, 'workspace.png') });
    await page.screenshot({
      path: path.join(dir, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'mobile bounds',
    );
    await page.screenshot({
      path: path.join(dir, 'mobile.png'),
      fullPage: true,
    });
    const workerFailures = await page.evaluate(() =>
      globalThis.invMatrixReplies
        .filter((r) => !r.ok)
        .map((r) => ({ action: r.action, error: r.error })),
    );
    assert.deepEqual(workerFailures, []);
    results.push({
      id,
      lang,
      container: entry.container,
      financial: truth.financial,
      exactFinancialProof: true,
      literalValueRoleColumnBandCitations: true,
      originalSessionBytes: true,
      acceptance: truth.financial === 'ready',
      workerFailures,
    });
    await ctx.close();
    currentPage = undefined;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(posts, []);
  await writeFile(
    path.join(out, 'checks.json'),
    JSON.stringify({ results, errors, external, posts }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ out, results, errors, external, posts }));
} catch (error) {
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        errors,
        external,
        posts,
        body: currentPage ? await currentPage.locator('body').innerText() : '',
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
