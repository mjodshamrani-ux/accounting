import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { formatChoice } from '../lib/reconciliation/input-readiness.ts';
import {
  validateSectionNumberChoice,
  type SectionCurrencyContext,
} from '../lib/reconciliation/section-currency-context.ts';
import {
  defaultMapping,
  type Mapping,
  type SourceFile,
  type FormatChoice,
} from '../lib/reconciliation/types.ts';
import {
  inspectSectionContinuation,
  revalidateSectionContinuation,
  SectionOperationError,
  type SectionCellEvidence,
} from '../lib/reconciliation/section-continuation.ts';
import {
  SectionDerivedReadingSession,
  type SectionDerivedSelection,
  type SectionDerivedReviewerDecision,
  type SectionDerivedReceipt,
  type SectionDerivedReadingArtifact,
} from '../lib/reconciliation/section-derived-reading.ts';

const base = new URL(
  '../audit/p4-qualified-currency-v1/draft/frozen/',
  import.meta.url,
);
const revision = 'qualified-currency-original-v1';
const sha = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
type Golden = {
  originalSha256: string;
  originalByteLength: number;
  cuts: number[];
  inventory: { row: number; page: number; values: string[] }[];
  currencyContext?: {
    currency: string;
    decimals: number;
    precisionOrigin: string;
  };
  currencyEvidence: {
    sourceHash: string;
    row: number;
    page: number;
    column: number;
    literal: string;
  }[];
  links: {
    originalRow: number;
    page: number;
    derivedRow: number;
    reference: string;
    referenceOrigin: string;
    referenceParentRow: number;
    amountLiteral: string;
  }[];
  csvSha256?: string;
  csvRows?: string[][];
  amountMinor?: number[];
  signedAmounts?: string[];
};
const contract = JSON.parse(
  await readBytes(new URL('contract.json', base), 'utf8'),
) as {
  mapping: Partial<Mapping>;
  cuts: number[];
  cases: { id: string; original: string; expected: string; outcome: string }[];
};
const actions = JSON.parse(
  await readBytes(new URL('actions.json', base), 'utf8'),
) as {
  actions: { id: string; source: string }[];
};
const formatActions = JSON.parse(
  await readBytes(
    new URL('../format-addendum/actions-addendum.json', new URL('../', base)),
    'utf8',
  ),
) as {
  actions: { id: string }[];
};
async function fixture(
  id = 'kwd-cross-page',
  withChoice = true,
  selectedDecimals?: number,
) {
  const spec = contract.cases.find((c) => c.id === id)!;
  const bytes = await readBytes(new URL(spec.original, base));
  const golden = JSON.parse(
    await readBytes(new URL(spec.expected, base), 'utf8'),
  ) as Golden;
  const source = await readFile(
    spec.original,
    Uint8Array.from(bytes).buffer,
    golden.cuts,
  );
  const decimals =
    selectedDecimals ??
    golden.currencyContext?.decimals ??
    (id.startsWith('jpy') ? 0 : id.startsWith('kwd') ? 3 : 2);
  const mapping = { ...defaultMapping(), ...contract.mapping };
  const assessment = suggestFormats(source, mapping, decimals).numberFormat;
  if (withChoice && assessment.status === 'ambiguous')
    mapping.formatChoice = {
      numberFormat: formatChoice(
        source,
        mapping,
        'numberFormat',
        'dot',
        assessment.candidates,
        decimals,
      ),
    };
  return { spec, bytes, source, golden, mapping, decimals };
}
function decision(
  selection: SectionDerivedSelection,
  dotAck = true,
): SectionDerivedReviewerDecision {
  return {
    decision: 'accept',
    reviewerLabel: 'Independent frozen-contract test reviewer',
    rationale:
      'Review all original physical source cells and the explicit dot interpretation.',
    reviewedSourceHash: selection.review.sourceHash,
    reviewedExtractionHash: selection.review.extractionHash,
    reviewedExtractionRevision: selection.review.extractionRevision,
    reviewedSelectionHash: selection.selectionHash,
    acknowledgements: {
      originalRowsReviewed: true,
      referenceRolesReviewed: true,
      signedAmountsPreserved: true,
      derivedSourceUnderstood: true,
      ...(dotAck &&
      selection.review.originalNumberFormat?.status === 'ambiguous'
        ? { originalDotInterpretationReviewed: true as const }
        : {}),
    },
  };
}
async function inspected(f: Awaited<ReturnType<typeof fixture>>) {
  const session = new SectionDerivedReadingSession(
    f.source,
    f.mapping,
    revision,
    f.decimals,
  );
  const initial = await session.inspect();
  const selection = await session.selectProposalIds(
    initial.review.proposals.map((p) => p.id),
  );
  return { ...f, session, selection };
}
async function reviewed(id = 'kwd-cross-page') {
  const f = await inspected(await fixture(id));
  const input = decision(f.selection);
  const receipt = await f.session.recordReviewerDecision(input);
  assert.ok(receipt);
  return { ...f, input, receipt };
}
async function apply(f: Awaited<ReturnType<typeof reviewed>>) {
  return f.session.apply(f.receipt, f.source, f.mapping, revision, f.decimals);
}
function binding(e: SectionCellEvidence) {
  return {
    sourceHash: e.sourceHash,
    row: e.row,
    page: e.page,
    column: e.column,
    literal: e.literal,
  };
}
async function exactArtifact(
  f: Awaited<ReturnType<typeof reviewed>>,
  result: SectionDerivedReadingArtifact,
) {
  const csv = await readBytes(new URL(`${f.spec.id}.csv`, base), 'utf8');
  assert.equal(result.csv, csv);
  assert.equal(result.nativeSource.sha256, f.golden.csvSha256);
  assert.equal(
    sha(new Uint8Array(result.originalPdf)),
    f.golden.originalSha256,
  );
  assert.deepEqual(
    new Uint8Array(result.originalPdf),
    Uint8Array.from(f.bytes),
  );
  assert.deepEqual(result.nativeSource.sheets[0].rows, f.golden.csvRows);
  assert.equal(result.financialApproval, false);
  const provenance = result.provenance;
  assert.equal(provenance.financialApproval, false);
  assert.equal(provenance.scopeConfirmed, false);
  assert.ok(provenance.currencyContext);
  assert.equal(
    provenance.currencyContext.code,
    f.golden.currencyContext!.currency,
  );
  assert.equal(
    provenance.currencyContext.decimals,
    f.golden.currencyContext!.decimals,
  );
  assert.equal(
    provenance.currencyContext.precisionOrigin,
    'finite-contract-policy',
  );
  assert.deepEqual(
    provenance.currencyContext.headerCells.map(binding),
    f.golden.currencyEvidence,
  );
  for (const evidence of provenance.currencyContext.headerCells) {
    assert.equal(evidence.sourceHash, f.golden.originalSha256);
    assert.equal(evidence.extractionHash, f.selection.review.extractionHash);
    assert.equal(evidence.extractionRevision, revision);
    assert.equal(evidence.sheet, 1);
  }
  assert.deepEqual(
    provenance.inventory.map(({ originalRow: row, page, values }) => ({
      row,
      page,
      values,
    })),
    f.golden.inventory,
  );
  assert.deepEqual(
    provenance.links.map((link) => ({
      originalRow: link.originalRow,
      page: link.page,
      derivedRow: link.derivedRow,
      reference: link.reference,
      referenceOrigin: link.referenceOrigin,
      referenceParentRow: link.proposal?.parent.row ?? 2,
      amountLiteral: link.amountEvidence.literal,
    })),
    f.golden.links,
  );
  const fresh = await readFile(
    result.nativeSource.name,
    result.nativeSource.original!,
  );
  const scope = {
    supplier: '',
    entity: '',
    account: '',
    currency: provenance.currencyContext.code,
    decimals: f.decimals,
    cutoff: '2100-12-31',
    dateWindow: 0,
    confirmed: false,
    coverageConfirmed: false,
  };
  const prepared = prepareVerifiedSources([fresh], [result.mapping], scope, [
    'supplier',
  ]).sources[0];
  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(
    prepared.transactions.map((t) => t.amount),
    f.golden.amountMinor,
  );
  assert.deepEqual(
    prepared.transactions.map((t) => t.originalAmount),
    f.golden.signedAmounts,
  );
  assert.ok(
    prepared.transactions.every(
      (t) => t.currency === provenance.currencyContext!.code,
    ),
  );
  assert.equal(prepared.excluded.length, 1);
  assert.equal(prepared.excluded[0].kind, 'non-movement');
  assert.deepEqual(prepared.excluded[0].values, f.golden.csvRows![0]);
  if (f.selection.review.originalNumberFormat?.status === 'ambiguous') {
    assert.equal(
      provenance.reviewer.acknowledgements.originalDotInterpretationReviewed,
      true,
    );
    assert.deepEqual(
      provenance.originalNumberInterpretation,
      f.mapping.formatChoice!.numberFormat,
    );
    const rebound = formatChoice(
      fresh,
      result.mapping,
      'numberFormat',
      'dot',
      ['dot', 'comma'],
      f.decimals,
    );
    assert.deepEqual(provenance.derivedNumberInterpretation, rebound);
    assert.deepEqual(result.mapping.formatChoice!.numberFormat, rebound);
    assert.notEqual(rebound.sourceHash, f.source.sha256);
    assert.deepEqual(rebound.cuts, []);
  } else {
    assert.equal(provenance.originalNumberInterpretation, undefined);
    assert.equal(provenance.derivedNumberInterpretation, undefined);
    assert.equal(
      provenance.reviewer.acknowledgements.originalDotInterpretationReviewed,
      undefined,
    );
  }
}
void test('qualified frozen truth and all original native inventories stay exact', async () => {
  const frozen = JSON.parse(
    await readBytes(new URL('freeze.json', base), 'utf8'),
  ) as { files: Record<string, { sha256: string; bytes: number }> };
  assert.equal(contract.cases.length, 27);
  assert.equal(actions.actions.length, 18);
  assert.equal(formatActions.actions.length, 27);
  for (const [name, pin] of Object.entries(frozen.files)) {
    const bytes = await readBytes(new URL(name, base));
    assert.equal(sha(bytes), pin.sha256, name);
    assert.equal(bytes.length, pin.bytes, name);
  }
  for (const c of contract.cases) {
    const f = await fixture(c.id);
    assert.equal(f.source.sha256, f.golden.originalSha256);
    assert.equal(f.bytes.length, f.golden.originalByteLength);
    assert.deepEqual(
      f.source.sheets[0].rows.map((values, i) => ({
        row: i + 1,
        page: f.source.sheets[0].rowPages![String(i + 1)],
        values,
      })),
      f.golden.inventory,
      c.id,
    );
  }
});
for (const c of contract.cases.filter((c) => c.outcome === 'derived'))
  void test(`qualified native positive ${c.id} preserves exact CSV, money, all headers and original links`, async () => {
    const f = await reviewed(c.id);
    await exactArtifact(f, await apply(f));
    assert.equal(f.session.state, 'derived');
    await assert.rejects(apply(f), /current reviewer receipt/);
  });
