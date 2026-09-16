import { WORKER_CHANNEL, isRecord, validateWorkerValue } from './protocol.ts';
import {
  ImportDiagnosticError,
  isImportDiagnosis,
} from './import-diagnostics.ts';
export type WorkerPort = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
export function createWorkerClient(
  create: () => WorkerPort,
  timeoutMs = 45000,
) {
  let serial = 0,
    cached: WorkerPort | null = null,
    inUse = false;
  let preparation: Promise<unknown> | null = null;
  function request<T>(
    action: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('أُلغيت العملية'));
      if (inUse) return reject(new Error('انتظر انتهاء العملية الحالية'));
      if (!cached) cached = create();
      const worker = cached,
        id = ++serial;
      inUse = true;
      let settled = false;
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
                  'تعذر قراءة الملف؛ أُعيد تجهيز القارئ للمحاولة التالية.',
                ),
          );
      };
      const abort = () => fail(new Error('أُلغيت العملية'));
      const timeout = setTimeout(
        () =>
          fail(
            new Error('تجاوزت العملية 45 ثانية. قلل حجم الملف أو راجع بنيته.'),
          ),
        timeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      worker.onmessage = (event) => {
        const response = event.data as unknown;
        // Library messages and delayed replies are not accounting results.
        if (
          !isRecord(response) ||
          response.channel !== WORKER_CHANNEL ||
          response.id !== id
        )
          return;
        if (response.action !== action || typeof response.ok !== 'boolean')
          return fail(
            new Error(
              'رد قارئ الملفات غير صالح؛ أُعيد تجهيز القارئ للمحاولة التالية.',
            ),
          );
        if (!response.ok) {
          const message =
            typeof response.error === 'string' && response.error.trim()
              ? response.error
              : 'تعذر قراءة الملف؛ أُعيد تجهيز القارئ للمحاولة التالية.';
          return fail(
            action === 'read' && isImportDiagnosis(response.diagnosis)
              ? new ImportDiagnosticError(message, response.diagnosis)
              : new Error(message),
          );
        }
        try {
          validateWorkerValue(action, response.value, payload);
        } catch (error) {
          fail(error);
          return;
        }
        if (finish(false)) resolve(response.value as T);
      };
      worker.onerror = () =>
        fail(
          new Error(
            'توقفت المعالجة المحلية. أُعيد تجهيز القارئ؛ أعد اختيار الملف.',
          ),
        );
      worker.onmessageerror = () =>
        fail(new Error('تعذر استلام بيانات القارئ المحلي؛ أعد اختيار الملف.'));
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
