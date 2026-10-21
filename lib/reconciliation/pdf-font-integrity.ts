// PDF.js translates a failed font to an ErrorFont and can return the remaining
// page text. Observe the document-local font transport before it swallows that
// failure; a valid prefix is never an acceptable financial source.
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
const message = 'تعذر التحقق من نص أحد خطوط PDF؛ اطلب نسخة سليمة أو Excel';

// With font faces disabled, PDF.js sends the outline of every glyph it draws on
// the same transport ("FontPath", DrawOPS in text space with the font matrix
// applied). A Bezier curve lies inside the box of its control points, so that
// box contains the glyph's ink. Anything unreadable stays unknown, never small.
const PATH_POINTS = [2, 2, 6, 4, 0];
export function glyphInkExtent(
  path: unknown,
): readonly [number, number] | undefined {
  if (!(path instanceof ArrayBuffer)) return undefined;
  // Decode exactly as PDF.js encodes it in this realm (FeatureTest).
  const Values =
    typeof Float16Array === 'undefined' ? Float32Array : Float16Array;
  if (path.byteLength % Values.BYTES_PER_ELEMENT) return undefined;
  const values = new Values(path);
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < values.length;) {
    const points = PATH_POINTS[values[i++]];
    if (points === undefined || i + points > values.length) return undefined;
    for (let k = 1; k < points; k += 2) {
      const y = values[i + k];
      if (!Number.isFinite(values[i + k - 1]) || !Number.isFinite(y))
        return undefined;
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    i += points;
  }
  return low <= high ? [low, high] : undefined;
}

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
  const ink = new Map<string, readonly [number, number] | undefined>();
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const value = args[0];
    if (
      Array.isArray(value) &&
      value[1] === 'Font' &&
      record(value[2]) &&
      Object.hasOwn(value[2], 'error')
    )
      failed = true;
    if (
      Array.isArray(value) &&
      value[1] === 'FontPath' &&
      typeof value[0] === 'string'
    )
      // A path sent twice for one glyph cannot prove either outline.
      ink.set(
        value[0],
        ink.has(value[0]) ? undefined : glyphInkExtent(value[2]),
      );
    return Reflect.apply(original, this, args);
  };
  handlers.commonobj = wrapped;
  if (handlers.commonobj !== wrapped) throw new Error(message);
  return {
    assertComplete() {
      if (failed || handlers.commonobj !== wrapped) throw new Error(message);
    },
    /** Vertical ink extent of a drawn glyph (`<font>_path_<char>`) per unit
     * font size, when its outline was received and read. */
    glyphInk: (id: string) => ink.get(id),
    restore() {
      if (handlers.commonobj === wrapped) handlers.commonobj = original;
    },
  };
}
