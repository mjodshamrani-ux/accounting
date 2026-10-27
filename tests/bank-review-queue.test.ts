import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupActions,
  groupDecisions,
  reviewQueue,
} from '../lib/reconciliation/bank-review-queue.ts';
import type { BankStatementResult } from '../lib/reconciliation/bank-statement-lifecycle.ts';

// A settled period with only what the queue reads: the movements and
// entries with their dates, directions and amounts, and the cases. A
// movement's value date is its date unless given.
type Member = [
  id: string,
  direction: 'in' | 'out',
  amount: number,
  date?: string,
  valueDate?: string,
];
type Case = {
  reason: string;
  statement: string[];
  cashbook: string[];
  kind?: 'automatic' | 'review' | 'carried';
  status?: string;
};
function period(
  statement: Member[],
  cashbook: Member[],
  cases: Case[],
  status = 'needs-review',
) {
  return {
    status,
    context: '["synthetic"]',
    match: {
      movements: statement.map(
        ([id, direction, amount, date = '2026-11-10', valueDate = date]) => ({
          id,
          date,
          valueDate,
          direction,
          amount,
        }),
      ),
      cashbook: cashbook.map(
        ([id, direction, amount, date = '2026-11-10']) => ({
          id,
          date,
          direction,
          amount,
        }),
      ),
    },
    cases: cases.map((c, i) => ({
      id: `C${i + 1}`,
      kind: 'review',
      status: 'needs-review',
      reference: '',
      decision: c.status && c.status !== 'needs-review' ? `D${i}` : null,
      ...c,
    })),
    decisions: [],
  } as unknown as BankStatementResult;
}
const order = (r: BankStatementResult) =>
  reviewQueue(r).map((g) => [
    g.reason,
    g.direction,
    g.cases.map((c) => c.case),
  ]);

void test('exceptions come before suggestions whatever their amounts', () => {
  const r = period(
    [
      ['S1', 'out', 98_500_00],
      ['S2', 'out', 12_10],
    ],
    [
      ['V1', 'out', 98_500_00, '2026-11-09'],
      ['V2', 'out', 12_00],
    ],
    [
      { reason: 'amount-date-suggestion', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'amount-difference', statement: ['S2'], cashbook: ['V2'] },
    ],
  );
  assert.deepEqual(order(r), [
    ['amount-difference', 'out', ['C2']],
    ['amount-date-suggestion', 'out', ['C1']],
  ]);
  const [exception, suggestion] = reviewQueue(r);
  assert.equal(exception.class, 'exception');
  assert.equal(suggestion.class, 'suggestion');
});

void test("a case's impact is the larger side, not the sum, and a group's its largest case", () => {
  const r = period(
    [
      ['S1', 'in', 600_00],
      ['S2', 'in', 300_00],
    ],
    [
      ['V1', 'in', 500_00],
      ['V2', 'in', 450_00],
    ],
    [
      { reason: 'amount-difference', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'amount-difference', statement: ['S2'], cashbook: ['V2'] },
    ],
  );
  const [g] = reviewQueue(r);
  assert.deepEqual(
    g.cases.map((c) => [c.case, c.impact]),
    [
      ['C1', 600_00],
      ['C2', 450_00],
    ],
  );
  assert.equal(g.impact, 600_00);
  assert.equal(g.members, 4);
});

void test('within a group, larger impact first, then case number', () => {
  const r = period(
    [
      ['S1', 'out', 100_00],
      ['S2', 'out', 900_00],
      ['S3', 'out', 100_00],
    ],
    [
      ['V1', 'out', 100_00],
      ['V2', 'out', 900_00],
      ['V3', 'out', 100_00],
    ],
    ['1', '2', '3'].map((n) => ({
      reason: 'amount-date-suggestion',
      statement: [`S${n}`],
      cashbook: [`V${n}`],
    })),
  );
  assert.deepEqual(order(r), [
    ['amount-date-suggestion', 'out', ['C2', 'C1', 'C3']],
  ]);
});

