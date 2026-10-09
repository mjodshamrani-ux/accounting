import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  inspectMultilineSource,
  proposeMultilineSelection,
  parseModelSelections,
  MultilineReviewSession,
  sha256,
  type FieldSelection,
  type ReviewerDecision,
  type ReviewReceipt,
  type Span,
} from '../audit/local-provider/multiline-source-v1/workflow.ts';
const base = new URL(
  '../audit/local-provider/multiline-source-v1/frozen/',
  import.meta.url,
);
const revision = 'synthetic-text-extraction-v1';
const encoder = new TextEncoder();
const contract = JSON.parse(
  await readFile(new URL('contract.json', base), 'utf8'),
) as {
  cases: { id: string; input: string; expected: string; outcome: string }[];
};
type Golden = {
  outcome: string;
  reason?: string;
  originalSha256: string;
  extractionRevision: string;
  fields?: Record<string, string>;
  amountMinor?: string;
  evidence?: Record<string, { value: Span; role: Span }>;
};
const fixtures = await Promise.all(
  contract.cases.map(async (c) => ({
    ...c,
    bytes: new Uint8Array(await readFile(new URL(c.input, base))),
    golden: JSON.parse(
      await readFile(new URL(c.expected, base), 'utf8'),
    ) as Golden,
  })),
);
const supported = fixtures.filter((c) => c.outcome === 'candidate');
function reviewer(
  candidate: NonNullable<MultilineReviewSession['candidate']>,
  decision: 'accept' | 'reject' = 'accept',
): ReviewerDecision {
  return {
    decision,
    reviewerLabel: 'synthetic-review-test (not a field human claim)',
    rationale:
      'Synthetic test action separately inspects literal and role citations.',
    reviewedOriginalSha256: candidate.originalSha256,
    reviewedExtractionRevision: candidate.extractionRevision,
    reviewedSelectionSha256: candidate.selectionSha256,
  };
}
async function selected(id = 'en-basic') {
  const fixture = fixtures.find((c) => c.id === id)!;
  const session = new MultilineReviewSession(fixture.bytes, revision);
  const snapshot = await session.inspect();
  const candidate = await session.select(snapshot.candidate!.selections);
  assert.ok(candidate);
  return { session, fixture, candidate, snapshot };
}

