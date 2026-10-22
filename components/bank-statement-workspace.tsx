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
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import { currencyPrecision } from '@/lib/reconciliation/currency-precision';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import type {
  BankStatementReplay,
  BankStatementResult,
  StatementCase,
} from '@/lib/reconciliation/bank-statement-lifecycle';
import type {
  StatementDecision,
  StatementSource,
} from '@/lib/reconciliation/bank-statement-request';
import {
  BANK_CASHBOOK_FORMATS,
  BANK_STATEMENT_CURRENCIES,
  BANK_STATEMENT_FORMATS,
  heldReason,
  parseStatementClosing,
  statementActions,
  statementDecision,
  statementError,
  statementMember,
  statementState,
  type StatementErrorKind,
} from '@/lib/reconciliation/bank-statement-view';

type Role = 'statement' | 'cashbook';
type Failure = { kind: StatementErrorKind; detail: string };

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
    [currency, setCurrency] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [closing, setClosing] = useState(''),
    [result, setResult] = useState<BankStatementResult | null>(null),
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
  const state = (decisions: StatementDecision[]) =>
    statementState(statement!, cashbook!, scope(), decisions);
  function invalidate() {
    setResult(null);
    setFailure(null);
  }
  function install(v: BankStatementReplay) {
    const [s, c] = v.state.files;
    setStatement(s);
    setCashbook(c);
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
    currency,
    start,
    end,
    closing,
    closingInvalid,
    result,
    note,
    busy,
    failure,
    pdf,
    ready,
    hasWork: !!(statement || cashbook),
    setNote,
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
        role === 'statement' ? BANK_STATEMENT_FORMATS : BANK_CASHBOOK_FORMATS;
      // A late reply or digest for the previous file must never be installed.
      const id = ++serial.current;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
      invalidate();
      if (file.size > MAX_FILE_BYTES || !formats.test(file.name)) {
        setFailure({ kind: 'other', detail: file.name });
        return;
      }
      const chosen = await sourceOf(file);
      if (id !== serial.current) return;
      if (role === 'statement') setStatement(chosen);
      else setCashbook(chosen);
    },
    compare: () =>
      perform(async (signal) =>
        install(
          await workerTask<BankStatementReplay>(
            'bank-statement-reconcile',
            state([]),
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
          await workerTask<BankStatementReplay>(
            'bank-statement-reconcile',
            state([...result.decisions, decision]),
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
          await workerTask<BankStatementReplay>(
            'bank-statement-restore',
            { buffer },
            signal,
          ),
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
        {k.kind === 'review' && (
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
      <p className="bank-source-basis">{c.claim}</p>
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
