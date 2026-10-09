import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import {
  defaultMapping,
  type SourceFile,
} from '../lib/reconciliation/types.ts';
import {
  inspectSectionContinuation,
  revalidateSectionContinuation,
  SectionOperationError,
  type SectionCellEvidence,
  type SectionOperationOptions,
  type SectionResourceBudgets,
} from '../lib/reconciliation/section-continuation.ts';
import {
  SectionDerivedReadingSession,
  type SectionDerivedReviewerDecision,
  type SectionDerivedSelection,
  type SectionDerivedReceipt,
} from '../lib/reconciliation/section-derived-reading.ts';

const base = new URL(
  '../audit/p4-multicell-section-v1/frozen/',
  import.meta.url,
);
type Case = { id: string; original: string; expected: string; outcome: string };
type LiteralCell = {
  row: number;
  page: number;
  column: number;
  literal: string;
};
type Golden = {
  originalSha256: string;
  inventory: { row: number; page: number; values: string[] }[];
  proposals: {
    targetRow: number;
    reference: string;
    parentCells: LiteralCell[];
    continuationCells: LiteralCell[][];
    headerCells: LiteralCell[][];
  }[];
  links: {
    originalRow: number;
    page: number;
    derivedRow: number;
    reference: string;
    referenceOrigin: string;
  }[];
  csvSha256?: string;
  csvRows?: string[][];
  signedAmounts?: string[];
  amountMinor?: number[];
};
const contract = JSON.parse(
  await readBytes(new URL('contract.json', base), 'utf8'),
) as {
  cases: Case[];
  cuts: number[];
  revision: string;
  defaultBudgets: SectionResourceBudgets;
};
const actions = JSON.parse(
  await readBytes(new URL('actions.json', base), 'utf8'),
) as {
  actions: {
    id: string;
    source: string;
    expected: string;
    budget?: Partial<SectionResourceBudgets>;
    selectedMovementRows?: number[];
  }[];
};
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  description: 2,
  amount: 3,
  pdfReviewed: true,
};
const revision = contract.revision;
const sha = (data: Uint8Array | string) =>
  createHash('sha256').update(data).digest('hex');
