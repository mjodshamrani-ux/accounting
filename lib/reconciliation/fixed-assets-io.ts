import ExcelJS from 'exceljs';
import { assetCSV } from './fixed-assets-csv.ts';
import {
  ASSET_VERSION,
  ASSET_LONG_FAMILY,
  ASSET_FIELDS,
  ASSET_VALUES,
  ASSET_COMPONENTS,
  ASSET_ROLES,
  reconcileAsset,
  assertAssetEventBudget,
  type AssetInput,
  type AssetResult,
} from './fixed-assets.ts';
import { snapshotAsset } from './fixed-assets-envelope.ts';
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
export { snapshotAsset } from './fixed-assets-envelope.ts';
export async function replayAsset(input: AssetInput) {
  const snapshot = snapshotAsset(input);
  const snapshots = snapshot.files;
  const { readings, scope, completeness, events } = snapshot;
  const metadata = { readings, scope, completeness, events };
  const files = [];
  for (const f of snapshots) {
    const file = await readAssetFile(f.name, f.original!);
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
    const file = await readAssetFile(f.name, f.original!);
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
  const long = r.readings[0].family === ASSET_LONG_FAMILY;
  table(
    'Assets',
    [
      long ? 'First physical member ID' : 'Record ID',
      'Source',
      long ? 'First component row' : 'Source row',
      ...ASSET_VALUES[0].map((h) => units[h] ?? h),
      ...(long ? ['Representation'] : []),
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
      ...(long ? [v.representation ?? ''] : []),
    ]),
  );
  if (long) {
    table(
      'Long component evidence',
      [
        'Member ID',
        'Source',
        'Role',
        'SHA256',
        'Sheet',
        'Source row',
        'Column',
        'Field',
        'Present',
        'Text',
        'Minor',
        'Component',
        'Component column',
        'Asset ID',
        'Asset dimensions',
        'Valuation reference',
        'Context',
      ],
      (r.componentEvidence ?? []).map((v) => [
        v.memberId,
        v.source,
        v.role,
        v.sourceHash,
        v.sheet,
        v.row,
        v.column,
        v.header,
        String(v.present),
        v.text,
        v.minor,
        v.component,
        v.componentColumn,
        v.asset,
        v.dimensions,
        v.valuation,
        v.context,
      ]),
    );
    table(
      'Asset component members',
      [
        'Asset ID',
        'Asset dimensions',
        'Representation',
        'Member ID',
        'Source',
        'Source row',
        'Component',
        'Amount column',
        'Present',
        'Text',
        'Minor',
      ],
      r.records[0].flatMap((v) =>
        (v.componentEvidence ?? []).map((e) => [
          v.asset,
          v.dimensions,
          v.representation ?? '',
          e.memberId,
          e.source,
          e.row,
          e.component,
          e.column,
          String(e.present),
          e.text,
          e.minor,
        ]),
      ),
    );
    const rawRows = state.files[0].sheets[0].rows.slice(1);
    const width = rawRows.reduce((n, row) => Math.max(n, row.length), 0);
    table(
      'Original register rows',
      [
        'Source',
        'Source row',
        'Cell count',
        ...Array.from({ length: width }, (_, i) => `Cell ${i + 1}`),
      ],
      rawRows.map((row, i) => [0, i + 2, row.length, ...row]),
    );
  }
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

/** Independently reread worker output and bind it to the captured request. */
export async function validateAssetWorkerResponse(
  action: string,
  value: unknown,
  payload: unknown,
) {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const originalsEqual = (a: AssetInput, b: AssetInput) =>
    a.files.every((f, i) => {
      const x = new Uint8Array(f.original!),
        y = new Uint8Array(b.files[i].original!);
      return x.length === y.length && x.every((v, j) => v === y[j]);
    });
  const equalState = (a: AssetInput, b: AssetInput) =>
    same(a, b) && originalsEqual(a, b);
  if (!plain(payload)) throw Error('ASSET_ENVELOPE');
  if (action === 'asset-read') {
    if (
      !plain(value) ||
      !(payload.buffer instanceof ArrayBuffer) ||
      typeof payload.name !== 'string'
    )
      throw Error('ASSET_ENVELOPE');
    const fresh = await readAssetFile(payload.name, payload.buffer);
    if (
      !same(value, fresh) ||
      !(value.original instanceof ArrayBuffer) ||
      !new Uint8Array(fresh.original).every(
        (v, i) => v === new Uint8Array(value.original as ArrayBuffer)[i],
      ) ||
      value.original.byteLength !== fresh.original.byteLength
    )
      throw Error('ASSET_ENVELOPE');
    return fresh;
  }
  if (action === 'asset-reconcile' || action === 'asset-restore') {
    if (
      !plain(value) ||
      !keys(value, ['state', 'result']) ||
      !plain(value.state)
    )
      throw Error('ASSET_ENVELOPE');
    const fresh = await replayAsset(value.state as unknown as AssetInput);
    if (JSON.stringify(fresh.result) !== JSON.stringify(value.result))
      throw Error('ASSET_ENVELOPE');
    if (!equalState(fresh.state, value.state as unknown as AssetInput))
      throw Error('ASSET_ENVELOPE');
    const requested =
      action === 'asset-reconcile'
        ? await replayAsset(payload as unknown as AssetInput)
        : await restoreAsset(payload.buffer as ArrayBuffer);
    if (
      !equalState(fresh.state, requested.state) ||
      !same(fresh.result, requested.result)
    )
      throw Error('ASSET_REQUEST_BINDING');
    return fresh;
  }
  if (!(value instanceof ArrayBuffer)) throw Error('ASSET_ENVELOPE');
  if (action === 'asset-save') {
    const saved = await restoreAsset(value),
      requested = await replayAsset(payload as unknown as AssetInput);
    if (
      !equalState(saved.state, requested.state) ||
      !same(saved.result, requested.result)
    )
      throw Error('ASSET_REQUEST_BINDING');
  } else if (action === 'asset-export') {
    // Compare native cell values, since ZIP metadata is not an accounting identity.
    const expected = await exportAsset(
      payload.state as AssetInput,
      payload.result as AssetResult,
    );
    const inspect = async (buffer: ArrayBuffer) => {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
      return book.worksheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.getSheetValues(),
      }));
    };
    if (!same(await inspect(value), await inspect(expected)))
      throw Error('ASSET_REQUEST_BINDING');
  }
  return value;
}
