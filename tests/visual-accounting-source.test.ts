import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { knownVisualSource } from '../audit/visual-accounting/make_record.mjs';
import {
  readVisualAccountingSource,
  replayReviewedVisualSource,
  restoreVisualAccountingRecord,
  createVisualAccountingRecord,
  visualAccountingMapping,
  visualHeaderCandidates,
  VISUAL_SOURCE_INVALID,
} from '../lib/reconciliation/visual-accounting-source.ts';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import type { SessionState } from '../lib/reconciliation/session.ts';
import { isInputReadinessRejection } from '../lib/reconciliation/input-readiness.ts';
import { editVisualTableRow } from '../lib/reconciliation/visual-table.ts';
import type { Scope, Mapping } from '../lib/reconciliation/types.ts';
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const baseline = knownVisualSource();
async function fixture(changes?: Parameters<typeof knownVisualSource>[1]) {
  const f = changes
    ? await knownVisualSource(undefined, changes)
    : await baseline;
  const file = await readFile(
    'statement.tarasuf-reviewed.json',
    f.bytes.slice().buffer,
  );
  const rows = f.contract.ledger
    .map((r: string[]) =>
      r.map((s) => '"' + s.replaceAll('"', '""') + '"').join(','),
    )
    .join('\n');
  const ledger = await readFile(
    'ledger.csv',
    new TextEncoder().encode(rows).buffer,
  );
  const scope: Scope = {
    supplier: f.context.supplier,
    entity: f.context.entity,
    account: f.context.account,
    currency: f.context.currency,
    decimals: f.context.decimals,
    cutoff: f.context.cutoff,
    dateWindow: 3,
    confirmed: true,
    coverageConfirmed: false,
  };
  const ledgerMapping: Mapping = {
    ...visualAccountingMapping(file),
    reference: 0,
    date: 1,
    amount: 2,
    currencyColumn: 3,
    periodStart: f.context.periodStart,
    numberFormat: 'dot',
    multiplier: 1,
    formatChoice: undefined,
  };
  delete ledgerMapping.formatChoice;
  const state: SessionState = {
    files: [file, ledger],
    mappings: [visualAccountingMapping(file), ledgerMapping],
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  };
  const result = reconcileSupplierStatement(state).result;
  return { f, file, ledger, scope, state, result };
}
const forbidden = (e: unknown) =>
  e instanceof Error && e.message === VISUAL_SOURCE_INVALID;
