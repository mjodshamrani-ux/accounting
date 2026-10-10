import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { nativeDisplayIssue } from './xlsx-display.ts';
import { assertSourceFile } from './protocol.ts';
import type { SourceFile } from './types.ts';

export const ALLOCATION_VERSION = 'allocation-snapshot-1';
export const ALLOCATION_SCOPE_FIELDS = [
  'entity',
  'ledger',
  'party',
  'account',
  'currency',
  'cutoff',
  'basis',
] as const;
export type AllocationScope = Record<
  (typeof ALLOCATION_SCOPE_FIELDS)[number],
  string
> & { confirmed: boolean };
export const ALLOCATION_ROLES = [
  'available-payments',
  'open-invoices',
  'proposed-remittance',
] as const;
export type AllocationReading = {
  sheet: number;
  role: (typeof ALLOCATION_ROLES)[number];
  family: typeof ALLOCATION_VERSION;
  confirmed: boolean;
};
const metadata = [
  'Entity',
  'Ledger',
  'Party',
  'Account',
  'Currency',
  'Snapshot date',
  'Allocation basis',
];
export const ALLOCATION_HEADERS = [
  [
    'Payment ID',
    'Payment date',
    ...metadata,
    'Original amount',
    'Available amount',
  ],
  [
    'Invoice ID',
    'Invoice date',
    ...metadata,
    'Original amount',
    'Available amount',
  ],
  [
    'Advice line ID',
    ...metadata,
    'Payment ID',
    'Invoice ID',
    'Allocation amount',
  ],
];
export type AllocationBasis = {
  kind: 'remittance' | 'external-confirmation' | 'accountant-review';
  reference: string;
  reason: string;
  proofId: string;
};
export type AllocationLink = {
  paymentId: string;
  invoiceId: string;
  amount: number;
  basis: AllocationBasis;
};
type EventBase = { id: string; context: string; at: string; note: string };
export type AllocationEvent = EventBase &
  (
    | { type: 'allocate'; links: AllocationLink[] }
    | { type: 'undo'; target: string }
  );
