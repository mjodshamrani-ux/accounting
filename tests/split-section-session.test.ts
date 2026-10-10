import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  readFile as readBytes,
  readdir,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from '../lib/reconciliation/io.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import {
  SplitSectionSession,
  revalidateSplitArtifact,
  saveSplitArtifact,
  restoreSplitArtifact,
  exportSplitWorkbook,
  type SplitSessionOptions,
} from '../lib/reconciliation/split-section-session.ts';

const base = new URL('../audit/split-section/frozen/', import.meta.url);
type Context = ConstructorParameters<typeof SplitSectionSession>[1];
type Selection = Awaited<ReturnType<SplitSectionSession['inspect']>>;
type Artifact = Awaited<ReturnType<SplitSectionSession['apply']>>;
type Oracle = {
  case: string;
  accepted: boolean;
  cuts: number[];
  sourceSha256: string;
  pageCount: number;
  inventory: { row: number; page: number; kind: string; values: string[] }[];
  movements: {
    originalRow: number;
    page: number;
    derivedRow: number;
    reference: string;
    referenceOrigin: string;
    debitText: string;
    creditText: string;
    debitMinor: number;
    creditMinor: number;
    netMinor: number;
  }[];
  totals: { debitMinor: number; creditMinor: number; netMinor: number };
};
const hash = (bytes: ArrayBuffer | Uint8Array | string) =>
  createHash('sha256')
    .update(
      typeof bytes === 'string'
        ? bytes
        : new Uint8Array(
            bytes instanceof ArrayBuffer ? bytes : bytes.buffer,
            bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset,
            bytes.byteLength,
          ),
    )
    .digest('hex');
const context = (): Context => ({
  mapping: {
    ...defaultMapping(),
    sheet: 0,
    header: 2,
    date: 0,
    reference: 1,
    description: 2,
    amount: -1,
    debit: 3,
    credit: 4,
    mode: 'split',
    multiplier: 1,
    numberFormat: 'dot',
    dateFormat: 'ymd',
    currencyColumn: -1,
    reportType: 'transactions',
    pdfReviewed: true,
    opening: '',
    closing: '',
    periodStart: '',
    excluded: {},
  },
  currency: 'SAR',
  decimals: 2,
  perspective: 'debit-minus-credit',
  extractionRevision: 'synthetic-native-split-section-v1',
});
const reviewer = {
  label: 'Synthetic Reviewer A',
  rationale: 'All original rows and both components independently checked.',
};
const acknowledgements = {
  originalRowsReviewed: true,
  referenceRolesReviewed: true,
  separateAmountsReviewed: true,
  perspectiveReviewed: true,
  currencyReviewed: true,
  totalsReviewed: true,
  derivedSourceUnderstood: true,
} as const;
async function fixture(id = 'P05-carry-and-component-totals') {
  const oracle = JSON.parse(
    await readBytes(new URL(`${id}/oracle.json`, base), 'utf8'),
  ) as Oracle;
  const original = await readBytes(new URL(`${id}/source.pdf`, base));
  const source = await readFile(
    `${id}.pdf`,
    Uint8Array.from(original).buffer,
    oracle.cuts,
    false,
    undefined,
    32767,
  );
  assert.equal(source.sha256, oracle.sourceSha256, `${id}: frozen source hash`);
  assert.deepEqual(
    source.sheets[0].rows,
    oracle.inventory.map((row) => row.values),
    `${id}: all literal source cells`,
  );
  assert.deepEqual(
    source.sheets[0].rowPages,
    Object.fromEntries(
      oracle.inventory.map((row) => [String(row.row), row.page]),
    ),
    `${id}: native physical row pages`,
  );
  const reading = context();
  return {
    id,
    oracle,
    original,
    source,
    context: reading,
    session: new SplitSectionSession(source, reading),
  };
}
function decision(
  selection: Selection,
  patch: Partial<
    Parameters<SplitSectionSession['recordReviewerDecision']>[0]
  > = {},
) {
  return {
    decision: 'accept' as const,
    reviewerLabel: reviewer.label,
    rationale: reviewer.rationale,
    reviewedSourceHash: selection.review.sourceHash,
    reviewedExtractionHash: selection.review.extractionHash,
    reviewedContextHash: selection.review.contextHash,
    reviewedSelectionHash: selection.selectionHash,
    acknowledgements,
    ...patch,
  };
}
async function reviewed(id = 'P05-carry-and-component-totals') {
  const f = await fixture(id);
  const inspect = await f.session.inspect();
  assert.equal(
    inspect.review.state,
    'review-ready',
    `${id}: full source must remain review-ready`,
  );
  assert.deepEqual(
    inspect.review.movements.map((m) => ({
      originalRow: m.originalRow,
      page: m.page,
      derivedRow: m.derivedRow,
      reference: m.reference,
      referenceOrigin: m.referenceOrigin,
      debitText: m.debit,
      creditText: m.credit,
      debitMinor: m.debitMinor,
      creditMinor: m.creditMinor,
    })),
    f.oracle.movements.map((m) => ({
      originalRow: m.originalRow,
      page: m.page,
      derivedRow: m.derivedRow,
      reference: m.reference,
      referenceOrigin: m.referenceOrigin,
      debitText: m.debitText,
      creditText: m.creditText,
      debitMinor: String(m.debitMinor),
      creditMinor: String(m.creditMinor),
    })),
    `${id}: exact complete movement membership and separate money`,
  );
  const selection = await f.session.select(
    f.oracle.movements.map((m) => m.originalRow),
    inspect.review.proposals.map((p) => p.id),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt, `${id}: explicit real session-owned receipt`);
  return { ...f, selection, receipt };
}

