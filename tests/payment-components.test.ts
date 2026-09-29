import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Scope, SourceFile } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
type Row = {
  amount: string;
  bank?: string;
  receipt?: string;
  reference?: string;
  voucher?: string;
  date?: string;
  type?: string;
  po?: string;
  chosen?: string;
  description?: string;
};
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  amount: 3,
  description: 8,
  currencyColumn: 9,
};
const file = (rows: Row[]): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'Data',
      formulaRows: [],
      hiddenRows: [],
      rows: [
        [
          'Date',
          'Document No',
          'Reference',
          'Amount',
          'Type',
          'Bank Reference',
          'Receipt No',
          'Voucher No',
          'Description',
          'Currency',
          'PO',
        ],
        ...rows.map((t) => [
          t.date ?? '2026-07-15',
          t.reference ?? 'PAY-4001',
          t.chosen ?? t.reference ?? 'PAY-4001',
          t.amount,
          t.type ?? 'Payment',
          t.bank ?? '',
          t.receipt ?? '',
          t.voucher ?? '',
          t.description ?? '',
          'SAR',
          t.po ?? '',
        ]),
      ],
    },
  ],
});
const source = (a: Row[], b: Row[]) =>
  [
    normalizeSource(file(a), mapping, scope, 'supplier'),
    normalizeSource(file(b), mapping, scope, 'ledger'),
  ] as const;
const run = (a: Row[], b: Row[]) => compare(...source(a, b), scope);
const auto = (r: ReturnType<typeof compare>) =>
  r.matches.filter((m) => m.kind === 'auto');
const conserved = (r: ReturnType<typeof compare>) =>
  assert.deepEqual(
    r.cases.flatMap((c) => c.sourceTrace.map((s) => s.sourceRowId)).sort(),
    [...r.supplier.transactions, ...r.ledger.transactions]
      .map((t) => t.id)
      .sort(),
  );
const competing = (): { a: Row[]; b: Row[] } => ({
  a: [{ amount: '-100', bank: 'B-100', receipt: 'R-100' }],
  b: [
    { amount: '-40', bank: 'B-100', receipt: 'R-100' },
    { amount: '-60', bank: 'B-100' },
    { amount: '-60', receipt: 'R-100' },
  ],
});
test('P2 overlapping bank and receipt alternatives are reviewed before any row is consumed', () => {
  const { a, b } = competing();
  for (const order of [b, [...b].reverse()]) {
    const r = run(a, order);
    assert.equal(auto(r).length, 0);
    assert.equal(r.cases.length, 1);
    assert.equal(
      r.cases[0].matchingRule,
      'PAYMENT_IDENTITY_COMPONENT_REVIEW_V1',
    );
    assert.match(r.cases[0].evidence.join(' '), /B-100/);
    assert.match(r.cases[0].evidence.join(' '), /R-100/);
    conserved(r);
  }
});
test('P2 complete N:M payment groups are equivalent groups, never individual pairings', () => {
  const r = run(
    [
      { amount: '-40', bank: 'BANK-771' },
      { amount: '-60', bank: 'BANK-771' },
    ],
    [
      { amount: '-25', bank: 'BANK-771' },
      { amount: '-75', bank: 'BANK-771' },
    ],
  );
  assert.equal(auto(r).length, 1);
  assert.equal(r.cases[0].classification, 'EXACT_MANY_TO_MANY');
  assert.equal(r.cases[0].variance, 0);
  assert.equal(r.caseCounts.matchedSourceRows, 4);
  assert.match(r.cases[0].evidence.join(' '), /لا تثبت مقابلة كل صف/);
  conserved(r);
});
test('P2 invoice certified subgroups coexist with exact sibling pairs without amount-driven subsets', () => {
  const inv = (amount: string, chosen: string): Row => ({
    amount,
    chosen,
    reference: 'INV-7441',
    type: 'Invoice',
    po: 'PO-4491',
  });
  const r = run(
    [inv('1000', 'A'), inv('500', 'B')],
    [inv('500', 'B'), inv('400', 'A'), inv('600', 'A'), inv('500', 'C')],
  );
  assert.equal(auto(r).length, 2);
  const group = r.cases.find((c) => c.classification === 'EXACT_1_TO_MANY')!;
  assert.ok(group);
  assert.deepEqual(
    group.ledgerMembers.map((t) => t.amount).sort(),
    [40000, 60000],
  );
  assert.equal(r.ledgerOnly[0].chosenReference, 'C');
  conserved(r);
});

