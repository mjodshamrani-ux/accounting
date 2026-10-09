import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/context';
import {
  sourceStructureReviewCopy,
  sourceStructureReason,
} from '@/lib/i18n/source-structure-review';
import { money } from '@/lib/reconciliation/core';
import { SourceStructureReviewController } from '@/lib/reconciliation/source-structure-review';
import type {
  SourceStructureReviewInput,
  SourceStructureReviewResult,
} from '@/lib/reconciliation/source-structure-review';
import type {
  SectionContinuationReview,
  SectionCellEvidence,
} from '@/lib/reconciliation/section-continuation';

type SourceStructureReviewProps = Omit<
  SourceStructureReviewInput,
  'extractionRevision'
> & { extractionRevision?: string };

/** Opt-in inspection; closing unmounts the owned controller and discards results. */
export function SourceStructureReview(props: SourceStructureReviewProps) {
  const { lang } = useI18n();
  const t = sourceStructureReviewCopy(lang);
  const [open, setOpen] = useState(false);
  return (
    <section
      data-testid="source-structure-review-disclosure"
      className="min-w-0 max-w-full"
    >
      <Button
        className="h-auto max-w-full min-w-0 whitespace-normal text-start"
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls="source-structure-review-body"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t.close : t.open}
      </Button>
      {open && (
        <div id="source-structure-review-body">
          <SourceStructureReviewPanel {...props} />
        </div>
      )}
    </section>
  );
}

