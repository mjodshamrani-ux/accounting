import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-046',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
type Row = {
  amount: string;
  ref?: string;
  type?: string;
  bank?: string;
  receipt?: string;
  voucher?: string;
  po?: string;
  date?: string;
  description?: string;
  currency?: string;
};
const headers = [
  'Date',
  'Document No',
  'Amount',
  'Document Type',
  'Bank Reference',
  'Receipt No',
  'AP Voucher',
  'PO',
  'Description',
  'Currency',
];
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  description: 8,
  currencyColumn: 9,
};
const file = (rows: Row[], amountHeader = 'Amount'): SourceFile => ({
  name: 'synthetic-046.csv',
  sheets: [
    {
      name: 'Data',
      formulaRows: [],
      hiddenRows: [],
      rows: [
        headers.map((h, i) => (i === 2 ? amountHeader : h)),
        ...rows.map((r) => [
          r.date ?? '2026-07-15',
          r.ref ?? 'PAY-046-01',
          r.amount,
          r.type ?? 'Payment',
          r.bank ?? 'BANK-046-19',
          r.receipt ?? '',
          r.voucher ?? '',
          r.po ?? '',
          r.description ?? '',
          r.currency ?? 'SAR',
        ]),
      ],
    },
  ],
});
const sources = (
  a: Row[],
  b: Row[],
  pa: Partial<Mapping> = {},
  pb: Partial<Mapping> = {},
) =>
  [
    normalizeSource(file(a), { ...mapping, ...pa }, scope, 'supplier'),
    normalizeSource(file(b), { ...mapping, ...pb }, scope, 'ledger'),
  ] as const;
const single: Row[] = [{ amount: '-100' }];
const parts: Row[] = [{ amount: '-40' }, { amount: '-60' }];
function conserved(result: ReturnType<typeof compare>, count: number) {
  const ids = result.cases.flatMap((c) =>
    c.sourceTrace.map((r) => r.sourceRowId),
  );
  assert.equal(ids.length, count);
  assert.equal(new Set(ids).size, count);
}

