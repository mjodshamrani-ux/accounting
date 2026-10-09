import { latinDigits, parseDate, parseMoney } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, MAX_FILE_BYTES, type SourceFile } from './types.ts';
export const IC_VERSION = 'intercompany-ledger-1';
export const IC_SESSION_LIMIT = 64 * 1024 * 1024;
export const IC_ROLES = [
  'left-ledger',
  'right-ledger',
  'relationship-evidence',
  'timing-evidence',
] as const;
export const IC_SCOPE_FIELDS = [
  'entityA',
  'entityB',
  'ledgerA',
  'ledgerB',
  'accountA',
  'accountB',
  'dimensionsA',
  'dimensionsB',
  'currency',
  'currencyBasis',
  'fxPolicy',
  'postingStatus',
  'postingLayer',
  'start',
  'end',
  'asOf',
  'policyVersion',
] as const;
export const IC_SCOPE_HEADERS = [
  'Entity A',
  'Entity B',
  'Ledger A',
  'Ledger B',
  'Account A',
  'Account B',
  'Dimensions A',
  'Dimensions B',
  'Currency',
  'Currency basis',
  'FX policy',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
  'As of',
  'Policy version',
] as const;
export const IC_HEADERS = [
  [
    'Entity',
    'Counterparty',
    'Ledger',
    'Account ID',
    'Complete dimensions',
    'Transaction ID',
    'Counterparty transaction ID',
    'Posting date',
    'Debit',
    'Credit',
    'Currency',
    'Currency basis',
    'FX policy',
    'Posting status',
    'Posting layer',
    'Period start',
    'Period end',
    'As of',
    'Policy version',
  ],
  [
    'Entity',
    'Counterparty',
    'Ledger',
    'Account ID',
    'Complete dimensions',
    'Transaction ID',
    'Counterparty transaction ID',
    'Posting date',
    'Debit',
    'Credit',
    'Currency',
    'Currency basis',
    'FX policy',
    'Posting status',
    'Posting layer',
    'Period start',
    'Period end',
    'As of',
    'Policy version',
  ],
  [
    'Relation ID',
    'Left transaction ID',
    'Right transaction ID',
    'Left account',
    'Left dimensions',
    'Right account',
    'Right dimensions',
    'Left posting date',
    'Right posting date',
    'Valid from',
    'Valid to',
    'Relationship reference',
    'Entity A',
    'Entity B',
    'Ledger A',
    'Ledger B',
    'Account A',
    'Account B',
    'Dimensions A',
    'Dimensions B',
    'Currency',
    'Currency basis',
    'FX policy',
    'Posting status',
    'Posting layer',
    'Period start',
    'Period end',
    'As of',
    'Policy version',
  ],
  [
    'Evidence ID',
    'Side',
    'Transaction ID',
    'Counterparty transaction ID',
    'Counterparty posting date',
    'Expected counterparty amount',
    'Timing reference',
    'Entity A',
    'Entity B',
    'Ledger A',
    'Ledger B',
    'Account A',
    'Account B',
    'Dimensions A',
    'Dimensions B',
    'Currency',
    'Currency basis',
    'FX policy',
    'Posting status',
    'Posting layer',
    'Period start',
    'Period end',
    'As of',
    'Policy version',
  ],
] as const;
export const IC_CLAIM =
  'Consistency of supplied reciprocal ledger transactions with confirmed relationship evidence only; no posting, elimination, consolidation, source authenticity or ERP completeness opinion';

export type IntercompanyScope = Record<
  (typeof IC_SCOPE_FIELDS)[number],
  string