void test('reviewed visual source proves a partial match without substituting the nearby balance or inventing a damaged amount', async () => {
  const { file, result } = await fixture();
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].supplierId, 'supplier:0:2');
  assert.equal(result.matches[0].ledgerId, 'ledger:0:2');
  assert.equal(result.supplier.total, -25000);
  assert.equal(result.supplier.transactions[0].originalAmount, '-٢٥٠٫٠٠');
  assert.equal(
    file.sheets[0].cellIssues!['3:3']?.[0],
    'تعذرت قراءة قيمة من الصورة أو خالفت الصيغة المحددة (amount)',
  );
  assert.equal(result.supplier.errors[0].row, 3);
  assert.ok(result.supplier.errors[0].isolation);
  assert.deepEqual(
    result.ledgerOnly.map((t) => t.reference),
    ['INV-002'],
  );
  assert.equal(
    result.supplier.excluded.find((r) => r.row === 4)?.kind,
    'non-movement',
  );
  assert.equal(file.visual!.table.rows.length, 3);
  assert.ok(Object.isFrozen(file.sheets[0].rows[1]));
});
void test('human-reviewed images never prove full balances even under caller coverage flags', async () => {
  const { file, state, scope } = await fixture();
  const normalized = normalizeSource(
    file,
    state.mappings[0],
    { ...scope, coverageConfirmed: true },
    'supplier',
  );
  assert.equal(normalized.opening, null);
  assert.equal(normalized.closing, null);
  assert.equal(normalized.balanceValid, false);
  assert.equal(normalized.coverageStatus, 'PERIOD_COVERAGE_UNCONFIRMED');
  assert.equal(normalized.balanceArithmeticStatus, 'BALANCE_ROW_NOT_FOUND');
});
void test('unregistered cloned sources must replay the full original record before normalization', async () => {
  const { file, state, scope } = await fixture();
  const clone = structuredClone(file);
  assert.throws(
    () => normalizeSource(clone, state.mappings[0], scope, 'supplier'),
    forbidden,
  );
  const fresh = await replayReviewedVisualSource(clone);
  assert.equal(
    normalizeSource(fresh, state.mappings[0], scope, 'supplier').transactions
      .length,
    1,
  );
  clone.sheets[0].rows[1][2] = '250.00';
  await assert.rejects(replayReviewedVisualSource(clone), forbidden);
});
void test('removing a kind or adding native-looking original CSV cannot launder the visual source', async () => {
  const { file, state, scope } = await fixture();
  for (const patch of [
    { kind: undefined },
    { name: 'fake.csv' },
    { visual: undefined },
    { kind: 'visual-table' },
  ]) {
    const bad = { ...structuredClone(file), ...patch };
    assert.throws(
      () => normalizeSource(bad, state.mappings[0], scope, 'supplier'),
      forbidden,
    );
    await assert.rejects(replayReviewedVisualSource(bad), forbidden);
  }
  await assert.rejects(
    readVisualAccountingSource('fake.csv', file.original!),
    forbidden,
  );
});
void test('mapping, sign, amount-vs-balance, report and source exclusions are bound on normalize, reconcile, session and export', async () => {
  const { file, state, result } = await fixture();
  for (const p of [
    { amount: 3 },
    { date: 0 },
    { reference: 1 },
    { header: 1 },
    { mode: 'split' },
    { multiplier: -1 },
    { numberFormat: 'comma' },
    { dateFormat: 'dmy' },
    { reportType: 'open-items' },
    { opening: '0' },
    { closing: '9999' },
    { periodStart: '' },
    { excluded: { '3': 'Skip failed row' } },
    {
      directionEvidence: {
        multiplier: 1,
        balanceColumn: 3,
        checkedRows: 1,
        reason: 'fake',
      },
    },
  ]) {
    const m = { ...state.mappings[0], ...p } as Mapping;
    assert.throws(
      () => normalizeSource(file, m, state.scope, 'supplier'),
      forbidden,
    );
    assert.throws(
      () =>
        reconcileSupplierStatement({
          ...state,
          mappings: [m, state.mappings[1]],
        }),
      forbidden,
    );
    await assert.rejects(
      saveSession({ ...state, mappings: [m, state.mappings[1]] }),
      forbidden,
    );
    const stale = { ...result, supplier: { ...result.supplier, mapping: m } };
    await assert.rejects(
      exportWorkbook(stale, state.files, state.review),
      forbidden,
    );
  }
});
void test('economic context and side cannot drift silently', async () => {
  const { file, state } = await fixture();
  for (const p of [
    { supplier: 'Other' },
    { entity: 'Other' },
    { account: 'Other' },
    { currency: 'USD' },
    { decimals: 3 },
    { cutoff: '2026-08-31' },
  ])
    assert.throws(
      () =>
        normalizeSource(
          file,
          state.mappings[0],
          { ...state.scope, ...p },
          'supplier',
        ),
      forbidden,
    );
  assert.throws(
    () => normalizeSource(file, state.mappings[0], state.scope, 'ledger'),
    forbidden,
  );
});
void test('missing or wrong header meanings cannot acquire amount/reference authority', async () => {
  const f = await baseline;
  assert.equal(visualHeaderCandidates(f.table, 2)[0].value, 'Movement');
  for (const headers of [
    ['region:5', 'region:6', 'region:8', 'region:7'],
    ['region:5', 'region:6', 'region:3', 'region:8'],
    ['region:5', 'region:6', 'region:7'],
    ['region:5', 'region:6', 'region:7', 'region:7'],
  ])
    await assert.rejects(
      createVisualAccountingRecord(
        f.table,
        headers,
        f.context,
        '2026-10-04T09:00:00.000Z',
        f.currencyProof,
      ),
      forbidden,
    );
  const unconfirmed = editVisualTableRow(f.table, 0, {
    disposition: 'movement',
    note: '',
    cells: [...f.table.rows[0].cells],
  });
  await assert.rejects(
    createVisualAccountingRecord(
      unconfirmed,
      f.headers,
      f.context,
      '2026-10-04T09:00:00.000Z',
    ),
    forbidden,
  );
});
void test('record edits cannot reuse table or interpretation receipts', async () => {
  const f = await baseline;
  type MutableRecord = {
    context: { multiplier: number; decimals: number; cutoff: string };
    headers: string[];
    review: { fingerprint: string };
    table: {
      rows: unknown[];
      coverage: unknown;
      image: { regions: { value: string }[] };
    };
    approved?: boolean;
    basis: string;
    version: number;
  };
  const edits = [
    (p: MutableRecord) => (p.context.multiplier = -1),
    (p: MutableRecord) => (p.context.decimals = 3),
    (p: MutableRecord) => (p.context.cutoff = '2026-08-31'),
    (p: MutableRecord) => (p.headers[2] = 'region:8'),
    (p: MutableRecord) => (p.review.fingerprint = '0'.repeat(64)),
    (p: MutableRecord) => p.table.rows.pop(),
    (p: MutableRecord) => (p.table.coverage = null),
    (p: MutableRecord) => (p.table.image.regions[2].value = '250.00'),
    (p: MutableRecord) => (p.approved = true),
    (p: MutableRecord) => (p.basis = 'verified'),
    (p: MutableRecord) => (p.version = 2),
  ];
  for (const edit of edits) {
    const p = JSON.parse(JSON.stringify(f.record));
    edit(p);
    await assert.rejects(restoreVisualAccountingRecord(encode(p)));
  }
});
void test('context/headers snapshot before crypto and reject accessors without invoking them', async () => {
  const f = await baseline,
    context = { ...f.context },
    headers = [...f.headers];
  const pending = createVisualAccountingRecord(
    f.table,
    headers,
    context,
    '2026-10-04T09:00:00.000Z',
    f.currencyProof,
  );
  context.multiplier = -1;
  headers[2] = 'region:8';
  const record = await pending;
  assert.equal(record.context.multiplier, 1);
  assert.equal(record.headers[2], 'region:7');
  let touched = 0;
  const getter = { ...f.context };
  Object.defineProperty(getter, 'currency', {
    enumerable: true,
    get() {
      touched++;
      return 'SAR';
    },
  });
  await assert.rejects(
    createVisualAccountingRecord(
      f.table,
      f.headers,
      getter,
      '2026-10-04T09:00:00.000Z',
    ),
    forbidden,
  );
  assert.equal(touched, 0);
  const badHeaders = [...f.headers];
  Object.defineProperty(badHeaders, '0', {
    enumerable: true,
    get() {
      touched++;
      return 'region:5';
    },
  });
  await assert.rejects(
    createVisualAccountingRecord(
      f.table,
      badHeaders,
      f.context,
      '2026-10-04T09:00:00.000Z',
    ),
    forbidden,
  );
  assert.equal(touched, 0);
});
void test('failed row identities suppress plausible competitors instead of creating uniqueness', async () => {
  const { result } = await fixture({ reference2: 'INV-001' });
  assert.equal(result.matches.length, 0);
  assert.equal(result.supplier.errors.length, 1);
  assert.equal(result.supplier.transactions[0].reference, 'INV-001');
});
void test('values valid only in another locale participate in contradiction detection', async () => {
  const f = await knownVisualSource(undefined, {
    amount1: '1,234.00',
    amount2: '1.234,00',
  });
  const file = await readFile(
    'statement.tarasuf-reviewed.json',
    f.bytes.slice().buffer,
  );
  assert.equal(file.sheets[0].rowIssues!['3'], undefined);
  const base = await fixture();
  assert.throws(
    () =>
      reconcileSupplierStatement({
        ...base.state,
        files: [file, base.ledger],
        mappings: [visualAccountingMapping(file), base.state.mappings[1]],
      }),
    (e) => isInputReadinessRejection(e, 'FORMAT_INVALID'),
  );
});
void test('an explicit ambiguous-format interpretation is source-bound and independently parsed', async () => {
  // Structural parser unit with deliberately re-entered KWD label. It is not
  // part of the frozen PNG truth oracle, which rejects this transcription.
  const f = await knownVisualSource(undefined, {
    amount1: '1,000',
    currencyLiteral: 'KWD',
    context: { currency: 'KWD', decimals: 3 },
  });
  const file = await readFile(
      'statement.tarasuf-reviewed.json',
      f.bytes.slice().buffer,
    ),
    m = visualAccountingMapping(file);
  const scope = { ...(await fixture()).scope, currency: 'KWD', decimals: 3 };
  assert.ok(m.formatChoice?.numberFormat);
  assert.equal(
    normalizeSource(file, m, scope, 'supplier').transactions[0].amount,
    1000000,
  );
  assert.throws(
    () =>
      normalizeSource(file, { ...m, numberFormat: 'comma' }, scope, 'supplier'),
    forbidden,
  );
});
void test('session restores original PNG and all source proofs then recomputes the same partial result', async () => {
  const { state, result } = await fixture(),
    bytes = await saveSession(state),
    restored = await restoreSession(bytes);
  assert.deepEqual(restored.result, result);
  assert.equal(restored.files[0].kind, 'reviewed-visual-source');
  assert.equal(restored.files[0].visual!.table.rows.length, 3);
  const p = JSON.parse(new TextDecoder().decode(bytes));
  p.mappings[0].amount = 3;
  await assert.rejects(restoreSession(encode(p).buffer), forbidden);
});
void test('workpaper replays sources and carries the entire reviewed record, exact original PNG, unread row and required match', async () => {
  const { file, state, result } = await fixture();
  const out = await exportWorkbook(result, state.files, state.review);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(out);
  const chunks = book
    .getWorksheet('Visual Source Record')!
    .getRows(2, book.getWorksheet('Visual Source Record')!.rowCount - 1)!;
  const text = chunks
    .map((r) => {
      const value = r.getCell(3).value;
      assert.equal(typeof value, 'string');
      return value as string;
    })
    .join('');
  assert.equal(text, new TextDecoder().decode(file.original!));
  assert.equal(book.getWorksheet('Reading Issues')!.rowCount, 2);
  assert.equal(
    book.getWorksheet('Supplier transactions')!.getCell('H2').value,
    -250,
  );
  assert.equal(
    book.getWorksheet('Supplier transactions')!.getCell('I2').value,
    '-٢٥٠٫٠٠',
  );
  assert.equal(book.getWorksheet('Match Evidence')!.getCell('S2').value, -250);
  assert.equal(
    book.getWorksheet('Visual Source Proof')!.getCell('C2').value,
    file.visual!.table.image.source.sha256,
  );
  const restored = await restoreSession(await saveSession(state));
  const replayBook = new ExcelJS.Workbook();
  await replayBook.xlsx.load(
    await exportWorkbook(restored.result, restored.files, restored.review),
  );
  assert.equal(
    replayBook.getWorksheet('Supplier transactions')!.getCell('H2').value,
    -250,
  );
});
void test('mutable original bytes or stale result totals are refused at export', async () => {
  const { state, result } = await fixture();
  await assert.rejects(
    exportWorkbook(
      { ...result, supplier: { ...result.supplier, total: 1 } },
      state.files,
      state.review,
    ),
    /إعادة الحساب/,
  );
  const source = await readFile(
    state.files[0].name,
    state.files[0].original!.slice(0),
  );
  new Uint8Array(source.original!)[0] ^= 1;
  await assert.rejects(
    exportWorkbook(result, [source, state.files[1]], state.review),
  );
});