test('046 explicit shared bank identity proves a whole payment in either 1:N direction', () => {
  for (const reverse of [false, true]) {
    const pair = reverse ? sources(parts, single) : sources(single, parts);
    const r = compare(...pair, scope);
    assert.equal(
      r.matches.length,
      1,
      'clear payment group must be completed, not reviewed',
    );
    assert.equal(
      r.cases[0].matchingRule,
      'EXPLICIT_PAYMENT_IDENTITY_GROUP_TOTAL_V1',
    );
    assert.equal(
      r.cases[0].classification,
      reverse ? 'EXACT_MANY_TO_1' : 'EXACT_1_TO_MANY',
    );
    assert.equal(r.cases[0].supplierTotal, -10000);
    assert.equal(r.cases[0].ledgerTotal, -10000);
    assert.equal(r.cases[0].bridgeEffect, 0);
    assert.equal(r.caseCounts.matchedSourceRows, 3);
    assert.equal(r.caseCounts.autoMatchedCases, 1);
    assert.match(r.matches[0].reason, /BANK-046-19/);
    conserved(r, 3);
  }
});
test('046 explicit receipt identity supports payment groups without a bank column value', () => {
  const patch = (rows: Row[]) =>
    rows.map((r) => ({ ...r, bank: '', receipt: 'RCPT-046-09' }));
  const r = compare(...sources(patch(single), patch(parts)), scope);
  assert.equal(r.matches.length, 1);
  assert.match(r.matches[0].reason, /RCPT-046-09/);
});
test('046 generic shared payment references and unique amount subsets remain review, not proof', () => {
  for (const b of [
    parts,
    [
      { amount: '-40', ref: 'PAY-A-46' },
      { amount: '-60', ref: 'PAY-B-46' },
    ],
  ]) {
    const pair = sources(
      single.map((r) => ({ ...r, bank: '' })),
      b.map((r) => ({ ...r, bank: '' })),
    );
    const r = compare(...pair, scope);
    assert.equal(r.matches.length, 0);
    conserved(r, 3);
  }
  const prefixOnly = sources(
    single.map((r) => ({ ...r, bank: '' })),
    parts.map((r) => ({ ...r, bank: '' })),
  );
  assert.equal(prefixOnly[0].transactions[0].receiptReference, 'PAY-046-01');
  assert.deepEqual(
    prefixOnly[0].transactions[0].paymentIdentityFields ?? [],
    [],
  );
});
test('046 payment identity cannot allocate invoices or override document, amount, sign, date or receipt conflicts', () => {
  for (const mutation of [
    { type: 'Invoice' },
    { amount: '-59.99' },
    { amount: '60' },
    { date: '2026-07-16' },
    { bank: 'BANK-OTHER-99' },
    { receipt: 'RCPT-OTHER-99' },
  ]) {
    const a = single.map((r) => ({ ...r, receipt: 'RCPT-046-10' }));
    const b = parts.map((r) => ({ ...r, receipt: 'RCPT-046-10' }));
    b[1] = { ...b[1], ...mutation };
    const r = compare(...sources(a, b), scope);
    assert.equal(r.matches.length, 0, JSON.stringify(mutation));
    conserved(r, 3);
  }
  const competingReceipts = parts.map((r, i) => ({
    ...r,
    receipt: `RCPT-OTHER-${i}`,
  }));
  assert.equal(
    compare(...sources(single, competingReceipts), scope).matches.length,
    0,
  );
});
test('046 bank-reference groups never search a matching subset or ignore a competing same-identity row', () => {
  for (const extra of [
    { amount: '-10' },
    { amount: '-100' },
    { amount: '-100', type: 'Invoice', ref: 'INV-046-42' },
  ]) {
    const r = compare(...sources(single, [...parts, extra]), scope);
    assert.equal(r.matches.length, 0);
    conserved(r, 4);
  }
});
test('046 a duplicate component cannot be disguised by changing its description', () => {
  for (const type of ['Payment', 'Invoice']) {
    const a = [{ amount: '100', type, ref: 'DOC-046-11', po: 'PO-046-71' }];
    const b = ['first description', 'second description'].map(
      (description) => ({
        amount: '50',
        type,
        ref: 'DOC-046-11',
        po: 'PO-046-71',
        voucher: 'AP-046-81',
        description,
      }),
    );
    assert.equal(compare(...sources(a, b), scope).matches.length, 0, type);
  }
});
test('046 explicit original invoice lines retain the existing 6750 = 2500 + 2250 + 2000 capability', () => {
  const common = {
    ref: 'INV-046-729',
    type: 'Invoice',
    bank: '',
    po: 'PO-046-871',
  };
  const a = [{ ...common, amount: '6750' }];
  const b = ['2500', '2250', '2000'].map((amount) => ({
    ...common,
    amount,
    voucher: 'AP-046-149',
  }));
  const r = compare(...sources(a, b), scope);
  assert.equal(r.matches.length, 1);
  assert.equal(r.cases[0].supplierTotal, 675000);
  assert.equal(r.cases[0].ledgerTotal, 675000);
  assert.equal(r.cases[0].matchingRule, 'EXACT_REFERENCE_GROUP_TOTAL_V1');
  conserved(r, 4);
});
test('046 explicit source errors, hidden evidence and excluded same-payment rows prevent complete-group approval', () => {
  const withError = sources(single, parts);
  withError[1].errors.push({ row: 99, message: 'unreadable movement' });
  assert.equal(compare(...withError, scope).matches.length, 0);
  const hidden = file(parts);
  hidden.sheets[0].hiddenRows = [2];
  const hiddenSource = normalizeSource(hidden, mapping, scope, 'ledger');
  assert.equal(
    compare(sources(single, parts)[0], hiddenSource, scope).matches.length,
    0,
  );
  const unsafeHeader = file(parts);
  unsafeHeader.sheets[0].referenceIssues = {
    '1:5': ['unsafe identity heading'],
  };
  const unsafeSource = normalizeSource(unsafeHeader, mapping, scope, 'ledger');
  assert.equal(
    compare(sources(single, parts)[0], unsafeSource, scope).matches.length,
    0,
  );
  const excluded = sources(single, [
    ...parts,
    { amount: '-10', date: '2026-08-01' },
  ]);
  assert.equal(
    excluded[1].excluded.filter((r) => r.values.includes('2026-08-01')).length,
    1,
  );
  assert.equal(compare(...excluded, scope).matches.length, 0);
});
test('046 currency and amount-basis conflicts are not group evidence even after user confirmation', () => {
  const currency = sources(single, [
    parts[0],
    { ...parts[1], currency: 'USD' },
  ]);
  assert.equal(compare(...currency, scope).matches.length, 0);
  const remaining = normalizeSource(
    file(parts, 'Outstanding'),
    mapping,
    scope,
    'ledger',
  );
  assert.ok(remaining.errors.some((e) => e.row === 0));
  assert.equal(
    compare(sources(single, parts)[0], remaining, scope).matches.length,
    0,
  );
  assert.throws(() =>
    compare(...sources(single, parts, {}, { reportType: 'open-items' }), scope),
  );
});
test('046 row-level amount basis cannot mix original and remaining values under a generic amount header', () => {
  const withBasis = (
    values: string[],
    reportType: Mapping['reportType'] = 'transactions',
  ) => {
    const input = file(
      parts.map((r) => ({
        ...r,
        type: 'Invoice',
        bank: '',
        po: 'PO-BASIS-046',
      })),
    );
    input.sheets[0].rows.forEach((row, i) =>
      row.push(i === 0 ? 'Amount Basis' : values[i - 1]),
    );
    return normalizeSource(input, { ...mapping, reportType }, scope, 'ledger');
  };
  const invoice = sources(
    single.map((r) => ({
      ...r,
      type: 'Invoice',
      bank: '',
      po: 'PO-BASIS-046',
    })),
    parts,
  )[0];
  for (const values of [
    ['Movement', 'Original Amount'],
    ['مبلغ الحركة', 'مبلغ الفاتورة'],
  ]) {
    const b = withBasis(values);
    assert.deepEqual(b.errors, []);
    assert.equal(compare(invoice, b, scope).matches.length, 1);
  }
  for (const values of [
    ['Original Amount', 'Outstanding'],
    ['Movement', 'Unknown'],
    ['Movement', ''],
  ]) {
    const b = withBasis(values);
    assert.equal(b.transactions.length, 1);
    assert.ok(b.errors.some((e) => e.row === 3 && /أساس مبلغ/.test(e.message)));
    assert.equal(compare(invoice, b, scope).matches.length, 0);
  }
  const open = withBasis(['Outstanding', 'Remaining Amount'], 'open-items');
  assert.deepEqual(open.errors, []);
  const mixedOpen = withBasis(['Outstanding', 'Movement'], 'open-items');
  assert.ok(mixedOpen.errors.some((e) => e.row === 3));
});
test('046 payment group rejection is preserved and source ordering never selects a subset', () => {
  const variants = [parts, [...parts].reverse()];
  for (const rows of variants) {
    const pair = sources(single, rows);
    assert.equal(compare(...pair, scope).matches.length, 1);
    const rejected = [
      `${pair[0].transactions[0].id}|${pair[1].transactions[0].id}`,
    ];
    assert.equal(compare(...pair, scope, [], rejected).matches.length, 0);
  }
});
test('046 a search limit is exposed with all group rows retained', () => {
  const b = Array.from({ length: 101 }, (_, i) => ({
    amount: String(-(i + 1)),
  }));
  const r = compare(...sources([{ amount: '-5151' }], b), scope);
  assert.equal(r.matches.length, 0);
  assert.equal(r.cases[0].status, 'Needs Review');
  assert.match(r.cases[0].evidence.join(' '), /حد الاعتماد الآلي/);
  conserved(r, 102);
});
test('046 a manual decision cannot override explicit document identity or PO conflicts', () => {
  for (const patch of [
    { type: 'Invoice' },
    { po: 'PO-OTHER-88' },
    { receipt: 'RCPT-OTHER-88' },
  ]) {
    const a = [{ amount: '-100', po: 'PO-046-87', receipt: 'RCPT-046-11' }];
    const b = [{ ...a[0], ...patch }];
    const pair = sources(a, b);
    assert.throws(
      () =>
        compare(...pair, scope, [
          {
            supplierId: pair[0].transactions[0].id,
            ledgerId: pair[1].transactions[0].id,
            note: 'reviewed',
          },
        ]),
      /تعارض|متعارض/,
    );
  }
});

