import test from 'node:test';
import assert from 'node:assert/strict';
import { inferScopeSuggestions } from '../lib/reconciliation/scope-inference.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { inferMapping } from '../lib/reconciliation/core.ts';
import type { SourceFile, SheetData } from '../lib/reconciliation/types.ts';

const header = ['Date', 'Reference', 'Description', 'Amount'];
const transaction = ['2026-06-02', 'SYN-41', 'Supplies', '187.50'];
const source = (rows: string[][], name = 'synthetic.xlsx'): SourceFile => ({
  name,
  sheets: [{ name: 'Statement', rows, formulaRows: [], hiddenRows: [] }],
});
const infer = (a: SourceFile, b: SourceFile | null = null) =>
  inferScopeSuggestions(
    [a, b],
    [inferMapping(a), b ? inferMapping(b) : defaultMapping()],
  );

test('explicit metadata from a nine-column supplier layout retains source evidence and uses period end', () => {
  const file = source([
    ['Synthetic vendor report'],
    ['Supplier', 'Tidal Office Supplies'],
    ['Customer', 'Cedar Works LLC'],
    ['Customer Account', '0007-A'],
    ['Currency', 'SAR'],
    ['Period', '01-Jun-2026 to 30-Jun-2026'],
    [
      'Date',
      'Type',
      'Document No.',
      'Customer Ref / PO',
      'Description',
      'Debit (SAR)',
      'Credit (SAR)',
      'Running Balance',
      'Due Date',
    ],
    [
      '02-Jun-2026',
      'Invoice',
      'SYN-41',
      'PO-77',
      'Supplies',
      '187.50',
      '0.00',
      '687.50',
      '02-Jul-2026',
    ],
  ]);
  const result = infer(file);
  assert.deepEqual(result.values, {
    supplier: 'Tidal Office Supplies',
    entity: 'Cedar Works LLC',
    account: '0007-A',
    currency: 'SAR',
    cutoff: '2026-06-30',
  });
  assert.deepEqual(result.fields.cutoff.evidence[0], {
    value: '2026-06-30',
    rawValue: '01-Jun-2026 to 30-Jun-2026',
    label: 'Period',
    sourceName: 'synthetic.xlsx',
    side: 'supplier',
    sheet: 'Statement',
    row: 6,
    column: 2,
    kind: 'label',
  });
  assert.equal(result.fields.currency.evidence.length, 3);
});

test('Arabic labels and explicit inline metadata work before a PDF table without column cuts', () => {
  const file = source(
    [
      ['كشف المورد التجريبي'],
      ['المورد: شركة الموج | العميل: شركة الورق'],
      ['رقم حساب العميل: 00042'],
      ['العملة: SAR'],
      ['الفترة: من ٢٠٢٦-٠٦-٠١ إلى ٢٠٢٦-٠٦-٣٠'],
      ['التاريخ رقم المستند البيان مدين دائن الرصيد'],
      ['2026-06-02 SYN-41 Supplies 187.50 0.00 687.50'],
      ['المورد: هذا نص بعد الجدول وليس بيانات النطاق'],
    ],
    'synthetic.pdf',
  );
  file.pdf = { cuts: [], pages: 1 };
  const result = inferScopeSuggestions(
    [file, null],
    [defaultMapping(), defaultMapping()],
  );
  assert.deepEqual(result.values, {
    supplier: 'شركة الموج',
    entity: 'شركة الورق',
    account: '00042',
    currency: 'SAR',
    cutoff: '2026-06-30',
  });
  assert.equal(result.fields.supplier.evidence.length, 1);
});

