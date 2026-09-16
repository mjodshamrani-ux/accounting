export const ENGINE_VERSION = '0.3.8-experimental';
export const MAX_ROWS = 20000;
export const MAX_SHEETS = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export type SheetData = {
  name: string;
  rows: string[][];
  formulaRows: number[];
  hiddenRows: number[];
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
};
export type SourceFile = {
  name: string;
  sheets: SheetData[];
  original?: ArrayBuffer;
  sha256?: string;
  pdf?: { cuts: number[]; pages: number; autoColumns?: boolean };
};
export type ReportType = 'transactions' | 'open-items';
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
  documentType?: 'Invoice' | 'Credit Note' | 'Payment' | 'Journal' | 'Unknown';
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
export type Excluded = { row: number; reason: string; values: string[] };
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
  errors: { row: number; message: string }[];
  warnings: string[];
  total: number;
  opening: number | null;
  closing: number | null;
  balanceValid: boolean;
  rowCount: number;
  mapping: Mapping;
  sourceName: string;
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
  };
};
export type Decision = { supplierId: string; ledgerId: string; note: string };
export type ReconciliationCase = {
  caseId: string;
  classification:
    | 'EXACT_1_TO_1'
    | 'EXACT_1_TO_MANY'
    | 'EXACT_MANY_TO_1'
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
