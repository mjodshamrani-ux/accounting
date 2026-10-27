// bank-statement-lifecycle-1, request part: the state a statement session
// keeps and its synchronous capture. Only the two original files, the scope
// the accountant chose and the accountant's decisions are state; every
// reading and match is recomputed from the original bytes on each replay.
// This module has no reader or workbook dependency, so the worker protocol
// and client can capture a request before anything yields.
import { cashbookColumnsOf } from './bank-cashbook-map.ts';
import type { CashbookColumns } from './bank-cashbook-map.ts';
import { currencyPrecision } from './currency-precision.ts';
import { bookBalance, type BookBalance } from './bank-statement-sheet.ts';
import { MAX_FILE_BYTES } from './types.ts';

export const BANK_STATEMENT_LIFECYCLE_VERSION = 'bank-statement-lifecycle-1';
/** The proposed roll format: a session that also keeps the previous
 * period's session file (audit/bank-roll-foundation/contract.json). */
export const BANK_STATEMENT_ROLL_VERSION = 'bank-statement-roll-1';
/** The proposed sheet format: a session, carrying or not, that also keeps
 * what the accountant entered for the closing reconciliation sheet
 * (audit/bank-sheet-foundation/contract.json). */
export const BANK_STATEMENT_SHEET_VERSION = 'bank-reconciliation-sheet-1';
export const BANK_STATEMENT_SESSION_FORMAT = 'tarasuf-bank-statement-session';
export const BANK_STATEMENT_SESSION_LIMIT = 32 * 1024 * 1024;
export const BANK_STATEMENT_EXPORT_LIMIT = 96 * 1024 * 1024;
export const BANK_STATEMENT_DECISION_LIMIT = 1000;

export type StatementSource = {
  name: string;
  sha256: string;
  original: ArrayBuffer;
  /** The cashbook only: the columns it is read with when its first row is
   * not the declared headers (bank-cashbook-map-1, proposed). Absent for
   * the declared reading. */
  columns?: CashbookColumns;
};
export type StatementScope = {
  /** A table statement's currency; null for a PDF, which prints its own. */
  currency: string | null;
  /** A table statement's period; null for a PDF, which prints its own. */
  period: { start: string; end: string } | null;
  /** A table statement's closing balance as the accountant confirmed it, in
   * minor units; only for a table that prints no closing balance. */
  confirmedClosing: number | null;
};
export type StatementDecision = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  /** The result context the decision was taken in. */
  context: string;
  /** Device time, UTC. */
  at: string;
  /** The case decided, with its exact members. */
  case: string;
  statement: string[];
  cashbook: string[];
  note: string;
};
/** A tolerance as the accountant declared it (bank-tolerance-1, proposed):
 * its three values as given. Whether they are a policy the contract admits
 * depends on the statement currency, so it is decided on replay. */
export type DeclaredTolerance = {
  perItem: number | string | boolean | null;
  perPeriod: number | string | boolean | null;
  note: number | string | boolean | null;
};
export type BankStatementState = {
  version: typeof BANK_STATEMENT_LIFECYCLE_VERSION;
  /** The statement (PDF, CSV or XLSX), then the cashbook (CSV or XLSX). */
  files: [StatementSource, StatementSource];
  scope: StatementScope;
  decisions: StatementDecision[];
  /** Absent when no tolerance is declared. */
  tolerance?: DeclaredTolerance;
};
/** A period that carries (bank-statement-roll-1, proposed): its own state
 * and the previous period's session file as it was saved. */
export type BankStatementRollState = Omit<BankStatementState, 'version'> & {
  version: typeof BANK_STATEMENT_ROLL_VERSION;
  previous: StatementSource;
};
/** A sign-off as the user typed it, with the fingerprint of the sheet it
 * was given on. Text only: not a digital signature or an identity check. */
export type SheetSignoff = { name: string; date: string; fingerprint: string };
export type SheetInputs = {
  book: BookBalance | null;
  language: 'ar' | 'en';
  prepared: SheetSignoff | null;
  reviewed: SheetSignoff | null;
};
/** A period with its closing sheet (bank-reconciliation-sheet-1, proposed):
 * its own state, the previous period's session file if it carries, and the
 * sheet inputs. */
