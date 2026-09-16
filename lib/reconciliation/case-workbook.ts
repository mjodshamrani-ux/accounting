import type ExcelJS from 'exceljs';
import type {
  AuditEvent,
  Comparison,
  ReconciliationCase,
  SourceFile,
  Transaction,
} from './types.ts';

type Value = ExcelJS.CellValue;
type Review = {
  checked: boolean;
  name: string;
  notes: string;
  events?: AuditEvent[];
};
const palette = {
  Matched: 'FFE4F0E9',
  'Needs Review': 'FFFFF0CC',
  Unmatched: 'FFFBE4E7',
  Rejected: 'FFFBE4E7',
};
const date = (value?: string): Date | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
const formula = (
  expression: string,
  result: number,
): ExcelJS.CellFormulaValue => ({ formula: expression, result });
const refs = (members: Transaction[]) =>
  [...new Set(members.map((t) => t.primaryReference || t.reference))].join(
    ' | ',
  );
const firstDate = (members: Transaction[]) =>
  date(members.map((t) => t.date).sort()[0]);
const membersText = (members: Transaction[]) =>
  members
    .map(
      (t) =>
        `${t.primaryReference || t.reference} · ${t.sheet}:${t.row}${t.sourcePage ? ` · PDF p${t.sourcePage}` : ''}`,
    )
    .join('\n');
export function parsedSourceLink(t: Transaction): ExcelJS.CellHyperlinkValue {
  const sheet =
    t.side === 'supplier' ? 'Parsed Supplier Source' : 'Parsed Ledger Source';
  return {
    text: `${t.side} · ${t.sheet} · row ${t.row}${t.sourcePage ? ` · PDF p${t.sourcePage}` : ''}`,
    hyperlink: `#'${sheet}'!A${t.row + 1}`,
  };
}

