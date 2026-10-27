// bank-statement-lifecycle-1: a statement session kept as its original files,
// the scope the accountant chose and the accountant's decisions, and nothing
// else. Every replay re-reads both files from their bytes (the statement by
// bank-statement-native.ts, the cashbook by bank-statement-match.ts), checks
// their fingerprints and matches again; a saved session or a returned result
// is never taken as a reading.
//
// A decision names one case with its exact members and the context it was
// taken in: the files, the currency, the period, the confirmed closing and how
// completeness was proved. Change any of them and every decision is refused
// rather than moved to whatever the case ids mean now. An accountant may
// accept only a one-to-one review case whose values agree (an amount and date
// suggestion, or a date gap under one reference), may reject any undecided
// case, an automatic one included, and may undo a decision. A held statement
// takes no decisions.
import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { readNativePdfWordSource } from './pdf.ts';
import { validateExportText, excelExportText } from './export-text.ts';
import {
  BANK_STATEMENT_NATIVE,
  readBankStatementPdf,
  readBankStatementTable,
  type BankStatementReading,
} from './bank-statement-native.ts';
import {
  matchBankStatement,
  readBankCashbookTable,
  readMappedBankCashbook,
  type ReviewReason,
  type StatementMatchResult,
} from './bank-statement-match.ts';
import {
  CARRIED_ACCEPTABLE,
  carriedItems,
  clearCarried,
  refuse,
  rollContinuity,
  RollRefused,
  type CarriedClearing,
  type CarriedItem,
  type CarriedReason,
  type RollRefusal,
} from './bank-statement-roll.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  CASHBOOK_ROLES,
  cashbookColumnsUnread,
  columnLetters,
  type MappedColumn,
} from './bank-cashbook-map.ts';
import {
  BANK_SHEET_FAMILY as BANK_SHEET_FAMILY_NAME,
  reconciliationSheet,
  sheetFingerprint,
  type ReconciliationSheet,
  type SheetOutcome,
} from './bank-statement-sheet.ts';
import { bankSheetCopy } from '../i18n/bank-sheet.ts';
import {
  BANK_STATEMENT_SHEET_VERSION,
  snapshotSheetInputs,
  snapshotSheetStatementState,
  type AnyStatementState,
  type BankStatementSheetState,
  type SheetInputs,
} from './bank-statement-request.ts';
import {
  BANK_STATEMENT_EXPORT_LIMIT,
  BANK_STATEMENT_LIFECYCLE_VERSION,
  BANK_STATEMENT_ROLL_VERSION,
  BANK_STATEMENT_SESSION_FORMAT,
  BANK_STATEMENT_SESSION_LIMIT,
  fail,
  sameStatementData,
  snapshotBankStatementRequest,
  snapshotBankStatementState,
  snapshotRolledStatementState,
  snapshotAnyStatementState,
  statementBytes,
  statementKeys,
  statementPlain,
  statementText,
  type BankStatementExportRequest,
  type BankStatementRollState,
  type BankStatementState,
  type StatementDecision,
  type StatementScope,
  type StatementSource,
} from './bank-statement-request.ts';

export type StatementCaseStatus =
  | 'matched-automatic'
  | 'needs-review'
  | 'matched-accepted'
  | 'rejected';
export type StatementCase = {
  /** C1, C2, …: automatic pairs, then review groups, in the engine's order,
   * then, in a period that carries, carried cases in carried order. */
  id: string;
  kind: 'automatic' | 'review' | 'carried';
  reason: 'reference' | ReviewReason | CarriedReason;
  reference: string;
  statement: string[];
  cashbook: string[];
  /** A carried case's carried item keys, in carried order. */
  carried?: string[];
  status: StatementCaseStatus;
  /** The decision in effect, if any. */
  decision: string | null;
};
export type OutstandingItem = {
  side: 'statement' | 'cashbook';
  id: string;
  /** 'unmatched', or the rejected case that left it outstanding. */
  origin: string;
};
/** What a period that carries adds (bank-statement-roll-1, proposed). */
export type StatementRoll = {
  /** The previous period's session file, and whether it is carried. */
  previous: { name: string; sha256: string } & (
    | { status: 'accepted' }
    | { status: 'refused'; code: RollRefusal; detail: string }
  );
  /** The items carried in, each with its provenance and age. */
  carried: CarriedItem[];
  /** Current items a repetition holds in its case. */
  withheld: CarriedClearing['withheld'];
  /** Carried items still outstanding at this period's end, with their age
   * then: in no case, or in a rejected one. */
  outstanding: CarriedItem[];
};
/** A sign-off and whether the sheet is still the one it was given on. */
export type SheetSignoffStatus = {
  name: string;
  date: string;
  fingerprint: string;
  valid: boolean;
};
/** What a period with its closing sheet adds (bank-reconciliation-sheet-1,
 * proposed): the sheet or the refusal in its place, its fingerprint, the
 * language of its labels, and the sign-offs with their standing. */
export type StatementSheet = {
  outcome: SheetOutcome;
  fingerprint: string | null;
  language: SheetInputs['language'];
  prepared: SheetSignoffStatus | null;
  reviewed: SheetSignoffStatus | null;
};
export type BankStatementResult = {
  version:
    | typeof BANK_STATEMENT_LIFECYCLE_VERSION
    | typeof BANK_STATEMENT_ROLL_VERSION
    | typeof BANK_STATEMENT_SHEET_VERSION;
  context: string;
  /** held: nothing matched; needs-review: a case awaits the accountant;
   * reviewed: every case is automatic or decided. Outstanding items are
   * listed either way; none of these is a completed reconciliation. */
  status: 'held' | 'needs-review' | 'reviewed';
  sources: {
    role: 'statement' | 'cashbook';
    name: string;
    sha256: string;
    format: 'pdf' | 'csv' | 'xlsx';
  }[];
  scope: StatementScope;
  reading: BankStatementReading;
  match: StatementMatchResult;
  cases: StatementCase[];
  outstanding: OutstandingItem[];
  decisions: StatementDecision[];
  /** Present only in a period that carries. */
  roll?: StatementRoll;
  /** Present only in a period with its closing sheet. */
  sheet?: StatementSheet;
};
export type BankStatementReplay = {
  state: BankStatementState;
  result: BankStatementResult;
};
export type BankStatementRollReplay = {
  state: BankStatementRollState;
  result: BankStatementResult;
};
export type BankStatementSheetReplay = {
  state: BankStatementSheetState;
  result: BankStatementResult;
};