void test('cases of another direction, shape or date gap are another group', () => {
  const r = period(
    [
      ['S1', 'in', 100_00, '2026-11-15'],
      ['S2', 'out', 100_00, '2026-11-15'],
      ['S3', 'out', 100_00, '2026-11-19'],
      ['S4', 'out', 100_00, '2026-11-15'],
      ['S5', 'out', 50_00],
      ['S6', 'out', 50_00],
      ['S7', 'in', 70_00],
    ],
    [
      ['V1', 'in', 100_00, '2026-11-10'],
      ['V2', 'out', 100_00, '2026-11-10'],
      ['V3', 'out', 100_00, '2026-11-10'],
      ['V4', 'out', 100_00, '2026-11-10'],
      ['V5', 'out', 100_00],
      ['V7', 'out', 70_00],
    ],
    [
      { reason: 'date-gap', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'date-gap', statement: ['S2'], cashbook: ['V2'] },
      { reason: 'date-gap', statement: ['S3'], cashbook: ['V3'] },
      { reason: 'date-gap', statement: ['S4'], cashbook: ['V4'] },
      {
        reason: 'duplicate-reference',
        statement: ['S5', 'S6'],
        cashbook: ['V5'],
      },
      { reason: 'direction-conflict', statement: ['S7'], cashbook: ['V7'] },
    ],
  );
  const queue = reviewQueue(r);
  assert.deepEqual(
    queue.map((g) => [g.signature, g.cases.map((c) => c.case)]),
    [
      ['duplicate-reference|out|2:1|', ['C5']],
      ['direction-conflict|in+out|1:1|', ['C6']],
      ['date-gap|out|1:1|5', ['C2', 'C4']],
      ['date-gap|in|1:1|5', ['C1']],
      ['date-gap|out|1:1|9', ['C3']],
    ],
  );
  assert.equal(queue[2].gap, 5);
  assert.equal(queue[0].gap, undefined);
});

void test('equal impact: more members first, then the reason order', () => {
  const r = period(
    [
      ['S1', 'in', 2_500_00],
      ['S2', 'out', 2_500_00],
      ['S3', 'out', 1_000_00],
      ['S4', 'out', 1_000_00],
    ],
    [
      ['V1', 'in', 2_500_00],
      ['V2', 'out', 2_500_00],
      ['V3', 'out', 1_000_00],
      ['V4', 'out', 1_000_00],
    ],
    [
      { reason: 'amount-date-suggestion', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'amount-date-suggestion', statement: ['S2'], cashbook: ['V2'] },
      { reason: 'amount-date-suggestion', statement: ['S3'], cashbook: ['V3'] },
      { reason: 'amount-date-suggestion', statement: ['S4'], cashbook: ['V4'] },
    ],
  );
  assert.deepEqual(
    order(r).map(([, d]) => d),
    ['out', 'in'],
  );
  const tie = period(
    [
      ['S1', 'out', 500_00, '2026-11-15'],
      ['S2', 'out', 500_00],
    ],
    [
      ['V1', 'out', 500_00, '2026-11-10'],
      ['V2', 'out', 500_00],
    ],
    [
      { reason: 'amount-date-suggestion', statement: ['S2'], cashbook: ['V2'] },
      { reason: 'date-gap', statement: ['S1'], cashbook: ['V1'] },
    ],
  );
  assert.deepEqual(
    order(tie).map(([reason]) => reason),
    ['date-gap', 'amount-date-suggestion'],
  );
});

void test('decided, automatic and carried cases are not in the queue; a held statement has none', () => {
  const members: Member[] = [
    ['S1', 'out', 100_00],
    ['S2', 'out', 100_00],
    ['S3', 'out', 100_00],
    ['S4', 'out', 100_00],
  ];
  const book: Member[] = members.map(([id, d, a]) => [
    id.replace('S', 'V'),
    d,
    a,
  ]);
  const cases: Case[] = [
    {
      reason: 'reference',
      statement: ['S1'],
      cashbook: ['V1'],
      kind: 'automatic',
      status: 'matched-automatic',
    },
    {
      reason: 'amount-date-suggestion',
      statement: ['S2'],
      cashbook: ['V2'],
      status: 'matched-accepted',
    },
    {
      reason: 'amount-date-suggestion',
      statement: ['S3'],
      cashbook: ['V3'],
      status: 'rejected',
    },
    {
      reason: 'carried-reference',
      statement: ['S4'],
      cashbook: [],
      kind: 'carried',
    },
  ];
  assert.deepEqual(reviewQueue(period(members, book, cases)), []);
  const open: Case[] = [
    { reason: 'amount-date-suggestion', statement: ['S2'], cashbook: ['V2'] },
  ];
  assert.equal(reviewQueue(period(members, book, open)).length, 1);
  assert.deepEqual(reviewQueue(period(members, book, open, 'held')), []);
});

