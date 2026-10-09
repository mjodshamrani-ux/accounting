import { latinDigits, parseDate, parseMoney } from './core.ts';
import { assertSourceFile } from './protocol.ts';
import { BANK_SCOPE_FIELDS, type BankRecord } from './bank.ts';
import {
  reconcileBankBalances,
  type BankBalanceInput,
  type BankBalanceResult,
} from './bank-balance.ts';
import type { SourceFile } from './types.ts';
export const ADJUSTMENT_SESSION_LIMIT = 96 * 1024 * 1024;
export const ADJUSTMENT_VERSION = 'bank-adjustment-ledger-1';
export const ADJUSTMENT_ROLES = [
  'reconciliation-items',
  'reconciliation-evidence',
] as const;
export const ADJUSTMENT_HEADERS = [
  [
    'Item ID',
    'Point',
    'Adjust side',
    'Evidence ID',
    'Amount',
    'Explanation',
    'Entity',
    'Ledger',
    'Bank account',
    'Currency',
    'Period start',
    'Period end',
  ],
  [
    'Evidence ID',
    'Lifecycle ID',
    'Kind',
    'Source side',
    'Record ID',
    'Movement date',
    'Value date',
    'Document reference',
    'Entity',
    'Ledger',
    'Bank account',
    'Currency',
    'Period start',
    'Period end',
    'Signed amount',
  ],
];
export const ADJUSTMENT_CLAIM =
  'Reconciliation within supplied confirmed evidence only; no source authenticity, ERP completeness, automatic posting or unsupported timing-group assurance';
