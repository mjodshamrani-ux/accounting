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
//   node scripts/evidence-thread-browser.mjs
// EVIDENCE_THREAD_DIST names another build (a mutation gate's copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

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
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(base);
if ((await page.evaluate(() => document.documentElement.lang)) !== 'en')
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
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
await openDomainWorkspace(page, 'stock');
await stock.locator('[data-stock-links]').waitFor();
assert.equal(
  await drawer.count(),
  0,
  'stock: a change of type closes the evidence',
);

assert.deepEqual(errors, [], 'no page error');
await browser.close();
server.close();
console.log(JSON.stringify({ passed: true, followed: report }, null, 1));
