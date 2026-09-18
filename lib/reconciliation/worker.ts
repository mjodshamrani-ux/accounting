import { assertInputFormats } from './input-readiness.ts';
import { saveSession, restoreSession } from './session.ts';
import { readFile, exportWorkbook } from './io.ts';
import { normalizeSource, compare } from './core.ts';
import { ENGINE_VERSION } from './types.ts';
import { WORKER_CHANNEL, isRequest } from './protocol.ts';
import { ImportDiagnosticError } from './import-diagnostics.ts';
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
      assertInputFormats(payload.files, payload.mappings, payload.scope);
      const a = normalizeSource(
        payload.files[0],
        payload.mappings[0],
        payload.scope,
        'supplier',
      );
      const b = normalizeSource(
        payload.files[1],
        payload.mappings[1],
        payload.scope,
        'ledger',
      );
      measured('normalizePairMs');
      const result = compare(
        a,
        b,
        payload.scope,
        payload.decisions,
        payload.rejected,
      );
      measured('matchingMs');
      value = {
        a,
        b,
        result,
      };
    } else if (action === 'compare') {
      assertInputFormats(payload.files, payload.mappings, payload.scope);
      const [a, b] = payload.files;
      const [am, bm] = payload.mappings;
      value = compare(
        normalizeSource(a, am, payload.scope, 'supplier'),
        normalizeSource(b, bm, payload.scope, 'ledger'),
        payload.scope,
        payload.decisions,
        payload.rejected,
      );
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
    });
  }
};
