export const ENGINE_VERSION = '0.3.22-experimental';
export const MAX_ROWS = 20000;
export const MAX_SHEETS = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
// Native-text PDF capacity, independent of row/text/byte and OCR limits.
export const MAX_PDF_PAGES = 100;
export type SheetData = {
  name: string;
  rows: string[][];
  formulaRows: number[];
  hiddenRows: number[];
  // Native XLSX geometry, not an inferred role or an accounting approval.
  xlsxHeaders?: {
    sourceHash: string;
    sheetName: string;
    sheetIndex: number;
    hiddenColumns: number[];
    merges: {
      top: number;
      left: number;
      bottom: number;
      right: number;
      text: string;
    }[];
  };
  numericCells?: Record<string, { value: number; format: string }>;
  formulaCells?: Record<string, { formula: string }>;
  rowIssues?: Record<string, string[]>;
  // Excel issues are scoped to cells (one-based row:column), then checked against
  // the user's mapping. Unused helper columns must not invalidate a transaction.
  cellIssues?: Record<string, string[]>;
  // Observations that do not change the value read from the cell. They are shown
  // to the accountant but never block a row, unlike cellIssues.
  cellNotes?: Record<string, string[]>;
  referenceIssues?: Record<string, string[]>;
  rowPages?: Record<string, number>;
  pdfHeaderFragments?: Record<string, string[][]>;
  pdfTextTransforms?: Record<
    string,
    {
      column: number;
      page: number;
      extractedText: string;
      glyphText: string;
      usedText: string;
      rule:
        | 'verified-numeric-glyph-order'
        | 'verified-adjacent-numeric-fragments'
        | 'verified-rtl-word-order';
    }[]
  >;
};
export type SourceFile = {
  name: string;
  sheets: SheetData[];
  original?: ArrayBuffer;
  sha256?: string;
  pdf?: { cuts: number[]; pages: number; autoColumns?: boolean };
};
export type ReportType = 'transactions' | 'open-items';
/** Context that made a format choice meaningful. Any change to the source, the
 * mapped column, the header row or the currency precision invalidates it. */
