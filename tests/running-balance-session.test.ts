import test, { after } from 'node:test';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { readRunningSyntheticPages } from './running-balance-test-helper.ts';
import {
  RUNNING_COLUMNS,
  RUNNING_RESOURCE_BUDGETS,
  guardRunningPlain,
  snapshotRunningInputs,
  checkRunningOptions,
  type RunningBalanceContext,
} from '../lib/reconciliation/running-balance.ts';
import {
  RunningBalanceSession,
  RUNNING_ARTIFACT_VERSION,
  saveRunningArtifact,
  restoreRunningArtifact,
  exportRunningWorkbook,
  revalidateRunningArtifact,
  type RunningSelection,
  type RunningReviewerDecision,
  type RunningArtifact,
  type RunningReceipt,
} from '../lib/reconciliation/running-balance-session.ts';

const base = new URL('../audit/running-balance/frozen/', import.meta.url);
const evidence = process.env.RUNNING_SESSION_REPORT_DIR
  ? pathToFileURL(resolve(process.env.RUNNING_SESSION_REPORT_DIR) + sep)
  : new URL('../work/running-balance-session/', import.meta.url);
const completedReports = new Map<string, Record<string, unknown>>();
const hash = (value: ArrayBuffer | string | Uint8Array) =>
  createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : new Uint8Array(
            value instanceof ArrayBuffer ? value : value.buffer,
            value instanceof ArrayBuffer ? 0 : value.byteOffset,
            value.byteLength,
          ),
    )
    .digest('hex');
type Facts = {
  id: string;
  accepted: boolean;
  pages: string[][][];
  sourceSha256: string;
  cuts: number[];
  expected: {
    openingMinor: number;
    closingMinor: number;
    debitMinor: number;
    creditMinor: number;
    count: number;
    balancesMinor: number[];
    references: string[];
  };
};
const context = (): RunningBalanceContext => ({
  columns: { ...RUNNING_COLUMNS },
  currency: 'SAR',
  decimals: 2,
  perspective: 'debit-minus-credit',
  extractionRevision: 'synthetic-native-running-balance-v1',
});
const acknowledgements = {
  originalRowsReviewed: true,
  referenceRolesReviewed: true,
  separateAmountsReviewed: true,
  perspectiveReviewed: true,
  currencyReviewed: true,
  balancesReviewed: true,
  sequenceReviewed: true,
  totalsReviewed: true,
  derivedSourceUnderstood: true,
} as const;
const reviewer = {
  label: 'Synthetic reviewer A',
  rationale:
    'All literal rows, provided balances, source sequence and separate component controls reviewed.',
};
async function report(id: string, details: Record<string, unknown>) {
  completedReports.set(id, details);
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL(`${id}.json`, evidence),
    JSON.stringify(
      {
        id,
        passed: true,
        financialApproval: false,
        scopeConfirmed: false,
        ...details,
      },
      null,
      2,
    ) + '\n',
  );
}
async function fixture(id = 'P01-two-pages-two-sections') {
  const facts = JSON.parse(
    await readBytes(new URL(`${id}/facts.json`, base), 'utf8'),
  ) as Facts;
  const original = await readBytes(new URL(`${id}/source.pdf`, base));
  const source = await readFile(
    `${id}.pdf`,
    Uint8Array.from(original).buffer,
    facts.cuts,
    false,
    undefined,
    32767,
  );
  assert.equal(source.sha256, facts.sourceSha256);
  assert.deepEqual(source.sheets[0].rows, facts.pages.flat());
  const reading = context();
  return {
    id,
    facts,
    original,
    source,
    context: reading,
    session: new RunningBalanceSession(source, reading),
  };
}
function decision(
  selection: RunningSelection,
  patch: Partial<RunningReviewerDecision> = {},
): RunningReviewerDecision {
  return {
    decision: 'accept',
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
async function reviewed(id?: string) {
  const f = await fixture(id);
  const inspected = await f.session.inspect();
  assert.equal(
    inspected.review.state,
    'review-ready',
    `${f.id}: complete frozen source`,
  );
  const selection = await f.session.select(
    inspected.review.movements.map((m) => m.originalRow),
    inspected.review.proposals.map((p) => p.id),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  return { ...f, selection, receipt };
}
async function refusal(action: () => Promise<unknown>, code?: string) {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof Error,
    'operation must refuse and publish no result',
  );
  if (code)
    assert.equal(
      (caught as Error & { code?: string }).code ?? caught.message,
      code,
    );
  return caught as Error & { code?: string; stage?: string };
}
function checkTruth(artifact: RunningArtifact, facts: Facts) {
  const r = artifact.provenance.review,
    e = facts.expected;
  assert.equal(artifact.version, RUNNING_ARTIFACT_VERSION);
  assert.equal(artifact.financialApproval, false);
  assert.equal(artifact.scopeConfirmed, false);
  assert.equal(r.openingMinor, String(e.openingMinor));
  assert.equal(r.closingMinor, String(e.closingMinor));
  assert.equal(r.grossDebitMinor, String(e.debitMinor));
  assert.equal(r.grossCreditMinor, String(e.creditMinor));
  assert.equal(r.movements.length, e.count);
  assert.deepEqual(
    r.movements.map((m) => m.balanceMinor),
    e.balancesMinor.map(String),
  );
  assert.deepEqual(
    r.movements.map((m) => m.reference),
    e.references,
  );
  assert.deepEqual(
    r.rows.map((row) => row.values),
    facts.pages.flat(),
  );
  assert.deepEqual(
    r.movements.map((m) => m.seq),
    Array.from({ length: e.count }, (_, i) => String(i + 1)),
  );
  for (const step of r.balanceSteps) {
    assert.equal(
      step.computedMinor,
      String(
        BigInt(step.previousProvidedMinor!) +
          BigInt(step.debitProvidedMinor!) -
          BigInt(step.creditProvidedMinor!),
      ),
    );
    assert.equal(step.differenceMinor, '0');
    assert.equal(step.nextProvidedMinor, step.computedMinor);
  }
  for (const c of r.controls) {
    if (c.differenceMinor !== null)
      assert.equal(c.differenceMinor, '0', c.role);
    if (c.debitDifferenceMinor !== undefined && c.debitDifferenceMinor !== null)
      assert.equal(c.debitDifferenceMinor, '0', c.role);
    if (
      c.creditDifferenceMinor !== undefined &&
      c.creditDifferenceMinor !== null
    )
      assert.equal(c.creditDifferenceMinor, '0', c.role);
  }
  const sourceRows = facts.pages
    .flat()
    .filter((row) => /^[1-9][0-9]*$/.test(row[0]));
  assert.deepEqual(
    r.movements.map((m) => [
      m.seq,
      m.date,
      m.description,
      m.debit,
      m.credit,
      m.balance,
    ]),
    sourceRows.map((row) => [row[0], row[1], row[3], row[4], row[5], row[6]]),
  );
}
async function checkWorkbook(bytes: ArrayBuffer, artifact: RunningArtifact) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    [
      'DerivedReading',
      'OriginalInventory',
      'SourceCellEvidence',
      'BalanceSteps',
      'Controls',
      'ControlMembers',
      'ReviewHistory',
      'OriginalPdf',
    ],
  );
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        assert.equal(
          typeof cell.value,
          'string',
          `${sheet.name}: literal string only`,
        );
        assert.equal(cell.type, ExcelJS.ValueType.String);
        assert.equal(cell.numFmt, '@');
        assert.ok((cell.value as string).length <= 32767);
      }),
    );
  const derived: string[][] = [];
  workbook.getWorksheet('DerivedReading')!.eachRow((row) => {
    derived.push((row.values as unknown[]).slice(1).map(String));
  });
  assert.deepEqual(derived, [
    ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
    ...artifact.provenance.review.movements.map((m) => [
      m.seq,
      m.date,
      m.reference,
      m.description,
      m.debit,
      m.credit,
      m.balance,
    ]),
  ]);
  const chunks: string[] = [];
  workbook.getWorksheet('OriginalPdf')!.eachRow((row, index) => {
    if (index > 1) chunks.push(row.getCell(2).value as string);
  });
  assert.equal(
    hash(Buffer.from(chunks.join(''), 'base64')),
    artifact.provenance.originalSha256,
  );
  assert.equal(
    workbook.getWorksheet('BalanceSteps')!.rowCount,
    artifact.provenance.review.balanceSteps.length + 1,
  );
  assert.equal(
    workbook.getWorksheet('Controls')!.rowCount,
    artifact.provenance.review.controls.length + 1,
  );
  assert.equal(
    workbook.getWorksheet('ControlMembers')!.rowCount,
    artifact.provenance.review.controls.reduce(
      (n, c) => n + c.members.length,
      1,
    ),
  );
  return workbook;
}

