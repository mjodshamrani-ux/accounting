// bank-statement-lifecycle-1, interface part: what the bank workspace may
// offer the accountant for a statement session, derived from the result
// alone. The lifecycle stays the authority: a button enabled here is a
// request it can still refuse, and a button disabled here is one it would
// refuse. Nothing here reads a file or decides a match.
import { latinDigits } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import type {
  BankStatementResult,
  StatementCase,
} from './bank-statement-lifecycle.ts';
import {
  BANK_STATEMENT_LIFECYCLE_VERSION,
  BANK_STATEMENT_ROLL_VERSION,
  BANK_STATEMENT_SHEET_VERSION,
  SIGNOFF_NAME_LIMIT,
  isoDay,
  statementText,
  type BankStatementRollState,
  type BankStatementSheetState,
  type BankStatementState,
  type SheetInputs,
  type SheetSignoff,
  type StatementDecision,
  type StatementSource,
} from './bank-statement-request.ts';
import { BOOK_NOTE_LIMIT } from './bank-statement-sheet.ts';
import type { ReviewReason } from './bank-statement-match.ts';
import type { CarriedItem, CarriedReason } from './bank-statement-roll.ts';

export const BANK_STATEMENT_FORMATS = /\.(pdf|csv|xlsx)$/iu;
export const BANK_CASHBOOK_FORMATS = /\.(csv|xlsx)$/iu;
/** The currencies whose minor units are known offline. */
export const BANK_STATEMENT_CURRENCIES = [
  'SAR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'QAR',
  'EGP',
  'KWD',
  'BHD',
  'OMR',
  'JPY',
].filter((c) => currencyPrecision(c) !== undefined);

/** Review reasons the lifecycle accepts as they stand; for carried items,
 * the two the roll contract lets an accountant accept. */
const ACCEPTABLE: ReadonlySet<string> = new Set<ReviewReason | CarriedReason>([
  'amount-date-suggestion',
  'date-gap',
  'carried-reference',
  'carried-amount-suggestion',
]);

/** Which decisions the lifecycle would take on this case, given a note. */
export function statementActions(c: StatementCase, note: string) {
  const noted = !!note.trim();
  return {
    accept: noted && c.status === 'needs-review' && ACCEPTABLE.has(c.reason),
    reject: noted && c.decision === null,
    undo: noted && c.decision !== null,
  };
}

/** A decision on a case, with its exact members, in the result's context. */
export function statementDecision(
  result: BankStatementResult,
  c: StatementCase,
  type: StatementDecision['type'],
  note: string,
  id: string,
  at: string,
): StatementDecision {
  return {
    id,
    type,
    context: result.context,
    at,
    case: c.id,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    note: note.trim(),
  };
}

/** A state from the two sources, the scope and the decisions. */
export function statementState(
  statement: StatementSource,
  cashbook: StatementSource,
  scope: BankStatementState['scope'],
  decisions: StatementDecision[],
): BankStatementState {
  return {
    version: BANK_STATEMENT_LIFECYCLE_VERSION,
    files: [statement, cashbook],
    scope,
    decisions,
  };
}

/** A period that carries: the same, with the previous period's session file.
 * Only a printed statement carries (bank-statement-roll-1). */
export function rolledStatementState(
  statement: StatementSource,
  cashbook: StatementSource,
  decisions: StatementDecision[],
  previous: StatementSource,
): BankStatementRollState {
  return {
    version: BANK_STATEMENT_ROLL_VERSION,
    files: [statement, cashbook],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
    previous,
  };
}

/** A printed statement's period with its closing sheet
 * (bank-reconciliation-sheet-1, proposed): the period's own state, the
 * previous session file or none, and the sheet inputs. */
export function sheetStatementState(
  statement: StatementSource,
  cashbook: StatementSource,
  decisions: StatementDecision[],
  previous: StatementSource | null,
  sheet: SheetInputs,
): BankStatementSheetState {
  return {
    version: BANK_STATEMENT_SHEET_VERSION,
    files: [statement, cashbook],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
    previous,
    sheet,
  };
}

/**
 * The sheet inputs as typed, or what stops them: a book balance that is not
 * a plain amount in the statement currency's decimals, or a source note that
 * is too long, holds control characters or names no balance. An empty
 * balance is no balance: the sheet then says it needs one. Sign-offs given
 * before are kept; the replay judges them against the new content.
 */
export function sheetInputs(
  current: SheetInputs | null,
  balance: string,
  note: string,
  language: SheetInputs['language'],
  decimals: number,
): SheetInputs | 'book' | 'note' {
  const minor = balance.trim()
    ? parseStatementClosing(balance, decimals)
    : null;
  if (balance.trim() && minor === null) return 'book';
  const source = note.trim();
  if (
    source.length > BOOK_NOTE_LIMIT ||
    /[\p{Cc}\p{Cf}]/u.test(source) ||
    (source && minor === null)
  )
    return 'note';
  return {
    book: minor === null ? null : { balance: minor, note: source },
    language,
    prepared: current?.prepared ?? null,
    reviewed: current?.reviewed ?? null,
  };
}

/** A sign-off on the sheet now shown: the typed name and date, bound to its
 * fingerprint; none while there is no sheet or the name or date is not one
 * the session admits. */
export function sheetSignoff(
  result: BankStatementResult,
  name: string,
  date: string,
): SheetSignoff | null {
  const fingerprint = result.sheet?.fingerprint;
  const typed = name.trim();
  return fingerprint && statementText(typed, SIGNOFF_NAME_LIMIT) && isoDay(date)
    ? { name: typed, date, fingerprint }
    : null;
}

