import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  ALLOCATION_ROLES,
  ALLOCATION_VERSION,
  type AllocationInput,
  type AllocationResult,
} from '../lib/reconciliation/allocation.ts';
import {
  reviewAllocationAdvice,
  type AllocationAdviceReview,
} from '../lib/reconciliation/allocation-advice.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

// The real worker in a thread, behind the client binding the page uses.
type Envelope = {
  state: AllocationInput;
  result: AllocationResult;
  review: AllocationAdviceReview;
};
const META =
  'Synthetic Tile Importer,TI-AP,Kiln K5,2130,BHD,2028-07-31,before-proposed-allocation';
const HEAD = [
  'Payment ID,Payment date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Invoice ID,Invoice date,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Original amount,Available amount',
  'Advice line ID,Entity,Ledger,Party,Account,Currency,Snapshot date,Allocation basis,Payment ID,Invoice ID,Allocation amount',
];
async function input(): Promise<AllocationInput> {
  const rows = [
    [`R-1,2028-07-02,${META},90.500,90.500`],
    [
      `T-1,2028-06-11,${META},60.250,60.250`,
      `T-2,2028-06-18,${META},30.250,30.250`,
    ],
    [`A1,${META},R-1,T-1,60.250`, `A2,${META},R-1,T-2,40.000`],
  ];
  const files = [];
  for (const side of [0, 1, 2])
    files.push(
      await readFile(
        `kiln-${side}.csv`,
        new TextEncoder().encode([HEAD[side], ...rows[side]].join('\n') + '\n')
          .buffer,
      ),
    );
  return {
    files: files as AllocationInput['files'],
    readings: ALLOCATION_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ALLOCATION_VERSION,
      confirmed: true,
    })) as AllocationInput['readings'],
    scope: {
      entity: 'Synthetic Tile Importer',
      ledger: 'TI-AP',
      party: 'Kiln K5',
      account: '2130',
      currency: 'BHD',
      cutoff: '2028-07-31',
      basis: 'before-proposed-allocation',
      confirmed: true,
    },
    events: [],
  };
}
const statuses = (value: Envelope) =>
  value.review.lines.map((l) => [l.reference, l.status, l.reasons]);
// A1 fits; A2 asks 40.000 of T-2, which holds 30.250, and with A1 the advice on
// R-1 is 100.250 against 90.500.
const EXPECTED = [
  ['A1', 'review', ['COMPETES_PAYMENT']],
  ['A2', 'review', ['OVER_INVOICE', 'COMPETES_PAYMENT']],
];

async function forged(alter: (value: Envelope) => void) {
  const ports: GlTbBindingPort[] = [];
  const client = createWorkerClient(() => {
    const first = ports.length === 0;
    const port = new GlTbBindingPort((response, deliver) => {
      if (
        first &&
        response.ok &&
        response.action === 'allocation-advice-review'
      )
        alter(response.value as Envelope);
      deliver(response);
    });
    ports.push(port);
    return port;
  });
  try {
    await assert.rejects(
      client.request('allocation-advice-review', await input()),
      /ALLOCATION_ADVICE_WORKER_BINDING/,
    );
    assert.equal(ports[0].terminated, true, 'rejected worker terminated');
    const clean = await client.request<Envelope>(
      'allocation-advice-review',
      await input(),
    );
    assert.deepEqual(statuses(clean), EXPECTED);
  } finally {
    ports.forEach((port) => port.terminate());
  }
}

void test('binding: the page installs the advice review it computes again from the bytes it sent', async () => {
  const port = new GlTbBindingPort();
  try {
    const value = await createWorkerClient(() => port).request<Envelope>(
      'allocation-advice-review',
      await input(),
    );
    assert.equal(value.review.decimals, 3);
    assert.deepEqual(statuses(value), EXPECTED);
    assert.deepEqual(
      value.review.items.map((i) => [i.reference, i.remaining, i.excess]),
      [
        ['R-1', 90500, 9750],
        ['T-1', 60250, 0],
        ['T-2', 30250, 9750],
      ],
    );
  } finally {
    port.terminate();
  }
});

void test('binding: a reply with another line, another capacity, a consistent forgery or other bytes is refused and the worker replaced', async () => {
  // The review alone changed.
  await forged((value) => {
    value.review.lines[0].status = 'fits';
    value.review.lines[0].reasons = [];
  });
  // More room on R-1 in the family result and the review that follows from
  // it: the protocol's own check accepts this pair, so only the replay from
  // the bytes sent shows it.
  await forged((value) => {
    const r1 = value.result.items.find((i) => i.reference === 'R-1')!.id;
    const b = value.result.balances.find((b) => b.id === r1)!;
    b.available += 9750;
    b.remaining += 9750;
    value.review = reviewAllocationAdvice(value.result);
    assert.deepEqual(statuses(value), [
      ['A1', 'fits', []],
      ['A2', 'review', ['OVER_INVOICE']],
    ]);
  });
  await forged((value) => {
    new Uint8Array(value.state.files[1].original!)[0] ^= 1;
  });
  await forged((value) => {
    value.state.scope.party = 'Kiln K6';
  });
});
