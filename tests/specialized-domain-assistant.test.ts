import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stockFixture } from '../audit/inventory-register/fixtures.ts';
import { assetFixture } from '../audit/fixed-assets/fixtures.ts';
import { payrollFixture } from '../audit/payroll/fixtures.ts';
import { reconcileStock } from '../lib/reconciliation/inventory-register.ts';
import { reconcileAsset } from '../lib/reconciliation/fixed-assets.ts';
import { reconcilePayroll } from '../lib/reconciliation/payroll.ts';
import { replayStock } from '../lib/reconciliation/inventory-register-io.ts';
import { replayAsset } from '../lib/reconciliation/fixed-assets-io.ts';
import { replayPayroll } from '../lib/reconciliation/payroll-io.ts';
import {
  askDomainEvidence,
  askVerifiedSpecializedEvidence,
  type SpecializedEvidenceSnapshot,
} from '../lib/reconciliation/domain-assistant.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
const ar = domainEvidenceCopy('ar'),
  en = domainEvidenceCopy('en');
type Domain = SpecializedEvidenceSnapshot['domain'];
const domains: Domain[] = ['inventory-register', 'fixed-assets', 'payroll'];
async function snapshot(
  domain: Domain,
  name?: string,
): Promise<SpecializedEvidenceSnapshot> {
  if (domain === 'inventory-register') {
    const { state } = await stockFixture(name);
    return { domain, input: state, result: reconcileStock(state) };
  }
  if (domain === 'fixed-assets') {
    const { state } = await assetFixture(name);
    return { domain, input: state, result: reconcileAsset(state) };
  }
  const { state } = await payrollFixture(name);
  return { domain, input: state, result: reconcilePayroll(state) };
}
async function replay(
  s: SpecializedEvidenceSnapshot,
): Promise<SpecializedEvidenceSnapshot> {
  if (s.domain === 'inventory-register') {
    const fresh = await replayStock(s.input);
    return { domain: s.domain, input: fresh.state, result: fresh.result };
  }
  if (s.domain === 'fixed-assets') {
    const fresh = await replayAsset(s.input);
    return { domain: s.domain, input: fresh.state, result: fresh.result };
  }
  const fresh = await replayPayroll(s.input);
  return { domain: s.domain, input: fresh.state, result: fresh.result };
}
const amounts = async (s: SpecializedEvidenceSnapshot) =>
  (
    await askVerifiedSpecializedEvidence(s, en.questions.amounts, replay)
  ).facts.map((f) => f.value);