/** Review reasons an accountant may accept as they stand: one movement and
 * one entry with the same direction and amount; in a period that carries,
 * also the two carried reasons the contract names. */
const ACCEPTABLE: ReadonlySet<string> = new Set<ReviewReason | CarriedReason>([
  'amount-date-suggestion',
  'date-gap',
  ...CARRIED_ACCEPTABLE,
]);
const formatOf = (name: string) =>
  /\.pdf$/iu.test(name) ? 'pdf' : /\.csv$/iu.test(name) ? 'csv' : 'xlsx';
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** What two originals and a scope give before any decision. Frozen: every
 * result settled from it shares it, and none may change it. */
type StatementBase = {
  reading: BankStatementReading;
  match: StatementMatchResult;
  context: string;
  /** With columns (bank-cashbook-map-1): what the reading left out. */
  unread?: { above: number; unread: MappedColumn[] };
};
function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

/** Re-reads both originals, matches them, and applies the decisions. */
export async function replayBankStatement(
  input: unknown,
): Promise<BankStatementReplay> {
  const state = snapshotBankStatementState(input);
  return settleStatement(state, await readStatement(state));
}

/** Reads both originals from their bytes, checks both fingerprints and the
 * scope, and matches. */
let reads = 0;
/** How many times this thread has read a statement's originals. */
export const statementReads = () => reads;
async function readStatement(
  state: BankStatementState | BankStatementRollState,
): Promise<StatementBase> {
  reads++;
  const [statementFile, cashbookFile] = state.files;
  const { scope } = state;
  let reading: BankStatementReading;
  if (formatOf(statementFile.name) === 'pdf') {
    // A PDF prints its own currency and period; no scope may replace them,
    // and no confirmation stands in for its printed proof.
    if (
      scope.currency !== null ||
      scope.period !== null ||
      scope.confirmedClosing !== null
    )
      fail('STATE_SCOPE');
    const source = await readNativePdfWordSource(
      statementFile.original.slice(0),
    );
    if (source.sha256 !== statementFile.sha256) fail('SOURCE_HASH');
    reading = readBankStatementPdf(source);
  } else {
    if (scope.currency === null) fail('STATE_SCOPE');
    const file = await readFile(
      statementFile.name,
      statementFile.original.slice(0),
    );
    if (file.sha256 !== statementFile.sha256) fail('SOURCE_HASH');
    reading = readBankStatementTable(file, scope.currency);
    // A confirmation is only for a table that prints no closing balance.
    if (
      scope.confirmedClosing !== null &&
      reading.status !== 'completeness-unproven'
    )
      fail('STATE_SCOPE');
  }
  const cashbookSource = await readFile(
    cashbookFile.name,
    cashbookFile.original.slice(0),
  );
  if (cashbookSource.sha256 !== cashbookFile.sha256) fail('SOURCE_HASH');
  // Columns are re-proved from the bytes by the mapped reader itself.
  const { columns } = cashbookFile;
  const cashbook = columns
    ? readMappedBankCashbook(cashbookSource, reading.currency, columns)
    : readBankCashbookTable(cashbookSource, reading.currency);
  const match = matchBankStatement(reading, cashbook, {
    ...(scope.period ? { period: scope.period } : {}),
    ...(scope.confirmedClosing === null
      ? {}
      : { confirmedClosing: scope.confirmedClosing }),
  });
  const context = JSON.stringify([
    BANK_STATEMENT_LIFECYCLE_VERSION,
    BANK_STATEMENT_NATIVE,
    state.files.map((f) => f.sha256),
    reading.currency,
    match.statement.period,
    scope.confirmedClosing,
    match.statement.completeness,
    // A decision taken under other columns, or under the declared reading,
    // is refused; a session without columns keeps its context.
    ...(columns ? [columns] : []),
  ]);
  // With columns, the base also says what the reading left out.
  if (columns)
    return frozen({
      reading,
      match,
      context,
      unread: cashbookColumnsUnread(cashbookSource, columns),
    });
  return frozen({ reading, match, context });
}

