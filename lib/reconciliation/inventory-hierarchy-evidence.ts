import type { StockHierarchyEvidence } from './inventory-hierarchy-sections.ts';
import type { StockCellCitation } from './inventory-section-components.ts';
export const STOCK_HIERARCHY_CITATION_HEADERS = [
  'Record ID',
  'Source',
  'SHA256',
  'Sheet index',
  'Sheet',
  'Source row',
  'Column',
  'Field',
  'Text',
  'Kind',
  'Parent row',
  'Batch row',
  'Boundary row',
  'Merge range',
  'Derived dimensions',
];
export function stockHierarchyCitationRows(
  e: StockHierarchyEvidence,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const add = (
    id: string,
    c: StockCellCitation,
    field: string,
    kind: string,
    parent: number | null = null,
    batch: number | null = null,
    boundary: number | null = null,
    merge = '',
    dims = '',
  ) =>
    rows.push([
      id,
      0,
      c.sourceHash,
      c.sheet,
      c.sheetName,
      c.row,
      c.column,
      field,
      c.raw,
      kind,
      parent,
      batch,
      boundary,
      merge,
      dims,
    ]);
  add('', e.title, 'Title', 'format');
  for (const [key, c] of Object.entries(e.scope))
    if (c) add('', c, key, 'scope');
  for (const r of e.records) {
    const parent = r.parent.value.row,
      batch = r.batch.value.row;
    for (const [field, c] of Object.entries(r.fields))
      add(
        r.recordId,
        c,
        field,
        'value',
        parent,
        batch,
        null,
        '',
        r.derivedDimensions,
      );
    for (const [field, c] of Object.entries(r.headers))
      add(r.recordId, c, field, 'role', parent, batch);
    for (const dim of [r.parent, r.batch]) {
      const m = dim.merge,
        range = m ? JSON.stringify([m.top, m.left, m.bottom, m.right]) : '';
      add(
        r.recordId,
        dim.label,
        dim.key,
        'dimension-role',
        parent,
        batch,
        null,
        range,
      );
      add(
        r.recordId,
        dim.value,
        dim.key,
        'dimension-value',
        parent,
        batch,
        null,
        range,
        r.derivedDimensions,
      );
    }
    if (r.parentEnd)
      add(
        r.recordId,
        r.parentEnd,
        'Parent end',
        'boundary',
        parent,
        batch,
        r.parentEnd.row,
      );
    if (r.batchEnd)
      add(
        r.recordId,
        r.batchEnd,
        'Batch end',
        'boundary',
        parent,
        batch,
        r.batchEnd.row,
      );
  }
  if (e.reportTotal) add('', e.reportTotal, 'Report total', 'control');
  if (e.reportEnd) add('', e.reportEnd, 'End report', 'report-end');
  return rows;
}