void test('all eight frozen positives complete inspect/select/review/apply/save/restore/Excel cycles with independent literal financial truth', async () => {
  const ids = (await readdir(base)).filter((id) => id.startsWith('P')).sort();
  assert.equal(ids.length, 8);
  for (const id of ids) {
    const f = await reviewed(id);
    const artifact = await f.session.apply(f.receipt, f.source, f.context);
    checkTruth(artifact, f.facts);
    const expectedCsv = await readBytes(
      new URL(`${id}/expected.csv`, base),
      'utf8',
    );
    assert.equal(artifact.csv, expectedCsv);
    const archive = await saveRunningArtifact(artifact);
    const restored = await restoreRunningArtifact(archive);
    checkTruth(restored, f.facts);
    assert.equal(hash(restored.originalPdf), f.facts.sourceSha256);
    assert.equal(restored.csv, expectedCsv);
    await checkWorkbook(await exportRunningWorkbook(restored), restored);
    await mkdir(new URL(`${id}/`, evidence), { recursive: true });
    await writeFile(
      new URL(`${id}/artifact.json`, evidence),
      new Uint8Array(archive),
    );
    await writeFile(
      new URL(`${id}/export.xlsx`, evidence),
      new Uint8Array(await exportRunningWorkbook(restored)),
    );
    await writeFile(new URL(`${id}/derived.csv`, evidence), artifact.csv);
    await report(`cycle-${id}`, {
      sourceSha256: f.facts.sourceSha256,
      expected: f.facts.expected,
      movementCount: artifact.provenance.review.movements.length,
      allSevenLiteralFields: true,
      archiveHistoricalOnly: true,
      workbookLiteralNoFormulas: true,
    });
  }
});

