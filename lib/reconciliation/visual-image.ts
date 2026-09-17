/** Bound compressed images before browser decoding; no OCR value is interpreted here. */
export const VISUAL_IMAGE_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  pixels: 8_000_000,
  edge: 4096,
});
function dimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > VISUAL_IMAGE_LIMITS.edge ||
    height > VISUAL_IMAGE_LIMITS.edge ||
    width * height > VISUAL_IMAGE_LIMITS.pixels
  )
    throw new Error(
      'أبعاد الصورة تتجاوز حد القراءة المحلية: 8 ملايين بكسل و4096 بكسل لكل ضلع.',
    );
  return { width, height };
}
export function inspectVisualImage(buffer: ArrayBuffer): {
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
} {
  if (!buffer.byteLength || buffer.byteLength > VISUAL_IMAGE_LIMITS.bytes)
    throw new Error('الحد الأقصى لحجم الصورة هو 8 MB.');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  ) {
    if (
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
    )
      throw new Error('بيانات تعريف ملف PNG غير صالحة.');
    const size = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8,
      chunks = 0,
      ended = false;
    while (offset < bytes.length) {
      if (++chunks > 5000 || offset + 12 > bytes.length)
        throw new Error('بنية PNG غير مكتملة.');
      const length = view.getUint32(offset),
        type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (offset + length + 12 > bytes.length || type === 'acTL')
        throw new Error('الصورة متحركة أو بيانات PNG غير مكتملة.');
      offset += length + 12;
      if (type === 'IEND') {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!ended) throw new Error('بيانات نهاية ملف PNG غير مكتملة.');
    return { ...size, mime: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
      throw new Error('بيانات نهاية ملف JPEG غير مكتملة.');
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || bytes[offset + 2] !== 8)
          throw new Error('صيغة JPEG غير مدعومة للقراءة البصرية.');
        return {
          ...dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)),
          mime: 'image/jpeg',
        };
      }
      offset += length;
    }
    throw new Error('تعذر التحقق من أبعاد صورة JPEG قبل قراءتها.');
  }
  throw new Error('قراءة الصور تقبل PNG أو JPEG فقط. اختر ملف الصورة الأصلي.');
}
export async function renderVisualImage(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
) {
  const declared = inspectVisualImage(buffer);
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(
    new Blob([buffer], { type: declared.mime }),
  );
  try {
    signal?.throwIfAborted();
    const { width, height } = dimensions(bitmap.width, bitmap.height);
    if (
      !(
        (width === declared.width && height === declared.height) ||
        (width === declared.height && height === declared.width)
      )
    )
      throw new Error(
        'أبعاد الصورة المقروءة لا تطابق أبعادها المسجلة في بيانات الملف.',
      );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('لا يدعم المتصفح معاينة الصور.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error('تعذر إنشاء معاينة الصورة.')),
          'image/png',
        ),
      );
      signal?.throwIfAborted();
      return { page: 1, totalPages: 1, width, height, png };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
export async function pngDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(text)}`;
}
