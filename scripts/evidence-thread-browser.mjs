// UX-10(c): the evidence thread in the built application, on the bank
// movements. Two synthetic files, written here with 30 movements a side, are
// compared, and one movement is followed in English and in Arabic at 1440,
// 1024 and 390 px, with motion and with reduced motion:
// - its way in names the movement and says whether its evidence is open;
// - opening it takes the focus to the drawer's heading, in a region named by
//   it, fixed at the inline end of the screen (at its bottom below 1024 px);
//   the table does not move and the row stays marked;
// - the drawer names the side, the file and the row the movement was read
//   from, its amount as the table shows it, and its cells, each the text the
//   file holds at that column, read here with this check's own split;
// - from 1024 px no way in is under the drawer; below it, what the page
//   brings into view stops above the sheet;
// - with motion it slides in for 160 ms; with reduced motion it is there at
//   once;
// - Escape closes it and returns the focus to the same way in; the way back
//   does the same on the movement's own page after the table was turned;
// - another run and a change of type each close it.
// Then (UX-10(d)) in the fixed assets and the payroll, with their examples,
// whose files are frozen cases read here: in English and Arabic at 1440,
// 1024 and 390 px, every comparison opens the GL row of its account (and
// component) and then exactly the register rows whose mapping names that
// account and component, each cell as the file holds it, with the table's
// figures; the payroll register net opens every bank payout row; Escape and
// the way back close it, and a change of type does too.
// And in the inventory, with the sealed INV-3 story L26, whose four files
// are read through the workspace's own file inputs: in English at 1440 px
// and in Arabic at 390 px, each register row that does not link opens
// itself, then the mapping, policy evidence and GL rows the sealed
// expectations name for it (EXPECTED.json, from the story's own oracle, not
// from the engine), each cell as the file holds it, read here with this
// check's own CSV reader, for two of the files quote every field.
// And in the GL and TB comparison, with the frozen case positive: each
// balance component opens every GL row of its kind (opening, movement or
// closing, read from the file here), then the TB row, each with the one cell
// of its column, and the drawer's three figures are the table's.
// And in the clearing and the receivables, each case opens its movements.
// And in the financial position: each statement line opens its own row,
// then the trial-balance, mapping and evidence rows of each member, held to
// the files; in the example (the frozen case whole-post-closing) they are
// the sealed rows; in a story of 57 lines written here with those rows in
// other orders, they are worked out from the files; its line headings are
// marked, a decision closes the drawer, and the way back returns over pages.
// And in the intercompany pairs, the same way: each pair opens its
// relationship row, every ledger row it names and its timing evidence; the
// example (the frozen case pending) at its sealed rows, and a story of 54
// pairs written here, with one-sided pairs, timing evidence and a
// transaction written twice, at the rows worked out from its files.
// And in the payment gateway, whose batch has two tables of one row: the
// totals open the transaction and fee rows they sum, the residuals every row
// of the batch, worked out from the files (and in the example, the frozen
// case pending, held to its seal); the signed example too; a decision
// closes the drawer; and a batch of sixty transactions with a row of empty
// cells, uploaded through the inputs, opens every row but that one.
// And in the supplier comparison, whose list has a row for each case: in
// every tab and on every page, each case opens every row the engine traced
// for it, from both files, each cell as the file holds it; the cases of the
// three lists draw every row of both files once. The example (the page's
// own files) in English at 1440 px and in Arabic at 390 px with reduced
// motion; a story of 81 rows written here and uploaded through the inputs,
// whose matched list spans two pages, and the way back over them. Another
// tab, a search, leaving the review step and a change of type close it.
// And in the allocation's value ledger: each payment or invoice opens the row
// it was read from, with its two traced cells and its four figures; the
// example, then a story of 63 items over two pages with its columns in other
// orders; a decision closes it.
// And in the GL/TB sections panel (GLT-1c): each account opens the row that
// opens each of its GL sections and each of its TB rows, worked out here from
// the files, every cell by its column; sealed stories on two pages, in
// Arabic at 390 px and from a holdout; opening it closes the drawer above and
// the other way round; folding the panel, another run and a change of type
// close it.
// And in the long payroll register panel (PAY-1c): each employee opens every
// row the engine placed under it, by its place, headed by the sealed line at
// that row, with the sealed figures; a story of 120 employees over three
// pages, a held employee in Arabic at 390 px, and two holdouts; the same
// one drawer, folding, another run and a change of type.
//   node scripts/evidence-thread-browser.mjs
// EVIDENCE_THREAD_DIST names another build (a mutation gate's copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { demoFiles } from '../lib/reconciliation/demo.ts';
import { stageWatchdog } from './stage-watchdog.mjs';

// A run that stalls, an action or a wait that times out (DEV-117), says what
// the page was doing before it fails as it would have: whether the page
// still answers, which regions are busy, and what alerts it shows. Any other
// error fails as before, unchanged; the exit code is 1 either way.
let stalledPage = null;
process.on('uncaughtException', async (error) => {
  if (error?.name === 'TimeoutError' && stalledPage) {
    const state = await Promise.race([
      stalledPage
        .evaluate(() => ({
          answers: true,
          busy: [...document.querySelectorAll('[aria-busy]')].map((e) =>
            [e.tagName, e.className, e.getAttribute('aria-busy')].join(' '),
          ),
          alerts: [...document.querySelectorAll('[role="alert"]')].map((e) =>
            e.textContent.trim().slice(0, 200),
          ),
          drawer: !!document.querySelector('[data-evidence-drawer]'),
          focus: document.activeElement?.tagName ?? null,
        }))
        .catch((e) => ({ answers: false, error: e.message })),
      new Promise((done) =>
        setTimeout(() => done({ answers: false, error: 'no answer in 5 s' }), 5000),
      ),
    ]);
    console.error(`Stalled; the page then: ${JSON.stringify(state)}`);
  }
  console.error(error);
  process.exit(1);
});
const root = path.resolve(process.env.EVIDENCE_THREAD_DIST ?? 'dist');
const out = path.resolve(
  process.env.EVIDENCE_THREAD_DIR ?? 'work/qa-evidence-thread',
);
await mkdir(out, { recursive: true });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('outside');
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
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});

// The words the reader meets, as the copy writes them.
const words = {
  en: {
    way: 'Review source cells',
    evidence: 'Source cell evidence',
    back: 'Back to the movement in its table',
    sides: ['Bank statement', 'Cashbook'],
    table: 'Original movements',
    previous: 'Previous page',
    next: 'Next page',
  },
  ar: {
    way: 'راجع خلايا المصدر',
    evidence: 'دليل خلايا المصدر',
    back: 'عُد إلى الحركة في جدولها',
    sides: ['كشف البنك', 'دفتر النقدية'],
    table: 'الحركات الأصلية',
    previous: 'الصفحة السابقة',
    next: 'الصفحة التالية',
  },
};

// Two synthetic sources in the settlement template, written here; the check
// reads them back with its own split (the files hold no quotes).
const header =
  'Record ID,Settlement ID,Movement date,Value date,Cash direction,Role,Parent payment ID,Reverses record ID,Policy,Status,Entity,Ledger,Bank account,Currency,Period start,Period end,Amount';
const files = [0, 1].map((side) => {
  const lines = [header];
  for (let i = 1; i <= 30; i++)
    lines.push(
      `${side ? 'L' : 'B'}${i},S${i},2026-09-15,2026-09-16,outflow,principal,,,individual,${side ? 'posted' : 'booked'},Synthetic Cash Owner,Primary Book,BANK-001,SAR,2026-09-01,2026-09-30,${1000 + i}.${String(i).padStart(2, '0')}`,
    );
  return { name: `thread-${side}.csv`, text: `${lines.join('\n')}\n` };
});
for (const f of files) await writeFile(path.join(out, f.name), f.text);
const fileRows = files.map((f) =>
  f.text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(',')),
);
// The file row of a movement: its side and its own reference.
const sourceRow = (side, own) => {
  const at = fileRows[side].findIndex((r, i) => i > 0 && r[0] === own);
  assert.ok(at > 0, `${own} is a row of ${files[side].name}`);
  return { number: at + 1, cells: fileRows[side][at] };
};

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
context.setDefaultTimeout(20000);
const page = await context.newPage();
stalledPage = page;
// A wait that has no timeout of its own, such as an evaluate on a page that
// stops drawing frames (DEV-95), is stopped after four minutes on one stage,
// with the stage and the page's state; it would otherwise stop only at the
// gate's own limit, with nothing printed.
const watch = stageWatchdog({ page: () => stalledPage });
watch.at('bank: the files');
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(base);
if ((await page.evaluate(() => document.documentElement.lang)) !== 'en')
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
watch.at('bank: open the workspace');
await openDomainWorkspace(page, 'bank');
for (const side of [0, 1]) {
  const source = page.getByTestId(`bank-source-${side}`);
  await source
    .getByLabel(words.en.sides[side], { exact: true })
    .setInputFiles(path.join(out, files[side].name));
  await source.getByText(files[side].name, { exact: true }).waitFor();
}
await page.evaluate(
  () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
);
const workspace = page.locator('main.bank-workspace');
const run = async () => {
  const confirm = workspace.getByLabel(
    'I reviewed the bank statement and the cashbook',
    { exact: false },
  );
  if (!(await confirm.isChecked())) await confirm.check();
  await workspace
    .getByRole('button', { name: 'Compare bank movements', exact: true })
    .click();
};
await run();
await page.getByTestId('bank-result').waitFor();

const drawer = page.locator('[data-evidence-drawer]');
const movements = page.locator('[data-bank-movement-table="movements"]');
const rows = () => movements.locator('tbody tr');
const cellsOf = async (row) =>
  (await row.locator('th, td').allInnerTexts()).map((t) => t.trim());
const frame = () =>
  movements.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return [r.x, r.y + scrollY, r.width, r.height];
  });
const arrived = () =>
  drawer.evaluate((e) =>
    Promise.all(e.getAnimations().map((a) => a.finished)),
  );
const focused = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a.tagName,
      way: a.getAttribute('data-bank-evidence-for'),
      inDrawer: !!a.closest('[data-evidence-drawer]'),
      text: a.textContent,
    };
  });
// A drawer that never closes is reported by the assertion after it, not by
// a timeout.
const closed = () =>
  drawer.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

async function follow(lang, width, motion, index) {
  const w = words[lang],
    what = `${lang} ${width} px ${motion}`;
  watch.at(`bank ${what}: ${index}`);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  const row = rows().nth(index),
    cells = await cellsOf(row),
    [, sideText, place, own] = cells,
    side = w.sides.indexOf(sideText);
  assert.ok(side >= 0, `${what}: the way in opens the row, then its side`);
  const source = sourceRow(side, own);
  assert.equal(Number(place), source.number, `${what}: the row's place`);
  const way = row.getByRole('button', {
    name: `${w.way} · ${own}`,
    exact: true,
  });
  assert.equal(await way.count(), 1, `${what}: the way in names ${own}`);
  assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
  const before = await frame();
  await way.click();
  await drawer.waitFor();
  await arrived();
  // The focus is on the drawer's heading, which names the region.
  const opened = await focused();
  assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
  assert.ok(opened.text.startsWith(w.evidence), `${what}: ${opened.text}`);
  assert.ok(opened.text.includes(own), `${what}: the heading names ${own}`);
  assert.equal(
    await page.getByRole('region', { name: opened.text, exact: true }).count(),
    1,
    `${what}: the drawer is a region named by its heading`,
  );
  assert.deepEqual(await frame(), before, `${what}: the table stays put`);
  assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
  assert.equal(
    await way.getAttribute('aria-controls'),
    await drawer.getAttribute('id'),
    `${what}: the way in names the drawer`,
  );
  const marked = page.locator('tr[data-thread-open]');
  assert.equal(await marked.count(), 1, `${what}: one row is marked`);
  assert.equal((await cellsOf(marked))[3], own, `${what}: the marked row`);
  // Where the drawer is.
  const box = await drawer.evaluate((e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      position: s.position,
      animation: [s.animationName, s.animationDuration],
      viewport: [innerWidth, innerHeight],
      bar: document.querySelector('.topbar')?.getBoundingClientRect().bottom,
    };
  });
  const [vw, vh] = box.viewport;
  assert.equal(box.position, 'fixed', `${what}: over the page, not in it`);
  if (width >= 1024) {
    assert.equal(Math.round(box.y), Math.round(box.bar), `${what}: top`);
    assert.equal(Math.round(box.bottom), vh, `${what}: bottom`);
    assert.equal(Math.round(box.width), 420, `${what}: width`);
    assert.equal(
      Math.round(lang === 'ar' ? box.x : box.right),
      lang === 'ar' ? 0 : vw,
      `${what}: at the inline end of the screen`,
    );
  } else {
    assert.deepEqual(
      [Math.round(box.x), Math.round(box.width), Math.round(box.bottom)],
      [0, vw, vh],
      `${what}: a sheet from the bottom`,
    );
    assert.ok(box.height <= vh * 0.7 + 1, `${what}: at most 70% high`);
  }
  assert.deepEqual(
    box.animation,
    motion === 'reduce' ? ['none', '0s'] : ['evidence-drawer-in', '0.16s'],
    `${what}: motion`,
  );
  // What the drawer says: the side, the file, the row, the amount as the
  // table shows it, and each cell as the file holds it.
  assert.equal(
    await drawer.locator('[data-thread-source] h3').innerText(),
    sideText,
    `${what}: the side`,
  );
  assert.ok(
    (await drawer.locator('[data-thread-source] dl').innerText()).includes(
      files[side].name,
    ),
    `${what}: the file`,
  );
  assert.equal(
    await drawer.locator('[data-thread-row]').innerText(),
    String(source.number),
    `${what}: the row the movement was read from`,
  );
  const amount = drawer.locator('.evidence-drawer__amount');
  assert.equal(await amount.count(), 1, `${what}: the amount is shown`);
  assert.equal(
    (await amount.locator('.bank-movement-amount').innerText()).trim(),
    cells[11],
    `${what}: the amount, whole, as the table shows it`,
  );
  const shown = await drawer
    .locator('[data-thread-source] tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())),
    );
  assert.ok(shown.length >= 2, `${what}: cells are shown`);
  const columns = shown.map(([, column]) => Number(column));
  assert.equal(new Set(columns).size, columns.length, `${what}: no repeat`);
  for (const [, column, text] of shown)
    assert.equal(
      text,
      source.cells[Number(column) - 1],
      `${what}: column ${column} as the file holds it`,
    );
  for (const name of ['Record ID', 'Amount'])
    assert.ok(
      columns.includes(fileRows[side][0].indexOf(name) + 1),
      `${what}: the ${name} cell`,
    );
  // The rest of the page stays within reach.
  if (width >= 1024)
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll('[data-bank-evidence-for]')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight) return false;
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return !!hit?.closest('[data-evidence-drawer]');
          })
          .map((b) => b.textContent),
      ),
      [],
      `${what}: no way in is under the drawer`,
    );
  else
    assert.ok(
      await page.evaluate(
        () =>
          parseFloat(
            getComputedStyle(document.documentElement).scrollPaddingBottom,
          ) >=
          innerHeight * 0.7 - 1,
      ),
      `${what}: what the page brings into view stops above the sheet`,
    );
  // Escape inside the drawer closes it and returns to the same way in.
  await drawer.getByRole('heading', { level: 2 }).press('Escape');
  await closed();
  assert.equal(await drawer.count(), 0, `${what}: Escape closes it`);
  const back = await focused();
  assert.deepEqual(
    [back.tag, back.way],
    ['BUTTON', await way.getAttribute('data-bank-evidence-for')],
    `${what}: Escape returns to the row's way in`,
  );
  assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
  assert.deepEqual(await frame(), before, `${what}: the table stays put`);
  assert.equal(await page.locator('tr[data-thread-open]').count(), 0, what);
}

// The way back, after the table was turned while the drawer was open, turns
// it back to the movement's page and returns to its way in.
async function wayBack(lang) {
  watch.at(`bank ${lang}: the way back`);
  const w = words[lang],
    pager = (name) =>
      movements.getByRole('button', { name, exact: true }).first();
  await page.setViewportSize({ width: 1440, height: 900 });
  await pager(w.next).click();
  const row = rows().nth(4),
    own = (await cellsOf(row))[3];
  await row
    .getByRole('button', { name: `${w.way} · ${own}`, exact: true })
    .click();
  await drawer.waitFor();
  await arrived();
  await pager(w.previous).click();
  await drawer.getByRole('button', { name: w.back, exact: true }).click();
  await closed();
  assert.equal(await drawer.count(), 0, `${lang}: the way back closes it`);
  const back = await focused();
  assert.equal(back.tag, 'BUTTON', `${lang}: the way back returns to a way in`);
  assert.equal(
    (await cellsOf(page.locator('tr', { has: page.locator(':focus') })))[3],
    own,
    `${lang}: on the movement's own page`,
  );
  await pager(w.previous).click();
}

const report = [];
for (const lang of ['en', 'ar']) {
  if (lang === 'ar')
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    lang,
  );
  assert.ok((await rows().count()) > 0, `${lang}: the movements are shown`);
  for (const [width, motion, index] of [
    [1440, 'no-preference', 1],
    [1440, 'reduce', 7],
    [1024, 'no-preference', 2],
    [1024, 'reduce', 31],
    [390, 'no-preference', 3],
    [390, 'reduce', 40],
  ]) {
    await follow(lang, width, motion, index);
    report.push(`${lang} ${width} ${motion}`);
  }
  await wayBack(lang);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
// Another run and a change of type each close the drawer.
async function opened() {
  await rows().first().getByRole('button').first().click();
  await drawer.waitFor();
}
await opened();
await run();
await closed();
assert.equal(await drawer.count(), 0, 'another run closes the evidence');
await opened();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('supplier');
watch.at('bank: open the workspace');
await openDomainWorkspace(page, 'bank');
await rows().first().waitFor();
assert.equal(await drawer.count(), 0, 'a change of type closes the evidence');

