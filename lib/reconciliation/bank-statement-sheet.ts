// bank-reconciliation-sheet-1 (proposed): the closing reconciliation sheet of
// a bank statement period, by the contract in
// audit/bank-sheet-foundation/contract.json. The lifecycle settles the period
// (bank-statement-lifecycle.ts); this module only reads its result.
//
// The bank side is the statement's printed closing balance; the book side is
// a balance the accountant declares. Every item the settled period leaves
// not cleared is listed alone, by side and direction, with its origin: never
// netted against another, never explained by a cause the evidence does not
// give. Only an automatic pair or an accepted case clears an item. The
// difference is what remains; no entry, tolerance or matching amount closes
// it. A sheet with a case awaiting a decision is a draft.
import type { Direction } from './bank-statement-match.ts';
import type { BankStatementResult } from './bank-statement-lifecycle.ts';

export const BANK_SHEET_FAMILY = 'bank-reconciliation-sheet-1';
/** In the order they are checked. */
export const SHEET_REFUSALS = [
  'SHEET_STATEMENT_HELD',
  'SHEET_PREVIOUS_REFUSED',
  'SHEET_NO_BOOK_BALANCE',
] as const;
export type SheetRefusal = (typeof SHEET_REFUSALS)[number];
/** Cashbook items adjust the bank balance; statement items the book's. */
export const SHEET_SECTIONS = [
  'bookReceiptsNotOnStatement',
  'bookPaymentsNotOnStatement',
  'statementDepositsNotInBook',
  'statementWithdrawalsNotInBook',
] as const;
export type SheetSection = (typeof SHEET_SECTIONS)[number];
const SECTION: Record<string, SheetSection> = {
  'cashbook:in': 'bookReceiptsNotOnStatement',
  'cashbook:out': 'bookPaymentsNotOnStatement',
  'statement:in': 'statementDepositsNotInBook',
  'statement:out': 'statementWithdrawalsNotInBook',
};
/** The book balance the accountant declares: minor units of the statement
 * currency, positive for a debit balance, with a note of where it was read. */
export type BookBalance = { balance: number; note: string };
export const BOOK_NOTE_LIMIT = 200;
export type SheetOrigin = 'unmatched' | 'rejected' | 'pending' | 'carried';
export type SheetItem = {
  side: 'statement' | 'cashbook';
  id: string;
  /** The period the item comes from. */
  period: { start: string; end: string };
  page: number | null;
  row: number | null;
  date: string;
  direction: Direction;
  /** Minor units, positive. */
  amount: number;
  reference: string;
  origin: SheetOrigin;
  /** The case holding it, if any, and that case's reason. */
  case: string | null;
  reason: string | null;
  /** Carried items: period ends outstanding at this period's end. */
  age: number | null;
  /** The file the item is read from. */
  source: string;
};
export type ReconciliationSheet = {
  family: typeof BANK_SHEET_FAMILY;
  status: 'draft' | 'reconciled' | 'difference';
  currency: string;
  decimals: number;
  period: { start: string; end: string };
  bank: { balance: number; page: number };
  book: BookBalance;
  sections: Record<SheetSection, { items: SheetItem[]; total: number }>;
  adjustedBank: number;
  adjustedBook: number;
  /** adjustedBank - adjustedBook. */
  difference: number;
};
export type SheetOutcome =
  | { refusal: SheetRefusal }
  | { refusal: null; sheet: ReconciliationSheet };

function fail(code: string): never {
  throw new Error(`BANK_SHEET_${code}`);
}

/** A declared book balance as the contract admits it. */
export function bookBalance(value: unknown): BookBalance {
  const v = value as BookBalance;
  if (
    !v ||
    typeof v !== 'object' ||
    Object.keys(v).sort().join() !== 'balance,note' ||
    !Number.isSafeInteger(v.balance) ||
    typeof v.note !== 'string' ||
    v.note.length > BOOK_NOTE_LIMIT ||
    /[\p{Cc}\p{Cf}]/u.test(v.note)
  )
    fail('BOOK');
  return { balance: v.balance, note: v.note };
}

const rank = (item: SheetItem) => [
  item.period.start,
  item.side === 'statement' ? Number(item.id.slice(1)) : (item.row ?? 0),
] as const;
const before = (a: SheetItem, b: SheetItem) => {
  const [p, x] = rank(a);
  const [q, y] = rank(b);
  return p < q ? -1 : p > q ? 1 : x - y;
};

/** The sheet of a settled period with the book balance declared for it, or
 * the refusal that stands in its place. */
