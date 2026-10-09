import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  InvoiceOverlapReviewLedger,
  prepareInvoiceOverlapReview,
} from '../lib/reconciliation/invoice-overlap-review.ts';
import type {
  InvoiceOverlapReviewInput,
  InvoiceOverlapSelection,
} from '../lib/reconciliation/invoice-overlap-review.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
// Evidence writes are explicitly opt-in; ordinary test runs cannot rewrite sealed books.
const saveFixture = (path: URL, bytes: Uint8Array) => {
  if (process.env.INVOICE_OVERLAP_SAVE_FIXTURES === '1')
    writeFileSync(path, bytes);
};
const mapping: Mapping = {
  sheet: 0,
  header: 0,
  date: 3,
  reference: 0,
  description: -1,
  amount: 2,
  debit: -1,
  credit: -1,
  currencyColumn: -1,
  mode: 'signed',
  multiplier: 1,
  numberFormat: 'dot',
  dateFormat: 'ymd',
  reportType: 'transactions',
  opening: '',
  closing: '',
  periodStart: '',
  excluded: {},
};
const scope: Scope = {
  entity: 'E',
  account: 'AP',
  supplier: 'S',
  currency: 'SAR',
  decimals: 0,
  cutoff: '2026-09-30',
  dateWindow: 7,
  confirmed: true,
  coverageConfirmed: true,
};
async function fixture(): Promise<InvoiceOverlapReviewInput> {
  const header = 'Invoice No,Reference,Amount,Date,Document Type\n';
  const csvs = [
    header + 'INV-X,,100,2026-09-01,Invoice\n',
    header +
      'INV-X,,40,2026-09-01,Invoice\nINV-X,,60,2026-09-02,Invoice\nINV-X,,100,2026-09-03,Invoice\n',
  ];
  const files = await Promise.all(
    csvs.map((s, i) =>
      readFile(`overlap-${i}.csv`, new TextEncoder().encode(s).buffer),
    ),
  );
  return {
    currentSourceFiles: files as [SourceFile, SourceFile],
    mappings: [structuredClone(mapping), structuredClone(mapping)],
    scope: structuredClone(scope),
    revision: 'native-revision-1',
  };
}
async function selection(
  ledger: InvoiceOverlapReviewLedger,
  input: InvoiceOverlapReviewInput,
  mode = 'split',
): Promise<InvoiceOverlapSelection> {
  const s = await ledger.inspect(input);
  assert.equal(s.search.searchComplete, true);
  assert.equal(s.search.candidates.length, 2);
  const c = s.search.components[0];
  return {
    generation: ledger.state.generation,
    snapshotKey: s.snapshotKey,
    componentId: c.id,
    reviewerLabel: 'Accountant A',
    rationale:
      'Reviewed original invoice and all alternative members; source ledger single row remains unmatched.',
    reviewedRowKeys: [...c.rowKeys],
    decisions: s.search.candidates
      .filter((x) => c.candidateIds.includes(x.id))
      .map((x) => ({
        candidateId: x.id,
        decision:
          (mode === 'split' && x.ledgerIds.length === 2) ||
          (mode === 'single' && x.ledgerIds.length === 1) ||
          mode === 'both'
            ? 'accepted'
            : 'rejected',
        rationale:
          'Original dated source rows reviewed; aggregate belongs to the chosen invoice settlement.',
      })),
  };
}
void test('independent Python transition oracle is frozen before implementation', () => {
  const oracle = JSON.parse(
    readFileSync(
      new URL(
        '../audit/invoice-overlap-review-v1/frozen-transition-truths.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(oracle.cases.length, 12);
  assert.equal(
    oracle.cases.find((x: { name: string }) => x.name === 'overlap').expected,
    'refused-unchanged',
  );
});
for (const mode of ['split', 'single', 'reject-all'])
  void test(`atomic explicit ${mode}, independent source money preserved and undo restores whole component`, async () => {
    const input = await fixture(),
      before = structuredClone(input),
      ledger = new InvoiceOverlapReviewLedger(),
      sel = await selection(ledger, input, mode);
    const state = await ledger.commit(input, sel);
    assert.equal(state.generation, 1);
    assert.equal(state.receipts.length, 1);
    assert.deepEqual(input, before);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await ledger.exportWorkbook(input));
    const expected = mode === 'reject-all' ? 0 : 1;
    assert.equal(
      book.getWorksheet('Accepted aggregates')!.rowCount,
      expected + 1,
    );
    assert.equal(book.getWorksheet('Original movements')!.rowCount, 5);
    if (expected)
      assert.equal(
        book.getWorksheet('Accepted aggregates')!.getCell('F2').value,
        100,
      );
    const session = await ledger.exportSession(input),
      restored = new InvoiceOverlapReviewLedger();
    const imported = await restored.reimportSession(input, session);
    assert.equal(imported.status, 'archived-not-authoritative');
    assert.equal(restored.state.generation, 0);
    assert.deepEqual(restored.state.activeReceiptIds, []);
    assert.deepEqual(restored.archivedReviewDraft, session);
    await restored.commit(input, await selection(restored, input, mode));
    assert.deepEqual(restored.state, ledger.state);
    const undone = await ledger.undo(input, {
      generation: 1,
      receiptId: state.receipts[0].id,
      reviewerLabel: 'Accountant A',
      rationale: 'Reopen the whole component for further source review.',
    });
    assert.deepEqual(undone.activeReceiptIds, []);
    assert.equal(undone.receipts.length, 2);
    const after = new ExcelJS.Workbook();
    await after.xlsx.load(await ledger.exportWorkbook(input));
    assert.equal(after.getWorksheet('Accepted aggregates')!.rowCount, 1);
    for (let r = 2; r <= 5; r++)
      assert.equal(
        after.getWorksheet('Original movements')!.getCell(`H${r}`).value,
        'unmatched',
      );
  });
const edits: [string, (s: InvoiceOverlapSelection) => void][] = [
  [
    'overlapping choices',
    (s) => s.decisions.forEach((d) => (d.decision = 'accepted')),
  ],
  ['omitted competitor', (s) => s.decisions.pop()],
  ['omitted residual', (s) => s.reviewedRowKeys.pop()],
  ['duplicate decision', (s) => s.decisions.push(s.decisions[0])],
  [
    'duplicate reviewed row',
    (s) => s.reviewedRowKeys.push(s.reviewedRowKeys[0]),
  ],
  ['outside component', (s) => (s.componentId = 'forged')],
  ['unknown candidate', (s) => (s.decisions[0].candidateId = 'unknown')],
  ['stale snapshot', (s) => (s.snapshotKey = 'forged')],
  ['stale generation', (s) => (s.generation = 5)],
  ['blank reviewer', (s) => (s.reviewerLabel = '')],
  ['blank reason', (s) => (s.rationale = ' ')],
  ['blank per choice reason', (s) => (s.decisions[0].rationale = '')],
  [
    'unknown decision',
    (s) => ((s.decisions[0] as { decision: string }).decision = 'auto'),
  ],
];
for (const [name, edit] of edits)
  void test(`${name}: no partial ledger write`, async () => {
    const input = await fixture(),
      ledger = new InvoiceOverlapReviewLedger(),
      s = await selection(ledger, input);
    edit(s);
    const before = ledger.state;
    await assert.rejects(ledger.commit(input, s));
    assert.deepEqual(ledger.state, before);
  });
for (const [name, edit] of [
  [
    'cached rows',
    (i: InvoiceOverlapReviewInput) =>
      (i.currentSourceFiles[0].sheets[0].rows[1][2] = '99'),
  ],
  [
    'original bytes',
    (i: InvoiceOverlapReviewInput) =>
      (new Uint8Array(i.currentSourceFiles[0].original!)[10] ^= 1),
  ],
  [
    'hash',
    (i: InvoiceOverlapReviewInput) =>
      (i.currentSourceFiles[0].sha256 = '0'.repeat(64)),
  ],
  [
    'mapping',
    (i: InvoiceOverlapReviewInput) =>
      (i.mappings[0].excluded = { '2': 'manual' }),
  ],
  ['scope', (i: InvoiceOverlapReviewInput) => (i.scope.account = 'Other')],
  ['revision', (i: InvoiceOverlapReviewInput) => (i.revision = 'changed')],
  [
    'derived forgery',
    (i: InvoiceOverlapReviewInput) =>
      (i.currentSourceFiles[0].kind = 'derived-source'),
  ],
] as const)
  void test(`changed ${name} refuses commit/undo/export/session without mutation`, async () => {
    const input = await fixture(),
      ledger = new InvoiceOverlapReviewLedger(),
      s = await selection(ledger, input);
    await ledger.commit(input, s);
    const before = ledger.state,
      session = await ledger.exportSession(input);
    edit(input);
    await assert.rejects(ledger.commit(input, { ...s, generation: 1 }));
    await assert.rejects(
      ledger.undo(input, {
        generation: 1,
        receiptId: before.receipts[0].id,
        reviewerLabel: 'A',
        rationale: 'Review reopened',
      }),
    );
    await assert.rejects(ledger.exportWorkbook(input));
    await assert.rejects(ledger.exportSession(input));
    await assert.rejects(
      new InvoiceOverlapReviewLedger().reimportSession(input, session),
    );
    assert.deepEqual(ledger.state, before);
  });
void test('caller mutations cannot modify private receipts or exported state', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger(),
    s = await selection(l, i);
  await l.commit(i, s);
  s.decisions[0].rationale = 'tampered';
  const state = l.state;
  state.receipts[0].decisions = [];
  state.activeReceiptIds = [];
  assert.equal(l.state.receipts[0].decisions.length, 2);
  assert.equal(l.state.activeReceiptIds.length, 1);
});
void test('concurrent commits publish exactly one complete receipt', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger(),
    s = await selection(l, i);
  const results = await Promise.allSettled([l.commit(i, s), l.commit(i, s)]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(l.state.generation, 1);
  assert.equal(l.state.receipts.length, 1);
});
void test('cancelled native inspection and midflight source edit cannot publish', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger(),
    s = await selection(l, i),
    abort = new AbortController();
  abort.abort();
  i.signal = abort.signal;
  await assert.rejects(l.commit(i, s));
  delete i.signal;
  const pending = l.commit(i, s);
  i.revision = 'new';
  await assert.rejects(pending);
  assert.equal(l.state.generation, 0);
});
void test('tampered session events and active IDs refuse whole restore', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger();
  await l.commit(i, await selection(l, i));
  const session = await l.exportSession(i);
  for (const edit of [
    (x: typeof session) => (x.state.receipts[0].generation = 8),
    (x: typeof session) => (x.state.receipts[0].id = 'forged'),
    (x: typeof session) => (x.state.activeReceiptIds = []),
    (x: typeof session) => x.state.receipts[0].decisions.pop(),
  ]) {
    const altered = structuredClone(session);
    edit(altered);
    const restored = new InvoiceOverlapReviewLedger();
    await assert.rejects(restored.reimportSession(i, altered));
    assert.equal(restored.state.generation, 0);
  }
});
void test('native independent export fixture preserves accepted/restored/undone outputs', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger();
  await l.commit(i, await selection(l, i));
  const base = new URL('../audit/invoice-overlap-review-v1/', import.meta.url);
  saveFixture(
    new URL('accepted.xlsx', base),
    new Uint8Array(await l.exportWorkbook(i)),
  );
  const session = await l.exportSession(i),
    restored = new InvoiceOverlapReviewLedger();
  await restored.reimportSession(i, session);
  saveFixture(
    new URL('import-draft.xlsx', base),
    new Uint8Array(await restored.exportWorkbook(i)),
  );
  await restored.commit(i, await selection(restored, i));
  saveFixture(
    new URL('restored.xlsx', base),
    new Uint8Array(await restored.exportWorkbook(i)),
  );
  await l.undo(i, {
    generation: 1,
    receiptId: l.state.receipts[0].id,
    reviewerLabel: 'Accountant A',
    rationale: 'Reopen all members',
  });
  saveFixture(
    new URL('undone.xlsx', base),
    new Uint8Array(await l.exportWorkbook(i)),
  );
});