> & { confirmed: boolean };
export type IntercompanyReading = {
  sheet: number;
  role: (typeof IC_ROLES)[number];
  family: typeof IC_VERSION;
  confirmed: boolean;
};
export type IntercompanyEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  relationId: string;
  memberIds: string[];
  context: string;
  at: string;
  reference: string;
  note: string;
};
export type IntercompanyInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [
    IntercompanyReading,
    IntercompanyReading,
    IntercompanyReading,
    IntercompanyReading,
  ];
  scope: IntercompanyScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: IntercompanyEvent[];
};
type Origin = { id: string; source: number; row: number };
export type IntercompanyEntry = Origin & {
  transactionId: string;
  counterpartyTransactionId: string;
  account: string;
  dimensions: string;
  date: string;
  debit: number;
  credit: number;
  net: number;
};
export type IntercompanyRelation = Origin & {
  relationId: string;
  leftId: string;
  rightId: string;
  accountA: string;
  dimensionsA: string;
  accountB: string;
  dimensionsB: string;
  dateA: string;
  dateB: string;
  validFrom: string;
  validTo: string;
  reference: string;
};
export type IntercompanyTiming = Origin & {
  evidenceId: string;
  side: 'left' | 'right';
  transactionId: string;
  counterpartyTransactionId: string;
  date: string;
  amount: number;
  reference: string;
};
export type IntercompanyPair = {
  relationId: string;
  relationRecord: string;
  left: IntercompanyEntry | null;
  right: IntercompanyEntry | null;
  timing: IntercompanyTiming[];
  members: (Origin & {
    side: 'left' | 'right';
    transactionId: string;
    counterpartyTransactionId: string;
    account: string;
    dimensions: string;
    date: string;
    debit: number | null;
    credit: number | null;
    net: number | null;
  })[];
  residual: number | null;
  status: 'blocked' | 'ready' | 'difference' | 'missing' | 'timing-evidence';
  review: 'accepted' | 'rejected' | 'needs-review';
};
export type IntercompanyIssue = {
  code: string;
  source: number;
  row: number;
  key: string;
  related: string;
};
export type IntercompanyResult = {
  version: typeof IC_VERSION;
  claim: typeof IC_CLAIM;
  context: string;
  scope: IntercompanyScope;
  readings: IntercompanyInput['readings'];
  completeness: IntercompanyInput['completeness'];
  decimals: number;
  sources: {
    name: string;
    hash: string;
    sheet: string;
    role: IntercompanyReading['role'];
  }[];
  left: IntercompanyEntry[];
  right: IntercompanyEntry[];
  relations: IntercompanyRelation[];
  timing: IntercompanyTiming[];
  pairs: IntercompanyPair[];
  inventory: (Origin & {
    kind: 'header' | 'blank' | 'record' | 'error';
    values: string[];
    errors: string[];
  })[];
  cells: (Origin & { column: number; field: string; text: string })[];
  issues: IntercompanyIssue[];
  missing: { kind: string; key: string }[];
  totals: { debit: number; credit: number; net: number }[] | null;
  events: IntercompanyEvent[];
  status:
    | 'source-error'
    | 'missing'
    | 'difference'
    | 'needs-review'
    | 'consistent-with-evidence';
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`IC_${code}`);
}
function text(v: string, limit = 500, identity = true) {
  if (
    typeof v !== 'string' ||
    !v ||
    v !== v.trim() ||
    v.length > limit ||
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    (identity && /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v))
  )
    fail('IDENTITY');
  return v;
}
function date(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || parseDate(v, 'ymd') !== v) fail('DATE');
  return v;
}
function amount(raw: string, decimals: number, signed = false) {
  const value = latinDigits(raw).replace(/٫/g, '.');
  if (
    !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value) ||
    (value.split('.')[1]?.length ?? 0) > decimals
  )
    fail('AMOUNT');
  let n: number | undefined;
  try {
    n = parseMoney(value, 'dot', decimals);
  } catch {
    fail('AMOUNT');
  }
  if (
    n === undefined ||
    !Number.isSafeInteger(n) ||
    Math.abs(n) > 1e14 ||
    (!signed && n < 0)
  )
    fail('AMOUNT');
  return n === 0 ? 0 : n;
}
function sum(values: number[]) {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || Math.abs(value) > 1e14) fail('SUM');
    total += BigInt(value);
  }
  if (total > 100000000000000n || total < -100000000000000n) fail('SUM');
  return Number(total);
}
function validate(input: IntercompanyInput) {
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
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...IC_SCOPE_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !IC_SCOPE_FIELDS.every(
      (k) => typeof s[k] === 'string' && text(s[k]) === s[k],
    )
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (decimals === undefined) fail('CURRENCY');
  if (
    s.entityA === s.entityB ||
    s.currencyBasis !== 'functional' ||
    s.fxPolicy !== 'same-currency-no-conversion' ||
    s.postingStatus !== 'posted' ||
    date(s.start) > date(s.end) ||
    date(s.asOf) !== s.end
  )
    fail('SCOPE');
  input.files.forEach((file) => {
    assertSourceFile(file);
    text(file.name, 255, false);
    if (file.sheets.length !== 1) fail('SOURCE_SHEETS');
    if (
      file.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
      !(file.original instanceof ArrayBuffer) ||
      !file.original.byteLength ||
      file.original.byteLength > MAX_FILE_BYTES
    )
      fail('SOURCE');
    for (const row of file.sheets[0].rows)
      for (const value of row) if (value.length > 32767) fail('CELL_LIMIT');
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
      r.role !== IC_ROLES[i] ||
      r.family !== IC_VERSION ||
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
    ...Object.fromEntries(IC_SCOPE_FIELDS.map((k) => [k, s[k]])),
    confirmed: true,
  } as IntercompanyScope;
  const readings = input.readings.map((r) => ({
    sheet: r.sheet,
    role: r.role,
    family: IC_VERSION,
    confirmed: true,
  })) as IntercompanyInput['readings'];
  const completeness = {
    confirmed: c.confirmed,
    reference: c.reference,
    note: c.note,
  };
  return { scope, readings, completeness, decimals };
}
function unique<T>(rows: T[], key: (r: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const found = groups.get(k);
    if (found) found.push(row);
    else groups.set(k, [row]);
  }
  return new Map(
    [...groups].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]),
  );
}
export function reconcileIntercompany(
  input: IntercompanyInput,
): IntercompanyResult {
  const { scope, readings, completeness, decimals } = validate(input);
  const context = JSON.stringify([
    IC_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const left: IntercompanyEntry[] = [],
    right: IntercompanyEntry[] = [],
    relations: IntercompanyRelation[] = [],
    timing: IntercompanyTiming[] = [];
  const inventory: IntercompanyResult['inventory'] = [],
    cells: IntercompanyResult['cells'] = [],
    issues: IntercompanyIssue[] = [],
    missing: IntercompanyResult['missing'] = [];
  const inv = new Map<string, IntercompanyResult['inventory'][number]>(),
    issueSeen = new Set<string>(),
    missingSeen = new Set<string>();
  const origins = new Map<string, Origin>();
  const origin = (source: number, row: number): Origin => ({
    id: JSON.stringify([
      IC_VERSION,
      source,
      input.files[source].sha256,
      0,
      row,
    ]),
    source,
    row,
  });
  function problem(code: string, o: Origin, key = '', related = '') {
    const id = JSON.stringify([code, o.source, o.row, key, related]);
    if (!issueSeen.has(id)) {
      issueSeen.add(id);
      issues.push({ code, source: o.source, row: o.row, key, related });
    }
    const r = inv.get(o.id);
    if (r) {
      r.kind = 'error';
      if (!r.errors.includes(code)) r.errors.push(code);
    }
  }
  function absent(kind: string, key: string) {
    const id = JSON.stringify([kind, key]);
    if (!missingSeen.has(id)) {
      missingSeen.add(id);
      missing.push({ kind, key });
    }
  }
  function removeAbsent(kind: string, key: string) {
    const i = missing.findIndex((m) => m.kind === kind && m.key === key);
    if (i >= 0) missing.splice(i, 1);
  }
  const rawLedger = [new Map<string, Origin[]>(), new Map<string, Origin[]>()];
  for (let source = 0; source < 4; source++) {
    const sheet = input.files[source].sheets[0],
      wanted = IC_HEADERS[source],
      head = sheet.rows[0] ?? [],
      col = Object.fromEntries(head.map((h, i) => [h, i]));
    const headerUnsafe =
      sheet.hiddenRows.includes(1) ||
      !!sheet.rowIssues?.['1']?.length ||
      !!sheet.xlsxHeaders?.hiddenColumns.length ||
      !!sheet.xlsxHeaders?.merges.length ||
      [sheet.cellIssues, sheet.referenceIssues].some((map) =>
        Object.entries(map ?? {}).some(
          ([k, v]) => k.startsWith('1:') && v.length,
        ),
      ) ||
      Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'));
    const headerOK =
      head.length === wanted.length &&
      new Set(head).size === head.length &&
      wanted.every((h) => Object.hasOwn(col, h)) &&
      !headerUnsafe;
    const hidden = new Set(sheet.hiddenRows),
      unsafe = new Set(sheet.formulaRows);
    for (const k of Object.keys(sheet.formulaCells ?? {}))
      unsafe.add(Number(k.split(':')[0]));
    for (const [k, v] of Object.entries(sheet.cellIssues ?? {}))
      if (v.length) unsafe.add(Number(k.split(':')[0]));
    const typedColumns = new Set([
      'Debit',
      'Credit',
      'Expected counterparty amount',
      'Posting date',
      'Left posting date',
      'Right posting date',
      'Counterparty posting date',
      'Valid from',
      'Valid to',
      'Period start',
      'Period end',
      'As of',
    ]);
    for (const [k, v] of Object.entries(sheet.referenceIssues ?? {})) {
      const [row, column] = k.split(':').map(Number);
      if (v.length && !typedColumns.has(head[column - 1])) unsafe.add(row);
    }
    for (const [index, values] of sheet.rows.entries()) {
      const o = origin(source, index + 1);
      origins.set(o.id, o);
      const row: IntercompanyResult['inventory'][number] = {
        ...o,
        kind:
          index === 0
            ? 'header'
            : values.some((v) => v.trim())
              ? 'record'
              : 'blank',
        values: [...values],
        errors: [],
      };
      inventory.push(row);
      inv.set(o.id, row);
      values.forEach((value, c) =>
        cells.push({
          ...o,
          column: c + 1,
          field: head[c] ?? `Column ${c + 1}`,
          text: value,
        }),
      );
      // Preserve clear raw ledger identities even when another column or row
      // is invalid. An ambiguous duplicate identity header cannot name a row.
      if (
        index > 0 &&
        source < 2 &&
        head.filter((h) => h === 'Transaction ID').length === 1
      ) {
        const rawId = values[col['Transaction ID']] ?? '';
        if (rawId && rawId === rawId.trim()) {
          const group = rawLedger[source].get(rawId);
          if (group) group.push(o);
          else rawLedger[source].set(rawId, [o]);
        }
      }
      if (!headerOK) {
        problem('COLUMNS', o);
        continue;
      }
      if (index === 0) continue;
      try {
        if (
          hidden.has(o.row) ||
          unsafe.has(o.row) ||
          sheet.rowIssues?.[String(o.row)]?.length
        )
          fail('CELL');
        if (!values.some((v) => v.trim())) continue;
        if (values.length !== head.length) fail('COLUMNS');
        const get = (h: string) => values[col[h]] ?? '';
        for (let i = source < 2 ? 8 : 0; i < IC_SCOPE_FIELDS.length; i++)
          if (get(IC_SCOPE_HEADERS[i]) !== scope[IC_SCOPE_FIELDS[i]])
            fail('ROW_SCOPE');
        if (source < 2) {
          const letter = source === 0 ? 'A' : 'B',
            other = source === 0 ? 'B' : 'A';
          for (const [h, k] of [
            ['Entity', `entity${letter}`],
            ['Counterparty', `entity${other}`],
            ['Ledger', `ledger${letter}`],
            ['Account ID', `account${letter}`],
            ['Complete dimensions', `dimensions${letter}`],
          ])
            if (get(h) !== scope[k as keyof IntercompanyScope])
              fail('ROW_SCOPE');
          const transactionId = text(get('Transaction ID')),
            counterpartyTransactionId = text(
              get('Counterparty transaction ID'),
            ),
            posting = date(get('Posting date'));
          if (posting < scope.start || posting > scope.end)
            fail('POSTING_PERIOD');
          const debit = amount(get('Debit'), decimals),
            credit = amount(get('Credit'), decimals);
          if (debit > 0 && credit > 0) fail('BOTH_SIDES');
          (source === 0 ? left : right).push({
            ...o,
            transactionId,
            counterpartyTransactionId,
            account: get('Account ID'),
            dimensions: get('Complete dimensions'),
            date: posting,
            debit,
            credit,
            net: sum([debit, -credit]),
          });
        } else if (source === 2) {
          const ids = wanted.slice(0, 7).map((h) => text(get(h))),
            dateA = date(get('Left posting date')),
            dateB = date(get('Right posting date')),
            validFrom = date(get('Valid from')),
            validTo = date(get('Valid to')),
            reference = text(get('Relationship reference'), 2000, false);
          if (
            validFrom > scope.start ||
            validTo < scope.end ||
            validFrom > validTo ||
            dateA < validFrom ||
            dateA > validTo ||
            dateB < validFrom ||
            dateB > validTo
          )
            fail('VALIDITY');
          if (
            JSON.stringify(ids.slice(3)) !==
            JSON.stringify([
              scope.accountA,
              scope.dimensionsA,
              scope.accountB,
              scope.dimensionsB,
            ])
          )
            fail('RELATION_IDENTITY');
          relations.push({
            ...o,
            relationId: ids[0],
            leftId: ids[1],
            rightId: ids[2],
            accountA: ids[3],
            dimensionsA: ids[4],
            accountB: ids[5],
            dimensionsB: ids[6],
            dateA,
            dateB,
            validFrom,
            validTo,
            reference,
          });
        } else {
          const evidenceId = text(get('Evidence ID')),
            side = get('Side');
          if (side !== 'left' && side !== 'right') fail('TIMING_SIDE');
          const posting = date(get('Counterparty posting date'));
          if (posting >= scope.start && posting <= scope.end)
            fail('TIMING_PERIOD');
          timing.push({
            ...o,
            evidenceId,
            side,
            transactionId: text(get('Transaction ID')),
            counterpartyTransactionId: text(get('Counterparty transaction ID')),
            date: posting,
            amount: amount(get('Expected counterparty amount'), decimals, true),
            reference: text(get('Timing reference'), 2000, false),
          });
        }
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('IC_')) throw e;
        problem(e.message.slice(3), o);
      }
    }
    if (headerOK) {
      const fields =
        source < 2
          ? [['Transaction ID'], ['Counterparty transaction ID']]
          : source === 2
            ? [
                ['Relation ID'],
                ['Left transaction ID'],
                ['Right transaction ID'],
              ]
            : [['Evidence ID'], ['Side', 'Transaction ID']];
      for (const names of fields) {
        const groups = new Map<string, Origin[]>();
        for (let index = 1; index < sheet.rows.length; index++) {
          const row = sheet.rows[index],
            raw = names.map((h) => row[col[h]] ?? '');
          if (!raw.every((v) => v && v === v.trim())) continue;
          const k = JSON.stringify(raw),
            g = groups.get(k),
            o = origin(source, index + 1);
          if (g) g.push(o);
          else groups.set(k, [o]);
        }
        for (const [k, rows] of groups)
          if (rows.length > 1)
            for (const o of rows) problem('DUPLICATE', o, k, names.join('|'));
      }
    }
  }
  const a = unique(left, (r) => r.transactionId),
    b = unique(right, (r) => r.transactionId),
    used = [new Set<string>(), new Set<string>()],
    pairs: IntercompanyPair[] = [];
  if (!left.length) absent('left-ledger', 'all');
  if (!right.length) absent('right-ledger', 'all');
  const timingGroups = new Map<string, IntercompanyTiming[]>();
  for (const t of timing) {
    const k = JSON.stringify([t.side, t.transactionId]),
      g = timingGroups.get(k);
    if (g) g.push(t);
    else timingGroups.set(k, [t]);
  }
  const usedTiming = new Set<string>();
  const parsedLedger = new Map([...left, ...right].map((e) => [e.id, e]));
  let physicalMemberCount = 0;
  for (const r of relations) {
    const rawMembers = [
      rawLedger[0].get(r.leftId) ?? [],
      rawLedger[1].get(r.rightId) ?? [],
    ];
    physicalMemberCount += rawMembers[0].length + rawMembers[1].length;
    if (physicalMemberCount > 1_048_575) fail('PAIR_MEMBERS_CAPACITY');
    const members: IntercompanyPair['members'] = rawMembers.flatMap(
      (rows, source) =>
        rows.map((o) => {
          const entry = parsedLedger.get(o.id),
            sheet = input.files[source].sheets[0];
          const header = sheet.rows[0],
            raw = sheet.rows[o.row - 1];
          return {
            ...o,
            side: source === 0 ? ('left' as const) : ('right' as const),
            transactionId: raw[header.indexOf('Transaction ID')] ?? '',
            counterpartyTransactionId:
              raw[header.indexOf('Counterparty transaction ID')] ?? '',
            account: raw[header.indexOf('Account ID')] ?? '',
            dimensions: raw[header.indexOf('Complete dimensions')] ?? '',
            date: raw[header.indexOf('Posting date')] ?? '',
            debit: entry?.debit ?? null,
            credit: entry?.credit ?? null,
            net: entry?.net ?? null,
          };
        }),
    );
    const l = a.get(r.leftId) ?? null,
      rt = b.get(r.rightId) ?? null,
      ts: IntercompanyTiming[] = [];
    used[0].add(r.leftId);
    used[1].add(r.rightId);
    for (const [source, entry, partner] of [
      [0, l, rt],
      [1, rt, l],
    ] as const) {
      const tid = source === 0 ? r.leftId : r.rightId;
      if (!entry) {
        absent(source === 0 ? 'left-transaction' : 'right-transaction', tid);
        continue;
      }
      if (
        entry.counterpartyTransactionId !==
          (source === 0 ? r.rightId : r.leftId) ||
        entry.account !== (source === 0 ? r.accountA : r.accountB) ||
        entry.dimensions !== (source === 0 ? r.dimensionsA : r.dimensionsB) ||
        entry.date !== (source === 0 ? r.dateA : r.dateB)
      )
        problem('RELATION_LINK', r, r.relationId, tid);
      if (partner && entry.counterpartyTransactionId !== partner.transactionId)
        problem('CROSS_REFERENCE', entry, entry.transactionId);
      for (const t of timingGroups.get(
        JSON.stringify([source === 0 ? 'left' : 'right', entry.transactionId]),
      ) ?? []) {
        ts.push(t);
        usedTiming.add(t.id);
        if (
          partner ||
          t.counterpartyTransactionId !== entry.counterpartyTransactionId ||
          t.date !== (source === 0 ? r.dateB : r.dateA) ||
          t.amount !== -entry.net
        )
          problem('TIMING_LINK', t, t.evidenceId, r.relationId);
      }
    }
    pairs.push({
      relationId: r.relationId,
      relationRecord: r.id,
      left: l,
      right: rt,
      timing: ts,
      members,
      residual: null,
      status: 'blocked',
      review: 'needs-review',
    });
  }
  for (const [source, rows] of [left, right].entries())
    for (const row of rows)
      if (!used[source].has(row.transactionId))
        absent(
          source === 0 ? 'relationship-left' : 'relationship-right',
          row.transactionId,
        );
  for (const t of timing)
    if (!usedTiming.has(t.id)) problem('TIMING_LINK', t, t.evidenceId);
  // An invalid timing/proof/ledger record must retain the absent counterpart.
  // Build this once after all link/duplicate diagnostics, rather than scanning
  // every issue for every pair. A timing document never creates a ledger row.
  const invalidOrigins = new Set(issues.map((i) => origin(i.source, i.row).id));
  for (const pair of pairs) {
    const entry = pair.left ?? pair.right;
    if (
      pair.timing.length === 1 &&
      !!pair.left !== !!pair.right &&
      entry &&
      !invalidOrigins.has(pair.relationRecord) &&
      !invalidOrigins.has(entry.id) &&
      !invalidOrigins.has(pair.timing[0].id)
    )
      removeAbsent(
        pair.left ? 'right-transaction' : 'left-transaction',
        entry.counterpartyTransactionId,
      );
  }
  const totals: NonNullable<IntercompanyResult['totals']> = [];
  for (const [source, rows] of [left, right].entries()) {
    try {
      totals.push({
        debit: sum(rows.map((r) => r.debit)),
        credit: sum(rows.map((r) => r.credit)),
        net: sum(rows.map((r) => r.net)),
      });
    } catch {
      problem('TOTAL_BOUND', origin(source, 0));
    }
  }
  for (const pair of pairs)
    if (pair.left && pair.right) {
      try {
        pair.residual = sum([pair.left.net, pair.right.net]);
      } catch {
        problem(
          'RESIDUAL_BOUND',
          origins.get(pair.relationRecord)!,
          pair.relationId,
        );
      }
    }
  const valid = !issues.length,
    covered = !missing.length;
  for (const pair of pairs) {
    if (!valid) {
      pair.residual = null;
      pair.status = 'blocked';
    } else if (!pair.left || !pair.right)
      pair.status = pair.timing.length === 1 ? 'timing-evidence' : 'missing';
    else pair.status = pair.residual === 0 ? 'ready' : 'difference';
  }
  const ready =
    valid &&
    covered &&
    pairs.length > 0 &&
    pairs.every((p) => p.status === 'ready');
  const seen = new Set<string>(),
    events: IntercompanyEvent[] = [];
  const pairMap = unique(pairs, (p) => p.relationId);
  for (const e of input.events) {
    if (
      !plain(e) ||
      !keys(e, [
        'id',
        'type',
        'relationId',
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
    text(e.relationId);
    text(e.reference, 2000, false);
    text(e.note, 2000, false);
    e.memberIds.forEach((v) => text(v));
    if (seen.has(e.id)) fail('EVENT_ID');
    seen.add(e.id);
    if (e.context !== context) fail('EVENT_CONTEXT');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
      !Number.isFinite(Date.parse(e.at)) ||
      new Date(e.at).toISOString() !== e.at
    )
      fail('EVENT_DATE');
    if (e.type === 'accept' && (!ready || !completeness.confirmed))
      fail('EVENT_FINANCIAL');
    const pair = pairMap.get(e.relationId);
    if (!pair) fail('EVENT_RELATION');
    const members = pair.members.map((m) => m.id);
    if (
      !members.length ||
      e.memberIds.length !== members.length ||
      new Set(e.memberIds).size !== e.memberIds.length ||
      [...e.memberIds].sort().join('\0') !== members.sort().join('\0')
    )
      fail('EVENT_MEMBERS');
    if (e.type === 'undo') {
      if (pair.review === 'needs-review') fail('EVENT_STATE');
      pair.review = 'needs-review';
    } else {
      if (pair.review !== 'needs-review') fail('EVENT_STATE');
      pair.review = e.type === 'accept' ? 'accepted' : 'rejected';
    }
    events.push({ ...e, memberIds: [...e.memberIds] });
  }
  const status: IntercompanyResult['status'] = !valid
    ? 'source-error'
    : !covered
      ? 'missing'
      : pairs.some((p) => p.status === 'difference')
        ? 'difference'
        : !ready ||
            !completeness.confirmed ||
            pairs.some((p) => p.review !== 'accepted')
          ? 'needs-review'
          : 'consistent-with-evidence';
  return {
    version: IC_VERSION,
    claim: IC_CLAIM,
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
    left,
    right,
    relations,
    timing,
    pairs,
    inventory,
    cells,
    issues,
    missing,
    totals: valid ? totals : null,
    events,
    status,
  };
}