void test('A01 original-byte change refuses stale review and consumes live receipt', async () => {
  const f = await reviewed();
  const changed = structuredClone(f.source);
  new Uint8Array(changed.original!)[100] ^= 1;
  const error = await refusal(() =>
    f.session.apply(f.receipt, changed, f.context),
  );
  await refusal(
    () => f.session.apply(f.receipt, f.source, f.context),
    'RUNNING_RECEIPT',
  );
  await report('A01', {
    actualCode: error.code ?? error.message,
    newArtifacts: 0,
  });
});
void test('A02 cached rows and physical pages cannot be forged while retaining original hash', async () => {
  const results = [];
  for (const mode of ['row', 'page']) {
    const f = await reviewed();
    const changed = structuredClone(f.source);
    if (mode === 'row') changed.sheets[0].rows.reverse();
    else changed.sheets[0].rowPages!['11'] = 2;
    assert.equal(changed.sha256, f.source.sha256);
    const error = await refusal(() =>
      f.session.apply(f.receipt, changed, f.context),
    );
    results.push({ mode, refusal: error.code ?? error.message });
  }
  await report('A02', { results, newArtifacts: 0 });
});
void test('A03 swapping source balance and debit monetary roles refuses without inferring movements', async () => {
  const f = await reviewed();
  const changed = structuredClone(f.context);
  Object.assign(changed.columns, { debit: 6, balance: 4 });
  const error = await refusal(() =>
    f.session.apply(f.receipt, f.source, changed),
  );
  await report('A03', {
    refusal: error.code ?? error.message,
    newArtifacts: 0,
  });
});
void test('A04 changed period/account/perspective/currency/precision invalidates publication', async () => {
  const results = [];
  for (const field of [
    'period',
    'account',
    'perspective',
    'currency',
    'decimals',
  ]) {
    const f = await reviewed();
    const source = structuredClone(f.source),
      reading = structuredClone(f.context);
    if (field === 'period')
      source.sheets[0].rows[3][0] = 'Period: 2026-09-01/2026-10-31';
    else if (field === 'account')
      source.sheets[0].rows[2][0] = 'Account: ACCT-2';
    else
      Object.assign(reading, {
        [field]:
          field === 'decimals'
            ? 3
            : field === 'currency'
              ? 'USD'
              : 'credit-minus-debit',
      });
    const error = await refusal(() =>
      f.session.apply(f.receipt, source, reading),
    );
    await refusal(
      () => f.session.apply(f.receipt, f.source, f.context),
      'RUNNING_RECEIPT',
    );
    results.push({ field, refusal: error.code ?? error.message });
  }
  const f = await reviewed();
  await refusal(
    () =>
      f.session.apply(f.receipt, f.source, f.context, {
        onCheckpoint: () => f.session.invalidate(),
      }),
    'RUNNING_GENERATION',
  );
  await report('A04', { results, pendingPublicationInvalidated: true });
});
void test('A05 zero movements are mandatory selection members', async () => {
  const f = await reviewed('P03-zero-and-identical-movements');
  const zero = f.selection.review.movements.find(
    (m) => m.debitMinor === '0' && m.creditMinor === '0',
  )!;
  assert.ok(zero);
  const supplied = structuredClone(f.selection);
  supplied.selectedMovementRows = supplied.selectedMovementRows.filter(
    (row) => row !== zero.originalRow,
  );
  await refusal(
    () =>
      f.session.apply(f.receipt, f.source, f.context, {
        currentSelection: supplied,
      }),
    'RUNNING_SELECTION',
  );
  await report('A05', { omittedZeroRow: zero.originalRow, newArtifacts: 0 });
});
void test('A06 every inherited reference proposal is mandatory', async () => {
  const f = await reviewed();
  assert.ok(f.selection.selectedProposalIds.length);
  const supplied = structuredClone(f.selection);
  supplied.selectedProposalIds.pop();
  await refusal(
    () =>
      f.session.apply(f.receipt, f.source, f.context, {
        currentSelection: supplied,
      }),
    'RUNNING_SELECTION',
  );
  await report('A06', { newArtifacts: 0 });
});
void test('A07 changing reviewer label/rationale/acknowledgements invalidates receipt', async () => {
  for (const field of ['label', 'rationale']) {
    const f = await reviewed();
    f.session.updateReviewer(
      field === 'label' ? 'Reviewer B' : reviewer.label,
      field === 'rationale' ? 'Changed reviewed rationale' : reviewer.rationale,
    );
    await refusal(
      () => f.session.apply(f.receipt, f.source, f.context),
      'RUNNING_REVIEWER',
    );
  }
  for (const key of Object.keys(acknowledgements)) {
    const f = await reviewed();
    await refusal(
      () =>
        f.session.recordReviewerDecision(
          decision(f.selection, {
            acknowledgements: {
              ...acknowledgements,
              [key]: false,
            } as unknown as typeof acknowledgements,
          }),
        ),
      'RUNNING_REVIEWER',
    );
    await refusal(
      () => f.session.apply(f.receipt, f.source, f.context),
      'RUNNING_RECEIPT',
    );
  }
  await report('A07', {
    reviewerChanges: ['label', 'rationale', 'acknowledgements'],
    newArtifacts: 0,
  });
});
void test('A08 cloned/serialized/cross-session receipts never carry authority', async () => {
  const f = await reviewed();
  const other = await reviewed();
  for (const receipt of [
    { ...f.receipt },
    JSON.parse(JSON.stringify(f.receipt)),
  ])
    await refusal(
      () => f.session.apply(receipt, f.source, f.context),
      'RUNNING_RECEIPT',
    );
  await refusal(
    () => other.session.apply(f.receipt, other.source, other.context),
    'RUNNING_RECEIPT',
  );
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  checkTruth(artifact, f.facts);
  await report('A08', {
    forgedAttempts: 3,
    originalLiveReceiptStillOwned: true,
  });
});
void test('A09 receipt consumes before successful, failed and aborted apply awaits', async () => {
  for (const mode of ['success', 'failure', 'abort']) {
    const f = await reviewed();
    if (mode === 'success')
      await f.session.apply(f.receipt, f.source, f.context);
    else if (mode === 'failure') {
      const source = structuredClone(f.source);
      source.sheets[0].rows[10][6] = '999.99';
      await refusal(() => f.session.apply(f.receipt, source, f.context));
    } else {
      const controller = new AbortController();
      controller.abort();
      await refusal(
        () =>
          f.session.apply(f.receipt, f.source, f.context, {
            signal: controller.signal,
          }),
        'cancelled',
      );
    }
    await refusal(
      () => f.session.apply(f.receipt, f.source, f.context),
      'RUNNING_RECEIPT',
    );
  }
  const f = await reviewed();
  const first = f.session.apply(f.receipt, f.source, f.context);
  await refusal(
    () => f.session.apply(f.receipt, f.source, f.context),
    'RUNNING_RECEIPT',
  );
  await first;
  await report('A09', {
    modes: ['success', 'failed', 'preaborted', 'concurrent'],
    consumedBeforeAwait: true,
  });
});
void test('A10 valid restore is exact historical evidence without live authority', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  const restored = await restoreRunningArtifact(
    await saveRunningArtifact(artifact),
  );
  checkTruth(restored, f.facts);
  const another = await reviewed();
  await refusal(
    () =>
      another.session.apply(
        restored.provenance.historicalReceipt as RunningReceipt,
        f.source,
        f.context,
      ),
    'RUNNING_RECEIPT',
  );
  assert.equal(hash(restored.originalPdf), f.facts.sourceSha256);
  await report('A10', {
    exactPdf: true,
    exactBalances: true,
    historicalOnly: true,
  });
});

