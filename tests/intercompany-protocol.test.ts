import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedIntercompany } from '../audit/intercompany/fixtures.ts';
import {
  WORKER_CHANNEL,
  isRequest,
  validateWorkerValue,
} from '../lib/reconciliation/protocol.ts';
void test('Intercompany worker envelope: only declared actions and recomputed whole-pair results can be installed', async () => {
  const value = await finishedIntercompany('pending');
  for (const action of ['intercompany-reconcile', 'intercompany-restore']) {
    assert.doesNotThrow(() => validateWorkerValue(action, value, {}));
    for (const edit of [
      (v: typeof value) => {
        v.result.status = 'consistent-with-evidence';
      },
      (v: typeof value) => {
        v.result.pairs[0].residual = 1;
      },
      (v: typeof value) => {
        v.result.inventory.pop();
      },
      (v: typeof value) => {
        v.result.missing.push({ kind: 'invented', key: 'other' });
      },
      (v: typeof value) => {
        v.state.scope.policyVersion = 'CHANGED';
      },
    ]) {
      const bad = structuredClone(value);
      edit(bad);
      assert.throws(() => validateWorkerValue(action, bad, {}));
    }
  }
  assert.ok(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'intercompany-read',
      payload: {},
    }),
  );
  assert.ok(
    !isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'intercompany-accept',
      payload: {},
    }),
  );
});
void test('Intercompany worker envelope: source name/hash/original and binary action outputs are required', async () => {
  const { state } = await finishedIntercompany('pending');
  const file = state.files[0];
  validateWorkerValue('intercompany-read', file, { name: file.name });
  assert.throws(() =>
    validateWorkerValue('intercompany-read', file, { name: 'other.csv' }),
  );
  assert.throws(() =>
    validateWorkerValue(
      'intercompany-read',
      { ...file, original: undefined },
      { name: file.name },
    ),
  );
  for (const action of ['intercompany-save', 'intercompany-export']) {
    assert.doesNotThrow(() =>
      validateWorkerValue(action, new ArrayBuffer(1), {}),
    );
    assert.throws(() => validateWorkerValue(action, {}, {}));
    assert.throws(() => validateWorkerValue(action, new ArrayBuffer(0), {}));
  }
});