export type BankStatementSheetState = Omit<BankStatementState, 'version'> & {
  version: typeof BANK_STATEMENT_SHEET_VERSION;
  previous: StatementSource | null;
  sheet: SheetInputs;
};
export type AnyStatementState =
  | BankStatementState
  | BankStatementRollState
  | BankStatementSheetState;
export type BankStatementExportRequest = {
  state: AnyStatementState;
  result: unknown;
};
export const SIGNOFF_NAME_LIMIT = 120;

export const STATEMENT_FILE = /\.(pdf|csv|xlsx)$/iu;
export const CASHBOOK_FILE = /\.(csv|xlsx)$/iu;

export const statementPlain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const statementKeys = (v: object, expected: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
/** An array with every index present and nothing beside them. */
export const denseArray = (v: unknown, limit: number): v is unknown[] =>
  Array.isArray(v) &&
  v.length <= limit &&
  statementKeys(
    v,
    Array.from({ length: v.length }, (_, i) => String(i)),
  );
export function fail(code: string): never {
  throw new Error(`BANK_STATEMENT_${code}`);
}
export function statementBytes(
  v: unknown,
  limit = MAX_FILE_BYTES,
  code = 'SOURCE',
): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > limit)
    fail(code);
}
/** Visible text without control or format characters. */
export function statementText(v: unknown, limit: number): v is string {
  return (
    typeof v === 'string' &&
    !!v.trim() &&
    v === v.trim() &&
    v.length <= limit &&
    !/[\p{Cc}\p{Cf}]/u.test(v)
  );
}
export const isoDay = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/u.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isoInstant = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;

/** The scope's own form; whether it fits the statement is checked on replay. */
function snapshotScope(scope: unknown): StatementScope {
  if (
    !statementPlain(scope) ||
    !statementKeys(scope, ['currency', 'period', 'confirmedClosing'])
  )
    fail('STATE_SCOPE');
  const { currency, period, confirmedClosing } = scope;
  if (
    currency !== null &&
    (typeof currency !== 'string' ||
      !/^[A-Z]{3}$/u.test(currency) ||
      currencyPrecision(currency) === undefined)
  )
    fail('STATE_SCOPE');
  if (
    period !== null &&
    (!statementPlain(period) ||
      !statementKeys(period, ['start', 'end']) ||
      !isoDay(period.start) ||
      !isoDay(period.end) ||
      period.start > period.end)
  )
    fail('STATE_SCOPE');
  if (
    confirmedClosing !== null &&
    (typeof confirmedClosing !== 'number' ||
      !Number.isSafeInteger(confirmedClosing))
  )
    fail('STATE_SCOPE');
  return {
    currency,
    period: period === null ? null : { start: period.start, end: period.end },
    confirmedClosing,
  } as StatementScope;
}
/** A decision's own form; its context and members are checked on replay. */
function snapshotDecision(e: unknown): StatementDecision {
  const ids = (v: unknown) =>
    denseArray(v, 1000) && v.every((id) => statementText(id, 200));
  if (
    !statementPlain(e) ||
    !statementKeys(e, [
      'id',
      'type',
      'context',
      'at',
      'case',
      'statement',
      'cashbook',
      'note',
    ]) ||
    !statementText(e.id, 200) ||
    !['accept', 'reject', 'undo'].includes(e.type as string) ||
    !statementText(e.context, 4096) ||
    !isoInstant(e.at) ||
    !statementText(e.case, 20) ||
    !ids(e.statement) ||
    !ids(e.cashbook) ||
    !statementText(e.note, 2000)
  )
    fail('DECISION');
  return {
    id: e.id,
    type: e.type as StatementDecision['type'],
    context: e.context,
    at: e.at,
    case: e.case,
    statement: [...(e.statement as string[])],
    cashbook: [...(e.cashbook as string[])],
    note: e.note,
  };
}
/** A declared tolerance's own form: exactly its three values, each a plain
 * value. Which rule they break, if any, is decided on replay. */
