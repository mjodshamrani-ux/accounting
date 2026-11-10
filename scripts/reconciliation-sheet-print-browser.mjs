// UX-6(d): the reconciliation sheet on paper says what the downloaded sheet
// says, and nothing else prints.
//
// In each workspace with its print (GL/TB; the case workspaces suppliers,
// clearing, receivables, bank movements and allocation; and the family
// workspaces financial position, intercompany, payment gateway, inventory,
// fixed assets and payroll, with inventory also on its printed register's
// path from the synthetic INV1F-P01 originals), in Arabic and in English,
// the check runs the workspace's own synthetic example and requires:
// - the print table to be in the page only while the page prints, from the
//   browser's beforeprint to its afterprint (the check dispatches them as the
//   browser does, and page.pdf fires them itself), never drawn on the screen
//   even then, gone after it, and drawn by the workspace on the screen alone
//   while another workspace with a result of its own is kept hidden (the
//   suppliers in the GL/TB check, whose panel stays in the page hidden; GL/TB
//   in the case workspaces'; and in each family workspace's another family
//   workspace, for they too stay in the page hidden);
// - in print media, nothing visible but the table and the way down to it;
// - the table to equal the first sheet of the workbook the page downloads,
//   row for row and cell for cell, as the independent checker reads the
//   workbook (audit/reconciliation-sheet/check_sheet.py --print, which also
//   checks the download against its own evidence sheets); and the checker to
//   refuse a table with a row left out, a figure changed, a fingerprint cut
//   (or, where the example's sources have no original file, the words the
//   sheet writes in its place) or the other language, so its agreement means
//   something;
// - the printed A4 pages counted and recorded; and on A4 and on a small
//   page, where breaks fall in more places, no group the sheet keeps
//   together split over two pages unless it starts at the top of one (a
//   group taller than a page), read from a marker the check writes in each
//   row (Arabic text does not come back from the PDF in order);
// - the chunks loaded to compose the sheet recorded, and whether ExcelJS and
//   JSZip were already loaded with the page;
// - the print command, from the keyboard, pressed as soon as the result is
//   shown (for the suppliers, in their workpaper step, with a reviewer's name
//   and notes) while the sheet's module is held back, to wait and print the
//   whole sheet; the table to follow a change of language, never printed in
//   the other language when the page prints in the same moment as the
//   change, and the command pressed at once after it to print it in that
//   language; in a
//   case or family workspace, after a decision, the table to carry its
//   reason and to equal the sheet downloaded then; and no table once the
//   result it was composed for is gone, nor a command that is still open.
// The suppliers' other export, after a group is accepted in the overlap
// review, writes no sheet; the main integration check
// (scripts/supplier-main-overlap-browser.mjs) holds the command there.
//
// Synthetic examples only. The check reads the screen and the download; it
// does not prove a printer, another browser or a device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { getDocumentProxy } from 'unpdf';
import {
  openDomainWorkspace,
  openWorkspaceDisclosures,
} from './domain-navigation-support.mjs';
import { stageWatchdog } from './stage-watchdog.mjs';
import { DECISIONS } from './ux-census-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(
  process.env.RECONCILIATION_SHEET_PRINT_DIST ?? path.join(root, 'dist'),
);
const out = path.resolve(
  process.env.RECONCILIATION_SHEET_PRINT_DIR ??
    path.join(root, 'work/reconciliation-sheet/print-browser'),
);
const checker = path.join(root, 'audit/reconciliation-sheet/check_sheet.py');

const LANGUAGES = {
  ar: {
    button: 'AR العربية',
    example: /مثال/u,
    print: 'اطبع ورقة التسوية',
    title: 'ورقة التسوية',
  },
  en: {
    button: 'EN English',
    example: /example|sample/iu,
    print: 'Print the reconciliation sheet',
    title: 'Reconciliation sheet',
  },
};

// The reason a decision in the check is recorded with, which the printed
// sheet must then carry.
const NOTE = {
  ar: 'سبب اصطناعي لقرار في فحص الطباعة',
  en: 'Synthetic print check decision reason',
};
// A change to the declared entity: the result rested on the scope it was
// run with, and goes.
const scopeDrop = async (panel, lang) => {
  const entity = panel
    .getByLabel(lang === 'ar' ? 'الكيان' : 'Entity', { exact: true })
    .first();
  for (const fold of await entity.locator('xpath=ancestor::details').all())
    if ((await fold.getAttribute('open')) === null)
      await fold.locator(':scope > summary').click();
  await entity.fill((await entity.inputValue()) + ' X');
};