void test('A11 tampered opening/carry/closing and evidence spans refuse archive restore/export', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  const archived = await saveRunningArtifact(artifact);
  const attempts = [];
  for (const role of ['opening', 'carried', 'brought', 'closing', 'span']) {
    const payload = JSON.parse(new TextDecoder().decode(archived));
    if (role === 'span')
      payload.artifact.provenance.review.balanceSteps[0].nextEvidence
        .spanEndExclusive--;
    else {
      const c = payload.artifact.provenance.review.controls.find(
        (x: { role: string }) => x.role.includes(role),
      );
      assert.ok(c, role);
      c.providedMinor = '123';
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).buffer;
    const error = await refusal(() => restoreRunningArtifact(bytes));
    attempts.push({ role, code: error.code ?? error.message });
  }
  const changed = structuredClone(artifact);
  changed.provenance.review.balanceSteps[0].nextEvidence.cellText = '170.01';
  await refusal(() => exportRunningWorkbook(changed));
  await report('A11', { attempts, tamperedExportRefused: true });
});
void test('A12 CSV Seq/Balance and original inventory tampering refuse while net is unchanged', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  const archived = await saveRunningArtifact(artifact);
  const attempts = [];
  for (const role of ['seq', 'balance', 'inventory']) {
    const payload = JSON.parse(new TextDecoder().decode(archived));
    const net = payload.artifact.provenance.review.netMinor;
    if (role === 'seq')
      payload.artifact.csv = payload.artifact.csv.replace('1,2026', '9,2026');
    if (role === 'balance')
      payload.artifact.csv = payload.artifact.csv.replace('220.00', '220.01');
    if (role === 'inventory')
      payload.artifact.provenance.inventory[10].values[6] = '220.01';
    assert.equal(payload.artifact.provenance.review.netMinor, net);
    const error = await refusal(() =>
      restoreRunningArtifact(
        new TextEncoder().encode(JSON.stringify(payload)).buffer,
      ),
    );
    attempts.push({ role, code: error.code ?? error.message });
  }
  const changed = structuredClone(artifact);
  changed.csv = changed.csv.replace('220.00', '220.01');
  await refusal(() => exportRunningWorkbook(changed));
  await report('A12', { attempts, preservedNet: true });
});

