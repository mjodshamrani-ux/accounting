import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocationStrip,
  arStrip,
  assetStrip,
  bankStrip,
  clearingStrip,
  financialStrip,
  gatewayStrip,
  glTbStrip,
  intercompanyStrip,
  mostFrequent,
  payrollStrip,
  stockStrip,
  supplierStrip,
  type AlignmentStrip,
} from '../lib/alignment-strip.ts';

// The alignment strip (UX-4) says only what the engine wrote: each amount is
// an engine field with its own sign, each count counts items by a status the
// engine wrote. The values below are synthetic and chosen so that a sum, a
// difference worked out here, a flipped sign or a dropped item would show.

type Input<F extends (r: never) => AlignmentStrip> = Parameters<F>[0];
const as = <F extends (r: never) => AlignmentStrip>(_: F, v: unknown) =>
  v as Input<F>;

void test('the most frequent reason, ties to the first in order', () => {
  assert.equal(mostFrequent([]), null);
  assert.equal(mostFrequent(['b', 'a', 'a', 'b']), 'b');
  assert.equal(mostFrequent(['a', 'b', 'b']), 'b');
  assert.equal(mostFrequent(['x']), 'x');
});

void test('supplier: case counts and the closing difference as the engine wrote them; no main reason yet', () => {
  const cases = [
    { status: 'Needs Review', classification: 'AMOUNT_VARIANCE' },
    { status: 'Needs Review', classification: 'AMBIGUOUS_CANDIDATE' },
    { status: 'Needs Review', classification: 'AMBIGUOUS_CANDIDATE' },
    { status: 'Matched', classification: 'EXACT_1_TO_1' },
  ];
  const caseCounts = {
    autoMatchedCases: 5,
    manualMatches: 2,
    needsReviewCases: 3,
    unmatchedCases: 4,
  };
  const strip = supplierStrip(
    as(supplierStrip, {
      cases,
      caseCounts,
      bridge: { delta: -12345, residual: 70 },
    }),
  );
  assert.deepEqual(strip.agreed, { count: 7, of: null, unit: 'case' });
  assert.deepEqual(strip.review, {
    kind: 'count',
    count: 3,
    reason: null,
    alone: 4,
  });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 1,
    items: [{ name: 'closing', between: 'supplier-ledger', minor: -12345 }],
  });
  assert.deepEqual(
    supplierStrip(as(supplierStrip, { cases, caseCounts, bridge: null })).gap,
    { kind: 'not-computed' },
  );
});

void test('receivables: totals as read, and no gap the engine does not compute', () => {
  const strip = arStrip(
    as(arStrip, {
      totals: [1240000, null],
      cases: [
        { status: 'matched', reason: 'exact-own-document' },
        { status: 'review', reason: 'missing-counterpart' },
        { status: 'review', reason: 'amount-difference' },
        { status: 'review', reason: 'missing-counterpart' },
      ],
    }),
  );
  assert.deepEqual(strip.totals, [1240000, null]);
  assert.deepEqual(strip.agreed, { count: 1, of: null, unit: 'document' });
  assert.deepEqual(strip.review, {
    kind: 'count',
    count: 3,
    reason: 'missing-counterpart',
  });
  assert.deepEqual(strip.gap, { kind: 'not-computed' });
});

void test('bank movements: matched by identity or by a person; a source error waits too', () => {
  const strip = bankStrip(
    as(bankStrip, {
      cases: [
        { status: 'matched-evidence', reason: 'explicit-identity' },
        { status: 'matched-manual', reason: 'human-review' },
        { status: 'needs-review', reason: 'missing-counterpart' },
        { status: 'source-error', reason: 'source-error' },
        { status: 'needs-review', reason: 'missing-counterpart' },
      ],
    }),
  );
  assert.deepEqual(strip.agreed, { count: 2, of: null, unit: 'case' });
  assert.deepEqual(strip.review, {
    kind: 'count',
    count: 3,
    reason: 'missing-counterpart',
  });
  assert.deepEqual(strip.gap, { kind: 'not-computed' });
});