test('P2 unbalanced, unsafe and manually consumed competitors never disappear from identity membership', () => {
  for (const change of [
    'unbalanced',
    'unsafe',
    'date',
    'manual',
    'rejected',
  ] as const) {
    const { a, b } = competing();
    if (change === 'unbalanced') b[2].amount = '-91';
    if (change === 'unsafe') b[2].reference = '=1+1';
    if (change === 'date') b[2].date = '2026-07-25';
    if (change === 'manual') {
      a[0].amount = '-40';
    }
    const pair = source(a, b);
    const s = pair[0].transactions[0].id,
      l = pair[1].transactions[0].id;
    const r = compare(
      ...pair,
      scope,
      change === 'manual'
        ? [{ supplierId: s, ledgerId: l, note: 'Verified manually' }]
        : [],
      change === 'rejected' ? [`${s}|${l}`] : [],
    );
    assert.equal(auto(r).length, 0, change);
    assert.equal(r.caseCounts.manualMatches, change === 'manual' ? 1 : 0);
    conserved(r);
  }
});

test('P2 a primary-only unknown member and normalized collisions cannot be dropped from bank groups', () => {
  const a: Row[] = [{ amount: '-100', bank: 'BANK-091' }];
  const parts: Row[] = [
    { amount: '-40', bank: 'BANK-091' },
    { amount: '-60', bank: 'BANK-091' },
  ];
  for (const unknown of [
    { amount: '-10', reference: 'BANK-091' },
    { amount: '-10', reference: 'BANK-091', type: 'Unknown' },
    { amount: '-10', bank: 'BANK091' },
  ]) {
    const r = run(a, [...parts, unknown]);
    assert.equal(auto(r).length, 0);
    conserved(r);
  }
});

test('P2 an exact payment pair cannot consume a member before overlapping receipts are examined', () => {
  const r = run(
    [{ amount: '-100', bank: 'BANK-092', receipt: 'RCPT-092' }],
    [
      { amount: '-100', bank: 'BANK-092', receipt: 'RCPT-092' },
      { amount: '-17', receipt: 'RCPT-092' },
    ],
  );
  assert.equal(auto(r).length, 0);
  assert.equal(r.cases.length, 1);
  conserved(r);
});

test('P2 identical bank and receipt memberships corroborate one group, while one-sided annotations need no guessing', () => {
  for (const partial of [false, true]) {
    const a: Row[] = [
      { amount: '-40', bank: 'BANK-093', receipt: 'RCPT-093' },
      { amount: '-60', bank: 'BANK-093', receipt: partial ? '' : 'RCPT-093' },
    ];
    const b: Row[] = [
      { amount: '-25', bank: 'BANK-093', receipt: partial ? '' : 'RCPT-093' },
      { amount: '-75', bank: 'BANK-093', receipt: partial ? '' : 'RCPT-093' },
    ];
    const r = run(a, b);
    assert.equal(auto(r).length, 1, String(partial));
    conserved(r);
  }
});

