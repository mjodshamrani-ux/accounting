const MAX_OUTPUT = 32 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
/** Verify actual decompressed bytes before ExcelJS allocates the workbook tree. */
export async function validateZipContents(buffer: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(buffer),
    v = new DataView(buffer);
  const fail = () => {
    throw new Error('فهرس XLSX تالف أو أرشيف غير مدعوم');
  };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) return fail();
  const count = v.getUint16(end + 10, true),
    start = v.getUint32(end + 16, true),
    size = v.getUint32(end + 12, true);
  if (
    !count ||
    count > 1000 ||
    start + size !== end ||
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    v.getUint16(end + 8, true) !== count
  )
    return fail();
  let cursor = start,
    actualTotal = 0;
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || v.getUint32(cursor, true) !== 0x02014b50)
      return fail();
    const flags = v.getUint16(cursor + 8, true),
      method = v.getUint16(cursor + 10, true),
      crc = v.getUint32(cursor + 16, true);
    const packed = v.getUint32(cursor + 20, true),
      declared = v.getUint32(cursor + 24, true);
    const nl = v.getUint16(cursor + 28, true),
      el = v.getUint16(cursor + 30, true),
      cl = v.getUint16(cursor + 32, true),
      local = v.getUint32(cursor + 42, true);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      declared > MAX_OUTPUT ||
      cursor + 46 + nl + el + cl > end ||
      local + 30 > start
    )
      return fail();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + nl),
    );
    if (
      names.has(name) ||
      /(^\/|(^|\/)\.\.(\/|$)|\\|vbaProject|externalLinks)/i.test(name)
    )
      return fail();
    names.add(name);
    if (
      v.getUint32(local, true) !== 0x04034b50 ||
      v.getUint16(local + 6, true) !== flags ||
      v.getUint16(local + 8, true) !== method
    )
      return fail();
    const lnl = v.getUint16(local + 26, true),
      lel = v.getUint16(local + 28, true),
      data = local + 30 + lnl + lel;
    if (
      data + packed > start ||
      lnl !== nl ||
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(local + 30, local + 30 + lnl),
      ) !== name
    )
      return fail();
    if (
      !(flags & 8) &&
      (v.getUint32(local + 14, true) !== crc ||
        v.getUint32(local + 18, true) !== packed ||
        v.getUint32(local + 22, true) !== declared)
    )
      return fail();
    if (ranges.some(([a, b]) => local < b && data + packed > a)) return fail();
    ranges.push([local, data + packed]);
    const content = new Blob([buffer.slice(data, data + packed)]).stream();
    const stream =
      method === 8
        ? content.pipeThrough(new DecompressionStream('deflate-raw'))
        : content;
    const reader = stream.getReader();
    let actual = 0,
      checksum = 0xffffffff;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        actual += next.value.length;
        actualTotal += next.value.length;
        if (actual > declared || actualTotal > MAX_OUTPUT)
          throw new Error(
            'محتوى XLSX الفعلي يتجاوز حجم الفك المسموح أو الحجم المعلن',
          );
        for (const b of next.value)
          checksum = (checksum >>> 8) ^ crcTable[(checksum ^ b) & 255];
      }
      if (actual !== declared || (checksum ^ 0xffffffff) >>> 0 !== crc)
        return fail();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    cursor += 46 + nl + el + cl;
  }
  if (cursor !== end) return fail();
}
