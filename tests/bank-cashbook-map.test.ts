import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASHBOOK_MAP_LIMITS,
  CashbookMapError,
  cashbookColumnsUnread,
  cashbookMapProblems,
  chooseCashbookColumns,
  mapColumns,
  namedCashbookMap,
  normalLabel,
  parseCashbookMap,
  readStoredCashbookMaps,
  serializeCashbookMap,
  validateCashbookMap,
  withCashbookMap,
  type CashbookChoice,
  type CashbookColumns,
  type CashbookMap,
} from '../lib/reconciliation/bank-cashbook-map.ts';
import {
  CashbookReadError,
  readBankCashbookTable,
  readMappedBankCashbook,
  type CashbookEntry,
} from '../lib/reconciliation/bank-statement-match.ts';
import { numericPrecisionIssue } from '../lib/reconciliation/io.ts';
import type { SheetData, SourceFile } from '../lib/reconciliation/types.ts';

// bank-cashbook-map-1, proposed. The proof against the oracle on the 21
// sealed stories is scripts/bank-map-proof; here each rule is held directly,
// with a near case where one piece of evidence differs. Characters a reader
// cannot see are built from their code points.

const ch = (code: number) => String.fromCodePoint(code);
const NBSP = ch(0xa0);
const IDEOGRAPHIC_SPACE = ch(0x3000);
const TATWEEL = ch(0x640);
const ZERO_WIDTH_SPACE = ch(0x200b);
const BOM = ch(0xfeff);
const BOLD_A = ch(0x1d400);

function file(
  rows: string[][],
  extra: Partial<SheetData> = {},
  sheets = 1,
): SourceFile {
  const sheet: SheetData = {
    name: 'Cashbook',
    rows,
    formulaRows: [],
    hiddenRows: [],
    ...extra,
  };
  return {
    name: 'cashbook.xlsx',
    sheets: [
      sheet,
      ...Array.from({ length: sheets - 1 }, (_, i) => ({
        ...sheet,
        name: `Notes ${i}`,
        rows: [['note']],
      })),
    ],
  };
}

const HEADER = [
  'Voucher No',
  'Date',
  'Document No',
  'Reference',
  'Narration',
  'Debit',
  'Credit',
  'Balance',
];
const TITLES = [['Al Noor Trading Co.'], ['Cash book'], ['Period: July 2026']];
const ROWS = [
  [
    'RV-1',
    '2026-07-02',
    'DOC-1',
    'TRF-1',
    'Customer receipt',
    '100.50',
    '',
    '1100.50',
  ],
  [
    'PV-2',
    '2026-07-03',
    'DOC-2',
    'CHQ-2',
    'Supplier payment',
    '',
    '40.00',
    '1060.50',
  ],
];
const CHOICE: CashbookChoice = {
  header: 4,
  columns: {
    date: 2,
    voucher: 1,
    description: 5,
    reference: 4,
    receipts: 6,
    payments: 7,
  },
};
const sample = (rows = ROWS, extra: Partial<SheetData> = {}) =>
  file([...TITLES, HEADER, ...rows], extra);
function columnsOf(f: SourceFile, choice = CHOICE): CashbookColumns {
  const chosen = chooseCashbookColumns(f, choice);
  assert.ok('columns' in chosen, JSON.stringify(chosen));
  return chosen.columns;
}
const VALID: CashbookMap = namedCashbookMap(
  'Main current account',
  columnsOf(sample()),
);
/** A map as JSON holds it, open to the edits a test plants. */
type MapDraft = {
  [key: string]: unknown;
  columns: Record<string, { [key: string]: unknown } | null>;
};
const text = (value: unknown) => JSON.stringify(value);
/** The mapped reading's amounts, or its refusal as code@row: a test
 * asserts on either, so a planted defect fails an assertion, not a throw. */
const reading = <T>(
  f: SourceFile,
  columns: CashbookColumns,
  shape: (e: CashbookEntry) => T,
) => {
  try {
    return readMappedBankCashbook(f, 'SAR', columns).map(shape);
  } catch (error) {
    assert.ok(error instanceof CashbookReadError, String(error));
    return `${error.code}@${error.row}`;
  }
};
const amounts = (f: SourceFile, columns: CashbookColumns) =>
  reading(f, columns, (e) => e.amount);