// Independent native source authoring exercises physical cancellation and resource cases.
function zeroPages(
  count: number,
  description = 'zero movement',
  blankReference = false,
): string[][][] {
  const n = Math.ceil(count / 27),
    pages: string[][][] = [];
  let sequence = 1;
  for (let page = 1; page <= n; page++) {
    const rows: string[][] = [
      ['SYNTHETIC ONLY', '', '', '', '', '', ''],
      ['Statement: ST-ZERO', '', '', '', '', '', ''],
      ['Account: ACCT-ZERO', '', '', '', '', '', ''],
      ['Period: 2026-10-01/2026-10-31', '', '', '', '', '', ''],
      ['Currency: SAR', '', '', '', '', '', ''],
      ['Balance basis: debit-minus-credit', '', '', '', '', '', ''],
      [`Page: ${page} of ${n}`, '', '', '', '', '', ''],
      ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      page === 1
        ? ['Opening balance', '2026-10-01', '', '', '', '', '0']
        : ['Brought balance', '', '', '', '', '', '0'],
      [
        page === 1 ? 'Invoice: INV-Z' : 'Continued invoice: INV-Z',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ];
    const localCount = Math.min(27, count - sequence + 1);
    for (let i = 0; i < localCount; i++)
      rows.push([
        String(sequence++),
        '2026-10-10',
        blankReference ? '' : 'INV-Z',
        description,
        '0',
        '0',
        '0',
      ]);
    if (page === n)
      rows.push(['Section total: INV-Z', '', '', '', '0', '0', '']);
    rows.push(
      ['Page total', '', '', '', '0', '0', ''],
      [`Page count: ${localCount}`, '', '', '', '', '', ''],
    );
    if (page < n) rows.push(['Carried balance', '', '', '', '', '', '0']);
    else
      rows.push(
        ['Closing balance', '2026-10-31', '', '', '', '', '0'],
        ['Statement total', '', '', '', '0', '0', ''],
        [`Statement count: ${count}`, '', '', '', '', '', ''],
      );
    pages.push(rows);
  }
  return pages;
}
async function sourceSession(pages: string[][][]) {
  const source = await readRunningSyntheticPages(pages);
  const reading = context();
  return {
    source,
    context: reading,
    session: new RunningBalanceSession(source, reading),
  };
}
async function reviewedSource(pages: string[][][]) {
  const f = await sourceSession(pages);
  const inspected = await f.session.inspect();
  assert.equal(inspected.review.state, 'review-ready');
  const selection = await f.session.select(
    inspected.review.movements.map((m) => m.originalRow),
    inspected.review.proposals.map((p) => p.id),
  );
  const receipt = await f.session.recordReviewerDecision(decision(selection));
  assert.ok(receipt);
  return { ...f, selection, receipt };
}

void test('A13 abort before every branch, native next page, physical row256 and before publication', async () => {
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  const archive = await saveRunningArtifact(artifact);
  const controller = new AbortController();
  controller.abort();
  let getterReads = 0;
  const poisoned = Object.defineProperty({}, 'originalSource', {
    enumerable: true,
    get: () => {
      getterReads++;
      throw new Error('must not execute');
    },
  }) as RunningArtifact;
  await refusal(
    () => revalidateRunningArtifact(poisoned, { signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () => saveRunningArtifact(poisoned, { signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () => exportRunningWorkbook(poisoned, { signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () => restoreRunningArtifact(archive, { signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () => f.session.inspect({ signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () => f.session.select([], [], { signal: controller.signal }),
    'cancelled',
  );
  await refusal(
    () =>
      f.session.recordReviewerDecision(decision(f.selection), {
        signal: controller.signal,
      }),
    'cancelled',
  );
  assert.equal(getterReads, 0);
  const checkpoints = [];
  for (const stage of ['pdf-read', 'section-rows']) {
    const many = await sourceSession(zeroPages(270));
    const abort = new AbortController();
    let hit = false;
    await refusal(
      () =>
        many.session.inspect({
          signal: abort.signal,
          onProgress: (p) => {
            if (
              p.stage === stage &&
              p.completed === (stage === 'pdf-read' ? 1 : 256)
            ) {
              hit = true;
              abort.abort();
            }
          },
        }),
      'cancelled',
    );
    assert.equal(hit, true, `actual ${stage} checkpoint`);
    assert.equal(many.session.selection, null);
    checkpoints.push(stage);
  }
  const beforePublish = await reviewed();
  const abort = new AbortController();
  await refusal(
    () =>
      beforePublish.session.apply(
        beforePublish.receipt,
        beforePublish.source,
        beforePublish.context,
        {
          signal: abort.signal,
          onCheckpoint: (e) => {
            if (e.stage === 'before-publish') abort.abort();
          },
        },
      ),
    'cancelled',
  );
  await refusal(
    () =>
      beforePublish.session.apply(
        beforePublish.receipt,
        beforePublish.source,
        beforePublish.context,
      ),
    'RUNNING_RECEIPT',
  );
  await report('A13', {
    preAbortGetterReads: getterReads,
    actualCheckpoints: checkpoints,
    beforePublication: true,
    newArtifacts: 0,
  });
});
void test('A14 source replacement during pending inspect/review/apply blocks old generation', async () => {
  const replacement = await fixture('P07-zero-only-negative-opening');
  const f = await fixture();
  await refusal(
    () =>
      f.session.inspect({
        onCheckpoint: () =>
          f.session.replaceSource(replacement.source, replacement.context),
      }),
    'RUNNING_GENERATION',
  );
  assert.equal(f.session.selection, null);
  const reviewedPending = await reviewed();
  let replaced = false;
  await refusal(
    () =>
      reviewedPending.session.recordReviewerDecision(
        decision(reviewedPending.selection),
        {
          onProgress: (p) => {
            if (!replaced && p.stage === 'pdf-read') {
              replaced = true;
              reviewedPending.session.replaceSource(
                replacement.source,
                replacement.context,
              );
            }
          },
        },
      ),
    'RUNNING_GENERATION',
  );
  assert.ok(replaced);
  const applied = await reviewed();
  await refusal(
    () =>
      applied.session.apply(applied.receipt, applied.source, applied.context, {
        onCheckpoint: () =>
          applied.session.replaceSource(
            replacement.source,
            replacement.context,
          ),
      }),
    'RUNNING_GENERATION',
  );
  await report('A14', {
    stages: ['inspect', 'recordReviewerDecision', 'apply'],
    newArtifacts: 0,
  });
});
void test('A15 caller mutations after owned snapshots never alias source or evidence', async () => {
  const f = await reviewed();
  const original = structuredClone(f.source);
  const source = structuredClone(f.source),
    reading = structuredClone(f.context),
    supplied = structuredClone(f.selection);
  const artifact = await f.session.apply(f.receipt, source, reading, {
    currentSelection: supplied,
    onCheckpoint: () => {
      new Uint8Array(source.original!)[100] ^= 1;
      source.sheets[0].rows[10][6] = '999.99';
      supplied.review.movements[0].balanceEvidence.literal = '999.99';
      Object.assign(reading.columns, { balance: 4 });
    },
  });
  checkTruth(artifact, f.facts);
  assert.equal(hash(artifact.originalPdf), hash(original.original!));
  const snapshot = f.session.selection!;
  snapshot.review.movements[0].descriptionEvidence.literal = 'poison';
  assert.notEqual(
    f.session.selection!.review.movements[0].descriptionEvidence.literal,
    'poison',
  );
  await report('A15', {
    ownedPdfUnchanged: true,
    evidenceNotAliased: true,
    sevenLiteralsExact: true,
  });
});
void test('A16 getters/nonplain/symbol/sparse/cyclic descriptors refuse before clone without execution', async () => {
  const f = await fixture();
  let getterReads = 0;
  const badSource = structuredClone(f.source);
  Object.defineProperty(badSource, 'sheets', {
    enumerable: true,
    get: () => {
      getterReads++;
      return f.source.sheets;
    },
  });
  assert.throws(() => new RunningBalanceSession(badSource, f.context));
  const badContext = Object.defineProperty({}, 'columns', {
    enumerable: true,
    get: () => {
      getterReads++;
      return RUNNING_COLUMNS;
    },
  }) as RunningBalanceContext;
  assert.throws(() => new RunningBalanceSession(f.source, badContext));
  const options = Object.defineProperty({}, 'onCheckpoint', {
    enumerable: true,
    get: () => {
      getterReads++;
      return () => {};
    },
  });
  await refusal(() => f.session.inspect(options));
  const fakeSignal = Object.defineProperty({}, 'aborted', {
    enumerable: true,
    get: () => {
      getterReads++;
      return false;
    },
  });
  await refusal(() => f.session.inspect({ signal: fakeSignal as AbortSignal }));
  const live = await reviewed();
  const poison = Object.defineProperty({}, 'reviewerLabel', {
    enumerable: true,
    get: () => {
      getterReads++;
      return 'Reviewer';
    },
  }) as RunningReviewerDecision;
  await refusal(() => live.session.recordReviewerDecision(poison));
  for (const value of [
    new Date(),
    new Map(),
    Object.assign([], { extra: 'bad' }),
    Array(1),
    { [Symbol('key')]: 'bad' },
  ])
    assert.throws(() => guardRunningPlain(value));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => guardRunningPlain(cyclic));
  const poisonArtifact = Object.defineProperty({}, 'originalSource', {
    enumerable: true,
    get: () => {
      getterReads++;
      return f.source;
    },
  }) as RunningArtifact;
  await refusal(() => saveRunningArtifact(poisonArtifact));
  await refusal(() => exportRunningWorkbook(poisonArtifact));
  await refusal(() => revalidateRunningArtifact(poisonArtifact));
  assert.equal(getterReads, 0);
  await report('A16', {
    getterReads,
    rejected: [
      'source',
      'context',
      'options',
      'signal',
      'decision',
      'date',
      'map',
      'extra-array-key',
      'sparse-array',
      'symbol',
      'cycle',
    ],
  });
});

void test('A17 exact contract resource boundaries and +1 reject without truncation', async () => {
  const f = await fixture();
  const limits = RUNNING_RESOURCE_BUDGETS;
  const boundaries: Record<string, unknown>[] = [];
  for (const [key, make] of [
    [
      'maxOriginalBytes',
      (n: number) => {
        const x = structuredClone(f.source);
        x.original = new ArrayBuffer(n);
        return x;
      },
    ],
    [
      'maxPages',
      (n: number) => {
        const x = structuredClone(f.source);
        x.pdf!.pages = n;
        return x;
      },
    ],
    [
      'maxRows',
      (n: number) => {
        const x = structuredClone(f.source);
        x.sheets[0].rows = Array.from({ length: n }, () => [
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        return x;
      },
    ],
  ] as const) {
    const limit = limits[key];
    const boundary = make(limit);
    snapshotRunningInputs(boundary, f.context);
    assert.throws(() => snapshotRunningInputs(make(limit + 1), f.context));
    boundaries.push({
      key,
      boundary: limit,
      plusOneRejected: true,
      acceptancePromise:
        'allocation boundary only; native/semantic gates still apply',
    });
  }
  guardRunningPlain('x'.repeat(32767));
  assert.throws(() => guardRunningPlain('x'.repeat(32768)));
  boundaries.push({
    key: 'maxCellTextUnits',
    boundary: 32767,
    plusOneRejected: true,
  });
  const evidenceOperation = checkRunningOptions();
  evidenceOperation.evidence(65536);
  assert.throws(() => evidenceOperation.evidence(1));
  boundaries.push({
    key: 'maxEvidenceCells',
    boundary: 65536,
    plusOneRejected: true,
  });
  const proposalOperation = checkRunningOptions();
  for (let i = 0; i < 4096; i++) proposalOperation.proposal();
  assert.throws(() => proposalOperation.proposal());
  boundaries.push({
    key: 'maxProposals',
    boundary: 4096,
    plusOneRejected: true,
  });
  const exactNodes: null[][] = Array.from({ length: 20 }, (_, i) =>
    Array(i === 19 ? 50017 : 49998).fill(null),
  );
  guardRunningPlain(exactNodes);
  exactNodes[19].push(null);
  assert.throws(() => guardRunningPlain(exactNodes));
  boundaries.push({
    key: 'maxPlainNodes',
    boundary: 1000000,
    plusOneRejected: true,
  });
  const text: string[] = Array.from({ length: 305 }, () => 'x'.repeat(32767));
  text.push('x'.repeat(5251));
  guardRunningPlain(text);
  text[text.length - 1] += 'x';
  assert.throws(() => guardRunningPlain(text));
  boundaries.push({
    key: 'maxPlainTextUnits',
    boundary: 10000000,
    plusOneRejected: true,
  });
  let depth: unknown = null;
  for (let i = 0; i < 14; i++) depth = [depth];
  guardRunningPlain(depth);
  assert.throws(() => guardRunningPlain([depth]));
  boundaries.push({
    key: 'maxPlainDepth',
    boundary: 14,
    plusOneRejected: true,
  });
  const live = await reviewed();
  const artifact = await live.session.apply(
    live.receipt,
    live.source,
    live.context,
  );
  const atCsvCap = structuredClone(artifact);
  atCsvCap.csv = 'x'.repeat(8 * 1024 * 1024);
  const boundaryError = await refusal(() =>
    revalidateRunningArtifact(atCsvCap),
  );
  assert.equal(
    boundaryError.code,
    'RUNNING_DERIVED_REPLAY',
    'whole CSV file at cap passes allocation then fails exact native replay',
  );
  const overCsvCap = structuredClone(artifact);
  overCsvCap.csv = atCsvCap.csv + 'x';
  const overError = await refusal(() => revalidateRunningArtifact(overCsvCap));
  assert.equal(overError.code, 'RUNNING_ARCHIVE');
  boundaries.push({
    key: 'maxCsvBytes',
    boundary: 8 * 1024 * 1024,
    boundaryReachedReplay: true,
    plusOneRejected: true,
  });
  await report('A17', { boundaries, noTruncation: true });
});
void test('A18 restored workbook retains seven literal fields, every control/member and exact PDF with no formulas', async () => {
  const f = await reviewed('P08-literal-decimal-forms');
  const original = await f.session.apply(f.receipt, f.source, f.context);
  const restored = await restoreRunningArtifact(
    await saveRunningArtifact(original),
  );
  const workbook = await checkWorkbook(
    await exportRunningWorkbook(restored),
    restored,
  );
  const balances = restored.provenance.review.movements.map((m) => m.balance);
  assert.deepEqual(
    balances,
    f.facts.pages
      .flat()
      .filter((r) => /^[1-9][0-9]*$/.test(r[0]))
      .map((r) => r[6]),
  );
  const evidenceSheet = workbook.getWorksheet('SourceCellEvidence')!;
  assert.ok(
    evidenceSheet.rowCount > restored.provenance.review.movements.length * 7,
  );
  await report('A18', {
    exactLiterals: true,
    noFormulas: true,
    controls: restored.provenance.review.controls.length,
    members: restored.provenance.review.controls.reduce(
      (n, c) => n + c.members.length,
      0,
    ),
    pdfSha256: hash(restored.originalPdf),
  });
});
void test('A19 family artifact never auto-assigns comparison scope/opening/closing or approves finances', async () => {
  const unrelated = {
    opening: '17.23',
    closing: '8.00',
    scopeConfirmed: false,
    financialApproval: false,
    account: 'OTHER',
  };
  const before = structuredClone(unrelated);
  const f = await reviewed();
  const artifact = await f.session.apply(f.receipt, f.source, f.context);
  await saveRunningArtifact(artifact);
  await exportRunningWorkbook(artifact);
  assert.deepEqual(unrelated, before);
  assert.equal(artifact.mapping.opening, '');
  assert.equal(artifact.mapping.closing, '');
  assert.equal(artifact.mapping.periodStart, '');
  assert.deepEqual(artifact.mapping.excluded, {});
  assert.equal(artifact.scopeConfirmed, false);
  assert.equal(artifact.financialApproval, false);
  assert.equal(Object.hasOwn(artifact, 'scope'), false);
  assert.equal(Object.hasOwn(artifact, 'transactions'), false);
  assert.equal(Object.hasOwn(artifact, 'comparison'), false);
  await report('A19', {
    unrelatedComparisonUnchanged: true,
    explicitIndependentDerivedSource: true,
    automaticBalanceAssignment: false,
  });
});
void test('A20 valid uniform IDs retain financial truth with newly bound source and evidence', async () => {
  const f = await fixture();
  const pages = structuredClone(f.facts.pages);
  for (const page of pages)
    for (const row of page)
      for (let i = 0; i < row.length; i++)
        row[i] = row[i]
          .replaceAll('ST-001', 'Statement.New/7')
          .replaceAll('ACCT-1', 'Account.New_2')
          .replaceAll('INV-A', 'Parent.New-A')
          .replaceAll('INV-B', 'Parent.New-B');
  const changed = await reviewedSource(pages);
  const artifact = await changed.session.apply(
    changed.receipt,
    changed.source,
    changed.context,
  );
  assert.equal(
    artifact.provenance.review.grossDebitMinor,
    String(f.facts.expected.debitMinor),
  );
  assert.equal(
    artifact.provenance.review.grossCreditMinor,
    String(f.facts.expected.creditMinor),
  );
  assert.deepEqual(
    artifact.provenance.review.movements.map((m) => m.balanceMinor),
    f.facts.expected.balancesMinor.map(String),
  );
  assert.notEqual(artifact.provenance.originalSha256, f.facts.sourceSha256);
  assert.equal(
    artifact.provenance.review.declaredScope!.statement,
    'Statement.New/7',
  );
  assert.equal(
    artifact.provenance.review.declaredScope!.account,
    'Account.New_2',
  );
  for (const m of artifact.provenance.review.movements)
    assert.equal(
      m.parentEvidence.sourceHash,
      artifact.provenance.originalSha256,
    );
  await restoreRunningArtifact(await saveRunningArtifact(artifact));
  await report('A20', {
    sameFinancialTruth: true,
    oldHash: f.facts.sourceSha256,
    newHash: artifact.provenance.originalSha256,
    newlyBoundIdentifiers: true,
  });
});
void test('A21 uniform period/date shift retains physical sequence and exact money', async () => {
  const f = await fixture('P04-posting-order-not-date-order');
  const pages = structuredClone(f.facts.pages);
  for (const page of pages)
    for (const row of page)
      for (let i = 0; i < row.length; i++)
        row[i] = row[i].replaceAll('2026-10-', '2027-10-');
  const changed = await reviewedSource(pages);
  const artifact = await changed.session.apply(
    changed.receipt,
    changed.source,
    changed.context,
  );
  assert.deepEqual(
    artifact.provenance.review.movements.map((m) => m.seq),
    Array.from({ length: f.facts.expected.count }, (_, i) => String(i + 1)),
  );
  assert.deepEqual(
    artifact.provenance.review.movements.map((m) => m.balanceMinor),
    f.facts.expected.balancesMinor.map(String),
  );
  assert.equal(
    artifact.provenance.review.grossDebitMinor,
    String(f.facts.expected.debitMinor),
  );
  assert.deepEqual(
    artifact.provenance.review.movements.map((m) => m.date),
    f.facts.pages
      .flat()
      .filter((r) => /^[1-9][0-9]*$/.test(r[0]))
      .map((r) => r[1].replace('2026', '2027')),
  );
  assert.notEqual(artifact.provenance.originalSha256, f.facts.sourceSha256);
  await restoreRunningArtifact(await saveRunningArtifact(artifact));
  await report('A21', {
    sameFinancialTruth: true,
    physicalSequenceUnchanged: true,
    newlyBoundDateEvidence: true,
  });
});
void test('A22 invalid identity/canonical Seq/page/count syntax and out-of-period dates block the entire source', async () => {
  const f = await fixture();
  const defects = [
    { kind: 'statement-id', row: 1, col: 0, value: 'Statement: BAD ID' },
    { kind: 'account-id', row: 2, col: 0, value: 'Account: /BAD' },
    { kind: 'parent-id', row: 9, col: 0, value: 'Invoice: BAD ID' },
    { kind: 'seq', row: 10, col: 0, value: '01' },
    { kind: 'page', row: 6, col: 0, value: 'Page: 01 of 2' },
    { kind: 'count', row: 13, col: 0, value: 'Page count: 02' },
    { kind: 'date', row: 10, col: 1, value: '2026-09-30' },
  ];
  const results = [];
  for (const defect of defects) {
    const pages = structuredClone(f.facts.pages);
    pages[0][defect.row][defect.col] = defect.value;
    const changed = await sourceSession(pages);
    const inspected = await changed.session.inspect();
    assert.equal(inspected.review.state, 'blocked', defect.kind);
    assert.deepEqual(inspected.review.movements, []);
    assert.deepEqual(inspected.review.proposals, []);
    await refusal(() =>
      changed.session.recordReviewerDecision(decision(inspected)),
    );
    results.push({
      defect: defect.kind,
      diagnostics: inspected.review.diagnostics.map((d) => d.code),
    });
  }
  await report('A22', { results, noPartialArtifacts: true });
});
void test('A23 valid native source with large repeated evidence refuses before successful artifact delivery', async () => {
  const f = await reviewedSource(zeroPages(60, 'x'.repeat(15000)));
  assert.equal(f.selection.review.sourceVerified, true);
  assert.equal(f.selection.review.state, 'review-ready');
  assert.equal(f.selection.review.movements.length, 60);
  assert.ok(f.source.original!.byteLength < 8 * 1024 * 1024);
  assert.equal(f.selection.review.grossDebitMinor, '0');
  assert.equal(f.selection.review.grossCreditMinor, '0');
  const error = await refusal(
    () => f.session.apply(f.receipt, f.source, f.context),
    'resource-limit',
  );
  assert.notEqual(f.session.state, 'derived');
  await refusal(
    () => f.session.apply(f.receipt, f.source, f.context),
    'RUNNING_RECEIPT',
  );
  await report('A23', {
    validNativeSource: true,
    sourceBytes: f.source.original!.byteLength,
    movementCount: 60,
    descriptionUnits: 15000,
    repeatedArtifactBudgetRefused: true,
    refusal: error.code,
    newArtifacts: 0,
  });
});
void test('A24 reduced caps reject at their configured limit and cannot raise contract maxima', async () => {
  const f = await fixture();
  const reductions = {
    maxOriginalBytes: f.source.original!.byteLength - 1,
    maxPages: 1,
    maxRows: f.source.sheets[0].rows.length - 1,
    maxCellTextUnits: 10,
    maxProposals: 1,
    maxEvidenceCells: 1,
    maxPlainNodes: 1,
    maxPlainTextUnits: 1,
    maxPlainDepth: 1,
  };
  const results = [];
  for (const [key, limit] of Object.entries(reductions)) {
    const session = new RunningBalanceSession(f.source, f.context);
    const error = await refusal(
      () => session.inspect({ budgets: { [key]: limit } }),
      'resource-limit',
    );
    results.push({ key, configuredLimit: limit, refusal: error.code });
  }
  const live = await reviewed();
  const artifact = await live.session.apply(
    live.receipt,
    live.source,
    live.context,
  );
  await refusal(
    () =>
      saveRunningArtifact(artifact, {
        budgets: {
          maxCsvBytes: new TextEncoder().encode(artifact.csv).byteLength - 1,
        },
      }),
    'RUNNING_ARCHIVE',
  );
  results.push({
    key: 'maxCsvBytes',
    configuredLimit: new TextEncoder().encode(artifact.csv).byteLength - 1,
  });
  for (const [key, maximum] of Object.entries(RUNNING_RESOURCE_BUDGETS))
    assert.throws(() =>
      checkRunningOptions({ budgets: { [key]: maximum + 1 } }),
    );
  await report('A24', { results, optionsCannotRaiseContractMaxima: true });
});

void test('explicit rejection, all acknowledgements and bounded selection operations preserve lifecycle', async () => {
  const f = await fixture();
  const inspected = await f.session.inspect();
  const complete = await f.session.select(
    inspected.review.movements.map((m) => m.originalRow),
    inspected.review.proposals.map((p) => p.id),
  );
  assert.equal(
    await f.session.recordReviewerDecision(
      decision(complete, { decision: 'reject' }),
    ),
    null,
  );
  assert.equal(f.session.state, 'rejected');
  await refusal(
    () =>
      f.session.select(
        [complete.selectedMovementRows[0], complete.selectedMovementRows[0]],
        complete.selectedProposalIds,
      ),
    'RUNNING_SELECTION',
  );
  await refusal(
    () =>
      f.session.select(
        complete.selectedMovementRows,
        complete.selectedProposalIds,
        { budgets: { maxPlainNodes: 2 } },
      ),
    'resource-limit',
  );
  await refusal(
    () =>
      f.session.recordReviewerDecision(
        decision(complete, { reviewerLabel: '' }),
      ),
    'RUNNING_REVIEWER',
  );
  await refusal(
    () =>
      f.session.recordReviewerDecision(decision(complete, { rationale: '' })),
    'RUNNING_REVIEWER',
  );
});

// Keep the report map self-contained in an isolated checkout. The authored
// action specification is a byte-exact copy of the approved pre-code package.
after(async () => {
  const actionBytes = await readBytes(
    new URL('../audit/running-balance/ACTION-TRUTHS.json', import.meta.url),
  );
  assert.equal(
    hash(actionBytes),
    'ba1fde2c912f99f0a72f8b1f5e1b25e4b6bd53eacfd8a94ba621e9062c784f68',
  );
  const truths = JSON.parse(actionBytes.toString('utf8')) as {
    contract: string;
    actions: { id: string; action: string; expected: string }[];
  };
  assert.deepEqual(
    truths.actions.map((action) => action.id),
    Array.from({ length: 24 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL('ACTION-RESULTS.json', evidence),
    JSON.stringify(
      {
        contract: truths.contract,
        actionTruthsSha256: hash(actionBytes),
        actionCount: truths.actions.length,
        passedActions: truths.actions.filter((action) =>
          completedReports.has(action.id),
        ).length,
        completedPositiveCycles: [...completedReports.keys()].filter((id) =>
          id.startsWith('cycle-P'),
        ).length,
        actions: truths.actions.map((action) => ({
          ...action,
          passed: completedReports.has(action.id),
          evidence: `${action.id}.json`,
        })),
        financialApproval: false,
        scopeConfirmed: false,
      },
      null,
      2,
    ) + '\n',
  );
});
