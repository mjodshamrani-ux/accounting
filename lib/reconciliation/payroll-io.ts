import ExcelJS from 'exceljs';
import { payrollCSV } from './payroll-csv.ts';
import {
  PAYROLL_VERSION,
  PAYROLL_FIELDS,
  PAYROLL_VALUES,
  PAYROLL_COMPONENTS,
  PAYROLL_ROLES,
  reconcilePayroll,
  assertPayrollEventBudget,
  type PayrollInput,
  type PayrollResult,
} from './payroll.ts';
import { MAX_FILE_BYTES } from './types.ts';
const LIMIT = 64 * 1024 * 1024;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('PAYROLL_SOURCE');
}
const hash = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
export async function readPayrollFile(name: string, original: ArrayBuffer) {
  bytes(original);
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 255 ||
    !/\.csv$/i.test(name)
  )
    throw Error('PAYROLL_SOURCE');
  const snapshot = original.slice(0),
    rows = payrollCSV(snapshot);
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
    throw Error('PAYROLL_SESSION');
  const data = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(data);
  if (encode(data) !== v) throw Error('PAYROLL_SESSION');
  return data;
}
export async function replayPayroll(input: PayrollInput) {
  // Prevalidate sizes/metadata/event members before any metadata clone, then
  // capture every original and every decision field before the first await.
  reconcilePayroll(input);
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
  if (
    snapshots.reduce((n, f) => n + f.original.byteLength, 0) >
    32 * 1024 * 1024
  )
    throw Error('PAYROLL_SOURCE_CAPACITY');
  const files = [];
  for (const f of snapshots) {
    const file = await readPayrollFile(f.name, f.original);
    if (file.sha256 !== f.sha256) throw Error('PAYROLL_SOURCE_HASH');
    files.push(file);
  }
  const state: PayrollInput = {
    files: [files[0], files[1], files[2], files[3], files[4]],
    ...metadata,
  };
  return { state, result: reconcilePayroll(state) };
}
export async function savePayroll(input: PayrollInput) {
  const { state } = await replayPayroll(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-payroll-session',
      version: PAYROLL_VERSION,
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
  await restorePayroll(data);
  return data;
}
export async function restorePayroll(original: ArrayBuffer) {
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
    parsed.format !== 'tarasuf-payroll-session' ||
    parsed.version !== PAYROLL_VERSION ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 5
  )
    throw Error('PAYROLL_SESSION');
  assertPayrollEventBudget(parsed.events);
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
      throw Error('PAYROLL_SESSION');
    return { name: f.name, sha256: f.sha256, original: decode(f.data) };
  });
  if (
    snapshots.reduce((n, f) => n + f.original.byteLength, 0) >
    32 * 1024 * 1024
  )
    throw Error('PAYROLL_SOURCE_CAPACITY');
  const files = [];
  for (const f of snapshots) {
    const file = await readPayrollFile(f.name, f.original);
    if (file.sha256 !== f.sha256) throw Error('PAYROLL_SOURCE_HASH');
    files.push(file);
  }
  return replayPayroll({
    files: [files[0], files[1], files[2], files[3], files[4]],
    readings: parsed.readings as PayrollInput['readings'],
    scope: parsed.scope as PayrollInput['scope'],
    completeness: parsed.completeness as PayrollInput['completeness'],
    events: parsed.events as PayrollInput['events'],
  });
}
type Value = string | number | null;
export async function exportPayroll(
  input: PayrollInput,
  expected: PayrollResult,
) {
  const expectedSnapshot = JSON.stringify(expected);
  const { state, result: r } = await replayPayroll(input);
  if (JSON.stringify(r) !== expectedSnapshot)
    throw Error('PAYROLL_STALE_EXPORT');
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
        'Consistency of supplied posted payroll components, evidenced GL expense and liability roles, disbursement clearing and one supplied bank outflow; no tax calculation, posting, transfer initiation or proof each employee received payment',
      ],
      ['Status', r.status],
      ['Financial', r.financial],
      ['Review', r.review],
      ['Context', r.context],
      ['Decimals', r.decimals],
      ...PAYROLL_FIELDS.map((k) => [k, r.scope[k]] as Value[]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness note', r.completeness.note],
      ...(['gross', 'deductions', 'employer', 'net'] as const).map(
        (k) =>
          [`Register ${k} minor`, r.totals?.register[k] ?? null] as Value[],
      ),
      ...PAYROLL_COMPONENTS.map(
        (c) => [`GL ${c} minor`, r.totals?.gl[c] ?? null] as Value[],
      ),
      ['Bank minor', r.totals?.bank ?? null],
    ],
  );
  const units: Record<string, string> = Object.fromEntries(
    [
      'Gross',
      'Deductions',
      'Employer contribution',
      'Net',
      'Debit',
      'Credit',
      'Amount',
    ].map((k) => [k, k + ' minor']),
  );
  table(
    'Payroll register',
    [
      'Record ID',
      'Source',
      'Source row',
      ...PAYROLL_VALUES[0].map((h) => units[h] ?? h),
    ],
    r.records[0].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.employee,
      v.dimensions,
      v.gross,
      v.deductions,
      v.employer,
      v.net,
      v.payrollReference,
    ]),
  );
  table(
    'Mapping',
    ['Record ID', 'Source', 'Source row', ...PAYROLL_VALUES[1]],
    r.records[1].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.employee,
      v.dimensions,
      v.component,
      v.account,
      v.glDimensions,
      v.evidence,
    ]),
  );
  table(
    'Policy evidence',
    ['Record ID', 'Source', 'Source row', ...PAYROLL_VALUES[2]],
    r.records[2].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.employee,
      v.dimensions,
      v.component,
      v.payrollReference,
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
    'GL entries',
    [
      'Record ID',
      'Source',
      'Source row',
      ...PAYROLL_VALUES[3].map((h) => units[h] ?? h),
      'Normal minor',
    ],
    r.records[3].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.phase,
      v.component,
      v.account,
      v.glDimensions,
      v.accountClass,
      v.debit,
      v.credit,
      v.entryDate,
      v.postingReference,
      v.normal,
    ]),
  );
  table(
    'Bank payout',
    [
      'Record ID',
      'Source',
      'Source row',
      ...PAYROLL_VALUES[4].map((h) => units[h] ?? h),
    ],
    r.records[4].map((v) => [
      v.memberId,
      v.source,
      v.row,
      v.id,
      v.bankAccount,
      v.direction,
      v.amount,
      v.valueDate,
      v.payoutReference,
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
    'Bank comparison',
    [
      'Register net minor',
      'Bank minor',
      'Difference minor',
      'Bank source rows',
    ],
    [
      [
        r.bankComparison.register,
        r.bankComparison.bank,
        r.bankComparison.difference,
        JSON.stringify(r.bankComparison.bankRows),
      ],
    ],
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
        PAYROLL_ROLES[i],
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
      throw Error('PAYROLL_EXPORT_CAPACITY');
    for (const row of [t.headers, ...t.rows])
      for (const v of row)
        if (
          (typeof v === 'string' && v.length > 32767) ||
          (typeof v === 'number' && !Number.isSafeInteger(v))
        )
          throw Error('PAYROLL_EXPORT_CAPACITY');
  }
  const book = new ExcelJS.Workbook();
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name);
    sheet.addRow(t.headers);
    for (const row of t.rows) sheet.addRow(row);
  }
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