const codeOf = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (error) {
    assert.ok(error instanceof CashbookMapError, String(error));
    return error.code;
  }
};
const edit = (change: (m: MapDraft) => void) => {
  const m = JSON.parse(text(VALID));
  change(m);
  return m;
};

void test('a label is compared in its normal form and nothing looser', () => {
  assert.equal(
    normalLabel(` Voucher${NBSP}\t No${IDEOGRAPHIC_SPACE}`),
    'Voucher No',
  );
  const hamza = 'الإيضاح';
  assert.notEqual(hamza.normalize('NFD'), hamza);
  assert.equal(normalLabel(hamza.normalize('NFD')), hamza);
  assert.notEqual(normalLabel(`المر${TATWEEL}جع`), 'المرجع');
  assert.notEqual(normalLabel('CREDIT'), 'Credit');
  // A zero-width space is not white space.
  assert.equal(normalLabel(`Ref${ZERO_WIDTH_SPACE}`), `Ref${ZERO_WIDTH_SPACE}`);
});

void test('a map carries positions and labels, checked in the contract order', () => {
  assert.deepEqual(validateCashbookMap(JSON.parse(text(VALID))), VALID);
  assert.equal(
    codeOf(() => validateCashbookMap([1])),
    'MAP_JSON',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(
        edit((m) => Object.assign(m, { format: 'x', currency: 'SAR' })),
      ),
    ),
    'MAP_FORMAT',
  );
  assert.equal(
    codeOf(() => validateCashbookMap(edit((m) => (m.currency = 'SAR')))),
    'MAP_KEYS',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(edit((m) => (m.columns.receipts!.sign = 1))),
    ),
    'MAP_KEYS',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(
        edit((m) => Object.assign(m, { name: '', header: 0 })),
      ),
    ),
    'MAP_NAME',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(
        edit((m) =>
          Object.assign(m, {
            header: 0,
            columns: { ...m.columns, date: null },
          }),
        ),
      ),
    ),
    'MAP_HEADER',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(edit((m) => (m.columns.payments!.column = 6))),
    ),
    'MAP_COLUMN',
  );
  assert.equal(
    codeOf(() => validateCashbookMap(edit((m) => (m.columns.date = null)))),
    'MAP_COLUMN',
  );
  assert.equal(
    codeOf(() =>
      validateCashbookMap(edit((m) => (m.columns.date!.column = '2'))),
    ),
    'MAP_COLUMN',
  );
  assert.equal(
    codeOf(() => validateCashbookMap(edit((m) => (m.version = true)))),
    'MAP_FORMAT',
  );
  assert.equal(
    codeOf(() => validateCashbookMap(edit((m) => (m.header = true)))),
    'MAP_HEADER',
  );
  // Optional roles may go without a column.
  assert.equal(
    codeOf(() =>
      validateCashbookMap(
        edit((m) =>
          Object.assign(m.columns, { description: null, reference: null }),
        ),
      ),
    ),
    null,
  );
});

