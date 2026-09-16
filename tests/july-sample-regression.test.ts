import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportWorkbook } from '../lib/reconciliation/io.ts';
import { explainResult } from '../lib/reconciliation/assistant.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import type {
  Comparison,
  ReconciliationCase,
  Transaction,
} from '../lib/reconciliation/types.ts';
import { julySampleAvailable, loadJulySample } from './helpers/july-sample.ts';

const available = await julySampleAvailable();
const options = {
  skip: available
    ? false
    : 'Private July originals unavailable; set MIZAN_SAMPLE_DIR to run this acceptance suite.',
};
let loaded: Promise<Awaited<ReturnType<typeof loadJulySample>>[]> | undefined;
const samples = () =>
  (loaded ??= Promise.all(
    ['xlsx', 'pdf'].map((extension) =>
      loadJulySample(extension as 'xlsx' | 'pdf'),
    ),
  ));
const members = (c: ReconciliationCase) => [
  ...c.supplierMembers,
  ...c.ledgerMembers,
];
const document = (t: Transaction) => t.documentReference || t.reference;
const hasDocument = (c: ReconciliationCase, reference: string) =>
  members(c).some((t) => document(t) === reference);
const requiredCase = (
  result: Comparison,
  classification: ReconciliationCase['classification'],
  reference?: string,
) => {
  const selected = result.cases.filter(
    (c) =>
      c.classification === classification &&
      (!reference || hasDocument(c, reference)),
  );
  assert.equal(
    selected.length,
    1,
    `${classification} ${reference ?? ''} must be one case`,
  );
  return selected[0];
};
const businessCase = (c: ReconciliationCase) => ({
  classification: c.classification,
  status: c.status,
  supplier: c.supplierMembers
    .map((t) => [t.date, document(t), t.amount])
    .sort(),
  ledger: c.ledgerMembers.map((t) => [t.date, document(t), t.amount]).sort(),
  supplierTotal: c.supplierTotal,
  ledgerTotal: c.ledgerTotal,
  variance: c.variance,
  bridgeEffect: c.bridgeEffect,
});

test(
  'July acceptance 1: Excel and PDF have identical accounting cases and bridge',
  options,
  async () => {
    const [excel, pdf] = await samples();
    const canonical = (result: Comparison) =>
      result.cases
        .map(businessCase)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.ok(excel.result.cases.length > 0);
    assert.deepEqual(canonical(excel.result), canonical(pdf.result));
    assert.deepEqual(excel.result.bridge, pdf.result.bridge);
    assert.deepEqual(excel.result.caseCounts, pdf.result.caseCounts);
  },
);

test(
  'July acceptance 2: every one of the 23 original rows occurs in exactly one case',
  options,
  async () => {
    for (const { extension, result } of await samples()) {
      assert.deepEqual(
        [
          result.supplier.transactions.length,
          result.ledger.transactions.length,
        ],
        [11, 12],
        extension,
      );
      assert.deepEqual(
        [result.supplier.errors, result.ledger.errors],
        [[], []],
      );
      const originals = [
        ...result.supplier.transactions,
        ...result.ledger.transactions,
      ].map((t) => t.id);
      const assigned = result.cases.flatMap((c) => members(c).map((t) => t.id));
      assert.equal(assigned.length, 23);
      assert.equal(new Set(assigned).size, 23);
      assert.deepEqual([...assigned].sort(), [...originals].sort());
      const traced = result.cases.flatMap((c) =>
        c.sourceTrace.map((trace) => trace.sourceRowId),
      );
      assert.deepEqual(traced.sort(), [...originals].sort());
      for (const c of result.cases)
        for (const trace of c.sourceTrace) {
          assert.ok(trace.sheet && trace.row > 0);
          if (extension === 'pdf') assert.ok(trace.page && trace.page > 0);
        }
    }
  },
);

