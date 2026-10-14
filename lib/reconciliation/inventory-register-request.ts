import {
  assertStockEventBudget,
  STOCK_FIELDS,
  type StockInput,
} from './inventory-register.ts';
import { MAX_FILE_BYTES } from './types.ts';

export const STOCK_WORKER_SESSION_LIMIT = 64 * 1024 * 1024;
export const STOCK_WORKER_EXPORT_LIMIT = 96 * 1024 * 1024;
// A transport limit, not a capacity benchmark: one million exported cell
// evidence objects alone use roughly six million visited nodes.
export const STOCK_WORKER_RESULT_NODE_LIMIT = 8000000;
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, expected: readonly string[]) =>
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const bounded = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max;
function bytes(value: unknown, max: number): asserts value is ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || !value.byteLength || value.byteLength > max)
    throw Error('STOCK_WORKER_SOURCE');
}
/** Bound untrusted cached results before taking an owned transport copy. */
export function snapshotStockTransportData(value: unknown): unknown {
  let nodes = 0, characters = 0;
  const visit = (current: unknown, depth: number) => {
    if (++nodes > STOCK_WORKER_RESULT_NODE_LIMIT || depth > 20) throw Error('STOCK_WORKER_ENVELOPE');
    if (typeof current === 'string') {
      characters += current.length;
      if (current.length > 65536 || characters > 48 * 1024 * 1024)
        throw Error('STOCK_WORKER_ENVELOPE');
      return;
    }
    if (current === null || typeof current === 'boolean' || current === undefined) return;
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (current instanceof ArrayBuffer) {
      bytes(current, MAX_FILE_BYTES);
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > 2000000) throw Error('STOCK_WORKER_ENVELOPE');
      for (const child of current) visit(child, depth + 1);
      return;
    }
    if (!plain(current) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(current)) ||
      Object.keys(current).length > 2000000) throw Error('STOCK_WORKER_ENVELOPE');
    for (const [key, child] of Object.entries(current)) {
      if (key.length > 128) throw Error('STOCK_WORKER_ENVELOPE');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return structuredClone(value);
}

/** Authoritative originals and choices are owned before the worker factory. */
export function snapshotStockInputRequest(input: StockInput): StockInput {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) || input.files.length !== 4 ||
    !Array.isArray(input.readings) || input.readings.length !== 4
  ) throw Error('STOCK_WORKER_INPUT');
  assertStockEventBudget(input.events);
  if (
    !plain(input.scope) || !keys(input.scope, [...STOCK_FIELDS, 'confirmed']) ||
    typeof input.scope.confirmed !== 'boolean' ||
    !STOCK_FIELDS.every((key) => bounded(input.scope[key], 500)) ||
    !plain(input.completeness) ||
    !keys(input.completeness, ['confirmed', 'reference', 'note']) ||
    typeof input.completeness.confirmed !== 'boolean' ||
    !bounded(input.completeness.reference, 2000) || !bounded(input.completeness.note, 2000)
  ) throw Error('STOCK_WORKER_CONTEXT');
  for (const reading of input.readings)
    if (
      !plain(reading) || !keys(reading, ['sheet', 'role', 'family', 'confirmed']) ||
      reading.sheet !== 0 || !bounded(reading.role, 100) ||
      !bounded(reading.family, 100) || typeof reading.confirmed !== 'boolean'
    ) throw Error('STOCK_WORKER_READING');
  for (const event of input.events)
    if (
      !plain(event) ||
      !keys(event, ['id', 'type', 'memberIds', 'context', 'at', 'reference', 'note']) ||
      !bounded(event.id, 500) || !bounded(event.type, 10) ||
      !bounded(event.context, 65536) || !bounded(event.at, 100) ||
      !bounded(event.reference, 2000) || !bounded(event.note, 2000) ||
      !event.memberIds.every((id) => bounded(id, 500))
    ) throw Error('STOCK_WORKER_EVENT');
  const files = input.files.map((file) => {
    if (
      !plain(file) || file.kind !== undefined ||
      Object.keys(file).some((key) => !['name', 'sha256', 'original', 'sheets', 'kind'].includes(key)) ||
      !bounded(file.name, 255) ||
      !file.name || !/\.(csv|xlsx)$/i.test(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    ) throw Error('STOCK_WORKER_SOURCE');
    bytes(file.original, MAX_FILE_BYTES);
    return {
      name: file.name, sha256: file.sha256, original: file.original.slice(0), sheets: [],
    };
  });
  return {
    files: [files[0], files[1], files[2], files[3]],
    ...structuredClone({
      readings: input.readings, scope: input.scope,
      completeness: input.completeness, events: input.events,
    }),
  };
}

export function snapshotStockRequest(action: string, payload: unknown): unknown {
  if (!plain(payload)) throw Error('STOCK_WORKER_INPUT');
  if (action === 'stock-reconcile' || action === 'stock-save')
    return snapshotStockInputRequest(payload as unknown as StockInput);
  if (action === 'stock-export') {
    if (!keys(payload, ['state', 'result']) || !plain(payload.result))
      throw Error('STOCK_WORKER_INPUT');
    return { state: snapshotStockInputRequest(payload.state as StockInput), result: snapshotStockTransportData(payload.result) };
  }
  if (action === 'stock-read' || action === 'stock-restore') {
    if (!keys(payload, action === 'stock-read' ? ['name', 'buffer'] : ['buffer']))
      throw Error('STOCK_WORKER_INPUT');
    bytes(payload.buffer, action === 'stock-read' ? MAX_FILE_BYTES : STOCK_WORKER_SESSION_LIMIT);
    if (action === 'stock-read' &&
      (!bounded(payload.name, 255) || !/\.(csv|xlsx)$/i.test(payload.name as string)))
      throw Error('STOCK_WORKER_SOURCE');
    return { ...payload, buffer: payload.buffer.slice(0) };
  }
  throw Error('STOCK_WORKER_ACTION');
}