// Each workspace with its print: the module its sheet is composed by, how
// its example runs, which button downloads its workpaper, a decision the
// sheet must then say, and a change that drops its result.
const SUPPLIER = {
  ar: {
    run: 'تحقق وقارن',
    prepare: 'أعدّ ورقة العمل',
    reviewer: 'اسم المراجع',
    notes: 'ملاحظات المراجعة',
    back: 'عُد إلى المراجعة',
    unmatched: 'دون مقابل',
    details: 'تفاصيل الحالة',
    reason: 'سبب القرار',
    reviewOnly: 'سجّل مراجعة دون مطابقة',
    edit: 'عدّل الإعدادات',
  },
  en: {
    run: 'Check and compare',
    prepare: 'Prepare the workpaper',
    reviewer: 'Reviewer name',
    notes: 'Review notes',
    back: 'Back to review',
    unmatched: 'Unmatched',
    details: 'Case details',
    reason: 'Reason for the decision',
    reviewOnly: 'Record review without a match',
    edit: 'Edit settings',
  },
};
const supplierButton = (panel, lang, word) =>
  panel.getByRole('button', { name: SUPPLIER[lang][word], exact: true });
// The supplier page exports from its workpaper step, where the reviewer's
// name and notes are written; the sheet says them.
const supplierWorkpaper = async (panel, lang) => {
  await supplierButton(panel, lang, 'prepare').click();
  await panel
    .getByRole('textbox', { name: SUPPLIER[lang].reviewer, exact: true })
    .fill(lang === 'ar' ? 'مراجع اصطناعي' : 'Synthetic reviewer');
  await panel
    .getByRole('textbox', { name: SUPPLIER[lang].notes, exact: true })
    .fill(lang === 'ar' ? 'ملاحظة اصطناعية للطباعة' : 'Synthetic print note');
};

// The family workspaces stay in the page hidden while another is shown. A
// decision rejects a whole line, pair, batch or scope with a reference and
// the reason, on the first item that takes it; withdrawing the card's
// confirmation drops the result.
const REFERENCE = {
  ar: 'مرجع اصطناعي للطباعة',
  en: 'Synthetic print reference',
};
const familyDecide = (decisions) => async (panel, lang) => {
  await openWorkspaceDisclosures(panel, { requiredSources: false });
  const [reference, reason] = DECISIONS[decisions].fields[lang];
  await panel.getByLabel(reference, { exact: true }).fill(REFERENCE[lang]);
  await panel.getByLabel(reason, { exact: true }).fill(NOTE[lang]);
  const reject = panel.getByRole('button', {
    name: DECISIONS[decisions].press[lang][0],
    exact: true,
  });
  for (let i = 0; i < (await reject.count()); i++)
    if (await reject.nth(i).isEnabled()) return reject.nth(i).click();
  throw Error(`${decisions}/${lang}: no decision is open`);
};
const cardDrop = async (panel) => {
  const box = panel.locator('.scope-card__confirm input').first();
  for (const fold of await box.locator('xpath=ancestor::details').all())
    if ((await fold.getAttribute('open')) === null)
      await fold.locator(':scope > summary').click();
  await box.uncheck();
};
// Each family workspace is, in another's check, the one kept hidden with a
// result of its own (payroll for the financial position, then each for the
// next), so each one's hold on its table while hidden is checked.
const family = (chunk, decisions, exported, neighbour) => ({
  chunk,
  result: '[data-result-heading="result"]',
  export: exported,
  neighbour,
  decide: familyDecide(decisions),
  drop: cardDrop,
});
// The printed register's path in the inventory workspace: the synthetic
// INV1F-P01 originals, generated as the PDF lifecycle fixture generates
// them and checked against their sealed manifest, opened through the native
// file inputs; the card is confirmed from what the four files say, and the
// check runs.
const STOCK = {
  ar: {
    roles: [
      'سجل المخزون المرحل',
      'خريطة الصنف والأستاذ المقترحة',
      'دليل السياسة المستقل المقدم',
      'أرصدة مخزون الأستاذ المحددة',
    ],
    confirm: 'راجعت سجل المخزون المرحل',
    compare: 'افحص المخزون والأستاذ',
  },
  en: {
    roles: [
      'Posted inventory register',
      'Proposed item / GL mapping',
      'Independent supplied policy evidence',
      'Selected inventory GL balances',
    ],
    confirm: 'I reviewed the posted inventory register',
    compare: 'Check inventory / GL',
  },
};
let printedSources = null;
const printedRegister = async () => {
  if (!printedSources) {
    const dir = path.join(out, 'inventory-pdf-sources');
    execFileSync(
      'python3',
      [
        '-B',
        path.join(root, 'audit/inventory-pdf-foundation/generate.py'),
        '--output-dir',
        dir,
        '--include-scope-controls',
      ],
      { timeout: 60000 },
    );
    const manifest = JSON.parse(
      await readFile(
        path.join(root, 'audit/inventory-pdf-foundation/INPUT-MANIFEST.v2.json'),
        'utf8',
      ),
    );
    for (const f of manifest.files) {
      const bytes = await readFile(path.join(dir, f.path));
      assert.equal(bytes.length, f.bytes, f.path);
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        f.sha256,
        f.path,
      );
    }
    printedSources = path.join(dir, 'INV1F-P01');
  }
  return printedSources;
};
const stockIdle = (panel) =>
  panel
    .locator('[data-stock-workspace][aria-busy="false"]')
    .waitFor({ timeout: 60000 });