/** What carrying adds to a period before any decision. */
type StatementCarry = {
  previous: StatementRoll['previous'];
  carried: CarriedItem[];
  clearing: CarriedClearing;
};
/** Applies the decisions to what the originals gave. Reads nothing. */
function settleStatement(
  state: BankStatementState,
  base: StatementBase,
): BankStatementReplay;
function settleStatement(
  state: BankStatementRollState,
  base: StatementBase,
  carry: StatementCarry,
): BankStatementRollReplay;
function settleStatement(
  state: BankStatementState | BankStatementRollState,
  base: StatementBase,
  carry?: StatementCarry,
): BankStatementReplay | BankStatementRollReplay {
  const { reading, match, context } = base;
  const { scope } = state;
  const cited = new Map<string, string>([
    ...match.movements.map((m) => [`S:${m.id}`, m.reference.trim()] as const),
    ...match.cashbook.map((e) => [`C:${e.id}`, e.reference.trim()] as const),
  ]);
  const carriedReference = new Map(
    carry?.carried.map((c) => [c.key, c.reference]),
  );
  const cases: StatementCase[] = [
    ...match.auto.map((a) => ({
      kind: 'automatic' as const,
      reason: 'reference' as const,
      reference: a.reference,
      statement: [a.statement],
      cashbook: [a.cashbook],
      status: 'matched-automatic' as const,
    })),
    ...match.review.map((g) => ({
      kind: 'review' as const,
      reason: g.reason,
      reference: g.reference ?? '',
      statement: [...g.statement],
      cashbook: [...g.cashbook],
      status: 'needs-review' as const,
    })),
    // The reference a carried case shows is its one carried item's, when
    // every current member cites it too.
    ...(carry?.clearing.cases ?? []).map((g) => {
      const reference =
        g.carried.length === 1 ? carriedReference.get(g.carried[0])! : '';
      const members = [
        ...g.statement.map((id) => `S:${id}`),
        ...g.cashbook.map((id) => `C:${id}`),
      ];
      return {
        kind: 'carried' as const,
        reason: g.reason,
        reference:
          reference && members.every((k) => cited.get(k) === reference)
            ? reference
            : '',
        statement: [...g.statement],
        cashbook: [...g.cashbook],
        carried: [...g.carried],
        status: 'needs-review' as const,
      };
    }),
  ].map((c, i): StatementCase => ({ id: `C${i + 1}`, ...c, decision: null }));
  if (match.held && state.decisions.length) fail('HELD');
  const byId = new Map(cases.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const e of state.decisions) {
    if (e.context !== context || seen.has(e.id)) fail('DECISION');
    seen.add(e.id);
    const c = byId.get(e.case);
    if (
      !c ||
      !sameIds(c.statement, e.statement) ||
      !sameIds(c.cashbook, e.cashbook)
    )
      fail('MEMBERS');
    if (e.type === 'accept') {
      if (c.status !== 'needs-review' || !ACCEPTABLE.has(c.reason))
        fail('INELIGIBLE');
      c.status = 'matched-accepted';
      c.decision = e.id;
    } else if (e.type === 'reject') {
      if (c.decision !== null) fail('INELIGIBLE');
      c.status = 'rejected';
      c.decision = e.id;
    } else {
      if (c.decision === null) fail('UNDO');
      c.status = c.kind === 'automatic' ? 'matched-automatic' : 'needs-review';
      c.decision = null;
    }
  }

  const origin = new Map<string, string>();
  for (const id of match.statementOnly) origin.set(`S:${id}`, 'unmatched');
  for (const id of match.cashbookOnly) origin.set(`C:${id}`, 'unmatched');
  // A current item in a carried case is not outstanding unless the case is
  // rejected, as a member of any review case is not.
  for (const c of cases)
    if (c.kind === 'carried' && c.status !== 'rejected') {
      for (const id of c.statement) origin.delete(`S:${id}`);
      for (const id of c.cashbook) origin.delete(`C:${id}`);
    }
  for (const c of cases)
    if (c.status === 'rejected') {
      for (const id of c.statement) origin.set(`S:${id}`, c.id);
      for (const id of c.cashbook) origin.set(`C:${id}`, c.id);
    }
  const outstanding: OutstandingItem[] = [
    ...match.movements.flatMap((m) => {
      const o = origin.get(`S:${m.id}`);
      return o ? [{ side: 'statement' as const, id: m.id, origin: o }] : [];
    }),
    ...match.cashbook.flatMap((c) => {
      const o = origin.get(`C:${c.id}`);
      return o ? [{ side: 'cashbook' as const, id: c.id, origin: o }] : [];
    }),
  ];
  // A carried item stays carried, one period older, unless its case is
  // undecided or accepted.
  const held = new Set(
    cases.flatMap((c) =>
      c.kind === 'carried' && c.status !== 'rejected' ? c.carried! : [],
    ),
  );
  const roll: StatementRoll | undefined = carry && {
    previous: carry.previous,
    carried: carry.carried,
    withheld: carry.clearing.withheld,
    outstanding: carry.carried
      .filter((c) => !held.has(c.key))
      .map((c) => ({ ...c, age: c.age + 1 })),
  };
  return {
    state,
    result: {
      version: state.version,
      context,
      status: match.held
        ? 'held'
        : cases.some((c) => c.status === 'needs-review')
          ? 'needs-review'
          : 'reviewed',
      sources: state.files.map((f, i) => ({
        role: i === 0 ? ('statement' as const) : ('cashbook' as const),
        name: f.name,
        sha256: f.sha256,
        format: formatOf(f.name),
        ...(f.columns
          ? { columns: structuredClone(f.columns), ...base.unread }
          : {}),
      })),
      scope: structuredClone(scope),
      reading,
      match,
      cases,
      outstanding,
      decisions: structuredClone(state.decisions),
      ...(roll ? { roll } : {}),
    },
  } as BankStatementReplay | BankStatementRollReplay;
}

/**
 * This thread's own reading of the last originals it verified. A later
 * request with the same names, fingerprints, bytes (compared byte for byte)
 * and scope gives the same reading, so its decisions are settled on it
 * without reading the PDF again; anything else is read from its bytes.
 */
let verified: {
  files: StatementSource[];
  scope: string;
  base: StatementBase;
} | null = null;
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  return x.every((v, i) => v === y[i]);
};
export async function replayVerified(
  input: unknown,
): Promise<BankStatementReplay> {
  const state = snapshotBankStatementState(input);
  const scope = JSON.stringify(state.scope);
  const v = verified;
  if (
    v &&
    v.scope === scope &&
    v.files.every(
      (f, i) =>
        f.name === state.files[i].name &&
        JSON.stringify(f.columns ?? null) ===
          JSON.stringify(state.files[i].columns ?? null) &&
        f.sha256 === state.files[i].sha256 &&
        sameBytes(f.original, state.files[i].original),
    )
  )
    return settleStatement(state, v.base);
  const base = await readStatement(state);
  verified = {
    files: state.files.map((f) => ({ ...f, original: f.original.slice(0) })),
    scope,
    base,
  };
  return settleStatement(state, base);
}

function encode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer),
    parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(parts.join(''));
}
function decode(value: unknown, limit = MAX_FILE_BYTES) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(limit / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  )
    fail('SESSION');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  statementBytes(bytes, limit, 'SESSION');
  if (encode(bytes) !== value) fail('SESSION');
  return bytes;
}

/** Only the originals, the scope and the decisions are saved; the session is
 * restored before it is returned, and must give the same result. */
