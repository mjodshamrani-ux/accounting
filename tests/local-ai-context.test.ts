import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import {
  askLocalModel,
  interpretModelOutput,
} from '../lib/reconciliation/local-ai.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Comparison, SourceFile } from '../lib/reconciliation/types.ts';

function fixture() {
  const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
  return compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
}

test('a model cannot append unrelated proposal IDs to a specific document explanation', () => {
  const result = fixture();
  const raw = JSON.stringify({
    intent: 'transaction',
    transactionId: 'supplier:0:2',
    proposal: { supplierIds: ['supplier:0:8'], ledgerIds: ['ledger:0:7'] },
  });
  assert.equal(interpretModelOutput(result, raw, 'Explain supplier:0:2'), null);
});

test('a valid source ID still cannot be invented outside the model evidence window', () => {
  const result = fixture();
  const raw = JSON.stringify({
    intent: 'next',
    proposal: {
      supplierIds: ['supplier:0:8'],
      ledgerIds: ['ledger:0:7'],
    },
  });
  assert.equal(
    interpretModelOutput(
      result,
      raw,
      'What should I examine?',
      new Set(['supplier:0:8']),
    ),
    null,
  );
});

test('local model receives canonical review cases, including the document asked about', async () => {
  const result = fixture();
  let data:
    | { candidates: { id: string; signedMinorUnits: number }[] }
    | undefined;
  await askLocalModel(
    result,
    'Explain supplier:0:8',
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (prompt) => {
          data = JSON.parse(prompt.split('DATA=')[1]);
          return '{"intent":"unknown"}';
        },
        destroy() {},
      }),
    },
  );
  assert.ok(data);
  assert.equal(data.candidates[0].id, 'supplier:0:8');
  for (const row of data.candidates) {
    const source = [
      ...result.supplier.transactions,
      ...result.ledger.transactions,
    ].find((t) => t.id === row.id);
    assert.equal(row.signedMinorUnits, source?.amount);
  }
  assert.ok(data.candidates.length <= 20);
});

test('in-place changes to current accounting result invalidate an outstanding model reply', async () => {
  const result = fixture();
  let destroyed = 0;
  const answer = await askLocalModel(
    result,
    'question',
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => {
          result.scope.currency = 'USD';
          return '{"intent":"difference"}';
        },
        destroy() {
          destroyed++;
        },
      }),
    },
  );
  assert.equal(answer, null);
  assert.equal(destroyed, 1);
});

test('blank prompts never query a local model', async () => {
  let calls = 0;
  await askLocalModel(fixture(), '  ', new AbortController().signal, {
    availability: async () => {
      calls++;
      return 'available';
    },
    create: async () => {
      throw Error('must not create');
    },
  });
  assert.equal(calls, 0);
});

type ModelData = {
  candidates: {
    id: string;
    side: 'supplier' | 'ledger';
    caseId: string;
    signedMinorUnits: number;
  }[];
};
function broadFixture(groupSize = 0) {
  const scope = { ...demoScope, confirmed: true, coverageConfirmed: false };
  const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
  const file = (side: 'supplier' | 'ledger'): SourceFile => ({
    name: `synthetic-${side}.csv`,
    sheets: [
      {
        name: 'Data',
        formulaRows: [],
        hiddenRows: [],
        rows: [
          ['Date', 'Reference', 'Amount'],
          ...Array.from(
            { length: side === 'supplier' ? groupSize : groupSize ? 1 : 0 },
            () => ['2026-08-12', 'INV-GROUP-901', '1.00'],
          ),
          ...Array.from({ length: 25 }, (_, i) => [
            '2026-08-12',
            `${side}-INV-${i}`,
            '7.21',
          ]),
        ],
      },
    ],
  });
  return compare(
    normalizeSource(file('supplier'), mapping, scope, 'supplier'),
    normalizeSource(file('ledger'), mapping, scope, 'ledger'),
    scope,
  );
}
async function captureData(
  result: Comparison,
  question = 'What should I examine?',
) {
  let data: ModelData | undefined;
  const answer = await askLocalModel(
    result,
    question,
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (text) => {
          data = JSON.parse(text.split('DATA=')[1]);
          return '{"intent":"unknown"}';
        },
        destroy() {},
      }),
    },
  );
  return { data, answer };
}
function assertWholeCanonicalCases(result: Comparison, data: ModelData) {
  const canonical = new Map(
    [...result.supplier.transactions, ...result.ledger.transactions].map(
      (t) => [t.id, t],
    ),
  );
  const ids = new Set(data.candidates.map((t) => t.id));
  assert.equal(ids.size, data.candidates.length);
  assert.ok(data.candidates.length <= 20);
  for (const side of ['supplier', 'ledger'])
    assert.ok(data.candidates.filter((t) => t.side === side).length <= 10);
  for (const row of data.candidates) {
    const source = canonical.get(row.id)!;
    assert.equal(row.signedMinorUnits, source.amount);
    assert.equal(row.side, source.side);
    const c = result.cases.find((item) => item.caseId === row.caseId)!;
    assert.ok(c);
    assert.ok(
      c.sourceTrace.every((member) => ids.has(member.sourceRowId)),
      'every admitted case is supplied in full',
    );
  }
}

test('large review contexts reserve ten canonical rows per side instead of starving ledger evidence', async () => {
  const result = broadFixture();
  const { data } = await captureData(result);
  assert.ok(data);
  assert.equal(data.candidates.filter((t) => t.side === 'supplier').length, 10);
  assert.equal(data.candidates.filter((t) => t.side === 'ledger').length, 10);
  assertWholeCanonicalCases(result, data);
});

test('an explicitly requested late ledger row is prioritized with the same balanced budget', async () => {
  const result = broadFixture();
  const { data } = await captureData(result, 'Explain ledger:0:26');
  assert.ok(data);
  assert.equal(data.candidates[0].id, 'ledger:0:26');
  assert.equal(data.candidates.filter((t) => t.side === 'supplier').length, 10);
  assert.equal(data.candidates.filter((t) => t.side === 'ledger').length, 10);
  assertWholeCanonicalCases(result, data);
});

test('a referenced ambiguous group is admitted whole and remaining capacity stays bounded on both sides', async () => {
  const result = broadFixture(9);
  // Change display copies only: candidate amounts must still come from sources.
  result.cases = structuredClone(result.cases);
  const group = result.cases.find((c) => c.supplierMembers.length === 9)!;
  group.supplierMembers[0].amount = 999999;
  const { data } = await captureData(result, 'Explain supplier:0:2');
  assert.ok(data);
  assert.equal(data.candidates[0].id, 'supplier:0:2');
  assert.equal(
    data.candidates.filter((t) => t.caseId === group.caseId).length,
    10,
  );
  assertWholeCanonicalCases(result, data);
});

test('oversized referenced cases fall back before invoking a model and are never truncated', async () => {
  const result = broadFixture(11);
  let calls = 0;
  const answer = await askLocalModel(
    result,
    'Explain supplier:0:2',
    new AbortController().signal,
    {
      availability: async () => {
        calls++;
        return 'available';
      },
      create: async () => {
        throw Error('oversized case must not create model session');
      },
    },
  );
  assert.equal(answer, null);
  assert.equal(calls, 0);
  const { data } = await captureData(result);
  assert.ok(data);
  assert.ok(
    data.candidates.every(
      (t) => t.id !== 'supplier:0:2' && t.id !== 'ledger:0:2',
    ),
    'unrequested oversized case is omitted as a whole',
  );
  assertWholeCanonicalCases(result, data);
});