const openPrintedRegister = async (panel, lang) => {
  const sources = await printedRegister();
  for (const i of [0, 3, 1, 2]) {
    await openWorkspaceDisclosures(panel);
    await panel
      .getByLabel(STOCK[lang].roles[i], { exact: true })
      .setInputFiles(
        path.join(
          sources,
          ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv'][i],
        ),
      );
    await stockIdle(panel);
  }
  await panel.getByLabel(STOCK[lang].confirm, { exact: false }).check();
  await panel
    .getByRole('button', { name: STOCK[lang].compare, exact: true })
    .click();
};

const WORKSPACES = {
  supplier: {
    chunk: 'supplier',
    result: '[data-result-part="cases"]',
    export: {
      ar: 'نزّل مسودة Excel',
      en: 'Download Excel draft',
    },
    // The example opens both sources and the scope; the check compares.
    run: (panel, lang) => supplierButton(panel, lang, 'run').click(),
    ready: supplierWorkpaper,
    decide: async (panel, lang) => {
      await supplierButton(panel, lang, 'back').click();
      await panel
        .getByRole('tab', { name: SUPPLIER[lang].unmatched, exact: true })
        .click();
      await supplierButton(panel, lang, 'details').first().click();
      await panel
        .getByRole('textbox', { name: SUPPLIER[lang].reason, exact: true })
        .fill(NOTE[lang]);
      await supplierButton(panel, lang, 'reviewOnly').click();
      await supplierButton(panel, lang, 'prepare').click();
    },
    // Editing the settings gives the result up and returns to the scope.
    drop: async (panel, lang) => {
      await supplierButton(panel, lang, 'back').click();
      await supplierButton(panel, lang, 'edit').click();
    },
  },
  'gl-tb': {
    chunk: 'gl-tb',
    result: '[data-testid="gl-tb-result"]',
    export: {
      ar: 'نزّل ورقة عمل الأستاذ والميزان',
      en: 'Download GL/TB workpaper',
    },
    // Another reading family for the trial balance: the result rested on
    // the one read, and goes.
    drop: async (panel) => {
      const family = panel.locator('[data-testid="gl-tb-family"]');
      const now = await family.inputValue();
      const other = await family.evaluate(
        (select, value) =>
          [...select.options].find((o) => o.value !== value).value,
        now,
      );
      await family.selectOption(other);
    },
  },
  clearing: {
    chunk: 'clearing',
    result: '[aria-labelledby="clearing-result-title"]',
    export: {
      ar: 'نزّل ورقة عمل المقاصة',
      en: 'Download clearing workpaper',
    },
    // The example opens the ledger; the check runs it.
    run: (panel, lang) =>
      panel
        .getByRole('button', {
          name: lang === 'ar' ? 'افحص المقاصة' : 'Check clearing',
          exact: true,
        })
        .click(),
    decide: async (panel, lang) => {
      await panel
        .getByLabel(
          lang === 'ar' ? 'سبب قرار المراجعة' : 'Review decision reason',
          { exact: true },
        )
        .fill(NOTE[lang]);
      await panel
        .getByRole('button', {
          name: lang === 'ar' ? 'ألغ مقاصة المجموعة' : 'Reopen cleared group',
          exact: true,
        })
        .first()
        .click();
    },
    drop: scopeDrop,
  },
  ar: {
    chunk: 'ar',
    result: '[data-result-heading="result"]',
    export: {
      ar: 'نزّل ورقة عمل ذمم العملاء',
      en: 'Download AR workpaper',
    },
    decide: async (panel, lang) => {
      await panel
        .getByLabel(
          lang === 'ar' ? 'سبب مراجعة المستند' : 'Document review reason',
          { exact: true },
        )
        .fill(NOTE[lang]);
      await panel
        .getByRole('button', {
          name: lang === 'ar' ? 'أعد فتح زوج المستندات' : 'Reopen document pair',
          exact: true,
        })
        .first()
        .click();
    },
    drop: scopeDrop,
  },
  bank: {
    chunk: 'bank-movements',
    result: '[data-testid="bank-result"]',
    export: {
      ar: 'نزّل ورقة عمل حركات البنك',
      en: 'Download bank movement workpaper',
    },
    decide: async (panel, lang) => {
      await panel
        .getByLabel(lang === 'ar' ? 'مرجع الدليل' : 'Evidence reference', {
          exact: true,
        })
        .fill(lang === 'ar' ? 'مرجع اصطناعي للطباعة' : 'Synthetic print reference');
      await panel
        .getByLabel(
          lang === 'ar' ? 'سبب القرار أو الإلغاء' : 'Decision or undo reason',
          { exact: true },
        )
        .fill(NOTE[lang]);
      await panel
        .getByRole('button', {
          name:
            lang === 'ar'
              ? 'ألغ حالة الحركات كاملة'
              : 'Undo complete movement case',
          exact: true,
        })
        .first()
        .click();
    },
    drop: scopeDrop,
  },
  allocation: {
    chunk: 'allocation',
    result: '[data-testid="allocation-result"]',
    export: {
      ar: 'نزّل ورقة التخصيص',
      en: 'Download allocation workpaper',
    },
    decide: async (panel, lang) => {
      await panel
        .getByLabel(
          lang === 'ar' ? 'سبب القرار أو الإلغاء' : 'Decision or undo reason',
          { exact: true },
        )
        .fill(NOTE[lang]);
      for (const box of await panel
        .getByTestId('allocation-proof')
        .locator('input')
        .all())
        if (await box.isEnabled()) await box.check();
      await panel
        .getByRole('button', {
          name:
            lang === 'ar'
              ? 'اعتمد الخطوط المحددة كاملة'
              : 'Approve selected advice atomically',
          exact: true,
        })
        .click();
    },
    drop: scopeDrop,
  },
  'tb-financial': family(
    'financial',
    'tb-financial',
    { ar: 'صدّر الأدلة', en: 'Export evidence' },
    'payroll',
  ),
  intercompany: family(
    'intercompany',
    'intercompany',
    { ar: 'صدّر أدلة معاملات المنشآت', en: 'Export intercompany evidence' },
    'tb-financial',
  ),
  gateway: family(
    'payment-gateway',
    'gateway',
    { ar: 'صدّر أدلة بوابة الدفع', en: 'Export gateway evidence' },
    'intercompany',
  ),
  stock: family(
    'inventory',
    'stock',
    { ar: 'صدّر أدلة المخزون', en: 'Export inventory evidence' },
    'gateway',
  ),
  // The same workspace on its other path: the printed register.
  'stock-pdf': {
    ...family(
      'inventory',
      'stock',
      { ar: 'صدّر أدلة المخزون', en: 'Export inventory evidence' },
      'assets',
    ),
    panel: 'stock',
    load: openPrintedRegister,
  },
  assets: family(
    'fixed-assets',
    'assets',
    { ar: 'صدّر أدلة الأصول', en: 'Export asset evidence' },
    'stock',
  ),
  payroll: family(
    'payroll',
    'payroll',
    { ar: 'صدّر أدلة الرواتب', en: 'Export payroll evidence' },
    'assets',
  ),
};

