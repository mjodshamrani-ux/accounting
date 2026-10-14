import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { bindInventorySectionNative } from './inventory-section-native.ts';
import { snapshotStockInputRequest } from './inventory-register-request.ts';
import {
  stockSectionCitationRows,
  STOCK_SECTION_CITATION_HEADERS,
  stockSourceObservations,
  STOCK_SOURCE_OBSERVATION_HEADERS,
} from './inventory-section-evidence.ts';
import {
  stockMatrixCitationRows,
  STOCK_MATRIX_CITATION_HEADERS,
} from './inventory-matrix-evidence.ts';
import { stockCSV } from './inventory-register-csv.ts';
import {
  STOCK_VERSION,
  STOCK_FIELDS,
  STOCK_VALUES,
  STOCK_ROLES,
  reconcileStock,
  assertStockEventBudget,
  type StockInput,
  type StockResult,
} from './inventory-register.ts';
import { MAX_FILE_BYTES } from './types.ts';
const LIMIT = 64 * 1024 * 1024;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('STOCK_SOURCE');
}
const hash = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
export async function readStockFile(name: string, original: ArrayBuffer) {
  bytes(original);
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 255 ||
    !/\.(?:csv|xlsx)$/i.test(name)
  )
    throw Error('STOCK_SOURCE');
  const snapshot = original.slice(0);
  if (/\.xlsx$/i.test(name)) {
    const source = await readFile(
      name,
      snapshot,
      undefined,
      false,
      undefined,
      32767,
    );
    if (source.sheets.length !== 1) throw Error('STOCK_SOURCE');
    return bindInventorySectionNative(source);
  }
  const rows = stockCSV(snapshot);
  return {
    name,
    original: snapshot,
    sha256: await hash(snapshot),
    sheets: [{ name: 'CSV', rows, formulaRows: [], hiddenRows: [] }],
  };
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
    throw Error('STOCK_SESSION');
  const data = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(data);
  if (encode(data) !== v) throw Error('STOCK_SESSION');
  return data;
}
export async function replayStock(input: StockInput) {
  // Bound and own original bytes and choices before the first await. Parsed
  // caches are disposable; neither a forged cache nor an empty one is truth.
  const captured = snapshotStockInputRequest(input);
  const snapshots = captured.files;
  const metadata = {
    readings: captured.readings,
    scope: captured.scope,
    completeness: captured.completeness,
    events: captured.events,
  };
  const files = [];
  for (const f of snapshots) {
    const file = await readStockFile(f.name, f.original!);
    if (file.sha256 !== f.sha256) throw Error('STOCK_SOURCE_HASH');
    files.push(file);
  }
  const state: StockInput = {
    files: [files[0], files[1], files[2], files[3]],
    ...metadata,
  };
  return { state, result: reconcileStock(state) };
}
export async function saveStock(input: StockInput) {
  const { state } = await replayStock(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-inventory-register-session',
      version: STOCK_VERSION,
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
  bytes(data, LIMIT);
  await restoreStock(data);
  return data;
}
export async function restoreStock(original: ArrayBuffer) {
  bytes(original, LIMIT);
  const snapshot = original.slice(0),
    parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(snapshot),
    );
  if (
    !plain(parsed) ||
    !keys(parsed, [
      'format',
      'version',
      'files',
      'readings',
      'scope',
      'completeness',
      'events',
    ]) ||
    parsed.format !== 'tarasuf-inventory-register-session' ||
    parsed.version !== STOCK_VERSION ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 4
  )
    throw Error('STOCK_SESSION');
  assertStockEventBudget(parsed.events);
  // Decode all sources synchronously so no field of the session can be read
  // from a caller-owned buffer after hashing another source.
  const snapshots = parsed.files.map((f) => {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      !/\.(?:csv|xlsx)$/i.test(f.name) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw Error('STOCK_SESSION');
    return { name: f.name, sha256: f.sha256, original: decode(f.data) };
  });
  const files = [];
  for (const f of snapshots) {
    const file = await readStockFile(f.name, f.original!);
    if (file.sha256 !== f.sha256) throw Error('STOCK_SOURCE_HASH');
    files.push(file);
  }
  return replayStock({
    files: [files[0], files[1], files[2], files[3]],
    readings: parsed.readings as StockInput['readings'],
    scope: parsed.scope as StockInput['scope'],
    completeness: parsed.completeness as StockInput['completeness'],
    events: parsed.events as StockInput['events'],
  });
}
type Value = string | number | null;
export async function exportStock(input: StockInput, expected: StockResult) {
  const expectedSnapshot = JSON.stringify(expected);
  const { state, result: r } = await replayStock(input);
  if (JSON.stringify(r) !== expectedSnapshot) throw Error('STOCK_STALE_EXPORT');
  if (r.cells.length + 1 > 1048576 || r.inventory.length + 1 > 1048576)
    throw Error('STOCK_EXPORT_CAPACITY');
  const tables: { name: string; headers: string[]; rows: Value[][] }[] = [];
  const table = (name: string, headers: string[], rows: Value[][]) =>
    tables.push({ name, headers, rows });
  table(
    'Summary',
    ['Field', 'Value'],
    [
      ['Version', r.version],
      [
        'Claim',
        'Supplied posted carrying value consistency with evidenced mapping and selected inventory GL accounts; no valuation, quantity aggregation, posting or completeness opinion',
      ],
      ['Status', r.status],
      ['Financial', r.financial],
      ['Review', r.review],
      ['Context', r.context],
      ['Decimals', r.decimals],
      ...STOCK_FIELDS.map((k) => [k, r.scope[k]] as Value[]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness note', r.completeness.note],
      ['Register minor', r.totals?.registerMinor ?? null],
      ...(r.sectionEvidence || r.matrixEvidence
        ? [
            [
              'Register minor basis',
              'Only values with proven item/dimension mapping and policy evidence contribute; see Register for all supplied parsed values',
            ] as Value[],
          ]
        : []),
      ['GL minor', r.totals?.glMinor ?? null],
    ],
  );
  const units: Record<string, string> = {
    Quantity: 'Quantity scaled integer',
    'Posted value': 'Posted value minor',
    Debit: 'Debit minor',
    Credit: 'Credit minor',
  };
  ['Register', 'Mapping', 'Policy evidence', 'GL balances'].forEach((name, i) =>
    table(
      name,
      [
        'Record ID',
        'Source',
        'Source row',
        ...(i === 0 && r.matrixEvidence ? ['Source column'] : []),
        ...STOCK_VALUES[i].map((h) => units[h] ?? h),
      ],
      r.records[i].map((v) => [
        v.id,
        v.source,
        v.row,
        ...(i === 0 && r.matrixEvidence ? [v.column ?? null] : []),
        ...v.values,
      ]),
    ),
  );
  table(
    'Account comparisons',
    [
      'GL account',
      'GL dimensions',
      'Register minor',
      'Debit minor',
      'Credit minor',
      'GL minor',
      'Difference minor',
    ],
    r.comparisons.map((v) => [
      v.account,
      v.dimensions,
      v.registerMinor,
      v.debitMinor,
      v.creditMinor,
      v.glMinor,
      v.differenceMinor,
    ]),
  );
  table(
    'Missing',
    ['Missing'],
    r.missing.map((v) => [v]),
  );
  table(
    'Issues',
    [
      'Source',
      'Source row',
      ...(r.matrixEvidence ? ['Source column'] : []),
      'Code',
    ],
    r.issues.map((v) => [
      v.source,
      v.row,
      ...(r.matrixEvidence ? [v.column ?? null] : []),
      v.code,
    ]),
  );
  table(
    'Cell evidence',
    ['Source', 'Source row', 'Column', 'Field', 'Text'],
    r.cells.map((v) => [v.source, v.row, v.column, v.field, v.text]),
  );
  table(
    'Inventory',
    ['Source', 'Source row', 'Kind'],
    r.inventory.map((v) => [v.source, v.row, v.kind]),
  );
  table(
    'Reading',
    ['Source', 'Role', 'Family', 'Sheet', 'Confirmed'],
    r.readings.map((v, i) => [
      i,
      v.role,
      v.family,
      v.sheet,
      String(v.confirmed),
    ]),
  );
  table(
    'Events',
    ['Event ID', 'Type', 'Context', 'At', 'Reference', 'Note', 'Member count'],
    r.events.map((v) => [
      v.id,
      v.type,
      v.context,
      v.at,
      v.reference,
      v.note,
      v.memberIds.length,
    ]),
  );
  table(
    'Event members',
    ['Event ID', 'Member ID'],
    r.events.flatMap((v) => v.memberIds.map((id) => [v.id, id])),
  );
  const sources: Value[][] = [];
  state.files.forEach((f, i) => {
    const data = encode(f.original!);
    for (let part = 0; part * 30000 < data.length; part++)
      sources.push([
        i,
        STOCK_ROLES[i],
        f.name,
        f.sheets[0].name,
        f.sha256!,
        part + 1,
        Math.ceil(data.length / 30000),
        data.slice(part * 30000, (part + 1) * 30000),
      ]);
  });
  table(
    'Sources',
    ['Source', 'Role', 'Name', 'Sheet', 'SHA256', 'Part', 'Parts', 'Base64'],
    sources,
  );
  if (r.sectionEvidence)
    table(
      'Section citations',
      STOCK_SECTION_CITATION_HEADERS,
      stockSectionCitationRows(r.sectionEvidence),
    );
  if (r.matrixEvidence)
    table(
      'Matrix citations',
      STOCK_MATRIX_CITATION_HEADERS,
      stockMatrixCitationRows(r.matrixEvidence),
    );
  if (r.sectionEvidence || r.matrixEvidence) {
    const observations = stockSourceObservations(state.files);
    if (observations.length)
      table(
        'Source observations',
        STOCK_SOURCE_OBSERVATION_HEADERS,
        observations,
      );
  }
  // Preflight every table before allocating Workbook; never truncate evidence.
  for (const t of tables) {
    if (t.rows.length + 1 > 1048576 || t.headers.length > 16384)
      throw Error('STOCK_EXPORT_CAPACITY');
    for (const row of [t.headers, ...t.rows])
      for (const v of row)
        if (
          (typeof v === 'string' && v.length > 32767) ||
          (typeof v === 'number' && !Number.isSafeInteger(v))
        )
          throw Error('STOCK_EXPORT_CAPACITY');
  }
  const book = new ExcelJS.Workbook();
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name);
    sheet.addRow(t.headers);
    for (const row of t.rows) sheet.addRow(row);
  }
  const data = await book.xlsx.writeBuffer();
  return new Uint8Array(data).buffer;
}
