import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  splitSectionReviewCopy,
  splitSectionReason,
  splitSectionKind,
} from '@/lib/i18n/split-section-review';
import {
  SplitSectionSession,
  saveSplitArtifact,
  restoreSplitArtifact,
  exportSplitWorkbook,
} from '@/lib/reconciliation/split-section-session';
import type { Mapping, Scope, SourceFile } from '@/lib/reconciliation/types';

type Props = {
  files: [SourceFile | null, SourceFile | null];
  mappings: [Mapping, Mapping];
  scope: Scope;
  extractionRevision?: string;
};
type Selection = Awaited<ReturnType<SplitSectionSession['inspect']>>;
type Receipt = Awaited<
  ReturnType<SplitSectionSession['recordReviewerDecision']>
>;
type Artifact = Awaited<ReturnType<SplitSectionSession['apply']>>;
type Evidence = Selection['review']['movements'][number]['debitEvidence'];
const fields = [
  'originalRowsReviewed',
  'referenceRolesReviewed',
  'separateAmountsReviewed',
  'perspectiveReviewed',
  'currencyReviewed',
  'totalsReviewed',
  'derivedSourceUnderstood',
] as const;
type Ack = Record<(typeof fields)[number], boolean>;
const emptyAck = (): Ack =>
  Object.fromEntries(fields.map((key) => [key, false])) as Ack;
