import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  ALLOCATION_ROLES,
  ALLOCATION_VERSION,
  reconcileAllocation,
  type AllocationEvent,
  type AllocationInput,
  type AllocationResult,
} from '../lib/reconciliation/allocation.ts';
import {
  competitorsOf,
  reviewAllocationAdvice,
  twinsOf,
} from '../lib/reconciliation/allocation-advice.ts';
import { replayAllocationAdvice } from '../lib/reconciliation/allocation-advice-io.ts';
import { MAX_ROWS } from '../lib/reconciliation/types.ts';

// A freight forwarder's carrier account in dirhams, unrelated to the ALL-1
// stories.
const META =
  'Synthetic Freight Forwarder LLC,FF-AP,Carrier C07,2110,AED,2027-03-31,before-proposed-allocation';
const HEAD = [
  'Payment ID,Payment date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Invoice ID,Invoice date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Advice line ID,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Payment ID,Invoice ID,Allocation amount',
];
const SCOPE = {
  entity: 'Synthetic Freight Forwarder LLC',
  ledger: 'FF-AP',
  party: 'Carrier C07',
  account: '2110',
  currency: 'AED',
  cutoff: '2027-03-31',
  basis: 'before-proposed-allocation',
  confirmed: true,
};
type Book = {
  pays: [string, string, string?][];
  invs: [string, string, string?][];
  advice: [string, string, string, string][];
};
const csv = (side: number, rows: string[]) =>
  new TextEncoder().encode([HEAD[side], ...rows].join('\n') + '\n');
function texts(b: Book) {
  return [
    b.pays.map(([id, o, a]) => `${id},2027-03-10,${META},${o},${a ?? o}`),
    b.invs.map(([id, o, a]) => `${id},2027-02-20,${META},${o},${a ?? o}`),
    b.advice.map(([id, p, i, m]) => `${id},${META},${p},${i},${m}`),
  ];
}
async function state(b: Book, names = ['pay.csv', 'inv.csv', 'adv.csv']) {
  const rows = texts(b);
  const files = [];
  for (const side of [0, 1, 2])
    files.push(await readFile(names[side], csv(side, rows[side]).buffer));
  return {
    files: files as AllocationInput['files'],
    readings: ALLOCATION_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ALLOCATION_VERSION,
      confirmed: true,
    })) as AllocationInput['readings'],
    scope: { ...SCOPE },
    events: [] as AllocationEvent[],
  };
}
let clock = 0;
function remit(
  r: AllocationResult,
  id: string,
  lines: string[],
): AllocationEvent {
  return {
    id,
    context: r.context,
    at: new Date(Date.UTC(2027, 3, 1, 8, 0, ++clock)).toISOString(),
    note: 'Approved from the advice',
    type: 'allocate',
    links: lines.map((ref) => {
      const p = r.proofs.find((p) => p.reference === ref)!;
      return {
        paymentId: r.items.find(
          (i) => i.side === 0 && i.reference === p.payment,
        )!.id,
        invoiceId: r.items.find(
          (i) => i.side === 1 && i.reference === p.invoice,
        )!.id,
        amount: p.amount,
        basis: {
          kind: 'remittance',
          reference: ref,
          reason: 'Advice',
          proofId: p.id,
        },
      };
    }),
  };
}
function human(
  r: AllocationResult,
  id: string,
  pay: string,
  inv: string,
  amount: number,
): AllocationEvent {
  return {
    id,
    context: r.context,
    at: new Date(Date.UTC(2027, 3, 1, 8, 0, ++clock)).toISOString(),
    note: 'Agreed with the carrier',
    type: 'allocate',
    links: [
      {
        paymentId: r.items.find((i) => i.side === 0 && i.reference === pay)!.id,
        invoiceId: r.items.find((i) => i.side === 1 && i.reference === inv)!.id,
        amount,
        basis: {
          kind: 'accountant-review',
          reference: `CALL-${id}`,
          reason: 'Phone confirmation',
          proofId: '',
        },
      },
    ],
  };
}
async function review(
  b: Book,
  decide?: (r: AllocationResult) => AllocationEvent[],
) {
  const s = await state(b);
  if (decide) s.events = decide(reconcileAllocation(s));
  return reviewAllocationAdvice(reconcileAllocation(s));
}
const brief = (r: ReturnType<typeof reviewAllocationAdvice>) =>
  r.lines.map((l) => [l.reference, l.status, l.reasons]);