void test('review text survives archive and XLSX escape decoding exactly', async () => {
  const f = await fixture();
  f.context.extractionRevision = 'native_x0041_\r\u007f';
  const session = new SplitSectionSession(f.source, f.context);
  const inspected = await session.inspect();
  const selected = await session.select(
    inspected.review.movements.map((m) => m.originalRow),
    inspected.review.proposals.map((p) => p.id),
  );
  const reviewerLabel = 'Reviewer_x0041_\r\u007f';
  const rationale = 'Literal _x005F_x0041_ and _x000A_ stay literal.';
  const receipt = await session.recordReviewerDecision(
    decision(selected, { reviewerLabel, rationale }),
  );
  assert.ok(receipt);
  const artifact = await session.apply(receipt, f.source, f.context);
  const restored = await restoreSplitArtifact(await saveSplitArtifact(artifact));
  assert.equal(restored.provenance.reviewer.label, reviewerLabel);
  for (const input of [artifact, restored]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await exportSplitWorkbook(input));
    const history = new Map<string, unknown>();
    book.getWorksheet('ReviewHistory')!.eachRow((row) => {
      const key = row.getCell(1).value;
      assert.equal(typeof key, 'string');
      history.set(key as string, row.getCell(2).value);
    });
    assert.equal(history.get('Reviewer'), reviewerLabel);
    assert.equal(history.get('Rationale'), rationale);
    assert.equal(
      book.getWorksheet('SourceCellEvidence')!.getRow(2).getCell(5).value,
      f.context.extractionRevision,
    );
  }
});

void test('invalid review and extraction text is rejected before receipt issuance', async () => {
  const invalid = ['bad\u0001text', 'bad\ufffetext', 'bad\ud800text'];
  for (const text of invalid) {
    const f = await reviewed();
    await assert.rejects(
      f.session.recordReviewerDecision(decision(f.selection, { reviewerLabel: text })),
      { code: 'SPLIT_REVIEWER', stage: 'reviewer-context' },
    );
    await assert.rejects(
      f.session.recordReviewerDecision(decision(f.selection, { rationale: text })),
      { code: 'SPLIT_REVIEWER', stage: 'reviewer-context' },
    );
    const reading = { ...f.context, extractionRevision: text };
    assert.throws(() => new SplitSectionSession(f.source, reading), {
      code: 'SPLIT_CONTEXT', stage: 'reading-context',
    });
  }
});

void test('derived source metadata cannot claim a conflicting source family', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  for (const patch of [{ kind: 'reviewed-image' }, { pdf: { pages: 1 } }, { extra: 'claim' }]) {
    const damaged = structuredClone(artifact);
    Object.assign(damaged.nativeSource, patch);
    await assert.rejects(revalidateSplitArtifact(damaged), {
      code: 'SPLIT_DERIVED_REPLAY', stage: 'source-revalidation',
    });
  }
});