void test('the limits of a map, at and beyond each', () => {
  const at = (change: (m: MapDraft) => void) =>
    codeOf(() => validateCashbookMap(edit(change)));
  assert.equal(
    at((m) => (m.name = 'n'.repeat(CASHBOOK_MAP_LIMITS.name))),
    null,
  );
  assert.equal(
    at((m) => (m.name = 'n'.repeat(CASHBOOK_MAP_LIMITS.name + 1))),
    'MAP_NAME',
  );
  assert.equal(
    at((m) => (m.header = 30)),
    null,
  );
  assert.equal(
    at((m) => (m.header = 31)),
    'MAP_HEADER',
  );
  assert.equal(
    at((m) => (m.header = 1.5)),
    'MAP_HEADER',
  );
  assert.equal(
    at((m) => (m.columns.payments!.column = 100)),
    null,
  );
  assert.equal(
    at((m) => (m.columns.payments!.column = 101)),
    'MAP_COLUMN',
  );
  assert.equal(
    at((m) => (m.columns.reference!.label = 'r'.repeat(120))),
    null,
  );
  assert.equal(
    at((m) => (m.columns.reference!.label = 'r'.repeat(121))),
    'MAP_LABEL',
  );
  // UTF-16 code units: 60 characters outside the basic plane are 120.
  assert.equal(
    at((m) => (m.columns.reference!.label = BOLD_A.repeat(60))),
    null,
  );
  assert.equal(
    at((m) => (m.columns.reference!.label = BOLD_A.repeat(61))),
    'MAP_LABEL',
  );
  assert.equal(
    at((m) => (m.columns.reference!.label = ' Reference')),
    'MAP_LABEL',
  );
  assert.equal(
    at((m) => (m.columns.reference!.label = `Cheque${ch(7)}Ref`)),
    'MAP_LABEL',
  );
  assert.equal(
    at((m) => (m.name = ' Main current account')),
    'MAP_NAME',
  );
});

void test('a map file is read as TextDecoder and JSON.parse read it', () => {
  const bytes = new TextEncoder().encode(serializeCashbookMap(VALID));
  assert.deepEqual(parseCashbookMap(bytes), VALID);
  assert.deepEqual(
    parseCashbookMap(
      new TextEncoder().encode(BOM + serializeCashbookMap(VALID)),
    ),
    VALID,
  );
  const json = serializeCashbookMap(VALID);
  assert.equal(
    codeOf(() =>
      parseCashbookMap(
        new TextEncoder().encode(json.replace('"header": 4', '"header": NaN')),
      ),
    ),
    'MAP_JSON',
  );
  assert.deepEqual(
    parseCashbookMap(
      new TextEncoder().encode(json.replace('"header": 4', '"header": 4.0')),
    ),
    VALID,
  );
  const broken = Uint8Array.from(bytes);
  broken[json.indexOf('Main')] = 0xf6;
  assert.equal(
    codeOf(() => parseCashbookMap(broken)),
    'MAP_JSON',
  );
  const padded =
    json.slice(0, -2) +
    ' '.repeat(CASHBOOK_MAP_LIMITS.bytes - json.length) +
    json.slice(-2);
  assert.equal(
    new TextEncoder().encode(padded).length,
    CASHBOOK_MAP_LIMITS.bytes,
  );
  assert.deepEqual(parseCashbookMap(new TextEncoder().encode(padded)), VALID);
  assert.equal(
    codeOf(() => parseCashbookMap(new TextEncoder().encode(` ${padded}`))),
    'MAP_JSON',
  );
  assert.equal(
    codeOf(() =>
      parseCashbookMap(new TextEncoder().encode('{"__proto__": {}}')),
    ),
    'MAP_FORMAT',
  );
});

void test('a map fits by position and label; a moved or renamed column does not', () => {
  const columns = mapColumns(VALID);
  assert.deepEqual(cashbookMapProblems(sample(), columns), []);
  // Reference and Document No change places.
  const swapped = [...HEADER];
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  const moved = file([...TITLES, swapped, ...ROWS]);
  assert.deepEqual(cashbookMapProblems(moved, columns), [
    {
      kind: 'column',
      role: 'reference',
      column: 4,
      label: 'Reference',
      found: 'Document No',
      elsewhere: ['C4'],
    },
  ]);
  // The same header one row lower: every role differs; no other row is searched.
  const lower = file([...TITLES, ['Printed'], HEADER, ...ROWS]);
  assert.deepEqual(
    cashbookMapProblems(lower, columns).map((p) =>
      p.kind === 'column' ? `${p.role}:${p.elsewhere.join(',')}` : p.kind,
    ),
    [
      'date:B5',
      'voucher:A5',
      'description:E5',
      'reference:D5',
      'receipts:F5',
      'payments:G5',
    ],
  );
  // White space differs: fits. Letter case differs: does not.
  const spaced = [...HEADER];
  spaced[0] = `Voucher${NBSP} No `;
  assert.deepEqual(
    cashbookMapProblems(file([...TITLES, spaced, ...ROWS]), columns),
    [],
  );
  const upper = [...HEADER];
  upper[6] = 'CREDIT';
  assert.deepEqual(
    cashbookMapProblems(file([...TITLES, upper, ...ROWS]), columns).map(
      (p) => p.kind === 'column' && p.role,
    ),
    ['payments'],
  );
  // A column appended after the mapped ones changes nothing.
  assert.deepEqual(
    cashbookMapProblems(
      file([...TITLES, [...HEADER, 'Cost centre'], ...ROWS]),
      columns,
    ),
    [],
  );
});

