import { replayStockPdfOriginals } from './inventory-register.ts';
import { writeStockEvidenceWorkbook } from './inventory-register-io.ts';
import {
  snapshotStockPdfRequest,
  sameStockPdfData,
  pdfBytes,
  STOCK_PDF_EXPORT_LIMIT,
  type StockPdfExportRequest,
} from './inventory-pdf-request.ts';

/** Original bytes alone confer authority; the supplied result is only a guard. */
export async function exportStockPdf(
  payload: StockPdfExportRequest,
): Promise<ArrayBuffer> {
  const captured = snapshotStockPdfRequest(
    'stock-pdf-export',
    payload,
  ) as StockPdfExportRequest;
  const fresh = await replayStockPdfOriginals(captured.state);
  if (!sameStockPdfData(captured.result, fresh.result))
    throw Error('STOCK_PDF_STALE_EXPORT');
  const bytes = await writeStockEvidenceWorkbook(
    fresh.result,
    fresh.state.files.map((f, i) => ({
      name: f.name,
      sha256: f.sha256,
      original: f.original,
      sheet: i ? 'CSV' : 'PDF',
    })),
    [],
    captured.language ?? 'en',
  );
  pdfBytes(bytes, STOCK_PDF_EXPORT_LIMIT);
  return bytes;
}
