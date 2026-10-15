import type { SourceFile } from './types.ts';
import type { StockScope } from './inventory-register.ts';
import type { StockCellCitation } from './inventory-section-components.ts';

export const STOCK_HIERARCHY_FAMILY = 'inventory-hierarchy-sections-1';
export const STOCK_HIERARCHY_TITLE = 'Inventory carrying-value register';
export const HIERARCHY_FIELDS = [
  'Item ID',
  'Quantity',
  'Unit',
  'Quantity precision',
  'Posted value',
  'Valuation reference',
];
const scopeFields = [
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
const scopeLabels = [
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
export function isInventoryHierarchy(file: SourceFile) {
  return file.sheets[0]?.rows[0]?.[0] === STOCK_HIERARCHY_TITLE;
}
export function inventoryHierarchyScope(
  file: SourceFile,
): Partial<StockScope> | null {
  if (!isInventoryHierarchy(file)) return null;
  const found: Partial<StockScope> = {};
  for (const original of file.sheets[0].rows.slice(1)) {
    const row = [...original];
    while (row.at(-1) === '') row.pop();
    if (!row.length) continue;
    if (['Plant', 'Warehouse'].includes(row[0])) break;
    const index = scopeLabels.indexOf(row[0]);
    if (
      index < 0 ||
      row.length !== 2 ||
      !row[1] ||
      row[1] !== row[1].trim() ||
      found[scopeFields[index]] !== undefined
    )
      return null;
    found[scopeFields[index]] = row[1];
  }
  return scopeFields.every((k) => typeof found[k] === 'string') ? found : null;
}
type Merge = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  text: string;
};
export type HierarchyDimension = {
  key: string;
  label: StockCellCitation;
  value: StockCellCitation;
  merge?: Merge;
};
export type HierarchyRecordEvidence = {
  recordId: string;
  row: number;
  derivedDimensions: string;
  fields: Record<string, StockCellCitation>;
  headers: Record<string, StockCellCitation>;
  parent: HierarchyDimension;
  batch: HierarchyDimension;
  parentEnd: StockCellCitation | null;
  batchEnd: StockCellCitation | null;
};
export type StockHierarchyEvidence = {
  family: typeof STOCK_HIERARCHY_FAMILY;
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
  records: HierarchyRecordEvidence[];
};
export type HierarchyRowKind =
  | 'parent-start'
  | 'batch-start'
  | 'parent-end'
  | 'batch-end'
  | 'format'
  | 'scope'
  | 'detail-header'
  | 'data'
  | 'control'
  | 'report-end'
  | 'blank'
  | 'error';
export function parseInventoryHierarchy(
  file: SourceFile,
  scope: StockScope,
  decimals: number,
  numeric: (raw: string, precision: number) => number,
) {
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
    const key = JSON.stringify([row, column, code]);
    if (!seenIssues.has(key)) {
      issues.push({ row, ...(column === undefined ? {} : { column }), code });
      seenIssues.add(key);
    }
  };
  const inventory: { row: number; kind: HierarchyRowKind }[] = [],
    cells: { row: number; column: number; field: string; text: string }[] = [],
    memberRows: number[] = [];
  const records: {
    row: number;
    raw: Record<string, string>;
    evidence: HierarchyRecordEvidence;
  }[] = [];
  const evidence: StockHierarchyEvidence = {
    family: STOCK_HIERARCHY_FAMILY,
    source: 0,
    sourceHash: file.sha256!,
    sheet: 0,
    sheetName: sheet.name,
    title: cite(1, 1),
    scope: {},
    records: [],
  };
  let parent: HierarchyDimension | null = null,
    batch: HierarchyDimension | null = null,
    headers: Record<string, StockCellCitation> | null = null;
  let parentKind = '',
    started = false,
    ended = false,
    controlled = false;
  let parentRecords: HierarchyRecordEvidence[] = [],
    batchRecords: HierarchyRecordEvidence[] = [];
  const sums = new Map<number, bigint>(),
    duplicate = new Map<string, number[]>();
  const trimRow = (r: string[]) => {
    const copy = [...r];
    while (copy.at(-1) === '') copy.pop();
    return copy;
  };
  const populated = (row: number) =>
    sheet.rows[row - 1]?.some((v) => v !== '') ?? false;
  const literal = (row: number, column: number) => {
    if (sheet.numericCells?.[`${row}:${column}`])
      problem(row, 'NUMERIC_IDENTITY', column);
    if (sheet.referenceIssues?.[`${row}:${column}`]?.length)
      problem(row, 'REFERENCE_DISPLAY', column);
  };
  const token = (row: number) => {
    const raw = cite(row, 2).raw;
    literal(row, 1);
    literal(row, 2);
    if (!raw || raw !== raw.trim() || /[;=]/.test(raw))
      problem(row, 'HIERARCHY_DIMENSION', 2);
    return raw;
  };
  const closeBatch = (row: number) => {
    for (const e of batchRecords) e.batchEnd = cite(row, 1);
    batchRecords = [];
    batch = null;
    headers = null;
  };
  const closeParent = (row: number) => {
    closeBatch(row);
    for (const e of parentRecords) e.parentEnd = cite(row, 1);
    parentRecords = [];
    parent = null;
  };
  const dimension = (row: number, key: string): HierarchyDimension => {
    const merge = mergeByRow.get(row);
    return {
      key,
      label: cite(row, 1),
      value: cite(row, 2),
      ...(merge ? { merge: { ...merge } } : {}),
    };
  };
  for (const row of sheet.hiddenRows)
    if (populated(row)) problem(row, 'HIDDEN_SOURCE');
  for (const row of sheet.formulaRows) problem(row, 'FORMULA_SOURCE');
  for (const [row, warnings] of Object.entries(sheet.rowIssues ?? {}))
    if (warnings.length && populated(Number(row)))
      problem(Number(row), 'SOURCE_DISPLAY');
  for (const [coordinate, warnings] of Object.entries(sheet.cellIssues ?? {})) {
    const [row, column] = coordinate.split(':').map(Number);
    if (warnings.length && cite(row, column).raw !== '')
      problem(row, 'SOURCE_DISPLAY', column);
  }
  if (Object.keys(sheet.formulaCells ?? {}).length)
    problem(1, 'FORMULA_SOURCE');
  for (const col of sheet.xlsxHeaders?.hiddenColumns ?? [])
    if (sheet.rows.some((r) => r[col - 1] !== undefined && r[col - 1] !== ''))
      problem(1, 'HIDDEN_SOURCE');
  const merges = sheet.xlsxHeaders?.merges ?? [];
  const mergeByRow = new Map(merges.map((m) => [m.top, m]));
  const mergeRows = new Set<number>();
  for (const m of merges) {
    const row = trimRow(sheet.rows[m.top - 1] ?? []);
    if (
      m.top !== m.bottom ||
      m.left !== 2 ||
      ![6, 7].includes(m.right) ||
      !['Plant', 'Warehouse', 'Batch'].includes(row[0]) ||
      !row[1] ||
      m.text !== row[1] ||
      row.length !== 2
    )
      problem(m.top, 'HIERARCHY_MERGE');
    if (mergeRows.has(m.top)) problem(m.top, 'HIERARCHY_MERGE');
    mergeRows.add(m.top);
  }
  sheet.rows.forEach((original, index) => {
    const row = index + 1,
      raw = trimRow(original),
      label = raw[0] ?? '';
    let kind: HierarchyRowKind = 'error';
    original.forEach((text, col) =>
      cells.push({ row, column: col + 1, field: label, text }),
    );
    if (raw.length && row > 1) memberRows.push(row);
    if (!raw.length) kind = 'blank';
    else if (ended) {
      problem(row, 'TRAILING_CONTENT');
    } else if (row === 1) {
      kind = 'format';
      if (raw.length !== 1 || label !== STOCK_HIERARCHY_TITLE)
        problem(row, 'FORMAT');
    } else if (scopeLabels.includes(label)) {
      kind = 'scope';
      const key = scopeFields[scopeLabels.indexOf(label)];
      if (started || raw.length !== 2 || evidence.scope[key])
        problem(row, 'SCOPE_FIELD');
      else {
        evidence.scope[key] = cite(row, 2);
        literal(row, 2);
        if (raw[1] !== scope[key]) problem(row, 'ROW_SCOPE', 2);
      }
    } else if (['Plant', 'Warehouse'].includes(label)) {
      kind = 'parent-start';
      closeParent(row);
      started = true;
      if (
        controlled ||
        raw.length !== 2 ||
        (parentKind && parentKind !== label)
      )
        problem(row, 'HIERARCHY_PARENT');
      parentKind ||= label;
      const value = token(row);
      if (value && raw.length === 2 && !controlled && label === parentKind)
        parent = dimension(row, label.toLowerCase());
    } else if (label === 'Batch') {
      kind = 'batch-start';
      closeBatch(row);
      const value = token(row);
      if (!parent || raw.length !== 2 || controlled)
        problem(row, 'HIERARCHY_BATCH');
      if (parent && value && raw.length === 2 && !controlled)
        batch = dimension(row, 'batch');
    } else if (['End batch', 'Batch total'].includes(label)) {
      kind = label === 'End batch' ? 'batch-end' : 'control';
      if (!batch || raw.length !== (label === 'End batch' ? 1 : 2))
        problem(row, 'HIERARCHY_BOUNDARY');
      if (label === 'Batch total' && batch)
        checkControl(row, sums.get(batch.value.row) ?? 0n);
      closeBatch(row);
    } else if (['End plant', 'End warehouse', 'Parent total'].includes(label)) {
      kind = label === 'Parent total' ? 'control' : 'parent-end';
      if (
        !parent ||
        raw.length !== (label === 'Parent total' ? 2 : 1) ||
        (label !== 'Parent total' &&
          label !== 'End ' + parentKind.toLowerCase())
      )
        problem(row, 'HIERARCHY_BOUNDARY');
      if (label === 'Parent total' && parent)
        checkControl(row, sums.get(parent.value.row) ?? 0n);
      closeParent(row);
    } else if (label === 'Report total') {
      kind = 'control';
      if (controlled || raw.length !== 2) problem(row, 'CONTROL_BOUNDARY');
      checkControl(
        row,
        records.reduce((sum, r) => {
          try {
            return sum + BigInt(numeric(r.raw['Posted value'], decimals));
          } catch {
            return sum;
          }
        }, 0n),
      );
      closeParent(row);
      controlled = true;
      evidence.reportTotal = cite(row, 2);
    } else if (label === 'End report') {
      kind = 'report-end';
      if (raw.length !== 1) problem(row, 'END_REPORT');
      closeParent(row);
      ended = true;
      evidence.reportEnd = cite(row, 1);
    } else if (raw.includes('Item ID')) {
      kind = 'detail-header';
      if (
        !parent ||
        !batch ||
        controlled ||
        ![6, 7].includes(raw.length) ||
        new Set(raw).size !== raw.length ||
        !HIERARCHY_FIELDS.every((k) => raw.includes(k)) ||
        (raw.length === 7 && !raw.includes('Item dimensions'))
      ) {
        problem(row, 'HIERARCHY_HEADER');
        headers = null;
      } else {
        headers = Object.fromEntries(raw.map((k, i) => [k, cite(row, i + 1)]));
        for (let col = 1; col <= raw.length; col++) literal(row, col);
        for (const dim of [parent, batch])
          if (dim.merge && dim.merge.right !== raw.length)
            problem(dim.value.row, 'HIERARCHY_MERGE');
      }
    } else if (
      parent &&
      batch &&
      headers &&
      raw.length === Object.keys(headers).length
    ) {
      kind = 'data';
      const activeHeaders = headers;
      const fields = Object.fromEntries(
        Object.entries(activeHeaders).map(([key, c]) => [
          key,
          cite(row, c.column),
        ]),
      );
      const dims =
        parent.key + '=' + parent.value.raw + ';batch=' + batch.value.raw;
      const values = Object.fromEntries(
        Object.entries(fields).map(([key, c]) => [key, c.raw]),
      );
      for (const key of HIERARCHY_FIELDS)
        if (!values[key]) problem(row, 'HIERARCHY_VALUE', fields[key].column);
      if (fields['Item dimensions'] && values['Item dimensions'] !== dims)
        problem(
          row,
          'HIERARCHY_DIMENSION_CONFLICT',
          fields['Item dimensions'].column,
        );
      for (const key of [
        'Item ID',
        'Unit',
        'Valuation reference',
        'Item dimensions',
      ])
        if (fields[key]) literal(row, fields[key].column);
      values['Item dimensions'] = dims;
      const key = JSON.stringify([values['Item ID'], dims]),
        rows = duplicate.get(key) ?? [];
      rows.push(row);
      duplicate.set(key, rows);
      const e: HierarchyRecordEvidence = {
        recordId: '',
        row,
        derivedDimensions: dims,
        fields,
        headers: { ...activeHeaders },
        parent,
        batch,
        parentEnd: null,
        batchEnd: null,
      };
      records.push({ row, raw: values, evidence: e });
      evidence.records.push(e);
      parentRecords.push(e);
      batchRecords.push(e);
      try {
        const n = BigInt(numeric(values['Posted value'], decimals));
        for (const dim of [parent, batch])
          sums.set(dim.value.row, (sums.get(dim.value.row) ?? 0n) + n);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('STOCK_'))
          throw error;
        problem(row, error.message.slice(6), fields['Posted value'].column);
      }
    } else {
      problem(row, 'HIERARCHY_ORPHAN');
      closeBatch(row);
    }
    inventory.push({ row, kind });
  });
  function checkControl(row: number, expected: bigint) {
    try {
      if (BigInt(numeric(cite(row, 2).raw, decimals)) !== expected)
        problem(row, 'CONTROL_MISMATCH', 2);
    } catch {
      problem(row, 'CONTROL_MISMATCH', 2);
    }
  }
  for (const rows of duplicate.values())
    if (rows.length > 1) for (const row of rows) problem(row, 'DUPLICATE');
  if (!ended) problem(sheet.rows.length || 1, 'MISSING_END_REPORT');
  if (!scopeFields.every((k) => evidence.scope[k])) problem(1, 'MISSING_SCOPE');
  if (!records.length) problem(1, 'MISSING_SECTION');
  return { records, inventory, cells, issues, memberRows, evidence };
}