for (const id of ['19', '60']) {
  void test(`native capacity ${id}: publish only an artifact within archive guards`, async () => {
    const capacityBase = new URL(
      '../audit/split-section/capacity-regression/',
      import.meta.url,
    );
    const frozen = JSON.parse(
      await readBytes(new URL('INPUTS.json', capacityBase), 'utf8'),
    ) as {
      cases: {
        id: string;
        movementCount: number;
        sourceSha256: string;
        expectedCsvSha256: string;
        cuts: number[];
        grossDebitMinor: string;
        grossCreditMinor: string;
        netMinor: string;
      }[];
    };
    const facts = frozen.cases.find((row) => row.id === id)!;
    const bytes = await readBytes(new URL(`${id}/source.pdf`, capacityBase));
    const expectedCsv = await readBytes(
      new URL(`${id}/expected.csv`, capacityBase),
    );
    assert.equal(hash(bytes), facts.sourceSha256);
    assert.equal(hash(expectedCsv), facts.expectedCsvSha256);
    const source = await readFile(
      'SYNTHETIC-CAPACITY.pdf',
      Uint8Array.from(bytes).buffer,
      facts.cuts,
      false,
      undefined,
      32767,
    );
    const reading = context();
    const session = new SplitSectionSession(source, reading);
    const inspected = await session.inspect();
    assert.equal(inspected.review.state, 'review-ready');
    assert.equal(inspected.review.movements.length, facts.movementCount);
    assert.equal(inspected.review.grossDebitMinor, facts.grossDebitMinor);
    assert.equal(inspected.review.grossCreditMinor, facts.grossCreditMinor);
    assert.equal(inspected.review.netMinor, facts.netMinor);
    const selected = await session.select(
      inspected.review.movements.map((row) => row.originalRow),
      inspected.review.proposals.map((proposal) => proposal.id),
    );
    const receipt = await session.recordReviewerDecision(decision(selected));
    assert.ok(receipt);
    if (id === '60') {
      await assertCode(
        () => session.apply(receipt, source, reading),
        'resource-limit',
      );
      await assertCode(
        () => session.apply(receipt, source, reading),
        'SPLIT_RECEIPT',
      );
      return;
    }
    const artifact = await session.apply(receipt, source, reading);
    assert.equal(artifact.csv, expectedCsv.toString('utf8'));
    assert.ok(artifact.csv.length > 32767, 'whole CSV exceeds a cell limit');
    const saved = await saveSplitArtifact(artifact);
    const restored = await restoreSplitArtifact(saved);
    assert.equal(restored.csv, artifact.csv);
    assert.equal(restored.provenance.links.length, facts.movementCount);
    assert.equal(restored.financialApproval, false);
    assert.equal(restored.scopeConfirmed, false);
    const workbook = await exportSplitWorkbook(restored);
    assert.ok(workbook.byteLength > 0);
    if (process.env.P4_REPORT_DIR) {
      const report = `${process.env.P4_REPORT_DIR}/capacity-${id}`;
      await mkdir(report, { recursive: true });
      await writeFile(`${report}/actual.split`, new Uint8Array(saved));
      await writeFile(`${report}/actual.xlsx`, new Uint8Array(workbook));
      await writeFile(`${report}/actual.csv`, artifact.csv);
    }
  });
}
async function assertCode(
  action: () => Promise<unknown>,
  expectedCode: string,
) {
  let result: unknown;
  let caught: unknown;
  try {
    result = await action();
  } catch (error) {
    caught = error;
  }
  assert.equal(
    result,
    undefined,
    'refused operation must not publish an artifact',
  );
  assert.ok(caught instanceof Error, 'refused operation must report its cause');
  assert.equal(
    (caught as Error & { code: string }).code,
    expectedCode,
    caught.message,
  );
  return caught;
}
async function report(id: string, value: unknown) {
  if (!process.env.P4_REPORT_DIR) return;
  await mkdir(process.env.P4_REPORT_DIR, { recursive: true });
  await writeFile(
    new URL(
      `${id}.json`,
      `file://${process.env.P4_REPORT_DIR.replace(/\/$/, '')}/`,
    ),
    JSON.stringify(value, null, 2) + '\n',
  );
}
function checkArtifact(
  artifact: Artifact,
  oracle: Oracle,
  expectedCsv: string,
) {
  assert.equal(
    artifact.csv,
    expectedCsv,
    `${oracle.case}: whole exact RFC4180 CSV`,
  );
  assert.equal(artifact.originalSource.sha256, oracle.sourceSha256);
  assert.equal(hash(artifact.originalPdf), oracle.sourceSha256);
  assert.deepEqual(
    artifact.provenance.inventory.map((row) => ({
      row: row.originalRow,
      page: row.page,
      kind: row.kind,
      values: row.values,
    })),
    oracle.inventory.map(({ row, page, kind, values }) => ({
      row,
      page,
      kind,
      values,
    })),
  );
  assert.deepEqual(
    artifact.provenance.links.map((row) => ({
      originalRow: row.originalRow,
      page: row.page,
      derivedRow: row.derivedRow,
      reference: row.reference,
      referenceOrigin: row.referenceOrigin,
      debitText: row.debit,
      creditText: row.credit,
      debitMinor: String(row.debitMinor),
      creditMinor: String(row.creditMinor),
      netMinor: String(BigInt(row.debitMinor) - BigInt(row.creditMinor)),
    })),
    oracle.movements.map((row) => ({
      originalRow: row.originalRow,
      page: row.page,
      derivedRow: row.derivedRow,
      reference: row.reference,
      referenceOrigin: row.referenceOrigin,
      debitText: row.debitText,
      creditText: row.creditText,
      debitMinor: String(row.debitMinor),
      creditMinor: String(row.creditMinor),
      netMinor: String(row.netMinor),
    })),
  );
  assert.deepEqual(
    {
      debitMinor: artifact.provenance.review.grossDebitMinor,
      creditMinor: artifact.provenance.review.grossCreditMinor,
      netMinor: artifact.provenance.review.netMinor,
    },
    Object.fromEntries(
      Object.entries(oracle.totals).map(([key, value]) => [key, String(value)]),
    ),
  );
  for (const total of artifact.provenance.review.totals) {
    const original = oracle.inventory[total.originalRow - 1];
    assert.equal(total.role, original.values[0]);
    assert.equal(total.page, original.page);
    assert.equal(total.debitEvidence.cellText, original.values[3]);
    assert.equal(total.creditEvidence.cellText, original.values[4]);
    assert.equal(total.actualDebitMinor, total.expectedDebitMinor);
    assert.equal(total.actualCreditMinor, total.expectedCreditMinor);
  }
  assert.equal(artifact.provenance.financialApproval, false);
  assert.equal(artifact.provenance.scopeConfirmed, false);
  assert.equal(artifact.mapping.mode, 'split');
  assert.equal(artifact.mapping.debit, 3);
  assert.equal(artifact.mapping.credit, 4);
  assert.equal(artifact.mapping.multiplier, 1);
  assert.deepEqual(
    artifact.provenance.selection.selectedMovementRows,
    oracle.movements.map((m) => m.originalRow),
  );
}

