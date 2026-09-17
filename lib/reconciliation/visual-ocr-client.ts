// A directly owned worker handle exists before any Tesseract initialization
// promise. Cancellation therefore never waits for a partially loaded engine.
export type VisualOcrWorker = Pick<Worker, 'postMessage' | 'terminate'> &
  Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export type VisualOcrOptions = {
  assetBaseUrl: string;
  signal?: AbortSignal;
  onProgress?: (status: string) => void;
  /** Test seam; production uses a dedicated browser Worker. */
  workerFactory?: (blobUrl: string) => VisualOcrWorker;
  /** Tests may shorten, but cannot disable or extend, the hard deadlines. */
  startupTimeoutMs?: number;
  pageTimeoutMs?: number;
};
export type VisualOcr = {
  recognize(png: Uint8Array): Promise<unknown>;
  destroy(): void;
};
type Action = 'load' | 'loadLanguage' | 'initialize' | 'recognize';
type Pending = {
  jobId: string;
  action: Action;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};
const STARTUP_MS = 60_000;
const PAGE_MS = 90_000;
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const progressText: Record<Action, string> = {
  load: 'تهيئة القارئ البصري المحلي',
  loadLanguage: 'تهيئة القراءة بالعربية والإنجليزية',
  initialize: 'تجهيز محرك القراءة البصرية',
  recognize: 'قراءة الصفحة داخل الجهاز',
};
const progressStatuses: Record<Action, readonly string[]> = {
  load: ['loading tesseract core', 'initializing tesseract'],
  loadLanguage: ['loading language traineddata'],
  initialize: ['initializing api'],
  recognize: ['recognizing text'],
};
let workerSequence = 0;

