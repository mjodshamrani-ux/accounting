import { MAX_ROWS, type SourceFile } from './types.ts';
import type { StockScope } from './inventory-register.ts';
import type { StockCellCitation } from './inventory-section-components.ts';

export const STOCK_MATRIX_FAMILY = 'inventory-transposed-register-1';
export const STOCK_MATRIX_FORMAT = 'INV1A-MATRIX-1';
export type StockMatrixFieldEvidence = {
  value: StockCellCitation;
  role: StockCellCitation;
};
export type StockMatrixBandEvidence = {
  header: StockCellCitation;
  columns: { column: number; key: StockCellCitation }[];
  completedRolesAtRow: number | null;
  boundary?: {
    kind: 'field' | 'report-total' | 'report-end';
    citation: StockCellCitation;
  };
  records: {
    recordId: string;
    column: number;
    anchor: StockCellCitation;
    axis: StockCellCitation;
    fields: Record<string, StockMatrixFieldEvidence>;
  }[];
};
export type StockMatrixEvidence = {
  family: typeof STOCK_MATRIX_FAMILY;
  source: 0;
  sheet: 0;
  sheetName: string;
  sourceHash: string;
  format: StockCellCitation;
  scope: Partial<
    Record<keyof Omit<StockScope, 'confirmed'>, StockCellCitation>
  >;
  reportTotal?: StockCellCitation;
  reportEnd?: StockCellCitation;
  bands: StockMatrixBandEvidence[];
};
export type StockMatrixRowKind =
  | 'format'
  | 'scope'
  | 'matrix-axis'
  | 'matrix-field'
  | 'control'
  | 'report-end'
  | 'blank'
  | 'error';