for (const c of contract.cases.filter((c) => c.outcome === 'blocked'))
  void test(`qualified native refusal ${c.id} publishes no partial artifact`, async () => {
    const f = await fixture(c.id);
    const session = new SectionDerivedReadingSession(
      f.source,
      f.mapping,
      revision,
      f.decimals,
    );
    let receipt: SectionDerivedReceipt | null = null;
    await assert.rejects(async () => {
      const initial = await session.inspect();
      const selection = await session.selectProposalIds(
        initial.review.proposals.map((p) => p.id),
      );
      receipt = await session.recordReviewerDecision(decision(selection));
      assert.ok(receipt);
      await session.apply(receipt, f.source, f.mapping, revision, f.decimals);
    }, /Unsupported|Conflicting|boundaries|corrupt|justified|reference|precision|movement|choice/);
    if (receipt)
      await assert.rejects(
        session.apply(receipt, f.source, f.mapping, revision, f.decimals),
        /current reviewer receipt/,
      );
    assert.deepEqual(
      new Uint8Array(f.source.original!),
      Uint8Array.from(f.bytes),
    );
    assert.notEqual(session.state, 'derived');
  });
for (const id of ['bare-existing-family', 'description-code-only'])
  void test(`qualified control ${id} retains prior bare behavior with no currency authority`, async () => {
    const f = await reviewed(id);
    const result = await apply(f);
    assert.equal(f.selection.review.currencyContext, undefined);
    assert.equal(f.selection.review.originalNumberFormat, undefined);
    assert.equal(result.provenance.currencyContext, undefined);
    assert.deepEqual(result.nativeSource.sheets[0].rows[0], [
      'Date',
      'Reference',
      'Description',
      'Amount',
    ]);
  });
