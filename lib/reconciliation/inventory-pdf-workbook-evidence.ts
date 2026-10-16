import type { StockResult } from './inventory-register.ts';

type Cell = string | number | null;
export type StockEvidenceTable = {
  name: string;
  headers: string[];
  rows: Cell[][];
};
/** UTF-16 Excel limit; never split a Unicode scalar between cells. */
export function stockPdfTextParts(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 30000, text.length);
    const prior = text.charCodeAt(end - 1),
      next = text.charCodeAt(end);
    if (prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [''];
}
/** Presentation only, including unresolved source evidence; no new matching. */
export function stockPdfWorkbookTables(r: StockResult): StockEvidenceTable[] {
  const e = r.pdfEvidence;
  if (!e) return [];
  const tables: StockEvidenceTable[] = [];
  const table = (name: string, headers: string[], rows: Cell[][]) =>
    tables.push({ name, headers, rows });
  table(
    'PDF records',
    ['Record ID', 'Page', 'Line', 'Source row', 'Field', 'Raw text'],
    e.records.flatMap((v) =>
      Object.entries(v.raw).map(([field, raw]) => [
        v.id,
        v.page,
        v.line,
        v.row,
        field,
        raw,
      ]),
    ),
  );
  table(
    'PDF literals',
    [
      'SHA256',
      'Page',
      'Line',
      'Items',
      'Start UTF16',
      'End UTF16',
      'Operators',
      'Part',
      'Parts',
      'Literal text',
    ],
    e.literals.flatMap((v) => {
      const parts = stockPdfTextParts(v.text);
      return parts.map((part, i) => [
        v.span.sourceHash,
        v.span.page,
        v.span.line,
        JSON.stringify(v.span.items),
        v.start,
        v.end,
        JSON.stringify(v.operators),
        i + 1,
        parts.length,
        part,
      ]);
    }),
  );
  table(
    'PDF links',
    ['Register ID', 'Related role', 'Related ID', 'Supported'],
    e.links.flatMap((v) => [
      ...v.mappingIds.map((id) => [
        v.registerId,
        'mapping',
        id,
        String(v.supported),
      ]),
      ...v.policyIds.map((id) => [
        v.registerId,
        'policy',
        id,
        String(v.supported),
      ]),
      ...v.glIds.map((id) => [v.registerId, 'gl', id, String(v.supported)]),
      // Retain the register even when a related set is empty. All competitors
      // and the selected account/dimensions also remain in full evidence below.
      [v.registerId, 'register', v.registerId, String(v.supported)],
    ]),
  );
  table(
    'PDF controls',
    ['Kind', 'Page', 'Declared minor', 'Actual minor'],
    [
      ...e.pageTotals.map((v) => [
        'page',
        v.page,
        v.declaredMinor,
        v.actualMinor,
      ]),
      ...(e.reportTotal
        ? [
            [
              'report',
              null,
              e.reportTotal.declaredMinor,
              e.reportTotal.actualMinor,
            ],
          ]
        : []),
    ],
  );
  table(
    'PDF diagnostics',
    ['Page', 'Line', 'Code'],
    e.issues.map((v) => [v.page, v.line, v.code]),
  );
  // Lossless local evidence, not another financial authority. This includes
  // every native item, exact glyph trace, role/value span, section/continuation
  // boundary, unresolved line and link. Chunking avoids Excel's 32767-cell cap.
  const parts = stockPdfTextParts(JSON.stringify(e));
  table(
    'PDF evidence',
    ['Format', 'SHA256', 'Part', 'Parts', 'JSON text'],
    parts.map((part, i) => [
      'inventory-pdf-workbook-evidence-1',
      e.reading.source.sha256,
      i + 1,
      parts.length,
      part,
    ]),
  );
  return tables;
}
