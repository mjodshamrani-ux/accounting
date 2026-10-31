import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { usePendingResultFocus } from '@/components/result-focus';
import { Button } from '@/components/ui/button';
import {
  WorkspaceFileInput,
  WorkspaceGroupTitle,
  WorkspaceSourceHeading,
  WorkspaceSources,
} from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { bankStatementCopy } from '@/lib/i18n/bank-statement';
import { bankSheetCopy } from '@/lib/i18n/bank-sheet';
import { bankReviewCopy } from '@/lib/i18n/bank-review';
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import { currencyPrecision } from '@/lib/reconciliation/currency-precision';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import type { CashbookColumns } from '@/lib/reconciliation/bank-cashbook-map';
import {
  CashbookColumnsPanel,
  CashbookColumnsUsed,
} from './bank-cashbook-columns';
import type {
  BankStatementReplay,
  BankStatementResult,
  BankStatementRollReplay,
  BankStatementSheetReplay,
  StatementCase,
} from '@/lib/reconciliation/bank-statement-lifecycle';
import {
  BANK_STATEMENT_SESSION_LIMIT,
  type DeclaredTolerance,
  type SheetInputs,
  type SheetSignoff,
  type StatementDecision,
  type StatementSource,
} from '@/lib/reconciliation/bank-statement-request';
import { SHEET_SECTIONS } from '@/lib/reconciliation/bank-statement-sheet';
import {
  groupActions,
  groupDecisions,
  reviewQueue,
} from '@/lib/reconciliation/bank-review-queue';
import {
  BANK_CASHBOOK_FORMATS,
  BANK_STATEMENT_CURRENCIES,
  BANK_STATEMENT_FORMATS,
  carriedAtEnd,
  heldDetail,
  heldReason,
  parseStatementClosing,
  sheetInputs,
  sheetSignoff,
  sheetStatementState,
  statementActions,
  statementDecision,
  statementError,
  statementMember,
  statementState,
  rolledStatementState,
  toleranceInputs,
  toleranceRule,
  type StatementErrorKind,
} from '@/lib/reconciliation/bank-statement-view';

type Role = 'statement' | 'cashbook' | 'previous';
type Replay =
  | BankStatementReplay
  | BankStatementRollReplay
  | BankStatementSheetReplay;
type Failure = { kind: StatementErrorKind; detail: string };
/** The sheet inputs as typed; the language is empty until chosen. */
type SheetForm = {
  balance: string;
  note: string;
  language: SheetInputs['language'] | '';
};
/** What the sheet form shows for applied inputs, or for none. */
function sheetFormOf(inputs: SheetInputs | null, decimals: number): SheetForm {
  return {
    balance: inputs?.book
      ? money(inputs.book.balance, decimals).replace(/,/gu, '')
      : '',
    note: inputs?.book?.note ?? '',
    language: inputs?.language ?? '',
  };
}

/** The tolerance as typed: each limit in major units, and its reason. */
type ToleranceForm = { perItem: string; perPeriod: string; note: string };
/** What the tolerance form shows for an applied policy, or for none. */
function toleranceFormOf(
  policy: DeclaredTolerance | null | undefined,
  decimals: number,
): ToleranceForm {
  const limit = (v: DeclaredTolerance['perItem'] | undefined) =>
    typeof v === 'number' ? money(v, decimals).replace(/,/gu, '') : '';
  return {
    perItem: limit(policy?.perItem),
    perPeriod: limit(policy?.perPeriod),
    note: typeof policy?.note === 'string' ? policy.note : '',
  };
}