void test('a group decision is offered for two or more cases; accept only for suggestions', () => {
  const r = period(
    [
      ['S1', 'out', 100_00],
      ['S2', 'out', 100_00],
      ['S3', 'out', 300_00],
      ['S4', 'out', 300_00],
      ['S5', 'in', 50_00],
    ],
    [
      ['V1', 'out', 100_00],
      ['V2', 'out', 100_00],
      ['V3', 'out', 310_00],
      ['V4', 'out', 290_00],
      ['V5', 'in', 50_00],
    ],
    [
      { reason: 'amount-date-suggestion', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'amount-date-suggestion', statement: ['S2'], cashbook: ['V2'] },
      { reason: 'amount-difference', statement: ['S3'], cashbook: ['V3'] },
      { reason: 'amount-difference', statement: ['S4'], cashbook: ['V4'] },
      { reason: 'amount-date-suggestion', statement: ['S5'], cashbook: ['V5'] },
    ],
  );
  const offers = Object.fromEntries(
    reviewQueue(r).map((g) => [g.signature, g.offers]),
  );
  assert.deepEqual(offers, {
    'amount-difference|out|1:1|': { accept: false, reject: true },
    'amount-date-suggestion|out|1:1|': { accept: true, reject: true },
    'amount-date-suggestion|in|1:1|': { accept: false, reject: false },
  });
  const [, suggestions] = reviewQueue(r);
  assert.deepEqual(groupActions(suggestions, '  '), {
    accept: false,
    reject: false,
  });
  assert.deepEqual(groupActions(suggestions, 'bank advice'), {
    accept: true,
    reject: true,
  });
});

void test('a group decision is one ordinary decision per case, in group order, and nothing else', () => {
  const r = period(
    [
      ['S1', 'out', 100_00],
      ['S2', 'out', 700_00],
      ['S3', 'out', 300_00],
    ],
    [
      ['V1', 'out', 100_00],
      ['V2', 'out', 700_00],
      ['V3', 'out', 300_00],
    ],
    ['1', '2', '3'].map((n) => ({
      reason: 'amount-date-suggestion',
      statement: [`S${n}`],
      cashbook: [`V${n}`],
    })),
  );
  const at = '2026-12-01T09:00:00.000Z';
  const got = groupDecisions(
    r,
    'amount-date-suggestion|out|1:1|',
    'accept',
    ' bank advice ',
    (i) => `G${i}`,
    at,
  );
  assert.deepEqual(got, [
    {
      id: 'G0',
      type: 'accept',
      context: r.context,
      at,
      case: 'C2',
      statement: ['S2'],
      cashbook: ['V2'],
      note: 'bank advice',
    },
    {
      id: 'G1',
      type: 'accept',
      context: r.context,
      at,
      case: 'C3',
      statement: ['S3'],
      cashbook: ['V3'],
      note: 'bank advice',
    },
    {
      id: 'G2',
      type: 'accept',
      context: r.context,
      at,
      case: 'C1',
      statement: ['S1'],
      cashbook: ['V1'],
      note: 'bank advice',
    },
  ]);
  assert.equal(
    groupDecisions(
      r,
      'amount-date-suggestion|out|1:1|',
      'accept',
      '',
      String,
      at,
    ),
    null,
  );
  assert.equal(
    groupDecisions(
      r,
      'amount-date-suggestion|in|1:1|',
      'reject',
      'x',
      String,
      at,
    ),
    null,
  );
});

void test('a later group decision covers only the cases still needing one', () => {
  const r = period(
    [
      ['S1', 'out', 100_00],
      ['S2', 'out', 200_00],
      ['S3', 'out', 300_00],
    ],
    [
      ['V1', 'out', 100_00],
      ['V2', 'out', 200_00],
      ['V3', 'out', 300_00],
    ],
    [
      { reason: 'amount-date-suggestion', statement: ['S1'], cashbook: ['V1'] },
      {
        reason: 'amount-date-suggestion',
        statement: ['S2'],
        cashbook: ['V2'],
        status: 'matched-accepted',
      },
      { reason: 'amount-date-suggestion', statement: ['S3'], cashbook: ['V3'] },
    ],
  );
  const got = groupDecisions(
    r,
    'amount-date-suggestion|out|1:1|',
    'reject',
    'x',
    String,
    'now',
  );
  assert.deepEqual(
    got?.map((d) => d.case),
    ['C3', 'C1'],
  );
});

void test('a date gap is counted from the movement date, as the matcher counts it, not its value date', () => {
  const r = period(
    [
      ['S1', 'out', 100_00, '2026-11-15', '2026-11-12'],
      ['S2', 'out', 100_00, '2026-11-15', '2026-11-15'],
    ],
    [
      ['V1', 'out', 100_00, '2026-11-10'],
      ['V2', 'out', 100_00, '2026-11-10'],
    ],
    [
      { reason: 'date-gap', statement: ['S1'], cashbook: ['V1'] },
      { reason: 'date-gap', statement: ['S2'], cashbook: ['V2'] },
    ],
  );
  assert.deepEqual(
    reviewQueue(r).map((g) => [g.gap, g.cases.map((c) => c.case)]),
    [[5, ['C1', 'C2']]],
  );
});
