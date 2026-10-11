import {
  assertGatewayEventBudget,
  PG_SCOPE_FIELDS,
  PG_SESSION_LIMIT,
  type GatewayInput,
} from './payment-gateway.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { assertSourceFile } from './protocol.ts';

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const bounded = (v: unknown, limit: number) =>
  typeof v === 'string' && v.length <= limit;
function bytes(v: unknown, max: number): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('PG_WORKER_SOURCE');
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Capture authoritative originals synchronously, before even the worker factory. */
export function snapshotGatewayInput(input: GatewayInput): GatewayInput {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4
  )
    throw Error('PG_WORKER_INPUT');
  assertGatewayEventBudget(input.events);
  if (
    !plain(input.scope) ||
    !keys(input.scope, [...PG_SCOPE_FIELDS, 'confirmed']) ||
    typeof input.scope.confirmed !== 'boolean' ||
    !PG_SCOPE_FIELDS.every((k) => bounded(input.scope[k], 500)) ||
    !plain(input.completeness) ||
    !keys(input.completeness, ['confirmed', 'reference', 'note']) ||
    typeof input.completeness.confirmed !== 'boolean' ||
    !bounded(input.completeness.reference, 2000) ||
    !bounded(input.completeness.note, 2000)
  )
    throw Error('PG_WORKER_CONTEXT');
  for (const r of input.readings)
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.sheet !== 0 ||
      !bounded(r.role, 100) ||
      !bounded(r.family, 100) ||
      typeof r.confirmed !== 'boolean'
    )
      throw Error('PG_WORKER_READING');
  for (const e of input.events)
    if (
      !keys(e, [
        'id',
        'type',
        'batchId',
        'memberIds',
        'context',
        'at',
        'reference',
        'note',
      ]) ||
      !bounded(e.id, 500) ||
      !bounded(e.type, 10) ||
      !bounded(e.batchId, 500) ||
      !bounded(e.context, 65536) ||
      !bounded(e.at, 100) ||
      !bounded(e.reference, 2000) ||
      !bounded(e.note, 2000) ||
      !e.memberIds.every((id) => bounded(id, 500))
    )
      throw Error('PG_WORKER_EVENT');
  const files = input.files.map((f) => {
    if (
      !plain(f) ||
      f.kind !== undefined ||
      !bounded(f.name, 255) ||
      !/\.(csv|xlsx)$/i.test(f.name) ||
      !/^[a-f0-9]{64}$/.test(f.sha256 ?? '')
    )
      throw Error('PG_WORKER_SOURCE');
    bytes(f.original, MAX_FILE_BYTES);
    return {
      name: f.name,
      sha256: f.sha256,
      original: f.original.slice(0),
      sheets: [],
    };
  });
  return {
    files: [files[0], files[1], files[2], files[3]],
    ...structuredClone({
      readings: input.readings,
      scope: input.scope,
      completeness: input.completeness,
      events: input.events,
    }),
  };
}

export function snapshotGatewayRequest(
  action: string,
  payload: unknown,
): unknown {
  if (!plain(payload)) throw Error('PG_WORKER_INPUT');
  if (action === 'gateway-reconcile' || action === 'gateway-save')
    return snapshotGatewayInput(payload as unknown as GatewayInput);
  if (action === 'gateway-export') {
    if (!keys(payload, ['state', 'result']) || !plain(payload.result))
      throw Error('PG_WORKER_INPUT');
    return {
      state: snapshotGatewayInput(payload.state as GatewayInput),
      result: structuredClone(payload.result),
    };
  }
  if (action === 'gateway-read' || action === 'gateway-restore') {
    if (
      !keys(
        payload,
        action === 'gateway-read' ? ['name', 'buffer'] : ['buffer'],
      )
    )
      throw Error('PG_WORKER_INPUT');
    bytes(
      payload.buffer,
      action === 'gateway-read' ? MAX_FILE_BYTES : PG_SESSION_LIMIT,
    );
    if (
      action === 'gateway-read' &&
      (!bounded(payload.name, 255) ||
        !/\.(csv|xlsx)$/i.test(payload.name as string))
    )
      throw Error('PG_WORKER_SOURCE');
    return { ...payload, buffer: payload.buffer.slice(0) };
  }
  throw Error('PG_WORKER_ACTION');
}

