import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

/**
 * UX-6: the reconciliation sheet of a downloaded workpaper says what the
 * screen says. Read here with ExcelJS, apart from the code that wrote it, and
 * compared with the strip and the table as the page draws them: each strip
 * cell's label, value and notes, and each row of the named table. Numbers on
 * the screen are compared as numbers, so grouping marks and the direction
 * marks that isolate them do not count.
 */
const NAMES = { ar: 'ورقة التسوية', en: 'Reconciliation sheet' };

/** A number as the screen writes it: digits, one point, a sign. */
const screenNumber = (text) => {
  const plain = text
    .replace(/[\u200e\u200f\u2066-\u2069\u061c]/gu, '')
    .replace(/\u2212/gu, '-')
    .replace(/,/gu, '')
    .trim();
  return /^-?\d+(\.\d+)?$/u.test(plain) ? Number(plain) : null;
};
const cellValue = (cell) => {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'richText' in v)
    return v.richText.map((r) => r.text).join('');
  return v;
};
const same = (screen, sheet, what) => {
  const n = screenNumber(screen);
  if (typeof sheet === 'number')
    assert.equal(n, sheet, `${what}: «${screen}» on the screen, ${sheet} in the sheet`);
  else assert.equal(screen, sheet, what);
};

/** The first sheet of a download as rows of four cells, after its place,
 * its name and its direction are checked. */
export async function readSheet(file, lang) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets[0];
  assert.equal(sheet.name, NAMES[lang], 'the sheet is first, named in the interface language');
  assert.equal(book.worksheets[1].name, 'Summary', 'the evidence follows it');
  assert.equal(
    Boolean(sheet.views?.[0]?.rightToLeft),
    lang === 'ar',
    'an Arabic sheet reads right to left',
  );
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    rows[n - 1] = [1, 2, 3, 4].map((c) => cellValue(row.getCell(c)));
  });
  return Array.from(rows, (r) => r ?? [null, null, null, null]);
}

export async function sheetSaysScreen(page, { file, lang, result, table }) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  await tableSaysScreen(grid, table);
  return { rows: grid.length };
}

/** The strip: each cell's label, value and notes as the page draws them. */
export async function stripSaysScreen(grid, result) {
  const strip = result.locator('[data-alignment-strip]');
  for (const name of ['agreed', 'review', 'gap']) {
    const cell = strip.locator(`[data-strip-cell="${name}"]`);
    const label = (await cell.locator('.alignment-strip__label').innerText()).trim();
    const value = (await cell.locator('.alignment-strip__value').innerText()).trim();
    const notes = cell.locator('.alignment-strip__note');
    const note = (await notes.count()) ? (await notes.innerText()).trim() : '';
    const at = grid.findIndex((r) => r[0] === label);
    assert.ok(at >= 0, `${name}: the sheet has a row «${label}»`);
    const [, b, c, d] = grid[at];
    if (c !== null) {
      // «4 من 6»: a count, a word and a count, each in its own cell.
      assert.equal(value, `${b} ${c} ${d}`, `${name}: value`);
    } else same(value, b, `${name}: value`);
    const said = [];
    for (let i = at + 1; i < grid.length && grid[i][0] === null && grid[i][1] !== null; i++)
      said.push(grid[i][2] === null ? `${grid[i][1]}` : `${grid[i][1]}: ${grid[i][2]}`);
    assert.equal(said.join(' · '), note, `${name}: notes`);
  }
}

/** A table the sheet repeats whole: its head, then each row as drawn. */
export async function tableSaysScreen(grid, table) {
  const head = await table.locator('thead th').allInnerTexts();
  const top = grid.findIndex((r) => r[0] === head[0].trim());
  assert.ok(top >= 0, `the sheet has the table «${head[0]}»`);
  assert.deepEqual(
    grid[top].slice(0, head.length),
    head.map((h) => h.trim()),
    'the table head',
  );
  const body = table.locator('tbody tr');
  const count = await body.count();
  for (let i = 0; i < count; i++) {
    const cells = (await body.nth(i).locator('th, td').allInnerTexts()).map((t) => t.trim());
    cells.forEach((text, j) =>
      same(text, grid[top + 1 + i][j], `table row ${i + 1} cell ${j + 1}`),
    );
  }
}

/**
 * UX-6(b), clearing: the groups the page shows as waiting for review, in its
 * order, are the sheet's review table: members, reference, net and the reason
 * the page writes under the basis; and the sheet's decisions are those the
 * run recorded, each with the reviewer's reason. The words for each heading
 * come from the page's own table head.
 */
export async function clearingSheetSaysScreen(
  page,
  { file, lang, result, decisions },
) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  const table = result.locator('table').filter({
    has: page.locator('[data-testid="clearing-case"]'),
  });
  const head = (await table.locator('thead th').allInnerTexts()).map((h) =>
    h.trim(),
  );
  const waiting = table
    .locator('[data-testid="clearing-case"]')
    .filter({ has: page.locator('[data-status="review"]') });
  const count = await waiting.count();
  const top = grid.findIndex((r) => r[0] === head[0]);
  if (!count) {
    assert.equal(top, -1, 'no group waits, so no review table');
  } else {
    assert.ok(top >= 0, `the sheet has the table «${head[0]}»`);
    assert.deepEqual(
      grid[top],
      [head[0], head[1], head[2], head[4]],
      'the review table head: members, reference, net, the basis column',
    );
    for (let i = 0; i < count; i++) {
      const cells = waiting.nth(i).locator('th, td');
      const [members, reference, net] = (await cells.allInnerTexts()).map(
        (t) => t.trim(),
      );
      const reason = (
        await cells.nth(4).locator('.muted').innerText()
      ).trim();
      const row = grid[top + 1 + i];
      assert.equal(row[0], members, `review row ${i + 1}: members`);
      assert.equal(row[1], reference, `review row ${i + 1}: reference`);
      same(net, row[2], `review row ${i + 1}: net`);
      assert.equal(row[3], reason, `review row ${i + 1}: reason`);
    }
    assert.ok(
      grid[top + 1 + count].every((c) => c === null),
      'the review table holds the waiting groups and no more',
    );
  }
  const at = grid.findIndex((r) => r[0] === decisions.head);
  if (!decisions.rows.length) assert.equal(at, -1, 'no decision, no table');
  else {
    assert.ok(at >= 0, `the sheet has the decisions «${decisions.head}»`);
    decisions.rows.forEach((d, i) =>
      assert.deepEqual(
        grid[at + 1 + i].slice(0, 3),
        d,
        `decision ${i + 1}: what it did, its members, the reason given`,
      ),
    );
    assert.ok(
      grid[at + 1 + decisions.rows.length].every((c) => c === null),
      'the recorded decisions and no more',
    );
  }
  return { rows: grid.length, waiting: count };
}
