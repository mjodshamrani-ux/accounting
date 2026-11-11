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
  assert.ok(
    (await amount.innerText()).includes(cells[11]),
    `${what}: the amount as the table shows it`,
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
assert.deepEqual(errors, [], 'no page error');
await browser.close();
server.close();
console.log(JSON.stringify({ passed: true, followed: report }, null, 1));