void test('qualified KWD negative own choice permits receipt then excess fraction consumes it at late Apply', async () => {
  const f = await reviewed('kwd-excess-fraction');
  assert.equal(
    f.source.sha256,
    'f0a46630f96660883c23ae3b5dbbfc9acaec4ba2fc7522037d5da885c7bca3cf',
  );
  assert.equal(f.selection.review.originalNumberFormat!.status, 'ambiguous');
  assert.equal(f.session.state, 'reviewed');
  await assert.rejects(apply(f), /boundaries|corrupt/);
  assert.equal(f.session.state, 'review-ready');
  await assert.rejects(apply(f), /current reviewer receipt/);
  const foreign = await fixture('kwd-on-page');
  const own = await fixture('kwd-excess-fraction');
  own.mapping.formatChoice = foreign.mapping.formatChoice;
  const blocked = await inspected(own);
  await assert.rejects(
    blocked.session.recordReviewerDecision(decision(blocked.selection)),
    /choice/,
  );
});
for (const [id, decimals] of [
  ['sar-on-page', 0],
  ['sar-on-page', 3],
  ['jpy-on-page', 2],
  ['kwd-on-page', 2],
] as const)
  void test(`qualified exponent ${id}/${decimals} refuses before receipt mint`, async () => {
    const f = await inspected(await fixture(id, true, decimals));
    await assert.rejects(
      f.session.recordReviewerDecision(decision(f.selection)),
      /exponent/,
    );
    assert.equal(f.session.state, 'review-ready');
  });
