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
import {
  readingStatus,
  sourceReadingIssues,
} from '../lib/reconciliation/reading-issues.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic partial supplier',
  entity: 'Synthetic partial buyer',
  account: 'PART-AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const bytes = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\r\n')).buffer;
const header = ['Date', 'Reference', 'Amount', 'Description'];
const valid = (ref: string, amount: string) => [
  '2026-07-15',
  ref,
  amount,
  'Invoice',
];
async function input(errors = 13, displaced = false) {
  const files: [SourceFile, SourceFile] = [
    await readFile(
      'partial-supplier.csv',
      bytes([
        header,
        valid('INV-PART-001', '100.00'),
        ...Array.from({ length: errors }, (_, i) =>
          valid(
            `INV-PART-ERR-${i + 1}`,
            displaced ? `unread-${i + 1}` : 'unread',
          ),
        ),
        valid('INV-PART-002', '250.00'),
      ]),
    ),
    await readFile(
      'partial-ledger.csv',
      bytes([
        header,
        valid('INV-PART-001', '100.00'),
        valid('INV-PART-002', '250.00'),
      ]),
    ),
  ];
  const mappings = files.map(
    (file, i) => selectImportMapping(file, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  return { files, mappings, scope };
}
const review = {
  checked: true,
  name: 'Synthetic reviewer',
  notes: 'Record review without claiming complete input.',
};
function records(sheet: ExcelJS.Worksheet) {
  const headers = (sheet.getRow(1).values as ExcelJS.CellValue[])
    .slice(1)
    .map(String);
  return Array.from({ length: sheet.rowCount - 1 }, (_, i) =>
    Object.fromEntries(
      headers.map((h, column) => [h, sheet.getCell(i + 2, column + 1).value]),
    ),
  );
}
function summary(book: ExcelJS.Workbook, name: string) {
  return records(book.getWorksheet('Summary')!).find(
    (r) => r['Field / الحقل'] === name,
  )?.['Value / القيمة'];
}

test('partial source rows remain explicit through Excel and original-source session restoration', async () => {
  const p = await input();
  const result = reconcileSupplierStatement(p).result;
  assert.equal(result.supplier.errors.length, 13);
  assert.equal(result.supplier.transactions.length, 2);
  assert.equal(result.caseCounts.autoMatchedCases, 2);
  assert.equal(result.bridge, null);
  assert.deepEqual(readingStatus([result.supplier, result.ledger]), {
    partial: true,
    processedRows: 4,
    unreadRows: 13,
    balanceIssues: 0,
    sourceIssues: 0,
  });
  const exported = await exportWorkbook(result, p.files, review);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  const issueSheet = book.getWorksheet('Reading Issues');
  assert.ok(issueSheet, 'Reading Issues worksheet must exist');
  assert.equal(issueSheet.state, 'visible');
  const issues = records(issueSheet);
  assert.equal(
    issues.length,
    13,
    'all issues survive, including those beyond the first UI page',
  );
  for (const [i, issue] of issues.entries()) {
    assert.equal(issue['Source Row'], i + 3);
    assert.equal(issue['Source File'], 'partial-supplier.csv');
    assert.equal(issue['Source Sheet'], 'CSV');
    assert.equal(issue['Issue Scope'], 'Row');
    assert.equal(issue['PDF Page'], null);
    assert.equal(JSON.parse(String(issue['Original Values']))[2], 'unread');
    assert.ok(String(issue.Reason).trim());
    assert.equal(
      Object.hasOwn(issue, 'Amount'),
      false,
      'an unread amount is never exported as zero',
    );
    assert.equal(
      Object.hasOwn(issue, 'Source Row ID'),
      false,
      'reading issues are not financial transactions',
    );
  }
  const diagnostics = records(book.getWorksheet('Diagnostics')!).filter(
    (r) => r['الرمز'] === 'SOURCE_ROW_READING_ERROR',
  );
  assert.equal(diagnostics.length, 13);
  assert.ok(diagnostics.every((r) => !r['حركات المصدر']));
  assert.match(String(summary(book, 'Reading Status')), /Partial/);
  assert.equal(summary(book, 'Rows Needing Reading Review'), 13);
  assert.equal(summary(book, 'Supplier Processed Transaction Total'), 350);
  assert.equal(summary(book, 'Ledger Processed Transaction Total'), 350);
  assert.match(String(summary(book, 'Totals Basis')), /unknown, not zero/);
  assert.match(String(summary(book, 'Reviewer Status')), /open reading issues/);
  assert.match(String(summary(book, 'Workbook Mode')), /Partial/);
  const memberIds = records(book.getWorksheet('Match Evidence')!)
    .map((r) => r['Source Row ID'])
    .sort();
  assert.deepEqual(
    memberIds,
    ['ledger:0:2', 'ledger:0:3', 'supplier:0:16', 'supplier:0:2'].sort(),
  );
  const saved = await saveSession({
    ...p,
    decisions: [],
    rejected: [],
    events: [],
    review,
  });
  const restored = await restoreSession(saved);
  assert.deepEqual(restored.result.supplier.errors, result.supplier.errors);
  assert.equal(restored.result.caseCounts.autoMatchedCases, 2);
  assert.equal(restored.review.checked, false);
  assert.equal(
    readingStatus([restored.result.supplier, restored.result.ledger]).partial,
    true,
  );
  await assert.rejects(
    exportWorkbook(
      { ...result, supplier: { ...result.supplier, errors: [] } },
      p.files,
      review,
    ),
    /إعادة الحساب/,
  );
});

test('partial assistant answers disclose incompleteness, prioritize row errors and reject model approval', async () => {
  const p = await input(1);
  const result = reconcileSupplierStatement(p).result;
  for (const question of [
    'What should I review next?',
    'What checks were not completed?',
    'Explain INV-PART-001',
  ]) {
    const answer = explainResult(result, question);
    assert.match(answer.text, /^نتيجة جزئية:/);
    const english = localizeEngineText(answer.text, 'en');
    assert.match(english, /^Partial result:/);
    assert.doesNotMatch(english, /[؀-ۿ]/);
    assert.match(english, /do not establish a complete reconciliation/);
    assert.ok(!answer.sourceIds.includes('supplier:0:3'));
  }
  const next = localizeEngineText(
    explainResult(result, 'What should I review next?').text,
    'en',
  );
  assert.match(next, /Review the reading issues first/);
  assert.match(next, /Supplier: row 3/);
  assert.match(next, /not converted to zeros/);
  const proposal = verifyHypothesis(result, {
    supplierIds: ['supplier:0:2'],
    ledgerIds: ['ledger:0:2'],
  });
  assert.match(proposal.reason, /قراءة المصدر غير مكتملة/);
});

test('balance-only issues have no invented row or page and preserve the entered text', async () => {
  const p = await input(0);
  p.mappings[0].opening = 'not-a-balance';
  const result = reconcileSupplierStatement(p).result;
  assert.ok(
    result.supplier.errors.some(
      (error) => error.row === 0 && error.scope === 'balance',
    ),
  );
  const status = readingStatus([result.supplier, result.ledger]);
  assert.equal(status.partial, true);
  assert.equal(status.unreadRows, 0);
  assert.equal(status.sourceIssues, 0);
  assert.equal(status.balanceIssues, 1);
  assert.equal(result.bridge, null);
  const issue = sourceReadingIssues(result.supplier, p.files[0], 'supplier')[0];
  assert.equal(issue.kind, 'balance');
  assert.equal(issue.row, null);
  assert.equal(issue.page, null);
  assert.deepEqual(issue.values, ['not-a-balance', '']);
});

test('clean export and assistant keep their existing status without a partial claim', async () => {
  const p = await input(0);
  const result = reconcileSupplierStatement(p).result;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportWorkbook(result, p.files, review));
  assert.equal(book.getWorksheet('Reading Issues'), undefined);
  assert.equal(summary(book, 'Reading Status'), undefined);
  assert.equal(
    summary(book, 'Reviewer Status'),
    'Review completed by user; no approval implied',
  );
  assert.doesNotMatch(
    explainResult(result, 'What checks were not completed?').text,
    /^نتيجة جزئية:/,
  );
});

test('reference-shaped invalid amounts retain negative collision evidence while disjoint pairs continue', async () => {
  const p = await input(13, true);
  const result = reconcileSupplierStatement(p).result;
  assert.equal(result.supplier.errors.length, 13);
  assert.ok(
    result.supplier.errors.every((error) => error.isolation?.keys.length),
  );
  assert.equal(result.caseCounts.autoMatchedCases, 2);
  assert.equal(result.bridge, null);
});