test(
  'July acceptance 3: exactly six original one-to-one matches are automatic',
  options,
  async () => {
    const expected = [
      'INV-260701',
      'INV-260706',
      'CN-26003',
      'INV-260715',
      'INV-260718',
      'INV-260722',
    ].sort();
    for (const { result } of await samples()) {
      const exact = result.cases.filter(
        (c) => c.classification === 'EXACT_1_TO_1',
      );
      assert.deepEqual(
        exact.map((c) => document(c.supplierMembers[0])).sort(),
        expected,
      );
      for (const c of exact) {
        assert.equal(c.status, 'Matched');
        assert.equal(c.reviewRequired, false);
        assert.equal(c.supplierMembers.length, 1);
        assert.equal(c.ledgerMembers.length, 1);
        assert.equal(c.supplierTotal, c.ledgerTotal);
        assert.equal(c.bridgeEffect, 0);
      }
    }
  },
);

test(
  'July acceptance 4: INV-260729 is one proven 1:M case, never duplicate or unmatched',
  options,
  async () => {
    for (const { result, files } of await samples()) {
      const c = requiredCase(result, 'EXACT_1_TO_MANY', 'INV-260729');
      assert.equal(c.status, 'Matched');
      assert.equal(c.reviewRequired, false);
      assert.deepEqual(
        [c.supplierMembers.length, c.ledgerMembers.length],
        [1, 3],
      );
      assert.deepEqual(
        c.ledgerMembers.map((t) => t.amount).sort((a, b) => a - b),
        [200000, 225000, 250000],
      );
      assert.deepEqual(
        [c.supplierTotal, c.ledgerTotal, c.variance, c.bridgeEffect],
        [675000, 675000, 0, 0],
      );
      for (const t of c.ledgerMembers) {
        assert.equal(t.documentReference, 'INV-260729');
        assert.equal(t.voucherReference, 'AP-260149');
        assert.equal(t.poReference, 'PO-46871');
      }
      assert.equal(new Set(c.ledgerMembers.map((t) => t.date)).size, 1);
      const ids = new Set(members(c).map((t) => t.id));
      assert.equal(
        [...result.supplierOnly, ...result.ledgerOnly].some((t) =>
          ids.has(t.id),
        ),
        false,
      );
      assert.equal(
        result.ambiguousIds.some((id) => ids.has(id)),
        false,
      );
      assert.equal(
        result.diagnostics.some(
          (d) =>
            d.code === 'DUPLICATE_REFERENCE' &&
            d.transactionIds.some((id) => ids.has(id)),
        ),
        false,
      );
      // Mutate copies of the supplied source only: unreadable or contradictory
      // supporting identity must not disappear and leave an automatic group.
      for (const fault of ['unsafe-po', 'different-voucher'] as const) {
        const changed = structuredClone(files[1]);
        const sheet = changed.sheets[result.ledger.mapping.sheet];
        const row = c.ledgerMembers[0].row;
        const header = sheet.rows[result.ledger.mapping.header];
        const column = header.findIndex((value) =>
          fault === 'unsafe-po'
            ? /^PO \/ Bank Ref$/i.test(value)
            : /^AP Voucher$/i.test(value),
        );
        assert.ok(column >= 0);
        const other = result.ledger.transactions.find(
          (transaction) =>
            transaction.documentType === 'Invoice' &&
            transaction.documentReference !== 'INV-260729',
        )!;
        sheet.rows[row - 1][column] = sheet.rows[other.row - 1][column];
        if (fault === 'unsafe-po')
          (sheet.cellIssues ??= {})[`${row}:${column + 1}`] = [
            'Unreadable source reference',
          ];
        const ledger = normalizeSource(
          changed,
          result.ledger.mapping,
          result.scope,
          'ledger',
        );
        assert.deepEqual(ledger.errors, []);
        const checked = compare(result.supplier, ledger, result.scope);
        assert.equal(
          checked.cases.some(
            (item) =>
              item.status === 'Matched' && hasDocument(item, 'INV-260729'),
          ),
          false,
          fault,
        );
        assert.equal(
          requiredCase(checked, 'AMBIGUOUS_CANDIDATE', 'INV-260729').status,
          'Needs Review',
        );
        assert.equal(
          requiredCase(checked, 'PAYMENT_CANDIDATE').status,
          'Needs Review',
        );
        const assigned = checked.cases.flatMap((item) =>
          members(item).map((transaction) => transaction.id),
        );
        assert.equal(assigned.length, 23, fault);
        assert.equal(new Set(assigned).size, 23, fault);
        assert.deepEqual(
          [...assigned].sort(),
          [...result.supplier.transactions, ...ledger.transactions]
            .map((transaction) => transaction.id)
            .sort(),
        );
      }
    }
  },
);

