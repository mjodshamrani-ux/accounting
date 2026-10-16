import type JSZip from 'jszip';
import type { StockInput, StockResult } from './inventory-register.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { SaxesParser } from 'saxes';
import {
  STOCK_WORKER_SESSION_LIMIT,
  STOCK_WORKER_EXPORT_LIMIT,
  snapshotStockInputRequest,
  snapshotStockTransportData,
} from './inventory-register-request.ts';
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, expected: readonly string[]) =>
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const bounded = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
function bytes(value: unknown, max: number): asserts value is ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || !value.byteLength || value.byteLength > max)
    throw Error('STOCK_WORKER_SOURCE');
}
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((byte, index) => byte === y[index]);
};
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer)
    return a instanceof ArrayBuffer && b instanceof ArrayBuffer && sameBytes(a, b);
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      keys(a, Object.keys(b)) && a.every((value, index) =>
        Object.hasOwn(b, index) && same(value, b[index]));
  if (!plain(a) || !plain(b) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(a)) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(b))) return false;
  return keys(a, Object.keys(b)) && Object.entries(a).every(([key, value]) => same(value, b[key]));
}

export function assertStockWorkerReply(response: Record<string, unknown>) {
  const required = response.ok === true
    ? ['channel', 'id', 'action', 'ok', 'value']
    : ['channel', 'id', 'action', 'ok', 'error'];
  if (
    typeof response.ok !== 'boolean' ||
    !keys(response, [...required, ...(Object.hasOwn(response, 'timings') ? ['timings'] : [])]) ||
    (response.ok === false && (!bounded(response.error, 4096) || !(response.error as string).trim()))
  ) throw Error('STOCK_WORKER_ENVELOPE');
  if (Object.hasOwn(response, 'timings') &&
    (!plain(response.timings) || Object.keys(response.timings).length > 32 ||
      Object.entries(response.timings).some(([key, value]) =>
        key.length > 100 || typeof value !== 'number' || !Number.isFinite(value) || value < 0)))
    throw Error('STOCK_WORKER_ENVELOPE');
}

function equalState(a: StockInput, b: StockInput) {
  const identity = (input: StockInput) => ({
    readings: input.readings, scope: input.scope, completeness: input.completeness,
    events: input.events,
    files: input.files.map((file) => ({ name: file.name, sha256: file.sha256, kind: file.kind })),
  });
  return same(identity(a), identity(b)) &&
    a.files.every((file, index) => sameBytes(file.original!, b.files[index].original!));
}

/** Only the two producer-controlled core timestamps can differ between exports. */
function coreProperties(xml: string) {
  const parser = new SaxesParser({ xmlns: true }), stack: string[] = [], events: unknown[] = [];
  let date = '', dateNode = false;
  parser.on('doctype', () => { throw Error('STOCK_WORKER_BINDING'); });
  parser.on('opentag', (tag) => {
    const name = `{${tag.uri}}${tag.local}`;
    dateNode = stack.length === 1 && stack[0] ===
      '{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties' &&
      tag.uri === 'http://purl.org/dc/terms/' && ['created', 'modified'].includes(tag.local);
    if (dateNode) date = '';
    events.push(['open', name, Object.values(tag.attributes)
      .filter((attribute) => attribute.uri !== 'http://www.w3.org/2000/xmlns/')
      .map((attribute) => [`{${attribute.uri}}${attribute.local}`, attribute.value])
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
    stack.push(name);
  });
  parser.on('text', (text) => {
    if (dateNode) date += text;
    else events.push(['text', text]);
  });
  parser.on('cdata', (text) => { events.push(['cdata', text]); });
  parser.on('comment', (text) => { events.push(['comment', text]); });
  parser.on('processinginstruction', (value) => { events.push(['processinginstruction', value]); });
  parser.on('closetag', (tag) => {
    if (dateNode) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date.replace('Z', '.000Z'))
        throw Error('STOCK_WORKER_BINDING');
      events.push(['text', '[export-time]']);
    }
    dateNode = false;
    events.push(['close', `{${tag.uri}}${tag.local}`]);
    stack.pop();
  });
  parser.write(xml).close();
  return JSON.stringify(events);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function readExportEntry(
  file: JSZip.JSZipObject,
  expectedSize: number,
  expectedCrc: number,
): Promise<string> {
  // JSZip's accumulating reader checks declared size after allocating. Stream
  // with a hard limit so false size metadata cannot authorize unlimited inflate.
  const stream = (
    file as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }
  ).internalStream('uint8array');
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0,
      crc = 0xffffffff;
    const parts: string[] = [];
    const fail = (error: unknown) => {
      stream.pause();
      reject(error);
    };
    stream
      .on('data', (chunk) => {
        try {
          size += chunk.byteLength;
          if (size > expectedSize) throw Error('STOCK_WORKER_EXPORT_CAPACITY');
          for (const byte of chunk)
            crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
          parts.push(decoder.decode(chunk, { stream: true }));
        } catch (error) {
          fail(error);
        }
      })
      .on('error', fail)
      .on('end', () => {
        try {
          if (size !== expectedSize || (crc ^ 0xffffffff) >>> 0 !== expectedCrc)
            throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
          parts.push(decoder.decode());
          resolve(parts.join(''));
        } catch (error) {
          fail(error);
        }
      })
      .resume();
  });
}