async function sourceOf(file: File): Promise<StatementSource> {
  const original = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', original);
  return {
    name: file.name,
    sha256: [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    original,
  };
}
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const isPdf = (s: StatementSource | null) => !!s && /\.pdf$/iu.test(s.name);

/** The statement session the bank workspace keeps while either source type
 * is shown: the two originals, the scope as typed, and the last result. */
export function useBankStatement() {
  const [statement, setStatement] = useState<StatementSource | null>(null),
    [cashbook, setCashbook] = useState<StatementSource | null>(null),
    [previous, setPrevious] = useState<StatementSource | null>(null),
    [currency, setCurrency] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [closing, setClosing] = useState(''),
    [result, setResult] = useState<BankStatementResult | null>(null),
    [sheet, setSheet] = useState<SheetInputs | null>(null),
    [sheetForm, setSheetForm] = useState<SheetForm>(sheetFormOf(null, 0)),
    // The tolerance in force (bank-tolerance-1), and as typed.
    [tolerance, setTolerance] = useState<DeclaredTolerance | null>(null),
    [toleranceForm, setToleranceForm] = useState<ToleranceForm>(
      toleranceFormOf(null, 0),
    ),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<Failure | null>(null),
    // The cashbook as read, for choosing its columns by hand or by a map.
    [layout, setLayout] = useState<SourceFile | null>(null);
  // A comparison, a reading with chosen columns or a restored session takes
  // the reader to the result; a decision, sheet or tolerance does not (UX-2).
  const [revealPending, setRevealPending] = useState(false);
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
    },
    [],
  );
  const pdf = isPdf(statement);
  const decimals = currencyPrecision(currency);
  const closingMinor =
    closing.trim() && decimals !== undefined
      ? parseStatementClosing(closing, decimals)
      : null;
  const closingInvalid = !!closing.trim() && closingMinor === null;
  const scope = () =>
    pdf
      ? { currency: null, period: null, confirmedClosing: null }
      : {
          currency: currency || null,
          period: start && end ? { start, end } : null,
          confirmedClosing: closingMinor,
        };
  const ready =
    !!statement && !!cashbook && (pdf || (!!currency && !closingInvalid));
  // A previous session is carried only into a printed statement.
  const period = (decisions: StatementDecision[]) =>
    pdf && previous
      ? rolledStatementState(statement!, cashbook!, decisions, previous)
      : statementState(statement!, cashbook!, scope(), decisions);
  // So is a closing sheet, once its inputs are applied.
  const untolerated = (
    decisions: StatementDecision[],
    inputs: SheetInputs | null = sheet,
  ) =>
    pdf && inputs
      ? sheetStatementState(statement!, cashbook!, decisions, previous, inputs)
      : period(decisions);
  // And a declared tolerance, once applied: every request carries it.
  const state = (
    decisions: StatementDecision[],
    inputs: SheetInputs | null = sheet,
    policy: DeclaredTolerance | null = tolerance,
  ) => {
    const chosen = untolerated(decisions, inputs);
    return policy ? { ...chosen, tolerance: policy } : chosen;
  };
  function invalidate() {
    setResult(null);
    setFailure(null);
    // Other files or another scope are another period: no tolerance yet.
    setTolerance(null);
    setToleranceForm(toleranceFormOf(null, 0));
  }
  function install(v: Replay, restored = false) {
    const [s, c] = v.state.files;
    setStatement(s);
    setCashbook(c);
    // The file's layout is kept only for the same cashbook.
    setLayout((l) => (l && l.sha256 === c.sha256 ? l : null));
    // A restored session brings its own previous file or none; a table's
    // comparison keeps a hidden one for when a printed statement returns.
    if ('previous' in v.state) setPrevious(v.state.previous);
    else if (restored) setPrevious(null);
    // The sheet inputs come with the state that holds them: a comparison
    // starts without them, and a session restores its own or none.
    const inputs = 'sheet' in v.state ? v.state.sheet : null;
    setSheet(inputs);
    setSheetForm(sheetFormOf(inputs, v.result.reading.decimals));
    // So does the tolerance: the one the state holds, or none.
    setTolerance(v.state.tolerance ?? null);
    setToleranceForm(
      toleranceFormOf(v.state.tolerance, v.result.reading.decimals),
    );
    const { scope: chosen } = v.state;
    setCurrency(chosen.currency ?? '');
    setStart(chosen.period?.start ?? '');
    setEnd(chosen.period?.end ?? '');
    setClosing(
      chosen.confirmedClosing === null || chosen.currency === null
        ? ''
        : money(
            chosen.confirmedClosing,
            currencyPrecision(chosen.currency) ?? 2,
          ).replace(/,/gu, ''),
    );
    setResult(v.result);
    setFailure(null);
  }
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current?.abort();
    controller.current = control;
    setBusy(true);
    setFailure(null);
    try {
      await prepareWorker();
      if (!control.signal.aborted) await work(control.signal);
    } catch (error) {
      if (id === serial.current && !control.signal.aborted) {
        const detail = error instanceof Error ? error.message : '';
        setFailure({ kind: statementError(detail), detail });
      }
    } finally {
      if (id === serial.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  /** The cashbook read for its columns (bank-cashbook-map-1). */
  async function readLayout(signal: AbortSignal) {
    const book = cashbook!;
    setLayout(
      await workerTask<SourceFile>(
        'read',
        { name: book.name, buffer: book.original.slice(0) },
        signal,
      ),
    );
  }
  const headerRefused =
    !!failure &&
    failure.kind === 'cashbook' &&
    /^BANK_CASHBOOK_HEADER\b/u.test(failure.detail);
  return {
    statement,
    cashbook,
    previous,
    currency,
    start,
    end,
    closing,
    closingInvalid,
    result,
    revealPending,
    revealed: () => setRevealPending(false),
    sheet,
    sheetForm,
    tolerance,
    toleranceForm,
    note,
    busy,
    failure,
    pdf,
    ready,
    headerRefused,
    layout:
      layout && cashbook && layout.sha256 === cashbook.sha256 ? layout : null,
    hasWork: !!(statement || cashbook),
    setNote,
    setSheetForm(change: Partial<SheetForm>) {
      setSheetForm((form) => ({ ...form, ...change }));
    },
    setToleranceForm(change: Partial<ToleranceForm>) {
      setToleranceForm((form) => ({ ...form, ...change }));
    },
    setScope(change: {
      currency?: string;
      start?: string;
      end?: string;
      closing?: string;
    }) {
      if (change.currency !== undefined) setCurrency(change.currency);
      if (change.start !== undefined) setStart(change.start);
      if (change.end !== undefined) setEnd(change.end);
      if (change.closing !== undefined) setClosing(change.closing);
      invalidate();
    },
    async choose(role: Role, file: File) {
      const formats =
        role === 'statement'
          ? BANK_STATEMENT_FORMATS
          : role === 'cashbook'
            ? BANK_CASHBOOK_FORMATS
            : /\.json$/iu;
      const limit =
        role === 'previous' ? BANK_STATEMENT_SESSION_LIMIT : MAX_FILE_BYTES;
      // A late reply or digest for the previous file must never be installed.
      const id = ++serial.current;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
      invalidate();
      if (role === 'cashbook') setLayout(null);
      if (file.size > limit || !formats.test(file.name)) {
        setFailure({ kind: 'other', detail: file.name });
        return;
      }
      const chosen = await sourceOf(file);
      if (id !== serial.current) return;
      if (role === 'statement') setStatement(chosen);
      else if (role === 'cashbook') setCashbook(chosen);
      else setPrevious(chosen);
    },
    removePrevious() {
      serial.current++;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
      setPrevious(null);
      invalidate();
    },
    compare: () =>
      perform(async (signal) => {
        try {
          install(
            await workerTask<Replay>(
              'bank-statement-reconcile',
              state([], null),
              signal,
            ),
          );
          setRevealPending(true);
        } catch (error) {
          // The declared reading comes first; once it refuses the header
          // row, the cashbook is read for its columns, for the accountant
          // to choose them. Its refusal stays the one shown.
          if (
            !cashbook!.columns &&
            error instanceof Error &&
            /^BANK_CASHBOOK_HEADER\b/u.test(error.message)
          )
            await readLayout(signal).catch(() => undefined);
          throw error;
        }
      }),
    /** A new comparison with the cashbook read with these columns. */
    readWith: (columns: CashbookColumns) =>
      perform(async (signal) => {
        const book = { ...cashbook!, columns };
        setCashbook(book);
        setResult(null);
        // A new comparison: no decision and no sheet, the cashbook with its
        // columns in the state as built from the sources shown.
        const fresh = state([], null);
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            { ...fresh, files: [fresh.files[0], book] },
            signal,
          ),
        );
        setRevealPending(true);
      }),
    loadLayout: () => perform(readLayout),
    decide: (c: StatementCase, type: StatementDecision['type']) =>
      perform(async (signal) => {
        if (!result) return;
        const decision = statementDecision(
          result,
          c,
          type,
          note,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state([...result.decisions, decision]),
            signal,
          ),
        );
      }),
    decideGroup: (signature: string, type: 'accept' | 'reject') =>
      perform(async (signal) => {
        if (!result) return;
        // One ordinary decision per case of the group as it stands now.
        const decisions = groupDecisions(
          result,
          signature,
          type,
          note,
          () => crypto.randomUUID(),
          new Date().toISOString(),
        );
        if (!decisions) return;
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state([...result.decisions, ...decisions]),
            signal,
          ),
        );
      }),
    applySheet: (inputs: SheetInputs) =>
      perform(async (signal) => {
        if (!result) return;
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state(result.decisions, inputs),
            signal,
          ),
        );
      }),
    /** The period replayed under a tolerance, or under none; the lifecycle
     * refuses it once a decision is bound to the one in force. */
    applyTolerance: (policy: DeclaredTolerance | null) =>
      perform(async (signal) => {
        if (!result) return;
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state(result.decisions, sheet, policy),
            signal,
          ),
        );
      }),
    sign: (kind: 'prepared' | 'reviewed', signoff: SheetSignoff) =>
      perform(async (signal) => {
        if (!result || !sheet) return;
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state(result.decisions, { ...sheet, [kind]: signoff }),
            signal,
          ),
        );
      }),
    save: () =>
      perform(async (signal) => {
        if (!result) return;
        download(
          await workerTask<ArrayBuffer>(
            'bank-statement-save',
            state(result.decisions),
            signal,
          ),
          'tarasuf-bank-statement-session.json',
          'application/json',
        );
      }),
    exportBook: () =>
      perform(async (signal) => {
        if (!result) return;
        download(
          await workerTask<ArrayBuffer>(
            'bank-statement-export',
            { state: state(result.decisions), result },
            signal,
          ),
          'tarasuf-bank-statement-workpaper.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      }),
    restore: (buffer: ArrayBuffer) =>
      perform(async (signal) => {
        install(
          await workerTask<Replay>(
            'bank-statement-restore',
            { buffer },
            signal,
          ),
          true,
        );
        setRevealPending(true);
      }),
    cancel() {
      serial.current++;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
    },
  };
}
export type BankStatementSession = ReturnType<typeof useBankStatement>;

/** A paged table that builds only the rows it shows. */
function Table<T>({
  title,
  headers,
  items,
  row,
  testId,
}: {
  title: string;
  headers: string[];
  items: readonly T[];
  row: (item: T, index: number) => ReactNode[];
  testId: string;
}) {
  const { lang } = useI18n(),
    c = bankStatementCopy[lang];
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / 50));
  const at = Math.min(page, pages - 1);
  return (
    <section data-bank-statement-table={testId}>
      <h2>{title}</h2>
      <div className="gl-tb-table">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.slice(at * 50, (at + 1) * 50).map((item, i) => (
              <tr key={at * 50 + i}>
                {row(item, at * 50 + i).map((cell, k) => (
                  <td key={k}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="gl-tb-actions">
          <Button
            variant="outline"
            disabled={!at}
            onClick={() => setPage(at - 1)}
          >
            {c.previous}
          </Button>
          <span>
            {at + 1} / {pages}
          </span>
          <Button
            variant="outline"
            disabled={at + 1 >= pages}
            onClick={() => setPage(at + 1)}
          >
            {c.next}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The statement sources and scope, inside the workspace's locked fieldset. */
export function BankStatementSources({ s }: { s: BankStatementSession }) {
  const { lang } = useI18n(),
    c = bankStatementCopy[lang];
  const file = (role: Role) => (event: ChangeEvent<HTMLInputElement>) => {
    const blob = event.target.files?.[0];
    event.target.value = '';
    if (blob) void s.choose(role, blob);
  };
  return (
    <>
      <WorkspaceGroupTitle kind="sources" />
      <WorkspaceSources
        primaryIndices={[0, 1]}
        primaryReady={!!(s.statement && s.cashbook)}
      >
        {(['statement', 'cashbook'] as const).map((role) => (
          <section
            className="workspace-source"
            key={role}
            data-testid={`bank-statement-source-${role}`}
          >
            <h2>
              <WorkspaceSourceHeading>{c[role]}</WorkspaceSourceHeading>
            </h2>
            <WorkspaceFileInput
              type="file"
              accept={role === 'statement' ? '.pdf,.csv,.xlsx' : '.csv,.xlsx'}
              aria-label={c[role]}
              onChange={file(role)}
            />
            {s[role] && (
              <p data-bank-statement-file={role}>
                <bdi>{s[role]!.name}</bdi>
              </p>
            )}
            <p className="bank-source-basis">
              {role === 'statement' ? c.statementHint : c.cashbookHint}
            </p>
          </section>
        ))}
      </WorkspaceSources>
      <section className="workspace-scope" hidden={!s.statement}>
        <WorkspaceGroupTitle kind="scope" />
        {s.pdf ? (
          <p className="bank-source-basis">{c.pdfScope}</p>
        ) : (
          <>
            <p className="bank-source-basis">{c.tableScope}</p>
            <div className="gl-tb-grid">
              <label>
                {c.currency}
                <select
                  aria-label={c.currency}
                  value={s.currency}
                  onChange={(e) => s.setScope({ currency: e.target.value })}
                >
                  <option value="">{c.chooseCurrency}</option>
                  {BANK_STATEMENT_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {c.periodStart}
                <input
                  type="date"
                  aria-label={c.periodStart}
                  value={s.start}
                  onChange={(e) => s.setScope({ start: e.target.value })}
                />
              </label>
              <label>
                {c.periodEnd}
                <input
                  type="date"
                  aria-label={c.periodEnd}
                  value={s.end}
                  onChange={(e) => s.setScope({ end: e.target.value })}
                />
              </label>
              <label>
                {c.closing}
                <input
                  inputMode="decimal"
                  dir="ltr"
                  aria-label={c.closing}
                  aria-invalid={s.closingInvalid}
                  value={s.closing}
                  onChange={(e) => s.setScope({ closing: e.target.value })}
                />
              </label>
            </div>
            <p className="bank-source-basis">{c.closingHint}</p>
            {s.closingInvalid && <p role="alert">{c.closingInvalid}</p>}
          </>
        )}
      </section>
      <div className="workspace-sources" hidden={!s.pdf}>
        <section
          className="workspace-source"
          data-testid="bank-statement-source-previous"
        >
          <h2>
            <WorkspaceSourceHeading>{c.priorSession}</WorkspaceSourceHeading>
          </h2>
          <WorkspaceFileInput
            type="file"
            accept=".json"
            aria-label={c.priorSession}
            onChange={file('previous')}
          />
          {s.previous && (
            <>
              <p data-bank-statement-file="previous">
                <bdi>{s.previous.name}</bdi>
              </p>
              <Button variant="outline" onClick={() => s.removePrevious()}>
                {c.priorSessionRemove}
              </Button>
            </>
          )}
          <p className="bank-source-basis">{c.priorSessionHint}</p>
        </section>
      </div>
      <Button disabled={!s.ready} onClick={() => void s.compare()}>
        {c.compare}
      </Button>
    </>
  );
}

/** The statement result, decisions and outputs. */
export function BankStatementResults({
  s,
  locked,
}: {
  s: BankStatementSession;
  locked: boolean;
}) {
  const { t, lang } = useI18n(),
    c = bankStatementCopy[lang];
  const r = s.result;
  return (
    <>
      {s.busy && (
        <Button variant="outline" onClick={() => s.cancel()}>
          {t.bank.cancel}
        </Button>
      )}
      {s.failure && (
        <p role="alert" data-bank-statement-failure={s.failure.kind}>
          {c.errors[s.failure.kind]}{' '}
          {s.failure.detail && (
            <>
              {c.errorDetail}: <bdi dir="ltr">{s.failure.detail}</bdi>
            </>
          )}
        </p>
      )}
      {s.cashbook && (s.layout || s.cashbook.columns) && (
        <CashbookColumnsPanel key={s.cashbook.sha256} s={s} locked={locked} />
      )}
      {r && <Result r={r} s={s} locked={locked} />}
    </>
  );
}

function Result({
  r,
  s,
  locked,
}: {
  r: BankStatementResult;
  s: BankStatementSession;
  locked: boolean;
}) {
  const { lang } = useI18n(),
    c = bankStatementCopy[lang];
  const heading = usePendingResultFocus(s.revealPending, s.revealed);
  const format = (n: number | null | undefined) =>
    n === null || n === undefined ? '' : money(n, r.reading.decimals);
  const held = r.match.held ? heldReason(r.match.held.reason) : null;
  // The reader's detail in the page's words, amounts at the currency's
  // precision; a detail of no known form is shown as the reader wrote it.
  const heldText = (detail: string) => {
    const d = heldDetail(detail);
    const amount = (n: number, key: string) => (
      <bdi key={key} dir="ltr">
        {format(n)}
      </bdi>
    );
    switch (d.kind) {
      case 'balance':
        return c.heldDetail.balance(
          d.items ? c.pageCitation(d.page, d.items) : c.pageOnly(d.page),
          c.heldLines[d.line],
          amount(d.printed, 'printed'),
          amount(d.computed, 'computed'),
          amount(d.printed - d.computed, 'difference'),
        );
      case 'page-totals':
        return c.heldDetail.pageTotals(c.pageOnly(d.page));
      case 'page-start':
        return c.heldDetail.pageStart(c.pageOnly(d.page));
      case 'page-end':
        return c.heldDetail.pageEnd(c.pageOnly(d.page));
      case 'statement-totals':
        return c.heldDetail.statementTotals;
      case 'second-opening':
        return c.heldDetail.secondOpening;
      case 'no-closing':
        return c.heldDetail.noClosing;
      case 'pages':
        return c.heldDetail.pages(
          c.heldDetail.list(d.read),
          c.heldDetail.list(d.declared),
        );
      case 'as-written':
        return <bdi dir="ltr">{d.text}</bdi>;
    }
  };
  const where = (side: 'statement' | 'cashbook', id: string) => {
    const m = statementMember(r, side, id);
    if (!m) return id;
    const [page, items] = m.citation.split(':');
    return side === 'statement'
      ? c.pageCitation(Number(page), items)
      : c.rowCitation(m.citation);
  };
  const members = (side: 'statement' | 'cashbook', ids: string[]) => (
    <ul className="bank-statement-members">
      {ids.map((id) => {
        const m = statementMember(r, side, id);
        return (
          <li key={id}>
            <span>
              <bdi className="bank-statement-id">{id}</bdi>{' '}
              <bdi dir="ltr">{format(m?.amount)}</bdi>{' '}
              {m ? c.directions[m.direction] : ''}
            </span>
            <small>
              <bdi dir="ltr">{m?.date}</bdi> · {where(side, id)}
            </small>
          </li>
        );
      })}
    </ul>
  );
  const caseRow = (k: StatementCase) => {
    const can = statementActions(k, s.note);
    return [
      k.id,
      c.reasons[k.reason],
      <bdi key="reference" className="bank-statement-id">
        {k.reference}
      </bdi>,
      members('statement', k.statement),
      members('cashbook', k.cashbook),
      c.caseStatus[k.status],
      <div className="gl-tb-actions" key="decide">
        {k.kind !== 'automatic' && (
          <Button
            disabled={locked || !can.accept}
            onClick={() => void s.decide(k, 'accept')}
          >
            {c.accept}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={locked || !can.reject}
          onClick={() => void s.decide(k, 'reject')}
        >
          {c.reject}
        </Button>
        <Button
          variant="outline"
          disabled={locked || !can.undo}
          onClick={() => void s.decide(k, 'undo')}
        >
          {c.undo}
        </Button>
      </div>,
    ];
  };
  const toleratedRow = (k: StatementCase) => {
    const can = statementActions(k, s.note),
      status = c.caseStatus[k.status];
    return [
      k.id,
      c.reasons[k.reason],
      <bdi key="reference" className="bank-statement-id">
        {k.reference}
      </bdi>,
      members('statement', k.statement),
      members('cashbook', k.cashbook),
      <bdi key="difference" dir="ltr" data-bank-tolerance-difference>
        {format(k.amounts?.difference)}
      </bdi>,
      status,
      <div className="gl-tb-actions" key="decide">
        <Button
          variant="outline"
          disabled={locked || !can.reject}
          onClick={() => void s.decide(k, 'reject')}
        >
          {c.reject}
        </Button>
        <Button
          variant="outline"
          disabled={locked || !can.undo}
          onClick={() => void s.decide(k, 'undo')}
        >
          {c.undo}
        </Button>
      </div>,
    ];
  };
  const carried = new Map((r.roll?.carried ?? []).map((i) => [i.key, i]));
  const carriedRow = (k: StatementCase) => {
    const cells = caseRow(k);
    cells[2] = (
      <ul className="bank-statement-members" key="carried">
        {(k.carried ?? []).map((key) => {
          const i = carried.get(key);
          return (
            <li key={key}>
              <span>
                <bdi className="bank-statement-id">{i?.id ?? key}</bdi>{' '}
                <bdi dir="ltr">{format(i?.amount)}</bdi>{' '}
                {i ? c.directions[i.direction] : ''}
              </span>
              {i && (
                <small>
                  <bdi dir="ltr">{i.date}</bdi> ·{' '}
                  {i.page === null
                    ? c.rowCitation(String(i.row))
                    : c.pageOnly(i.page)}
                </small>
              )}
            </li>
          );
        })}
      </ul>
    );
    return cells;
  };
  const movementIds = new Map<number, string>();
  {
    let n = 0;
    for (const [i, l] of r.reading.lines.entries())
      if (l.kind === 'movement') movementIds.set(i, `S${++n}`);
  }
  const period = r.match.statement.period;
  return (
    <section className="bank-statement-result" data-bank-statement-result>
      <h2
        data-bank-statement-status={r.status}
        ref={heading}
        tabIndex={-1}
        data-result-heading="result"
      >
        {c.status[r.status]}
      </h2>
      {!r.match.held && (
        <p className="bank-source-basis" data-bank-statement-counts>
          {c.counts(
            r.cases.filter((k) => k.kind === 'automatic').length,
            r.cases.filter((k) => k.status === 'needs-review').length,
            r.outstanding.length,
          )}
        </p>
      )}
      {held && r.match.held && (
        <output className="bank-statement-held">
          <p data-bank-statement-held={held.kind}>
            {c.held[held.kind]} {held.detail && heldText(held.detail)}
          </p>
          <p>{c.heldCounts(r.match.held.statement, r.match.held.cashbook)}</p>
          {held.detail && heldDetail(held.detail).kind !== 'as-written' && (
            <details data-bank-statement-held-raw>
              <summary>{c.heldRaw}</summary>
              <bdi dir="ltr">
                <code>{held.detail}</code>
              </bdi>
            </details>
          )}
        </output>
      )}
      {r.roll && (
        <output
          className={
            r.roll.previous.status === 'refused'
              ? 'bank-statement-held'
              : 'bank-source-basis'
          }
          data-bank-statement-previous={r.roll.previous.status}
        >
          {r.roll.previous.status === 'accepted' ? (
            <p>
              {c.priorAccepted(r.roll.previous.name, r.roll.carried.length)}
            </p>
          ) : (
            <>
              <p data-bank-statement-previous-code={r.roll.previous.code}>
                {c.priorRefused[r.roll.previous.code]}{' '}
                {r.roll.previous.detail && (
                  <>
                    {c.errorDetail}:{' '}
                    <bdi dir="ltr">{r.roll.previous.detail}</bdi>
                  </>
                )}
              </p>
              <p>{c.priorRefusedNote}</p>
            </>
          )}
        </output>
      )}
      <Table
        title={c.summary}
        headers={c.summaryHeaders}
        testId="summary"
        row={(cells) => cells}
        items={[
          [c.summaryRows.format, r.reading.format.toUpperCase()],
          [c.summaryRows.currency, r.reading.currency],
          [
            c.summaryRows.period,
            period ? (
              <bdi
                key="period"
                dir="ltr"
              >{`${period.start} – ${period.end}`}</bdi>
            ) : (
              ''
            ),
          ],
          [c.summaryRows.pages, r.reading.pages.length || ''],
          [
            c.summaryRows.opening,
            <bdi key="o" dir="ltr">
              {format(r.reading.opening)}
            </bdi>,
          ],
          [
            c.summaryRows.closingPrinted,
            <bdi key="c" dir="ltr">
              {format(r.reading.closing)}
            </bdi>,
          ],
          [
            c.summaryRows.withdrawals,
            <bdi key="w" dir="ltr">
              {format(r.reading.withdrawals)}
            </bdi>,
          ],
          [
            c.summaryRows.deposits,
            <bdi key="d" dir="ltr">
              {format(r.reading.deposits)}
            </bdi>,
          ],
          [
            c.summaryRows.completeness,
            c.completeness[r.match.statement.completeness],
          ],
        ]}
      />
      <CashbookColumnsUsed r={r} />
      <p className="bank-source-basis" data-bank-statement-claim>
        {r.sheet ? c.claimWithSheet : c.claim}
      </p>
      <Tolerance r={r} s={s} locked={locked} />
      {r.reading.format === 'pdf' && <Sheet r={r} s={s} locked={locked} />}
      <fieldset disabled={locked}>
        <div className="gl-tb-actions">
          <Button onClick={() => void s.save()}>{c.save}</Button>
          <Button onClick={() => void s.exportBook()}>{c.export}</Button>
        </div>
        <p className="bank-source-basis">{c.exportNote}</p>
        {r.cases.length > 0 && (
          <>
            <label className="bank-statement-note">
              {c.note}
              <textarea
                aria-label={c.note}
                value={s.note}
                onChange={(e) => s.setNote(e.target.value)}
              />
            </label>
            <p className="bank-source-basis">
              {c.noteHint} {c.acceptLimit}
            </p>
          </>
        )}
      </fieldset>
      {r.reading.format === 'pdf' && r.status !== 'held' && (
        <Queue r={r} s={s} locked={locked} members={members} format={format} />
      )}
      {r.cases.some((k) => k.kind === 'tolerated') && (
        <Table
          title={c.tolerance.cases}
          headers={c.tolerance.caseHeaders}
          testId="tolerated"
          items={r.cases.filter((k) => k.kind === 'tolerated')}
          row={toleratedRow}
        />
      )}
      {r.cases.some((k) => k.kind === 'review') && (
        <Table
          title={c.review}
          headers={c.caseHeaders}
          testId="review"
          items={r.cases.filter((k) => k.kind === 'review')}
          row={caseRow}
        />
      )}
      {r.cases.some((k) => k.kind === 'carried') && (
        <Table
          title={c.carriedCases}
          headers={c.carriedCaseHeaders}
          testId="carried"
          items={r.cases.filter((k) => k.kind === 'carried')}
          row={carriedRow}
        />
      )}
      {r.cases.some((k) => k.kind === 'automatic') && (
        <Table
          title={c.automatic}
          headers={c.caseHeaders}
          testId="automatic"
          items={r.cases.filter((k) => k.kind === 'automatic')}
          row={caseRow}
        />
      )}
      {r.outstanding.length > 0 && (
        <Table
          title={c.outstanding}
          headers={c.outstandingHeaders}
          testId="outstanding"
          items={r.outstanding}
          row={(o) => {
            const m = statementMember(r, o.side, o.id);
            return [
              c.sides[o.side],
              <bdi key="id">{o.id}</bdi>,
              o.origin === 'unmatched' ? c.unmatched : c.rejectedIn(o.origin),
              m?.date ?? '',
              <bdi key="ref">{m?.reference ?? ''}</bdi>,
              m ? c.directions[m.direction] : '',
              <bdi key="amount" dir="ltr">
                {format(m?.amount)}
              </bdi>,
              where(o.side, o.id),
            ];
          }}
        />
      )}
      {r.roll && r.roll.carried.length > 0 && (
        <Table
          title={c.carriedItems}
          headers={c.carriedItemHeaders}
          testId="carried-items"
          items={r.roll.carried}
          row={(i) => {
            const age = carriedAtEnd(r, i);
            return [
              <bdi key="id">{i.id}</bdi>,
              c.sides[i.side],
              <bdi key="period" dir="ltr">
                {`${i.period.start} – ${i.period.end}`}
              </bdi>,
              i.page === null
                ? c.rowCitation(String(i.row))
                : c.pageOnly(i.page),
              <bdi key="date" dir="ltr">
                {i.date}
              </bdi>,
              <bdi key="ref">{i.reference}</bdi>,
              c.directions[i.direction],
              <bdi key="amount" dir="ltr">
                {format(i.amount)}
              </bdi>,
              i.origin === 'unmatched'
                ? c.unmatched
                : c.priorRejectedIn(i.origin),
              i.age,
              age === null ? c.inCase : c.stillCarried(age),
            ];
          }}
        />
      )}
      {r.match.timing.length > 0 && (
        <Table
          title={c.timing}
          headers={c.timingHeaders}
          testId="timing"
          items={r.match.timing}
          row={(id) => {
            const m = statementMember(r, 'statement', id)!;
            return [
              id,
              m.date,
              r.match.movements[Number(id.slice(1)) - 1].valueDate,
              where('statement', id),
            ];
          }}
        />
      )}
      {r.decisions.length > 0 && (
        <Table
          title={c.decisions}
          headers={c.decisionHeaders}
          testId="decisions"
          items={r.decisions}
          row={(d) => [
            <bdi key="id" dir="ltr">
              {d.id}
            </bdi>,
            c.decisionTypes[d.type],
            d.case,
            <bdi key="at" dir="ltr">
              {d.at}
            </bdi>,
            d.note,
          ]}
        />
      )}
      <details className="bank-statement-lines">
        <summary>{c.lines}</summary>
        <Table
          title={c.lines}
          headers={c.lineHeaders}
          testId="lines"
          items={r.reading.lines}
          row={(l, i) => [
            i + 1,
            c.lineKinds[l.kind],
            l.page || '',
            l.items.join(' '),
            movementIds.get(i) ?? '',
            l.date ?? '',
            l.valueDate ?? '',
            l.description ?? l.text ?? '',
            <bdi key="ref">{l.reference ?? ''}</bdi>,
            <bdi key="w" dir="ltr">
              {format(l.withdrawal)}
            </bdi>,
            <bdi key="d" dir="ltr">
              {format(l.deposit)}
            </bdi>,
            <bdi key="b" dir="ltr">
              {format(l.balance)}
            </bdi>,
          ]}
        />
      </details>
    </section>
  );
}

/** The tolerance the accountant declares (bank-tolerance-1, proposed): typed
 * in the statement currency, applied by a replay the lifecycle may refuse,
 * and fixed once a decision is bound to it. What it did is shown with it. */
function Tolerance({
  r,
  s,
  locked,
}: {
  r: BankStatementResult;
  s: BankStatementSession;
  locked: boolean;
}) {
  const { lang } = useI18n(),
    t = bankStatementCopy[lang].tolerance;
  const decimals = r.reading.decimals;
  const show = (n: number) => money(n, decimals);
  const form = s.toleranceForm;
  const typed = toleranceInputs(
    form.perItem,
    form.perPeriod,
    form.note,
    decimals,
  );
  const touched = !!(form.perItem || form.perPeriod || form.note);
  const applied = r.tolerance?.policy ?? null;
  // A decision is bound to the context the tolerance is part of.
  const bound = r.decisions.length > 0;
  const rule =
    s.failure?.kind === 'tolerance' ? toleranceRule(s.failure.detail) : null;
  const tolerated = r.cases.filter(
    (k) => k.status === 'matched-tolerated',
  ).length;
  return (
    <section className="bank-tolerance" data-bank-tolerance>
      <h2>{t.title}</h2>
      <p className="bank-source-basis">{t.intro}</p>
      <p data-bank-tolerance-applied={applied ? 'yes' : 'no'}>
        {applied ? (
          <>
            <bdi>
              {t.declared(
                show(applied.perItem),
                show(applied.perPeriod),
                applied.note,
              )}
            </bdi>
          </>
        ) : (
          t.none
        )}
      </p>
      {r.tolerance && (
        <output
          className={
            r.tolerance.exceeded ? 'bank-statement-held' : 'bank-source-basis'
          }
          data-bank-tolerance-outcome={
            r.tolerance.exceeded ? 'exceeded' : 'tolerated'
          }
        >
          <p>
            {r.tolerance.exceeded
              ? t.exceeded(
                  show(r.tolerance.sum),
                  show(r.tolerance.policy.perPeriod),
                )
              : t.counts(tolerated, r.tolerance.eligible.length)}
          </p>
        </output>
      )}
      <fieldset disabled={locked || bound}>
        <div className="gl-tb-grid">
          <label>
            {t.perItem}
            <input
              inputMode="decimal"
              dir="ltr"
              aria-label={t.perItem}
              aria-invalid={typed === 'perItem'}
              value={form.perItem}
              onChange={(e) => s.setToleranceForm({ perItem: e.target.value })}
            />
          </label>
          <label>
            {t.perPeriod}
            <input
              inputMode="decimal"
              dir="ltr"
              aria-label={t.perPeriod}
              aria-invalid={typed === 'perPeriod'}
              value={form.perPeriod}
              onChange={(e) =>
                s.setToleranceForm({ perPeriod: e.target.value })
              }
            />
          </label>
          <label>
            {t.note}
            <input
              aria-label={t.note}
              aria-invalid={typed === 'note'}
              value={form.note}
              onChange={(e) => s.setToleranceForm({ note: e.target.value })}
            />
          </label>
        </div>
        <p className="bank-source-basis">
          {t.perItemHint}. {t.perPeriodHint}. {t.noteHint}.
        </p>
        {touched && typeof typed === 'string' && (
          <p role="alert" data-bank-tolerance-invalid={typed}>
            {t.invalid[typed]}
          </p>
        )}
        <div className="gl-tb-actions">
          <Button
            disabled={typeof typed === 'string'}
            onClick={() => {
              if (typeof typed !== 'string') void s.applyTolerance(typed);
            }}
          >
            {t.apply}
          </Button>
          <Button
            variant="outline"
            disabled={!applied}
            onClick={() => void s.applyTolerance(null)}
          >
            {t.remove}
          </Button>
        </div>
      </fieldset>
      {bound && (
        <p className="bank-source-basis" data-bank-tolerance-locked>
          {t.locked}
        </p>
      )}
      {rule && (
        <p role="alert" data-bank-tolerance-refused={rule}>
          {t.rules[rule]}
        </p>
      )}
    </section>
  );
}

/** The closing reconciliation sheet of a printed statement's period
 * (bank-reconciliation-sheet-1, proposed): its inputs, the sheet or the
 * refusal in its place, and the sign-offs with their standing. Every figure
 * is the replayed result's; nothing here adds or nets an amount. */
function Queue({
  r,
  s,
  locked,
  members,
  format,
}: {
  r: BankStatementResult;
  s: BankStatementSession;
  locked: boolean;
  members: (side: 'statement' | 'cashbook', ids: string[]) => ReactNode;
  format: (n: number) => string;
}) {
  const { lang } = useI18n(),
    c = bankStatementCopy[lang],
    q = bankReviewCopy[lang];
  const queue = reviewQueue(r);
  return (
    <section
      className="bank-review-queue"
      data-bank-review-queue={queue.length}
    >
      <h2>{q.title}</h2>
      <p className="bank-source-basis">{q.intro}</p>
      {queue.length === 0 ? (
        <p data-bank-review-empty>{q.empty}</p>
      ) : (
        <p className="bank-source-basis">{q.bulkNote}</p>
      )}
      {queue.map((g, i) => {
        const offered = groupActions(g, s.note);
        const n = g.cases.length;
        return (
          <section
            key={g.signature}
            data-bank-review-group={g.signature}
            data-bank-review-class={g.class}
          >
            <Table
              title={`${q.classes[g.class]}: ${c.reasons[g.reason]}`}
              headers={q.headers}
              testId={`queue-${i + 1}`}
              items={g.cases}
              row={(k) => [
                k.case,
                members('statement', k.statement),
                members('cashbook', k.cashbook),
                <bdi key="impact" dir="ltr">
                  {format(k.impact)}
                </bdi>,
              ]}
            />
            <p className="bank-source-basis" data-bank-review-evidence>
              {q.directions[g.direction]} · {q.shape(g.statement, g.cashbook)}
              {g.gap === undefined ? '' : ` · ${q.gap(g.gap)}`} · {q.cases(n)} ·{' '}
              {q.impact}: <bdi dir="ltr">{format(g.impact)}</bdi>
            </p>
            {n < 2 ? (
              <p className="bank-source-basis">{q.single}</p>
            ) : (
              <>
                <div className="gl-tb-actions">
                  {g.offers.accept && (
                    <Button
                      disabled={locked || !offered.accept}
                      data-bank-review-bulk="accept"
                      onClick={() => void s.decideGroup(g.signature, 'accept')}
                    >
                      {q.acceptAll(n)}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={locked || !offered.reject}
                    data-bank-review-bulk="reject"
                    onClick={() => void s.decideGroup(g.signature, 'reject')}
                  >
                    {q.rejectAll(n)}
                  </Button>
                </div>
                {!g.offers.accept && (
                  <p className="bank-source-basis">{q.noBulkAccept}</p>
                )}
                {!s.note.trim() && (
                  <p className="bank-source-basis">{q.needsNote}</p>
                )}
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}

function Sheet({
  r,
  s,
  locked,
}: {
  r: BankStatementResult;
  s: BankStatementSession;
  locked: boolean;
}) {
  const { lang } = useI18n(),
    c = bankStatementCopy[lang],
    h = bankSheetCopy[lang];
  const [signers, setSigners] = useState({
    prepared: { name: '', date: '' },
    reviewed: { name: '', date: '' },
  });
  const language = s.sheetForm.language || lang;
  const inputs = sheetInputs(
    s.sheet,
    s.sheetForm.balance,
    s.sheetForm.note,
    language,
    r.reading.decimals,
  );
  const amount = (n: number) => (
    <bdi dir="ltr">{money(n, r.reading.decimals)}</bdi>
  );
  const shown = r.sheet;
  const sheet =
    shown && shown.outcome.refusal === null ? shown.outcome.sheet : null;
  return (
    <section className="bank-sheet" data-bank-sheet>
      <h2>{h.title}</h2>
      <fieldset disabled={locked}>
        <p className="bank-source-basis">{h.screen.intro}</p>
        <div className="gl-tb-grid">
          <label>
            {h.screen.balance}
            <input
              inputMode="decimal"
              dir="ltr"
              aria-label={h.screen.balance}
              aria-invalid={inputs === 'book'}
              value={s.sheetForm.balance}
              onChange={(e) => s.setSheetForm({ balance: e.target.value })}
            />
          </label>
          <label>
            {h.screen.note}
            <input
              aria-label={h.screen.note}
              aria-invalid={inputs === 'note'}
              value={s.sheetForm.note}
              onChange={(e) => s.setSheetForm({ note: e.target.value })}
            />
          </label>
          <label>
            {h.screen.language}
            <select
              aria-label={h.screen.language}
              value={language}
              onChange={(e) =>
                s.setSheetForm({
                  language: e.target.value as SheetInputs['language'],
                })
              }
            >
              {(['ar', 'en'] as const).map((l) => (
                <option key={l} value={l}>
                  {h.screen.languages[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="bank-source-basis">{h.screen.balanceHint}</p>
        {typeof inputs === 'string' && (
          <p role="alert" data-bank-sheet-invalid={inputs}>
            {h.screen.invalid[inputs]}
          </p>
        )}
        <Button
          disabled={typeof inputs === 'string'}
          onClick={() => {
            if (typeof inputs !== 'string') void s.applySheet(inputs);
          }}
        >
          {h.screen.apply}
        </Button>
      </fieldset>
      {shown?.outcome.refusal && (
        <output
          className="bank-statement-held"
          data-bank-sheet-refusal={shown.outcome.refusal}
        >
          <p>{h.refusals[shown.outcome.refusal]}</p>
        </output>
      )}
      {sheet && (
        <>
          <h3 data-bank-sheet-status={sheet.status}>
            {h.status[sheet.status]}
          </h3>
          <Table
            title={h.sheetName}
            headers={h.screen.bridgeHeaders}
            testId="sheet"
            row={(cells) => cells}
            items={[
              [
                h.bank,
                amount(sheet.bank.balance),
                h.bankSource(sheet.bank.page),
              ],
              ...SHEET_SECTIONS.slice(0, 2).map((name) => [
                h.sections[name],
                amount(sheet.sections[name].total),
                h.screen.count(sheet.sections[name].items.length),
              ]),
              [h.adjustedBank, amount(sheet.adjustedBank), ''],
              [
                h.book,
                amount(sheet.book.balance),
                <bdi key="note">{h.screen.declared(sheet.book.note)}</bdi>,
              ],
              ...SHEET_SECTIONS.slice(2).map((name) => [
                h.sections[name],
                amount(sheet.sections[name].total),
                h.screen.count(sheet.sections[name].items.length),
              ]),
              [h.adjustedBook, amount(sheet.adjustedBook), ''],
              [h.difference, amount(sheet.difference), ''],
              ...(sheet.toleratedDifferences
                ? [
                    [
                      h.tolerance.section,
                      amount(sheet.tolerated!),
                      h.screen.count(sheet.toleratedDifferences.length),
                    ],
                    [h.tolerance.unexplained, amount(sheet.unexplained!), ''],
                  ]
                : []),
            ]}
          />
          {!!sheet.toleratedDifferences?.length && (
            <Table
              title={h.tolerance.section}
              headers={h.tolerance.screenHeaders}
              testId="sheet-tolerated"
              items={sheet.toleratedDifferences}
              row={(d) => [
                h.tolerance.directions[d.direction],
                d.case,
                <bdi key="statement" className="bank-statement-id">
                  {d.statement}
                </bdi>,
                <bdi key="cashbook" className="bank-statement-id">
                  {d.cashbook}
                </bdi>,
                amount(d.amounts.statement),
                amount(d.amounts.cashbook),
                amount(d.effect),
              ]}
            />
          )}
          {SHEET_SECTIONS.filter(
            (name) => sheet.sections[name].items.length > 0,
          ).map((name) => (
            <Table
              key={name}
              title={h.sections[name]}
              headers={h.screen.itemHeaders}
              testId={`sheet-${name}`}
              items={sheet.sections[name].items}
              row={(i) => [
                h.sides[i.side],
                <bdi key="id" className="bank-statement-id">
                  {i.id}
                </bdi>,
                <bdi key="period" dir="ltr">
                  {`${i.period.start} – ${i.period.end}`}
                </bdi>,
                i.page === null
                  ? c.rowCitation(String(i.row))
                  : c.pageOnly(i.page),
                <bdi key="date" dir="ltr">
                  {i.date}
                </bdi>,
                <bdi key="ref">{i.reference}</bdi>,
                c.directions[i.direction],
                amount(i.amount),
                h.origins[i.origin],
                i.case ?? '',
                i.reason
                  ? (c.reasons[i.reason as keyof typeof c.reasons] ?? i.reason)
                  : '',
                i.age ?? '',
              ]}
            />
          ))}
        </>
      )}
      {shown && (
        <fieldset disabled={locked} data-bank-sheet-signoffs>
          <legend>{h.screen.signoffs}</legend>
          {(['prepared', 'reviewed'] as const).map((kind) => {
            const given = shown[kind],
              typed = signers[kind],
              signoff = sheetSignoff(r, typed.name, typed.date);
            const type = (change: Partial<typeof typed>) =>
              setSigners((all) => ({
                ...all,
                [kind]: { ...all[kind], ...change },
              }));
            return (
              <div
                key={kind}
                data-bank-sheet-signoff={kind}
                data-bank-sheet-signoff-valid={
                  given ? String(given.valid) : 'none'
                }
              >
                <h3>{h[kind]}</h3>
                <p>
                  {given ? (
                    <>
                      <bdi>{given.name}</bdi> ·{' '}
                      <bdi dir="ltr">{given.date}</bdi> ·{' '}
                      {given.valid ? h.signoffValid : h.signoffVoid}
                    </>
                  ) : (
                    h.screen.none
                  )}
                </p>
                <div className="gl-tb-grid">
                  <label>
                    {h.screen.name}
                    <input
                      aria-label={`${h[kind]}: ${h.screen.name}`}
                      value={typed.name}
                      onChange={(e) => type({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    {h.signoffDate}
                    <input
                      type="date"
                      aria-label={`${h[kind]}: ${h.signoffDate}`}
                      value={typed.date}
                      onChange={(e) => type({ date: e.target.value })}
                    />
                  </label>
                </div>
                <Button
                  variant="outline"
                  disabled={!signoff}
                  onClick={() => {
                    if (signoff) void s.sign(kind, signoff);
                  }}
                >
                  {h.screen.sign[kind]}
                </Button>
              </div>
            );
          })}
          <p className="bank-source-basis">{h.screen.signHint}</p>
        </fieldset>
      )}
      {shown && <p className="bank-source-basis">{h.claim}</p>}
    </section>
  );
}