test(
  'July acceptance 5: INV-260710 is one amount-variance review with minus 180 SAR effect',
  options,
  async () => {
    for (const { result } of await samples()) {
      const c = requiredCase(result, 'AMOUNT_VARIANCE', 'INV-260710');
      assert.equal(c.status, 'Needs Review');
      assert.equal(c.reviewRequired, true);
      assert.deepEqual(
        [c.supplierMembers.length, c.ledgerMembers.length],
        [1, 1],
      );
      assert.deepEqual(
        [c.supplierTotal, c.ledgerTotal, c.variance, c.bridgeEffect],
        [920000, 902000, 18000, -18000],
      );
      assert.equal(
        result.cases.filter((item) => hasDocument(item, 'INV-260710')).length,
        1,
      );
    }
  },
);

test(
  'July acceptance 6: the unique 15000 SAR payment remains a zero-net review candidate',
  options,
  async () => {
    for (const { result } of await samples()) {
      const c = requiredCase(result, 'PAYMENT_CANDIDATE');
      for (const reference of [
        'RCPT-77031',
        'BANK-8821',
        'PYM-000441',
        'ALRAJHI-764992',
      ]) {
        const answer = explainResult(result, `اشرح ${reference}`);
        assert.equal(answer.kind, 'transaction');
        assert.ok(answer.text.includes('PAYMENT_CANDIDATE'));
        assert.deepEqual(
          new Set(answer.sourceIds),
          new Set(c.sourceTrace.map((t) => t.sourceRowId)),
        );
      }
      assert.equal(c.status, 'Needs Review');
      assert.equal(c.reviewRequired, true);
      assert.deepEqual(
        [c.supplierTotal, c.ledgerTotal, c.variance, c.bridgeEffect],
        [-1500000, -1500000, 0, 0],
      );
      assert.deepEqual(
        [c.supplierMembers.length, c.ledgerMembers.length],
        [1, 1],
      );
      assert.equal(c.supplierMembers[0].date, '2026-07-21');
      assert.equal(c.ledgerMembers[0].date, '2026-07-22');
      assert.equal(c.supplierMembers[0].bankReference, 'BANK-8821');
      assert.equal(c.ledgerMembers[0].bankReference, 'ALRAJHI-764992');
      assert.equal(c.supplierMembers[0].receiptReference, 'RCPT-77031');
      assert.equal(c.ledgerMembers[0].voucherReference, 'PYM-000441');
      assert.equal(c.supplierMembers[0].poReference, '');
      assert.equal(c.ledgerMembers[0].poReference, '');
      assert.notEqual(
        c.supplierMembers[0].primaryReference,
        c.ledgerMembers[0].primaryReference,
      );
      const ids = new Set(members(c).map((t) => t.id));
      assert.equal(
        [...result.supplierOnly, ...result.ledgerOnly].some((t) =>
          ids.has(t.id),
        ),
        false,
      );
      assert.equal(
        result.matches.some(
          (m) => ids.has(m.supplierId) || ids.has(m.ledgerId),
        ),
        false,
      );
      const accepted = compare(result.supplier, result.ledger, result.scope, [
        {
          supplierId: c.supplierMembers[0].id,
          ledgerId: c.ledgerMembers[0].id,
          note: 'Reviewer explicitly approved the supplied payment evidence',
        },
      ]);
      const manual = accepted.cases.filter((item) =>
        members(item).some((transaction) => ids.has(transaction.id)),
      );
      assert.equal(manual.length, 1);
      assert.equal(manual[0].status, 'Matched');
      assert.equal(manual[0].matchingRule, 'MANUAL_REVIEW');
      assert.equal(manual[0].reviewerDecision, 'Accepted');
      assert.equal(accepted.caseCounts.manualMatches, 1);
      assert.equal(accepted.caseCounts.autoMatchedCases, 7);
      const assigned = accepted.cases.flatMap((item) =>
        members(item).map((transaction) => transaction.id),
      );
      assert.equal(assigned.length, 23);
      assert.equal(new Set(assigned).size, 23);
    }
  },
);

