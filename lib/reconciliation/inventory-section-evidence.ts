import { STOCK_FIELDS } from './inventory-register.ts';
import type {
  StockSectionEvidence,
  StockCellCitation,
} from './inventory-section-components.ts';
import type { SourceFile } from './types.ts';
export const STOCK_SOURCE_OBSERVATION_HEADERS = [
  'Source',
  'Sheet',
  'Source row',
  'Column',
  'Kind',
  'Observation',
];
// These observations describe original reader metadata, not financial facts.
// Reference-format warnings are role-sensitive and remain in the core issues.
export function stockSourceObservations(
  files: (SourceFile | null)[],
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  files.forEach((file, source) =>
    file?.sheets.forEach((sheet) => {
      for (const [row, issues] of Object.entries(sheet.rowIssues ?? {}))
        for (const issue of issues)
          rows.push([source, sheet.name, Number(row), null, 'row', issue]);
      for (const [key, issues] of Object.entries(sheet.cellIssues ?? {})) {
        const [row, column] = key.split(':').map(Number);
        for (const issue of issues)
          rows.push([source, sheet.name, row, column, 'cell', issue]);
      }
      for (const [key, formula] of Object.entries(sheet.formulaCells ?? {})) {
        const [row, column] = key.split(':').map(Number);
        rows.push([
          source,
          sheet.name,
          row,
          column,
          'formula',
          formula.formula,
        ]);
      }
    }),
  );
  return rows;
}
export const STOCK_SECTION_CITATION_HEADERS = [
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
  'Section end row',
];
export function stockSectionCitationRows(
  evidence: StockSectionEvidence,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const add = (
    record: string,
    cite: StockCellCitation,
    field: string,
    kind: string,
    endRow: number | null = null,
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
      endRow,
    ]);
  add('', evidence.format, 'Format', 'format');
  for (const field of STOCK_FIELDS) {
    const cite = evidence.scope[field];
    if (cite) add('', cite, field, 'scope');
  }
  for (const section of evidence.sections) {
    for (const field of [
      'Item ID',
      'Item dimensions',
      'Quantity',
      'Unit',
      'Quantity precision',
      'Posted value',
      'Valuation reference',
    ]) {
      const cite = section.fields[field];
      if (cite) add(section.recordId, cite, field, 'value', section.endRow);
    }
    add(
      section.recordId,
      section.boundaries.start,
      'Section',
      'boundary',
      section.endRow,
    );
    add(
      section.recordId,
      section.boundaries.end,
      'End section',
      'boundary',
      section.endRow,
    );
    if (section.subtotal)
      add(
        section.recordId,
        section.subtotal,
        'Section subtotal',
        'control',
        section.endRow,
      );
  }
  if (evidence.reportTotal)
    add('', evidence.reportTotal, 'Report total', 'control', 0);
  return rows;
}