/** Where a carried item stands at this period's end: still carried, with
 * its age then, or held by a case that is not rejected. */
export function carriedAtEnd(
  result: BankStatementResult,
  item: CarriedItem,
): number | null {
  return result.roll?.outstanding.find((o) => o.key === item.key)?.age ?? null;
}

/**
 * A closing balance typed by the accountant, in minor units, or null when it
 * is not a plain amount in the currency's decimals. Arabic-Indic digits, the
 * Arabic decimal mark and thousands separators are read as written; nothing
 * is rounded or completed.
 */
export function parseStatementClosing(
  text: string,
  decimals: number,
): number | null {
  const s = latinDigits(text.trim())
    .replace(/٫/gu, '.')
    .replace(/[,٬\s]/gu, '');
  const m = new RegExp(
    `^(-?)(\\d+)${decimals ? `\\.(\\d{${decimals}})` : ''}$`,
    'u',
  ).exec(s);
  if (!m) return null;
  const value = Number(m[2] + (m[3] ?? ''));
  if (!Number.isSafeInteger(value)) return null;
  return m[1] ? -value : value;
}

export type HeldReason =
  | 'confirm-closing'
  | 'closing-differs'
  | 'no-period'
  | 'balance-broken'
  | 'incomplete-pages'
  | 'other';
/** The kind of a held statement's reason, and the printed detail to cite. */
export function heldReason(reason: string): {
  kind: HeldReason;
  detail: string;
} {
  if (reason === 'completeness-unproven: confirm the closing balance')
    return { kind: 'confirm-closing', detail: '' };
  // The file's own closing is not repeated: a confirmation must come from
  // the accountant's source, not from the file it confirms.
  if (/^confirmed closing -?\d+ != -?\d+$/u.test(reason))
    return { kind: 'closing-differs', detail: '' };
  if (reason === 'no statement period')
    return { kind: 'no-period', detail: '' };
  for (const kind of ['balance-broken', 'incomplete-pages'] as const)
    if (reason.startsWith(`${kind}: `))
      return { kind, detail: reason.slice(kind.length + 2) };
  return { kind: 'other', detail: reason };
}

export type StatementErrorKind =
  | 'statement-reading'
  | 'statement-layout'
  | 'statement-scope'
  | 'statement-line'
  | 'cashbook'
  | 'source-hash'
  | 'session'
  | 'scope-choice'
  | 'decision'
  | 'sheet'
  | 'other';
/** The kind of a refusal message from the worker. */
export function statementError(message: string): StatementErrorKind {
  if (/^BANK_SHEET_[A-Z]/u.test(message)) return 'sheet';
  const code = /^BANK_(STATEMENT|CASHBOOK)_([A-Z_]+)\b/u.exec(message);
  if (!code) return 'other';
  if (code[1] === 'CASHBOOK') return 'cashbook';
  switch (code[2]) {
    case 'READING':
      return 'statement-reading';
    case 'HEADER':
    case 'HEADING':
      return 'statement-layout';
    case 'SCOPE':
      return 'statement-scope';
    case 'LINE':
    case 'AMOUNT':
    case 'DATE':
    case 'COLUMN':
      return 'statement-line';
    case 'SOURCE_HASH':
      return 'source-hash';
    case 'SESSION':
      return 'session';
    case 'STATE_SCOPE':
      return 'scope-choice';
    case 'DECISION':
    case 'MEMBERS':
    case 'INELIGIBLE':
    case 'UNDO':
    case 'HELD':
      return 'decision';
    case 'SHEET':
      return 'sheet';
    default:
      return 'other';
  }
}

/** Which session a restored file holds, by its declared format alone. */
export function bankSessionFormat(
  buffer: ArrayBuffer,
): 'statement' | 'movements' | null {
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const format = (parsed as { format?: unknown }).format;
    return format === 'tarasuf-bank-statement-session'
      ? 'statement'
      : format === 'tarasuf-bank-session'
        ? 'movements'
        : null;
  } catch {
    return null;
  }
}

// Members by id, built once per result: a long statement has thousands.
const indexes = new WeakMap<
  BankStatementResult,
  {
    movements: Map<string, BankStatementResult['match']['movements'][number]>;
    cashbook: Map<string, BankStatementResult['match']['cashbook'][number]>;
  }
>();
function indexed(result: BankStatementResult) {
  let index = indexes.get(result);
  if (!index) {
    index = {
      movements: new Map(result.match.movements.map((m) => [m.id, m])),
      cashbook: new Map(result.match.cashbook.map((c) => [c.id, c])),
    };
    indexes.set(result, index);
  }
  return index;
}

/** A statement movement or cashbook entry, as the tables show a member. */
export function statementMember(
  result: BankStatementResult,
  side: 'statement' | 'cashbook',
  id: string,
) {
  if (side === 'statement') {
    const m = indexed(result).movements.get(id);
    return m
      ? {
          id,
          date: m.date,
          reference: m.reference,
          direction: m.direction,
          amount: m.amount,
          citation: `${m.page}:${m.items.join(' ')}`,
        }
      : null;
  }
  const c = indexed(result).cashbook.get(id);
  return c
    ? {
        id,
        date: c.date,
        reference: c.reference,
        direction: c.direction,
        amount: c.amount,
        citation: String(c.row),
      }
    : null;
}