test(
  'July acceptance 7: only the three genuinely one-sided documents are unmatched',
  options,
  async () => {
    for (const { result } of await samples()) {
      const unmatched = result.cases.filter((c) => c.status === 'Unmatched');
      assert.deepEqual(
        unmatched
          .map((c) => [
            c.classification,
            document(members(c)[0]),
            members(c)[0].amount,
          ])
          .sort(),
        [
          ['SUPPLIER_ONLY', 'INV-260722-A', 345000],
          ['SUPPLIER_ONLY', 'INV-260731', 483000],
          ['LEDGER_ONLY', 'INV-260725', 230000],
        ].sort(),
      );
    }
  },
);

test(
  'July acceptance 8: source balance arithmetic, period and account metadata stay distinct from coverage approval',
  options,
  async () => {
    for (const { result } of await samples()) {
      assert.deepEqual(
        [
          result.supplier.opening,
          result.supplier.closing,
          result.supplier.total,
        ],
        [840000, 7053000, 6213000],
      );
      assert.deepEqual(
        [result.ledger.opening, result.ledger.closing, result.ledger.total],
        [840000, 6437000, 5597000],
      );
      for (const source of [result.supplier, result.ledger]) {
        assert.equal(
          source.balanceArithmeticStatus,
          'BALANCE_ARITHMETIC_VERIFIED',
        );
        assert.equal(source.periodStatus, 'PERIOD_DETECTED');
        assert.equal(source.coverageStatus, 'PERIOD_COVERAGE_UNCONFIRMED');
        assert.equal(source.metadata?.periodStart, '2026-07-01');
        assert.equal(source.metadata?.periodEnd, '2026-07-31');
        assert.ok(source.metadata?.balanceRowReference.opening);
        assert.ok(source.metadata?.balanceRowReference.closing);
      }
      assert.equal(result.scope.coverageConfirmed, false);
      assert.equal(
        result.balanceComparable,
        false,
        'arithmetic is not full reconciliation approval',
      );
      assert.equal(
        result.supplier.metadata?.supplierStatementAccount,
        'CUST-10482',
      );
      assert.equal(result.ledger.metadata?.supplierCode, 'SUP-004271');
      assert.equal(
        result.ledger.metadata?.apControlAccount,
        '211001 - Trade Payables',
      );
    }
  },
);

test(
  'July acceptance 9: the source-to-ledger bridge explains exactly 6160 SAR',
  options,
  async () => {
    for (const { result } of await samples()) {
      assert.ok(result.bridge);
      assert.deepEqual(result.bridge, {
        delta: 616000,
        openingAdjustment: 0,
        itemAdjustment: -616000,
        adjusted: 6437000,
        residual: 0,
      });
      assert.equal(
        result.cases.reduce((sum, c) => sum + c.bridgeEffect, 0),
        -616000,
      );
      const effects = result.cases.filter((c) => c.bridgeEffect !== 0);
      assert.deepEqual(
        effects.map((c) => c.bridgeEffect).sort((a, b) => a - b),
        [-483000, -345000, -18000, 230000],
      );
      assert.equal(
        new Set(effects.map((c) => c.evidence.join(' '))).size,
        4,
        'each bridge explanation must identify its own case',
      );
    }
  },
);

test(
  'July acceptance 10: case counts and source-member counts are both exact',
  options,
  async () => {
    for (const { result } of await samples()) {
      assert.deepEqual(result.caseCounts, {
        autoMatchedCases: 7,
        matchedSourceRows: 16,
        needsReviewCases: 2,
        needsReviewSourceRows: 4,
        unmatchedCases: 3,
        unmatchedSourceRows: 3,
        manualMatches: 0,
        rejectedCandidates: 0,
      });
      for (const [status, cases, rows] of [
        ['Matched', 7, 16],
        ['Needs Review', 2, 4],
        ['Unmatched', 3, 3],
      ] as const) {
        const selected = result.cases.filter((c) => c.status === status);
        assert.equal(selected.length, cases);
        assert.equal(selected.flatMap(members).length, rows);
      }
    }
  },
);

