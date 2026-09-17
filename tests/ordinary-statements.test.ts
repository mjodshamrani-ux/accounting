// Statement shapes an accountant actually receives. Each case failed to import
// before: a total line, a repeated page header, a timestamped date, or a PDF
// whose headers are not in the suggestion vocabulary. The point of every
// assertion here is that the file imports AND that nothing left the record
// silently: every row is either read, excluded with a reason, or reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { latestSourceDate } from '../lib/reconciliation/scope-inference.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Al-Faisal',
  entity: 'Buyer Co',
  account: 'AP-1',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};

// A vendor statement with a merged title, a period line, an opening balance, a
// running-balance formula, a timestamped date and a closing total.
async function vendorStatement() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'Al-Faisal Trading Co. — Statement of Account';
  ws.getCell('A2').value = 'Period: 01/08/2026 - 31/08/2026';
  ws.addRow([]);
  ws.addRow(['Date', 'Reference', 'Description', 'Amount', 'Balance']);
  ws.addRow(['Opening balance', '', '', '', 5000]);
  ws.addRow(['2026-08-02', 'INV-1001', 'Goods', 1200]);
  ws.addRow(['2026-08-05', 'INV-1002', 'Goods', 3400.5]);
  ws.addRow(['2026-08-11', 'PMT-77', 'Payment received', -2000]);
  ws.addRow(['2026-08-19', 'INV-1003', 'Goods', 880.25]);
  ws.getCell('E9').value = { formula: 'E8+D9', result: 8480.75 };
  ws.addRow(['Total', '', '', 3480.75, '']);
  // An ERP export routinely stamps a time onto the date column.
  ws.getCell('A6').value = new Date(Date.UTC(2026, 7, 2, 9, 30));
  return readFile(
    'statement.xlsx',
    new Uint8Array(await wb.xlsx.writeBuffer()).buffer,
  );
}

const accounted = (file: SourceFile, mapping: Mapping, result: unknown) => {
  const r = result as {
    transactions: unknown[];
    excluded: unknown[];
    errors: unknown[];
  };
  assert.equal(
    r.transactions.length + r.excluded.length + r.errors.length,
    file.sheets[mapping.sheet].rows.length,
    'every source row must be read, excluded with a reason, or reported',
  );
};

test('an ordinary vendor statement imports and compares without manual row surgery', async () => {
  const file = await vendorStatement();
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'unique-table');
  const mapping = selection.mapping;
  assert.equal(mapping.header, 3);
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(
    result.errors,
    [],
    'a total row, a balance row and a timestamped date must not be errors',
  );
  assert.deepEqual(
    result.transactions.map((t) => t.amount),
    [120000, 340050, -200000, 88025],
  );
  assert.equal(result.transactions[0].date, '2026-08-02');
  // The lines that left the comparison are named, not dropped.
  const reasons = result.excluded
    .filter((e) => e.row >= 5)
    .map((e) => [e.row, e.reason] as const);
  assert.deepEqual(
    reasons.map(([row]) => row),
    [5, 10],
  );
  for (const [, reason] of reasons) assert.match(reason, /استُبعد تلقائيًا/);
  assert.match(reasons[0][1], /Opening balance/);
  assert.match(reasons[1][1], /Total/);
  accounted(file, mapping, result);
  const ledger = normalizeSource(file, mapping, scope, 'ledger');
  assert.equal(compare(result, ledger, scope).matches.length, 4);
});

test('the dropped time is reported as a note, never as a silent change', async () => {
  const file = await vendorStatement();
  const note = file.sheets[0].cellNotes?.['6:1']?.join('؛ ') ?? '';
  assert.match(note, /A6/);
  assert.match(note, /2026-08-02/);
  // A note must not also appear as a blocking issue for the same cell.
  assert.equal(file.sheets[0].cellIssues?.['6:1'], undefined);
});

test('a formula inside a total row does not resurrect it as an error', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  ws.addRow(['Date', 'Reference', 'Amount']);
  ws.addRow(['2026-08-02', 'INV-1', 100]);
  ws.addRow(['Total', '', { formula: 'C2', result: 100 }]);
  const file = await readFile(
    'totals.xlsx',
    new Uint8Array(await wb.xlsx.writeBuffer()).buffer,
  );
  const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 1);
  assert.match(result.excluded.at(-1)!.reason, /استُبعد تلقائيًا/);
  accounted(file, mapping, result);
});

