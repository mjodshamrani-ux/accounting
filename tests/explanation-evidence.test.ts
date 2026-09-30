import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import {
  explainResult,
  resolveQuestionReferences,
  hasVerifiedExplanationEvidence,
  containsExactIdentifier,
} from '../lib/reconciliation/assistant.ts';
import {
  askLocalModel,
  interpretModelOutput,
} from '../lib/reconciliation/local-ai.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import type {
  Scope,
  Mapping,
  SourceFile,
  Comparison,
} from '../lib/reconciliation/types.ts';
type Fixture = {
  id: string;
  question: string;
  lookupCount: number;
  answerKind: string;
  approved: number;
  referenceColumn?: number;
  externalBalances?: {
    supplierOpening: string;
    supplierClosing: string;
    ledgerOpening: string;
    ledgerClosing: string;
    periodStart: string;
  };
};
const root = '../audit/assistant-evidence/';
const contract = JSON.parse(
  await bytes(new URL(root + 'contract.json', import.meta.url), 'utf8'),
) as { scope: Scope; cases: Fixture[] };
async function native(id: string) {
  const c = contract.cases.find((c) => c.id === id)!;
  const files = (await Promise.all(
    ['supplier', 'ledger'].map(async (side) => {
      const name = id + '-' + side + '.csv',
        b = await bytes(new URL(root + 'frozen/' + name, import.meta.url));
      return readFile(
        name,
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      );
    }),
  )) as [SourceFile, SourceFile];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  if (c.referenceColumn !== undefined)
    for (const m of mappings) m.reference = c.referenceColumn;
  if (c.externalBalances)
    for (const [i, m] of mappings.entries()) {
      const b = c.externalBalances;
      m.opening = i ? b.ledgerOpening : b.supplierOpening;
      m.closing = i ? b.ledgerClosing : b.supplierClosing;
      m.periodStart = b.periodStart;
    }
  const input = { files, mappings, scope: contract.scope };
  return { c, input, result: reconcileSupplierStatement(input).result };
}
for (const c of contract.cases)
  void test(
    'P5 native evidence lookup and restored explanation: ' + c.id,
    async () => {
      const { input, result } = await native(c.id),
        before = JSON.stringify(result);
      assert.equal(hasVerifiedExplanationEvidence(result), true);
      assert.equal(
        resolveQuestionReferences(result, c.question)?.length,
        c.lookupCount,
      );
      const answer = explainResult(result, c.question);
      assert.equal(answer.kind, c.answerKind);
      assert.equal(result.caseCounts.autoMatchedCases, c.approved);
      const restored = await restoreSession(
        await saveSession({
          ...input,
          decisions: [],
          rejected: [],
          events: [],
          review: { name: '', notes: '', checked: false },
        }),
      );
      assert.deepEqual(explainResult(restored.result, c.question), answer);
      assert.equal(JSON.stringify(result), before);
      if (c.id === 'untyped-credit') {
        assert.match(answer.text, /CN-701.*Credit Note No/);
        assert.equal(result.supplier.transactions[0].documentType, 'Unknown');
        assert.equal(result.caseCounts.needsReviewSourceRows, 2);
      }
      if (c.id === 'partial-source') {
        assert.match(answer.text, /^نتيجة جزئية:/);
        assert.doesNotMatch(
          localizeEngineText(answer.text, 'en'),
          /\p{Script=Arabic}/u,
        );
        assert.equal(result.supplier.errors.length, 1);
      }
    },
  );
type Alter = (r: Comparison) => void;
const probes: [string, Alter][] = [
  [
    'case total',
    (r) => {
      r.cases[0] = { ...r.cases[0], supplierTotal: 9999900 };
    },
  ],
  [
    'case variance',
    (r) => {
      r.cases[0] = { ...r.cases[0], variance: 9999900 };
    },
  ],
  [
    'case bridge effect',
    (r) => {
      r.cases[0] = { ...r.cases[0], bridgeEffect: 9999900 };
    },
  ],
  [
    'display member',
    (r) => {
      r.cases[0].supplierMembers = r.cases[0].supplierMembers.map((t) => ({
        ...t,
        amount: 9999900,
        amountMinor: 9999900,
      }));
    },
  ],
  [
    'source trace',
    (r) => {
      r.cases[0].sourceTrace = r.cases[0].sourceTrace.map((t) => ({
        ...t,
        row: 99,
      }));
    },
  ],
  [
    'counter',
    (r) => {
      r.caseCounts = { ...r.caseCounts, autoMatchedCases: 9999 };
    },
  ],
  [
    'bridge delta',
    (r) => {
      r.bridge = { ...r.bridge!, delta: 9999900 };
    },
  ],
  [
    'bridge adjustment',
    (r) => {
      r.bridge = { ...r.bridge!, itemAdjustment: 9999900 };
    },
  ],
  [
    'closing source drift',
    (r) => {
      r.supplier = { ...r.supplier, closing: 9999900 };
    },
  ],
  [
    'bridge arithmetic status',
    (r) => {
      r.supplier = {
        ...r.supplier,
        balanceArithmeticStatus: 'BALANCE_ARITHMETIC_FAILED',
      };
    },
  ],
  [
    'false full reconciliation',
    (r) => {
      r.balanceComparable = true;
    },
  ],
  [
    'missing case',
    (r) => {
      r.cases = [];
    },
  ],
];
for (const [name, alter] of probes)
  void test(
    'P5 inconsistent ' + name + ' cannot become a chat figure or model context',
    async () => {
      const { result } = await native('balanced-variance');
      const bad = structuredClone(result);
      alter(bad);
      const before = JSON.stringify(bad);
      let availability = 0,
        create = 0;
      const api = {
        availability: async () => {
          availability++;
          return 'available';
        },
        create: async () => {
          create++;
          throw Error('invalid result must not reach a model');
        },
      };
      for (const q of [
        'Explain INV-P5-730',
        'Why is there a balance difference?',
        'What checks were completed?',
        'What should I review next?',
      ]) {
        const answer = explainResult(bad, q);
        assert.equal(answer.kind, 'unsupported');
        assert.deepEqual(answer.sourceIds, []);
        assert.doesNotMatch(answer.text, /99,999|9999/);
        assert.equal(interpretModelOutput(bad, '{"intent":"checks"}', q), null);
      }
      assert.equal(
        await askLocalModel(
          bad,
          'Help me understand',
          new AbortController().signal,
          api,
        ),
        null,
      );
      assert.equal(availability, 0);
      assert.equal(create, 0);
      assert.equal(JSON.stringify(bad), before);
    },
  );