void test('a label is searched in the first thirty rows only', () => {
  const columns = mapColumns(edit((m) => (m.columns.reference!.column = 9)));
  const at = (row: number) => {
    const rows: string[][] = Array.from({ length: 31 }, () => []);
    rows[3] = HEADER;
    rows[row - 1] = ['', '', '', 'Reference'];
    return cashbookMapProblems(file(rows), columns);
  };
  const reference = (problems: ReturnType<typeof at>) =>
    problems.find((p) => p.kind === 'column' && p.role === 'reference');
  assert.deepEqual((reference(at(30)) as { elsewhere: string[] }).elsewhere, [
    'D4',
    'D30',
  ]);
  assert.deepEqual((reference(at(31)) as { elsewhere: string[] }).elsewhere, [
    'D4',
  ]);
});

void test('the file must be one sheet and reach the header row', () => {
  const columns = mapColumns(VALID);
  assert.deepEqual(
    cashbookMapProblems(file([...TITLES, HEADER, ...ROWS], {}, 2), columns),
    [{ kind: 'sheets', count: 2 }],
  );
  assert.deepEqual(cashbookMapProblems(file([...TITLES]), columns), [
    { kind: 'header-row', row: 4 },
  ]);
  assert.deepEqual(cashbookMapProblems(file([...TITLES, HEADER]), columns), []);
});

void test('a choice by hand: header, columns, the file, then labels', () => {
  const choose = (choice: CashbookChoice, f = sample()) => {
    try {
      return chooseCashbookColumns(f, choice);
    } catch (error) {
      assert.ok(error instanceof CashbookMapError);
      return error.code;
    }
  };
  const columns = { ...CHOICE.columns };
  assert.equal(
    choose({ header: 31, columns: { ...columns, payments: 6 } }),
    'MAP_HEADER',
  );
  assert.equal(
    choose({ header: 4, columns: { ...columns, payments: 6 } }),
    'MAP_COLUMN',
  );
  assert.equal(
    choose({ header: 4, columns: { ...columns, date: null } }),
    'MAP_COLUMN',
  );
  // A column whose header cell is empty has no label to prove it.
  const blank = file([
    ...TITLES,
    [...HEADER.slice(0, 4), '', ...HEADER.slice(5)],
    ...ROWS,
  ]);
  assert.equal(choose(CHOICE, blank), 'MAP_LABEL');
  // A second sheet is reported before any label is read.
  assert.deepEqual(
    choose(
      CHOICE,
      file(
        [...TITLES, [...HEADER.slice(0, 4), '', ...HEADER.slice(5)], ...ROWS],
        {},
        2,
      ),
    ),
    {
      problems: [{ kind: 'sheets', count: 2 }],
    },
  );
  const spaced = file([
    ...TITLES,
    [`Voucher${NBSP} No `, ...HEADER.slice(1)],
    ...ROWS,
  ]);
  const chosen = choose(CHOICE, spaced);
  assert.ok(typeof chosen === 'object' && 'columns' in chosen);
  assert.equal(chosen.columns.columns.voucher?.label, 'Voucher No');
  assert.deepEqual(cashbookColumnsUnread(sample(), chosen.columns), {
    above: 3,
    unread: [
      { column: 3, label: 'Document No' },
      { column: 8, label: 'Balance' },
    ],
  });
});

