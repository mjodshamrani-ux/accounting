/** First measured evidence family: opaque RGB/RGBA, 8-bit, non-interlaced PNG.
 * No browser rendering, OCR confidence or user-supplied SHA is pixel proof.
 */
export class VisualEvidenceError extends Error {
  readonly code:
    | 'format'
    | 'limit'
    | 'pixels'
    | 'source'
    | 'record'
    | 'stale'
    | 'cell';
  constructor(code: VisualEvidenceError['code']) {
    super(`visual-evidence:${code}`);
    this.code = code;
    this.name = 'VisualEvidenceError';
  }
}
export const VISUAL_EVIDENCE_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  pixels: 8_000_000,
  edge: 4096,
  recordBytes: 16 * 1024 * 1024,
  cells: 1000,
});
const reject = (
  code: ConstructorParameters<typeof VisualEvidenceError>[0],
): never => {
  throw new VisualEvidenceError(code);
};
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', copy)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function decodePngUrl(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,'))
    return reject('format');
  const text = value.slice(22);
  if (text.length > Math.ceil(VISUAL_EVIDENCE_LIMITS.bytes / 3) * 4)
    return reject('limit');
  if (!text || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    return reject('format');
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return reject('format');
  }
  if (btoa(binary) !== text) return reject('format');
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function encodePngUrl(bytes: Uint8Array): string {
  if (bytes.byteLength > VISUAL_EVIDENCE_LIMITS.bytes) return reject('limit');
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(text);
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    x = Math.abs(p - a),
    y = Math.abs(p - b),
    z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};
/** Decode full bytes with chunk CRCs, bounded inflation and all scanline filters.
 * Ambiguous colour profiles, EXIF orientation, animation and transparency are
 * deferred families, never silently flattened or accepted as the same image.
 */
export async function pngPixelEvidence(input: Uint8Array) {
  const bytes = new Uint8Array(input);
  if (bytes.length > VISUAL_EVIDENCE_LIMITS.bytes) return reject('limit');
  if (
    bytes.length < 57 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => bytes[i] !== v)
  )
    return reject('format');
  const view = new DataView(bytes.buffer);
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    chunks = 0;
  const compressed: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (++chunks > 5000 || offset + 12 > bytes.length) return reject('format');
    const length = view.getUint32(offset),
      end = offset + length + 12;
    if (end > bytes.length) return reject('format');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
      return reject('format');
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) return reject('format');
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (
        !width ||
        !height ||
        width > VISUAL_EVIDENCE_LIMITS.edge ||
        height > VISUAL_EVIDENCE_LIMITS.edge ||
        width * height > VISUAL_EVIDENCE_LIMITS.pixels
      )
        return reject('limit');
      channels =
        bytes[offset + 17] === 2 ? 3 : bytes[offset + 17] === 6 ? 4 : 0;
      if (
        bytes[offset + 16] !== 8 ||
        !channels ||
        bytes.slice(offset + 18, offset + 21).some((v) => v !== 0)
      )
        return reject('format');
    } else if (type === 'IDAT') {
      if (!length) return reject('format');
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== bytes.length)
        return reject('format');
      ended = true;
      break;
    } else return reject('format');
    offset = end;
  }
  if (!ended) return reject('format');
  const stride = width * channels,
    expected = (stride + 1) * height;
  const scanlines = new Uint8Array(expected);
  const reader = new Blob(compressed.map((b) => new Uint8Array(b)))
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (size + part.value.length > expected) {
        await reader.cancel();
        return reject('pixels');
      }
      scanlines.set(part.value, size);
      size += part.value.length;
    }
  } catch (error) {
    if (error instanceof VisualEvidenceError) throw error;
    return reject('pixels');
  } finally {
    reader.releaseLock();
  }
  if (size !== expected) return reject('pixels');
  const raw = new Uint8Array(stride * height),
    rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (stride + 1)];
    if (filter > 4) return reject('pixels');
    for (let x = 0; x < stride; x++) {
      const position = y * stride + x,
        a = x >= channels ? raw[position - channels] : 0,
        b = y ? raw[position - stride] : 0,
        c = y && x >= channels ? raw[position - stride - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c);
      raw[position] = (scanlines[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  for (let i = 0, j = 0; i < raw.length; i += channels, j += 4) {
    if (channels === 4 && raw[i + 3] !== 255) return reject('format');
    rgba[j] = raw[i];
    rgba[j + 1] = raw[i + 1];
    rgba[j + 2] = raw[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, pixelSha256: await digest(rgba) };
}