void test('clearing: one record, its net as the engine wrote it, zero included', () => {
  const cases = [
    { status: 'cleared', reason: 'reference-zero' },
    { status: 'review', reason: 'residual' },
  ];
  const debit = clearingStrip(as(clearingStrip, { cases, total: 42050 }));
  assert.deepEqual(debit.gap, {
    kind: 'figures',
    compared: 1,
    items: [{ name: 'account-net', between: 'clearing-net', minor: 42050 }],
  });
  assert.deepEqual(clearingStrip(as(clearingStrip, { cases, total: -1 })).gap, {
    kind: 'figures',
    compared: 1,
    items: [{ name: 'account-net', between: 'clearing-net', minor: -1 }],
  });
  assert.deepEqual(clearingStrip(as(clearingStrip, { cases, total: 0 })).gap, {
    kind: 'figures',
    compared: 1,
    items: [],
  });
  assert.deepEqual(debit.agreed, { count: 1, of: null, unit: 'group' });
  assert.deepEqual(debit.review, {
    kind: 'count',
    count: 1,
    reason: 'residual',
  });
});

void test('allocation: links are decisions, its status is said, no gap computed', () => {
  const strip = allocationStrip(
    as(allocationStrip, { links: [{}, {}, {}], status: 'ready' }),
  );
  assert.deepEqual(strip.agreed, { count: 3, of: null, unit: 'link' });
  assert.deepEqual(strip.review, { kind: 'state', status: 'ready' });
  assert.deepEqual(strip.gap, { kind: 'not-computed' });
});

void test('ledger and trial balance: each field as the engine wrote it; none when not computed', () => {
  const differences = {
    openingDebit: 0,
    openingCredit: 0,
    periodDebit: 2500,
    periodCredit: 0,
    closingDebit: -2500,
    closingCredit: 0,
  };
  const strip = glTbStrip(as(glTbStrip, { differences, status: 'difference' }));
  assert.deepEqual(strip.agreed, { count: 4, of: 6, unit: 'field' });
  assert.deepEqual(strip.review, { kind: 'state', status: 'difference' });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 6,
    items: [
      { name: 'periodDebit', between: 'ledger-tb', minor: 2500 },
      { name: 'closingDebit', between: 'ledger-tb', minor: -2500 },
    ],
  });
  const missing = glTbStrip(
    as(glTbStrip, { differences: null, status: 'missing' }),
  );
  assert.deepEqual(missing.gap, { kind: 'blocked', status: 'missing' });
  assert.deepEqual(missing.agreed, { count: 0, of: null, unit: 'field' });
});

void test('intercompany: pairs ready by the engine, pairs waiting for a person, no total gap', () => {
  const strip = intercompanyStrip(
    as(intercompanyStrip, {
      status: 'needs-review',
      pairs: [
        { status: 'ready', review: 'needs-review' },
        { status: 'ready', review: 'accepted' },
        { status: 'difference', review: 'needs-review' },
        { status: 'missing', review: 'rejected' },
      ],
    }),
  );
  assert.deepEqual(strip.agreed, { count: 2, of: 4, unit: 'pair' });
  assert.deepEqual(strip.review, {
    kind: 'count',
    count: 2,
    reason: 'ready',
  });
  assert.deepEqual(strip.gap, { kind: 'not-computed' });
});

