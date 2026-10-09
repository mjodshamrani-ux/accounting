import ExcelJS from 'exceljs';
import { readGatewayFile } from './payment-gateway-source.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { assertGatewayNative } from './payment-gateway-native.ts';
import {
  PG_VERSION,
  PG_SESSION_LIMIT,
  PG_SCOPE_FIELDS,
  PG_VALUE_HEADERS,
  reconcileGateway,
  assertGatewayEventBudget,
  type GatewayInput,
  type GatewayResult,
} from './payment-gateway.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('PG_SOURCE');
}
function encode(v: ArrayBuffer) {
  let s = '';
  for (const n of new Uint8Array(v)) s += String.fromCharCode(n);
  return btoa(s);
}
function decode(v: unknown) {
  if (
    typeof v !== 'string' ||
    v.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
  )
    throw Error('PG_SESSION');
  const b = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(b);
  if (encode(b) !== v) throw Error('PG_SESSION');
  return b;
}
export async function replayGateway(input: GatewayInput) {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4
  )
    throw Error('PG_INPUT');
  // Take every original and decision-defining field synchronously. The caller
  // must not be able to alter a later source or review context while hashing an
  // earlier original. Cached parsed rows are deliberately excluded.
  assertGatewayEventBudget(input.events);
  const snapshots = input.files.map((old) => {
    if (
      !plain(old) ||
      old.kind !== undefined ||
      typeof old.name !== 'string' ||
      old.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(old.name)
    )
      throw Error('PG_SOURCE');
    bytes(old.original);
    return {
      name: old.name,
      sha256: old.sha256,
      original: old.original.slice(0),
    };
  });
  const metadata = structuredClone({
    readings: input.readings,
    scope: input.scope,
    completeness: input.completeness,
    events: input.events,
  });
  const files = [];
  for (const old of snapshots) {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', old.original)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== old.sha256) throw Error('PG_SOURCE_HASH');
    const file = await readGatewayFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('PG_SOURCE_HASH');
    files.push(file);
  }
  const state: GatewayInput = {
    files: files as GatewayInput['files'],
    ...metadata,
  };
  const result = reconcileGateway(state);
  for (let i = 0; i < files.length; i++)
    await assertGatewayNative(files[i], i, result.decimals);
  for (const file of files) {
    const after = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', file.original!)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (after !== file.sha256) throw Error('PG_SOURCE_HASH');
  }
  return { state, result };
}
export async function saveGateway(input: GatewayInput) {
  const { state } = await replayGateway(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-payment-gateway-session',
      version: PG_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original!),
      })),
      readings: state.readings,
      scope: state.scope,
      completeness: state.completeness,
      events: state.events,
    }),
  ).buffer;
  bytes(data, PG_SESSION_LIMIT);
  await restoreGateway(data);
  return data;
}
export async function restoreGateway(data: ArrayBuffer) {
  bytes(data, PG_SESSION_LIMIT);
  const p: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(data),
  );
  if (
    !plain(p) ||
    !keys(p, [
      'format',
      'version',
      'files',
      'readings',
      'scope',
      'completeness',
      'events',
    ]) ||
    p.format !== 'tarasuf-payment-gateway-session' ||
    p.version !== PG_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 4
  )
    throw Error('PG_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw Error('PG_SESSION');
    const file = await readGatewayFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw Error('PG_SOURCE_HASH');
    files.push(file);
  }
  return replayGateway({
    files: files as GatewayInput['files'],
    readings: p.readings as GatewayInput['readings'],
    scope: p.scope as GatewayInput['scope'],
    completeness: p.completeness as GatewayInput['completeness'],
    events: p.events as GatewayInput['events'],
  });
}
type Value = string | number | null;
type Table = { name: string; headers: string[]; rows: Value[][] };
export async function exportGateway(
  input: GatewayInput,
  expected: GatewayResult,
) {
  const { state, result: r } = await replayGateway(input);
  if (JSON.stringify(r) !== JSON.stringify(expected))
    throw Error('PG_STALE_EXPORT');
  const counts = [
    r.cells.length,
    r.inventory.length,
    r.events.reduce((n, e) => n + e.memberIds.length, 0),
  ];
  if (counts.some((n) => n + 1 > 1_048_576)) throw Error('PG_EXPORT_ROWS');
  const tables: Table[] = [];
  const table = (name: string, headers: string[], rows: Value[][]) =>
    tables.push({ name, headers, rows });
  table(
    'Summary',
    ['Field', 'Value'],
    [
      ['Domain', 'payment-gateway-batch'],
      ['Version', r.version],
      ['Claim', r.claim],
      ['Status', r.status],
      ['Review', r.review],
      ['Decimals', r.decimals],
      ['Context', r.context],
      ...PG_SCOPE_FIELDS.map((k) => [k, r.scope[k]] as Value[]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness reason', r.completeness.note],
    ],
  );
  ['Transactions', 'Fee evidence', 'Settlement', 'Payout'].forEach((name, i) =>
    table(
      name,
      ['Record ID', 'Source', 'Source row', ...PG_VALUE_HEADERS[i]],
      r.records[i].map((e) => [e.id, e.source, e.row, ...e.values]),
    ),
  );
  table(
    'Totals',
    ['Gross sales', 'Refunds', 'Evidenced fees', 'Calculated net'],
    r.totals ? [r.totals] : [],
  );
  table(
    'Residuals',
    ['Gross sales', 'Refunds', 'Fees', 'Net', 'Bank credit'],
    r.residuals ? [r.residuals] : [],
  );
  table(
    'Missing',
    ['Kind'],
    r.missing.map((k) => [k]),
  );
  table(
    'Issues',
    ['Code', 'Source', 'Source row', 'Key'],
    r.issues.map((e) => [e.code, e.source, e.row, e.key]),
  );
  table(
    'Cell evidence',
    [
      'Source',
      'Hash',
      'Sheet',
      'Sheet name',
      'Source row',
      'Column',
      'Header',
      'Value',
    ],
    r.cells.map((c) => [
      c.source,
      r.sources[c.source].hash,
      0,
      r.sources[c.source].sheet,
      c.row,
      c.column,
      c.field,
      c.text,
    ]),
  );
  table(
    'Inventory',
    ['Source', 'Hash', 'Source row', 'Kind', 'Errors'],
    r.inventory.map((e) => [
      e.source,
      r.sources[e.source].hash,
      e.row,
      e.kind,
      e.errors.join('|'),
    ]),
  );
  table(
    'Reading',
    ['Source', 'Sheet', 'Role', 'Family', 'Confirmed'],
    r.readings.map((v, i) => [
      i,
      v.sheet,
      v.role,
      v.family,
      String(v.confirmed),
    ]),
  );
  table(
    'Events',
    [
      'Sequence',
      'Event ID',
      'Type',
      'Batch ID',
      'UTC time',
      'Reference',
      'Note',
      'Context',
    ],
    r.events.map((e, i) => [
      i + 1,
      e.id,
      e.type,
      e.batchId,
      e.at,
      e.reference,
      e.note,
      e.context,
    ]),
  );
  table(
    'Event members',
    ['Sequence', 'Event ID', 'Record ID'],
    r.events.flatMap((e, i) => e.memberIds.map((id) => [i + 1, e.id, id])),
  );
  table(
    'Sources',
    ['Source', 'Name', 'Hash', 'Chunk', 'Original base64'],
    state.files.flatMap((f, i) => {
      const data = encode(f.original!),
        rows: Value[][] = [];
      for (let offset = 0; offset < data.length; offset += 30000)
        rows.push([
          i,
          f.name,
          f.sha256!,
          offset / 30000,
          data.slice(offset, offset + 30000),
        ]);
      return rows;
    }),
  );
  for (const t of tables) {
    if (t.rows.length + 1 > 1_048_576) throw Error('PG_EXPORT_ROWS');
    for (const row of [t.headers, ...t.rows])
      for (const v of row) {
        if (typeof v === 'number' && !Number.isSafeInteger(v))
          throw Error('PG_EXPORT_CELL');
        if (
          typeof v === 'string' &&
          (v.length > 32767 ||
            Array.from(v).some((c) => {
              const n = c.codePointAt(0)!;
              return (
                (n < 32 && ![9, 10, 13].includes(n)) ||
                (n >= 0xd800 && n <= 0xdfff) ||
                n === 0xfffe ||
                n === 0xffff
              );
            }))
        )
          throw Error('PG_EXPORT_CELL');
      }
  }
  const book = new ExcelJS.Workbook();
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name);
    sheet.addRow(t.headers);
    t.rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.columns = t.headers.map(() => ({ width: 24 }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const data = await book.xlsx.writeBuffer();
  return Uint8Array.from(new Uint8Array(data)).buffer;
}