void test('the mapped reading reads the entries under the header and nothing above', () => {
  const columns = mapColumns(VALID);
  // A row above the header that looks like an entry is not one.
  const above = file([
    ['RV-0', '2026-07-01', '', 'TRF-0', 'Opening', '9.00', ''],
    ...TITLES.slice(1),
    HEADER,
    ...ROWS,
  ]);
  assert.deepEqual(
    reading(above, columns, (e) => [
      e.id,
      e.row,
      e.date,
      e.reference,
      e.direction,
      e.amount,
    ]),
    [
      ['RV-1', 5, '2026-07-02', 'TRF-1', 'in', 10050],
      ['PV-2', 6, '2026-07-03', 'CHQ-2', 'out', 4000],
    ],
  );
  // The declared reading refuses the same file by its header.
  assert.throws(
    () => readBankCashbookTable(sample(), 'SAR'),
    (e: unknown) => e instanceof CashbookReadError && e.code === 'HEADER',
  );
  // Without a reference column, references are empty.
  const noReference = chooseCashbookColumns(sample(), {
    header: 4,
    columns: { ...CHOICE.columns, reference: null },
  });
  assert.ok('columns' in noReference);
  assert.deepEqual(
    reading(sample(), noReference.columns, (e) => e.reference),
    ['', ''],
  );
});

void test('the mapped reading refuses as the declared one does, on its own columns', () => {
  const columns = mapColumns(VALID);
  const code = (f: SourceFile, currency = 'SAR', c = columns) => {
    try {
      readMappedBankCashbook(f, currency, c);
      return 'read';
    } catch (error) {
      assert.ok(error instanceof CashbookReadError, String(error));
      return `${error.code}@${error.row}`;
    }
  };
  assert.equal(code(sample(), 'XXX'), 'SCOPE@0');
  // Columns that do not fit are refused, not read.
  assert.equal(code(sample(), 'SAR', { ...columns, header: 3 }), 'MAP@3');
  // A value under an empty header cell; a labelled unmapped column is fine.
  assert.equal(code(sample([ROWS[0], [...ROWS[1], 'note']])), 'COLUMN@6');
  assert.equal(
    code(
      sample([ROWS[0], [...ROWS[1].slice(0, 2), 'other', ...ROWS[1].slice(3)]]),
    ),
    'read',
  );
  // A row with values only in columns the map does not read.
  assert.equal(
    code(sample([ROWS[0], ['', '', 'DOC-9', '', '', '', '', '9.00'], ROWS[1]])),
    'ROW@6',
  );
  assert.equal(
    code(sample([ROWS[0], ['', '', '', '', 'Total', '100.50', '40.00', '']])),
    'AMOUNT@6',
  );
  assert.equal(
    code(
      sample([ROWS[0], [...ROWS[1].slice(0, 0), 'RV-1', ...ROWS[1].slice(1)]]),
    ),
    'VOUCHER@6',
  );
  assert.equal(
    code(sample([ROWS[0], [ROWS[1][0], '03/07/2026', ...ROWS[1].slice(2)]])),
    'DATE@6',
  );
});

void test('a typed amount is read as typed in its mapped column, not the declared one', () => {
  const columns = mapColumns(VALID);
  const rows = [
    ROWS[0],
    [
      'PV-2',
      '2026-07-03',
      'DOC-2',
      'CHQ-2',
      'Supplier payment',
      '',
      '40',
      '1060.50',
    ],
  ];
  assert.deepEqual(
    amounts(
      sample(rows, { numericCells: { '6:7': { value: 40, format: '' } } }),
      columns,
    ),
    [10050, 4000],
  );
  // The same number recorded as typed in the declared Payments column (6)
  // does not make the mapped column's text a typed amount.
  assert.throws(
    () =>
      readMappedBankCashbook(
        sample(rows, { numericCells: { '6:6': { value: 40, format: '' } } }),
        'SAR',
        columns,
      ),
    (e: unknown) =>
      e instanceof CashbookReadError && e.code === 'AMOUNT' && e.row === 6,
  );
});

