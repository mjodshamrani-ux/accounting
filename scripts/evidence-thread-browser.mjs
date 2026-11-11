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
//   node scripts/evidence-thread-browser.mjs
// EVIDENCE_THREAD_DIST names another build (a mutation gate's copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
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

watch.stop();
assert.deepEqual(errors, [], 'no page error');
await browser.close();
server.close();
console.log(JSON.stringify({ passed: true, followed: report }, null, 1));