test(
  'July acceptance 11: exported workbooks have six visible case sheets and native numeric/date cells',
  options,
  async () => {
    for (const { extension, files, result } of await samples()) {
      const bytes = await exportWorkbook(result, files, {
        checked: false,
        name: '',
        notes: '',
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes as never);
      const visible = [
        'Summary',
        'Matches',
        'Needs Review',
        'Unmatched',
        'Reconciliation Bridge',
        'Review Sign-off',
      ];
      assert.equal(book.worksheets[0].name, 'Summary');
      assert.deepEqual(
        book.worksheets.filter((s) => s.state === 'visible').map((s) => s.name),
        visible,
      );
      for (const sheet of book.worksheets.filter(
        (s) => !visible.includes(s.name),
      ))
        assert.equal(sheet.state, 'hidden');
      assert.equal(book.getWorksheet('Matches')!.rowCount, 8);
      assert.equal(book.getWorksheet('Needs Review')!.rowCount, 3);
      assert.equal(book.getWorksheet('Unmatched')!.rowCount, 4);
      const exportedIds = ['Matches', 'Needs Review', 'Unmatched'].flatMap(
        (name) => {
          const sheet = book.getWorksheet(name)!;
          return Array.from(
            { length: sheet.rowCount - 1 },
            (_, index) => sheet.getCell(index + 2, 1).text,
          );
        },
      );
      assert.equal(
        new Set(exportedIds).size,
        12,
        'a case cannot appear in multiple main sheets',
      );
      assert.deepEqual(
        exportedIds.sort(),
        result.cases.map((c) => c.caseId).sort(),
      );
      const summary = book.getWorksheet('Summary')!;
      for (const [label, expected] of Object.entries({
        'Auto Matched Cases': 7,
        'Matched Source Rows': 16,
        'Needs Review Cases': 2,
        'Needs Review Source Rows': 4,
        'Unmatched Cases': 3,
        'Unmatched Source Rows': 3,
        'Manual Matches': 0,
        'Rejected Candidates': 0,
        'Supplier Opening Balance': 8400,
        'Ledger Opening Balance': 8400,
        'Supplier Closing Balance': 70530,
        'Ledger Closing Balance': 64370,
        'Opening Difference': 0,
        'Closing Difference': 6160,
        'Net Bridge Adjustments': -6160,
        'Adjusted Supplier Balance': 64370,
        Residual: 0,
      })) {
        const rows: ExcelJS.Row[] = [];
        summary.eachRow((row) => {
          if (row.getCell(1).value === label) rows.push(row);
        });
        assert.equal(
          rows.length,
          1,
          `Summary must contain ${label} exactly once`,
        );
        const cell = rows[0].getCell(2);
        const actual =
          cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
        assert.equal(actual, expected, `Summary ${label}`);
      }
      for (const name of ['Matches', 'Needs Review', 'Unmatched']) {
        const sheet = book.getWorksheet(name)!;
        assert.ok(sheet.autoFilter, `${name}: filter must exist`);
        const filter = sheet.autoFilter;
        if (typeof filter === 'string')
          assert.match(
            filter,
            new RegExp(
              `:${sheet.getColumn(sheet.columnCount).letter}${sheet.rowCount}$`,
            ),
          );
        else if (filter && typeof filter === 'object') {
          const to = filter.to;
          if (typeof to === 'string')
            assert.match(to, new RegExp(`${sheet.rowCount}$`));
          else assert.equal(to.row, sheet.rowCount);
        }
        const headers = sheet.getRow(1).values as unknown[];
        let nativeAmounts = 0,
          nativeDates = 0;
        headers.forEach((value, column) => {
          if (typeof value !== 'string') return;
          const isAmount =
            /^(Supplier (Amount|Total)|Ledger (Amount|Total)|Variance|Amount)$/i.test(
              value,
            );
          const isDate = /^(Supplier Date|Ledger Date|Date)$/i.test(value);
          if (!isAmount && !isDate) return;
          for (let row = 2; row <= sheet.rowCount; row++) {
            const cell = sheet.getCell(row, column);
            if (cell.value === null || cell.value === '') continue;
            if (isDate) {
              assert.ok(
                cell.value instanceof Date,
                `${name}!${cell.address} must be a native date`,
              );
              assert.equal(cell.numFmt, 'yyyy-mm-dd');
              nativeDates++;
            } else {
              assert.equal(
                typeof cell.value,
                'number',
                `${name}!${cell.address} must be numeric`,
              );
              assert.equal(cell.numFmt, '#,##0.00');
              nativeAmounts++;
            }
          }
        });
        assert.equal(
          nativeAmounts,
          name === 'Matches' ? 14 : name === 'Needs Review' ? 6 : 3,
          `${name}: all amount columns are typed`,
        );
        assert.equal(
          nativeDates,
          name === 'Matches' ? 14 : name === 'Unmatched' ? 3 : 0,
          `${name}: all date columns are typed`,
        );
      }
      const text = book.worksheets
        .flatMap((s) => s.getSheetValues())
        .flat(2)
        .filter((v) => typeof v === 'string')
        .join('\n');
      assert.doesNotMatch(
        text,
        /الرصيد غير متاح|الأرصدة غير متاحة|الجسر غير متاح/,
      );
      const bridge = book.getWorksheet('Reconciliation Bridge')!;
      for (const item of result.cases.filter((c) => c.bridgeEffect !== 0)) {
        const rows: ExcelJS.Row[] = [];
        bridge.eachRow((row) => {
          if (row.getCell(1).value === item.caseId) rows.push(row);
        });
        assert.equal(rows.length, 1, 'one bridge row per nonzero case');
        assert.equal(rows[0].getCell(5).value, item.bridgeEffect / 100);
        assert.ok(rows[0].getCell(6).text.length > 0);
      }
      let formulas = 0;
      bridge.eachRow((r) =>
        r.eachCell((c) => {
          if (c.type === ExcelJS.ValueType.Formula) formulas++;
        }),
      );
      assert.ok(formulas > 0, 'bridge must retain real Excel formulas');
      if (extension === 'pdf') {
        const origins = book.worksheets.find((s) =>
          /^PDF Row Origins$/i.test(s.name),
        );
        assert.ok(origins && origins.rowCount > 23);
        const numeric = book.worksheets.find((s) =>
          /^Numeric Cell Origins$/i.test(s.name),
        );
        assert.ok(!numeric || numeric.state === 'hidden');
      }
    }
  },
);

test(
  'July acceptance 12: diagnostics name the actual group, variance and payment states',
  options,
  async () => {
    for (const { result } of await samples()) {
      const group = requiredCase(result, 'EXACT_1_TO_MANY', 'INV-260729');
      const variance = requiredCase(result, 'AMOUNT_VARIANCE', 'INV-260710');
      for (const [c, forbidden] of [
        [group, 'DUPLICATE_REFERENCE'],
        [variance, 'NO_REFERENCE_CANDIDATE'],
      ] as const) {
        const ids = new Set(members(c).map((t) => t.id));
        assert.equal(
          result.diagnostics.some(
            (d) =>
              d.code === forbidden &&
              d.transactionIds.some((id) => ids.has(id)),
          ),
          false,
        );
        assert.ok(c.matchingRule);
        assert.ok(c.evidence.length > 0);
      }
      assert.equal(
        requiredCase(result, 'PAYMENT_CANDIDATE').status,
        'Needs Review',
      );
      assert.equal(
        result.diagnostics.some((d) => d.code === 'BALANCE_UNVERIFIED'),
        false,
      );
      assert.ok(
        result.diagnostics.some(
          (d) => d.code === 'PERIOD_COVERAGE_UNCONFIRMED',
        ),
      );
    }
  },
);