export async function saveBankStatement(input: unknown): Promise<ArrayBuffer> {
  const replay = await replayBankStatement(input);
  const { state } = replay;
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: BANK_STATEMENT_SESSION_FORMAT,
      version: BANK_STATEMENT_LIFECYCLE_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original),
        ...(f.columns ? { columns: f.columns } : {}),
      })),
      scope: state.scope,
      decisions: state.decisions,
    }),
  ).buffer;
  statementBytes(session, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  if (!sameStatementData(await restoreBankStatement(session), replay))
    fail('SESSION');
  return session;
}

export async function restoreBankStatement(
  session: ArrayBuffer,
  replay: (
    input: unknown,
  ) => Promise<BankStatementReplay> = replayBankStatement,
): Promise<BankStatementReplay> {
  return replay(sessionState(session));
}

/** The state a session file holds: its originals, scope and decisions. A
 * session in the proposed roll format is not restored here. */
function sessionState(session: ArrayBuffer): BankStatementState {
  const { state, previous, sheet } = statementSessionParts(session);
  if (previous || sheet) fail('SESSION');
  return state;
}

/** What a session file holds: its originals, scope and decisions, and, in the
 * proposed roll format (bank-statement-roll-1), the previous period's session
 * file as it was saved, unread. Its fingerprint is checked by its reader. */
export function statementSessionParts(session: ArrayBuffer): {
  state: BankStatementState;
  previous: StatementSource | null;
  sheet: SheetInputs | null;
} {
  statementBytes(session, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(session.slice(0)),
    );
  } catch {
    fail('SESSION');
  }
  const roll =
    statementPlain(parsed) && parsed.version === BANK_STATEMENT_ROLL_VERSION;
  // The proposed sheet format: `previous` is null or the previous session
  // file, and `sheet` holds the sheet inputs.
  const withSheet =
    statementPlain(parsed) && parsed.version === BANK_STATEMENT_SHEET_VERSION;
  if (
    !statementPlain(parsed) ||
    !statementKeys(parsed, [
      'format',
      'version',
      'files',
      'scope',
      'decisions',
      ...(roll || withSheet ? ['previous'] : []),
      ...(withSheet ? ['sheet'] : []),
    ]) ||
    parsed.format !== BANK_STATEMENT_SESSION_FORMAT ||
    (parsed.version !== BANK_STATEMENT_LIFECYCLE_VERSION &&
      !roll &&
      !withSheet) ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 2
  )
    fail('SESSION');
  const files = parsed.files.map((f, i) => {
    // The cashbook may carry the columns it is read with; the snapshot
    // checks their form, and the replay proves them from the bytes.
    const mapped = i === 1 && statementPlain(f) && 'columns' in f;
    const keys = ['name', 'sha256', 'data', ...(mapped ? ['columns'] : [])];
    if (!statementPlain(f) || !statementKeys(f, keys)) fail('SESSION');
    return {
      name: f.name,
      sha256: f.sha256,
      original: decode(f.data),
      ...(mapped ? { columns: f.columns } : {}),
    };
  });
  let previous: StatementSource | null = null;
  if (roll || (withSheet && parsed.previous !== null)) {
    const p = parsed.previous;
    if (
      !statementPlain(p) ||
      !statementKeys(p, ['name', 'sha256', 'data']) ||
      !statementText(p.name, 255) ||
      typeof p.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(p.sha256)
    )
      fail('SESSION');
    previous = {
      name: p.name,
      sha256: p.sha256,
      original: decode(p.data, BANK_STATEMENT_SESSION_LIMIT),
    };
  }
  return {
    state: snapshotBankStatementState({
      version: BANK_STATEMENT_LIFECYCLE_VERSION,
      files,
      scope: parsed.scope,
      decisions: parsed.decisions,
    }),
    previous,
    sheet: withSheet ? snapshotSheetInputs(parsed.sheet) : null,
  };
}

async function digest(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A previous period's session file as the product reads it: replayed from
 * its own originals as any restore is, then its items outstanding at its end
 * with their age. Refuses with a roll code (RollRefused). */
async function closedPeriod(
  session: ArrayBuffer,
): Promise<{ result: BankStatementResult; left: CarriedItem[] }> {
  let result: BankStatementResult;
  try {
    const { state, previous } = statementSessionParts(session);
    // Only a printed statement carries: it states its own currency, period,
    // closing and opening, which no scope replaces.
    if (Object.values(state.scope).some((v) => v !== null)) fail('STATE_SCOPE');
    ({ result } = previous
      ? await replayRolledStatement({
          ...state,
          version: BANK_STATEMENT_ROLL_VERSION,
          previous,
        })
      : await replayBankStatement(state));
  } catch (error) {
    return refuse('ROLL_PREVIOUS_UNREADABLE', messageOf(error));
  }
  if (result.status === 'held')
    refuse('ROLL_PREVIOUS_HELD', result.match.held?.reason);
  if (result.status !== 'reviewed') refuse('ROLL_PREVIOUS_UNDECIDED');
  // The chain: a period that could not carry its own previous period is not
  // one the product can read as closed.
  const before = result.roll?.previous;
  if (before?.status === 'refused')
    refuse(
      'ROLL_PREVIOUS_UNREADABLE',
      `its previous period: ${before.code}${before.detail ? `: ${before.detail}` : ''}`,
    );
  return {
    result,
    left: [
      ...carriedItems(result, await digest(session)),
      ...(result.roll?.outstanding ?? []),
    ],
  };
}

/** A period that carries: its own originals read as replayBankStatement
 * reads them, the previous session file read as closedPeriod reads it, the
 * carried items cleared by the contract's order, and the decisions applied.
 * Every decision is bound to the previous file too (R6). */
export async function replayRolledStatement(
  input: unknown,
): Promise<BankStatementRollReplay> {
  const state = snapshotRolledStatementState(input);
  const base = await readStatement(state);
  const { previous: file, scope } = state;
  if ((await digest(file.original)) !== file.sha256) fail('SOURCE_HASH');
  let previous: StatementRoll['previous'];
  let carried: CarriedItem[] = [];
  try {
    const closed = await closedPeriod(file.original.slice(0));
    const problem = rollContinuity(closed.result, base);
    if (problem) refuse(problem);
    carried = closed.left;
    previous = { name: file.name, sha256: file.sha256, status: 'accepted' };
  } catch (error) {
    if (!(error instanceof RollRefused)) throw error;
    previous = {
      name: file.name,
      sha256: file.sha256,
      status: 'refused',
      code: error.code,
      detail: error.detail,
    };
  }
  const clearing = clearCarried(carried, base.reading, base.match.cashbook, {
    ...(scope.period ? { period: scope.period } : {}),
    ...(scope.confirmedClosing === null
      ? {}
      : { confirmedClosing: scope.confirmedClosing }),
  });
  const context = JSON.stringify([
    BANK_STATEMENT_ROLL_VERSION,
    BANK_STATEMENT_NATIVE,
    state.files.map((source) => source.sha256),
    base.reading.currency,
    clearing.match.statement.period,
    scope.confirmedClosing,
    clearing.match.statement.completeness,
    file.sha256,
  ]);
  return settleStatement(
    state,
    frozen({ reading: base.reading, match: clearing.match, context }),
    frozen({ previous, carried, clearing }),
  );
}

/** A period that carries is saved with its previous session file, byte for
 * byte, and restored before it is returned. */
export async function saveRolledStatement(
  input: unknown,
): Promise<ArrayBuffer> {
  const replay = await replayRolledStatement(input);
  const { state } = replay;
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: BANK_STATEMENT_SESSION_FORMAT,
      version: BANK_STATEMENT_ROLL_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original),
        ...(f.columns ? { columns: f.columns } : {}),
      })),
      scope: state.scope,
      decisions: [...state.decisions],
      previous: {
        name: state.previous.name,
        sha256: state.previous.sha256,
        data: encode(state.previous.original),
      },
    }),
  ).buffer;
  statementBytes(session, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  if (!sameStatementData(await restoreRolledStatement(session), replay))
    fail('SESSION');
  return session;
}

