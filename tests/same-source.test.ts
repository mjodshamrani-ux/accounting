import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import { SAME_SOURCE_MESSAGE } from '../lib/reconciliation/core.ts';
import { engineCatalog } from '../lib/i18n/engine-catalog.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

// One source on both sides is not a reconciliation. The comparison may still
// be shown, labelled as a diagnostic, but nothing in it is approved, on every
// path (compare, restore, export). Two independent sources are unaffected,
// even when they come from one workbook or carry similar names.
const scope: Scope = {
  supplier: 'S',
  entity: 'E',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const ROWS = [
  ['Date', 'Reference', 'Type', 'Description', 'Amount'],
  ['2026-07-09', 'INV-4101', 'Invoice', 'Goods supplied', '1250.00'],
  ['2026-07-10', 'INV-4102', 'Invoice', 'Goods supplied', '300.00'],
];
const csvBytes = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
const read = (name: string, rows = ROWS) => readFile(name, csvBytes(rows));
const reading = (file: SourceFile, side: 'supplier' | 'ledger', sheet = 0) => {
  const { mapping } = selectImportMapping(file, side);
  return { ...mapping, sheet } as Mapping;
};
const run = (files: [SourceFile, SourceFile], mappings: [Mapping, Mapping]) =>
  reconcileSupplierStatement({ files, mappings, scope }).result;
const isDiagnosticOnly = (r: ReturnType<typeof run>) =>
  r.caseCounts.autoMatchedCases === 0 &&
  r.caseCounts.matchedSourceRows === 0 &&
  r.matches.length === 0 &&
  r.diagnostics.some((d) => d.code === 'SAME_SOURCE_BOTH_SIDES') &&
  r.cases.every(
    (c) => c.status !== 'Matched' && c.evidence[0] === SAME_SOURCE_MESSAGE,
  );

test('the same file on both sides is a labelled diagnostic, never approved', async () => {
  const f = await read('july.csv');
  const r = run([f, f], [reading(f, 'supplier'), reading(f, 'ledger')]);
  assert.ok(isDiagnosticOnly(r));
  assert.equal(r.caseCounts.needsReviewCases, 2);
  // The message is catalogued, so it is shown in both languages.
  assert.ok(engineCatalog[SAME_SOURCE_MESSAGE]);
});

test('a copy under another name is still the same source', async () => {
  const f = await read('july.csv');
  const copy = await read('july (copy) - ledger.csv');
  assert.equal(f.sha256, copy.sha256);
  const r = run([f, copy], [reading(f, 'supplier'), reading(copy, 'ledger')]);
  assert.ok(isDiagnosticOnly(r));
});

test('the same file read with its columns listed or chosen differently is still the same source', async () => {
  const f = await read('july.csv');
  const m = reading(f, 'supplier');
  // The same reading with its keys in another order.
  const reordered = Object.fromEntries(
    Object.entries(reading(f, 'ledger')).reverse(),
  ) as Mapping;
  assert.ok(isDiagnosticOnly(run([f, f], [m, reordered])));
  // Another column taken as the description does not make another source.
  assert.ok(
    isDiagnosticOnly(
      run([f, f], [m, { ...reading(f, 'ledger'), description: 2 }]),
    ),
  );
});

test('similar names on two different sources are two sources', async () => {
  const supplier = await read('july statement.csv');
  const ledger = await read('july statement.csv', [
    ...ROWS,
    ['2026-07-12', 'INV-4103', 'Invoice', 'Goods supplied', '75.00'],
  ]);
  assert.notEqual(supplier.sha256, ledger.sha256);
  const r = run(
    [supplier, ledger],
    [reading(supplier, 'supplier'), reading(ledger, 'ledger')],
  );
  assert.equal(r.caseCounts.autoMatchedCases, 2);
  assert.ok(!r.diagnostics.some((d) => d.code === 'SAME_SOURCE_BOTH_SIDES'));
});

test('two different sheets of one workbook are two sources', async () => {
  const book = new ExcelJS.Workbook();
  for (const name of ['Vendor statement', 'AP ledger']) {
    const sheet = book.addWorksheet(name);
    for (const row of ROWS)
      sheet.addRow(
        row.map((v, i) => (i === 4 && /\d/.test(v) ? Number(v) : v)),
      );
  }
  const bytes = new Uint8Array(await book.xlsx.writeBuffer())
    .buffer as ArrayBuffer;
  const f = await readFile('workpaper.xlsx', bytes);
  assert.equal(f.sheets.length, 2);
  // A two-sheet workbook is read as the accountant sets it: one sheet each.
  const sheetReading = (sheet: number) =>
    ({
      ...defaultMapping(),
      sheet,
      header: 0,
      date: 0,
      reference: 1,
      description: 3,
      amount: 4,
    }) as Mapping;
  const mappings: [Mapping, Mapping] = [sheetReading(0), sheetReading(1)];
  const r = run([f, f], mappings);
  assert.equal(r.caseCounts.autoMatchedCases, 2);
  assert.ok(!r.diagnostics.some((d) => d.code === 'SAME_SOURCE_BOTH_SIDES'));
  // The same sheet chosen twice from that workbook is one source again.
  assert.ok(
    isDiagnosticOnly(run([f, f], [mappings[0], { ...mappings[1], sheet: 0 }])),
  );
});

test('restoring, comparing again and exporting keep the self-comparison unapproved', async () => {
  const f = await read('july.csv');
  const copy = await read('july-ledger.csv');
  const files: [SourceFile, SourceFile] = [f, copy];
  const mappings: [Mapping, Mapping] = [
    reading(f, 'supplier'),
    reading(copy, 'ledger'),
  ];
  const review = { checked: false, name: '', notes: '' };
  const restored = await restoreSession(
    await saveSession({
      files,
      mappings,
      scope,
      decisions: [],
      rejected: [],
      events: [],
      review,
    }),
  );
  assert.ok(isDiagnosticOnly(restored.result));
  assert.deepEqual(restored.result, run(files, mappings));
  // A manual decision cannot turn it into an approved reconciliation either.
  const [s, l] = [
    restored.result.supplier.transactions[0],
    restored.result.ledger.transactions[0],
  ];
  const withDecision = reconcileSupplierStatement({
    files,
    mappings,
    scope,
    decisions: [{ supplierId: s.id, ledgerId: l.id, note: 'checked' }],
  }).result;
  assert.equal(
    withDecision.cases.filter((c) => c.status === 'Matched').length,
    0,
  );
  // The workpaper carries the label and no approved case.
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportWorkbook(restored.result, files, review));
  const texts: string[] = [];
  book.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => void texts.push(String(cell.value ?? ''))),
    ),
  );
  assert.ok(texts.includes('SAME_SOURCE_BOTH_SIDES'));
  assert.ok(!texts.includes('Matched'));
});
