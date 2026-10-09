import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import type { SourceFile } from './types.ts';

export const BANK_VERSION = 'bank-cash-movements-1';
export const BANK_SCOPE_FIELDS = [
  'entity',
  'ledger',
  'account',
  'currency',
  'start',
  'end',
] as const;
export const BANK_ROLES = ['bank-statement', 'cashbook'] as const;
export const BANK_HEADERS = [
  'Record ID',
  'Settlement ID',
  'Movement date',
  'Value date',
  'Cash direction',
  'Role',
  'Parent payment ID',
  'Reverses record ID',
  'Policy',
  'Status',
  'Entity',
  'Ledger',
  'Bank account',
  'Currency',
  'Period start',
  'Period end',
  'Amount',
];
export type BankScope = Record<(typeof BANK_SCOPE_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type BankReading = {
  sheet: number;
  role: (typeof BANK_ROLES)[number];
  family: typeof BANK_VERSION;
  perspective: 'company-cash';
  confirmed: boolean;
};
export type BankPolicy =
  | 'individual'
  | 'outgoing-inclusive'
  | 'incoming-net'
  | 'reversal';
export type BankRole =
  | 'principal'
  | 'settlement'
  | 'fee'
  | 'fee-tax'
  | 'periodic-fee'
  | 'reversal';
export type BankEvent = {
  id: string;
  type: 'accept' | 'undo';
  context: string;
  at: string;
  reference: string;
  note: string;
  bankIds: string[];
  cashIds: string[];
};
export type BankInput = {
  files: [SourceFile, SourceFile];
  readings: [BankReading, BankReading];
  scope: BankScope;
  events: BankEvent[];
};
export type BankRecord = {
  id: string;
  side: 0 | 1;
  row: number;
  reference: string;
  settlement: string;
  movementDate: string;
  valueDate: string;
  direction: 'inflow' | 'outflow';
  role: BankRole;
  parent: string;
  reverses: string;
  policy: BankPolicy;
  status: 'booked' | 'posted';
  amount: number;
  signed: number;
  traces: { field: string; column: number; text: string }[];
};
export type BankInventory = {
  id: string;
  side: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | 'movement' | 'error';
  values: string[];
  error?: string;
};
export type BankCase = {
  id: string;
  key: string;
  kind: 'reference' | 'missing' | 'human';
  bankIds: string[];
  cashIds: string[];
  bankMinor: number;
  cashMinor: number;
  deltaMinor: number;
  status:
    | 'matched-evidence'
    | 'matched-manual'
    | 'needs-review'
    | 'source-error';
  reason:
    | 'explicit-identity'
    | 'human-review'
    | 'undone'
    | 'source-error'
    | 'missing-identity'
    | 'missing-counterpart'
    | 'member-limit'
    | 'policy-members'
    | 'reversal-origin-conflict'
    | 'incomplete-reversal'
    | 'amount-difference'
    | 'timing-review';
  eligible: boolean;
  policy: BankPolicy | null;
  timingReview: boolean;
};
export type BankTimingItem = {
  id: string;
  side: 0 | 1;
  row: number;
  reference: string;
  movementDate: string;
  valueDate: string;
  outsidePeriod: true;
  validMovement: boolean;
};
export type BankResult = {
  version: typeof BANK_VERSION;
  context: string;
  decimals: number;
  status: 'empty' | 'movements-consistent' | 'needs-review' | 'source-error';
  scope: BankScope;
  readings: BankInput['readings'];
  sources: {
    name: string;
    hash: string;
    sheet: string;
    role: BankReading['role'];
  }[];
  records: BankRecord[];
  inventory: BankInventory[];
  cases: BankCase[];
  timingItems: BankTimingItem[];
  events: BankEvent[];
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`BANK_${code}`);
}
function visible(v: unknown, max = 500): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v !== v.trim() ||
    v.length > max ||
    /[\p{Cc}\p{Cf}]/u.test(v)
  )
    fail('TEXT');
  return v;
}
function identity(v: unknown): string {
  const s = visible(v);
  if (/^[=+@-]/.test(s) || /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(s))
    fail('IDENTITY');
  return s;
}
const optional = (v: string) => (v ? identity(v) : '');
const iso = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDate(v, 'ymd') === v;
function date(v: string): string {
  if (!iso(v)) fail('DATE');
  return v;
}
function amount(v: string, decimals: number): number {
  const s = latinDigits(v.trim()).replace(/٫/g, '.');
  if (!/^\d+(?:\.\d+)?$/.test(s)) fail('AMOUNT');
  const n = parseMoney(s, 'dot', decimals);
  if (n === undefined || !Number.isSafeInteger(n) || n <= 0 || n > 1e14)
    fail('AMOUNT');
  return n;
}
function sum(values: number[]): number {
  try {
    return safeSum(values);
  } catch {
    return fail('SUM');
  }
}
function scopeDecimals(s: BankScope): number {
  if (
    !plain(s) ||
    !keys(s, [...BANK_SCOPE_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !BANK_SCOPE_FIELDS.every((k) => identity(s[k]) === s[k])
  )
    fail('SCOPE');
  date(s.start);
  date(s.end);
  const n = currencyPrecision(s.currency);
  if (n === undefined || s.start > s.end) fail('SCOPE');
  return n;
}
function readSource(input: BankInput, side: 0 | 1, decimals: number) {
  const file = input.files[side],
    reading = input.readings[side];
  assertSourceFile(file);
  if (
    file.kind !== undefined ||
    !/\.(csv|xlsx)$/i.test(file.name) ||
    !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
  )
    fail('SOURCE');
  if (
    !plain(reading) ||
    !keys(reading, ['sheet', 'role', 'family', 'perspective', 'confirmed']) ||
    reading.family !== BANK_VERSION ||
    reading.role !== BANK_ROLES[side] ||
    reading.perspective !== 'company-cash' ||
    reading.confirmed !== true ||
    !Number.isSafeInteger(reading.sheet) ||
    reading.sheet < 0
  )
    fail('READING');
  const sheet = file.sheets[reading.sheet];
  if (
    !sheet?.rows.length ||
    sheet.hiddenRows.includes(1) ||
    sheet.rowIssues?.['1']?.length ||
    sheet.xlsxHeaders?.hiddenColumns.length ||
    sheet.xlsxHeaders?.merges.length ||
    [sheet.cellIssues, sheet.referenceIssues].some((m) =>
      Object.entries(m ?? {}).some(([k, v]) => k.startsWith('1:') && v.length),
    ) ||
    Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'))
  )
    fail('COLUMNS');
  const head = sheet.rows[0].map((v) => v.trim());
  if (
    head.length !== BANK_HEADERS.length ||
    new Set(head).size !== head.length ||
    BANK_HEADERS.some((h) => !head.includes(h))
  )
    fail('COLUMNS');
  const col = Object.fromEntries(BANK_HEADERS.map((h) => [h, head.indexOf(h)])),
    identityCols = BANK_HEADERS.filter(
      (h) => h !== 'Amount' && !/date$|^Period /i.test(h),
    ).map((h) => col[h]);
  const records: BankRecord[] = [],
    inventory: BankInventory[] = [],
    hidden = new Set(sheet.hiddenRows);
  for (const [index, raw] of sheet.rows.entries()) {
    const row = index + 1,
      values = [...raw],
      id = `${side}:${file.sha256}:${reading.sheet}:${row}`;
    if (!index) {
      inventory.push({ id, side, row, kind: 'header', values });
      continue;
    }
    try {
      if (
        hidden.has(row) ||
        sheet.rowIssues?.[String(row)]?.length ||
        Object.values(col).some(
          (c) =>
            sheet.formulaCells?.[`${row}:${c + 1}`] ||
            sheet.cellIssues?.[`${row}:${c + 1}`]?.length,
        ) ||
        identityCols.some(
          (c) => sheet.referenceIssues?.[`${row}:${c + 1}`]?.length,
        )
      )
        fail('CELL');
      if (!values.some((v) => v.trim())) {
        inventory.push({ id, side, row, kind: 'blank', values });
        continue;
      }
      if (values.slice(BANK_HEADERS.length).some((v) => v.trim()))
        fail('COLUMNS');
      const get = (h: string) => (values[col[h]] ?? '').trim();
      for (const [i, h] of [
        'Entity',
        'Ledger',
        'Bank account',
        'Currency',
        'Period start',
        'Period end',
      ].entries())
        if (get(h) !== input.scope[BANK_SCOPE_FIELDS[i]]) fail('ROW_SCOPE');
      const reference = identity(get('Record ID')),
        settlement = optional(get('Settlement ID')),
        movementDate = date(get('Movement date')),
        valueDate = date(get('Value date')),
        direction = get('Cash direction'),
        role = get('Role'),
        policy = get('Policy'),
        status = get('Status'),
        parent = optional(get('Parent payment ID')),
        reverses = optional(get('Reverses record ID')),
        n = amount(get('Amount'), decimals);
      if (movementDate < input.scope.start || movementDate > input.scope.end)
        fail('PERIOD');
      if (direction !== 'inflow' && direction !== 'outflow') fail('DIRECTION');
      if (status !== (side ? 'posted' : 'booked')) fail('STATUS');
      if (
        ![
          'individual',
          'outgoing-inclusive',
          'incoming-net',
          'reversal',
        ].includes(policy)
      )
        fail('POLICY');
      const validRole =
        policy === 'individual'
          ? ['principal', 'periodic-fee'].includes(role)
          : policy === 'reversal'
            ? role === 'reversal'
            : side
              ? ['principal', 'fee', 'fee-tax'].includes(role)
              : role === 'settlement';
      if (
        !validRole ||
        ((role === 'fee' || role === 'fee-tax') &&
          (direction !== 'outflow' || !parent)) ||
        (role !== 'fee' && role !== 'fee-tax' && parent) ||
        (policy === 'reversal') !== !!reverses
      )
        fail('ROLE');
      records.push({
        id,
        side,
        row,
        reference,
        settlement,
        movementDate,
        valueDate,
        direction,
        role: role as BankRole,
        parent,
        reverses,
        policy: policy as BankPolicy,
        status: status as BankRecord['status'],
        amount: n,
        signed: direction === 'inflow' ? n : -n,
        traces: BANK_HEADERS.map((field) => ({
          field,
          column: col[field] + 1,
          text: values[col[field]] ?? '',
        })),
      });
      inventory.push({ id, side, row, kind: 'movement', values });
    } catch (e) {
      inventory.push({
        id,
        side,
        row,
        kind: 'error',
        values,
        error: e instanceof Error ? e.message : 'BANK_ROW',
      });
    }
  }
  return { records, inventory, col };
}
function sameIds(a: string[], b: string[]): boolean {
  const wanted = new Set(b);
  return a.length === b.length && a.every((v) => wanted.has(v));
}
function ordinaryReason(
  bank: BankRecord[],
  cash: BankRecord[],
): BankCase['reason'] | null {
  if (!bank.length || !cash.length) return 'missing-counterpart';
  if (bank.length > 100 || cash.length > 100) return 'member-limit';
  const policy = bank[0].policy;
  if (
    [...bank, ...cash].some((r) => r.policy !== policy) ||
    policy === 'reversal'
  )
    return 'policy-members';
  if (policy === 'individual') {
    if (
      bank.length !== 1 ||
      cash.length !== 1 ||
      bank[0].role !== cash[0].role ||
      bank[0].direction !== cash[0].direction
    )
      return 'policy-members';
  } else {
    const wanted = policy === 'incoming-net' ? 'inflow' : 'outflow';
    if (
      bank.length !== 1 ||
      bank[0].role !== 'settlement' ||
      bank[0].direction !== wanted ||
      !cash.some((r) => r.role === 'principal') ||
      cash.some(
        (r) =>
          !['principal', 'fee', 'fee-tax'].includes(r.role) ||
          (r.role === 'principal'
            ? r.direction !== wanted
            : r.direction !== 'outflow'),
      )
    )
      return 'policy-members';
  }
  if (sum(bank.map((r) => r.signed)) !== sum(cash.map((r) => r.signed)))
    return 'amount-difference';
  return null;
}
/** Pure movement comparison. This result never establishes an opening/closing balance bridge. */
export function reconcileBank(input: BankInput): BankResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  const decimals = scopeDecimals(input.scope),
    read = [readSource(input, 0, decimals), readSource(input, 1, decimals)],
    inventory = read.flatMap((r) => r.inventory),
    candidate = read.flatMap((r) => r.records),
    invalid = new Set<string>();
  const inventoryById = new Map(inventory.map((r) => [r.id, r]));
  const mark = (r: BankRecord, code: string) => {
    invalid.add(r.id);
    const inv = inventoryById.get(r.id)!;
    inv.kind = 'error';
    inv.error = `BANK_${code}`;
  };
  // Count identity claims on the original inventory, including malformed competitors.
  for (const side of [0, 1] as const)
    for (const field of ['Record ID', 'Reverses record ID']) {
      const claims = new Map<string, number>();
      for (const i of read[side].inventory)
        if (i.row > 1) {
          const ref = (i.values[read[side].col[field]] ?? '').trim();
          if (ref) claims.set(ref, (claims.get(ref) ?? 0) + 1);
        }
      for (const r of read[side].records)
        if (
          (claims.get(field === 'Record ID' ? r.reference : r.reverses) ?? 0) >
          1
        )
          mark(
            r,
            field === 'Record ID' ? 'DUPLICATE_ID' : 'DUPLICATE_REVERSAL',
          );
    }
  // Invalid originals/parents cannot become evidence through a later dependent row.
  let changed = true;
  while (changed) {
    changed = false;
    const available = new Map(
      candidate
        .filter((r) => !invalid.has(r.id))
        .map((r) => [`${r.side}:${r.reference}`, r]),
    );
    for (const r of candidate)
      if (!invalid.has(r.id)) {
        if (r.parent) {
          const parent = available.get(`${r.side}:${r.parent}`);
          if (
            !parent ||
            parent.role !== 'principal' ||
            parent.settlement !== r.settlement ||
            parent.policy !== r.policy ||
            !r.settlement
          ) {
            mark(r, 'PARENT');
            changed = true;
          }
        }
        if (r.reverses) {
          const original = available.get(`${r.side}:${r.reverses}`);
          if (
            !original ||
            original.policy === 'reversal' ||
            !original.settlement ||
            r.amount !== original.amount ||
            r.direction === original.direction ||
            r.movementDate < original.movementDate ||
            r.valueDate < original.valueDate
          ) {
            mark(r, 'REVERSAL');
            changed = true;
          }
        }
      }
  }
  const records = candidate.filter((r) => !invalid.has(r.id)),
    byId = new Map(records.map((r) => [r.id, r])),
    own = new Map(records.map((r) => [`${r.side}:${r.reference}`, r]));
  const sourceError = inventory.some((i) => i.kind === 'error');
  if (sourceError && input.events.length) fail('SOURCE_ERRORS');
  const timingItems: BankTimingItem[] = [];
  for (const i of inventory)
    if (i.row > 1) {
      const col = read[i.side].col,
        get = (h: string) => (i.values[col[h]] ?? '').trim(),
        valueDate = get('Value date');
      if (
        iso(valueDate) &&
        (valueDate < input.scope.start || valueDate > input.scope.end)
      )
        timingItems.push({
          id: i.id,
          side: i.side,
          row: i.row,
          reference: get('Record ID'),
          movementDate: get('Movement date'),
          valueDate,
          outsidePeriod: true,
          validMovement: byId.has(i.id),
        });
    }
  const grouped = new Map<string, BankRecord[]>();
  for (const r of records) {
    const key = JSON.stringify(
      r.settlement
        ? ['reference', r.settlement]
        : ['blank', r.side, r.reference],
    );
    const members = grouped.get(key);
    if (members) members.push(r);
    else grouped.set(key, [r]);
  }
  const cases: BankCase[] = [],
    caseId = (key: string) =>
      JSON.stringify([BANK_VERSION, input.files.map((f) => f.sha256), key]);
  for (const [groupKey, members] of grouped) {
    const key =
      members[0].settlement ||
      `blank:${members[0].side}:${members[0].reference}`;
    const bank = members.filter((r) => r.side === 0),
      cash = members.filter((r) => r.side === 1),
      bankMinor = sum(bank.map((r) => r.signed)),
      cashMinor = sum(cash.map((r) => r.signed)),
      deltaMinor = sum([bankMinor, -cashMinor]);
    let reason: BankCase['reason'] | null = null;
    if (!members[0].settlement) reason = 'missing-identity';
    else if (!bank.length || !cash.length) reason = 'missing-counterpart';
    else if (bank.length > 100 || cash.length > 100) reason = 'member-limit';
    else if (members.every((r) => r.policy === 'reversal')) {
      const originals = members.map((r) => own.get(`${r.side}:${r.reverses}`)!);
      const originKeys = new Set(originals.map((r) => r.settlement));
      if (originKeys.size !== 1) reason = 'reversal-origin-conflict';
      else {
        const originalMembers =
            grouped.get(
              JSON.stringify(['reference', originals[0].settlement]),
            ) ?? [],
          ob = originalMembers.filter((r) => r.side === 0),
          oc = originalMembers.filter((r) => r.side === 1);
        if (
          !sameIds(
            originals.map((r) => r.id),
            originalMembers.map((r) => r.id),
          )
        )
          reason = 'incomplete-reversal';
        else if (ordinaryReason(ob, oc) !== null) reason = 'policy-members';
        else if (deltaMinor !== 0) reason = 'amount-difference';
      }
    } else reason = ordinaryReason(bank, cash);
    const eligible = reason === null,
      timingReview =
        eligible &&
        (new Set(members.map((r) => r.movementDate)).size !== 1 ||
          new Set(members.map((r) => r.valueDate)).size !== 1 ||
          members.some(
            (r) =>
              r.valueDate < input.scope.start || r.valueDate > input.scope.end,
          ));
    if (timingReview) reason = 'timing-review';
    cases.push({
      id: caseId(groupKey),
      key,
      kind: members[0].settlement ? 'reference' : 'missing',
      bankIds: bank.map((r) => r.id),
      cashIds: cash.map((r) => r.id),
      bankMinor,
      cashMinor,
      deltaMinor,
      status: sourceError
        ? 'source-error'
        : reason
          ? 'needs-review'
          : 'matched-evidence',
      reason: sourceError ? 'source-error' : (reason ?? 'explicit-identity'),
      eligible: sourceError ? false : eligible,
      policy:
        new Set(members.map((r) => r.policy)).size === 1
          ? members[0].policy
          : null,
      timingReview,
    });
  }
  const context = JSON.stringify([
      BANK_VERSION,
      input.files.map((f) => f.sha256),
      input.readings.map((r) => [
        r.sheet,
        r.role,
        r.family,
        r.perspective,
        r.confirmed,
      ]),
      BANK_SCOPE_FIELDS.map((k) => input.scope[k]),
      true,
    ]),
    seen = new Set<string>();
  for (const e of input.events) {
    if (
      !plain(e) ||
      !keys(e, [
        'id',
        'type',
        'context',
        'at',
        'reference',
        'note',
        'bankIds',
        'cashIds',
      ]) ||
      !['accept', 'undo'].includes(e.type) ||
      e.context !== context ||
      typeof e.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
      !Number.isFinite(Date.parse(e.at)) ||
      new Date(e.at).toISOString() !== e.at
    )
      fail('EVENT');
    identity(e.id);
    identity(e.reference);
    visible(e.note, 2000);
    if (seen.has(e.id)) fail('EVENT');
    seen.add(e.id);
    if (
      !Array.isArray(e.bankIds) ||
      !Array.isArray(e.cashIds) ||
      !e.bankIds.length ||
      !e.cashIds.length ||
      e.bankIds.length > 100 ||
      e.cashIds.length > 100 ||
      new Set([...e.bankIds, ...e.cashIds]).size !==
        e.bankIds.length + e.cashIds.length
    )
      fail('MEMBERS');
    const bank = e.bankIds.map((id) => byId.get(id)),
      cash = e.cashIds.map((id) => byId.get(id));
    if (
      bank.some((r) => !r || r.side !== 0) ||
      cash.some((r) => !r || r.side !== 1)
    )
      fail('MEMBERS');
    const found = cases.find(
      (c) => sameIds(c.bankIds, e.bankIds) && sameIds(c.cashIds, e.cashIds),
    );
    if (found) {
      if (e.type === 'accept') {
        if (
          !found.eligible ||
          found.deltaMinor !== 0 ||
          found.status !== 'needs-review'
        )
          fail('INELIGIBLE');
        found.status = 'matched-manual';
        found.reason = 'human-review';
      } else {
        if (!['matched-evidence', 'matched-manual'].includes(found.status))
          fail('UNDO');
        if (found.kind === 'human') {
          cases.splice(cases.indexOf(found), 1);
          for (const id of [...found.bankIds, ...found.cashIds]) {
            const r = byId.get(id)!;
            cases.push({
              id: caseId(JSON.stringify(['blank', r.side, r.reference])),
              key: `blank:${r.side}:${r.reference}`,
              kind: 'missing',
              bankIds: r.side ? [] : [r.id],
              cashIds: r.side ? [r.id] : [],
              bankMinor: r.side ? 0 : r.signed,
              cashMinor: r.side ? r.signed : 0,
              deltaMinor: r.side ? -r.signed : r.signed,
              status: 'needs-review',
              reason: 'missing-identity',
              eligible: false,
              policy: r.policy,
              timingReview: false,
            });
          }
        } else {
          found.status = 'needs-review';
          found.reason = 'undone';
        }
      }
    } else {
      if (e.type !== 'accept' || bank.length !== 1 || cash.length !== 1)
        fail('MEMBERS');
      const b = bank[0]!,
        c = cash[0]!;
      if (
        b.settlement ||
        c.settlement ||
        b.policy !== 'individual' ||
        c.policy !== 'individual' ||
        ordinaryReason([b], [c]) !== null
      )
        fail('INELIGIBLE');
      const single = cases.filter((g) =>
        [...g.bankIds, ...g.cashIds].some((id) => id === b.id || id === c.id),
      );
      if (
        single.length !== 2 ||
        single.some(
          (g) =>
            g.status !== 'needs-review' ||
            g.bankIds.length + g.cashIds.length !== 1,
        )
      )
        fail('MEMBERS');
      for (const g of single) cases.splice(cases.indexOf(g), 1);
      cases.push({
        id: JSON.stringify([BANK_VERSION, 'manual', b.id, c.id]),
        key: `manual:${b.id}:${c.id}`,
        kind: 'human',
        bankIds: [b.id],
        cashIds: [c.id],
        bankMinor: b.signed,
        cashMinor: c.signed,
        deltaMinor: 0,
        status: 'matched-manual',
        reason: 'human-review',
        eligible: true,
        policy: 'individual',
        timingReview:
          b.movementDate !== c.movementDate ||
          b.valueDate !== c.valueDate ||
          [b, c].some(
            (r) =>
              r.valueDate < input.scope.start || r.valueDate > input.scope.end,
          ),
      });
    }
  }
  const status = sourceError
    ? 'source-error'
    : !records.length
      ? 'empty'
      : cases.every((c) =>
            ['matched-evidence', 'matched-manual'].includes(c.status),
          )
        ? 'movements-consistent'
        : 'needs-review';
  return {
    version: BANK_VERSION,
    context,
    decimals,
    status,
    scope: structuredClone(input.scope),
    readings: structuredClone(input.readings),
    sources: input.files.map((f, i) => ({
      name: f.name,
      hash: f.sha256!,
      sheet: f.sheets[input.readings[i].sheet].name,
      role: input.readings[i].role,
    })),
    records,
    inventory,
    cases,
    timingItems,
    events: structuredClone(input.events),
  };
}
