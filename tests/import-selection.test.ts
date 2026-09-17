import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import {
  getMappedImportIssues,
  selectImportMapping,
} from '../lib/reconciliation/import-selection.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';

const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const rows = [
  ['date', 'reference', 'amount'],
  ['2026-08-01', 'SYNTHETIC-1', '100.25'],
  ['2026-08-02', 'SYNTHETIC-2', '-20.00'],
];

async function workbookFile(tables: [string, (string | number)[][]][]) {
  const book = new ExcelJS.Workbook();
  for (const [name, data] of tables) {
    const sheet = book.addWorksheet(name);
    data.forEach((row) => sheet.addRow(row));
  }
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  return readFile(
    'synthetic-import.xlsx',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

test('upload chooses the only recognizable table after an instructions sheet and normalization preserves exact totals', async () => {
  const file = await workbookFile([
    ['Instructions', [['Read the statement before comparing']]],
    ['Transactions', [['Synthetic supplier statement'], ...rows]],
    ['Summary', [['Closing balance', '80.25']]],
  ]);
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'unique-table');
  assert.equal(selection.mapping.sheet, 1);
  assert.equal(selection.mapping.header, 1);
  const normalized = normalizeSource(
    file,
    selection.mapping,
    scope,
    'supplier',
  );
  assert.deepEqual(normalized.errors, []);
  assert.equal(normalized.total, 8025);
  assert.equal(normalized.transactions.length, 2);
  assert.equal(normalized.balanceValid, false);
});

test('two plausible source tables require explicit sheet selection instead of defaulting to either', async () => {
  const file = await workbookFile([
    ['Diagnostics', [['Not a source table']]],
    ['Supplier A', rows],
    ['Supplier B', rows],
  ]);
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'choose-sheet');
  assert.equal(selection.mapping.sheet, -1);
  assert.throws(
    () => normalizeSource(file, selection.mapping, scope, 'supplier'),
    /ورقة/,
  );
  const chosen = inferMapping(file, 2);
  assert.equal(normalizeSource(file, chosen, scope, 'supplier').total, 8025);
});

test('unknown multisheet layouts require sheet choice while unknown single-sheet files remain configurable', async () => {
  const unknown = [
    ['Unfamiliar heading', 'Another heading'],
    ['abc', '100'],
  ];
  const multi = await workbookFile([
    ['Cover', [['Cover']]],
    ['Data', unknown],
  ]);
  assert.equal(selectImportMapping(multi, 'ledger').mapping.sheet, -1);
  const single = await workbookFile([['Data', unknown]]);
  const selection = selectImportMapping(single, 'ledger');
  assert.equal(selection.kind, 'single-sheet');
  assert.equal(selection.mapping.sheet, 0);
  assert.equal(selection.mapping.amount, -1);
  assert.throws(
    () => normalizeSource(single, selection.mapping, scope, 'ledger'),
    /أعمدة/,
  );
});

test('a unique debit-credit table is suggested without inferring the debt direction or confirmed balances', async () => {
  const file = await workbookFile([
    ['Notes', [['Synthetic notes']]],
    [
      'Data',
      [
        ['التاريخ', 'المرجع', 'مدين', 'دائن'],
        ['2026-08-01', 'SYNTHETIC-1', 100, 0],
      ],
    ],
  ]);
  const mapping = selectImportMapping(file, 'supplier').mapping;
  assert.equal(mapping.sheet, 1);
  assert.equal(mapping.mode, 'split');
  assert.equal(mapping.opening, '');
  assert.equal(mapping.closing, '');
  assert.deepEqual(mapping.excluded, {});
});

test('a PDF awaiting column boundaries remains accessible without gaining extraction approval', () => {
  const file: SourceFile = {
    name: 'synthetic.pdf',
    sheets: [
      {
        name: 'PDF',
        rows: [['Unsplit PDF text']],
        formulaRows: [],
        hiddenRows: [],
      },
    ],
    pdf: { cuts: [], pages: 1 },
  };
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.mapping.sheet, 0);
  assert.notEqual(selection.mapping.pdfReviewed, true);
});

