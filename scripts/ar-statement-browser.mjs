// AR-1 PDF A4: the printed customer statement in the built AR workspace,
// through the real worker, as an accountant uses it. For sealed stories in
// Arabic and English, at desktop and phone widths: open the ledger CSV and the
// statement PDF with the native file input, map and confirm the ledger,
// confirm the statement's role and the scope, compare; then check what is
// on screen against the sealed EXPECTED.json (matched pairs, the sections and
// which one is compared, the reasons matching is held), download the workpaper
// and the session, have the independent checker judge the workpaper, and
// restore the session. One story is opened with the keyboard alone, one has a
// decision recorded and checked in its workpaper, and one has its statement
// replaced to show the old result is not kept.
//   pnpm build && node --experimental-strip-types scripts/ar-statement-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/ar-statement-foundation');
const frozen = path.join(suite, 'frozen');
const out = path.resolve(
  process.env.AR_STATEMENT_BROWSER_DIR ||
    path.join(root, 'work/ar-statement-browser'),
);
await mkdir(out, { recursive: true });
const facts = JSON.parse(
  await readFile(path.join(frozen, 'stories.json'), 'utf8'),
);
const expected = JSON.parse(
  await readFile(path.join(frozen, 'EXPECTED.json'), 'utf8'),
).stories;
const story = (id) => facts.stories.find((s) => s.id === id);
// A private build and a quick pass, for the interface mutation gate.
const dist = path.resolve(process.env.AR_STATEMENT_DIST || path.join(root, 'dist'));
const quick = process.env.AR_STATEMENT_BROWSER_QUICK === '1';
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
const check = (id, file, reopened = []) =>
  JSON.parse(
    execFileSync(
      'python3',
      [
        '-B',
        path.join(suite, 'check_export.py'),
        id,
        file,
        ...(reopened.length ? ['--reopened', ...reopened] : []),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
// Matched, out of scope, scope not found, scope repeated, Arabic, a line error.
const ids = quick
  ? ['A03', 'A16', 'A09']
  : ['A01', 'A03', 'A16', 'A15', 'A12', 'A09'];
const contexts = quick
  ? [['en', 1440]]
  : [
      ['ar', 1440],
      ['en', 1440],
      ['ar', 390],
    ];
const runs = [];
const errors = [];
const external = [];
try {
  for (const [lang, width] of contexts) {
    const copy = (lang === 'ar' ? ar : en).arDocuments;
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      acceptDownloads: true,
      reducedMotion: 'reduce',
    });
    context.setDefaultTimeout(60000);
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.startsWith(origin + '/') ||
        url.startsWith('blob:') ||
        url.startsWith('data:')
      )
        return route.continue();
      external.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    // One chooser listener for the page: a listener per chooser races the key.
    const choosers = [];
    page.on('filechooser', (chooser) => choosers.push(chooser));
    page.on('pageerror', (error) =>
      errors.push({ lang, width, message: error.message }),
    );
    await page.goto(origin);
    if (lang === 'en')
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
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
    const openStatement = async (id, keyboard) => {
      const input = w.getByTestId('ar-source-1').locator('input[type="file"]');
      const file = path.join(frozen, `${id}-statement.pdf`);
      if (keyboard) {
        const seen = choosers.length;
        await input.focus();
        await page.keyboard.press('Enter');
        for (let tries = 0; choosers.length === seen && tries < 100; tries++)
          await page.waitForTimeout(50);
        assert.equal(choosers.length, seen + 1, 'file chooser by Enter');
        await choosers.at(-1).setFiles(file);
      } else await input.setInputFiles(file);
      await wait();
    };
    const compare = async (id, { keyboard = false } = {}) => {
      const s = story(id);
      const ledger = w.getByTestId('ar-source-0');
      // The ledger is a table: a PDF offered there is refused.
      await ledger
        .locator('input[type="file"]')
        .setInputFiles(path.join(frozen, `${id}-statement.pdf`));
      await wait();
      assert.equal(await w.getByRole('alert').count(), 1, `${id} PDF ledger refused`);
      assert.equal(await ledger.locator('[data-ar-statement-pdf]').count(), 0);
      await ledger
        .locator('input[type="file"]')
        .setInputFiles(path.join(frozen, `${id}-ledger.csv`));
      await wait();
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
        await ledger
          .getByLabel(`${copy.sides[0]}: ${copy.fields[field]}`, { exact: true })
          .selectOption(String(position));
      await ledger.getByRole('checkbox').check();
      await openStatement(id, keyboard);
      const statement = w.getByTestId('ar-source-1');
      assert.ok(await statement.locator('[data-ar-statement-pdf]').isVisible());
      // A printed statement has no columns or family to choose.
      assert.equal(await statement.locator('select').count(), 0, `${id} selects`);
      const confirm = statement.getByRole('checkbox');
      assert.equal(await confirm.isChecked(), false, `${id} role unconfirmed`);
      if (keyboard) {
        await confirm.focus();
        await page.keyboard.press('Space');
      } else await confirm.check();
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
          .fill(s.scope[field]);
      await w.getByLabel(copy.scopeConfirm, { exact: true }).check();
      if (keyboard) {
        await button(copy.run).focus();
        await page.keyboard.press('Enter');
      } else await button(copy.run).click();
      await wait();
      assert.equal(await w.getByRole('alert').count(), 0, `${lang}/${id} alert`);
    };
    const judge = async (id) => {
      const want = expected[id];
      assert.equal(Number(await metric(copy.matched)), want.matched, `${id} matched`);
      assert.equal(
        await w.locator('[data-ar-status]').count(),
        want.status === 'source-error' ? 1 : 0,
        `${id} status`,
      );
      const sections = w.locator('[data-ar-statement-sections] tbody tr');
      assert.equal(await sections.count(), want.sections.length, `${id} sections`);
      for (const [i, s] of want.sections.entries())
        assert.equal(
          (await sections.nth(i).locator('[data-ar-section-status]').innerText()).trim(),
          s.compared
            ? copy.sectionCompared
            : s.scope
              ? copy.sectionOther
              : copy.sectionUnreadable,
          `${id} section ${i + 1}`,
        );
      const holds = await w
        .locator('[data-ar-holds] li')
        .evaluateAll((items) => items.map((i) => i.getAttribute('data-ar-hold')));
      assert.deepEqual(
        [...new Set(holds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        want.errorCodes,
        `${id} holds`,
      );
      for (const code of want.errorCodes)
        assert.ok(
          (await w.locator(`[data-ar-hold="${code}"]`).first().innerText()).includes(
            copy.issue[code] ?? copy.issue.other,
          ),
          `${id} ${code} text`,
        );
      // Printed lines are named by their page and line.
      assert.ok(
        await w
          .locator('td', { hasText: `${copy.page} 1 · ${copy.line} 1` })
          .first()
          .isVisible(),
        `${id} printed place`,
      );
      const overflow = await w.evaluate(
        (element) =>
          element.getBoundingClientRect().width > innerWidth + 1 ||
          document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(overflow, false, `${lang}/${width}/${id} overflow`);
    };
    for (const id of ids) {
      const keyboard = id === 'A03' && lang === 'en';
      await compare(id, { keyboard });
      await judge(id);
      const workbook = path.join(out, `${lang}-${width}-${id}.xlsx`);
      const session = path.join(out, `${lang}-${width}-${id}.json`);
      await download(copy.export, workbook);
      await download(copy.save, session);
      const checked = check(id, workbook);
      // Restoring the session gives the same result on screen.
      const before = await metric(copy.matched);
      await w.getByLabel(copy.restore, { exact: true }).setInputFiles(session);
      await wait();
      assert.equal(await metric(copy.matched), before, `${id} restored`);
      await judge(id);
      runs.push({ lang, width, id, keyboard, checked });
    }
    // A decision recorded on screen reaches the workpaper.
    await compare('A01');
    await w.getByLabel(copy.note, { exact: true }).fill('Customer disputes the invoice date');
    const first = w.getByTestId('ar-case').filter({ hasText: 'INV-1001' });
    await first.getByRole('button', { name: copy.reopen, exact: true }).click();
    await wait();
    assert.equal(Number(await metric(copy.matched)), expected.A01.matched - 1);
    const decided = path.join(out, `${lang}-${width}-A01-reopened.xlsx`);
    await download(copy.export, decided);
    runs.push({ lang, width, id: 'A01-reopened', checked: check('A01', decided, ['INV-1001']) });
    // Replacing the statement drops the result made from the old one.
    await openStatement('A04');
    assert.equal(await w.locator('[data-ar-statement-sections]').count(), 0, 'stale result');
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
assert.deepEqual(errors, []);
assert.deepEqual(external, []);
const summary = {
  runs: runs.length,
  stories: ids,
  contexts: contexts.map(([lang, width]) => `${lang}-${width}`),
  checked: runs.every((r) => r.checked.story),
};
await writeFile(path.join(out, 'summary.json'), JSON.stringify({ summary, runs }, null, 1));
console.log(JSON.stringify(summary));