const literal = ({
  row,
  page,
  column,
  literal,
}: SectionCellEvidence): LiteralCell => ({ row, page, column, literal });
async function fixture(id = 'pair-signed') {
  const c = contract.cases.find((candidate) => candidate.id === id) ?? {
    id,
    original: id + '.pdf',
    expected: id + '.expected.json',
    outcome: 'resource',
  };
  const original = await readBytes(new URL(c.original, base));
  const golden = JSON.parse(
    await readBytes(new URL(c.expected, base), 'utf8'),
  ) as Golden;
  const source = await readFile(
    c.original,
    Uint8Array.from(original).buffer,
    contract.cuts,
  );
  const session = new SectionDerivedReadingSession(
    source,
    mapping,
    revision,
    2,
  );
  return { source, session, original, golden, c };
}
function decision(
  selection: SectionDerivedSelection,
): SectionDerivedReviewerDecision {
  return {
    decision: 'accept',
    reviewerLabel: 'Independent synthetic contract actor',
    rationale:
      'Explicit review of original section role/value cells and every signed movement.',
    reviewedSourceHash: selection.review.sourceHash,
    reviewedExtractionHash: selection.review.extractionHash,
    reviewedExtractionRevision: selection.review.extractionRevision,
    reviewedSelectionHash: selection.selectionHash,
    acknowledgements: {
      originalRowsReviewed: true,
      referenceRolesReviewed: true,
      signedAmountsPreserved: true,
      derivedSourceUnderstood: true,
    },
  };
}
async function reviewed(id = 'pair-signed', targets?: number[]) {
  const f = await fixture(id);
  const inspected = await f.session.inspect();
  const selected = await f.session.selectProposalIds(
    inspected.review.proposals
      .filter((p) => !targets || targets.includes(p.target.row))
      .map((p) => p.id),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selected));
  assert.ok(receipt);
  return { ...f, selected, receipt };
}
function allRows(source: SourceFile) {
  return source.sheets[0].rows.map((values, index) => ({
    row: index + 1,
    page: source.sheets[0].rowPages![String(index + 1)],
    values,
  }));
}
void test('the pre-code independent multicell freeze and generator remain exact', async () => {
  const frozen = JSON.parse(
    await readBytes(new URL('freeze.json', base), 'utf8'),
  ) as {
    authorship: string;
    generatorSha256: string;
    files: Record<string, string>;
  };
  assert.match(frozen.authorship, /before multicell engine implementation/);
  assert.equal(Object.keys(frozen.files).length, 74);
  assert.equal(contract.cases.length, 30);
  assert.equal(actions.actions.length, 21);
  for (const [name, digest] of Object.entries(frozen.files))
    assert.equal(sha(await readBytes(new URL(name, base))), digest, name);
  assert.equal(
    sha(await readBytes(new URL('../freeze.py', base))),
    frozen.generatorSha256,
  );
});
for (const c of contract.cases) {
  void test(`independent original truth: ${c.id}`, async () => {
    if (c.outcome === 'native-import-blocked') {
      const original = await readBytes(new URL(c.original, base));
      await assert.rejects(
        readFile(c.original, Uint8Array.from(original).buffer, contract.cuts),
        (error: unknown) =>
          error instanceof Error &&
          'diagnosis' in error &&
          (error.diagnosis as { code: string }).code ===
            'PDF_NO_EXTRACTABLE_TEXT',
      );
      return;
    }
    const f = await reviewed(c.id);
    const before = structuredClone(f.source);
    assert.deepEqual(allRows(f.source), f.golden.inventory);
    assert.deepEqual(
      f.selected.review.rows.map(({ row, page, values }) => ({
        row,
        page,
        values,
      })),
      f.golden.inventory,
    );
    assert.equal(f.selected.review.sourceVerified, true);
    assert.equal(f.selected.review.sourceHash, f.golden.originalSha256);
    if (c.outcome === 'blocked') {
      // Empty frozen proposals/links mean no accepted derivation assertions;
      // valid earlier diagnostic suggestions need not be erased from review.
      await assert.rejects(
        f.session.apply(f.receipt, f.source, mapping, revision),
      );
      assert.equal(f.session.state, 'review-ready');
      await assert.rejects(
        f.session.apply(f.receipt, f.source, mapping, revision),
        /current reviewer receipt/,
      );
      assert.deepEqual(f.source, before);
      return;
    }
    assert.deepEqual(
      f.selected.review.proposals.map((p) => ({
        targetRow: p.target.row,
        reference: p.reference,
        parentCells: (p.parentSpan ?? [p.parent]).map(literal),
        continuationCells: (
          p.continuationSpans ?? p.continuation.map((cell) => [cell])
        ).map((span) => span.map(literal)),
        headerCells: p.headers.map((span) => span.map(literal)),
      })),
      f.golden.proposals,
    );
    for (const p of f.selected.review.proposals) {
      for (const evidence of [
        p.target,
        p.parent,
        ...p.continuation,
        ...p.headers.flat(),
        ...(p.parentSpan ?? []),
        ...(p.continuationSpans?.flat() ?? []),
      ]) {
        assert.equal(evidence.sourceHash, f.golden.originalSha256);
        assert.equal(evidence.extractionHash, f.selected.review.extractionHash);
        assert.equal(evidence.extractionRevision, revision);
        assert.equal(evidence.sheet, 1);
        assert.equal(
          evidence.literal,
          f.golden.inventory[evidence.row - 1].values[evidence.column - 1],
        );
        assert.equal(evidence.page, f.golden.inventory[evidence.row - 1].page);
      }
      assert.deepEqual(p.parent, (p.parentSpan ?? [p.parent]).at(-1));
    }
    const result = await f.session.apply(
      f.receipt,
      f.source,
      mapping,
      revision,
    );
    const expectedCsv = await readBytes(new URL(c.id + '.csv', base));
    assert.equal(result.csv, expectedCsv.toString());
    assert.deepEqual(Buffer.from(result.nativeSource.original!), expectedCsv);
    assert.equal(result.nativeSource.sha256, f.golden.csvSha256);
    assert.deepEqual(result.nativeSource.sheets[0].rows, f.golden.csvRows);
    assert.deepEqual(Buffer.from(result.originalPdf), f.original);
    assert.equal(result.financialApproval, false);
    assert.equal(result.provenance.financialApproval, false);
    assert.equal(result.nativeSource.kind, undefined);
    assert.deepEqual(
      result.provenance.inventory.map(({ originalRow, page, values }) => ({
        row: originalRow,
        page,
        values,
      })),
      f.golden.inventory,
    );
    assert.deepEqual(
      result.provenance.links.map(
        ({ originalRow, page, derivedRow, reference, referenceOrigin }) => ({
          originalRow,
          page,
          derivedRow,
          reference,
          referenceOrigin,
        }),
      ),
      f.golden.links,
    );
    assert.deepEqual(
      result.provenance.links.map((link) => link.amountEvidence.literal),
      f.golden.signedAmounts,
    );
    for (const link of result.provenance.links) {
      assert.equal(
        result.provenance.inventory[link.originalRow - 1].derivedRow,
        link.derivedRow,
      );
      // A legacy single-cell parent retains its complete label literal; paired
      // parent evidence is the separate value cell, never a joined string.
      const parentCells = f.golden.proposals.find(
        (p) => p.targetRow === link.originalRow,
      )?.parentCells;
      assert.equal(
        link.referenceEvidence.literal,
        parentCells?.at(-1)?.literal ?? link.reference,
      );
      if (link.proposal)
        assert.deepEqual(
          link.proposal,
          f.selected.review.proposals.find(
            (p) => p.target.row === link.originalRow,
          ),
        );
    }
    const fresh = await readFile(
      result.nativeSource.name,
      Uint8Array.from(expectedCsv).buffer,
    );
    const prepared = prepareVerifiedSources(
      [fresh],
      [result.mapping],
      {
        supplier: '',
        entity: '',
        account: '',
        currency: 'XXX',
        decimals: 2,
        cutoff: '2100-12-31',
        dateWindow: 0,
        confirmed: false,
        coverageConfirmed: false,
      },
      ['supplier'],
    ).sources[0];
    assert.deepEqual(prepared.errors, []);
    assert.deepEqual(
      prepared.transactions.map((row) => row.amount),
      f.golden.amountMinor,
    );
    assert.deepEqual(
      prepared.transactions.map((row) => row.originalAmount),
      f.golden.signedAmounts,
    );
    assert.equal(prepared.excluded.length, 1);
    assert.deepEqual(f.source, before);
  });
}
for (const action of actions.actions) {
  void test(`independent refusal action: ${action.id}`, async () => {
    const id = action.source.replace(/\.pdf$/, '');
    const f = await fixture(id);
    const before = structuredClone(f.source);
    if (
      action.budget ||
      action.id === 'pre-aborted' ||
      action.id === 'native-read-aborted' ||
      action.id === 'row-walk-aborted' ||
      action.id === 'replace-during-original-replay' ||
      action.id === 'reviewer-cleared-during-replay'
    ) {
      const controller = new AbortController();
      const progress: { stage: string; completed: number }[] = [];
      if (action.id === 'pre-aborted') controller.abort();
      const options: SectionOperationOptions = {
        signal: controller.signal,
        budgets: action.budget,
        onProgress: (p) => {
          progress.push(p);
          if (p.stage === 'pdf-read' && p.completed === 1) {
            if (action.id === 'native-read-aborted') controller.abort();
            if (action.id === 'replace-during-original-replay')
              f.session.replaceSource(f.source, mapping, revision);
            if (action.id === 'reviewer-cleared-during-replay')
              f.session.updateReviewer('', '');
          }
          if (
            p.stage === 'section-rows' &&
            p.completed === 256 &&
            action.id === 'row-walk-aborted'
          )
            controller.abort();
        },
      };
      await assert.rejects(f.session.inspect(options), (error: unknown) => {
        if (action.budget)
          return (
            error instanceof SectionOperationError &&
            error.code ===
              (action.expected === 'invalid-budget-blocked'
                ? 'invalid-budget'
                : 'resource-limit')
          );
        return (
          error instanceof Error &&
          /cancelled|changed while/.test(error.message)
        );
      });
      assert.equal(f.session.selection, null);
      assert.equal(f.session.state, 'empty');
      if (
        action.id === 'native-read-aborted' ||
        action.id === 'replace-during-original-replay' ||
        action.id === 'reviewer-cleared-during-replay'
      ) {
        assert.ok(
          progress.some((p) => p.stage === 'pdf-read' && p.completed === 1),
        );
        assert.ok(
          !progress.some((p) => p.stage === 'pdf-read' && p.completed > 1),
        );
        assert.ok(!progress.some((p) => p.stage === 'pdf-layout'));
      }
      if (action.id === 'row-walk-aborted')
        assert.ok(
          progress.some(
            (p) => p.stage === 'section-rows' && p.completed === 256,
          ),
        );
      await assert.rejects(
        f.session.recordReviewerDecision({} as SectionDerivedReviewerDecision),
        /separate explicit/,
      );
    } else if (
      action.id.startsWith('cached-') ||
      action.id === 'original-bytes-tamper'
    ) {
      const tampered = structuredClone(f.source);
      if (action.id === 'cached-parent-value-tamper')
        tampered.sheets[0].rows[1][1] = 'INV-999';
      if (action.id === 'cached-parent-role-tamper')
        tampered.sheets[0].rows[1][0] = 'Invoice Number';
      if (action.id === 'cached-page-tamper')
        tampered.sheets[0].rowPages!['5'] = 1;
      if (action.id === 'original-bytes-tamper')
        new Uint8Array(tampered.original!)[10] ^= 1;
      const callerBefore = structuredClone(tampered);
      await assert.rejects(
        inspectSectionContinuation(tampered, mapping, revision),
        /hash does not match|differs from the fresh original|physical page provenance/,
      );
      assert.deepEqual(tampered, callerBefore);
    } else if (action.id === 'proposal-span-tamper') {
      const review = await inspectSectionContinuation(
        f.source,
        mapping,
        revision,
      );
      review.proposals[1].continuationSpans![0][0].literal =
        'Continued invoice No';
      await assert.rejects(
        revalidateSectionContinuation(review, f.source, mapping, revision),
        /stale or altered/,
      );
      const unaltered = await inspectSectionContinuation(
        f.source,
        mapping,
        revision,
      );
      unaltered.proposals[0].parentSpan![0].column = 2;
      await assert.rejects(
        revalidateSectionContinuation(unaltered, f.source, mapping, revision),
        /stale or altered/,
      );
    } else {
      const inspected = await f.session.inspect();
      const selected = await f.session.selectProposalIds(
        inspected.review.proposals
          .filter(
            (p) =>
              !action.selectedMovementRows ||
              action.selectedMovementRows.includes(p.target.row),
          )
          .map((p) => p.id),
      );
      const receipt = await f.session.recordReviewerDecision(
        decision(selected),
      );
      assert.ok(receipt);
      let supplied = receipt;
      let reading = mapping;
      let currentRevision = revision;
      if (action.id === 'post-review-source-swap')
        f.session.replaceSource(f.source, mapping, revision);
      if (action.id === 'post-review-mapping-swap')
        reading = { ...mapping, amount: 2 };
      if (action.id === 'post-review-revision-swap')
        currentRevision += '-changed';
      if (action.id === 'receipt-clone') {
        supplied = structuredClone(receipt) as SectionDerivedReceipt;
        await assert.rejects(
          f.session.apply(
            JSON.parse(JSON.stringify(receipt)),
            f.source,
            reading,
            currentRevision,
          ),
          /current reviewer receipt/,
        );
      }
      await assert.rejects(
        f.session.apply(supplied, f.source, reading, currentRevision),
      );
      // Counterfeit attempts never consume someone else's real receipt. Every
      // owned refused Apply and every source update does consume current power.
      if (action.id !== 'receipt-clone') {
        assert.notEqual(f.session.state, 'reviewed');
        await assert.rejects(
          f.session.apply(receipt, f.source, mapping, revision),
          /current reviewer receipt/,
        );
      }
    }
    assert.deepEqual(f.source, before);
  });
}
void test('Apply cancellation and owned generation changes stop native replay and consume the current receipt', async () => {
  for (const change of [
    'signal',
    'source',
    'reviewer',
    'row-walk',
    'derived-walk',
  ]) {
    const f = await reviewed('resource-cancellation');
    const controller = new AbortController();
    const progress: { stage: string; completed: number }[] = [];
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision, 2, {
        signal: controller.signal,
        onProgress: (p) => {
          progress.push(p);
          if (p.stage === 'pdf-read' && p.completed === 1) {
            if (change === 'signal') controller.abort();
            if (change === 'source')
              f.session.replaceSource(f.source, mapping, revision);
            if (change === 'reviewer') f.session.updateReviewer('', '');
          }
          if (
            change === 'row-walk' &&
            p.stage === 'section-rows' &&
            p.completed === 256
          )
            controller.abort();
          if (
            change === 'derived-walk' &&
            p.stage === 'section-rows' &&
            p.phase === 'derived' &&
            p.completed === 256
          )
            controller.abort();
        },
      }),
      /cancelled|changed while/,
    );
    if (change !== 'row-walk' && change !== 'derived-walk')
      assert.ok(
        !progress.some((p) => p.stage === 'pdf-read' && p.completed > 1),
      );
    assert.notEqual(f.session.state, 'reviewed');
    assert.notEqual(f.session.state, 'derived');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('budget boundaries are inclusive, all serialized citation occurrences count, and lower Apply budgets consume authority', async () => {
  const f = await fixture();
  // Independent pair-signed truth has 4 rows, 2 proposals, 2 amount citations,
  // and for each proposal 1 target + 1 value + 2 parent-span occurrences = 10.
  const exact: Partial<SectionResourceBudgets> = {
    maxOriginalBytes: f.original.byteLength,
    maxPages: 1,
    maxRows: 4,
    maxProposals: 2,
    maxEvidenceCells: 10,
  };
  const review = await inspectSectionContinuation(
    f.source,
    mapping,
    revision,
    2,
    { budgets: exact },
  );
  assert.equal(review.proposals.length, 2);
  await assert.rejects(
    inspectSectionContinuation(f.source, mapping, revision, 2, {
      budgets: { ...exact, maxEvidenceCells: 9 },
    }),
    (error: unknown) =>
      error instanceof SectionOperationError && error.code === 'resource-limit',
  );
  for (const budget of actions.actions.filter((action) => action.budget)) {
    const ready = await reviewed(
      budget.id === 'page-budget' ? 'pair-cross-page' : 'pair-signed',
    );
    await assert.rejects(
      ready.session.apply(ready.receipt, ready.source, mapping, revision, 2, {
        budgets: budget.budget,
      }),
      (error: unknown) =>
        error instanceof SectionOperationError &&
        error.code ===
          (budget.id === 'invalid-budget'
            ? 'invalid-budget'
            : 'resource-limit'),
    );
    assert.equal(ready.session.state, 'review-ready');
    await assert.rejects(
      ready.session.apply(ready.receipt, ready.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('resource preflight runs before caller cache cloning and cancellation policy is captured before awaiting native replay', async () => {
  const f = await fixture();
  // A function cannot be cloned; the original-byte bound must reject first.
  const tooLarge = {
    ...f.source,
    original: new ArrayBuffer(8388609),
    impossibleClone: () => {},
  } as SourceFile;
  await assert.rejects(
    inspectSectionContinuation(tooLarge, mapping, revision),
    (error: unknown) =>
      error instanceof SectionOperationError && error.code === 'resource-limit',
  );
  assert.throws(
    () => new SectionDerivedReadingSession(tooLarge, mapping, revision),
    (error: unknown) =>
      error instanceof SectionOperationError && error.code === 'resource-limit',
  );
  const budgets: Partial<SectionResourceBudgets> = { maxRows: 4 };
  const controller = new AbortController();
  const options: SectionOperationOptions = {
    budgets,
    signal: controller.signal,
    onProgress: (p) => {
      if (p.stage === 'pdf-read' && p.completed === 0) budgets.maxRows = 1;
    },
  };
  assert.equal(
    (await inspectSectionContinuation(f.source, mapping, revision, 2, options))
      .proposals.length,
    2,
  );
  const pending = inspectSectionContinuation(f.source, mapping, revision, 2, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof SectionOperationError && error.code === 'cancelled',
  );
});
void test('a real event-loop cancellation between row chunks stops before publishing a review', async () => {
  const f = await fixture('resource-cancellation');
  const controller = new AbortController();
  const rowProgress: number[] = [];
  let fired = false;
  await assert.rejects(
    f.session.inspect({
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.stage !== 'section-rows') return;
        rowProgress.push(progress.completed);
        if (progress.completed === 256)
          setTimeout(() => {
            fired = true;
            controller.abort();
          }, 0);
      },
    }),
    (error: unknown) =>
      error instanceof SectionOperationError && error.code === 'cancelled',
  );
  assert.equal(fired, true);
  assert.deepEqual(rowProgress, [256]);
  assert.equal(f.session.selection, null);
  assert.equal(f.session.state, 'empty');
});
void test('source and reading metadata attacks are refused before any caller structuredClone', async () => {
  const f = await fixture();
  const nativeClone = globalThis.structuredClone;
  const attacks: { source: SourceFile; reading: typeof mapping }[] = [];
  for (const mutate of [
    (source: SourceFile) => {
      source.pdf!.cuts = Array(100001).fill(1);
    },
    (source: SourceFile) => {
      source.sheets[0].rowPages = Object.fromEntries(
        Array.from({ length: 20001 }, (_, index) => [String(index + 1), 1]),
      );
    },
    (source: SourceFile) => {
      source.sheets[0].rowIssues = { '1': Array(20001).fill('issue') };
    },
    (source: SourceFile) => {
      source.sheets[0].cellNotes = Object.fromEntries(
        Array.from({ length: 20001 }, (_, index) => [
          String(index + 1) + ':1',
          [],
        ]),
      );
    },
    (source: SourceFile) => {
      source.sheets[0].pdfTextTransforms = {
        '1': Array(20001).fill({}),
      } as SourceFile['sheets'][number]['pdfTextTransforms'];
    },
    (source: SourceFile) => {
      source.sheets[0].name = 'x'.repeat(4097);
    },
    (source: SourceFile) => {
      Object.assign(source, { extraPayload: new ArrayBuffer(1024 * 1024) });
    },
    (source: SourceFile) => {
      Object.defineProperty(source.sheets[0], 'name', {
        enumerable: true,
        get: () => 'PDF',
      });
    },
  ]) {
    const source = nativeClone(f.source);
    mutate(source);
    attacks.push({ source, reading: mapping });
  }
  for (const mutate of [
    (reading: typeof mapping) => {
      reading.excluded = Object.fromEntries(
        Array.from({ length: 20001 }, (_, index) => [String(index + 1), 'x']),
      );
    },
    (reading: typeof mapping) => {
      reading.opening = 'x'.repeat(4097);
    },
    (reading: typeof mapping) => {
      Object.assign(reading, { extraPayload: Array(100001).fill('x') });
    },
  ]) {
    const reading = nativeClone(mapping);
    mutate(reading);
    attacks.push({ source: f.source, reading });
  }
  let clones = 0;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    for (const attack of attacks) {
      clones = 0;
      await assert.rejects(
        inspectSectionContinuation(attack.source, attack.reading, revision),
        (error: unknown) =>
          error instanceof SectionOperationError &&
          error.code === 'resource-limit',
      );
      assert.equal(clones, 0);
      assert.throws(
        () =>
          new SectionDerivedReadingSession(
            attack.source,
            attack.reading,
            revision,
          ),
        (error: unknown) =>
          error instanceof SectionOperationError &&
          error.code === 'resource-limit',
      );
      assert.equal(clones, 0);
    }
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
void test('reviewer metadata and oversized proposal IDs invalidate old power before clone or element/Set iteration', async () => {
  const f = await reviewed();
  const oversized = decision(f.selected);
  oversized.rationale = 'x'.repeat(100001);
  const nativeClone = globalThis.structuredClone;
  let clones = 0;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    await assert.rejects(
      f.session.recordReviewerDecision(oversized),
      /resource-limit/,
    );
    assert.equal(clones, 0);
    assert.equal(f.session.state, 'review-ready');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
    assert.equal(clones, 0);
    const malformed = decision(f.selected);
    Object.assign(malformed.acknowledgements, {
      extraPayload: Array(100001).fill(true),
    });
    await assert.rejects(
      f.session.recordReviewerDecision(malformed),
      /resource-limit/,
    );
    assert.equal(clones, 0);
    const ids = Array<string>(100001).fill('fake');
    let elementReads = 0;
    Object.defineProperty(ids, '0', {
      get: () => {
        elementReads++;
        return 'fake';
      },
    });
    await assert.rejects(
      f.session.selectProposalIds(ids),
      /invalid or duplicated/,
    );
    assert.equal(elementReads, 0);
    assert.equal(clones, 0);
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
void test('pre-aborted cancellation happens before metadata access/clone and refused owned Apply cannot reuse its receipt', async () => {
  const f = await reviewed();
  const controller = new AbortController();
  controller.abort();
  let getterReads = 0;
  const hostile = { ...f.source };
  Object.defineProperty(hostile, 'name', {
    enumerable: true,
    get: () => {
      getterReads++;
      return f.source.name;
    },
  });
  const nativeClone = globalThis.structuredClone;
  let clones = 0;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return nativeClone(...args);
  }) as typeof structuredClone;
  try {
    await assert.rejects(
      inspectSectionContinuation(hostile, mapping, revision, 2, {
        signal: controller.signal,
      }),
      /cancelled/,
    );
    await assert.rejects(
      f.session.apply(f.receipt, hostile, mapping, revision, 2, {
        signal: controller.signal,
      }),
      /cancelled/,
    );
    assert.equal(getterReads, 0);
    assert.equal(clones, 0);
    assert.equal(f.session.state, 'review-ready');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  } finally {
    globalThis.structuredClone = nativeClone;
  }
});
void test('nested PDF accessors and non-native array iterators are refused before evaluation or clone', async () => {
  const f = await fixture();
  const nativeClone = globalThis.structuredClone;
  let clones = 0;
  let metadataReads = 0;
  for (const key of ['pages', 'cuts', 'autoColumns']) {
    const source = nativeClone(f.source);
    Object.defineProperty(source.pdf!, key, {
      enumerable: true,
      get: () => {
        metadataReads++;
        return key === 'cuts' ? [25, 45, 69] : 1;
      },
    });
    globalThis.structuredClone = ((
      ...args: Parameters<typeof structuredClone>
    ) => {
      clones++;
      return nativeClone(...args);
    }) as typeof structuredClone;
    try {
      await assert.rejects(
        inspectSectionContinuation(source, mapping, revision),
        /resource-limit/,
      );
      assert.equal(metadataReads, 0);
      assert.equal(clones, 0);
    } finally {
      globalThis.structuredClone = nativeClone;
    }
  }
  const source = nativeClone(f.source);
  Object.setPrototypeOf(source.sheets, {
    [Symbol.iterator]: () => {
      metadataReads++;
      return [][Symbol.iterator]();
    },
  });
  await assert.rejects(
    inspectSectionContinuation(source, mapping, revision),
    /resource-limit/,
  );
  assert.equal(metadataReads, 0);
});
