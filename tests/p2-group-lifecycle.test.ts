import { compareDefaultSort } from './helpers/lint-value-text.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import {
  explainResult,
  verifyHypothesis,
} from '../lib/reconciliation/assistant.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import type { SessionState } from '../lib/reconciliation/session.ts';
import type {
  Comparison,
  AuditEvent,
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic P2 supplier',
  entity: 'Synthetic P2 company',
  account: 'AP-P2',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const review = {
  checked: false,
  name: 'Synthetic lifecycle reviewer',
  notes: 'Whole payment group, no individual allocation.',
};
const headers = [
  'Date',
  'Document No',
  'Amount',
  'Document Type',
  'Bank Reference',
  'Receipt No',
  'AP Voucher',
  'Description',
  'Currency',
];
const sourceRows = (side: 'supplier' | 'ledger', receipt = false) =>
  (side === 'supplier' ? ['-40.00', '-60.00'] : ['-25.00', '-75.00']).map(
    (amount, i) => [
      '2026-07-15',
      `${side === 'supplier' ? 'SUP' : 'LED'}-PAY-441-${i + 1}`,
      amount,
      'Payment',
      receipt ? '' : 'BANK-P2-441',
      receipt ? 'RCPT-P2-441' : '',
      `${side === 'supplier' ? 'SUP' : 'LED'}-VOUCHER-441-${i + 1}`,
      `${side} payment part ${i + 1}`,
      'SAR',
    ],
  );
const csvBytes = (rows: string[][]) =>
  new TextEncoder().encode(
    [headers, ...rows].map((row) => row.join(',')).join('\r\n'),
  ).buffer;
async function input(
  receipt = false,
  ledgerRows = sourceRows('ledger', receipt),
) {
  const files: [SourceFile, SourceFile] = [
    await readFile(
      'p2-supplier.csv',
      csvBytes(sourceRows('supplier', receipt)),
    ),
    await readFile('p2-ledger.csv', csvBytes(ledgerRows)),
  ];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  return { files, mappings, scope };
}
const run = (p: Awaited<ReturnType<typeof input>>, rejected: string[] = []) =>
  reconcileSupplierStatement({ ...p, rejected }).result;
const sessionState = (
  p: Awaited<ReturnType<typeof input>>,
  rejected: string[] = [],
): SessionState => ({
  ...p,
  decisions: [],
  rejected,
  events: [],
  review,
});
const allIds = (r: Comparison) =>
  [...r.supplier.transactions, ...r.ledger.transactions]
    .map((t) => t.id)
    .sort();
function conserved(r: Comparison) {
  const ids = r.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId));
  assert.deepEqual(
    ids.sort(),
    allIds(r),
    'each source row belongs to exactly one case',
  );
  assert.equal(new Set(ids).size, ids.length);
}
function provenGroup(r: Comparison) {
  assert.equal(r.supplier.errors.length + r.ledger.errors.length, 0);
  assert.equal(r.cases.length, 1);
  const c = r.cases[0];
  assert.equal(c.classification, 'EXACT_MANY_TO_MANY');
  assert.equal(c.status, 'Matched');
  assert.equal(c.reviewRequired, false);
  assert.deepEqual([c.supplierMembers.length, c.ledgerMembers.length], [2, 2]);
  assert.deepEqual(
    [c.supplierTotal, c.ledgerTotal, c.variance, c.bridgeEffect],
    [-10000, -10000, 0, 0],
  );
  assert.equal(
    r.matches.length,
    1,
    'one whole-group match, not individual payment allocations',
  );
  const m = r.matches[0];
  assert.equal(m.kind, 'auto');
  assert.deepEqual(
    m.supplierIds?.slice().sort(),
    c.supplierMembers.map((t) => t.id).sort(),
  );
  assert.deepEqual(
    m.ledgerIds?.slice().sort(),
    c.ledgerMembers.map((t) => t.id).sort(),
  );
  assert.ok(
    c.supplierMembers.every((s) =>
      c.ledgerMembers.every((l) => s.amount !== l.amount),
    ),
    'the fixture cannot prove any individual amount pair',
  );
  assert.deepEqual(
    [
      r.caseCounts.autoMatchedCases,
      r.caseCounts.matchedSourceRows,
      r.caseCounts.manualMatches,
    ],
    [1, 4, 0],
  );
  assert.equal(
    r.balanceComparable,
    false,
    'a closed payment group is not a verified statement balance',
  );
  assert.equal(r.bridge, null);
  conserved(r);
}
async function workbook(
  r: Comparison,
  files: [SourceFile, SourceFile],
  events: AuditEvent[] = [],
) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportWorkbook(r, files, { ...review, events }));
  return book;
}
function summaryValue(book: ExcelJS.Workbook, label: string) {
  const sheet = book.getWorksheet('Summary')!;
  const row = [...Array(sheet.rowCount)]
    .map((_, i) => sheet.getRow(i + 1))
    .find((r) => r.getCell(1).value === label);
  assert.ok(row, label);
  return row.getCell(2).value;
}
function verifyWorkbook(book: ExcelJS.Workbook, result: Comparison) {
  const matches = book.getWorksheet('Matches')!;
  assert.equal(
    matches.rowCount,
    2,
    'one exported group, not two invented pairs',
  );
  assert.equal(matches.getCell('B2').value, 'N:M');
  assert.equal(matches.getCell('I2').value, '2 supplier / 2 ledger');
  assert.deepEqual(
    ['E2', 'H2'].map((cell) => matches.getCell(cell).value),
    [-100, -100],
  );
  assert.deepEqual(
    ['O2', 'P2', 'Q2'].map((cell) => matches.getCell(cell).value),
    [2, 2, 'Auto'],
  );
  assert.equal(matches.getCell('K2').value, result.cases[0].matchingRule);
  const links = ['R2', 'S2', 'T2', 'U2'].map(
    (cell) => matches.getCell(cell).value as ExcelJS.CellHyperlinkValue,
  );
  assert.deepEqual(
    links.map((link) => link.hyperlink),
    [
      "#'Parsed Supplier Source'!A3",
      "#'Parsed Supplier Source'!A4",
      "#'Parsed Ledger Source'!A3",
      "#'Parsed Ledger Source'!A4",
    ],
  );
  const evidence = book.getWorksheet('Match Evidence')!;
  assert.equal(evidence.rowCount, 5);
  const ids = [];
  for (let row = 2; row <= evidence.rowCount; row++) {
    ids.push(evidence.getCell(row, 7).value);
    assert.equal(evidence.getCell(row, 1).value, result.cases[0].caseId);
    assert.equal(evidence.getCell(row, 2).value, 'EXACT_MANY_TO_MANY');
    assert.equal(evidence.getCell(row, 3).value, 'Matched');
  }
  assert.deepEqual(ids.sort(compareDefaultSort), allIds(result));
  assert.deepEqual(summaryValue(book, 'Auto Matched Cases'), {
    formula: 'COUNTIF(\'Matches\'!Q2:Q2,"Auto")',
    result: 1,
  });
  assert.deepEqual(summaryValue(book, 'Matched Source Rows'), {
    formula: "SUM('Matches'!O2:P2)",
    result: 4,
  });
}