test('P2 N:M rejects duplicates on either side, sign offsets, wrong dates and incomplete or conflicting evidence', () => {
  const baseA: Row[] = [
    { amount: '-40', bank: 'BANK-094' },
    { amount: '-60', bank: 'BANK-094' },
  ];
  const baseB: Row[] = [
    { amount: '-25', bank: 'BANK-094' },
    { amount: '-75', bank: 'BANK-094' },
  ];
  for (const change of [
    'duplicate-a',
    'duplicate-b',
    'sign',
    'date',
    'unknown',
    'unsafe',
    'no-role',
    'incomplete',
    'excluded',
    'secondary-conflict',
    'po-conflict',
  ]) {
    const a = structuredClone(baseA),
      b = structuredClone(baseB);
    if (change === 'duplicate-a') a.forEach((t) => (t.amount = '-50'));
    if (change === 'duplicate-b') b.forEach((t) => (t.amount = '-50'));
    if (change === 'sign') {
      b[0].amount = '25';
      b[1].amount = '-125';
    }
    if (change === 'date') b[1].date = '2026-07-18';
    if (change === 'unknown') b[1].type = 'Unknown';
    if (change === 'unsafe') b[1].reference = '#REF!';
    if (change === 'secondary-conflict') {
      a[1].receipt = 'R-0941';
      b[1].receipt = 'R-0942';
    }
    if (change === 'po-conflict') {
      a[1].po = 'PO-0941';
      b[1].po = 'PO-0942';
    }
    const pair = source(a, b);
    if (change === 'no-role')
      pair[1].transactions[0].paymentIdentityFields = [];
    if (change === 'incomplete')
      pair[1].errors.push({ row: 4, message: 'Unread source row' });
    if (change === 'excluded')
      pair[1].excluded.push({
        row: 4,
        reason: 'Excluded',
        values: ['BANK-094'],
      });
    const r = compare(...pair, scope);
    assert.equal(auto(r).length, 0, change);
    conserved(r);
  }
});

test('P2 N:M group limit retains every row and never approves a truncated group', () => {
  const a: Row[] = [
    { amount: '-5000', bank: 'BANK-095' },
    { amount: '-151', bank: 'BANK-095' },
  ];
  const b: Row[] = Array.from({ length: 101 }, (_, i) => ({
    amount: String(-(i + 1)),
    bank: 'BANK-095',
  }));
  const r = run(a, b);
  assert.equal(auto(r).length, 0);
  assert.match(r.cases[0].evidence.join(' '), /حد الاعتماد الآلي/);
  conserved(r);
});

test('P2 unknown document discriminators block invoice subgroups and do not fabricate uniqueness after manual use', () => {
  const inv = (amount: string, chosen: string): Row => ({
    amount,
    chosen,
    reference: 'INV-0961',
    type: 'Invoice',
    po: 'PO-0961',
  });
  for (const unknown of ['', 'N/A', '=1+1']) {
    const r = run(
      [inv('100', 'A'), inv('10', unknown)],
      [inv('40', 'A'), inv('60', 'A'), inv('10', unknown)],
    );
    assert.equal(auto(r).length, 0);
    conserved(r);
  }
});

test('P2 an unknown-type original bank member prevents a smaller exact payment pair', () => {
  const r = run(
    [
      { amount: '-100', bank: 'BANK-097' },
      {
        amount: '-10',
        bank: 'BANK-097',
        reference: 'DOC-UNKNOWN-A',
        type: 'Unknown',
      },
    ],
    [
      { amount: '-100', bank: 'BANK-097' },
      {
        amount: '-10',
        bank: 'BANK-097',
        reference: 'DOC-UNKNOWN-B',
        type: 'Unknown',
      },
    ],
  );
  assert.equal(auto(r).length, 0);
  conserved(r);
});

test('P2 invalid calendar dates and direct same-source comparisons cannot become approved groups', () => {
  const a: Row[] = [
    { amount: '-40', bank: 'BANK-098' },
    { amount: '-60', bank: 'BANK-098' },
  ];
  const b: Row[] = [
    { amount: '-25', bank: 'BANK-098' },
    { amount: '-75', bank: 'BANK-098' },
  ];
  for (const date of ['2026-02-31', 'not-a-date']) {
    const pair = source(a, b);
    [...pair[0].transactions, ...pair[1].transactions].forEach((t) => {
      t.date = date;
    });
    const r = compare(...pair, scope);
    assert.equal(auto(r).length, 0);
    conserved(r);
  }
  const pair = source(a, b);
  pair[1].sourceOrigin = pair[0].sourceOrigin;
  const r = compare(...pair, scope);
  assert.equal(auto(r).length, 0);
  assert.equal(r.cases[0].status, 'Needs Review');
  assert.equal(r.cases[0].reviewRequired, true);
});