/** Six accountant-facing sheets. This is a verified snapshot, not an editable engine. */
export function addCaseWorksheets(
  book: ExcelJS.Workbook,
  result: Comparison,
  files: SourceFile[],
  review: Review,
  validateText: (text: string) => void,
): void {
  const scale = 10 ** result.scope.decimals;
  const amountFormat = result.scope.decimals
    ? '#,##0.' + '0'.repeat(result.scope.decimals)
    : '#,##0';
  const major = (value: number | null | undefined): number | null =>
    value == null ? null : value / scale;
  const create = (
    name: string,
    headers: string[],
    rows: Value[][],
    widths: number[],
  ) => {
    const sheet = book.addWorksheet(name, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      pageSetup: {
        orientation: headers.length > 4 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.addRow(headers);
    rows.forEach((row) =>
      sheet.addRow(row.map((value) => (value === '' ? null : value))),
    );
    sheet.columns.forEach((column, index) => {
      column.width = widths[index] ?? 30;
    });
    sheet.eachRow((row, index) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (typeof value === 'string') validateText(value);
        if (value && typeof value === 'object' && 'text' in value)
          validateText(value.text);
        cell.alignment = {
          vertical: 'top',
          wrapText: true,
          readingOrder: 'ltr',
        };
        if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
        if (value && typeof value === 'object' && 'hyperlink' in value)
          cell.font = { color: { argb: 'FF245A81' }, underline: true };
      });
      if (index > 1) row.height = 42;
    });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF31556B' },
    };
    sheet.getRow(1).height = 32;
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: headers.length },
    };
    sheet.pageSetup.printTitlesRow = '1:1';
    return sheet;
  };
  const shade = (sheet: ExcelJS.Worksheet, cases: ReconciliationCase[]) =>
    cases.forEach((c, index) => {
      sheet.getRow(index + 2).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: palette[c.status] },
      };
    });
  const amountColumns = (sheet: ExcelJS.Worksheet, columns: number[]) =>
    columns.forEach((column) => {
      sheet.getColumn(column).numFmt = amountFormat;
    });
  const sourceColumns = (cases: ReconciliationCase[]) => {
    const supplier = Math.max(0, ...cases.map((c) => c.supplierMembers.length));
    const ledger = Math.max(0, ...cases.map((c) => c.ledgerMembers.length));
    return {
      headers: [
        ...Array.from(
          { length: supplier },
          (_, i) => `Supplier Source ${i + 1}`,
        ),
        ...Array.from({ length: ledger }, (_, i) => `Ledger Source ${i + 1}`),
      ],
      values: (c: ReconciliationCase): Value[] => [
        ...Array.from({ length: supplier }, (_, i) =>
          c.supplierMembers[i] ? parsedSourceLink(c.supplierMembers[i]) : null,
        ),
        ...Array.from({ length: ledger }, (_, i) =>
          c.ledgerMembers[i] ? parsedSourceLink(c.ledgerMembers[i]) : null,
        ),
      ],
    };
  };
  const matched = result.cases.filter((c) => c.status === 'Matched');
  const needsReview = result.cases.filter(
    (c) => c.status === 'Needs Review' || c.status === 'Rejected',
  );
  const unmatched = result.cases.filter((c) => c.status === 'Unmatched');
  // Reserve the six sheets in their final order; all audit sheets are added later.
  const summary = create(
    'Summary',
    ['Field / الحقل', 'Value / القيمة'],
    [],
    [37, 88],
  );
  const matchSources = sourceColumns(matched);
  const matches = create(
    'Matches',
    [
      'Case ID',
      'Match Type',
      'Supplier Date',
      'Supplier References',
      'Supplier Amount',
      'Ledger Date',
      'Ledger References',
      'Ledger Amount',
      'Group Members',
      'Date Gap',
      'Rule',
      'Evidence',
      'Status',
      'Reviewer Note',
      'Supplier Source Rows',
      'Ledger Source Rows',
      'Match Decision',
      ...matchSources.headers,
    ],
    matched.map((c) => {
      const dates = [...c.supplierMembers, ...c.ledgerMembers].map((t) =>
        Date.parse(`${t.date}T00:00:00Z`),
      );
      return [
        c.caseId,
        c.supplierMembers.length === 1 && c.ledgerMembers.length === 1
          ? '1:1'
          : c.supplierMembers.length === 1
            ? '1:M'
            : 'M:1',
        firstDate(c.supplierMembers),
        refs(c.supplierMembers),
        major(c.supplierTotal),
        firstDate(c.ledgerMembers),
        refs(c.ledgerMembers),
        major(c.ledgerTotal),
        `${c.supplierMembers.length} supplier / ${c.ledgerMembers.length} ledger`,
        dates.length
          ? (Math.max(...dates) - Math.min(...dates)) / 86400000
          : null,
        c.matchingRule,
        c.evidence.join('\n'),
        c.status,
        c.reviewerReason ?? '',
        c.supplierMembers.length,
        c.ledgerMembers.length,
        c.reviewerDecision === 'Accepted' ? 'Manual' : 'Auto',
        ...matchSources.values(c),
      ];
    }),
    [24, 13, 15, 27, 19, 15, 27, 19, 25, 13, 27, 65, 15, 42, 16, 16, 18],
  );
  amountColumns(matches, [5, 8]);
  shade(matches, matched);
  const reviewSources = sourceColumns(needsReview);
  const reviewRows = create(
    'Needs Review',
    [
      'Case ID',
      'Classification',
      'Supplier Members',
      'Ledger Members',
      'Supplier Total',
      'Ledger Total',
      'Variance',
      'Evidence',
      'Why Review Is Required',
      'Suggested Action',
      'User Decision',
      'User Reason',
      'Status',
      'Supplier Source Rows',
      'Ledger Source Rows',
      ...reviewSources.headers,
    ],
    needsReview.map((c) => [
      c.caseId,
      c.classification,
      membersText(c.supplierMembers),
      membersText(c.ledgerMembers),
      major(c.supplierTotal),
      major(c.ledgerTotal),
      major(c.variance),
      c.evidence.join('\n'),
      c.classification === 'AMOUNT_VARIANCE'
        ? 'Counterpart identified; the signed amounts differ.'
        : c.classification === 'PAYMENT_CANDIDATE'
          ? 'Exact unique payment amount and date proximity; no shared documentary reference.'
          : c.status === 'Rejected'
            ? 'The reviewer rejected this candidate; it is not a confirmed match.'
            : 'The evidence does not prove a unique match.',
      c.classification === 'AMOUNT_VARIANCE'
        ? 'Compare the original invoice, postings and adjustments; document the reason for the variance.'
        : c.classification === 'PAYMENT_CANDIDATE'
          ? 'Confirm the bank transfer or remittance advice and both payment references.'
          : 'Inspect the linked source documents and record a supported decision in Mizan.',
      c.reviewerDecision ?? 'Pending',
      c.reviewerReason ?? '',
      c.status,
      c.supplierMembers.length,
      c.ledgerMembers.length,
      ...reviewSources.values(c),
    ]),
    [24, 25, 43, 43, 19, 19, 19, 65, 58, 58, 18, 42, 18, 16, 16],
  );
  amountColumns(reviewRows, [5, 6, 7]);
  shade(reviewRows, needsReview);
  const unpaired = create(
    'Unmatched',
    [
      'Case ID',
      'Side',
      'Date',
      'Document Type',
      'Reference',
      'PO / Voucher / Bank Ref',
      'Description',
      'Amount',
      'Reason',
      'Source Link',
      'Source Rows',
    ],
    unmatched.map((c) => {
      const t = [...c.supplierMembers, ...c.ledgerMembers][0];
      return [
        c.caseId,
        t?.side ?? '',
        t ? date(t.date) : null,
        t?.documentType ?? '',
        t?.primaryReference || t?.reference || '',
        t
          ? [
              t.poReference,
              t.voucherReference,
              t.bankReference,
              t.receiptReference,
            ]
              .filter(Boolean)
              .join(' | ')
          : '',
        t?.description ?? '',
        major(c.supplierMembers.length ? c.supplierTotal : c.ledgerTotal),
        c.evidence.join('\n'),
        t ? parsedSourceLink(t) : null,
        c.supplierMembers.length + c.ledgerMembers.length,
      ];
    }),
    [24, 14, 15, 19, 28, 37, 55, 19, 60, 42, 15],
  );
  amountColumns(unpaired, [8]);
  shade(unpaired, unmatched);
  const affected = result.cases.filter((c) => c.bridgeEffect !== 0);
  const opening = result.bridge?.openingAdjustment ?? 0;
  const bridgeRows: Value[][] = [
    ...(opening !== 0
      ? [
          [
            'OPENING_DIFFERENCE',
            'OPENING_BALANCE_DIFFERENCE',
            major(result.supplier.opening),
            major(result.ledger.opening),
            major(opening),
            'Ledger opening balance minus supplier opening balance; investigate the earlier period.',
            'Needs Review',
            'See source balance row references in Run Settings',
          ],
        ]
      : []),
    ...affected.map((c) => [
      c.caseId,
      c.classification,
      major(c.supplierTotal),
      major(c.ledgerTotal),
      major(c.bridgeEffect),
      c.evidence.join('\n'),
      c.status,
      {
        text: `${c.sourceTrace.length} source rows · ${c.caseId}`,
        hyperlink: `#'${c.status === 'Unmatched' ? 'Unmatched' : c.status === 'Matched' ? 'Matches' : 'Needs Review'}'!A${(c.status === 'Unmatched' ? unmatched : c.status === 'Matched' ? matched : needsReview).indexOf(c) + 2}`,
      },
    ]),
  ];
  const bridge = create(
    'Reconciliation Bridge',
    [
      'Case ID',
      'Classification',
      'Supplier Amount',
      'Ledger Amount',
      'Adjustment From Supplier to Ledger',
      'Explanation',
      'Review Status',
      'Supporting Source',
    ],
    bridgeRows,
    [26, 28, 20, 27, 28, 70, 20, 44],
  );
  amountColumns(bridge, [3, 4, 5]);
  const totalRow = bridgeRows.length + 3;
  const supplierClose = result.supplier.closing;
  const ledgerClose = result.ledger.closing;
  const net = opening + affected.reduce((sum, c) => sum + c.bridgeEffect, 0);
  const setBridge = (row: number, label: string, value: Value) => {
    bridge.getCell(row, 4).value = label;
    bridge.getCell(row, 4).font = { bold: true };
    bridge.getCell(row, 4).alignment = {
      wrapText: true,
      vertical: 'middle',
      readingOrder: 'ltr',
    };
    bridge.getRow(row).height = 32;
    bridge.getCell(row, 5).value = value;
    bridge.getCell(row, 5).numFmt = amountFormat;
  };
  setBridge(
    totalRow,
    'Net Bridge Adjustments',
    formula(
      bridgeRows.length ? `SUM(E2:E${bridgeRows.length + 1})` : '0',
      net / scale,
    ),
  );
  setBridge(totalRow + 1, 'Supplier Closing Balance', major(supplierClose));
  setBridge(
    totalRow + 2,
    'Adjusted Supplier Balance',
    result.bridge
      ? formula(
          `SUM(E${totalRow}:E${totalRow + 1})`,
          result.bridge.adjusted / scale,
        )
      : null,
  );
  setBridge(totalRow + 3, 'Ledger Closing Balance', major(ledgerClose));
  setBridge(
    totalRow + 4,
    'Residual',
    result.bridge
      ? formula(
          `E${totalRow + 2}-E${totalRow + 3}`,
          result.bridge.residual / scale,
        )
      : null,
  );
  const caveat = bridge.getCell(totalRow + 6, 1);
  caveat.value = result.bridge
    ? 'Arithmetic bridge only. A zero residual does not prove the accounting causes or complete reconciliation. Review cases and coverage remain separate.'
    : 'Balance bridge prerequisites are incomplete. Case adjustments above are transaction effects only.';
  caveat.alignment = { wrapText: true };
  bridge.mergeCells(totalRow + 6, 1, totalRow + 7, 8);
  const zeroNet = result.cases.filter(
    (c) =>
      c.bridgeEffect === 0 &&
      (c.status === 'Needs Review' || c.status === 'Rejected'),
  );
  if (zeroNet.length) {
    const start = totalRow + 9;
    bridge.getCell(start, 1).value =
      'Zero-net review cases — excluded from net adjustments';
    bridge.mergeCells(start, 1, start, 8);
    zeroNet.forEach((c, index) => {
      const row = bridge.getRow(start + index + 1);
      row.values = [
        c.caseId,
        c.classification,
        major(c.supplierTotal),
        major(c.ledgerTotal),
        0,
        c.evidence.join('\n'),
        c.status,
        {
          text: 'Review case',
          hyperlink: `#'Needs Review'!A${needsReview.indexOf(c) + 2}`,
        },
      ];
      row.alignment = { wrapText: true, vertical: 'top', readingOrder: 'ltr' };
      row.height = 48;
    });
  }
  const signedAt = [...(review.events ?? [])]
    .reverse()
    .find((event) => event.action === 'review')?.time;
  create(
    'Review Sign-off',
    ['Field / الحقل', 'Value / القيمة'],
    [
      ['Reviewer Name', review.name],
      [
        'Review Date',
        signedAt && Number.isFinite(Date.parse(signedAt))
          ? new Date(signedAt)
          : null,
      ],
      [
        'Coverage Confirmed',
        result.scope.coverageConfirmed
          ? 'Confirmed by user'
          : 'Pending user confirmation',
      ],
      ['Review Completed', review.checked ? 'User marked complete' : 'Pending'],
      [
        'Approved / Not Approved',
        'Not approved — review completion is not an approval declaration',
      ],
      ['Notes', review.notes],
      [
        'Workbook Mode',
        'Snapshot. Editing this workbook does not change Mizan decisions, evidence or matching status. Record decisions in Mizan and export a new snapshot.',
      ],
      [
        'Review History',
        { text: 'Recorded actions', hyperlink: "#'Review History'!A1" },
      ],
    ],
    [35, 100],
  );
  const s = result.supplier,
    l = result.ledger;
  const summaryRows: [string, Value, ('money' | 'date')?][] = [];
  // Local helper retains an explicit unit for every executive financial cell.
  const field = (label: string, value: Value, kind?: 'money' | 'date') => {
    summaryRows.push([label, value, kind]);
  };
  field(
    'Workbook Mode',
    'Verified accounting snapshot for review; not a declaration of full reconciliation.',
  );
  field(
    'Supplier',
    result.scope.supplier ||
      s.metadata?.supplierName ||
      l.metadata?.supplierName ||
      '',
  );
  field(
    'Entity',
    result.scope.entity ||
      s.metadata?.entityName ||
      l.metadata?.entityName ||
      '',
  );
  field('Currency', result.scope.currency);
  field(
    'Supplier Period Start',
    date(s.metadata?.periodStart || s.mapping.periodStart),
    'date',
  );
  field('Supplier Period End', date(s.metadata?.periodEnd), 'date');
  field(
    'Ledger Period Start',
    date(l.metadata?.periodStart || l.mapping.periodStart),
    'date',
  );
  field('Ledger Period End', date(l.metadata?.periodEnd), 'date');
  field('Cut-off Date', date(result.scope.cutoff), 'date');
  field(
    'Supplier Source Type',
    files[0].pdf ? 'PDF' : /\.xlsx$/i.test(files[0].name) ? 'Excel' : 'CSV',
  );
  field(
    'Ledger Source Type',
    files[1].pdf ? 'PDF' : /\.xlsx$/i.test(files[1].name) ? 'Excel' : 'CSV',
  );
  field(
    'Supplier Statement Account',
    s.metadata?.supplierStatementAccount ||
      l.metadata?.supplierStatementAccount ||
      '',
  );
  field(
    'Supplier Code',
    l.metadata?.supplierCode || s.metadata?.supplierCode || '',
  );
  field(
    'AP Control Account',
    l.metadata?.apControlAccount ||
      s.metadata?.apControlAccount ||
      result.scope.account,
  );
  field(
    'Reviewer Status',
    review.checked
      ? 'Review completed by user; no approval implied'
      : 'Pending review',
  );
  field('Supplier Opening Balance', major(s.opening), 'money');
  field('Ledger Opening Balance', major(l.opening), 'money');
  field('Supplier Closing Balance', major(s.closing), 'money');
  field('Ledger Closing Balance', major(l.closing), 'money');
  field(
    'Opening Difference',
    s.opening !== null && l.opening !== null
      ? major(s.opening - l.opening)
      : null,
    'money',
  );
  field(
    'Closing Difference',
    s.closing !== null && l.closing !== null
      ? major(s.closing - l.closing)
      : null,
    'money',
  );
  field(
    'Supplier Balance Arithmetic',
    s.balanceArithmeticStatus ??
      (s.balanceValid
        ? 'BALANCE_ARITHMETIC_VERIFIED'
        : 'BALANCE_ROW_NOT_FOUND'),
  );
  field(
    'Ledger Balance Arithmetic',
    l.balanceArithmeticStatus ??
      (l.balanceValid
        ? 'BALANCE_ARITHMETIC_VERIFIED'
        : 'BALANCE_ROW_NOT_FOUND'),
  );
  field('Supplier Period Status', s.periodStatus ?? 'PERIOD_NOT_DETECTED');
  field('Ledger Period Status', l.periodStatus ?? 'PERIOD_NOT_DETECTED');
  field(
    'Coverage Confirmation Status',
    result.scope.coverageConfirmed
      ? 'PERIOD_COVERAGE_CONFIRMED'
      : 'PERIOD_COVERAGE_UNCONFIRMED',
  );
  const matchEnd = Math.max(2, matched.length + 1),
    reviewEnd = Math.max(2, needsReview.length + 1),
    unmatchedEnd = Math.max(2, unmatched.length + 1);
  field(
    'Auto Matched Cases',
    formula(
      `COUNTIF('Matches'!Q2:Q${matchEnd},"Auto")`,
      result.caseCounts.autoMatchedCases,
    ),
  );
  field(
    'Matched Source Rows',
    formula(
      `SUM('Matches'!O2:P${matchEnd})`,
      result.caseCounts.matchedSourceRows,
    ),
  );
  field(
    'Needs Review Cases',
    formula(
      `COUNTIF('Needs Review'!M2:M${reviewEnd},"Needs Review")`,
      result.caseCounts.needsReviewCases,
    ),
  );
  field(
    'Needs Review Source Rows',
    formula(
      `SUMIF('Needs Review'!M2:M${reviewEnd},"Needs Review",'Needs Review'!N2:N${reviewEnd})+SUMIF('Needs Review'!M2:M${reviewEnd},"Needs Review",'Needs Review'!O2:O${reviewEnd})`,
      result.caseCounts.needsReviewSourceRows,
    ),
  );
  field(
    'Unmatched Cases',
    formula(
      `COUNTA('Unmatched'!A2:A${unmatchedEnd})`,
      result.caseCounts.unmatchedCases,
    ),
  );
  field(
    'Unmatched Source Rows',
    formula(
      `SUM('Unmatched'!K2:K${unmatchedEnd})`,
      result.caseCounts.unmatchedSourceRows,
    ),
  );
  field(
    'Manual Matches',
    formula(
      `COUNTIF('Matches'!Q2:Q${matchEnd},"Manual")`,
      result.caseCounts.manualMatches,
    ),
  );
  field(
    'Rejected Candidates',
    formula(
      `COUNTIF('Needs Review'!M2:M${reviewEnd},"Rejected")`,
      result.caseCounts.rejectedCandidates,
    ),
  );
  field(
    'Net Bridge Adjustments',
    formula(`'Reconciliation Bridge'!E${totalRow}`, net / scale),
    'money',
  );
  field(
    'Adjusted Supplier Balance',
    result.bridge
      ? formula(
          `'Reconciliation Bridge'!E${totalRow + 2}`,
          result.bridge.adjusted / scale,
        )
      : null,
    'money',
  );
  field(
    'Residual',
    result.bridge
      ? formula(
          `'Reconciliation Bridge'!E${totalRow + 4}`,
          result.bridge.residual / scale,
        )
      : null,
    'money',
  );
  field(
    'Bridge Status',
    result.bridge
      ? 'Arithmetic bridge available; does not prove accounting causes or full reconciliation'
      : 'Balance bridge prerequisites incomplete',
  );
  field('Review Cases', {
    text: 'Open Needs Review',
    hyperlink: "#'Needs Review'!A1",
  });
  field('Review Sign-off', {
    text: 'Open Review Sign-off',
    hyperlink: "#'Review Sign-off'!A1",
  });
  field('Audit Metadata', {
    text: 'Version, hashes and export time (hidden audit sheet)',
    hyperlink: "#'Export Metadata'!A1",
  });
  summaryRows.forEach(([label, value, kind]) => {
    if (typeof value === 'string') validateText(value);
    const row = summary.addRow([label, value === '' ? null : value]);
    row.height = 30;
    row.alignment = { vertical: 'top', wrapText: true, readingOrder: 'ltr' };
    if (kind === 'money') row.getCell(2).numFmt = amountFormat;
    if (kind === 'date') row.getCell(2).numFmt = 'yyyy-mm-dd';
    if (
      label.includes('Cases') ||
      label.includes('Source Rows') ||
      kind === 'money'
    )
      row.getCell(2).font = { bold: true, color: { argb: 'FF24465D' } };
  });
  const rowFor = (label: string) =>
    summaryRows.findIndex(([key]) => key === label) + 2;
  if (s.opening !== null && l.opening !== null)
    summary.getCell(rowFor('Opening Difference'), 2).value = formula(
      `B${rowFor('Supplier Opening Balance')}-B${rowFor('Ledger Opening Balance')}`,
      (s.opening - l.opening) / scale,
    );
  if (s.closing !== null && l.closing !== null)
    summary.getCell(rowFor('Closing Difference'), 2).value = formula(
      `B${rowFor('Supplier Closing Balance')}-B${rowFor('Ledger Closing Balance')}`,
      (s.closing - l.closing) / scale,
    );
  summary.autoFilter = { from: 'A1', to: `B${summary.rowCount}` };
  book.views = [
    {
      x: 0,
      y: 0,
      width: 16000,
      height: 10000,
      visibility: 'visible',
      activeTab: 0,
      firstSheet: 0,
    },
  ];
  book.calcProperties.fullCalcOnLoad = true;
}
