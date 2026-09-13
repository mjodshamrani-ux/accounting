import { saveSession, restoreSession } from './session.ts';
import { readFile, exportWorkbook } from './io.ts';
import { normalizeSource, compare } from './core.ts';
import { ENGINE_VERSION } from './types.ts';
import { WORKER_CHANNEL, isRequest } from './protocol.ts';
self.onmessage = async (event: MessageEvent) => {
  const input: unknown = event.data;
  if (!isRequest(input)) return;
  const { id, action, payload } = event.data;
  const reply = { channel: WORKER_CHANNEL, id, action };
  try {
    let value: unknown;
    if (action === 'ready') value = { ready: true, engine: ENGINE_VERSION };
    else if (action === 'save-session') value = await saveSession(payload);
    else if (action === 'restore-session')
      value = await restoreSession(payload.buffer);
    else if (action === 'read')
      value = await readFile(payload.name, payload.buffer, payload.pdfCuts);
    else if (action === 'reconcile') {
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
      value = {
        a,
        b,
        result:
          a.errors.length || b.errors.length
            ? null
            : compare(a, b, payload.scope, payload.decisions, payload.rejected),
      };
    } else if (action === 'compare') {
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
    else if (action === 'export')
      value = await exportWorkbook(
        payload.result,
        payload.files,
        payload.review,
      );
    else throw new Error('عملية غير معروفة');
    if (value instanceof ArrayBuffer)
      self.postMessage({ ...reply, ok: true, value }, { transfer: [value] });
    else self.postMessage({ ...reply, ok: true, value });
  } catch (error) {
    self.postMessage({
      ...reply,
      ok: false,
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : 'تعذر إكمال العملية محليًا',
    });
  }
};
