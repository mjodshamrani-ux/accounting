import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import {
  interpretModelOutput,
  askLocalModel,
} from '../lib/reconciliation/local-ai.ts';
import {
  verifyHypothesis,
  explainResult,
} from '../lib/reconciliation/assistant.ts';

const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const run = () =>
  compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );

test('AI cannot pick one row from a reference shared by several documents', () => {
  const result = run();
  for (const id of ['supplier:0:8', 'supplier:0:9', 'ledger:0:7']) {
    assert.equal(
      interpretModelOutput(
        result,
        JSON.stringify({ intent: 'transaction', transactionId: id }),
        'Explain INV-005',
      ),
      null,
    );
  }
  const answer = explainResult(result, 'Explain INV-005');
  assert.deepEqual(
    new Set(answer.sourceIds),
    new Set(['supplier:0:8', 'supplier:0:9', 'ledger:0:7']),
  );
});

test('explicit row ID can disambiguate AI routing, but contradictory references cannot', () => {
  const result = run();
  const raw = JSON.stringify({
    intent: 'transaction',
    transactionId: 'supplier:0:8',
  });
  assert.ok(interpretModelOutput(result, raw, 'Explain supplier:0:8'));
  assert.equal(
    interpretModelOutput(result, raw, 'Explain supplier:0:8 and INV-999'),
    null,
  );
});

test('AI routing rejects irrelevant transaction fields and blank or oversized questions', () => {
  const result = run();
  assert.equal(
    interpretModelOutput(
      result,
      '{"intent":"checks","transactionId":"supplier:0:8"}',
      'checks',
    ),
    null,
  );
  assert.equal(interpretModelOutput(result, '{"intent":"checks"}', ''), null);
  assert.equal(
    interpretModelOutput(result, '{"intent":"checks"}', 'x'.repeat(501)),
    null,
  );
});

test('out-of-range hypothesis differences fail closed without crashing the assistant', () => {
  const result = run();
  result.supplierOnly[0].amount = 100_000_000_000_000;
  result.ledgerOnly[0].amount = -100_000_000_000_000;
  const before = JSON.stringify(result);
  const proposal = {
    supplierIds: [result.supplierOnly[0].id],
    ledgerIds: [result.ledgerOnly[0].id],
  };
  const check = verifyHypothesis(result, proposal);
  assert.equal(check.status, 'rejected');
  assert.equal(check.difference, null);
  assert.equal(JSON.stringify(result), before);
});

test('hostile model proposals never acquire authority or alter any source evidence', () => {
  const result = run();
  const before = JSON.stringify(result);
  const id = result.supplierOnly[0].id;
  const other = result.ledgerOnly[0].id;
  for (const field of [
    'amount',
    'balance',
    'approved',
    'confidence',
    'reason',
    '__proto__',
    'constructor',
  ]) {
    for (const value of [0, true, 'approved', { amount: 0 }]) {
      const proposal = {
        supplierIds: [id],
        ledgerIds: [other],
        [field]: value,
      };
      assert.equal(verifyHypothesis(result, proposal).status, 'rejected');
      assert.equal(
        interpretModelOutput(
          result,
          JSON.stringify({ intent: 'checks', [field]: value }),
          'checks',
        ),
        null,
      );
    }
  }
  assert.equal(JSON.stringify(result), before);
});

test('Arabic and aborted requests do not even query a model provider', async () => {
  let calls = 0;
  const api = {
    availability: async () => {
      calls++;
      return 'available';
    },
    create: async () => {
      throw Error('no model session');
    },
  };
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await askLocalModel(run(), 'غير مفهوم', new AbortController().signal, api),
    null,
  );
  assert.equal(
    await askLocalModel(run(), 'unfamiliar', aborted.signal, api),
    null,
  );
  assert.equal(calls, 0);
});