/** Read-only inspection. There is deliberately no financial mutation callback. */
function SourceStructureReviewPanel({
  files,
  mappings,
  scope,
  extractionRevision = 'native-reading-v1',
}: SourceStructureReviewProps) {
  const { lang, engineText } = useI18n();
  const t = sourceStructureReviewCopy(lang);
  const controller = useMemo(() => new SourceStructureReviewController(), []);
  const binding = useMemo(
    () => ({ files, mappings, scope, extractionRevision }),
    [files, mappings, scope, extractionRevision],
  );
  const [draft, setDraft] = useState<{
    binding: typeof binding;
    scope: typeof scope;
    attested: boolean;
  } | null>(null);
  const reviewScope = draft?.binding === binding ? draft.scope : scope;
  const attested = draft?.binding === binding && draft.attested;
  const input = useMemo(
    () => ({
      ...binding,
      scope: {
        ...reviewScope,
        confirmed: attested,
        coverageConfirmed: attested,
      },
    }),
    [binding, reviewScope, attested],
  );
  function editScope(
    field: 'supplier' | 'entity' | 'account' | 'currency' | 'cutoff',
    value: string,
  ) {
    setDraft({
      binding,
      scope: { ...reviewScope, [field]: value },
      attested: false,
    });
  }
  const [view, setView] = useState<{
    input: typeof input;
    busy: boolean;
    result: SourceStructureReviewResult | null;
  } | null>(null);
  useEffect(() => {
    controller.clear();
    return () => controller.clear();
  }, [controller, input]);
  // Hide stale output in the render that changes an input, before effects run.
  const current = view?.input === input ? view : null;
  const result = current?.result;
  const side = (value: string) =>
    value === 'supplier' ? t.supplier : t.ledger;
  const amount = (value: number | null) =>
    value === null
      ? t.unknown
      : `${money(value, reviewScope.decimals)} ${reviewScope.currency}`;
  const cell = (e: SectionCellEvidence) => (
    <span
      className="block break-all"
      data-source-cell={`${e.sheet}:${e.page}:${e.row}:${e.column}`}
    >
      <bdi>
        {t.sheet} {e.sheet} · {t.page} {e.page} · {t.row} {e.row} · {e.column}
      </bdi>{' '}
      <mark>{e.literal || '∅'}</mark>
    </span>
  );
  async function run() {
    setView({ input, busy: true, result: null });
    if (await controller.run(input))
      setView({ input, busy: false, result: controller.result });
  }
  return (
    <section
      data-testid="source-structure-review"
      className="min-w-0 max-w-full rounded-xl border p-4 space-y-3"
      aria-labelledby="source-structure-title"
    >
      <h2 id="source-structure-title" className="font-semibold">
        {t.title}
      </h2>
      <p>{t.intro}</p>
      {files.map(
        (file, i) =>
          file && (
            <p key={i}>
              {side(i === 0 ? 'supplier' : 'ledger')} · {t.sheet}:{' '}
              <bdi>{file.sheets[mappings[i].sheet]?.name ?? t.unknown}</bdi> ·{' '}
              {t.outsideSheets}: {Math.max(0, file.sheets.length - 1)}
            </p>
          ),
      )}
      <fieldset className="border rounded p-3 space-y-2">
        <legend>{t.scope}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            ['supplier', 'entity', 'account', 'currency', 'cutoff'] as const
          ).map((field) => (
            <label key={field}>
              {field === 'supplier' ? t.supplierField : t[field]}
              <Input
                data-review-scope={field}
                aria-label={`${t.scope}: ${field === 'supplier' ? t.supplierField : t[field]}`}
                type={field === 'cutoff' ? 'date' : 'text'}
                value={reviewScope[field]}
                onChange={(e) => editScope(field, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-wrap gap-2">
          <input
            data-review-scope-attestation
            type="checkbox"
            checked={attested}
            onChange={(e) =>
              setDraft({
                binding,
                scope: { ...reviewScope },
                attested: e.target.checked,
              })
            }
          />
          {t.attest}
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-auto max-w-full min-w-0 whitespace-normal text-start"
          type="button"
          onClick={() => void run()}
          disabled={!files.every(Boolean) || !!current?.busy}
        >
          {t.run}
        </Button>
        <Button
          className="h-auto max-w-full min-w-0 whitespace-normal text-start"
          type="button"
          variant="outline"
          onClick={() => {
            controller.clear();
            setView(null);
          }}
        >
          {t.clear}
        </Button>
      </div>
      {!files.every(Boolean) && <p>{t.missing}</p>}
      {current?.busy && <output>{t.busy}</output>}
      {result && (
        <>
          <h3 className="font-semibold">{t.groups}</h3>
          {result.groupError && (
            <p role="alert">
              {t.error}: {engineText(result.groupError)}
            </p>
          )}
          {result.groups && (
            <div data-testid="invoice-group-candidates">
              <output>
                {result.groups.searchComplete ? t.complete : t.incomplete} ·{' '}
                {result.groups.status === 'needs-review'
                  ? t.needsReview
                  : t.candidate}
              </output>
              {!!result.groups.reasons.length && (
                <p>
                  {t.reasons}:{' '}
                  <bdi>
                    {result.groups.reasons
                      .map((r) => sourceStructureReason(r, lang))
                      .join(', ')}
                  </bdi>
                </p>
              )}
              {!result.groups.candidates.length && <p>{t.empty}</p>}
              {result.groups.candidates.map((c) => (
                <article
                  key={c.id}
                  className="border rounded p-3 my-2"
                  data-candidate-status={c.status}
                >
                  <h4>
                    <mark>
                      <bdi>{c.invoice}</bdi>
                    </mark>{' '}
                    · {c.status === 'candidate' ? t.candidate : t.needsReview}
                  </h4>
                  {c.selectedReference && (
                    <p>
                      {t.selected}: <bdi>{c.selectedReference}</bdi>
                    </p>
                  )}
                  <p>
                    {t.supplier} {t.total}:{' '}
                    <bdi>{amount(c.supplierTotalMinor)}</bdi> · {t.ledger}{' '}
                    {t.total}: <bdi>{amount(c.ledgerTotalMinor)}</bdi>
                  </p>
                  {!!c.reasons.length && (
                    <p>
                      {t.reasons}:{' '}
                      <bdi>
                        {c.reasons
                          .map((r) => sourceStructureReason(r, lang))
                          .join(', ')}
                      </bdi>
                    </p>
                  )}
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {[
                            t.sheet,
                            t.row,
                            t.date,
                            t.amount,
                            t.invoiceRole,
                            t.selectedRole,
                            t.hash,
                          ].map((label) => (
                            <th key={label} className="p-2 text-start">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.evidence.members.map((m) => (
                          <tr key={`${m.side}:${m.id}`}>
                            <td>
                              {side(m.side)} · <bdi>{m.sheet}</bdi>
                            </td>
                            <td>{m.row}</td>
                            <td>
                              <bdi>{m.date}</bdi>
                            </td>
                            <td>
                              <bdi>{amount(m.amountMinor)}</bdi>
                            </td>
                            <td>
                              <mark>
                                <bdi>{m.invoiceHeader}</bdi>
                              </mark>{' '}
                              [{m.invoiceColumn}]
                            </td>
                            <td>
                              {m.selectedHeader && (
                                <mark>
                                  <bdi>{m.selectedHeader}</bdi>
                                </mark>
                              )}{' '}
                              {m.selectedColumn === undefined
                                ? ''
                                : `[${m.selectedColumn}]`}
                            </td>
                            <td className="max-w-40 break-all">
                              <bdi>{m.sourceHash}</bdi>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!!c.competingRows.length && (
                    <div>
                      <h5>{t.competitors}</h5>
                      {c.competingRows.map((r, i) => (
                        <p key={i}>
                          {side(r.side)} · <bdi>{r.sheet}</bdi> · {t.row}{' '}
                          {r.row}:{' '}
                          <bdi>
                            {r.identities
                              .map(
                                (v) =>
                                  `${sourceStructureReason(v.role, lang)}: ${v.value}`,
                              )
                              .join(' · ')}
                          </bdi>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <h3 className="font-semibold">{t.sections}</h3>
          {result.sections.map((s) => (
            <article
              key={s.side}
              className="border rounded p-3"
              data-section-side={s.side}
            >
              <h4>{side(s.side)}</h4>
              {!s.applicable && <p>{t.notPdf}</p>}
              {s.error && (
                <p role="alert">
                  {t.error}: {engineText(s.error)}
                </p>
              )}
              {s.review && (
                <>
                  <p className="break-all">
                    {t.hash}: <bdi>{s.review.sourceHash}</bdi> · {t.revision}:{' '}
                    <bdi>{s.review.extractionRevision}</bdi>
                  </p>
                  {s.review.headerBands && (
                    <details data-section-header-bands>
                      <summary>{t.headerBands}</summary>
                      {s.review.headerBands.flat().map((e) => (
                        <div key={`${e.row}:${e.column}`}>{cell(e)}</div>
                      ))}
                    </details>
                  )}
                  {!s.review.proposals.length && <p>{t.noProposals}</p>}
                  {s.review.proposals.map((p) => (
                    <div
                      key={p.id}
                      className="border p-2 my-2"
                      data-section-proposal={p.reference}
                    >
                      <p>
                        {t.candidate}:{' '}
                        <mark>
                          <bdi>{p.reference}</bdi>
                        </mark>
                      </p>
                      <p>{t.target}</p>
                      {cell(p.target)}
                      <p>{t.parent}</p>
                      {(p.parentSpan ?? [p.parent]).map((e) => (
                        <div key={`${e.row}:${e.column}`}>{cell(e)}</div>
                      ))}
                      {p.continuation.length > 0 && <p>{t.continuation}</p>}
                      {(p.continuationSpans ?? p.continuation.map((e) => [e])).flat().map((e) => (
                        <div key={`${e.row}:${e.column}`}>{cell(e)}</div>
                      ))}
                      {(p.headerBands ?? p.headers).length > 0 && <p>{p.headerBands ? t.headerBands : t.headers}</p>}
                      {(p.headerBands ?? p.headers).flat().map((e) => (
                        <div key={`${e.row}:${e.column}`}>{cell(e)}</div>
                      ))}
                    </div>
                  ))}
                  {!!s.review.questions.length && (
                    <div>
                      <h5>{t.questions}</h5>
                      {s.review.questions.map((q) => (
                        <div key={q.id} role="alert">
                          <bdi>{sourceStructureReason(q.code, lang)}</bdi> ·{' '}
                          {t.row} {q.rows.join(', ')}
                          {q.evidence.map((e, i) => (
                            <div key={i}>{cell(e)}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  <PhysicalRows
                    key={s.review.extractionHash}
                    rows={s.review.rows}
                  />
                </>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

/** Every row remains reachable, while rendering at most 100 rows at a time. */
function PhysicalRows({ rows }: { rows: SectionContinuationReview['rows'] }) {
  const { lang } = useI18n();
  const t = sourceStructureReviewCopy(lang);
  const [offset, setOffset] = useState(0);
  return (
    <details>
      <summary>
        {t.rows} ({rows.length})
      </summary>
      <p>
        <bdi>
          {rows.length ? offset + 1 : 0}–{Math.min(offset + 100, rows.length)}
        </bdi>{' '}
        {t.of} {rows.length}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-auto max-w-full min-w-0 whitespace-normal text-start"
          type="button"
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset((n) => Math.max(0, n - 100))}
        >
          {t.previous}
        </Button>
        <Button
          className="h-auto max-w-full min-w-0 whitespace-normal text-start"
          type="button"
          variant="outline"
          disabled={offset + 100 >= rows.length}
          onClick={() => setOffset((n) => n + 100)}
        >
          {t.next}
        </Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(offset, offset + 100).map((r) => (
              <tr key={r.row} data-physical-row={r.row}>
                <th>
                  {t.page} {r.page} · {t.row} {r.row}
                </th>
                {r.values.map((v, col) => (
                  <td key={col} className="p-2">
                    <bdi>{v}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