function assertReturnedInput(input: unknown): asserts input is GatewayInput {
  if (!plain(input) || !Array.isArray(input.files) || input.files.length !== 4)
    throw Error('PG_WORKER_ENVELOPE');
  // Bound transport before async rereads or decoding an attacker-selected source.
  snapshotGatewayInput(input as unknown as GatewayInput);
  for (const file of input.files) {
    assertSourceFile(file);
    bytes(file.original, MAX_FILE_BYTES);
  }
}
const equalState = (a: GatewayInput, b: GatewayInput) => {
  const identity = (v: GatewayInput) => ({
    readings: v.readings,
    scope: v.scope,
    completeness: v.completeness,
    events: v.events,
    files: v.files.map((f) => ({
      name: f.name,
      sha256: f.sha256,
      kind: f.kind,
    })),
  });
  return (
    same(identity(a), identity(b)) &&
    a.files.every((f, i) => sameBytes(f.original!, b.files[i].original!))
  );
};

/** Never install a coherent result from another caller/session. */
export async function validateGatewayWorkerResponse(
  action: string,
  value: unknown,
  payload: unknown,
) {
  if (!plain(payload)) throw Error('PG_WORKER_INPUT');
  const io = await import('./payment-gateway-io.ts');
  if (action === 'gateway-read') {
    assertSourceFile(value);
    bytes(value.original, MAX_FILE_BYTES);
    if (
      value.name !== payload.name ||
      !sameBytes(value.original, payload.buffer as ArrayBuffer)
    )
      throw Error('PG_WORKER_BINDING');
    const { readGatewayFile } = await import('./payment-gateway-source.ts');
    const fresh = await readGatewayFile(
      payload.name as string,
      payload.buffer as ArrayBuffer,
    );
    if (!same(value, fresh)) throw Error('PG_WORKER_BINDING');
    return fresh;
  }
  if (action === 'gateway-reconcile' || action === 'gateway-restore') {
    if (
      !plain(value) ||
      !keys(value, ['state', 'result']) ||
      !plain(value.result)
    )
      throw Error('PG_WORKER_ENVELOPE');
    assertReturnedInput(value.state);
    const requested =
      action === 'gateway-restore'
        ? await io.restoreGateway(payload.buffer as ArrayBuffer)
        : await io.replayGateway(payload as unknown as GatewayInput);
    if (
      !equalState(value.state, requested.state) ||
      !same(value.result, requested.result)
    )
      throw Error('PG_WORKER_BINDING');
    // Disposable parsed sheets cannot become authoritative by passing an envelope check.
    return requested;
  }
  bytes(value, action === 'gateway-save' ? PG_SESSION_LIMIT : 96 * 1024 * 1024);
  if (action === 'gateway-save') {
    const requested = await io.replayGateway(
        payload as unknown as GatewayInput,
      ),
      restored = await io.restoreGateway(value);
    if (
      !equalState(restored.state, requested.state) ||
      !same(restored.result, requested.result)
    )
      throw Error('PG_WORKER_BINDING');
    return value;
  }
  if (action === 'gateway-export') {
    const expected = await io.exportGateway(
      payload.state as GatewayInput,
      payload.result as import('./payment-gateway.ts').GatewayResult,
    );
    const { default: JSZip } = await import('jszip');
    const { default: ExcelJS } = await import('exceljs');
    const inspect = async (buffer: ArrayBuffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      if (
        entries.reduce(
          (n, f) =>
            n +
            ((f as unknown as { _data?: { uncompressedSize?: number } })._data
              ?.uncompressedSize ?? 0),
          0,
        ) >
        192 * 1024 * 1024
      )
        throw Error('PG_WORKER_EXPORT_CAPACITY');
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
      return {
        entries: entries.map((f) => f.name).sort(),
        sheets: book.worksheets.map((sheet) => sheet.model),
      };
    };
    if (!same(await inspect(value), await inspect(expected)))
      throw Error('PG_WORKER_BINDING');
    // Regenerated caller-bound bytes are the only downloadable output.
    return expected;
  }
  throw Error('PG_WORKER_ACTION');
}