export async function restoreRolledStatement(
  session: ArrayBuffer,
): Promise<BankStatementRollReplay> {
  const { state, previous, sheet } = statementSessionParts(session);
  if (!previous || sheet) fail('SESSION');
  return replayRolledStatement({
    ...state,
    version: BANK_STATEMENT_ROLL_VERSION,
    previous,
  });
}

/** A period with its closing sheet (bank-reconciliation-sheet-1, proposed):
 * the period replayed as it is, carrying or not, then the sheet built from
 * its result and the declared book balance. A sign-off holds only while the
 * sheet's fingerprint is the one it was given on. Decisions keep the context
 * of the period they were taken in, so entering the sheet does not move them. */
export async function replaySheetStatement(
  input: unknown,
): Promise<BankStatementSheetReplay> {
  const state = snapshotSheetStatementState(input);
  const { sheet, previous } = state;
  const own = { files: state.files, scope: state.scope, decisions: state.decisions };
  const { result } = previous
    ? await replayRolledStatement({
        ...own,
        version: BANK_STATEMENT_ROLL_VERSION,
        previous,
      })
    : await replayBankStatement({
        ...own,
        version: BANK_STATEMENT_LIFECYCLE_VERSION,
      });
  const outcome = reconciliationSheet(result, sheet.book);
  const fingerprint = outcome.refusal
    ? null
    : await sheetFingerprint(outcome.sheet);
  const standing = (s: SheetInputs['prepared']) =>
    s && { ...s, valid: fingerprint !== null && s.fingerprint === fingerprint };
  return {
    state,
    result: frozen({
      ...result,
      version: BANK_STATEMENT_SHEET_VERSION,
      sheet: {
        outcome,
        fingerprint,
        language: sheet.language,
        prepared: standing(sheet.prepared),
        reviewed: standing(sheet.reviewed),
      },
    }),
  };
}

/** A period with its sheet is saved with its originals, scope, decisions,
 * previous session file (or null) and sheet inputs, and restored before it
 * is returned. */
export async function saveSheetStatement(
  input: unknown,
): Promise<ArrayBuffer> {
  const replay = await replaySheetStatement(input);
  const { state } = replay;
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: BANK_STATEMENT_SESSION_FORMAT,
      version: BANK_STATEMENT_SHEET_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original),
        ...(f.columns ? { columns: f.columns } : {}),
      })),
      scope: state.scope,
      decisions: [...state.decisions],
      previous: state.previous && {
        name: state.previous.name,
        sha256: state.previous.sha256,
        data: encode(state.previous.original),
      },
      sheet: state.sheet,
    }),
  ).buffer;
  statementBytes(session, BANK_STATEMENT_SESSION_LIMIT, 'SESSION');
  if (!sameStatementData(await restoreSheetStatement(session), replay))
    fail('SESSION');
  return session;
}

export async function restoreSheetStatement(
  session: ArrayBuffer,
): Promise<BankStatementSheetReplay> {
  const { state, previous, sheet } = statementSessionParts(session);
  if (!sheet) fail('SESSION');
  return replaySheetStatement({
    ...state,
    version: BANK_STATEMENT_SHEET_VERSION,
    previous,
    sheet,
  });
}

/** The workbook cites every value: statement lines by page and PDF.js text
 * item (or table row), cashbook entries by row, and carries both originals;
 * in a period that carries, also every carried item with its provenance, the
 * carried cases' members and the previous session file. */
