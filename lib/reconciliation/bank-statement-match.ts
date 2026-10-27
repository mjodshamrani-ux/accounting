// bank-statement-native-1, matching part: a statement read and proved by
// bank-statement-native.ts against the company cashbook, by the contract in
// audit/bank-statement-foundation/contract.json.
//
// Only a statement whose completeness is proved is matched: printed page
// numbers with a closing balance, or for a table export a closing balance the
// accountant confirmed that equals the file's own. Anything else is held whole,
// since a missing or misprinted page may hold the counterpart of any item.
// An automatic match needs one explicit identical reference on each side, the
// same direction and amount and dates within the window; everything else goes
// to review with its reason, and an equal amount and date is never more than
// a suggestion. Nothing here decides for the accountant or changes the files.
import type {
  BankStatementReading,
  StatementStatus,
} from './bank-statement-native.ts';
import { BANK_STATEMENT_NATIVE } from './bank-statement-native.ts';
import { currencyPrecision } from './currency-precision.ts';
import { numericPrecisionIssue } from './io.ts';
import type { SourceFile } from './types.ts';

export const STATEMENT_DATE_WINDOW_DAYS = 3;
export const CASHBOOK_HEADERS = [
  'Date',
  'Voucher',
  'Description',
  'Reference',
  'Receipts',
  'Payments',
];

export type Direction = 'in' | 'out';
export type CashbookEntry = {
  /** The voucher, unique within the cashbook. */
  id: string;
  /** 1-based row in the file. */
  row: number;
  date: string;
  description: string;
  reference: string;
  direction: Direction;
  /** Minor units, positive. */
  amount: number;
};
export type StatementMovement = {
  /** S1, S2, … in printed order. */
  id: string;
  page: number;
  items: number[];
  date: string;
  valueDate: string;
  description: string;
  reference: string;
  direction: Direction;
  amount: number;
  balance: number;
};
export type ReviewReason =
  | 'direction-conflict'
  | 'amount-difference'
  | 'date-gap'
  | 'duplicate-reference'
  | 'amount-date-suggestion'
  | 'ambiguous-amount-date';
export type ReviewGroup = {
  statement: string[];
  cashbook: string[];
  reason: ReviewReason;
  /** The shared reference, for the reasons found by reference. */
  reference?: string;
};
export type StatementMatchResult = {
  family: typeof BANK_STATEMENT_NATIVE;
  policy: { dateWindowDays: number };
  statement: {
    status: StatementStatus;
    reason?: string;
    /** How completeness was proved, if it was. */
    completeness: 'printed' | 'confirmed-closing' | 'unproven';
    period: { start: string; end: string } | null;
  };
  movements: StatementMovement[];
  cashbook: CashbookEntry[];
  /** Present when nothing could be matched; counts what was held. */
  held?: { reason: string; statement: number; cashbook: number };
  auto: { statement: string; cashbook: string; reference: string }[];
  review: ReviewGroup[];
  statementOnly: string[];
  cashbookOnly: string[];
  /** Statement movements whose value date falls outside the period. */
  timing: string[];
};

export class CashbookReadError extends Error {
  readonly code: string;
  readonly row: number;
  constructor(code: string, row: number, detail: string) {
    super(`BANK_CASHBOOK_${code}: row ${row}: ${detail}`);
    this.code = code;
    this.row = row;
  }
}

const isoDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(s);
  if (!m) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
    ? s
    : undefined;
};
const dayNumber = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const days = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));

/** Reads a cashbook export in the declared headers: one row per entry, one
 * positive amount in Receipts or Payments, a unique voucher, ISO dates. */
