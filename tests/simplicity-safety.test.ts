import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compare,
  inferMapping,
  normalizeSource,
  structuralSummaryLabel,
} from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP-TEST',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  description: 2,
  amount: 3,
};
const fixture = (
  rows: string[][],
  header = ['Date', 'Reference', 'Description', 'Amount'],
): SourceFile => ({
  name: 'synthetic-safety.csv',
  sheets: [
    {
      name: 'Statement',
      rows: [header, ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
function accounted(file: SourceFile, result: SourceResult): void {
  const rows = [
    ...result.transactions.map((entry) => entry.row),
    ...result.excluded.map((entry) => entry.row),
    ...result.errors.filter((entry) => entry.row > 0).map((entry) => entry.row),
  ].sort((a, b) => a - b);
  assert.deepEqual(
    rows,
    file.sheets[0].rows.map((_, i) => i + 1),
    'Every source row must appear exactly once as read, excluded, or erroneous',
  );
}

test('a valid transaction stays a transaction when its entire description is a summary word', () => {
  for (const description of [
    'Total',
    'Closing Balance',
    'Opening balance',
    'الإجمالي',
    'الرصيد الافتتاحي',
  ]) {
    const file = fixture([['2026-07-01', 'INV-100', description, '100.00']]);
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.deepEqual(result.errors, [], description);
    assert.equal(result.transactions.length, 1, description);
    assert.equal(result.transactions[0].amount, 10000);
    assert.equal(result.transactions[0].description, description);
    assert.deepEqual(
      result.excluded.map((row) => row.row),
      [1],
    );
    accounted(file, result);
  }
});

test('a summary word in an unused helper cannot remove a real transaction', () => {
  const file = fixture(
    [['2026-07-01', 'INV-100', 'Goods', '100.00', 'Total']],
    ['Date', 'Reference', 'Description', 'Amount', 'Group'],
  );
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].reference, 'INV-100');
  accounted(file, result);
});

test('a duplicate with description Total remains visible and prevents an automatic match', () => {
  const source = fixture([
    ['2026-07-01', 'INV-100', 'Invoice', '100.00'],
    ['2026-07-01', 'INV-100', 'Total', '100.00'],
  ]);
  const counterpart = fixture([['2026-07-01', 'INV-100', 'Invoice', '100.00']]);
  const supplier = normalizeSource(source, mapping, scope, 'supplier');
  const ledger = normalizeSource(counterpart, mapping, scope, 'ledger');
  const result = compare(supplier, ledger, scope);
  assert.equal(supplier.transactions.length, 2);
  assert.deepEqual(supplier.errors, []);
  assert.equal(result.matches.length, 0);
  assert.equal(result.supplierOnly.length, 2);
  assert.equal(result.ledgerOnly.length, 1);
  assert.deepEqual(
    new Set(result.ambiguousIds),
    new Set(supplier.transactions.map((transaction) => transaction.id)),
  );
  accounted(source, supplier);
  accounted(counterpart, ledger);
});

test('unreadable potential duplicates leave readable data available but cannot prove any automatic match', () => {
  for (const side of ['supplier', 'ledger'] as const) {
    for (const defect of ['amount', 'date', 'reference'] as const) {
      const broken = fixture([
        ['2026-07-01', 'INV-100', 'Invoice', '100.00'],
        [
          defect === 'date' ? '2026-02-30' : '2026-07-01',
          'INV-100',
          'Invoice',
          defect === 'amount' ? 'unreadable' : '100.00',
        ],
      ]);
      if (defect === 'reference')
        broken.sheets[0].referenceIssues = {
          '3:2': ['Reference display does not match its underlying value'],
        };
      const good = fixture([['2026-07-01', 'INV-100', 'Invoice', '100.00']]);
      const supplierFile = side === 'supplier' ? broken : good;
      const ledgerFile = side === 'ledger' ? broken : good;
      const supplier = normalizeSource(
        supplierFile,
        mapping,
        scope,
        'supplier',
      );
      const ledger = normalizeSource(ledgerFile, mapping, scope, 'ledger');
      const result = compare(supplier, ledger, scope);
      const incomplete = side === 'supplier' ? supplier : ledger;
      assert.equal(incomplete.errors.length, 1, `${side}/${defect}`);
      assert.equal(incomplete.errors[0].row, 3);
      assert.equal(incomplete.transactions.length, 1);
      assert.equal(
        result.matches.filter((match) => match.kind === 'auto').length,
        0,
      );
      assert.equal(result.supplierOnly.length, 1);
      assert.equal(result.ledgerOnly.length, 1);
      assert.ok(
        result.diagnostics.some(
          (diagnostic) => diagnostic.code === 'SKIPPED_ROWS',
        ),
      );
      assert.equal(result.balanceComparable, false);
      accounted(supplierFile, supplier);
      accounted(ledgerFile, ledger);
    }
  }
});

test('summary wording cannot bypass a mapped parsing or formula defect in a transaction', () => {
  for (const issue of ['cell', 'row', 'formula']) {
    const file = fixture([['2026-07-01', 'INV-100', 'Total', '100.00']]);
    if (issue === 'cell')
      file.sheets[0].cellIssues = { '2:4': ['Hidden sign'] };
    if (issue === 'row')
      file.sheets[0].rowIssues = { '2': ['PDF text is ambiguous'] };
    if (issue === 'formula') file.sheets[0].formulaRows = [2];
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.equal(result.errors.length, 1, issue);
    assert.equal(result.errors[0].row, 2);
    assert.equal(result.transactions.length, 0);
    assert.ok(!result.excluded.some((row) => row.row === 2));
    accounted(file, result);
  }
});

test('a decimal quantity is not inferred as a monetary amount', () => {
  const file = fixture(
    [['2026-07-01', 'INV-100', '2.50']],
    ['Date', 'Reference', 'Quantity'],
  );
  const inferred = inferMapping(file);
  assert.equal(inferred.date, 0);
  assert.equal(inferred.reference, 1);
  assert.equal(inferred.amount, -1);
  assert.throws(() => normalizeSource(file, inferred, scope, 'supplier'));
});

test('a due date is not inferred as the transaction date merely because it parses', () => {
  const file = fixture(
    [['2026-07-31', 'INV-100', '100.00']],
    ['Due Date', 'Reference', 'Amount'],
  );
  const inferred = inferMapping(file);
  assert.equal(inferred.date, -1);
  assert.equal(inferred.reference, 1);
  assert.equal(inferred.amount, 2);
  assert.throws(() => normalizeSource(file, inferred, scope, 'supplier'));
});

test('an unknown identifier column does not become an invoice reference through uniqueness', () => {
  const file = fixture(
    [['2026-07-01', 'SKU-100', '100.00']],
    ['Date', 'Stock Code', 'Amount'],
  );
  const inferred = inferMapping(file);
  assert.equal(inferred.reference, -1);
  const supplier = normalizeSource(file, inferred, scope, 'supplier');
  const ledger = normalizeSource(file, inferred, scope, 'ledger');
  assert.equal(supplier.transactions.length, 1);
  assert.equal(compare(supplier, ledger, scope).matches.length, 0);
});

test('two explicit reference headers cannot be resolved by preferring the column without duplicates', () => {
  const build = (invoice: string) =>
    fixture(
      [
        ['2026-07-01', invoice, 'ORDER-001', '100.00'],
        ['2026-07-01', invoice, 'ORDER-002', '100.00'],
      ],
      ['Date', 'Invoice No.', 'Our Ref', 'Amount'],
    );
  const supplierFile = build('INV-100');
  const ledgerFile = build('INV-900');
  const supplierMapping = inferMapping(supplierFile);
  const ledgerMapping = inferMapping(ledgerFile);
  assert.equal(supplierMapping.reference, -1);
  assert.equal(ledgerMapping.reference, -1);
  const supplier = normalizeSource(
    supplierFile,
    supplierMapping,
    scope,
    'supplier',
  );
  const ledger = normalizeSource(ledgerFile, ledgerMapping, scope, 'ledger');
  const result = compare(supplier, ledger, scope);
  assert.equal(result.matches.length, 0);
  assert.equal(result.supplierOnly.length, 2);
  assert.equal(result.ledgerOnly.length, 2);
  accounted(supplierFile, supplier);
  accounted(ledgerFile, ledger);
});

test('structural opening and total lines remain accounted for without manual exclusions', () => {
  const file = fixture([
    ['Opening balance', '', '', '40.00'],
    ['2026-07-01', 'INV-100', 'Goods', '100.00'],
    ['Total', '', '', '100.00'],
    ['Closing Balance', '', '', '140.00'],
  ]);
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((transaction) => transaction.row),
    [3],
  );
  assert.equal(result.total, 10000);
  assert.deepEqual(
    result.excluded.map((row) => row.row),
    [1, 2, 4, 5],
  );
  for (const row of result.excluded.filter((entry) => entry.row > 1)) {
    assert.ok(row.reason.trim());
    assert.deepEqual(row.values, file.sheets[0].rows[row.row - 1]);
  }
  assert.deepEqual(mapping.excluded, {});
  accounted(file, result);
});

test('reordered columns cannot turn a dated transaction with a numeric reference into a total', () => {
  const variants = [
    {
      header: ['Description', 'Reference', 'Date', 'Amount'],
      row: ['Total', '12345', '2026-07-01', '100.00'],
      description: 0,
      reference: 1,
      date: 2,
      amount: 3,
    },
    {
      header: ['Description', 'Date', 'Amount', 'Reference'],
      row: ['Total', '2026-07-01', '100.00', '12345'],
      description: 0,
      reference: 3,
      date: 1,
      amount: 2,
    },
    {
      header: ['Amount', 'Description', 'Reference', 'Date'],
      row: ['100.00', 'Total', '12345', '2026-07-01'],
      description: 1,
      reference: 2,
      date: 3,
      amount: 0,
    },
  ];
  for (const variant of variants) {
    const m = {
      ...defaultMapping(),
      date: variant.date,
      reference: variant.reference,
      description: variant.description,
      amount: variant.amount,
    };
    const file = fixture([variant.row], variant.header);
    assert.equal(
      structuralSummaryLabel(variant.row, m, variant.header),
      undefined,
    );
    const result = normalizeSource(file, m, scope, 'supplier');
    assert.deepEqual(result.errors, []);
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].amount, 10000);
    assert.equal(result.transactions[0].reference, '12345');
    assert.equal(result.transactions[0].date, '2026-07-01');
    assert.ok(!result.excluded.some((row) => row.row === 2));
    accounted(file, result);
  }
});