export async function exportBankStatement(
  input: unknown,
  expected: unknown,
  replay: (
    input: unknown,
  ) => Promise<
    BankStatementReplay | BankStatementRollReplay | BankStatementSheetReplay
  > = replayBankStatement,
): Promise<ArrayBuffer> {
  const { state, result } = await replay(input);
  if (!sameStatementData(result, expected)) fail('STALE_RESULT');
  const { reading, match } = result;
  const book = new ExcelJS.Workbook();
  book.creator = 'Tarasuf';
  if (result.sheet) reconciliationWorksheet(book, result.sheet);
  function table(name: string, headers: string[], rows: (string | number)[][]) {
    for (const row of [headers, ...rows])
      for (const value of row)
        validateExportText(value, 'BANK_STATEMENT_EXPORT_CELL');
    const s = book.addWorksheet(name);
    s.addRow(headers.map(excelExportText));
    s.addRows(rows.map((row) => row.map(excelExportText)));
    s.views = [{ state: 'frozen', ySplit: 1 }];
    s.getRow(1).font = { bold: true };
    s.columns.forEach((c) => {
      c.width = 24;
    });
  }
  const movementId = new Map<number, string>();
  {
    let n = 0;
    for (const [i, l] of reading.lines.entries())
      if (l.kind === 'movement') movementId.set(i, `S${++n}`);
  }
  const movements = new Map(match.movements.map((m) => [m.id, m]));
  const entries = new Map(match.cashbook.map((c) => [c.id, c]));
  /** Where a member is printed: [page or row, cited items, date, direction, amount]. */
  const cite = (side: 'statement' | 'cashbook', id: string) => {
    if (side === 'statement') {
      const m = movements.get(id)!;
      return [m.page, m.items.join(' '), m.date, m.direction, m.amount];
    }
    const c = entries.get(id)!;
    return [c.row, '', c.date, c.direction, c.amount];
  };
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'bank-statement-cashbook'],
      ['Lifecycle', result.version],
      ['Family', BANK_STATEMENT_NATIVE],
      ['Status', result.status],
      ['Held reason', match.held?.reason ?? ''],
      ['Statement status', reading.status],
      ['Statement reason', reading.reason ?? ''],
      ['Completeness', match.statement.completeness],
      ['Format', reading.format],
      ['Layout', reading.layout],
      ['Currency', reading.currency],
      ['Decimals', reading.decimals],
      ['Period start', match.statement.period?.start ?? ''],
      ['Period end', match.statement.period?.end ?? ''],
      ['Confirmed closing minor units', result.scope.confirmedClosing ?? ''],
      ['Opening minor units', reading.opening ?? ''],
      ['Closing minor units', reading.closing ?? ''],
      ['Withdrawals minor units', reading.withdrawals],
      ['Deposits minor units', reading.deposits],
      ['Date window days', match.policy.dateWindowDays],
      ['Heading', reading.heading],
      ['Context', result.context],
      [
        'Claim',
        result.sheet
          ? 'Statement-to-cashbook movement matching, and the closing reconciliation sheet first in this workbook: the bank balance proved from the printed statement, the book balance declared by the accountant, every item not cleared listed alone. Completeness of the books, fee or currency inference, ERP posting and source authenticity are not claimed'
          : 'Statement-to-cashbook movement matching only. Completeness rests on printed page numbers with a closing balance, or on a closing balance the accountant confirmed; no balance bridge, fee or currency inference, ERP posting or source authenticity assurance',
      ],
    ],
  );
  table(
    'Statement lines',
    [
      'Line',
      'Kind',
      'Page',
      'Cited items',
      'Movement ID',
      'Date',
      'Value date',
      'Description',
      'Reference',
      'Withdrawal minor units',
      'Deposit minor units',
      'Balance minor units',
      'Text',
    ],
    reading.lines.map((l, i) => [
      i + 1,
      l.kind,
      l.page,
      l.items.join(' '),
      movementId.get(i) ?? '',
      l.date ?? '',
      l.valueDate ?? '',
      l.description ?? '',
      l.reference ?? '',
      l.withdrawal ?? '',
      l.deposit ?? '',
      l.balance ?? '',
      l.text ?? '',
    ]),
  );
  table(
    'Pages',
    ['Physical page', 'Printed page', 'Of'],
    reading.pages.map((p) => [p.page, p.number, p.of]),
  );
  table(
    'Cashbook',
    [
      'Voucher',
      'Source row',
      'Date',
      'Description',
      'Reference',
      'Direction',
      'Amount minor units',
    ],
    match.cashbook.map((c) => [
      c.id,
      c.row,
      c.date,
      c.description,
      c.reference,
      c.direction,
      c.amount,
    ]),
  );
  // The columns the cashbook was read with, when not the declared ones
  // (bank-cashbook-map-1): the header row, each role's column and label,
  // and what the reading left out.
  const mapped = state.files[1].columns;
  const left = result.sources[1] as {
    above?: number;
    unread?: MappedColumn[];
  };
  if (mapped)
    table(
      'Cashbook columns',
      ['Item', 'Column', 'Label'],
      [
        ['header row', mapped.header, ''],
        ...CASHBOOK_ROLES.map((role) => {
          const c = mapped.columns[role];
          return [role, c ? columnLetters(c.column) : '', c?.label ?? ''];
        }),
        ['rows above the header', left.above ?? 0, ''],
        ...(left.unread ?? []).map((c) => [
          'not read',
          columnLetters(c.column),
          c.label,
        ]),
      ],
    );
  table(
    'Cases',
    [
      'Case ID',
      'Kind',
      'Reason',
      'Reference',
      'Status',
      'Decision',
      'Statement IDs',
      'Cashbook IDs',
    ],
    result.cases.map((c) => [
      c.id,
      c.kind,
      c.reason,
      c.reference,
      c.status,
      c.decision ?? '',
      c.statement.join(' '),
      c.cashbook.join(' '),
    ]),
  );
  table(
    'Case members',
    [
      'Case ID',
      'Side',
      'Member ID',
      'Page or row',
      'Cited items',
      'Date',
      'Direction',
      'Amount minor units',
    ],
    result.cases.flatMap((c) => [
      ...c.statement.map((id) => [
        c.id,
        'statement',
        id,
        ...cite('statement', id),
      ]),
      ...c.cashbook.map((id) => [
        c.id,
        'cashbook',
        id,
        ...cite('cashbook', id),
      ]),
    ]),
  );
  table(
    'Outstanding',
    [
      'Side',
      'ID',
      'Origin',
      'Page or row',
      'Cited items',
      'Date',
      'Direction',
      'Amount minor units',
    ],
    result.outstanding.map((o) => [
      o.side,
      o.id,
      o.origin,
      ...cite(o.side, o.id),
    ]),
  );
  table(
    'Timing',
    [
      'Movement ID',
      'Page',
      'Cited items',
      'Date',
      'Value date',
      'Period start',
      'Period end',
    ],
    match.timing.map((id) => {
      const m = movements.get(id)!;
      return [
        id,
        m.page,
        m.items.join(' '),
        m.date,
        m.valueDate,
        match.statement.period?.start ?? '',
        match.statement.period?.end ?? '',
      ];
    }),
  );
  table(
    'Decisions',
    ['Index', 'Decision', 'Type', 'Case', 'Context', 'Device UTC', 'Note'],
    result.decisions.map((e, i) => [
      i + 1,
      e.id,
      e.type,
      e.case,
      e.context,
      e.at,
      e.note,
    ]),
  );
  table(
    'Decision members',
    ['Decision', 'Side', 'Member ID'],
    result.decisions.flatMap((e) => [
      ...e.statement.map((id) => [e.id, 'statement', id]),
      ...e.cashbook.map((id) => [e.id, 'cashbook', id]),
    ]),
  );
  const { roll } = result;
  if (roll) {
    table(
      'Previous period',
      ['Property', 'Value'],
      [
        ['Name', roll.previous.name],
        ['SHA256', roll.previous.sha256],
        ['Status', roll.previous.status],
        ['Code', roll.previous.status === 'refused' ? roll.previous.code : ''],
        [
          'Detail',
          roll.previous.status === 'refused' ? roll.previous.detail : '',
        ],
        [
          'Claim',
          'Carried items are candidate evidence from a closed previous period, re-read from its session file; none is cleared automatically, and no write-off, balance bridge or timing classification is made',
        ],
      ],
    );
    const left = new Map(roll.outstanding.map((c) => [c.key, c.age]));
    table(
      'Carried items',
      [
        'Key',
        'Side',
        'ID',
        'Period start',
        'Period end',
        'Page or row',
        'Date',
        'Direction',
        'Amount minor units',
        'Reference',
        'Origin',
        'Age',
        'Source SHA256',
        'Session SHA256',
        'Outstanding at period end',
        'Age at period end',
      ],
      roll.carried.map((c) => [
        c.key,
        c.side,
        c.id,
        c.period.start,
        c.period.end,
        (c.page ?? c.row)!,
        c.date,
        c.direction,
        c.amount,
        c.reference,
        c.origin,
        c.age,
        c.source,
        c.session,
        left.has(c.key) ? 'yes' : 'no',
        left.get(c.key) ?? '',
      ]),
    );
    table(
      'Carried case members',
      ['Case ID', 'Carried key'],
      result.cases.flatMap((c) => (c.carried ?? []).map((k) => [c.id, k])),
    );
    table('Withheld', ['Side', 'ID'], [
      ...roll.withheld.statement.map((id) => ['statement', id]),
      ...roll.withheld.cashbook.map((id) => ['cashbook', id]),
    ]);
  }
  const chunks: (string | number)[][] = [];
  const originals = [
    ...state.files,
    ...('previous' in state && state.previous ? [state.previous] : []),
  ];
  for (const [i, f] of originals.entries()) {
    const data = encode(f.original);
    for (let at = 0; at < data.length; at += 30000)
      chunks.push([
        (['statement', 'cashbook', 'previous'] as const)[i],
        f.name,
        f.sha256,
        at / 30000,
        data.slice(at, at + 30000),
      ]);
  }
  table('Sources', ['Role', 'Name', 'SHA256', 'Chunk index', 'Base64'], chunks);
  const workbook = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  statementBytes(workbook, BANK_STATEMENT_EXPORT_LIMIT, 'EXPORT');
  return workbook;
}

