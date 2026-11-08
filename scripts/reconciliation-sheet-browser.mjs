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

export async function sheetSaysScreen(page, { file, lang, result, table }) {
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
  const grid = Array.from(rows, (r) => r ?? [null, null, null, null]);

  // The strip: each cell as the page draws it.
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

  // The table: each row as the page draws it.
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
  return { rows: grid.length };
}