function snapshotTolerance(value: unknown): DeclaredTolerance {
  const plain = (v: unknown) =>
    v === null || ['number', 'string', 'boolean'].includes(typeof v);
  if (
    !statementPlain(value) ||
    !statementKeys(value, ['perItem', 'perPeriod', 'note']) ||
    !plain(value.perItem) ||
    !plain(value.perPeriod) ||
    !plain(value.note)
  )
    fail('INPUT');
  return {
    perItem: value.perItem as DeclaredTolerance['perItem'],
    perPeriod: value.perPeriod as DeclaredTolerance['perPeriod'],
    note: value.note as DeclaredTolerance['note'],
  };
}
/** Whether a state declares a tolerance, by its keys alone. */
const declares = (value: Record<string, unknown>) => 'tolerance' in value;
/** A state without its declared tolerance, the one optional member. */
const withoutTolerance = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'tolerance'));
/** Captures a state synchronously: the original bytes are copied, and no
 * reading, result or parsed cache is accepted beside them. */
export function snapshotBankStatementState(input: unknown): BankStatementState {
  const declared = statementPlain(input) && declares(input);
  const value = declared ? withoutTolerance(input) : input;
  if (
    !statementPlain(value) ||
    !statementKeys(value, ['version', 'files', 'scope', 'decisions']) ||
    value.version !== BANK_STATEMENT_LIFECYCLE_VERSION ||
    !denseArray(value.files, 2) ||
    value.files.length !== 2 ||
    !denseArray(value.decisions, BANK_STATEMENT_DECISION_LIMIT)
  )
    fail('INPUT');
  const files = value.files.map((f, i) => {
    // Columns are a reading choice of the cashbook, and of nothing else.
    const mapped = i === 1 && statementPlain(f) && 'columns' in f;
    if (
      !statementPlain(f) ||
      !statementKeys(f, [
        'name',
        'sha256',
        'original',
        ...(mapped ? ['columns'] : []),
      ]) ||
      !statementText(f.name, 255) ||
      !(i === 0 ? STATEMENT_FILE : CASHBOOK_FILE).test(f.name) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(f.sha256)
    )
      fail('SOURCE');
    statementBytes(f.original);
    if (mapped) {
      let columns: CashbookColumns;
      try {
        columns = cashbookColumnsOf(f.columns);
      } catch {
        fail('SOURCE_COLUMNS');
      }
      return {
        name: f.name,
        sha256: f.sha256,
        original: f.original.slice(0),
        columns,
      };
    }
    return { name: f.name, sha256: f.sha256, original: f.original.slice(0) };
  });
  return {
    version: BANK_STATEMENT_LIFECYCLE_VERSION,
    files: files as BankStatementState['files'],
    scope: snapshotScope(value.scope),
    decisions: value.decisions.map(snapshotDecision),
    ...(declared ? { tolerance: snapshotTolerance(input.tolerance) } : {}),
  };
}
/** Captures a roll state synchronously: the period's own state as above,
 * and the previous session file's name, fingerprint and copied bytes. */