void test('inventory: each account difference as written, totals as given', () => {
  const strip = stockStrip(
    as(stockStrip, {
      review: 'needs-review',
      status: 'difference',
      totals: { registerMinor: 500000, glMinor: 499000 },
      comparisons: [
        { account: '1400', dimensions: '', differenceMinor: 0 },
        { account: '1410', dimensions: 'WH-2', differenceMinor: 1000 },
      ],
    }),
  );
  assert.deepEqual(strip.totals, [500000, 499000]);
  assert.deepEqual(strip.agreed, { count: 1, of: 2, unit: 'account' });
  assert.deepEqual(strip.review, { kind: 'whole', review: 'needs-review' });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 2,
    items: [{ name: '1410 · WH-2', between: 'register-gl', minor: 1000 }],
  });
  assert.deepEqual(
    stockStrip(
      as(stockStrip, {
        review: 'needs-review',
        status: 'source-error',
        totals: null,
        comparisons: [
          { account: '1400', dimensions: '', differenceMinor: null },
        ],
      }),
    ).gap,
    { kind: 'blocked', status: 'source-error' },
  );
  // An account the engine could not bound has no difference; the others
  // still have theirs, and only those count as compared.
  assert.deepEqual(
    stockStrip(
      as(stockStrip, {
        review: 'needs-review',
        status: 'difference',
        totals: null,
        comparisons: [
          { account: '1400', dimensions: '', differenceMinor: null },
          { account: '1410', dimensions: '', differenceMinor: 1000 },
        ],
      }),
    ).gap,
    {
      kind: 'figures',
      compared: 1,
      items: [{ name: '1410', between: 'register-gl', minor: 1000 }],
    },
  );
});

void test('payment gateway: five residuals in the engine order, the last against the bank', () => {
  const strip = gatewayStrip(
    as(gatewayStrip, {
      review: 'needs-review',
      status: 'difference',
      residuals: [0, 0, -300, 0, 300],
    }),
  );
  assert.deepEqual(strip.agreed, { count: 3, of: 5, unit: 'residual' });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 5,
    items: [
      { name: 'fees', between: 'computed-summary', minor: -300 },
      { name: 'payout', between: 'summary-bank', minor: 300 },
    ],
  });
  assert.deepEqual(
    gatewayStrip(
      as(gatewayStrip, {
        review: 'needs-review',
        status: 'missing',
        residuals: null,
      }),
    ).gap,
    { kind: 'blocked', status: 'missing' },
  );
});

void test('payroll: components against the ledger and the net against the bank', () => {
  const strip = payrollStrip(
    as(payrollStrip, {
      review: 'accepted',
      status: 'consistent-with-evidence',
      comparisons: [
        { component: 'gross', difference: 0 },
        { component: 'deductions', difference: 15000 },
      ],
      bankComparison: { difference: -15000 },
    }),
  );
  assert.deepEqual(strip.agreed, { count: 1, of: 3, unit: 'comparison' });
  assert.deepEqual(strip.review, { kind: 'whole', review: 'accepted' });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 3,
    items: [
      { name: 'deductions', between: 'payroll-gl', minor: 15000 },
      { name: 'bank', between: 'payroll-bank', minor: -15000 },
    ],
  });
  assert.deepEqual(
    payrollStrip(
      as(payrollStrip, {
        review: 'needs-review',
        status: 'source-error',
        comparisons: [{ component: 'gross', difference: null }],
        bankComparison: { difference: null },
      }),
    ).gap,
    { kind: 'blocked', status: 'source-error' },
  );
});

void test('fixed assets: each component difference as written', () => {
  const strip = assetStrip(
    as(assetStrip, {
      review: 'needs-review',
      status: 'difference',
      comparisons: [
        { component: 'cost', difference: 0 },
        { component: 'depreciation', difference: -999 },
      ],
    }),
  );
  assert.deepEqual(strip.agreed, { count: 1, of: 2, unit: 'component' });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 2,
    items: [{ name: 'depreciation', between: 'register-gl', minor: -999 }],
  });
});

void test('financial statements: the trial balance residual first, then each line', () => {
  const strip = financialStrip(
    as(financialStrip, {
      status: 'difference',
      tb: { debit: 100, credit: 100, residual: 0 },
      lines: [
        { label: 'Cash', difference: 0, review: 'accepted' },
        { label: 'Payables', difference: 700, review: 'needs-review' },
        { label: 'Equity', difference: null, review: 'blocked' },
      ],
    }),
  );
  assert.deepEqual(strip.agreed, { count: 2, of: 4, unit: 'comparison' });
  assert.deepEqual(strip.review, { kind: 'count', count: 1, reason: null });
  assert.deepEqual(strip.gap, {
    kind: 'figures',
    compared: 3,
    items: [{ name: 'Payables', between: 'calculated-reported', minor: 700 }],
  });
});
