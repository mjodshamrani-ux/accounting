import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  runningBalanceCopy,
  runningDiagnostic,
} from '@/lib/i18n/running-balance-review';
import { readFile } from '@/lib/reconciliation/io';
import {
  RUNNING_COLUMNS,
  RUNNING_CUTS,
  type RunningBalanceContext,
  type RunningCellEvidence,
  type RunningOptions,
} from '@/lib/reconciliation/running-balance';
import {
  RunningBalanceSession,
  saveRunningArtifact,
  restoreRunningArtifact,
  exportRunningWorkbook,
  type RunningSelection,
  type RunningReceipt,
  type RunningArtifact,
  type RunningAcknowledgements,
} from '@/lib/reconciliation/running-balance-session';
import type { Scope, SourceFile } from '@/lib/reconciliation/types';
import './running-balance-review.css';

type Props = {
  files: [SourceFile | null, SourceFile | null];
  scope: Scope;
  extractionRevision: string;
};
const ackKeys = [
  'originalRowsReviewed',
  'referenceRolesReviewed',
  'separateAmountsReviewed',
  'perspectiveReviewed',
  'currencyReviewed',
  'balancesReviewed',
  'sequenceReviewed',
  'totalsReviewed',
  'derivedSourceUnderstood',
] as const;
type AckDraft = Record<(typeof ackKeys)[number], boolean>;
const emptyAck = () =>
  Object.fromEntries(ackKeys.map((key) => [key, false])) as AckDraft;
