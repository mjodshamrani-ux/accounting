import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  ALLOCATION_ROLES,
  ALLOCATION_VERSION,
  type AllocationEvent,
  type AllocationInput,
  type AllocationResult,
} from '../lib/reconciliation/allocation.ts';
import { replayAllocationAdvice } from '../lib/reconciliation/allocation-advice-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic printing supplier in riyals, unrelated to the ALL-1
// stories. P-2 holds 150.00 and two twin lines advise 100.00 each from it to
// I-3, which holds 100.00.
const META =
  'Synthetic Print House,PH-AP,Paper Mill M3,2120,SAR,2028-05-31,before-proposed-allocation';
const HEAD = [
  'Payment ID,Payment date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Invoice ID,Invoice date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Advice line ID,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Payment ID,Invoice ID,Allocation amount',
];
const ROWS = [
  [
    `P-1,2028-05-12,${META},500.00,500.00`,
    `P-2,2028-05-14,${META},150.00,150.00`,
  ],
  [
    `I-1,2028-04-20,${META},300.00,300.00`,
    `I-2,2028-04-22,${META},200.00,200.00`,
    `I-3,2028-04-25,${META},100.00,100.00`,
  ],
  [
    `L1,${META},P-1,I-1,300.00`,
    `L2,${META},P-1,I-2,200.00`,
    `L3,${META},P-2,I-3,100.00`,
    `L4,${META},P-2,I-3,100.00`,
  ],
];
const SCOPE = {
  entity: 'Synthetic Print House',
  ledger: 'PH-AP',
  party: 'Paper Mill M3',
  account: '2120',
  currency: 'SAR',
  cutoff: '2028-05-31',
  basis: 'before-proposed-allocation',
  confirmed: true,
};
async function request(
  last = '100.00',
  events: AllocationEvent[] = [],
): Promise<AllocationInput> {
  const files = [];
  for (const side of [0, 1, 2]) {
    const rows = [...ROWS[side]];
    if (side === 2) rows[3] = `L4,${META},P-2,I-3,${last}`;
    const bytes = new TextEncoder().encode(
      [HEAD[side], ...rows].join('\n') + '\n',
    );
    files.push(await readFile(`side-${side}.csv`, bytes.buffer));
  }
  return {
    files: files as AllocationInput['files'],
    readings: ALLOCATION_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ALLOCATION_VERSION,
      confirmed: true,
    })) as AllocationInput['readings'],
    scope: { ...SCOPE },
    events,
  };
}
function approve(r: AllocationResult, line: string): AllocationEvent {
  const p = r.proofs.find((p) => p.reference === line)!;
  return {
    id: `approve-${line}`,
    context: r.context,
    at: '2028-06-01T08:00:00.000Z',
    note: 'Approved from the advice',
    type: 'allocate',
    links: [
      {
        paymentId: r.items.find(
          (i) => i.side === 0 && i.reference === p.payment,
        )!.id,
        invoiceId: r.items.find(
          (i) => i.side === 1 && i.reference === p.invoice,
        )!.id,
        amount: p.amount,
        basis: {
          kind: 'remittance',
          reference: line,
          reason: 'Advice',
          proofId: p.id,
        },
      },
    ],
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () => validateWorkerValue('allocation-advice-review', value, payload),
    /غير مكتملة/,
  );
const lines = (value: Awaited<ReturnType<typeof replayAllocationAdvice>>) =>
  value.review.lines.map((l) => [l.reference, l.status, l.reasons]);

void test('allocation advice worker: the page installs only a review that follows from the three files it sent', async () => {
  const payload = await request();
  const value = await replayAllocationAdvice(payload);
  assert.deepEqual(lines(value), [
    ['L1', 'fits', []],
    ['L2', 'fits', []],
    ['L3', 'review', ['COMPETES_PAYMENT', 'COMPETES_INVOICE', 'TWIN']],
    ['L4', 'review', ['COMPETES_PAYMENT', 'COMPETES_INVOICE', 'TWIN']],
  ]);
  validateWorkerValue('allocation-advice-review', value, payload);
  // A review that does not follow from the family result it carries.
  const fits = structuredClone(value);
  fits.review.lines[2].status = 'fits';
  refused(fits, payload);
  const untwinned = structuredClone(value);
  untwinned.review.lines[3].reasons = ['COMPETES_PAYMENT', 'COMPETES_INVOICE'];
  refused(untwinned, payload);
  const room = structuredClone(value);
  const p2 = room.result.items.find((i) => i.reference === 'P-2')!.id;
  room.result.balances.find((b) => b.id === p2)!.remaining += 5000;
  refused(room, payload);
  // A review for another advice file is not this request's review.
  refused(await replayAllocationAdvice(await request('50.00')), payload);
  // Nor for these files under another scope, reading or decision list.
  refused(value, { ...payload, scope: { ...SCOPE, party: 'Paper Mill M4' } });
  refused(value, {
    ...payload,
    readings: payload.readings.map((r, side) =>
      side === 2 ? { ...r, confirmed: false } : r,
    ),
  });
  refused(value, {
    ...payload,
    events: [approve(value.result, 'L1')],
  });
  // The bytes it carries must be the bytes sent, side by side.
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.files[2].original!)[0] ^= 1;
  refused(bytes, payload);
  const swapped = structuredClone(value);
  swapped.state.files = [
    swapped.state.files[1],
    swapped.state.files[0],
    swapped.state.files[2],
  ];
  refused(swapped, payload);
  refused({ ...value, extra: true }, payload);
  refused(
    { ...value, review: { ...value.review, version: 'allocation-advice-0' } },
    payload,
  );
});

void test('allocation advice worker: a decision taken travels with the review', async () => {
  const first = await replayAllocationAdvice(await request());
  const payload = await request('100.00', [approve(first.result, 'L3')]);
  const value = await replayAllocationAdvice(payload);
  // L3 is allocated and carries no reason; P-2 keeps 50.00 and I-3 nothing,
  // so L4 now exceeds both and is still L3's twin.
  assert.deepEqual(lines(value), [
    ['L1', 'fits', []],
    ['L2', 'fits', []],
    ['L3', 'allocated', []],
    ['L4', 'review', ['OVER_PAYMENT', 'OVER_INVOICE', 'TWIN']],
  ]);
  validateWorkerValue('allocation-advice-review', value, payload);
  refused(value, { ...payload, events: [] });
  refused(first, payload);
});

void test('allocation advice worker: refusals carry the family code', async () => {
  const payload = await request();
  await assert.rejects(
    replayAllocationAdvice({
      ...payload,
      scope: { ...SCOPE, confirmed: false },
    }),
    /^Error: ALLOCATION_ADVICE_SCOPE$/,
  );
  await assert.rejects(
    replayAllocationAdvice(await request('1O0.00')),
    /^Error: ALLOCATION_ADVICE_SOURCE_ERRORS$/,
  );
  await assert.rejects(
    replayAllocationAdvice({
      ...payload,
      files: [
        payload.files[0],
        payload.files[1],
        { ...payload.files[2], name: 'side-2.pdf' },
      ] as AllocationInput['files'],
    }),
    /^Error: ALLOCATION_ADVICE_SOURCE$/,
  );
});
