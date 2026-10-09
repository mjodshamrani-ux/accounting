import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  sectionDerivedReviewCopy,
  sectionDerivedReviewError,
} from '@/lib/i18n/section-derived-review';
import { sourceStructureReason } from '@/lib/i18n/source-structure-review';
import { parseMoney } from '@/lib/reconciliation/core';
import { SectionDerivedReadingSession } from '@/lib/reconciliation/section-derived-reading';
import type {
  SectionDerivedSelection,
  SectionDerivedReceipt,
  SectionDerivedReadingArtifact,
} from '@/lib/reconciliation/section-derived-reading';
import type {
  SectionCellEvidence,
  SectionContinuationReview,
} from '@/lib/reconciliation/section-continuation';
import type { Mapping, Scope, SourceFile } from '@/lib/reconciliation/types';
export type SectionDerivedReviewProps = {
  files: [SourceFile | null, SourceFile | null];
  mappings: [Mapping, Mapping];
  scope: Scope;
  extractionRevision?: string;
};
const buttonClass = 'h-auto max-w-full min-w-0 whitespace-normal text-start';
function download(name: string, bytes: string | ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SectionDerivedReview(props: SectionDerivedReviewProps) {
  const { lang } = useI18n();
  const t = sectionDerivedReviewCopy(lang);
  const [open, setOpen] = useState(false);
  return (
    <section
      data-testid="section-derived-disclosure"
      className="min-w-0 max-w-full"
    >
      <Button
        className={buttonClass}
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t.close : t.open}
      </Button>
      {open && <SectionDerivedSourcePicker {...props} />}
    </section>
  );
}
function SectionDerivedSourcePicker(props: SectionDerivedReviewProps) {
  const { lang } = useI18n();
  const t = sectionDerivedReviewCopy(lang);
  const [side, setSide] = useState('');
  const binding = useMemo(
    () => ({
      files: props.files,
      mappings: props.mappings,
      scope: props.scope,
      revision: props.extractionRevision,
    }),
    [props.files, props.mappings, props.scope, props.extractionRevision],
  );
  const [chosen, setChosen] = useState<typeof binding | null>(null);
  const activeSide = chosen === binding ? side : '';
  const index = activeSide === 'supplier' ? 0 : 1;
  const file = activeSide ? props.files[index] : null;
  return (
    <div className="min-w-0 border rounded p-3 space-y-3">
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <label>
        {t.source}
        <select
          data-derived-source
          className="block max-w-full border p-2"
          value={activeSide}
          onChange={(e) => {
            setSide(e.target.value);
            setChosen(binding);
          }}
        >
          <option value="">{t.source}</option>
          {props.files.map(
            (source, i) =>
              source?.pdf && (
                <option key={i} value={i === 0 ? 'supplier' : 'ledger'}>
                  {i === 0 ? t.supplier : t.ledger} · {source.name}
                </option>
              ),
          )}
        </select>
      </label>
      {file?.pdf ? (
        <SectionDerivedPanel
          key={activeSide}
          file={file}
          mapping={props.mappings[index]}
          decimals={props.scope.decimals}
          revision={props.extractionRevision ?? 'native-section-derived-v1'}
        />
      ) : (
        <p>{t.missing}</p>
      )}
    </div>
  );
}
type Acknowledgements = {
  originalRowsReviewed: boolean;
  referenceRolesReviewed: boolean;
  signedAmountsPreserved: boolean;
  derivedSourceUnderstood: boolean;
  originalDotInterpretationReviewed: boolean;
};
const noAcknowledgements = (): Acknowledgements => ({
  originalRowsReviewed: false,
  referenceRolesReviewed: false,
  signedAmountsPreserved: false,
  derivedSourceUnderstood: false,
  originalDotInterpretationReviewed: false,
});
function SectionDerivedPanel({
  file,
  mapping,
  decimals,
  revision,
}: {
  file: SourceFile;
  mapping: Mapping;
  decimals: number;
  revision: string;
}) {
  const { lang } = useI18n();
  const t = sectionDerivedReviewCopy(lang);
  const binding = useMemo(
    () => ({ file, mapping, decimals, revision }),
    [file, mapping, decimals, revision],
  );
  const session = useMemo(
    () => new SectionDerivedReadingSession(file, mapping, revision, decimals),
    [file, mapping, revision, decimals],
  );
  const ticket = useRef(0);
  const [view, setView] = useState<{
    binding: typeof binding;
    selection: SectionDerivedSelection;
    receipt: SectionDerivedReceipt | null;
    artifact: SectionDerivedReadingArtifact | null;
  } | null>(null);
  const [form, setForm] = useState<{
    binding: typeof binding;
    reviewer: string;
    rationale: string;
    ack: Acknowledgements;
  } | null>(null);
  const current = view?.binding === binding ? view : null;
  const requiresOriginalInterpretation =
    !!current?.selection.review.currencyContext &&
    current.selection.review.originalNumberFormat?.status === 'ambiguous';
  const reviewer = form?.binding === binding ? form.reviewer : '';
  const rationale = form?.binding === binding ? form.rationale : '';
  const ack = form?.binding === binding ? form.ack : noAcknowledgements();
  const [busy, setBusy] = useState<{
    binding: typeof binding;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState<{
    binding: typeof binding;
    message: string;
  } | null>(null);
  const active = busy?.binding === binding && busy.active;
  useEffect(
    () => () => {
      ++ticket.current;
      session.replaceSource(file, mapping, revision, decimals);
    },
    [session, file, mapping, revision, decimals],
  );
  function invalidateReview(label = reviewer, reason = rationale) {
    ++ticket.current;
    setBusy(null);
    session.updateReviewer(label, reason);
    if (current) setView({ ...current, receipt: null, artifact: null });
  }
  async function run(
    action: () => Promise<{
      selection?: SectionDerivedSelection;
      receipt?: SectionDerivedReceipt | null;
      artifact?: SectionDerivedReadingArtifact | null;
    }>,
  ) {
    const id = ++ticket.current;
    setBusy({ binding, active: true });
    setError(null);
    try {
      const result = await action();
      if (id === ticket.current)
        setView({
          binding,
          selection: result.selection ?? current!.selection,
          receipt:
            result.receipt === undefined
              ? (current?.receipt ?? null)
              : result.receipt,
          artifact:
            result.artifact === undefined
              ? (current?.artifact ?? null)
              : result.artifact,
        });
    } catch (e) {
      if (id === ticket.current)
        setError({
          binding,
          message: e instanceof Error ? e.message : String(e),
        });
    } finally {
      if (id === ticket.current) setBusy({ binding, active: false });
    }
  }
  function reviewerChanged(field: 'reviewer' | 'rationale', value: string) {
    const next = {
      binding,
      reviewer,
      rationale,
      ack: noAcknowledgements(),
      [field]: value,
    };
    invalidateReview(next.reviewer, next.rationale);
    setForm(next);
  }
  const cite = (e: SectionCellEvidence) => (
    <p
      className="break-all"
      data-derived-cell={`${e.sheet}:${e.page}:${e.row}:${e.column}`}
    >
      <bdi>
        {t.sheet} {e.sheet} · {t.page} {e.page} · {t.row} {e.row} · {t.column}{' '}
        {e.column}
      </bdi>{' '}
      <mark>
        <bdi>{e.literal || '∅'}</bdi>
      </mark>
    </p>
  );
  const canReview =
    !!current &&
    !active &&
    !!reviewer.trim() &&
    !!rationale.trim() &&
    ack.originalRowsReviewed &&
    ack.referenceRolesReviewed &&
    ack.signedAmountsPreserved &&
    ack.derivedSourceUnderstood &&
    (!requiresOriginalInterpretation ||
      (ack.originalDotInterpretationReviewed &&
        mapping.formatChoice?.numberFormat?.value === 'dot'));
  function record(decision: 'accept' | 'reject') {
    if (!current) return;
    void run(async () => ({
      receipt: await session.recordReviewerDecision({
        decision,
        reviewerLabel: reviewer,
        rationale,
        reviewedSourceHash: current.selection.review.sourceHash,
        reviewedExtractionHash: current.selection.review.extractionHash,
        reviewedExtractionRevision: current.selection.review.extractionRevision,
        reviewedSelectionHash: current.selection.selectionHash,
        acknowledgements: {
          originalRowsReviewed: true,
          referenceRolesReviewed: true,
          signedAmountsPreserved: true,
          derivedSourceUnderstood: true,
          ...(requiresOriginalInterpretation
            ? { originalDotInterpretationReviewed: true as const }
            : {}),
        },
      }),
      artifact: null,
    }));
  }
  return (
    <section
      data-testid="section-derived-review"
      className="min-w-0 max-w-full space-y-3"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          type="button"
          disabled={active}
          onClick={() => {
            setForm(null);
            void run(async () => ({
              selection: await session.inspect(),
              receipt: null,
              artifact: null,
            }));
          }}
        >
          {t.inspect}
        </Button>
        <Button
          className={buttonClass}
          type="button"
          variant="outline"
          onClick={() => {
            ++ticket.current;
            session.replaceSource(file, mapping, revision, decimals);
            setView(null);
            setForm(null);
            setBusy(null);
            setError(null);
          }}
        >
          {t.clear}
        </Button>
      </div>
      {active && <output>{t.busy}</output>}
      {error?.binding === binding && (
        <p role="alert">
          {t.error}: {sectionDerivedReviewError(error.message, lang)}
        </p>
      )}
      {error?.binding === binding && (
        <details>
          <summary>{t.technical}</summary>
          <p className="break-all">{error.message}</p>
        </details>
      )}
      {current && (
        <>
          <p className="break-all">
            {t.hash}: <bdi>{current.selection.review.sourceHash}</bdi>
          </p>
          <p className="break-all">
            {t.extraction}: <bdi>{current.selection.review.extractionHash}</bdi>{' '}
            · {t.revision}: <bdi>{revision}</bdi>
          </p>
          <p className="break-all">
            {t.selection}: <bdi>{current.selection.selectionHash}</bdi>
          </p>
          {current.selection.review.currencyContext && (
            <div
              data-derived-currency-context
              className="min-w-0 border p-2 space-y-2"
            >
              <h3>{t.currencyContext}</h3>
              <p>
                {t.currency}:{' '}
                <bdi>{current.selection.review.currencyContext.code}</bdi>
              </p>
              <p data-derived-selected-precision>
                {t.precision}: {decimals}
              </p>
              <p data-derived-policy-precision>
                {t.policyPrecision}:{' '}
                {current.selection.review.currencyContext.decimals} ·{' '}
                {t.precisionOrigin}
              </p>
              <p>{t.precisionPolicy}</p>
              <p>{t.currencyHeaders}</p>
              {current.selection.review.currencyContext.headerCells.map((e) => (
                <div key={`${e.sheet}:${e.page}:${e.row}:${e.column}`}>
                  {cite(e)}
                </div>
              ))}
              {requiresOriginalInterpretation && (
                <div data-derived-original-number-interpretation>
                  <p>{t.originalInterpretation}</p>
                  <p>{t.originalInterpretationGuidance}</p>
                  <p>
                    {mapping.formatChoice?.numberFormat?.value === 'dot'
                      ? t.originalChoiceRecorded
                      : t.originalChoiceNeeded}
                  </p>
                </div>
              )}
            </div>
          )}
          {current.selection.review.headerBands && (
            <details data-derived-header-bands>
              <summary>{t.headerBands}</summary>
              {current.selection.review.headerBands.flat().map((e) => (
                <div key={`${e.row}:${e.column}`}>{cite(e)}</div>
              ))}
            </details>
          )}
          <h3>{t.proposals}</h3>
          {!current.selection.review.proposals.length && <p>{t.none}</p>}
          {current.selection.review.proposals.map((proposal) => (
            <article
              key={proposal.id}
              data-derived-proposal={proposal.id}
              className="min-w-0 border p-2"
            >
              <label className="block">
                <input
                  type="checkbox"
                  data-derived-proposal-select={proposal.id}
                  checked={current.selection.selectedProposalIds.includes(
                    proposal.id,
                  )}
                  disabled={active}
                  onChange={(e) => {
                    setForm({
                      binding,
                      reviewer,
                      rationale,
                      ack: noAcknowledgements(),
                    });
                    setView({ ...current, receipt: null, artifact: null });
                    const ids = e.target.checked
                      ? [...current.selection.selectedProposalIds, proposal.id]
                      : current.selection.selectedProposalIds.filter(
                          (id) => id !== proposal.id,
                        );
                    void run(async () => ({
                      selection: await session.selectProposalIds(ids),
                      receipt: null,
                      artifact: null,
                    }));
                  }}
                />
                {t.selected}:{' '}
                <mark>
                  <bdi>{proposal.reference}</bdi>
                </mark>
              </label>
              <p>{t.target}</p>
              {cite(proposal.target)}
              <p>{t.parent}</p>
              {(proposal.parentSpan ?? [proposal.parent]).map((e) => (
                <div key={`${e.row}:${e.column}`}>{cite(e)}</div>
              ))}
              {!!proposal.continuation.length && <p>{t.continuation}</p>}
              {(
                proposal.continuationSpans ??
                proposal.continuation.map((e) => [e])
              )
                .flat()
                .map((e) => (
                  <div key={`${e.row}:${e.column}`}>{cite(e)}</div>
                ))}
              {!!(proposal.headerBands ?? proposal.headers).length && (
                <p>{proposal.headerBands ? t.headerBands : t.headers}</p>
              )}
              {(proposal.headerBands ?? proposal.headers).flat().map((e) => (
                <div key={`${e.row}:${e.column}`}>{cite(e)}</div>
              ))}
            </article>
          ))}
          {!!current.selection.review.questions.length && (
            <div>
              <h3>{t.questions}</h3>
              {current.selection.review.questions.map((question) => (
                <div key={question.id} role="alert">
                  <p>
                    {sourceStructureReason(question.code, lang)} · {t.row}{' '}
                    {question.rows.join(', ')}
                  </p>
                  {question.evidence.map((e, i) => (
                    <div key={i}>{cite(e)}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <DerivedRows
            key={current.selection.review.extractionHash}
            rows={current.selection.review.rows}
            interpretationDecimals={
              requiresOriginalInterpretation
                ? current.selection.review.currencyContext?.decimals
                : undefined
            }
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              {t.reviewer}
              <Input
                data-derived-reviewer
                value={reviewer}
                onChange={(e) => reviewerChanged('reviewer', e.target.value)}
              />
            </label>
            <label>
              {t.rationale}
              <Input
                data-derived-rationale
                value={rationale}
                onChange={(e) => reviewerChanged('rationale', e.target.value)}
              />
            </label>
          </div>
          {(
            [
              ['originalRowsReviewed', t.originalAck],
              ['referenceRolesReviewed', t.rolesAck],
              ['signedAmountsPreserved', t.amountsAck],
              ['derivedSourceUnderstood', t.derivedAck],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="block">
              <input
                type="checkbox"
                data-derived-ack={field}
                checked={ack[field]}
                onChange={(e) => {
                  invalidateReview();
                  setForm({
                    binding,
                    reviewer,
                    rationale,
                    ack: { ...ack, [field]: e.target.checked },
                  });
                }}
              />{' '}
              {label}
            </label>
          ))}
          {requiresOriginalInterpretation && (
            <label className="block">
              <input
                type="checkbox"
                data-derived-ack="originalDotInterpretationReviewed"
                checked={ack.originalDotInterpretationReviewed}
                onChange={(e) => {
                  invalidateReview();
                  setForm({
                    binding,
                    reviewer,
                    rationale,
                    ack: {
                      ...ack,
                      originalDotInterpretationReviewed: e.target.checked,
                    },
                  });
                }}
              />{' '}
              {t.originalInterpretationAck}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className={buttonClass}
              type="button"
              disabled={!canReview}
              onClick={() => record('accept')}
            >
              {t.accept}
            </Button>
            <Button
              className={buttonClass}
              type="button"
              variant="outline"
              disabled={!canReview}
              onClick={() => record('reject')}
            >
              {t.reject}
            </Button>
          </div>
          {current.receipt && (
            <div>
              <p className="break-all">
                {t.receipt}: <bdi>{current.receipt.id}</bdi>
              </p>
              <Button
                className={buttonClass}
                type="button"
                disabled={active}
                onClick={() => {
                  setView({ ...current, receipt: null, artifact: null });
                  void run(async () => ({
                    artifact: await session.apply(
                      current.receipt!,
                      file,
                      mapping,
                      revision,
                      decimals,
                    ),
                    receipt: null,
                  }));
                }}
              >
                {t.apply}
              </Button>
            </div>
          )}
          {current.artifact && (
            <div data-derived-artifact className="space-y-2">
              <p>{t.artifact}</p>
              <p className="break-all">
                <bdi>
                  {current.artifact.provenance.derivedName} ·{' '}
                  {current.artifact.provenance.derivedSha256}
                </bdi>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  className={buttonClass}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    download(
                      current.artifact!.provenance.derivedName,
                      current.artifact!.csv,
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  {t.downloadCsv}
                </Button>
                <Button
                  className={buttonClass}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    download(
                      'section-derived-provenance.json',
                      JSON.stringify(current.artifact!.provenance, null, 2),
                      'application/json',
                    )
                  }
                >
                  {t.downloadProvenance}
                </Button>
                <Button
                  className={buttonClass}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    download(
                      current.artifact!.provenance.originalName,
                      current.artifact!.originalPdf,
                      'application/pdf',
                    )
                  }
                >
                  {t.downloadOriginal}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function DerivedRows({
  rows,
  interpretationDecimals,
}: {
  rows: SectionContinuationReview['rows'];
  interpretationDecimals?: number;
}) {
  const { lang } = useI18n();
  const t = sectionDerivedReviewCopy(lang);
  const [offset, setOffset] = useState(0);
  function interpretation(literal: string, format: 'dot' | 'comma') {
    try {
      return String(parseMoney(literal, format, interpretationDecimals!));
    } catch {
      return t.unreadableInterpretation;
    }
  }
  return (
    <details open={interpretationDecimals !== undefined}>
      <summary>
        {t.rows} ({rows.length})
      </summary>
      <p>
        {rows.length ? offset + 1 : 0}–{Math.min(offset + 100, rows.length)}{' '}
        {t.of} {rows.length}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          type="button"
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset((value) => Math.max(0, value - 100))}
        >
          {t.previous}
        </Button>
        <Button
          className={buttonClass}
          type="button"
          variant="outline"
          disabled={offset + 100 >= rows.length}
          onClick={() => setOffset((value) => value + 100)}
        >
          {t.next}
        </Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(offset, offset + 100).map((row) => (
              <tr key={row.row} data-derived-original-row={row.row}>
                <th>
                  {t.page} {row.page} · {t.row} {row.row}
                </th>
                {row.values.map((value, i) => (
                  <td key={i} className="p-2">
                    <bdi>{value}</bdi>
                  </td>
                ))}
                {interpretationDecimals !== undefined && (
                  <td className="p-2" data-derived-amount-interpretations>
                    {row.amounts.map((amount) => (
                      <div
                        key={`${amount.sheet}:${amount.page}:${amount.row}:${amount.column}`}
                      >
                        <p>
                          <bdi>{amount.literal}</bdi>
                        </p>
                        <p>
                          {t.decimalInterpretation}:{' '}
                          <bdi>{interpretation(amount.literal, 'dot')}</bdi>
                        </p>
                        <p>
                          {t.groupingInterpretation}:{' '}
                          <bdi>{interpretation(amount.literal, 'comma')}</bdi>
                        </p>
                      </div>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
