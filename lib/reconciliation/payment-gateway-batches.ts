import type { SheetData, SourceFile } from './types.ts';

/** payment-gateway-batches-1: the batches of one merchant account over a
 * period, each against its settlement row, the gateway's payout lines that
 * say which batch each payout pays, and the bank credits that name the
 * payouts. Read by its own contract beside payment-gateway-batch-1, which is
 * unchanged. Review only: no batch, payout or credit is linked by amount or
 * date, and nothing is decided. */
export const PG_BATCHES_VERSION = 'payment-gateway-batches-1' as const;
export const PG_BATCHES_ROLES = [
  'transactions',
  'fee-evidence',
  'settlements',
  'payout-lines',
  'bank-credits',
] as const;
export type GatewayBatchesRole = (typeof PG_BATCHES_ROLES)[number];
export const PG_BATCHES_HEADERS: readonly (readonly string[])[] = [
  [
    'Transaction ID',
    'Batch ID',
    'Kind',
    'Posting date',
    'Amount',
    'Reference',
    'Merchant account',
    'Currency',
  ],
  ['Fee ID', 'Batch ID', 'Amount', 'Reference', 'Merchant account', 'Currency'],
  [
    'Batch ID',
    'Settlement date',
    'Gross sales',
    'Refunds',
    'Fees',
    'Net',
    'Merchant account',
    'Currency',
  ],
  ['Payout ID', 'Batch ID', 'Amount', 'Merchant account', 'Currency'],
  [
    'Bank reference',
    'Payout ID',
    'Value date',
    'Credit',
    'Bank account',
    'Currency',
  ],
];
export const PG_BATCHES_SCOPE_FIELDS = [
  'entity',
  'gateway',
  'merchantAccount',
  'bankAccount',
  'currency',
  'start',
  'end',
  'asOf',
] as const;
/** Minor units by currency, as the contract lists them. */
export const PG_BATCHES_PLACES: Readonly<Record<string, 0 | 2 | 3>> = {
  SAR: 2,
  AED: 2,
  USD: 2,
  EUR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};
/** The reader's ceiling: MAX_ROWS lines and thirty header rows. */
export const PG_BATCHES_ROW_LIMIT = 20030;
export const PG_BATCH_REASONS = [
  'SALES',
  'REFUNDS',
  'FEES',
  'NET',
  'PAID_SHORT',
  'PAID_OVER',
  'PAYOUT',
] as const;
export type GatewayBatchReason = (typeof PG_BATCH_REASONS)[number];
export const PG_PAYOUT_REASONS = ['CREDIT', 'NOT_DEPOSITED'] as const;
export type GatewayPayoutReason = (typeof PG_PAYOUT_REASONS)[number];
export const PG_BATCHES_ROW_CODES = [
  'CELL',
  'COLUMNS',
  'ROW_SCOPE',
  'IDENTITY',
  'TEXT',
  'KIND',
  'AMOUNT',
  'DATE',
  'PERIOD',
  'DUPLICATE',
  'MEMBER',
] as const;
export type GatewayBatchesRowCode = (typeof PG_BATCHES_ROW_CODES)[number];

export type GatewayBatchesScope = Record<
  (typeof PG_BATCHES_SCOPE_FIELDS)[number],
  string