export function readBankCashbookTable(
  file: SourceFile,
  currency: string,
): CashbookEntry[] {
  const decimals = currencyPrecision(currency);
  if (decimals === undefined)
    throw new CashbookReadError('SCOPE', 0, 'unknown currency');
  const rows = file.sheets[0]?.rows ?? [];
  if (
    file.sheets.length !== 1 ||
    rows[0]?.length !== CASHBOOK_HEADERS.length ||
    rows[0].some((h, i) => h.trim() !== CASHBOOK_HEADERS[i])
  )
    throw new CashbookReadError(
      'HEADER',
      1,
      'the first row must be the declared headers in order',
    );
  const money = new RegExp(
    `^(\\d+)${decimals ? `\\.(\\d{${decimals}})` : ''}$`,
    'u',
  );
  // A typed number holds its value, not the decimals it is shown with: the
  // number 366445 is 366445.00, and 1234.5 is 1234.50. Text keeps the form.
  const typedMoney = new RegExp(
    `^(\\d+)${decimals ? `(?:\\.(\\d{1,${decimals}}))?` : ''}$`,
    'u',
  );
  const numeric = file.sheets[0]?.numericCells;
  // What the generic reader recorded about a cell that Excel would hide,
  // merge, compute or write as another identifier. The other families'
  // readers use these records; an entry must not rest on such a cell (G16). A
  // typed amount whose stored digits outlive JavaScript keeps the rule
  // above: its precision note stays out of the two amount columns only.
  const sheet = file.sheets[0];
  const recorded = (at: number) => {
    const rowIssues = sheet.rowIssues?.[String(at)] ?? [];
    if (rowIssues.length)
      throw new CashbookReadError('SHEET', at, rowIssues.join('; '));
    CASHBOOK_HEADERS.forEach((name, k) => {
      const key = `${at}:${k + 1}`;
      const issues = [
        ...(sheet.cellIssues?.[key] ?? []),
        ...(name === 'Voucher' || name === 'Reference'
          ? (sheet.referenceIssues?.[key] ?? [])
          : []),
      ].filter(
        (issue) =>
          !(
            (name === 'Receipts' || name === 'Payments') &&
            issue === numericPrecisionIssue(`${'ABCDEF'[k]}${at}`)
          ),
      );
      if (issues.length)
        throw new CashbookReadError('CELL', at, `${name}: ${issues.join('; ')}`);
    });
  };
  recorded(1);
  const amount = (s: string, at: number, column: number, name: string) => {
    if (!s) return 0;
    const m = (numeric?.[`${at}:${column}`] ? typedMoney : money).exec(s);
    const value = m ? Number(m[1] + (m[2] ?? '').padEnd(decimals, '0')) : NaN;
    if (!Number.isSafeInteger(value))
      throw new CashbookReadError('AMOUNT', at, `${name} ${JSON.stringify(s)}`);
    return value;
  };
  const entries: CashbookEntry[] = [];
  const vouchers = new Set<string>();
  for (const [i, row] of rows.slice(1).entries()) {
    const at = i + 2;
    recorded(at);
    if (row.slice(CASHBOOK_HEADERS.length).some((s) => s.trim()))
      throw new CashbookReadError('COLUMN', at, 'a value outside the columns');
    const [date, voucher, description, reference, receipts, payments] =
      CASHBOOK_HEADERS.map((_, k) => (row[k] ?? '').trim());
    if (
      !date &&
      !voucher &&
      !description &&
      !reference &&
      !receipts &&
      !payments
    )
      throw new CashbookReadError('ROW', at, 'an empty row');
    const receipt = amount(receipts, at, 5, 'receipts');
    const payment = amount(payments, at, 6, 'payments');
    if (receipt > 0 === payment > 0)
      throw new CashbookReadError(
        'AMOUNT',
        at,
        'one positive amount in Receipts or Payments',
      );
    if (!voucher || vouchers.has(voucher))
      throw new CashbookReadError(
        'VOUCHER',
        at,
        'a missing or repeated voucher',
      );
    vouchers.add(voucher);
    entries.push({
      id: voucher,
      row: at,
      date:
        isoDate(date) ??
        (() => {
          throw new CashbookReadError('DATE', at, JSON.stringify(date));
        })(),
      description,
      reference,
      direction: receipt ? 'in' : 'out',
      amount: receipt || payment,
    });
  }
  return entries;
}

/** The statement's movements, identified S1, S2, … in printed order. */
export function statementMovements(
  reading: BankStatementReading,
): StatementMovement[] {
  return reading.lines
    .filter((l) => l.kind === 'movement')
    .map((l, i) => ({
      id: `S${i + 1}`,
      page: l.page,
      items: l.items,
      date: l.date!,
      valueDate: l.valueDate!,
      description: l.description ?? '',
      reference: l.reference ?? '',
      direction: l.withdrawal ? ('out' as const) : ('in' as const),
      amount: l.withdrawal || l.deposit!,
      balance: l.balance!,
    }));
}

