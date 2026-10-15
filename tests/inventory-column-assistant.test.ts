import test from 'node:test';
import assert from 'node:assert/strict';
import { columnInput } from './inventory-column-fixture.ts';
import { replayStock } from '../lib/reconciliation/inventory-register-io.ts';
import { askVerifiedSpecializedEvidence } from '../lib/reconciliation/domain-assistant.ts';
import { domainEvidenceCopy } from '../lib/i18n/domain-evidence.ts';
void test('INV-1E assistant uses source-replayed supported money and cannot promote changed parent dimensions', async () => {
  const value = await replayStock(await columnInput('D02'));
  assert.equal(value.result.financial, 'missing');
  const before = structuredClone(value),
    snapshot = {
      domain: 'inventory-register' as const,
      input: value.state,
      result: value.result,
    };
  for (const lang of ['ar', 'en'] as const) {
    const answer = await askVerifiedSpecializedEvidence(
      snapshot,
      domainEvidenceCopy(lang).questions.amounts,
      async () => {
        const fresh = await replayStock(snapshot.input);
        return {
          domain: 'inventory-register' as const,
          input: fresh.state,
          result: fresh.result,
        };
      },
    );
    assert.deepEqual(
      answer.facts.map((f) => [f.label, f.subject, f.value]),
      [
        ['supportedRegister', 'register', 62500],
        ['carrying', 'gl', 1125000],
      ],
    );
    assert.deepEqual(
      answer.sources.map((s) => s.hash),
      value.state.files.map((f) => f.sha256),
    );
  }
  assert.deepEqual(value, before);
});
