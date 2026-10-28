import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  IMB_ROLES,
  IMB_VERSION,
} from '../lib/reconciliation/inventory-movement-bridge.ts';
import {
  replayMovementBridge,
  type ImbReplayInput,
} from '../lib/reconciliation/inventory-movement-bridge-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic stock book, unrelated to the INV-2 stories.
const SCOPE = {
  Entity: 'SYN-PROTOCOL-CO',
  Currency: 'EGP',
  'Period start': '2029-01-01',
  'Period end': '2029-01-31',
  'Negative balances': 'not allowed',
};
const HEAD =
  'Movement ID,Item ID,Item dimensions,Kind,Quantity,Unit,Value,Movement date,Posting date,GL account,Transfer ID,Origin ID';
function register(closing = '12.00') {
  return (
    [
      HEAD,
      'M1,I1,w=1,opening,10,pcs,10.00,2029-01-01,2029-01-01,1500,,',
      'M2,I1,w=1,receipt,4,pcs,4.00,2029-01-10,2029-01-10,1500,,',
      'M3,I1,w=1,issue,2,pcs,2.00,2029-01-20,2029-01-20,1500,,',
      `M4,I1,w=1,closing,12,pcs,${closing},2029-01-31,2029-01-31,1500,,`,
    ].join('\n') + '\n'
  );
}
const GL =
  'GL account,Opening,Debit,Credit,Closing\n1500,10.00,4.00,2.00,12.00\n';
const file = (name: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    original: bytes.buffer,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
function request(closing?: string): ImbReplayInput {
  return {
    files: [file('register.csv', register(closing)), file('gl.csv', GL)],
    readings: [
      { role: IMB_ROLES[0], family: IMB_VERSION, confirmed: true },
      { role: IMB_ROLES[1], family: IMB_VERSION, confirmed: true },
    ],
    scope: { confirmed: true, fields: { ...SCOPE } },
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () =>
      validateWorkerValue(
        'inventory-movement-bridge-reconcile',
        value,
        payload,
      ),
    /غير مكتملة/,
  );

void test('IMB worker: the page installs only a result it can compute again from the files it sent', async () => {
  const payload = request();
  const value = await replayMovementBridge(payload);
  assert.equal(value.result.positions[0].status, 'consistent');
  assert.equal(value.result.accounts[0].status, 'consistent');
  validateWorkerValue('inventory-movement-bridge-reconcile', value, payload);
  const changed = structuredClone(value);
  changed.result.positions[0].status = 'held';
  refused(changed, payload);
  const silent = structuredClone(value);
  silent.result.accounts[0].register!.closing = '9001';
  refused(silent, payload);
  // A result for another register is not this request's result.
  const other = await replayMovementBridge(request('12.01'));
  refused(other, payload);
  const wrongScope = structuredClone(value);
  wrongScope.state.scope.fields = {
    ...wrongScope.state.scope.fields,
    Entity: 'SYN-OTHER',
  };
  refused(wrongScope, payload);
});

void test('IMB worker: bytes, a hash or a name the page did not send change nothing, in either file', async () => {
  const payload = request();
  const value = await replayMovementBridge(payload);
  for (const i of [0, 1]) {
    const bytes = structuredClone(value);
    new Uint8Array(bytes.state.files[i].original)[0] ^= 1;
    refused(bytes, payload);
    const hash = structuredClone(value);
    hash.state.files[i].sha256 = '0'.repeat(64);
    refused(hash, payload);
    const name = structuredClone(value);
    name.state.files[i].name = 'other.csv';
    refused(name, payload);
  }
  const swapped = structuredClone(value);
  swapped.state.files.reverse();
  refused(swapped, payload);
  refused({ ...value, extra: true }, payload);
});
