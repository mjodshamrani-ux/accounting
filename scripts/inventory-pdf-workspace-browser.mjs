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
import { scopeCardCopy } from '../lib/i18n/scope-card.ts';
import { inventoryPdfCopy } from '../lib/i18n/inventory-pdf.ts';
import { recordTableCopy } from '../lib/i18n/record-table.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
import { STOCK_FIELDS } from '../lib/reconciliation/inventory-register.ts';
import { inventorySheetSaysScreen } from './reconciliation-sheet-browser.mjs';
import { money } from '../lib/reconciliation/core.ts';
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
  checks = [],
  sheets = [];
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
      const received = await d;
      if (k === 'export')
        assert.equal(
          received.suggestedFilename(),
          `tarasuf-inventory-evidence-${lang}.xlsx`,
        );
      await received.saveAs(path.join(out, file));
      await wait();
      // UX-6(c): the workpaper opens on the reconciliation sheet, in the
      // interface's language, and it says what this page shows; the Arabic
      // one names its evidence sheets as its Arabic evidence does.
      if (k === 'export')
        sheets.push({
          file,
          lang,
          ...(await inventorySheetSaysScreen(page, {
            file: path.join(out, file),
            lang,
            printed: true,
          })),
        });
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
    // UX-5(d): the printed register states its scope once, in its scope
    // lines, and the three other originals on every row; the card says so
    // for each, and its one confirmation carries the four sources and the
    // scope.
    // A register refused for its page sequence (N01, N02 in the sealed
    // contract) is not read past its pages, so its scope lines are not
    // read: the card must not name it, and the three companions give the
    // scope alone. The engine then refuses the register as before.
    const unread = g3Contract.sourceErrors[code] === 'PAGE_SEQUENCE',
      // The companions' data rows, from their bytes: every row writes the
      // scope (own split; the synthetic CSVs quote no line breaks).
      companionRows = (
        await Promise.all(
          ['mapping.csv', 'policy.csv', 'gl.csv'].map((f) =>
            readFile(path.join(out, 'sources', name, f), 'utf8'),
          ),
        )
      ).reduce(
        (n, text) => n + text.split(/\r?\n/).filter((l) => l.trim()).length - 1,
        0,
      );
    const cardSays = async (when) => {
      const block = lang === 'ar' ? 'كتلة النطاق' : 'scope block';
      for (const field of STOCK_FIELDS) {
        const row = w.locator(`[data-scope-field="${field}"]`);
        assert.equal(
          await row.getAttribute('data-origin'),
          'file',
          `${code} ${when}: ${field} from the files`,
        );
        const hint = (await row.locator('.hint').textContent()).trim();
        assert.equal(
          hint.includes(`${t().roles[0]}: ${block}`),
          !unread,
          `${code} ${when}: ${field} read from the printed register's scope lines: ${hint}`,
        );
        assert.equal(
          hint.includes(t().roles[0]),
          !unread,
          `${code} ${when}: ${field} names the register only when it was read: ${hint}`,
        );
        for (const i of [1, 2, 3])
          assert.ok(
            hint.includes(`${t().roles[i]}: `),
            `${code} ${when}: ${field} read from ${t().roles[i]}: ${hint}`,
          );
      }
      const summary = w.locator('[data-scope-card] [data-scope-summary]');
      assert.equal(
        (await summary.innerText()).trim(),
        t()
          .cardSummary(
            pdfScope.entity,
            pdfScope.inventoryLedger,
            pdfScope.glLedger,
            pdfScope.asOf,
            pdfScope.currency,
            companionRows,
            unread ? 'files' : 'block',
          )
          .join(''),
        `${code} ${when}: the sentence says what was read`,
      );
      assert.equal(
        await summary.locator('bdi').count(),
        5,
        `${code} ${when}: each value in the sentence is isolated`,
      );
    };
    await cardSays('loaded');
    const confirmBox = w.getByLabel(t().cardConfirm('', '')[0], {
      exact: false,
    });
    assert.equal(
      await confirmBox.isChecked(),
      false,
      code + ': a suggestion never confirms',
    );
    await confirmBox.check();
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
        // A table with no row is one quiet line that names it (UX-3); an
        // evidence section with no row is named, under its key, on the one
        // line of empty sections instead (UX-4).
        const quiet = await w
          .locator('.workspace-results [data-record-empty]')
          .evaluateAll((nodes) => nodes.map((n) => n.textContent.trim()));
        const emptySections = await w
          .locator(
            '.workspace-results [data-empty-sections] [data-empty-section]',
          )
          .evaluateAll((nodes) =>
            nodes.map((n) => [n.dataset.emptySection, n.textContent.trim()]),
          );
        const rendered = (label, headers, rows, section) => {
          const found = tables.filter(
            (table) =>
              JSON.stringify(table.headers) === JSON.stringify(headers),
          );
          if (!rows.length) {
            assert.equal(
              found.length,
              0,
              name + ': no table of headers over no row ' + label,
            );
            if (section) {
              assert.deepEqual(
                emptySections.filter(([key]) => key === section.key),
                [[section.key, section.name]],
                name + ': the line of empty sections names ' + section.name,
              );
              return;
            }
            assert.equal(
              quiet.filter((line) => line === recordTableCopy[lang].none(label))
                .length,
              1,
              name + ': one quiet line says ' + label + ' has none',
            );
            return;
          }
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
        // The page shows money in major units at the currency's precision and
        // a register quantity at its own precision; the engine's integers are
        // formatted here independently of the page before comparing.
        const amount = (v) =>
          v === null || v === undefined ? v : money(v, r.decimals);
        rendered(
          t().tableNames.totals,
          t().totals,
          r.totals
            ? [[amount(r.totals.registerMinor), amount(r.totals.glMinor)]]
            : [],
        );
        rendered(
          t().tableNames.comparisons,
          t().comparisons,
          r.comparisons.map((c) => [
            c.account,
            c.dimensions,
            amount(c.registerMinor),
            amount(c.debitMinor),
            amount(c.creditMinor),
            amount(c.glMinor),
            amount(c.differenceMinor),
          ]),
        );
        const recordCell = (role, values) =>
          values.map((v, j) =>
            role === 0 && j === 2 && typeof v === 'number'
              ? money(v, Number(values[4]))
              : ((role === 0 && j === 5) ||
                    (role === 3 && (j === 3 || j === 4))) &&
                  typeof v === 'number'
                ? amount(v)
                : v,
          );
        for (const [i, records] of r.records.entries())
          rendered(
            recordTableCopy[lang].rowsOf(t().roles[i]),
            t().records[i],
            records.map((v) => [v.row, ...recordCell(i, v.values)]),
            { key: `records.${i}`, name: t().roles[i] },
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
    if (code === 'N01') {
      await download('save', name + '-source-error-session.json');
      await page.reload();
      await openDomainWorkspace(page, 'stock');
      await openWorkspaceDisclosures(w);
      await w
        .getByLabel(t().restore, { exact: true })
        .setInputFiles(path.join(out, name + '-source-error-session.json'));
      await wait();
      const restored = (await last('stock-pdf-restore')).result;
      assert.deepEqual(restored, phases.unreviewed);
      assert.equal(restored.financial, 'source-error');
      assert.equal(restored.totals, null);
      await cardSays('restored cold');
      assert.equal(
        await w.locator('[data-stock-status]').innerText(),
        t().status['source-error'],
      );
      assert.equal(await button('accept').isEnabled(), false);
      checks.push(
        'cold source-error PDF session retains diagnostics and withheld money',
      );
    }
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
      // The card reads the restored register's scope lines, not those of
      // whatever was on screen before the session.
      await cardSays('restored cold');
      assert.equal(
        await w
          .getByLabel(t().cardConfirm('', '')[0], { exact: false })
          .isChecked(),
        true,
        'P02 restored cold: the confirmation the session ran with',
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
    if (code === 'P01') {
      // Another printed register drops the one confirmation, even with the
      // same scope; the accountant ticks it again for the new original.
      await openWorkspaceDisclosures(w);
      await w
        .getByLabel(t().roles[0], { exact: true })
        .setInputFiles(path.join(out, 'sources', 'INV1F-P03', 'register.pdf'));
      await wait();
      const again = w.getByLabel(t().cardConfirm('', '')[0], { exact: false });
      assert.equal(
        await again.isChecked(),
        false,
        'P01: a new register drops the confirmation',
      );
      assert.equal(
        await button('compare').isEnabled(),
        false,
        'P01: no run before it is confirmed again',
      );
      await again.check();
      assert.equal(
        await button('compare').isEnabled(),
        true,
        'P01: confirmed again, the run opens',
      );
      checks.push('a new printed register drops the one confirmation');
      // A field only the register's scope lines state: the three companions
      // are written without their Chart version column (own split), so the
      // card reads that field from the register alone. Restored on a fresh
      // page, the session is read with its own register, so the field is
      // still from the file, not the accountant's entry.
      const only = path.join(out, 'sources', 'INV1F-P01-register-only');
      await mkdir(only, { recursive: true });
      for (const f of ['mapping.csv', 'policy.csv', 'gl.csv']) {
        const lines = (
          await readFile(path.join(out, 'sources', 'INV1F-P01', f), 'utf8')
        )
          .split(/\r?\n/)
          .filter((l) => l.trim());
        const at = lines[0].split(',').indexOf('Chart version');
        assert.ok(at >= 0, f + ' writes Chart version');
        assert.ok(
          lines.every(
            (l) =>
              !l.includes('"') &&
              l.split(',').length === lines[0].split(',').length,
          ),
          f + ': unquoted rows of one width, so a plain split is exact',
        );
        await writeFile(
          path.join(only, f),
          lines
            .map((l) =>
              l
                .split(',')
                .filter((_, i) => i !== at)
                .join(','),
            )
            .join('\n') + '\n',
        );
      }
      const onlyRegister = async (when) => {
        const row = w.locator('[data-scope-field="chartVersion"]');
        assert.equal(
          await row.getAttribute('data-origin'),
          'file',
          `${when}: Chart version from the register's scope lines`,
        );
        const hint = (await row.locator('.hint').textContent()).trim();
        assert.ok(hint.includes(`${t().roles[0]}: `), `${when}: ${hint}`);
        for (const i of [1, 2, 3])
          assert.ok(!hint.includes(t().roles[i]), `${when}: ${hint}`);
      };
      await page.reload();
      await openDomainWorkspace(page, 'stock');
      for (const i of [0, 3, 1, 2]) {
        await openWorkspaceDisclosures(w);
        await w
          .getByLabel(t().roles[i], { exact: true })
          .setInputFiles(
            i === 0
              ? path.join(out, 'sources', 'INV1F-P01', 'register.pdf')
              : path.join(only, ['', 'mapping.csv', 'policy.csv', 'gl.csv'][i]),
          );
        await wait();
      }
      await onlyRegister('P01 register-only field');
      await w.getByLabel(t().cardConfirm('', '')[0], { exact: false }).check();
      await button('compare').click();
      await wait();
      await download('save', 'register-only-session.json');
      await page.reload();
      await openDomainWorkspace(page, 'stock');
      await openWorkspaceDisclosures(w);
      await w
        .getByLabel(t().restore, { exact: true })
        .setInputFiles(path.join(out, 'register-only-session.json'));
      await wait();
      await onlyRegister('P01 register-only field restored cold');
      checks.push('a field only the register states survives a cold restore');
      // A mapping whose every row names another entity than the register's
      // scope lines: the field is a question before any run, listing the
      // register's value as its scope block and each file's with its rows.
      const other = path.join(out, 'sources', 'INV1F-P01-other-entity');
      await mkdir(other, { recursive: true });
      const mapping = (
        await readFile(
          path.join(out, 'sources', 'INV1F-P01', 'mapping.csv'),
          'utf8',
        )
      )
        .split(/\r?\n/)
        .filter((l) => l.trim());
      const entityAt = mapping[0].split(',').indexOf('Entity');
      assert.ok(entityAt >= 0);
      await writeFile(
        path.join(other, 'mapping.csv'),
        mapping
          .map((l, i) =>
            i
              ? l
                  .split(',')
                  .map((c, j) => (j === entityAt ? 'Other Owner' : c))
                  .join(',')
              : l,
          )
          .join('\n') + '\n',
      );
      await page.reload();
      await openDomainWorkspace(page, 'stock');
      for (const i of [0, 3, 1, 2]) {
        await openWorkspaceDisclosures(w);
        await w
          .getByLabel(t().roles[i], { exact: true })
          .setInputFiles(
            i === 1
              ? path.join(other, 'mapping.csv')
              : path.join(
                  out,
                  'sources',
                  'INV1F-P01',
                  ['register.pdf', '', 'policy.csv', 'gl.csv'][i],
                ),
          );
        await wait();
      }
      const entity = w.locator('[data-scope-field="entity"]');
      assert.equal(
        await entity.getAttribute('data-origin'),
        'question',
        'P01 other entity: a question',
      );
      assert.equal(
        await w
          .getByLabel(t().scopePrefix + t().scope.entity, { exact: true })
          .inputValue(),
        '',
        'P01 other entity: a disagreement is never filled',
      );
      const rowsOf = async (dir, f) =>
        (await readFile(path.join(dir, f), 'utf8'))
          .split(/\r?\n/)
          .filter((l) => l.trim()).length - 1;
      const say = scopeCardCopy[lang];
      assert.deepEqual(
        (await entity.locator('li').allTextContents())
          .map((x) => x.trim())
          .sort(),
        [
          `${say.quote(pdfScope.entity)} ${say.valueIn(t().roles[0], 1, true)}`,
          `${say.quote(pdfScope.entity)} ${say.valueIn(t().roles[2], await rowsOf(path.join(out, 'sources', 'INV1F-P01'), 'policy.csv'))}`,
          `${say.quote(pdfScope.entity)} ${say.valueIn(t().roles[3], await rowsOf(path.join(out, 'sources', 'INV1F-P01'), 'gl.csv'))}`,
          `${say.quote('Other Owner')} ${say.valueIn(t().roles[1], await rowsOf(other, 'mapping.csv'))}`,
        ].sort(),
        "P01 other entity: the register's value as its scope block, each file's with its rows",
      );
      assert.ok(
        (await entity.locator('li').allTextContents()).some((x) =>
          x.includes(lang === 'ar' ? 'كتلة النطاق' : 'scope block'),
        ),
        'P01 other entity: the block is named as a block',
      );
      checks.push(
        "a companion against the register's scope lines is a question",
      );
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
assert.ok(
  sheets.length > 0 && new Set(sheets.map((s) => s.lang)).size === 2,
  'workpapers checked in both languages',
);
const report = {
  passed: true,
  out,
  checks,
  sheets,
  independent: JSON.parse(independent.stdout),
  errors,
  external,
  nonGet,
};
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