export type AllocationInput = {
  files: [SourceFile, SourceFile, SourceFile];
  readings: [AllocationReading, AllocationReading, AllocationReading];
  scope: AllocationScope;
  events: AllocationEvent[];
};
export type AllocationItem = {
  id: string;
  side: 0 | 1;
  row: number;
  reference: string;
  date: string;
  original: number;
  available: number;
  traces: { field: string; column: number; text: string; amount: number }[];
};
export type AllocationProof = {
  id: string;
  row: number;
  reference: string;
  payment: string;
  invoice: string;
  amount: number;
  column: number;
  text: string;
};
export type AllocationInventory = {
  side: number;
  row: number;
  kind: 'header' | 'blank' | 'item' | 'proof' | 'error';
  values: string[];
  error?: string;
};
export type AllocationResult = {
  version: typeof ALLOCATION_VERSION;
  context: string;
  decimals: number;
  status: 'ready' | 'source-error';
  scope: AllocationScope;
  readings: AllocationInput['readings'];
  sources: {
    hash: string;
    name: string;
    sheet: string;
    role: AllocationReading['role'];
  }[];
  items: AllocationItem[];
  proofs: AllocationProof[];
  inventory: AllocationInventory[];
  events: AllocationEvent[];
  activeDecisions: string[];
  links: (AllocationLink & { id: string; decision: string })[];
  balances: {
    id: string;
    original: number;
    available: number;
    allocated: number;
    remaining: number;
  }[];
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`ALLOCATION_${code}`);
}
function text(v: unknown, max = 500): string {
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
function identity(v: unknown) {
  const s = text(v);
  if (/^[=+@-]/.test(s) || /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(s))
    fail('IDENTITY');
  return s;
}
function date(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || parseDate(v, 'ymd') !== v) fail('DATE');
  return v;
}
function money(raw: string, decimals: number) {
  const v = latinDigits(raw.trim()).replace(/٫/g, '.');
  if (!/^\d+(?:\.\d+)?$/.test(v)) fail('AMOUNT');
  const n = parseMoney(v, 'dot', decimals);
  if (n === undefined || !Number.isSafeInteger(n) || n < 0 || n > 1e14)
    fail('AMOUNT');
  return n;
}
function scopeDecimals(scope: AllocationScope) {
  if (
    !plain(scope) ||
    !keys(scope, [...ALLOCATION_SCOPE_FIELDS, 'confirmed']) ||
    scope.confirmed !== true ||
    !ALLOCATION_SCOPE_FIELDS.every((k) => identity(scope[k]) === scope[k])
  )
    fail('SCOPE');
  const n = currencyPrecision(scope.currency);
  if (n === undefined || scope.basis !== 'before-proposed-allocation')
    fail('SCOPE');
  date(scope.cutoff);
  return n;
}
function readSource(input: AllocationInput, side: 0 | 1 | 2, decimals: number) {
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
    !keys(reading, ['sheet', 'role', 'family', 'confirmed']) ||
    reading.family !== ALLOCATION_VERSION ||
    reading.role !== ALLOCATION_ROLES[side] ||
    reading.confirmed !== true ||
    !Number.isSafeInteger(reading.sheet) ||
    reading.sheet < 0
  )
    fail('READING');
  const s = file.sheets[reading.sheet],
    headers = ALLOCATION_HEADERS[side];
  if (
    !s?.rows.length ||
    s.hiddenRows.includes(1) ||
    s.rowIssues?.['1']?.some((issue) => !issue.startsWith('XLSX_NATIVE_DISPLAY:')) ||
    s.xlsxHeaders?.hiddenColumns.length ||
    s.xlsxHeaders?.merges.length ||
    [s.cellIssues, s.referenceIssues].some((m) =>
      Object.entries(m ?? {}).some(([k, v]) => k.startsWith('1:') && v.length),
    ) ||
    Object.keys(s.formulaCells ?? {}).some((k) => k.startsWith('1:'))
  )
    fail('COLUMNS');
  const head = s.rows[0].map((v) => v.trim());
  if (
    head.length !== headers.length ||
    new Set(head).size !== head.length ||
    headers.some((h) => !head.includes(h))
  )
    fail('COLUMNS');
  const col = Object.fromEntries(headers.map((h) => [h, head.indexOf(h)]));
  const identityCols = headers
    .filter((h) => !/amount$|date$/i.test(h))
    .map((h) => col[h]);
  const items: AllocationItem[] = [],
    proofs: AllocationProof[] = [],
    inventory: AllocationInventory[] = [];
  const hidden = new Set(s.hiddenRows);
  for (const [index, raw] of s.rows.entries()) {
    const row = index + 1,
      values = [...raw];
    if (!index) {
      inventory.push({ side, row, kind: 'header', values });
      continue;
    }
    try {
      if (
        hidden.has(row) ||
        s.rowIssues?.[String(row)]?.length ||
        Object.values(col).some(
          (c) =>
            s.formulaCells?.[`${row}:${c + 1}`] ||
            s.cellIssues?.[`${row}:${c + 1}`]?.length,
        ) ||
        identityCols.some((c) => s.referenceIssues?.[`${row}:${c + 1}`]?.length)
      )
        fail('CELL');
      if (!values.some((v) => v.trim())) {
        inventory.push({ side, row, kind: 'blank', values });
        continue;
      }
      if (values.slice(headers.length).some((v) => v.trim())) fail('COLUMNS');
      const get = (h: string) => (values[col[h]] ?? '').trim();
      for (const [i, key] of ALLOCATION_SCOPE_FIELDS.entries())
        if (get(metadata[i]) !== input.scope[key]) fail('ROW_SCOPE');
      const id = `${side}:${file.sha256}:${reading.sheet}:${row}`;
      if (side === 2) {
        const reference = identity(get('Advice line ID')),
          payment = identity(get('Payment ID')),
          invoice = identity(get('Invoice ID')),
          amount = money(get('Allocation amount'), decimals);
        if (amount <= 0) fail('AMOUNT');
        proofs.push({
          id,
          row,
          reference,
          payment,
          invoice,
          amount,
          column: col['Allocation amount'] + 1,
          text: values[col['Allocation amount']] ?? '',
        });
      } else {
        const reference = identity(get(side ? 'Invoice ID' : 'Payment ID')),
          when = date(get(side ? 'Invoice date' : 'Payment date'));
        if (when > input.scope.cutoff) fail('DATE');
        const original = money(get('Original amount'), decimals),
          available = money(get('Available amount'), decimals);
        if (original <= 0 || available > original) fail('CAPACITY');
        items.push({
          id,
          side,
          row,
          reference,
          date: when,
          original,
          available,
          traces: ['Original amount', 'Available amount'].map((field) => ({
            field,
            column: col[field] + 1,
            text: values[col[field]] ?? '',
            amount: field === 'Original amount' ? original : available,
          })),
        });
      }
      inventory.push({
        side,
        row,
        kind: side === 2 ? 'proof' : 'item',
        values,
      });
    } catch (e) {
      inventory.push({
        side,
        row,
        kind: 'error',
        values,
        error: nativeDisplayIssue(s, row, Object.values(col)) ??
          (e instanceof Error ? e.message : 'ALLOCATION_ROW'),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const x of [...items, ...proofs])
    counts.set(x.reference, (counts.get(x.reference) ?? 0) + 1);
  const bad = new Set(
    [...items, ...proofs]
      .filter((x) => counts.get(x.reference)! > 1)
      .map((x) => x.row),
  );
  for (const i of inventory)
    if (bad.has(i.row)) {
      i.kind = 'error';
      i.error = 'ALLOCATION_DUPLICATE';
    }
  return {
    items: items.filter((x) => !bad.has(x.row)),
    proofs: proofs.filter((x) => !bad.has(x.row)),
    inventory,
  };
}
function eventEnvelope(e: AllocationEvent, context: string, seen: Set<string>) {
  if (
    !plain(e) ||
    !['allocate', 'undo'].includes(e.type) ||
    !keys(e, [
      'id',
      'context',
      'at',
      'note',
      'type',
      e.type === 'allocate' ? 'links' : 'target',
    ]) ||
    e.context !== context ||
    seen.has(e.id)
  )
    fail('EVENT');
  identity(e.id);
  text(e.note, 2000);
  if (
    typeof e.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
    !Number.isFinite(Date.parse(e.at)) ||
    new Date(e.at).toISOString() !== e.at
  )
    fail('EVENT_TIME');
  seen.add(e.id);
}
/** Pure replay. Value capacity, never row ownership or AP matching. */
export function reconcileAllocation(input: AllocationInput): AllocationResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 3 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 3 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  const decimals = scopeDecimals(input.scope),
    read = ([0, 1, 2] as const).map((side) =>
      readSource(input, side, decimals),
    );
  const items = read.flatMap((r) => r.items),
    inventory = read.flatMap((r) => r.inventory),
    proofs = read.flatMap((r) => r.proofs);
  const itemById = new Map(items.map((i) => [i.id, i])),
    byRef = new Map(items.map((i) => [`${i.side}:${i.reference}`, i]));
  const validProofs = proofs.filter((p) => {
    if (byRef.has(`0:${p.payment}`) && byRef.has(`1:${p.invoice}`)) return true;
    const inv = inventory.find((i) => i.side === 2 && i.row === p.row)!;
    inv.kind = 'error';
    inv.error = 'ALLOCATION_PROOF_MEMBER';
    return false;
  });
  const proofById = new Map(validProofs.map((p) => [p.id, p]));
  const context = JSON.stringify([
    ALLOCATION_VERSION,
    input.files.map((f) => f.sha256),
    input.readings.map((r) => [r.sheet, r.role, r.family, r.confirmed]),
    ALLOCATION_SCOPE_FIELDS.map((k) => input.scope[k]),
    input.scope.confirmed,
  ]);
  const status = inventory.some((i) => i.kind === 'error')
    ? 'source-error'
    : 'ready';
  if (status === 'source-error' && input.events.length) fail('SOURCE_ERRORS');
  // Each admitted event is checked against the complete active ledger before insertion.
  const active = new Map<string, AllocationLink[]>(),
    seen = new Set<string>();
  const usage = () => {
    const used = new Map<string, number>(),
      proofsUsed = new Set<string>();
    for (const ls of active.values())
      for (const l of ls) {
        used.set(l.paymentId, safeSum([used.get(l.paymentId) ?? 0, l.amount]));
        used.set(l.invoiceId, safeSum([used.get(l.invoiceId) ?? 0, l.amount]));
        if (l.basis.kind === 'remittance') proofsUsed.add(l.basis.proofId);
      }
    return { used, proofsUsed };
  };
  for (const e of input.events) {
    eventEnvelope(e, context, seen);
    if (e.type === 'undo') {
      identity(e.target);
      if (!active.has(e.target)) fail('UNDO');
      active.delete(e.target);
      continue;
    }
    if (!Array.isArray(e.links) || !e.links.length || e.links.length > 100)
      fail('LINKS');
    const { used, proofsUsed } = usage();
    for (const l of e.links) {
      if (
        !plain(l) ||
        !keys(l, ['paymentId', 'invoiceId', 'amount', 'basis']) ||
        !Number.isSafeInteger(l.amount) ||
        l.amount <= 0 ||
        l.amount > 1e14
      )
        fail('LINK');
      const pay = itemById.get(l.paymentId),
        inv = itemById.get(l.invoiceId);
      if (!pay || pay.side !== 0 || !inv || inv.side !== 1) fail('MEMBER');
      const b = l.basis;
      if (
        !plain(b) ||
        !keys(b, ['kind', 'reference', 'reason', 'proofId']) ||
        !['remittance', 'external-confirmation', 'accountant-review'].includes(
          b.kind,
        )
      )
        fail('BASIS');
      text(b.reference);
      text(b.reason, 2000);
      if (b.kind === 'remittance') {
        const p = proofById.get(b.proofId);
        if (
          !p ||
          p.reference !== b.reference ||
          p.payment !== pay.reference ||
          p.invoice !== inv.reference ||
          p.amount !== l.amount ||
          proofsUsed.has(p.id)
        )
          fail('PROOF');
        proofsUsed.add(p.id);
      } else if (b.proofId !== '') fail('BASIS');
      for (const item of [pay, inv]) {
        const total = safeSum([used.get(item.id) ?? 0, l.amount]);
        if (total > item.available) fail('OVER_AVAILABLE');
        used.set(item.id, total);
      }
    }
    active.set(e.id, e.links);
  }
  const { used } = usage();
  const links = [...active].flatMap(([decision, ls]) =>
    ls.map((l, i) => ({ ...l, id: `${decision}:${i}`, decision })),
  );
  const balances = items.map((i) => ({
    id: i.id,
    original: i.original,
    available: i.available,
    allocated: used.get(i.id) ?? 0,
    remaining: i.available - (used.get(i.id) ?? 0),
  }));
  // BigInt totals make conservation independent of aggregate Number rounding.
  const totals = [0n, 0n];
  for (const b of balances) {
    if (b.remaining < 0 || safeSum([b.allocated, b.remaining]) !== b.available)
      fail('CONSERVATION');
    totals[itemById.get(b.id)!.side] += BigInt(b.allocated);
  }
  if (totals[0] !== totals[1]) fail('CONSERVATION');
  return structuredClone({
    version: ALLOCATION_VERSION,
    context,
    decimals,
    status,
    scope: input.scope,
    readings: input.readings,
    sources: input.files.map((f, side) => ({
      hash: f.sha256!,
      name: f.name,
      sheet: f.sheets[input.readings[side].sheet].name,
      role: input.readings[side].role,
    })),
    items,
    proofs: validProofs,
    inventory,
    events: input.events,
    activeDecisions: [...active.keys()],
    links,
    balances,
  });
}