void test('advice: lines that fit their payment and invoice together fit, in one, many and crossing', async () => {
  const r = await review({
    pays: [
      ['PAY-1', '900.00'],
      ['PAY-2', '450.00'],
    ],
    invs: [
      ['INV-1', '300.00'],
      ['INV-2', '600.00'],
      ['INV-3', '450.00'],
    ],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '300.00'],
      ['ADV-2', 'PAY-1', 'INV-2', '600.00'],
      ['ADV-3', 'PAY-2', 'INV-3', '450.00'],
    ],
  });
  assert.deepEqual(brief(r), [
    ['ADV-1', 'fits', []],
    ['ADV-2', 'fits', []],
    ['ADV-3', 'fits', []],
  ]);
  assert.deepEqual(
    r.items.map((i) => [i.reference, i.remaining, i.advised, i.excess]),
    [
      ['PAY-1', 90000, 90000, 0],
      ['PAY-2', 45000, 45000, 0],
      ['INV-1', 30000, 30000, 0],
      ['INV-2', 60000, 60000, 0],
      ['INV-3', 45000, 45000, 0],
    ],
  );
});

void test('advice: every open line on a crowded invoice competes, none preferred, whatever the row order', async () => {
  const book: Book = {
    pays: [
      ['PAY-1', '250.00'],
      ['PAY-2', '250.00'],
      ['PAY-3', '250.00'],
    ],
    invs: [['INV-1', '250.00']],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '250.00'],
      ['ADV-2', 'PAY-2', 'INV-1', '250.00'],
      ['ADV-3', 'PAY-3', 'INV-1', '250.00'],
    ],
  };
  const r = await review(book);
  assert.deepEqual(brief(r), [
    ['ADV-1', 'review', ['COMPETES_INVOICE']],
    ['ADV-2', 'review', ['COMPETES_INVOICE']],
    ['ADV-3', 'review', ['COMPETES_INVOICE']],
  ]);
  assert.deepEqual(
    r.lines.map((l) => competitorsOf(r, l)),
    [
      [3, 4],
      [2, 4],
      [2, 3],
    ],
  );
  assert.deepEqual(r.items.find((i) => i.reference === 'INV-1')!.excess, 50000);
  const reversed = await review({
    ...book,
    advice: [...book.advice].reverse(),
  });
  const byReference = (a: unknown[], b: unknown[]) =>
    String(a[0]).localeCompare(String(b[0]));
  assert.deepEqual(
    brief(reversed).sort(byReference),
    brief(r).sort(byReference),
  );
});

void test('advice: one fils over is over alone, or competing together; exactly the capacity fits', async () => {
  const over = await review({
    pays: [['PAY-1', '100.00']],
    invs: [['INV-1', '100.00']],
    advice: [['ADV-1', 'PAY-1', 'INV-1', '100.01']],
  });
  assert.deepEqual(brief(over), [
    ['ADV-1', 'review', ['OVER_PAYMENT', 'OVER_INVOICE']],
  ]);
  const exact = await review({
    pays: [['PAY-1', '100.00']],
    invs: [['INV-1', '100.00']],
    advice: [['ADV-1', 'PAY-1', 'INV-1', '100.00']],
  });
  assert.deepEqual(brief(exact), [['ADV-1', 'fits', []]]);
  const crowded = await review({
    pays: [['PAY-1', '100.00']],
    invs: [
      ['INV-1', '60.00'],
      ['INV-2', '40.01'],
    ],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '60.00'],
      ['ADV-2', 'PAY-1', 'INV-2', '40.01'],
    ],
  });
  assert.deepEqual(brief(crowded), [
    ['ADV-1', 'review', ['COMPETES_PAYMENT']],
    ['ADV-2', 'review', ['COMPETES_PAYMENT']],
  ]);
});

void test('advice: a line over alone still names the lines that crowd its invoice', async () => {
  const r = await review({
    pays: [
      ['PAY-1', '500.00'],
      ['PAY-2', '80.00'],
    ],
    invs: [['INV-1', '300.00']],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '320.00'],
      ['ADV-2', 'PAY-2', 'INV-1', '80.00'],
    ],
  });
  assert.deepEqual(brief(r), [
    ['ADV-1', 'review', ['OVER_INVOICE']],
    ['ADV-2', 'review', ['COMPETES_INVOICE']],
  ]);
  assert.deepEqual(
    r.lines.map((l) => competitorsOf(r, l)),
    [[3], [2]],
  );
});

void test('advice: competition on both items is given in contract order, with both sides of competitors', async () => {
  const r = await review({
    pays: [
      ['PAY-1', '120.00'],
      ['PAY-2', '60.00'],
    ],
    invs: [
      ['INV-1', '100.00'],
      ['INV-2', '80.00'],
    ],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '80.00'],
      ['ADV-2', 'PAY-1', 'INV-2', '60.00'],
      ['ADV-3', 'PAY-2', 'INV-1', '40.00'],
    ],
  });
  assert.deepEqual(brief(r), [
    ['ADV-1', 'review', ['COMPETES_PAYMENT', 'COMPETES_INVOICE']],
    ['ADV-2', 'review', ['COMPETES_PAYMENT']],
    ['ADV-3', 'review', ['COMPETES_INVOICE']],
  ]);
  assert.deepEqual(competitorsOf(r, r.lines[0]), [3, 4]);
});