void test('all 55 inputs retain the accepted independent freeze and every recorded file hash', async () => {
  const raw = await readBytes(
    new URL('../audit/split-section/INPUT-MANIFEST.json', import.meta.url),
  );
  assert.equal(
    hash(raw),
    'ebb1f9678384fa35ff23c28d636c240c6d1488ac483006ae85a20b019e2bc16c',
  );
  const manifest = JSON.parse(raw.toString('utf8')) as {
    caseCount: number;
    files: { path: string; bytes: number; sha256: string }[];
  };
  assert.equal(manifest.caseCount, 55);
  for (const entry of manifest.files) {
    const bytes = await readBytes(new URL(`../${entry.path}`, import.meta.url));
    assert.equal(bytes.byteLength, entry.bytes, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
});

void test('all twelve accepted frozen cases traverse real inspect, review, apply, replay, save, restore and XLSX export', async () => {
  let count = 0;
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const oracle = JSON.parse(
      await readBytes(new URL(`${entry.name}/oracle.json`, base), 'utf8'),
    ) as Oracle;
    if (!oracle.accepted) continue;
    const f = await reviewed(entry.name);
    const expectedCsv = await readBytes(
      new URL(`${entry.name}/expected.csv`, base),
      'utf8',
    );
    const originalBefore = hash(f.source.original!);
    const artifact = await f.session.apply(f.receipt, f.source, f.context);
    checkArtifact(artifact, oracle, expectedCsv);
    assert.equal(
      hash(f.source.original!),
      originalBefore,
      'apply preserves caller source bytes',
    );
    assert.deepEqual(
      f.source.sheets[0].rows,
      oracle.inventory.map((row) => row.values),
      'apply preserves caller extraction',
    );
    const replayed = await revalidateSplitArtifact(artifact);
    checkArtifact(replayed, oracle, expectedCsv);
    const bytes = await saveSplitArtifact(artifact);
    const restored = await restoreSplitArtifact(bytes);
    checkArtifact(restored, oracle, expectedCsv);
    assert.deepEqual(
      restored.provenance,
      artifact.provenance,
      'save/restore retains the complete historical audit',
    );
    const workbook = await exportSplitWorkbook(restored);
    assert.ok(workbook.byteLength > 0, 'native XLSX export was created');
    const otherSession = new SplitSectionSession(
      restored.originalSource,
      restored.context,
    );
    const restoredInspection = await otherSession.inspect();
    await assertCode(
      () =>
        otherSession.apply(
          restored.provenance.historicalReceipt as typeof f.receipt,
          restored.originalSource,
          restored.context,
        ),
      'SPLIT_RECEIPT',
    );
    const reselected = await otherSession.select(
      oracle.movements.map((m) => m.originalRow),
      restoredInspection.review.proposals.map((p) => p.id),
    );
    const newReceipt = await otherSession.recordReviewerDecision(
      decision(reselected),
    );
    assert.ok(
      newReceipt,
      'fresh explicit review can issue fresh authority after restore',
    );
    assert.notEqual(newReceipt.id, restored.provenance.historicalReceipt.id);
    const reapplied = await otherSession.apply(
      newReceipt,
      restored.originalSource,
      restored.context,
    );
    checkArtifact(reapplied, oracle, expectedCsv);
    await assertCode(
      () => f.session.apply(f.receipt, f.source, f.context),
      'SPLIT_RECEIPT',
    );
    if (process.env.P4_REPORT_DIR) {
      await mkdir(process.env.P4_REPORT_DIR, { recursive: true });
      const destination = new URL(
        `file://${process.env.P4_REPORT_DIR.replace(/\/$/, '')}/`,
      );
      await writeFile(
        new URL(`${entry.name}.xlsx`, destination),
        new Uint8Array(workbook),
      );
      await writeFile(
        new URL(`${entry.name}.split`, destination),
        new Uint8Array(bytes),
      );
      await report(`${entry.name}-lifecycle`, {
        case: entry.name,
        passed: true,
        sourceSha256: hash(artifact.originalPdf),
        csvSha256: hash(artifact.csv),
        originalRows: oracle.inventory.length,
        movementRows: artifact.provenance.selection.selectedMovementRows,
        totals: artifact.provenance.review.totals,
        financialApproval: false,
        scopeConfirmed: false,
      });
    }
    count++;
  }
  assert.equal(
    count,
    12,
    'every positive frozen fixture was actually executed',
  );
});

void test('inspect and incomplete/rejected/missing-acknowledgement review cannot create live authority', async () => {
  const f = await fixture();
  const inspected = await f.session.inspect();
  await assertCode(
    () =>
      f.session.apply(
        {} as Parameters<SplitSectionSession['apply']>[0],
        f.source,
        f.context,
      ),
    'SPLIT_RECEIPT',
  );
  await assertCode(
    () => f.session.recordReviewerDecision(decision(inspected)),
    'SPLIT_SELECTION',
  );
  const complete = await f.session.select(
    f.oracle.movements.map((m) => m.originalRow),
    inspected.review.proposals.map((p) => p.id),
  );
  assert.equal(
    await f.session.recordReviewerDecision(
      decision(complete, { decision: 'reject' }),
    ),
    null,
  );
  for (const name of Object.keys(acknowledgements)) {
    const incomplete = { ...acknowledgements, [name]: false };
    await assertCode(
      () =>
        f.session.recordReviewerDecision(
          decision(complete, {
            acknowledgements: incomplete as typeof acknowledgements,
          }),
        ),
      'SPLIT_REVIEWER',
    );
  }
  await assertCode(
    () =>
      f.session.recordReviewerDecision(
        decision(complete, { reviewerLabel: '' }),
      ),
    'SPLIT_REVIEWER',
  );
  await assertCode(
    () =>
      f.session.recordReviewerDecision(decision(complete, { rationale: '' })),
    'SPLIT_REVIEWER',
  );
});

// Exact source/proof/context deltas from the independently frozen ACTION-INPUTS-V2.
// Patched caller selections are supplied to apply for proof revalidation; merely
// editing a defensive returned copy would not change the session-owned review.
const tamperActions = [
  {
    id: 'A01-change-original-byte',
    code: 'SPLIT_STALE_REVIEW',
    stage: 'source-revalidation',
  },
  {
    id: 'A02-change-raw-cell',
    code: 'SPLIT_STALE_REVIEW',
    stage: 'source-revalidation',
  },
  {
    id: 'A03-change-page-map',
    code: 'SPLIT_STALE_REVIEW',
    stage: 'source-revalidation',
  },
  {
    id: 'A04-change-parent-span',
    code: 'SPLIT_STALE_REVIEW',
    stage: 'evidence-revalidation',
  },
  {
    id: 'A05-change-debit-cell',
    code: 'SPLIT_STALE_REVIEW',
    stage: 'evidence-revalidation',
  },
  {
    id: 'A06-swap-debit-credit',
    code: 'SPLIT_CONTEXT',
    stage: 'reading-context',
  },
  { id: 'A07-change-cuts', code: 'SPLIT_CONTEXT', stage: 'reading-context' },
  {
    id: 'A08-change-decimals',
    code: 'SPLIT_CONTEXT',
    stage: 'reading-context',
  },
  {
    id: 'A09-change-perspective',
    code: 'SPLIT_CONTEXT',
    stage: 'reading-context',
  },
  {
    id: 'A10-clone-receipt',
    code: 'SPLIT_RECEIPT',
    stage: 'receipt-ownership',
  },
  {
    id: 'A11-reuse-consumed-receipt',
    code: 'SPLIT_RECEIPT',
    stage: 'receipt-ownership',
  },
  {
    id: 'A12-select-subset',
    code: 'SPLIT_SELECTION',
    stage: 'complete-selection',
  },
  {
    id: 'A13-drop-zero-movement',
    code: 'SPLIT_SELECTION',
    stage: 'complete-selection',
  },
  {
    id: 'A14-change-reviewer',
    code: 'SPLIT_REVIEWER',
    stage: 'reviewer-context',
  },
] as const;
for (const action of tamperActions)
  void test(`${action.id}: ${action.stage}, zero new artifacts and authority`, async () => {
    const f = await reviewed(
      action.id.startsWith('A13') ? 'P08-complete-zero-section' : undefined,
    );
    const currentSource = structuredClone(f.source);
    const currentContext = structuredClone(f.context);
    const currentSelection = structuredClone(f.selection);
    let receipt = f.receipt;
    let setupArtifact: Artifact | undefined;
    switch (action.id) {
      case 'A01-change-original-byte': {
        const bytes = new Uint8Array(currentSource.original!);
        assert.equal(bytes[911], 53);
        bytes[911] = 54;
        assert.equal(
          hash(bytes),
          'fddd32739e2999322c6cfb1dbabcae536ad1b5be6fdd0c0131d3f390db3977bc',
        );
        break;
      }
      case 'A02-change-raw-cell':
        assert.equal(currentSource.sheets[0].rows[4][2], 'Supplied movement');
        currentSource.sheets[0].rows[4][2] = 'Changed movement';
        break;
      case 'A03-change-page-map':
        assert.equal(currentSource.sheets[0].rowPages!['13'], 2);
        currentSource.sheets[0].rowPages!['13'] = 1;
        break;
      case 'A04-change-parent-span': {
        const parent = currentSelection.review.proposals[0].evidence.parent;
        assert.equal(parent.spanEndExclusive, 14);
        assert.equal(parent.spanText, 'A-101');
        parent.spanEndExclusive = 13;
        parent.spanText = 'A-10';
        break;
      }
      case 'A05-change-debit-cell': {
        const debit = currentSelection.review.movements[0].debitEvidence;
        assert.equal(debit.cellText, '123.45');
        assert.equal(debit.spanText, '123.45');
        debit.cellText = '123.46';
        debit.spanText = '123.46';
        break;
      }
      case 'A06-swap-debit-credit':
        assert.equal(currentContext.mapping.debit, 3);
        assert.equal(currentContext.mapping.credit, 4);
        currentContext.mapping.debit = 4;
        currentContext.mapping.credit = 3;
        break;
      case 'A07-change-cuts':
        assert.deepEqual(currentSource.pdf!.cuts, [18, 36, 69, 83]);
        currentSource.pdf!.cuts = [18, 36, 68, 83];
        break;
      case 'A08-change-decimals':
        assert.equal(currentContext.decimals, 2);
        (currentContext as unknown as { decimals: number }).decimals = 3;
        break;
      case 'A09-change-perspective':
        assert.equal(currentContext.perspective, 'debit-minus-credit');
        (currentContext as unknown as { perspective: string }).perspective =
          'credit-minus-debit';
        break;
      case 'A10-clone-receipt':
        receipt = { ...receipt };
        assert.notEqual(receipt, f.receipt);
        break;
      case 'A11-reuse-consumed-receipt':
        setupArtifact = await f.session.apply(receipt, f.source, f.context);
        checkArtifact(
          setupArtifact,
          f.oracle,
          await readBytes(new URL(`${f.id}/expected.csv`, base), 'utf8'),
        );
        break;
      case 'A12-select-subset':
        assert.deepEqual(currentSelection.selectedMovementRows, [5, 6, 13]);
        currentSelection.selectedMovementRows = [5, 6];
        break;
      case 'A13-drop-zero-movement':
        assert.deepEqual(currentSelection.selectedMovementRows, [5]);
        assert.equal(currentSelection.review.movements[0].debitMinor, '0');
        assert.equal(currentSelection.review.movements[0].creditMinor, '0');
        currentSelection.selectedMovementRows = [];
        break;
      case 'A14-change-reviewer':
        f.session.updateReviewer(
          'Synthetic Reviewer B',
          reviewer.rationale,
        );
        break;
    }
    const before = setupArtifact
      ? JSON.stringify(setupArtifact.provenance)
      : undefined;
    const error = await assertCode(
      () =>
        f.session.apply(receipt, currentSource, currentContext, {
          currentSelection,
        }),
      action.code,
    );
    assert.equal(
      (error as Error & { stage: string }).stage,
      action.stage,
      'exact action refusal stage',
    );
    if (setupArtifact)
      assert.equal(
        JSON.stringify(setupArtifact.provenance),
        before,
        'A11 legitimate setup artifact remains unchanged',
      );
    await report(action.id, {
      id: action.id,
      passed: true,
      expectedStage: action.stage,
      actualCode: (error as Error & { code: string }).code,
      newDerivedArtifacts: 0,
      newAuthority: 0,
      setupArtifacts: setupArtifact ? 1 : 0,
      financialApproval: false,
      scopeConfirmed: false,
      partialPublication: false,
    });
  });

void test('A15-replace-owned-source-during-await: pending generation cannot publish', async () => {
  const f = await fixture();
  const replacement = await fixture('P08-complete-zero-section');
  let checkpoints = 0;
  await assertCode(
    () =>
      f.session.inspect({
        onCheckpoint: async (event) => {
          assert.equal(event.stage, 'owned-snapshot');
          checkpoints++;
          f.session.replaceSource(replacement.source, replacement.context);
        },
      }),
    'SPLIT_GENERATION',
  );
  assert.equal(
    checkpoints,
    1,
    'actual deterministic snapshot checkpoint executed',
  );
  await report('A15-replace-owned-source-during-await', {
    passed: true,
    actualCode: 'SPLIT_GENERATION',
    checkpoints,
    newDerivedArtifacts: 0,
    newAuthority: 0,
  });
});

void test('A16-mutate-caller-after-snapshot: actual owned snapshot remains legal and unchanged', async () => {
  const f = await fixture();
  let checkpoints = 0;
  const inspected = await f.session.inspect({
    onCheckpoint: (event) => {
      assert.equal(event.stage, 'owned-snapshot');
      checkpoints++;
      const bytes = new Uint8Array(f.source.original!);
      assert.equal(bytes[911], 53);
      bytes[911] = 55;
      assert.equal(f.source.sheets[0].rows[4][3], '123.45');
      f.source.sheets[0].rows[4][3] = '999.99';
    },
  });
  assert.equal(checkpoints, 1);
  assert.equal(inspected.review.sourceHash, f.oracle.sourceSha256);
  assert.deepEqual(
    inspected.review.rows.map((row) => row.values),
    f.oracle.inventory.map((row) => row.values),
  );
  assert.deepEqual(
    {
      debitMinor: inspected.review.grossDebitMinor,
      creditMinor: inspected.review.grossCreditMinor,
      netMinor: inspected.review.netMinor,
    },
    { debitMinor: '12795', creditMinor: '237', netMinor: '12558' },
  );
  const selection = await f.session.select(
    [5, 6, 13],
    inspected.review.proposals.map((p) => p.id),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  const unmodified = await fixture();
  const artifact = await f.session.apply(
    receipt,
    unmodified.source,
    unmodified.context,
  );
  checkArtifact(
    artifact,
    f.oracle,
    await readBytes(new URL(`${f.id}/expected.csv`, base), 'utf8'),
  );
  await report('A16-mutate-caller-after-snapshot', {
    passed: true,
    resultSourceSha256: inspected.review.sourceHash,
    resultMoney: {
      debitMinor: inspected.review.grossDebitMinor,
      creditMinor: inspected.review.grossCreditMinor,
      netMinor: inspected.review.netMinor,
    },
    ownedRowsUnchanged: true,
    checkpoints,
    financialApproval: false,
    scopeConfirmed: false,
  });
});

void test('A17-pre-abort: refusal precedes owned clone and native read', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort('Synthetic P4 pre-abort');
  let clones = 0;
  let nativeReads = 0;
  const originalClone = globalThis.structuredClone;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    clones++;
    return originalClone(...args);
  }) as typeof structuredClone;
  const originalGetter = f.source.original!;
  Object.defineProperty(f.source, 'original', {
    configurable: true,
    get() {
      nativeReads++;
      return originalGetter;
    },
  });
  try {
    await assertCode(
      () =>
        f.session.inspect({
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.stage === 'pdf-read') nativeReads++;
          },
        }),
      'cancelled',
    );
  } finally {
    globalThis.structuredClone = originalClone;
    Object.defineProperty(f.source, 'original', {
      configurable: true,
      writable: true,
      value: originalGetter,
    });
  }
  assert.equal(clones, 0);
  assert.equal(nativeReads, 0);
  await report('A17-pre-abort', {
    passed: true,
    actualCode: 'cancelled',
    ownedCloneCount: clones,
    nativeReadCount: nativeReads,
    newDerivedArtifacts: 0,
    newAuthority: 0,
  });
});

