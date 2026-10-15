import { MAX_ROWS, type SourceFile } from './types.ts';
import type { StockScope } from './inventory-register.ts';
import type { StockCellCitation } from './inventory-section-components.ts';
import {
  HIERARCHY_FIELDS,
  STOCK_HIERARCHY_TITLE,
  inventoryHierarchyScope,
} from './inventory-hierarchy-sections.ts';
import { assertInventoryMatrixLogicalBudget } from './inventory-transposed-register.ts';

export const STOCK_COLUMN_FAMILY = 'inventory-column-hierarchy-1';
export function isInventoryColumnHierarchy(file: SourceFile) {
  const rows = file.sheets[0]?.rows ?? [];
  if (rows[0]?.[0] !== STOCK_HIERARCHY_TITLE) return false;
  const first = rows.findIndex((r) => ['Warehouse', 'Plant'].includes(r[0]));
  if (first < 0) return false;
  const next = rows.slice(first + 1).filter((r) => r.some((v) => v !== ''));
  return next[0]?.[0] === 'Batch' && next[1]?.[0] === 'Field';
}
export const inventoryColumnScope = (file: SourceFile) =>
  isInventoryColumnHierarchy(file) ? inventoryHierarchyScope(file) : null;
export type ColumnMerge = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  text: string;
};
export type ColumnRecordEvidence = {
  recordId: string;
  row: number;
  column: number;
  derivedDimensions: string;
  axis: StockCellCitation;
  parent: {
    label: StockCellCitation;
    value: StockCellCitation;
    merge?: ColumnMerge;
  };
  batch: { label: StockCellCitation; value: StockCellCitation };
  panelEnd: StockCellCitation;
  fields: Record<string, { role: StockCellCitation; value: StockCellCitation }>;
};
export type StockColumnEvidence = {
  family: typeof STOCK_COLUMN_FAMILY;
  source: 0;
  sourceHash: string;
  sheet: 0;
  sheetName: string;
  title: StockCellCitation;
  scope: Partial<
    Record<keyof Omit<StockScope, 'confirmed'>, StockCellCitation>
  >;
  reportTotal?: StockCellCitation;
  reportEnd?: StockCellCitation;
  records: ColumnRecordEvidence[];
};
export type ColumnRowKind =
  | 'format'
  | 'scope'
  | 'column-parent'
  | 'column-batch'
  | 'matrix-axis'
  | 'matrix-field'
  | 'column-end'
  | 'control'
  | 'report-end'
  | 'blank'
  | 'error';
const labels = [
  'Entity',
  'Inventory ledger',
  'GL ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'As of',
  'Chart version',
  'Map version',
  'Valuation policy version',
  'Inventory account set version',
];
const keys = [
  'entity',
  'inventoryLedger',
  'glLedger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'asOf',
  'chartVersion',
  'mapVersion',
  'valuationPolicyVersion',
  'inventoryAccountSetVersion',
] as const;

