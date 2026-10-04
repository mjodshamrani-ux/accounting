import { WORKER_CHANNEL, isRecord, validateWorkerValue } from './protocol.ts';
import { isNextProcessingProgress } from './processing-progress.ts';
import type { ProcessingProgress } from './processing-progress.ts';
import {
  ImportDiagnosticError,
  isImportDiagnosis,
} from './import-diagnostics.ts';
export type WorkerPort = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
const isPdfRead = (action: string, payload: unknown) =>
  action === 'read' &&
  isRecord(payload) &&
  typeof payload.name === 'string' &&
  /\.pdf$/i.test(payload.name);

/** The deadline covers the entire request, including sequential source re-reads. */
export function workerRequestTimeout(action: string, payload: unknown) {
  const rereadsPdf =
    (action === 'save-session' || action === 'export') &&
    isRecord(payload) &&
    Array.isArray(payload.files) &&
    payload.files.some(
      (file) =>
        isRecord(file) &&
        typeof file.name === 'string' &&
        /\.pdf$/i.test(file.name),
    );
  return isPdfRead(action, payload) ||
    action === 'restore-session' ||
    rereadsPdf
    ? 180000
    : 45000;
}
export function createWorkerClient(
  create: () => WorkerPort,
  timeoutMs?: number,
) {
  let serial = 0,
    cached: WorkerPort | null = null,
    inUse = false;
  let preparation: Promise<unknown> | null = null;
  function request<T>(
    action: string,
    payload: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('أُلغيت العملية'));
      if (inUse) return reject(new Error('انتظر انتهاء العملية الحالية'));
      if (!cached) cached = create();
      const worker = cached,
        id = ++serial;
      inUse = true;
      let settled = false;
      let progress: ProcessingProgress | undefined;
      const finish = (terminate: boolean) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        inUse = false;
        if (terminate) {
          worker.terminate();
          cached = null;
          preparation = null;
        }
        return true;
      };
      const fail = (error: unknown) => {
        if (finish(true))
          reject(
            error instanceof Error && error.message.trim()
              ? error
              : new Error(
                  'تعذر قراءة الملف. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
                ),
          );
      };
      const abort = () => fail(new Error('أُلغيت العملية'));
      const deadlineMs = timeoutMs ?? workerRequestTimeout(action, payload);
      const timeout = setTimeout(
        () =>
          fail(
            new Error(
              `تجاوزت العملية مهلة ${deadlineMs / 1000} ثانية. قلل حجم الملف أو راجع بنيته.`,
            ),
          ),
        deadlineMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      worker.onmessage = async (event) => {
        if (settled) return;
        const response = event.data as unknown;
        // Library messages and delayed replies are not accounting results.
        if (
          !isRecord(response) ||
          response.channel !== WORKER_CHANNEL ||
          response.id !== id
        )
          return;
        const invalidResponse = () =>
          fail(
            new Error(
              'استجابة قارئ الملفات غير صالحة. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
            ),
          );
        if (response.action !== action) return invalidResponse();
        if (
          Object.hasOwn(response, 'kind') ||
          Object.hasOwn(response, 'progress')
        ) {
          if (
            response.kind !== 'progress' ||
            !isPdfRead(action, payload) ||
            Object.keys(response).length !== 5 ||
            Object.keys(response).some(
              (key) =>
                !['channel', 'id', 'action', 'kind', 'progress'].includes(key),
            ) ||
            !isNextProcessingProgress(progress, response.progress)
          )
            return invalidResponse();
          progress = { ...response.progress };
          try {
            onProgress?.({ ...progress });
          } catch (error) {
            fail(error);
          }
          return;
        }
        if (typeof response.ok !== 'boolean')
          return fail(
            new Error(
              'استجابة قارئ الملفات غير صالحة. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
            ),
          );
        if (!response.ok) {
          const message =
            typeof response.error === 'string' && response.error.trim()
              ? response.error
              : 'تعذر قراءة الملف. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.';
          return fail(
            action === 'read' && isImportDiagnosis(response.diagnosis)
              ? new ImportDiagnosticError(message, response.diagnosis)
              : new Error(message),
          );
        }
        try {
          validateWorkerValue(action, response.value, payload);
          if (action === 'read' && isRecord(response.value) && response.value.kind === 'reviewed-visual-source') {
            const { replayReviewedVisualSource } = await import('./visual-accounting-source.ts');
            response.value = await replayReviewedVisualSource(response.value as import('./types.ts').SourceFile);
          }
          if (action === 'restore-session' && isRecord(response.value) && Array.isArray(response.value.files)) {
            const { replayReviewedVisualSource } = await import('./visual-accounting-source.ts');
            response.value.files = await Promise.all(response.value.files.map(replayReviewedVisualSource));
          }
        } catch (error) {
          fail(error);
          return;
        }
        if (finish(false)) resolve(response.value as T);
      };
      worker.onerror = () =>
        fail(
          new Error(
            'توقفت المعالجة المحلية وأُعيد تجهيز القارئ. أعد اختيار الملف.',
          ),
        );
      worker.onmessageerror = () =>
        fail(new Error('تعذر استلام بيانات القارئ المحلي. أعد اختيار الملف.'));
      try {
        worker.postMessage({ channel: WORKER_CHANNEL, id, action, payload });
      } catch (error) {
        fail(error);
      }
    });
  }
  return {
    request,
    prepare: () =>
      (preparation ??= request('ready', {}).catch((error) => {
        preparation = null;
        throw error;
      })),
  };
}
