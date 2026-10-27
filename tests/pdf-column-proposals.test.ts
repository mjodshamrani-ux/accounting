// SUP-2 S4: column proposals for supplier statement PDFs.
//
// A proposal is geometry evidence for the accountant's review; it never
// assigns roles. It is made only when one known header band repeats on every
// page and every dated line's text lies inside one proposed column.
// - A debit and credit statement fills one side per line. Such a line is
//   evidence when each word lies under one heading, in heading order, and only
//   debit or credit headings are left empty.
// - "Balance" alone is a known heading. A band still needs date, reference and
//   amount headings.
// - A producer may write each word as its own item. A run of words that
//   crosses a cut is one text, as one item would be: whole in its first
//   column, with the crossing recorded. Runs inside one column are untouched.
// The fixture font is Courier: every glyph and space is 0.6 em wide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import {
  layoutPdfPage,
  readNativePdfSource,
  type PdfToken,
} from '../lib/reconciliation/pdf.ts';
import { suggestPdfColumnLayout } from '../lib/reconciliation/pdf-column-suggestions.ts';
import type { Scope } from '../lib/reconciliation/types.ts';

const SIZE = 9;
const CHAR = SIZE * 0.6;
const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const escape = (value: string) => value.replace(/[\\()]/g, (c) => '\\' + c);
const item = (x: number, y: number, value: string) =>
  `BT /F1 ${SIZE} Tf 1 0 0 1 ${x.toFixed(2)} ${y} Tm (${escape(value)}) Tj ET`;
const width = (value: string) => value.length * CHAR;
/** A cell starting at x, written as one item or one item per word. */
const cell = (x: number, y: number, value: string, words: boolean) => {
  if (!words) return [item(x, y, value)];
  const out: string[] = [];
  let at = x;
  for (const word of value.split(' ')) {
    out.push(item(at, y, word));
    at += width(word) + CHAR;
  }
  return out;
};
const right = (end: number, y: number, value: string, words = false) =>
  cell(end - width(value), y, value, words);