test('PDF inline labels separated only by spaces remain anchored and preserve role across both sides', () => {
  const a = source([
    ['Supplier: Tidal Office Supplies Customer: Cedar Works LLC Currency: SAR'],
    ['Customer Account: C-009 Period: 01-Jun-2026 to 30-Jun-2026'],
    header,
    transaction,
  ]);
  const b = source(
    [
      ['Vendor: Tidal Office Supplies'],
      ['Legal Entity: Cedar Works LLC'],
      ['Period End: 2026-06-30'],
      header,
      transaction,
    ],
    'synthetic-ledger.xlsx',
  );
  const result = infer(a, b);
  assert.equal(result.values.supplier, 'Tidal Office Supplies');
  assert.equal(result.fields.supplier.evidence[1].side, 'ledger');
  assert.equal(result.values.entity, 'Cedar Works LLC');
  assert.equal(result.values.account, 'C-009');
});

test('different explicit dates, entities, accounts and currencies remain conflicts without a chosen value', () => {
  const a = source([
    ['Customer', 'Cedar Works LLC'],
    ['Customer Account', 'a42'],
    ['Currency', 'SAR'],
    ['Period', '2026-06-01 - 2026-06-30'],
    header,
    transaction,
  ]);
  const b = source([
    ['Customer', 'Other Legal Entity'],
    ['Supplier Account', 'A42'],
    ['Currency', 'USD'],
    ['Period', '2026-07-01 - 2026-07-31'],
    header,
    transaction,
  ]);
  const result = infer(a, b);
  for (const field of ['entity', 'account', 'currency', 'cutoff'] as const) {
    assert.equal(result.fields[field].status, 'conflict');
    assert.equal(result.fields[field].value, undefined);
    assert.equal(result.values[field], undefined);
    assert.equal(result.fields[field].evidence.length, 2);
  }
});

test('nothing comes from filename, company title, generic account, statement date, transaction extrema or other sheets', () => {
  const file = source(
    [
      ['Company', 'Guessable Co'],
      ['Account', '42'],
      ['Statement Date', '2026-06-30'],
      ['Report generated for Supplier: Invented Supplier'],
      ['Supplier', '', 'Unrelated text'],
      header,
      transaction,
      ['Supplier: A description after the header'],
    ],
    'SAR-Cedar-2026-06-30.xlsx',
  );
  file.sheets.push({
    name: 'Diagnostics',
    rows: [
      ['Supplier', 'Do not read me'],
      ['Currency', 'USD'],
    ],
    formulaRows: [],
    hiddenRows: [],
  });
  const result = infer(file);
  assert.deepEqual(result.values, {});
  assert.ok(
    Object.values(result.fields).every((field) => field.status === 'missing'),
  );
  assert.deepEqual(
    inferScopeSuggestions([null, null], [defaultMapping(), defaultMapping()])
      .values,
    {},
  );
  assert.deepEqual(
    inferScopeSuggestions(
      [file, null],
      [{ ...defaultMapping(), sheet: -1 }, defaultMapping()],
    ).values,
    {},
  );
});

test('a complete mapped currency column provides one currency with auditable rows; unmapped helpers do not', () => {
  const file = source([
    ['Date', 'Reference', 'Amount', 'Currency', 'Helper currency'],
    ['2026-06-02', 'SYN-41', '187.50', 'sar', 'USD'],
    ['2026-06-03', 'SYN-42', '125.25', 'SAR', 'USD'],
  ]);
  const result = infer(file);
  assert.equal(result.values.currency, 'SAR');
  assert.equal(result.fields.currency.evidence[0].row, 2);
  assert.equal(result.fields.currency.evidence[0].checkedRows, 2);
  assert.equal(result.fields.currency.evidence[0].rawValue, 'sar');
  assert.equal(result.fields.currency.evidence[0].kind, 'column');
});

test('incomplete currency columns block prefill and mixed currencies are exposed even when a row is blank', () => {
  const file = source([
    ['Currency', 'SAR'],
    ['Date', 'Reference', 'Amount', 'Currency'],
    ['2026-06-02', 'SYN-41', '187.50', 'SAR'],
    ['2026-06-03', 'SYN-42', '125.25', ''],
  ]);
  let result = infer(file);
  assert.equal(result.values.currency, undefined);
  assert.equal(result.fields.currency.status, 'missing');
  assert.equal(result.fields.currency.issues.length, 1);
  file.sheets[0].rows.push(['2026-06-04', 'SYN-43', '20.00', 'USD']);
  result = infer(file);
  assert.equal(result.fields.currency.status, 'conflict');
  assert.equal(result.values.currency, undefined);
  const mapping = inferMapping(file);
  mapping.excluded = {
    '4': 'non-data row reviewed',
    '5': 'out of scope row reviewed',
  };
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, defaultMapping()]).values
      .currency,
    'SAR',
  );
});