export type ParsedStockMatrix = {
  records: {
    row: number;
    column: number;
    band: number;
    raw: Record<string, string>;
    anchor: StockCellCitation;
    axis: StockCellCitation;
    fields: Record<string, StockMatrixFieldEvidence>;
  }[];
  inventory: { row: number; kind: StockMatrixRowKind }[];
  cells: { row: number; column: number; field: string; text: string }[];
  issues: { row: number; column?: number; code: string }[];
  memberRows: number[];
  evidence: Omit<StockMatrixEvidence, 'bands'> & {
    bands: Omit<StockMatrixBandEvidence, 'records'>[];
  };
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
const VALUES = [
  'Item ID',
  'Item dimensions',
  'Quantity',
  'Unit',
  'Quantity precision',
  'Posted value',
  'Valuation reference',
];
const IDENTITIES = [
  'Item ID',
  'Item dimensions',
  'Unit',
  'Valuation reference',
];

// Matrix rows do not bound the number of logical facts. Check active columns
// across every supplied axis before allocating logical records or citations.
export function assertInventoryMatrixLogicalBudget(
  file: SourceFile,
  budget = MAX_ROWS,
) {
  let count = 0;
  for (const row of file.sheets[0].rows) {
    if (row[0] !== 'Field') continue;
    for (let column = 1; column < row.length; column++)
      if (row[column] !== '') {
        count++;
        if (count > budget) throw Error('STOCK_LOGICAL_ROWS');
      }
  }
}

// Each logical record is an original column inside one explicit Field band.
// The role/value cell pair proves its meaning without manufacturing source rows.
export function parseInventoryTransposedRegister(
  file: SourceFile,
  scope: StockScope,
  decimals: number,
  numeric: (raw: string, precision: number) => number,
  budget = MAX_ROWS,
): ParsedStockMatrix {
  assertInventoryMatrixLogicalBudget(file, budget);
  const sheet = file.sheets[0];
  const cite = (row: number, column: number): StockCellCitation => ({
    sourceHash: file.sha256!,
    sheet: 0,
    sheetName: sheet.name,
    row,
    column,
    raw: sheet.rows[row - 1]?.[column - 1] ?? '',
  });
  const output: ParsedStockMatrix = {
    records: [],
    inventory: [],
    cells: [],
    issues: [],
    memberRows: [],
    evidence: {
      family: STOCK_MATRIX_FAMILY,
      source: 0,
      sheet: 0,
      sheetName: sheet.name,
      sourceHash: file.sha256!,
      format: cite(1, 2),
      scope: {},
      bands: [],
    },
  };
  const issueKeys = new Set<string>();
  const problem = (row: number, code: string, column?: number) => {
    const key = JSON.stringify([row, column, code]);
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    output.issues.push({
      row,
      ...(column === undefined ? {} : { column }),
      code,
    });
  };
  const literalIdentity = (row: number, column: number, max = 500) => {
    const coordinate = `${row}:${column}`;
    if (sheet.numericCells?.[coordinate])
      problem(row, 'NUMERIC_IDENTITY', column);
    if (sheet.referenceIssues?.[coordinate]?.length)
      problem(row, 'REFERENCE_DISPLAY', column);
    const value = sheet.rows[row - 1]?.[column - 1];
    if (
      typeof value !== 'string' ||
      !value ||
      value !== value.trim() ||
      value.length > max ||
      /[\p{Cc}\p{Cf}]/u.test(value) ||
      /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(value)
    )
      problem(row, 'IDENTITY', column);
  };
  const numericSafe = (
    raw: string,
    precision: number,
    row: number,
    column: number,
  ) => {
    try {
      return numeric(raw, precision);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('STOCK_'))
        throw error;
      problem(row, error.message.slice(6), column);
      return null;
    }
  };
  const populatedRow = (row: number) =>
    sheet.rows[row - 1]?.some((v) => v !== '') ?? false;
  const populatedCell = (key: string) => {
    const [row, column] = key.split(':').map(Number);
    const value = sheet.rows[row - 1]?.[column - 1];
    return value !== undefined && value !== '';
  };
  for (const row of sheet.hiddenRows)
    if (populatedRow(row)) problem(row, 'HIDDEN_SOURCE');
  for (const row of sheet.formulaRows) problem(row, 'FORMULA_SOURCE');
  for (const [row, issues] of Object.entries(sheet.rowIssues ?? {}))
    if (issues.length && populatedRow(Number(row)))
      problem(Number(row), 'SOURCE_DISPLAY');
  for (const [key, issues] of Object.entries(sheet.cellIssues ?? {}))
    if (issues.length && populatedCell(key)) {
      const [row, column] = key.split(':').map(Number);
      problem(row, 'SOURCE_DISPLAY', column);
    }
  for (const column of sheet.xlsxHeaders?.hiddenColumns ?? []) {
    const row = sheet.rows.findIndex(
      (r) => r[column - 1] !== undefined && r[column - 1] !== '',
    );
    if (row !== -1) problem(row + 1, 'HIDDEN_SOURCE', column);
  }
  if (sheet.xlsxHeaders?.merges.length) problem(1, 'MERGED_SOURCE');
  for (const key of Object.keys(sheet.formulaCells ?? {})) {
    const [row, column] = key.split(':').map(Number);
    problem(row, 'FORMULA_SOURCE', column);
  }
  const formulaMembers = new Set([
    ...sheet.formulaRows,
    ...Object.keys(sheet.formulaCells ?? {}).map((key) =>
      Number(key.split(':')[0]),
    ),
  ]);
  type Band = {
    evidenceIndex: number;
    columns: { column: number; key: StockCellCitation }[];
    roles: Map<string, number>;
  };
  let band: Band | null = null;
  let seenBand = false,
    ended = false,
    seenControl = false;
  const duplicateKeys = new Map<string, { row: number; column: number }[]>();
  const postedValues: bigint[] = [];
  const scopeComplete = (row: number) => {
    for (const [, key] of SCOPE_HEADERS)
      if (!output.evidence.scope[key]) problem(row, 'MISSING_SCOPE', 1);
  };
  const finishBand = (boundary?: StockMatrixBandEvidence['boundary']) => {
    if (!band) return;
    const current = band;
    const evidence = output.evidence.bands[current.evidenceIndex];
    if (boundary) evidence.boundary = boundary;
    const missing = VALUES.filter((role) => !current.roles.has(role));
    if (missing.length)
      problem(
        boundary?.citation.row ?? evidence.header.row,
        'MISSING_MATRIX_FIELD',
        1,
      );
    for (const axis of current.columns) {
      const column = axis.column;
      const identity = ['Item ID', 'Item dimensions'].map((role) => {
        const row = current.roles.get(role);
        return row === undefined
          ? ''
          : (sheet.rows[row - 1]?.[column - 1] ?? '');
      });
      const itemRow = current.roles.get('Item ID');
      if (itemRow !== undefined && identity.every(Boolean)) {
        const key = JSON.stringify(identity);
        const members = duplicateKeys.get(key) ?? [];
        members.push({ row: itemRow, column });
        duplicateKeys.set(key, members);
      }
      if (missing.length || itemRow === undefined) continue;
      // A named axis promises a fact. An empty or absent value is not zero and
      // does not acquire a fabricated value citation from rectangular padding.
      if (
        VALUES.some((role) => {
          const row = current.roles.get(role)!;
          return (
            sheet.rows[row - 1]?.[column - 1] === undefined ||
            sheet.rows[row - 1][column - 1] === ''
          );
        })
      )
        continue;
      const fields = Object.fromEntries(
        VALUES.map((role) => {
          const row = current.roles.get(role)!;
          return [role, { value: cite(row, column), role: cite(row, 1) }];
        }),
      );
      const value = fields['Posted value'].value;
      const money = numericSafe(value.raw, decimals, value.row, value.column);
      if (money !== null) postedValues.push(BigInt(money));
      output.records.push({
        row: itemRow,
        column,
        band: current.evidenceIndex,
        raw: Object.fromEntries(
          VALUES.map((role) => [role, fields[role].value.raw]),
        ),
        anchor: fields['Item ID'].value,
        axis: axis.key,
        fields,
      });
    }
    band = null;
  };
  sheet.rows.forEach((original, index) => {
    const row = index + 1;
    const raw = [...original];
    while (raw.length && raw.at(-1) === '') raw.pop();
    const label = raw[0] ?? '';
    const blank =
      !original.some((value) => value.trim()) && !formulaMembers.has(row);
    const kind: StockMatrixRowKind = blank
      ? 'blank'
      : index === 0
        ? 'format'
        : label === 'Scope'
          ? 'scope'
          : label === 'Field'
            ? 'matrix-axis'
            : VALUES.includes(label)
              ? 'matrix-field'
              : label === 'Report total'
                ? 'control'
                : label === 'End report'
                  ? 'report-end'
                  : 'error';
    output.inventory.push({ row, kind });
    original.forEach((value, column) =>
      output.cells.push({
        row,
        column: column + 1,
        field: label === 'Scope' ? (raw[1] ?? '') : label,
        text: value,
      }),
    );
    if (index > 0 && !blank) output.memberRows.push(row);
    if (index === 0) {
      if (
        raw.length !== 2 ||
        raw[0] !== 'Format' ||
        raw[1] !== STOCK_MATRIX_FORMAT
      )
        problem(row, 'FORMAT', 2);
      literalIdentity(row, 1);
      literalIdentity(row, 2);
      return;
    }
    if (blank) return;
    if (ended) {
      problem(row, 'TRAILING_ROW', 1);
      return;
    }
    literalIdentity(row, 1);
    if (label === 'Scope') {
      if (seenBand || seenControl) {
        problem(row, 'SCOPE_CONFLICT', 1);
        return;
      }
      const entry = SCOPE_HEADERS.find(([header]) => header === raw[1]);
      if (raw.length !== 3 || !entry) {
        problem(row, 'SCOPE_FIELD', 2);
        return;
      }
      literalIdentity(row, 2);
      literalIdentity(row, 3);
      const key = entry[1];
      if (output.evidence.scope[key]) {
        problem(row, 'DUPLICATE_SCOPE', 2);
        return;
      }
      output.evidence.scope[key] = cite(row, 3);
      if (raw[2] !== scope[key]) problem(row, 'SCOPE_CONFLICT', 3);
      return;
    }
    if (label === 'Field') {
      scopeComplete(row);
      finishBand({ kind: 'field', citation: cite(row, 1) });
      if (seenControl) problem(row, 'MATRIX_BOUNDARY', 1);
      const columns: Band['columns'] = [];
      const keys = new Map<string, number[]>();
      for (let column = 2; column <= raw.length; column++) {
        if (raw[column - 1] === '') continue;
        literalIdentity(row, column);
        const key = raw[column - 1];
        const values = keys.get(key) ?? [];
        values.push(column);
        keys.set(key, values);
        columns.push({ column, key: cite(row, column) });
      }
      for (const values of keys.values())
        if (values.length > 1)
          for (const column of values)
            problem(row, 'DUPLICATE_MATRIX_AXIS', column);
      if (!columns.length) problem(row, 'MISSING_MATRIX_AXIS', 1);
      const evidenceIndex = output.evidence.bands.length;
      output.evidence.bands.push({
        header: cite(row, 1),
        columns,
        completedRolesAtRow: null,
      });
      band = { evidenceIndex, columns, roles: new Map() };
      seenBand = true;
      return;
    }
    if (label === 'Report total') {
      finishBand({ kind: 'report-total', citation: cite(row, 1) });
      if (!seenBand || raw.length !== 2) {
        problem(row, 'CONTROL_BOUNDARY', 1);
        return;
      }
      if (seenControl) {
        problem(row, 'DUPLICATE_CONTROL', 2);
        return;
      }
      seenControl = true;
      output.evidence.reportTotal = cite(row, 2);
      return;
    }
    if (label === 'End report') {
      scopeComplete(row);
      finishBand({ kind: 'report-end', citation: cite(row, 1) });
      if (raw.length !== 1) problem(row, 'REPORT_BOUNDARY', 1);
      if (!seenBand) problem(row, 'MISSING_MATRIX_AXIS', 1);
      output.evidence.reportEnd = cite(row, 1);
      ended = true;
      return;
    }
    if (!band || !VALUES.includes(label)) {
      problem(
        row,
        VALUES.includes(label) ? 'ORPHAN_MATRIX_FIELD' : 'UNKNOWN_ROW',
        1,
      );
      return;
    }
    if (band.roles.has(label)) {
      problem(row, 'DUPLICATE_MATRIX_FIELD', 1);
      return;
    }
    band.roles.set(label, row);
    if (band.roles.size === VALUES.length)
      output.evidence.bands[band.evidenceIndex].completedRolesAtRow = row;
    const active = new Set(band.columns.map((axis) => axis.column));
    for (const axis of band.columns) {
      const value = original[axis.column - 1];
      if (value === undefined || value === '')
        problem(row, 'MISSING_MATRIX_VALUE', axis.column);
      else if (IDENTITIES.includes(label))
        literalIdentity(
          row,
          axis.column,
          label === 'Valuation reference' ? 2000 : 500,
        );
    }
    for (let column = 2; column <= raw.length; column++)
      if (!active.has(column) && raw[column - 1] !== '')
        problem(row, 'ORPHAN_MATRIX_COLUMN', column);
  });
  finishBand();
  if (!ended) problem(Math.max(1, sheet.rows.length), 'MISSING_END_REPORT', 1);
  if (output.evidence.reportTotal) {
    const control = output.evidence.reportTotal;
    const amount = numericSafe(
      control.raw,
      decimals,
      control.row,
      control.column,
    );
    if (
      amount !== null &&
      postedValues.reduce((sum, value) => sum + value, 0n) !== BigInt(amount)
    )
      problem(control.row, 'CONTROL_MISMATCH', control.column);
  }
  for (const members of duplicateKeys.values())
    if (members.length > 1)
      for (const member of members)
        problem(member.row, 'DUPLICATE', member.column);
  return output;
}
