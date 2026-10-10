// PDF.js translates a failed font to an ErrorFont and can return the remaining
// page text. Observe the document-local font transport before it swallows that
// failure; a valid prefix is never an acceptable financial source.
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
const message = 'تعذر التحقق من نص أحد خطوط PDF؛ اطلب نسخة سليمة أو Excel';
export function guardPdfFontIntegrity(document: unknown, version: string) {
  if (
    version !== '6.1.200' ||
    !record(document) ||
    !record(document._transport) ||
    !record(document._transport.messageHandler) ||
    !record(document._transport.messageHandler.actionHandler) ||
    typeof document._transport.messageHandler.actionHandler.commonobj !==
      'function'
  )
    throw new Error(message);
  const handlers = document._transport.messageHandler.actionHandler;
  const original = handlers.commonobj as (...args: unknown[]) => unknown;
  let failed = false;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const value = args[0];
    if (
      Array.isArray(value) &&
      value[1] === 'Font' &&
      record(value[2]) &&
      Object.hasOwn(value[2], 'error')
    )
      failed = true;
    return Reflect.apply(original, this, args);
  };
  handlers.commonobj = wrapped;
  if (handlers.commonobj !== wrapped) throw new Error(message);
  return {
    assertComplete() {
      if (failed || handlers.commonobj !== wrapped) throw new Error(message);
    },
    restore() {
      if (handlers.commonobj === wrapped) handlers.commonobj = original;
    },
  };
}
