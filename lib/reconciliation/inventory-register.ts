import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';

// Private pure proof stage: no worker/UI/public IO or financial posting authority.
export const STOCK_VERSION = 'inventory-posted-register-gl-1';
export const STOCK_ROLES = [
  'register',
  'mapping',
  'policy-evidence',
  'gl',
] as const;
export const STOCK_FIELDS = [
  'entity',
  'inventoryLedger',
  'glLedger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'asOf',
  'chartVersion',
  'mapVersion',
  'valuationPolicyVersion',
  'inventoryAccountSetVersion',
] as const;
export const STOCK_SCOPE_HEADERS = [
  'Entity',
  'Inventory ledger',
  'GL ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'As of',
  'Chart version',
  'Map version',
  'Valuation policy version',
  'Inventory account set version',
];
export const STOCK_VALUES = [
  [
    'Item ID',
    'Item dimensions',
    'Quantity',
    'Unit',
    'Quantity precision',
    'Posted value',
    'Valuation reference',
  ],
  [
    'Mapping ID',
    'Item ID',
    'Item dimensions',
    'GL account',
    'GL dimensions',
    'Evidence ID',
  ],
  [
    'Evidence ID',
    'Item ID',
    'Item dimensions',
    'Unit',
    'Quantity precision',
    'Valuation reference',
    'GL account',
    'GL dimensions',
    'Account class',
    'Sign',
    'Value basis',
    'Valid from',
    'Valid to',
    'Reference',
  ],
  ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
];
export const STOCK_HEADERS = STOCK_VALUES.map((v) => [
  ...v,
  ...STOCK_SCOPE_HEADERS,
]);
export type StockScope = Record<(typeof STOCK_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type StockReading = {
  sheet: number;
  role: (typeof STOCK_ROLES)[number];
  family: typeof STOCK_VERSION;
  confirmed: boolean;
};
export type StockEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  memberIds: string[];
  context: string;
  at: string;
  reference: string;
  note: string;
};
export type StockInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [StockReading, StockReading, StockReading, StockReading];
  scope: StockScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: StockEvent[];
};
type RecordRow = {
  id: string;
  source: number;
  row: number;
  values: (string | number)[];
};
type Comparison = {
  account: string;
  dimensions: string;
  registerMinor: number | null;
  debitMinor: number | null;
  creditMinor: number | null;
  glMinor: number | null;
  differenceMinor: number | null;
};
export type StockResult = {
  version: typeof STOCK_VERSION;
  context: string;
  scope: StockScope;
  readings: StockInput['readings'];
  completeness: StockInput['completeness'];
  decimals: number;
  records: RecordRow[][];
  issues: { source: number; row: number; code: string }[];
  missing: string[];
  comparisons: Comparison[];
  totals: { registerMinor: number; glMinor: number } | null;
  inventory: {
    source: number;
    row: number;
    kind: 'header' | 'blank' | 'data';
  }[];
  cells: {
    source: number;
    row: number;
    column: number;
    field: string;
    text: string;
  }[];
  memberIds: string[];
  events: StockEvent[];
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
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function fail(code: string): never {
  throw Error('STOCK_' + code);
}
function text(value: unknown, max = 500): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(value)
  )
    fail('IDENTITY');
  return value;
}
function day(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.slice(0, 4) === '0000' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail('VALIDITY');
  return value;
}
function scaled(value: string, precision: number) {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) fail('NUMBER');
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > precision) fail('PRECISION');
  const n = BigInt(integer + fraction.padEnd(precision, '0'));
  if (n > 100000000000000n) fail('BOUND');
  return Number(n);
}
function bounded(n: bigint) {
  if (n > 100000000000000n || n < -100000000000000n) fail('TOTAL_BOUND');
  return Number(n);
}
export function assertStockEventBudget(events: unknown) {
  if (!Array.isArray(events) || events.length > 1000) fail('EVENT_CAPACITY');
  let total = 0;
  for (const e of events) {
    if (
      !plain(e) ||
      !Array.isArray(e.memberIds) ||
      e.memberIds.length > MAX_ROWS
    )
      fail('EVENT_CAPACITY');
    total += e.memberIds.length;
    if (total > 100000) fail('EVENT_CAPACITY');
  }
}
export function reconcileStock(input: StockInput): StockResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4
  )
    fail('INPUT');
  assertStockEventBudget(input.events);
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...STOCK_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !STOCK_FIELDS.every((k) => text(s[k]) === s[k])
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (decimals === undefined || !['SAR', 'JPY', 'KWD'].includes(s.currency))
    fail('CURRENCY');
  if (s.currencyBasis !== 'functional' || s.postingStatus !== 'posted')
    fail('SCOPE');
  day(s.asOf);
  const c = input.completeness;
  if (
    !plain(c) ||
    !keys(c, ['confirmed', 'reference', 'note']) ||
    typeof c.confirmed !== 'boolean' ||
    typeof c.reference !== 'string' ||
    typeof c.note !== 'string'
  )
    fail('COMPLETENESS');
  if (c.confirmed || c.reference) text(c.reference, 2000);
  if (c.confirmed || c.note) text(c.note, 2000);
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.sheet !== 0 ||
      r.role !== STOCK_ROLES[i] ||
      r.family !== STOCK_VERSION ||
      r.confirmed !== true
    )
      fail('READING');
  });
  input.files.forEach((f) => {
    assertSourceFile(f);
    text(f.name, 255);
    if (
      f.kind !== undefined ||
      !/\.csv$/i.test(f.name) ||
      f.sheets.length !== 1 ||
      !(f.original instanceof ArrayBuffer) ||
      !f.original.byteLength ||
      f.original.byteLength > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(f.sha256 ?? '')
    )
      fail('SOURCE');
    const sh = f.sheets[0];
    if (
      sh.rows.length > MAX_ROWS + 1 ||
      sh.rows.some((r) => r.length > 100 || r.some((v) => v.length > 32767))
    )
      fail('SOURCE_CAPACITY');
    if (
      sh.rows.reduce((n, row) => n + row.reduce((a, v) => a + v.length, 0), 0) >
      f.original.byteLength
    )
      fail('SOURCE_CAPACITY');
    if (
      sh.hiddenRows.length ||
      sh.formulaRows.length ||
      Object.keys(sh).some(
        (k) => !['name', 'rows', 'formulaRows', 'hiddenRows'].includes(k),
      )
    )
      fail('SOURCE_METADATA');
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
  const scope = {
      ...Object.fromEntries(STOCK_FIELDS.map((k) => [k, s[k]])),
      confirmed: true,
    } as StockScope,
    readings = input.readings.map((r) => ({ ...r })) as StockInput['readings'],
    completeness = { ...c };
  const context = JSON.stringify([
    STOCK_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const result: StockResult = {
    version: STOCK_VERSION,
    context,
    scope,
    readings,
    completeness,
    decimals,
    records: [[], [], [], []],
    issues: [],
    missing: [],
    comparisons: [],
    totals: null,
    inventory: [],
    cells: [],
    memberIds: [],
    events: [],
    financial: 'ready',
    review: 'needs-review',
    status: 'needs-review',
  };
  const problem = (source: number, row: number, code: string) =>
    result.issues.push({ source, row, code });
  const absent = (key: string) => {
    if (!result.missing.includes(key)) result.missing.push(key);
  };
  input.files.forEach((f, source) => {
    const rows = f.sheets[0].rows,
      header = rows[0] ?? [],
      desired = STOCK_HEADERS[source];
    const good =
      header.length === desired.length &&
      new Set(header).size === desired.length &&
      desired.every((h) => header.includes(h));
    const positions = Object.fromEntries(header.map((h, i) => [h, i]));
    if (!rows.length) problem(source, 1, 'COLUMNS');
    rows.forEach((raw, index) => {
      const row = index + 1,
        blank = raw.every((v) => !v.trim());
      result.inventory.push({
        source,
        row,
        kind: index === 0 ? 'header' : blank ? 'blank' : 'data',
      });
      raw.forEach((v, column) =>
        result.cells.push({
          source,
          row,
          column: column + 1,
          field: header[column] ?? '',
          text: v,
        }),
      );
      const id = JSON.stringify([STOCK_VERSION, source, f.sha256, 0, row]);
      if (index > 0 && !blank) result.memberIds.push(id);
      if (!good) {
        problem(source, row, 'COLUMNS');
        return;
      }
      if (index === 0 || blank) return;
      try {
        if (raw.length !== header.length) fail('COLUMNS');
        const get = (key: string) => raw[positions[key]];
        if (
          STOCK_FIELDS.some((k, i) => get(STOCK_SCOPE_HEADERS[i]) !== scope[k])
        )
          fail('ROW_SCOPE');
        const v: (string | number)[] = STOCK_VALUES[source].map(get);
        STOCK_VALUES[source].forEach((key, i) => {
          if (
            ![
              'Quantity',
              'Posted value',
              'Debit',
              'Credit',
              'Quantity precision',
            ].includes(key)
          )
            text(
              v[i],
              ['Valuation reference', 'Reference'].includes(key) ? 2000 : 500,
            );
        });
        if (source === 0 || source === 2) {
          if (!/^[0-6]$/.test(v[4] as string)) fail('QUANTITY_PRECISION');
          v[4] = Number(v[4]);
        }
        if (source === 0) {
          v[2] = scaled(v[2] as string, v[4] as number);
          v[5] = scaled(v[5] as string, decimals);
        }
        if (source === 2) {
          if (
            v[8] !== 'inventory' ||
            v[9] !== 'debit-positive' ||
            v[10] !== 'provided-posted-carrying-value'
          )
            fail('POLICY');
          if (day(v[11] as string) > s.asOf || day(v[12] as string) < s.asOf)
            fail('VALIDITY');
        }
        if (source === 3) {
          if (v[2] !== 'inventory') fail('ACCOUNT_CLASS');
          v[3] = scaled(v[3] as string, decimals);
          v[4] = scaled(v[4] as string, decimals);
        }
        result.records[source].push({ id, source, row, values: v });
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('STOCK_')) throw e;
        problem(source, row, e.message.slice(6));
      }
    });
    if (good) {
      const detect = (fields: string[], code: string) => {
        const groups = new Map<string, number[]>();
        rows.slice(1).forEach((raw, i) => {
          const key = fields.map((k) => raw[positions[k]] ?? '');
          if (key.every(Boolean)) {
            const identity = JSON.stringify(key);
            const group = groups.get(identity) ?? [];
            group.push(i + 2);
            groups.set(identity, group);
          }
        });
        for (const group of groups.values())
          if (group.length > 1)
            for (const row of group) problem(source, row, code);
      };
      detect(
        source === 0 || source === 3
          ? STOCK_VALUES[source].slice(0, 2)
          : [STOCK_VALUES[source][0]],
        'DUPLICATE',
      );
      if (source === 1)
        detect(['Item ID', 'Item dimensions'], 'DUPLICATE_MAPPING');
    }
    if (!result.records[source].length) absent('source:' + source);
  });
  const compound = (parts: (string | number)[]) => JSON.stringify(parts);
  const itemKey = (v: (string | number)[]) => compound(v.slice(0, 2));
  const supported = new Map<string, bigint>();
  const mappingIndex = new Map<string, RecordRow[]>(),
    evidenceIndex = new Map<string | number, RecordRow[]>();
  for (const row of result.records[1]) {
    const key = compound(row.values.slice(1, 3));
    const group = mappingIndex.get(key) ?? [];
    group.push(row);
    mappingIndex.set(key, group);
  }
  for (const row of result.records[2]) {
    const key = row.values[0];
    const group = evidenceIndex.get(key) ?? [];
    group.push(row);
    evidenceIndex.set(key, group);
  }
  for (const item of result.records[0]) {
    const v = item.values,
      key = itemKey(v),
      mapping = mappingIndex.get(key) ?? [];
    if (mapping.length !== 1) {
      absent('mapping:' + key);
      continue;
    }
    const m = mapping[0].values,
      evidence = evidenceIndex.get(m[5]) ?? [];
    const expected = [v[0], v[1], v[3], v[4], v[6], m[3], m[4]];
    if (
      evidence.length !== 1 ||
      compound(evidence[0].values.slice(1, 8)) !== compound(expected)
    ) {
      absent('evidence:' + key);
      continue;
    }
    const account = compound(m.slice(3, 5));
    supported.set(account, (supported.get(account) ?? 0n) + BigInt(v[5]));
  }
  const itemKeys = new Set(result.records[0].map((r) => itemKey(r.values))),
    evidenceKeys = new Set(result.records[1].map((r) => r.values[5]));
  for (const r of result.records[1])
    if (!itemKeys.has(compound(r.values.slice(1, 3))))
      absent('orphan-mapping:' + r.values[0]);
  for (const r of result.records[2])
    if (!evidenceKeys.has(r.values[0]))
      absent('orphan-evidence:' + r.values[0]);
  const glKeys = new Set(result.records[3].map((r) => itemKey(r.values)));
  for (const k of supported.keys()) if (!glKeys.has(k)) absent('gl:' + k);
  let glTotal = 0n;
  for (const gl of result.records[3]) {
    const v = gl.values,
      key = itemKey(v),
      amount = supported.get(key) ?? 0n,
      net = BigInt(v[3]) - BigInt(v[4]);
    if (!supported.has(key)) absent('account:' + key);
    glTotal += net;
    try {
      bounded(glTotal);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'STOCK_TOTAL_BOUND') throw e;
      problem(3, gl.row, 'TOTAL_BOUND');
    }
    const comparison: Comparison = {
      account: v[0] as string,
      dimensions: v[1] as string,
      registerMinor: null,
      debitMinor: null,
      creditMinor: null,
      glMinor: null,
      differenceMinor: null,
    };
    try {
      Object.assign(comparison, {
        registerMinor: bounded(amount),
        debitMinor: v[3],
        creditMinor: v[4],
        glMinor: bounded(net),
        differenceMinor: bounded(amount - net),
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'STOCK_TOTAL_BOUND') throw e;
      problem(3, gl.row, 'TOTAL_BOUND');
    }
    result.comparisons.push(comparison);
  }
  try {
    result.totals = {
      registerMinor: bounded(
        [...supported.values()].reduce((a, b) => a + b, 0n),
      ),
      glMinor: bounded(glTotal),
    };
  } catch (e) {
    if (!(e instanceof Error) || e.message !== 'STOCK_TOTAL_BOUND') throw e;
    problem(-1, 0, 'TOTAL_BOUND');
  }
  if (result.issues.length) {
    result.totals = null;
    for (const row of result.comparisons)
      Object.assign(row, {
        registerMinor: null,
        debitMinor: null,
        creditMinor: null,
        glMinor: null,
        differenceMinor: null,
      });
  }
  result.financial = result.issues.length
    ? 'source-error'
    : result.missing.length
      ? 'missing'
      : result.comparisons.some((r) => r.differenceMinor !== 0)
        ? 'difference'
        : 'ready';
  const ids = new Set<string>();
  const physicalIds = new Set(result.memberIds);
  let active: 'accept' | 'reject' | null = null,
    at = '';
  for (const event of input.events) {
    if (
      !plain(event) ||
      !keys(event, [
        'id',
        'type',
        'memberIds',
        'context',
        'at',
        'reference',
        'note',
      ])
    )
      fail('EVENT');
    text(event.id);
    text(event.reference, 2000);
    text(event.note, 2000);
    if (
      ids.has(event.id) ||
      !['accept', 'reject', 'undo'].includes(event.type) ||
      event.context !== context ||
      typeof event.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      new Date(event.at).toISOString() !== event.at ||
      event.at.slice(0, 4) === '0000' ||
      event.at < at
    )
      fail('EVENT');
    if (
      event.memberIds.length !== result.memberIds.length ||
      !result.memberIds.length ||
      new Set(event.memberIds).size !== event.memberIds.length ||
      !event.memberIds.every((id) => physicalIds.has(id))
    )
      fail('EVENT_MEMBERS');
    if (event.type === 'undo') {
      if (active === null) fail('EVENT_SEQUENCE');
      active = null;
    } else {
      if (active !== null) fail('EVENT_SEQUENCE');
      if (
        event.type === 'accept' &&
        (result.financial !== 'ready' || !completeness.confirmed)
      )
        fail('EVENT_ACCEPT');
      active = event.type;
    }
    ids.add(event.id);
    at = event.at;
    result.events.push({ ...event, memberIds: [...event.memberIds] });
  }
  result.review =
    active === 'accept'
      ? 'accepted'
      : active === 'reject'
        ? 'rejected'
        : 'needs-review';
  result.status =
    result.financial !== 'ready'
      ? result.financial
      : result.review === 'accepted'
        ? 'consistent-with-evidence'
        : 'needs-review';
  return result;
}
