import { assertInputFormats } from './input-readiness.ts';
import { saveSession, restoreSession } from './session.ts';
import { readFile, exportWorkbook } from './io.ts';
import { normalizeSource } from './core.ts';
import { reconcileSupplierStatement } from './supplier-reconciliation.ts';
import { ENGINE_VERSION } from './types.ts';
import { WORKER_CHANNEL, isRequest } from './protocol.ts';
import { ImportDiagnosticError } from './import-diagnostics.ts';
import { isInputReadinessRejection } from './input-readiness.ts';
self.onmessage = async (event: MessageEvent) => {
  const input: unknown = event.data;
  if (!isRequest(input)) return;
  const { id, action, payload } = event.data;
  const reply = { channel: WORKER_CHANNEL, id, action };
  // Durations only: no source content, persistence, or network telemetry.
  const timings: Record<string, number> = {};
  let started = performance.now();
  const measured = (stage: string) => {
    const now = performance.now();
    timings[stage] = now - started;
    started = now;
  };
  try {
    let value: unknown;
    if (action === 'ready') value = { ready: true, engine: ENGINE_VERSION };
    else if (action === 'save-session') value = await saveSession(payload);
    else if (action === 'restore-session')
      value = await restoreSession(payload.buffer);
    else if (action === 'read')
      value = await readFile(
        payload.name,
        payload.buffer,
        payload.pdfCuts,
        payload.autoPdfColumns === true,
      );
    else if (action === 'reconcile') {
      // The shared source boundary checks formats and directions first.
      const { a, b, result } = reconcileSupplierStatement(payload, measured);
      value = { a, b, result };
    } else if (action === 'compare') {
      value = reconcileSupplierStatement(payload).result;
    } else if (action === 'normalize')
      value = normalizeSource(
        payload.file,
        payload.mapping,
        payload.scope,
        payload.side,
      );
    else if (action === 'export') {
      assertInputFormats(
        payload.files,
        [payload.result.supplier.mapping, payload.result.ledger.mapping],
        payload.result.scope,
      );
      value = await exportWorkbook(
        payload.result,
        payload.files,
        payload.review,
        (stage, milliseconds) => {
          timings[stage] = milliseconds;
        },
      );
    } else throw new Error('عملية غير معروفة');
    if (value instanceof ArrayBuffer)
      self.postMessage(
        { ...reply, ok: true, value, timings },
        { transfer: [value] },
      );
    else self.postMessage({ ...reply, ok: true, value, timings });
  } catch (error) {
    self.postMessage({
      ...reply,
      ok: false,
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : 'تعذر إكمال العملية محليًا',
      ...(error instanceof ImportDiagnosticError
        ? { diagnosis: error.diagnosis }
        : {}),
      // The refusal reason crosses the boundary, so a caller can tell a guarded
      // stop from a crash without parsing a message.
      ...(isInputReadinessRejection(error)
        ? { readiness: error.readiness }
        : {}),
    });
  }
};