const choiceChanges: Record<string, (choice: FormatChoice) => void> = {
  'forged-choice-source-hash': (c) => {
    // Independent frozen KWD cross-page CSV hash, never the original PDF hash.
    c.sourceHash =
      'd991ddcf03ec87dadc230d8c9804f49248a16cea143b21af777411255b565b0a';
  },
  'choice-value-comma': (c) => {
    c.value = 'comma';
  },
  'choice-amount-column': (c) => {
    c.columns = [2];
  },
  'choice-header-row': (c) => {
    c.header = 1;
  },
  'choice-sheet': (c) => {
    c.sheet = 1;
  },
  'choice-exponent': (c) => {
    c.decimals = 2;
  },
  'choice-missing-candidate': (c) => {
    c.candidates = ['dot'];
  },
  'choice-extra-candidate': (c) => {
    c.candidates.push('other');
  },
  'choice-duplicate-candidate': (c) => {
    c.candidates = ['dot', 'dot'];
  },
  'choice-cuts': (c) => {
    c.cuts = [25, 46, 70];
  },
  'choice-exclusion': (c) => {
    c.excludedRows = [3];
  },
  'choice-balance-input': (c) => {
    c.balanceInputs = ['0', ''];
  },
};
for (const [id, change] of Object.entries(choiceChanges))
  void test(`qualified original action ${id} refuses fresh candidate/source binding before mint`, async () => {
    const f = await fixture();
    change(f.mapping.formatChoice!.numberFormat!);
    const inspectedSource = await inspected(f);
    await assert.rejects(
      inspectedSource.session.recordReviewerDecision(
        decision(inspectedSource.selection),
      ),
      /choice/,
    );
    assert.equal(inspectedSource.session.state, 'review-ready');
  });
for (const kind of ['missing-choice', 'missing-ack', 'false-ack'])
  void test(`qualified ambiguity ${kind} refuses before mint despite dot mapping`, async () => {
    const f = await inspected(
      await fixture('kwd-cross-page', kind !== 'missing-choice'),
    );
    const input = decision(f.selection, kind === 'missing-choice');
    if (kind === 'false-ack')
      Object.assign(input.acknowledgements, {
        originalDotInterpretationReviewed: false,
      });
    await assert.rejects(
      f.session.recordReviewerDecision(input),
      /choice|acknowledgement/,
    );
    assert.equal(f.session.state, 'review-ready');
  });
