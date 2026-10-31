import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PG_BATCHES_HEADERS,
  PG_BATCHES_ROLES,
  PG_BATCHES_VERSION,
  reviewGatewayBatches,
  type GatewayBatchesInput,
  type GatewayBatchesResult,
} from '../lib/reconciliation/payment-gateway-batches.ts';
import type { GatewayBatchesReplayInput } from '../lib/reconciliation/payment-gateway-batches-io.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

// The real worker in a thread, behind the client binding the page uses. A
// Bahraini dinar gateway of its own.
type Envelope = { state: GatewayBatchesInput; result: GatewayBatchesResult };
const MID = 'BIND-MID-2';
const BANK = 'BIND-BANK-9';
function input(): GatewayBatchesReplayInput {
  const body = [
    [
      ['S-1', 'B-1', 'sale', '2028-07-03', '10.000', 'Order 1', MID, 'BHD'],
      ['S-2', 'B-2', 'sale', '2028-07-04', '5.000', 'Order 2', MID, 'BHD'],
    ],
    [['F-1', 'B-1', '0.200', 'Card fee', MID, 'BHD']],
    [
      ['B-1', '2028-07-05', '10.000', '0', '0.200', '9.800', MID, 'BHD'],
      ['B-2', '2028-07-05', '5.000', '0', '0', '5.000', MID, 'BHD'],
    ],
    [
      ['P-1', 'B-1', '9.800', MID, 'BHD'],
      ['P-1', 'B-2', '5.000', MID, 'BHD'],
    ],
    [['K-1', 'P-1', '2028-07-06', '14.800', BANK, 'BHD']],
  ];
  return {
    files: body.map((rows, side) => {
      const bytes = new TextEncoder().encode(
        [PG_BATCHES_HEADERS[side], ...rows].map((r) => r.join(',')).join('\n') +
          '\n',
      );
      return {
        name: `${PG_BATCHES_ROLES[side]}.csv`,
        original: bytes.buffer as ArrayBuffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    readings: PG_BATCHES_ROLES.map((role) => ({
      sheet: 0 as const,
      role,
      family: PG_BATCHES_VERSION,
      confirmed: true as const,
    })),
    scope: {
      entity: 'SYN-BINDING-CO',
      gateway: 'SYN-BINDING-GW',
      merchantAccount: MID,
      bankAccount: BANK,
      currency: 'BHD',
      start: '2028-07-01',
      end: '2028-07-31',
      asOf: '2028-08-04',
      confirmed: true,
    },
  };
}

async function forged(alter: (value: Envelope) => void) {
  const ports: GlTbBindingPort[] = [];
  const client = createWorkerClient(() => {
    const first = ports.length === 0;
    const port = new GlTbBindingPort((response, deliver) => {
      if (
        first &&
        response.ok &&
        response.action === 'payment-gateway-batches-reconcile'
      )
        alter(response.value as Envelope);
      deliver(response);
    });
    ports.push(port);
    return port;
  });
  try {
    await assert.rejects(
      client.request('payment-gateway-batches-reconcile', input()),
      /PG_BATCHES_WORKER_BINDING/,
    );
    assert.equal(ports[0].terminated, true, 'rejected worker terminated');
    const clean = await client.request<Envelope>(
      'payment-gateway-batches-reconcile',
      input(),
    );
    assert.deepEqual(
      clean.result.batches.map((b) => [b.batch, b.status]),
      [
        ['B-1', 'consistent'],
        ['B-2', 'consistent'],
      ],
    );
  } finally {
    ports.forEach((port) => port.terminate());
  }
}

void test('binding: the page installs the review it computes again from the bytes it sent', async () => {
  const port = new GlTbBindingPort();
  try {
    const value = await createWorkerClient(() => port).request<Envelope>(
      'payment-gateway-batches-reconcile',
      input(),
    );
    assert.deepEqual(
      value.result.payouts.map((p) => [p.payout, p.batches, p.status]),
      [['P-1', ['B-1', 'B-2'], 'consistent']],
    );
  } finally {
    port.terminate();
  }
});

void test('binding: a reply with another review, other sheets agreeing with it, or other bytes is refused and the worker replaced', async () => {
  await forged((value) => {
    value.result.batches[0].status = 'review';
  });
  // Sheets and review forged together agree with each other, so the
  // protocol's recomputation passes; only the page's replay of its own bytes
  // catches them.
  await forged((value) => {
    value.state.files[4].sheets[0].rows[1][3] = '14.700';
    value.result = reviewGatewayBatches(value.state);
  });
  await forged((value) => {
    new Uint8Array(value.state.files[0].original!)[0] ^= 1;
  });
  await forged((value) => {
    value.state.scope.gateway = 'other';
  });
});