test('046 payment proof is re-read from original bytes for export and sessions, never trusted from an annotated result', async () => {
  const read = async (rows: Row[], side: string) => {
    const csv = file(rows)
      .sheets[0].rows.map((row) =>
        row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(','),
      )
      .join('\r\n');
    return readFile(
      `synthetic-${side}-046.csv`,
      new TextEncoder().encode(csv).buffer,
    );
  };
  for (const explicit of [true, false]) {
    const rows = [single, parts].map((items) =>
      items.map((r) => ({ ...r, ...(explicit ? {} : { bank: '' }) })),
    );
    const files = (await Promise.all(
      rows.map((r, i) => read(r, String(i))),
    )) as [SourceFile, SourceFile];
    const a = normalizeSource(files[0], mapping, scope, 'supplier');
    const b = normalizeSource(files[1], mapping, scope, 'ledger');
    const r = compare(a, b, scope);
    assert.equal(r.matches.length, explicit ? 1 : 0);
    const bytes = await exportWorkbook(r, files, {
      checked: false,
      name: '',
      notes: '',
    });
    assert.ok(bytes.byteLength > 0);
    const session = await saveSession({
      files,
      mappings: [mapping, mapping],
      scope,
      decisions: [],
      rejected: [],
      events: [],
      review: { checked: false, name: '', notes: '' },
    });
    assert.equal(
      (await restoreSession(session)).result.matches.length,
      explicit ? 1 : 0,
    );
    if (!explicit) {
      for (const t of [...a.transactions, ...b.transactions])
        t.paymentIdentityFields = ['receiptReference'];
      const forged = compare(a, b, scope);
      assert.equal(
        forged.matches.length,
        1,
        'probe actually forges an in-memory approval',
      );
      await assert.rejects(
        exportWorkbook(forged, files, { checked: false, name: '', notes: '' }),
        /إعادة الحساب/,
      );
    }
  }
});