> & { confirmed: true };
export type GatewayBatchesReading = {
  sheet: 0;
  role: GatewayBatchesRole;
  family: typeof PG_BATCHES_VERSION;
  confirmed: true;
};
export type GatewayBatchesInput = {
  files: SourceFile[];
  readings: GatewayBatchesReading[];
  scope: GatewayBatchesScope;
};
export type GatewayBatchesRowError = {
  source: number;
  row: number;
  code: GatewayBatchesRowCode;
};
export type GatewayBatchesRecords = {
  transactions: {
    row: number;
    id: string;
    batch: string;
    kind: 'sale' | 'refund';
    date: string;
    amount: number;
    reference: string;
  }[];
  fees: {
    row: number;
    id: string;
    batch: string;
    amount: number;
    reference: string;
  }[];
  settlements: {
    row: number;
    batch: string;
    date: string;
    gross: number;
    refunds: number;
    fees: number;
    net: number;
  }[];
  lines: { row: number; payout: string; batch: string; amount: number }[];
  credits: {
    row: number;
    reference: string;
    payout: string;
    valueDate: string;
    amount: number;
  }[];
};
export type GatewayBatch = {
  row: number;
  batch: string;
  sales: number[];
  refunds: number[];
  fees: number[];
  components: { sales: number; refunds: number; fees: number };
  settlement: { gross: number; refunds: number; fees: number; net: number };
  paid: number;
  payouts: string[];
  status: 'consistent' | 'in-transit' | 'review';
  reasons: GatewayBatchReason[];
};
export type GatewayPayout = {
  payout: string;
  lines: number[];
  batches: string[];
  amount: number;
  credit: { row: number; valueDate: string; amount: number } | null;
  status: 'consistent' | 'in-transit' | 'review';
  reasons: GatewayPayoutReason[];
};
export type GatewayUnlinkedCredit = {
  row: number;
  reference: string;
  payout: string;
  valueDate: string;
  amount: number;
  reasons: ['UNLINKED_CREDIT'];
};
export type GatewayBatchesResult = {
  version: typeof PG_BATCHES_VERSION;
  context: string;
  sources: { name: string; sha256: string; sheet: string }[];
  readings: GatewayBatchesReading[];
  scope: GatewayBatchesScope;
  decimals: 0 | 2 | 3;
  /** SOURCE_ERRORS when any row of any file is in error: then no batch,
   * payout or credit is reviewed, and the errors say which rows. */
  refused: 'SOURCE_ERRORS' | null;
  errors: GatewayBatchesRowError[];
  records: GatewayBatchesRecords;
  batches: GatewayBatch[];
  payouts: GatewayPayout[];
  credits: GatewayUnlinkedCredit[];
};

