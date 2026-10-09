import ExcelJS from 'exceljs';
import { assetCSV } from './fixed-assets-csv.ts';
import {
  ASSET_VERSION,
  ASSET_FIELDS,
  ASSET_VALUES,
  ASSET_COMPONENTS,
  ASSET_ROLES,
  reconcileAsset,
  assertAssetEventBudget,
  type AssetInput,
  type AssetResult,
} from './fixed-assets.ts';
import { MAX_FILE_BYTES } from './types.ts';
const LIMIT = 64 * 1024 * 1024;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('ASSET_SOURCE');
}
const hash = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
export async function readAssetFile(name: string, original: ArrayBuffer) {
  bytes(original);
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 255 ||
    !/\.csv$/i.test(name)
  )
    throw Error('ASSET_SOURCE');
  const snapshot = original.slice(0),
    rows = assetCSV(snapshot);
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
    throw Error('ASSET_SESSION');
  const data = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(data);
  if (encode(data) !== v) throw Error('ASSET_SESSION');
  return data;
}
export async function replayAsset(input: AssetInput) {
  // Prevalidate sizes/metadata/event members before any metadata clone, then
  // capture every original and every decision field before the first await.
  reconcileAsset(input);
  const snapshots = input.files.map((f) => ({
    name: f.name,
    sha256: f.sha256,
    original: f.original!.slice(0),
  }));
  const metadata = structuredClone({
    readings: input.readings,
    scope: input.scope,
    completeness: input.completeness,
    events: input.events,
  });
  const files = [];
  for (const f of snapshots) {
    const file = await readAssetFile(f.name, f.original);
    if (file.sha256 !== f.sha256) throw Error('ASSET_SOURCE_HASH');
    files.push(file);
  }
  const state: AssetInput = {
    files: [files[0], files[1], files[2], files[3]],
    ...metadata,
  };
  return { state, result: reconcileAsset(state) };
}
export async function saveAsset(input: AssetInput) {
  const { state } = await replayAsset(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-fixed-assets-session',
      version: ASSET_VERSION,
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
  await restoreAsset(data);
  return data;
}
export async function restoreAsset(original: ArrayBuffer) {
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
    parsed.format !== 'tarasuf-fixed-assets-session' ||
    parsed.version !== ASSET_VERSION ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 4
  )
    throw Error('ASSET_SESSION');
  assertAssetEventBudget(parsed.events);
  // Decode all sources synchronously so no field of the session can be read
  // from a caller-owned buffer after hashing another source.
  const snapshots = parsed.files.map((f) => {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      !/\.csv$/i.test(f.name) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw Error('ASSET_SESSION');
    return { name: f.name, sha256: f.sha256, original: decode(f.data) };
  });
  const files = [];
  for (const f of snapshots) {
    const file = await readAssetFile(f.name, f.original);
    if (file.sha256 !== f.sha256) throw Error('ASSET_SOURCE_HASH');
    files.push(file);
  }
  return replayAsset({
    files: [files[0], files[1], files[2], files[3]],
    readings: parsed.readings as AssetInput['readings'],
    scope: parsed.scope as AssetInput['scope'],
    completeness: parsed.completeness as AssetInput['completeness'],
    events: parsed.events as AssetInput['events'],
  });
}
type Value = string | number | null;
export async function exportAsset(input: AssetInput, expected: AssetResult) {
  const expectedSnapshot = JSON.stringify(expected);
  const { state, result: r } = await replayAsset(input);
  if (JSON.stringify(r) !== expectedSnapshot) throw Error('ASSET_STALE_EXPORT');
  if (r.cells.length + 1 > 1048576 || r.inventory.length + 1 > 1048576)
    throw Error('ASSET_EXPORT_CAPACITY');
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
        'Consistency of supplied posted asset cost, accumulated depreciation, impairment and carrying amount with evidenced component mapping and selected GL accounts; no depreciation algorithm, valuation, posting, existence or completeness opinion',
      ],
      ['Status', r.status],
      ['Financial', r.financial],
      ['Review', r.review],
      ['Context', r.context],
      ['Decimals', r.decimals],
      ...ASSET_FIELDS.map((k) => [k, r.scope[k]] as Value[]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness note', r.completeness.note],
      ...[...ASSET_COMPONENTS, 'carrying' as const].flatMap(
        (k) =>
          [
            [`Register ${k} minor`, r.totals?.register[k] ?? null],
            [`GL ${k} minor`, r.totals?.gl[k] ?? null],
          ] as Value[][],
      ),
    ],
  );
  const units: Record<string, string> = {
    Cost: 'Cost minor',
    'Accumulated depreciation': 'Accumulated depreciation minor',
    Impairment: 'Impairment minor',
    'Carrying amount': 'Carrying amount minor',
    Debit: 'Debit minor',
    Credit: 'Credit minor',
  };
  table(
    'Assets',
    [
      'Record ID',
      'Source',
      'Source row',
      ...ASSET_VALUES[0].map((h) => units[h] ?? h),
    ],
    r.records[0].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.asset,
      v.dimensions,
      v.cost,
      v.depreciation,
      v.impairment,
      v.carrying,
      v.valuation,
    ]),
  );
  table(
    'Mapping',
    ['Record ID', 'Source', 'Source row', ...ASSET_VALUES[1]],
    r.records[1].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.asset,
      v.dimensions,
      v.component,
      v.account,
      v.glDimensions,
      v.evidence,
    ]),
  );
  table(
    'Policy evidence',
    ['Record ID', 'Source', 'Source row', ...ASSET_VALUES[2]],
    r.records[2].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.asset,
      v.dimensions,
      v.component,
      v.valuation,
      v.account,
      v.glDimensions,
      v.accountClass,
      v.sign,
      v.basis,
      v.validFrom,
      v.validTo,
      v.reference,
    ]),
  );
  table(
    'GL balances',
    [
      'Record ID',
      'Source',
      'Source row',
      ...ASSET_VALUES[3].map((h) => units[h] ?? h),
      'Component',
      'Normal minor',
    ],
    r.records[3].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.account,
      v.glDimensions,
      v.accountClass,
      v.debit,
      v.credit,
      v.component,
      v.normal,
    ]),
  );
  table(
    'Component comparisons',
    [
      'GL account',
      'GL dimensions',
      'Component',
      'Register minor',
      'GL minor',
      'Difference minor',
      'GL source row',
      'Register source rows',
    ],
    r.comparisons.map((v) => [
      v.account,
      v.dimensions,
      v.component,
      v.register,
      v.gl,
      v.difference,
      v.glRow,
      JSON.stringify(v.registerRows),
    ]),
  );
  table(
    'Missing',
    ['Reason', 'Source', 'Source row', 'Component'],
    r.missing.map((v) => [v.reason, v.source, v.row, v.component ?? '']),
  );
  table(
    'Issues',
    ['Source', 'Source row', 'Code'],
    r.issues.map((v) => [v.source, v.row, v.code]),
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
        ASSET_ROLES[i],
        f.name,
        'CSV',
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
  for (const t of tables) {
    if (t.rows.length + 1 > 1048576 || t.headers.length > 16384)
      throw Error('ASSET_EXPORT_CAPACITY');
    for (const row of [t.headers, ...t.rows])
      for (const v of row)
        if (
          (typeof v === 'string' && v.length > 32767) ||
          (typeof v === 'number' && !Number.isSafeInteger(v))
        )
          throw Error('ASSET_EXPORT_CAPACITY');
  }
  const book = new ExcelJS.Workbook();
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name);
    sheet.addRow(t.headers);
    for (const row of t.rows) sheet.addRow(row);
  }
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
