import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';

// Pure asset component accounting; public IO must re-read/hash original sources.
export const ASSET_VERSION = 'fixed-assets-posted-components-gl-1';
export const ASSET_ROLES = [
  'register',
  'mapping',
  'policy-evidence',
  'gl',
] as const;
export const ASSET_FIELDS = [
  'entity',
  'assetLedger',
  'glLedger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'asOf',
  'chartVersion',
  'mapVersion',
  'componentPolicyVersion',
  'assetAccountSetVersion',
] as const;
export const ASSET_SCOPE_HEADERS = [
  'Entity',
  'Asset ledger',
  'GL ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'As of',
  'Chart version',
  'Map version',
  'Component policy version',
  'Asset account set version',
];
export const ASSET_COMPONENTS = ['cost', 'depreciation', 'impairment'] as const;
export type AssetComponent = (typeof ASSET_COMPONENTS)[number];
export const ASSET_CLASSES = [
  'fixed-asset-cost',
  'accumulated-depreciation',
  'accumulated-impairment',
] as const;
export const ASSET_SIGNS = [
  'debit-positive',
  'credit-positive',
  'credit-positive',
] as const;
export const ASSET_VALUES = [
  [
    'Asset ID',
    'Asset dimensions',
    'Cost',
    'Accumulated depreciation',
    'Impairment',
    'Carrying amount',
    'Valuation reference',
  ],
  [
    'Mapping ID',
    'Asset ID',
    'Asset dimensions',
    'Component',
    'GL account',
    'GL dimensions',
    'Evidence ID',
  ],
  [
    'Evidence ID',
    'Asset ID',
    'Asset dimensions',
    'Component',
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
export const ASSET_HEADERS = ASSET_VALUES.map((v) => [
  ...v,
  ...ASSET_SCOPE_HEADERS,
]);
export type AssetScope = Record<(typeof ASSET_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type AssetReading = {
  sheet: number;
  role: (typeof ASSET_ROLES)[number];
  family: typeof ASSET_VERSION;
  confirmed: boolean;
};
export type AssetEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  memberIds: string[];
  context: string;
  at: string;
  reference: string;
  note: string;
};
export type AssetInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [AssetReading, AssetReading, AssetReading, AssetReading];
  scope: AssetScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: AssetEvent[];
};
type Physical = { memberId: string; source: number; row: number };
export type AssetRegisterRow = Physical & {
  asset: string;
  dimensions: string;
  cost: number;
  depreciation: number;
  impairment: number;
  carrying: number;
  valuation: string;
};
export type AssetMappingRow = Physical & {
  id: string;
  asset: string;
  dimensions: string;
  component: AssetComponent;
  account: string;
  glDimensions: string;
  evidence: string;
};
export type AssetEvidenceRow = Physical & {
  id: string;
  asset: string;
  dimensions: string;
  component: AssetComponent;
  valuation: string;
  account: string;
  glDimensions: string;
  accountClass: string;
  sign: string;
  basis: string;
  validFrom: string;
  validTo: string;
  reference: string;
};
export type AssetGLRow = Physical & {
  account: string;
  glDimensions: string;
  accountClass: string;
  component: AssetComponent;
  debit: number;
  credit: number;
  normal: number;
};
export type AssetTotals = Record<AssetComponent | 'carrying', number>;
export type AssetMissing = {
  reason: string;
  source: number;
  row: number;
  component?: AssetComponent;
};
export type AssetComparison = {
  account: string;
  dimensions: string;
  component: AssetComponent;
  register: number | null;
  gl: number | null;
  difference: number | null;
  glRow: number;
  registerRows: number[];
};
export type AssetResult = {
  version: typeof ASSET_VERSION;
  context: string;
  scope: AssetScope;
  readings: AssetInput['readings'];
  completeness: AssetInput['completeness'];
  decimals: number;
  records: [
    AssetRegisterRow[],
    AssetMappingRow[],
    AssetEvidenceRow[],
    AssetGLRow[],
  ];
  issues: { source: number; row: number; code: string }[];
  missing: AssetMissing[];
  comparisons: AssetComparison[];
  totals: { register: AssetTotals; gl: AssetTotals } | null;
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
  events: AssetEvent[];
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
  throw Error('ASSET_' + code);
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
export function assertAssetEventBudget(events: unknown) {
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
export function reconcileAsset(input: AssetInput): AssetResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4
  )
    fail('INPUT');
  assertAssetEventBudget(input.events);
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...ASSET_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !ASSET_FIELDS.every((k) => text(s[k]) === s[k])
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
      r.role !== ASSET_ROLES[i] ||
      r.family !== ASSET_VERSION ||
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
      ...Object.fromEntries(ASSET_FIELDS.map((k) => [k, s[k]])),
      confirmed: true,
    } as AssetScope,
    readings = input.readings.map((r) => ({
      sheet: r.sheet,
      role: r.role,
      family: r.family,
      confirmed: r.confirmed,
    })) as AssetInput['readings'],
    completeness = { ...c };
  const context = JSON.stringify([
    ASSET_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const result: AssetResult = {
    version: ASSET_VERSION,
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
  const absent = (
    reason: string,
    source: number,
    row: number,
    component?: AssetComponent,
  ) =>
    result.missing.push({
      reason,
      source,
      row,
      ...(component ? { component } : {}),
    });
  const component = (value: string): AssetComponent => {
    if (!ASSET_COMPONENTS.includes(value as AssetComponent)) fail('COMPONENT');
    return value as AssetComponent;
  };
  input.files.forEach((f, source) => {
    const rows = f.sheets[0].rows,
      header = rows[0] ?? [],
      desired = ASSET_HEADERS[source];
    const good =
      header.length === desired.length &&
      new Set(header).size === desired.length &&
      desired.every((h) => header.includes(h));
    const positions = Object.fromEntries(header.map((h, i) => [h, i]));
    if (!rows.length) problem(source, 1, 'COLUMNS');
    rows.forEach((raw, index) => {
      const row = index + 1,
        blank = raw.every((v) => !v.trim()),
        memberId = JSON.stringify([ASSET_VERSION, source, f.sha256, 0, row]);
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
      if (index > 0 && !blank) result.memberIds.push(memberId);
      if (index === 0) {
        if (!good) problem(source, row, 'COLUMNS');
        return;
      }
      if (blank) return;
      if (!good || raw.length !== header.length) {
        problem(source, row, 'COLUMNS');
        return;
      }
      const get = (key: string) => raw[positions[key]],
        physical = { source, row, memberId };
      try {
        if (
          ASSET_FIELDS.some((k, i) => get(ASSET_SCOPE_HEADERS[i]) !== scope[k])
        )
          fail('ROW_SCOPE');
        if (source === 0) {
          const cost = scaled(get('Cost'), decimals),
            depreciation = scaled(get('Accumulated depreciation'), decimals),
            impairment = scaled(get('Impairment'), decimals),
            carrying = scaled(get('Carrying amount'), decimals);
          if (
            BigInt(cost) - BigInt(depreciation) - BigInt(impairment) < 0n ||
            BigInt(cost) - BigInt(depreciation) - BigInt(impairment) !==
              BigInt(carrying)
          )
            fail('CARRYING_EQUATION');
          result.records[0].push({
            ...physical,
            asset: text(get('Asset ID')),
            dimensions: text(get('Asset dimensions')),
            cost,
            depreciation,
            impairment,
            carrying,
            valuation: text(get('Valuation reference')),
          });
        } else if (source === 1) {
          result.records[1].push({
            ...physical,
            id: text(get('Mapping ID')),
            asset: text(get('Asset ID')),
            dimensions: text(get('Asset dimensions')),
            component: component(get('Component')),
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            evidence: text(get('Evidence ID')),
          });
        } else if (source === 2) {
          const c = component(get('Component')),
            i = ASSET_COMPONENTS.indexOf(c),
            accountClass = get('Account class'),
            sign = get('Sign'),
            basis = get('Value basis');
          if (
            accountClass !== ASSET_CLASSES[i] ||
            sign !== ASSET_SIGNS[i] ||
            basis !== 'provided-posted-component'
          )
            fail('POLICY');
          const validFrom = day(get('Valid from')),
            validTo = day(get('Valid to'));
          if (validFrom > scope.asOf || validTo < scope.asOf) fail('VALIDITY');
          result.records[2].push({
            ...physical,
            id: text(get('Evidence ID')),
            asset: text(get('Asset ID')),
            dimensions: text(get('Asset dimensions')),
            component: c,
            valuation: text(get('Valuation reference')),
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            accountClass,
            sign,
            basis,
            validFrom,
            validTo,
            reference: text(get('Reference'), 2000),
          });
        } else {
          const accountClass = get('Account class'),
            i = ASSET_CLASSES.indexOf(
              accountClass as (typeof ASSET_CLASSES)[number],
            );
          if (i < 0) fail('CLASS');
          const c = ASSET_COMPONENTS[i],
            debit = scaled(get('Debit'), decimals),
            credit = scaled(get('Credit'), decimals);
          result.records[3].push({
            ...physical,
            account: text(get('GL account')),
            glDimensions: text(get('GL dimensions')),
            accountClass,
            component: c,
            debit,
            credit,
            normal: c === 'cost' ? debit - credit : credit - debit,
          });
        }
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('ASSET_')) throw e;
        problem(source, row, e.message.slice(6));
      }
    });
    const detect = (fields: string[], code: string) => {
      if (!fields.every((k) => header.includes(k))) return;
      const groups = new Map<string, number[]>();
      rows.slice(1).forEach((raw, i) => {
        if (!raw.some((v) => v.trim())) return;
        const key = JSON.stringify(fields.map((k) => raw[positions[k]] ?? '')),
          group = groups.get(key) ?? [];
        group.push(i + 2);
        groups.set(key, group);
      });
      for (const group of groups.values())
        if (group.length > 1)
          for (const row of group) problem(source, row, code);
    };
    detect(
      source === 0
        ? ['Asset ID', 'Asset dimensions']
        : source === 1
          ? ['Asset ID', 'Asset dimensions', 'Component']
          : source === 2
            ? ['Evidence ID']
            : ['GL account', 'GL dimensions'],
      'DUPLICATE',
    );
    if (source === 1) detect(['Mapping ID'], 'DUPLICATE_MAPPING_ID');
  });
  const [register, mapping, policies, gls] = result.records;
  const key = (v: { asset: string; dimensions: string }) =>
    JSON.stringify([v.asset, v.dimensions]);
  const accountKey = (v: { account: string; glDimensions: string }) =>
    JSON.stringify([v.account, v.glDimensions]);
  const mappingIndex = new Map<string, AssetMappingRow[]>(),
    evidenceIndex = new Map<string, AssetEvidenceRow[]>(),
    glIndex = new Map<string, AssetGLRow[]>();
  for (const m of mapping) {
    const k = JSON.stringify([key(m), m.component]),
      group = mappingIndex.get(k) ?? [];
    group.push(m);
    mappingIndex.set(k, group);
  }
  for (const p of policies) {
    const group = evidenceIndex.get(p.id) ?? [];
    group.push(p);
    evidenceIndex.set(p.id, group);
  }
  for (const g of gls) {
    const k = accountKey(g),
      group = glIndex.get(k) ?? [];
    group.push(g);
    glIndex.set(k, group);
  }
  const usedMapping = new Set<number>(),
    usedEvidence = new Set<number>(),
    allocations = new Map<
      string,
      { item: AssetRegisterRow; component: AssetComponent }[]
    >();
  for (const item of register)
    for (const c of ASSET_COMPONENTS) {
      const group = mappingIndex.get(JSON.stringify([key(item), c])) ?? [];
      if (group.length !== 1) {
        absent('mapping', 0, item.row, c);
        continue;
      }
      const m = group[0];
      usedMapping.add(m.row);
      const evidence = evidenceIndex.get(m.evidence) ?? [];
      if (evidence.length !== 1) {
        absent('evidence', 1, m.row, c);
        continue;
      }
      const p = evidence[0];
      if (
        key(p) !== key(item) ||
        p.component !== c ||
        p.valuation !== item.valuation ||
        accountKey(p) !== accountKey(m)
      ) {
        absent('evidence-match', 1, m.row, c);
        continue;
      }
      usedEvidence.add(p.row);
      const gs = glIndex.get(accountKey(m)) ?? [];
      if (gs.length !== 1 || gs[0].component !== c) {
        absent('gl', 1, m.row, c);
        continue;
      }
      const k = accountKey(m),
        assigned = allocations.get(k) ?? [];
      assigned.push({ item, component: c });
      allocations.set(k, assigned);
    }
  for (const m of mapping)
    if (!usedMapping.has(m.row))
      absent('orphan-mapping', 1, m.row, m.component);
  for (const p of policies)
    if (!usedEvidence.has(p.row))
      absent('orphan-evidence', 2, p.row, p.component);
  const totalsKeys = [...ASSET_COMPONENTS, 'carrying'] as const;
  const registerTotals = {
      cost: 0n,
      depreciation: 0n,
      impairment: 0n,
      carrying: 0n,
    },
    glTotals = { cost: 0n, depreciation: 0n, impairment: 0n, carrying: 0n };
  for (const r of register)
    for (const k of totalsKeys) registerTotals[k] += BigInt(r[k]);
  if (totalsKeys.some((k) => registerTotals[k] > 100000000000000n))
    problem(0, 0, 'AGGREGATE_BOUND');
  for (const g of gls) {
    glTotals[g.component] += BigInt(g.normal);
    if (
      glTotals[g.component] > 100000000000000n ||
      glTotals[g.component] < -100000000000000n
    )
      problem(3, g.row, 'AGGREGATE_BOUND');
    const assigned = allocations.get(accountKey(g)) ?? [];
    if (!assigned.length) absent('unmapped-gl', 3, g.row, g.component);
    const value = assigned.reduce(
      (sum, { item, component }) => sum + BigInt(item[component]),
      0n,
    );
    if (value > 100000000000000n) problem(3, g.row, 'AGGREGATE_BOUND');
    result.comparisons.push({
      account: g.account,
      dimensions: g.glDimensions,
      component: g.component,
      register: value <= 100000000000000n ? Number(value) : null,
      gl: g.normal,
      difference:
        value <= 100000000000000n ? Number(value - BigInt(g.normal)) : null,
      glRow: g.row,
      registerRows: assigned.map(({ item }) => item.row),
    });
  }
  glTotals.carrying =
    glTotals.cost - glTotals.depreciation - glTotals.impairment;
  if (
    glTotals.carrying > 100000000000000n ||
    glTotals.carrying < -100000000000000n
  )
    problem(3, 0, 'AGGREGATE_BOUND');
  result.records.forEach((r, i) => {
    if (!r.length) absent('empty-source', i, 0);
  });
  if (result.issues.length) {
    for (const c of result.comparisons)
      Object.assign(c, { register: null, gl: null, difference: null });
  } else
    result.totals = {
      register: Object.fromEntries(
        totalsKeys.map((k) => [k, Number(registerTotals[k])]),
      ) as AssetTotals,
      gl: Object.fromEntries(
        totalsKeys.map((k) => [k, Number(glTotals[k])]),
      ) as AssetTotals,
    };
  result.financial = result.issues.length
    ? 'source-error'
    : result.missing.length
      ? 'missing'
      : result.comparisons.some((c) => c.difference !== 0)
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
