import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { assertFinancialNative } from './tb-financial-native.ts';
import {
  FINANCIAL_VERSION,
  FINANCIAL_SESSION_LIMIT,
  FINANCIAL_SCOPE_FIELDS,
  FINANCIAL_CATEGORIES,
  reconcileFinancialPosition,
  type FinancialInput,
  type FinancialResult,
} from './tb-financial.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('TB_FIN_SOURCE');
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
    throw Error('TB_FIN_SESSION');
  const b = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(b);
  if (encode(b) !== v) throw Error('TB_FIN_SESSION');
  return b;
}
export async function replayFinancialPosition(input: FinancialInput) {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4
  )
    throw Error('TB_FIN_INPUT');
  const files = [];
  for (const old of input.files) {
    if (
      !plain(old) ||
      old.kind !== undefined ||
      typeof old.name !== 'string' ||
      old.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(old.name)
    )
      throw Error('TB_FIN_SOURCE');
    bytes(old.original);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', old.original)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== old.sha256) throw Error('TB_FIN_SOURCE_HASH');
    const file = await readFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('TB_FIN_SOURCE_HASH');
    files.push(file);
  }
  const state: FinancialInput = {
    files: files as FinancialInput['files'],
    readings: input.readings,
    scope: input.scope,
    completeness: input.completeness,
    events: input.events,
  };
  const result = reconcileFinancialPosition(state);
  for (let i = 0; i < files.length; i++)
    await assertFinancialNative(files[i], i, result.decimals);
  return { state, result };
}
export async function saveFinancialPosition(input: FinancialInput) {
  const { state } = await replayFinancialPosition(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-tb-financial-session',
      version: FINANCIAL_VERSION,
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
  bytes(data, FINANCIAL_SESSION_LIMIT);
  await restoreFinancialPosition(data);
  return data;
}
export async function restoreFinancialPosition(data: ArrayBuffer) {
  bytes(data, FINANCIAL_SESSION_LIMIT);
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
    p.format !== 'tarasuf-tb-financial-session' ||
    p.version !== FINANCIAL_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 4
  )
    throw Error('TB_FIN_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw Error('TB_FIN_SESSION');
    const file = await readFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw Error('TB_FIN_SOURCE_HASH');
    files.push(file);
  }
  return replayFinancialPosition({
    files: files as FinancialInput['files'],
    readings: p.readings as FinancialInput['readings'],
    scope: p.scope as FinancialInput['scope'],
    completeness: p.completeness as FinancialInput['completeness'],
    events: p.events as FinancialInput['events'],
  });
}
export async function exportFinancialPosition(
  input: FinancialInput,
  expected: FinancialResult,
) {
  const { state, result: r } = await replayFinancialPosition(input);
  if (JSON.stringify(r) !== JSON.stringify(expected))
    throw Error('TB_FIN_STALE_EXPORT');
  // Preflight every exported table before allocating a workbook. Whole event
  // membership may multiply the source inventory by up to 1,000 decisions.
  const counts = [
    25,
    r.accounts.length,
    r.mappings.length,
    r.evidence.length,
    r.lines.length,
    r.lines.reduce((n, l) => n + l.members.length, 0),
    r.totals ? 10 : 0,
    r.grandTotals ? 2 : 0,
    r.missing.length,
    r.issues.length,
    r.cells.length,
    r.inventory.length,
    r.readings.length,
    r.events.length,
    r.events.reduce((n, e) => n + e.mappingIds.length, 0),
    state.files.reduce(
      (n, f) =>
        n + Math.ceil((Math.ceil(f.original!.byteLength / 3) * 4) / 30000),
      0,
    ),
  ];
  if (counts.some((n) => n + 1 > 1_048_576)) throw Error('TB_FIN_EXPORT_ROWS');
  const book = new ExcelJS.Workbook();
  type Value = string | number | null;
  function table(name: string, headers: string[], rows: Value[][]) {
    if (rows.length + 1 > 1_048_576) throw Error('TB_FIN_EXPORT_ROWS');
    const sheet = book.addWorksheet(name);
    for (const row of [headers, ...rows]) {
      for (const v of row)
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
          throw Error('TB_FIN_EXPORT_CELL');
      sheet.addRow(row);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns = headers.map(() => ({ width: 24 }));
  }
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'tb-financial-position'],
      ['Version', r.version],
      ['Claim', r.claim],
      ['Status', r.status],
      ['Decimals', r.decimals],
      ['Context', r.context],
      ...FINANCIAL_SCOPE_FIELDS.map((k) => [k, r.scope[k]]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness reason', r.completeness.note],
      ['TB debit minor units', r.tb?.debit ?? null],
      ['TB credit minor units', r.tb?.credit ?? null],
      ['TB residual minor units', r.tb?.residual ?? null],
    ],
  );
  table(
    'Accounts',
    [
      'ID',
      'Source row',
      'Account ID',
      'Complete dimensions',
      'Label',
      'Class',
      'Debit minor units',
      'Credit minor units',
      'Net minor units',
    ],
    r.accounts.map((a) => [
      a.id,
      a.row,
      a.account,
      a.dimensions,
      a.label,
      a.category,
      a.debit,
      a.credit,
      a.net,
    ]),
  );
  table(
    'Mappings',
    [
      'ID',
      'Source row',
      'Mapping ID',
      'Account ID',
      'Complete dimensions',
      'Line ID',
      'Sign',
      'Evidence ID',
    ],
    r.mappings.map((m) => [
      m.id,
      m.row,
      m.mappingId,
      m.account,
      m.dimensions,
      m.lineId,
      m.sign,
      m.evidenceId,
    ]),
  );
  table(
    'Evidence',
    [
      'ID',
      'Source row',
      'Evidence ID',
      'Account ID',
      'Complete dimensions',
      'Account class',
      'Line ID',
      'Line label',
      'Line class',
      'Sign',
      'Valid from',
      'Valid to',
      'Evidence reference',
    ],
    r.evidence.map((e) => [
      e.id,
      e.row,
      e.evidenceId,
      e.account,
      e.dimensions,
      e.accountClass,
      e.lineId,
      e.label,
      e.category,
      e.sign,
      e.validFrom,
      e.validTo,
      e.reference,
    ]),
  );
  table(
    'Lines',
    [
      'ID',
      'Source row',
      'Line ID',
      'Label',
      'Class',
      'Calculated minor units',
      'Reported minor units',
      'Difference minor units',
      'Review',
    ],
    r.lines.map((l) => [
      l.id,
      l.row,
      l.lineId,
      l.label,
      l.category,
      l.calculated,
      l.reported,
      l.difference,
      l.review,
    ]),
  );
  table(
    'Line members',
    [
      'Line ID',
      'Mapping ID',
      'Account record',
      'Mapping record',
      'Evidence record',
      'Account ID',
      'Complete dimensions',
      'Evidence ID',
      'Debit minor units',
      'Credit minor units',
      'Net minor units',
      'Contribution minor units',
    ],
    r.lines.flatMap((l) =>
      l.members.map((m) => [
        l.lineId,
        m.mappingId,
        m.accountRecord,
        m.mappingRecord,
        m.evidenceRecord,
        m.account,
        m.dimensions,
        m.evidenceId,
        m.debit,
        m.credit,
        m.net,
        m.contribution,
      ]),
    ),
  );
  table(
    'Totals',
    ['Basis', 'Class', 'Amount minor units'],
    r.totals
      ? (['calculated', 'reported'] as const).flatMap((b) =>
          FINANCIAL_CATEGORIES.map((c) => [b, c, r.totals![b][c]]),
        )
      : [],
  );
  table(
    'Grand totals',
    [
      'Basis',
      'Assets minor units',
      'Liabilities minor units',
      'Equity minor units',
      'Equation minor units',
    ],
    r.grandTotals
      ? (['calculated', 'reported'] as const).map((b) => [
          b,
          r.grandTotals![b].assets,
          r.grandTotals![b].liabilities,
          r.grandTotals![b].equity,
          r.grandTotals![b].equation,
        ])
      : [],
  );
  table(
    'Missing',
    ['Kind', 'Key'],
    r.missing.map((m) => [m.kind, m.key]),
  );
  table(
    'Issues',
    ['Code', 'Source', 'Row', 'Key', 'Related'],
    r.issues.map((i) => [i.code, i.source, i.row, i.key, i.related]),
  );
  table(
    'Cell evidence',
    ['Source', 'ID', 'Source row', 'Field', 'Source column', 'Original text'],
    r.cells.map((c) => [c.source, c.id, c.row, c.field, c.column, c.text]),
  );
  table(
    'Inventory',
    ['Source', 'ID', 'Source row', 'Kind', 'Errors', 'Original cells'],
    r.inventory.map((i) => [
      i.source,
      i.id,
      i.row,
      i.kind,
      JSON.stringify(i.errors),
      JSON.stringify(i.values),
    ]),
  );
  table(
    'Reading',
    ['Source', 'Sheet index', 'Role', 'Family', 'Confirmed'],
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
      'Index',
      'ID',
      'Type',
      'Context',
      'Line ID',
      'Device UTC',
      'Evidence reference',
      'Reason',
    ],
    r.events.map((e, i) => [
      i,
      e.id,
      e.type,
      e.context,
      e.lineId,
      e.at,
      e.reference,
      e.note,
    ]),
  );
  table(
    'Event members',
    ['Decision', 'Mapping ID'],
    r.events.flatMap((e, i) => e.mappingIds.map((m) => [i, m])),
  );
  table(
    'Sources',
    ['Source', 'Name', 'SHA256', 'Chunk index', 'Base64'],
    state.files.flatMap((f, i) => {
      const s = encode(f.original!);
      const rows: Value[][] = [];
      for (let at = 0; at < s.length; at += 30000)
        rows.push([i, f.name, f.sha256!, at / 30000, s.slice(at, at + 30000)]);
      return rows;
    }),
  );
  const b: unknown = await book.xlsx.writeBuffer();
  if (b instanceof ArrayBuffer) return b.slice(0);
  if (ArrayBuffer.isView(b))
    return Uint8Array.from(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
      .buffer;
  throw Error('TB_FIN_EXPORT_BUFFER');
}
