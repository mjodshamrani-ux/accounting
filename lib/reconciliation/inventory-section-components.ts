import type { SourceFile } from './types.ts';
import type { StockScope } from './inventory-register.ts';

export const STOCK_SECTION_FAMILY = 'inventory-section-components-1';
export const STOCK_SECTION_FORMAT = 'INV1A-SECTIONS-1';
export type StockCellCitation = {
  sourceHash: string;
  sheet: number;
  sheetName: string;
  row: number;
  column: number;
  raw: string;
};
export type StockSectionEvidence = {
  family: typeof STOCK_SECTION_FAMILY;
  source: 0;
  sheet: 0;
  sheetName: string;
  sourceHash: string;
  format: StockCellCitation;
  reportTotal?: StockCellCitation;
  scope: Partial<
    Record<keyof Omit<StockScope, 'confirmed'>, StockCellCitation>
  >;
  sections: {
    recordId: string;
    startRow: number;
    endRow: number;
    fields: Record<string, StockCellCitation>;
    subtotal?: StockCellCitation;
    boundaries: { start: StockCellCitation; end: StockCellCitation };
  }[];
};
export type StockSectionRowKind =
  | 'format'
  | 'scope'
  | 'section-start'
  | 'section-field'
  | 'component'
  | 'control'
  | 'section-end'
  | 'report-end'
  | 'detail-header'
  | 'blank'
  | 'error';
export type ParsedStockSections = {
  records: {
    row: number;
    endRow: number;
    raw: Record<string, string>;
    fields: Record<string, StockCellCitation>;
    subtotal?: StockCellCitation;
  }[];
  inventory: { row: number; kind: StockSectionRowKind }[];
  cells: { row: number; column: number; field: string; text: string }[];
  issues: { row: number; code: string }[];
  memberRows: number[];
  scope: StockSectionEvidence['scope'];
  format: StockCellCitation;
  reportTotal?: StockCellCitation;
};
const SCOPE_HEADERS = [
  ['Entity', 'entity'],
  ['Inventory ledger', 'inventoryLedger'],
  ['GL ledger', 'glLedger'],
  ['Currency', 'currency'],
  ['Currency basis', 'currencyBasis'],
  ['Posting status', 'postingStatus'],
  ['Posting layer', 'postingLayer'],
  ['As of', 'asOf'],
  ['Chart version', 'chartVersion'],
  ['Map version', 'mapVersion'],
  ['Valuation policy version', 'valuationPolicyVersion'],
  ['Inventory account set version', 'inventoryAccountSetVersion'],
] as const;
const IDENTITIES = [
  'Item ID',
  'Item dimensions',
  'Unit',
  'Quantity precision',
  'Valuation reference',
];
const COMPONENTS = ['Quantity', 'Posted value'];
const VALUES = [
  'Item ID',
  'Item dimensions',
  'Quantity',
  'Unit',
  'Quantity precision',
  'Posted value',
  'Valuation reference',
];