void test('qualified current extraction hash/revision and receipt copies never confer owned authority', async () => {
  for (const field of [
    'reviewedExtractionHash',
    'reviewedExtractionRevision',
  ] as const) {
    const f = await inspected(await fixture());
    const input = decision(f.selection);
    input[field] = 'changed';
    await assert.rejects(f.session.recordReviewerDecision(input), /not bound/);
  }
  const f = await reviewed();
  const foreignSession = new SectionDerivedReadingSession(
    f.source,
    f.mapping,
    revision,
    f.decimals,
  );
  await assert.rejects(
    foreignSession.apply(f.receipt, f.source, f.mapping, revision, f.decimals),
    /owned/,
  );
  for (const copied of [
    structuredClone(f.receipt),
    JSON.parse(JSON.stringify(f.receipt)),
  ])
    await assert.rejects(
      f.session.apply(copied, f.source, f.mapping, revision, f.decimals),
      /owned/,
    );
  await exactArtifact(f, await apply(f));
});
void test('qualified omitted/corrupted currency cells and changed cached/native original cannot replay', async () => {
  const f = await reviewed('sar-cross-page');
  for (const mutate of [
    (r: SectionDerivedSelection['review']) => {
      r.currencyContext!.headerCells.pop();
    },
    (r: SectionDerivedSelection['review']) => {
      r.currencyContext!.headerCells[1].page = 1;
    },
    (r: SectionDerivedSelection['review']) => {
      r.currencyContext!.headerCells[1].column = 3;
    },
    (r: SectionDerivedSelection['review']) => {
      r.currencyContext!.headerCells[1].literal = 'Signed amount (JPY)';
    },
    (r: SectionDerivedSelection['review']) => {
      r.currencyContext!.code = 'JPY';
    },
  ]) {
    const review = structuredClone(f.selection.review);
    mutate(review);
    await assert.rejects(
      revalidateSectionContinuation(
        review,
        f.source,
        f.mapping,
        revision,
        f.decimals,
      ),
      /stale or altered/,
    );
  }
  for (const mutate of [
    (s: SourceFile) => {
      s.sheets[0].rows[3][3] = 'Signed amount (JPY)';
    },
    (s: SourceFile) => {
      const offset = new TextDecoder().decode(s.original!).indexOf('SAR');
      assert.ok(offset >= 0);
      new Uint8Array(s.original!)[offset] = 'J'.charCodeAt(0);
    },
  ]) {
    const changed = structuredClone(f.source);
    mutate(changed);
    await assert.rejects(
      inspectSectionContinuation(changed, f.mapping, revision, f.decimals),
      /hash|differs/,
    );
  }
  await exactArtifact(f, await apply(f));
});
void test('qualified incomplete movement selection, rejection and current precision/revision/source changes consume authority', async () => {
  const f = await inspected(await fixture('sar-on-page'));
  const selection = await f.session.selectProposalIds(
    f.selection.selectedProposalIds.slice(1),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  await assert.rejects(
    f.session.apply(receipt, f.source, f.mapping, revision, f.decimals),
    /Every original movement/,
  );
  await assert.rejects(
    f.session.apply(receipt, f.source, f.mapping, revision, f.decimals),
    /current reviewer receipt/,
  );
  for (const kind of ['precision', 'revision', 'source']) {
    const current = await reviewed(
      kind === 'precision' ? 'kwd-on-page' : 'sar-on-page',
    );
    const replacement =
      kind === 'source'
        ? (await fixture('jpy-on-page')).source
        : current.source;
    await assert.rejects(
      current.session.apply(
        current.receipt,
        replacement,
        current.mapping,
        kind === 'revision' ? 'changed' : revision,
        kind === 'precision' ? 2 : current.decimals,
      ),
      /changed|stale/,
    );
    await assert.rejects(apply(current), /current reviewer receipt/);
  }
  const rejected = await reviewed();
  const rejection = { ...rejected.input, decision: 'reject' as const };
  assert.equal(await rejected.session.recordReviewerDecision(rejection), null);
  await assert.rejects(apply(rejected), /current reviewer receipt/);
});
void test('qualified exact citation budgets count all header cells, bare thresholds stay unchanged', async () => {
  const f = await fixture('sar-cross-page');
  const result = await inspectSectionContinuation(
    f.source,
    f.mapping,
    revision,
    f.decimals,
  );
  // Existing citation occurrences plus each context amount-header cell.
  const count =
    result.rows.reduce((n, row) => n + row.amounts.length, 0) +
    result.questions.reduce((n, q) => n + q.evidence.length, 0) +
    result.proposals.reduce(
      (n, p) =>
        n +
        2 +
        p.continuation.length +
        p.headers.flat().length +
        (p.parentSpan?.length ?? 0) +
        (p.continuationSpans?.flat().length ?? 0) +
        (p.headerBands?.flat().length ?? 0),
      0,
    ) +
    result.currencyContext!.headerCells.length;
  await inspectSectionContinuation(f.source, f.mapping, revision, f.decimals, {
    budgets: { maxEvidenceCells: count },
  });
  await assert.rejects(
    inspectSectionContinuation(f.source, f.mapping, revision, f.decimals, {
      budgets: { maxEvidenceCells: count - 1 },
    }),
    (e) => e instanceof SectionOperationError && e.code === 'resource-limit',
  );
  const ready = await reviewed('sar-cross-page');
  await assert.rejects(
    ready.session.apply(
      ready.receipt,
      ready.source,
      ready.mapping,
      revision,
      ready.decimals,
      { budgets: { maxEvidenceCells: count - 1 } },
    ),
    /resource-limit/,
  );
  await assert.rejects(apply(ready), /current reviewer receipt/);
});
void test('qualified new choice and acknowledgement metadata reject accessors/oversize with zero getter reads and caller clones', async () => {
  const f = await fixture();
  const nativeClone = globalThis.structuredClone;
  let getters = 0,
    clones = 0;
  const hostile = structuredClone(f.mapping);
  Object.defineProperty(hostile.formatChoice!.numberFormat!, 'candidates', {
    enumerable: true,
    get: () => {
      getters++;
      return ['dot', 'comma'];
    },
  });
  const oversized = structuredClone(f.mapping);
  oversized.formatChoice!.numberFormat!.candidates = Array(100001).fill('dot');
  const nested = structuredClone(f.mapping);
  Object.defineProperty(nested.formatChoice!.numberFormat!.cuts, '0', {
    enumerable: true,
    get: () => {
      getters++;
      return 25;
    },
  });
  const ready = await reviewed();
  const badDecision = decision(ready.selection);
  Object.defineProperty(
    badDecision.acknowledgements,
    'originalDotInterpretationReviewed',
    {
      enumerable: true,
      get: () => {
        getters++;
        return true;
      },
    },
  );
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    for (const reading of [hostile, nested, oversized]) {
      assert.throws(
        () =>
          new SectionDerivedReadingSession(
            f.source,
            reading,
            revision,
            f.decimals,
          ),
        /resource-limit/,
      );
      assert.equal(clones, 0);
    }
    await assert.rejects(
      ready.session.recordReviewerDecision(badDecision),
      /resource-limit/,
    );
    assert.equal(getters, 0);
    assert.equal(clones, 0);
    await assert.rejects(apply(ready), /current reviewer receipt/);
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
void test('qualified pre-aborted Apply refuses before caller getter or clone and consumes receipt', async () => {
  const f = await reviewed();
  let reads = 0,
    clones = 0;
  const hostile = { ...f.source };
  Object.defineProperty(hostile, 'name', {
    enumerable: true,
    get: () => {
      reads++;
      return f.source.name;
    },
  });
  const controller = new AbortController();
  controller.abort();
  const nativeClone = globalThis.structuredClone;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    await assert.rejects(
      f.session.apply(f.receipt, hostile, f.mapping, revision, f.decimals, {
        signal: controller.signal,
      }),
      /cancelled/,
    );
    assert.equal(reads, 0);
    assert.equal(clones, 0);
    await assert.rejects(apply(f), /current reviewer receipt/);
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
for (const kind of ['source', 'reading', 'decision'])
  void test(`qualified ownership late old-caller ${kind} mutation preserves exact native result`, async () => {
    const f = await reviewed();
    if (kind === 'decision') {
      const input = decision(f.selection);
      const pending = f.session.recordReviewerDecision(input);
      input.acknowledgements.originalDotInterpretationReviewed = undefined;
      input.reviewerLabel = 'late foreign label';
      f.receipt = (await pending)!;
    }
    let mutated = false;
    const result = await f.session.apply(
      f.receipt,
      f.source,
      f.mapping,
      revision,
      f.decimals,
      {
        onProgress: (p) => {
          if (p.stage !== 'pdf-read' || mutated) return;
          mutated = true;
          if (kind === 'source') {
            f.source.sheets[0].rows[0][3] = 'Signed amount (JPY)';
            new Uint8Array(f.source.original!)[10] ^= 1;
          }
          if (kind === 'reading') {
            f.mapping.numberFormat = 'comma';
            f.mapping.formatChoice!.numberFormat!.candidates = ['comma'];
          }
        },
      },
    );
    // Compare against a new independent original, not the now-mutated caller.
    const original = await fixture();
    await exactArtifact({ ...f, ...original }, result);
    assert.equal(
      result.provenance.reviewer.label,
      'Independent frozen-contract test reviewer',
    );
    if (kind !== 'decision') assert.equal(mutated, true);
  });
for (const kind of ['replace-source', 'replace-choice', 'reviewer', 'cancel'])
  void test(`qualified ${kind} during native replay prevents publication and receipt reuse`, async () => {
    const f = await reviewed();
    const controller = new AbortController();
    let changed = false;
    await assert.rejects(
      f.session.apply(f.receipt, f.source, f.mapping, revision, f.decimals, {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.stage !== 'pdf-read' || changed) return;
          changed = true;
          if (kind === 'cancel') controller.abort();
          else if (kind === 'reviewer') f.session.updateReviewer('', '');
          else {
            const reading = structuredClone(f.mapping);
            const source = structuredClone(f.source);
            if (kind === 'replace-choice')
              reading.formatChoice!.numberFormat!.value = 'comma';
            else {
              source.sheets[0].rows[0][3] = 'Signed amount (JPY)';
            }
            f.session.replaceSource(source, reading, revision, f.decimals);
          }
        },
      }),
      /changed while|cancelled/,
    );
    assert.equal(changed, true);
    assert.notEqual(f.session.state, 'derived');
    await assert.rejects(apply(f), /current reviewer receipt/);
  });
void test('qualified generation change during receipt native replay prevents stale mint; external selection changes are inert', async () => {
  const f = await inspected(await fixture());
  const pending = f.session.recordReviewerDecision(decision(f.selection));
  f.session.updateReviewer('', '');
  await assert.rejects(pending, /changed while/);
  const fresh = await reviewed();
  fresh.selection.review.currencyContext!.headerCells.length = 0;
  fresh.selection.review.originalNumberFormat!.candidates.length = 0;
  await exactArtifact(
    { ...fresh, selection: (await inspected(await fixture())).selection },
    await apply(fresh),
  );
});

void test('qualified fresh alternative cuts cannot mint despite a reconstructed own dot choice', async () => {
  const f = await fixture();
  for (const cuts of [
    [25, 46, 70],
    [24, 45, 70],
  ]) {
    const source = await readFile(
      f.spec.original,
      Uint8Array.from(f.bytes).buffer,
      cuts,
    );
    const mapping = { ...defaultMapping(), ...contract.mapping };
    const formats = suggestFormats(source, mapping, f.decimals).numberFormat;
    assert.deepEqual(formats.candidates, ['dot', 'comma']);
    mapping.formatChoice = {
      numberFormat: formatChoice(
        source,
        mapping,
        'numberFormat',
        'dot',
        formats.candidates,
        f.decimals,
      ),
    };
    assert.deepEqual(mapping.formatChoice.numberFormat!.cuts, cuts);
    const session = new SectionDerivedReadingSession(
      source,
      mapping,
      revision,
      f.decimals,
    );
    let receipt: SectionDerivedReceipt | null = null;
    await assert.rejects(async () => {
      const review = await session.inspect();
      const selection = await session.selectProposalIds(
        review.review.proposals.map((p) => p.id),
      );
      receipt = await session.recordReviewerDecision(decision(selection));
    }, /qualified currency extraction cuts/);
    assert.equal(receipt, null);
    assert.notEqual(session.state, 'derived');
  }
});

void test('qualified public adapter refuses malformed finite context before property getters or cloning', async () => {
  const f = await fixture();
  let getters = 0,
    clones = 0;
  const accessor = { decimals: 3 };
  Object.defineProperty(accessor, 'code', {
    enumerable: true,
    get: () => {
      getters++;
      return 'KWD';
    },
  });
  const contexts: unknown[] = [
    null,
    undefined,
    {},
    [],
    { code: 'USD', decimals: 2 },
    { code: 'KWD', decimals: 2 },
    { code: 'toString', decimals: 2 },
    {
      code: {
        toString: () => {
          getters++;
          return 'KWD';
        },
      },
      decimals: 3,
    },
    accessor,
  ];
  const nativeClone = globalThis.structuredClone;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    for (const context of contexts)
      assert.throws(
        () =>
          validateSectionNumberChoice(
            f.source,
            f.mapping,
            context as SectionCurrencyContext,
          ),
        (error) =>
          error instanceof Error &&
          error.name === 'Error' &&
          /finite qualified currency context/.test(error.message),
      );
    assert.equal(getters, 0);
    assert.equal(clones, 0);
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