// Logical records are original columns. No normalized file or synthetic source
// row is substituted for their physical role/value/parent/batch citations.
export function parseInventoryColumnHierarchy(
  file: SourceFile,
  scope: StockScope,
  decimals: number,
  numeric: (raw: string, precision: number) => number,
  budget = MAX_ROWS,
) {
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
  const issues: { row: number; column?: number; code: string }[] = [],
    seenIssues = new Set<string>();
  const problem = (row: number, code: string, column?: number) => {
    const k = JSON.stringify([row, column, code]);
    if (!seenIssues.has(k)) {
      seenIssues.add(k);
      issues.push({ row, ...(column === undefined ? {} : { column }), code });
    }
  };
  const literal = (row: number, column: number, dimension = false) => {
    const value = cite(row, column).raw;
    if (
      !value ||
      value !== value.trim() ||
      /[\p{Cc}\p{Cf}]/u.test(value) ||
      /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(value)
    )
      problem(row, 'IDENTITY', column);
    if (dimension && /[;=]/.test(value))
      problem(row, 'HIERARCHY_DIMENSION', column);
    if (sheet.numericCells?.[`${row}:${column}`])
      problem(row, 'NUMERIC_IDENTITY', column);
    if (sheet.referenceIssues?.[`${row}:${column}`]?.length)
      problem(row, 'REFERENCE_DISPLAY', column);
    return value;
  };
  const populated = (r: number) => sheet.rows[r - 1]?.some((v) => v !== '');
  for (const r of sheet.hiddenRows)
    if (populated(r)) problem(r, 'HIDDEN_SOURCE');
  for (const r of sheet.formulaRows) problem(r, 'FORMULA_SOURCE');
  for (const k of Object.keys(sheet.formulaCells ?? {})) {
    const [r, c] = k.split(':').map(Number);
    problem(r, 'FORMULA_SOURCE', c);
  }
  for (const [r, warnings] of Object.entries(sheet.rowIssues ?? {}))
    if (warnings.length && populated(Number(r)))
      problem(Number(r), 'SOURCE_DISPLAY');
  for (const [k, warnings] of Object.entries(sheet.cellIssues ?? {})) {
    const [r, c] = k.split(':').map(Number);
    if (warnings.length && cite(r, c).raw !== '')
      problem(r, 'SOURCE_DISPLAY', c);
  }
  for (const c of sheet.xlsxHeaders?.hiddenColumns ?? [])
    if (sheet.rows.some((r) => r[c - 1] !== undefined && r[c - 1] !== ''))
      problem(1, 'HIDDEN_SOURCE', c);
  const owners = new Map<string, ColumnMerge>();
  for (const m of sheet.xlsxHeaders?.merges ?? []) {
    if (
      m.top !== m.bottom ||
      m.left < 2 ||
      m.right <= m.left ||
      m.right > 100 ||
      !['Plant', 'Warehouse'].includes(cite(m.top, 1).raw)
    ) {
      problem(m.top, 'COLUMN_MERGE', m.left);
      continue;
    }
    for (let c = m.left; c <= m.right; c++) {
      const key = `${m.top}:${c}`;
      if (owners.has(key)) problem(m.top, 'COLUMN_MERGE', c);
      owners.set(key, m);
      if (c > m.left && cite(m.top, c).raw !== '')
        problem(m.top, 'COLUMN_MERGE', c);
    }
    if (cite(m.top, m.left).raw !== m.text)
      problem(m.top, 'COLUMN_MERGE', m.left);
  }
  const evidence: StockColumnEvidence = {
    family: STOCK_COLUMN_FAMILY,
    source: 0,
    sourceHash: file.sha256!,
    sheet: 0,
    sheetName: sheet.name,
    title: cite(1, 1),
    scope: {},
    records: [],
  };
  const records: {
    row: number;
    column: number;
    raw: Record<string, string>;
    evidence: ColumnRecordEvidence;
  }[] = [];
  const inventory: { row: number; kind: ColumnRowKind }[] = [],
    cells: { row: number; column: number; field: string; text: string }[] = [],
    memberRows: number[] = [];
  type Panel = {
    parent: number;
    batch: number | null;
    axis: number | null;
    roles: Map<string, number>;
  };
  let panel: Panel | null = null,
    parentKind = '',
    ended = false,
    controlled = false;
  const duplicates = new Map<string, { row: number; column: number }[]>();
  let providedSum = 0n;
  const safeNumber = (c: StockCellCitation) => {
    try {
      return numeric(c.raw, decimals);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('STOCK_')) throw e;
      problem(c.row, e.message.slice(6), c.column);
      return null;
    }
  };
  const completeScope = (row: number) => {
    for (const k of keys) if (!evidence.scope[k]) problem(row, 'MISSING_SCOPE');
  };
  const finish = (end: number) => {
    if (!panel) {
      problem(end, 'COLUMN_PANEL');
      return;
    }
    const p = panel;
    panel = null;
    if (!p.batch || !p.axis || HIERARCHY_FIELDS.some((r) => !p.roles.has(r))) {
      problem(end, 'COLUMN_PANEL');
      return;
    }
    const batchRow = p.batch,
      axisRow = p.axis;
    const columns = sheet.rows[axisRow - 1].flatMap((v, c) =>
        c > 0 && v !== '' ? [c + 1] : [],
      ),
      active = new Set(columns),
      axes = new Set<string>();
    if (!columns.length) problem(axisRow, 'MISSING_MATRIX_AXIS');
    const involved = [p.parent, batchRow, axisRow, ...p.roles.values()];
    const width = Math.max(...involved.map((r) => sheet.rows[r - 1].length));
    for (let c = 2; c <= width; c++) {
      const owner = owners.get(`${p.parent}:${c}`);
      if (
        !active.has(c) &&
        (owner || involved.some((r) => cite(r, c).raw !== ''))
      )
        problem(p.parent, 'ORPHAN_MATRIX_COLUMN', c);
    }
    for (const c of columns) {
      const axis = cite(axisRow, c),
        merge = owners.get(`${p.parent}:${c}`),
        anchor = merge?.left ?? c;
      const parent = literal(p.parent, anchor, true),
        batch = literal(batchRow, c, true);
      literal(axisRow, c);
      if (axes.has(axis.raw)) problem(axisRow, 'DUPLICATE_MATRIX_AXIS', c);
      axes.add(axis.raw);
      const dims = `${cite(p.parent, 1).raw.toLowerCase()}=${parent};batch=${batch}`;
      const fields = Object.fromEntries(
        [...p.roles].map(([k, r]) => [
          k,
          { role: cite(r, 1), value: cite(r, c) },
        ]),
      );
      for (const [k, pair] of Object.entries(fields)) {
        if (!pair.value.raw) problem(pair.value.row, 'MISSING_MATRIX_VALUE', c);
        else if (
          [
            'Item ID',
            'Unit',
            'Valuation reference',
            'Item dimensions',
          ].includes(k)
        )
          literal(pair.value.row, c);
      }
      if (
        fields['Item dimensions'] &&
        fields['Item dimensions'].value.raw !== dims
      )
        problem(fields['Item dimensions'].value.row, 'HIERARCHY_DIMENSION', c);
      const item = fields['Item ID'].value;
      const key = JSON.stringify([item.raw, dims]),
        prior = duplicates.get(key) ?? [];
      prior.push({ row: item.row, column: c });
      duplicates.set(key, prior);
      if (Object.values(fields).some((f) => !f.value.raw)) continue;
      const amount = safeNumber(fields['Posted value'].value);
      if (amount !== null) providedSum += BigInt(amount);
      const e: ColumnRecordEvidence = {
        recordId: '',
        row: item.row,
        column: c,
        derivedDimensions: dims,
        axis,
        parent: {
          label: cite(p.parent, 1),
          value: cite(p.parent, anchor),
          ...(merge ? { merge: { ...merge } } : {}),
        },
        batch: { label: cite(batchRow, 1), value: cite(batchRow, c) },
        panelEnd: cite(end, 1),
        fields,
      };
      records.push({
        row: item.row,
        column: c,
        raw: {
          ...Object.fromEntries(
            Object.entries(fields).map(([k, f]) => [k, f.value.raw]),
          ),
          'Item dimensions': dims,
        },
        evidence: e,
      });
      evidence.records.push(e);
    }
  };
  sheet.rows.forEach((original, i) => {
    const row = i + 1,
      raw = [...original];
    while (raw.at(-1) === '') raw.pop();
    const label = raw[0] ?? '',
      blank = !raw.length;
    const kind: ColumnRowKind = blank
      ? 'blank'
      : i === 0
        ? 'format'
        : labels.includes(label)
          ? 'scope'
          : ['Plant', 'Warehouse'].includes(label)
            ? 'column-parent'
            : label === 'Batch'
              ? 'column-batch'
              : label === 'Field'
                ? 'matrix-axis'
                : [...HIERARCHY_FIELDS, 'Item dimensions'].includes(label)
                  ? 'matrix-field'
                  : label === 'End panel'
                    ? 'column-end'
                    : label === 'Report total'
                      ? 'control'
                      : label === 'End report'
                        ? 'report-end'
                        : 'error';
    inventory.push({ row, kind });
    original.forEach((text, c) =>
      cells.push({ row, column: c + 1, field: label, text }),
    );
    if (i > 0 && !blank) memberRows.push(row);
    if (i === 0) {
      if (raw.length !== 1 || label !== STOCK_HIERARCHY_TITLE)
        problem(row, 'FORMAT');
      return;
    }
    if (blank) return;
    literal(row, 1);
    if (ended) {
      problem(row, 'TRAILING_ROW');
      return;
    }
    if (labels.includes(label)) {
      const k = keys[labels.indexOf(label)];
      if (parentKind || raw.length !== 2 || evidence.scope[k])
        problem(row, 'SCOPE_CONFLICT');
      else {
        evidence.scope[k] = cite(row, 2);
        literal(row, 2);
        if (raw[1] !== scope[k]) problem(row, 'SCOPE_CONFLICT', 2);
      }
    } else if (['Plant', 'Warehouse'].includes(label)) {
      completeScope(row);
      if (panel || controlled || (parentKind && parentKind !== label))
        problem(row, 'COLUMN_PANEL');
      parentKind ||= label;
      panel = { parent: row, batch: null, axis: null, roles: new Map() };
    } else if (label === 'Batch') {
      if (!panel || panel.batch || panel.axis) problem(row, 'COLUMN_PANEL');
      else panel.batch = row;
    } else if (label === 'Field') {
      if (!panel || !panel.batch || panel.axis) problem(row, 'COLUMN_PANEL');
      else panel.axis = row;
    } else if ([...HIERARCHY_FIELDS, 'Item dimensions'].includes(label)) {
      if (!panel || !panel.axis) problem(row, 'ORPHAN_MATRIX_FIELD');
      else if (panel.roles.has(label)) problem(row, 'DUPLICATE_MATRIX_FIELD');
      else panel.roles.set(label, row);
    } else if (label === 'End panel') {
      if (raw.length !== 1) problem(row, 'COLUMN_PANEL');
      finish(row);
    } else if (label === 'Report total') {
      if (panel || controlled || raw.length !== 2)
        problem(row, 'CONTROL_BOUNDARY');
      controlled = true;
      evidence.reportTotal = cite(row, 2);
    } else if (label === 'End report') {
      completeScope(row);
      if (panel || raw.length !== 1) problem(row, 'COLUMN_PANEL');
      ended = true;
      evidence.reportEnd = cite(row, 1);
    } else {
      problem(row, 'UNKNOWN_ROW');
      panel = null;
    }
  });
  if (!ended) problem(Math.max(1, sheet.rows.length), 'MISSING_END_REPORT');
  if (panel) problem(Math.max(1, sheet.rows.length), 'COLUMN_PANEL');
  if (evidence.reportTotal) {
    const value = safeNumber(evidence.reportTotal);
    if (value !== null && BigInt(value) !== providedSum)
      problem(evidence.reportTotal.row, 'CONTROL_MISMATCH', 2);
  }
  for (const group of duplicates.values())
    if (group.length > 1)
      for (const c of group) problem(c.row, 'DUPLICATE', c.column);
  if (!records.length) problem(1, 'MISSING_SECTION');
  return { records, evidence, inventory, cells, memberRows, issues };
}
