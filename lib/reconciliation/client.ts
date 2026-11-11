import { createWorkerClient } from './worker-client.ts';
import type { ProcessingProgress } from './processing-progress.ts';

// The engine's text is its own file (worker-engine.ts, UX-9). Its request
// starts as soon as this module runs, before the first page is drawn, and
// readiness still waits for it: prepareWorker resolves only once the worker
// has answered, and the page opens no file and no type before that (UX-3).
// A failed load is tried again by the next prepareWorker or request.
let Engine: (new () => Worker) | null = null;
let loading: Promise<void> | null = null;
function loadEngine() {
  loading ??= import('./worker-engine.ts').then(
    (module) => {
      Engine = module.default;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}
void loadEngine().catch(() => undefined);
const client = createWorkerClient(() => new Engine!());
/** A request before the engine has loaded waits for it; once loaded, a request
 *  reaches the client in the same turn, so its payload is captured as before. */
export function workerTask<T>(
  action: string,
  payload: unknown,
  signal?: AbortSignal,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<T> {
  if (Engine) return client.request<T>(action, payload, signal, onProgress);
  return loadEngine().then(() =>
    client.request<T>(action, payload, signal, onProgress),
  );
}
export const prepareWorker = () => loadEngine().then(() => client.prepare());