// UX-10(d): in the fixed assets and the payroll, each comparison by account
// and component opens the GL row it compares, then the register rows of
// that account and component; the payroll register net opens the bank
// payout rows. Each example's files are a frozen case, read here with this
// check's own split, and the rows each thread must hold are worked out here
// from them: the GL row of the account (and, in the payroll, of the
// component), and the register rows whose mapping row names that account
// and component.
const caseRows = async (dir, count) =>
  Promise.all(
    Array.from({ length: count }, async (_, s) =>
      (await readFile(`${dir}/source-${s}.csv`, 'utf8'))
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => line.split(',')),
    ),
  );
const column = (rows, name) => {
  const at = rows[0].indexOf(name);
  assert.ok(at >= 0, `the column ${name}`);
  return at;
};
const families = {
  assets: {
    workspace: '[data-asset-workspace]',
    status: '[data-asset-status]',
    dir: 'audit/fixed-assets/cases/three-components-positive',
    sources: 4,
    party: 'Asset ID',
    example: {
      en: 'Open a synthetic asset example',
      ar: 'افتح مثال أصول اصطناعي',
    },
    roles: {
      en: [
        'Posted asset component register',
        'Proposed asset component / GL mapping',
        'Independent supplied asset policy evidence',
        'Selected asset GL balances',
      ],
      ar: [
        'سجل مكونات الأصول المرحل',
        'خريطة مكونات الأصول والأستاذ المقترحة',
        'دليل سياسة الأصول المستقل المقدم',
        'أرصدة مكونات الأصول في الأستاذ المحددة',
      ],
    },
    comparisons: {
      en: 'Comparison by account and component',
      ar: 'المقارنة حسب الحساب والمكون',
    },
  },
  payroll: {
    workspace: '[data-payroll-workspace]',
    status: '[data-payroll-status]',
    dir: 'audit/payroll/cases/seven-components-and-bank-positive',
    sources: 5,
    party: 'Employee ID',
    example: {
      en: 'Open a synthetic payroll example',
      ar: 'افتح مثال رواتب اصطناعي',
    },
    roles: {
      en: [
        'Posted employee payroll register',
        'Proposed employee component / GL mapping',
        'Independent supplied payroll policy evidence',
        'Selected posted payroll and disbursement GL entries',
        'Independent posted bank payout',
      ],
      ar: [
        'مسير الموظفين المرحل',
        'خريطة مكونات الموظفين والأستاذ المقترحة',
        'دليل سياسة الرواتب المستقل المقدم',
        'قيود الرواتب والصرف المرحلة المحددة',
        'الصرف البنكي المرحل المستقل',
      ],
    },
    comparisons: {
      en: 'Comparison by account and component',
      ar: 'المقارنة حسب الحساب والمكون',
    },
    bank: {
      en: 'Register net against the bank outflow',
      ar: 'صافي المسير مقابل الصرف البنكي',
    },
  },
};
const threadWords = {
  en: {
    way: 'Review source rows',
    heading: 'Source rows',
    back: 'Back to the row in its table',
  },
  ar: {
    way: 'راجع صفوف المصدر',
    heading: 'صفوف المصدر',
    back: 'عُد إلى الصف في جدوله',
  },
};
// The drawer's sources as drawn: each one's source index, role, row and
// cells [header, column, text].
const drawn = () =>
  drawer.locator('[data-thread-source]').evaluateAll((sections) =>
    sections.map((s) => ({
      source: Number(s.getAttribute('data-thread-source')),
      role: s.querySelector('h3')?.textContent.trim(),
      row: Number(s.querySelector('[data-thread-row]')?.textContent),
      cells: [...s.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent.trim()),
      ),
    })),
  );
// A drawn source against its file: every cell of the row it names, in
// order, with the file's header and text.
function heldToFile(source, files, what) {
  const rows = files[source.source],
    row = rows[source.row - 1];
  assert.ok(source.row > 1 && row, `${what}: row ${source.row} of a file`);
  assert.deepEqual(
    source.cells,
    row.map((text, i) => [rows[0][i], String(i + 1), text]),
    `${what}: every cell of row ${source.row} as the file holds it`,
  );
}
const followedRows = { assets: 0, payroll: 0 };
async function followFamily(name, lang, width, motion) {
  const f = families[name],
    w = page.locator(f.workspace),
    tw = threadWords[lang],
    what = `${name} ${lang} ${width} px ${motion}`;
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  const files = await caseRows(f.dir, f.sources),
    [register, mapping, , gl] = files;
  const table = w.locator(`table[aria-label="${f.comparisons[lang]}"]`),
    count = await table.locator('tbody tr').count();
  assert.ok(count >= 3, `${what}: comparisons are shown`);
  const head = await table.locator('thead th').allInnerTexts();
  assert.equal(head[0].trim(), tw.way, `${what}: the way in opens each row`);
  for (let i = 0; i < count; i++) {
    watch.at(`${what}: ${i}`);
    const row = table.locator('tbody tr').nth(i),
      cells = (await row.locator('td, th').allInnerTexts()).map((x) =>
        x.trim(),
      ),
      [, account, , component] = cells,
      way = row.getByRole('button', {
        name: `${tw.way} · ${account} · ${component}`,
        exact: true,
      });
    assert.equal(await way.count(), 1, `${what} ${account}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${account} · ${component}`,
      `${what}: the heading names the comparison`,
    );
    const sources = await drawn();
    // The GL row first: the one of this account, and in the payroll of
    // this component.
    const glSource = sources[0];
    assert.equal(glSource?.source, 3, `${what} ${account}: the GL row first`);
    assert.equal(glSource.role, f.roles[lang][3], `${what}: the GL role`);
    heldToFile(glSource, files, `${what} ${account} GL`);
    const glRow = gl[glSource.row - 1];
    assert.equal(glRow[column(gl, 'GL account')], account, `${what}: account`);
    const components =
      name === 'payroll'
        ? [glRow[column(gl, 'Component')]]
        : [
            ...new Set(
              mapping
                .slice(1)
                .filter((m) => m[column(mapping, 'GL account')] === account)
                .map((m) => m[column(mapping, 'Component')]),
            ),
          ];
    assert.equal(components.length, 1, `${what}: one component maps there`);
    // Then the register rows mapped to this account and component.
    const parties = new Set(
      mapping
        .slice(1)
        .filter(
          (m) =>
            m[column(mapping, 'GL account')] === account &&
            m[column(mapping, 'Component')] === components[0],
        )
        .map((m) => m[column(mapping, f.party)]),
    );
    const expected = register
      .map((r, at) => [r, at + 1])
      .filter(([r], at) => at > 0 && parties.has(r[column(register, f.party)]))
      .map(([, number]) => number);
    assert.deepEqual(
      sources.slice(1).map((s) => [s.source, s.row]),
      expected.map((number) => [0, number]),
      `${what} ${account}: the register rows of the account and component`,
    );
    for (const s of sources.slice(1)) {
      assert.equal(s.role, f.roles[lang][0], `${what}: the register role`);
      heldToFile(s, files, `${what} ${account} register`);
    }
    followedRows[name] += sources.length;
    // Each figure whole and in its place, as the table shows it: a part of
    // one figure inside another is not the same figure.
    assert.deepEqual(
      (
        await drawer
          .locator('.evidence-drawer__amount .tarasuf-amount')
          .allInnerTexts()
      ).map((x) => x.trim()),
      cells.slice(4),
      `${what} ${account}: the table's figures`,
    );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: the row is marked`,
    );
    await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: Escape closes it`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: Escape returns to the way in`,
    );
    assert.equal(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(account),
      true,
      `${what}: the same way in`,
    );
  }
  if (!f.bank) return;
  // The register net against the bank: every bank payout row.
  const bankTable = w.locator(`table[aria-label="${f.bank[lang]}"]`);
  await bankTable
    .getByRole('button', { name: `${tw.way} · ${f.bank[lang]}`, exact: true })
    .click();
  await drawer.waitFor();
  await arrived();
  const sources = await drawn();
  assert.ok(files[4].length > 1, `${what}: the case has bank rows`);
  assert.deepEqual(
    sources.map((s) => [s.source, s.row]),
    files[4].slice(1).map((_, at) => [4, at + 2]),
    `${what}: every bank payout row`,
  );
  followedRows[name] += sources.length;
  for (const s of sources) {
    assert.equal(s.role, f.roles[lang][4], `${what}: the bank role`);
    heldToFile(s, files, `${what} bank`);
  }
  await drawer.getByRole('button', { name: tw.back, exact: true }).click();
  await closed();
  assert.equal(await drawer.count(), 0, `${what}: the way back closes it`);
}
for (const name of ['assets', 'payroll']) {
  const f = families[name];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: null });
  if ((await page.evaluate(() => document.documentElement.lang)) !== 'en')
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await openDomainWorkspace(page, name);
  const w = page.locator(f.workspace);
  await w.getByRole('button', { name: f.example.en, exact: true }).click();
  await w.locator(f.status).waitFor();
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'false',
    f.workspace,
  );
  for (const [lang, width, motion] of [
    ['en', 1440, 'no-preference'],
    ['en', 390, 'reduce'],
    ['ar', 1024, 'reduce'],
    ['ar', 390, 'no-preference'],
  ]) {
    if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
      await page
        .getByRole('button', {
          name: lang === 'ar' ? 'AR العربية' : 'EN English',
          exact: true,
        })
        .click();
    await followFamily(name, lang, width, motion);
    report.push(`${name} ${lang} ${width} ${motion}`);
  }
  // A change of type closes it.
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await w
    .getByRole('button', { name: /^Review source rows · / })
    .first()
    .click();
  await drawer.waitFor();
  await page
    .locator('select[data-reconciliation-type-select]')
    .selectOption('bank');
  await openDomainWorkspace(page, name);
  await w.locator(f.status).waitFor();
  assert.equal(
    await drawer.count(),
    0,
    `${name}: a change of type closes the evidence`,
  );
}
await page.emulateMedia({ reducedMotion: null });
// Every comparison opened its GL row and at least one register row.
assert.ok(followedRows.assets >= 4 * 3 * 2, `asset rows: ${followedRows.assets}`);
assert.ok(
  followedRows.payroll >= 4 * 7 * 2 + 4,
  `payroll rows: ${followedRows.payroll}`,
);
report.push(`rows held to their files: ${JSON.stringify(followedRows)}`);

// UX-10(d), the inventory: the register rows of L26 that do not link.
const LINKS = 'audit/inventory-links-foundation/frozen';
const STOCK_FILES = ['register', 'mapping', 'evidence', 'gl'];
// This check's own CSV reader: a byte order mark, quoted fields, doubled
// quotes and CRLF, which the story's writers use.
function csvRows(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/u, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
const stockWords = {
  en: {
    title: 'Register rows that do not link, and why',
    roles: [
      'Posted inventory register',
      'Proposed item / GL mapping',
      'Independent supplied policy evidence',
      'Selected inventory GL balances',
    ],
  },
  ar: {
    title: 'صفوف السجل التي لا تُربط، ولماذا',
    roles: [
      'سجل المخزون المرحل',
      'خريطة الصنف والأستاذ المقترحة',
      'دليل السياسة المستقل المقدم',
      'أرصدة مخزون الأستاذ المحددة',
    ],
  },
};
const stockFiles = await Promise.all(
  STOCK_FILES.map(async (role) =>
    csvRows(await readFile(`${LINKS}/L26-${role}.csv`, 'utf8')),
  ),
);
const sealed = JSON.parse(
  await readFile(`${LINKS}/EXPECTED.json`, 'utf8'),
).stories.L26.links.filter((l) => l[1] === 'unlinked');
assert.ok(sealed.length >= 6, 'L26 has its unlinked register rows');
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
if ((await page.evaluate(() => document.documentElement.lang)) !== 'en')
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
watch.at('stock: open the workspace');
await openDomainWorkspace(page, 'stock');
const stock = page.locator('[data-stock-workspace]');
const stockIdle = () =>
  page.waitForFunction(
    () =>
      document
        .querySelector('[data-stock-workspace]')
        ?.getAttribute('aria-busy') === 'false',
    null,
    { timeout: 120000 },
  );
for (const [i, role] of stockWords.en.roles.entries()) {
  await stock
    .getByLabel(role, { exact: true })
    .setInputFiles(path.resolve(`${LINKS}/L26-${STOCK_FILES[i]}.csv`));
  await stockIdle();
}
await stock
  .getByLabel(
    "I reviewed the posted inventory register, the proposed item / GL mapping, the independent supplied policy evidence and the selected inventory GL balances (each one's role and family) and their common scope",
  )
  .check();
await stock
  .getByRole('button', { name: 'Check inventory / GL', exact: true })
  .click();
await stockIdle();
let stockRows = 0;
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  const tw = threadWords[lang],
    sw = stockWords[lang],
    what = `stock ${lang} ${width} px ${motion}`;
  const table = stock.locator(`table[aria-label="${sw.title}"]`);
  const head = await table.locator('thead th').allInnerTexts();
  assert.equal(head[0].trim(), tw.way, `${what}: the way in opens each row`);
  const count = await table.locator('tbody tr').count();
  assert.equal(count, sealed.length, `${what}: every unlinked row is shown`);
  for (let i = 0; i < count; i++) {
    watch.at(`${what}: ${i}`);
    const row = table.locator('tbody tr').nth(i),
      number = Number(await row.getAttribute('data-stock-unlinked-row')),
      cells = (await row.locator('td').allInnerTexts()).map((x) => x.trim()),
      [, , item, dimensions] = cells,
      want = sealed.find((l) => l[0] === number);
    assert.ok(want, `${what}: row ${number} is one the seal names`);
    const way = row.getByRole('button', {
      name: `${tw.way} · ${item} · ${dimensions}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} row ${number}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${item} · ${dimensions}`,
      `${what}: the heading names the register row`,
    );
    const [, , , maps, evidence, , gl] = want;
    const sources = await drawn();
    assert.deepEqual(
      sources.map((s) => [s.source, s.row]),
      [
        [0, number],
        ...maps.map((m) => [1, m]),
        ...evidence.map((e) => [2, e]),
        ...gl.map((g) => [3, g]),
      ],
      `${what} row ${number}: the register row, then the rows the seal names`,
    );
    for (const s of sources) {
      assert.equal(s.role, sw.roles[s.source], `${what}: the role`);
      heldToFile(s, stockFiles, `${what} row ${number}`);
    }
    // The register row is the one of this item and its dimensions.
    const register = stockFiles[0],
      own = register[number - 1];
    assert.deepEqual(
      [own[register[0].indexOf('Item ID')], own[register[0].indexOf('Item dimensions')]],
      [item, dimensions],
      `${what} row ${number}: its item and dimensions`,
    );
    stockRows += sources.length;
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: the row is marked`,
    );
    if (i % 2) {
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    } else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.equal(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(`${item} · ${dimensions}`),
      true,
      `${what}: the same way in`,
    );
  }
  report.push(`stock ${lang} ${width} ${motion}`);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
// Six rows, each its register row and the rows the seal names (14), twice.
assert.equal(stockRows, 2 * (6 + 14), `stock rows: ${stockRows}`);
report.push(`stock rows held to their files: ${stockRows}`);
// A change of type closes it.
await stock
  .getByRole('button', { name: /^Review source rows · / })
  .first()
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('stock: open the workspace');
await openDomainWorkspace(page, 'stock');
await stock.locator('[data-stock-links]').waitFor();
assert.equal(
  await drawer.count(),
  0,
  'stock: a change of type closes the evidence',
);

// UX-10(d), the GL and TB comparison: the balance components of the frozen
// case positive, uploaded through the workspace's own file inputs.
const GLTB = 'audit/gl-tb/frozen';
const glTbFiles = await Promise.all(
  ['gl', 'tb'].map(async (side) =>
    csvRows(await readFile(`${GLTB}/positive-${side}.csv`, 'utf8')),
  ),
);
const glTbWords = {
  en: { sides: ['GL detail and balances', 'Trial balance source'] },
  ar: { sides: ['تفاصيل الأستاذ وأرصدته', 'مصدر ميزان المراجعة'] },
};
const GL_KINDS = ['opening', 'opening', 'movement', 'movement', 'closing', 'closing'];
const TB_COLUMNS = [
  'Opening debit',
  'Opening credit',
  'Period debit',
  'Period credit',
  'Closing debit',
  'Closing credit',
];
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('gl-tb: open the workspace');
await openDomainWorkspace(page, 'gl-tb');
for (const [side, label] of glTbWords.en.sides.entries()) {
  const file = `positive-${side ? 'tb' : 'gl'}.csv`;
  await page
    .getByLabel(label, { exact: true })
    .setInputFiles(path.resolve(`${GLTB}/${file}`));
  await page.getByRole('heading', { name: file, exact: true }).waitFor();
}
await page.evaluate(
  () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
);
await page
  .getByLabel('I reviewed the GL detail and balances and the trial balance source', {
    exact: false,
  })
  .check();
await page
  .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
  .click();