function literalMapping(m: Mapping) {
  return (
    m.sheet === 0 &&
    m.header === 2 &&
    m.date === 0 &&
    m.reference === 1 &&
    m.description === 2 &&
    m.debit === 3 &&
    m.credit === 4 &&
    m.amount === -1 &&
    m.currencyColumn === -1 &&
    m.mode === 'split' &&
    m.multiplier === 1 &&
    m.numberFormat === 'dot' &&
    m.dateFormat === 'ymd' &&
    m.reportType === 'transactions' &&
    m.opening === '' &&
    m.closing === '' &&
    m.periodStart === '' &&
    !m.directionEvidence &&
    !m.formatChoice &&
    Object.keys(m.excluded).length === 0
  );
}
class PendingOperation {
  generation = 0;
  abort: AbortController | null = null;
  advance() {
    return ++this.generation;
  }
  replaceAbort(controller: AbortController) {
    this.abort = controller;
  }
}
const buttonClass = 'h-auto max-w-full min-w-0 whitespace-normal text-start';
function download(name: string, bytes: string | ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SplitSectionReview(props: Props) {
  const { lang } = useI18n();
  const t = splitSectionReviewCopy(lang);
  const [open, setOpen] = useState(false);
  return (
    <section
      data-testid="split-section-disclosure"
      className="min-w-0 max-w-full"
    >
      <Button
        type="button"
        variant="outline"
        className={buttonClass}
        aria-expanded={open}
        data-testid="split-section-toggle"
        onClick={() => setOpen(!open)}
      >
        {open ? t.close : t.open}
      </Button>
      {open && <SplitSourcePicker {...props} />}
    </section>
  );
}
function SplitSourcePicker(props: Props) {
  const { lang } = useI18n();
  const t = splitSectionReviewCopy(lang);
  const binding = useMemo(
    () => ({
      files: props.files,
      mappings: props.mappings,
      scope: props.scope,
      revision: props.extractionRevision,
    }),
    [props.files, props.mappings, props.scope, props.extractionRevision],
  );
  const [chosen, setChosen] = useState<{
    binding: typeof binding;
    side: string;
  } | null>(null);
  const side = chosen?.binding === binding ? chosen.side : '';
  const index = side === '0' ? 0 : 1;
  const file = side ? props.files[index] : null;
  return (
    <div
      className="min-w-0 border rounded p-3 space-y-3"
      data-testid="split-section-picker"
    >
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{t.context}</p>
      <label>
        {t.source}
        <select
          className="block max-w-full border p-2"
          data-testid="split-section-source"
          value={side}
          onChange={(e) => setChosen({ binding, side: e.target.value })}
        >
          <option value="">{t.source}</option>
          {props.files.map(
            (source, i) =>
              source && (
                <option key={i} value={String(i)}>
                  {i === 0 ? t.supplier : t.ledger} · {source.name}
                </option>
              ),
          )}
        </select>
      </label>
      {file?.pdf &&
      !file.pdf.autoColumns &&
      file.pdf.cuts.length === 4 &&
      literalMapping(props.mappings[index]) ? (
        <SplitPanel
          key={`${side}:${JSON.stringify(props.scope)}:${JSON.stringify(props.mappings[index])}:${props.extractionRevision ?? ''}`}
          file={file}
          mapping={props.mappings[index]}
          scope={props.scope}
          revision={props.extractionRevision ?? 'native-split-section-v1'}
        />
      ) : (
        <p data-testid="split-section-unavailable">{t.missing}</p>
      )}
      <HistoricalArchive />
    </div>
  );
}
function SplitPanel({
  file,
  mapping,
  scope,
  revision,
}: {
  file: SourceFile;
  mapping: Mapping;
  scope: Scope;
  revision: string;
}) {
  const { lang } = useI18n();
  const t = splitSectionReviewCopy(lang);
  const context = useMemo(
    () => ({
      mapping,
      currency: 'SAR' as const,
      decimals: 2 as const,
      perspective: 'debit-minus-credit' as const,
      extractionRevision: revision,
    }),
    [mapping, revision],
  );
  const session = useMemo(
    () => new SplitSectionSession(file, context),
    [file, context],
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [receipt, setReceipt] = useState<Receipt>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [rationale, setRationale] = useState('');
  const [ack, setAck] = useState<Ack>(emptyAck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [offset, setOffset] = useState(0);
  const operation = useMemo(() => new PendingOperation(), []);
  const scopeReady = scope.currency === 'SAR' && scope.decimals === 2;
  useEffect(
    () => () => {
      operation.advance();
      operation.abort?.abort();
      session.invalidate();
    },
    [session, operation],
  );
  function invalidate() {
    setReceipt(null);
    setArtifact(null);
    session.updateReviewer(reviewer, rationale);
  }
  async function run(
    action: (options: {
      signal: AbortSignal;
      onProgress: (p: {
        stage: string;
        completed: number;
        total: number;
      }) => void;
    }) => Promise<void>,
  ) {
    operation.abort?.abort();
    const controller = new AbortController();
    operation.replaceAbort(controller);
    const ticket = operation.advance();
    setBusy(true);
    setError('');
    setProgress('');
    const options = {
      signal: controller.signal,
      onProgress: (p: { stage: string; completed: number; total: number }) => {
        if (ticket === operation.generation)
          setProgress(`${p.completed} / ${p.total}`);
      },
    };
    try {
      await action(options);
    } catch (e) {
      if (ticket === operation.generation) {
        setReceipt(null);
        setArtifact(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (ticket === operation.generation) setBusy(false);
    }
  }
  const evidence = (e: Evidence) => (
    <p className="break-all" data-testid="split-section-cell">
      <bdi>
        {t.sheet} {e.sheet} · {t.page} {e.page} · {t.row} {e.row} · {t.column}{' '}
        {e.column}
      </bdi>{' '}
      <mark>
        <bdi>{e.literal || '∅'}</bdi>
      </mark>
    </p>
  );
  const allSelected =
    !!selection &&
    selection.selectedMovementRows.length ===
      selection.review.movements.length &&
    selection.selectedProposalIds.length === selection.review.proposals.length;
  const canRecord =
    !!selection &&
    scopeReady &&
    !busy &&
    reviewer.trim() !== '' &&
    rationale.trim() !== '' &&
    fields.every((key) => ack[key]);
  async function choose(rows: number[], ids: string[]) {
    invalidate();
    setAck(emptyAck());
    await run(async (options) => {
      const next = await session.select(rows, ids, options);
      if (!options.signal.aborted) setSelection(next);
    });
  }
  function record(decision: 'accept' | 'reject') {
    if (!selection) return;
    invalidate();
    void run(async (options) => {
      const next = await session.recordReviewerDecision(
        {
          decision,
          reviewerLabel: reviewer,
          rationale,
          reviewedSourceHash: selection.review.sourceHash,
          reviewedExtractionHash: selection.review.extractionHash,
          reviewedContextHash: selection.review.contextHash,
          reviewedSelectionHash: selection.selectionHash,
          acknowledgements: {
            originalRowsReviewed: true,
            referenceRolesReviewed: true,
            separateAmountsReviewed: true,
            perspectiveReviewed: true,
            currencyReviewed: true,
            totalsReviewed: true,
            derivedSourceUnderstood: true,
          },
        },
        { ...options, currentSelection: selection },
      );
      if (!options.signal.aborted) setReceipt(next);
    });
  }
  return (
    <section
      className="min-w-0 max-w-full space-y-3"
      data-testid="split-section-review"
    >
      {!scopeReady && <p role="alert">{t.scope}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          data-testid="split-section-inspect"
          disabled={busy || !scopeReady}
          onClick={() => {
            invalidate();
            setAck(emptyAck());
            setSelection(null);
            setOffset(0);
            void run(async (options) => {
              const next = await session.inspect(options);
              if (!options.signal.aborted) setSelection(next);
            });
          }}
        >
          {t.inspect}
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          data-testid="split-section-clear"
          onClick={() => {
            operation.abort?.abort();
            operation.advance();
            session.invalidate();
            setReceipt(null);
            setArtifact(null);
            setSelection(null);
            setAck(emptyAck());
            setBusy(false);
            setError('');
          }}
        >
          {t.clear}
        </Button>
        {busy && (
          <Button
            className={buttonClass}
            variant="outline"
            data-testid="split-section-abort"
            onClick={() => {
              operation.abort?.abort();
              operation.advance();
              session.invalidate();
              setReceipt(null);
              setArtifact(null);
              setSelection(null);
              setAck(emptyAck());
              setBusy(false);
            }}
          >
            {t.abort}
          </Button>
        )}
      </div>
      {busy && (
        <output data-testid="split-section-progress">
          {t.busy} <bdi>{progress}</bdi>
        </output>
      )}
      {error && (
        <>
          <p role="alert">{t.error}</p>
          <details>
            <summary>{t.technical}</summary>
            <p className="break-all" data-testid="split-section-error">
              {error}
            </p>
          </details>
        </>
      )}
      {selection && (
        <>
          <p className="break-all">
            {t.hash}: <bdi>{selection.review.sourceHash}</bdi>
          </p>
          <p className="break-all">
            {t.selection}: <bdi>{selection.selectionHash}</bdi>
          </p>
          <p className="break-all">
            {t.extractionHash}: <bdi>{selection.review.extractionHash}</bdi>
          </p>
          <p className="break-all">
            {t.contextHash}: <bdi>{selection.review.contextHash}</bdi>
          </p>
          <output data-testid="split-section-status">
            {selection.review.state === 'review-ready' ? t.ready : t.blocked}
          </output>
          {selection.review.diagnostics.map((d, i) => (
            <p role="alert" key={i} data-testid="split-section-diagnostic">
              <bdi>
                {d.code} · {t.row} {d.row ?? ''} ·{' '}
                {splitSectionReason(d.code, lang)}
              </bdi>
            </p>
          ))}
          <details data-testid="split-section-context-evidence">
            <summary>
              {t.proof} · Currency: SAR · Date / Reference / Description / Debit
              / Credit
            </summary>
            {[
              ...selection.review.currencyEvidence,
              ...selection.review.headerEvidence.flat(),
            ].map((cell, i) => (
              <div key={i}>{evidence(cell)}</div>
            ))}
          </details>
          <h3>{t.rows}</h3>
          <div className="overflow-x-auto">
            <table data-testid="split-section-inventory">
              <thead>
                <tr>
                  <th>{t.row}</th>
                  <th>{t.page}</th>
                  <th>{t.classification}</th>
                  {['Date', 'Reference', 'Description', 'Debit', 'Credit'].map(
                    (h) => (
                      <th key={h}>
                        <bdi>{h}</bdi>
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {selection.review.rows
                  .slice(offset, offset + 100)
                  .map((row) => (
                    <tr key={row.originalRow}>
                      <td>{row.originalRow}</td>
                      <td>{row.page}</td>
                      <td>
                        <bdi>{splitSectionKind(row.kind, lang)}</bdi>
                      </td>
                      {row.values.map((value, i) => (
                        <td key={i}>
                          <bdi>{value || '∅'}</bdi>
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              {t.previous}
            </Button>
            <output>
              {offset + 1}–
              {Math.min(offset + 100, selection.review.rows.length)} /{' '}
              {selection.review.rows.length}
            </output>
            <Button
              variant="outline"
              disabled={offset + 100 >= selection.review.rows.length}
              onClick={() => setOffset(offset + 100)}
            >
              {t.next}
            </Button>
          </div>
          <p>{t.partial}</p>
          <Button
            className={buttonClass}
            variant="outline"
            data-testid="split-section-select-all"
            disabled={busy}
            onClick={() =>
              void choose(
                selection.review.movements.map((m) => m.originalRow),
                selection.review.proposals.map((p) => p.id),
              )
            }
          >
            {t.all}
          </Button>
          <h3>{t.movements}</h3>
          {selection.review.movements.map((m) => (
            <details key={m.originalRow} data-testid="split-section-movement">
              <summary>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`split-section-movement-${m.originalRow}`}
                    disabled={busy}
                    checked={selection.selectedMovementRows.includes(
                      m.originalRow,
                    )}
                    onChange={(e) =>
                      void choose(
                        e.target.checked
                          ? [...selection.selectedMovementRows, m.originalRow]
                          : selection.selectedMovementRows.filter(
                              (row) => row !== m.originalRow,
                            ),
                        selection.selectedProposalIds,
                      )
                    }
                  />{' '}
                  <bdi>
                    {t.row} {m.originalRow} · {m.reference} · {m.date} ·{' '}
                    {t.debit} {m.debit} · {t.credit} {m.credit}
                  </bdi>
                </label>
              </summary>
              <p data-testid="split-section-reference-origin">
                {t.referenceOrigin}:{' '}
                {m.referenceOrigin === 'explicit-source-cell'
                  ? t.explicitReference
                  : t.derivedReference}
              </p>
              <p>{t.proof}</p>
              {[
                m.dateEvidence,
                m.referenceEvidence,
                m.descriptionEvidence,
                m.debitEvidence,
                m.creditEvidence,
              ].map((cell, i) => (
                <div key={i}>{evidence(cell)}</div>
              ))}
            </details>
          ))}
          <h3>{t.proposals}</h3>
          {selection.review.proposals.map((p) => (
            <details key={p.id}>
              <summary>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`split-section-proposal-${p.id}`}
                    disabled={busy}
                    checked={selection.selectedProposalIds.includes(p.id)}
                    onChange={(e) =>
                      void choose(
                        selection.selectedMovementRows,
                        e.target.checked
                          ? [...selection.selectedProposalIds, p.id]
                          : selection.selectedProposalIds.filter(
                              (id) => id !== p.id,
                            ),
                      )
                    }
                  />{' '}
                  <bdi>
                    {p.reference} · {t.row} {p.evidence.target.row}
                  </bdi>
                </label>
              </summary>
              {[
                p.evidence.target,
                p.evidence.parent,
                ...p.evidence.continuations,
                ...p.evidence.headers.flat(),
              ].map((cell, i) => (
                <div key={i}>{evidence(cell)}</div>
              ))}
            </details>
          ))}
          <h3>{t.totals}</h3>
          <p>
            <bdi>
              {t.debit} {selection.review.grossDebitMinor} · {t.credit}{' '}
              {selection.review.grossCreditMinor} · {t.net}{' '}
              {selection.review.netMinor} ({t.minor})
            </bdi>
          </p>
          {selection.review.totals.map((total, i) => (
            <p key={i} data-testid="split-section-total">
              <bdi>
                {t.row} {total.originalRow} · {t.page} {total.page} ·{' '}
                {total.role} · {t.debit} {t.expected} {total.expectedDebitMinor}{' '}
                / {t.actual} {total.actualDebitMinor} · {t.credit} {t.expected}{' '}
                {total.expectedCreditMinor} / {t.actual}{' '}
                {total.actualCreditMinor} ({t.minor})
              </bdi>
            </p>
          ))}
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              {t.reviewer}
              <Input
                maxLength={200}
                data-testid="split-section-reviewer"
                disabled={busy}
                value={reviewer}
                onChange={(e) => {
                  invalidate();
                  setReviewer(e.target.value);
                  session.updateReviewer(e.target.value, rationale);
                }}
              />
            </label>
            <label>
              {t.rationale}
              <Input
                maxLength={4000}
                data-testid="split-section-rationale"
                disabled={busy}
                value={rationale}
                onChange={(e) => {
                  invalidate();
                  setRationale(e.target.value);
                  session.updateReviewer(reviewer, e.target.value);
                }}
              />
            </label>
          </div>
          {fields.map((key) => (
            <label key={key} className="block">
              <input
                type="checkbox"
                data-testid={`split-section-ack-${key}`}
                disabled={busy}
                checked={ack[key]}
                onChange={(e) => {
                  invalidate();
                  setAck({ ...ack, [key]: e.target.checked });
                }}
              />{' '}
              {t[key]}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              className={buttonClass}
              data-testid="split-section-accept"
              disabled={
                !canRecord ||
                !allSelected ||
                selection.review.state !== 'review-ready'
              }
              onClick={() => record('accept')}
            >
              {t.accept}
            </Button>
            <Button
              className={buttonClass}
              variant="outline"
              data-testid="split-section-reject"
              disabled={!canRecord}
              onClick={() => record('reject')}
            >
              {t.reject}
            </Button>
          </div>
          {receipt && (
            <>
              <p data-testid="split-section-receipt">{t.receipt}</p>
              <Button
                className={buttonClass}
                data-testid="split-section-apply"
                disabled={busy}
                onClick={() => {
                  const live = receipt;
                  setReceipt(null);
                  void run(async (options) => {
                    const next = await session.apply(live, file, context, {
                      ...options,
                      currentSelection: selection ?? undefined,
                    });
                    if (!options.signal.aborted) setArtifact(next);
                  });
                }}
              >
                {t.apply}
              </Button>
            </>
          )}
        </>
      )}
      {artifact && (
        <ArtifactDownloads artifact={artifact} run={run} busy={busy} />
      )}
    </section>
  );
}
type OperationOptions = {
  signal: AbortSignal;
  onProgress: (p: { stage: string; completed: number; total: number }) => void;
};
function ArtifactDownloads({
  artifact,
  busy,
  run,
}: {
  artifact: Artifact;
  busy: boolean;
  run: (action: (options: OperationOptions) => Promise<void>) => Promise<void>;
}) {
  const { lang } = useI18n();
  const t = splitSectionReviewCopy(lang);
  return (
    <div
      className="min-w-0 border p-3 space-y-2"
      data-testid="split-section-artifact"
    >
      <p>{t.artifact}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy}
          data-testid="split-section-download-csv"
          onClick={() =>
            void run(async (options) => {
              await saveSplitArtifact(artifact, options);
              if (!options.signal.aborted)
                download(
                  'split-section-derived.csv',
                  artifact.csv,
                  'text/csv;charset=utf-8',
                );
            })
          }
        >
          {t.csv}
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy}
          data-testid="split-section-download-archive"
          onClick={() =>
            void run(async (options) => {
              const bytes = await saveSplitArtifact(artifact, options);
              if (!options.signal.aborted)
                download(
                  'split-section-evidence.json',
                  bytes,
                  'application/json',
                );
            })
          }
        >
          {t.archive}
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy}
          data-testid="split-section-download-workbook"
          onClick={() =>
            void run(async (options) => {
              const bytes = await exportSplitWorkbook(artifact, options);
              if (!options.signal.aborted)
                download(
                  'split-section-evidence.xlsx',
                  bytes,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                );
            })
          }
        >
          {t.workbook}
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy}
          data-testid="split-section-download-original"
          onClick={() =>
            void run(async (options) => {
              await saveSplitArtifact(artifact, options);
              if (!options.signal.aborted)
                download(
                  'split-section-original.pdf',
                  artifact.originalPdf,
                  'application/pdf',
                );
            })
          }
        >
          {t.original}
        </Button>
      </div>
    </div>
  );
}
function HistoricalArchive() {
  const { lang } = useI18n();
  const t = splitSectionReviewCopy(lang);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(action: (options: OperationOptions) => Promise<void>) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      await action({ signal: abort.signal, onProgress: () => {} });
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }
  return (
    <section className="min-w-0 space-y-2" data-testid="split-section-history">
      <label>
        {t.restore}
        <Input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          data-testid="split-section-restore"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            setArtifact(null);
            if (file)
              void run(async (options) => {
                const bytes = await file.arrayBuffer();
                const restored = await restoreSplitArtifact(bytes, options);
                if (!options.signal.aborted) setArtifact(restored);
              });
          }}
        />
      </label>
      {busy && (
        <Button
          variant="outline"
          data-testid="split-section-history-abort"
          onClick={() => {
            controller.current?.abort();
            setBusy(false);
          }}
        >
          {t.abort}
        </Button>
      )}
      {error && (
        <>
          <p role="alert">{t.error}</p>
          <details>
            <summary>{t.technical}</summary>
            <p className="break-all">{error}</p>
          </details>
        </>
      )}
      {artifact && (
        <>
          <p data-testid="split-section-historical-only">{t.historical}</p>
          <ArtifactDownloads artifact={artifact} busy={busy} run={run} />
        </>
      )}
    </section>
  );
}
