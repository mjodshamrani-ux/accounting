import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney,
  parseDate,
  normalizeReference,
  normalizeSource,
  compare,
  inferMapping,
  money,
  safeSum,
} from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import type {
  Scope,
  SourceFile,
  Mapping,
} from '../lib/reconciliation/types.ts';
import { separateSheets } from './helpers/separate-export.ts';
const scope: Scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const run = (
  files = structuredClone(demoFiles),
  maps = structuredClone(demoMappings),
  s = scope,
) =>
  compare(
    normalizeSource(files[0], maps[0], s, 'supplier'),
    normalizeSource(files[1], maps[1], s, 'ledger'),
    s,
  );
const fixture = (rows: string[][]): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'CSV',
      rows: [['date', 'reference', 'amount'], ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
const mapping: Mapping = {
  ...demoMappings[0],
  date: 0,
  reference: 1,
  amount: 2,
  description: -1,
  currencyColumn: -1,
  opening: '',
  closing: '',
};
test('decimal money: no floating arithmetic, Arabic digits and parentheses', () => {
  assert.equal(parseMoney('١٬٢٣٤٫٥٦'), 123456);
  assert.equal(parseMoney('(1.234,56)', 'comma'), -123456);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('001.20'), 120);
  assert.equal(parseMoney('0.123', 'dot', 3), 123);
  assert.equal(money(-1), '-0.01');
});
test('reject ambiguous grouping, excessive precision, missing and exponent amounts', () => {
  for (const v of [
    '12,34.56',
    '1.001',
    '',
    '1e3',
    '-(-1)',
    '1.',
    '1,234,56',
    'SAR 100',
  ])
    assert.throws(() => parseMoney(v), v);
  assert.throws(() => safeSum([1e14, 1]));
});
test('dates require explicit format and real calendar dates', () => {
  assert.equal(parseDate('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(parseDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(parseDate('٢٠٢٦-٠٨-٠١', 'ymd'), '2026-08-01');
  assert.throws(() => parseDate('2026-02-29', 'ymd'));
  assert.throws(() => parseDate('01/01/26', 'dmy'));
});
test('reference normalization preserves year and leading zero distinctions', () => {
  assert.equal(normalizeReference(' INV/001 '), 'INV001');
  assert.notEqual(normalizeReference('INV-001'), normalizeReference('INV-1'));
  assert.notEqual(
    normalizeReference('2026-INV-001'),
    normalizeReference('INV-001'),
  );
});
test('demo retains duplicate ambiguity and produces 2 strict automatic pairs', () => {
  const r = run();
  assert.equal(r.matches.length, 2);
  assert.equal(r.ambiguousIds.length, 2);
  assert.equal(r.supplierOnly.length, 3);
  assert.equal(r.ledgerOnly.length, 2);
  assert.equal(r.bridge?.delta, 350000);
  assert.equal(r.bridge?.adjusted, 4200000);
  assert.equal(r.bridge?.residual, 0);
  assert.equal(r.caseCounts.needsReviewCases, 2);
  assert.equal(r.caseCounts.needsReviewSourceRows, 5);
  assert.equal(r.cases.flatMap((c) => c.sourceTrace).length, 14);
});
test('zero bridge residual never deletes opposite exceptions', () => {
  const files: [SourceFile, SourceFile] = [
    fixture([
      ['2026-08-01', 'INV-A1', '100'],
      ['2026-08-02', 'PAY-X', '-10'],
      ['2026-08-03', 'INV-Y', '10'],
    ]),
    fixture([['2026-08-01', 'INV-A1', '100']]),
  ];
  const m = { ...mapping, opening: '0', closing: '100' };
  const r = run(files, [m, m]);
  assert.equal(r.bridge?.delta, 0);
  assert.equal(r.supplierOnly.length, 2);
  assert.equal(r.matches.length, 1);
});
test('duplicate equality is not resolved by order or date', () => {
  const r = run();
  assert.ok(
    !r.matches.some(
      (m) => m.supplierId === 'supplier:0:8' || m.supplierId === 'supplier:0:9',
    ),
  );
  const files = structuredClone(demoFiles);
  for (const f of files)
    f.sheets[0].rows = [
      f.sheets[0].rows[0],
      ...f.sheets[0].rows.slice(1).reverse(),
    ];
  assert.equal(run(files).matches.length, 2);
});
test('numeric-only weak reference does not auto match', () => {
  const files: [SourceFile, SourceFile] = [
    fixture([['2026-08-01', '00104', '100']]),
    separateSheets(fixture([['2026-08-01', '00104', '100']])),
  ];
  assert.equal(run(files, [mapping, mapping]).matches.length, 0);
});
test('direction must be explicit and sign disagreement cannot auto match', () => {
  const files: [SourceFile, SourceFile] = [
    fixture([['2026-08-01', 'INV-104', '100']]),
    fixture([['2026-08-01', 'INV-104', '-100']]),
  ];
  assert.equal(run(files, [mapping, mapping]).matches.length, 0);
  assert.equal(
    run(files, [mapping, { ...mapping, multiplier: -1 }]).matches.length,
    1,
  );
});
test('cutoff exclusions retained and blank/header rows accounted for', () => {
  const file = fixture([
    ['2026-08-01', 'INV-104', '100'],
    ['2026-09-01', 'INV-105', '200'],
    ['', '', ''],
  ]);
  const r = normalizeSource(file, mapping, scope, 'supplier');
  assert.equal(r.transactions.length, 1);
  assert.equal(r.excluded.length, 3);
  assert.equal(
    r.transactions.length + r.excluded.length + r.errors.length,
    file.sheets[0].rows.length,
  );
});
test('a formula row blocks, a total row is classified, and no row is skipped silently', () => {
  const f = fixture([
    ['2026-08-01', 'INV-104', '100'],
    ['', 'Total', '100'],
  ]);
  f.sheets[0].formulaRows = [2];
  const r = normalizeSource(f, mapping, scope, 'supplier');
  // Row 2 carries a formula, so its value is not trusted.
  assert.deepEqual(
    r.errors.map((e) => e.row),
    [2],
  );
  assert.equal(r.transactions.length, 0);
  // Row 3 is the statement's own total: excluded with a recorded reason and its
  // original cells retained, never dropped without a trace.
  const total = r.excluded.find((e) => e.row === 3)!;
  assert.match(total.reason, /استُبعد تلقائيًا/);
  assert.deepEqual(total.values, ['', 'Total', '100']);
  assert.equal(
    r.transactions.length + r.excluded.length + r.errors.length,
    f.sheets[0].rows.length,
  );
});
test('manual exclusions require reason and preserve source contents', () => {
  const f = fixture([
    ['', 'Total', '100'],
    ['2026-08-01', 'INV-104', '100'],
  ]);
  const r = normalizeSource(
    f,
    { ...mapping, excluded: { '2': 'إجمالي مثبت' } },
    scope,
    'supplier',
  );
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.excluded.find((e) => e.row === 2)?.values, [
    '',
    'Total',
    '100',
  ]);
});
test('currency mismatch blocks source', () => {
  const f = structuredClone(demoFiles[0]);
  f.sheets[0].rows[1][4] = 'USD';
  const r = normalizeSource(f, demoMappings[0], scope, 'supplier');
  assert.equal(r.errors[0].row, 2);
});
test('reused column mapping is rejected', () => {
  assert.throws(() =>
    normalizeSource(
      demoFiles[0],
      { ...demoMappings[0], reference: 0 },
      scope,
      'supplier',
    ),
  );
});
test('arithmetic bridge stays separate from user coverage and invalid balances block it', () => {
  const unconfirmed = run(demoFiles, demoMappings, {
    ...scope,
    coverageConfirmed: false,
  });
  assert.equal(unconfirmed.bridge?.residual, 0);
  assert.equal(unconfirmed.balanceComparable, false);
  assert.equal(
    unconfirmed.supplier.balanceArithmeticStatus,
    'BALANCE_ARITHMETIC_VERIFIED',
  );
  assert.equal(
    unconfirmed.supplier.coverageStatus,
    'PERIOD_COVERAGE_UNCONFIRMED',
  );
  const m = structuredClone(demoMappings);
  m[1].closing = '41000';
  assert.equal(run(demoFiles, m).bridge, null);
});
test('opening adjustment remains separate and unexplained', () => {
  const maps = structuredClone(demoMappings);
  maps[1].opening = '21000';
  maps[1].closing = '43000';
  assert.equal(run(demoFiles, maps).bridge?.openingAdjustment, 100000);
});
test('open items include old unpaid documents; sum must match closing', () => {
  const files: [SourceFile, SourceFile] = [
    fixture([['2026-01-01', 'INV-104', '40']]),
    separateSheets(fixture([['2026-01-01', 'INV-104', '40']])),
  ];
  const m = { ...mapping, reportType: 'open-items' as const, closing: '40' };
  const r = run(files, [m, m]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.balanceComparable, true);
  assert.equal(r.bridge?.openingAdjustment, 0);
});
test('mixed report types rejected', () => {
  assert.throws(() =>
    run(demoFiles, [
      demoMappings[0],
      { ...demoMappings[1], reportType: 'open-items' },
    ]),
  );
});
test('manual pair cannot consume a transaction twice or conceal amount discrepancy', () => {
  const r = run();
  assert.throws(() =>
    compare(r.supplier, r.ledger, scope, [
      { supplierId: 'supplier:0:2', ledgerId: 'ledger:0:2', note: 'وثيقة' },
      { supplierId: 'supplier:0:3', ledgerId: 'ledger:0:2', note: 'وثيقة' },
    ]),
  );
  assert.throws(() =>
    compare(r.supplier, r.ledger, scope, [
      {
        supplierId: 'supplier:0:6',
        ledgerId: 'ledger:0:5',
        note: 'مبلغ مختلف',
      },
    ]),
  );
});
test('rejected automatic match stays a rejected case until a new explicit decision', () => {
  const r = run();
  const rejected = [`${r.matches[0].supplierId}|${r.matches[0].ledgerId}`];
  const r2 = compare(r.supplier, r.ledger, scope, [], rejected);
  assert.equal(r2.matches.length, 1);
  const rejectedCase = r2.cases.find((c) => c.status === 'Rejected');
  assert.equal(rejectedCase?.supplierMembers[0].id, r.matches[0].supplierId);
  assert.equal(rejectedCase?.ledgerMembers[0].id, r.matches[0].ledgerId);
  assert.equal(
    new Set(r2.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)))
      .size,
    14,
  );
});
test('inference suggests only column indices, no invented scope or balance', () => {
  const m = inferMapping(demoFiles[0]);
  assert.equal(m.reference, 1);
  assert.equal(m.amount, 3);
  assert.equal(m.opening, '');
  assert.equal(m.periodStart, '');
});
test('20k rows compare without quadratic candidate search', () => {
  const rows = Array.from({ length: 20000 }, (_, i) => [
    '2026-08-01',
    `INV-${i}`,
    String(i + 1),
  ]);
  const f = fixture(rows);
  const start = performance.now();
  const r = run([f, separateSheets(f)], [mapping, mapping]);
  assert.equal(r.matches.length, 20000);
  assert.ok(performance.now() - start < 6000);
});

test('generic word reference does not auto match', () => {
  const f = fixture([['2026-08-01', 'INVOICE', '100']]);
  assert.equal(
    run([f, separateSheets(f)], [mapping, mapping]).matches.length,
    0,
  );
});

test('extra CSV fields cannot silently shift or truncate amount', () => {
  const f = fixture([['2026-08-01', 'INV-100', '12', '34']]);
  const r = normalizeSource(f, mapping, scope, 'supplier');
  assert.equal(r.transactions.length, 0);
  assert.equal(r.errors.length, 1);
});
