import {
  IC_HEADERS,
  IC_SCOPE_FIELDS,
  IC_SCOPE_HEADERS,
  icAmount,
  icDate,
  icSum,
  icText,
} from './intercompany.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';

// Proposed family (audit/intercompany-batch-foundation/contract.json): several
// entity pairs in one run, each a declared batch decided on its own. The
// single-pair intercompany-ledger-1 family is unchanged beside it.
export const IC_BATCH_VERSION = 'intercompany-batch-1';
export const IC_BATCH_ROLES = [
  'batch-declaration',
  'entity-ledger',
  'relation-members',
] as const;
export const IC_BATCH_HEADERS = {
  'batch-declaration': ['Batch ID', ...IC_SCOPE_HEADERS],
  'entity-ledger': [...IC_HEADERS[0]],
  'relation-members': [
    'Relation ID',
    'Batch ID',
    'Side',
    'Transaction ID',
    'Relationship reference',
    'Valid from',
    'Valid to',
  ],
} as const;
export const IC_BATCH_CLAIM =
  'Consistency of supplied ledger transactions with confirmed relationship evidence, batch by batch; no posting, elimination, consolidation, netting between batches, currency translation, source authenticity or ERP completeness opinion';
export const IC_BATCH_BLOCKING = [
  'HEADER',
  'BATCH_FIELD',
  'BATCH_DUPLICATE',
  'BATCH_OVERLAP',
  'UNASSIGNED',
  'UNASSIGNED_AMBIGUOUS',
  'IDENTITY',
  'DATE',
  'AMOUNT',
  'BOTH_SIDES',
  'POSTING_PERIOD',
  'DUPLICATE_TRANSACTION',
  'RELATION_UNATTRIBUTED',
  'RELATION_FIELD',
  'RELATION_BATCHES',
  'RELATION_FIELDS_DIFFER',
  'VALIDITY',
  'RELATION_DUPLICATE_MEMBER',
  'COUNTERPARTY_CONFLICT',
] as const;
export const IC_BATCH_MISSING = [
  'RELATION_MEMBER_MISSING',
  'RELATION_ONE_SIDED',
  'UNRELATED',
  'SIDE_EMPTY',
] as const;
export const IC_BATCH_FILE_LIMIT = 64;

type Role = (typeof IC_BATCH_ROLES)[number];
type Side = 'A' | 'B';
export type IntercompanyBatchReading = {
  sheet: number;
  role: Role;
  family: typeof IC_BATCH_VERSION;
  confirmed: boolean;
};
export type IntercompanyBatchInput = {
  files: SourceFile[];
  readings: IntercompanyBatchReading[];
};
export type IntercompanyBatchPlace = { source: number; row: number };
export type IntercompanyBatchEntry = IntercompanyBatchPlace & {
  side: Side;
  transactionId: string;
  counterpartyTransactionId: string;
  date: string;
  debit: number;
  credit: number;
  net: number;
};
export type IntercompanyBatchRelation = {
  relationId: string;
  places: IntercompanyBatchPlace[];
  members: Record<Side, string[]>;
  status: 'blocked' | 'missing' | 'ready' | 'difference';
  net: Record<Side, number> | null;
  residual: number | null;
  rows: Record<Side, IntercompanyBatchPlace[]> | null;
};
export type IntercompanyBatch = {
  id: string;
  declarations: IntercompanyBatchPlace[];
  scope: Record<(typeof IC_SCOPE_FIELDS)[number], string>;
  decimals: number | null;
  status: 'blocked' | 'missing' | 'difference' | 'ready';
  codes: string[];
  findings: (IntercompanyBatchPlace & { code: string })[];
  sides: Record<Side, IntercompanyBatchPlace[]>;
  entries: Record<Side, IntercompanyBatchEntry[]>;
  relations: IntercompanyBatchRelation[];
};
export type IntercompanyBatchResult = {
  version: typeof IC_BATCH_VERSION;
  claim: typeof IC_BATCH_CLAIM;
  context: string;
  sources: { name: string; hash: string; role: Role }[];
  batches: IntercompanyBatch[];
  unassigned: (IntercompanyBatchPlace & { code: string; entity: string })[];
  run: string[];
};