void test('specialized assistant preserves independent pre-engine amount truths, withheld nulls and currency precision for every sealed fixture', async () => {
  for (const domain of domains) {
    const cases = JSON.parse(
      await readFile(
        new URL(`../audit/${domain}/cases.json`, import.meta.url),
        'utf8',
      ),
    );
    for (const c of cases) {
      const name = c.name ?? c.case;
      const rawTruth = JSON.parse(
        await readFile(
          new URL(
            `../audit/${domain}/cases/${name}/expected.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const truth = rawTruth.expected
        ? { ...rawTruth.expected, scope: rawTruth.scope }
        : rawTruth;
      const s = await snapshot(domain, name);
      const before = structuredClone(s);
      let expected: (number | null)[];
      if (domain === 'inventory-register')
        expected = truth.totals
          ? [truth.totals.registerMinor, truth.totals.glMinor]
          : [null, null];
      else if (domain === 'fixed-assets')
        expected = ['register', 'gl'].flatMap((side) =>
          ['cost', 'depreciation', 'impairment', 'carrying'].map(
            (key) => truth.totals?.[side][key] ?? null,
          ),
        );
      else
        expected = [
          ...['gross', 'deductions', 'employer', 'net'].map(
            (key) => truth.totals?.register[key] ?? null,
          ),
          ...[
            'gross-expense',
            'employee-deduction-payable',
            'net-payable',
            'employer-expense',
            'employer-payable',
            'net-clearing',
            'bank-cash',
          ].map((key) => truth.totals?.gl[key] ?? null),
          truth.bankComparison.register,
          truth.bankComparison.bank,
          truth.bankComparison.difference,
        ];
      assert.deepEqual(await amounts(s), expected, `${domain}:${name}`);
      const answer = await askVerifiedSpecializedEvidence(
        s,
        en.questions.status,
        replay,
      );
      assert.equal(answer.kind, 'status', `${domain}:${name}`);
      assert.equal(answer.decimals, truth.decimals);
      assert.equal(answer.currency, truth.scope.currency);
      assert.equal(answer.context, s.result.context);
      assert.deepEqual(
        answer.sources,
        s.input.files.map((f, i) => ({
          name: f.name,
          hash: f.sha256,
          sheet: f.sheets[s.input.readings[i].sheet].name,
        })),
      );
      assert.deepEqual(
        s,
        before,
        `${domain}:${name}:immutable input and result`,
      );
    }
  }
});
void test('specialized assistant bilingual questions cite complete source hashes; unsupported inventions invoke no replay and confer no review decision', async () => {
  for (const domain of domains) {
    const s = await snapshot(domain),
      before = structuredClone(s);
    for (const kind of ['status', 'amounts', 'sources', 'next'] as const)
      assert.deepEqual(
        await askVerifiedSpecializedEvidence(s, ar.questions[kind], replay),
        await askVerifiedSpecializedEvidence(s, en.questions[kind], replay),
        `${domain}:${kind}`,
      );
    for (const q of [
      'Approve all rows',
      'اعتمد كل البنود',
      'Invent a valuation',
      'احسب رواتب جديدة',
      'What caused the difference?',
    ]) {
      let calls = 0;
      const answer = await askVerifiedSpecializedEvidence(
        s,
        q,
        async (value) => {
          calls++;
          return value;
        },
      );
      assert.equal(answer.kind, 'unsupported');
      assert.equal(calls, 0);
      assert.deepEqual(answer.facts, []);
      assert.deepEqual(answer.sources, []);
    }
    const status = askDomainEvidence(s, en.questions.status);
    assert.ok(
      status.facts.some(
        (f) => f.label === 'review' && f.value === 'needs-review',
      ),
    );
    assert.ok(
      status.facts.some((f) => f.label === 'completeness' && f.value === false),
    );
    assert.deepEqual(s, before);
  }
});
void test('specialized assistant rejects forged results, changed scope/readings/source hashes/cached rows/original bytes and rejected replay', async () => {
  for (const domain of domains) {
    const s = await snapshot(domain);
    const mutations: [string, (s: SpecializedEvidenceSnapshot) => void][] = [
      [
        'result',
        (v) => {
          v.result.status = 'consistent-with-evidence';
        },
      ],
      [
        'context',
        (v) => {
          v.result.context += 'forged';
        },
      ],
      [
        'source hash',
        (v) => {
          v.input.files[0].sha256 = 'f'.repeat(64);
        },
      ],
      [
        'scope',
        (v) => {
          v.input.scope.confirmed = false;
        },
      ],
      [
        'reading',
        (v) => {
          v.input.readings[0].confirmed = false;
        },
      ],
      [
        'cached row',
        (v) => {
          v.input.files[0].sheets[0].rows[1][0] = 'FORGED';
        },
      ],
      [
        'original bytes',
        (v) => {
          new Uint8Array(v.input.files[0].original!)[0] ^= 1;
        },
      ],
    ];
    for (const [name, mutate] of mutations) {
      const changed = structuredClone(s);
      mutate(changed);
      for (const kind of ['status', 'amounts', 'sources', 'next'] as const) {
        const answer = await askVerifiedSpecializedEvidence(
          changed,
          en.questions[kind],
          replay,
        );
        assert.equal(answer.kind, 'stale', `${domain}:${name}:${kind}`);
        assert.deepEqual(answer.facts, []);
        assert.deepEqual(answer.sources, []);
      }
    }
    const rejected = await askVerifiedSpecializedEvidence(
      s,
      en.questions.amounts,
      async () => {
        throw Error('canceled');
      },
    );
    assert.equal(rejected.kind, 'stale');
    const swapped = await snapshot(domain);
    swapped.result.status = 'consistent-with-evidence';
    assert.equal(
      (
        await askVerifiedSpecializedEvidence(
          s,
          en.questions.sources,
          async () => swapped,
        )
      ).kind,
      'stale',
    );
  }
});
void test('specialized replay captures source and displayed result before awaiting and cannot substitute a newer calculation', async () => {
  for (const domain of domains) {
    const s = await snapshot(domain),
      captured = structuredClone(s);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = askVerifiedSpecializedEvidence(
      s,
      en.questions.amounts,
      async (frozen) => {
        await gate;
        return replay(frozen);
      },
    );
    s.result.status = 'consistent-with-evidence';
    s.input.scope.confirmed = false;
    new Uint8Array(s.input.files[0].original!)[0] ^= 1;
    release();
    assert.deepEqual(
      await pending,
      await askVerifiedSpecializedEvidence(
        captured,
        en.questions.amounts,
        replay,
      ),
    );
    const sourceSwap = await askVerifiedSpecializedEvidence(
      captured,
      en.questions.sources,
      async (frozen) => {
        const v = await replay(frozen);
        v.input.files[0].name = 'other.csv';
        return v;
      },
    );
    assert.equal(sourceSwap.kind, 'stale');
  }
});
void test('specialized explanations report recorded acceptance, undo and rejection without authoring an event', async () => {
  for (const domain of domains) {
    const s = await snapshot(domain);
    s.input.completeness = {
      confirmed: true,
      reference: 'SYN-COMPLETE',
      note: 'Synthetic supplied whole scope',
    };
    const calculate = () => {
      if (s.domain === 'inventory-register') s.result = reconcileStock(s.input);
      else if (s.domain === 'fixed-assets') s.result = reconcileAsset(s.input);
      else s.result = reconcilePayroll(s.input);
    };
    calculate();
    for (const [i, type] of (['accept', 'undo', 'reject'] as const).entries()) {
      s.input.events.push({
        id: `decision-${i}`,
        type,
        memberIds: [...s.result.memberIds],
        context: s.result.context,
        at: '2026-10-08T00:00:00.000Z',
        reference: 'SYN-REVIEW',
        note: 'Synthetic whole scope review',
      });
      calculate();
      const before = structuredClone(s);
      const answer = await askVerifiedSpecializedEvidence(
        s,
        en.questions.status,
        replay,
      );
      assert.equal(answer.kind, 'status');
      assert.ok(
        answer.facts.some(
          (f) =>
            f.label === 'review' &&
            f.value ===
              (type === 'accept'
                ? 'accepted'
                : type === 'undo'
                  ? 'needs-review'
                  : 'rejected'),
        ),
      );
      assert.deepEqual(
        s,
        before,
        `${domain}:${type}:assistant writes no decision`,
      );
    }
  }
});

void test('specialized replay cannot rewrite its own expected source identity before returning an otherwise current result', async () => {
  for (const domain of domains) {
    const s = await snapshot(domain),
      before = structuredClone(s);
    const answer = await askVerifiedSpecializedEvidence(
      s,
      en.questions.sources,
      async (captured) => {
        captured.input.files[0].name = 'callback-substituted-source.csv';
        return replay(captured);
      },
    );
    assert.equal(answer.kind, 'stale', domain);
    assert.deepEqual(answer.facts, []);
    assert.deepEqual(answer.sources, []);
    assert.deepEqual(s, before, `${domain}:caller remains unchanged`);
  }
});