test('one unreadable row reports itself instead of rejecting both files', () => {
  const build = (amount: string): SourceFile => ({
    name: 'rows.csv',
    sheets: [
      {
        name: 'CSV',
        rows: [
          ['date', 'reference', 'amount'],
          ['2026-08-02', 'INV-1', '100.00'],
          ['2026-08-03', 'INV-2', amount],
        ],
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  });
  const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
  const good = normalizeSource(build('50.00'), mapping, scope, 'ledger');
  const broken = normalizeSource(build('12,3,4'), mapping, scope, 'supplier');
  assert.equal(broken.errors.length, 1);
  assert.equal(broken.transactions.length, 1);
  const result = compare(broken, good, scope);
  assert.equal(
    result.matches.length,
    0,
    'an unread row may conceal a duplicate; readable rows remain for review',
  );
  // The incompleteness is stated in the result, not hidden by proceeding.
  const skipped = result.diagnostics.filter((d) => d.code === 'SKIPPED_ROWS');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].message, /لم تُقرأ/);
  assert.equal(
    broken.balanceValid,
    false,
    'a file with an unread row can never report a verified balance',
  );
});

test('the cut-off default is the latest date present, so it excludes nothing', async () => {
  const file = await vendorStatement();
  const mapping = selectImportMapping(file, 'supplier').mapping;
  const latest = latestSourceDate([file, file], [mapping, mapping]);
  assert.equal(latest, '2026-08-19');
  const result = normalizeSource(
    file,
    mapping,
    { ...scope, cutoff: latest },
    'supplier',
  );
  assert.equal(
    result.transactions.length,
    4,
    'defaulting to the latest date must not drop a transaction',
  );
  assert.equal(
    result.excluded.some((e) => e.reason.includes('بعد تاريخ المقارنة')),
    false,
  );
});

// A statement PDF whose every word is its own text run, right-aligned amounts,
// multi-word descriptions, a title block and a header repeated on page two —
// with wording deliberately outside the header vocabulary.
function positionedPdf(pages: { text: string; x: number; y: number }[][]) {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const kids: number[] = [];
  for (const words of pages) {
    const id = objects.length + 1;
    kids.push(id);
    const stream = words
      .map(
        (w) =>
          `BT /F1 10 Tf 1 0 0 1 ${w.x} ${w.y} Tm (${w.text.replace(/[\\()]/g, (x) => '\\' + x)}) Tj ET`,
      )
      .join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer;
}

const CHAR = 6; // Courier advance at 10pt
const statementRows: [string, string, string, string][] = [
  ['02/08/2026', 'INV-1001', 'Steel pipes batch A', '1,200.00'],
  ['05/08/2026', 'INV-1002', 'Valves and fittings', '3,400.50'],
  ['11/08/2026', 'PMT-0077', 'Bank transfer received', '-2,000.00'],
  ['19/08/2026', 'INV-1003', 'Gaskets', '880.25'],
  ['23/08/2026', 'CRN-0004', 'Credit note for return', '-115.00'],
];

function statementPage(
  rows: typeof statementRows,
  title: boolean,
  headers = ['Date', 'Doc. Ref', 'Narration', 'Value'],
) {
  const words: { text: string; x: number; y: number }[] = [];
  const x = [40, 130, 230, 430];
  let y = 750;
  if (title) {
    words.push({ text: 'Al-Faisal Trading Co. - Statement', x: 40, y });
    y -= 30;
  }
  headers.forEach((label, i) =>
    words.push({
      text: label,
      x: i === 3 ? x[3] + 80 - label.length * CHAR : x[i],
      y,
    }),
  );
  y -= 22;
  for (const row of rows) {
    words.push({ text: row[0], x: x[0], y });
    words.push({ text: row[1], x: x[1], y });
    let dx = x[2];
    for (const word of row[2].split(' ')) {
      words.push({ text: word, x: dx, y });
      dx += (word.length + 1) * CHAR;
    }
    words.push({ text: row[3], x: x[3] + 80 - row[3].length * CHAR, y });
    y -= 18;
  }
  return words;
}

test('a PDF with unfamiliar headers gets its columns from geometry', async () => {
  const file = await readFile(
    'statement.pdf',
    positionedPdf([
      statementPage(statementRows.slice(0, 3), true),
      statementPage(statementRows.slice(3), false),
    ]),
    undefined,
    true,
  );
  assert.equal(file.pdf!.autoColumns, true);
  assert.equal(
    file.pdf!.cuts.length,
    3,
    'four columns require three boundaries',
  );
  // Each data row lands in the right cell, signs and grouping intact.
  const rows = file.sheets[0].rows;
  assert.deepEqual(rows[2], statementRows[0]);
  assert.deepEqual(rows[4], statementRows[2]);
  // Page two's rows carry their own lineage and read the same way.
  assert.deepEqual(rows.at(-1), statementRows[4]);
  assert.equal(file.sheets[0].rowPages?.[String(rows.length)], 2);
  // No data row may be flagged by boundaries derived from the gaps between them.
  for (const [rn, issues] of Object.entries(file.sheets[0].rowIssues ?? {}))
    assert.ok(
      Number(rn) <= 1 || !issues.length,
      `row ${rn} was flagged: ${issues.join('; ')}`,
    );
});

test('geometry detection is independent of the header wording', async () => {
  for (const headers of [
    ['Date', 'Doc. Ref', 'Narration', 'Value'],
    ['Date', 'Voucher', 'Particulars', 'Net'],
    ['Date', 'Ref', 'Memo', 'Charge'],
  ]) {
    const file = await readFile(
      'statement.pdf',
      positionedPdf([statementPage(statementRows, true, headers)]),
      undefined,
      true,
    );
    assert.equal(
      file.pdf!.cuts.length,
      3,
      `wording ${headers.join('/')} must not change the geometry`,
    );
    assert.deepEqual(file.sheets[0].rows[2], statementRows[0]);
  }
});

test('a reviewed PDF reconciles with no boundary typed by hand', async () => {
  const file = await readFile(
    'statement.pdf',
    positionedPdf([statementPage(statementRows, true)]),
    undefined,
    true,
  );
  const mapping: Mapping = {
    ...defaultMapping(),
    header: 1,
    date: 0,
    reference: 1,
    description: 2,
    amount: 3,
    dateFormat: 'dmy',
    pdfReviewed: true,
  };
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => t.amount),
    [120000, 340050, -200000, 88025, -11500],
  );
  // The attestation is still what unlocks the read.
  assert.throws(
    () =>
      normalizeSource(
        file,
        { ...mapping, pdfReviewed: false },
        scope,
        'supplier',
      ),
    /PDF/,
  );
});

