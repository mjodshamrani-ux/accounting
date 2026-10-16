// Real, local, built UI uploads. Synthetic originals only; no injected controls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
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
} from '../lib/reconciliation/inventory-register.ts';
const root = path.resolve(import.meta.dirname, '..');
const outRoot =
  process.env.INV_COLUMN_BROWSER_DIR ??
  path.join(root, 'work/inv1e-engine/browser');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-'));
const sources = path.join(out, 'sources'),
  suite = path.join(root, 'audit/inventory-column-hierarchy');
const python = process.env.PYTHON ?? 'python3';
const independent = (file, args) =>
  execFileSync(python, ['-B', path.join(suite, file), ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
independent('generate.py', [
  '--output-dir',
  sources,
  '--include-layout-controls',
  '--negative-layout-controls',
]);
const corpus = JSON.parse(
  await readFile(path.join(sources, 'corpus.json'), 'utf8'),
);
const oracle = JSON.parse(independent('oracle.py', ['--root', sources]));
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
    ['INV1E-C01', 'ar'],
    ['INV1E-C04', 'ar'],
    ['INV1E-C03', 'en'],
    ['INV1E-C02', 'en'],
    ['INV1E-D01', 'ar'],
    ['INV1E-D14', 'en'],
    ['INV1E-D04', 'ar'],
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
      globalThis.invColumnReplies = [];
      globalThis.Worker = new Proxy(Worker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args);
          worker.addEventListener('message', (e) => {
            if (e.data?.action?.startsWith('stock-'))
              globalThis.invColumnReplies.push(e.data);
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
          globalThis.invColumnReplies
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
        i === 0 ? '.csv,.xlsx,.pdf' : '.csv',
      );
      await input.setInputFiles(path.join(sources, entry.files[i]));
      await wait();
      assert.equal(await w.getByRole('alert').count(), 0);
      await workspaceSource(w, t.roles[i]).getByRole('checkbox').check();
    }
    await openWorkspaceDisclosures(w);
    const expectedScope = oracle.cases.find((c) => c.id === 'INV1E-C01').scope;
    for (const [i, key] of STOCK_FIELDS.entries())
      assert.equal(
        await w
          .getByLabel(t.scopePrefix + t.scope[key], { exact: true })
          .inputValue(),
        expectedScope[STOCK_SCOPE_HEADERS[i]],
        id + ':prefilled scope',
      );
    await w.getByLabel(t.scopeConfirm, { exact: true }).check();
    let fresh = await compare();
    assert.equal(fresh.result.financial, truth.financial);
    const assistant = w.locator('[data-domain-evidence-assistant]');
    await assistant.locator('[data-evidence-question="sources"]').click();
    await assistant.locator('[data-evidence-answer="sources"]').waitFor();
    assert.deepEqual(
      await assistant.locator('[data-evidence-hash]').allTextContents(),
      fresh.state.files.map((f) => f.sha256),
    );

    if (truth.financial !== 'source-error') {
      assert.deepEqual(fresh.result.totals, truth.totals);
      assert.deepEqual(
        fresh.result.records[0].map((r) => r.values),
        truth.facts.map((r) => r.values),
      );
      assert.equal(fresh.result.columnEvidence.records.length, 6);
      for (const [n, e] of fresh.result.columnEvidence.records.entries()) {
        const f = truth.facts[n];
        assert.deepEqual(
          [e.parent.value.row, e.parent.value.column, e.parent.value.raw],
          f.parent,
        );
        assert.deepEqual(
          [e.batch.value.row, e.batch.value.column, e.batch.value.raw],
          f.batch,
        );
        assert.deepEqual([e.axis.row, e.axis.column, e.axis.raw], f.axis);
        assert.equal(e.panelEnd.row, f.panelEnd);
        assert.equal(e.derivedDimensions, f.values[1]);
        for (const [key, pair] of Object.entries(e.fields))
          for (const role of ['value', 'role'])
            assert.deepEqual(
              [pair[role].row, pair[role].column, pair[role].raw],
              f.fields[key][role],
            );
      }
      await download(t.export, 'pending.xlsx');
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'pending.xlsx'),
        '--case-dir',
        path.join(sources, id),
      ]);
      await download(t.save, 'pending.json');
      const session = JSON.parse(
        await readFile(path.join(dir, 'pending.json'), 'utf8'),
      );
      for (const [i, p] of entry.files.entries())
        assert.equal(
          session.files[i].data,
          (await readFile(path.join(sources, p))).toString('base64'),
        );
    } else {
      assert.equal(fresh.result.totals, null);
      assert.ok(fresh.result.issues.length);
      assert.ok(
        fresh.result.issues.some((i) => i.code === 'ORPHAN_MATRIX_COLUMN'),
      );
      await download(t.export, 'pending.xlsx');
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'pending.xlsx'),
        '--case-dir',
        path.join(sources, id),
      ]);
    }
    if (truth.financial === 'ready') {
      await w.getByLabel(t.complete, { exact: true }).check();
      await w
        .getByLabel(t.completeReference, { exact: true })
        .fill('INV1E-SYN');
      await w
        .getByLabel(t.completeNote, { exact: true })
        .fill('Synthetic source coverage');
      fresh = await compare();
      await w.getByLabel(t.reference, { exact: true }).fill('INV1E-SYN');
      await w
        .getByLabel(t.note, { exact: true })
        .fill('Synthetic header ownership review');
      await button(t.accept).click();
      await wait();
      assert.equal((await reply()).result.review, 'accepted');
      await download(t.save, 'accepted.json');
      await download(t.export, 'accepted.xlsx');
      independent('check_export.py', [
        '--workbook',
        path.join(dir, 'accepted.xlsx'),
        '--case-dir',
        path.join(sources, id),
        '--mode',
        'accepted',
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
        path.join(sources, id),
        '--mode',
        'accepted',
      ]);
    } else assert.equal(await button(t.accept).isEnabled(), false);
    const disclosures = await w
      .locator('details[data-workspace-advanced][open]')
      .all();
    for (const d of disclosures.reverse())
      if (await d.isVisible()) await d.locator(':scope > summary').click();
    await w.screenshot({ path: path.join(dir, 'workspace.png') });
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
    assert.deepEqual(
      await page.evaluate(() =>
        globalThis.invColumnReplies.filter((r) => !r.ok).map((r) => r.error),
      ),
      [],
    );
    results.push({
      id,
      lang,
      container: entry.container,
      financial: truth.financial,
      exactFinancialAndDimensionProof: true,
      originalBytes: true,
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
    ) + '\n',
  );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
