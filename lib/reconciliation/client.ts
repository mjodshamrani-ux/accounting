import LocalWorker from './worker.ts?worker&inline';
let serial = 0;
let cachedWorker: Worker | null = null;
let inUse = false;
export function workerTask<T>(
  action: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('أُلغيت العملية'));
      return;
    }
    if (inUse) {
      reject(new Error('انتظر انتهاء العملية الحالية'));
      return;
    }
    if (!cachedWorker) cachedWorker = new LocalWorker();
    const worker = cachedWorker;
    inUse = true;
    const id = ++serial;
    const finish = (terminate = false) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      inUse = false;
      if (terminate) {
        worker.terminate();
        cachedWorker = null;
        preparation = null;
      }
    };
    const abort = () => {
      finish(true);
      reject(new Error('أُلغيت العملية'));
    };
    const timeout = setTimeout(() => {
      finish(true);
      reject(
        new Error('تجاوزت العملية 45 ثانية. قلل حجم الملف أو راجع بنيته.'),
      );
    }, 45000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      finish();
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.value);
    };
    worker.onerror = () => {
      finish(true);
      reject(
        new Error(
          'تعذر تشغيل المعالجة المحلية. أعد فتح الصفحة أو استخدم متصفحًا حديثًا.',
        ),
      );
    };
    try {
      worker.postMessage({ id, action, payload });
    } catch (error) {
      finish(true);
      reject(error);
    }
  });
}

let preparation: Promise<unknown> | null = null;
export function prepareWorker() {
  return (preparation ??= workerTask('ready', {}).catch((error) => {
    preparation = null;
    throw error;
  }));
}
