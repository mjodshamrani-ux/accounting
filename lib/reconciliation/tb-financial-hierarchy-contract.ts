/** Local passive source4 prototype. This is not a financial decision/session contract. */
/**
 * Separate admission contract, not foundation-1 evidence equivalence.
 * Empty/oversized buffers are refused before capture/hash/decode: source=null,
 * BYTES, incomplete inventory and no source evidence. After successful capture
 * and hashing, syntax/semantic blocks retain the actual original/hash/length.
 * Hash/capture failures remain blocked without fabricated source evidence.
 */
export const FIN_HIERARCHY_INTAKE_CONTRACT =
  'fin-source4-bounded-intake-v1' as const;
export const FIN_HIERARCHY_SCOPE_HEADERS = [
  'Entity',
  'Ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
  'As of',
  'Chart version',
  'Map version',
  'Closing basis',
] as const;
export type FinancialHierarchyScopeHeader =
  (typeof FIN_HIERARCHY_SCOPE_HEADERS)[number];
export type FinancialHierarchyScope = Readonly<
  Record<FinancialHierarchyScopeHeader, string>
>;
export const FIN_HIERARCHY_NODE_HEADERS = [
  'Node ID',
  'Parent ID',
  'Kind',
  'Line label',
  'Line class',
  'Amount',
] as const;
export const FIN_HIERARCHY_CATEGORIES = [
  'current-asset',
  'noncurrent-asset',
  'current-liability',
  'noncurrent-liability',
  'equity',
] as const;
export type FinancialHierarchyCategory =
  (typeof FIN_HIERARCHY_CATEGORIES)[number];
export const FIN_HIERARCHY_LIMITS = Object.freeze({
  rows: 200,
  bytes: 131072,
  fieldCodePoints: 2000,
  depth: 20,
  minorAbs: 100000000000000n,
});
export type FinancialHierarchyIssueCode =
  | 'INPUT'
  | 'NAME'
  | 'BYTES'
  | 'HASH'
  | 'CSV'
  | 'UTF8'
  | 'HEADERS'
  | 'ROWS'
  | 'TEXT'
  | 'WIDTH'
  | 'SCOPE'
  | 'UNSUPPORTED_SCOPE'
  | 'DATE'
  | 'EMPTY_SOURCE'
  | 'NO_FINANCIAL_LEAF'
  | 'IDENTITY'
  | 'DUPLICATE_NODE'
  | 'KIND'
  | 'TITLE'
  | 'CLASSIFICATION'
  | 'MONEY'
  | 'PARENT'
  | 'CYCLE'
  | 'DEPTH'
  | 'EMPTY_PARENT'
  | 'CONTROL_TOTAL'
  | 'SUM';
export interface FinancialHierarchyIssue {
  code: FinancialHierarchyIssueCode;
  row: number | null;
  field: string | null;
  citationIndices: number[];
}
export interface FinancialHierarchyCitation {
  sourceRole: 'financial-position';
  sha256: string;
  /** CSV record position, header=1. Not a physical line number. */
  row: number;
  column: number;
  field: string | null;
  /** Decoded field text, without normalization, trimming or newline replacement. */
  raw: string;
  /** Exact serialized field, including quotes and escaped quotes. */
  lexeme: string;
}
export interface FinancialHierarchyInventoryRecord {
  row: number;
  raw: string[];
  lexemes: string[];
  /** Record bytes decoded as UTF-8, without its terminating record delimiter. */
  serialized: string;
  validWidth: boolean | null;
  citationIndices: number[];
}
export interface FinancialHierarchyNode {
  row: number;
  id: string;
  parentId: string;
  kind: string;
  label: string;
  lineClass: string;
  amountMinor: bigint | null;
  citationIndices: number[];
}
export interface FinancialHierarchyEdge {
  childId: string;
  childRow: number;
  parentId: string;
  /** All contenders, never a first-wins parent lookup. */
  parentRows: number[];
  citationIndices: number[];
}
export interface FinancialHierarchyControl {
  nodeId: string;
  row: number;
  children: { nodeId: string; row: number; amountMinor: bigint | null }[];
  suppliedMinor: bigint | null;
  childTotalMinor: bigint | null;
  differenceMinor: bigint | null;
  matches: boolean | null;
  citationIndices: number[];
}
export interface FinancialHierarchyLeafSums {
  /** Leaves only; parent amounts are controls, never extra contributions. */
  leaves: {
    nodeId: string;
    row: number;
    lineClass: string;
    amountMinor: bigint;
  }[];
  categoryMinor: Record<FinancialHierarchyCategory, bigint>;
  assetsMinor: bigint;
  liabilitiesMinor: bigint;
  equityMinor: bigint;
  equationMinor: bigint;
}
export interface FinancialHierarchySource4Result {
  readonly intakeContract: typeof FIN_HIERARCHY_INTAKE_CONTRACT;
  kind: 'passive-source4-inspection';
  status: 'inspected' | 'blocked';
  scope: FinancialHierarchyScope | null;
  source: {
    name: string;
    original: ArrayBuffer;
    sha256: string;
    byteLength: number;
  } | null;
  header: string[] | null;
  nodes: FinancialHierarchyNode[];
  edges: FinancialHierarchyEdge[];
  controls: FinancialHierarchyControl[];
  /** Null if malformed/ambiguous structure prevents a single leaf inventory. */
  leafSums: FinancialHierarchyLeafSums | null;
  /** Data records only; header text and its citations are separately retained. */
  inventory: FinancialHierarchyInventoryRecord[];
  citations: FinancialHierarchyCitation[];
  inventoryState: {
    complete: boolean;
    reason: FinancialHierarchyIssueCode | null;
    recordsObserved: number;
  };
  issues: FinancialHierarchyIssue[];
}
export interface FinancialHierarchySource4Input {
  name: string;
  original: ArrayBuffer;
  /** Explicit trusted context, never inferred from the first source record. */
  expectedScope: FinancialHierarchyScope;
}
