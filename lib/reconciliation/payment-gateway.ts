import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';
export const PG_VERSION = 'payment-gateway-batch-1';
export const PG_SESSION_LIMIT = 64 * 1024 * 1024;
export const PG_ROLES = [
  'transactions',
  'fee-evidence',
  'settlement',
  'payout',
] as const;
export const PG_SCOPE_FIELDS = [
  'entity',
  'gateway',
  'merchantAccount',
  'bankAccount',
  'dimensions',
  'currency',
  'currencyBasis',
  'fxPolicy',
  'start',
  'end',
  'asOf',
  'policyVersion',
  'batchId',
] as const;
export const PG_SCOPE_HEADERS = [
  'Entity',
  'Gateway',
  'Merchant account',
  'Bank account',
  'Complete dimensions',
  'Currency',
  'Currency basis',
  'FX policy',
  'Period start',
  'Period end',
  'As of',
  'Policy version',
  'Batch ID',
] as const;
export const PG_VALUE_HEADERS = [
  ['Transaction ID', 'Kind', 'Posting date', 'Amount', 'Reference'],
  ['Evidence ID', 'Fee ID', 'Amount', 'Reference', 'Valid from', 'Valid to'],
  [
    'Settlement ID',
    'Settlement date',
    'Gross sales',
    'Refunds',
    'Fees',
    'Net',
    'Payout ID',
    'Reference',
  ],
  ['Payout ID', 'Value date', 'Credit', 'Reference'],
] as const;
export const PG_HEADERS = PG_VALUE_HEADERS.map((h) => [
  ...h,
  ...PG_SCOPE_HEADERS,
]);
export const PG_CLAIM =
  'Consistency of supplied sales, refunds and independently evidenced fees with one gateway settlement and bank credit only; no posting, revenue recognition, fee legitimacy, source authenticity or completeness opinion';
