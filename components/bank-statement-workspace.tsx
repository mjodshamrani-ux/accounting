import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
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
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import { currencyPrecision } from '@/lib/reconciliation/currency-precision';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import type {
  BankStatementReplay,
  BankStatementResult,
  BankStatementRollReplay,
  BankStatementSheetReplay,
  StatementCase,
} from '@/lib/reconciliation/bank-statement-lifecycle';
import {
  BANK_STATEMENT_SESSION_LIMIT,
  type SheetInputs,
  type SheetSignoff,
  type StatementDecision,
  type StatementSource,
} from '@/lib/reconciliation/bank-statement-request';
import { SHEET_SECTIONS } from '@/lib/reconciliation/bank-statement-sheet';
import {
  BANK_CASHBOOK_FORMATS,
  BANK_STATEMENT_CURRENCIES,
  BANK_STATEMENT_FORMATS,
  carriedAtEnd,
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
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<Failure | null>(null);
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
  const state = (
    decisions: StatementDecision[],
    inputs: SheetInputs | null = sheet,
  ) =>
    pdf && inputs
      ? sheetStatementState(statement!, cashbook!, decisions, previous, inputs)
      : period(decisions);
  function invalidate() {
    setResult(null);
    setFailure(null);
  }
  function install(v: Replay, restored = false) {
    const [s, c] = v.state.files;
    setStatement(s);
    setCashbook(c);
    // A restored session brings its own previous file or none; a table's
    // comparison keeps a hidden one for when a printed statement returns.
    if ('previous' in v.state) setPrevious(v.state.previous);
    else if (restored) setPrevious(null);
    // The sheet inputs come with the state that holds them: a comparison
    // starts without them, and a session restores its own or none.
    const inputs = 'sheet' in v.state ? v.state.sheet : null;
    setSheet(inputs);
    setSheetForm(sheetFormOf(inputs, v.result.reading.decimals));
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
    sheet,
    sheetForm,
    note,
    busy,
    failure,
    pdf,
    ready,
    hasWork: !!(statement || cashbook),
    setNote,
    setSheetForm(change: Partial<SheetForm>) {
      setSheetForm((form) => ({ ...form, ...change }));
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
      perform(async (signal) =>
        install(
          await workerTask<Replay>(
            'bank-statement-reconcile',
            state([], null),
            signal,
          ),
        ),
      ),
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
      perform(async (signal) =>
        install(
          await workerTask<Replay>(
            'bank-statement-restore',
            { buffer },
            signal,
          ),
          true,
        ),
      ),
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
  const format = (n: number | null | undefined) =>
    n === null || n === undefined ? '' : money(n, r.reading.decimals);
  const held = r.match.held ? heldReason(r.match.held.reason) : null;
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
      <h2 data-bank-statement-status={r.status}>{c.status[r.status]}</h2>
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
            {c.held[held.kind]}{' '}
            {held.detail && <bdi dir="ltr">{held.detail}</bdi>}
          </p>
          <p>{c.heldCounts(r.match.held.statement, r.match.held.cashbook)}</p>
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
      <p className="bank-source-basis" data-bank-statement-claim>
        {r.sheet ? c.claimWithSheet : c.claim}
      </p>
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

/** The closing reconciliation sheet of a printed statement's period
 * (bank-reconciliation-sheet-1, proposed): its inputs, the sheet or the
 * refusal in its place, and the sign-offs with their standing. Every figure
 * is the replayed result's; nothing here adds or nets an amount. */
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
            ]}
          />
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