void test('P2 original CSV bank and receipt identities survive normalisation, session restore and N:M export with all source members', async () => {
  for (const receipt of [false, true]) {
    const p = await input(receipt);
    const result = run(p);
    provenGroup(result);
    const originalBook = await workbook(result, p.files);
    verifyWorkbook(originalBook, result);
    const saved = await saveSession(sessionState(p));
    const restored = await restoreSession(saved);
    provenGroup(restored.result);
    assert.deepEqual(
      restored.result,
      result,
      'restore re-proves the same complete group from original bytes',
    );
    assert.deepEqual(restored.decisions, []);
    const restoredBook = await workbook(restored.result, restored.files);
    verifyWorkbook(restoredBook, restored.result);
    for (const sheet of ['Matches', 'Match Evidence'])
      assert.deepEqual(
        restoredBook.getWorksheet(sheet)!.getSheetValues(),
        originalBook.getWorksheet(sheet)!.getSheetValues(),
      );
  }
});

void test('P2 group explanation cites every member and distinguishes group totals from individual pairings in both languages', async () => {
  const result = run(await input());
  provenGroup(result);
  for (const id of allIds(result)) {
    const answer = explainResult(result, 'اشرح هذه الحركة', id);
    assert.equal(answer.kind, 'transaction');
    assert.deepEqual(answer.sourceIds.slice().sort(), allIds(result));
    assert.match(answer.text, /BANK-P2-441/);
    for (const t of [
      ...result.supplier.transactions,
      ...result.ledger.transactions,
    ])
      assert.ok(
        answer.text.includes(t.reference),
        `source reference ${t.reference}`,
      );
    const english = localizeEngineText(answer.text, 'en');
    assert.doesNotMatch(
      english,
      /[؀-ۿ]/,
      'the full group explanation must be translated',
    );
    assert.match(
      english,
      /not.*(?:allocat|individual|row.to.row)|(?:no|without).*?(?:allocat|individual|row.to.row)/i,
    );
    assert.match(english, /100\.00 SAR/);
  }
});

