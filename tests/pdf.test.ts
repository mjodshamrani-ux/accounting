import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import {
  layoutPdfPage,
  validateCuts,
  checkPdfOperators,
} from '../lib/reconciliation/pdf.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';

import { syntheticPdf } from './helpers/pdf-fixture.ts';
const rows = [
  ['date', 'reference', 'amount', 'description'],
  ['2026-08-01', 'INV-001', '1234.56', 'Invoice'],
  ['2026-08-02', 'PAY-002', '-20.00', 'Payment'],
];
const cuts = [25, 45, 65];
test('oversized PDF cells reject before reaching Excel and malformed PDFs do not poison later reads', async () => {
  await assert.rejects(
    readFile('long-cell.pdf', syntheticPdf([[['x'.repeat(5000)]]], 0.01)),
    /خلية PDF/,
  );
  await assert.rejects(
    readFile('broken.pdf', new TextEncoder().encode('%PDF-1.7\nbroken').buffer),
  );
  const recovered = await readFile('valid.pdf', syntheticPdf([rows]), cuts);
  assert.deepEqual(recovered.sheets[0].rows, rows);
});
test('OCR invisible text and large raster backgrounds cannot pass as native PDF text', () => {
  const ops = {
    save: 1,
    restore: 2,
    transform: 3,
    setTextRenderingMode: 4,
    showText: 5,
    paintImageXObject: 6,
  };
  assert.throws(
    () => checkPdfOperators(ops, [4, 5], [[3], ['text']], 480000),
    /OCR/,
  );
  assert.throws(
    () => checkPdfOperators(ops, [3, 6], [[600, 0, 0, 800, 0, 0], []], 480000),
    /OCR/,
  );
  assert.throws(() =>
    checkPdfOperators(
      ops,
      [1, 3, 6, 2, 5],
      [[], [30, 0, 0, 30, 0, 0], [], [], ['text']],
      480000,
    ),
  );
});
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  description: 3,
  pdfReviewed: true,
};
const scope = {
  supplier: 'Supplier',
  entity: 'Entity',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
test('PDF actual bytes preserve columns, signs, row provenance and original bytes', async () => {
  const bytes = syntheticPdf([rows]);
  const f = await readFile('supplier.PDF', bytes, cuts);
  assert.deepEqual(f.sheets[0].rows, rows);
  assert.deepEqual(f.original, bytes);
  assert.equal(f.pdf?.pages, 1);
  assert.equal(f.sheets[0].rowPages?.['3'], 1);
  const s = normalizeSource(f, mapping, scope, 'supplier');
  assert.deepEqual(
    s.transactions.map((t) => t.amount),
    [123456, -2000],
  );
  assert.equal(s.transactions[1].sourcePage, 1);
});
test('PDF cannot reconcile without explicit extraction review', async () => {
  const f = await readFile('a.pdf', syntheticPdf([rows]), cuts);
  assert.throws(
    () =>
      normalizeSource(f, { ...mapping, pdfReviewed: false }, scope, 'supplier'),
    /PDF/,
  );
  // A boundary list is geometry, not an approval: a single-column extraction has
  // no boundary to set, and the review is still the thing that unlocks the read.
  f.pdf!.cuts = [];
  assert.throws(
    () =>
      normalizeSource(f, { ...mapping, pdfReviewed: false }, scope, 'supplier'),
    /PDF/,
  );
  assert.ok(normalizeSource(f, mapping, scope, 'supplier').transactions.length);
});
test('multi-page PDF keeps repeated headers and page lineage instead of silently deleting rows', async () => {
  const f = await readFile('a.pdf', syntheticPdf([rows, rows]), cuts);
  assert.equal(f.sheets[0].rows.length, 6);
  assert.equal(f.sheets[0].rowPages?.['4'], 2);
  const s = normalizeSource(f, mapping, scope, 'supplier');
  // Page two repeats the header verbatim. It is classified, not turned into an
  // error the accountant has to clear, and its cells stay in the record.
  const repeated = s.excluded.find((e) => e.row === 4)!;
  assert.match(repeated.reason, /عناوين مُكرر/);
  assert.deepEqual(repeated.values, rows[0]);
  assert.deepEqual(s.errors, []);
  assert.equal(s.transactions.length, 4);
  assert.equal(s.transactions[2].sourcePage, 2);
  assert.equal(
    s.transactions.length + s.excluded.length + s.errors.length,
    f.sheets[0].rows.length,
  );
});
test('blank/scanned page rejects the entire PDF including text/image mixed documents', async () => {
  for (const pages of [[[]], [rows, []]])
    await assert.rejects(
      readFile('scan.pdf', syntheticPdf(pages), cuts),
      /OCR/,
    );
});
test('fake PDF and more than 20 pages fail closed', async () => {
  await assert.rejects(
    readFile('fake.pdf', new TextEncoder().encode('not a PDF').buffer),
    /PDF/,
  );
  await assert.rejects(
    readFile(
      'long.pdf',
      syntheticPdf(Array.from({ length: 21 }, () => rows)),
      cuts,
    ),
    /20/,
  );
});
test('column boundary crossings and duplicate overlay glyphs produce blocking row issues', () => {
  const t = { text: '1234.56', x: 140, y: 100, width: 50, height: 10 };
  assert.ok(layoutPdfPage([t], [25], 600)[0].issues.length);
  assert.ok(layoutPdfPage([t, t], [50], 600)[0].issues.length);
});
test('invalid column cuts, coordinates and replacement characters fail closed', () => {
  for (const c of [
    [NaN],
    [0],
    [100],
    [40, 20],
    [20, 20],
    Array.from({ length: 20 }, (_, i) => i + 1),
  ])
    assert.throws(() => validateCuts(c));
  assert.throws(() =>
    layoutPdfPage(
      [{ text: 'bad\uFFFD', x: 0, y: 0, width: 10, height: 10 }],
      [],
      600,
    ),
  );
  assert.throws(() =>
    layoutPdfPage(
      [{ text: '10', x: NaN, y: 0, width: 10, height: 10 }],
      [],
      600,
    ),
  );
});
test('Arabic glyph text is preserved without reversing references or guessing numbers', () => {
  const result = layoutPdfPage(
    [
      { text: 'فاتورة-١٢٣', x: 400, y: 100, width: 80, height: 10 },
      { text: '١٬٢٣٤٫٥٦', x: 100, y: 100, width: 70, height: 10 },
    ],
    [50],
    600,
  );
  assert.deepEqual(result[0].row, ['١٬٢٣٤٫٥٦', 'فاتورة-١٢٣']);
  assert.deepEqual(result[0].issues, []);
});
test('PDF export re-extracts original bytes and session restoration keeps the same result', async () => {
  const f = await readFile('a.pdf', syntheticPdf([rows]), cuts);
  const files: [typeof f, typeof f] = [f, f];
  const r = compare(
    normalizeSource(f, mapping, scope, 'supplier'),
    normalizeSource(f, mapping, scope, 'ledger'),
    scope,
  );
  assert.equal(r.matches.length, 2);
  const bytes = await exportWorkbook(r, files, {
    checked: false,
    name: '',
    notes: '',
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  assert.equal(
    book.getWorksheet('Supplier transactions')!.getCell('J2').value,
    1,
  );
  const saved = await saveSession({
    files,
    mappings: [mapping, mapping],
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  });
  const restored = await restoreSession(saved);
  assert.deepEqual(restored.files[0].pdf, f.pdf);
  assert.deepEqual(restored.result, r);
  f.sheets[0].rows[1][2] = '999';
  const altered = compare(
    normalizeSource(f, mapping, scope, 'supplier'),
    normalizeSource(f, mapping, scope, 'ledger'),
    scope,
  );
  await assert.rejects(
    exportWorkbook(altered, files, { checked: false, name: '', notes: '' }),
  );
});
