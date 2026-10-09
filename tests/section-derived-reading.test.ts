import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import {
  defaultMapping,
  type SourceFile,
} from '../lib/reconciliation/types.ts';
import {
  SectionDerivedReadingSession,
  type SectionDerivedReviewerDecision,
  type SectionDerivedSelection,
  type SectionDerivedReceipt,
} from '../lib/reconciliation/section-derived-reading.ts';
const base = new URL('../audit/section-derived-v1/frozen/', import.meta.url);
const revision = 'synthetic-native-text-v1';
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  description: 2,
  amount: 3,
  pdfReviewed: true,
};
const contract = JSON.parse(
  await readBytes(new URL('contract.json', base), 'utf8'),
) as {
  cases: { id: string; original: string; expected: string; outcome: string }[];
};
const actions = JSON.parse(
  await readBytes(new URL('actions.json', base), 'utf8'),
) as {
  cases: Record<string, { selectedMovementRows: number[]; decision: 'accept' }>;
};
const readerBoundary = JSON.parse(
  await readBytes(new URL('reader-boundary.json', base), 'utf8'),
) as {
  cases: Record<
    string,
    { expectedBlockStage: string; expectedDiagnosticCode: string }
  >;
};
type Golden = {
  outcome: string;
  originalSha256: string;
  inventory: { row: number; page: number; values: string[] }[];
  links: number[];
  references: string[];
  csvSha256?: string;
  csvRows?: string[][];
  amountMinor?: number[];
};
async function fixture(id = 'section-signed') {
  const c = contract.cases.find((c) => c.id === id)!;
  const original = await readBytes(new URL(c.original, base));
  const source = await readFile(
    c.original,
    Uint8Array.from(original).buffer,
    [25, 45, 69],
  );
  const golden = JSON.parse(
    await readBytes(new URL(c.expected, base), 'utf8'),
  ) as Golden;
  const session = new SectionDerivedReadingSession(
    source,
    mapping,
    revision,
    2,
  );
  return { c, source, original, golden, session };
}
function decision(
  selection: SectionDerivedSelection,
  patch: Partial<SectionDerivedReviewerDecision> = {},
): SectionDerivedReviewerDecision {
  return {
    decision: 'accept',
    reviewerLabel: 'Synthetic contract reviewer (not a field human claim)',
    rationale:
      'Explicit synthetic inspection of each original role and signed row.',
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
    ...patch,
  };
}
async function reviewed(id = 'section-signed') {
  const f = await fixture(id);
  const inspected = await f.session.inspect();
  const targets = actions.cases[id].selectedMovementRows;
  const ids = inspected.review.proposals
    .filter((p) => targets.includes(p.target.row))
    .map((p) => p.id);
  const selection = await f.session.selectProposalIds(ids);
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  return { ...f, selection, receipt };
}
void test('independent pre-engine truth tables, exact CSVs, physical PDF originals and action annotation remain byte-exact', async () => {
  for (const freezeName of [
    'freeze.json',
    'action-freeze.json',
    'reader-boundary-freeze.json',
  ]) {
    const freeze = JSON.parse(
      await readBytes(new URL(freezeName, base), 'utf8'),
    ) as {
      authorship?: string;
      arithmetic?: string;
      files: Record<string, string>;
    };
    if (freezeName === 'freeze.json') {
      assert.match(freeze.authorship!, /before TypeScript engine/);
      assert.match(freeze.arithmetic!, /decimal.Decimal/);
    }
    for (const [name, digest] of Object.entries(freeze.files))
      assert.equal(
        createHash('sha256')
          .update(await readBytes(new URL(name, base)))
          .digest('hex'),
        digest,
        name,
      );
  }
  assert.equal(contract.cases.length, 10);
  assert.deepEqual(
    actions.cases['unselected-movement'].selectedMovementRows,
    [3],
  );
});
void test('three independently frozen positive originals derive exact CSV bytes, signed movements, complete inventory and role citations', async () => {
  for (const c of contract.cases.filter((c) => c.outcome === 'derived')) {
    const f = await reviewed(c.id);
    const sourceBefore = structuredClone(f.source);
    const result = await f.session.apply(
      f.receipt,
      f.source,
      mapping,
      revision,
      2,
    );
    const expectedCsv = await readBytes(new URL(c.id + '.csv', base));
    assert.equal(result.csv, expectedCsv.toString(), c.id);
    assert.equal(result.nativeSource.sha256, f.golden.csvSha256, c.id);
    assert.deepEqual(result.nativeSource.sheets[0].rows, f.golden.csvRows);
    assert.deepEqual(Buffer.from(result.originalPdf), f.original);
    assert.deepEqual(f.source, sourceBefore);
    assert.equal(result.kind, 'explicitly-derived-section-csv');
    assert.equal(result.financialApproval, false);
    assert.equal(result.nativeSource.kind, undefined);
    assert.match(result.nativeSource.name, /\.section-derived\.csv$/);
    assert.notEqual(result.nativeSource.sha256, f.source.sha256);
    assert.equal(result.provenance.originalSha256, f.golden.originalSha256);
    assert.equal(result.provenance.derivedSha256, result.nativeSource.sha256);
    assert.equal(result.provenance.financialApproval, false);
    assert.deepEqual(
      result.provenance.inventory.map((r) => ({
        row: r.originalRow,
        page: r.page,
        values: r.values,
      })),
      f.golden.inventory,
    );
    assert.deepEqual(
      result.provenance.links.map((l) => l.originalRow),
      f.golden.links,
    );
    assert.deepEqual(
      result.provenance.links.map((l) => l.reference),
      f.golden.references,
    );
    for (const link of result.provenance.links) {
      assert.equal(
        result.provenance.inventory[link.originalRow - 1].derivedRow,
        link.derivedRow,
      );
      assert.equal(
        result.nativeSource.sheets[0].rows[link.derivedRow - 1][3],
        link.amountEvidence.literal,
      );
      for (const e of [
        link.referenceEvidence,
        link.dateEvidence,
        link.descriptionEvidence,
        link.amountEvidence,
        ...(link.proposal
          ? [
              link.proposal.target,
              link.proposal.parent,
              ...link.proposal.continuation,
              ...link.proposal.headers.flat(),
            ]
          : []),
      ]) {
        assert.equal(
          e.literal,
          f.source.sheets[e.sheet - 1].rows[e.row - 1][e.column - 1],
        );
        assert.equal(e.page, f.source.sheets[0].rowPages![String(e.row)]);
        assert.equal(e.sourceHash, f.source.sha256);
      }
    }
    const reread = await readFile(
      result.nativeSource.name,
      result.nativeSource.original!,
    );
    const prepared = prepareVerifiedSources(
      [reread],
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
    assert.deepEqual(
      prepared.transactions.map((t) => t.amount),
      f.golden.amountMinor,
    );
    assert.equal(prepared.errors.length, 0);
    assert.equal(prepared.excluded.length, 1);
    assert.equal(prepared.excluded[0].row, 1);
    assert.equal(prepared.excluded[0].kind, 'non-movement');
    assert.equal(f.session.state, 'derived');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('seven frozen negative cases refuse omission of unknown, corrupt, conflicting and unselected physical movements', async () => {
  for (const c of contract.cases.filter((c) => c.outcome === 'blocked')) {
    const importBoundary = readerBoundary.cases[c.id];
    if (importBoundary) {
      const original = await readBytes(new URL(c.original, base));
      await assert.rejects(
        readFile(c.original, Uint8Array.from(original).buffer, [25, 45, 69]),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'diagnosis' in error &&
          (error.diagnosis as { code: string }).code ===
            importBoundary.expectedDiagnosticCode,
        c.id,
      );
      continue;
    }
    const f = await reviewed(c.id);
    assert.deepEqual(
      f.source.sheets[0].rows,
      f.golden.inventory.map((r) => r.values),
    );
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /Unresolved|Every original movement/,
      c.id,
    );
    assert.equal(f.session.state, 'review-ready');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('no proposal, model-shaped object, missing, copied, serialized, foreign-session or mutated receipt can Apply', async () => {
  const f = await reviewed();
  const fakeReceipts = [
    undefined,
    {},
    f.selection.review.proposals[0],
    structuredClone(f.receipt),
    JSON.parse(JSON.stringify(f.receipt)),
    { ...f.receipt, selectionHash: '0'.repeat(64) },
  ];
  for (const receipt of fakeReceipts)
    await assert.rejects(
      f.session.apply(
        receipt as SectionDerivedReceipt,
        f.source,
        mapping,
        revision,
      ),
      /current reviewer receipt/,
    );
  assert.throws(() => {
    (f.receipt as unknown as { sourceHash: string }).sourceHash = 'x';
  }, TypeError);
  const other = await fixture();
  await other.session.inspect();
  await assert.rejects(
    other.session.apply(f.receipt, f.source, mapping, revision),
    /current reviewer receipt/,
  );
  const applied = await f.session.apply(f.receipt, f.source, mapping, revision);
  assert.equal(applied.financialApproval, false);
});
void test('explicit current review hashes, reviewer label/rationale and all role acknowledgements are required', async () => {
  const f = await fixture();
  const selection = await f.session.inspect();
  for (const patch of [
    { reviewedSourceHash: 'x' },
    { reviewedExtractionHash: 'x' },
    { reviewedExtractionRevision: 'x' },
    { reviewedSelectionHash: 'x' },
    { reviewerLabel: '' },
    { rationale: '' },
    {
      acknowledgements:
        {} as SectionDerivedReviewerDecision['acknowledgements'],
    },
  ])
    await assert.rejects(
      f.session.recordReviewerDecision(decision(selection, patch)),
      /bound|reviewer|acknowledgements/,
    );
  const rejected = await f.session.recordReviewerDecision(
    decision(selection, { decision: 'reject' }),
  );
  assert.equal(rejected, null);
  assert.equal(f.session.state, 'rejected');
});
void test('changed original bytes, cached literals, physical pages, issues, revision, mapping and decimals reject and consume the prior receipt', async () => {
  const faults = [
    (f: SourceFile) => {
      new Uint8Array(f.original!)[10] ^= 1;
    },
    (f: SourceFile) => {
      f.sheets[0].rows[1][2] = 'Invoice: FORGED';
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2][3] = '12.50';
    },
    (f: SourceFile) => {
      f.sheets[0].rowPages!['3'] = 2;
    },
    (f: SourceFile) => {
      f.sheets[0].rowIssues = { '3': ['forged issue'] };
    },
  ];
  for (const mutate of faults) {
    const f = await reviewed();
    const altered = structuredClone(f.source);
    mutate(altered);
    await assert.rejects(
      f.session.apply(f.receipt, altered, mapping, revision),
      /original|provenance/,
    );
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
  for (const changed of [
    {
      reading: { ...mapping, numberFormat: 'comma' as const },
      revision,
      decimals: 2,
    },
    { reading: mapping, revision: revision + '-2', decimals: 2 },
    { reading: mapping, revision, decimals: 3 },
  ]) {
    const f = await reviewed();
    await assert.rejects(
      f.session.apply(
        f.receipt,
        f.source,
        changed.reading,
        changed.revision,
        changed.decimals,
      ),
      /reading, precision/,
    );
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('source, selection and reviewer lifecycle changes invalidate receipts, including invalid replacement selections and cleared reviewer input', async () => {
  for (const change of [
    'source',
    'selection',
    'reviewer',
    'invalid-selection',
    'empty-reviewer',
  ]) {
    const f = await reviewed();
    if (change === 'source')
      f.session.replaceSource(f.source, mapping, revision);
    if (change === 'selection') await f.session.selectProposalIds([]);
    if (change === 'reviewer')
      f.session.updateReviewer('Changed reviewer', 'Changed rationale');
    if (change === 'invalid-selection')
      await assert.rejects(
        f.session.selectProposalIds(['model-created']),
        /not part/,
      );
    if (change === 'empty-reviewer') f.session.updateReviewer('', 'changed');
    await assert.rejects(
      f.session.apply(f.receipt, f.source, mapping, revision),
      /current reviewer receipt/,
    );
  }
});
void test('pending inspect, selection, review and Apply cannot commit after source/reviewer generation changes', async () => {
  const f = await fixture();
  const inspect = f.session.inspect();
  f.session.replaceSource(f.source, mapping, revision + '-2');
  await assert.rejects(inspect, /changed while/);
  f.session.replaceSource(f.source, mapping, revision);
  const snapshot = await f.session.inspect();
  const select = f.session.selectProposalIds(
    snapshot.review.proposals.map((p) => p.id),
  );
  f.session.updateReviewer('Replacement', 'Changed while selecting');
  await assert.rejects(select, /changed while/);
  const selection = await f.session.selectProposalIds(
    snapshot.review.proposals.map((p) => p.id),
  );
  const review = f.session.recordReviewerDecision(decision(selection));
  f.session.updateReviewer('Replacement', 'Changed while reviewing');
  await assert.rejects(review, /changed while/);
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  const apply = f.session.apply(receipt, f.source, mapping, revision);
  f.session.replaceSource(f.source, mapping, revision);
  await assert.rejects(apply, /changed while/);
  assert.equal(f.session.state, 'empty');
});
void test('only one concurrent Apply can own a receipt and external selection snapshots cannot mutate its owned facts', async () => {
  const f = await reviewed();
  f.selection.review.rows[2].values[3] = '999.00';
  f.selection.selectedProposalIds.length = 0;
  const first = f.session.apply(f.receipt, f.source, mapping, revision);
  const second = f.session.apply(f.receipt, f.source, mapping, revision);
  await assert.rejects(second, /current reviewer receipt/);
  assert.equal((await first).nativeSource.sheets[0].rows[1][3], '-12.50');
});
void test('unsupported currency, balance, period, sign or direction interpretation cannot enter the derived subset', async () => {
  const f = await fixture();
  for (const patch of [
    { currencyColumn: 0 },
    { opening: '12.50' },
    { periodStart: '2026-10-01' },
    { multiplier: -1 as const },
    { reportType: 'open-items' as const },
    {
      directionEvidence: {
        multiplier: 1 as const,
        balanceColumn: 3,
        checkedRows: 1,
        reason: 'claimed',
      },
    },
  ]) {
    const session = new SectionDerivedReadingSession(
      f.source,
      { ...mapping, ...patch },
      revision,
    );
    await assert.rejects(session.inspect(), /without currency, balance/);
  }
});
void test('native currency-qualified, balance and unknown amount headers cannot lose their monetary context in a canonical CSV', async () => {
  for (const amountHeader of ['Amount (SAR)', 'Balance', 'Unspecified value']) {
    const source = await readFile(
      'context.pdf',
      syntheticPdf(
        [
          [
            ['Date', 'Reference', 'Description', amountHeader],
            ['2026-10-01', 'INV-1', 'line', '-12.50'],
          ],
        ],
        5,
      ),
      [25, 45, 69],
    );
    const session = new SectionDerivedReadingSession(source, mapping, revision);
    await assert.rejects(
      session.inspect(),
      /Unsupported original header, monetary context/,
    );
    assert.equal(session.state, 'empty');
  }
});
void test('renaming the acknowledged source requires a new review and cannot rewrite the original-name provenance', async () => {
  const f = await reviewed();
  await assert.rejects(
    f.session.apply(
      f.receipt,
      { ...f.source, name: 'renamed.pdf' },
      mapping,
      revision,
    ),
    /reading, precision/,
  );
  await assert.rejects(
    f.session.apply(f.receipt, f.source, mapping, revision),
    /current reviewer receipt/,
  );
});