await page.getByTestId('gl-tb-result').waitFor();
let glTbRows = 0;
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  const tw = threadWords[lang],
    what = `gl-tb ${lang} ${width} px ${motion}`;
  const table = page.getByTestId('gl-tb-balances').locator('table');
  const head = await table.locator('thead th').allInnerTexts();
  assert.equal(head[0].trim(), tw.way, `${what}: the way in opens each row`);
  const count = await table.locator('tbody tr').count();
  assert.equal(count, 6, `${what}: six balance components`);
  for (let i = 0; i < count; i++) {
    watch.at(`${what}: ${i}`);
    const row = table.locator('tbody tr').nth(i),
      component = (await row.locator('th').innerText()).trim(),
      figures = (await row.locator('td:not(:first-child)').allInnerTexts()).map(
        (x) => x.trim(),
      );
    const way = row.getByRole('button', {
      name: `${tw.way} · ${component}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${component}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${component}`,
      `${what}: the heading names the component`,
    );
    // Every GL row of the component's kind, in file order, then the TB row.
    const [gl] = glTbFiles,
      kind = gl[0].indexOf('Record kind');
    const want = [
      ...gl
        .map((r, at) => [r, at + 1])
        .filter(([r], at) => at > 0 && r[kind] === GL_KINDS[i])
        .map(([, n]) => [0, n]),
      [1, 2],
    ];
    const sources = await drawn();
    assert.deepEqual(
      sources.map((s) => [s.source, s.row]),
      want,
      `${what} ${component}: the GL rows of its kind, then the TB row`,
    );
    for (const s of sources) {
      assert.equal(s.role, glTbWords[lang].sides[s.source], `${what}: role`);
      const file = glTbFiles[s.source],
        header = s.source === 0 ? (i % 2 ? 'Credit' : 'Debit') : TB_COLUMNS[i],
        column = file[0].indexOf(header) + 1;
      assert.ok(column > 0, `${what}: the column ${header}`);
      assert.deepEqual(
        s.cells,
        [[header, String(column), file[s.row - 1][column - 1]]],
        `${what} ${component} row ${s.row}: the one cell of its column`,
      );
    }
    glTbRows += sources.length;
    assert.deepEqual(
      (
        await drawer
          .locator('.evidence-drawer__amount .tarasuf-amount')
          .allInnerTexts()
      ).map((x) => x.trim()),
      figures,
      `${what} ${component}: the table's figures`,
    );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: the row is marked`,
    );
    if (i % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(component),
      `${what}: the same way in`,
    );
  }
  report.push(`gl-tb ${lang} ${width} ${motion}`);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
// Opening and closing: one GL row and the TB row each; the period: the two
// movements and the TB row. Twice.
assert.equal(glTbRows, 2 * (2 + 2 + 3 + 3 + 2 + 2), `gl-tb rows: ${glTbRows}`);
report.push(`gl-tb rows held to their files: ${glTbRows}`);
// A change of type closes it.
await page
  .getByTestId('gl-tb-balances')
  .getByRole('button', { name: /^Review source rows · / })
  .first()
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('gl-tb: open the workspace');
await openDomainWorkspace(page, 'gl-tb');
await page.getByTestId('gl-tb-result').waitFor();
assert.equal(
  await drawer.count(),
  0,
  'gl-tb: a change of type closes the evidence',
);

// UX-10(d), clearing: each case of the synthetic example, which writes the
// frozen file byte for byte, opens the movement rows the engine put in it.
// The members of each case come from the seal, by row, and are named here
// by the posting identifiers the file holds in those rows.
const CLEARING = 'audit/clearing/frozen';
const clearingFile = csvRows(
  await readFile(`${CLEARING}/source.csv`, 'utf8'),
);
const clearingSeal = JSON.parse(
  await readFile(`${CLEARING}/expected.json`, 'utf8'),
);
const postingOf = (row) => clearingFile[row - 1][0];
const groupsOf = (groups) =>
  groups.map((g) => g.map(postingOf).sort().join(', ')).sort();
const clearingWords = {
  en: {
    role: 'Clearing movements file',
    amount: 'Amount in the table',
    net: 'Net',
  },
  ar: {
    role: 'ملف حركات المقاصة',
    amount: 'المبلغ في الجدول',
    net: 'الصافي',
  },
};
const clearing = page.locator('main.clearing-workspace');
const cases = () =>
  clearing
    .locator('table')
    .filter({ has: page.getByTestId('clearing-case') });
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('clearing: open the workspace');
await openDomainWorkspace(page, 'clearing');
await page
  .getByRole('button', { name: 'Open synthetic clearing example', exact: true })
  .click();
await page.getByRole('button', { name: 'Check clearing', exact: true }).click();
await page.getByRole('heading', { name: 'Clearing result', exact: true }).waitFor();
let clearingRows = 0;
async function followCases(lang, width, motion, groups) {
  const tw = threadWords[lang],
    what = `clearing ${lang} ${width} px ${motion}`;
  const head = await cases().locator('thead th').allInnerTexts();
  assert.equal(head[0].trim(), tw.way, `${what}: the way in opens each case`);
  const count = await cases().locator('tbody tr').count();
  const members = [];
  for (let i = 0; i < count; i++) {
    watch.at(`${what}: ${i}`);
    const row = cases().locator('tbody tr').nth(i),
      [, named, , net] = (await row.locator('td').allInnerTexts()).map((x) =>
        x.trim(),
      );
    const way = row.getByRole('button', {
      name: `${tw.way} · ${named}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${named}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the case`,
    );
    const sources = await drawn();
    assert.deepEqual(
      sources.map((s) => postingOf(s.row)).join(', '),
      named,
      `${what} ${named}: its member rows, in the case's order`,
    );
    for (const s of sources) {
      assert.equal(s.source, 0, `${what}: the one source`);
      assert.equal(s.role, clearingWords[lang].role, `${what}: role`);
      heldToFile(s, [clearingFile], `${what} ${named}`);
    }
    assert.deepEqual(
      await drawer
        .locator('[data-thread-source]')
        .evaluateAll((sections) =>
          sections.map((s) => s.querySelector('dd bdi')?.textContent.trim()),
        ),
      sources.map(() => 'synthetic-clearing.csv'),
      `${what}: the example's file`,
    );
    assert.equal(
      (await drawer.locator('.evidence-drawer__amount').innerText())
        .replace(/\s+/gu, ' ')
        .trim(),
      `${clearingWords[lang].amount}: ${clearingWords[lang].net} ${net}`,
      `${what} ${named}: the table's net`,
    );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: the case is marked`,
    );
    clearingRows += sources.length;
    members.push(named);
    if (i % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(named),
      `${what}: the same way in`,
    );
  }
  assert.deepEqual(
    members.map((m) => m.split(', ').sort().join(', ')).sort(),
    groupsOf(groups),
    `${what}: the sealed members of each case`,
  );
  report.push(`clearing ${lang} ${width} ${motion}`);
}
const sealedCases = [
  ...clearingSeal.automaticGroups,
  clearingSeal.residualGroup.rows,
  ...clearingSeal.unlinkedRows.map((r) => [r]),
];
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  await followCases(lang, width, motion, sealedCases);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
// Three, two, two, one and one rows, twice.
assert.equal(clearingRows, 2 * 9, `clearing rows: ${clearingRows}`);
// A decision changes the result, and closes the evidence of the old one: the
// two unlinked postings cleared by hand open as one case.
const [lone] = clearingSeal.unlinkedRows.map(postingOf);
await cases()
  .getByRole('button', { name: `Review source rows · ${lone}`, exact: true })
  .click();
await drawer.waitFor();
for (const row of clearingSeal.manualDecision.rows)
  await clearing
    .getByLabel(`Members: ${postingOf(row)}`, { exact: true })
    .check();
await clearing
  .getByLabel('Review decision reason', { exact: true })
  .fill(clearingSeal.manualDecision.note);
await clearing
  .getByRole('button', {
    name: 'Record human clearing for selected members',
    exact: true,
  })
  .click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="clearing-metrics"]')
    ?.textContent.includes('Cleared movements7'),
);
assert.equal(await drawer.count(), 0, 'clearing: a decision closes it');
clearingRows = 0;
await followCases('en', 1440, 'no-preference', [
  ...clearingSeal.automaticGroups,
  clearingSeal.residualGroup.rows,
  clearingSeal.manualDecision.rows,
]);
assert.equal(clearingRows, 9, `clearing rows after the decision: ${clearingRows}`);
report.push('clearing rows held to their file: 18, then 9 after a decision');
// A change of type closes it.
await cases()
  .getByRole('button', { name: /^Review source rows · / })
  .first()
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('clearing: open the workspace');
await openDomainWorkspace(page, 'clearing');
await cases().waitFor();
assert.equal(
  await drawer.count(),
  0,
  'clearing: a change of type closes the evidence',
);

// UX-10(d), receivables: each document pair of the synthetic example, which
// writes the frozen positive pair byte for byte, opens its two movements,
// each held to its file; then the printed statement of story A01 of the
// AR-1 foundation opens each of its lines by page and line, as its seal
// names them, and says its cells are not kept.
const ARL = 'audit/ar-limited/frozen',
  ARS = 'audit/ar-statement-foundation/frozen';
const arFiles = await Promise.all(
  ['ledger', 'statement'].map(async (side) =>
    csvRows(await readFile(`${ARL}/positive-${side}.csv`, 'utf8')),
  ),
);
const arSealed = JSON.parse(
  await readFile(`${ARL}/expected.json`, 'utf8'),
).cases.find((c) => c.name === 'positive');
const arWords = {
  en: {
    sides: ['Company AR ledger', 'Company-issued customer statement'],
    file: 'File',
    page: 'Page',
    line: 'Line',
    sheet: 'Sheet',
    notKept:
      'The result does not keep the text of this record’s cells. Its place is shown above.',
  },
  ar: { sides: ['سجل ذمم العملاء', 'كشف العميل الصادر عن الشركة'] },
};
const arw = page.locator('[data-ar-workspace]');
const arIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await arw.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the receivables workspace stayed busy for a minute');
};
// The drawer's sources with their place as drawn: the row, or the page and
// line, the sheet if any, and whether it says its cells are not kept.
const arDrawn = () =>
  drawer.locator('[data-thread-source]').evaluateAll((sections) =>
    sections.map((s) => {
      const place = Object.fromEntries(
        [...s.querySelectorAll('.evidence-drawer__place > div')].map((d) => [
          d.querySelector('dt').textContent.trim(),
          d.querySelector('dd').textContent.trim(),
        ]),
      );
      return {
        source: Number(s.getAttribute('data-thread-source')),
        role: s.querySelector('h3')?.textContent.trim(),
        place,
        missing: s.querySelector('.evidence-drawer__missing')?.textContent.trim(),
        cells: [...s.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((c) => c.textContent.trim()),
        ),
      };
    }),
  );
let arRows = 0;
// Each case of the result, opened in turn: the way in names it, the drawer's
// heading names it, its sources are judged by `judge`, the case is marked,
// and the way back or Escape returns the focus to the same way in.
async function followAr(lang, width, motion, judge) {
  const tw = threadWords[lang],
    what = `ar ${lang} ${width} px ${motion}`;
  const count = await arw.getByTestId('ar-case').count();
  assert.ok(count > 0, `${what}: cases`);
  for (let i = 0; i < count; i++) {
    watch.at(`${what}: ${i}`);
    const card = arw.getByTestId('ar-case').nth(i),
      heading = (await card.locator('h3').innerText()).trim();
    const way = card.getByRole('button', {
      name: `${tw.way} · ${heading}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${heading}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    const shadowOf = () => card.evaluate((e) => getComputedStyle(e).boxShadow);
    const closedShadow = await shadowOf();
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${heading}`,
      `${what}: the heading names the case`,
    );
    const sources = await arDrawn();
    for (const s of sources)
      assert.equal(s.role, arWords[lang].sides[s.source], `${what}: role`);
    await judge(heading, sources, `${what} ${heading}`);
    arRows += sources.length;
    assert.equal(
      await arw.locator('article[data-thread-open]').count(),
      1,
      `${what}: the case is marked`,
    );
    assert.equal(
      await card.getAttribute('data-thread-open'),
      '',
      `${what}: this case`,
    );
    // A card has no row to shade: its frame is drawn, a ring of 2 px in
    // place of the faint shadow every card has, and with motion it comes in
    // 160 ms; with reduced motion it is simply there.
    const frame = await card.evaluate((e) => {
      const s = getComputedStyle(e);
      return { shadow: s.boxShadow, animation: [s.animationName, s.animationDuration] };
    });
    assert.notEqual(frame.shadow, closedShadow, `${what}: the case is framed`);
    assert.match(frame.shadow, /\b0px 0px 0px 2px\b/u, `${what}: a 2 px ring`);
    assert.deepEqual(
      frame.animation,
      motion === 'reduce' ? ['none', '0s'] : ['evidence-card-in', '0.16s'],
      `${what}: the frame's motion`,
    );
    if (i % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(heading),
      `${what}: the same way in`,
    );
  }
  report.push(`ar ${lang} ${width} ${motion}`);
  return count;
}
// The example: a pair is one movement from each record, both read whole
// from their files, and the pairs are the sealed ones.
const examplePairs = [];
const judgeExample = async (heading, sources, what) => {
  assert.deepEqual(
    sources.map((s) => s.source).sort(),
    [0, 1],
    `${what}: one movement from each record`,
  );
  const named = ['synthetic-ar-ledger.csv', 'synthetic-customer-statement.csv'];
  for (const s of sources) {
    const row = Number(s.place.Row ?? s.place['الصف']);
    assert.equal(
      s.place.File ?? s.place['الملف'],
      named[s.source],
      `${what}: the example's file`,
    );
    heldToFile({ ...s, row }, arFiles, what);
  }
  examplePairs.push(
    [0, 1]
      .map((side) => {
        const s = sources.find((x) => x.source === side);
        return s.place.Row ?? s.place['الصف'];
      })
      .join(':'),
  );
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('ar: open the workspace');
await openDomainWorkspace(page, 'ar');
await page
  .getByRole('button', { name: 'Open synthetic AR example', exact: true })
  .click();
await page.getByTestId('ar-metrics').waitFor();
await arIdle();
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  examplePairs.length = 0;
  const count = await followAr(lang, width, motion, judgeExample);
  assert.deepEqual(
    examplePairs.sort((a, b) => a.localeCompare(b)),
    arSealed.requiredPairs.map((p) => p.join(':')).sort(),
    `ar ${lang}: the sealed pairs`,
  );
  assert.equal(count, arSealed.automaticPairCount, `ar ${lang}: the cases`);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
assert.equal(arRows, 2 * 2 * 3, `ar rows: ${arRows}`);
// A decision changes the result, and closes the evidence of the old one.
const invoice = arw.getByTestId('ar-case').filter({
  has: page.getByRole('heading', { name: 'Invoice: I001', exact: true }),
});
await invoice
  .getByRole('button', { name: 'Review source rows · Invoice: I001', exact: true })
  .click();
await drawer.waitFor();
await arw
  .getByLabel('Document review reason', { exact: true })
  .fill('Synthetic original document correspondence reopened for review');
await invoice
  .getByRole('button', { name: 'Reopen document pair', exact: true })
  .click();
await arIdle();
await invoice
  .getByText('Approval cancelled; document pair remains for review', {
    exact: false,
  })
  .waitFor();
assert.equal(await drawer.count(), 0, 'ar: a decision closes it');
// The printed statement: each pair opens the ledger row, held to its file,
// and the statement line at the page and line the seal names, with no sheet
// and no cells.
const a01 = JSON.parse(
  await readFile(`${ARS}/stories.json`, 'utf8'),
).stories.find((s) => s.id === 'A01');
const a01Sealed = JSON.parse(await readFile(`${ARS}/EXPECTED.json`, 'utf8'))
  .stories.A01;
const a01Ledger = csvRows(await readFile(`${ARS}/A01-ledger.csv`, 'utf8'));
await arw
  .getByTestId('ar-source-0')
  .locator('input[type="file"]')
  .setInputFiles(path.resolve(`${ARS}/A01-ledger.csv`));
await arIdle();
for (const [position, label] of [
  'Unique posting ID',
  'Document type',
  'Own document number',
  'Posting date',
  'Original signed amount',
  'Entity',
  'Ledger',
  'Customer ID',
  'Account',
  'Currency',
  'Related invoice',
  'Description',
].entries())
  await arw
    .getByLabel(`Company AR ledger: ${label}`, { exact: true })
    .selectOption(String(position));
await arw
  .getByTestId('ar-source-1')
  .locator('input[type="file"]')
  .setInputFiles(path.resolve(`${ARS}/A01-statement.pdf`));
await arIdle();
const arCard = arw.locator('[data-scope-card]');
if ((await arCard.locator('details').getAttribute('open')) === null)
  await arCard.locator('details summary').click();
for (const [field, label] of [
  ['entity', 'Entity'],
  ['ledger', 'Ledger'],
  ['customer', 'Customer ID'],
  ['account', 'Account'],
  ['currency', 'Currency'],
  ['start', 'Period start'],
  ['end', 'Period end'],
])
  await arw.getByLabel(label, { exact: true }).fill(a01.scope[field]);
await arw
  .getByLabel(
    'I reviewed the company AR ledger and the company-issued customer statement',
    { exact: false },
  )
  .click();
await arw
  .getByRole('button', { name: 'Compare AR documents', exact: true })
  .click();
await arIdle();
const posting = a01Ledger[0].indexOf('Posting ID');
const printed = [];
const judgePrinted = async (heading, sources, what) => {
  const document = heading.split(/:\s+/u).at(-1),
    sealed = a01Sealed.cases.find((c) => c.document === document);
  assert.ok(sealed, `${what}: a sealed case`);
  const ledger = sources.filter((s) => s.source === 0),
    lines = sources.filter((s) => s.source === 1);
  assert.deepEqual(
    ledger.map((s) => a01Ledger[Number(s.place.Row) - 1][posting]),
    sealed.ledger,
    `${what}: the sealed ledger rows`,
  );
  for (const s of ledger) {
    assert.equal(s.place.File, 'A01-ledger.csv', `${what}: the ledger file`);
    heldToFile({ ...s, row: Number(s.place.Row) }, [a01Ledger], what);
  }
  assert.deepEqual(
    lines.map((s) => [Number(s.place.Page), Number(s.place.Line)]),
    sealed.statement,
    `${what}: the sealed statement lines`,
  );
  for (const s of lines) {
    assert.equal(s.place.File, 'A01-statement.pdf', `${what}: the PDF`);
    assert.equal(s.place.Sheet, undefined, `${what}: a page has no sheet`);
    assert.equal(s.place.Row, undefined, `${what}: and no row`);
    assert.equal(s.missing, arWords.en.notKept, `${what}: cells not kept`);
    assert.deepEqual(s.cells, [], `${what}: no cell drawn`);
  }
  printed.push(document);
};
arRows = 0;
const printedCount = await followAr('en', 1440, 'no-preference', judgePrinted);
assert.equal(printedCount, a01Sealed.cases.length, 'ar printed: the cases');
assert.deepEqual(
  printed.sort((a, b) => a.localeCompare(b)),
  a01Sealed.cases.map((c) => c.document).sort(),
  'ar printed: every sealed case',
);
report.push(`ar printed statement: ${arRows} sources over ${printedCount} cases`);
// A change of type closes it.
await arw
  .getByRole('button', { name: /^Review source rows · / })
  .first()
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('ar: open the workspace');
await openDomainWorkspace(page, 'ar');
await arw.getByTestId('ar-case').first().waitFor();
assert.equal(await drawer.count(), 0, 'ar: a change of type closes the evidence');

// UX-10(d), the financial position: each statement line opens its own row in
// the statement, then for each member the trial-balance row of its account,
// the mapping row that puts the account on the line and the evidence row the
// mapping cites. The example writes the frozen case whole-post-closing byte
// for byte, and its rows are the sealed ones. A second story, written here,
// has 57 lines over two pages, eight of them of two accounts, with its trial
// balance, mapping and evidence rows each in another order; it is read
// through the workspace's own file inputs, and the rows of each line are
// worked out here from the files, by the identifiers they hold.
const FIN = 'audit/tb-financial/frozen';
const finWords = {
  en: [
    'Trial balance',
    'Proposed mapping',
    'Independent presentation evidence',
    'Financial position',
  ],
  ar: [
    'ميزان المراجعة',
    'الربط المقترح',
    'دليل العرض المستقل',
    'قائمة المركز المالي',
  ],
};
const fin = page.locator('[data-financial-workspace]');
const finIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await fin.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the financial position workspace stayed busy for a minute');
};
const finLines = () => fin.locator('section:has(> h3[data-decision-item])');
// The rows a line must open, worked out from the four files: its statement
// row, then for each mapping row that names the line, in the file's order,
// the trial-balance row of the account and dimensions it names, the mapping
// row itself and the evidence row of the evidence identifier it names.
function rowsInFiles(files) {
  const at = (source, name) => files[source][0].indexOf(name),
    find = (source, test) =>
      files[source].findIndex((r, n) => n > 0 && test(r)) + 1;
  return (lineId) => [
    [3, find(3, (r) => r[at(3, 'Line ID')] === lineId)],
    ...files[1].flatMap((m, n) =>
      n === 0 || m[at(1, 'Line ID')] !== lineId
        ? []
        : [
            [
              0,
              find(
                0,
                (r) =>
                  r[at(0, 'Account ID')] === m[at(1, 'Account ID')] &&
                  r[at(0, 'Complete dimensions')] ===
                    m[at(1, 'Complete dimensions')],
              ),
            ],
            [1, n + 1],
            [2, find(2, (r) => r[at(2, 'Evidence ID')] === m[at(1, 'Evidence ID')])],
          ],
    ),
  ];
}
const finExample = await Promise.all(
  [0, 1, 2, 3].map(async (i) =>
    csvRows(await readFile(`${FIN}/whole-post-closing-${i}.csv`, 'utf8')),
  ),
);
const finSealed = JSON.parse(
  await readFile(`${FIN}/expected.json`, 'utf8'),
).cases.find((c) => c.name === 'whole-post-closing').financialFacts;
const sealedRows = new Map(
  finSealed.lines.map((l) => [
    l.id,
    [
      [3, l.row],
      ...l.members.flatMap((m) => [
        [0, m.accountRow],
        [1, m.mappingRow],
        [2, m.evidenceRow],
      ]),
    ],
  ]),
);
// This check's own reading of the files agrees with the seal.
for (const [id, rows] of sealedRows)
  assert.deepEqual(rowsInFiles(finExample)(id), rows, `financial seal ${id}`);
