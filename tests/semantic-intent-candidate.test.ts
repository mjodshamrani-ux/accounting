import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindSemanticIntent,
  canonicalSemanticQuestion,
  INTENT_LABELS,
} from '../audit/local-provider/intent-v3/bind.ts';
import { evidenceQuestionKind } from '../lib/i18n/domain-evidence.ts';
void test('semantic candidate finite reply grammar refuses model authority, duplicate keys and invented amounts', () => {
  for (const intent of INTENT_LABELS) {
    assert.equal(bindSemanticIntent(JSON.stringify({ intent })), intent);
    if (intent !== 'refuse')
      assert.equal(
        evidenceQuestionKind(
          canonicalSemanticQuestion(JSON.stringify({ intent }))!,
        ),
        intent,
      );
    else
      assert.equal(canonicalSemanticQuestion(JSON.stringify({ intent })), null);
  }
  for (const raw of [
    null,
    1,
    {},
    '{"intent":"status","intent":"amounts"}',
    '{"intent":"status","approve":true}',
    '{"intent":"amounts","amount":0}',
    '{"intent":"post"}',
    '{"intent":"Status"}',
    '```json\n{"intent":"next"}\n```',
    'answer: {"intent":"sources"}',
    '{"intent":"sources"} trailing',
    ' '.repeat(129),
    '{"\\u0069ntent":"status"}',
  ])
    assert.equal(bindSemanticIntent(raw), null, JSON.stringify(raw));
});