type Fields = Record<string, string>;
type Record_ = IntercompanyBatchPlace & {
  fields: Fields | null;
  raw: string[];
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never {
  throw new Error(`IC_BATCH_${code}`);
}
const COMMON = IC_SCOPE_HEADERS.slice(8);
const valid = (check: () => unknown) => {
  try {
    check();
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('IC_')) return false;
    throw e;
  }
};
const isText = (v: string, limit = 500, identity = true) =>
  valid(() => icText(v, limit, identity));
const isDate = (v: string) => valid(() => icDate(v));
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function validate(input: IntercompanyBatchInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'files|readings' ||
    !Array.isArray(input.files) ||
    !Array.isArray(input.readings) ||
    input.files.length < 3 ||
    input.files.length > IC_BATCH_FILE_LIMIT ||
    input.readings.length !== input.files.length
  )
    fail('INPUT');
  const roles = input.readings.map((r) => {
    if (
      !plain(r) ||
      Object.keys(r).sort().join('|') !== 'confirmed|family|role|sheet' ||
      r.sheet !== 0 ||
      r.family !== IC_BATCH_VERSION ||
      r.confirmed !== true ||
      !IC_BATCH_ROLES.includes(r.role)
    )
      fail('READING');
    return r.role;
  });
  if (
    roles.filter((r) => r === 'batch-declaration').length !== 1 ||
    roles.filter((r) => r === 'relation-members').length !== 1
  )
    fail('ROLES');
  let rows = 0;
  input.files.forEach((file) => {
    assertSourceFile(file);
    if (
      !isText(file.name, 255, false) ||
      !/\.csv$/i.test(file.name) ||
      file.kind !== undefined ||
      file.sheets.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
      !(file.original instanceof ArrayBuffer) ||
      !file.original.byteLength ||
      file.original.byteLength > MAX_FILE_BYTES
    )
      fail('SOURCE');
    for (const row of file.sheets[0].rows)
      for (const value of row) if (value.length > 32767) fail('CELL_LIMIT');
    rows += Math.max(0, file.sheets[0].rows.length - 1);
  });
  if (new Set(input.files.map((f) => f.sha256)).size !== input.files.length)
    fail('INDEPENDENT_SOURCES');
  if (rows > MAX_ROWS) fail('ROWS');
  return roles;
}

function table(file: SourceFile, source: number, head: readonly string[]) {
  const [first, ...rest] = file.sheets[0].rows;
  if (
    !first ||
    first.length !== head.length ||
    new Set(first).size !== first.length ||
    !head.every((h) => first.includes(h))
  )
    return null;
  const out: Record_[] = [];
  rest.forEach((raw, i) => {
    if (!raw.some((v) => v.trim())) return;
    out.push({
      source,
      row: i + 2,
      raw: [...raw],
      fields:
        raw.length === first.length
          ? Object.fromEntries(first.map((h, c) => [h, raw[c]]))
          : null,
    });
  });
  return out;
}

function declarationValid(d: Fields) {
  if (!IC_BATCH_HEADERS['batch-declaration'].every((h) => isText(d[h])))
    return false;
  return (
    d['Entity A'] !== d['Entity B'] &&
    currencyPrecision(d.Currency) !== undefined &&
    d['Currency basis'] === 'functional' &&
    d['FX policy'] === 'same-currency-no-conversion' &&
    d['Posting status'] === 'posted' &&
    isDate(d['Period start']) &&
    isDate(d['Period end']) &&
    isDate(d['As of']) &&
    d['Period start'] <= d['Period end'] &&
    d['As of'] === d['Period end']
  );
}

const sideKey = (d: Fields, side: Side) => {
  const [me, other] = side === 'A' ? ['A', 'B'] : ['B', 'A'];
  return JSON.stringify([
    d[`Entity ${me}`],
    d[`Entity ${other}`],
    d[`Ledger ${me}`],
    d[`Account ${me}`],
    d[`Dimensions ${me}`],
    ...COMMON.map((h) => d[h]),
  ]);
};
const rowKey = (r: Fields) =>
  JSON.stringify([
    r.Entity,
    r.Counterparty,
    r.Ledger,
    r['Account ID'],
    r['Complete dimensions'],
    ...COMMON.map((h) => r[h]),
  ]);