// The financial lines and the intercompany pairs are sections, each with
// its heading and figures; a kind says which workspace, which sections,
// the words for each source's role and the name a section goes by.
const finKind = {
  name: 'financial',
  w: fin,
  items: finLines,
  roles: finWords,
  named: (parts) => parts.slice(0, 2).join(' · '),
  rows: 0,
};
// Each section given, opened in turn: the way in names it, the drawer's
// heading names it and shows the section's figures as the section does, its sources are
// the rows the story names, each held to its file, the line's heading is
// marked as a row is, and the way back or Escape returns the focus to the
// same way in.
async function followSections(kind, lang, width, motion, story, only) {
  const tw = threadWords[lang],
    what = `${kind.name} ${story.name} ${lang} ${width} px ${motion}`;
  const count = await kind.items().count();
  assert.ok(count > 0, `${what}: lines`);
  const followed = [];
  for (const i of only ?? [...Array(count).keys()]) {
    watch.at(`${what}: ${i}`);
    const line = kind.items().nth(i),
      heading = line.locator('> h3'),
      parts = (await heading.innerText()).trim().split(' · '),
      [lineId] = parts,
      named = kind.named(parts);
    const way = line.getByRole('button', {
      name: `${tw.way} · ${named}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${lineId}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    const styleOf = () =>
      heading.evaluate((e) => {
        const s = getComputedStyle(e);
        return {
          background: s.backgroundColor,
          shadow: s.boxShadow,
          animation: [s.animationName, s.animationDuration],
        };
      });
    const before = await styleOf(),
      figures = (await line.locator('> p').first().innerText())
        .replace(/\s+/gu, ' ')
        .trim();
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the line`,
    );
    const amount = (
      await drawer.locator('.evidence-drawer__amount').innerText()
    )
      .replace(/\s+/gu, ' ')
      .trim();
    assert.ok(
      figures && amount.endsWith(figures),
      `${what} ${lineId}: the line's figures, ${amount}`,
    );
    const sources = await arDrawn(),
      rowOf = (s) => Number(s.place.Row ?? s.place['الصف']);
    assert.deepEqual(
      sources.map((s) => [s.source, rowOf(s)]),
      story.rows(lineId),
      `${what} ${lineId}: the rows`,
    );
    for (const s of sources) {
      assert.equal(s.role, kind.roles[lang][s.source], `${what}: role`);
      assert.equal(
        s.place.File ?? s.place['الملف'],
        story.names[s.source],
        `${what}: the file`,
      );
      heldToFile({ ...s, row: rowOf(s) }, story.files, `${what} ${lineId}`);
    }
    kind.rows += sources.length;
    // A line is not a table row: its heading is shaded and underlined as a
    // row is, and with motion it comes in 160 ms.
    assert.equal(
      await kind.w.locator('section[data-thread-open]').count(),
      1,
      `${what}: the line is marked`,
    );
    assert.equal(await line.getAttribute('data-thread-open'), '', what);
    const after = await styleOf();
    assert.notEqual(after.background, before.background, `${what}: shaded`);
    assert.match(after.shadow, /0px -2px 0px 0px inset/u, `${what}: underlined`);
    assert.deepEqual(
      after.animation,
      motion === 'reduce' ? ['none', '0s'] : ['evidence-row-in', '0.16s'],
      `${what}: the mark's motion`,
    );
    if (i % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(`${named}`),
      `${what}: the same way in`,
    );
    followed.push(lineId);
  }
  report.push(`${kind.name} ${story.name} ${lang} ${width} ${motion}`);
  return followed;
}
const example = {
  name: 'example',
  files: finExample,
  names: [0, 1, 2, 3].map((i) => `whole-post-closing-${i}.csv`),
  rows: (id) => sealedRows.get(id),
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('tb-financial: open the workspace');
await openDomainWorkspace(page, 'tb-financial');
await fin
  .getByRole('button', { name: 'Open a synthetic example', exact: true })
  .click();
await fin.locator('[data-financial-status]').waitFor();
await finIdle();
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  assert.deepEqual(
    await followSections(finKind, lang, width, motion, example),
    [...sealedRows.keys()],
    `financial ${lang}: every sealed line`,
  );
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
assert.equal(
  finKind.rows,
  2 * (6 + 3 * 7),
  `financial example rows: ${finKind.rows}`,
);
// A decision changes the result, and closes the evidence of the old one.
await fin
  .getByLabel('Decision reference', { exact: true })
  .fill('Synthetic independent browser reference');
await fin
  .getByLabel('Decision reason', { exact: true })
  .fill('Original whole-line accounts and independent presentation evidence reviewed');
const cash = finLines().first();
await cash
  .getByRole('button', { name: 'Review source rows · CASH · Cash', exact: true })
  .click();
await drawer.waitFor();
await cash.getByRole('button', { name: 'Accept whole line', exact: true }).click();
await finIdle();
await cash.getByText('Accepted', { exact: false }).first().waitFor();
assert.equal(await drawer.count(), 0, 'financial: a decision closes it');
// The long story, through the file inputs.
const scopeCells = finExample[0][1].slice(-12),
  longRows = [[], [], [], []];
let longTotal = 0;
for (let k = 1; k <= 56; k++) {
  const id = `L${String(k).padStart(2, '0')}`,
    accounts = k % 7 === 0 ? [`${k}A`, `${k}B`] : [`${k}A`];
  let amount = 0;
  for (const [j, a] of accounts.entries()) {
    const value = k * 10 + j;
    amount += value;
    longTotal += value;
    longRows[0].push([a, 'none', `Account ${a}`, 'current-asset', `${value}.00`, '0.00']);
    longRows[1].push([`M-${a}`, a, 'none', id, 'debit-positive', `P-${a}`]);
    longRows[2].push([
      `P-${a}`, a, 'none', 'current-asset', id, `Line ${k}`, 'current-asset',
      'debit-positive', '2026-01-01', '2026-12-31', `Synthetic presentation document ${a}`,
    ]);
  }
  longRows[3].push([id, `Line ${k}`, 'current-asset', `${amount}.00`]);
}
longRows[0].push(['900', 'none', 'Capital', 'equity', '0.00', `${longTotal}.00`]);
longRows[1].push(['M-900', '900', 'none', 'CAP', 'credit-positive', 'P-900']);
longRows[2].push([
  'P-900', '900', 'none', 'equity', 'CAP', 'Capital', 'equity', 'credit-positive',
  '2026-01-01', '2026-12-31', 'Synthetic presentation document 900',
]);
longRows[3].push(['CAP', 'Capital', 'equity', `${longTotal}.00`]);
// The trial balance reversed, the mapping turned by twenty rows, the evidence
// odd rows first; the statement in its own order.
const longOrder = [
  [...longRows[0]].reverse(),
  [...longRows[1].slice(20), ...longRows[1].slice(0, 20)],
  [...longRows[2].filter((_, i) => i % 2), ...longRows[2].filter((_, i) => !(i % 2))],
  longRows[3],
];
const longFiles = longOrder.map((rows, i) => [
  finExample[i][0],
  ...rows.map((r) => [...r, ...scopeCells]),
]);
const long = {
  name: 'long',
  files: longFiles,
  names: [0, 1, 2, 3].map((i) => `financial-long-${i}.csv`),
  rows: rowsInFiles(longFiles),
};
for (const [i, rows] of longFiles.entries()) {
  await writeFile(
    path.join(out, long.names[i]),
    rows.map((r) => r.join(',')).join('\n') + '\n',
  );
  await fin
    .locator('.workspace-source')
    .filter({ has: page.getByLabel(finWords.en[i], { exact: true }) })
    .locator('input[type="file"]')
    .setInputFiles(path.join(out, long.names[i]));
  await finIdle();
  await fin.getByText(long.names[i], { exact: true }).waitFor();
}
await fin
  .getByLabel(
    'I reviewed the trial balance, the proposed mapping, the independent presentation evidence and the financial position',
    { exact: false },
  )
  .check();
await fin
  .getByLabel(
    'I reviewed completeness of supplied accounts, dimensions, mappings, evidence and statement lines',
    { exact: true },
  )
  .check();
await fin
  .getByRole('button', { name: 'Check mapping and amounts', exact: true })
  .click();
await finIdle();
await finLines().first().waitFor();
const finPager = (name) =>
  fin
    .getByRole('navigation', { name: 'Pages of Statement lines', exact: true })
    .getByRole('button', { name, exact: true });
await page.setViewportSize({ width: 1024, height: 900 });
finKind.rows = 0;
const firstPage = await followSections(finKind, 'en', 1024, 'no-preference', long, [0, 6, 49]);
await finPager('Next page').click();
await finLines().first().waitFor();
const secondPage = await followSections(finKind, 'en', 1024, 'no-preference', long);
assert.deepEqual(
  [...firstPage, ...secondPage],
  ['L01', 'L07', 'L50', 'L51', 'L52', 'L53', 'L54', 'L55', 'L56', 'CAP'],
  'financial long: the lines followed, over two pages',
);
// Ten lines, two of them (L07 and L56) of two accounts.
assert.equal(
  finKind.rows,
  10 + 3 * (10 + 2),
  `financial long rows: ${finKind.rows}`,
);
// The way back, after the lines were turned while the drawer was open, turns
// them back to the line's page and returns to its way in.
await finLines()
  .last()
  .getByRole('button', { name: 'Review source rows · CAP · Capital', exact: true })
  .click();
await drawer.waitFor();
await arrived();
await finPager('Previous page').click();
await finLines().first().getByText('L01', { exact: false }).first().waitFor();
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'financial: the way back closes it');
assert.ok(
  (await page.evaluate(() => document.activeElement?.textContent ?? '')).includes(
    'CAP · Capital',
  ),
  "financial: the way back returns to the line's way in, on its own page",
);
report.push('financial long: way back over two pages');
// A change of type closes it.
await finLines()
  .first()
  .getByRole('button', { name: /^Review source rows · / })
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('tb-financial: open the workspace');
await openDomainWorkspace(page, 'tb-financial');
await finLines().first().waitFor();
assert.equal(
  await drawer.count(),
  0,
  'financial: a change of type closes the evidence',
);

// UX-10(d), intercompany: each pair opens its relationship row, then every
// ledger row the relationship names, from either entity (a transaction
// written twice is two rows), then the timing evidence attached to it. The
// example writes the frozen case pending byte for byte, and its rows are the
// sealed ones. A second story, written here, has 54 pairs over two pages:
// six of them one-sided with timing evidence, one with its left transaction
// written twice, and its ledgers and timing evidence each in another order.
// It is read through the workspace's own file inputs, and the rows of each
// pair are worked out here from the files.
const ICF = 'audit/intercompany/frozen';
const icWords = {
  en: [
    'Left entity ledger',
    'Right entity ledger',
    'Independent relationship evidence',
    'Independent timing evidence',
  ],
  ar: [
    'دفتر المنشأة اليسرى',
    'دفتر المنشأة اليمنى',
    'أدلة العلاقة المستقلة',
    'أدلة التوقيت المستقلة',
  ],
};
const icw = page.locator('[data-intercompany-workspace]');
const icIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await icw.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the intercompany workspace stayed busy for a minute');
};
const icPairs = () => icw.locator('section[data-intercompany-pair]');
const icKind = {
  name: 'intercompany',
  w: icw,
  items: icPairs,
  roles: icWords,
  named: (parts) => parts[0],
  rows: 0,
};
// The rows a pair must open, worked out from the four files: its
// relationship row; every row of the left ledger, then of the right, whose
// transaction identifier is the one the relationship names, in the file's
// order; then, for each side whose transaction is written once, the timing
// rows of that side and transaction, in the file's order.
function icRowsInFiles(files) {
  const at = (source, name) => files[source][0].indexOf(name),
    rowsOf = (source, test) =>
      files[source].flatMap((r, n) => (n > 0 && test(r) ? [n + 1] : []));
  return (relationId) => {
    const relation = rowsOf(2, (r) => r[at(2, 'Relation ID')] === relationId);
    assert.equal(relation.length, 1, `${relationId}: one relationship row`);
    const named = files[2][relation[0] - 1],
      ids = [
        named[at(2, 'Left transaction ID')],
        named[at(2, 'Right transaction ID')],
      ],
      ledgers = [0, 1].map((side) =>
        rowsOf(side, (r) => r[at(side, 'Transaction ID')] === ids[side]),
      );
    return [
      [2, relation[0]],
      ...ledgers.flatMap((rows, side) => rows.map((row) => [side, row])),
      ...[0, 1].flatMap((side) =>
        ledgers[side].length !== 1
          ? []
          : rowsOf(
              3,
              (r) =>
                r[at(3, 'Side')] === (side ? 'right' : 'left') &&
                r[at(3, 'Transaction ID')] === ids[side],
            ).map((row) => [3, row]),
      ),
    ];
  };
}
const icExample = await Promise.all(
  [0, 1, 2, 3].map(async (i) =>
    csvRows(await readFile(`${ICF}/pending-${i}.csv`, 'utf8')),
  ),
);
const icSealed = new Map(
  JSON.parse(await readFile(`${ICF}/expected.json`, 'utf8'))
    .cases.find((c) => c.name === 'pending')
    .financialFacts.groups.map((g) => [
      g.id,
      [
        [2, g.relationRow],
        ...(g.left ? [[0, g.left.row]] : []),
        ...(g.right ? [[1, g.right.row]] : []),
        ...g.timing.map((t) => [3, t.row]),
      ],
    ]),
);
// This check's own reading of the files agrees with the seal.
for (const [id, rows] of icSealed)
  assert.deepEqual(icRowsInFiles(icExample)(id), rows, `intercompany seal ${id}`);