test('only selected amount headers are currency evidence and their contradictions prevent prefill', () => {
  const file = source([
    ['Currency', 'SAR'],
    ['Date', 'Reference', 'Debit (SAR)', 'Credit (USD)', 'Helper (AED)'],
    ['2026-06-02', 'SYN-41', '187.50', '0.00', '0.00'],
  ]);
  const result = infer(file);
  assert.equal(result.values.currency, undefined);
  assert.equal(result.fields.currency.status, 'conflict');
  assert.deepEqual(
    result.fields.currency.evidence.map((item) => item.value),
    ['SAR', 'SAR', 'USD'],
  );
});

test('invalid explicit metadata cannot be overridden by another valid label or a header', () => {
  const file = source([
    ['Currency', 'Saudi Riyal'],
    ['Currency', 'SAR'],
    ['Period End', '2026-02-30'],
    ['Period', '2026-06-01 - 2026-06-30'],
    header,
    transaction,
  ]);
  const result = infer(file);
  assert.equal(result.values.currency, undefined);
  assert.equal(result.values.cutoff, undefined);
  assert.equal(result.fields.currency.issues.length, 1);
  assert.equal(result.fields.cutoff.issues.length, 1);
  file.sheets[0].rows[2] = ['Period', '2026-06-30 to 2026-06-01'];
  assert.equal(infer(file).values.cutoff, undefined);
});

test('ambiguous numeric metadata is not filled even when transaction date order is configured', () => {
  const file = source([['Period End', '03/04/2026'], header, transaction]);
  const mapping = inferMapping(file);
  assert.equal(infer(file).values.cutoff, undefined);
  assert.equal(
    inferScopeSuggestions(
      [file, null],
      [{ ...mapping, dateFormat: 'dmy' }, defaultMapping()],
    ).values.cutoff,
    undefined,
  );
  assert.equal(
    inferScopeSuggestions(
      [file, null],
      [{ ...mapping, dateFormat: 'mdy' }, defaultMapping()],
    ).values.cutoff,
    undefined,
  );
});

test('hidden, formula, and parser-flagged metadata cannot become suggestions', () => {
  const variants: Partial<SheetData>[] = [
    { hiddenRows: [1] },
    { formulaRows: [1] },
    { rowIssues: { '1': ['suspicious'] } },
    { cellIssues: { '1:1': ['bad label'] } },
    { cellIssues: { '1:2': ['bad value'] } },
  ];
  for (const variant of variants) {
    const file = source([
      ['Supplier', 'Tidal Office Supplies'],
      header,
      transaction,
    ]);
    Object.assign(file.sheets[0], variant);
    assert.equal(infer(file).values.supplier, undefined);
  }
});

test('suggestions are deterministic, do not mutate source/mappings and never supply approvals or balance evidence', () => {
  const file = source([
    ['Supplier', 'Tidal Office Supplies'],
    ['Currency', 'SAR'],
    header,
    transaction,
  ]);
  const mapping = inferMapping(file);
  const before = JSON.stringify({ file, mapping });
  const first = inferScopeSuggestions(
    [file, null],
    [mapping, defaultMapping()],
  );
  assert.deepEqual(
    inferScopeSuggestions([file, null], [mapping, defaultMapping()]),
    first,
  );
  assert.equal(JSON.stringify({ file, mapping }), before);
  assert.equal(Object.hasOwn(first.values, 'confirmed'), false);
  assert.equal(Object.hasOwn(first.values, 'coverageConfirmed'), false);
  assert.equal(Object.hasOwn(first.values, 'opening'), false);
});
