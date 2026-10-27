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
  type ReviewReason,
  type StatementMatchResult,
} from './bank-statement-match.ts';
import { MAX_FILE_BYTES } from './types.ts';
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
  statementBytes,
  statementKeys,
  statementPlain,
  statementText,
  type BankStatementExportRequest,
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
  /** C1, C2, …: automatic pairs, then review groups, in the engine's order. */
  id: string;
  kind: 'automatic' | 'review';
  reason: 'reference' | ReviewReason;
  reference: string;
  statement: string[];
  cashbook: string[];
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
export type BankStatementResult = {
  version: typeof BANK_STATEMENT_LIFECYCLE_VERSION;
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
};
export type BankStatementReplay = {
  state: BankStatementState;
  result: BankStatementResult;
};

/** Review reasons an accountant may accept as they stand: one movement and
 * one entry with the same direction and amount. */
const ACCEPTABLE: ReadonlySet<string> = new Set<ReviewReason>([
  'amount-date-suggestion',
  'date-gap',
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
  state: BankStatementState,
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
  const cashbook = readBankCashbookTable(cashbookSource, reading.currency);
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
  ]);
  return frozen({ reading, match, context });
}

/** Applies the decisions to what the originals gave. Reads nothing. */
function settleStatement(
  state: BankStatementState,
  base: StatementBase,
): BankStatementReplay {
  const { reading, match, context } = base;
  const { scope } = state;
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
  return {
    state,
    result: {
      version: BANK_STATEMENT_LIFECYCLE_VERSION,
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
      })),
      scope: structuredClone(scope),
      reading,
      match,
      cases,
      outstanding,
      decisions: structuredClone(state.decisions),
    },
  };
}

/**
 * This thread's own reading of the last originals it verified. A later
 * request with the same names, fingerprints, bytes (compared byte for byte)
 * and scope gives the same reading, so its decisions are settled on it
 * without reading the PDF again; anything else is read from its bytes.
 */
let verified: {
  files: { name: string; sha256: string; original: ArrayBuffer }[];
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
  const { state, previous } = statementSessionParts(session);
  if (previous) fail('SESSION');
  return state;
}

/** What a session file holds: its originals, scope and decisions, and, in the
 * proposed roll format (bank-statement-roll-1), the previous period's session
 * file as it was saved, unread. Its fingerprint is checked by its reader. */
export function statementSessionParts(session: ArrayBuffer): {
  state: BankStatementState;
  previous: StatementSource | null;
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
  if (
    !statementPlain(parsed) ||
    !statementKeys(parsed, [
      'format',
      'version',
      'files',
      'scope',
      'decisions',
      ...(roll ? ['previous'] : []),
    ]) ||
    parsed.format !== BANK_STATEMENT_SESSION_FORMAT ||
    (parsed.version !== BANK_STATEMENT_LIFECYCLE_VERSION && !roll) ||
    !Array.isArray(parsed.files) ||
    parsed.files.length !== 2
  )
    fail('SESSION');
  const files = parsed.files.map((f) => {
    if (!statementPlain(f) || !statementKeys(f, ['name', 'sha256', 'data']))
      fail('SESSION');
    return { name: f.name, sha256: f.sha256, original: decode(f.data) };
  });
  let previous: StatementSource | null = null;
  if (roll) {
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
  };
}

/** The workbook cites every value: statement lines by page and PDF.js text
 * item (or table row), cashbook entries by row, and carries both originals. */
export async function exportBankStatement(
  input: unknown,
  expected: unknown,
  replay: (
    input: unknown,
  ) => Promise<BankStatementReplay> = replayBankStatement,
): Promise<ArrayBuffer> {
  const { state, result } = await replay(input);
  if (!sameStatementData(result, expected)) fail('STALE_RESULT');
  const { reading, match } = result;
  const book = new ExcelJS.Workbook();
  book.creator = 'Tarasuf';
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
        'Statement-to-cashbook movement matching only. Completeness rests on printed page numbers with a closing balance, or on a closing balance the accountant confirmed; no balance bridge, fee or currency inference, ERP posting or source authenticity assurance',
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
  const chunks: (string | number)[][] = [];
  for (const [i, f] of state.files.entries()) {
    const data = encode(f.original);
    for (let at = 0; at < data.length; at += 30000)
      chunks.push([
        i === 0 ? 'statement' : 'cashbook',
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
    const state = (await replayVerified(requested)).state;
    let saved: BankStatementState | undefined;
    try {
      saved = sessionState(returned);
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
    const expected = await exportBankStatement(state, result, replayVerified);
    const { sameStockWorkbook } =
      await import('./inventory-register-worker-binding.ts');
    const same = await sameStockWorkbook(returned, expected).catch(() => false);
    if (!same) fail('WORKER_BINDING');
    return expected;
  }
  if (!statementPlain(value) || !statementKeys(value, ['state', 'result']))
    fail('ENVELOPE');
  const captured = structuredClone(value);
  const expected =
    action === 'bank-statement-restore'
      ? await restoreBankStatement(
          (requested as { buffer: ArrayBuffer }).buffer,
          replayVerified,
        )
      : await replayVerified(requested);
  if (!sameStatementData(captured, expected)) fail('WORKER_BINDING');
  return expected;
}