function download(name: string, bytes: string | ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RunningBalanceReview(props: Props) {
  const { lang } = useI18n();
  const t = runningBalanceCopy[lang];
  const [open, setOpen] = useState(false);
  return (
    <section
      className="surface running-review"
      data-testid="running-balance-disclosure"
    >
      <div className="running-review__heading">
        <span className="running-review__icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <span className="running-review__eyebrow">{t.eyebrow}</span>
          <h2>{t.title}</h2>
          <p>{t.intro}</p>
        </div>
        <Button
          variant="outline"
          type="button"
          data-testid="running-balance-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t.close : t.open}
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
      </div>
      {open && <RunningPanel {...props} />}
    </section>
  );
}

function RunningPanel(props: Props) {
  const binding = useMemo(
    () => ({
      files: props.files,
      scope: props.scope,
      revision: props.extractionRevision,
    }),
    [props.files, props.scope, props.extractionRevision],
  );
  const [chosen, setChosen] = useState<{
    binding: typeof binding;
    side: string;
  } | null>(null);
  const side = chosen?.binding === binding ? chosen.side : '';
  return (
    <RunningSourcePanel
      key={`${side}:${JSON.stringify(props.scope)}:${props.extractionRevision}`}
      {...props}
      side={side}
      onSideChange={(value) => setChosen({ binding, side: value })}
    />
  );
}

function RunningSourcePanel({
  files,
  scope,
  extractionRevision,
  side,
  onSideChange,
}: Props & { side: string; onSideChange: (value: string) => void }) {
  const { lang } = useI18n();
  const t = runningBalanceCopy[lang];
  const [cutsReviewed, setCutsReviewed] = useState(false);
  const [selection, setSelection] = useState<RunningSelection | null>(null);
  const [receipt, setReceipt] = useState<RunningReceipt | null>(null);
  const [artifact, setArtifact] = useState<RunningArtifact | null>(null);
  const [historical, setHistorical] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [rationale, setRationale] = useState('');
  const [ack, setAck] = useState<AckDraft>(emptyAck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const [offset, setOffset] = useState(0);
  const [movementOffset, setMovementOffset] = useState(0);
  const [proposalOffset, setProposalOffset] = useState(0);
  const [controlOffset, setControlOffset] = useState(0);
  const operation = useRef({
    generation: 0,
    abort: null as AbortController | null,
  });
  const session = useRef<RunningBalanceSession | null>(null);
  const ownedSource = useRef<SourceFile | null>(null);
  const context = useMemo<RunningBalanceContext>(
    () => ({
      columns: RUNNING_COLUMNS,
      currency: 'SAR',
      decimals: 2,
      perspective: 'debit-minus-credit',
      extractionRevision: `${extractionRevision}:running-balance-v1`,
    }),
    [extractionRevision],
  );
  const file = side === '' ? null : files[Number(side)];
  useEffect(() => {
    const pending = operation.current;
    const ownedSession = session;
    return () => {
      pending.generation++;
      pending.abort?.abort();
      ownedSession.current?.invalidate();
    };
  }, []);
  function invalidateDecision() {
    operation.current.generation++;
    operation.current.abort?.abort();
    session.current?.updateReviewer(reviewer, rationale);
    setReceipt(null);
    setArtifact(null);
    setHistorical(false);
    setBusy(false);
    setNotice('');
  }
  async function run<T>(
    work: (options: RunningOptions) => Promise<T>,
    publish: (result: T) => void,
  ) {
    operation.current.abort?.abort();
    const controller = new AbortController();
    operation.current.abort = controller;
    const generation = ++operation.current.generation;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress(t.checking);
    const check = () => {
      if (
        controller.signal.aborted ||
        generation !== operation.current.generation
      )
        throw new Error('cancelled');
    };
    const options: RunningOptions = {
      signal: controller.signal,
      checkCurrent: check,
      onProgress: (p) => {
        check();
        setProgress(`${p.completed} / ${p.total}`);
      },
    };
    try {
      const result = await work(options);
      check();
      publish(result);
    } catch (failure) {
      if (generation === operation.current.generation) {
        setReceipt(null);
        setError(
          controller.signal.aborted || String(failure).includes('cancelled')
            ? t.cancelled
            : t.error,
        );
      }
    } finally {
      if (generation === operation.current.generation) {
        setBusy(false);
        setProgress('');
      }
    }
  }
  function cancel() {
    operation.current.generation++;
    operation.current.abort?.abort();
    session.current?.invalidate();
    setReceipt(null);
    setSelection(null);
    setBusy(false);
    setProgress('');
    setNotice(t.cancelled);
  }
  const review = selection?.review;
  const allSelected =
    !!selection &&
    selection.selectedMovementRows.length === review!.movements.length &&
    selection.selectedProposalIds.length === review!.proposals.length;
  const canRecord =
    !busy &&
    !!reviewer.trim() &&
    !!rationale.trim() &&
    ackKeys.every((key) => ack[key]);
  function choose(rows: number[], ids: string[]) {
    invalidateDecision();
    if (session.current)
      void run(
        (options) => session.current!.select(rows, ids, options),
        setSelection,
      );
  }
  function record(decision: 'accept' | 'reject') {
    if (!session.current || !selection) return;
    const live = session.current;
    const current = selection;
    void run(
      (options) =>
        live.recordReviewerDecision(
          {
            decision,
            reviewerLabel: reviewer,
            rationale,
            reviewedSourceHash: current.review.sourceHash,
            reviewedExtractionHash: current.review.extractionHash,
            reviewedContextHash: current.review.contextHash,
            reviewedSelectionHash: current.selectionHash,
            acknowledgements: ack as RunningAcknowledgements,
          },
          { ...options, currentSelection: current },
        ),
      (result) => {
        setReceipt(result);
        if (!result) setNotice(t.rejected);
      },
    );
  }
  function proof(cell: RunningCellEvidence, key: string | number) {
    return (
      <div className="running-review__proof" key={key}>
        <span>
          {t.page} {cell.page} · {t.row} {cell.row} · {t.column} {cell.column}
        </span>
        <code dir="auto">{JSON.stringify(cell.literal)}</code>
        <span>
          <bdi>
            {cell.spanStartInclusive}–{cell.spanEndExclusive}
          </bdi>{' '}
          · UTF-16
        </span>
        <code dir="ltr">{cell.sourceHash}</code>
      </div>
    );
  }
  const fields = [
    'seq',
    'date',
    'reference',
    'description',
    'debit',
    'credit',
    'balance',
  ] as const;
  function pager(start: number, total: number, update: (n: number) => void) {
    return (
      <div className="running-review__actions">
        <Button
          variant="outline"
          disabled={!start}
          onClick={() => update(Math.max(0, start - 20))}
        >
          {t.previous}
        </Button>
        <output>
          {Math.min(start + 1, total)}–{Math.min(start + 20, total)} / {total}
        </output>
        <Button
          variant="outline"
          disabled={start + 20 >= total}
          onClick={() => update(start + 20)}
        >
          {t.next}
        </Button>
      </div>
    );
  }
  return (
    <div className="running-review__body" data-testid="running-balance-panel">
      <p className="running-review__limit">{t.limit}</p>
      <div className="running-review__source">
        <label>
          {t.source}
          <select
            data-testid="running-balance-source"
            value={side}
            disabled={busy}
            onChange={(e) => onSideChange(e.target.value)}
          >
            <option value="">{t.choose}</option>
            {files.map((source, i) =>
              source?.original && /\.pdf$/i.test(source.name) ? (
                <option value={String(i)} key={i}>
                  {i === 0 ? t.supplier : t.ledger} · {source.name}
                </option>
              ) : null,
            )}
          </select>
        </label>
      </div>
      {file ? (
        <>
          <label className="running-review__check">
            <input
              data-testid="running-balance-cuts-ack"
              type="checkbox"
              disabled={busy}
              checked={cutsReviewed}
              onChange={(e) => {
                invalidateDecision();
                setSelection(null);
                setCutsReviewed(e.target.checked);
              }}
            />
            {t.cuts}
          </label>
          <div className="running-review__actions">
            <Button
              data-testid="running-balance-inspect"
              disabled={
                busy ||
                !cutsReviewed ||
                scope.currency !== 'SAR' ||
                scope.decimals !== 2
              }
              onClick={() => {
                setReceipt(null);
                setArtifact(null);
                setSelection(null);
                setAck(emptyAck());
                setOffset(0);
                void run(async (options) => {
                  const source = await readFile(
                    file.name,
                    file.original!.slice(0),
                    [...RUNNING_CUTS],
                    false,
                    (p) => {
                      options.checkCurrent?.();
                      options.onProgress?.(p);
                    },
                    32767,
                  );
                  options.checkCurrent?.();
                  const live = new RunningBalanceSession(
                    source,
                    context,
                    options,
                  );
                  session.current = live;
                  ownedSource.current = source;
                  return live.inspect(options);
                }, setSelection);
              }}
            >
              {t.inspect}
              <FileCheck2 size={16} aria-hidden="true" />
            </Button>
            {busy && (
              <Button
                variant="outline"
                data-testid="running-balance-cancel"
                onClick={cancel}
              >
                {t.cancel}
              </Button>
            )}
            <output aria-live="polite">{progress}</output>
          </div>
        </>
      ) : (
        <p>{t.empty}</p>
      )}
      {error && (
        <p
          role="alert"
          className="running-review__error"
          data-testid="running-balance-error"
        >
          {error}
        </p>
      )}
      {notice && <output>{notice}</output>}
      {review && (
        <>
          <div
            className={`running-review__status${review.state === 'blocked' ? ' is-blocked' : ''}`}
            data-testid="running-balance-status"
          >
            <CheckCircle2 size={18} aria-hidden="true" />
            <strong>{review.state === 'blocked' ? t.blocked : t.ready}</strong>
          </div>
          {review.declaredScope && (
            <p data-testid="running-balance-declared-scope">
              <bdi>
                {review.declaredScope.statement} ·{' '}
                {review.declaredScope.account} ·{' '}
                {review.declaredScope.periodStart} —{' '}
                {review.declaredScope.periodEnd}
              </bdi>
            </p>
          )}
          {review.diagnostics.length > 0 && (
            <ul data-testid="running-balance-diagnostics">
              {review.diagnostics.map((d, i) => (
                <li key={i}>
                  {runningDiagnostic[lang][
                    d.code as keyof typeof runningDiagnostic.ar
                  ] ?? t.error}
                  {d.row ? ` · ${t.row} ${d.row}` : ''}
                  {d.page ? ` · ${t.page} ${d.page}` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="running-review__stats">
            <div>
              <span>{t.opening} · SAR</span>
              <strong>
                <bdi>
                  {review.rows.find((r) => r.values[0] === 'Opening balance')
                    ?.values[6] ?? '—'}
                </bdi>
              </strong>
            </div>
            <div>
              <span>{t.count}</span>
              <strong>{review.movements.length}</strong>
            </div>
            <div>
              <span>{t.closing} · SAR</span>
              <strong>
                <bdi>
                  {review.rows.find((r) => r.values[0] === 'Closing balance')
                    ?.values[6] ?? '—'}
                </bdi>
              </strong>
            </div>
          </div>
          <div className="running-review__section">
            <h3>{t.original}</h3>
            <section className="running-review__scroll" aria-label={t.original}>
              <table data-testid="running-balance-inventory">
                <thead>
                  <tr>
                    <th>{t.row}</th>
                    <th>{t.page}</th>
                    {fields.map((f) => (
                      <th key={f}>{t[f]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {review.rows.slice(offset, offset + 20).map((r) => (
                    <tr key={r.originalRow}>
                      <td>{r.originalRow}</td>
                      <td>{r.page}</td>
                      {r.values.map((value, i) => (
                        <td key={i}>
                          <bdi>{value}</bdi>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div className="running-review__actions">
              <Button
                variant="outline"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                {t.previous}
              </Button>
              <output>
                {Math.min(offset + 1, review.rows.length)}–
                {Math.min(offset + 20, review.rows.length)} /{' '}
                {review.rows.length}
              </output>
              <Button
                variant="outline"
                disabled={offset + 20 >= review.rows.length}
                onClick={() => setOffset(offset + 20)}
              >
                {t.next}
              </Button>
            </div>
          </div>
          <details data-testid="running-balance-steps">
            <summary>
              {t.steps} · {review.balanceSteps.length}
            </summary>
            <div className="running-review__section">
              <p>{t.minor}</p>
              {review.balanceSteps
                .slice(movementOffset, movementOffset + 20)
                .map((s, i) => (
                  <div className="running-review__proof" key={i}>
                    <strong>
                      {t.row} {s.originalRow}
                    </strong>
                    <span>
                      {t.previousBalance}:{' '}
                      <bdi>{s.previousProvidedMinor ?? '—'}</bdi>
                    </span>
                    <span>
                      {t.debit}: <bdi>{s.debitProvidedMinor ?? '—'}</bdi> ·{' '}
                      {t.credit}: <bdi>{s.creditProvidedMinor ?? '—'}</bdi>
                    </span>
                    <span>
                      {t.computed}: <bdi>{s.computedMinor ?? '—'}</bdi>
                    </span>
                    <span>
                      {t.provided}: <bdi>{s.nextProvidedMinor ?? '—'}</bdi>
                    </span>
                    <span>
                      {t.difference}: <bdi>{s.differenceMinor ?? '—'}</bdi>
                    </span>
                    {s.previousEvidence &&
                      proof(s.previousEvidence, 'previous')}
                    {proof(s.nextEvidence, 'next')}
                  </div>
                ))}
              {pager(
                movementOffset,
                review.balanceSteps.length,
                setMovementOffset,
              )}
            </div>
          </details>
          <details>
            <summary>
              {t.controls} · {review.controls.length}
            </summary>
            <div className="running-review__section">
              {review.controls
                .slice(controlOffset, controlOffset + 20)
                .map((c, i) => (
                  <div className="running-review__proof" key={i}>
                    <strong>
                      <bdi>{review.rows[c.originalRow - 1]?.values[0]}</bdi> ·{' '}
                      {t.page} {c.page}
                    </strong>
                    <span>
                      {t.difference}:{' '}
                      <bdi>
                        {c.differenceMinor ?? c.debitDifferenceMinor ?? '—'}
                      </bdi>
                      {c.creditDifferenceMinor !== undefined && (
                        <>
                          {' '}
                          · {t.credit}:{' '}
                          <bdi>{c.creditDifferenceMinor ?? '—'}</bdi>
                        </>
                      )}
                    </span>
                    {c.evidence.map((e, n) => proof(e, n))}
                  </div>
                ))}
              {pager(controlOffset, review.controls.length, setControlOffset)}
            </div>
          </details>
          {review.state === 'review-ready' && (
            <>
              <div className="running-review__section">
                <h3>{t.selection}</h3>
                <p>{t.complete}</p>
                <div className="running-review__actions">
                  <Button
                    variant="outline"
                    data-testid="running-balance-select-all"
                    disabled={busy}
                    onClick={() =>
                      choose(
                        review.movements.map((m) => m.originalRow),
                        review.proposals.map((p) => p.id),
                      )
                    }
                  >
                    {t.all}
                  </Button>
                  <output>
                    {t.selected}: {selection!.selectedMovementRows.length}/
                    {review.movements.length} · {t.proposals}:{' '}
                    {selection!.selectedProposalIds.length}/
                    {review.proposals.length}
                  </output>
                </div>
                {review.movements
                  .slice(movementOffset, movementOffset + 20)
                  .map((m) => (
                    <details
                      key={m.originalRow}
                      data-testid="running-balance-movement"
                    >
                      <summary
                        aria-label={`${t.movement} ${m.seq} · ${m.reference}`}
                      >
                        <label
                          className="running-review__check"
                          aria-label={`${t.movement} ${m.seq}`}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${t.movement} ${m.seq}`}
                            data-testid={`running-balance-movement-${m.seq}`}
                            disabled={busy}
                            checked={selection!.selectedMovementRows.includes(
                              m.originalRow,
                            )}
                            onChange={(e) =>
                              choose(
                                e.target.checked
                                  ? [
                                      ...selection!.selectedMovementRows,
                                      m.originalRow,
                                    ]
                                  : selection!.selectedMovementRows.filter(
                                      (r) => r !== m.originalRow,
                                    ),
                                selection!.selectedProposalIds,
                              )
                            }
                          />
                          <span>
                            <bdi>
                              {m.seq} · {m.date} · {m.reference} · {t.balance}:{' '}
                              {m.balance}
                            </bdi>
                          </span>
                        </label>
                      </summary>
                      <div className="running-review__section">
                        <p>
                          {m.referenceOrigin === 'explicit-source-cell'
                            ? t.explicit
                            : t.inherited}
                        </p>
                        {[
                          m.seqEvidence,
                          m.dateEvidence,
                          m.referenceEvidence,
                          m.descriptionEvidence,
                          m.debitEvidence,
                          m.creditEvidence,
                          m.balanceEvidence,
                          m.parentEvidence,
                          ...m.continuationEvidence,
                        ].map((e, i) => proof(e, i))}
                      </div>
                    </details>
                  ))}
                {pager(
                  movementOffset,
                  review.movements.length,
                  setMovementOffset,
                )}
                {review.proposals
                  .slice(proposalOffset, proposalOffset + 20)
                  .map((p) => (
                    <details key={p.id}>
                      <summary
                        aria-label={`${t.reference} ${p.reference} · ${t.row} ${p.evidence.target.row}`}
                      >
                        <label className="running-review__check">
                          <input
                            type="checkbox"
                            aria-label={`${t.reference} ${p.reference} · ${t.row} ${p.evidence.target.row}`}
                            data-testid="running-balance-proposal"
                            disabled={busy}
                            checked={selection!.selectedProposalIds.includes(
                              p.id,
                            )}
                            onChange={(e) =>
                              choose(
                                selection!.selectedMovementRows,
                                e.target.checked
                                  ? [...selection!.selectedProposalIds, p.id]
                                  : selection!.selectedProposalIds.filter(
                                      (id) => id !== p.id,
                                    ),
                              )
                            }
                          />
                          <span>
                            {t.reference} · <bdi>{p.reference}</bdi> · {t.row}{' '}
                            {p.evidence.target.row}
                          </span>
                        </label>
                      </summary>
                      <div className="running-review__section">
                        {[
                          p.evidence.target,
                          p.evidence.parent,
                          ...p.evidence.continuations,
                          ...p.evidence.headers.flat(),
                        ].map((e, i) => proof(e, i))}
                      </div>
                    </details>
                  ))}
                {pager(
                  proposalOffset,
                  review.proposals.length,
                  setProposalOffset,
                )}
              </div>
              <div className="running-review__decision">
                <h3>{t.review}</h3>
                <div className="running-review__form">
                  <label>
                    {t.reviewer}
                    <Input
                      data-testid="running-balance-reviewer"
                      disabled={busy}
                      maxLength={200}
                      value={reviewer}
                      onChange={(e) => {
                        invalidateDecision();
                        setReviewer(e.target.value);
                        session.current?.updateReviewer(
                          e.target.value,
                          rationale,
                        );
                      }}
                    />
                  </label>
                  <label>
                    {t.rationale}
                    <textarea
                      data-testid="running-balance-rationale"
                      disabled={busy}
                      maxLength={4000}
                      value={rationale}
                      onChange={(e) => {
                        invalidateDecision();
                        setRationale(e.target.value);
                        session.current?.updateReviewer(
                          reviewer,
                          e.target.value,
                        );
                      }}
                    />
                  </label>
                </div>
                {ackKeys.map((key) => (
                  <label className="running-review__check" key={key}>
                    <input
                      type="checkbox"
                      data-testid={`running-balance-ack-${key}`}
                      disabled={busy}
                      checked={ack[key]}
                      onChange={(e) => {
                        invalidateDecision();
                        setAck((previous) => ({
                          ...previous,
                          [key]: e.target.checked,
                        }));
                      }}
                    />
                    {t[key]}
                  </label>
                ))}
                <div className="running-review__actions">
                  <Button
                    data-testid="running-balance-accept"
                    disabled={!canRecord || !allSelected}
                    onClick={() => record('accept')}
                  >
                    {t.accept}
                  </Button>
                  <Button
                    variant="outline"
                    data-testid="running-balance-reject"
                    disabled={!canRecord}
                    onClick={() => record('reject')}
                  >
                    {t.reject}
                  </Button>
                </div>
                {receipt && (
                  <>
                    <p data-testid="running-balance-receipt">{t.receipt}</p>
                    <Button
                      data-testid="running-balance-apply"
                      disabled={busy}
                      onClick={() => {
                        const live = receipt;
                        setReceipt(null);
                        void run(
                          (options) =>
                            session.current!.apply(
                              live,
                              ownedSource.current!,
                              context,
                              { ...options, currentSelection: selection! },
                            ),
                          (result) => {
                            setArtifact(result);
                            setHistorical(false);
                          },
                        );
                      }}
                    >
                      {t.apply}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
      {artifact && (
        <div
          className="running-review__artifact"
          data-testid="running-balance-artifact"
        >
          <h3>{t.artifact}</h3>
          <p>{historical ? t.historical : t.complete}</p>
          <div className="running-review__actions">
            <Button
              variant="outline"
              disabled={busy}
              data-testid="running-balance-download-csv"
              onClick={() =>
                void run(
                  (options) => saveRunningArtifact(artifact, options),
                  () =>
                    download(
                      'running-balance.csv',
                      artifact.csv,
                      'text/csv;charset=utf-8',
                    ),
                )
              }
            >
              {t.csv}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="running-balance-download-pdf"
              onClick={() =>
                void run(
                  (options) => saveRunningArtifact(artifact, options),
                  () =>
                    download(
                      'running-balance-original.pdf',
                      artifact.originalPdf,
                      'application/pdf',
                    ),
                )
              }
            >
              {t.pdf}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="running-balance-save"
              onClick={() =>
                void run(
                  (options) => saveRunningArtifact(artifact, options),
                  (bytes) =>
                    download(
                      'running-balance-artifact.json',
                      bytes,
                      'application/json',
                    ),
                )
              }
            >
              {t.save}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="running-balance-excel"
              onClick={() =>
                void run(
                  (options) => exportRunningWorkbook(artifact, options),
                  (bytes) =>
                    download(
                      'running-balance-evidence.xlsx',
                      bytes,
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    ),
                )
              }
            >
              {t.excel}
            </Button>
          </div>
        </div>
      )}
      <details>
        <summary>{t.restore}</summary>
        <div className="running-review__section">
          <label className="running-review__check">
            {t.restore}
            <input
              type="file"
              accept=".json,application/json"
              data-testid="running-balance-restore"
              disabled={busy}
              onChange={(e) => {
                const saved = e.target.files?.[0];
                e.target.value = '';
                if (!saved) return;
                invalidateDecision();
                session.current?.invalidate();
                setSelection(null);
                setArtifact(null);
                void run(
                  async (options) => {
                    if (saved.size > 64 * 1024 * 1024)
                      throw new Error('resource-limit');
                    const bytes = await saved.arrayBuffer();
                    options.checkCurrent?.();
                    return restoreRunningArtifact(bytes, options);
                  },
                  (result) => {
                    setArtifact(result);
                    setHistorical(true);
                  },
                );
              }}
            />
          </label>
          <p>{t.historical}</p>
        </div>
      </details>
    </div>
  );
}
