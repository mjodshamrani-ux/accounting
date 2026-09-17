// PDF.js 6.1.200 can resolve getOperatorList with a valid prefix before
// rejecting the promise for a later stream failure. Observe the source stream
// before PDF.js handles it, including failures after its final-chunk callback.
// This adapter is document-local and deliberately pinned to the audited API.
const PDFJS_VERSION = '6.1.200';
const message =
  'تعذر التحقق من اكتمال تعليمات عرض PDF؛ اطلب نسخة سليمة أو Excel';
type Handler = {
  sendWithStream: (...args: unknown[]) => ReadableStream<unknown>;
};
type StreamState = { done: Promise<void>; lastChunk: boolean; error?: unknown };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

export class PdfOperatorStreamError extends Error {
  constructor(cause?: unknown) {
    super(message, { cause });
    this.name = 'PdfOperatorStreamError';
  }
}

export function guardPdfOperatorStreams(document: unknown, version: string) {
  if (
    version !== PDFJS_VERSION ||
    !record(document) ||
    !record(document._transport) ||
    !record(document._transport.messageHandler) ||
    typeof document._transport.messageHandler.sendWithStream !== 'function'
  ) {
    throw new PdfOperatorStreamError();
  }
  const handler = document._transport.messageHandler as Handler;
  const original = handler.sendWithStream;
  const streams: StreamState[] = [];
  let restored = false;
  const wrapped: Handler['sendWithStream'] = function (this: Handler, ...args) {
    if (args[0] !== 'GetOperatorList')
      return Reflect.apply(original, this, args);
    let finish!: () => void;
    const state: StreamState = {
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      lastChunk: false,
    };
    streams.push(state);
    let reader: ReadableStreamDefaultReader<unknown>;
    try {
      const stream = Reflect.apply(original, this, args);
      if (!stream || typeof stream.getReader !== 'function')
        throw new PdfOperatorStreamError();
      reader = stream.getReader();
    } catch (error) {
      state.error = error;
      finish();
      throw new PdfOperatorStreamError(error);
    }
    return new ReadableStream<unknown>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            if (!state.lastChunk) state.error = new PdfOperatorStreamError();
            finish();
            controller.close();
            reader.releaseLock();
            return;
          }
          if (
            state.lastChunk ||
            !record(next.value) ||
            typeof next.value.lastChunk !== 'boolean'
          )
            throw new PdfOperatorStreamError();
          state.lastChunk = next.value.lastChunk;
          controller.enqueue(next.value);
        } catch (error) {
          state.error = error;
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        state.error = new PdfOperatorStreamError(reason);
        finish();
        await reader.cancel(reason);
      },
    });
  };
  handler.sendWithStream = wrapped;
  if (handler.sendWithStream !== wrapped) throw new PdfOperatorStreamError();
  return {
    async assertComplete() {
      if (restored || streams.length === 0) throw new PdfOperatorStreamError();
      await Promise.all(streams.map((state) => state.done));
      const failed = streams.find(
        (state) => Object.hasOwn(state, 'error') || !state.lastChunk,
      );
      if (failed) throw new PdfOperatorStreamError(failed.error);
    },
    restore() {
      restored = true;
      if (handler.sendWithStream === wrapped) handler.sendWithStream = original;
    },
  };
}