void test('semantically edited imported decisions remain nonauthoritative review drafts', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger();
  await l.commit(i, await selection(l, i));
  const session = await l.exportSession(i);
  session.state.receipts[0].decisions.forEach(
    (d) => (d.decision = d.decision === 'accepted' ? 'rejected' : 'accepted'),
  );
  session.state.receipts[0].rationale =
    'Imported claim changed, needs new human review';
  const restored = new InvoiceOverlapReviewLedger();
  assert.equal(
    (await restored.reimportSession(i, session)).status,
    'archived-not-authoritative',
  );
  assert.equal(restored.state.generation, 0);
  assert.deepEqual(restored.state.activeReceiptIds, []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await restored.exportWorkbook(i));
  assert.equal(workbook.getWorksheet('Accepted aggregates')!.rowCount, 1);
});
void test('invalidation cancels pending commit and never resurrects an undone imported journal', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger(),
    sel = await selection(l, i);
  const pending = l.commit(i, sel);
  l.invalidatePending();
  await assert.rejects(pending);
  assert.equal(l.state.generation, 0);
  await l.commit(i, await selection(l, i));
  const archive = await l.exportSession(i);
  await l.undo(i, {
    generation: 1,
    receiptId: l.state.receipts[0].id,
    reviewerLabel: 'A',
    rationale: 'Review revoked for full component',
  });
  const before = l.state;
  const restored = await l.reimportSession(i, archive);
  assert.equal(restored.status, 'archived-not-authoritative');
  assert.deepEqual(l.state, before);
  assert.deepEqual((await l.acceptedView(i)).aggregates, []);
});
void test('accepted aggregate view exposes original money and unmatched complement without pairwise allocation', async () => {
  const i = await fixture(),
    l = new InvoiceOverlapReviewLedger();
  await l.commit(i, await selection(l, i));
  const view = await l.acceptedView(i);
  assert.equal(view.aggregates.length, 1);
  assert.equal(view.aggregates[0].totalMinor, 100);
  assert.equal(view.aggregates[0].pairwiseAllocation, false);
  assert.equal(view.unmatched.length, 1);
  assert.equal(view.unmatched[0].amountMinor, 100);
  assert.deepEqual(
    view.sourceTransactions.map((ts) => ts.map((t) => t.amountMinor)),
    [[100], [40, 60, 100]],
  );
  view.aggregates[0].supplierIds = [];
  assert.equal((await l.acceptedView(i)).aggregates[0].supplierIds.length, 1);
});
void test('invalidation reaches pending undo/export/session import before publication', async () => {
  for (const op of ['undo', 'export', 'import'] as const) {
    const i = await fixture(),
      l = new InvoiceOverlapReviewLedger();
    await l.commit(i, await selection(l, i));
    const session = await l.exportSession(i),
      before = l.state;
    const p =
      op === 'undo'
        ? l.undo(i, {
            generation: 1,
            receiptId: before.receipts[0].id,
            reviewerLabel: 'A',
            rationale: 'Reopen all rows',
          })
        : op === 'export'
          ? l.exportWorkbook(i)
          : l.reimportSession(i, session);
    l.invalidatePending();
    await assert.rejects(p);
    assert.deepEqual(l.state, before);
    assert.equal(l.archivedReviewDraft, null);
  }
});
void test('missing-original and oversized-native inputs reject before source snapshotting', async () => {
  const i = await fixture();
  delete i.currentSourceFiles[0].original;
  await assert.rejects(prepareInvoiceOverlapReview(i));
  i.currentSourceFiles[0].original = new ArrayBuffer(8 * 1024 * 1024 + 1);
  await assert.rejects(prepareInvoiceOverlapReview(i));
});
void test('unknown physical malformed competitor and incomplete enumeration cannot be manually accepted', async () => {
  for (const raw of ['INV-X,,oops,2026-09-04,Invoice\n']) {
    const i = await fixture(),
      l = new InvoiceOverlapReviewLedger(),
      sel = await selection(l, i);
    const csv =
      new TextDecoder().decode(i.currentSourceFiles[1].original) + raw;
    i.currentSourceFiles[1] = await readFile(
      'overlap-1.csv',
      new TextEncoder().encode(csv).buffer,
    );
    await assert.rejects(l.commit(i, sel));
    assert.equal(l.state.generation, 0);
  }
  const i = await fixture();
  const header = 'Invoice No,Reference,Amount,Date,Document Type\n';
  const rows = Array.from(
    { length: 17 },
    (_, k) =>
      `INV-X,,${k + 1},2026-09-${String(k + 1).padStart(2, '0')},Invoice\n`,
  ).join('');
  i.currentSourceFiles[1] = await readFile(
    'overlap-1.csv',
    new TextEncoder().encode(header + rows).buffer,
  );
  const l = new InvoiceOverlapReviewLedger(),
    s = await l.inspect(i);
  assert.equal(s.search.searchComplete, false);
  await assert.rejects(
    l.commit(i, {
      generation: 0,
      snapshotKey: s.snapshotKey,
      componentId: s.search.components[0]?.id ?? 'none',
      reviewerLabel: 'A',
      rationale: 'Manual review cannot override incomplete search',
      decisions: [],
      reviewedRowKeys: [],
    }),
  );
  assert.equal(l.state.generation, 0);
});
void test('long complete human review journal is lossless across native Excel chunk boundaries', async () => {
  const i = await fixture(),
    header = 'Invoice No,Reference,Amount,Date,Document Type\n';
  i.currentSourceFiles = (await Promise.all(
    [3, 4].map(async (n, side) =>
      readFile(
        `long-${side}.csv`,
        new TextEncoder().encode(
          header +
            Array.from(
              { length: n },
              (_, j) =>
                `INV-L,,100,2026-09-${String(j + 1).padStart(2, '0')},Invoice\n`,
            ).join(''),
        ).buffer,
      ),
    ),
  )) as [SourceFile, SourceFile];
  const l = new InvoiceOverlapReviewLedger(),
    s = await l.inspect(i),
    c = s.search.components[0];
  assert.equal(s.search.searchComplete, true);
  assert.ok(c.candidateIds.length > 8);
  const reason = 'Reviewed invoice competing economic membership 🧾 '.repeat(
    50,
  );
  await l.commit(i, {
    generation: 0,
    snapshotKey: s.snapshotKey,
    componentId: c.id,
    reviewerLabel: 'Accountant',
    rationale: reason,
    reviewedRowKeys: c.rowKeys,
    decisions: c.candidateIds.map((candidateId) => ({
      candidateId,
      decision: 'rejected',
      rationale: reason,
    })),
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await l.exportWorkbook(i));
  const sheet = book.getWorksheet('Review ledger')!;
  assert.ok(sheet.rowCount > 2);
  let receipt = '';
  for (let r = 2; r <= sheet.rowCount; r++) {
    const text = sheet.getCell(r, 4).value;
    assert.ok(typeof text === 'string');
    assert.ok(text.length <= 30000);
    receipt += text;
  }
  assert.deepEqual(JSON.parse(receipt), l.state.receipts[0]);
});