void test('pre-TypeScript original freeze remains byte exact and independently matches SHA256', async () => {
  const freeze = JSON.parse(
    await readFile(new URL('freeze.json', base), 'utf8'),
  ) as { files: Record<string, string>; arithmetic: string };
  assert.match(freeze.arithmetic, /Python decimal.Decimal/);
  for (const [name, expectedHash] of Object.entries(freeze.files)) {
    const bytes = await readFile(new URL(name, base));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expectedHash,
      name,
    );
  }
  assert.equal(fixtures.length, 28);
  assert.equal(supported.length, 8);
});
void test('all original role and literal citations match independently authored Python goldens', async () => {
  for (const c of fixtures) {
    const snapshot = await inspectMultilineSource(c.bytes, revision);
    assert.equal(snapshot.originalSha256, c.golden.originalSha256, c.id);
    assert.equal(snapshot.outcome, c.golden.outcome, c.id);
    if (!snapshot.candidate) {
      assert.equal(snapshot.reason, c.golden.reason, c.id);
      continue;
    }
    assert.deepEqual(snapshot.candidate.fields, c.golden.fields, c.id);
    for (const selection of snapshot.candidate.selections) {
      assert.deepEqual(
        { value: selection.value, role: selection.role },
        c.golden.evidence![selection.field],
        c.id + selection.field,
      );
      assert.equal(selection.sourceSha256, c.golden.originalSha256);
      assert.equal(selection.extractionRevision, revision);
      const text = new TextDecoder().decode(c.bytes);
      for (const evidence of [selection.value, selection.role]) {
        assert.equal(
          text.slice(evidence.startUtf16, evidence.endUtf16),
          evidence.literal,
        );
        assert.equal(
          new TextDecoder().decode(
            c.bytes.slice(evidence.startByte, evidence.endByte),
          ),
          evidence.literal,
        );
      }
    }
  }
});
void test('8 separately synthetic-reviewed candidates replay through actual native CSV reader and financial engine', async () => {
  for (const c of supported) {
    const { session, candidate } = await selected(c.id);
    assert.equal(session.state, 'candidate');
    await assert.rejects(
      session.apply({} as ReviewReceipt, c.bytes, revision),
      /separate current reviewer/,
    );
    const receipt = session.recordReviewerDecision(reviewer(candidate));
    assert.ok(receipt);
    const result = await session.apply(receipt, c.bytes, revision);
    assert.equal(result.engine.amountMinor, c.golden.amountMinor, c.id);
    assert.equal(result.engine.date, c.golden.fields!.date);
    assert.equal(result.engine.reference, c.golden.fields!.reference);
    assert.equal(result.engine.originalAmount, c.golden.fields!.amount);
    assert.equal(result.engine.transactionCount, 1);
    assert.equal(result.originalText, new TextDecoder().decode(c.bytes));
    assert.equal(result.originalSha256, c.golden.originalSha256);
    assert.equal(result.derived.kind, 'explicitly-derived-csv');
    assert.match(result.derived.name, /derived.*\.csv$/);
    assert.equal(
      result.derived.sha256,
      await sha256(encoder.encode(result.derived.csv)),
    );
    assert.notEqual(result.derived.sha256, result.originalSha256);
    assert.equal(result.productEnabled, false);
    assert.equal(session.state, 'applied-development-derived');
    await assert.rejects(
      session.apply(receipt, c.bytes, revision),
      /separate current reviewer/,
    );
  }
});
void test('due date, PO reference, quantity and unit price cannot replace invoice roles even for identical literals', async () => {
  const { snapshot } = await selected('en-same-distractor-value');
  const selections = snapshot.candidate!.selections;
  const text = new TextDecoder().decode(snapshot.originalBytes);
  for (const field of ['date', 'amount'] as const) {
    const forged = structuredClone(selections) as FieldSelection[];
    const i = forged.findIndex((s) => s.field === field);
    const original = forged[i];
    const distractorStart =
      field === 'date'
        ? text.indexOf('2026-09-16', text.indexOf('Due date:'))
        : text.indexOf('125.00');
    forged[i] = {
      ...original,
      value: {
        ...original.value,
        startUtf16: distractorStart,
        endUtf16: distractorStart + original.value.literal.length,
        startByte: distractorStart,
        endByte: distractorStart + original.value.literal.length,
      },
    };
    assert.equal(
      await proposeMultilineSelection(snapshot, forged),
      null,
      field,
    );
  }
  const distractors = await selected('en-distractors');
  const ref = structuredClone(
    distractors.snapshot.candidate!.selections,
  ) as FieldSelection[];
  const referenceIndex = ref.findIndex((s) => s.field === 'reference');
  ref[referenceIndex] = {
    ...ref[referenceIndex],
    role: { ...ref[referenceIndex].role, literal: 'Purchase order' },
    value: { ...ref[referenceIndex].value, literal: 'PO-999' },
  };
  assert.equal(
    await proposeMultilineSelection(distractors.snapshot, ref),
    null,
  );
});
void test('missing, duplicate, forged and incomplete citations never bind; literal without role is insufficient', async () => {
  const { snapshot } = await selected('ar-basic');
  const valid = snapshot.candidate!.selections;
  const variants: unknown[] = [
    valid.slice(0, 3),
    [...valid, valid[0]],
    [valid[0], valid[0], valid[2], valid[3]],
    valid.map((s) =>
      s.field === 'amount'
        ? { ...s, value: { ...s.value, literal: '999.99' } }
        : s,
    ),
    valid.map((s) =>
      s.field === 'date'
        ? { ...s, role: { ...s.role, literal: 'تاريخ الاستحقاق' } }
        : s,
    ),
    valid.map((s) => ({ ...s, sourceSha256: '0'.repeat(64) })),
    valid.map((s) => ({ ...s, extractionRevision: 'new-revision' })),
    valid.map(({ role: _role, ...s }) => s),
    valid.map((s) => ({ ...s, approve: true })),
    valid.map((s) => ({
      ...s,
      value: { ...s.value, startByte: s.value.startUtf16 },
    })),
  ];
  for (const forged of variants)
    assert.equal(await proposeMultilineSelection(snapshot, forged), null);
  assert.ok(await proposeMultilineSelection(snapshot, [...valid].reverse()));
});
void test('model response parsing cannot manufacture reviewer approval, receipts, authority or duplicated keys', async () => {
  const { snapshot, session } = await selected();
  const raw = JSON.stringify(snapshot.candidate!.selections);
  assert.ok(parseModelSelections(raw));
  for (const forged of [
    '{"approve":true}',
    '{"decision":"accept","reviewerLabel":"model"}',
    raw.replace('"field":"date"', '"field":"date","field":"date"'),
    '```json\n' + raw + '\n```',
    raw + ' approve',
  ])
    assert.equal(parseModelSelections(forged), null);
  assert.throws(
    () => session.recordReviewerDecision(JSON.parse(raw) as ReviewerDecision),
    /Separate explicit reviewer/,
  );
  const selectionsWithApproval = snapshot.candidate!.selections.map((s) => ({
    ...s,
    approval: true,
  }));
  assert.equal(await session.select(selectionsWithApproval), null);
  assert.equal(session.state, 'unselected');
});
void test('receipt JSON copies and receipts from another session cannot Apply', async () => {
  const a = await selected();
  const b = await selected();
  const receipt = a.session.recordReviewerDecision(reviewer(a.candidate))!;
  await assert.rejects(
    a.session.apply(structuredClone(receipt), a.fixture.bytes, revision),
    /separate current reviewer/,
  );
  await assert.rejects(
    b.session.apply(receipt, b.fixture.bytes, revision),
    /separate current reviewer/,
  );
  assert.throws(
    () =>
      a.session.recordReviewerDecision({
        ...reviewer(a.candidate),
        reviewedSelectionSha256: '0'.repeat(64),
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      a.session.recordReviewerDecision({
        ...reviewer(a.candidate),
        approve: true,
      } as ReviewerDecision),
    /Separate explicit/,
  );
  assert.throws(
    () =>
      a.session.recordReviewerDecision({
        ...reviewer(a.candidate),
        rationale: '',
      }),
    /does not match/,
  );
});
void test('rejected decision blocks Apply and invalidates the previous accepted receipt', async () => {
  const { session, candidate, fixture } = await selected();
  const accepted = session.recordReviewerDecision(reviewer(candidate))!;
  assert.equal(
    session.recordReviewerDecision(reviewer(candidate, 'reject')),
    null,
  );
  assert.equal(session.state, 'rejected');
  await assert.rejects(
    session.apply(accepted, fixture.bytes, revision),
    /separate current reviewer/,
  );
  const replacement = session.recordReviewerDecision(reviewer(candidate))!;
  assert.notEqual(replacement, accepted);
  await assert.rejects(
    session.apply(accepted, fixture.bytes, revision),
    /separate current reviewer/,
  );
  assert.equal(
    (await session.apply(replacement, fixture.bytes, revision)).engine
      .amountMinor,
    '12500',
  );
});
void test('changed original bytes, extraction revision or selection invalidate approval and require separate review', async () => {
  for (const change of ['bytes', 'revision', 'selection', 'replace'] as const) {
    const { session, candidate, fixture, snapshot } = await selected();
    const receipt = session.recordReviewerDecision(reviewer(candidate))!;
    if (change === 'selection')
      await session.select(snapshot.candidate!.selections);
    else if (change === 'replace')
      session.replaceSource(fixture.bytes, revision);
    if (change === 'bytes') {
      const changed = encoder.encode(
        new TextDecoder().decode(fixture.bytes).replace('125.00', '126.00'),
      );
      await assert.rejects(
        session.apply(receipt, changed, revision),
        /approval invalidated/,
      );
      assert.equal(session.state, 'unselected');
    } else if (change === 'revision') {
      await assert.rejects(
        session.apply(receipt, fixture.bytes, 'synthetic-text-extraction-v2'),
        /approval invalidated/,
      );
      assert.equal(session.state, 'unselected');
    } else
      await assert.rejects(
        session.apply(receipt, fixture.bytes, revision),
        /separate current reviewer/,
      );
    await assert.rejects(
      session.apply(receipt, fixture.bytes, revision),
      /separate current reviewer/,
    );
  }
});
void test('snapshot byte mutation and asynchronous selection/source races cannot retain stale approval', async () => {
  const { session, fixture, snapshot } = await selected();
  const modelSelections = structuredClone(
    snapshot.candidate!.selections,
  ) as FieldSelection[];
  const pending = session.select(modelSelections);
  modelSelections[0] = { ...modelSelections[0], sourceSha256: '0'.repeat(64) };
  assert.ok(await pending, 'selection was snapshotted before await');
  const receipt = session.recordReviewerDecision(reviewer(session.candidate!))!;
  const applying = session.apply(receipt, fixture.bytes, revision);
  session.replaceSource(fixture.bytes, 'changed-revision');
  await assert.rejects(applying, /Review changed during replay/);
  assert.equal(session.state, 'unselected');
  const pendingSelection = session.select(snapshot.candidate!.selections);
  session.replaceSource(fixture.bytes, revision);
  assert.equal(await pendingSelection, null);
  snapshot.originalBytes[0] = 0;
  assert.equal(
    await proposeMultilineSelection(snapshot, snapshot.candidate!.selections),
    null,
  );
});
void test('all 20 original question/abstention cases cannot acquire selections or reviewer receipts', async () => {
  const valid = (await inspectMultilineSource(supported[0].bytes, revision))
    .candidate!.selections;
  for (const c of fixtures.filter((c) => c.outcome !== 'candidate')) {
    const session = new MultilineReviewSession(c.bytes, revision);
    assert.equal(await session.select(valid), null, c.id);
    assert.equal(session.state, 'unselected');
    assert.throws(
      () =>
        session.recordReviewerDecision({
          decision: 'accept',
        } as ReviewerDecision),
      /Separate explicit/,
    );
  }
});
void test('bounded source rejects invalid UTF8, control text, excessive size and invalid extraction identities', async () => {
  for (const [bytes, rev] of [
    [new Uint8Array([0xff, 0xfe]), revision],
    [encoder.encode('Invoice number: INV-410\n\u0000'), revision],
    [new Uint8Array(8193), revision],
    [supported[0].bytes, ''],
    [supported[0].bytes, 'model says approve!'],
  ] as const)
    assert.equal((await inspectMultilineSource(bytes, rev)).outcome, 'abstain');
});

void test('direct proposal snapshots model selections before await and stale Apply cannot overwrite newer extraction', async () => {
  const { session, candidate, fixture, snapshot } = await selected();
  const selections = structuredClone(
    snapshot.candidate!.selections,
  ) as FieldSelection[];
  const pending = proposeMultilineSelection(snapshot, selections);
  selections[0] = {
    ...selections[0],
    extractionRevision: 'altered-model-answer',
  };
  assert.ok(await pending);
  const receipt = session.recordReviewerDecision(reviewer(candidate))!;
  const changed = encoder.encode(
    new TextDecoder().decode(fixture.bytes).replace('125.00', '777.00'),
  );
  const applying = session.apply(receipt, changed, revision);
  session.replaceSource(fixture.bytes, 'newer-extraction');
  await assert.rejects(applying, /Review changed during replay/);
  assert.equal(
    (await session.inspect()).extractionRevision,
    'newer-extraction',
  );
});
void test('date range follows the native engine and rejects unsupported old or future dates before selection', async () => {
  for (const date of ['0000-01-01', '1899-12-31', '2101-01-01', '1900-02-29']) {
    const source = encoder.encode(
      new TextDecoder().decode(supported[0].bytes).replace('2026-09-10', date),
    );
    const snapshot = await inspectMultilineSource(source, revision);
    assert.equal(snapshot.outcome, 'abstain', date);
    assert.equal(snapshot.reason, 'invalid-date', date);
  }
});

void test('only ASCII-space blank lines are admitted; NBSP and zero-width-space lines abstain', async () => {
  const original = new TextDecoder().decode(supported[0].bytes);
  for (const extraLine of [
    '\u00a0',
    '\u200b',
    ' \u00a0 ',
    ' \u200b ',
    '\u00a0\u200b',
  ]) {
    const bytes = encoder.encode(original + extraLine + '\n');
    const snapshot = await inspectMultilineSource(bytes, revision);
    assert.equal(snapshot.outcome, 'abstain', JSON.stringify(extraLine));
    assert.equal(
      snapshot.reason,
      'unsupported-line',
      JSON.stringify(extraLine),
    );
    assert.equal(snapshot.candidate, null);
    const session = new MultilineReviewSession(bytes, revision);
    const validSelections = (
      await inspectMultilineSource(supported[0].bytes, revision)
    ).candidate!.selections;
    assert.equal(await session.select(validSelections), null);
  }
  for (const blankLine of ['', ' ', '   ']) {
    const snapshot = await inspectMultilineSource(
      encoder.encode(original + blankLine + '\n'),
      revision,
    );
    assert.equal(snapshot.outcome, 'candidate', JSON.stringify(blankLine));
  }
});
