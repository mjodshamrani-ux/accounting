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
  type SectionDerivedSelection,
  type SectionDerivedReviewerDecision,
} from '../lib/reconciliation/section-derived-reading.ts';

const base = new URL(
  '../audit/p4-native-arabic-section-v4/frozen/',
  import.meta.url,
);
const sha = (data: Uint8Array | string) =>
  createHash('sha256').update(data).digest('hex');
type Cell = { row: number; page: number; column: number; literal: string };
type Case = {
  id: string;
  original: string;
  expected: string;
  outcome: string;
  cuts?: number[];
};
type Golden = {
  originalSha256: string;
  inventory: { row: number; page: number; values: string[] }[];
  proposals: {
    targetRow: number;
    reference: string;
    parentCells: Cell[];
    continuationCells: Cell[][];
    headerCells: Cell[][];
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
const freezeBytes = await readBytes(new URL('freeze.json', base));
const frozen = JSON.parse(freezeBytes.toString()) as {
  generatorSha256: string;
  files: Record<string, string>;
};
const contract = JSON.parse(
  await readBytes(new URL('contract.json', base), 'utf8'),
) as {
  cuts: number[];
  revision: string;
  cases: Case[];
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
const syntaxScope = {
  supplier: '',
  entity: '',
  account: '',
  currency: 'XXX',
  decimals: 2,
  cutoff: '2100-12-31',
  dateWindow: 0,
  confirmed: false,
  coverageConfirmed: false,
};
const literal = ({
  row,
  page,
  column,
  literal,
}: SectionCellEvidence): Cell => ({ row, page, column, literal });
async function fixture(id = 'arabic-pair-signed') {
  const c = contract.cases.find((c) => c.id === id) ?? {
    id,
    original: id + '.pdf',
    expected: id + '.expected.json',
    outcome: 'resource',
  };
  const original = await readBytes(new URL(c.original, base));
  const expectedBytes = await readBytes(new URL(c.expected, base));
  const golden = JSON.parse(expectedBytes.toString()) as Golden;
  const source = await readFile(
    c.original,
    Uint8Array.from(original).buffer,
    c.cuts ?? contract.cuts,
  );
  const session = new SectionDerivedReadingSession(
    source,
    mapping,
    revision,
    2,
  );
  return { c, original, golden, source, session, expectedBytes };
}
function decision(
  selection: SectionDerivedSelection,
): SectionDerivedReviewerDecision {
  return {
    decision: 'accept',
    reviewerLabel: 'Independent native Arabic section contract actor',
    rationale:
      'Reviewed original Arabic role/value cells and all signed movements; explicit derived CSV only.',
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
async function reviewed(id = 'arabic-pair-signed') {
  const f = await fixture(id);
  const inspected = await f.session.inspect();
  const selected = await f.session.selectProposalIds(
    inspected.review.proposals.map((p) => p.id),
  );
  f.session.updateReviewer(
    'Independent native Arabic section contract actor',
    'Reviewed original Arabic role/value cells and all signed movements; explicit derived CSV only.',
  );
  const receipt = await f.session.recordReviewerDecision(decision(selected));
  assert.ok(receipt);
  return { ...f, selected, receipt };
}
function inventory(source: SourceFile) {
  return source.sheets[0].rows.map((values, index) => ({
    row: index + 1,
    page: source.sheets[0].rowPages![String(index + 1)],
    values,
  }));
}
function assertCitations(
  f: Awaited<ReturnType<typeof fixture>>,
  cells: SectionCellEvidence[],
  extractionHash: string,
) {
  for (const cell of cells) {
    const row = f.golden.inventory[cell.row - 1];
    assert.equal(cell.sourceHash, f.golden.originalSha256);
    assert.equal(cell.extractionHash, extractionHash);
    assert.equal(cell.extractionRevision, revision);
    assert.equal(cell.sheet, 1);
    assert.equal(cell.page, row.page);
    assert.equal(cell.literal, row.values[cell.column - 1]);
  }
}
void test('pre-code native Arabic freeze and30 reused originals remain exact', async () => {
  assert.equal(contract.cases.length, 30);
  assert.equal(actions.actions.length, 24);
  assert.equal(Object.keys(frozen.files).length, 105);
  for (const [name, digest] of Object.entries(frozen.files))
    assert.equal(sha(await readBytes(new URL(name, base))), digest, name);
  assert.equal(
    sha(await readBytes(new URL('../freeze.py', base))),
    frozen.generatorSha256,
  );
  const pins = (
    frozen as unknown as { identityReusedOriginals: Record<string, string> }
  ).identityReusedOriginals;
  assert.equal(Object.keys(pins).length, 30);
  for (const [name, digest] of Object.entries(pins))
    assert.equal(sha(await readBytes(new URL(name, base))), digest, name);
});
for (const c of contract.cases)
  void test(`native Arabic section truth: ${c.id}`, async () => {
    if (c.outcome === 'blocked') {
      const f = await fixture(c.id);
      const before = structuredClone(f.source);
      const raw = await inspectSectionContinuation(f.source, mapping, revision);
      assert.deepEqual(
        raw.rows.map(({ row, page, values }) => ({ row, page, values })),
        f.golden.inventory,
      );
      let selected: SectionDerivedSelection;
      try {
        const inspected = await f.session.inspect();
        selected = await f.session.selectProposalIds(
          inspected.review.proposals.map((p) => p.id),
        );
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /Unsupported original header, monetary context or source issues/,
        );
        assert.equal(f.session.state, 'empty');
        assert.equal(f.session.selection, null);
        await assert.rejects(
          f.session.recordReviewerDecision(
            {} as SectionDerivedReviewerDecision,
          ),
          /separate explicit/,
        );
        assert.deepEqual(f.source, before);
        return;
      }
      f.session.updateReviewer(
        'Independent native Arabic section contract actor',
        'Reviewed original Arabic role/value cells and all signed movements; explicit derived CSV only.',
      );
      const receipt = await f.session.recordReviewerDecision(
        decision(selected),
      );
      assert.ok(receipt);
      await assert.rejects(
        f.session.apply(receipt, f.source, mapping, revision),
      );
      assert.equal(f.session.state, 'review-ready');
      await assert.rejects(
        f.session.apply(receipt, f.source, mapping, revision),
        /current reviewer receipt/,
      );
      assert.deepEqual(f.source, before);
      return;
    }
    const f = await reviewed(c.id);
    const before = structuredClone(f.source);
    assert.deepEqual(inventory(f.source), f.golden.inventory);
    assert.deepEqual(
      f.selected.review.rows.map(({ row, page, values }) => ({
        row,
        page,
        values,
      })),
      f.golden.inventory,
    );
    assert.equal(f.selected.review.sourceVerified, true);
    assert.deepEqual(f.source.sheets[0].rowIssues, {});
    assert.deepEqual(
      f.selected.review.proposals.map((p) => ({
        targetRow: p.target.row,
        reference: p.reference,
        parentCells: (p.parentSpan ?? [p.parent]).map(literal),
        continuationCells: (
          p.continuationSpans ?? p.continuation.map((c) => [c])
        ).map((span) => span.map(literal)),
        headerCells: p.headers.map((b) => b.map(literal)),
      })),
      f.golden.proposals,
    );
    assert.equal(Object.hasOwn(f.selected.review, 'headerBands'), false);
    for (const key of [
      'rowIssues',
      'cellIssues',
      'referenceIssues',
      'cellNotes',
    ] as const)
      assert.ok(
        Object.values(f.source.sheets[0][key] ?? {}).every(
          (items) => items.length === 0,
        ),
        key,
      );
    for (const p of f.selected.review.proposals)
      assertCitations(
        f,
        [
          p.target,
          p.parent,
          ...p.headers.flat(),
          ...(p.parentSpan ?? []),
          ...(p.continuationSpans?.flat() ?? []),
          ...(p.headerBands?.flat() ?? []),
        ],
        f.selected.review.extractionHash,
      );
    const result = await f.session.apply(
      f.receipt,
      f.source,
      mapping,
      revision,
    );
    const csv = await readBytes(new URL(c.id + '.csv', base));
    assert.equal(result.csv, csv.toString());
    assert.deepEqual(Buffer.from(result.nativeSource.original!), csv);
    assert.equal(result.nativeSource.sha256, f.golden.csvSha256);
    assert.deepEqual(result.nativeSource.sheets[0].rows, f.golden.csvRows);
    assert.deepEqual(Buffer.from(result.originalPdf), f.original);
    assert.equal(result.financialApproval, false);
    assert.equal(result.provenance.financialApproval, false);
    assert.equal(result.nativeSource.kind, undefined);
    assert.deepEqual(
      result.provenance.headerBands,
      f.selected.review.headerBands,
    );
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
      result.provenance.links.map((l) => l.amountEvidence.literal),
      f.golden.signedAmounts,
    );
    const fresh = await readFile(
      result.nativeSource.name,
      Uint8Array.from(csv).buffer,
    );
    const prepared = prepareVerifiedSources(
      [fresh],
      [result.mapping],
      syntaxScope,
      ['supplier'],
    ).sources[0];
    assert.deepEqual(prepared.errors, []);
    assert.deepEqual(
      prepared.transactions.map((t) => t.amount),
      f.golden.amountMinor,
    );
    assert.deepEqual(
      prepared.transactions.map((t) => t.originalAmount),
      f.golden.signedAmounts,
    );
    assert.deepEqual(f.source, before);
  });
for (const action of actions.actions)
  void test(`native Arabic independent action: ${action.id}`, async () => {
    const id = action.source.replace(/\.pdf$/, '');
    const f = await fixture(id);
    const before = structuredClone(f.source);
    if (
      action.budget ||
      [
        'pre-aborted',
        'native-read-aborted',
        'row-walk-aborted',
        'replace-during-replay',
        'reviewer-cleared-during-replay',
      ].includes(action.id)
    ) {
      const controller = new AbortController();
      if (action.id === 'pre-aborted') controller.abort();
      const progress: { stage: string; completed: number }[] = [];
      const options: SectionOperationOptions = {
        signal: controller.signal,
        budgets: action.budget,
        onProgress: (p) => {
          progress.push(p);
          if (p.stage === 'pdf-read' && p.completed === 1) {
            if (action.id === 'native-read-aborted') controller.abort();
            if (action.id === 'replace-during-replay')
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
      await assert.rejects(f.session.inspect(options), (e) =>
        action.budget
          ? e instanceof SectionOperationError && e.code === 'resource-limit'
          : e instanceof Error && /cancelled|changed while/.test(e.message),
      );
      assert.equal(f.session.selection, null);
      assert.equal(f.session.state, 'empty');
      if (
        [
          'native-read-aborted',
          'replace-during-replay',
          'reviewer-cleared-during-replay',
        ].includes(action.id)
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
      action.id.endsWith('cache-tamper') ||
      action.id === 'original-byte-tamper'
    ) {
      const tampered = structuredClone(f.source);
      const detail = (
        action as unknown as {
          change: {
            row: number;
            column?: number;
            literal?: string;
            page?: number;
          };
        }
      ).change;
      if (action.id === 'original-byte-tamper')
        new Uint8Array(tampered.original!)[10] ^= 1;
      else if (detail.page !== undefined)
        tampered.sheets[0].rowPages![String(detail.row)] = detail.page;
      else
        tampered.sheets[0].rows[detail.row - 1][detail.column! - 1] =
          detail.literal!;
      const snapshot = structuredClone(tampered);
      await assert.rejects(
        inspectSectionContinuation(tampered, mapping, revision),
      );
      assert.deepEqual(tampered, snapshot);
    } else if (action.id === 'proposal-span-tamper') {
      for (const change of ['literal', 'page', 'column', 'omitted-role']) {
        const review = await inspectSectionContinuation(
          f.source,
          mapping,
          revision,
        );
        const span = review.proposals[1].continuationSpans![0];
        if (change === 'literal') span[1].literal = 'AR-999';
        if (change === 'page') span[0].page = 1;
        if (change === 'column') span[0].column = 2;
        if (change === 'omitted-role') span.splice(0, 1);
        await assert.rejects(
          revalidateSectionContinuation(review, f.source, mapping, revision),
          /stale or altered/,
        );
      }
    } else if (action.id === 'cuts-before-clone') {
      const tampered = structuredClone(f.source);
      tampered.pdf!.cuts = Array.from({ length: 100001 }, () => 1);
      const clone = globalThis.structuredClone;
      let calls = 0;
      globalThis.structuredClone = ((...args: Parameters<typeof clone>) => {
        calls++;
        return clone(...args);
      }) as typeof clone;
      try {
        await assert.rejects(
          inspectSectionContinuation(tampered, mapping, revision),
          (e) =>
            e instanceof SectionOperationError && e.code === 'resource-limit',
        );
        assert.equal(calls, 0);
      } finally {
        globalThis.structuredClone = clone;
      }
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
      f.session.updateReviewer(
        'Independent native Arabic section contract actor',
        'Reviewed original Arabic role/value cells and all signed movements; explicit derived CSV only.',
      );
      if (action.id === 'reviewer-metadata-before-clone') {
        const input = decision(selected);
        input.rationale = 'x'.repeat(100001);
        const clone = globalThis.structuredClone;
        let calls = 0;
        globalThis.structuredClone = ((...args: Parameters<typeof clone>) => {
          calls++;
          return clone(...args);
        }) as typeof clone;
        try {
          await assert.rejects(f.session.recordReviewerDecision(input));
          assert.equal(calls, 0);
        } finally {
          globalThis.structuredClone = clone;
        }
      } else {
        const receipt = await f.session.recordReviewerDecision(
          decision(selected),
        );
        assert.ok(receipt);
        const currentMapping = { ...mapping };
        let currentRevision = revision,
          decimals = 2;
        if (action.id === 'post-review-mapping') currentMapping.amount = 2;
        if (action.id === 'post-review-revision') currentRevision += '-changed';
        if (action.id === 'post-review-decimals') decimals = 3;
        const provided =
          action.id === 'receipt-clone' ? structuredClone(receipt) : receipt;
        await assert.rejects(
          f.session.apply(
            provided,
            f.source,
            currentMapping,
            currentRevision,
            decimals,
          ),
        );
        if (action.id === 'receipt-clone') {
          // A counterfeit never receives authority; the genuine receipt keeps
          // the previously accepted opaque session lifecycle.
          const artifact = await f.session.apply(
            receipt,
            f.source,
            mapping,
            revision,
          );
          assert.equal(artifact.financialApproval, false);
        } else assert.notEqual(f.session.state, 'derived');
        await assert.rejects(
          f.session.apply(receipt, f.source, mapping, revision),
          /current reviewer receipt/,
        );
      }
    }
    assert.deepEqual(f.source, before);
  });
void test('native Arabic resource conserves every row and signed amount with all bands', async () => {
  const f = await reviewed('arabic-resource-cancellation');
  assert.equal(f.source.pdf!.pages, 16);
  assert.equal(f.selected.review.rows.length, 320);
  assert.equal(f.selected.review.proposals.length, 288);
  assert.equal(Object.hasOwn(f.selected.review, 'headerBands'), false);
  const result = await f.session.apply(f.receipt, f.source, mapping, revision);
  assert.deepEqual(Buffer.from(result.originalPdf), f.original);
  assert.equal(result.provenance.inventory.length, 320);
  assert.equal(result.provenance.links.length, 288);
  assert.equal(Object.hasOwn(result.provenance, 'headerBands'), false);
  assert.equal(
    result.provenance.links.reduce(
      (sum, l) => sum + Number(l.amountEvidence.literal) * 100,
      0,
    ),
    72000,
  );
  assert.ok(
    result.provenance.links.every((l) => l.amountEvidence.literal === '+2.50'),
  );
  const fresh = await readFile(
    result.nativeSource.name,
    result.nativeSource.original!,
  );
  const parsed = prepareVerifiedSources(
    [fresh],
    [result.mapping],
    syntaxScope,
    ['supplier'],
  ).sources[0];
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.transactions.length, 288);
  assert.equal(
    parsed.transactions.reduce((sum, t) => sum + t.amount, 0),
    72000,
  );
});

void test('Arabic paired-source citation counts remain inclusive without raw header bands', async () => {
  const f = await fixture();
  await f.session.inspect({ budgets: { maxEvidenceCells: 10 } });
  await assert.rejects(
    f.session.inspect({ budgets: { maxEvidenceCells: 9 } }),
    (e) => e instanceof SectionOperationError && e.code === 'resource-limit',
  );
  assert.equal(f.session.selection, null);
  const cross = await fixture('arabic-cross-page');
  await cross.session.inspect({ budgets: { maxEvidenceCells: 17 } });
  await assert.rejects(
    cross.session.inspect({ budgets: { maxEvidenceCells: 16 } }),
    (e) => e instanceof SectionOperationError && e.code === 'resource-limit',
  );
  assert.equal(cross.session.selection, null);
});

void test('Apply cancellation and owned generation changes stop native replay and consume the current receipt', async () => {
  for (const change of [
    'signal',
    'source',
    'reviewer',
    'row-walk',
    'derived-walk',
  ]) {
    const f = await reviewed('arabic-resource-cancellation');
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