void test('advice: twins are the same payment, invoice and amount under another ID, and are kept', async () => {
  const r = await review({
    pays: [['PAY-1', '1000.00']],
    invs: [
      ['INV-1', '1000.00'],
      ['INV-2', '1000.00'],
    ],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '200.00'],
      ['ADV-2', 'PAY-1', 'INV-1', '200.00'],
      ['ADV-3', 'PAY-1', 'INV-1', '150.00'],
      ['ADV-4', 'PAY-1', 'INV-2', '200.00'],
    ],
  });
  assert.deepEqual(brief(r), [
    ['ADV-1', 'review', ['TWIN']],
    ['ADV-2', 'review', ['TWIN']],
    ['ADV-3', 'fits', []],
    ['ADV-4', 'fits', []],
  ]);
  assert.deepEqual(
    r.lines.map((l) => twinsOf(r, l)),
    [[3], [2], [], []],
  );
  assert.deepEqual(
    r.lines.map((l) => competitorsOf(r, l)),
    [[], [], [], []],
  );
});

void test('advice: an allocated line does not compete, takes its capacity, and its open twin still needs review', async () => {
  const r = await review(
    {
      pays: [
        ['PAY-1', '700.00'],
        ['PAY-2', '400.00'],
      ],
      invs: [['INV-1', '1000.00']],
      advice: [
        ['ADV-1', 'PAY-1', 'INV-1', '700.00'],
        ['ADV-2', 'PAY-2', 'INV-1', '400.00'],
        ['ADV-3', 'PAY-1', 'INV-1', '700.00'],
      ],
    },
    (r) => [remit(r, 'D1', ['ADV-1'])],
  );
  assert.deepEqual(brief(r), [
    ['ADV-1', 'allocated', []],
    ['ADV-2', 'review', ['OVER_INVOICE']],
    ['ADV-3', 'review', ['OVER_PAYMENT', 'OVER_INVOICE', 'TWIN']],
  ]);
  assert.deepEqual(twinsOf(r, r.lines[0]), [4]);
  const inv = r.items.find((i) => i.reference === 'INV-1')!;
  assert.deepEqual(
    [inv.allocated, inv.remaining, inv.advised, inv.excess],
    [70000, 30000, 110000, 80000],
  );
});

void test('advice: each item keeps its open lines once, and an allocated line competes with none', async () => {
  const r = await review(
    {
      pays: [
        ['PAY-1', '700.00'],
        ['PAY-2', '400.00'],
      ],
      invs: [['INV-1', '900.00']],
      advice: [
        ['ADV-1', 'PAY-1', 'INV-1', '700.00'],
        ['ADV-2', 'PAY-2', 'INV-1', '400.00'],
        ['ADV-3', 'PAY-2', 'INV-1', '100.00'],
      ],
    },
    (r) => [remit(r, 'D1', ['ADV-1'])],
  );
  assert.deepEqual(
    r.items.map((i) => [i.reference, i.open]),
    [
      ['PAY-1', []],
      ['PAY-2', [3, 4]],
      ['INV-1', [3, 4]],
    ],
  );
  assert.deepEqual(
    r.lines.map((l) => competitorsOf(r, l)),
    [[], [4], [3]],
  );
});

void test('advice: one payment advised in every line of a full advice file stays linear', async () => {
  const lines = Array.from(
    { length: MAX_ROWS + 29 },
    (_, k) =>
      [`ADV-${k}`, 'PAY-1', `INV-${k}`, '1.00'] as [
        string,
        string,
        string,
        string,
      ],
  );
  const r = await review({
    pays: [['PAY-1', `${MAX_ROWS + 28}.99`]],
    invs: lines.map(([, , inv]) => [inv, '1.00'] as [string, string]),
    advice: lines,
  });
  assert.equal(r.lines.length, MAX_ROWS + 29);
  assert.ok(r.lines.every((l) => l.reasons.join() === 'COMPETES_PAYMENT'));
  assert.equal(competitorsOf(r, r.lines[0]).length, MAX_ROWS + 28);
  assert.ok(JSON.stringify(r).length < 20e6);
});

void test('advice: undoing a decision returns its line and its capacity', async () => {
  const r = await review(
    {
      pays: [
        ['PAY-1', '700.00'],
        ['PAY-2', '400.00'],
      ],
      invs: [['INV-1', '1000.00']],
      advice: [
        ['ADV-1', 'PAY-1', 'INV-1', '700.00'],
        ['ADV-2', 'PAY-2', 'INV-1', '400.00'],
      ],
    },
    (r) => {
      const d = remit(r, 'D1', ['ADV-1']);
      return [
        d,
        {
          id: 'U1',
          context: r.context,
          at: new Date(Date.UTC(2027, 3, 1, 9)).toISOString(),
          note: 'Wrong remittance',
          type: 'undo',
          target: 'D1',
        },
      ];
    },
  );
  assert.deepEqual(brief(r), [
    ['ADV-1', 'review', ['COMPETES_INVOICE']],
    ['ADV-2', 'review', ['COMPETES_INVOICE']],
  ]);
  assert.equal(r.items.find((i) => i.reference === 'INV-1')!.allocated, 0);
});