/** Minor units as text in major units at the currency's precision, with a
 * leading minus for a negative amount and no grouping. */
function majorText(minor: number, decimals: number) {
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  return decimals
    ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : `${sign}${digits}`;
}

/** The reconciliation sheet, first in the workbook. Column A holds a fixed
 * English key for each row so the sheet reads the same in either language;
 * column B the label in the sheet's language; the values follow. No
 * formulas: every figure is stored as computed. */
function reconciliationWorksheet(book: ExcelJS.Workbook, s: StatementSheet) {
  const copy = bankSheetCopy[s.language];
  const rows: (string | number)[][] = [
    ['family', copy.title, BANK_SHEET_FAMILY_NAME],
  ];
  const { outcome } = s;
  if (outcome.refusal)
    rows.push([
      'refusal',
      copy.labels.refusal,
      copy.refusals[outcome.refusal],
      outcome.refusal,
    ]);
  else {
    const sheet: ReconciliationSheet = outcome.sheet;
    const money = (minor: number) => [majorText(minor, sheet.decimals), minor];
    rows.push(
      ['status', copy.labels.status, copy.status[sheet.status], sheet.status],
      ['currency', copy.labels.currency, sheet.currency],
      ['period', copy.labels.period, sheet.period.start, sheet.period.end],
      [
        'bank',
        copy.bank,
        ...money(sheet.bank.balance),
        copy.bankSource(sheet.bank.page),
      ],
      ['book', copy.book, ...money(sheet.book.balance), copy.bookSource],
      ['note', copy.bookNote, sheet.book.note],
      ['headers', ...copy.itemHeaders],
    );
    for (const [name, section] of Object.entries(sheet.sections)) {
      rows.push([
        'section',
        copy.sections[name as keyof typeof copy.sections],
        ...money(section.total),
        name,
      ]);
      for (const i of section.items)
        rows.push([
          'item',
          copy.sides[i.side],
          i.id,
          `${i.period.start}/${i.period.end}`,
          (i.page ?? i.row)!,
          i.date,
          i.reference,
          ...money(i.amount),
          copy.origins[i.origin],
          i.origin,
          i.case ?? '',
          i.reason ?? '',
          i.age ?? '',
          i.source,
        ]);
    }
    rows.push(
      ['adjustedBank', copy.adjustedBank, ...money(sheet.adjustedBank)],
      ['adjustedBook', copy.adjustedBook, ...money(sheet.adjustedBook)],
      ['difference', copy.difference, ...money(sheet.difference)],
    );
  }
  for (const kind of ['prepared', 'reviewed'] as const) {
    const signoff = s[kind];
    if (signoff)
      rows.push([
        kind,
        copy[kind],
        signoff.name,
        signoff.date,
        signoff.valid ? '' : copy.signoffVoid,
        signoff.valid ? 'valid' : 'void',
      ]);
  }
  rows.push(['claim', copy.labels.claim, copy.claim]);
  for (const row of rows)
    for (const value of row) validateExportText(value, 'BANK_SHEET_EXPORT_CELL');
  const ws = book.addWorksheet(copy.sheetName);
  ws.addRows(rows.map((row) => row.map(excelExportText)));
  ws.views = [{ rightToLeft: s.language === 'ar' }];
  ws.getColumn(1).width = 14;
  for (let c = 2; c <= 16; c++) ws.getColumn(c).width = 22;
}