void test('the reader records on mapped cells refuse; on other cells they do not', () => {
  const columns = mapColumns(VALID);
  const code = (extra: Partial<SheetData>) => {
    try {
      readMappedBankCashbook(sample(ROWS, extra), 'SAR', columns);
      return 'read';
    } catch (error) {
      assert.ok(error instanceof CashbookReadError);
      return `${error.code}@${error.row}`;
    }
  };
  assert.equal(code({ cellIssues: { '6:7': ['formula'] } }), 'CELL@6');
  assert.equal(code({ cellIssues: { '6:8': ['formula'] } }), 'read');
  assert.equal(code({ cellIssues: { '4:4': ['merged'] } }), 'CELL@4');
  assert.equal(code({ cellIssues: { '2:4': ['merged'] } }), 'read');
  // Reference issues only on the voucher and reference columns.
  assert.equal(code({ referenceIssues: { '5:4': ['format'] } }), 'CELL@5');
  assert.equal(code({ referenceIssues: { '5:5': ['format'] } }), 'read');
  assert.equal(code({ rowIssues: { '5': ['hidden sheet'] } }), 'SHEET@5');
  // The precision note is no issue on an amount column, named by its own letter.
  assert.equal(
    code({ cellIssues: { '5:6': [numericPrecisionIssue('F5')] } }),
    'read',
  );
  assert.equal(
    code({ cellIssues: { '5:6': [numericPrecisionIssue('E5')] } }),
    'CELL@5',
  );
  assert.equal(
    code({ cellIssues: { '5:4': [numericPrecisionIssue('D5')] } }),
    'CELL@5',
  );
});

void test('an amount column past Z keeps its precision note by its own letters', () => {
  const wide = (cells: string[]) => [
    ...cells.slice(0, 6),
    ...Array(20).fill(''),
    cells[6],
  ];
  const header = wide([
    'Voucher No',
    'Date',
    'Document No',
    'Reference',
    'Narration',
    'Debit',
    'Credit',
  ]);
  const f = (issues: Record<string, string[]>) =>
    file([header, ...ROWS.map((r) => wide(r))], { cellIssues: issues });
  const chosen = chooseCashbookColumns(f({}), {
    header: 1,
    columns: { ...CHOICE.columns, payments: 27 },
  });
  assert.ok('columns' in chosen);
  assert.deepEqual(
    amounts(f({ '3:27': [numericPrecisionIssue('AA3')] }), chosen.columns),
    [10050, 4000],
  );
  assert.throws(
    () =>
      readMappedBankCashbook(
        f({ '3:27': [numericPrecisionIssue('A3')] }),
        'SAR',
        chosen.columns,
      ),
    (e: unknown) => e instanceof CashbookReadError && e.code === 'CELL',
  );
});

void test('saved maps: one per name, a corrupt one not offered, fifty at most', () => {
  assert.deepEqual(readStoredCashbookMaps(null), { maps: [], unreadable: 0 });
  assert.deepEqual(readStoredCashbookMaps('{'), { maps: [], unreadable: 1 });
  const other = namedCashbookMap('Payroll account', mapColumns(VALID));
  const stored = readStoredCashbookMaps(
    text([VALID, { ...VALID, header: 0 }, other, VALID]),
  );
  assert.deepEqual(
    stored.maps.map((m) => m.name),
    ['Main current account', 'Payroll account'],
  );
  assert.equal(stored.unreadable, 2);
  const replaced = withCashbookMap(stored.maps, { ...VALID, header: 5 });
  assert.deepEqual(
    replaced?.map((m) => [m.name, m.header]),
    [
      ['Main current account', 5],
      ['Payroll account', 4],
    ],
  );
  const full = Array.from({ length: 50 }, (_, i) =>
    namedCashbookMap(`Account ${i}`, mapColumns(VALID)),
  );
  assert.equal(
    withCashbookMap(full, namedCashbookMap('Account 50', mapColumns(VALID))),
    null,
  );
  assert.equal(withCashbookMap(full, { ...full[3], header: 2 })?.[3].header, 2);
  assert.equal(readStoredCashbookMaps(text([...full, other])).unreadable, 1);
});
