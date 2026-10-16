import {
  replayStockPdfOriginals,
  type StockPdfReplay,
} from './inventory-register.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  STOCK_PDF_SESSION_FORMAT,
  STOCK_PDF_LIFECYCLE_VERSION,
  STOCK_PDF_SESSION_LIMIT,
  STOCK_PDF_EXPORT_LIMIT,
  pdfBytes,
  pdfKeys,
  pdfPlain,
  snapshotStockPdfState,
  snapshotStockPdfRequest,
  snapshotStockPdfTransport,
  sameStockPdfData,
  type StockPdfState,
  type StockPdfExportRequest,
} from './inventory-pdf-request.ts';

function encode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer),
    parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(parts.join(''));
}
function decode(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw Error('STOCK_PDF_SESSION');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  pdfBytes(bytes);
  if (encode(bytes) !== value) throw Error('STOCK_PDF_SESSION');
  return bytes;
}
/** Only original bytes and explicit choices are persisted; no parsed authority. */
export async function saveStockPdf(input: StockPdfState): Promise<ArrayBuffer> {
  const { state } = await replayStockPdfOriginals(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: STOCK_PDF_SESSION_FORMAT,
      version: STOCK_PDF_LIFECYCLE_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original),
      })),
      scope: state.scope,
      completeness: state.completeness,
      events: state.events,
    }),
  ).buffer;
  pdfBytes(data, STOCK_PDF_SESSION_LIMIT);
  return data;
}
export async function restoreStockPdf(
  original: ArrayBuffer,
): Promise<StockPdfReplay> {
  pdfBytes(original, STOCK_PDF_SESSION_LIMIT);
  const parsed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(original.slice(0)),
  );
  if (
    !pdfPlain(parsed) ||
    !pdfKeys(parsed, [
      'format',
      'version',
      'files',
      'scope',
      'completeness',
      'events',
    ]) ||
    parsed.format !== STOCK_PDF_SESSION_FORMAT ||
    parsed.version !== STOCK_PDF_LIFECYCLE_VERSION ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 4
  )
    throw Error('STOCK_PDF_SESSION');
  const files = parsed.files.map((f) => {
    if (!pdfPlain(f) || !pdfKeys(f, ['name', 'sha256', 'data']))
      throw Error('STOCK_PDF_SESSION');
    return { name: f.name, sha256: f.sha256, original: decode(f.data) };
  });
  return replayStockPdfOriginals(
    snapshotStockPdfState({
      version: parsed.version,
      files,
      scope: parsed.scope,
      completeness: parsed.completeness,
      events: parsed.events,
    }),
  );
}
/** A self-consistent foreign response cannot replace the captured request. */
export async function validateStockPdfWorkerResponse(
  action: string,
  value: unknown,
  payload: unknown,
) {
  const requested = snapshotStockPdfRequest(action, payload);
  if (action === 'stock-pdf-export') {
    pdfBytes(value, STOCK_PDF_EXPORT_LIMIT);
    const returned = value.slice(0);
    const { exportStockPdf } = await import('./inventory-pdf-workbook.ts');
    const { sameStockWorkbook } =
      await import('./inventory-register-worker-binding.ts');
    const expected = await exportStockPdf(requested as StockPdfExportRequest);
    if (!(await sameStockWorkbook(returned, expected)))
      throw Error('STOCK_PDF_WORKER_EXPORT_BINDING');
    return expected;
  }
  if (action === 'stock-pdf-save') {
    pdfBytes(value, STOCK_PDF_SESSION_LIMIT);
    const returned = value.slice(0);
    const expected = await replayStockPdfOriginals(requested as StockPdfState);
    const restored = await restoreStockPdf(returned);
    if (!sameStockPdfData(restored, expected))
      throw Error('STOCK_PDF_WORKER_BINDING');
    return returned;
  }
  if (
    !pdfPlain(value) ||
    !pdfKeys(value, ['version', 'state', 'result']) ||
    value.version !== STOCK_PDF_LIFECYCLE_VERSION ||
    !pdfPlain(value.result)
  )
    throw Error('STOCK_PDF_ENVELOPE');
  const captured = {
    version: value.version,
    state: snapshotStockPdfState(value.state),
    result: snapshotStockPdfTransport(value.result),
  };
  const expected =
    action === 'stock-pdf-restore'
      ? await restoreStockPdf((requested as { buffer: ArrayBuffer }).buffer)
      : await replayStockPdfOriginals(requested as StockPdfState);
  if (!sameStockPdfData(captured, expected))
    throw Error('STOCK_PDF_WORKER_BINDING');
  return expected;
}