export type GatewayScope = Record<(typeof PG_SCOPE_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type GatewayReading = {
  sheet: number;
  role: (typeof PG_ROLES)[number];
  family: typeof PG_VERSION;
  confirmed: boolean;
};
export type GatewayEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  batchId: string;
  memberIds: string[];
  context: string;
  at: string;
  reference: string;
  note: string;
};
export type GatewayInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [GatewayReading, GatewayReading, GatewayReading, GatewayReading];
  scope: GatewayScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: GatewayEvent[];
};
export type GatewayRecord = {
  id: string;
  source: number;
  row: number;
  values: (string | number)[];
};
export type GatewayIssue = {
  code: string;
  source: number;
  row: number;
  key: string;
};
export type GatewayResult = {
  version: typeof PG_VERSION;
  claim: typeof PG_CLAIM;
  context: string;
  scope: GatewayScope;
  readings: GatewayInput['readings'];
  completeness: GatewayInput['completeness'];
  decimals: number;
  sources: {
    name: string;
    hash: string;
    sheet: string;
    role: (typeof PG_ROLES)[number];
  }[];
  records: GatewayRecord[][];
  issues: GatewayIssue[];
  missing: string[];
  cells: {
    source: number;
    row: number;
    column: number;
    field: string;
    text: string;
  }[];
  inventory: { source: number; row: number; kind: string; errors: string[] }[];
  totals: number[] | null;
  residuals: number[] | null;
  memberIds: string[];
  events: GatewayEvent[];
  financial: 'source-error' | 'missing' | 'difference' | 'ready';
  review: 'needs-review' | 'accepted' | 'rejected';
  status:
    | 'source-error'
    | 'missing'
    | 'difference'
    | 'needs-review'
    | 'consistent-with-evidence';
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(s: string): never {
  throw Error('PG_' + s);
}
function text(v: unknown, limit = 500, strict = true): string {
  if (
    typeof v !== 'string' ||
    !v ||
    v !== v.trim() ||
    v.length > limit ||
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    (strict && /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v))
  )
    fail('IDENTITY');
  return v;
}
function day(v: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v.startsWith('0000-') ||
    !Number.isFinite(Date.parse(v + 'T00:00:00Z')) ||
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v
  )
    fail('DATE');
  return v;
}
function money(value: string, dec: number) {
  const v = value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/٫/g, '.');
  if (!/^\d+(?:\.\d+)?$/.test(v) || (v.split('.')[1]?.length ?? 0) > dec)
    fail('AMOUNT');
  const [whole, fraction = ''] = v.split('.');
  const n =
    BigInt(whole) * 10n ** BigInt(dec) +
    BigInt(fraction.padEnd(dec, '0') || '0');
  if (n > 100000000000000n) fail('AMOUNT');
  return Number(n);
}
function sum(values: number[]) {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  if (n > 100000000000000n || n < -100000000000000n) fail('TOTAL_BOUND');
  return Number(n);
}
function sheetUnsafe(
  sheet: SourceFile['sheets'][number],
  row: number,
  header: boolean,
) {
  const prefix = row + ':';
  const typed = new Set([
    'Amount',
    'Gross sales',
    'Refunds',
    'Fees',
    'Net',
    'Credit',
    'Posting date',
    'Settlement date',
    'Value date',
    'Valid from',
    'Valid to',
    'Period start',
    'Period end',
    'As of',
  ]);
  return (
    sheet.hiddenRows.includes(row) ||
    sheet.formulaRows.includes(row) ||
    !!sheet.rowIssues?.[String(row)]?.length ||
    !!sheet.xlsxHeaders?.hiddenColumns.length ||
    !!sheet.xlsxHeaders?.merges.length ||
    Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith(prefix)) ||
    Object.entries(sheet.cellIssues ?? {}).some(
      ([k, v]) => k.startsWith(prefix) && v.length,
    ) ||
    Object.entries(sheet.referenceIssues ?? {}).some(
      ([k, v]) =>
        k.startsWith(prefix) &&
        v.length &&
        (header || !typed.has(sheet.rows[0][Number(k.split(':')[1]) - 1])),
    )
  );
}
export function assertGatewayEventBudget(events: unknown) {
  if (!Array.isArray(events) || events.length > 1000) fail('INPUT');
  let count = 0;
  for (const e of events) {
    if (
      !plain(e) ||
      !Array.isArray(e.memberIds) ||
      e.memberIds.length > MAX_ROWS
    )
      fail('EVENT');
    count += e.memberIds.length;
    if (count > 100_000) fail('EVENT_CAPACITY');
  }
}
export function reconcileGateway(input: GatewayInput): GatewayResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  assertGatewayEventBudget(input.events);
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...PG_SCOPE_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !PG_SCOPE_FIELDS.every((k) => text(s[k]) === s[k])
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (decimals === undefined || !['SAR', 'JPY', 'KWD'].includes(s.currency))
    fail('CURRENCY');
  if (
    s.currencyBasis !== 'functional' ||
    s.fxPolicy !== 'same-currency-no-conversion' ||
    day(s.start) > day(s.end) ||
    day(s.asOf) !== s.end
  )
    fail('SCOPE');
  input.files.forEach((f) => {
    assertSourceFile(f);
    text(f.name, 255, false);
    if (
      f.sheets.length !== 1 ||
      f.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(f.name) ||
      !/^[a-f0-9]{64}$/.test(f.sha256 ?? '') ||
      !(f.original instanceof ArrayBuffer) ||
      !f.original.byteLength ||
      f.original.byteLength > MAX_FILE_BYTES
    )
      fail('SOURCE');
    for (const row of f.sheets[0].rows)
      for (const v of row) if (v.length > 32767) fail('CELL_LIMIT');
  });
  if (new Set(input.files.map((f) => f.sha256)).size !== 4)
    fail('INDEPENDENT_SOURCES');
  if (
    input.files.reduce(
      (n, f) => n + Math.max(0, f.sheets[0].rows.length - 1),
      0,
    ) > MAX_ROWS
  )
    fail('ROWS');
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.sheet !== 0 ||
      r.role !== PG_ROLES[i] ||
      r.family !== PG_VERSION ||
      r.confirmed !== true
    )
      fail('READING');
  });
  const c = input.completeness;
  if (
    !plain(c) ||
    !keys(c, ['confirmed', 'reference', 'note']) ||
    typeof c.confirmed !== 'boolean' ||
    typeof c.reference !== 'string' ||
    typeof c.note !== 'string'
  )
    fail('COMPLETENESS');
  if (c.confirmed || c.reference) text(c.reference, 2000, false);
  if (c.confirmed || c.note) text(c.note, 2000, false);
  const scope = {
    ...Object.fromEntries(PG_SCOPE_FIELDS.map((k) => [k, s[k]])),
    confirmed: true,
  } as GatewayScope;
  const readings = input.readings.map((r) => ({
    ...r,
  })) as GatewayInput['readings'];
  const completeness = { ...c };
  const context = JSON.stringify([
    PG_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const records: GatewayRecord[][] = [[], [], [], []],
    issues: GatewayIssue[] = [],
    missing: string[] = [],
    cells: GatewayResult['cells'] = [],
    inventory: GatewayResult['inventory'] = [];
  const problem = (code: string, source: number, row: number, key = '') =>
    issues.push({ code, source, row, key });
  const absent = (kind: string) => {
    if (!missing.includes(kind)) missing.push(kind);
  };
  const id = (src: number, row: number) =>
    JSON.stringify([PG_VERSION, src, input.files[src].sha256, 0, row]);
  input.files.forEach((f, source) => {
    const rows = f.sheets[0].rows,
      head = rows[0] ?? [],
      want = PG_HEADERS[source];
    const headerUnsafe = sheetUnsafe(f.sheets[0], 1, true);
    const ok =
      head.length === want.length &&
      new Set(head).size === want.length &&
      want.every((h) => head.includes(h)) &&
      !headerUnsafe;
    const col = Object.fromEntries(head.map((h, i) => [h, i]));
    for (let i = 0; i < rows.length; i++) {
      const row = i + 1,
        raw = rows[i],
        blank = raw.every((v) => !v.trim());
      raw.forEach((v, j) =>
        cells.push({
          source,
          row,
          column: j + 1,
          field: head[j] ?? '',
          text: v,
        }),
      );
      inventory.push({
        source,
        row,
        kind: i === 0 ? 'header' : blank ? 'blank' : PG_ROLES[source],
        errors: [],
      });
      if (!ok) {
        problem('COLUMNS', source, row);
        continue;
      }
      if (i === 0 || blank) continue;
      try {
        if (sheetUnsafe(f.sheets[0], row, false)) fail('CELL');
        if (raw.length !== head.length) fail('COLUMNS');
        const get = (h: string) => raw[col[h]];
        if (
          PG_SCOPE_FIELDS.some((k, j) => get(PG_SCOPE_HEADERS[j]) !== scope[k])
        )
          fail('ROW_SCOPE');
        const v: (string | number)[] = PG_VALUE_HEADERS[source].map((h) =>
          get(h),
        );
        const str = (j: number) => v[j] as string;
        if (source === 0) {
          text(v[0]);
          text(v[4], 2000, false);
          if (v[1] !== 'sale' && v[1] !== 'refund') fail('KIND');
          if (day(str(2)) < scope.start || str(2) > scope.end) fail('PERIOD');
          v[3] = money(str(3), decimals);
        } else if (source === 1) {
          text(v[0]);
          text(v[1]);
          text(v[3], 2000, false);
          v[2] = money(str(2), decimals);
          if (
            day(str(4)) > scope.start ||
            day(str(5)) < scope.end ||
            str(4) > str(5)
          )
            fail('VALIDITY');
        } else if (source === 2) {
          text(v[0]);
          text(v[6]);
          text(v[7], 2000, false);
          if (day(str(1)) < scope.start || str(1) > scope.end) fail('PERIOD');
          for (let j = 2; j < 6; j++) v[j] = money(str(j), decimals);
        } else {
          text(v[0]);
          text(v[3], 2000, false);
          if (day(str(1)) < scope.start || str(1) > scope.end) fail('PERIOD');
          v[2] = money(str(2), decimals);
        }
        records[source].push({ id: id(source, row), source, row, values: v });
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('PG_')) throw e;
        problem(e.message.slice(3), source, row);
      }
    }
    if (ok)
      for (const field of [want[0], ...(source === 1 ? ['Fee ID'] : [])]) {
        const groups = new Map<string, number[]>();
        for (let i = 1; i < rows.length; i++) {
          const value = rows[i][col[field]] ?? '';
          if (value && value === value.trim()) {
            const found = groups.get(value);
            if (found) found.push(i + 1);
            else groups.set(value, [i + 1]);
          }
        }
        for (const [value, group] of groups)
          if (group.length > 1)
            for (const row of group)
              problem('DUPLICATE', source, row, JSON.stringify([field, value]));
      }
  });
  for (const source of [2, 3])
    if (
      input.files[source].sheets[0].rows
        .slice(1)
        .filter((r) => r.some((v) => v.trim())).length > 1
    )
      problem('CARDINALITY', source, 0);
  for (const source of [0, 2, 3])
    if (!records[source].length) absent(PG_ROLES[source]);
  if (
    records[2].length === 1 &&
    (records[2][0].values[4] as number) > 0 &&
    !records[1].length
  )
    absent('fee-evidence');
  if (
    records[2].length === 1 &&
    records[3].length === 1 &&
    records[2][0].values[6] !== records[3][0].values[0]
  )
    problem('PAYOUT_LINK', 3, records[3][0].row);
  let totals: number[] | null = null,
    residuals: number[] | null = null;
  try {
    const gross = sum(
        records[0]
          .filter((r) => r.values[1] === 'sale')
          .map((r) => r.values[3] as number),
      ),
      refunds = sum(
        records[0]
          .filter((r) => r.values[1] === 'refund')
          .map((r) => r.values[3] as number),
      ),
      fees = sum(records[1].map((r) => r.values[2] as number));
    totals = [gross, refunds, fees, sum([gross, -refunds, -fees])];
  } catch {
    problem('TOTAL_BOUND', 0, 0);
  }
  if (
    !issues.length &&
    totals &&
    records[2].length === 1 &&
    records[3].length === 1
  ) {
    const summary = records[2][0].values,
      bank = records[3][0].values;
    try {
      residuals = [
        ...totals.map((n, i) => sum([n, -(summary[2 + i] as number)])),
        sum([summary[5] as number, -(bank[2] as number)]),
      ];
    } catch {
      problem('RESIDUAL_BOUND', 2, records[2][0].row);
    }
  }
  const originErrors = new Map<string, Set<string>>();
  for (const issue of issues) {
    const key = JSON.stringify([issue.source, issue.row]);
    const errors = originErrors.get(key) ?? new Set<string>();
    errors.add(issue.code);
    originErrors.set(key, errors);
  }
  for (const inv of inventory) {
    inv.errors = [
      ...(originErrors.get(JSON.stringify([inv.source, inv.row])) ?? []),
    ].sort();
    if (inv.errors.length) inv.kind = 'invalid';
  }
  if (issues.length) {
    totals = null;
    residuals = null;
  }
  const financial: GatewayResult['financial'] = issues.length
    ? 'source-error'
    : missing.length
      ? 'missing'
      : residuals?.some((n) => n !== 0)
        ? 'difference'
        : 'ready';
  const memberIds = input.files.flatMap((f, source) =>
    f.sheets[0].rows.flatMap((raw, i) =>
      i > 0 && raw.some((v) => v.trim()) ? [id(source, i + 1)] : [],
    ),
  );
  let review: GatewayResult['review'] = 'needs-review';
  const seen = new Set<string>(),
    events: GatewayEvent[] = [];
  for (const e of input.events) {
    if (
      !plain(e) ||
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
      !['accept', 'reject', 'undo'].includes(e.type) ||
      !Array.isArray(e.memberIds) ||
      e.memberIds.length > MAX_ROWS ||
      e.memberIds.some((v) => typeof v !== 'string') ||
      typeof e.context !== 'string' ||
      typeof e.at !== 'string'
    )
      fail('EVENT');
    text(e.id);
    text(e.batchId);
    text(e.reference, 2000, false);
    text(e.note, 2000, false);
    e.memberIds.forEach((v) => text(v));
    if (seen.has(e.id)) fail('EVENT_ID');
    seen.add(e.id);
    if (e.batchId !== scope.batchId) fail('EVENT_BATCH');
    if (e.context !== context) fail('EVENT_CONTEXT');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
      !Number.isFinite(Date.parse(e.at)) ||
      new Date(e.at).toISOString() !== e.at
    )
      fail('EVENT_DATE');
    if (
      !memberIds.length ||
      e.memberIds.length !== memberIds.length ||
      new Set(e.memberIds).size !== e.memberIds.length ||
      JSON.stringify([...e.memberIds].sort()) !==
        JSON.stringify([...memberIds].sort())
    )
      fail('EVENT_MEMBERS');
    if (
      e.type === 'accept' &&
      (financial !== 'ready' || !completeness.confirmed)
    )
      fail('EVENT_FINANCIAL');
    if (e.type === 'undo') {
      if (review === 'needs-review') fail('EVENT_STATE');
      review = 'needs-review';
    } else {
      if (review !== 'needs-review') fail('EVENT_STATE');
      review = e.type === 'accept' ? 'accepted' : 'rejected';
    }
    events.push({ ...e, memberIds: [...e.memberIds] });
  }
  const status: GatewayResult['status'] =
    financial !== 'ready'
      ? financial
      : !completeness.confirmed || review !== 'accepted'
        ? 'needs-review'
        : 'consistent-with-evidence';
  return {
    version: PG_VERSION,
    claim: PG_CLAIM,
    context,
    scope,
    readings,
    completeness,
    decimals,
    sources: input.files.map((f, i) => ({
      name: f.name,
      hash: f.sha256!,
      sheet: f.sheets[0].name,
      role: readings[i].role,
    })),
    records,
    issues,
    missing,
    cells,
    inventory,
    totals,
    residuals,
    memberIds,
    events,
    financial,
    review,
    status,
  };
}