/** Matches a statement reading against cashbook entries. */
export function matchBankStatement(
  reading: BankStatementReading,
  cashbook: CashbookEntry[],
  options: {
    /** A closing balance the accountant confirmed, in minor units. */
    confirmedClosing?: number;
    /** The statement period, for a statement that does not print one. */
    period?: { start: string; end: string };
    /** Items kept out of matching, as `S:<movement>` and `C:<voucher>`: a
     * carried item's repetition holds them for review (bank-statement-roll-1).
     * They are in no pair, group or one-sided list here. */
    withheld?: ReadonlySet<string>;
  } = {},
): StatementMatchResult {
  const movements = statementMovements(reading);
  const window = STATEMENT_DATE_WINDOW_DAYS;
  const period = reading.period ?? options.period ?? null;
  // A table states no closing balance; its own is the last running balance.
  const ownClosing =
    reading.closing ?? movements.at(-1)?.balance ?? reading.opening ?? null;
  const confirmed =
    reading.status === 'completeness-unproven' &&
    options.confirmedClosing !== undefined &&
    options.confirmedClosing === ownClosing;
  const completeness =
    reading.status === 'verified'
      ? ('printed' as const)
      : confirmed
        ? ('confirmed-closing' as const)
        : ('unproven' as const);
  const base: Omit<StatementMatchResult, 'held'> = {
    family: BANK_STATEMENT_NATIVE,
    policy: { dateWindowDays: window },
    statement: {
      status: reading.status,
      ...(reading.reason ? { reason: reading.reason } : {}),
      completeness,
      period,
    },
    movements,
    cashbook,
    auto: [],
    review: [],
    statementOnly: [],
    cashbookOnly: [],
    timing: [],
  };
  const hold = (reason: string): StatementMatchResult => ({
    ...base,
    held: { reason, statement: movements.length, cashbook: cashbook.length },
  });
  if (completeness === 'unproven')
    return hold(
      reading.status === 'completeness-unproven'
        ? options.confirmedClosing === undefined
          ? 'completeness-unproven: confirm the closing balance'
          : `confirmed closing ${options.confirmedClosing} != ${ownClosing}`
        : `${reading.status}: ${reading.reason ?? ''}`.trim(),
    );
  if (!period) return hold('no statement period');

  const used = new Set<string>(options.withheld);
  const auto: StatementMatchResult['auto'] = [];
  const review: ReviewGroup[] = [];
  const byReference = <T extends { reference: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const ref = r.reference.trim();
      if (ref) map.set(ref, [...(map.get(ref) ?? []), r]);
    }
    return map;
  };
  const statementRefs = byReference(
    movements.filter((r) => !used.has(`S:${r.id}`)),
  );
  const cashbookRefs = byReference(
    cashbook.filter((r) => !used.has(`C:${r.id}`)),
  );
  // Step 1: an explicit identical reference on both sides.
  for (const ref of [...statementRefs.keys()].sort()) {
    const s = statementRefs.get(ref)!;
    const c = cashbookRefs.get(ref);
    if (!c) continue;
    if (s.length === 1 && c.length === 1) {
      const [x, y] = [s[0], c[0]];
      const reason: ReviewReason | undefined =
        x.direction !== y.direction
          ? 'direction-conflict'
          : x.amount !== y.amount
            ? 'amount-difference'
            : days(x.date, y.date) > window
              ? 'date-gap'
              : undefined;
      if (reason)
        review.push({
          statement: [x.id],
          cashbook: [y.id],
          reason,
          reference: ref,
        });
      else auto.push({ statement: x.id, cashbook: y.id, reference: ref });
    } else
      review.push({
        statement: s.map((r) => r.id),
        cashbook: c.map((r) => r.id),
        reason: 'duplicate-reference',
        reference: ref,
      });
    for (const r of s) used.add(`S:${r.id}`);
    for (const r of c) used.add(`C:${r.id}`);
  }
  // Step 2: what is left, by direction, amount and date, as review only.
  const poolS = movements.filter((r) => !used.has(`S:${r.id}`));
  const poolC = cashbook.filter((r) => !used.has(`C:${r.id}`));
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    edges.set(a, (edges.get(a) ?? new Set()).add(b));
    edges.set(b, (edges.get(b) ?? new Set()).add(a));
  };
  const sameKind = new Map<string, CashbookEntry[]>();
  for (const c of poolC) {
    const key = `${c.direction}|${c.amount}`;
    sameKind.set(key, [...(sameKind.get(key) ?? []), c]);
  }
  for (const s of poolS)
    for (const c of sameKind.get(`${s.direction}|${s.amount}`) ?? [])
      if (days(s.date, c.date) <= window) link(`S:${s.id}`, `C:${c.id}`);
  const seen = new Set<string>();
  for (const start of [...edges.keys()].sort()) {
    if (seen.has(start)) continue;
    const component = new Set<string>();
    const todo = [start];
    while (todo.length) {
      const node = todo.pop()!;
      if (component.has(node)) continue;
      component.add(node);
      for (const next of edges.get(node)!)
        if (!component.has(next)) todo.push(next);
    }
    for (const node of component) {
      seen.add(node);
      used.add(node);
    }
    const members = [...component].sort();
    review.push({
      statement: members
        .filter((m) => m.startsWith('S:'))
        .map((m) => m.slice(2)),
      cashbook: members
        .filter((m) => m.startsWith('C:'))
        .map((m) => m.slice(2)),
      reason:
        component.size === 2
          ? 'amount-date-suggestion'
          : 'ambiguous-amount-date',
    });
  }
  return {
    ...base,
    auto,
    review,
    statementOnly: movements
      .filter((r) => !used.has(`S:${r.id}`))
      .map((r) => r.id),
    cashbookOnly: cashbook
      .filter((r) => !used.has(`C:${r.id}`))
      .map((r) => r.id),
    timing: movements
      .filter((r) => r.valueDate < period.start || r.valueDate > period.end)
      .map((r) => r.id),
  };
}