export const refuseGatewayBatches = (code: string): never => {
  throw new Error(`PG_BATCHES_${code}`);
};
class RowError extends Error {
  code: GatewayBatchesRowCode;
  constructor(code: GatewayBatchesRowCode) {
    super(code);
    this.code = code;
  }
}
const fail = (code: GatewayBatchesRowCode): never => {
  throw new RowError(code);
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (v: object, wanted: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');

/** The whitespace the contract trims, as Python's str.strip does: unlike
 * String.prototype.trim it removes U+001C to U+001F and U+0085, and keeps
 * U+FEFF. The control characters in it are those whitespace characters.
 */
const ends =
  // oxlint-disable-next-line eslint/no-control-regex
  /^[\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
const strip = (v: string) => v.replace(ends, '');
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const EXCEL_ERROR = /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i;
const length = (v: string) => Array.from(v).length;

function identity(v: unknown, code: (c: 'IDENTITY') => never = fail) {
  if (
    typeof v !== 'string' ||
    !v ||
    v !== strip(v) ||
    length(v) > 500 ||
    CONTROL.test(v) ||
    '=+@-'.includes(v[0]) ||
    EXCEL_ERROR.test(v)
  )
    return code('IDENTITY');
  return v;
}
function reference(v: string) {
  if (!v || v !== strip(v) || length(v) > 2000 || CONTROL.test(v)) fail('TEXT');
  return v;
}
/** A calendar date written as YYYY-MM-DD, or null. */
function calendar(v: unknown) {
  if (typeof v !== 'string') return null;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(v);
  if (!m) return null;
  const [y, month, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && month >= 1 && month <= 12 && d >= 1 && d <= days[month - 1]
    ? v
    : null;
}
function day(v: string, low: string, high: string) {
  const d = calendar(v);
  if (d === null) return fail('DATE');
  if (d < low || d > high) fail('PERIOD');
  return d;
}
/** Arabic-Indic and extended Arabic-Indic digits and the Arabic decimal
 * separator, and nothing else: a direction mark is not removed. */
const digits = (v: string) =>
  v.replace(/[\u0660-\u0669\u06f0-\u06f9\u066b]/g, (c) => {
    const n = c.charCodeAt(0);
    if (n === 0x066b) return '.';
    return String(n - (n >= 0x06f0 ? 0x06f0 : 0x0660));
  });
function amount(raw: string, places: number) {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(digits(raw));
  if (!m || (m[2] ?? '').length > places) return fail('AMOUNT');
  const n =
    BigInt(m[1]) * 10n ** BigInt(places) +
    BigInt((m[2] ?? '').padEnd(places, '0') || '0');
  if (n > 10n ** 14n) fail('AMOUNT');
  return Number(n);
}
/** An exact sum; a total no integer can hold exactly is refused, never
 * rounded. */
function total(values: number[]) {
  let sum = 0n;
  for (const v of values) sum += BigInt(v);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER))
    refuseGatewayBatches('TOTAL_LIMIT');
  return Number(sum);
}

/** READING, then SCOPE, in the contract's order. Returns the currency's
 * minor units. */
export function gatewayBatchesPlaces(readings: unknown, scope: unknown) {
  if (
    !Array.isArray(readings) ||
    readings.length !== PG_BATCHES_ROLES.length ||
    readings.some(
      (r, i) =>
        !plain(r) ||
        !sameKeys(r, ['sheet', 'role', 'family', 'confirmed']) ||
        r.sheet !== 0 ||
        r.role !== PG_BATCHES_ROLES[i] ||
        r.family !== PG_BATCHES_VERSION ||
        r.confirmed !== true,
    )
  )
    refuseGatewayBatches('READING');
  if (
    !plain(scope) ||
    !sameKeys(scope, [...PG_BATCHES_SCOPE_FIELDS, 'confirmed']) ||
    scope.confirmed !== true
  )
    return refuseGatewayBatches('SCOPE');
  for (const k of PG_BATCHES_SCOPE_FIELDS)
    identity(scope[k], () => refuseGatewayBatches('SCOPE'));
  const places = PG_BATCHES_PLACES[scope.currency as string];
  if (!Object.hasOwn(PG_BATCHES_PLACES, scope.currency as string))
    refuseGatewayBatches('SCOPE');
  const [start, end, asOf] = [scope.start, scope.end, scope.asOf].map(calendar);
  if (start === null || end === null || asOf === null)
    return refuseGatewayBatches('SCOPE');
  if (!(start <= end && end <= asOf)) refuseGatewayBatches('SCOPE');
  return places;
}

/** The trimmed header without its trailing blanks. */
const headerOf = (sheet: SheetData) => {
  const head = (sheet.rows[0] ?? []).map(strip);
  while (head.length && !head[head.length - 1]) head.pop();
  return head;
};
/** Rows the reader marks: hidden, a formula anywhere, a row issue, or a cell
 * issue, a note or (in an identity column) a reference issue within the
 * header's width. */
function marked(sheet: SheetData, width: number, identities: number[]) {
  const rows = new Set<number>([...sheet.hiddenRows, ...sheet.formulaRows]);
  for (const [r, list] of Object.entries(sheet.rowIssues ?? {}))
    if (list.length) rows.add(Number(r));
  for (const key of Object.keys(sheet.formulaCells ?? {}))
    rows.add(Number(key.split(':')[0]));
  const cells = (map?: Record<string, string[]>, only?: number[]) => {
    for (const [key, list] of Object.entries(map ?? {})) {
      const [r, c] = key.split(':').map(Number);
      if (list.length && c <= width && (!only || only.includes(c - 1)))
        rows.add(r);
    }
  };
  cells(sheet.cellIssues);
  cells(sheet.cellNotes);
  cells(sheet.referenceIssues, identities);
  return rows;
}
const IDENTITIES = [
  ['Transaction ID', 'Batch ID'],
  ['Fee ID', 'Batch ID'],
  ['Batch ID'],
  ['Payout ID', 'Batch ID'],
  ['Bank reference', 'Payout ID'],
];

/** COLUMNS: exactly the role's headers, each once, in any order, on a header
 * row the reader does not mark. The reader marks every cell of a hidden
 * column, so a hidden header is COLUMNS too. Returns each header's column. */
export function gatewayBatchesColumns(sheet: SheetData, side: number) {
  const want = PG_BATCHES_HEADERS[side];
  const head = headerOf(sheet);
  if (
    !sheet.rows.length ||
    head.length !== want.length ||
    new Set(head).size !== head.length ||
    want.some((h) => !head.includes(h))
  )
    return refuseGatewayBatches('COLUMNS');
  const col = Object.fromEntries(want.map((h) => [h, head.indexOf(h)]));
  const flagged = marked(
    sheet,
    head.length,
    IDENTITIES[side].map((h) => col[h]),
  );
  if (flagged.has(1)) refuseGatewayBatches('COLUMNS');
  return { col, width: head.length, flagged };
}

type Entry = Record<string, string | number> & {
  row: number;
  id: string;
};

function readSide(
  sheet: SheetData,
  side: number,
  scope: GatewayBatchesScope,
  places: number,
) {
  if (sheet.rows.length > PG_BATCHES_ROW_LIMIT) refuseGatewayBatches('ROWS');
  const { col, width, flagged } = gatewayBatchesColumns(sheet, side);
  const entries: Entry[] = [];
  const errors: GatewayBatchesRowError[] = [];
  for (let index = 1; index < sheet.rows.length; index++) {
    const values = sheet.rows[index];
    const row = index + 1;
    const cell = (h: string) => values[col[h]] ?? '';
    try {
      if (!values.some((v) => strip(v))) {
        if (flagged.has(row)) fail('CELL');
        continue;
      }
      if (flagged.has(row)) fail('CELL');
      if (values.slice(width).some((v) => strip(v))) fail('COLUMNS');
      const bank = side === 4;
      if (
        strip(cell(bank ? 'Bank account' : 'Merchant account')) !==
          (bank ? scope.bankAccount : scope.merchantAccount) ||
        strip(cell('Currency')) !== scope.currency
      )
        fail('ROW_SCOPE');
      if (side === 0) {
        const id = identity(cell('Transaction ID'));
        const batch = identity(cell('Batch ID'));
        const kind = cell('Kind');
        if (kind !== 'sale' && kind !== 'refund') fail('KIND');
        const date = day(cell('Posting date'), scope.start, scope.end);
        const value = amount(strip(cell('Amount')), places);
        const text = reference(cell('Reference'));
        entries.push({
          row,
          id,
          batch,
          kind,
          date,
          amount: value,
          reference: text,
        });
      } else if (side === 1) {
        const id = identity(cell('Fee ID'));
        const batch = identity(cell('Batch ID'));
        const value = amount(strip(cell('Amount')), places);
        const text = reference(cell('Reference'));
        entries.push({ row, id, batch, amount: value, reference: text });
      } else if (side === 2) {
        const id = identity(cell('Batch ID'));
        const date = day(cell('Settlement date'), scope.start, scope.end);
        const [gross, refunds, fees, net] = [
          'Gross sales',
          'Refunds',
          'Fees',
          'Net',
        ].map((h) => amount(strip(cell(h)), places));
        entries.push({ row, id, batch: id, date, gross, refunds, fees, net });
      } else if (side === 3) {
        const payout = identity(cell('Payout ID'));
        const batch = identity(cell('Batch ID'));
        const value = amount(strip(cell('Amount')), places);
        entries.push({
          row,
          id: JSON.stringify([payout, batch]),
          payout,
          batch,
          amount: value,
        });
      } else {
        const id = identity(cell('Bank reference'));
        const payout = identity(cell('Payout ID'));
        const valueDate = day(cell('Value date'), scope.start, scope.asOf);
        const value = amount(strip(cell('Credit')), places);
        entries.push({ row, id, payout, valueDate, amount: value });
      }
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      errors.push({ source: side, row, code: error.code });
    }
  }
  // A repeated key makes every row that carries it an error.
  const bad = new Set<number>();
  for (const key of side === 4 ? ['id', 'payout'] : ['id']) {
    const count = new Map<string | number, number>();
    for (const e of entries) count.set(e[key], (count.get(e[key]) ?? 0) + 1);
    for (const e of entries) if (count.get(e[key])! > 1) bad.add(e.row);
  }
  for (const row of [...bad].sort((a, b) => a - b))
    errors.push({ source: side, row, code: 'DUPLICATE' });
  return { entries: entries.filter((e) => !bad.has(e.row)), errors };
}

export function reviewGatewayBatches(
  input: GatewayBatchesInput,
): GatewayBatchesResult {
  if (
    !plain(input) ||
    !Array.isArray(input.files) ||
    input.files.length !== PG_BATCHES_ROLES.length ||
    input.files.some(
      (f) =>
        !f?.sheets?.[0] ||
        typeof f.sha256 !== 'string' ||
        typeof f.name !== 'string',
    )
  )
    refuseGatewayBatches('SOURCE');
  const decimals = gatewayBatchesPlaces(input.readings, input.scope);
  const scope = input.scope;
  const read: Entry[][] = [];
  const errors: GatewayBatchesRowError[] = [];
  for (let side = 0; side < PG_BATCHES_ROLES.length; side++) {
    const out = readSide(input.files[side].sheets[0], side, scope, decimals);
    read.push(out.entries);
    errors.push(...out.errors);
  }
  const known = new Set(read[2].map((s) => s.id));
  for (const side of [0, 1, 3])
    for (const e of read[side])
      if (!known.has(e.batch as string))
        errors.push({ source: side, row: e.row, code: 'MEMBER' });
  errors.sort((a, b) => a.source - b.source || a.row - b.row);
  const base = {
    version: PG_BATCHES_VERSION,
    context: JSON.stringify([
      PG_BATCHES_VERSION,
      input.files.map((f) => f.sha256),
      input.readings,
      PG_BATCHES_SCOPE_FIELDS.map((k) => scope[k]),
    ]),
    sources: input.files.map((f) => ({
      name: f.name,
      sha256: f.sha256!,
      sheet: f.sheets[0].name,
    })),
    readings: structuredClone(input.readings),
    scope: { ...scope },
    decimals,
  };
  if (errors.length)
    return {
      ...base,
      refused: 'SOURCE_ERRORS',
      errors,
      records: {
        transactions: [],
        fees: [],
        settlements: [],
        lines: [],
        credits: [],
      },
      batches: [],
      payouts: [],
      credits: [],
    };
  const records: GatewayBatchesRecords = {
    transactions: read[0].map((e) => ({
      row: e.row,
      id: e.id,
      batch: e.batch as string,
      kind: e.kind as 'sale' | 'refund',
      date: e.date as string,
      amount: e.amount as number,
      reference: e.reference as string,
    })),
    fees: read[1].map((e) => ({
      row: e.row,
      id: e.id,
      batch: e.batch as string,
      amount: e.amount as number,
      reference: e.reference as string,
    })),
    settlements: read[2].map((e) => ({
      row: e.row,
      batch: e.id,
      date: e.date as string,
      gross: e.gross as number,
      refunds: e.refunds as number,
      fees: e.fees as number,
      net: e.net as number,
    })),
    lines: read[3].map((e) => ({
      row: e.row,
      payout: e.payout as string,
      batch: e.batch as string,
      amount: e.amount as number,
    })),
    credits: read[4].map((e) => ({
      row: e.row,
      reference: e.id,
      payout: e.payout as string,
      valueDate: e.valueDate as string,
      amount: e.amount as number,
    })),
  };
  return {
    ...base,
    refused: null,
    errors: [],
    records,
    ...review(records, scope.end),
  };
}

/** The contract's review of readable records: payouts first, by their
 * lines, then each batch by its settlement row, then the credits no line
 * names. */
function review(records: GatewayBatchesRecords, end: string) {
  const { transactions, fees, settlements, lines, credits } = records;
  const creditOf = new Map(credits.map((c) => [c.payout, c]));
  const linesOf = new Map<string, GatewayBatchesRecords['lines']>();
  for (const line of lines) {
    const list = linesOf.get(line.payout);
    if (list) list.push(line);
    else linesOf.set(line.payout, [line]);
  }
  const statusOf = new Map<string, GatewayPayout['status']>();
  const payouts: GatewayPayout[] = [...linesOf].map(([payout, mine]) => {
    const amount = total(mine.map((l) => l.amount));
    const c = creditOf.get(payout);
    const reasons: GatewayPayoutReason[] = [];
    if (!c) reasons.push('NOT_DEPOSITED');
    else if (c.amount !== amount) reasons.push('CREDIT');
    const status = reasons.length
      ? 'review'
      : c!.valueDate > end
        ? 'in-transit'
        : 'consistent';
    statusOf.set(payout, status);
    return {
      payout,
      lines: mine.map((l) => l.row),
      batches: mine.map((l) => l.batch),
      amount,
      credit: c
        ? { row: c.row, valueDate: c.valueDate, amount: c.amount }
        : null,
      status,
      reasons,
    };
  });
  type Members = {
    sales: GatewayBatchesRecords['transactions'];
    refunds: GatewayBatchesRecords['transactions'];
    fees: GatewayBatchesRecords['fees'];
    lines: GatewayBatchesRecords['lines'];
  };
  const members = new Map<string, Members>(
    settlements.map((s) => [
      s.batch,
      { sales: [], refunds: [], fees: [], lines: [] },
    ]),
  );
  for (const t of transactions)
    members.get(t.batch)![t.kind === 'sale' ? 'sales' : 'refunds'].push(t);
  for (const f of fees) members.get(f.batch)!.fees.push(f);
  for (const l of lines) members.get(l.batch)!.lines.push(l);
  const batches: GatewayBatch[] = settlements.map((s) => {
    const mine = members.get(s.batch)!;
    const components = {
      sales: total(mine.sales.map((t) => t.amount)),
      refunds: total(mine.refunds.map((t) => t.amount)),
      fees: total(mine.fees.map((f) => f.amount)),
    };
    const paid = total(mine.lines.map((l) => l.amount));
    const its = [...new Set(mine.lines.map((l) => l.payout))];
    const reasons: GatewayBatchReason[] = [];
    if (components.sales !== s.gross) reasons.push('SALES');
    if (components.refunds !== s.refunds) reasons.push('REFUNDS');
    if (components.fees !== s.fees) reasons.push('FEES');
    if (s.gross - s.refunds - s.fees !== s.net) reasons.push('NET');
    if (paid < s.net) reasons.push('PAID_SHORT');
    if (paid > s.net) reasons.push('PAID_OVER');
    if (its.some((p) => statusOf.get(p) === 'review')) reasons.push('PAYOUT');
    return {
      row: s.row,
      batch: s.batch,
      sales: mine.sales.map((t) => t.row),
      refunds: mine.refunds.map((t) => t.row),
      fees: mine.fees.map((f) => f.row),
      components,
      settlement: {
        gross: s.gross,
        refunds: s.refunds,
        fees: s.fees,
        net: s.net,
      },
      paid,
      payouts: its,
      status: reasons.length
        ? 'review'
        : its.some((p) => statusOf.get(p) === 'in-transit')
          ? 'in-transit'
          : 'consistent',
      reasons,
    };
  });
  const unlinked: GatewayUnlinkedCredit[] = credits
    .filter((c) => !linesOf.has(c.payout))
    .map((c) => ({
      row: c.row,
      reference: c.reference,
      payout: c.payout,
      valueDate: c.valueDate,
      amount: c.amount,
      reasons: ['UNLINKED_CREDIT'],
    }));
  return { batches, payouts, credits: unlinked };
}