export function reconciliationSheet(
  result: BankStatementResult,
  book: BookBalance | null,
): SheetOutcome {
  const { reading, match } = result;
  if (reading.format !== 'pdf') fail('FORMAT');
  const closing = reading.lines.find((l) => l.kind === 'closing');
  if (
    result.status === 'held' ||
    match.held ||
    !match.statement.period ||
    reading.closing === null ||
    !closing
  )
    return { refusal: 'SHEET_STATEMENT_HELD' };
  if (result.roll?.previous.status === 'refused')
    return { refusal: 'SHEET_PREVIOUS_REFUSED' };
  if (book === null) return { refusal: 'SHEET_NO_BOOK_BALANCE' };
  const declared = bookBalance(book);
  const period = match.statement.period;
  const source = (role: 'statement' | 'cashbook') =>
    result.sources.find((s) => s.role === role)!.sha256;
  const movements = new Map(match.movements.map((m) => [m.id, m]));
  const entries = new Map(match.cashbook.map((c) => [c.id, c]));
  const cases = new Map(result.cases.map((c) => [c.id, c]));
  const carried = new Map((result.roll?.carried ?? []).map((c) => [c.key, c]));
  // Current items by side and id; a later origin replaces an earlier one, so
  // a member of a case awaiting a decision is pending, not unmatched.
  const current = new Map<string, SheetItem>();
  const put = (
    side: 'statement' | 'cashbook',
    id: string,
    origin: SheetOrigin,
    caseId: string | null,
  ) => {
    const m = side === 'statement' ? movements.get(id) : undefined;
    const e = side === 'cashbook' ? entries.get(id) : undefined;
    const x = m ?? e;
    if (!x) fail('ITEM');
    current.set(`${side}:${id}`, {
      side,
      id,
      period,
      page: m?.page ?? null,
      row: e?.row ?? null,
      date: x.date,
      direction: x.direction,
      amount: x.amount,
      reference: x.reference,
      origin,
      case: caseId,
      reason: caseId === null ? null : cases.get(caseId)!.reason,
      age: null,
      source: source(side),
    });
  };
  for (const o of result.outstanding)
    put(
      o.side,
      o.id,
      o.origin === 'unmatched' ? 'unmatched' : 'rejected',
      o.origin === 'unmatched' ? null : o.origin,
    );
  const pending = result.cases.filter((c) => c.status === 'needs-review');
  for (const c of pending) {
    for (const id of c.statement) put('statement', id, 'pending', c.id);
    for (const id of c.cashbook) put('cashbook', id, 'pending', c.id);
  }
  const old = (
    key: string,
    origin: SheetOrigin,
    caseId: string | null,
    age: number,
  ): SheetItem => {
    const c = carried.get(key) ?? fail('CARRIED');
    return {
      side: c.side,
      id: c.id,
      period: c.period,
      page: c.page,
      row: c.row,
      date: c.date,
      direction: c.direction,
      amount: c.amount,
      reference: c.reference,
      origin,
      case: caseId,
      reason: caseId === null ? null : cases.get(caseId)!.reason,
      age,
      source: c.source,
    };
  };
  const items = [...current.values()];
  for (const c of pending)
    for (const key of c.carried ?? [])
      items.push(old(key, 'pending', c.id, carried.get(key)!.age + 1));
  for (const x of result.roll?.outstanding ?? []) {
    const rejected = result.cases.find(
      (c) => c.status === 'rejected' && (c.carried ?? []).includes(x.key),
    );
    items.push(
      old(x.key, rejected ? 'rejected' : 'carried', rejected?.id ?? null, x.age),
    );
  }
  const sections = Object.fromEntries(
    SHEET_SECTIONS.map((name) => {
      const listed = items
        .filter((i) => SECTION[`${i.side}:${i.direction}`] === name)
        .sort(before);
      return [
        name,
        { items: listed, total: listed.reduce((t, i) => t + i.amount, 0) },
      ];
    }),
  ) as ReconciliationSheet['sections'];
  const adjustedBank =
    reading.closing +
    sections.bookReceiptsNotOnStatement.total -
    sections.bookPaymentsNotOnStatement.total;
  const adjustedBook =
    declared.balance +
    sections.statementDepositsNotInBook.total -
    sections.statementWithdrawalsNotInBook.total;
  const difference = adjustedBank - adjustedBook;
  return {
    refusal: null,
    sheet: {
      family: BANK_SHEET_FAMILY,
      status: items.some((i) => i.origin === 'pending')
        ? 'draft'
        : difference === 0
          ? 'reconciled'
          : 'difference',
      currency: reading.currency,
      decimals: reading.decimals,
      period,
      bank: { balance: reading.closing, page: closing.page },
      book: declared,
      sections,
      adjustedBank,
      adjustedBook,
      difference,
    },
  };
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;

/** The fingerprint a sign-off is bound to: the sheet's whole content, every
 * item with every field, in a fixed key order. Labels and language are not
 * content. */
export async function sheetFingerprint(
  sheet: ReconciliationSheet,
): Promise<string> {
  const text = new TextEncoder().encode(JSON.stringify(canonical(sheet)));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', text)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