for (const action of [
  { id: 'A18-abort-native-page-1', stage: 'pdf-read', completed: 1 },
  { id: 'A19-abort-row-256', stage: 'section-rows', completed: 256 },
] as const)
  void test(`${action.id}: exact physical checkpoint cancels all publication`, async () => {
    const f = await fixture('R01-nine-pages-270-movements');
    const controller = new AbortController();
    const checkpoints: { stage: string; completed: number }[] = [];
    await assertCode(
      () =>
        f.session.inspect({
          signal: controller.signal,
          onProgress: (progress) => {
            checkpoints.push({
              stage: progress.stage,
              completed: progress.completed,
            });
            if (
              progress.stage === action.stage &&
              progress.completed === action.completed
            )
              controller.abort(`Synthetic P4 ${action.id}`);
          },
        }),
      'cancelled',
    );
    const sameStage = checkpoints.filter(
      (event) => event.stage === action.stage,
    );
    assert.ok(
      sameStage.some((event) => event.completed === action.completed),
      'required real native/physical checkpoint was reached',
    );
    assert.ok(
      sameStage.every((event) => event.completed <= action.completed),
      'no later page or row checkpoint was started',
    );
    if (action.id === 'A19-abort-row-256') {
      assert.equal(f.oracle.inventory[255].row, 256);
      assert.equal(f.oracle.inventory[255].kind, 'brought');
      assert.equal(f.oracle.inventory[255].page, 8);
    }
    await report(action.id, {
      passed: true,
      actualCode: 'cancelled',
      checkpoints,
      newDerivedArtifacts: 0,
      newAuthority: 0,
      partialPublication: false,
    });
  });