// A logical record is a view of one explicitly bounded original section.
// This never manufactures a horizontal source row or replacement CSV bytes.
export function parseInventorySectionComponents(
  file: SourceFile,
  scope: StockScope,
  decimals: number,
  numeric: (raw: string, precision: number) => number,
): ParsedStockSections {
  const sheet = file.sheets[0];
  const cite = (row: number, column: number): StockCellCitation => ({
    sourceHash: file.sha256!,
    sheet: 0,
    sheetName: sheet.name,
    row,
    column,
    raw: sheet.rows[row - 1]?.[column - 1] ?? '',
  });
  const output: ParsedStockSections = {
    records: [],
    inventory: [],
    cells: [],
    issues: [],
    memberRows: [],
    scope: {},
    format: cite(1, 2),
  };
  const issueKeys = new Set<string>();
  const problem = (row: number, code: string) => {
    const key = JSON.stringify([row, code]);
    if (!issueKeys.has(key)) {
      output.issues.push({ row, code });
      issueKeys.add(key);
    }
  };
  const numericSafe = (raw: string, precision: number, row: number) => {
    try {
      return numeric(raw, precision);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('STOCK_')) throw e;
      problem(row, e.message.slice(6));
      return null;
    }
  };
  const literalIdentity = (row: number, column: number) => {
    const key = `${row}:${column}`;
    if (sheet.numericCells?.[key]) problem(row, 'NUMERIC_IDENTITY');
    if (sheet.referenceIssues?.[key]?.length) problem(row, 'REFERENCE_DISPLAY');
  };
  let section: {
    startRow: number;
    fields: Record<string, StockCellCitation>;
    componentPhase: boolean;
    detailHeader: boolean;
    subtotal: { raw: string; row: number } | null;
  } | null = null;
  let seenSection = false,
    ended = false,
    reportTotal: { raw: string; row: number } | null = null;
  const duplicateKeys = new Map<string, number[]>();
  const completedValues: bigint[] = [];
  const formulaMemberRows = new Set([
    ...sheet.formulaRows,
    ...Object.keys(sheet.formulaCells ?? {}).map((key) =>
      Number(key.split(':')[0]),
    ),
  ]);
  const scopeComplete = (row: number) => {
    for (const [, key] of SCOPE_HEADERS)
      if (!output.scope[key]) problem(row, 'MISSING_SCOPE');
  };
  const finishSection = (endRow: number, explicitEnd: boolean) => {
    if (!section) return;
    const current = section;
    if (!explicitEnd) problem(endRow, 'MISSING_END_SECTION');
    for (const field of IDENTITIES)
      if (!current.fields[field]) problem(endRow, 'MISSING_SECTION_FIELD');
    for (const field of COMPONENTS)
      if (!current.fields[field]) problem(endRow, 'MISSING_COMPONENT');
    const identity = ['Item ID', 'Item dimensions'].map(
      (k) => current.fields[k]?.raw ?? '',
    );
    if (identity.every(Boolean)) {
      const key = JSON.stringify(identity);
      const rows = duplicateKeys.get(key) ?? [];
      rows.push(current.startRow);
      duplicateKeys.set(key, rows);
    }
    if (VALUES.every((k) => current.fields[k]) && explicitEnd) {
      const value = current.fields['Posted value'];
      const money = numericSafe(value.raw, decimals, value.row);
      if (money !== null) completedValues.push(BigInt(money));
      if (current.subtotal) {
        const control = numericSafe(
          current.subtotal.raw,
          decimals,
          current.subtotal.row,
        );
        if (money !== null && control !== null && money !== control)
          problem(current.subtotal.row, 'CONTROL_MISMATCH');
      }
      output.records.push({
        row: current.startRow,
        endRow,
        raw: Object.fromEntries(VALUES.map((k) => [k, current.fields[k].raw])),
        fields: current.fields,
        ...(current.subtotal
          ? { subtotal: cite(current.subtotal.row, 2) }
          : {}),
      });
    }
    section = null;
  };
  const populatedRow = (row: number) =>
    sheet.rows[row - 1]?.some((value) => value !== '') ?? false;
  const populatedCell = (coordinate: string) => {
    const [row, column] = coordinate.split(':').map(Number);
    const value = sheet.rows[row - 1]?.[column - 1];
    return value !== undefined && value !== '';
  };
  if (sheet.hiddenRows.length)
    for (const row of sheet.hiddenRows)
      if (populatedRow(row)) problem(row, 'HIDDEN_SOURCE');
  if (sheet.formulaRows.length)
    for (const row of sheet.formulaRows) problem(row, 'FORMULA_SOURCE');
  for (const [row, issues] of Object.entries(sheet.rowIssues ?? {}))
    if (issues.length && populatedRow(Number(row)))
      problem(Number(row), 'SOURCE_DISPLAY');
  for (const [key, issues] of Object.entries(sheet.cellIssues ?? {}))
    if (issues.length && populatedCell(key))
      problem(Number(key.split(':')[0]), 'SOURCE_DISPLAY');
  if (
    sheet.xlsxHeaders?.hiddenColumns.some((column) =>
      sheet.rows.some(
        (row) => row[column - 1] !== undefined && row[column - 1] !== '',
      ),
    )
  )
    problem(1, 'HIDDEN_SOURCE');
  if (sheet.xlsxHeaders?.merges.length) problem(1, 'MERGED_SOURCE');
  if (sheet.formulaCells && Object.keys(sheet.formulaCells).length)
    problem(1, 'FORMULA_SOURCE');
  sheet.rows.forEach((original, index) => {
    const row = index + 1;
    const raw = [...original];
    while (raw.length && raw.at(-1) === '') raw.pop();
    const label = raw[0] ?? '';
    let kind: StockSectionRowKind = 'error';
    const field = label === 'Scope' ? (raw[1] ?? '') : label;
    if (
      index > 0 &&
      (original.some((v) => v.trim()) || formulaMemberRows.has(row))
    )
      output.memberRows.push(row);
    if (!original.some((v) => v.trim()) && !formulaMemberRows.has(row))
      kind = 'blank';
    else if (index === 0) kind = 'format';
    else if (label === 'Scope') kind = 'scope';
    else if (label === 'Section') kind = 'section-start';
    else if (IDENTITIES.includes(label)) kind = 'section-field';
    else if (COMPONENTS.includes(label)) kind = 'component';
    else if (label === 'Component') kind = 'detail-header';
    else if (label === 'Section subtotal' || label === 'Report total')
      kind = 'control';
    else if (label === 'End section') kind = 'section-end';
    else if (label === 'End report') kind = 'report-end';
    output.inventory.push({ row, kind });
    original.forEach((value, column) =>
      output.cells.push({ row, column: column + 1, field, text: value }),
    );
    if (index === 0) {
      if (
        raw.length !== 2 ||
        raw[0] !== 'Format' ||
        raw[1] !== STOCK_SECTION_FORMAT
      )
        problem(row, 'FORMAT');
      literalIdentity(row, 1);
      literalIdentity(row, 2);
      return;
    }
    if (kind === 'blank') return;
    if (ended) {
      problem(row, 'TRAILING_ROW');
      return;
    }
    literalIdentity(row, 1);
    if (label === 'Scope') {
      if (seenSection || reportTotal) {
        problem(row, 'SCOPE_CONFLICT');
        return;
      }
      const entry = SCOPE_HEADERS.find(([header]) => header === raw[1]);
      if (raw.length !== 3 || !entry) {
        problem(row, 'SCOPE_FIELD');
        return;
      }
      literalIdentity(row, 2);
      literalIdentity(row, 3);
      const key = entry[1];
      if (output.scope[key]) {
        problem(row, 'DUPLICATE_SCOPE');
        return;
      }
      output.scope[key] = cite(row, 3);
      if (raw[2] !== scope[key]) problem(row, 'SCOPE_CONFLICT');
      return;
    }
    if (label === 'Section') {
      scopeComplete(row);
      if (section) finishSection(row, false);
      if (raw.length !== 1 || reportTotal) problem(row, 'SECTION_BOUNDARY');
      section = {
        startRow: row,
        fields: {},
        componentPhase: false,
        detailHeader: false,
        subtotal: null,
      };
      seenSection = true;
      return;
    }
    if (label === 'End section') {
      if (raw.length !== 1) problem(row, 'SECTION_BOUNDARY');
      if (!section) problem(row, 'ORPHAN_BOUNDARY');
      else finishSection(row, true);
      return;
    }
    if (label === 'End report') {
      scopeComplete(row);
      if (raw.length !== 1) problem(row, 'REPORT_BOUNDARY');
      if (section) finishSection(row, false);
      if (!seenSection) problem(row, 'MISSING_SECTION');
      ended = true;
      return;
    }
    if (label === 'Report total') {
      if (section || !seenSection || raw.length !== 2) {
        problem(row, 'CONTROL_BOUNDARY');
        return;
      }
      if (reportTotal) {
        problem(row, 'DUPLICATE_CONTROL');
        return;
      }
      reportTotal = { raw: raw[1], row };
      output.reportTotal = cite(row, 2);
      return;
    }
    if (!section) {
      problem(
        row,
        COMPONENTS.includes(label) ? 'ORPHAN_COMPONENT' : 'UNKNOWN_ROW',
      );
      return;
    }
    if (IDENTITIES.includes(label)) {
      if (section.componentPhase || section.subtotal)
        problem(row, 'LATE_SECTION_FIELD');
      if (raw.length !== 2) {
        problem(row, 'SECTION_FIELD');
        return;
      }
      if (section.fields[label]) {
        problem(row, 'DUPLICATE_SECTION_FIELD');
        return;
      }
      if (label !== 'Quantity precision') literalIdentity(row, 2);
      section.fields[label] = cite(row, 2);
      return;
    }
    if (label === 'Component') {
      if (raw.length !== 2 || raw[1] !== 'Value' || section.subtotal)
        problem(row, 'COMPONENT_HEADER');
      literalIdentity(row, 2);
      for (const key of IDENTITIES)
        if (!section.fields[key]) problem(row, 'MISSING_SECTION_FIELD');
      section.componentPhase = true;
      section.detailHeader = true;
      return;
    }
    if (COMPONENTS.includes(label)) {
      if (!section.detailHeader || section.subtotal)
        problem(row, 'COMPONENT_BOUNDARY');
      for (const key of IDENTITIES)
        if (!section.fields[key]) problem(row, 'MISSING_SECTION_FIELD');
      section.componentPhase = true;
      if (raw.length !== 2) {
        problem(row, 'COMPONENT_FIELD');
        return;
      }
      if (section.fields[label]) {
        problem(row, 'DUPLICATE_COMPONENT');
        return;
      }
      section.fields[label] = cite(row, 2);
      return;
    }
    if (label === 'Section subtotal') {
      if (raw.length !== 2 || !COMPONENTS.every((k) => section!.fields[k])) {
        problem(row, 'CONTROL_BOUNDARY');
        return;
      }
      if (section.subtotal) {
        problem(row, 'DUPLICATE_CONTROL');
        return;
      }
      section.subtotal = { raw: raw[1], row };
      return;
    }
    problem(row, 'UNKNOWN_ROW');
  });
  if (section) finishSection(Math.max(1, sheet.rows.length), false);
  if (!ended) problem(Math.max(1, sheet.rows.length), 'MISSING_END_REPORT');
  const finalReportTotal = output.reportTotal;
  if (finalReportTotal) {
    const control = numericSafe(
      finalReportTotal.raw,
      decimals,
      finalReportTotal.row,
    );
    const sum = completedValues.reduce((a, b) => a + b, 0n);
    if (control !== null && sum !== BigInt(control))
      problem(finalReportTotal.row, 'CONTROL_MISMATCH');
  }
  for (const rows of duplicateKeys.values())
    if (rows.length > 1) for (const row of rows) problem(row, 'DUPLICATE');
  return output;
}
