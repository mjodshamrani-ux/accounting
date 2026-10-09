import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  askDomainEvidence,
  type DomainEvidenceSnapshot,
} from '../lib/reconciliation/domain-assistant.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { reconcileClearing } from '../lib/reconciliation/clearing.ts';
import {
  clearingDemo,
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
import { reconcileAr, type ArInput } from '../lib/reconciliation/ar.ts';
import {
  arDemo,
  arDemoReadings,
  arDemoScope,
} from '../lib/reconciliation/ar-demo.ts';
import { reconcileGlTb, type GlTbInput } from '../lib/reconciliation/gl-tb.ts';
import {
  glTbDemo,
  glDemoReadings,
  glDemoScope,
} from '../lib/reconciliation/gl-tb-demo.ts';
import { reconcileAllocation } from '../lib/reconciliation/allocation.ts';
import { allocationFixture } from '../audit/allocation/fixtures.ts';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import { bankFixture } from '../audit/bank/fixtures.ts';
import { reconcileBankAdjustments } from '../lib/reconciliation/bank-adjustment.ts';
import {
  adjustmentFixture,
  adjustmentTruth,
} from '../audit/bank-adjustment/fixtures.ts';
import { reconcileFinancialPosition } from '../lib/reconciliation/tb-financial.ts';
import {
  financialFixture,
  financialTruth,
} from '../audit/tb-financial/fixtures.ts';
import { reconcileIntercompany } from '../lib/reconciliation/intercompany.ts';
import {
  intercompanyFixture,
  intercompanyTruth,
} from '../audit/intercompany/fixtures.ts';
import { reconcileGateway } from '../lib/reconciliation/payment-gateway.ts';
import {
  gatewayFixture,
  gatewayTruth,
} from '../audit/payment-gateway/fixtures.ts';
const truth = JSON.parse(
  await fsRead(
    new URL(
      '../audit/domain-assistant/question-contract.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const ar = domainEvidenceCopy('ar'),
  en = domainEvidenceCopy('en');
const values = (s: DomainEvidenceSnapshot) =>
  askDomainEvidence(s, en.questions.amounts)
    .facts.filter((f) => f.money)
    .map((f) => f.value);
async function snapshots(): Promise<DomainEvidenceSnapshot[]> {
  const bytes = new TextEncoder().encode(clearingDemo).buffer;
  const clearing = {
    file: await readFile('clearing.csv', bytes),
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
  const arInput: ArInput = {
    files: (await Promise.all(
      arDemo().map((f) => readFile(f.name, f.buffer)),
    )) as ArInput['files'],
    readings: structuredClone(arDemoReadings),
    scope: { ...arDemoScope },
    events: [],
  };
  const gl: GlTbInput = {
    files: (await Promise.all(
      glTbDemo().map((f) => readFile(f.name, f.buffer)),
    )) as GlTbInput['files'],
    readings: structuredClone(glDemoReadings),
    scope: { ...glDemoScope },
  };
  const allocation = await allocationFixture(),
    bank = await bankFixture(),
    adjustment = await adjustmentFixture('pending'),
    financial = await financialFixture('pending'),
    intercompany = await intercompanyFixture('pending'),
    gateway = await gatewayFixture('pending');
  return [
    {
      domain: 'clearing',
      input: clearing,
      result: reconcileClearing(clearing),
    },
    { domain: 'ar', input: arInput, result: reconcileAr(arInput) },
    { domain: 'gl-tb', input: gl, result: reconcileGlTb(gl) },
    {
      domain: 'allocation',
      input: allocation,
      result: reconcileAllocation(allocation),
    },
    { domain: 'bank', input: bank, result: reconcileBank(bank) },
    {
      domain: 'bank-adjustment',
      input: adjustment,
      result: reconcileBankAdjustments(adjustment),
    },
    {
      domain: 'financial',
      input: financial,
      result: reconcileFinancialPosition(financial),
    },
    {
      domain: 'intercompany',
      input: intercompany,
      result: reconcileIntercompany(intercompany),
    },
    { domain: 'gateway', input: gateway, result: reconcileGateway(gateway) },
  ];
}
void test('Evidence assistant: all18 pre-code bilingual questions stay bounded and confer no financial decision', async () => {
  for (const s of await snapshots()) {
    const before = JSON.stringify(s);
    for (const c of truth.questions) {
      const answer = askDomainEvidence(s, c.question);
      assert.equal(answer.kind, c.kind, s.domain + ':' + c.question);
      if (c.kind === 'unsupported') {
        assert.deepEqual(answer.facts, []);
        assert.deepEqual(answer.sources, []);
      }
    }
    for (const k of ['status', 'amounts', 'sources', 'next'] as const)
      assert.deepEqual(
        askDomainEvidence(s, ar.questions[k]),
        askDomainEvidence(s, en.questions[k]),
        s.domain,
      );
    assert.equal(
      JSON.stringify(s),
      before,
      s.domain + ' must remain unchanged',
    );
  }
});
void test('Evidence assistant: all43 pre-engine payment accounting truths retain gross/net differences and null instead of zero', async () => {
  for (const c of gatewayTruth.cases) {
    if (c.status.startsWith('throws:')) continue;
    const input = await gatewayFixture(c.name),
      result = reconcileGateway(input),
      s = { domain: 'gateway' as const, input, result };
    assert.deepEqual(
      values(s),
      [
        ...(c.expected!.totals ?? [null, null, null, null]),
        ...(c.expected!.residuals ?? [null, null, null, null, null]),
      ],
      c.name,
    );
  }
  for (const name of [
    'pending',
    'malformed-competing-transaction',
    'gross-errors-net-cancels',
  ]) {
    const input = await gatewayFixture(name),
      result = reconcileGateway(input),
      all = values({ domain: 'gateway', input, result });
    if (name === 'pending')
      assert.deepEqual(all, [
        ...truth.manualPaymentAmounts.pending,
        ...truth.manualPaymentAmounts.pendingResiduals,
      ]);
    if (name === 'malformed-competing-transaction')
      assert.ok(all.every((v) => v === null));
    if (name === 'gross-errors-net-cancels')
      assert.deepEqual(
        all.slice(4),
        truth.manualPaymentAmounts['gross-errors-net-cancelsResiduals'],
      );
  }
});
void test('Evidence assistant: independent intercompany totals and financial equations are read without generating new aggregates', async () => {
  for (const c of intercompanyTruth.cases) {
    if (c.reject) continue;
    const input = await intercompanyFixture(c.name),
      result = reconcileIntercompany(input);
    assert.deepEqual(
      values({ domain: 'intercompany', input, result }),
      c.financialFacts
        ? c.financialFacts.totals.flatMap((x) => [x.debit, x.credit, x.net])
        : Array(6).fill(null),
      c.name,
    );
  }
  for (const c of financialTruth.cases) {
    if (c.reject) continue;
    const input = await financialFixture(c.name),
      result = reconcileFinancialPosition(input),
      a = askDomainEvidence(
        { domain: 'financial', input, result },
        en.questions.amounts,
      );
    assert.equal(a.kind, 'amounts', c.name);
    assert.deepEqual(
      a.facts.map((f) => f.value),
      c.financialFacts
        ? ['calculated', 'reported'].flatMap((s) =>
            ['assets', 'liabilities', 'equity', 'equation'].map((k) =>
              k === 'equation'
                ? (
                    c.financialFacts!.equations as unknown as Record<
                      string,
                      number
                    >
                  )[s]
                : (
                    c.financialFacts!.grandTotals as unknown as Record<
                      string,
                      Record<string, number>
                    >
                  )[s][k],
            ),
          )
        : Array(8).fill(null),
      c.name,
    );
  }
});
void test('Evidence assistant: forged display, changed source hash, changed cached row and scope never explain stale numbers', async () => {
  for (const s of await snapshots()) {
    const bad = structuredClone(s);
    Object.assign(bad.result, { injectedAmount: 987654321 });
    assert.deepEqual(
      askDomainEvidence(bad, en.questions.amounts),
      { ...truth.invalidDisplayedResult, currency: '', decimals: 0 },
      s.domain,
    );
    const changed = structuredClone(s);
    const input = changed.input as unknown as {
      file?: { sha256: string; sheets: { rows: string[][] }[] };
      files?: { sha256: string; sheets: { rows: string[][] }[] }[];
      balance?: {
        bank: { files: { sha256: string; sheets: { rows: string[][] }[] }[] };
      };
    };
    const file = input.file ?? input.files?.[0] ?? input.balance!.bank.files[0];
    file.sha256 = 'f'.repeat(64);
    assert.equal(
      askDomainEvidence(changed, en.questions.sources).kind,
      'stale',
      s.domain,
    );
    const changedRow = structuredClone(s),
      i = changedRow.input as typeof input,
      f = i.file ?? i.files?.[0] ?? i.balance!.bank.files[0];
    f.sheets[0].rows[1][0] = 'Changed unique source record';
    assert.equal(
      askDomainEvidence(changedRow, en.questions.status).kind,
      'stale',
      s.domain,
    );
    const changedScope = structuredClone(s);
    if (changedScope.domain === 'bank-adjustment')
      changedScope.input.balance.bank.scope.confirmed = false;
    else changedScope.input.scope.confirmed = false;
    assert.equal(askDomainEvidence(changedScope, en.questions.amounts).kind, 'stale', s.domain + ':scope confirmation changed');
  }
});
void test('Evidence assistant: full six-source bank provenance and independent opening/closing facts remain separate', async () => {
  const input = await adjustmentFixture('pending'),
    result = reconcileBankAdjustments(input),
    s = { domain: 'bank-adjustment' as const, input, result };
  const answer = askDomainEvidence(s, en.questions.sources);
  assert.deepEqual(
    answer.sources.map((s) => s.hash),
    [...input.balance.bank.files, ...input.balance.files, ...input.files].map(
      (f) => f.sha256,
    ),
  );
  assert.equal(answer.sources.length, 6);
  const c = adjustmentTruth.cases.find(
    (c: { name: string }) => c.name === 'pending',
  );
  const a = askDomainEvidence(s, en.questions.amounts);
  for (const [i, point] of ['opening', 'closing'].entries())
    assert.deepEqual(
      a.facts.slice(i * 7, i * 7 + 7).map((f) => f.value),
      [
        ...c.raw[point],
        ...c.adjustments[point],
        ...c.adjusted[point],
        c.differences[point],
      ],
      point,
    );
  for (const s of await snapshots())
    if (s.domain === 'allocation' || s.domain === 'bank') {
      const a = askDomainEvidence(s, en.questions.amounts);
      assert.equal(a.individualAmounts, true);
      assert.ok(a.facts.every((f) => !f.money));
    }
});
