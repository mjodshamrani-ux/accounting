import type { ArInput, ArResult } from './ar.ts';
import type JSZip from 'jszip';
import { assertSourceFile, isRecord } from './protocol.ts';
import { MAX_FILE_BYTES } from './types.ts';

export const AR_WORKER_SESSION_LIMIT = 32 * 1024 * 1024;
export const AR_WORKER_EXPORT_LIMIT = 96 * 1024 * 1024;
const keys = (value: object, expected: readonly string[]) =>
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');
function bytes(value: unknown, limit: number): asserts value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    !value.byteLength ||
    value.byteLength > limit
  )
    throw Error('AR_WORKER_BYTES');
}
const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value.length <= limit;
const legacyColumns = [
  'sheet',
  'header',
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'related',
  'description',
];
const scopeColumns = [
  'sheet',
  'header',
  'parent',
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'related',
  'open',
  'description',
];

/** Originals and choices are captured before the worker factory or any yield. */
export function snapshotArInput(input: ArInput): ArInput {
  if (
    !isRecord(input) ||
    !keys(input, ['files', 'readings', 'scope', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    throw Error('AR_WORKER_INPUT');
  if (
    !isRecord(input.scope) ||
    !keys(input.scope, [
      'entity',
      'ledger',
      'customer',
      'account',
      'currency',
      'start',
      'end',
      'confirmed',
    ]) ||
    typeof input.scope.confirmed !== 'boolean' ||
    ![
      'entity',
      'ledger',
      'customer',
      'account',
      'currency',
      'start',
      'end',
    ].every((k) => text(input.scope[k as keyof typeof input.scope], 200))
  )
    throw Error('AR_WORKER_SCOPE');
  for (const candidate of input.readings) {
    const reading: unknown = candidate;
    if (!isRecord(reading)) throw Error('AR_WORKER_READING');
    const columns =
      reading.family === 'ar-scope-details-1' ? scopeColumns : legacyColumns;
    if (
      !keys(reading, [
        ...columns,
        'role',
        'perspective',
        'basis',
        'confirmed',
        ...(reading.family === 'ar-scope-details-1' ? ['family'] : []),
      ]) ||
      !columns.every(
        (k) => Number.isSafeInteger(reading[k]) && (reading[k] as number) >= -1,
      ) ||
      !text(reading.role, 100) ||
      !text(reading.perspective, 100) ||
      !text(reading.basis, 100) ||
      typeof reading.confirmed !== 'boolean'
    )
      throw Error('AR_WORKER_READING');
  }
  for (const event of input.events)
    if (
      !isRecord(event) ||
      !keys(event, ['context', 'at', 'action', 'ids', 'note']) ||
      !text(event.context, 65536) ||
      !text(event.at, 100) ||
      !text(event.action, 10) ||
      !text(event.note, 200) ||
      !Array.isArray(event.ids) ||
      event.ids.length !== 2 ||
      !event.ids.every((id) => text(id, 1000))
    )
      throw Error('AR_WORKER_EVENT');
  const files = input.files.map((file) => {
    if (
      !isRecord(file) ||
      file.kind !== undefined ||
      !text(file.name, 255) ||
      !/\.(csv|xlsx)$/i.test(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      throw Error('AR_WORKER_SOURCE');
    bytes(file.original, MAX_FILE_BYTES);
    // Parsed caches cannot cross this boundary as authoritative source data.
    return {
      name: file.name,
      sha256: file.sha256,
      original: file.original.slice(0),
      sheets: [],
    };
  });
  return {
    files: [files[0], files[1]],
    ...structuredClone({
      readings: input.readings,
      scope: input.scope,
      events: input.events,
    }),
  };
}

export function snapshotArRequest(action: string, payload: unknown): unknown {
  if (!isRecord(payload)) throw Error('AR_WORKER_INPUT');
  if (action === 'ar-reconcile' || action === 'ar-save')
    return snapshotArInput(payload as unknown as ArInput);
  if (action === 'ar-export') {
    if (!keys(payload, ['state', 'result']) || !isRecord(payload.result))
      throw Error('AR_WORKER_INPUT');
    return {
      state: snapshotArInput(payload.state as ArInput),
      result: structuredClone(payload.result),
    };
  }
  if (action === 'ar-restore') {
    if (!keys(payload, ['buffer'])) throw Error('AR_WORKER_INPUT');
    bytes(payload.buffer, AR_WORKER_SESSION_LIMIT);
    return { buffer: payload.buffer.slice(0) };
  }
  throw Error('AR_WORKER_ACTION');
}

/** AR transport envelopes are exact, including the optional timing diagnostics. */
export function assertArWorkerReply(response: Record<string, unknown>) {
  const required =
    response.ok === true
      ? ['channel', 'id', 'action', 'ok', 'value']
      : ['channel', 'id', 'action', 'ok', 'error'];
  if (
    typeof response.ok !== 'boolean' ||
    !keys(response, [
      ...required,
      ...(Object.hasOwn(response, 'timings') ? ['timings'] : []),
    ]) ||
    (response.ok === false &&
      (!text(response.error, 4096) || !(response.error as string).trim()))
  )
    throw Error('AR_WORKER_ENVELOPE');
  if (
    Object.hasOwn(response, 'timings') &&
    (!isRecord(response.timings) ||
      Object.keys(response.timings).length > 32 ||
      Object.entries(response.timings).some(
        ([key, value]) =>
          key.length > 100 ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0,
      ))
  )
    throw Error('AR_WORKER_ENVELOPE');
}
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      keys(a, Object.keys(b)) &&
      a.every(
        (value, index) => Object.hasOwn(b, index) && same(value, b[index]),
      )
    );
  if (
    !isRecord(a) ||
    !isRecord(b) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(a)) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(b))
  )
    return false;
  return (
    keys(a, Object.keys(b)) &&
    Object.entries(a).every(([key, value]) => same(value, b[key]))
  );
}
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  return x.length === y.length && x.every((byte, index) => byte === y[index]);
};
const equalState = (a: ArInput, b: ArInput) =>
  same(
    {
      readings: a.readings,
      scope: a.scope,
      events: a.events,
      files: a.files.map((file) => ({
        name: file.name,
        sha256: file.sha256,
        kind: file.kind,
      })),
    },
    {
      readings: b.readings,
      scope: b.scope,
      events: b.events,
      files: b.files.map((file) => ({
        name: file.name,
        sha256: file.sha256,
        kind: file.kind,
      })),
    },
  ) &&
  a.files.every((file, side) =>
    sameBytes(file.original!, b.files[side].original!),
  );

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
          if (size > expectedSize) throw Error('AR_WORKER_EXPORT_CAPACITY');
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
            throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
    throw Error('AR_WORKER_EXPORT_ENVELOPE');
  const records = [];
  let cursor = raw.getUint32(end + 16, true),
    expanded = 0;
  for (let index = 0; index < raw.getUint16(end + 10, true); index++) {
    if (cursor + 46 > end || raw.getUint32(cursor, true) !== 0x02014b50)
      throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
      throw Error('AR_WORKER_EXPORT_ENVELOPE');
    expanded += uncompressed;
    if (expanded > 192 * 1024 * 1024) throw Error('AR_WORKER_EXPORT_CAPACITY');
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
  if (cursor !== end) throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
      throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
      throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
        throw Error('AR_WORKER_EXPORT_ENVELOPE');
      localEnd = descriptor + 12;
    }
  }
  if (localEnd !== raw.getUint32(end + 16, true))
    throw Error('AR_WORKER_EXPORT_ENVELOPE');
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
    throw Error('AR_WORKER_EXPORT_CAPACITY');
  const metadata = new Map(
    records.map((record) => [
      new TextDecoder('utf-8', { fatal: true }).decode(record.name),
      record,
    ]),
  );
  const contents = [];
  for (const file of entries) {
    const record = metadata.get(file.name);
    if (!record) throw Error('AR_WORKER_EXPORT_ENVELOPE');
    const content = await readExportEntry(
      file,
      record.uncompressed,
      record.crc,
    );
    contents.push([
      file.name,
      file.name === 'docProps/core.xml'
        ? content.replace(
            /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
            '$1$2',
          )
        : content,
    ]);
  }
  return contents;
}