export type AdjustmentReading = {
  sheet: number;
  role: (typeof ADJUSTMENT_ROLES)[number];
  family: typeof ADJUSTMENT_VERSION;
  perspective: 'company-cash';
  confirmed: boolean;
};
export type AdjustmentEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  context: string;
  at: string;
  reference: string;
  note: string;
  itemIds: string[];
};
export type BankAdjustmentInput = {
  balance: BankBalanceInput;
  files: [SourceFile, SourceFile];
  readings: [AdjustmentReading, AdjustmentReading];
  completeness: { confirmed: boolean; reference: string; note: string };
  events: AdjustmentEvent[];
};
type Cells = { field: string; column: number; text: string }[];
export type AdjustmentItem = {
  id: string;
  row: number;
  reference: string;
  point: 'opening' | 'closing';
  side: 0 | 1;
  proofReference: string;
  amount: number;
  explanation: string;
  cells: Cells;
};
export type AdjustmentProof = {
  id: string;
  row: number;
  reference: string;
  lifecycle: string;
  kind: 'timing' | 'bank-error' | 'cashbook-error' | 'settlement';
  side: 0 | 1;
  recordReference: string;
  movementDate: string;
  valueDate: string;
  document: string;
  amount: number;
  cells: Cells;
};
export type AdjustmentInventory = {
  id: string;
  source: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | 'record' | 'error';
  values: string[];
  error?: string;
};
export type AdjustmentLifecycle = {
  id: string;
  reference: string;
  itemIds: string[];
  proofIds: string[];
  movementIds: string[];
  status: 'blocked' | 'needs-review' | 'accepted' | 'rejected';
};
export type AdjustmentEndpoint = {
  point: 'opening' | 'closing';
  rawBank: number | null;
  rawCash: number | null;
  bankAdjustment: number | null;
  cashAdjustment: number | null;
  adjustedBank: number | null;
  adjustedCash: number | null;
  difference: number | null;
  bankItemIds: string[];
  cashItemIds: string[];
};
export type BankAdjustmentResult = {
  version: typeof ADJUSTMENT_VERSION;
  context: string;
  balance: BankBalanceResult;
  completeness: BankAdjustmentInput['completeness'];
  readings: BankAdjustmentInput['readings'];
  sources: { name: string; hash: string; sheet: string }[];
  items: AdjustmentItem[];
  proofs: AdjustmentProof[];
  inventory: AdjustmentInventory[];
  lifecycles: AdjustmentLifecycle[];
  events: AdjustmentEvent[];
  endpoints: AdjustmentEndpoint[];
  unresolved: string[];
  status:
    | 'source-error'
    | 'missing'
    | 'needs-review'
    | 'inconsistent'
    | 'reconciled-with-evidence';
  claim: typeof ADJUSTMENT_CLAIM;
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`ADJUSTMENT_${code}`);
}
function text(v: string, max = 500, identity = true) {
  if (
    !v ||
    v !== v.trim() ||
    v.length > max ||
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    (identity && /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v))
  )
    fail('IDENTITY');
  return v;
}
function iso(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDate(v, 'ymd') === v;
}
function amount(v: string, decimals: number) {
  const s = latinDigits(v.trim()).replace(/٫/g, '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) fail('AMOUNT');
  try {
    const n = parseMoney(s, 'dot', decimals);
    if (!n) fail('AMOUNT');
    return n;
  } catch {
    return fail('AMOUNT');
  }
}
function sum(values: number[]) {
  let n = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || Math.abs(v) > 1e14) fail('SUM');
    n += BigInt(v);
  }
  if (n > 100000000000000n || n < -100000000000000n) fail('SUM');
  return Number(n);
}
const same = (a: string[], b: string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  [...a].sort().join('\0') === [...b].sort().join('\0');
export function reconcileBankAdjustments(
  input: BankAdjustmentInput,
): BankAdjustmentResult {
  if (
    !plain(input) ||
    !keys(input, ['balance', 'files', 'readings', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  const balance = reconcileBankBalances(input.balance),
    complete = input.completeness;
  if (
    !plain(complete) ||
    !keys(complete, ['confirmed', 'reference', 'note']) ||
    complete.confirmed !== true ||
    typeof complete.reference !== 'string' ||
    typeof complete.note !== 'string'
  )
    fail('COMPLETENESS');
  text(complete.reference);
  text(complete.note, 2000, false);
  const items: AdjustmentItem[] = [],
    proofs: AdjustmentProof[] = [],
    inventory: AdjustmentInventory[] = [],
    columns: Record<string, number>[] = [];
  for (const source of [0, 1] as const) {
    const file = input.files[source],
      reading = input.readings[source];
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
      reading.role !== ADJUSTMENT_ROLES[source] ||
      reading.family !== ADJUSTMENT_VERSION ||
      reading.perspective !== 'company-cash' ||
      reading.confirmed !== true ||
      !Number.isSafeInteger(reading.sheet) ||
      reading.sheet < 0
    )
      fail('READING');
    const sheet = file.sheets[reading.sheet],
      headers = ADJUSTMENT_HEADERS[source];
    if (
      !sheet?.rows.length ||
      sheet.hiddenRows.includes(1) ||
      sheet.rowIssues?.['1']?.length ||
      sheet.xlsxHeaders?.hiddenColumns.length ||
      sheet.xlsxHeaders?.merges.length ||
      [sheet.cellIssues, sheet.referenceIssues].some((m) =>
        Object.entries(m ?? {}).some(
          ([k, v]) => k.startsWith('1:') && v.length,
        ),
      ) ||
      Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'))
    )
      fail('COLUMNS');
    const head = sheet.rows[0].map((v) => v.trim());
    if (
      head.length !== headers.length ||
      new Set(head).size !== head.length ||
      !headers.every((h) => head.includes(h))
    )
      fail('COLUMNS');
    const col = Object.fromEntries(headers.map((h) => [h, head.indexOf(h)]));
    columns.push(col);
    for (const [index, values] of sheet.rows.entries()) {
      const row = index + 1,
        id = JSON.stringify([
          ADJUSTMENT_VERSION,
          source,
          file.sha256,
          reading.sheet,
          row,
        ]),
        inv: AdjustmentInventory = {
          id,
          source,
          row,
          kind: index ? 'record' : 'header',
          values: [...values],
        };
      inventory.push(inv);
      if (!index) continue;
      const get = (h: string) => values[col[h]] ?? '',
        cells = headers.map((field) => ({
          field,
          column: col[field] + 1,
          text: get(field),
        }));
      try {
        if (
          sheet.hiddenRows.includes(row) ||
          sheet.rowIssues?.[String(row)]?.length ||
          headers.some(
            (h) =>
              sheet.formulaCells?.[`${row}:${col[h] + 1}`] ||
              sheet.cellIssues?.[`${row}:${col[h] + 1}`]?.length ||
              (![
                'Amount',
                'Signed amount',
                'Movement date',
                'Value date',
                'Period start',
                'Period end',
              ].includes(h) &&
                sheet.referenceIssues?.[`${row}:${col[h] + 1}`]?.length),
          ) ||
          values.length > headers.length
        )
          fail('CELL');
        if (!values.some((v) => v.trim())) {
          inv.kind = 'blank';
          continue;
        }
        const scopeHeaders = [
          'Entity',
          'Ledger',
          'Bank account',
          'Currency',
          'Period start',
          'Period end',
        ];
        if (
          scopeHeaders.some(
            (h, i) => get(h) !== balance.scope[BANK_SCOPE_FIELDS[i]],
          )
        )
          fail('SCOPE');
        if (source === 0) {
          const point = get('Point'),
            side = get('Adjust side');
          if (
            !['opening', 'closing'].includes(point) ||
            !['bank', 'cashbook'].includes(side)
          )
            fail('POINT');
          items.push({
            id,
            row,
            reference: text(get('Item ID')),
            point: point as AdjustmentItem['point'],
            side: side === 'bank' ? 0 : 1,
            proofReference: text(get('Evidence ID')),
            amount: amount(get('Amount'), balance.decimals),
            explanation: text(get('Explanation'), 2000, false),
            cells,
          });
        } else {
          const kind = get('Kind'),
            side = get('Source side');
          if (
            !['timing', 'bank-error', 'cashbook-error', 'settlement'].includes(
              kind,
            ) ||
            !['bank', 'cashbook'].includes(side)
          )
            fail('KIND');
          if (!iso(get('Movement date')) || !iso(get('Value date')))
            fail('DATE');
          proofs.push({
            id,
            row,
            reference: text(get('Evidence ID')),
            lifecycle: text(get('Lifecycle ID')),
            kind: kind as AdjustmentProof['kind'],
            side: side === 'bank' ? 0 : 1,
            recordReference: text(get('Record ID')),
            movementDate: get('Movement date'),
            valueDate: get('Value date'),
            document: text(get('Document reference')),
            amount: amount(get('Signed amount'), balance.decimals),
            cells,
          });
        }
      } catch (e) {
        inv.kind = 'error';
        inv.error = e instanceof Error ? e.message : 'ADJUSTMENT_ROW';
      }
    }
  }
  const byInventory = new Map(inventory.map((i) => [i.id, i]));
  function mark(id: string, code: string) {
    const i = byInventory.get(id)!;
    i.kind = 'error';
    i.error = `ADJUSTMENT_${code}`;
  }
  // Claims include invalid competitors from raw inventory, not only parsed candidates.
  for (const source of [0, 1] as const) {
    const col = columns[source],
      counts = new Map<string, number>(),
      field = source ? 'Evidence ID' : 'Item ID';
    for (const i of inventory.filter((i) => i.source === source && i.row > 1)) {
      const id = (i.values[col[field]] ?? '').trim();
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const r of source ? proofs : items)
      if ((counts.get(r.reference) ?? 0) > 1) mark(r.id, 'DUPLICATE_ID');
  }
  const memberClaims = new Map<string, number>();
  for (const i of inventory.filter((i) => i.source === 1 && i.row > 1)) {
    const col = columns[1],
      side = (i.values[col['Source side']] ?? '').trim(),
      ref = (i.values[col['Record ID']] ?? '').trim();
    if (ref) {
      const key = JSON.stringify([side, ref]);
      memberClaims.set(key, (memberClaims.get(key) ?? 0) + 1);
    }
  }
  for (const p of proofs)
    if (
      (memberClaims.get(
        JSON.stringify([p.side ? 'cashbook' : 'bank', p.recordReference]),
      ) ?? 0) > 1
    )
      mark(p.id, 'DUPLICATE_MEMBER');
  const byProof = new Map(proofs.map((p) => [p.reference, p])),
    byMovement = new Map(
      balance.bank.records.map((r) => [
        JSON.stringify([r.side, r.reference]),
        r,
      ]),
    ),
    used = new Set<string>(),
    lifeRows = new Map<string, AdjustmentItem[]>();
  for (const i of items) {
    const p = byProof.get(i.proofReference);
    if (!p || p.kind === 'settlement') {
      mark(i.id, 'EVIDENCE');
      continue;
    }
    used.add(p.id);
    if (
      i.amount !== p.amount ||
      i.side !==
        (p.kind === 'timing'
          ? p.side === 0
            ? 1
            : 0
          : p.kind === 'bank-error'
            ? 0
            : 1) ||
      (p.kind === 'bank-error' && p.side !== 0) ||
      (p.kind === 'cashbook-error' && p.side !== 1)
    )
      mark(i.id, 'AMOUNT_SIDE');
    const rows = lifeRows.get(p.lifecycle) ?? [];
    rows.push(i);
    lifeRows.set(p.lifecycle, rows);
  }
  const lifecycles: AdjustmentLifecycle[] = [];
  function originalMember(p: AdjustmentProof) {
    const m = byMovement.get(JSON.stringify([p.side, p.recordReference]));
    if (
      !m ||
      m.signed !== p.amount ||
      m.movementDate !== p.movementDate ||
      m.valueDate !== p.valueDate
    )
      fail('MEMBER');
    return m;
  }
  function supported(m: BankRecord) {
    const g = balance.bank.cases.find((g) =>
      [...g.bankIds, ...g.cashIds].includes(m.id),
    );
    return (
      !!g &&
      g.kind === 'reference' &&
      g.reason === 'missing-counterpart' &&
      g.policy === 'individual' &&
      g.bankIds.length + g.cashIds.length === 1 &&
      m.policy === 'individual' &&
      m.role === 'principal' &&
      !!m.settlement
    );
  }
  for (const [reference, rows] of lifeRows) {
    const related = proofs.filter((p) => p.lifecycle === reference),
      base = related.filter((p) => p.kind !== 'settlement'),
      settled = related.filter((p) => p.kind === 'settlement'),
      life: AdjustmentLifecycle = {
        id: JSON.stringify([ADJUSTMENT_VERSION, 'lifecycle', reference]),
        reference,
        itemIds: rows.map((r) => r.id),
        proofIds: related.map((p) => p.id),
        movementIds: [],
        status: 'needs-review',
      };
    lifecycles.push(life);
    try {
      if (
        base.length !== 1 ||
        rows.length > 2 ||
        new Set(rows.map((r) => r.point)).size !== rows.length ||
        settled.length > 1
      )
        fail('LIFECYCLE');
      const p = base[0],
        o = rows.find((r) => r.point === 'opening'),
        c = rows.find((r) => r.point === 'closing');
      if (rows.some((r) => r.proofReference !== p.reference)) fail('CARRY');
      if (o && p.movementDate > balance.coverage.openingAsOf) fail('DATE');
      if (c && p.movementDate > balance.coverage.closingAsOf) fail('DATE');
      if (c && p.movementDate <= balance.coverage.openingAsOf && !o)
        fail('OLD_ITEM');
      if (o && !c) {
        if (settled.length !== 1) fail('SETTLEMENT');
        const q = settled[0];
        used.add(q.id);
        if (
          q.side !== (p.kind === 'timing' ? (p.side === 0 ? 1 : 0) : p.side) ||
          q.amount !== p.amount ||
          q.movementDate < balance.scope.start ||
          q.movementDate > balance.scope.end ||
          q.valueDate < balance.scope.start ||
          q.valueDate > balance.scope.end ||
          q.movementDate < p.movementDate ||
          q.valueDate < p.valueDate
        )
          fail('SETTLEMENT');
        life.movementIds.push(originalMember(q).id);
      } else if (settled.length) fail('SETTLEMENT');
      if (c && !o && p.kind === 'timing') {
        const m = originalMember(p);
        if (!supported(m)) fail('POLICY');
        life.movementIds.push(m.id);
      }
    } catch (e) {
      for (const i of rows)
        mark(
          i.id,
          e instanceof Error
            ? e.message.replace(/^ADJUSTMENT_/, '')
            : 'LIFECYCLE',
        );
      life.status = 'blocked';
    }
  }
  for (const p of proofs) if (!used.has(p.id)) mark(p.id, 'UNUSED_EVIDENCE');
  const sourceError =
    balance.status === 'source-error' ||
    inventory.some((i) => i.kind === 'error');
  if (sourceError) for (const l of lifecycles) l.status = 'blocked';
  const context = JSON.stringify([
      ADJUSTMENT_VERSION,
      balance.context,
      balance.bank.events,
      input.files.map((f) => f.sha256),
      input.readings,
      complete,
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
        'itemIds',
      ]) ||
      typeof e.id !== 'string' ||
      typeof e.reference !== 'string' ||
      typeof e.note !== 'string' ||
      typeof e.at !== 'string' ||
      !['accept', 'reject', 'undo'].includes(e.type) ||
      e.context !== context ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
      !Number.isFinite(Date.parse(e.at)) ||
      new Date(e.at).toISOString() !== e.at ||
      !Array.isArray(e.itemIds) ||
      !e.itemIds.length ||
      e.itemIds.length > 2 ||
      e.itemIds.some((id) => typeof id !== 'string') ||
      seen.has(e.id)
    )
      fail('EVENT');
    text(e.id);
    text(e.reference);
    text(e.note, 2000, false);
    seen.add(e.id);
    if (sourceError || balance.missing.length) fail('EVENT_SOURCE');
    const l = lifecycles.find((l) => same(l.itemIds, e.itemIds));
    if (!l) fail('EVENT_MEMBERS');
    if (e.type === 'undo') {
      if (!['accepted', 'rejected'].includes(l.status)) fail('EVENT_STATE');
      l.status = 'needs-review';
    } else {
      if (l.status !== 'needs-review') fail('EVENT_STATE');
      l.status = e.type === 'accept' ? 'accepted' : 'rejected';
    }
  }
  const accepted = new Set(
      lifecycles
        .filter((l) => l.status === 'accepted')
        .flatMap((l) => l.itemIds),
    ),
    covered = new Set(
      lifecycles
        .filter((l) => l.status === 'accepted')
        .flatMap((l) => l.movementIds)
        .filter((id) => {
          const m = balance.bank.records.find((r) => r.id === id);
          return !!m && supported(m);
        }),
    );
  const unresolved = balance.bank.cases
    .filter(
      (g) =>
        g.status === 'needs-review' &&
        ![...g.bankIds, ...g.cashIds].every((id) => covered.has(id)),
    )
    .map((g) => g.id);
  const endpoints = (['opening', 'closing'] as const).map((point) => {
    const rawBank = balance.components[0][point],
      rawCash = balance.components[1][point],
      selected = items.filter((i) => i.point === point && accepted.has(i.id)),
      bankItemIds = selected.filter((i) => i.side === 0).map((i) => i.id),
      cashItemIds = selected.filter((i) => i.side === 1).map((i) => i.id),
      bankAdjustment = sourceError
        ? null
        : sum(selected.filter((i) => i.side === 0).map((i) => i.amount)),
      cashAdjustment = sourceError
        ? null
        : sum(selected.filter((i) => i.side === 1).map((i) => i.amount)),
      adjustedBank =
        rawBank !== null && bankAdjustment !== null
          ? sum([rawBank, bankAdjustment])
          : null,
      adjustedCash =
        rawCash !== null && cashAdjustment !== null
          ? sum([rawCash, cashAdjustment])
          : null;
    return {
      point,
      rawBank,
      rawCash,
      bankAdjustment,
      cashAdjustment,
      adjustedBank,
      adjustedCash,
      difference:
        adjustedBank !== null && adjustedCash !== null
          ? sum([adjustedBank, -adjustedCash])
          : null,
      bankItemIds,
      cashItemIds,
    };
  });
  const status = sourceError
    ? 'source-error'
    : balance.missing.length
      ? 'missing'
      : lifecycles.some((l) => l.status !== 'accepted')
        ? 'needs-review'
        : balance.components.some((c) => c.residual !== 0) ||
            endpoints.some((e) => e.difference !== 0)
          ? 'inconsistent'
          : unresolved.length
            ? 'needs-review'
            : 'reconciled-with-evidence';
  return {
    version: ADJUSTMENT_VERSION,
    context,
    balance,
    completeness: { ...complete },
    readings: structuredClone(input.readings),
    sources: input.files.map((f, i) => ({
      name: f.name,
      hash: f.sha256!,
      sheet: f.sheets[input.readings[i].sheet].name,
    })),
    items,
    proofs,
    inventory,
    lifecycles,
    events: structuredClone(input.events),
    endpoints,
    unresolved,
    status,
    claim: ADJUSTMENT_CLAIM,
  };
}