const resources = [
  {
    id: 'A20-lower-byte-budget',
    key: 'maxOriginalBytes',
    cap: 61441,
    required: 61442,
    unit: 'source-original-bytes',
  },
  {
    id: 'A21-lower-page-budget',
    key: 'maxPages',
    cap: 8,
    required: 9,
    unit: 'native-pages',
  },
  {
    id: 'A22-lower-row-budget',
    key: 'maxRows',
    cap: 324,
    required: 325,
    unit: 'physical-inventory-rows',
  },
  {
    id: 'A23-lower-evidence-budget',
    key: 'maxMoneyEvidenceCells',
    cap: 539,
    required: 540,
    unit: 'source-cell-proofs-for-both-movement-money-columns',
  },
  {
    id: 'A24-lower-proposal-budget',
    key: 'maxProposals',
    cap: 269,
    required: 270,
    unit: 'inherited-reference-claims',
  },
] as const;
for (const action of resources)
  void test(`${action.id}: ${action.unit} refuse the entire source`, async () => {
    const f = await fixture('R01-nine-pages-270-movements');
    assert.equal(f.source.original!.byteLength, 61442);
    assert.equal(f.source.pdf!.pages, 9);
    assert.equal(f.source.sheets[0].rows.length, 325);
    assert.equal(f.oracle.movements.length * 2, 540);
    assert.equal(f.oracle.movements.length, 270);
    const options: SplitSessionOptions =
      action.key === 'maxMoneyEvidenceCells'
        ? { maxMoneyEvidenceCells: action.cap }
        : { budgets: { [action.key]: action.cap } };
    await assertCode(() => f.session.inspect(options), 'resource-limit');
    if (action.key === 'maxMoneyEvidenceCells') {
      const boundary = await f.session.inspect({ maxMoneyEvidenceCells: 540 });
      assert.equal(
        boundary.review.state,
        'review-ready',
        'A23 exact movement-money-proof boundary passes without reducing other budgets',
      );
      assert.equal(boundary.review.movements.length * 2, 540);
      assert.equal(boundary.review.proposals.length, 270);
    }
    await report(action.id, {
      passed: true,
      actualCode: 'resource-limit',
      budgetKey: action.key,
      unit: action.unit,
      cap: action.cap,
      required: action.required,
      newDerivedArtifacts: 0,
      newAuthority: 0,
      partialPublication: false,
    });
  });