function failure(kind: 'abort' | 'timeout' | 'protocol' | 'worker'): Error {
  const error = new Error(
    {
      abort: 'أُوقفت القراءة البصرية المحلية.',
      timeout: 'تجاوزت القراءة البصرية المهلة؛ أُوقف العامل وأُفرغت موارده.',
      protocol: 'استجابة القارئ البصري غير صالحة؛ لم تُعتمد بيانات الصفحة.',
      worker: 'تعذر تشغيل القارئ البصري المحلي؛ لم تُعتمد بيانات الصفحة.',
    }[kind],
  );
  error.name =
    kind === 'abort'
      ? 'AbortError'
      : kind === 'timeout'
        ? 'TimeoutError'
        : 'VisualOcrError';
  return error;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function deadline(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error('مهلة القراءة البصرية غير صالحة.');
  return value;
}
function assetPaths(assetBaseUrl: string) {
  try {
    if (
      typeof assetBaseUrl !== 'string' ||
      !assetBaseUrl.trim() ||
      /[?#\\]/u.test(assetBaseUrl) ||
      Array.from(assetBaseUrl).some((c) => c.charCodeAt(0) <= 32) ||
      typeof location === 'undefined'
    )
      throw Error();
    const page = new URL(location.href);
    const base = new URL(assetBaseUrl, page);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.origin !== page.origin ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw Error();
    const path = base.href.replace(/\/+$/, '');
    return {
      worker: `${path}/ocr/worker.js`,
      vendor: `${path}/ocr/worker-vendor.js`,
      core: `${path}/ocr/tesseract-core-lstm.wasm.js`,
      languages: `${path}/ocr/languages`,
    };
  } catch {
    throw new Error(
      'يجب أن تكون أصول القراءة البصرية ثابتة ومن نفس موقع التطبيق دون بيانات دخول أو معاملات URL.',
    );
  }
}

export async function createVisualOcr(
  options: VisualOcrOptions,
): Promise<VisualOcr> {
  if (options.signal?.aborted) throw failure('abort');
  const paths = assetPaths(options.assetBaseUrl);
  const startupMs = deadline(options.startupTimeoutMs, STARTUP_MS);
  const pageMs = deadline(options.pageTimeoutMs, PAGE_MS);
  const workerId = `mizan-visual-ocr-${++workerSequence}`;
  let jobSequence = 0;
  let worker: VisualOcrWorker | undefined;
  let blobUrl: string | undefined;
  let pending: Pending | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped: Error | undefined;
  const notify = (action: Action) => {
    try {
      options.onProgress?.(progressText[action]);
    } catch {
      /* A view callback has no authority over OCR protocol or numbers. */
    }
  };
  const close = (error: Error) => {
    if (stopped) return;
    stopped = error;
    clearTimeout(startupTimer);
    options.signal?.removeEventListener('abort', onAbort);
    const job = pending;
    pending = undefined;
    clearTimeout(job?.timer);
    if (worker) {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      try {
        worker.terminate();
      } catch {
        /* Continue revoking retained resources. */
      }
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = undefined;
    }
    job?.reject(error);
  };
  function onAbort() {
    close(failure('abort'));
  }
  function onError(event: Event) {
    event.preventDefault();
    close(failure('worker'));
  }
  function onMessage(event: Event) {
    if (stopped) return;
    const packet: unknown = (event as MessageEvent<unknown>).data;
    const job = pending;
    if (
      !record(packet) ||
      !job ||
      Object.keys(packet).sort().join(',') !==
        'action,data,jobId,status,workerId' ||
      packet.workerId !== workerId ||
      packet.jobId !== job.jobId ||
      packet.action !== job.action ||
      !['resolve', 'reject', 'progress'].includes(String(packet.status))
    ) {
      close(failure('protocol'));
      return;
    }
    if (packet.status === 'reject') {
      close(failure('worker'));
      return;
    }
    if (packet.status === 'progress') {
      if (
        !record(packet.data) ||
        typeof packet.data.status !== 'string' ||
        !progressStatuses[job.action].includes(packet.data.status) ||
        typeof packet.data.progress !== 'number' ||
        !Number.isFinite(packet.data.progress) ||
        packet.data.progress < 0 ||
        packet.data.progress > 1
      ) {
        close(failure('protocol'));
        return;
      }
      notify(job.action);
      return;
    }
    const data = packet.data;
    const valid =
      job.action === 'load'
        ? record(data) && data.loaded === true
        : job.action === 'loadLanguage'
          ? data === 'eng+ara'
          : job.action === 'initialize'
            ? data === undefined
            : record(data) &&
              typeof data.text === 'string' &&
              Array.isArray(data.blocks);
    if (!valid) {
      close(failure('protocol'));
      return;
    }
    pending = undefined;
    clearTimeout(job.timer);
    // Text, confidence, logs and optional engine output never enter the caller.
    job.resolve(
      job.action === 'recognize'
        ? (data as Record<string, unknown>).blocks
        : undefined,
    );
  }
  function run(
    action: Action,
    payload: unknown,
    transfer: Transferable[] = [],
  ): Promise<unknown> {
    if (stopped) return Promise.reject(stopped);
    if (!worker || pending)
      return Promise.reject(
        new Error('توجد صفحة قيد القراءة؛ انتظر انتهائها قبل بدء صفحة أخرى.'),
      );
    return new Promise((resolve, reject) => {
      const jobId = `visual-job-${++jobSequence}`;
      pending = { jobId, action, resolve, reject };
      if (action === 'recognize')
        pending.timer = setTimeout(() => close(failure('timeout')), pageMs);
      notify(action);
      if (stopped) return;
      try {
        worker!.postMessage({ workerId, jobId, action, payload }, transfer);
      } catch {
        close(failure('worker'));
      }
    });
  }
  try {
    const blob = new Blob(
      [
        `self.__mizanOcrVendorUrl = ${JSON.stringify(paths.vendor)};\nimportScripts(${JSON.stringify(paths.worker)});`,
      ],
      { type: 'application/javascript' },
    );
    blobUrl = URL.createObjectURL(blob);
    worker = options.workerFactory
      ? options.workerFactory(blobUrl)
      : new Worker(blobUrl, { name: 'mizan-visual-ocr' });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      close(failure('abort'));
      throw stopped;
    }
    startupTimer = setTimeout(() => close(failure('timeout')), startupMs);
    await run('load', {
      options: { lstmOnly: true, corePath: paths.core, logging: false },
    });
    await run('loadLanguage', {
      langs: 'eng+ara',
      options: {
        langPath: paths.languages,
        cacheMethod: 'none',
        gzip: true,
        lstmOnly: true,
      },
    });
    await run('initialize', { langs: 'eng+ara', oem: 1, config: {} });
    clearTimeout(startupTimer);
    if (stopped) throw stopped;
    return {
      async recognize(png) {
        if (stopped) throw stopped;
        if (
          !(png instanceof Uint8Array) ||
          png.byteLength < PNG_SIGNATURE.length ||
          png.byteLength > MAX_PNG_BYTES ||
          PNG_SIGNATURE.some((byte, i) => png[i] !== byte)
        )
          throw new Error(
            'صورة الصفحة غير صالحة أو تتجاوز حد القراءة البصرية.',
          );
        // Transfer a private copy. Never detach or overwrite the caller's page.
        const image = new Uint8Array(png);
        return run(
          'recognize',
          { image, options: {}, output: { text: true, blocks: true } },
          [image.buffer],
        );
      },
      destroy() {
        close(failure('abort'));
      },
    };
  } catch {
    if (!stopped) close(failure('worker'));
    throw stopped;
  }
}