void test('currency needs a reviewed source crop and compatible precision', async () => {
  const f = await baseline,
    at = '2026-10-04T09:00:00.000Z';
  for (const proof of [null, 'region:5', 'region:3', 'region:100'])
    await assert.rejects(
      createVisualAccountingRecord(f.table, f.headers, f.context, at, proof),
      forbidden,
    );
  await assert.rejects(
    createVisualAccountingRecord(
      f.table,
      f.headers,
      { ...f.context, currency: 'USD' },
      at,
      f.currencyProof,
    ),
    forbidden,
  );
  await assert.rejects(
    createVisualAccountingRecord(
      f.table,
      f.headers,
      { ...f.context, decimals: 3 },
      at,
      f.currencyProof,
    ),
    forbidden,
  );
});
void test('same PNG cannot become independent evidence by changing its record context or side', async () => {
  const a = await fixture(),
    b = await knownVisualSource(undefined, { context: { side: 'ledger' } });
  const file = await readFile(
    'ledger.tarasuf-reviewed.json',
    b.bytes.slice().buffer,
  );
  assert.notEqual(file.sha256, a.file.sha256);
  const result = reconcileSupplierStatement({
    ...a.state,
    files: [a.file, file],
    mappings: [a.state.mappings[0], visualAccountingMapping(file)],
  }).result;
  assert.equal(result.matches.length, 0);
  assert.ok(result.cases.some((c) => c.status === 'Needs Review'));
});