void test('P5 audit-only lookups keep exact spelling, ambiguity and unknown identifiers', async () => {
  const { result } = await native('unselected-reference');
  assert.equal(resolveQuestionReferences(result, 'Explain EXT-777')?.length, 2);
  for (const q of [
    'Explain EXT-7770',
    'Explain EXT-777 and EXT-999',
    'Explain EXT777',
  ])
    assert.equal(resolveQuestionReferences(result, q), null);
  assert.equal(
    interpretModelOutput(
      result,
      '{"intent":"transaction","transactionId":"supplier:0:2"}',
      'Explain EXT-777',
    ),
    null,
  );
  assert.equal(result.caseCounts.autoMatchedCases, 1);
});
void test('P5 source-only views and retained evidence cannot drift from canonical rows', async () => {
  const { result } = await native('untyped-credit');
  const bad = structuredClone(result);
  bad.cases[0].supplierMembers = bad.cases[0].supplierMembers.map((t) => ({
    ...t,
    retainedEvidence: [],
  }));
  assert.equal(explainResult(bad, 'Explain CN-701').kind, 'unsupported');
  const malformed = structuredClone(result);
  malformed.supplier.transactions[0].retainedEvidence = [
    {
      field: 'unverifiedCreditNoteNumber',
      header: 'Credit Note No',
      value: 17 as never,
    },
  ];
  assert.equal(explainResult(malformed, 'Explain CN-701').kind, 'unsupported');
});
void test('P5 complete model windows carry canonical native cues and complete case membership', async () => {
  const { result } = await native('untyped-credit');
  const before = JSON.stringify(result);
  let data: Record<string, unknown> | undefined;
  const answer = await askLocalModel(
    result,
    'Help with CN-701',
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (prompt) => {
          data = JSON.parse(prompt.split('DATA=')[1]);
          return '{"intent":"transaction","transactionId":"supplier:0:2"}';
        },
        destroy() {},
      }),
    },
  );
  assert.ok(data);
  const candidates = data.candidates as {
    id: string;
    retainedEvidence: { field: string; header: string; value: string }[];
  }[];
  assert.equal(candidates.length, 2);
  assert.ok(Array.isArray(candidates[0].retainedEvidence));
  assert.deepEqual(
    candidates[0].retainedEvidence.find(
      (e) => e.field === 'unverifiedCreditNoteNumber',
    ),
    {
      field: 'unverifiedCreditNoteNumber',
      header: 'Credit Note No',
      value: 'CN-701',
    },
  );
  const cases = data.cases as {
    status: string;
    supplierIds: string[];
    ledgerIds: string[];
    supplierTotalMinor: number;
    ledgerTotalMinor: number;
  }[];
  assert.ok(Array.isArray(cases));
  assert.deepEqual(
    cases.map((c) => [
      c.status,
      c.supplierIds,
      c.ledgerIds,
      c.supplierTotalMinor,
      c.ledgerTotalMinor,
    ]),
    [['Needs Review', ['supplier:0:2'], ['ledger:0:2'], -5000, -5000]],
  );
  assert.ok(answer);
  assert.equal(answer.kind, 'transaction');
  assert.equal(JSON.stringify(result), before);
  assert.equal(result.caseCounts.autoMatchedCases, 0);
});
void test('P5 an over-budget UTF-8 window declines without truncating evidence or querying a model', async () => {
  const { result } = await native('untyped-credit');
  // Keep canonical/display copies consistent; the large literal is audit data.
  const huge = 'د'.repeat(17000);
  const t = result.supplier.transactions[0];
  t.retainedEvidence!.push({
    field: 'mappedReference',
    header: 'Reference',
    value: huge,
  });
  assert.equal(hasVerifiedExplanationEvidence(result), true);
  let calls = 0;
  assert.equal(
    await askLocalModel(
      result,
      'Help me understand',
      new AbortController().signal,
      {
        availability: async () => {
          calls++;
          return 'available';
        },
        create: async () => {
          throw Error('over-budget prompt must not be created');
        },
      },
    ),
    null,
  );
  assert.equal(calls, 0);
  assert.equal(t.retainedEvidence!.at(-1)?.value, huge);
});

void test('P5 exact identifier lookup keeps punctuation and Unicode boundaries during literal screening', () => {
  for (const [question, id, expected] of [
    ['See (CN-701)', 'CN-701', true],
    ['Explain CN-7010', 'CN-701', false],
    ['Explain CN.7+01', 'CN.7+01', true],
    ['Explain CNx7+01', 'CN.7+01', false],
    ['𝑨CN-701', 'CN-701', false],
    ['CN-701𐒠', 'CN-701', false],
    ['مرجعCN-701', 'CN-701', false],
    ['CN-701/CN-702', 'CN-701', false],
  ] as const)
    assert.equal(containsExactIdentifier(question, id), expected);
});