const icExampleStory = {
  name: 'example',
  files: icExample,
  names: [0, 1, 2, 3].map((i) => `pending-${i}.csv`),
  rows: (id) => icSealed.get(id),
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('intercompany: open the workspace');
await openDomainWorkspace(page, 'intercompany');
await icw
  .getByRole('button', {
    name: 'Open a synthetic intercompany example',
    exact: true,
  })
  .click();
await icPairs().first().waitFor();
await icIdle();
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  assert.deepEqual(
    await followSections(icKind, lang, width, motion, icExampleStory),
    [...icSealed.keys()],
    `intercompany ${lang}: every sealed pair`,
  );
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
assert.equal(icKind.rows, 2 * 3 * 3, `intercompany example rows: ${icKind.rows}`);
// A decision changes the result, and closes the evidence of the old one.
watch.at('intercompany: a decision');
await icw
  .getByLabel('Intercompany decision reference', { exact: true })
  .fill('Synthetic independent browser reference');
await icw
  .getByLabel('Intercompany decision explanation', { exact: true })
  .fill(
    'Original whole reciprocal transactions and independent relationship evidence reviewed',
  );
const firstPair = icPairs().first();
await firstPair
  .getByRole('button', { name: 'Review source rows · R-001', exact: true })
  .click();
await drawer.waitFor();
await firstPair
  .getByRole('button', { name: 'Approve whole pair', exact: true })
  .click();
await icIdle();
await closed();
assert.equal(await drawer.count(), 0, 'intercompany: a decision closes it');
// The long story, through the file inputs.
watch.at('intercompany: the long story');
const icTiming = csvRows(
  await readFile(`${ICF}/future-left-timing-evidence-3.csv`, 'utf8'),
);
const icRows = [[], [], [], []];
for (let k = 1; k <= 54; k++) {
  const n = String(k).padStart(3, '0'),
    [a, b] = [`A-${n}`, `B-${n}`],
    amount = `${k}.00`,
    oneSided = k % 9 === 0;
  const left = [...icExample[0][1]];
  [left[5], left[6], left[8], left[9]] = [a, b, amount, '0.00'];
  icRows[0].push(left);
  if (k === 20) icRows[0].push([...left]);
  if (!oneSided) {
    const right = [...icExample[1][1]];
    [right[5], right[6], right[8], right[9]] = [b, a, '0.00', amount];
    icRows[1].push(right);
  }
  const relation = [...icExample[2][1]];
  [relation[0], relation[1], relation[2], relation[11]] = [
    `R-${n}`,
    a,
    b,
    `Independent reciprocal document ${n}`,
  ];
  if (oneSided) relation[8] = '2026-10-01';
  icRows[2].push(relation);
  if (oneSided) {
    const timing = [...icTiming[1]];
    [timing[0], timing[2], timing[3], timing[4], timing[5]] = [
      `T-${n}`,
      a,
      b,
      '2026-10-01',
      `-${amount}`,
    ];
    icRows[3].push(timing);
  }
}
// The left ledger reversed, the right turned by 25 rows, the timing
// evidence reversed; the relationships in their own order.
const icLongFiles = [
  [...icRows[0]].reverse(),
  [...icRows[1].slice(25), ...icRows[1].slice(0, 25)],
  icRows[2],
  [...icRows[3]].reverse(),
].map((rows, i) => [i === 3 ? icTiming[0] : icExample[i][0], ...rows]);
const icLong = {
  name: 'long',
  files: icLongFiles,
  names: [0, 1, 2, 3].map((i) => `intercompany-long-${i}.csv`),
  rows: icRowsInFiles(icLongFiles),
};
for (const [i, rows] of icLongFiles.entries()) {
  await writeFile(
    path.join(out, icLong.names[i]),
    rows.map((r) => r.join(',')).join('\n') + '\n',
  );
  await icw
    .locator('.workspace-source')
    .filter({ has: page.getByLabel(icWords.en[i], { exact: true }) })
    .locator('input[type="file"]')
    .setInputFiles(path.join(out, icLong.names[i]));
  await icIdle();
  await icw.getByText(icLong.names[i], { exact: true }).waitFor();
}
await icw
  .getByLabel(
    'I reviewed the left and right entity ledgers, the independent relationship evidence and the independent timing evidence',
    { exact: false },
  )
  .check();
await icw
  .getByLabel(
    'I reviewed the complete supplied transactions, relationships and timing evidence.',
    { exact: true },
  )
  .check();
await icw
  .getByRole('button', { name: 'Check reciprocal transactions', exact: true })
  .click();
await icIdle();
await icPairs().first().waitFor();
const icPager = (name) =>
  icw
    .getByRole('navigation', { name: 'Pages of Counterpart pairs', exact: true })
    .getByRole('button', { name, exact: true });
await page.setViewportSize({ width: 1024, height: 900 });
icKind.rows = 0;
const icFirst = await followSections(icKind, 'en', 1024, 'no-preference', icLong, [0, 8, 19]);
await icPager('Next page').click();
await icPairs().first().waitFor();
const icSecond = await followSections(icKind, 'en', 1024, 'no-preference', icLong);
assert.deepEqual(
  [...icFirst, ...icSecond],
  ['R-001', 'R-009', 'R-020', 'R-051', 'R-052', 'R-053', 'R-054'],
  'intercompany long: the pairs followed, over two pages',
);
// R-001, R-051 to R-053: three rows each; R-009 and R-054: the relationship,
// the left row and the timing row; R-020: the relationship, the left row
// twice and the right row.
assert.equal(icKind.rows, 4 * 3 + 2 * 3 + 4, `intercompany long rows: ${icKind.rows}`);
// The way back, after the pairs were turned while the drawer was open, turns
// them back to the pair's page and returns to its way in.
watch.at('intercompany: the way back');
await icPairs()
  .last()
  .getByRole('button', { name: 'Review source rows · R-054', exact: true })
  .click();
await drawer.waitFor();
await arrived();
await icPager('Previous page').click();
await icPairs().first().getByText('R-001', { exact: false }).first().waitFor();
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'intercompany: the way back closes it');
assert.ok(
  (await page.evaluate(() => document.activeElement?.textContent ?? '')).includes(
    'R-054',
  ),
  "intercompany: the way back returns to the pair's way in, on its own page",
);
report.push('intercompany long: way back over two pages');
// A change of type closes it.
await icPairs()
  .first()
  .getByRole('button', { name: /^Review source rows · / })
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('intercompany: open the workspace again');
await openDomainWorkspace(page, 'intercompany');
await icPairs().first().waitFor();
assert.equal(
  await drawer.count(),
  0,
  'intercompany: a change of type closes the evidence',
);