void test('advice: a human allocation takes capacity like a remittance one', async () => {
  const r = await review(
    {
      pays: [
        ['PAY-1', '500.00'],
        ['PAY-2', '500.00'],
      ],
      invs: [
        ['INV-1', '500.00'],
        ['INV-2', '500.00'],
      ],
      advice: [['ADV-1', 'PAY-1', 'INV-2', '300.00']],
    },
    (r) => [human(r, 'D1', 'PAY-1', 'INV-1', 25000)],
  );
  assert.deepEqual(brief(r), [['ADV-1', 'review', ['OVER_PAYMENT']]]);
  for (const i of r.items) assert.equal(i.allocated + i.remaining, i.available);
  const inv = r.items.find((i) => i.reference === 'INV-2')!;
  assert.deepEqual([inv.remaining, inv.advised, inv.excess], [50000, 30000, 0]);
});

void test('advice: part-paid capacity is the snapshot available amount', async () => {
  const r = await review({
    pays: [['PAY-1', '90.00']],
    invs: [['INV-1', '400.00', '90.00']],
    advice: [['ADV-1', 'PAY-1', 'INV-1', '90.00']],
  });
  assert.deepEqual(brief(r), [['ADV-1', 'fits', []]]);
});

void test('advice: the review only reads the family result and repeats itself', async () => {
  const s = await state({
    pays: [['PAY-1', '300.00']],
    invs: [
      ['INV-1', '200.00'],
      ['INV-2', '200.00'],
    ],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '200.00'],
      ['ADV-2', 'PAY-1', 'INV-2', '200.00'],
    ],
  });
  const result = reconcileAllocation(s),
    before = structuredClone(result);
  const a = reviewAllocationAdvice(result),
    b = reviewAllocationAdvice(result);
  assert.deepEqual(result, before);
  assert.deepEqual(a, b);
  assert.equal(a.context, result.context);
  assert.equal(a.version, 'allocation-advice-review-1');
});

void test('advice replay: refusals keep the family code, source errors refuse, and the ceiling is ROWS', async () => {
  const s = await state({
    pays: [['PAY-1', '300.00']],
    invs: [['INV-1', '300.00']],
    advice: [
      ['ADV-1', 'PAY-1', 'INV-1', '100.00'],
      ['ADV-2', 'PAY-1', 'INV-9', '100.00'],
    ],
  });
  await assert.rejects(
    replayAllocationAdvice(s),
    /^Error: ALLOCATION_ADVICE_SOURCE_ERRORS$/,
  );
  const ok = await state({
    pays: [['PAY-1', '300.00']],
    invs: [['INV-1', '300.00']],
    advice: [['ADV-1', 'PAY-1', 'INV-1', '100.00']],
  });
  const r = reconcileAllocation(ok);
  await assert.rejects(
    replayAllocationAdvice({
      ...ok,
      events: [human(r, 'D1', 'PAY-1', 'INV-1', 30001)],
    }),
    /^Error: ALLOCATION_ADVICE_OVER_AVAILABLE$/,
  );
  await assert.rejects(
    replayAllocationAdvice({ ...ok, scope: { ...SCOPE, currency: 'XXX' } }),
    /^Error: ALLOCATION_ADVICE_SCOPE$/,
  );
  const forged = structuredClone(ok);
  forged.files[2].sha256 = '0'.repeat(64);
  await assert.rejects(
    replayAllocationAdvice(forged),
    /^Error: ALLOCATION_ADVICE_SOURCE_HASH$/,
  );
  const lines = Array.from(
    { length: MAX_ROWS + 30 },
    (_, k) =>
      [`ADV-${k}`, 'PAY-1', 'INV-1', '0.01'] as [
        string,
        string,
        string,
        string,
      ],
  );
  const big = await state({
    pays: [['PAY-1', '300.00']],
    invs: [['INV-1', '300.00']],
    advice: [],
  });
  const bytes = csv(2, texts({ pays: [], invs: [], advice: lines })[2]);
  big.files[2] = { ...big.files[2], original: bytes.buffer, sha256: 'x' };
  await assert.rejects(
    replayAllocationAdvice(big),
    /^Error: ALLOCATION_ADVICE_ROWS$/,
  );
  const replay = await replayAllocationAdvice(ok);
  assert.deepEqual(brief(replay.review), [['ADV-1', 'fits', []]]);
});