const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

// The independent checker on a download and a printed table; its report, or
// its refusal's code.
function check(lang, xlsx, grid) {
  try {
    const report = execFileSync(
      'python3',
      ['-B', checker, '--print', lang, xlsx, grid],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { passed: true, report: JSON.parse(report) };
  } catch (error) {
    const said = String(error.stderr ?? '') + String(error.stdout ?? '');
    const code = /Fault: ([A-Z_]+)/.exec(said)?.[1] ?? null;
    return { passed: false, code, said: said.slice(-400) };
  }
}

// The printed table as the page lays it out: each row's cells with their
// text and the columns each covers.
const readTable = (page) =>
  page.evaluate(() => {
    const sheet = document.querySelector(
      '[data-domain-panel]:not([hidden]) [data-sheet-print]',
    );
    return {
      lang: sheet.getAttribute('lang'),
      dir: sheet.getAttribute('dir'),
      rows: [...sheet.querySelectorAll('tr')].map((tr) =>
        [...tr.cells].map((td) => ({ text: td.textContent, span: td.colSpan })),
      ),
    };
  });

// The page prints: the browser says so before it lays the page out for
// print and again after. What prints is read in between.
const whilePrinting = async (page, read) => {
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  try {
    return await read();
  } finally {
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  }
};
// Outside printing the table is not in the page; after a print it goes.
const notInPage = async (page) => {
  const until = Date.now() + 5000;
  const count = () => page.locator('[data-sheet-print]').count();
  while ((await count()) && Date.now() < until) await page.waitForTimeout(50);
  return count();
};

await mkdir(out, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
let activePage;
const watch = stageWatchdog({ page: () => activePage });
const results = [];
const errors = [];

// Every workspace by default; a comma-separated list in
// RECONCILIATION_SHEET_PRINT_ONLY runs only those (to work on one), and the
// result says so.
const only = process.env.RECONCILIATION_SHEET_PRINT_ONLY
  ? process.env.RECONCILIATION_SHEET_PRINT_ONLY.split(',')
  : null;
for (const name of only ?? [])
  assert.ok(name in WORKSPACES, `no workspace ${name} in the check`);
try {
  for (const [domain, spec] of Object.entries(WORKSPACES))
    for (const [lang, words] of Object.entries(LANGUAGES)) {
      if (only && !only.includes(domain)) continue;
      const stage = `${domain}/${lang}`;
      watch.at(`${stage}: example`);
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
      });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        return url.startsWith(base + '/') ||
          url.startsWith('blob:') ||
          url.startsWith('data:')
          ? route.continue()
          : route.abort();
      });
      // The sheet's modules are held back a moment, so the command is
      // pressed before the sheet is composed and has to wait for it.
      await context.route(/-sheet-[\w-]+\.js$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', (e) => errors.push(`${stage}: ${e.message}`));
      try {
        await page.goto(base + '/');
        await page
          .getByRole('button', { name: words.button, exact: true })
          .click();
        // Another workspace with a result of its own, kept hidden while this
        // one is shown: when the page prints, it draws nothing.
        const neighbour =
          spec.neighbour ?? (domain === 'gl-tb' ? 'supplier' : 'gl-tb');
        const kept = await openDomainWorkspace(
          page,
          WORKSPACES[neighbour].panel ?? neighbour,
          { advanced: true, requiredSources: false },
        );
        await kept.getByRole('button', { name: words.example }).first().click();
        if (WORKSPACES[neighbour].run)
          await WORKSPACES[neighbour].run(kept, lang);
        await kept
          .locator(WORKSPACES[neighbour].result)
          .waitFor({ timeout: 60000 });
        const panel = await openDomainWorkspace(page, spec.panel ?? domain, {
          advanced: true,
          requiredSources: false,
        });
        if (spec.load) await spec.load(panel, lang);
        else
          await panel
            .getByRole('button', { name: words.example })
            .first()
            .click();
        if (spec.run) await spec.run(panel, lang);
        await panel.locator(spec.result).waitFor({ timeout: 60000 });
        if (spec.ready) await spec.ready(panel, lang);

        // The command, pressed as soon as the result is shown.
        watch.at(`${stage}: command before the sheet`);
        // In place of the browser's print: its events around the moment the
        // page is laid out for print, and what is drawn in that moment.
        await page.evaluate(() => {
          window.printed = [];
          window.print = () => {
            dispatchEvent(new Event('beforeprint'));
            const sheet = document.querySelector(
              '[data-domain-panel]:not([hidden]) [data-sheet-print]',
            );
            window.printed.push({
              lang: sheet?.getAttribute('lang') ?? null,
              rows: sheet ? sheet.querySelectorAll('tr').length : 0,
              display: sheet ? getComputedStyle(sheet).display : null,
              tables: document.querySelectorAll('[data-sheet-print]').length,
            });
            dispatchEvent(new Event('afterprint'));
          };
        });
        const printed = async (n) => {
          const deadline = Date.now() + 15000;
          let seen = [];
          while (Date.now() < deadline) {
            seen = await page.evaluate(() => window.printed);
            if (seen.length >= n) break;
            await page.waitForTimeout(100);
          }
          return seen;
        };
        const press = async (name) => {
          await panel.getByRole('button', { name, exact: true }).focus();
          await page.keyboard.press('Enter');
        };
        // The command is offered with the result; a page without it fails
        // here by assertion, not by a timeout waiting for it.
        assert.equal(
          await panel
            .getByRole('button', { name: words.print, exact: true })
            .count(),
          1,
          `${stage}: the print command is offered with the result`,
        );
        await press(words.print);

        // The table is composed for the result and drawn when the page
        // prints; a page without it fails here by assertion, not by a
        // timeout.
        watch.at(`${stage}: composed`);
        const sheet = page.locator('[data-sheet-print]');
        const early = (await printed(1))[0];
        assert.ok(
          early?.rows > 0,
          `${stage}: the result's sheet is composed for print`,
        );
        assert.equal(
          early.display,
          'none',
          `${stage}: the table is never drawn on the screen, not even while the page prints`,
        );
        assert.equal(
          early.tables,
          1,
          `${stage}: while the page prints only the workspace on the screen draws its table`,
        );
        assert.deepEqual(
          { lang: early.lang, rows: early.rows },
          {
            lang,
            rows: await whilePrinting(page, () =>
              page.locator('[data-sheet-print] tr').count(),
            ),
          },
          `${stage}: pressed before the sheet is composed, the command waits and prints it whole`,
        );
        assert.equal(
          await notInPage(page),
          0,
          `${stage}: outside printing the table is not in the page`,
        );
        const loaded = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .map((e) => ({ name: e.name.split('/').pop(), at: e.startTime })),
        );
        const chunk = (re) => loaded.find((e) => re.test(e.name));
        assert.ok(
          chunk(new RegExp(`^${spec.chunk}-sheet-`)),
          `${stage}: the sheet is composed by its own module, loaded for it`,
        );

        // The download, checked against its evidence by the checker.
        watch.at(`${stage}: download`);
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60000 }),
          panel
            .getByRole('button', { name: spec.export[lang], exact: true })
            .click(),
        ]);
        const xlsx = path.join(out, `${domain}-${lang}.xlsx`);
        await download.saveAs(xlsx);

        // In print media: nothing visible but the table and the way to it.
        watch.at(`${stage}: print media`);
        await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
        await page.emulateMedia({ media: 'print' });
        const stray = await page.evaluate(() =>
          [...document.body.querySelectorAll('*')]
            .filter(
              (el) =>
                el.checkVisibility() &&
                !el.closest('[data-sheet-print]') &&
                !el.querySelector('[data-sheet-print]'),
            )
            .map((el) => `${el.tagName}.${el.className}`.slice(0, 80)),
        );
        assert.deepEqual(stray, [], `${stage}: only the sheet prints`);
        assert.ok(
          await sheet.evaluate((el) => el.checkVisibility()),
          `${stage}: the sheet prints`,
        );

        // The table against the download, by the independent checker.
        const table = await readTable(page);
        // No emulation after it, not screen: page.pdf lays out in the
        // emulated media.
        await page.emulateMedia({ media: null });
        await page.evaluate(() => dispatchEvent(new Event('afterprint')));
        const grid = path.join(out, `${domain}-${lang}.print.json`);
        await writeFile(grid, JSON.stringify(table));
        const agreed = check(lang, xlsx, grid);
        assert.ok(
          agreed.passed,
          `${stage}: the printed table is the downloaded sheet: ${agreed.code} ${agreed.said ?? ''}`,
        );
        // The checker refuses a table that is not the sheet.
        const find = (test) => {
          for (const [r, row] of table.rows.entries())
            for (const [c, cell] of row.entries())
              if (test(cell.text)) return [r, c];
          return null;
        };
        const first = (test) => {
          const at = find(test);
          if (!at) throw Error(`${stage}: no cell to plant in`);
          return at;
        };
        // An amount, or a count where the sheet has no amount (the bank
        // movement example's sheet counts cases and has no gap to state).
        const amount =
          find((t) => /^-?[\d,]+\.\d+$/.test(t)) ?? first((t) => /^\d+$/.test(t));
        // The fingerprint, or what the sheet writes in its place: the
        // supplier example's sources are built in memory, with no original
        // file, and its sheet says so on the fingerprint's row.
        const fingerprintAt = () => {
          const r = table.rows.findIndex((row) =>
            row.some((cell) => cell.text.includes('SHA-256')),
          );
          if (r < 0) return null;
          const label = table.rows[r].findIndex((cell) =>
            cell.text.includes('SHA-256'),
          );
          const c = table.rows[r].findIndex(
            (cell, at) => at > label && cell.text,
          );
          return c < 0 ? null : [r, c];
        };
        const hash =
          find((t) => /^[0-9a-f]{64}$/.test(t)) ??
          fingerprintAt() ??
          first(() => false);
        const plants = [
          {
            name: 'a row left out',
            code: 'PRINT_ROWS',
            plant: (g) => g.rows.pop(),
          },
          {
            name: 'a figure changed',
            code: 'PRINT_CELL',
            plant: (g) => (g.rows[amount[0]][amount[1]].text += '1'),
          },
          {
            name: 'a fingerprint cut',
            code: 'PRINT_CELL',
            plant: (g) =>
              (g.rows[hash[0]][hash[1]].text = g.rows[hash[0]][
                hash[1]
              ].text.slice(0, -1)),
          },
          {
            name: 'the other language',
            code: 'PRINT_LANGUAGE',
            plant: (g) => (g.lang = lang === 'ar' ? 'en' : 'ar'),
          },
        ];
        for (const { name, code, plant } of plants) {
          const wrong = structuredClone(table);
          plant(wrong);
          const planted = path.join(out, `${domain}-${lang}.planted.json`);
          await writeFile(planted, JSON.stringify(wrong));
          const refused = check(lang, xlsx, planted);
          assert.ok(
            !refused.passed && refused.code === code,
            `${stage}: the checker refuses ${name} with ${code}, got ${String(refused.code)}`,
          );
        }

        // The pages: each row carries a marker the PDF gives back in order,
        // out of the flow so the layout is the same.
        // page.pdf fires beforeprint and afterprint itself; the markers are
        // written by a listener the check adds after the page's own, so the
        // table is drawn when they are written.
        watch.at(`${stage}: pages`);
        await page.evaluate(() => {
          window.markRows = () =>
            document
              .querySelectorAll(
                '[data-domain-panel]:not([hidden]) [data-sheet-print] tr',
              )
              .forEach((tr, i) => {
                const mark = document.createElement('span');
                mark.dataset.printMark = '';
                mark.textContent = ` R${i}R `;
                mark.style.cssText =
                  'position:absolute;font:3px monospace;color:#fff;';
                tr.cells[0].prepend(mark);
              });
          addEventListener('beforeprint', window.markRows);
        });
        const groups = await whilePrinting(page, () =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll(
                '[data-domain-panel]:not([hidden]) [data-sheet-print] tbody',
              ),
            ].map((tbody) => ({
              keep: tbody.hasAttribute('data-sheet-keep'),
              rows: tbody.rows.length,
            })),
          ),
        );
        // Each row's page in a print; every row printed once; and a kept
        // group over two pages only where it starts at the top of one.
        const paged = async (name) => {
          const pdf = path.join(out, `${domain}-${lang}${name}.pdf`);
          await page.pdf({ path: pdf, preferCSSPageSize: true });
          const doc = await getDocumentProxy(
            new Uint8Array(await readFile(pdf)),
          );
          const onPage = [];
          for (let p = 1; p <= doc.numPages; p++) {
            const text = (await (await doc.getPage(p)).getTextContent()).items
              .map((item) => item.str)
              .join(' ');
            onPage.push(
              [...text.matchAll(/R(\d+)R/g)].map((m) => Number(m[1])),
            );
          }
          assert.deepEqual(
            [...new Set(onPage.flat())].sort((a, b) => a - b),
            table.rows.map((_, i) => i),
            `${stage}${name}: every row is printed, once`,
          );
          const pageOf = (r) => onPage.findIndex((p) => p.includes(r));
          let at = 0;
          for (const group of groups) {
            const rows = Array.from({ length: group.rows }, (_, i) => at + i);
            at += group.rows;
            if (!group.keep) continue;
            const pages = new Set(rows.map(pageOf));
            const top = Math.min(...onPage[pageOf(rows[0])]) === rows[0];
            assert.ok(
              pages.size === 1 || top,
              `${stage}${name}: rows ${rows[0]} to ${rows.at(-1)} kept together are not split`,
            );
          }
          return onPage;
        };
        const onPage = await paged('');
        // A small page puts the breaks in more places.
        const small = await page.addStyleTag({
          content: '@media print { @page { size: 148mm 160mm; } }',
        });
        const onSmall = await paged('-small');
        await small.evaluate((style) => style.remove());
        await page.evaluate(() =>
          removeEventListener('beforeprint', window.markRows),
        );
        assert.equal(
          await notInPage(page),
          0,
          `${stage}: after the page prints the table is gone from it`,
        );

        // The command prints the drawn table, from the keyboard; and right
        // after a change of language, before the table is composed again,
        // it waits for it and prints it in that language.
        watch.at(`${stage}: command`);
        await press(words.print);
        assert.deepEqual(
          (await printed(2))[1],
          { lang, rows: table.rows.length, display: 'none', tables: 1 },
          `${stage}: the command prints the sheet`,
        );
        assert.equal(
          await notInPage(page),
          0,
          `${stage}: after the command prints the table is gone from the page`,
        );
        watch.at(`${stage}: language`);
        const otherLang = lang === 'ar' ? 'en' : 'ar';
        // The page printed by the browser in the same moment as the change,
        // before the table is composed again: what it draws is never the
        // table composed in the language left.
        const switcher = await page
          .getByRole('button', {
            name: LANGUAGES[otherLang].button,
            exact: true,
          })
          .elementHandle();
        const atTheChange = await switcher.evaluate((button) => {
          button.click();
          dispatchEvent(new Event('beforeprint'));
          const drawn = document
            .querySelector('[data-domain-panel]:not([hidden]) [data-sheet-print]')
            ?.getAttribute('lang');
          dispatchEvent(new Event('afterprint'));
          return drawn ?? null;
        });
        assert.notEqual(
          atTheChange,
          lang,
          `${stage}: a table composed in one language is never printed after a change to the other`,
        );
        await press(LANGUAGES[otherLang].print);
        assert.equal(
          (await printed(3))[2]?.lang,
          otherLang,
          `${stage}: printed at once after a change of language, the sheet is in that language`,
        );
        assert.equal(
          (await whilePrinting(page, () => readTable(page))).rows[0][0].text,
          LANGUAGES[otherLang].title,
          `${stage}: the table is composed again in the other language`,
        );
        await page
          .getByRole('button', { name: words.button, exact: true })
          .click();

        // After a decision the table is composed again and is the sheet the
        // page downloads then, by the independent checker.
        let decided = null;
        if (spec.decide) {
          watch.at(`${stage}: decided`);
          await spec.decide(panel, lang);
          const until = Date.now() + 20000;
          const carries = () =>
            whilePrinting(page, () =>
              page.evaluate(
                (note) =>
                  !!document
                    .querySelector(
                      '[data-domain-panel]:not([hidden]) [data-sheet-print]',
                    )
                    ?.textContent.includes(note),
                NOTE[lang],
              ),
            );
          while (!(await carries()) && Date.now() < until)
            await page.waitForTimeout(100);
          const after = await whilePrinting(page, () => readTable(page));
          assert.ok(
            after.rows.some((row) =>
              row.some((cell) => cell.text.includes(NOTE[lang])),
            ),
            `${stage}: after a decision the table carries its reason`,
          );
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            panel
              .getByRole('button', { name: spec.export[lang], exact: true })
              .click(),
          ]);
          const xlsx = path.join(out, `${domain}-${lang}-decided.xlsx`);
          await download.saveAs(xlsx);
          const grid = path.join(out, `${domain}-${lang}-decided.print.json`);
          await writeFile(grid, JSON.stringify(after));
          const again = check(lang, xlsx, grid);
          assert.ok(
            again.passed,
            `${stage}: after a decision the printed table is the downloaded sheet: ${again.code} ${again.said ?? ''}`,
          );
          decided = { rows: after.rows.length, cells: again.report.cells };
        }

        // No table once its result is gone.
        watch.at(`${stage}: dropped`);
        await spec.drop(panel, lang);
        const gone = Date.now() + 10000;
        while ((await panel.locator(spec.result).count()) && Date.now() < gone)
          await page.waitForTimeout(100);
        assert.equal(
          await panel.locator(spec.result).count(),
          0,
          `${stage}: the change drops the result`,
        );
        assert.equal(
          await whilePrinting(page, () =>
            panel.locator('[data-sheet-print]').count(),
          ),
          0,
          `${stage}: no table once its result is gone, even while the page prints`,
        );
        // Nor the command: gone with the result, or closed as the export
        // beside it is.
        const command = panel.getByRole('button', {
          name: words.print,
          exact: true,
        });
        assert.ok(
          !(await command.count()) || (await command.isDisabled()),
          `${stage}: once its result is gone the print command is not offered`,
        );

        results.push({
          domain,
          lang,
          rows: table.rows.length,
          cells: agreed.report.cells,
          pages: onPage.length,
          firstRowOnEachPage: onPage.map((p) => Math.min(...p)),
          smallPages: onSmall.length,
          groups: groups.filter((g) => g.keep).length,
          decided,
          sheetChunks: loaded
            .filter((e) => /-sheet-/.test(e.name))
            .map((e) => e.name),
          exceljsJszipWithThePage: ['exceljs', 'jszip'].every((n) =>
            loaded.some(
              (e) =>
                e.name.startsWith(n) &&
                e.at < chunk(new RegExp(`^${spec.chunk}-sheet-`)).at,
            ),
          ),
        });
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        await context.close();
      }
    }
  assert.deepEqual(errors, [], 'no page error');
} finally {
  watch.stop();
  await browser.close();
  server.close();
}
await writeFile(
  path.join(out, 'result.json'),
  JSON.stringify({ passed: true, only, prints: results }, null, 1),
);
console.log(JSON.stringify({ passed: true, only, prints: results.length }));