// The payment gateway (UX-10(d)). A batch has two tables of one row each:
// its totals open the transaction and fee rows they sum, and its residuals
// every row of the batch. Those are the rows under each file's header that
// hold any text, of the files the table draws on, in file order, worked out
// here from the files.
const PGF = 'audit/payment-gateway/frozen';
const pgWords = {
  en: [
    'Gateway sales and refunds',
    'Independent fee evidence',
    'Gateway settlement summary',
    'Bank credit evidence',
  ],
  ar: [
    'مبيعات ومرتجعات البوابة',
    'أدلة الرسوم المستقلة',
    'ملخص تسوية البوابة',
    'أدلة الإيداع البنكي',
  ],
};
const pgTables = {
  en: ['Calculated totals', 'Residuals, calculated minus summary'],
  ar: ['المجاميع المحسوبة', 'الفروق، المحسوب ناقص الملخص'],
};
const pgw = page.locator('[data-gateway-workspace]');
const pgIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    if ((await pgw.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the gateway workspace stayed busy for a minute');
};
const pgRowsInFiles = (files) => (table) =>
  (table ? [0, 1, 2, 3] : [0, 1]).flatMap((source) =>
    files[source].flatMap((r, n) =>
      n > 0 && r.some((v) => v.trim()) ? [[source, n + 1]] : [],
    ),
  );
let pgRows = 0;
// Each table of the batch, opened in turn: the way in names the batch and
// the table, the drawer's heading names them, its figures are the row's,
// its sources are the story's rows, each held to its file, the row is
// marked, and the way back or Escape returns the focus to the same way in.
async function followBatch(lang, width, motion, story) {
  const tw = threadWords[lang],
    what = `gateway ${story.name} ${lang} ${width} px ${motion}`;
  for (const [t, label] of pgTables[lang].entries()) {
    watch.at(`${what}: ${label}`);
    const table = pgw.locator(`table[aria-label="${label}"]`),
      head = (await table.locator('thead th').allInnerTexts()).map((x) =>
        x.trim(),
      );
    assert.equal(head[0], tw.way, `${what} ${label}: the way in opens the row`);
    const row = table.locator('tbody tr');
    assert.equal(await row.count(), 1, `${what} ${label}: one row`);
    const cells = (await row.locator('td, th').allInnerTexts()).map((x) =>
        x.trim(),
      ),
      named = `${story.batch} · ${label}`,
      way = row.getByRole('button', {
        name: `${tw.way} · ${named}`,
        exact: true,
      });
    assert.equal(await way.count(), 1, `${what} ${label}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the batch and the table`,
    );
    // Each figure whole and in its place, as the row shows it.
    assert.deepEqual(
      (
        await drawer
          .locator('.evidence-drawer__amount .tarasuf-amount')
          .allInnerTexts()
      ).map((x) => x.trim()),
      cells.slice(1),
      `${what} ${label}: the row's figures`,
    );
    const sources = await arDrawn(),
      rowOf = (s) => Number(s.place.Row ?? s.place['الصف']);
    assert.deepEqual(
      sources.map((s) => [s.source, rowOf(s)]),
      story.rows(t),
      `${what} ${label}: the rows`,
    );
    for (const s of sources) {
      assert.equal(s.role, pgWords[lang][s.source], `${what}: role`);
      assert.equal(
        s.place.File ?? s.place['الملف'],
        story.names[s.source],
        `${what}: the file`,
      );
      heldToFile({ ...s, row: rowOf(s) }, story.files, `${what} ${label}`);
    }
    pgRows += sources.length;
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: one row marked`,
    );
    assert.equal(await row.getAttribute('data-thread-open'), '', what);
    if (t)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).includes(named),
      `${what}: the same way in`,
    );
  }
  report.push(`gateway ${story.name} ${lang} ${width} ${motion}`);
}
const pgExample = await Promise.all(
  [0, 1, 2, 3].map(async (i) =>
    csvRows(await readFile(`${PGF}/pending-${i}.csv`, 'utf8')),
  ),
);
// This check's own reading of the files agrees with the seal: the rows
// the engine read as each file's role.
const pgSealed = JSON.parse(await readFile(`${PGF}/expected.json`, 'utf8'))
  .cases.find((c) => c.name === 'pending')
  .expected.inventory.filter((r) => r.kind !== 'header' && r.kind !== 'blank')
  .map((r) => [r.source, r.row]);
assert.deepEqual(pgRowsInFiles(pgExample)(1), pgSealed, 'gateway seal');
const pgExampleStory = {
  name: 'example',
  batch: 'BATCH-001',
  files: pgExample,
  names: [0, 1, 2, 3].map((i) => `pending-${i}.csv`),
  rows: pgRowsInFiles(pgExample),
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('gateway: open the workspace');
await openDomainWorkspace(page, 'gateway');
await pgw
  .getByRole('button', {
    name: 'Open a synthetic gateway example',
    exact: true,
  })
  .click();
await pgw.locator('[data-gateway-status]').waitFor();
await pgIdle();
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  await followBatch(lang, width, motion, pgExampleStory);
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'EN English', exact: true }).click();
// Totals: three transactions and two fees; residuals: those, the
// settlement and the payout. Twice, in English and in Arabic.
assert.equal(pgRows, 2 * (5 + 7), `gateway example rows: ${pgRows}`);
// The signed example: its own files, read with the signed amount column.
watch.at('gateway: the signed example');
const PGS = 'audit/payment-gateway-signed/fixtures/sar-mixed';
const pgSigned = await Promise.all(
  [0, 1, 2, 3].map(async (i) =>
    csvRows(await readFile(`${PGS}/${i}.csv`, 'utf8')),
  ),
);
await pgw
  .getByRole('button', {
    name: 'Open a synthetic signed amount example',
    exact: true,
  })
  .click();
await pgw.getByText('signed-0.csv', { exact: true }).first().waitFor();
await pgIdle();
pgRows = 0;
await followBatch('en', 1440, 'no-preference', {
  name: 'signed',
  batch: 'SYNTH-BATCH-01',
  files: pgSigned,
  names: [0, 1, 2, 3].map((i) => `signed-${i}.csv`),
  rows: pgRowsInFiles(pgSigned),
});
const pgSignedRows = pgRows;
assert.ok(pgSignedRows > 4, `gateway signed rows: ${pgSignedRows}`);
// A decision changes the result, and closes the evidence of the old one.
watch.at('gateway: a decision');
await pgw
  .getByLabel('Gateway decision reference', { exact: true })
  .fill('Synthetic independent browser reference');
await pgw
  .getByLabel('Gateway decision explanation', { exact: true })
  .fill('Synthetic batch evidence reviewed for the browser check');
await pgw
  .getByRole('button', {
    name: `Review source rows · SYNTH-BATCH-01 · ${pgTables.en[1]}`,
    exact: true,
  })
  .click();
await drawer.waitFor();
await pgw
  .getByRole('button', { name: 'Reject whole batch', exact: true })
  .click();
await pgIdle();
await closed();
assert.equal(await drawer.count(), 0, 'gateway: a decision closes it');
// A long batch, written here and uploaded through the file inputs: sixty
// transactions with a row of empty cells among them, which is no row of
// the batch, and four fees, against the example's settlement and payout.
watch.at('gateway: the long story');
const pgLongFiles = [
  [
    pgExample[0][0],
    ...Array.from({ length: 60 }, (_, k) => {
      const r = [...pgExample[0][1]];
      [r[0], r[1], r[3], r[4]] = [
        `T-${String(k + 1).padStart(3, '0')}`,
        k % 7 === 3 ? 'refund' : 'sale',
        `${k + 1}.00`,
        `Order ${k + 1}`,
      ];
      return r;
    }).flatMap((r, k) => (k === 30 ? [r.map(() => ''), r] : [r])),
  ],
  [
    pgExample[1][0],
    ...Array.from({ length: 4 }, (_, k) => {
      const r = [...pgExample[1][1]];
      [r[0], r[1], r[2]] = [`E-${k + 1}`, `F-${k + 1}`, `${k + 1}.00`];
      return r;
    }),
  ],
  pgExample[2],
  pgExample[3],
];
const pgLong = {
  name: 'long',
  batch: 'BATCH-001',
  files: pgLongFiles,
  names: [0, 1, 2, 3].map((i) => `gateway-long-${i}.csv`),
  rows: pgRowsInFiles(pgLongFiles),
};
// On a fresh page, as a reader starts one: the examples' scope is not the
// story's.
await page.reload();
if ((await page.evaluate(() => document.documentElement.lang)) !== 'en')
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
await openDomainWorkspace(page, 'gateway');
for (const [i, rows] of pgLongFiles.entries()) {
  await writeFile(
    path.join(out, pgLong.names[i]),
    rows.map((r) => r.join(',')).join('\n') + '\n',
  );
  await pgw
    .locator('.workspace-source')
    .filter({ has: page.getByLabel(pgWords.en[i], { exact: true }) })
    .locator('input[type="file"]')
    .setInputFiles(path.join(out, pgLong.names[i]));
  await pgIdle();
  await pgw.getByText(pgLong.names[i], { exact: true }).waitFor();
}
await pgw
  .getByLabel(
    'I reviewed the gateway sales and refunds, the independent fee evidence, the gateway settlement summary and the bank credit evidence',
    { exact: false },
  )
  .check();
await pgw
  .getByRole('button', { name: 'Check gateway batch', exact: true })
  .click();
await pgIdle();
await pgw.locator(`table[aria-label="${pgTables.en[1]}"] tbody tr`).waitFor();
await page.setViewportSize({ width: 1024, height: 900 });
pgRows = 0;
await followBatch('en', 1024, 'no-preference', pgLong);
// Totals: sixty transactions and four fees; residuals: those, the
// settlement and the payout. The row of empty cells is in neither.
assert.equal(pgRows, 64 + 66, `gateway long rows: ${pgRows}`);
// A change of type closes it.
await pgw
  .getByRole('button', { name: /^Review source rows · BATCH-001 · / })
  .first()
  .click();
await drawer.waitFor();
await page
  .locator('select[data-reconciliation-type-select]')
  .selectOption('bank');
watch.at('gateway: open the workspace again');
await openDomainWorkspace(page, 'gateway');
await pgw.locator('[data-gateway-status]').waitFor();
assert.equal(
  await drawer.count(),
  0,
  'gateway: a change of type closes the evidence',
);

// The supplier comparison: every row of each of its three lists, on every
// page, opens every row the engine traced for its case. The example's files
// are the page's own (lib/reconciliation/demo.ts), each with its header in
// the first row; a story of 81 rows written here is uploaded through the
// page's two file inputs and held to its files with this check's own reader.
const supWords = {
  en: {
    side: ['Supplier', 'AP ledger'],
    tabs: ['Unmatched', 'Matched', /^Needs Review \(\d+\)$/u],
    example: 'Try the sample',
    run: 'Check and compare',
    next: 'Next page',
    search: 'Search results',
  },
  ar: {
    side: ['المورد', 'الدفتر'],
    tabs: ['دون مقابل', 'المطابقات', /^يحتاج مراجعة \(\d+\)$/u],
    example: 'جرّب المثال',
    run: 'تحقق وقارن',
    next: 'الصفحة التالية',
    search: 'البحث في النتائج',
  },
};
const supList = page.locator('section.surface').filter({
    has: page.locator('.results-frame'),
  }),
  supRowsOf = () => supList.locator('.results-frame table tbody tr');
let supRows = 0,
  supOpened = 0;
// One row of the list shown: its way in names its side and row, the drawer
// is named the same, its amount and members are the row's, its sources are
// the case's (the row itself among them), each held to its file.
async function followSupplierRow(lang, what, row, story, closeBy) {
  const tw = threadWords[lang],
    sw = supWords[lang],
    way = row.locator('td').first().getByRole('button');
  const name = (await way.textContent()).trim(),
    [, side, own] = name.match(/^.+ · (.+) · (\d+)$/u) ?? [];
  assert.equal(name, `${tw.way} · ${side} · ${own}`, `${what}: ${name}`);
  const sideAt = sw.side.indexOf(side);
  assert.ok(sideAt >= 0, `${what}: a side named ${side}`);
  const cells = row.locator('td');
  assert.equal(
    (await cells.nth(1).innerText()).trim(),
    `${side} · ${own}`,
    `${what}: the way in names the row's own source and row`,
  );
  const amount = (
      await cells.nth(4).evaluate((e) => e.firstChild.textContent)
    ).trim(),
    [, x, y] = (await cells.nth(4).locator('.muted').innerText())
      .trim()
      .match(/^(\d+):(\d+)/u)
      .map(Number);
  assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
  await way.click();
  await drawer.waitFor();
  await arrived();
  assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
  assert.equal(
    await way.getAttribute('aria-controls'),
    await drawer.getAttribute('id'),
    `${what}: the way in names the drawer`,
  );
  const opened = await focused();
  assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
  assert.equal(
    opened.text,
    `${tw.heading} · ${side} · ${own}`,
    `${what}: the heading names the side and the row`,
  );
  assert.equal(
    (await drawer.locator('[data-thread-amount]').innerText()).trim(),
    amount,
    `${what}: the case's amount as the row shows it`,
  );
  const sources = await arDrawn(),
    rowOf = (s) => Number(s.place.Row ?? s.place['الصف']);
  assert.deepEqual(
    [0, 1].map((n) => sources.filter((s) => s.source === n).length),
    [x, y],
    `${what}: every member of the case, ${x}:${y}`,
  );
  assert.ok(
    sources.some((s) => s.source === sideAt && rowOf(s) === Number(own)),
    `${what}: the row itself is among them`,
  );
  for (const s of sources) {
    assert.equal(s.role, sw.side[s.source], `${what}: role`);
    assert.equal(
      s.place.File ?? s.place['الملف'],
      story.names[s.source],
      `${what}: the file`,
    );
    assert.equal(s.place.Sheet ?? s.place['الورقة'], 'CSV', `${what}: sheet`);
    assert.equal(s.missing, undefined, `${what}: its cells are drawn`);
    heldToFile({ ...s, row: rowOf(s) }, story.files, `${what} ${side} ${own}`);
  }
  supRows += sources.length;
  supOpened++;
  const places = sources.map((s) => `${s.source}:${rowOf(s)}`);
  assert.equal(
    await page.locator('tr[data-thread-open]').count(),
    1,
    `${what}: one row marked`,
  );
  assert.equal(await row.getAttribute('data-thread-open'), '', what);
  if (closeBy === 'back')
    await drawer.getByRole('button', { name: tw.back, exact: true }).click();
  else await drawer.getByRole('heading', { level: 2 }).press('Escape');
  await closed();
  assert.equal(await drawer.count(), 0, `${what}: it closes`);
  const back = await focused();
  assert.equal(
    back.text.trim(),
    name,
    `${what}: the focus returns to the same way in`,
  );
  return places;
}
// Every row of each list, on every page of it. Each list's row is a case;
// the cases of the three lists together draw every row of both files once.
async function followSupplier(lang, width, motion, story) {
  const sw = supWords[lang],
    tw = threadWords[lang],
    what = `supplier ${story.name} ${lang} ${width} px ${motion}`;
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  const counts = [],
    places = [];
  for (const tab of sw.tabs) {
    await supList.getByRole('tab', { name: tab, exact: true }).click();
    const head = (
      await supList.locator('.results-frame thead th').allInnerTexts()
    ).map((x) => x.trim());
    assert.equal(head[0], tw.way, `${what}: the way in heads the list`);
    let seen = 0;
    for (let at = 0; ; at++) {
      watch.at(`${what}: ${tab} page ${at + 1}`);
      const count = await supRowsOf().count();
      for (let i = 0; i < count; i++)
        places.push(
          ...(await followSupplierRow(
            lang,
            `${what} ${tab} page ${at + 1} row ${i + 1}`,
            supRowsOf().nth(i),
            story,
            i % 2 ? 'back' : 'escape',
          )),
        );
      seen += count;
      const next = supList.getByRole('button', { name: sw.next, exact: true });
      if (!(await next.count()) || (await next.isDisabled())) break;
      await next.click();
    }
    counts.push(seen);
  }
  assert.deepEqual(
    places.toSorted(),
    story.files
      .flatMap((rows, source) =>
        rows.slice(1).map((_, n) => `${source}:${n + 2}`),
      )
      .toSorted(),
    `${what}: the cases draw every row of both files, once`,
  );
  report.push(
    `supplier ${story.name} ${lang} ${width} ${motion}: ${counts.join(' / ')} cases`,
  );
  return counts;
}
async function supplierLang(lang) {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang)
    await page
      .getByRole('button', {
        name: lang === 'ar' ? 'AR العربية' : 'EN English',
        exact: true,
      })
      .click();
}
const supExample = {
  name: 'example',
  files: demoFiles.map((f) => f.sheets[0].rows),
  names: demoFiles.map((f) => f.name),
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
watch.at('supplier: the example');
await supplierLang('en');
const supPanel = await openDomainWorkspace(page, 'supplier');
await supPanel
  .getByRole('button', { name: supWords.en.example, exact: true })
  .click();
await supPanel
  .getByRole('button', { name: supWords.en.run, exact: true })
  .click();
await supRowsOf().first().waitFor();
const supExampleCounts = [];
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  await supplierLang(lang);
  supExampleCounts.push(await followSupplier(lang, width, motion, supExample));
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await supplierLang('en');
// The same cases in both languages: five without a counterpart, two
// matched and two to review, over eight supplier rows and six ledger rows.
assert.deepEqual(
  supExampleCounts,
  [
    [5, 2, 2],
    [5, 2, 2],
  ],
  'supplier example: the same lists in both languages',
);
// Another list closes it: a tab, then a search.
const supWay = () => supRowsOf().first().locator('td').first().getByRole('button');
await supList.getByRole('tab', { name: 'Matched', exact: true }).click();
await supWay().click();
await drawer.waitFor();
await supList.getByRole('tab', { name: 'Unmatched', exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'supplier: another tab closes it');
await supWay().click();
await drawer.waitFor();
await supList
  .getByRole('textbox', { name: 'Search results', exact: true })
  .fill('INV');
await closed();
assert.equal(await drawer.count(), 0, 'supplier: a search closes it');
await supList
  .getByRole('textbox', { name: 'Search results', exact: true })
  .fill('');
// Leaving the review step closes it, as the keyboard leaves it: to the
// workpaper and back.
await supWay().click();
await drawer.waitFor();
for (const name of ['Prepare the workpaper', 'Back to review']) {
  const step = page.getByRole('button', { name, exact: true });
  await step.waitFor();
  await step.focus();
  await page.keyboard.press('Enter');
}
await supRowsOf().first().waitFor();
assert.equal(
  await drawer.count(),
  0,
  'supplier: leaving the review step closes it',
);
// A story of 81 rows written here: forty-one supplier rows (forty invoices
// and a payment), forty ledger rows (thirty-five of those invoices, one at
// another amount and four of its own), its columns in another order than
// the example's, uploaded through the page's file inputs.
watch.at('supplier: the long story');
const supHeader = ['Reference', 'Posting date', 'Amount', 'Narrative'];
const supLongFiles = [
  [
    supHeader,
    ...Array.from({ length: 40 }, (_, k) => [
      `SINV-${k + 1}`,
      `2026-08-${String(1 + (k % 28)).padStart(2, '0')}`,
      `${(k + 1) * 10}.00`,
      `Synthetic invoice ${k + 1}`,
    ]),
    ['SPAY-1', '2026-08-29', '-55.00', 'Synthetic payment'],
  ],
  [
    supHeader,
    ...Array.from({ length: 40 }, (_, k) =>
      k % 10 === 9
        ? [
            `LOCAL-${k + 1}`,
            `2026-08-${String(1 + (k % 28)).padStart(2, '0')}`,
            `${k + 3}.00`,
            `Ledger only ${k + 1}`,
          ]
        : [
            `SINV-${k + 1}`,
            `2026-08-${String(1 + (k % 28)).padStart(2, '0')}`,
            `${(k + 1) * 10 + (k === 4 ? 1 : 0)}.00`,
            `Synthetic invoice ${k + 1}`,
          ],
    ),
  ],
];
const supLong = {
  name: 'long',
  files: supLongFiles,
  names: ['supplier-long.csv', 'ledger-long.csv'],
};
await page.reload();
await supplierLang('en');
const supLongPanel = await openDomainWorkspace(page, 'supplier');
for (const [i, label] of [
  'Supplier statement',
  'Accounts payable report',
].entries()) {
  const file = path.join(out, supLong.names[i]);
  await writeFile(file, supLongFiles[i].map((r) => r.join(',')).join('\n') + '\n');
  await supLongPanel.getByLabel(label, { exact: true }).setInputFiles(file);
  await supLongPanel.getByText(supLong.names[i], { exact: true }).first().waitFor();
}
// The files as this check reads them back from the bytes it wrote.
for (const [i, rows] of supLongFiles.entries())
  assert.deepEqual(
    csvRows(await readFile(path.join(out, supLong.names[i]), 'utf8')),
    rows,
    `supplier long: file ${i} reads back`,
  );
await supLongPanel.getByRole('button', { name: 'Confirm data', exact: true }).click();
await supLongPanel.getByLabel('Currency', { exact: true }).fill('SAR');
await supLongPanel.getByLabel('Cut-off date', { exact: true }).fill('2026-08-31');
await supLongPanel
  .getByRole('button', { name: supWords.en.run, exact: true })
  .click();
await supRowsOf().first().waitFor();
const supLongCounts = await followSupplier(
  'en',
  1024,
  'no-preference',
  supLong,
);
assert.ok(
  supLongCounts[1] > 30,
  `supplier long: the matched list has more than a page: ${supLongCounts.join(' ')}`,
);
// The way back returns to the row's own page after the list was turned.
watch.at('supplier: the way back over pages');
await supList.getByRole('tab', { name: 'Unmatched', exact: true }).click();
await supList.getByRole('tab', { name: 'Matched', exact: true }).click();
await supList.getByRole('button', { name: 'Next page', exact: true }).click();
const supTurned = supRowsOf().nth(3),
  supTurnedName = (
    await supTurned.locator('td').first().getByRole('button').textContent()
  ).trim();
await supTurned.locator('td').first().getByRole('button').click();
await drawer.waitFor();
await supList
  .getByRole('button', { name: 'Previous page', exact: true })
  .click();
assert.ok(
  !(await supList.getByText(supTurnedName.split(' · ').slice(1).join(' · '), {
    exact: true,
  }).count()),
  'supplier long: the row is off the page shown',
);
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(
  (await focused()).text.trim(),
  supTurnedName,
  'supplier long: the way back returns to the row on its page',
);
// Fourteen rows of the example twice, and the story's 81.
assert.deepEqual(
  [supOpened, supRows],
  [2 * 9 + supLongCounts.reduce((a, b) => a + b, 0), 2 * 14 + 81],
  'supplier: cases opened and rows drawn',
);
// A change of type closes it.
await supWay().click();
await drawer.waitFor();
await page.locator('select[data-reconciliation-type-select]').selectOption('bank');
await openDomainWorkspace(page, 'supplier');
assert.equal(await drawer.count(), 0, 'supplier: a change of type closes it');

// UX-10(d), allocation: each item of the value ledger, a payment or an
// invoice, opens the one row it was read from, with the two amount cells the
// reader traced for it, and shows its four figures as its row does. The
// example writes the frozen case one-to-many byte for byte. A story of 63
// items written here, each file's columns in another order, is read through
// the workspace's own file inputs and fills two pages. Each item's row is
// found here by its identifier in its file, read with this check's reader.
const ALF = 'audit/allocation/frozen';
const alOrder = (a, b) => (a < b ? -1 : Number(a > b));
const alSides = {
  en: ['Available payments', 'Open invoices', 'Proposed remittance'],
  ar: ['الدفعات المتاحة', 'الفواتير المفتوحة', 'إشعار التخصيص المقترح'],
};
const AL_ID = ['Payment ID', 'Invoice ID'],
  AL_TRACED = ['Original amount', 'Available amount'];
const alw = page.locator('[data-allocation-workspace]');
const alIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await alw.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the allocation workspace stayed busy for a minute');
};
const alLedger = alw.getByTestId('allocation-ledger');
const alPager = (name) =>
  alw
    .getByRole('navigation', { name: 'Pages of Value ledger', exact: true })
    .getByRole('button', { name, exact: true });
let alOpened = 0;
// Every item on the page shown, opened in turn: the way in names its side
// and its reference, the drawer's heading names them, its figures are the
// row's, its one source is the item's file at the row that holds its
// identifier, with the two traced cells as the file holds them, the row is
// marked, and the way back or Escape returns the focus to the same way in.
async function followItems(lang, width, motion, story) {
  const tw = threadWords[lang],
    what = `allocation ${story.name} ${lang} ${width} px ${motion}`,
    head = (await alLedger.locator('thead th').allInnerTexts()).map((x) =>
      x.trim(),
    );
  assert.equal(head[0], tw.way, `${what}: the way in opens the row`);
  const rows = alLedger.locator('tbody tr'),
    count = await rows.count(),
    seen = [];
  assert.ok(count > 0, `${what}: items`);
  for (let n = 0; n < count; n++) {
    const row = rows.nth(n),
      cells = (await row.locator('td, th').allInnerTexts()).map((x) =>
        x.trim(),
      ),
      [, sideName, reference] = cells,
      side = alSides[lang].indexOf(sideName),
      named = `${sideName} · ${reference}`;
    watch.at(`${what}: ${named}`);
    assert.ok(side === 0 || side === 1, `${what}: ${named} is an item`);
    const file = story.files[side],
      id = file[0].indexOf(AL_ID[side]),
      at = file.findIndex((r, i) => i > 0 && r[id] === reference);
    assert.equal(
      file.filter((r, i) => i > 0 && r[id] === reference).length,
      1,
      `${what} ${named}: one row of its file holds it`,
    );
    const way = row.getByRole('button', {
      name: `${tw.way} · ${named}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${named}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the item`,
    );
    assert.deepEqual(
      (
        await drawer
          .locator('.evidence-drawer__amount .tarasuf-amount')
          .allInnerTexts()
      ).map((x) => x.trim()),
      cells.slice(3),
      `${what} ${named}: the item's four figures`,
    );
    const sources = await arDrawn();
    assert.deepEqual(
      sources.map((s) => [
        s.source,
        s.role,
        s.place.File ?? s.place['الملف'],
        s.place.Sheet ?? s.place['الورقة'],
        Number(s.place.Row ?? s.place['الصف']),
        s.missing,
      ]),
      [[side, sideName, story.names[side], 'CSV', at + 1, undefined]],
      `${what} ${named}: the one row it was read from`,
    );
    assert.deepEqual(
      sources[0].cells,
      AL_TRACED.map((field) => {
        const c = file[0].indexOf(field);
        return [field, String(c + 1), file[at][c]];
      }),
      `${what} ${named}: the traced cells as the file holds them`,
    );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: one row marked`,
    );
    assert.equal(await row.getAttribute('data-thread-open'), '', what);
    if (n % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).endsWith(named),
      `${what}: the same way in`,
    );
    seen.push(`${side}:${reference}`);
    alOpened++;
  }
  report.push(`allocation ${story.name} ${lang} ${width} ${motion}`);
  return seen;
}
// Every data row of the payments and the invoices, by side and identifier.
const alItemsOf = (files) =>
  [0, 1].flatMap((side) =>
    files[side]
      .slice(1)
      .map((r) => `${side}:${r[files[side][0].indexOf(AL_ID[side])]}`),
  );
const alExample = {
  name: 'example',
  files: await Promise.all(
    [0, 1, 2].map(async (i) =>
      csvRows(await readFile(`${ALF}/one-to-many-${i}.csv`, 'utf8')),
    ),
  ),
  names: [0, 1, 2].map((i) => `synthetic-allocation-${i}.csv`),
};
watch.at('allocation: open the workspace');
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
await supplierLang('en');
await openDomainWorkspace(page, 'allocation');
await alw
  .getByRole('button', {
    name: 'Open synthetic allocation example',
    exact: true,
  })
  .click();
await alw.getByTestId('allocation-result').waitFor();
await alIdle();
// One payment and three invoices, in both languages.
for (const [lang, width, motion] of [
  ['en', 1440, 'no-preference'],
  ['ar', 390, 'reduce'],
]) {
  await supplierLang(lang);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });
  assert.deepEqual(
    (await followItems(lang, width, motion, alExample)).sort(alOrder),
    alItemsOf(alExample.files).sort(alOrder),
    `allocation example ${lang}: every item once`,
  );
}
await page.emulateMedia({ reducedMotion: null });
await page.setViewportSize({ width: 1440, height: 900 });
await supplierLang('en');
// A decision changes the result, and closes the evidence of the old one;
// the payment then opens with the figures the decision left, the seal's.
watch.at('allocation: a decision');
const alPayment = () =>
  alLedger.getByRole('button', {
    name: `${threadWords.en.way} · ${alSides.en[0]} · P1`,
    exact: true,
  });
await alPayment().click();
await drawer.waitFor();
await alw
  .getByLabel('Decision or undo reason', { exact: true })
  .fill('Synthetic advice explicitly states this distribution');
for (const box of await alw.getByTestId('allocation-proof').locator('input').all())
  if (await box.isEnabled()) await box.check();
await alw
  .getByRole('button', { name: 'Approve selected advice atomically', exact: true })
  .click();
await alw.getByTestId('allocation-event').first().waitFor();
await alIdle();
await closed();
assert.equal(await drawer.count(), 0, 'allocation: a decision closes it');
const alSealed = JSON.parse(await readFile(`${ALF}/expected.json`, 'utf8'))
  .cases.find((c) => c.name === 'one-to-many').balances['0:P1'];
await alPayment().click();
await drawer.waitFor();
assert.deepEqual(
  (
    await drawer
      .locator('.evidence-drawer__amount .tarasuf-amount')
      .allInnerTexts()
  ).map((x) => x.trim()),
  alSealed.map((v) =>
    (v / 100).toLocaleString('en', { minimumFractionDigits: 2 }),
  ),
  'allocation: the payment opens with the figures the decision left',
);
await drawer.getByRole('heading', { level: 2 }).press('Escape');
await closed();
// The long story: three payments and sixty invoices, the payments' columns
// reversed and the invoices' turned by four, with one remittance line.
watch.at('allocation: the long story');
const alHeaders = alExample.files.map((f) => f[0]),
  alScope = alExample.files[0][1].slice(2, 9),
  alTurned = (header, order) => (row) => order.map((h) => row[header.indexOf(h)]);
const alOrders = [
  [...alHeaders[0]].reverse(),
  [...alHeaders[1].slice(4), ...alHeaders[1].slice(0, 4)],
  alHeaders[2],
];
const alLongRows = [
  [
    ['P-01', '2026-09-20', ...alScope, '5000.00', '4000.00'],
    ['P-02', '2026-09-21', ...alScope, '3000.50', '3000.50'],
    ['P-03', '2026-09-22', ...alScope, '1200.00', '1.00'],
  ],
  Array.from({ length: 60 }, (_, k) => {
    const original = `${101 + k}.${String((k * 7) % 100).padStart(2, '0')}`;
    return [
      `I-${String(k + 1).padStart(3, '0')}`,
      '2026-08-15',
      ...alScope,
      original,
      k % 4 ? original : `${51 + k}.00`,
    ];
  }),
  [['R-01', ...alScope, 'P-01', 'I-001', '10.00']],
];
const alLongFiles = alLongRows.map((rows, side) => [
  alOrders[side],
  ...rows.map(alTurned(alHeaders[side], alOrders[side])),
]);
const alLong = {
  name: 'long',
  files: alLongFiles,
  names: [0, 1, 2].map((i) => `allocation-long-${i}.csv`),
};
await page.reload();
await supplierLang('en');
await openDomainWorkspace(page, 'allocation');
for (const [side, rows] of alLongFiles.entries()) {
  const file = path.join(out, alLong.names[side]);
  await writeFile(file, rows.map((r) => r.join(',')).join('\n') + '\n');
  assert.deepEqual(
    csvRows(await readFile(file, 'utf8')),
    rows,
    `allocation long: file ${side} reads back`,
  );
  const source = alw.getByTestId(`allocation-source-${side}`);
  await source.getByLabel(alSides.en[side], { exact: true }).setInputFiles(file);
  await source
    .getByRole('heading', { name: alLong.names[side], exact: true })
    .waitFor();
}
await page.evaluate(
  () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
);
await alw
  .getByLabel(
    'I reviewed the available payments, the open invoices and the proposed remittance',
    { exact: false },
  )
  .check();
await alw.getByRole('button', { name: 'Read value ledger', exact: true }).click();
await alw.getByTestId('allocation-result').waitFor();
await alIdle();
await page.setViewportSize({ width: 1024, height: 900 });
const alFirst = await followItems('en', 1024, 'no-preference', alLong);
await alPager('Next page').click();
await alLedger.locator('tbody tr').nth(13).waitFor({ state: 'detached' });
const alSecond = await followItems('en', 1024, 'no-preference', alLong);
assert.deepEqual(
  [alFirst.length, alSecond.length],
  [50, 13],
  'allocation long: two pages',
);
assert.deepEqual(
  [...alFirst, ...alSecond].sort(alOrder),
  alItemsOf(alLongFiles).sort(alOrder),
  'allocation long: every item once',
);
// The way back, after the ledger was turned while the drawer was open,
// turns it back to the item's page and returns to its way in.
watch.at('allocation: the way back over pages');
const alLast = alLedger.locator('tbody tr').last(),
  alLastName = (await alLast.getByRole('button').textContent()).trim();
await alLast.getByRole('button').click();
await drawer.waitFor();
await arrived();
await alPager('Previous page').click();
await alLedger.locator('tbody tr').nth(13).waitFor();
assert.equal(
  await alLedger.getByRole('button', { name: alLastName, exact: true }).count(),
  0,
  'allocation long: the item is off the page shown',
);
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'allocation: the way back closes it');
assert.equal(
  (await focused()).text.trim(),
  alLastName,
  "allocation long: the way back returns to the item on its own page",
);
report.push('allocation long: way back over two pages');
// Four items twice, and the story's 63.
assert.equal(alOpened, 2 * 4 + 63, `allocation: items opened: ${alOpened}`);
// A change of type closes it.
await alLedger.getByRole('button').first().click();
await drawer.waitFor();
await page.locator('select[data-reconciliation-type-select]').selectOption('bank');
await openDomainWorkspace(page, 'allocation');
assert.equal(await drawer.count(), 0, 'allocation: a change of type closes it');

// UX-10(d), GL sections and TB pages (GLT-1c): each account of the sections
// panel opens the row that opens each GL section the engine read for it,
// then each TB row it read for it, with every cell as the file holds it, by
// its column (the result keeps no header for these cells), and shows its
// components as its row does. Sealed stories are read through the panel's
// own file inputs; the rows an account must open are worked out here from
// the two files, with this check's own reader, by the contract's labels and
// columns. Opening it closes the drawer of the table above, and the other
// way round; folding the panel, another run and a change of type close it.
const GLS_F = 'audit/gl-tb-sections-foundation/frozen',
  GLS_H = 'audit/gl-tb-sections-holdout-h1/frozen';
const glsWords = {
  en: {
    roles: ['GL', 'TB'],
    amount: 'Amount in the table',
    note: 'The result keeps the row of each section and each TB line, not the row that heads its columns: each cell is shown by its column, as the file has it.',
  },
  ar: {
    roles: ['GL', 'الميزان'],
    amount: 'المبلغ في الجدول',
    note: 'تحفظ النتيجة صف كل قسم وكل سطر من الميزان، لا الصف الذي يحمل رؤوس أعمدته: فتُعرض كل خلية بعمودها كما في الملف.',
  },
};
// The rows each account must open, from the files: the row that opens each
// GL section whose labels name the account and its dimensions, then each TB
// account row of a page whose column row names them, in the files' order;
// only sections and pages whose scope labels are the run's.
function glsRowsInFiles(gl, tb, scope) {
  const strip = (v) => (v ?? '').replace(/^ +| +$/g, '');
  const wide = (r) => {
    let n = r.length;
    while (n && !strip(r[n - 1])) n--;
    return n;
  };
  const blocks = (rows, start, end) => {
    const found = [];
    let b = null;
    for (const [i, r] of rows.entries()) {
      if (!wide(r)) continue;
      const first = strip(r[0]);
      if (first === start) {
        b = { row: i + 1, labels: {}, columns: null, body: [] };
        found.push(b);
      } else if (!b) continue;
      else if (first === end) b = null;
      else if (!b.columns && wide(r) > 2) b.columns = r.map(strip);
      else if (!b.columns) b.labels[first] = strip(r[1]);
      else b.body.push({ row: i + 1, cells: r });
    }
    return found;
  };
  const inScope = (b) =>
    Object.entries(scope).every(([label, v]) => b.labels[label] === v);
  const want = new Map();
  const add = (key, at) => want.set(key, [...(want.get(key) ?? []), at]);
  for (const b of blocks(gl, 'Section', 'End section'))
    if (inScope(b))
      add(`${b.labels.Account}|${b.labels['Complete dimensions']}`, [0, b.row]);
  for (const b of blocks(tb, 'Page', 'End page'))
    if (inScope(b) && b.columns) {
      const at = (name) => b.columns.indexOf(name);
      for (const r of b.body)
        if (strip(r.cells[at('Row type')]) === 'account')
          add(
            `${strip(r.cells[at('Account')])}|${strip(r.cells[at('Complete dimensions')])}`,
            [1, r.row],
          );
    }
  return want;
}
async function glsStory(dir, sid) {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (role) =>
      csvRows(await readFile(`${dir}/${sid}-${role}.csv`, 'utf8')),
    ),
  );
  const scope = JSON.parse(await readFile(`${dir}/${sid}-scope.json`, 'utf8'));
  return {
    dir,
    sid,
    files,
    scope,
    names: ['gl', 'tb'].map((role) => `${sid}-${role}.csv`),
    want: glsRowsInFiles(files[0], files[1], scope),
  };
}
const glsScopeInputs = {
  entity: 'Entity',
  ledger: 'Ledger',
  currency: 'Currency',
  currencyBasis: 'Currency basis',
  postingStatus: 'Posting status',
  postingLayer: 'Posting layer',
  start: 'Period start',
  end: 'Period end',
};
const glsCheck = /^(Check every account|افحص كل حساب)$/;
let gls = null;
const glsIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await gls.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the sections panel stayed busy for a minute');
};
async function glsLoad(story) {
  const sets = gls.locator('fieldset');
  for (const i of [0, 1]) {
    await sets
      .nth(i)
      .locator('input[type="file"]')
      .setInputFiles(path.resolve(`${story.dir}/${story.names[i]}`));
    await glsIdle();
    await sets.nth(i).locator('input[type="checkbox"]').check();
  }
  for (const [k, label] of Object.entries(glsScopeInputs))
    await gls.locator(`[data-gls-scope="${k}"]`).fill(story.scope[label]);
  await gls.locator('[data-gls-scope-confirm]').check();
  await gls.getByRole('button', { name: glsCheck }).click();
  await gls.locator('[data-gls-result]').waitFor();
  await glsIdle();
}
const glsRows = () => gls.locator('tr[data-gls-account]');
const glsPager = (name) =>
  gls
    .locator('[data-gls-pager="accounts"]')
    .getByRole('button', { name, exact: true });
let glsOpened = 0;
// The accounts at `indices` of the page shown, opened in turn: the way in
// names the account and its dimensions, the drawer's heading names them, its
// amount is the row's components, its sources are the rows worked out from
// the files, each cell as the file holds it by its column, the row is
// marked, and the way back or Escape returns the focus to the same way in.
async function followAccounts(lang, width, motion, story, indices) {
  const tw = threadWords[lang],
    gw = glsWords[lang],
    what = `gl-tb sections ${story.sid} ${lang} ${width} px ${motion}`,
    head = (
      await gls
        .locator('table:has(tr[data-gls-account]) thead th')
        .allInnerTexts()
    ).map((x) => x.trim());
  assert.equal(head[0], tw.way, `${what}: the way in opens the row`);
  const seen = [];
  for (const n of indices) {
    const row = glsRows().nth(n),
      key = await row.getAttribute('data-gls-account'),
      cells = (await row.locator('th, td').allTextContents()).map((x) =>
        x.trim(),
      ),
      [, account, dims] = cells,
      components = cells[5],
      named = dims ? `${account} · ${dims}` : account;
    watch.at(`${what}: ${named}`);
    assert.equal(key, `${account}|${dims}`, `${what}: ${named} is the row's`);
    const want = story.want.get(key) ?? [];
    assert.ok(want.length, `${what} ${named}: the files name its rows`);
    const way = row.getByRole('button', {
      name: `${tw.way} · ${named}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${named}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the account`,
    );
    const amount = drawer.locator('.evidence-drawer__amount');
    if (components)
      assert.equal(
        (await amount.textContent()).trim(),
        `${gw.amount}: ${components}`,
        `${what} ${named}: its components as the row shows them`,
      );
    else assert.equal(await amount.count(), 0, `${what} ${named}: no amount`);
    assert.equal(
      await drawer.getByText(gw.note, { exact: true }).count(),
      1,
      `${what}: it says the cells have no header`,
    );
    const sources = await arDrawn();
    assert.deepEqual(
      sources.map((s) => [
        s.source,
        s.role,
        s.place.File ?? s.place['الملف'],
        s.place.Sheet ?? s.place['الورقة'],
        Number(s.place.Row ?? s.place['الصف']),
        s.missing,
      ]),
      want.map(([source, at]) => [
        source,
        gw.roles[source],
        story.names[source],
        'CSV',
        at,
        undefined,
      ]),
      `${what} ${named}: each section and TB row the files name for it`,
    );
    for (const [k, [source, at]] of want.entries())
      assert.deepEqual(
        sources[k].cells,
        story.files[source][at - 1].map((text, c) => [
          '—',
          String(c + 1),
          text.trim(),
        ]),
        `${what} ${named}: row ${at} of ${story.names[source]} as the file holds it`,
      );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: one row marked`,
    );
    assert.equal(await row.getAttribute('data-thread-open'), '', what);
    if (n % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).endsWith(named),
      `${what}: the same way in`,
    );
    seen.push(key);
    glsOpened++;
  }
  report.push(`gl-tb sections ${story.sid} ${lang} ${width} ${motion}`);
  return seen;
}
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
watch.at('gl-tb sections: the files');
await page.reload();
await supplierLang('en');
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
const gtPanel = await openDomainWorkspace(page, 'gl-tb');
// The comparison above the panel, for the one drawer on the page.
for (const [side, label] of glTbWords.en.sides.entries()) {
  const file = `positive-${side ? 'tb' : 'gl'}.csv`;
  await page
    .getByLabel(label, { exact: true })
    .setInputFiles(path.resolve(`${GLTB}/${file}`));
  await page.getByRole('heading', { name: file, exact: true }).waitFor();
}
await page.evaluate(
  () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
);
await page
  .getByLabel('I reviewed the GL detail and balances and the trial balance source', {
    exact: false,
  })
  .check();
await page
  .getByRole('button', { name: 'Verify GL/TB consistency', exact: true })
  .click();
await page.getByTestId('gl-tb-result').waitFor();
const glsDetails = gtPanel.locator('details[data-gls-details]');
if ((await glsDetails.getAttribute('open')) === null)
  await glsDetails.locator(':scope > summary').click();
gls = glsDetails.locator('[data-gls]');
// Sixty accounts on two pages: five of the first page and all of the second.
const glsLong = await glsStory(GLS_F, 'T29');
await glsLoad(glsLong);
assert.equal(await glsRows().count(), 50, 'gl-tb sections T29: a full page');
await followAccounts('en', 1440, 'no-preference', glsLong, range(0, 5));
await glsPager('Next page').click();
await glsRows().nth(10).waitFor({ state: 'detached' });
const glsSecond = await followAccounts(
  'en',
  1440,
  'no-preference',
  glsLong,
  range(0, 10),
);
assert.equal(glsSecond.length, 10, 'gl-tb sections T29: the second page');
// The way back, after the accounts were turned while the drawer was open,
// turns them back to the account's page and returns to its way in.
watch.at('gl-tb sections: the way back over pages');
const glsLast = glsRows().last(),
  glsLastName = (await glsLast.getByRole('button').textContent()).trim();
await glsLast.getByRole('button').click();
await drawer.waitFor();
await arrived();
await glsPager('Previous page').click();
await glsRows().nth(10).waitFor();
assert.equal(
  await gls.getByRole('button', { name: glsLastName, exact: true }).count(),
  0,
  'gl-tb sections T29: the account is off the page shown',
);
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'gl-tb sections: the way back closes it');
assert.equal(
  (await focused()).text.trim(),
  glsLastName,
  'gl-tb sections T29: the way back returns to the account on its own page',
);
report.push('gl-tb sections T29: way back over two pages');
// One drawer on the page: an account's closes the balance component's
// above, and the other way round.
watch.at('gl-tb sections: one drawer on the page');
const gtWay = page
  .getByTestId('gl-tb-balances')
  .getByRole('button', { name: /^Review source rows · / })
  .first();
await gtWay.click();
await drawer.waitFor();
const glsFirst = glsRows().first().getByRole('button');
// The focus is on the heading of the drawer just opened; any other drawer
// still open is then counted by the assertion, not waited for.
const inDrawer = (name) =>
  page.waitForFunction(
    (heading) =>
      document.activeElement?.closest('[data-evidence-drawer]') &&
      document.activeElement.textContent.endsWith(heading),
    name,
  );
await glsFirst.click();
await inDrawer(
  (await glsFirst.textContent()).slice(threadWords.en.way.length),
);
assert.equal(
  await page.locator('[data-evidence-drawer]').count(),
  1,
  'gl-tb sections: the account closes the component above',
);
assert.equal(await gtWay.getAttribute('aria-expanded'), 'false');
assert.equal(await glsFirst.getAttribute('aria-expanded'), 'true');
await gtWay.click();
await inDrawer((await gtWay.textContent()).slice(threadWords.en.way.length));
assert.equal(
  await page.locator('[data-evidence-drawer]').count(),
  1,
  'gl-tb sections: the component closes the account',
);
assert.equal(await glsFirst.getAttribute('aria-expanded'), 'false');
await drawer.getByRole('heading', { level: 2 }).press('Escape');
await closed();
// Folding the panel closes it, and so does another run.
watch.at('gl-tb sections: folding and another run');
await glsFirst.click();
await drawer.waitFor();
await glsDetails.locator(':scope > summary').click();
await closed();
assert.equal(await drawer.count(), 0, 'gl-tb sections: folding closes it');
await glsDetails.locator(':scope > summary').click();
await glsFirst.click();
await drawer.waitFor();
await gls.getByRole('button', { name: glsCheck }).click();
await gls.locator('[data-gls-result]').waitFor();
await glsIdle();
await closed();
assert.equal(await drawer.count(), 0, 'gl-tb sections: another run closes it');
// Arabic, right to left, at 390 px with reduced motion: Arabic dimensions.
watch.at('gl-tb sections: Arabic');
await supplierLang('ar');
await page.setViewportSize({ width: 390, height: 900 });
await page.emulateMedia({ reducedMotion: 'reduce' });
const glsArabic = await glsStory(GLS_F, 'T17');
await glsLoad(glsArabic);
await followAccounts('ar', 390, 'reduce', glsArabic, range(0, await glsRows().count()));
// A holdout from another writer, which quotes its fields.
watch.at('gl-tb sections: a holdout');
await supplierLang('en');
await page.setViewportSize({ width: 1024, height: 900 });
await page.emulateMedia({ reducedMotion: null });
const glsHoldout = await glsStory(GLS_H, 'H02');
await glsLoad(glsHoldout);
await followAccounts('en', 1024, 'no-preference', glsHoldout, range(0, await glsRows().count()));
// Five and ten of T29, the two of T17 and the three of H02.
assert.equal(glsOpened, 5 + 10 + 2 + 3, `gl-tb sections: accounts opened: ${glsOpened}`);
// A change of type closes it.
await glsRows().first().getByRole('button').click();
await drawer.waitFor();
await page.locator('select[data-reconciliation-type-select]').selectOption('bank');
await openDomainWorkspace(page, 'gl-tb');
assert.equal(await drawer.count(), 0, 'gl-tb sections: a change of type closes it');

// UX-10(d), the long payroll register (PAY-1c): each employee of the panel
// opens every row the engine placed under it, in the order of the file, by
// its place alone (the result keeps no text of its cells), each headed by
// the line as the engine read it: its ID, component, kind and amount; an
// employee the engine held keeps no reading of its lines, and its rows are
// headed by the register's role. The drawer's figures are the employee's
// earnings, deductions and printed net. Sealed stories are read through the
// panel's own file input; an employee's rows are worked out here from the
// file, with this check's own reader: the lines of the sections whose scope
// labels are the run's; and the headings and figures are the seal's. Opening
// it closes the drawer of the comparison above, and the other way round;
// folding the panel, another run and a change of type close it.
const PLR_F = 'audit/payroll-long-register-foundation/frozen',
  PLR_H = 'audit/payroll-long-register-holdout-h1/frozen';
const plrCurrencies = JSON.parse(
  await readFile('audit/payroll-long-register-foundation/contract.json', 'utf8'),
).reading.currencies;
const plrWords = {
  en: {
    role: 'Long register: payroll register (CSV)',
    line: 'Line',
    kinds: {
      earning: 'Earning',
      deduction: 'Deduction',
      employer: 'Employer contribution',
      net: 'Net',
    },
    figures: ['Earnings', 'Deductions', 'Net printed'],
    note: 'Each row below is a line the engine placed under this employee, in the order of the file, headed by the line as the engine read it.',
    held: 'The engine held this employee, so the result keeps no reading of its lines: each row below is shown by its place alone.',
    notKept:
      'The result does not keep the text of this record’s cells. Its place is shown above.',
  },
  ar: {
    role: 'المسير الطويل: ملف المسير (CSV)',
    line: 'السطر',
    kinds: {
      earning: 'استحقاق',
      deduction: 'استقطاع',
      employer: 'مساهمة صاحب العمل',
      net: 'صافٍ',
    },
    figures: ['الاستحقاق', 'الاستقطاع', 'الصافي المطبوع'],
    note: 'كل صف أدناه سطر وضعه المحرك تحت هذا الموظف، بترتيب الملف، وعنوانه السطر كما قرأه المحرك.',
    held: 'أوقف المحرك هذا الموظف، فلا تحفظ النتيجة قراءةً لأسطره: يُعرض كل صف أدناه بموضعه وحده.',
    notKept: 'النتيجة لا تحفظ نصوص خلايا هذا السجل. وموضعه مذكور أعلاه.',
  },
};
// An amount at the run's decimals, grouped, the minus first: written here
// on its own, not taken from the application.
const plrAmount = (v, decimals) => {
  const sign = v < 0 ? '-' : '',
    digits = String(Math.abs(v)).padStart(decimals + 1, '0'),
    whole = (decimals ? digits.slice(0, -decimals) : digits).replace(
      /\B(?=(\d{3})+(?!\d))/gu,
      ',',
    );
  return decimals ? `${sign}${whole}.${digits.slice(-decimals)}` : `${sign}${whole}`;
};
// Each employee's lines in the file: every line of a section whose scope
// labels are the run's, by its employee and dimensions, in the file's order,
// with its row and its line ID.
function plrLinesInFile(rows, scope) {
  const strip = (v) => (v ?? '').replace(/^ +| +$/g, '');
  const wide = (r) => {
    let n = r.length;
    while (n && !strip(r[n - 1])) n--;
    return n;
  };
  const want = new Map();
  let b = null;
  for (const [i, r] of rows.entries()) {
    if (!wide(r)) continue;
    const first = strip(r[0]);
    if (first === 'Section') b = { labels: {}, columns: null };
    else if (!b) continue;
    else if (first === 'End section') b = null;
    else if (!b.columns && wide(r) > 2) b.columns = r.map(strip);
    else if (!b.columns) b.labels[first] = strip(r[1]);
    else if (
      wide(r) > 2 &&
      Object.entries(scope).every(([label, v]) => b.labels[label] === v)
    ) {
      const at = (name) => strip(r[b.columns.indexOf(name)]);
      const key = `${at('Employee ID')}|${at('Employee dimensions')}`;
      want.set(key, [...(want.get(key) ?? []), { row: i + 1, id: at('Line ID') }]);
    }
  }
  return want;
}
async function plrStory(dir, sid) {
  const scope = JSON.parse(await readFile(`${dir}/${sid}-scope.json`, 'utf8'));
  return {
    dir,
    sid,
    scope,
    name: `${sid}-register.csv`,
    decimals: plrCurrencies[scope.Currency] ?? 2,
    want: plrLinesInFile(
      csvRows(await readFile(`${dir}/${sid}-register.csv`, 'utf8')),
      scope,
    ),
    sealed: JSON.parse(await readFile(`${dir}/EXPECTED.json`, 'utf8')).stories[sid]
      .employees,
  };
}
const plrCheck = /^(Check the register|افحص المسير)$/;
let plr = null;
const plrIdle = async () => {
  for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
    if ((await plr.getAttribute('aria-busy')) === 'false') return;
    await page.waitForTimeout(100);
  }
  throw Error('the long register panel stayed busy for a minute');
};
async function plrLoad(story) {
  await plr
    .locator('input[data-plr-file]')
    .setInputFiles(path.resolve(`${story.dir}/${story.name}`));
  await plrIdle();
  await plr.locator('[data-plr-confirm]').check();
  for (const [label, v] of Object.entries(story.scope))
    await plr.locator(`[data-plr-scope="${label}"]`).fill(v);
  await plr.locator('[data-plr-scope-confirm]').check();
  await plr.getByRole('button', { name: plrCheck }).click();
  await plr.locator('[data-plr-result]').waitFor();
  await plrIdle();
  // The rule above holds for this story: it names the employees shown.
  const shownKeys = await plr
    .locator('tr[data-plr-employee]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-plr-employee')));
  assert.ok(shownKeys.length, `long register ${story.sid}: employees`);
  for (const key of shownKeys)
    assert.ok(story.want.has(key), `long register ${story.sid}: ${key} in the file`);
}
const plrRows = () => plr.locator('tr[data-plr-employee]');
const plrPager = (name) =>
  plr
    .locator('[data-plr-pager="employees"]')
    .getByRole('button', { name, exact: true });
let plrOpened = 0;
// The employees at `indices` of the page shown, opened in turn: the way in
// names the employee and its dimensions, the drawer's heading names them,
// its figures are the seal's, its sources are the rows worked out from the
// file, each by its place, headed by the seal's line at that row, the row is
// marked, and the way back or Escape returns the focus to the same way in.
async function followEmployees(lang, width, motion, story, indices) {
  const tw = threadWords[lang],
    pw = plrWords[lang],
    what = `long register ${story.sid} ${lang} ${width} px ${motion}`,
    head = (
      await plr
        .locator('table:has(tr[data-plr-employee]) thead th')
        .allInnerTexts()
    ).map((x) => x.trim());
  assert.equal(head[0], tw.way, `${what}: the way in opens the row`);
  const seen = [];
  for (const n of indices) {
    const row = plrRows().nth(n),
      key = await row.getAttribute('data-plr-employee'),
      [, employee, dims] = (await row.locator('th, td').allTextContents()).map(
        (x) => x.trim(),
      ),
      named = dims ? `${employee} · ${dims}` : employee;
    watch.at(`${what}: ${named}`);
    assert.equal(key, `${employee}|${dims}`, `${what}: ${named} is the row's`);
    const lines = story.want.get(key) ?? [],
      sealed = story.sealed[key];
    assert.ok(lines.length && sealed, `${what} ${named}: the file and the seal`);
    const way = row.getByRole('button', {
      name: `${tw.way} · ${named}`,
      exact: true,
    });
    assert.equal(await way.count(), 1, `${what} ${named}: the way in`);
    assert.equal(await way.getAttribute('aria-expanded'), 'false', what);
    await way.click();
    await drawer.waitFor();
    await arrived();
    assert.equal(await way.getAttribute('aria-expanded'), 'true', what);
    assert.equal(
      await way.getAttribute('aria-controls'),
      await drawer.getAttribute('id'),
      `${what}: the way in names the drawer`,
    );
    const opened = await focused();
    assert.deepEqual([opened.tag, opened.inDrawer], ['H2', true], what);
    assert.equal(
      opened.text,
      `${tw.heading} · ${named}`,
      `${what}: the heading names the employee`,
    );
    const figures = drawer.locator('.evidence-drawer__amount .tarasuf-figure');
    const decided = sealed.status !== 'held';
    if (decided)
      assert.deepEqual(
        (await figures.allInnerTexts()).map((x) => x.trim()),
        ['earnings', 'deductions', 'net'].map(
          (k, i) => `${pw.figures[i]} ${plrAmount(sealed[k], story.decimals)}`,
        ),
        `${what} ${named}: its earnings, deductions and printed net`,
      );
    else
      assert.equal(
        await drawer.locator('.evidence-drawer__amount').count(),
        0,
        `${what} ${named}: a held employee has no figures`,
      );
    assert.equal(
      await drawer.getByText(decided ? pw.note : pw.held, { exact: true }).count(),
      1,
      `${what} ${named}: it says what each row is`,
    );
    const byId = new Map((sealed.lines ?? []).map((l) => [l[0], l]));
    const sources = await arDrawn();
    assert.deepEqual(
      sources.map((s) => [
        s.source,
        s.role,
        s.place.File ?? s.place['الملف'],
        s.place.Sheet ?? s.place['الورقة'],
        Number(s.place.Row ?? s.place['الصف']),
        s.missing,
        s.cells.length,
      ]),
      lines.map(({ row, id }) => {
        const l = byId.get(id);
        return [
          0,
          decided
            ? `${pw.line} ${id} · ${l[1]} · ${pw.kinds[l[2]]} · ${plrAmount(l[3], story.decimals)}`
            : pw.role,
          story.name,
          undefined,
          row,
          pw.notKept,
          0,
        ];
      }),
      `${what} ${named}: each of its rows in the file, headed by its line`,
    );
    // A decided employee opens every line the seal gives it, and no other.
    const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    if (decided)
      assert.deepEqual(
        lines.map((l) => l.id).sort(byCode),
        [...byId.keys()].sort(byCode),
        `${what} ${named}: its sealed lines`,
      );
    assert.equal(
      await page.locator('tr[data-thread-open]').count(),
      1,
      `${what}: one row marked`,
    );
    assert.equal(await row.getAttribute('data-thread-open'), '', what);
    if (n % 2)
      await drawer.getByRole('button', { name: tw.back, exact: true }).click();
    else await drawer.getByRole('heading', { level: 2 }).press('Escape');
    await closed();
    assert.equal(await drawer.count(), 0, `${what}: it closes`);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-expanded'),
      ),
      'false',
      `${what}: the focus returns to the way in`,
    );
    assert.ok(
      (
        await page.evaluate(() => document.activeElement?.textContent ?? '')
      ).endsWith(named),
      `${what}: the same way in`,
    );
    seen.push(key);
    plrOpened++;
  }
  report.push(`long register ${story.sid} ${lang} ${width} ${motion}`);
  return seen;
}
watch.at('long register: the files');
await page.reload();
await supplierLang('en');
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
await openDomainWorkspace(page, 'payroll');
// The comparison above the panel, for the one drawer on the page.
const plrWorkspace = page.locator(families.payroll.workspace);
await plrWorkspace
  .getByRole('button', { name: families.payroll.example.en, exact: true })
  .click();
await plrWorkspace.locator(families.payroll.status).waitFor();
await page.waitForFunction(
  (sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'false',
  families.payroll.workspace,
);
const plrDetails = plrWorkspace.locator('details[data-plr-details]');
if ((await plrDetails.getAttribute('open')) === null)
  await plrDetails.locator(':scope > summary').click();
plr = plrDetails.locator('[data-plr]');
// 120 employees on three pages: five of the first page and ten of the
// third.
const plrLong = await plrStory(PLR_F, 'P38');
await plrLoad(plrLong);
assert.equal(await plrRows().count(), 50, 'long register P38: a full page');
await followEmployees('en', 1440, 'no-preference', plrLong, range(0, 5));
await plrPager('Next page').click();
await plrPager('Next page').click();
await plrRows().nth(20).waitFor({ state: 'detached' });
const plrThird = await followEmployees(
  'en',
  1440,
  'no-preference',
  plrLong,
  range(0, 10),
);
assert.equal(plrThird.length, 10, 'long register P38: the third page');
// The way back, after the employees were turned while the drawer was open,
// turns them back to the employee's page and returns to its way in.
watch.at('long register: the way back over pages');
const plrLast = plrRows().last(),
  plrLastName = (await plrLast.getByRole('button').textContent()).trim();
await plrLast.getByRole('button').click();
await drawer.waitFor();
await arrived();
await plrPager('Previous page').click();
await plrRows().nth(20).waitFor();
assert.equal(
  await plr.getByRole('button', { name: plrLastName, exact: true }).count(),
  0,
  'long register P38: the employee is off the page shown',
);
await drawer.getByRole('button', { name: threadWords.en.back, exact: true }).click();
await closed();
assert.equal(await drawer.count(), 0, 'long register: the way back closes it');
assert.equal(
  (await focused()).text.trim(),
  plrLastName,
  'long register P38: the way back returns to the employee on its own page',
);
report.push('long register P38: way back over three pages');
// One drawer on the page: an employee's closes the comparison's above, and
// the other way round. The comparison's ways come first on the page.
watch.at('long register: one drawer on the page');
const plrAbove = plrWorkspace
  .getByRole('button', { name: /^Review source rows · / })
  .first();
await plrAbove.click();
await drawer.waitFor();
const plrFirst = plrRows().first().getByRole('button');
await plrFirst.click();
await inDrawer((await plrFirst.textContent()).slice(threadWords.en.way.length));
assert.equal(
  await page.locator('[data-evidence-drawer]').count(),
  1,
  'long register: the employee closes the comparison above',
);
assert.equal(await plrAbove.getAttribute('aria-expanded'), 'false');
assert.equal(await plrFirst.getAttribute('aria-expanded'), 'true');
await plrAbove.click();
await inDrawer((await plrAbove.textContent()).slice(threadWords.en.way.length));
assert.equal(
  await page.locator('[data-evidence-drawer]').count(),
  1,
  'long register: the comparison closes the employee',
);
assert.equal(await plrFirst.getAttribute('aria-expanded'), 'false');
await drawer.getByRole('heading', { level: 2 }).press('Escape');
await closed();
// Folding the panel closes it, and so does another run.
watch.at('long register: folding and another run');
await plrFirst.click();
await drawer.waitFor();
await plrDetails.locator(':scope > summary').click();
await closed();
assert.equal(await drawer.count(), 0, 'long register: folding closes it');
await plrDetails.locator(':scope > summary').click();
await plrFirst.click();
await drawer.waitFor();
await plr.getByRole('button', { name: plrCheck }).click();
await plr.locator('[data-plr-result]').waitFor();
await plrIdle();
await closed();
assert.equal(await drawer.count(), 0, 'long register: another run closes it');
// Arabic, right to left, at 390 px with reduced motion: a held employee.
watch.at('long register: Arabic');
await supplierLang('ar');
await page.setViewportSize({ width: 390, height: 900 });
await page.emulateMedia({ reducedMotion: 'reduce' });
const plrArabic = await plrStory(PLR_F, 'P04');
await plrLoad(plrArabic);
await followEmployees('ar', 390, 'reduce', plrArabic, range(0, await plrRows().count()));
// Two holdouts from other writers: one with old Mac line ends that writes an
// employee's net line first, one with a section of another scope and a held
// employee.
watch.at('long register: holdouts');
await supplierLang('en');
await page.setViewportSize({ width: 1024, height: 900 });
await page.emulateMedia({ reducedMotion: null });
for (const sid of ['H29', 'H08']) {
  const story = await plrStory(PLR_H, sid);
  await plrLoad(story);
  await followEmployees('en', 1024, 'no-preference', story, range(0, await plrRows().count()));
}
// Five and ten of P38, the two of P04, the two of H29 and the one of H08.
assert.equal(plrOpened, 5 + 10 + 2 + 2 + 1, `long register: employees opened: ${plrOpened}`);
// A change of type closes it: the workspace stays drawn while hidden.
await plrRows().first().getByRole('button').click();
await drawer.waitFor();
await page.locator('select[data-reconciliation-type-select]').selectOption('bank');
await openDomainWorkspace(page, 'payroll');
assert.equal(await drawer.count(), 0, 'long register: a change of type closes it');

watch.stop();
assert.deepEqual(errors, [], 'no page error');
await browser.close();
server.close();
console.log(JSON.stringify({ passed: true, followed: report }, null, 1));