void test('P2 rejecting any member pair atomically unmatches the whole group and restore preserves that rejection', async () => {
  const p = await input();
  const original = run(p);
  provenGroup(original);
  const m = original.matches[0];
  // The first token is exactly what the current group-unlink UI submits.
  const uiToken = `${m.supplierId}|${m.ledgerId}`;
  const tokens = new Set([
    uiToken,
    ...m.supplierIds!.flatMap((s) => m.ledgerIds!.map((l) => `${s}|${l}`)),
  ]);
  for (const token of tokens) {
    const rejected = run(p, [token]);
    assert.equal(rejected.matches.length, 0, token);
    assert.equal(rejected.caseCounts.matchedSourceRows, 0, token);
    assert.ok(rejected.cases.every((c) => c.status !== 'Matched'));
    assert.deepEqual(rejected.rejectedPairs, [token]);
    conserved(rejected);
  }
  const rejected = run(p, [uiToken]);
  const state = sessionState(p, [uiToken]);
  state.events = [
    {
      action: 'unlink',
      time: '2026-07-31T12:00:00.000Z',
      ids: allIds(original),
      note: 'Reviewer rejected the whole payment group.',
    },
  ];
  const restored = await restoreSession(await saveSession(state));
  assert.deepEqual(restored.result, rejected);
  assert.deepEqual(restored.events, state.events);
  const book = await workbook(restored.result, restored.files, restored.events);
  assert.equal(book.getWorksheet('Matches')!.rowCount, 1);
  const evidenceIds = book
    .getWorksheet('Match Evidence')!
    .getSheetValues()
    .slice(2)
    .map((row) => (row as ExcelJS.CellValue[])[7])
    .sort(compareDefaultSort);
  assert.deepEqual(evidenceIds, allIds(original));
  assert.equal(
    book.getWorksheet('Review History')!.getCell('C2').value,
    allIds(original).join(' | '),
  );
  provenGroup(run(p)); // Removing the rejection restores proof; this is not a claim of a UI undo control.
});

void test('P2 assistant rejects a case-member copy with forged explicit payment identity provenance', async () => {
  const original = run(await input());
  provenGroup(original);
  for (const fields of [undefined, [], ['receiptReference']] as const) {
    const result = structuredClone(original);
    const c = result.cases[0];
    c.supplierMembers[0] = {
      ...c.supplierMembers[0],
      paymentIdentityFields: fields === undefined ? undefined : [...fields],
    };
    const answer = verifyHypothesis(result, {
      supplierIds: c.supplierMembers.map((t) => t.id),
      ledgerIds: c.ledgerMembers.map((t) => t.id),
    });
    assert.equal(answer.status, 'rejected');
    assert.match(answer.reason, /لا تطابق المصدر الحالي/);
  }
});

void test('P2 changed source bytes invalidate the old group and cannot be exported or restored as its old proof', async () => {
  const p = await input();
  const original = run(p);
  provenGroup(original);
  const saved = await saveSession(sessionState(p));
  const session = JSON.parse(new TextDecoder().decode(saved));
  const changedRows = sourceRows('ledger');
  changedRows[1][2] = '-74.00';
  const changed = await input(false, changedRows);
  const fresh = run(changed);
  assert.equal(fresh.matches.length, 0);
  conserved(fresh);
  await assert.rejects(
    exportWorkbook(original, changed.files, review),
    /إعادة الحساب/,
  );
  const altered = structuredClone(session);
  altered.files[1].data = Buffer.from(changed.files[1].original!).toString(
    'base64',
  );
  await assert.rejects(
    restoreSession(new TextEncoder().encode(JSON.stringify(altered)).buffer),
    /بصمة مصدر الجلسة/,
  );
  altered.files[1].sha256 = changed.files[1].sha256;
  const reread = await restoreSession(
    new TextEncoder().encode(JSON.stringify(altered)).buffer,
  );
  assert.equal(
    reread.result.matches.length,
    0,
    'even a correctly re-hashed changed source must be recomputed',
  );
  conserved(reread.result);
  const tampered = structuredClone(original);
  tampered.cases[0].ledgerMembers.pop();
  await assert.rejects(
    exportWorkbook(tampered, p.files, review),
    /إعادة الحساب/,
  );
});
