import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedGateway } from '../audit/payment-gateway/fixtures.ts';
import {
  validateWorkerValue,
  isRequest,
  WORKER_CHANNEL,
} from '../lib/reconciliation/protocol.ts';
void test('Gateway worker: only complete recomputed original evidence/results can be installed', async () => {
  const good = await finishedGateway('pending');
  for (const action of ['gateway-reconcile', 'gateway-restore']) {
    validateWorkerValue(action, good, {});
    for (const edit of [
      (v: typeof good) => {
        v.result.status = 'consistent-with-evidence';
      },
      (v: typeof good) => {
        v.result.records[0].pop();
      },
      (v: typeof good) => {
        v.result.residuals![0] = 1;
      },
      (v: typeof good) => {
        v.result.inventory.pop();
      },
      (v: typeof good) => {
        v.state.scope.policyVersion = 'changed';
      },
    ]) {
      const bad = structuredClone(good);
      edit(bad);
      assert.throws(() => validateWorkerValue(action, bad, {}));
    }
  }
  assert.ok(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'gateway-reconcile',
      payload: {},
    }),
  );
  assert.ok(
    !isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'gateway-accept',
      payload: {},
    }),
  );
});
void test('Gateway worker: source identity and actual ArrayBuffer binary outputs are mandatory', async () => {
  const base = await finishedGateway('pending'),
    file = base.state.files[0];
  validateWorkerValue('gateway-read', file, { name: file.name });
  assert.throws(() =>
    validateWorkerValue('gateway-read', file, { name: 'wrong.csv' }),
  );
  assert.throws(() =>
    validateWorkerValue(
      'gateway-read',
      { ...file, original: undefined },
      { name: file.name },
    ),
  );
  for (const action of ['gateway-save', 'gateway-export']) {
    validateWorkerValue(action, new ArrayBuffer(1), {});
    assert.throws(() => validateWorkerValue(action, {}, {}));
    assert.throws(() => validateWorkerValue(action, new ArrayBuffer(0), {}));
  }
});
