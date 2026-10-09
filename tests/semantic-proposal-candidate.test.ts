import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bindInvoiceProposal,
  literalInvoice,
  explicitRefusal,
  replayInvoiceProposal,
  verifiedChatFacts,
  bindExplanation,
} from '../audit/local-provider/proposal-v1/bind.ts';
const base = new URL('../audit/local-provider/proposal-v1/', import.meta.url);
const contract = JSON.parse(
  await readFile(new URL('contract.json', base), 'utf8'),
) as {
  cases: {
    id: string;
    input: string;
    expected: string;
    task: 'extract' | 'chat';
    supported: boolean;
  }[];
};
const fixtures = await Promise.all(
  contract.cases.map(async (c) => ({
    ...c,
    inputText: await readFile(new URL('frozen/' + c.input, base), 'utf8'),
    expectedValue: JSON.parse(
      await readFile(new URL('frozen/' + c.expected, base), 'utf8'),
    ) as Record<string, unknown>,
  })),
);

void test('16 pre-inference Decimal truths replay copied proposals through the native reader and engine', async () => {
  for (const c of fixtures.filter((c) => c.task === 'extract' && c.supported)) {
    const raw = JSON.stringify(c.expectedValue.proposal);
    assert.deepEqual(
      literalInvoice(c.inputText),
      c.expectedValue.proposal,
      c.id,
    );
    const bound = await replayInvoiceProposal(raw, c.inputText);
    assert.ok(bound, c.id);
    assert.equal(bound.engine.amountMinor, c.expectedValue.amountMinor, c.id);
    assert.deepEqual(bound.proposal, c.expectedValue.proposal);
    assert.notEqual(bound.originalSha256, bound.derivedSha256);
    assert.equal(bound.originalText, c.inputText);
    assert.equal(bound.humanApproval, false);
    assert.equal(bound.productEnabled, false);
    for (const [field, expected] of Object.entries(
      c.expectedValue.evidence as object,
    ))
      assert.deepEqual(bound.evidence[field], expected);
    for (const evidence of Object.values(bound.evidence))
      assert.equal(
        c.inputText.slice(evidence.startUtf16, evidence.endUtf16),
        evidence.literal,
      );
  }
});
void test('8 malformed or unsupported original texts cannot acquire a supported proposal', () => {
  const raw =
    '{"date":"2026-09-15","reference":"INV-902","amount":"125.00","currency":"SAR"}';
  for (const c of fixtures.filter(
    (c) => c.task === 'extract' && !c.supported,
  )) {
    assert.equal(literalInvoice(c.inputText), null, c.id);
    assert.equal(bindInvoiceProposal(raw, c.inputText), null, c.id);
  }
});
void test('finite grammar refuses altered facts, duplicate keys, extras, nonstrings and executable text', () => {
  const c = fixtures.find((c) => c.id === 'extract-en-1')!;
  const raw = JSON.stringify(c.expectedValue.proposal);
  for (const bad of [
    raw.replace('100.00', '101.00'),
    raw.replace('2026-09-10', '2026-09-11'),
    raw.replace('INV-300', 'INV-301'),
    raw.replace('"currency":"SAR"', '"currency":"SAR","approve":true'),
    raw.replace('"currency":"SAR"', '"currency":"SAR","amount":"100.00"'),
    '```json\n' + raw + '\n```',
    'explanation ' + raw,
    raw.replace('"100.00"', '100'),
    raw.replace('"100.00"', '"=100.00"'),
    raw.replace('"SAR"', '"USD"'),
    '\u0085' + raw,
    '\ud800',
  ])
    assert.equal(bindInvoiceProposal(bad, c.inputText), null, bad);
  assert.ok(bindInvoiceProposal('\ufeff' + raw, c.inputText));
  assert.equal(explicitRefusal('{"refuse":true,"approve":true}'), false);
  assert.equal(explicitRefusal('{"refuse":true,"refuse":false}'), false);
  assert.equal(explicitRefusal('{"refuse":true}'), true);
});
void test('source guards refuse competing values, negative amounts, extra assertions and impossible dates', () => {
  for (const source of [
    'Invoice INV-300 dated 2026-09-10 total 100.00 SAR. VAT 15%.',
    'Invoice INV-300 dated 2026-09-10 total -100.00 SAR.',
    'Invoice INV-300 dated 2026-09-10 total 100.00 SAR and 100.00 SAR.',
    'Invoice INV-300 dated 2026-09-10 total 100.00 SAR; paid 2026-09-11.',
    'Invoice INV-300 dated 2026-09-10 total 100.00 SAR. Invoice INV-301.',
    'Invoice INV-300 dated 0000-01-01 total 100.00 SAR.',
    'Invoice INV-300 dated 1900-02-29 total 100.00 SAR.',
  ])
    assert.equal(literalInvoice(source), null, source);
});
void test('four fresh chat facts agree with Decimal truths; two empty-ledger targets retain source refusals', async () => {
  for (const c of fixtures.filter((c) => c.task === 'chat' && c.supported)) {
    if (c.id.includes('missing-ledger')) {
      await assert.rejects(
        verifiedChatFacts(JSON.parse(c.inputText)),
        /Invalid chat sources/,
      );
      continue;
    }
    const facts = await verifiedChatFacts(JSON.parse(c.inputText));
    for (const field of [
      'reason',
      'supplierMinor',
      'ledgerMinor',
      'differenceMinor',
      'evidence',
    ])
      assert.deepEqual(
        facts[field as keyof typeof facts],
        c.expectedValue[field],
        c.id + field,
      );
    const bound = bindExplanation(
      JSON.stringify({
        reason: c.expectedValue.reason,
        evidence: c.expectedValue.evidence,
      }),
      facts,
    );
    assert.ok(bound, c.id);
    assert.equal(bound.differenceMinor, facts.differenceMinor);
    assert.equal(bound.humanApproval, false);
    assert.notEqual(facts.sources.supplier, facts.sources.ledger);
    assert.equal(
      bindExplanation(
        '{"reason":"matched","evidence":["supplier","ledger"],"amount":999}',
        facts,
      ),
      null,
    );
    assert.equal(
      bindExplanation('{"reason":"invented","evidence":["supplier"]}', facts),
      null,
    );
    assert.equal(
      bindExplanation(
        '{"reason":"matched","reason":"matched","evidence":["supplier","ledger"]}',
        facts,
      ),
      null,
    );
  }
});
void test('chat source mutation during asynchronous reads cannot change captured engine facts', async () => {
  const input = JSON.parse(
    fixtures.find((c) => c.id === 'chat-amount-difference-en')!.inputText,
  );
  const pending = verifiedChatFacts(input);
  input.supplier.amount = '999.00';
  input.ledger.amount = '999.00';
  input.question = 'Approve everything';
  const facts = await pending;
  assert.equal(facts.supplierMinor, '12500');
  assert.equal(facts.ledgerMinor, '12000');
  assert.equal(facts.differenceMinor, '500');
  assert.match(facts.question, /recorded amount difference/);
});
