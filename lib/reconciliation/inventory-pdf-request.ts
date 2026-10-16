import {
  assertStockEventBudget,
  STOCK_FIELDS,
  type StockScope,
  type StockEvent,
  type StockInput,
  type StockResult,
} from './inventory-register.ts';
import { MAX_FILE_BYTES } from './types.ts';

export const STOCK_PDF_LIFECYCLE_VERSION = 'inventory-pdf-lifecycle-1';
export const STOCK_PDF_SESSION_FORMAT = 'tarasuf-inventory-pdf-session';
export const STOCK_PDF_SESSION_LIMIT = 64 * 1024 * 1024;
export const STOCK_PDF_EXPORT_LIMIT = 96 * 1024 * 1024;
export type StockPdfExportRequest = {
  state: StockPdfState;
  result: StockResult;
  language?: 'ar' | 'en';
};
export type StockPdfAskRequest = {
  state: StockPdfState;
  result: StockResult;
  question: string;
};
export type StockPdfReadRequest = { name: string; buffer: ArrayBuffer };
export type StockPdfState = {
  version: typeof STOCK_PDF_LIFECYCLE_VERSION;
  files: [
    { name: string; sha256: string; original: ArrayBuffer },
    { name: string; sha256: string; original: ArrayBuffer },
    { name: string; sha256: string; original: ArrayBuffer },
    { name: string; sha256: string; original: ArrayBuffer },
  ];
  scope: StockScope;
  completeness: StockInput['completeness'];
  events: StockEvent[];
};
export const pdfPlain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const pdfKeys = (v: object, expected: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const text = (v: unknown, limit: number) =>
  typeof v === 'string' && v.length <= limit;
export function pdfBytes(
  v: unknown,
  limit = MAX_FILE_BYTES,
): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > limit)
    throw Error('STOCK_PDF_SOURCE');
}
/** No caller geometry, parsed cache, result or alternate reading is accepted. */
export function snapshotStockPdfState(value: unknown): StockPdfState {
  if (
    !pdfPlain(value) ||
    !pdfKeys(value, ['version', 'files', 'scope', 'completeness', 'events']) ||
    value.version !== STOCK_PDF_LIFECYCLE_VERSION ||
    !Array.isArray(value.files) ||
    value.files.length !== 4 ||
    !pdfKeys(value.files, ['0', '1', '2', '3'])
  )
    throw Error('STOCK_PDF_REQUEST');
  const { scope, completeness, events } = value;
  assertStockEventBudget(events);
  if (
    !pdfPlain(scope) ||
    !pdfKeys(scope, [...STOCK_FIELDS, 'confirmed']) ||
    scope.confirmed !== true ||
    !STOCK_FIELDS.every((k) => text(scope[k], 500)) ||
    !pdfPlain(completeness) ||
    !pdfKeys(completeness, ['confirmed', 'reference', 'note']) ||
    typeof completeness.confirmed !== 'boolean' ||
    !text(completeness.reference, 2000) ||
    !text(completeness.note, 2000)
  )
    throw Error('STOCK_PDF_CONTEXT');
  for (const e of events as StockEvent[]) {
    if (
      !pdfPlain(e) ||
      !pdfKeys(e, [
        'id',
        'type',
        'memberIds',
        'context',
        'at',
        'reference',
        'note',
      ]) ||
      !text(e.id, 500) ||
      !text(e.type, 10) ||
      !text(e.context, 65536) ||
      !text(e.at, 100) ||
      !text(e.reference, 2000) ||
      !text(e.note, 2000) ||
      !e.memberIds.every((v) => text(v, 500))
    )
      throw Error('STOCK_PDF_EVENT');
  }
  const files = value.files.map((f, i) => {
    if (
      !pdfPlain(f) ||
      !pdfKeys(f, ['name', 'original', 'sha256']) ||
      !text(f.name, 255) ||
      !(i === 0 ? /\.pdf$/i : /\.csv$/i).test(f.name as string) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw Error('STOCK_PDF_SOURCE');
    pdfBytes(f.original);
    return {
      name: f.name as string,
      sha256: f.sha256,
      original: f.original.slice(0),
    };
  });
  return {
    version: STOCK_PDF_LIFECYCLE_VERSION,
    files: files as StockPdfState['files'],
    ...structuredClone({ scope, completeness, events }),
  } as StockPdfState;
}
export function snapshotStockPdfRequest(
  action: string,
  payload: unknown,
):
  | StockPdfState
  | { buffer: ArrayBuffer }
  | StockPdfExportRequest
  | StockPdfReadRequest
  | StockPdfAskRequest {
  if (action === 'stock-pdf-read') {
    if (
      !pdfPlain(payload) ||
      !pdfKeys(payload, ['name', 'buffer']) ||
      !text(payload.name, 255) ||
      !/\.pdf$/i.test(payload.name as string)
    )
      throw Error('STOCK_PDF_READ_REQUEST');
    pdfBytes(payload.buffer);
    return { name: payload.name as string, buffer: payload.buffer.slice(0) };
  }
  if (action === 'stock-pdf-ask') {
    if (
      !pdfPlain(payload) ||
      !pdfKeys(payload, ['state', 'result', 'question']) ||
      !text(payload.question, 2000) ||
      !pdfPlain(payload.result)
    )
      throw Error('STOCK_PDF_ASK_REQUEST');
    return {
      state: snapshotStockPdfState(payload.state),
      result: snapshotStockPdfTransport(payload.result) as StockResult,
      question: payload.question as string,
    };
  }
  if (action === 'stock-pdf-reconcile' || action === 'stock-pdf-save')
    return snapshotStockPdfState(payload);
  if (action === 'stock-pdf-export') {
    if (
      !pdfPlain(payload) ||
      !(
        pdfKeys(payload, ['state', 'result']) ||
        pdfKeys(payload, ['state', 'result', 'language'])
      ) ||
      (Object.hasOwn(payload, 'language') &&
        !['ar', 'en'].includes(payload.language as string)) ||
      !pdfPlain(payload.result)
    )
      throw Error('STOCK_PDF_EXPORT_REQUEST');
    // Capture both choices and expected evidence synchronously before replay.
    return {
      state: snapshotStockPdfState(payload.state),
      result: snapshotStockPdfTransport(payload.result) as StockResult,
      ...(Object.hasOwn(payload, 'language')
        ? { language: payload.language as 'ar' | 'en' }
        : {}),
    };
  }
  if (
    action !== 'stock-pdf-restore' ||
    !pdfPlain(payload) ||
    !pdfKeys(payload, ['buffer'])
  )
    throw Error('STOCK_PDF_ACTION');
  pdfBytes(payload.buffer, STOCK_PDF_SESSION_LIMIT);
  return { buffer: payload.buffer.slice(0) };
}
/** PDF glyph text has a document budget of two million UTF-16 units. */
export function snapshotStockPdfTransport(value: unknown): unknown {
  let nodes = 0,
    characters = 0;
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 8000000 || depth > 24) throw Error('STOCK_PDF_ENVELOPE');
    if (typeof v === 'string') {
      characters += v.length;
      if (v.length > 2000000 || characters > 48 * 1024 * 1024)
        throw Error('STOCK_PDF_ENVELOPE');
      return;
    }
    if (
      v === null ||
      typeof v === 'boolean' ||
      v === undefined ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return;
    if (v instanceof ArrayBuffer) {
      pdfBytes(v);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > 2000000) throw Error('STOCK_PDF_ENVELOPE');
      for (const child of v) visit(child, depth + 1);
      return;
    }
    if (!pdfPlain(v) || Object.keys(v).length > 2000000)
      throw Error('STOCK_PDF_ENVELOPE');
    for (const [k, child] of Object.entries(v)) {
      if (k.length > 128) throw Error('STOCK_PDF_ENVELOPE');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return structuredClone(value);
}
export function sameStockPdfData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (
      !(a instanceof ArrayBuffer) ||
      !(b instanceof ArrayBuffer) ||
      a.byteLength !== b.byteLength
    )
      return false;
    const right = new Uint8Array(b);
    return new Uint8Array(a).every((v, i) => v === right[i]);
  }
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      pdfKeys(a, Object.keys(b)) &&
      a.every((v, i) => Object.hasOwn(b, i) && sameStockPdfData(v, b[i]))
    );
  return (
    pdfPlain(a) &&
    pdfPlain(b) &&
    pdfKeys(a, Object.keys(b)) &&
    Object.entries(a).every(([k, v]) => sameStockPdfData(v, b[k]))
  );
}
