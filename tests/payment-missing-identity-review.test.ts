// SUP-2: parts of one payment without the payment's bank identity. The single
// row's explicit bank reference is its matching identity, the parts carry
// only the general payment reference, so the two fall into different
// reference groups. The contract (EVAL-1 G01, G02 and G08, missing-identity)
// is a review candidate holding the whole group, with the reason that one
// payment identity is not proven; never an approval, and never a subset.
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

const RULE = 'PAYMENT_GENERAL_REFERENCE_GROUP_REVIEW_V1';
const MISSING = /لم تثبت هوية دفعة واحدة/;
const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-S2',
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
  date?: string;
};
const headers = [
  'Date',
  'Document No',
  'Amount',
  'Document Type',
  'Bank Reference',
  'Receipt No',
  'Description',
];
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  description: 6,
};
const file = (name: string, rows: Row[]): SourceFile => ({
  name,
  sheets: [
    {
      name: 'Data',
      formulaRows: [],
      hiddenRows: [],
      rows: [
        headers,
        ...rows.map((r) => [
          r.date ?? '2026-07-15',
          r.ref ?? 'PAY-S2-01',
          r.amount,
          r.type ?? 'Payment',
          r.bank ?? '',
          r.receipt ?? '',
          'Bank transfer',
        ]),
      ],
    },
  ],
});
const files = (a: Row[], b: Row[]) =>
  [file('supplier-s2.csv', a), file('ledger-s2.csv', b)] as const;
const run = (a: Row[], b: Row[]) => {
  const [fa, fb] = files(a, b);
  return compare(
    normalizeSource(fa, mapping, scope, 'supplier'),
    normalizeSource(fb, mapping, scope, 'ledger'),
    scope,
  );
};
const single: Row[] = [{ amount: '-100', bank: 'BANK-S2-77' }];
const parts: Row[] = [{ amount: '-40' }, { amount: '-25' }, { amount: '-35' }];
function conserved(result: ReturnType<typeof compare>, count: number) {
  const ids = result.cases.flatMap((c) =>
    c.sourceTrace.map((r) => r.sourceRowId),
  );
  assert.equal(ids.length, count);
  assert.equal(new Set(ids).size, count);
}
const candidates = (r: ReturnType<typeof compare>) =>
  r.cases.filter((c) => c.matchingRule === RULE);

void test('S2 the parts of one payment without its bank identity are one review candidate, either direction', () => {
  for (const reverse of [false, true]) {
    const r = reverse ? run(parts, single) : run(single, parts);
    assert.equal(r.matches.length, 0, 'never approved');
    const found = candidates(r);
    assert.equal(found.length, 1, `reverse=${reverse}`);
    const c = found[0];
    assert.equal(c.status, 'Needs Review');
    assert.equal(c.classification, 'AMBIGUOUS_CANDIDATE');
    assert.equal(c.supplierMembers.length, reverse ? 3 : 1);
    assert.equal(c.ledgerMembers.length, reverse ? 1 : 3);
    assert.equal(c.supplierTotal, -10000);
    assert.equal(c.ledgerTotal, -10000);
    assert.equal(c.bridgeEffect, 0);
    assert.ok(c.evidence.some((e) => MISSING.test(e)));
    assert.ok(c.evidence.some((e) => e.includes('BANK-S2-77')));
    assert.equal(r.caseCounts.autoMatchedCases, 0);
    conserved(r, 4);
  }
});

void test('S2 parts on two days within the window are the same candidate', () => {
  const twoDays = parts.map((p, i) => (i === 2 ? { ...p, date: '2026-07-16' } : p));
  const r = run(single, twoDays);
  assert.equal(r.matches.length, 0);
  assert.equal(candidates(r).length, 1);
  conserved(r, 4);
});

void test('S2 no candidate when the evidence does not hold the whole group', () => {
  const near: [string, Row[], Row[]][] = [
    ['totals differ by one halala', single, [...parts.slice(0, 2), { amount: '-34.99' }]],
    ['a part is an invoice', single, [...parts.slice(0, 2), { amount: '-35', type: 'Invoice' }]],
    ['a part outside the date window', single, [...parts.slice(0, 2), { amount: '-35', date: '2026-07-19' }]],
    ['a part carries another bank reference', single, [...parts.slice(0, 2), { amount: '-35', bank: 'BANK-OTHER-1' }]],
    ['a part carries an explicit receipt number', single, [...parts.slice(0, 2), { amount: '-35', receipt: 'RCPT-S2-1' }]],
    ['a part has the opposite sign', single, [...parts.slice(0, 2), { amount: '35' }]],
    ['parts under different references', single, parts.map((p, i) => ({ ...p, ref: `PAY-S2-X${i}` }))],
    ['one counterpart only', single, [{ amount: '-100' }]],
    ['another row on the single side under the general reference', [...single, { amount: '-5' }], parts],
    ['a competing payment of the whole amount', single, [...parts, { amount: '-100', ref: 'PAY-S2-99' }]],
    ['an invoice holding the payment identity', single, [...parts, { amount: '-5', ref: 'INV-S2-5', type: 'Invoice', bank: 'BANK-S2-77' }]],
    ['parts all later than the window', single, parts.map((p) => ({ ...p, date: '2026-07-18' }))],
    ['equal totals with a part of the opposite sign', single, [{ amount: '-60' }, { amount: '-50' }, { amount: '10' }]],
    ['parts spread wider than the window', single, [{ amount: '-40', date: '2026-07-13' }, { amount: '-25' }, { amount: '-35', date: '2026-07-17' }]],
  ];
  for (const [why, a, b] of near) {
    const r = run(a, b);
    assert.equal(r.matches.length, 0, why);
    assert.equal(candidates(r).length, 0, why);
    conserved(r, a.length + b.length);
  }
});

void test('S2 an unreadable row under the same reference is a possible part: no candidate', () => {
  const r = run(single, [...parts, { amount: 'n/a' }]);
  assert.equal(r.matches.length, 0);
  assert.equal(candidates(r).length, 0);
  conserved(r, 4);
});

void test('S2 the candidate keeps its members through save, restore and export', async () => {
  // Export re-reads the original bytes, so the sources are read from CSV.
  const bytes = (f: SourceFile) =>
    new TextEncoder().encode(
      f.sheets[0].rows
        .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
        .join('\r\n'),
    ).buffer;
  const [fa, fb] = await Promise.all(
    files(single, parts).map((f) => readFile(f.name, bytes(f))),
  );
  const session = await saveSession({
    files: [fa, fb],
    mappings: [mapping, mapping],
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  });
  const restored = (await restoreSession(session)).result;
  const c = candidates(restored);
  assert.equal(c.length, 1);
  assert.deepEqual(
    c[0].sourceTrace.map((t) => [t.side, t.row]),
    [
      ['supplier', 2],
      ['ledger', 2],
      ['ledger', 3],
      ['ledger', 4],
    ],
  );
  const book = await exportWorkbook(restored, [fa, fb], {
    checked: false,
    name: '',
    notes: '',
  });
  assert.ok(book.byteLength > 0);
});
