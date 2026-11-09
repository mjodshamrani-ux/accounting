// UX-6(d): the reconciliation sheet on paper says what the downloaded sheet
// says, and nothing else prints.
//
// In each workspace with its print, in Arabic and in English, the check runs
// the workspace's own synthetic example and requires:
// - the print table to exist for the result and never to be drawn on the
//   screen;
// - in print media, nothing visible but the table and the way down to it;
// - the table to equal the first sheet of the workbook the page downloads,
//   row for row and cell for cell, as the independent checker reads the
//   workbook (audit/reconciliation-sheet/check_sheet.py --print, which also
//   checks the download against its own evidence sheets); and the checker to
//   refuse a table with a row left out, an amount changed, a fingerprint cut
//   or the other language, so its agreement means something;
// - the printed A4 pages counted and recorded; and on A4 and on a small
//   page, where breaks fall in more places, no group the sheet keeps
//   together split over two pages unless it starts at the top of one (a
//   group taller than a page), read from a marker the check writes in each
//   row (Arabic text does not come back from the PDF in order);
// - the chunks loaded to compose the sheet recorded, and whether ExcelJS and
//   JSZip were already loaded with the page;
// - the print command, from the keyboard, pressed as soon as the result is
//   shown while the sheet's module is held back, to wait and print the
//   whole sheet; the table to follow a change of language, never drawn
//   beside the command in the other language after the change, and the
//   command pressed at once after it to print it in that language; and no
//   table once the result it was composed for is gone.
//
// Synthetic examples only. The check reads the screen and the download; it
// does not prove a printer, another browser or a device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { getDocumentProxy } from 'unpdf';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { stageWatchdog } from './stage-watchdog.mjs';

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

// Each workspace with its print: how its example runs, which button
// downloads its workpaper, and a change that drops its result.
const WORKSPACES = {
  'gl-tb': {
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
    const sheet = document.querySelector('[data-sheet-print]');
    return {
      lang: sheet.getAttribute('lang'),
      dir: sheet.getAttribute('dir'),
      rows: [...sheet.querySelectorAll('tr')].map((tr) =>
        [...tr.cells].map((td) => ({ text: td.textContent, span: td.colSpan })),
      ),
    };
  });

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