// One content stream per page, each item placed exactly where it is given.
function pagesPdf(pages: string[][]) {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const kids: number[] = [];
  for (const items of pages) {
    const id = objects.length + 1;
    kids.push(id);
    const stream = items.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((s, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${s}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}
const csv = (rows: string[]) =>
  new TextEncoder().encode(['Date,Reference,Amount', ...rows].join('\r\n') + '\r\n')
    .buffer as ArrayBuffer;
async function reconcile(statement: ArrayBuffer, ledger: ArrayBuffer) {
  const file = await readFile('statement.pdf', statement, undefined, true);
  const book = await readFile('ledger.csv', ledger);
  const mapping = { ...selectImportMapping(file, 'supplier').mapping, pdfReviewed: true };
  const a = normalizeSource(file, mapping, scope, 'supplier');
  const b = normalizeSource(book, selectImportMapping(book, 'ledger').mapping, scope, 'ledger');
  return { file, mapping, a, result: compare(a, b, scope) };
}
async function layout(statement: ArrayBuffer) {
  const source = await readNativePdfSource(statement);
  return suggestPdfColumnLayout(
    source.pages.map((page) => ({ width: page.width, tokens: page.tokens })),
  );
}

// --- A. Debit and credit, one side per line, a wide right-aligned balance heading.
const sides = {
  reference: 30,
  date: 100,
  description: 170,
  debit: 330,
  credit: 470,
  balance: 560,
};
type SideRow = [string, string, string, string, string, string];
const sideRows: SideRow[] = [
  ['INV-301', '2026-07-02', 'Steel bars', '1,250.00', '', '1,250.00'],
  ['PMT-77', '2026-07-05', 'Bank transfer', '', '480.10', '769.90'],
  ['INV-302', '2026-07-09', 'Bolts', '2,000.00', '', '2,769.90'],
  ['CN-12', '2026-07-12', 'Price adjustment', '', '120.00', '2,649.90'],
];
function sideStatement(
  rows: SideRow[] = sideRows,
  headings = ['Reference', 'Date', 'Description', 'Debit', 'Credit', 'Running Balance'],
  at: Partial<typeof sides> = {},
) {
  const x = { ...sides, ...at };
  const items = [
    item(30, 780, 'Synthetic Supplier Trading'),
    item(30, 765, 'Currency: SAR'),
    item(x.reference, 740, headings[0]),
    item(x.date, 740, headings[1]),
    item(x.description, 740, headings[2]),
    ...right(x.debit, 740, headings[3]),
    ...right(x.credit, 740, headings[4]),
    ...right(x.balance, 740, headings[5]),
  ];
  rows.forEach((row, i) => {
    const y = 720 - i * 18;
    items.push(item(x.reference, y, row[0]), item(x.date, y, row[1]));
    if (row[2]) items.push(item(x.description, y, row[2]));
    if (row[3]) items.push(...right(x.debit, y, row[3]));
    if (row[4]) items.push(...right(x.credit, y, row[4]));
    if (row[5]) items.push(...right(x.balance, y, row[5]));
  });
  return pagesPdf([items]);
}
const sideLedger = csv([
  '2026-07-02,INV-301,1250.00',
  '2026-07-05,PMT-77,-480.10',
  '2026-07-09,INV-302,2000.00',
  '2026-07-12,CN-12,-120.00',
]);

void test('S4 a debit and credit statement that fills one side per line is proposed by its headings', async () => {
  const statement = sideStatement();
  assert.equal((await layout(statement))?.cuts.length, 5);
  const { file, mapping, a, result } = await reconcile(statement, sideLedger);
  const sheet = file.sheets[0];
  assert.equal(file.pdf?.autoColumns, true);
  assert.equal(file.pdf?.cuts.length, 5);
  const header = sheet.rows.findIndex((row) => row[0] === 'Reference');
  assert.deepEqual(sheet.rows[header], [
    'Reference',
    'Date',
    'Description',
    'Debit',
    'Credit',
    'Running Balance',
  ]);
  assert.equal(sheet.rowIssues?.[String(header + 1)], undefined);
  assert.deepEqual(
    sideRows.map((_, i) => sheet.rows[header + 1 + i]),
    sideRows,
  );
  // The wide heading is not cut: the last cut lies left of where it begins.
  const begins = ((sides.balance - width('Running Balance')) / 600) * 100;
  assert.ok(file.pdf!.cuts[4] < begins);
  assert.equal(mapping.mode, 'split');
  assert.deepEqual([mapping.debit, mapping.credit], [3, 4]);
  assert.equal(a.errors.length, 0);
  assert.equal(result.matches.length, 4);
});

void test('S4 near cases: a side line is evidence only under its own heading, and only sides may be empty', async () => {
  // An amount wide enough to lie under both Debit and Credit is under no one heading.
  const both = sideStatement(
    sideRows.map((row) =>
      row[4] ? [row[0], row[1], row[2], '', '12,345,678.90', row[5]] : row,
    ),
    undefined,
    { debit: 400, credit: 460 },
  );
  assert.equal(await layout(both), null);
  // An amount between the two headings lies under neither.
  const between = sideStatement(
    sideRows.map((row) => [row[0], row[1], row[2], '', '', row[5]]),
  );
  const betweenItems = sideRows.map((row, i) => right(405, 720 - i * 18, row[3] || row[4]));
  const floating = pagesPdf([
    [
      ...new TextDecoder()
        .decode(between)
        .split('\n')
        .filter((line) => line.startsWith('BT ')),
      ...betweenItems.flat(),
    ],
  ]);
  assert.equal(await layout(floating), null);
  // A line that leaves the description empty is not a side line.
  const noDescription = sideStatement(
    sideRows.map((row) => [row[0], row[1], '', row[3], row[4], row[5]]),
  );
  assert.equal(await layout(noDescription), null);
  // The same statement with both sides filled on one line is still proposed.
  const oneFull = sideStatement([
    ['INV-300', '2026-07-01', 'Opening invoice', '10.00', '10.00', '0.00'],
    ...sideRows,
  ]);
  assert.equal((await layout(oneFull))?.cuts.length, 5);
});

// --- B. One item per word in a monospaced font, a lone Balance heading and two dates.
const cols = { date: 30, reference: 110, due: 180, description: 262, amount: 470, balance: 560 };
type WordRow = { date: string; reference: string; due: string; description: string; amount: string; balance: string };
const movements: WordRow[] = [
  { date: '2026-07-01', reference: 'INV-401', due: '2026-07-31', description: 'Packing crates', amount: '28,280.66', balance: '60,466.77' },
  { date: '2026-07-02', reference: 'CN-90', due: '2026-08-01', description: 'Price adjustment', amount: '(1,277.20)', balance: '59,189.57' },
  { date: '2026-07-03', reference: 'INV-402', due: '2026-08-02', description: 'Safety gloves', amount: '2,247.55', balance: '61,437.12' },
  { date: '2026-07-17', reference: 'PMT-380', due: '2026-08-16', description: 'Transfer received', amount: '(1,098.43)', balance: '60,338.69' },
  { date: '2026-07-22', reference: 'INV-403', due: '2026-08-21', description: 'Valve spares', amount: '4,410.38', balance: '64,749.07' },
];
const wordLedger = csv([
  '2026-07-01,INV-401,28280.66',
  '2026-07-02,CN-90,-1277.20',
  '2026-07-03,INV-402,2247.55',
  '2026-07-17,PMT-380,-1098.43',
  '2026-07-22,INV-403,4410.38',
]);
function wordStatement(
  words: boolean,
  options: { dueFirst?: boolean; crossing?: string } = {},
) {
  const heads = options.dueFirst
    ? ['Due Date', 'Invoice No', 'Invoice Date']
    : ['Invoice Date', 'Invoice No', 'Due Date'];
  const page = (number: number, lines: WordRow[], open: string, close: string) => {
    const items = [
      ...cell(30, 780, 'Synthetic Supplier Trading Co', words),
      ...cell(30, 765, 'Customer: Synthetic Buyer Period: 2026-07-01 to 2026-07-31', words),
      ...cell(30, 750, 'Currency: SAR', words),
      ...cell(cols.date, 730, heads[0], words),
      ...cell(cols.reference, 730, heads[1], words),
      ...cell(cols.due, 730, heads[2], words),
      ...cell(cols.description, 730, 'Description', words),
      ...right(cols.amount, 730, 'Amount', words),
      ...right(cols.balance, 730, 'Balance', words),
      ...cell(30, 712, open, words),
      ...right(cols.balance, 712, number === 1 ? '32,186.11' : '61,437.12', words),
    ];
    lines.forEach((row, i) => {
      const y = 694 - i * 18;
      const first = options.dueFirst ? row.due : row.date;
      const third = options.dueFirst ? row.date : row.due;
      items.push(
        ...cell(cols.date, y, first, words),
        ...cell(cols.reference, y, row.reference, words),
        ...cell(cols.due, y, third, words),
        ...cell(cols.description, y, row.description, words),
        ...right(cols.amount, y, row.amount, words),
        ...right(cols.balance, y, row.balance, words),
      );
    });
    const end = 694 - lines.length * 18;
    items.push(
      ...cell(30, end, close, words),
      ...right(cols.balance, end, lines.at(-1)!.balance, words),
      ...cell(250, end - 30, `Page ${number} of 2`, words),
    );
    return items;
  };
  const first = movements.slice(0, 3);
  if (options.crossing)
    first[1] = { ...first[1], description: options.crossing };
  return pagesPdf([
    page(1, first, 'Opening balance', 'Balance carried forward'),
    page(2, movements.slice(3), 'Balance brought forward', 'Closing balance'),
  ]);
}

void test('S4 a statement written one item per word, with a Balance heading and two dates, is proposed and matched', async () => {
  assert.equal((await layout(wordStatement(true)))?.cuts.length, 5);
  const { file, mapping, a, result } = await reconcile(wordStatement(true), wordLedger);
  const sheet = file.sheets[0];
  assert.equal(file.pdf?.autoColumns, true);
  assert.equal(file.pdf?.cuts.length, 5);
  const header = sheet.rows.findIndex((row) => row[0] === 'Invoice Date');
  assert.deepEqual(sheet.rows[header], [
    'Invoice Date',
    'Invoice No',
    'Due Date',
    'Description',
    'Amount',
    'Balance',
  ]);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.amount, 4);
  // A label that crosses a cut is one text in its first column, flagged.
  for (const label of ['Opening balance', 'Balance carried forward', 'Balance brought forward', 'Closing balance']) {
    const rn = sheet.rows.findIndex((row) => row[0] === label) + 1;
    assert.ok(rn > 0, label);
    assert.deepEqual(sheet.rows[rn - 1].slice(1, 5), ['', '', '', ''], label);
    assert.ok(sheet.rowIssues?.[String(rn)]?.some((i) => i.startsWith('نص يعبر حد عمود؛')), label);
  }
  assert.equal(a.errors.length, 0);
  assert.equal(a.transactions.length, 5);
  assert.deepEqual(
    a.transactions.map((t) => t.date),
    movements.map((m) => m.date),
  );
  assert.equal(result.matches.length, 5);
});

void test('S4 metamorphic: the same statement written word by word or line by line reads the same cells', async () => {
  const words = await readFile('w.pdf', wordStatement(true), undefined, true);
  const lines = await readFile('l.pdf', wordStatement(false), undefined, true);
  assert.deepEqual(words.pdf?.cuts, lines.pdf?.cuts);
  assert.deepEqual(words.sheets[0].rows, lines.sheets[0].rows);
});

void test('S4 near cases: the transaction date is chosen over a due date in either order', async () => {
  const statement = wordStatement(true, { dueFirst: true });
  assert.equal((await layout(statement))?.cuts.length, 5);
  const { mapping, a, result } = await reconcile(statement, wordLedger);
  assert.equal(mapping.date, 2);
  assert.deepEqual(
    a.transactions.map((t) => t.date),
    movements.map((m) => m.date),
  );
  assert.equal(result.matches.length, 5);
});

void test('S4 near cases: a dated line whose words cross a cut withdraws the proposal, and under declared columns is an error, never a summary', async () => {
  const crossing = 'Steel fittings for the north plant extension';
  const statement = wordStatement(true, { crossing });
  assert.equal(await layout(statement), null);
  // The accountant draws the columns the clean statement was proposed with.
  const declared = (await readFile('c.pdf', wordStatement(true), undefined, true)).pdf!.cuts;
  assert.equal(declared.length, 5);
  const file = await readFile('statement.pdf', statement, declared);
  const book = await readFile('ledger.csv', wordLedger);
  const mapping = { ...selectImportMapping(file, 'supplier').mapping, pdfReviewed: true };
  const a = normalizeSource(file, mapping, scope, 'supplier');
  const result = compare(
    a,
    normalizeSource(book, selectImportMapping(book, 'ledger').mapping, scope, 'ledger'),
    scope,
  );
  const sheet = file.sheets[0];
  const rn = sheet.rows.findIndex((row) => row[0] === '2026-07-02') + 1;
  assert.ok(sheet.rows[rn - 1][3].startsWith('Steel fittings'));
  const error = a.errors.find((e) => e.row === rn);
  assert.ok(error?.message.startsWith('نص يعبر حد عمود؛'));
  assert.ok(!a.excluded.some((x) => x.row === rn));
  assert.ok(!a.transactions.some((t) => t.reference === 'CN-90'));
  assert.ok(!result.matches.some((m) => m.evidence?.supplierRow === rn));
});

// --- Layout units: what a crossing run carries and what it leaves.
const tok = (text: string, x: number, w: number): PdfToken => ({
  text,
  x,
  y: 700,
  width: w,
  height: 10,
});
void test('S4 a run that stays inside its columns keeps them; a crossing run takes only its own words', () => {
  // Two words a space apart on either side of a cut, neither crossing it.
  const inside = layoutPdfPage([tok('A1', 10, 20), tok('B1', 33, 20)], [31.5], 100);
  assert.deepEqual(inside[0].row, ['A1', 'B1']);
  assert.deepEqual(inside[0].issues, []);
  // A crossing label keeps its words, including one wholly past the cut; an
  // amount a column gap away keeps its column.
  const words = (second: number) => [
    tok('Balance', 10, 20),
    tok('carried', second, 12),
    tok('forward', second + 16, 12),
    tok('1,000.00', 80, 15),
  ];
  const label = layoutPdfPage(words(34), [40], 100);
  assert.deepEqual(label[0].row, ['Balance carried forward', '1,000.00']);
  assert.ok(label[0].issues.some((i) => i.startsWith('نص يعبر حد عمود؛')));
  // When no word crosses, the same words keep their own columns.
  const split = layoutPdfPage(words(41), [40], 100);
  assert.deepEqual(split[0].row, ['Balance', 'carried forward 1,000.00']);
  assert.deepEqual(split[0].issues, []);
});

void test('S4 a text transform of a word in a crossing run names the cell its text went to', () => {
  const traced = (text: string, x: number, w: number): PdfToken => ({
    ...tok(text, x, w),
    extractionText: text.split('').reverse().join(''),
    glyphText: text,
    extractionRule: 'verified-rtl-glyph-order',
  });
  const [line] = layoutPdfPage(
    [tok('Balance', 10, 20), traced('carried', 34, 12), traced('forward', 50, 12)],
    [40],
    100,
  );
  assert.deepEqual(line.row, ['Balance carried forward', '']);
  assert.deepEqual(
    line.textTransforms.map((t) => [t.usedText, t.column]),
    [
      ['carried', 1],
      ['forward', 1],
    ],
  );
});