export type FormatChoice = {
  value: string;
  sourceHash: string;
  sheet: number;
  header: number;
  columns: number[];
  decimals: number;
  candidates: string[];
  // Settings that change which values reach the interpretation even though the
  // file and its columns are unchanged: the PDF extraction boundaries, the rows
  // excluded from reading, and any balance typed in beside the table.
  cuts: number[];
  excludedRows: number[];
  balanceInputs: string[];
};
export type Mapping = {
  pdfReviewed?: boolean;
  sheet: number;
  header: number;
  date: number;
  reference: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  currencyColumn: number;
  mode: 'signed' | 'split';
  multiplier: 1 | -1;
  directionEvidence?: {
    multiplier: 1 | -1;
    balanceColumn: number;
    checkedRows: number;
    reason: string;
  };
  numberFormat: 'dot' | 'comma';
  dateFormat: 'ymd' | 'dmy' | 'mdy';
  // The accountant's explicit answer to an ambiguity the document cannot settle,
  // bound to the document and the reading it was made under. It records that a
  // choice was made, never that a source was reviewed or approved: the engine
  // re-derives from the document whether a choice is still needed and whether
  // this value is still one the document allows.
  formatChoice?: {
    dateFormat?: FormatChoice;
    numberFormat?: FormatChoice;
  };
  reportType: ReportType;
  opening: string;
  closing: string;
  periodStart: string;
  excluded: Record<string, string>;
};
export type Scope = {
  supplier: string;
  entity: string;
  account: string;
  currency: string;
  decimals: number;
  cutoff: string;
  dateWindow: number;
  confirmed: boolean;
  coverageConfirmed: boolean;
};
export type Transaction = {
  amountMinor?: number;
  primaryReference?: string;
  referenceEvidenceIssues?: string[];
  documentReference?: string;
  voucherReference?: string;
  poReference?: string;
  bankReference?: string;
  receiptReference?: string;
  // Only identities read from explicitly labelled bank/receipt columns. A PAY
  // prefix or a mixed PO/bank column is not positive evidence for grouping.
  paymentIdentityFields?: ('bankReference' | 'receiptReference')[];
  documentType?: 'Invoice' | 'Credit Note' | 'Payment' | 'Journal' | 'Unknown';
  chosenReference?: string;
  // Positive role provenance only for an explicitly selected, unique and safe
  // generic reference column. Local vouchers/orders and audit-only retention
  // must never acquire this authority merely by having the same cell value.
  chosenReferenceEvidence?: {
    role: 'document-reference';
    header: string;
    column: number;
  };
  // A unique, safe column explicitly labelled Reference, even when the
  // reading chose another identity. This is conflict evidence only.
  statedReference?: string;
  // Values read from the row that no other field carries, with the header
  // they came from. Kept for the audit trail only; never matching evidence.
  retainedEvidence?: {
    field:
      | 'mappedReference'
      | 'statedReference'
      | 'batch'
      | 'documentTypeLabel';
    header: string;
    value: string;
  }[];
  currency?: string;
  sourcePage?: number;
  id: string;
  side: 'supplier' | 'ledger';
  row: number;
  sheet: string;
  date: string;
  reference: string;
  normalizedReference: string;
  description: string;
  amount: number;
  originalAmount: string;
};
export type Excluded = {
  row: number;
  reason: string;
  values: string[];
  // Assigned by normalization, never inferred from the free-text reason.
  kind?: 'non-movement' | 'manual' | 'outside-period';
  // Negative membership only. Excluding a movement cannot manufacture uniqueness.
  isolation?: SourceReadError['isolation'];
};
export type SourceReadError = {
  row: number;
  message: string;
  sourcePage?: number;
  // Entered balance values affect arithmetic, never the identity of a movement.
  // All other row-zero errors remain source-wide semantic blockers.
  scope?: 'balance';
  // Negative evidence only: an unread movement still occupies every safely
  // observed identity. Absence means its possible competitors are unknown.
  isolation?: { rule: 'SAFE_REFERENCE_ENVELOPE_V1'; keys: string[] };
};
export type SourceResult = {
  metadata?: import('./statement-metadata.ts').StatementMetadata;
  balanceArithmeticStatus?:
    | 'BALANCE_ARITHMETIC_VERIFIED'
    | 'BALANCE_ARITHMETIC_FAILED'
    | 'BALANCE_ROW_NOT_FOUND';
  periodStatus?: 'PERIOD_DETECTED' | 'PERIOD_NOT_DETECTED';
  coverageStatus?: 'PERIOD_COVERAGE_CONFIRMED' | 'PERIOD_COVERAGE_UNCONFIRMED';
  transactions: Transaction[];
  excluded: Excluded[];
  errors: SourceReadError[];
  warnings: string[];
  total: number;
  opening: number | null;
  closing: number | null;
  balanceValid: boolean;
  rowCount: number;
  mapping: Mapping;
  sourceName: string;
  // Where the rows came from: the file's SHA-256 (or, for a file read without
  // one, a fingerprint of its sheet) and the sheet. Two sides with the same
  // origin that read the same rows are one source compared with itself.
  sourceOrigin?: string;
  sourceHash?: string;
};
export type Match = {
  caseId?: string;
  supplierIds?: string[];
  ledgerIds?: string[];
  supplierId: string;
  ledgerId: string;
  kind: 'auto' | 'manual';
  reason: string;
  note?: string;
  evidence?: {
    rule: string;
    supplierRow: number;
    ledgerRow: number;
    amount: number;
    dateGap: number;
    reference: string;
    discriminator?: {
      value: string;
      supplierHeader: string;
      supplierColumn: number;
      ledgerHeader: string;
      ledgerColumn: number;
    };
  };
};
export type Decision = { supplierId: string; ledgerId: string; note: string };
export type ReconciliationCase = {
  caseId: string;
  classification:
    | 'EXACT_1_TO_1'
    | 'EXACT_1_TO_MANY'
    | 'EXACT_MANY_TO_1'
    | 'EXACT_MANY_TO_MANY'
    | 'AMOUNT_VARIANCE'
    | 'PAYMENT_CANDIDATE'
    | 'SUPPLIER_ONLY'
    | 'LEDGER_ONLY'
    | 'REJECTED_CANDIDATE'
    | 'AMBIGUOUS_CANDIDATE';
  status: 'Matched' | 'Needs Review' | 'Unmatched' | 'Rejected';
  supplierMembers: Transaction[];
  ledgerMembers: Transaction[];
  supplierTotal: number;
  ledgerTotal: number;
  variance: number;
  bridgeEffect: number;
  matchingRule: string;
  evidence: string[];
  reviewRequired: boolean;
  reviewerDecision?: 'Accepted' | 'Rejected';
  reviewerReason?: string;
  createdAt?: string;
  reviewedAt?: string;
  sourceTrace: {
    sourceRowId: string;
    side: Transaction['side'];
    sheet: string;
    row: number;
    page?: number;
  }[];
};
export type CaseCounts = {
  autoMatchedCases: number;
  matchedSourceRows: number;
  needsReviewCases: number;
  needsReviewSourceRows: number;
  unmatchedCases: number;
  unmatchedSourceRows: number;
  manualMatches: number;
  rejectedCandidates: number;
};
export type Comparison = {
  cases: ReconciliationCase[];
  caseCounts: CaseCounts;
  supplier: SourceResult;
  ledger: SourceResult;
  scope: Scope;
  matches: Match[];
  supplierOnly: Transaction[];
  ledgerOnly: Transaction[];
  ambiguousIds: string[];
  suggestions: Record<string, string[]>;
  rejectedPairs: string[];
  diagnostics: { code: string; message: string; transactionIds: string[] }[];
  balanceComparable: boolean;
  bridge: {
    delta: number;
    openingAdjustment: number;
    itemAdjustment: number;
    adjusted: number;
    residual: number;
  } | null;
};
export const defaultMapping = (): Mapping => ({
  sheet: 0,
  header: 0,
  date: -1,
  reference: -1,
  description: -1,
  amount: -1,
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
});

export type AuditEvent = {
  time: string;
  action: 'compare' | 'link' | 'unlink' | 'review';
  ids: string[];
  note: string;
};
