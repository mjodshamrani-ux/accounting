import { STOCK_FIELDS, STOCK_VALUES } from './inventory-register.ts';
import type { StockMatrixEvidence } from './inventory-transposed-register.ts';
import type { StockCellCitation } from './inventory-section-components.ts';

export const STOCK_MATRIX_CITATION_HEADERS = [
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
  'Band header row',
  'Fact column',
];
// Role and value are two different original cells. A shared physical role row
// does not make neighboring fact columns interchangeable.
export function stockMatrixCitationRows(
  evidence: StockMatrixEvidence,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const add = (
    record: string,
    cite: StockCellCitation,
    field: string,
    kind: string,
    band: number | null = null,
    column: number | null = null,
  ) =>
    rows.push([
      record,
      evidence.source,
      cite.sourceHash,
      cite.sheet,
      cite.sheetName,
      cite.row,
      cite.column,
      field,
      cite.raw,
      kind,
      band,
      column,
    ]);
  add('', evidence.format, 'Format', 'format');
  for (const key of STOCK_FIELDS)
    if (evidence.scope[key]) add('', evidence.scope[key], key, 'scope');
  for (const band of evidence.bands) {
    add('', band.header, 'Field', 'axis-header', band.header.row);
    for (const axis of band.columns)
      add('', axis.key, 'Column key', 'axis-key', band.header.row, axis.column);
    if (band.boundary)
      add(
        '',
        band.boundary.citation,
        band.boundary.kind,
        'boundary',
        band.header.row,
      );
    for (const record of band.records) {
      add(
        record.recordId,
        record.anchor,
        'Item ID',
        'record-anchor',
        band.header.row,
        record.column,
      );
      add(
        record.recordId,
        record.axis,
        'Column key',
        'record-axis',
        band.header.row,
        record.column,
      );
      for (const field of STOCK_VALUES[0]) {
        const pair = record.fields[field];
        if (!pair) continue;
        add(
          record.recordId,
          pair.value,
          field,
          'value',
          band.header.row,
          record.column,
        );
        add(
          record.recordId,
          pair.role,
          field,
          'role',
          band.header.row,
          record.column,
        );
      }
    }
  }
  if (evidence.reportTotal)
    add('', evidence.reportTotal, 'Report total', 'control');
  if (evidence.reportEnd)
    add('', evidence.reportEnd, 'End report', 'report-end');
  return rows;
}