/** Replay the submitted originals, never a self-consistent foreign state. */
export async function validateArWorkerResponse(
  action: string,
  value: unknown,
  payload: unknown,
) {
  if (!isRecord(payload)) throw Error('AR_WORKER_INPUT');
  // Copy the reply before dynamic imports or any other validation yield.
  value = structuredClone(value);
  if (action === 'ar-reconcile' || action === 'ar-restore') {
    if (
      !isRecord(value) ||
      !keys(value, ['state', 'result']) ||
      !isRecord(value.result)
    )
      throw Error('AR_WORKER_ENVELOPE');
    snapshotArInput(value.state as ArInput);
    for (const file of (value.state as ArInput).files) assertSourceFile(file);
    const io = await import('./ar-io.ts');
    const requested =
      action === 'ar-restore'
        ? await io.restoreAr(payload.buffer as ArrayBuffer)
        : await io.replayAr(payload as unknown as ArInput);
    if (
      !equalState(value.state as ArInput, requested.state) ||
      !same(value.result, requested.result)
    )
      throw Error('AR_WORKER_BINDING');
    return requested;
  }
  bytes(
    value,
    action === 'ar-save' ? AR_WORKER_SESSION_LIMIT : AR_WORKER_EXPORT_LIMIT,
  );
  const io = await import('./ar-io.ts');
  if (action === 'ar-save') {
    const requested = await io.replayAr(payload as unknown as ArInput),
      restored = await io.restoreAr(value);
    if (
      !equalState(restored.state, requested.state) ||
      !same(restored.result, requested.result)
    )
      throw Error('AR_WORKER_BINDING');
    return value;
  }
  if (action === 'ar-export') {
    const expected = await io.exportAr(
      payload.state as ArInput,
      payload.result as ArResult,
    );
    bytes(expected, AR_WORKER_EXPORT_LIMIT);
    if (!same(await inspectExport(value), await inspectExport(expected)))
      throw Error('AR_WORKER_BINDING');
    return expected;
  }
  throw Error('AR_WORKER_ACTION');
}