void test('artifact replay rejects stale CSV, component money, membership, evidence and original PDF', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  const patches: { patch: (copy: Artifact) => void; code: string }[] = [
    {
      patch: (copy) => {
        copy.csv = copy.csv.replace('123.45', '123.46');
      },
      code: 'SPLIT_DERIVED_REPLAY',
    },
    {
      patch: (copy) => {
        copy.provenance.links[0].debitMinor = '12346';
      },
      code: 'SPLIT_STALE_REVIEW',
    },
    {
      patch: (copy) => {
        copy.provenance.links.pop();
      },
      code: 'SPLIT_STALE_REVIEW',
    },
    {
      patch: (copy) => {
        copy.provenance.review.movements[0].debitEvidence.cellText = '123.46';
      },
      code: 'SPLIT_STALE_REVIEW',
    },
    {
      patch: (copy) => {
        new Uint8Array(copy.originalPdf)[911] = 54;
      },
      code: 'SPLIT_STALE_REVIEW',
    },
  ];
  for (const { patch, code } of patches) {
    const copy = structuredClone(artifact);
    patch(copy);
    await assertCode(() => revalidateSplitArtifact(copy), code);
  }
});

void test('an old real receipt cannot be applied after selecting the same complete members again', async () => {
  const f = await reviewed();
  await f.session.select(
    f.selection.selectedMovementRows,
    f.selection.selectedProposalIds,
  );
  await assertCode(
    () => f.session.apply(f.receipt, f.source, f.context),
    'SPLIT_RECEIPT',
  );
});
