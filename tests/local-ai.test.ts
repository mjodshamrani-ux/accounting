import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askLocalModel,
  interpretModelOutput,
} from '../lib/reconciliation/local-ai.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const r = compare(
  normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
  normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
  scope,
);
test('unavailable or downloadable models never create a session or start download', async () => {
  for (const availability of ['unavailable', 'downloadable', 'downloading']) {
    let creates = 0;
    assert.equal(
      await askLocalModel(r, 'question', new AbortController().signal, {
        availability: async () => availability,
        create: async () => {
          creates++;
          throw new Error('must not create');
        },
      }),
      null,
    );
    assert.equal(creates, 0);
  }
});
test('ready model uses same languages, structured output and destroys session', async () => {
  let destroyed = 0;
  let availabilityOptions: unknown;
  const answer = await askLocalModel(
    r,
    'question',
    new AbortController().signal,
    {
      availability: async (options) => {
        availabilityOptions = options;
        return 'available';
      },
      create: async (options) => {
        const { signal, ...rest } = options as Record<string, unknown>;
        assert.ok(signal);
        assert.deepEqual(rest, availabilityOptions);
        return {
          prompt: async () => '{"intent":"difference"}',
          destroy: () => {
            destroyed++;
          },
        };
      },
    },
  );
  assert.ok(answer?.text.includes('3,500.00'));
  assert.equal(destroyed, 1);
});
test('model cannot supply financial facts, approval, prose or nonexistent IDs', () => {
  for (const raw of [
    'approved',
    '{"intent":"difference","amount":50000}',
    '{"intent":"transaction","transactionId":"fake"}',
    '{"intent":"checks","approved":true}',
    '{"intent":"__proto__"}',
  ])
    assert.equal(interpretModelOutput(r, raw), null);
});
test('model-generated proposal is rechecked without becoming a match', () => {
  const before = JSON.stringify(r);
  const answer = interpretModelOutput(
    r,
    '{"intent":"transaction","transactionId":"supplier:0:2","proposal":{"supplierIds":["supplier:0:2"],"ledgerIds":["ledger:0:2"]}}',
    'Explain INV-001',
  );
  assert.ok(answer?.text.includes('لا ينشئ مطابقة'));
  assert.equal(JSON.stringify(r), before);
});
test('abort and model errors fall back without output or retained session', async () => {
  const controller = new AbortController();
  let destroyed = 0;
  const answer = await askLocalModel(r, 'question', controller.signal, {
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => {
        controller.abort();
        return '{"intent":"difference"}';
      },
      destroy: () => {
        destroyed++;
      },
    }),
  });
  assert.equal(answer, null);
  assert.equal(destroyed, 1);
});