const pairOf = (d: Fields) =>
  (['A', 'B'] as const)
    .map((s) =>
      JSON.stringify(
        ['Entity', 'Ledger', 'Account', 'Dimensions'].map(
          (h) => d[`${h} ${s}`],
        ),
      ),
    )
    .sort(byText)
    .join('\u0000');
const policyOf = (d: Fields) =>
  JSON.stringify(
    [
      'Currency',
      'Currency basis',
      'FX policy',
      'Posting status',
      'Posting layer',
      'Policy version',
    ].map((h) => d[h]),
  );

export function reconcileIntercompanyBatches(
  input: IntercompanyBatchInput,
): IntercompanyBatchResult {
  const roles = validate(input);
  const files = input.files;
  const context = JSON.stringify([
    IC_BATCH_VERSION,
    files.map((f) => f.sha256),
    roles,
  ]);
  const run = new Set<string>();
  const codes = new Map<string, Set<string>>();
  const findings = new Map<
    string,
    Map<string, IntercompanyBatchPlace & { code: string }>
  >();
  const flag = (bid: string, code: string, at?: IntercompanyBatchPlace) => {
    let c = codes.get(bid);
    if (!c) codes.set(bid, (c = new Set()));
    c.add(code);
    if (at) {
      let f = findings.get(bid);
      if (!f) findings.set(bid, (f = new Map()));
      f.set(JSON.stringify([code, at.source, at.row]), { code, ...at });
    }
  };
  const tableOf = (role: Role) =>
    roles.flatMap((r, source) => {
      if (r !== role) return [];
      const t = table(files[source], source, IC_BATCH_HEADERS[role]);
      if (!t) run.add('HEADER');
      return t ?? [];
    });

  // Declarations: the separation contract.
  const declared = new Map<
    string,
    (IntercompanyBatchPlace & { d: Fields })[]
  >();
  for (const r of tableOf('batch-declaration')) {
    const bid = r.fields?.['Batch ID'];
    if (!r.fields || bid === undefined || !isText(bid)) {
      run.add('BATCH_FIELD');
      continue;
    }
    const at = { source: r.source, row: r.row };
    const list = declared.get(bid) ?? [];
    list.push({ ...at, d: r.fields });
    declared.set(bid, list);
    if (!declarationValid(r.fields)) flag(bid, 'BATCH_FIELD', at);
  }
  for (const [bid, list] of declared)
    if (list.length > 1)
      for (const at of list)
        flag(bid, 'BATCH_DUPLICATE', { source: at.source, row: at.row });
  const decls = [...declared].flatMap(([bid, list]) =>
    list.map((x) => ({ bid, ...x })),
  );
  for (let i = 0; i < decls.length; i++)
    for (let j = i + 1; j < decls.length; j++) {
      const a = decls[i],
        b = decls[j];
      if (
        a.bid === b.bid ||
        ![a, b].every(
          (x) => isDate(x.d['Period start']) && isDate(x.d['Period end']),
        )
      )
        continue;
      if (
        pairOf(a.d) === pairOf(b.d) &&
        policyOf(a.d) === policyOf(b.d) &&
        (a.d['Period start'] > b.d['Period start']
          ? a.d['Period start']
          : b.d['Period start']) <=
          (a.d['Period end'] < b.d['Period end']
            ? a.d['Period end']
            : b.d['Period end'])
      ) {
        flag(a.bid, 'BATCH_OVERLAP', { source: a.source, row: a.row });
        flag(b.bid, 'BATCH_OVERLAP', { source: b.source, row: b.row });
      }
    }

  // Assignment by declared identity only (B1, B2).
  const keys = new Map<string, Map<string, { bid: string; side: Side }>>();
  for (const x of decls)
    for (const side of ['A', 'B'] as const) {
      const k = sideKey(x.d, side);
      const m = keys.get(k) ?? new Map<string, { bid: string; side: Side }>();
      m.set(`${x.bid}\u0000${side}`, { bid: x.bid, side });
      keys.set(k, m);
    }
  type Assigned = { bid: string; side: Side; r: Record_ & { fields: Fields } };
  const assigned: Assigned[] = [];
  const loose: { r: Record_; entity: string; code: string; hit: string[] }[] =
    [];
  for (const r of tableOf('entity-ledger')) {
    if (!r.fields) {
      const head = files[r.source].sheets[0].rows[0];
      loose.push({
        r,
        entity: r.raw[head.indexOf('Entity')] ?? '',
        code: 'UNASSIGNED',
        hit: [],
      });
      continue;
    }
    const found = [...(keys.get(rowKey(r.fields))?.values() ?? [])];
    if (found.length === 1)
      assigned.push({ ...found[0], r: r as Record_ & { fields: Fields } });
    else
      loose.push({
        r,
        entity: r.fields.Entity,
        code: found.length ? 'UNASSIGNED_AMBIGUOUS' : 'UNASSIGNED',
        hit: found.map((f) => f.bid),
      });
  }
  const feeds = new Map<number, Set<string>>();
  for (const a of assigned) {
    const s = feeds.get(a.r.source) ?? new Set<string>();
    s.add(a.bid);
    feeds.set(a.r.source, s);
  }
  const unassigned: IntercompanyBatchResult['unassigned'] = [];
  for (const x of loose) {
    const at = { source: x.r.source, row: x.r.row };
    unassigned.push({ ...at, code: x.code, entity: x.entity });
    const hit =
      x.code === 'UNASSIGNED_AMBIGUOUS'
        ? new Set(x.hit)
        : new Set([
            ...decls
              .filter(
                (d) =>
                  x.entity === d.d['Entity A'] || x.entity === d.d['Entity B'],
              )
              .map((d) => d.bid),
            ...(feeds.get(x.r.source) ?? []),
          ]);
    for (const bid of hit) flag(bid, x.code, at);
  }

  const entries = new Map<string, IntercompanyBatchEntry[]>();
  const at = (bid: string, side: Side, tx: string) =>
    entries.get(JSON.stringify([bid, side, tx]));
  for (const a of assigned) {
    const d = declared.get(a.bid)![0].d,
      f = a.r.fields,
      place = { source: a.r.source, row: a.r.row };
    let posted: string;
    try {
      icText(f['Transaction ID']);
      icText(f['Counterparty transaction ID']);
    } catch {
      flag(a.bid, 'IDENTITY', place);
      continue;
    }
    try {
      posted = icDate(f['Posting date']);
    } catch {
      flag(a.bid, 'DATE', place);
      continue;
    }
    if (
      isDate(d['Period start']) &&
      isDate(d['Period end']) &&
      (posted < d['Period start'] || posted > d['Period end'])
    )
      flag(a.bid, 'POSTING_PERIOD', place);
    const decimals = currencyPrecision(d.Currency);
    if (decimals === undefined) continue;
    let debit: number, credit: number;
    try {
      debit = icAmount(f.Debit, decimals);
      credit = icAmount(f.Credit, decimals);
    } catch {
      flag(a.bid, 'AMOUNT', place);
      continue;
    }
    if (debit > 0 && credit > 0) {
      flag(a.bid, 'BOTH_SIDES', place);
      continue;
    }
    const k = JSON.stringify([a.bid, a.side, f['Transaction ID']]);
    const list = entries.get(k) ?? [];
    list.push({
      ...place,
      side: a.side,
      transactionId: f['Transaction ID'],
      counterpartyTransactionId: f['Counterparty transaction ID'],
      date: posted,
      debit,
      credit,
      net: icSum([debit, -credit]),
    });
    entries.set(k, list);
  }
  const transactions = new Map<string, Assigned[]>();
  for (const a of assigned) {
    const tx = a.r.fields['Transaction ID'];
    if (!tx) continue;
    const k = JSON.stringify([a.bid, a.side, tx]);
    transactions.set(k, [...(transactions.get(k) ?? []), a]);
  }
  for (const list of transactions.values())
    if (list.length > 1)
      for (const a of list)
        flag(a.bid, 'DUPLICATE_TRANSACTION', {
          source: a.r.source,
          row: a.r.row,
        });

  // Relation members (B3, B4, B5, B8).
  type Member = IntercompanyBatchPlace & {
    bid: string;
    rid: string;
    side: Side;
    tx: string;
    terms: string;
    from: string;
    to: string;
  };
  const members: Member[] = [];
  for (const r of tableOf('relation-members')) {
    const f = r.fields;
    if (!f || !declared.has(f['Batch ID'])) {
      run.add('RELATION_UNATTRIBUTED');
      continue;
    }
    const place = { source: r.source, row: r.row };
    if (
      !isText(f['Relation ID']) ||
      (f.Side !== 'A' && f.Side !== 'B') ||
      !isText(f['Transaction ID']) ||
      !isText(f['Relationship reference'], 2000, false) ||
      !isDate(f['Valid from']) ||
      !isDate(f['Valid to'])
    ) {
      flag(f['Batch ID'], 'RELATION_FIELD', place);
      continue;
    }
    members.push({
      ...place,
      bid: f['Batch ID'],
      rid: f['Relation ID'],
      side: f.Side,
      tx: f['Transaction ID'],
      terms: JSON.stringify([
        f['Relationship reference'],
        f['Valid from'],
        f['Valid to'],
      ]),
      from: f['Valid from'],
      to: f['Valid to'],
    });
  }
  const byRelation = new Map<string, Member[]>();
  for (const m of members)
    byRelation.set(m.rid, [...(byRelation.get(m.rid) ?? []), m]);
  for (const list of byRelation.values()) {
    const across = new Set(list.map((m) => m.bid)).size > 1,
      differ = new Set(list.map((m) => m.terms)).size > 1;
    for (const m of list) {
      const place = { source: m.source, row: m.row };
      if (across) flag(m.bid, 'RELATION_BATCHES', place);
      if (differ) flag(m.bid, 'RELATION_FIELDS_DIFFER', place);
      const d = declared.get(m.bid)![0].d;
      if (
        isDate(d['Period start']) &&
        isDate(d['Period end']) &&
        (m.from > d['Period start'] || m.to < d['Period end'] || m.from > m.to)
      )
        flag(m.bid, 'VALIDITY', place);
    }
  }
  const named = new Map<string, Member[]>();
  for (const m of members) {
    const k = JSON.stringify([m.bid, m.side, m.tx]);
    named.set(k, [...(named.get(k) ?? []), m]);
  }
  for (const list of named.values())
    if (list.length > 1)
      for (const m of list)
        flag(m.bid, 'RELATION_DUPLICATE_MEMBER', {
          source: m.source,
          row: m.row,
        });
  const relations = new Map<
    string,
    { bid: string; rid: string; list: Member[] }
  >();
  for (const m of members) {
    const k = JSON.stringify([m.bid, m.rid]);
    const g = relations.get(k) ?? { bid: m.bid, rid: m.rid, list: [] };
    g.list.push(m);
    relations.set(k, g);
  }
  const sidesOf = (list: Member[]) => ({
    A: list.filter((m) => m.side === 'A').map((m) => m.tx),
    B: list.filter((m) => m.side === 'B').map((m) => m.tx),
  });
  for (const g of relations.values()) {
    const named = sidesOf(g.list);
    for (const [side, other] of [
      ['A', 'B'],
      ['B', 'A'],
    ] as const)
      for (const tx of named[side])
        for (const e of at(g.bid, side, tx) ?? [])
          if (
            at(g.bid, other, e.counterpartyTransactionId) &&
            !named[other].includes(e.counterpartyTransactionId)
          )
            flag(g.bid, 'COUNTERPARTY_CONFLICT', {
              source: e.source,
              row: e.row,
            });
  }

  // Each batch on its own: no netting between relations or batches.
  const batches: IntercompanyBatch[] = [];
  for (const [bid, list] of declared) {
    for (const code of run) flag(bid, code);
    const d = list[0].d;
    const decimals = currencyPrecision(d.Currency) ?? null;
    const mine = [...relations.values()].filter((g) => g.bid === bid);
    const own = [...entries.entries()]
      .filter(([k]) => (JSON.parse(k) as string[])[0] === bid)
      .flatMap(([, v]) => v);
    const sides = {
      A: assigned
        .filter((a) => a.bid === bid && a.side === 'A')
        .map((a) => ({ source: a.r.source, row: a.r.row })),
      B: assigned
        .filter((a) => a.bid === bid && a.side === 'B')
        .map((a) => ({ source: a.r.source, row: a.r.row })),
    };
    const blocking = [...(codes.get(bid) ?? [])]
      .filter((c) => (IC_BATCH_BLOCKING as readonly string[]).includes(c))
      .sort(byText);
    const out: IntercompanyBatch = {
      id: bid,
      declarations: list.map((x) => ({ source: x.source, row: x.row })),
      scope: Object.fromEntries(
        IC_SCOPE_FIELDS.map((k, i) => [k, d[IC_SCOPE_HEADERS[i]]]),
      ) as IntercompanyBatch['scope'],
      decimals,
      status: 'blocked',
      codes: blocking,
      findings: [...(findings.get(bid)?.values() ?? [])].sort(
        (a, b) =>
          byText(a.code, b.code) || a.source - b.source || a.row - b.row,
      ),
      sides,
      entries: {
        A: own.filter((e) => e.side === 'A'),
        B: own.filter((e) => e.side === 'B'),
      },
      relations: [],
    };
    batches.push(out);
    if (blocking.length) {
      out.relations = mine.map((g) => ({
        relationId: g.rid,
        places: g.list.map((m) => ({ source: m.source, row: m.row })),
        members: sidesOf(g.list),
        status: 'blocked',
        net: null,
        residual: null,
        rows: null,
      }));
      continue;
    }
    const missing = new Set<string>();
    for (const g of mine) {
      const names = sidesOf(g.list);
      const found = {
        A: names.A.map((tx) => at(bid, 'A', tx)?.[0]),
        B: names.B.map((tx) => at(bid, 'B', tx)?.[0]),
      };
      const oneSided = !names.A.length || !names.B.length,
        absent = [...found.A, ...found.B].some((e) => !e);
      if (oneSided) missing.add('RELATION_ONE_SIDED');
      if (absent) missing.add('RELATION_MEMBER_MISSING');
      const relation: IntercompanyBatchRelation = {
        relationId: g.rid,
        places: g.list.map((m) => ({ source: m.source, row: m.row })),
        members: names,
        status: 'missing',
        net: null,
        residual: null,
        rows: null,
      };
      if (!oneSided && !absent) {
        const a = found.A as IntercompanyBatchEntry[],
          b = found.B as IntercompanyBatchEntry[];
        const net = {
          A: icSum(a.map((e) => e.net)),
          B: icSum(b.map((e) => e.net)),
        };
        relation.net = net;
        relation.residual = icSum([net.A, net.B]);
        relation.status = relation.residual === 0 ? 'ready' : 'difference';
        relation.rows = {
          A: a.map((e) => ({ source: e.source, row: e.row })),
          B: b.map((e) => ({ source: e.source, row: e.row })),
        };
      }
      out.relations.push(relation);
    }
    const related = new Set(
      mine.flatMap((g) => g.list.map((m) => JSON.stringify([m.side, m.tx]))),
    );
    if (
      own.some((e) => !related.has(JSON.stringify([e.side, e.transactionId])))
    )
      missing.add('UNRELATED');
    if (!sides.A.length || !sides.B.length) missing.add('SIDE_EMPTY');
    out.codes = [...missing].sort(byText);
    out.status = missing.size
      ? 'missing'
      : out.relations.some((r) => r.status === 'difference')
        ? 'difference'
        : 'ready';
  }
  return {
    version: IC_BATCH_VERSION,
    claim: IC_BATCH_CLAIM,
    context,
    sources: files.map((f, i) => ({
      name: f.name,
      hash: f.sha256!,
      role: roles[i],
    })),
    batches,
    unassigned: unassigned.sort((a, b) => a.source - b.source || a.row - b.row),
    run: [...run].sort(byText),
  };
}
