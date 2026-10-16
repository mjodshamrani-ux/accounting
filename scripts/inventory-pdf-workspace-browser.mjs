// Real UI uploads, genuine Worker observations and local downloads only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import {
  pdfLifecycleFixture,
  g3Contract,
  pdfScope,
} from '../tests/helpers/inventory-pdf-lifecycle-fixture.ts';
import { stockCopy } from '../lib/i18n/inventory-register.ts';
import { inventoryPdfCopy } from '../lib/i18n/inventory-pdf.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
import { STOCK_FIELDS } from '../lib/reconciliation/inventory-register.ts';
import {
  openDomainWorkspace,
  openWorkspaceDisclosures,
  workspaceSource,
} from './domain-navigation-support.mjs';
const root = path.resolve(import.meta.dirname, '..'),
  dist = path.join(root, 'dist');
const output =
  process.env.INV_PDF_WORKSPACE_BROWSER_DIR ??
  path.join(root, 'work/inventory-pdf-workspace-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const fixture = await pdfLifecycleFixture();
await cp(fixture.root, path.join(out, 'sources'), { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local'),
      f = path.resolve(
        dist,
        '.' +
          decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname),
      );
    assert.ok(f.startsWith(dist + path.sep));
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = {},
  errors = [],
  external = [],
  nonGet = [],
  checks = [];
let browser, current;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const codes = [
    ...g3Contract.ready,
    ...g3Contract.difference,
    ...g3Contract.missing,
    ...Object.keys(g3Contract.sourceErrors),
  ];
  for (const [caseIndex, code] of codes.entries()) {
    const name = 'INV1F-' + code,
      initial = caseIndex % 2 ? 'en' : 'ar';
    let lang = initial;
    const ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: code === 'P04' ? 390 : 1440, height: 1000 },
    });
    ctx.setDefaultTimeout(60000);
    ctx.on('request', (r) => {
      if (!r.url().startsWith(origin + '/') && !/^(blob:|data:)/.test(r.url()))
        external.push(r.url());
      if (r.method() !== 'GET') nonGet.push(r.method() + ' ' + r.url());
    });
    const page = (current = await ctx.newPage());
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      globalThis.pdfReplies = [];
      globalThis.pdfHold = false;
      globalThis.pdfQueue = [];
      globalThis.pdfTerminated = 0;
      globalThis.Worker = new Proxy(Worker, {
        construct(target, args) {
          const w = Reflect.construct(target, args);
          w.addEventListener('message', (e) => {
            if (e.data?.action?.startsWith('stock-pdf-'))
              globalThis.pdfReplies.push(e.data);
          });
          // Delay authentic transport only for cancellation testing. Never fabricate,
          // change or inject a financial response or a disabled UI control.
          const nativeSet = Object.getOwnPropertyDescriptor(
            Worker.prototype,
            'onmessage',
          ).set.bind(w);
          let handler = null;
          nativeSet((e) => {
            if (globalThis.pdfHold) {
              const receive = handler;
              globalThis.pdfQueue.push(() => receive?.call(w, e));
            } else handler?.call(w, e);
          });
          Object.defineProperty(w, 'onmessage', {
            get: () => handler,
            set: (v) => {
              handler = v;
            },
            configurable: true,
          });
          const terminate = w.terminate.bind(w);
          w.terminate = () => {
            globalThis.pdfTerminated++;
            return terminate();
          };
          return w;
        },
      });
    });
    await page.goto(origin);
    if (lang === 'en')
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
    const w = await openDomainWorkspace(page, 'stock');
    const t = () => stockCopy[lang];
    const button = (k) => w.getByRole('button', { name: t()[k], exact: true });
    const wait = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('[data-stock-workspace]')
            ?.getAttribute('aria-busy') === 'false',
      );
    const language = async (next) => {
      if (next !== lang) {
        await page
          .getByRole('button', {
            name: next === 'en' ? 'EN English' : 'AR العربية',
            exact: true,
          })
          .click();
        lang = next;
      }
    };
    const last = (action) =>
      page.evaluate(
        (action) =>
          globalThis.pdfReplies
            .filter((r) => r.action === action && r.ok)
            .at(-1)?.value,
        action,
      );
    const download = async (k, file) => {
      assert.equal(await button(k).isEnabled(), true, k);
      const d = page.waitForEvent('download');
      await button(k).click();
      await (await d).saveAs(path.join(out, file));
      await wait();
    };
    for (const i of [0, 3, 1, 2]) {
      await openWorkspaceDisclosures(w);
      const input = w.getByLabel(t().roles[i], { exact: true });
      assert.equal(await input.isEnabled(), true);
      await input.setInputFiles(
        path.join(
          out,
          'sources',
          name,
          ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv'][i],
        ),
      );
      await wait();
      await workspaceSource(w, t().roles[i]).getByRole('checkbox').check();
    }
    if (code === 'P02') {
      const pending = page.waitForEvent('download');
      await w
        .getByRole('button', {
          name: inventoryPdfCopy[lang].original,
          exact: true,
        })
        .click();
      const target = path.join(out, 'original-register.pdf');
      await (await pending).saveAs(target);
      assert.deepEqual(
        await readFile(target),
        await readFile(path.join(out, 'sources', name, 'register.pdf')),
      );
    }
    for (const field of STOCK_FIELDS)
      assert.equal(
        await w
          .getByLabel(t().scopePrefix + t().scope[field], { exact: true })
          .inputValue(),
        pdfScope[field],
        code + ': scope ' + field,
      );
    await w.getByLabel(t().scopeConfirm, { exact: true }).check();
    const phases = {};
    const capture = async (phase) => {
      const r = (await last('stock-pdf-reconcile')).result;
      phases[phase] = r;
      assert.equal(
        await w.locator('[data-stock-status]').innerText(),
        t().status[r.status],
      );
      for (const next of ['en', 'ar']) {
        await language(next);
        assert.equal(
          await w
            .getByText(inventoryPdfCopy[next].exportNote, { exact: true })
            .isVisible(),
          true,
        );
        // Tie the rendered page to the same result independently checked from
        // its source originals below, including empty money on source errors.
        const tables = await w
          .locator('.workspace-results table')
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              headers: [...n.querySelectorAll('thead th')].map((c) =>
                c.textContent.trim(),
              ),
              rows: [...n.querySelectorAll('tbody tr')].map((row) =>
                [...row.querySelectorAll('td')].map((c) =>
                  c.textContent.trim(),
                ),
              ),
            })),
          );
        const rendered = (headers, rows) => {
          const found = tables.filter(
            (table) =>
              JSON.stringify(table.headers) === JSON.stringify(headers),
          );
          assert.equal(
            found.length,
            1,
            name + ': unique rendered table ' + headers.join('|'),
          );
          assert.deepEqual(
            found[0].rows,
            rows.map((row) => row.map((v) => String(v ?? '—'))).slice(0, 50),
          );
        };
        rendered(
          t().totals,
          r.totals ? [[r.totals.registerMinor, r.totals.glMinor]] : [],
        );
        rendered(
          t().comparisons,
          r.comparisons.map((c) => [
            c.account,
            c.dimensions,
            c.registerMinor,
            c.debitMinor,
            c.creditMinor,
            c.glMinor,
            c.differenceMinor,
          ]),
        );
        for (const [i, records] of r.records.entries())
          rendered(
            t().records[i],
            records.map((v) => [v.row, ...v.values]),
          );
        await download(
          'export',
          name + '-' + phase + (next === 'ar' ? '-ar' : '') + '.xlsx',
        );
      }
      return r;
    };
    assert.equal(await button('compare').isEnabled(), true);
    await button('compare').click();
    await wait();
    await capture('unreviewed');
    for (const next of ['en', 'ar']) {
      await language(next);
      const e = domainEvidenceCopy(next);
      await w.locator('[data-evidence-question="amounts"]').click();
      await wait();
      await w.locator('[data-evidence-answer="amounts"]').waitFor();
      const reply = await last('stock-pdf-ask');
      assert.equal(reply.kind, 'amounts');
      assert.equal(reply.context, phases.unreviewed.context);
      assert.equal(
        reply.facts[0].value,
        phases.unreviewed.totals?.registerMinor ?? null,
      );
      assert.equal(
        reply.facts[1].value,
        phases.unreviewed.totals?.glMinor ?? null,
      );
      assert.equal(
        await w.locator('[data-evidence-fact="supportedRegister"]').count(),
        1,
      );
      assert.ok(
        await w
          .getByRole('heading', { name: e.title, exact: true })
          .isVisible(),
      );
    }
    if (g3Contract.ready.includes(code)) {
      await openWorkspaceDisclosures(w);
      await w
        .getByLabel(t().completeReference, { exact: true })
        .fill('Synthetic completeness review');
      await w
        .getByLabel(t().completeNote, { exact: true })
        .fill('All original pages reviewed');
      await w.getByLabel(t().complete, { exact: true }).check();
      await button('compare').click();
      await wait();
      await capture('complete');
      await w
        .getByLabel(t().reference, { exact: true })
        .fill('Synthetic source review');
      await w
        .getByLabel(t().note, { exact: true })
        .fill('All supplied scope reviewed');
      for (const [type, phase] of [
        ['accept', 'accepted'],
        ['undo', 'undone'],
        ['reject', 'rejected'],
        ['undo', 'reopened'],
      ]) {
        assert.equal(await button(type).isEnabled(), true);
        await button(type).click();
        await wait();
        await capture(phase);
        if (phase === 'accepted') {
          await download('save', name + '-session.json');
          const s = JSON.parse(
            await readFile(path.join(out, name + '-session.json'), 'utf8'),
          );
          assert.equal(s.format, 'tarasuf-inventory-pdf-session');
          assert.equal(s.files.length, 4);
          assert.ok(!('result' in s));
          await openWorkspaceDisclosures(w);
          await w
            .getByLabel(t().restore, { exact: true })
            .setInputFiles(path.join(out, name + '-session.json'));
          await wait();
          assert.deepEqual(
            (await last('stock-pdf-restore')).result,
            phases.accepted,
          );
        }
      }
    } else assert.equal(await button('accept').isEnabled(), false);
    results[name] = phases;
    if (code === 'P02') {
      // A cold mount must select the PDF session route before legacy CSV parsing.
      await page.reload();
      await openDomainWorkspace(page, 'stock');
      assert.equal(await w.locator('[data-stock-status]').count(), 0);
      await openWorkspaceDisclosures(w);
      await w
        .getByLabel(t().restore, { exact: true })
        .setInputFiles(path.join(out, name + '-session.json'));
      await wait();
      assert.deepEqual(
        (await last('stock-pdf-restore')).result,
        phases.accepted,
      );
      assert.equal(
        await w.locator('[data-stock-status]').innerText(),
        t().status[phases.accepted.status],
      );
      checks.push('cold PDF session restores accepted original-bound result');
    }
    if (code === 'P03') {
      // Cross-domain navigation and language changes retain the same PDF work.
      await openDomainWorkspace(page, 'bank');
      await openDomainWorkspace(page, 'stock');
      assert.equal(
        await w.locator('[data-stock-status]').innerText(),
        t().status['needs-review'],
      );
      const before = await page.evaluate(() => globalThis.pdfTerminated);
      await page.evaluate(() => {
        globalThis.pdfHold = true;
      });
      await w
        .getByLabel(t().roles[0], { exact: true })
        .setInputFiles(path.join(out, 'sources', 'INV1F-P01', 'register.pdf'));
      await page.waitForFunction(() => globalThis.pdfQueue.length > 0);
      await button('cancel').click();
      await wait();
      await page.evaluate(() => {
        globalThis.pdfHold = false;
        for (const deliver of globalThis.pdfQueue.splice(0)) deliver();
      });
      await page.waitForTimeout(50);
      assert.equal(await w.locator('[data-stock-status]').count(), 0);
      assert.ok((await page.evaluate(() => globalThis.pdfTerminated)) > before);
      await button('compare').click();
      await wait();
      assert.equal(
        (await last('stock-pdf-reconcile')).result.pdfEvidence.reading.source
          .sha256,
        phases.unreviewed.pdfEvidence.reading.source.sha256,
      );
      checks.push(
        'cancelled authentic late PDF response and fresh Worker recovery',
      );
    }
    if (['P02', 'P04'].includes(code)) {
      for (const d of await w
        .locator('details[data-workspace-advanced][open]')
        .all())
        if (await d.isVisible()) await d.locator(':scope > summary').click();
      await w.locator('h1,h2').first().scrollIntoViewIfNeeded();
    }
    if (code === 'P04') {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: path.join(out, 'pdf-mobile-ar.png'),
        fullPage: false,
      });
    }
    if (code === 'P02') {
      await page.screenshot({
        path: path.join(out, 'pdf-desktop-ar.png'),
        fullPage: false,
      });
      await language('en');
      await page.screenshot({
        path: path.join(out, 'pdf-desktop-en.png'),
        fullPage: false,
      });
      await workspaceSource(w, t().roles[0]).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, 'pdf-upload-en.png'),
        fullPage: false,
      });
      await w.locator('[data-stock-status]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, 'pdf-result-en.png'),
        fullPage: false,
      });
    }
    checks.push(
      name + ' actual upload scope decisions assistant bilingual exports',
    );
    console.log('Completed PDF UI ' + name);
    await ctx.close();
    current = null;
  }
} catch (e) {
  if (current)
    await current.screenshot({
      path: path.join(out, 'failure.png'),
      fullPage: false,
    });
  throw e;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await fixture.close();
}
assert.deepEqual(errors, []);
assert.deepEqual(external, []);
assert.deepEqual(nonGet, []);
const file = path.join(out, 'results.json');
await writeFile(file, JSON.stringify(results));
const independent = spawnSync(
  process.env.PYTHON ?? 'python3',
  [
    '-B',
    path.join(root, 'audit/inventory-pdf-workspace/check_workspace.py'),
    '--books',
    out,
    '--sources',
    path.join(out, 'sources'),
    '--result',
    file,
    '--ui',
  ],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
);
await writeFile(
  path.join(out, 'independent.log'),
  independent.stdout + independent.stderr,
);
assert.equal(independent.status, 0, independent.stderr);
const report = {
  passed: true,
  out,
  checks,
  independent: JSON.parse(independent.stdout),
  errors,
  external,
  nonGet,
};
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
