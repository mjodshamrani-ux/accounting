import type { StockColumnEvidence } from './inventory-column-hierarchy.ts';
import type { StockCellCitation } from './inventory-section-components.ts';
export const STOCK_COLUMN_CITATION_HEADERS = [
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
  'Panel end row',
  'Axis row',
  'Record column',
  'Merge range',
  'Derived dimensions',
];
export function stockColumnCitationRows(
  e: StockColumnEvidence,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const add = (
    id: string,
    c: StockCellCitation,
    field: string,
    kind: string,
    context: (string | number | null)[] = [
      null,
      null,
      null,
      null,
      null,
      '',
      '',
    ],
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
      ...context,
    ]);
  add('', e.title, 'Title', 'format');
  for (const [key, c] of Object.entries(e.scope))
    if (c) add('', c, key, 'scope');
  for (const r of e.records) {
    const m = r.parent.merge;
    const context = [
      r.parent.value.row,
      r.batch.value.row,
      r.panelEnd.row,
      r.axis.row,
      r.column,
      m ? JSON.stringify([m.top, m.left, m.bottom, m.right]) : '',
      r.derivedDimensions,
    ];
    for (const [field, pair] of Object.entries(r.fields)) {
      add(r.recordId, pair.value, field, 'value', context);
      add(r.recordId, pair.role, field, 'role', context);
    }
    add(r.recordId, r.axis, 'Axis', 'axis', context);
    add(
      r.recordId,
      r.parent.label,
      r.parent.label.raw.toLowerCase(),
      'dimension-role',
      context,
    );
    add(
      r.recordId,
      r.parent.value,
      r.parent.label.raw.toLowerCase(),
      'dimension-value',
      context,
    );
    add(r.recordId, r.batch.label, 'batch', 'dimension-role', context);
    add(r.recordId, r.batch.value, 'batch', 'dimension-value', context);
    add(r.recordId, r.panelEnd, 'End panel', 'boundary', context);
  }
  if (e.reportTotal) add('', e.reportTotal, 'Report total', 'control');
  if (e.reportEnd) add('', e.reportEnd, 'End report', 'report-end');
  return rows;
}