export function snapshotRolledStatementState(
  value: unknown,
): BankStatementRollState {
  if (
    !statementPlain(value) ||
    !statementKeys(value, [
      'version',
      'files',
      'scope',
      'decisions',
      'previous',
      ...(declares(value) ? ['tolerance'] : []),
    ]) ||
    value.version !== BANK_STATEMENT_ROLL_VERSION
  )
    fail('INPUT');
  const { previous: p, ...own } = value;
  const state = snapshotBankStatementState({
    ...own,
    version: BANK_STATEMENT_LIFECYCLE_VERSION,
  });
  if (
    !statementPlain(p) ||
    !statementKeys(p, ['name', 'sha256', 'original']) ||
    !statementText(p.name, 255) ||
    typeof p.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(p.sha256)
  )
    fail('SOURCE');
  statementBytes(p.original, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  return {
    ...state,
    version: BANK_STATEMENT_ROLL_VERSION,
    previous: { name: p.name, sha256: p.sha256, original: p.original.slice(0) },
  };
}
/** The sheet inputs' own form; whether a sign-off still holds is decided on
 * replay, from the sheet's fingerprint. */
export function snapshotSheetInputs(value: unknown): SheetInputs {
  if (
    !statementPlain(value) ||
    !statementKeys(value, ['book', 'language', 'prepared', 'reviewed']) ||
    !['ar', 'en'].includes(value.language as string)
  )
    fail('SHEET');
  let book: BookBalance | null = null;
  if (value.book !== null)
    try {
      book = bookBalance(value.book);
    } catch {
      fail('SHEET');
    }
  const signoff = (v: unknown): SheetSignoff | null => {
    if (v === null) return null;
    if (
      !statementPlain(v) ||
      !statementKeys(v, ['name', 'date', 'fingerprint']) ||
      !statementText(v.name, SIGNOFF_NAME_LIMIT) ||
      !isoDay(v.date) ||
      typeof v.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(v.fingerprint)
    )
      fail('SHEET');
    return { name: v.name, date: v.date, fingerprint: v.fingerprint };
  };
  return {
    book,
    language: value.language as SheetInputs['language'],
    prepared: signoff(value.prepared),
    reviewed: signoff(value.reviewed),
  };
}
/** Captures a sheet state synchronously: the period's own state, the
 * previous session file if any, and the sheet inputs. */
export function snapshotSheetStatementState(
  value: unknown,
): BankStatementSheetState {
  if (
    !statementPlain(value) ||
    !statementKeys(value, [
      'version',
      'files',
      'scope',
      'decisions',
      'previous',
      'sheet',
      ...(declares(value) ? ['tolerance'] : []),
    ]) ||
    value.version !== BANK_STATEMENT_SHEET_VERSION
  )
    fail('INPUT');
  const { sheet, previous, ...own } = value;
  const state =
    previous === null
      ? snapshotBankStatementState({
          ...own,
          version: BANK_STATEMENT_LIFECYCLE_VERSION,
        })
      : snapshotRolledStatementState({
          ...own,
          version: BANK_STATEMENT_ROLL_VERSION,
          previous,
        });
  return {
    version: BANK_STATEMENT_SHEET_VERSION,
    files: state.files,
    scope: state.scope,
    decisions: state.decisions,
    previous: 'previous' in state ? state.previous : null,
    sheet: snapshotSheetInputs(sheet),
    ...(state.tolerance ? { tolerance: state.tolerance } : {}),
  };
}
/** Captures a state of any kind, by its declared version. */
export function snapshotAnyStatementState(value: unknown): AnyStatementState {
  if (statementPlain(value) && value.version === BANK_STATEMENT_SHEET_VERSION)
    return snapshotSheetStatementState(value);
  return statementPlain(value) && value.version === BANK_STATEMENT_ROLL_VERSION
    ? snapshotRolledStatementState(value)
    : snapshotBankStatementState(value);
}
/** Captures a worker request before anything yields. */
export function snapshotBankStatementRequest(
  action: string,
  payload: unknown,
): AnyStatementState | BankStatementExportRequest | { buffer: ArrayBuffer } {
  if (action === 'bank-statement-reconcile' || action === 'bank-statement-save')
    return snapshotAnyStatementState(payload);
  if (action === 'bank-statement-export') {
    if (
      !statementPlain(payload) ||
      !statementKeys(payload, ['state', 'result']) ||
      !statementPlain(payload.result)
    )
      fail('EXPORT_REQUEST');
    return {
      state: snapshotAnyStatementState(payload.state),
      result: structuredClone(payload.result),
    };
  }
  if (
    action !== 'bank-statement-restore' ||
    !statementPlain(payload) ||
    !statementKeys(payload, ['buffer'])
  )
    fail('ACTION');
  statementBytes(payload.buffer, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  return { buffer: payload.buffer.slice(0) };
}
/** Structural equality; original bytes are compared byte for byte. */
export function sameStatementData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (
      !(a instanceof ArrayBuffer) ||
      !(b instanceof ArrayBuffer) ||
      a.byteLength !== b.byteLength
    )
      return false;
    const right = new Uint8Array(b);
    return new Uint8Array(a).every((v, i) => v === right[i]);
  }
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      statementKeys(a, Object.keys(b)) &&
      a.every((v, i) => sameStatementData(v, b[i]))
    );
  return (
    statementPlain(a) &&
    statementPlain(b) &&
    statementKeys(a, Object.keys(b)) &&
    Object.entries(a).every(([k, v]) => sameStatementData(v, b[k]))
  );
}