async function inspectExport(buffer: ArrayBuffer) {
  // A ZIP end record must terminate the transport exactly; no trailing payload.
  const raw = new DataView(buffer),
    end = buffer.byteLength - 22;
  if (
    end < 0 ||
    raw.getUint32(end, true) !== 0x06054b50 ||
    raw.getUint16(end + 20, true) !== 0 ||
    raw.getUint16(end + 4, true) !== 0 ||
    raw.getUint16(end + 6, true) !== 0 ||
    raw.getUint16(end + 8, true) !== raw.getUint16(end + 10, true) ||
    raw.getUint16(end + 10, true) > 1000 ||
    raw.getUint32(end + 12, true) + raw.getUint32(end + 16, true) !== end
  )
    throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
  const records = [];
  let cursor = raw.getUint32(end + 16, true),
    expanded = 0;
  for (let index = 0; index < raw.getUint16(end + 10, true); index++) {
    if (cursor + 46 > end || raw.getUint32(cursor, true) !== 0x02014b50)
      throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
    const nameLength = raw.getUint16(cursor + 28, true),
      extraLength = raw.getUint16(cursor + 30, true),
      commentLength = raw.getUint16(cursor + 32, true);
    const compressed = raw.getUint32(cursor + 20, true),
      uncompressed = raw.getUint32(cursor + 24, true),
      offset = raw.getUint32(cursor + 42, true),
      flags = raw.getUint16(cursor + 8, true),
      method = raw.getUint16(cursor + 10, true);
    const crc = raw.getUint32(cursor + 16, true);
    if (
      cursor + 46 + nameLength + extraLength + commentLength > end ||
      raw.getUint16(cursor + 34, true) !== 0 ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      offset === 0xffffffff
    )
      throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
    expanded += uncompressed;
    if (expanded > 192 * 1024 * 1024) throw Error('STOCK_WORKER_EXPORT_CAPACITY');
    records.push({
      offset,
      flags,
      method,
      compressed,
      uncompressed,
      crc,
      name: new Uint8Array(buffer, cursor + 46, nameLength),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
  let localEnd = 0;
  for (const record of records.sort((a, b) => a.offset - b.offset)) {
    const offset = record.offset;
    if (
      offset !== localEnd ||
      offset + 30 > end ||
      raw.getUint32(offset, true) !== 0x04034b50 ||
      raw.getUint16(offset + 6, true) !== record.flags ||
      raw.getUint16(offset + 8, true) !== record.method ||
      (!(record.flags & 8) &&
        (raw.getUint32(offset + 14, true) !== record.crc ||
          raw.getUint32(offset + 18, true) !== record.compressed ||
          raw.getUint32(offset + 22, true) !== record.uncompressed))
    )
      throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
    const nameLength = raw.getUint16(offset + 26, true),
      extraLength = raw.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    if (
      dataStart + record.compressed > raw.getUint32(end + 16, true) ||
      nameLength !== record.name.length ||
      record.name.some(
        (byte, index) => byte !== raw.getUint8(offset + 30 + index),
      )
    )
      throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
    localEnd = dataStart + record.compressed;
    if (record.flags & 8) {
      const descriptor =
        localEnd + (raw.getUint32(localEnd, true) === 0x08074b50 ? 4 : 0);
      if (
        descriptor + 12 > raw.getUint32(end + 16, true) ||
        raw.getUint32(descriptor, true) !== record.crc ||
        raw.getUint32(descriptor + 4, true) !== record.compressed ||
        raw.getUint32(descriptor + 8, true) !== record.uncompressed
      )
        throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
      localEnd = descriptor + 12;
    }
  }
  if (localEnd !== raw.getUint32(end + 16, true))
    throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((file) => !file.dir)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (
    Object.keys(zip.files).length !== raw.getUint16(end + 10, true) ||
    entries.length > 1000 ||
    entries.some((file) => file.name !== file.unsafeOriginalName) ||
    entries.reduce(
      (size, file) =>
        size +
        ((file as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize ?? Infinity),
      0,
    ) >
      192 * 1024 * 1024
  )
    throw Error('STOCK_WORKER_EXPORT_CAPACITY');
  const metadata = new Map(
    records.map((record) => [
      new TextDecoder('utf-8', { fatal: true }).decode(record.name),
      record,
    ]),
  );
  const contents = [];
  for (const file of entries) {
    const record = metadata.get(file.name);
    if (!record) throw Error('STOCK_WORKER_EXPORT_ENVELOPE');
    const content = await readExportEntry(
      file,
      record.uncompressed,
      record.crc,
    );
    contents.push([
      file.name,
      file.name === 'docProps/core.xml'
        ? coreProperties(content)
        : content,
    ]);
  }
  return contents;
}

export async function sameStockWorkbook(actual: ArrayBuffer, expected: ArrayBuffer) {
  return same(await inspectExport(actual), await inspectExport(expected));
}

/** No reply cache or valid foreign scope can replace the captured caller. */
export async function validateStockWorkerResponse(action: string, value: unknown, payload: unknown) {
  if (!plain(payload)) throw Error('STOCK_WORKER_INPUT');
  // Own every returned field used after a yield. Parsed caches remain disposable.
  let captured: unknown;
  if (action === 'stock-reconcile' || action === 'stock-restore') {
    if (!plain(value) || !keys(value, ['state', 'result']) || !plain(value.result))
      throw Error('STOCK_WORKER_ENVELOPE');
    captured = { state: snapshotStockInputRequest(value.state as StockInput), result: snapshotStockTransportData(value.result) };
  } else if (action === 'stock-read') {
    if (!plain(value)) throw Error('STOCK_WORKER_ENVELOPE');
    bytes(value.original, MAX_FILE_BYTES);
    captured = snapshotStockTransportData(value);
    assertSourceFile(captured);
  } else {
    bytes(value, action === 'stock-save' ? STOCK_WORKER_SESSION_LIMIT : STOCK_WORKER_EXPORT_LIMIT);
    captured = value.slice(0);
  }
  const io = await import('./inventory-register-io.ts');
  if (action === 'stock-read') {
    const returned = captured as import('./types.ts').SourceFile;
    if (returned.name !== payload.name || !sameBytes(returned.original!, payload.buffer as ArrayBuffer))
      throw Error('STOCK_WORKER_BINDING');
    const fresh = await io.readStockFile(payload.name as string, payload.buffer as ArrayBuffer);
    if (!same(returned, fresh)) throw Error('STOCK_WORKER_BINDING');
    return fresh;
  }
  if (action === 'stock-reconcile' || action === 'stock-restore') {
    const returned = captured as { state: StockInput; result: StockResult };
    const requested = action === 'stock-restore'
      ? await io.restoreStock(payload.buffer as ArrayBuffer)
      : await io.replayStock(payload as unknown as StockInput);
    if (!equalState(returned.state, requested.state) || !same(returned.result, requested.result))
      throw Error('STOCK_WORKER_BINDING');
    return requested;
  }
  if (action === 'stock-save') {
    const requested = await io.replayStock(payload as unknown as StockInput),
      restored = await io.restoreStock(captured as ArrayBuffer);
    if (!equalState(restored.state, requested.state) || !same(restored.result, requested.result))
      throw Error('STOCK_WORKER_BINDING');
    return captured;
  }
  if (action === 'stock-export') {
    const expected = await io.exportStock(payload.state as StockInput, payload.result as StockResult);
    if (!await sameStockWorkbook(captured as ArrayBuffer, expected)) throw Error('STOCK_WORKER_BINDING');
    return expected;
  }
  throw Error('STOCK_WORKER_ACTION');
}