test('a real synthetic export reimports the appropriate source copy and does not restore old approvals or decisions', async () => {
  const supplier = normalizeSource(
    demoFiles[0],
    demoMappings[0],
    scope,
    'supplier',
  );
  const ledger = normalizeSource(
    demoFiles[1],
    demoMappings[1],
    scope,
    'ledger',
  );
  const result = compare(supplier, ledger, scope);
  const bytes = await exportWorkbook(result, structuredClone(demoFiles), {
    checked: true,
    name: 'Synthetic reviewer',
    notes: 'Synthetic import regression',
  });
  const file = await readFile('synthetic-workpaper.xlsx', bytes);
  assert.ok(file.sheets.length > 12);
  for (const side of ['supplier', 'ledger'] as const) {
    const selection = selectImportMapping(file, side);
    assert.equal(selection.kind, 'workpaper');
    assert.equal(
      file.sheets[selection.mapping.sheet].name,
      side === 'supplier' ? 'Parsed Supplier Source' : 'Parsed Ledger Source',
    );
    assert.ok(selection.mapping.header > 0);
    assert.equal(selection.mapping.opening, '');
    assert.equal(selection.mapping.closing, '');
    assert.equal(selection.mapping.periodStart, '');
    assert.deepEqual(selection.mapping.excluded, {});
    assert.notEqual(selection.mapping.pdfReviewed, true);
    assert.match(selection.notice, /مصدَّر من تراصف/);
    assert.match(selection.notice, /لم تُستعد/);
    const normalized = normalizeSource(file, selection.mapping, scope, side);
    const previous = side === 'supplier' ? supplier : ledger;
    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.total, previous.total);
    assert.deepEqual(
      normalized.transactions.map((transaction) => transaction.reference),
      previous.transactions.map((transaction) => transaction.reference),
    );
    assert.equal(normalized.balanceValid, false);
  }
});

test('familiar workpaper sheet names without the export signatures do not auto-select a side', async () => {
  const file = await workbookFile([
    ['Diagnostics', [['Unrelated content']]],
    ['Run settings', [['Scope', 'not settings']]],
    ['Supplier source', rows],
    ['Ledger source', rows],
  ]);
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'choose-sheet');
  assert.equal(selection.mapping.sheet, -1);
});

test('early review lists only selected cells on included data rows, retaining row-level geometry issues', () => {
  const file: SourceFile = {
    name: 'synthetic.xlsx',
    sheets: [
      {
        name: 'Data',
        rows: [
          ...rows.map((row) => [...row, 'unmapped']),
          ['2026-08-03', 'SYNTHETIC-3', '10', 'unmapped'],
        ],
        formulaRows: [],
        hiddenRows: [],
        cellIssues: {
          '1:3': ['Header decoration'],
          '2:3': ['Unsafe amount sign'],
          '2:4': ['Unselected decorative cell'],
          '4:3': ['Explicitly excluded row'],
        },
        rowIssues: { '3': ['Overlapping row geometry'] },
        referenceIssues: {
          '2:2': ['Reference display differs from stored digits'],
          '2:3': ['Amount formatting is not a reference concern'],
          '4:2': ['Excluded reference'],
        },
      },
    ],
  };
  const mapping = {
    ...inferMapping(file),
    excluded: { '4': 'Synthetic non-transaction row reviewed' },
  };
  assert.deepEqual(getMappedImportIssues(file, mapping), [
    {
      row: 2,
      column: 2,
      messages: ['Reference display differs from stored digits'],
    },
    { row: 2, column: 3, messages: ['Unsafe amount sign'] },
    { row: 3, messages: ['Overlapping row geometry'] },
  ]);
  assert.deepEqual(getMappedImportIssues(file, { ...mapping, sheet: -1 }), []);
});

test('early review exposes uncached formulas even when the row appears empty', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['date', 'reference', 'amount']);
  sheet.addRow([{ formula: 'A3' }, { formula: 'B3' }, { formula: 'C3' }]);
  const file = await readFile(
    'synthetic.xlsx',
    new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
  );
  const mapping = inferMapping(file);
  const issues = getMappedImportIssues(file, mapping);
  assert.equal(issues.length, 3);
  assert.ok(
    issues.every(
      (issue) =>
        issue.row === 2 &&
        issue.messages.some((message) => message.includes('صيغة')),
    ),
  );
  assert.deepEqual(
    getMappedImportIssues(file, {
      ...mapping,
      excluded: { '2': 'Reviewed formula footer' },
    }),
    [],
  );
});