test('missing or malformed dates with numeric document references remain reviewable rows', () => {
  const header = ['Description', 'Reference', 'Date', 'Amount'];
  const m = {
    ...defaultMapping(),
    description: 0,
    reference: 1,
    date: 2,
    amount: 3,
  };
  for (const [date, reference] of [
    ['', '12345'],
    ['2026-02-30', '12345'],
    ['2026-02-30', ''],
    ['01/02/26', '١٢٣٤٥'],
  ]) {
    const row = ['Total', reference, date, '100.00'];
    const file = fixture([row], header);
    assert.equal(structuralSummaryLabel(row, m, header), undefined);
    const result = normalizeSource(file, m, scope, 'supplier');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].row, 2);
    assert.ok(!result.excluded.some((entry) => entry.row === 2));
    accounted(file, result);
  }
  const row = ['Total', '12345', '', '100.00'];
  assert.equal(
    structuralSummaryLabel(row, { ...m, reference: -1 }, header),
    undefined,
    'An explicit reference header remains conflicting evidence when mapping is unresolved',
  );
});

test('dated opening and closing records need dedicated balance identities, never invoice numbers', () => {
  const header = ['Type', 'Reference', 'Date', 'Amount'];
  const m = { ...defaultMapping(), reference: 1, date: 2, amount: 3 };
  const opening = ['Opening Balance', 'B/F', '2026-07-01', '40.00'];
  const closing = ['Closing Balance', 'C/F', '2026-07-31', '140.00'];
  assert.equal(
    structuralSummaryLabel(opening, m, header, true),
    'Opening Balance',
  );
  assert.equal(structuralSummaryLabel(opening, m, header, false), undefined);
  assert.equal(
    structuralSummaryLabel(closing, m, header, false),
    'Closing Balance',
  );
  const file = fixture(
    [opening, ['Invoice', 'INV-100', '2026-07-02', '100.00'], closing],
    header,
  );
  const result = normalizeSource(file, m, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((entry) => entry.row),
    [3],
  );
  assert.equal(result.total, 10000);
  accounted(file, result);
  for (const type of ['Opening Balance', 'Closing Balance'])
    for (const reference of ['12345', 'INV-100'])
      assert.equal(
        structuralSummaryLabel(
          [type, reference, '2026-07-01', '40.00'],
          m,
          header,
          true,
        ),
        undefined,
      );
  assert.equal(
    structuralSummaryLabel(
      ['Opening Balance', 'B/F', '2026-02-30', '40.00'],
      m,
      header,
      true,
    ),
    undefined,
  );
  assert.equal(
    structuralSummaryLabel(
      [...opening, 'INV-100'],
      m,
      [...header, 'Invoice No.'],
      true,
    ),
    undefined,
  );
  assert.equal(
    structuralSummaryLabel(
      [...opening, 'Opening Balance'],
      m,
      [...header, 'Doc Type'],
      true,
    ),
    undefined,
    'Ambiguous type headers cannot prove a balance identity',
  );
});
