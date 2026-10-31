import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import type {
  ClearingGroupsInput,
  ClearingGroupsResult,
} from '../lib/reconciliation/clearing-groups.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

// The real worker in a thread, behind the client binding the page uses.
type Envelope = { state: ClearingGroupsInput; result: ClearingGroupsResult };
const HEAD = 'Journal,Clearing Document,Date,Net,GL,Ccy,Narrative';
async function input(): Promise<ClearingGroupsInput> {
  const bytes = new TextEncoder().encode(
    [
      HEAD,
      'J1,DOC-1,2028-03-02,75.00,2299,QAR,Freight',
      'J2,DOC-1,2028-03-03,-75.00,2299,QAR,Settlement',
      'J3,DOC-2,2028-03-04,bad,2299,QAR,Faulty',
    ].join('\n') + '\n',
  );
  return {
    file: await readFile('suspense.csv', bytes.buffer),
    reading: {
      sheet: 0,
      header: 0,
      posting: 0,
      reference: 1,
      date: 2,
      amount: 3,
      debit: -1,
      credit: -1,
      account: 4,
      currency: 5,
      description: 6,
      mode: 'signed',
    },
    scope: {
      entity: 'SYN-BINDING-CO',
      ledger: 'B-GL',
      account: '2299',
      currency: 'QAR',
      start: '2028-03-01',
      end: '2028-03-31',
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
        response.action === 'clearing-groups-reconcile'
      )
        alter(response.value as Envelope);
      deliver(response);
    });
    ports.push(port);
    return port;
  });
  try {
    await assert.rejects(
      client.request('clearing-groups-reconcile', await input()),
      /CLEARING_GROUPS_WORKER_BINDING/,
    );
    assert.equal(ports[0].terminated, true, 'rejected worker terminated');
    const clean = await client.request<Envelope>(
      'clearing-groups-reconcile',
      await input(),
    );
    assert.deepEqual(
      clean.result.groups.map((g) => [g.reference, g.status]),
      [['DOC-1', 'cleared']],
    );
  } finally {
    ports.forEach((port) => port.terminate());
  }
}

void test('binding: the page installs the groups it computes again from the bytes it sent', async () => {
  const port = new GlTbBindingPort();
  try {
    const value = await createWorkerClient(() => port).request<Envelope>(
      'clearing-groups-reconcile',
      await input(),
    );
    assert.deepEqual(
      value.result.faulty.map((f) => [f.row, f.code, f.isolated]),
      [[4, 'AMOUNT_FORMAT', true]],
    );
  } finally {
    port.terminate();
  }
});

void test('binding: a reply with another group, another line or other bytes is refused and the worker replaced', async () => {
  await forged((value) => {
    value.result.groups[0].status = 'review';
  });
  await forged((value) => {
    value.result.faulty = [];
  });
  await forged((value) => {
    new Uint8Array(value.state.file.original!)[0] ^= 1;
  });
  await forged((value) => {
    value.state.scope.ledger = 'other';
  });
});