test('geometry refuses to invent columns when the layout proves none', async () => {
  // Continuous prose: no vertical band is free of text on every line, so there
  // is no boundary to prove and none may be guessed.
  const lines = [
    'Dear customer please find below the balance owed as at the end of August',
    'The amount shown is due within thirty days of the statement date shown',
    'Please contact accounts payable should any of these figures need review',
  ];
  const file = await readFile(
    'letter.pdf',
    positionedPdf([lines.map((text, i) => ({ text, x: 40, y: 750 - i * 18 }))]),
    undefined,
    true,
  );
  assert.equal(file.pdf!.cuts.length, 0);
  assert.equal(file.pdf!.autoColumns, undefined);
  // A single-column read is a valid read, so it must not be a dead end.
  assert.equal(file.sheets[0].rows.length, 3);
});

test('a cell overflowing a boundary is flagged, never merged quietly', async () => {
  const words = statementPage(statementRows, true);
  // A late row whose narration runs across the amount column's boundary.
  words.push({
    text: 'Balance carried to the next page please',
    x: 230,
    y: 640,
  });
  const file = await readFile(
    'overflow.pdf',
    positionedPdf([words]),
    undefined,
    true,
  );
  const overflowing = Object.entries(file.sheets[0].rowIssues ?? {}).filter(
    ([, issues]) => issues.some((i) => i.includes('يعبر حد عمود')),
  );
  assert.ok(overflowing.length, 'the crossing row must carry a read issue');
  const mapping: Mapping = {
    ...defaultMapping(),
    header: 1,
    date: 0,
    reference: 1,
    description: 2,
    amount: 3,
    dateFormat: 'dmy',
    pdfReviewed: true,
  };
  const result = normalizeSource(file, mapping, scope, 'supplier');
  // It is reported as unread, not folded into a transaction with a wrong amount.
  const flagged = Number(overflowing[0][0]);
  assert.ok(
    result.errors.some((e) => e.row === flagged) ||
      result.excluded.some((e) => e.row === flagged),
    'the crossing row must not become a silent transaction',
  );
  accounted(file, mapping, result);
});