/** A period that carries, exported from its own replay. */
export const exportRolledStatement = (input: unknown, expected: unknown) =>
  exportBankStatement(input, expected, replayRolledStatement);
/** A period with its closing sheet, exported from its own replay: the sheet
 * first, in the language of its labels. */
export const exportSheetStatement = (input: unknown, expected: unknown) =>
  exportBankStatement(input, expected, replaySheetStatement);

/** Any kind of state, by its declared version: what the worker serves. */
const rolled = (state: AnyStatementState): state is BankStatementRollState =>
  state.version === BANK_STATEMENT_ROLL_VERSION;
const sheeted = (state: AnyStatementState): state is BankStatementSheetState =>
  state.version === BANK_STATEMENT_SHEET_VERSION;
export async function replayAnyStatement(
  input: unknown,
): Promise<
  BankStatementReplay | BankStatementRollReplay | BankStatementSheetReplay
> {
  const state = snapshotAnyStatementState(input);
  if (sheeted(state)) return replaySheetStatement(state);
  return rolled(state)
    ? replayRolledStatement(state)
    : replayBankStatement(state);
}
export async function saveAnyStatement(input: unknown): Promise<ArrayBuffer> {
  const state = snapshotAnyStatementState(input);
  if (sheeted(state)) return saveSheetStatement(state);
  return rolled(state) ? saveRolledStatement(state) : saveBankStatement(state);
}
export async function exportAnyStatement(input: unknown, expected: unknown) {
  const state = snapshotAnyStatementState(input);
  if (sheeted(state)) return exportSheetStatement(state, expected);
  return rolled(state)
    ? exportRolledStatement(state, expected)
    : exportBankStatement(state, expected);
}
/** A session file of either format; one that carries keeps its previous. */
export async function restoreAnyStatement(
  session: ArrayBuffer,
  replay: (
    input: unknown,
  ) => Promise<BankStatementReplay> = replayBankStatement,
): Promise<
  BankStatementReplay | BankStatementRollReplay | BankStatementSheetReplay
> {
  const { state, previous, sheet } = statementSessionParts(session);
  if (sheet)
    return replaySheetStatement({
      ...state,
      version: BANK_STATEMENT_SHEET_VERSION,
      previous,
      sheet,
    });
  return previous
    ? replayRolledStatement({
        ...state,
        version: BANK_STATEMENT_ROLL_VERSION,
        previous,
      })
    : replay(state);
}

/** A worker reply is installed only if this thread, from the captured
 * request's own originals, computes the same thing. The originals are read
 * here once per set of bytes and scope (replayVerified); a saved session is
 * bound by holding exactly the request's originals, scope and decisions,
 * which this thread has just replayed. */
export async function validateBankStatementWorkerResponse(
  action: string,
  value: unknown,
  payload: unknown,
): Promise<unknown> {
  const requested = snapshotBankStatementRequest(action, payload);
  if (action === 'bank-statement-save') {
    statementBytes(value, BANK_STATEMENT_SESSION_LIMIT, 'ENVELOPE');
    const returned = value.slice(0);
    const capture = requested as AnyStatementState;
    const state = sheeted(capture)
      ? (await replaySheetStatement(capture)).state
      : rolled(capture)
        ? (await replayRolledStatement(capture)).state
        : (await replayVerified(capture)).state;
    let saved: AnyStatementState | undefined;
    try {
      const parts = statementSessionParts(returned);
      saved = parts.sheet
        ? {
            ...parts.state,
            version: BANK_STATEMENT_SHEET_VERSION,
            previous: parts.previous,
            sheet: parts.sheet,
          }
        : parts.previous
        ? {
            ...parts.state,
            version: BANK_STATEMENT_ROLL_VERSION,
            previous: parts.previous,
          }
        : parts.state;
    } catch {
      fail('WORKER_BINDING');
    }
    if (!sameStatementData(saved, state)) fail('WORKER_BINDING');
    return returned;
  }
  if (action === 'bank-statement-export') {
    statementBytes(value, BANK_STATEMENT_EXPORT_LIMIT, 'ENVELOPE');
    const returned = value.slice(0);
    const { state, result } = requested as BankStatementExportRequest;
    const expected = sheeted(state)
      ? await exportBankStatement(state, result, replaySheetStatement)
      : rolled(state)
        ? await exportBankStatement(state, result, replayRolledStatement)
        : await exportBankStatement(state, result, replayVerified);
    const { sameStockWorkbook } =
      await import('./inventory-register-worker-binding.ts');
    const same = await sameStockWorkbook(returned, expected).catch(() => false);
    if (!same) fail('WORKER_BINDING');
    return expected;
  }
  if (!statementPlain(value) || !statementKeys(value, ['state', 'result']))
    fail('ENVELOPE');
  const captured = structuredClone(value);
  const capture = requested as AnyStatementState;
  const expected =
    action === 'bank-statement-restore'
      ? await restoreAnyStatement(
          (requested as { buffer: ArrayBuffer }).buffer,
          replayVerified,
        )
      : sheeted(capture)
        ? await replaySheetStatement(capture)
        : rolled(capture)
        ? await replayRolledStatement(capture)
        : await replayVerified(requested);
  if (!sameStatementData(captured, expected)) fail('WORKER_BINDING');
  return expected;
}