try {
  for (const [domain, spec] of Object.entries(WORKSPACES))
    for (const [lang, words] of Object.entries(LANGUAGES)) {
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
        const panel = await openDomainWorkspace(page, domain, {
          advanced: true,
          requiredSources: false,
        });
        await panel
          .getByRole('button', { name: words.example })
          .first()
          .click();
        await panel.locator(spec.result).waitFor({ timeout: 60000 });

        // The command, pressed as soon as the result is shown.
        watch.at(`${stage}: command before the sheet`);
        await page.evaluate(() => {
          window.printed = [];
          window.print = () => {
            const sheet = document.querySelector('[data-sheet-print]');
            window.printed.push({
              lang: sheet?.getAttribute('lang') ?? null,
              rows: sheet ? sheet.querySelectorAll('tr').length : 0,
            });
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

        // The table is composed for the result; a page without it fails
        // here by assertion, not by a timeout.
        watch.at(`${stage}: composed`);
        const sheet = page.locator('[data-sheet-print]');
        const until = Date.now() + 20000;
        while (!(await sheet.count()) && Date.now() < until)
          await page.waitForTimeout(100);
        assert.equal(
          await sheet.count(),
          1,
          `${stage}: the result's sheet is composed for print`,
        );
        assert.equal(
          await sheet.evaluate((el) => getComputedStyle(el).display),
          'none',
          `${stage}: the table is never drawn on the screen`,
        );
        assert.deepEqual(
          (await printed(1))[0],
          {
            lang,
            rows: await page.locator('[data-sheet-print] tr').count(),
          },
          `${stage}: pressed before the sheet is composed, the command waits and prints it whole`,
        );
        const loaded = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .map((e) => ({ name: e.name.split('/').pop(), at: e.startTime })),
        );
        const chunk = (re) => loaded.find((e) => re.test(e.name));
        assert.ok(
          chunk(new RegExp(`^${domain}-sheet-`)),
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
        const grid = path.join(out, `${domain}-${lang}.print.json`);
        await writeFile(grid, JSON.stringify(table));
        const agreed = check(lang, xlsx, grid);
        assert.ok(
          agreed.passed,
          `${stage}: the printed table is the downloaded sheet: ${agreed.code} ${agreed.said ?? ''}`,
        );
        // The checker refuses a table that is not the sheet.
        const first = (test) => {
          for (const [r, row] of table.rows.entries())
            for (const [c, cell] of row.entries())
              if (test(cell.text)) return [r, c];
          throw Error(`${stage}: no cell to plant in`);
        };
        const amount = first((t) => /^-?[\d,]+\.\d+$/.test(t));
        const hash = first((t) => /^[0-9a-f]{64}$/.test(t));
        const plants = [
          {
            name: 'a row left out',
            code: 'PRINT_ROWS',
            plant: (g) => g.rows.pop(),
          },
          {
            name: 'an amount changed',
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
        watch.at(`${stage}: pages`);
        await page.evaluate(() => {
          [...document.querySelectorAll('[data-sheet-print] tr')].forEach(
            (tr, i) => {
              const mark = document.createElement('span');
              mark.dataset.printMark = '';
              mark.textContent = ` R${i}R `;
              mark.style.cssText =
                'position:absolute;font:3px monospace;color:#fff;';
              tr.cells[0].prepend(mark);
            },
          );
        });
        const groups = await page.evaluate(() =>
          [...document.querySelectorAll('[data-sheet-print] tbody')].map(
            (tbody) => ({
              keep: tbody.hasAttribute('data-sheet-keep'),
              rows: tbody.rows.length,
            }),
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
          document
            .querySelectorAll('[data-print-mark]')
            .forEach((m) => m.remove()),
        );

        // The command prints the drawn table, from the keyboard; and right
        // after a change of language, before the table is composed again,
        // it waits for it and prints it in that language.
        watch.at(`${stage}: command`);
        await page.emulateMedia({ media: 'screen' });
        await press(words.print);
        assert.deepEqual(
          (await printed(2))[1],
          { lang, rows: table.rows.length },
          `${stage}: the command prints the sheet`,
        );
        watch.at(`${stage}: language`);
        const otherLang = lang === 'ar' ? 'en' : 'ar';
        // From the change on, after every change to the page: a table drawn
        // beside the command must be the one composed in the command's
        // language, never the one composed before the change.
        await page.evaluate((commands) => {
          window.sheetLanguages = { seen: [], wrong: [] };
          const look = () => {
            const panel = document.querySelector(
              '[data-domain-panel]:not([hidden])',
            );
            const sheet = panel?.querySelector('[data-sheet-print]');
            const command = [...(panel?.querySelectorAll('button') ?? [])]
              .map((b) => b.textContent.trim())
              .find((text) => Object.values(commands).includes(text));
            if (!sheet || !command) return;
            const said = Object.keys(commands).find(
              (l) => commands[l] === command,
            );
            const drawn = sheet.getAttribute('lang');
            window.sheetLanguages.seen.push(said);
            if (drawn !== said)
              window.sheetLanguages.wrong.push({ command: said, sheet: drawn });
          };
          window.sheetWatch = new MutationObserver(look);
          window.sheetWatch.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
        }, Object.fromEntries(
          Object.entries(LANGUAGES).map(([l, w]) => [l, w.print]),
        ));
        await page
          .getByRole('button', {
            name: LANGUAGES[otherLang].button,
            exact: true,
          })
          .click();
        await press(LANGUAGES[otherLang].print);
        assert.equal(
          (await printed(3))[2]?.lang,
          otherLang,
          `${stage}: printed at once after a change of language, the sheet is in that language`,
        );
        assert.equal(
          (await readTable(page)).rows[0][0].text,
          LANGUAGES[otherLang].title,
          `${stage}: the table is composed again in the other language`,
        );
        const languages = await page.evaluate(() => {
          window.sheetWatch.disconnect();
          return window.sheetLanguages;
        });
        assert.ok(
          languages.seen.includes(otherLang),
          `${stage}: the table was watched beside the command in the other language`,
        );
        assert.deepEqual(
          languages.wrong,
          [],
          `${stage}: a table composed in one language is never drawn beside the other's command`,
        );
        await page
          .getByRole('button', { name: words.button, exact: true })
          .click();

        // No table once its result is gone.
        watch.at(`${stage}: dropped`);
        await spec.drop(panel);
        const gone = Date.now() + 10000;
        while ((await panel.locator(spec.result).count()) && Date.now() < gone)
          await page.waitForTimeout(100);
        assert.equal(
          await panel.locator(spec.result).count(),
          0,
          `${stage}: the change drops the result`,
        );
        assert.equal(
          await sheet.count(),
          0,
          `${stage}: no table once its result is gone`,
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
          sheetChunks: loaded
            .filter((e) => /-sheet-/.test(e.name))
            .map((e) => e.name),
          exceljsJszipWithThePage: ['exceljs', 'jszip'].every((n) =>
            loaded.some(
              (e) =>
                e.name.startsWith(n) &&
                e.at < chunk(new RegExp(`^${domain}-sheet-`)).at,
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
  JSON.stringify({ passed: true, prints: results }, null, 1),
);
console.log(JSON.stringify({ passed: true, prints: results.length }));
