import { readInventoryLiteralPdfRegister } from './inventory-pdf-register.ts';
import { inventoryPdfLiteral } from './inventory-pdf-accounting.ts';
import type { SourceFile } from './types.ts';
import {
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  type StockScope,
} from './inventory-register.ts';
import {
  snapshotStockPdfRequest,
  type StockPdfReadRequest,
} from './inventory-pdf-request.ts';
export const STOCK_PDF_PREVIEW = 'inventory-pdf-preview-1';
export type StockPdfPreview = {
  kind: typeof STOCK_PDF_PREVIEW;
  name: string;
  sha256: string;
  original: ArrayBuffer;
  reading: Awaited<ReturnType<typeof readInventoryLiteralPdfRegister>>;
  scope: Partial<StockScope>;
};
/** UI proposal from explicit, identical CSV scope cells only; no confirmation. */
export function inventoryCompanionScope(file: SourceFile): Partial<StockScope> {
  const rows = file.sheets[0]?.rows;
  if (
    !/\.csv$/i.test(file.name) ||
    file.sheets.length !== 1 ||
    !rows ||
    rows.length < 2 ||
    rows.some((r) => r.length !== rows[0].length)
  )
    return {};
  const proposed: Partial<StockScope> = {};
  for (const [i, label] of STOCK_SCOPE_HEADERS.entries()) {
    const column = rows[0].indexOf(label);
    if (column < 0 || rows[0].lastIndexOf(label) !== column) continue;
    const value = rows[1][column];
    if (
      value &&
      value === value.trim() &&
      rows.slice(1).every((r) => r[column] === value)
    )
      proposed[STOCK_FIELDS[i]] = value;
  }
  return proposed;
}
/** Display/role proposal only. Financial calls always reread the original. */
export async function readStockPdf(
  v: StockPdfReadRequest,
): Promise<StockPdfPreview> {
  const owned = snapshotStockPdfRequest(
    'stock-pdf-read',
    v,
  ) as StockPdfReadRequest;
  const reading = await readInventoryLiteralPdfRegister(owned.buffer);
  const scope: Partial<StockScope> = {};
  for (const [i, label] of STOCK_SCOPE_HEADERS.entries()) {
    const pair = reading.scope[label];
    if (!pair) continue;
    try {
      scope[STOCK_FIELDS[i]] = inventoryPdfLiteral(
        reading.source,
        pair.value,
      ).text;
    } catch {
      /* An ambiguous literal is not an inferred scope value. */
    }
  }
  return {
    kind: STOCK_PDF_PREVIEW,
    name: owned.name,
    original: owned.buffer,
    sha256: reading.source.sha256,
    reading,
    scope,
  };
}
