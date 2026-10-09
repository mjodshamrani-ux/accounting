import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  invoiceOverlapReviewCopy,
  invoiceOverlapIntegratedCopy,
  invoiceOverlapReason,
  invoiceOverlapDisposition,
  invoiceOverlapReviewError,
} from '@/lib/i18n/invoice-overlap-review';
import { sourceStructureReason } from '@/lib/i18n/source-structure-review';
import { money, safeSum } from '@/lib/reconciliation/core';
import { InvoiceOverlapReviewLedger } from '@/lib/reconciliation/invoice-overlap-review';
import type { SupplierInvoiceOverlapReview, SupplierMainReviewInput } from '@/lib/reconciliation/supplier-overlap-review';
import type {
  InvoiceOverlapReviewSnapshot,
  InvoiceOverlapState,
  InvoiceOverlapSession,
} from '@/lib/reconciliation/invoice-overlap-review';
import { INVOICE_OVERLAP_HARD_REASONS } from '@/lib/reconciliation/invoice-overlap-search';
import type { InvoiceOverlapRow } from '@/lib/reconciliation/invoice-overlap-search';
import type { Comparison, Mapping, Scope, SourceFile } from '@/lib/reconciliation/types';

export type InvoiceOverlapReviewProps = {
  files: [SourceFile | null, SourceFile | null];
  mappings: [Mapping, Mapping];
  scope: Scope;
  extractionRevision?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  mainReview?: {
    coordinator: SupplierInvoiceOverlapReview;
    context: SupplierMainReviewInput['main'];
    onResult: (result: Comparison) => void;
    blockedReason?: string;
  };
};
const buttonClass = 'h-auto max-w-full min-w-0 whitespace-normal text-start';
function download(name: string, bytes: string | ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function InvoiceOverlapReview(props: InvoiceOverlapReviewProps) {
  const { lang } = useI18n();
  const t = invoiceOverlapReviewCopy(lang);
  const [localOpen, setLocalOpen] = useState(false);
  const open = props.open ?? localOpen;
  return (
    <section
      className="min-w-0 max-w-full"
      data-testid="invoice-overlap-disclosure"
    >
      <Button
        className={buttonClass}
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => props.onOpenChange ? props.onOpenChange(!open) : setLocalOpen(!open)}
      >
        {open ? t.close : t.open}
      </Button>
      {open && <InvoiceOverlapPanel {...props} />}
    </section>
  );
}
type ComponentForm = {
  decisions: Record<
    string,
    { decision: '' | 'accepted' | 'rejected'; rationale: string }
  >;
  rowsReviewed: boolean;
  authorized: boolean;
  undoRationale: string;
  undoAuthorized: boolean;
};
function InvoiceOverlapPanel({
  files,
  mappings,
  scope,
  extractionRevision = 'native-overlap-reading-v1',
  mainReview,
}: InvoiceOverlapReviewProps) {
  const { lang } = useI18n();
  const t = mainReview ? invoiceOverlapIntegratedCopy(lang) : invoiceOverlapReviewCopy(lang);
  const sourceBinding = useMemo(
    () => ({ files, mappings, scope, extractionRevision }),
    [files, mappings, scope, extractionRevision],
  );
  const [draft, setDraft] = useState<{
    binding: typeof sourceBinding;
    scope: Scope;
    ack: boolean;
  } | null>(null);
  const localScope = draft?.binding === sourceBinding ? draft.scope : scope;
  const scopeAck = draft?.binding === sourceBinding && draft.ack;
  const input = useMemo(
    (): SupplierMainReviewInput => ({
      currentSourceFiles: files as [SourceFile, SourceFile],
      mappings,
      scope: {
        ...localScope,
        confirmed: scopeAck,
        coverageConfirmed: scopeAck,
      },
      revision: extractionRevision,
      main: mainReview?.context ?? { generation: 0, decisions: [], rejected: [] },
    }),
    [files, mappings, localScope, scopeAck, extractionRevision, mainReview?.context],
  );
  const ledgerOwner = useMemo(
    () => ({ input, ledger: mainReview?.coordinator ?? new InvoiceOverlapReviewLedger() }),
    [input, mainReview?.coordinator],
  );
  const ledger = ledgerOwner.ledger;
  const ticket = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const [view, setView] = useState<{
    input: typeof input;
    snapshot: InvoiceOverlapReviewSnapshot;
    state: InvoiceOverlapState;
  } | null>(null);
  const [busy, setBusy] = useState<{
    input: typeof input;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState<{
    input: typeof input;
    message: string;
  } | null>(null);
  const [reviewerDraft, setReviewerDraft] = useState<{
    input: typeof input;
    label: string;
    reason: string;
  } | null>(null);
  const reviewer = reviewerDraft?.input === input ? reviewerDraft.label : '';
  const rationale = reviewerDraft?.input === input ? reviewerDraft.reason : '';
  const [archived, setArchived] = useState<{
    input: typeof input;
    session: InvoiceOverlapSession;
  } | null>(null);
  const [forms, setForms] = useState<{
    input: typeof input;
    values: Record<string, ComponentForm>;
  } | null>(null);
  const current = view?.input === input ? view : null;
  const archiveSession = archived?.input === input ? archived.session : mainReview?.coordinator.archivedReviewDraft;
  const active = busy?.input === input && busy.active;
  const cancelOperations = useCallback(() => {
    ++ticket.current;
    ledger.invalidatePending();
    operation.current?.abort();
    operation.current = null;
  }, [ledger]);
  function invalidatePending() {
    cancelOperations();
    setBusy(null);
  }
  useEffect(() => {
    cancelOperations();
    return cancelOperations;
  }, [cancelOperations]);
  async function run(
    action: (
      live: SupplierMainReviewInput,
    ) => Promise<InvoiceOverlapReviewSnapshot | null | { mainResult: Comparison }>,
  ) {
    const scopeDrift = mainReview && (localScope.currency !== scope.currency || localScope.decimals !== scope.decimals);
    if (mainReview?.blockedReason || scopeDrift) {
      setError({ input, message: mainReview?.blockedReason || t.scopeCurrency });
      return;
    }
    ledger.invalidatePending();
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const id = ++ticket.current;
    const live = { ...structuredClone(input), signal: controller.signal };
    setBusy({ input, active: true });
    setError(null);
    try {
      const outcome = await action(live);
      if (id === ticket.current && !controller.signal.aborted) {
        const snapshot = outcome && 'mainResult' in outcome ? null : outcome;
        if (outcome && 'mainResult' in outcome) mainReview?.onResult(outcome.mainResult);
        if (snapshot) setView({ input, snapshot, state: ledger.state });
        else if (current) setView({ ...current, state: ledger.state });
      }
    } catch (e) {
      if (id === ticket.current && !controller.signal.aborted)
        setError({
          input,
          message: e instanceof Error ? e.message : String(e),
        });
    } finally {
      if (id === ticket.current) setBusy({ input, active: false });
    }
  }
  function scopeChanged(
    field: 'supplier' | 'entity' | 'account' | 'currency' | 'cutoff',
    value: string,
  ) {
    invalidatePending();
    setDraft({
      binding: sourceBinding,
      scope: { ...localScope, [field]: value },
      ack: false,
    });
  }
  function formFor(id: string): ComponentForm {
    return forms?.input === input
      ? (forms.values[id] ?? {
          decisions: {},
          rowsReviewed: false,
          authorized: false,
          undoRationale: '',
          undoAuthorized: false,
        })
      : {
          decisions: {},
          rowsReviewed: false,
          authorized: false,
          undoRationale: '',
          undoAuthorized: false,
        };
  }
  function editForm(id: string, updated: ComponentForm) {
    invalidatePending();
    setForms((previous) => ({
      input,
      values: {
        ...(previous?.input === input ? previous.values : {}),
        [id]: updated,
      },
    }));
  }
  function reviewerChanged(field: 'label' | 'reason', value: string) {
    invalidatePending();
    setReviewerDraft({
      input,
      label: reviewer,
      reason: rationale,
      [field]: value,
    });
    setForms((previous) =>
      previous?.input === input
        ? {
            input,
            values: Object.fromEntries(
              Object.entries(previous.values).map(([id, form]) => [
                id,
                {
                  ...form,
                  rowsReviewed: false,
                  authorized: false,
                  undoAuthorized: false,
                },
              ]),
            ),
          }
        : previous,
    );
  }
  const amount = (value: number | null) =>
    value === null
      ? t.unknown
      : `${money(value, localScope.decimals)} ${localScope.currency}`;
  const acceptedRows = new Set<string>();
  if (current)
    for (const receipt of current.state.receipts.filter((r) =>
      current.state.activeReceiptIds.includes(r.id),
    ))
      for (const decision of receipt.decisions.filter(
        (d) => d.decision === 'accepted',
      ))
        for (const key of current.snapshot.search.candidates.find(
          (c) => c.id === decision.candidateId,
        )?.rowKeys ?? [])
          acceptedRows.add(key);
  const originalCells = new Map(
    (current?.snapshot.search.rows ?? []).map((row) => {
      const side = row.side === 'supplier' ? 0 : 1;
      return [
        row.key,
        files[side]?.sheets[mappings[side].sheet]?.rows[row.row - 1] ?? [],
      ] as const;
    }),
  );
  const residualRows =
    current?.snapshot.search.rows.filter(
      (row) => row.disposition === 'movement' && !acceptedRows.has(row.key),
    ) ?? [];
  function residualTotal(side: 'supplier' | 'ledger') {
    const rows = residualRows.filter((r) => r.side === side);
    try {
      return rows.some((r) => r.amountMinor === null)
        ? null
        : safeSum(rows.map((r) => r.amountMinor!));
    } catch {
      return null;
    }
  }
  return (
    <section
      data-testid="invoice-overlap-review"
      className="min-w-0 max-w-full border rounded p-3 space-y-3"
    >
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      {files.map(
        (file, i) =>
          file && (
            <p key={i} className="break-all">
              {i === 0 ? t.supplier : t.ledger}: <bdi>{file.name}</bdi> ·{' '}
              {t.selectedSheet}:{' '}
              <bdi>{file.sheets[mappings[i].sheet]?.name ?? t.unknown}</bdi> ·{' '}
              {t.outsideSheets}: {Math.max(0, file.sheets.length - 1)}
            </p>
          ),
      )}
      <fieldset className="min-w-0 border p-2">
        <legend>{t.scope}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            ['supplier', 'entity', 'account', 'currency', 'cutoff'] as const
          ).map((field) => (
            <label key={field}>
              {t[field]}
              <Input
                data-overlap-scope={field}
                aria-label={`${t.scope}: ${t[field]}`}
                type={field === 'cutoff' ? 'date' : 'text'}
                value={localScope[field]}
                readOnly={!!mainReview && field === 'currency'}
                onChange={(e) => scopeChanged(field, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="block">
          <input
            type="checkbox"
            data-overlap-scope-ack
            checked={scopeAck}
            onChange={(e) => {
              invalidatePending();
              setDraft({
                binding: sourceBinding,
                scope: { ...localScope },
                ack: e.target.checked,
              });
            }}
          />{' '}
          {t.scopeAck}
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className={buttonClass}
          disabled={!files.every(Boolean) || active || !!mainReview?.blockedReason}
          onClick={() => void run((live) => ledger.inspect(live))}
        >
          {t.inspect}
        </Button>
        {active && (
          <Button
            type="button"
            className={buttonClass}
            variant="outline"
            onClick={invalidatePending}
          >
            {t.cancel}
          </Button>
        )}
      </div>
      {!files.every(Boolean) && <p>{t.missing}</p>}
      {mainReview?.blockedReason && <p className="hint warn">{mainReview.blockedReason}</p>}
      {active && <output>{t.searching}</output>}
      {error?.input === input && (
        <p role="alert">
          {t.error}: {invoiceOverlapReviewError(error.message, lang)}
        </p>
      )}
      {error?.input === input && (
        <details>
          <summary>{t.technical}</summary>
          <p className="break-all">{error.message}</p>
        </details>
      )}
      {current && (
        <>
          <p className="break-all">
            {t.hash}: <bdi>{current.snapshot.snapshotKey}</bdi>
          </p>
          {!current.snapshot.search.searchComplete && (
            <p role="alert">{t.incomplete}</p>
          )}
          {!!current.snapshot.search.reasons.length && (
            <p>
              {t.reasons}:{' '}
              {current.snapshot.search.reasons
                .map((reason) => invoiceOverlapReason(reason, lang))
                .join(', ')}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              {t.reviewer}
              <Input
                data-overlap-reviewer
                value={reviewer}
                onChange={(e) => {
                  reviewerChanged('label', e.target.value);
                }}
              />
            </label>
            <label>
              {t.rationale}
              <Input
                data-overlap-rationale
                value={rationale}
                onChange={(e) => {
                  reviewerChanged('reason', e.target.value);
                }}
              />
            </label>
          </div>
          {current.snapshot.search.searchComplete &&
            !current.snapshot.search.components.length && <p>{t.empty}</p>}
          <OverlapRows
            rows={current.snapshot.search.rows}
            originalCells={originalCells}
            decimals={localScope.decimals}
            currency={localScope.currency}
            title={t.inventory}
            acceptedRows={acceptedRows}
          />
          {!current.snapshot.search.searchComplete && (
            <details>
              <summary>
                {t.diagnostics} ({current.snapshot.search.candidates.length})
              </summary>
              {current.snapshot.search.candidates.map((candidate) => (
                <article key={candidate.id} className="break-all">
                  <p>
                    <bdi>
                      {candidate.invoice} · {candidate.selectedReference}
                    </bdi>{' '}
                    · {t.total}: <bdi>{amount(candidate.totalMinor)}</bdi>
                  </p>
                  <p>
                    {candidate.reasons
                      .map((reason) => invoiceOverlapReason(reason, lang))
                      .join(', ')}
                  </p>
                  {candidate.evidence.members.map((member) => (
                    <p key={`${member.side}:${member.id}`}>
                      {member.side === 'supplier' ? t.supplier : t.ledger} ·{' '}
                      <bdi>{member.sheet}</bdi> · {t.row} {member.row} ·{' '}
                      <bdi>{member.date}</bdi> ·{' '}
                      <bdi>{amount(member.amountMinor)}</bdi>
                    </p>
                  ))}
                </article>
              ))}
            </details>
          )}
          {current.snapshot.search.components.map((component) => {
            const form = formFor(component.id);
            const recorded = current.state.receipts.find(
              (r) =>
                current.state.activeReceiptIds.includes(r.id) &&
                r.componentId === component.id,
            );
            const rows = current.snapshot.search.rows.filter((r) =>
              component.rowKeys.includes(r.key),
            );
            return (
              <article
                data-overlap-component={component.id}
                key={component.id}
                className="min-w-0 border p-2 space-y-2"
              >
                <h3>
                  {t.component}:{' '}
                  <mark>
                    <bdi>{component.invoice}</bdi>
                  </mark>{' '}
                  {component.selectedReference && (
                    <bdi>{component.selectedReference}</bdi>
                  )}
                </h3>
                <p>
                  {t.reasons}:{' '}
                  {component.reasons
                    .map((reason) => invoiceOverlapReason(reason, lang))
                    .join(', ')}
                </p>
                <h4>
                  {t.candidates} ({component.candidateIds.length})
                </h4>
                {component.candidateIds.map((id) => {
                  const candidate = current.snapshot.search.candidates.find(
                    (c) => c.id === id,
                  )!;
                  const choice = form.decisions[id] ?? {
                    decision: '' as const,
                    rationale: '',
                  };
                  return (
                    <div
                      key={id}
                      data-overlap-candidate={id}
                      data-overlap-ledger-members={candidate.ledgerIds.length}
                      data-overlap-supplier-members={
                        candidate.supplierIds.length
                      }
                      className="min-w-0 border p-2"
                    >
                      <p>
                        {t.candidate} · {t.total}:{' '}
                        <bdi>{amount(candidate.totalMinor)}</bdi>
                      </p>
                      <p className="break-all">
                        <bdi>{id}</bdi>
                      </p>
                      {candidate.evidence.members.map((member) => (
                        <p key={`${member.side}:${member.id}`}>
                          {member.side === 'supplier' ? t.supplier : t.ledger} ·{' '}
                          <bdi>{member.sheet}</bdi> · {t.row} {member.row} ·{' '}
                          <bdi>{member.date}</bdi> ·{' '}
                          <bdi>{amount(member.amountMinor)}</bdi> ·{' '}
                          <mark>
                            <bdi>{member.invoiceHeader}</bdi>
                          </mark>{' '}
                          [{member.invoiceColumn}]{' '}
                          {member.selectedHeader && (
                            <>
                              <mark>
                                <bdi>{member.selectedHeader}</bdi>
                              </mark>{' '}
                              [{member.selectedColumn}]
                            </>
                          )}
                        </p>
                      ))}
                      <p>
                        {t.reasons}:{' '}
                        {candidate.reasons
                          .map((reason) => invoiceOverlapReason(reason, lang))
                          .join(', ')}
                      </p>
                      <label>
                        {t.undecided}
                        <select
                          data-overlap-decision={id}
                          className="block max-w-full border p-2"
                          value={choice.decision}
                          disabled={!!recorded || active}
                          onChange={(e) =>
                            editForm(component.id, {
                              ...form,
                              decisions: {
                                ...form.decisions,
                                [id]: {
                                  ...choice,
                                  decision: e.target.value as
                                    | ''
                                    | 'accepted'
                                    | 'rejected',
                                },
                              },
                              authorized: false,
                            })
                          }
                        >
                          <option value="">{t.undecided}</option>
                          <option value="accepted">{t.accept}</option>
                          <option value="rejected">{t.reject}</option>
                        </select>
                      </label>
                      <label>
                        {t.decisionReason}
                        <Input
                          data-overlap-decision-rationale={id}
                          value={choice.rationale}
                          disabled={!!recorded || active}
                          onChange={(e) =>
                            editForm(component.id, {
                              ...form,
                              decisions: {
                                ...form.decisions,
                                [id]: { ...choice, rationale: e.target.value },
                              },
                              authorized: false,
                            })
                          }
                        />
                      </label>
                    </div>
                  );
                })}
                <OverlapRows
                  originalCells={originalCells}
                  rows={rows}
                  decimals={localScope.decimals}
                  currency={localScope.currency}
                  title={t.rows}
                  acceptedRows={acceptedRows}
                />
                <p>
                  {t.residual}:{' '}
                  {
                    rows.filter(
                      (row) =>
                        row.disposition === 'movement' &&
                        !acceptedRows.has(row.key),
                    ).length
                  }{' '}
                  {t.rows}
                </p>
                {!recorded && (
                  <>
                    <label className="block">
                      <input
                        type="checkbox"
                        data-overlap-rows-ack
                        checked={form.rowsReviewed}
                        onChange={(e) =>
                          editForm(component.id, {
                            ...form,
                            rowsReviewed: e.target.checked,
                            authorized: false,
                          })
                        }
                      />{' '}
                      {t.rowsAck}
                    </label>
                    <label className="block">
                      <input
                        type="checkbox"
                        data-overlap-decisions-ack
                        checked={form.authorized}
                        onChange={(e) =>
                          editForm(component.id, {
                            ...form,
                            authorized: e.target.checked,
                          })
                        }
                      />{' '}
                      {t.decisionAck}
                    </label>
                    <Button
                      className={buttonClass}
                      type="button"
                      disabled={
                        active ||
                        !!mainReview?.blockedReason ||
                        !current.snapshot.search.searchComplete ||
                        current.snapshot.search.reasons.some((reason) =>
                          INVOICE_OVERLAP_HARD_REASONS.includes(reason),
                        ) ||
                        component.reasons.some((reason) =>
                          INVOICE_OVERLAP_HARD_REASONS.includes(reason),
                        ) ||
                        !component.complete ||
                        !reviewer.trim() ||
                        !rationale.trim() ||
                        !form.rowsReviewed ||
                        !form.authorized ||
                        component.candidateIds.some(
                          (id) =>
                            !form.decisions[id]?.decision ||
                            !form.decisions[id]?.rationale.trim(),
                        )
                      }
                      onClick={() =>
                        void run(async (live) => {
                          const outcome = await ledger.commit(live, {
                            generation: ledger.state.generation,
                            snapshotKey: current.snapshot.snapshotKey,
                            componentId: component.id,
                            reviewerLabel: reviewer,
                            rationale,
                            reviewedRowKeys: component.rowKeys,
                            decisions: component.candidateIds.map((id) => ({
                              candidateId: id,
                              decision: form.decisions[id].decision as
                                | 'accepted'
                                | 'rejected',
                              rationale: form.decisions[id].rationale,
                            })),
                          });
                          return 'result' in outcome ? { mainResult: outcome.result } : null;
                        })
                      }
                    >
                      {t.commit}
                    </Button>
                  </>
                )}
                {recorded && (
                  <>
                    <p
                      className="break-all"
                      data-overlap-active-receipt={recorded.id}
                    >
                      {t.receipt}: <bdi>{recorded.id}</bdi>
                    </p>
                    <label>
                      {t.undoReason}
                      <Input
                        data-overlap-undo-rationale
                        value={form.undoRationale}
                        onChange={(e) =>
                          editForm(component.id, {
                            ...form,
                            undoRationale: e.target.value,
                            undoAuthorized: false,
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <input
                        type="checkbox"
                        data-overlap-undo-ack
                        checked={form.undoAuthorized}
                        onChange={(e) =>
                          editForm(component.id, {
                            ...form,
                            undoAuthorized: e.target.checked,
                          })
                        }
                      />{' '}
                      {t.undoAck}
                    </label>
                    <Button
                      className={buttonClass}
                      type="button"
                      variant="outline"
                      disabled={
                        active ||
                        !!mainReview?.blockedReason ||
                        !reviewer.trim() ||
                        !form.undoRationale.trim() ||
                        !form.undoAuthorized
                      }
                      onClick={() =>
                        void run(async (live) => {
                          const outcome = await ledger.undo(live, {
                            generation: ledger.state.generation,
                            receiptId: recorded.id,
                            reviewerLabel: reviewer,
                            rationale: form.undoRationale,
                          });
                          if (!live.signal?.aborted)
                            setForms((previous) => {
                              if (previous?.input !== input) return previous;
                              const values = { ...previous.values };
                              delete values[component.id];
                              return { input, values };
                            });
                          return 'result' in outcome ? { mainResult: outcome.result } : null;
                        })
                      }
                    >
                      {t.undo}
                    </Button>
                  </>
                )}
              </article>
            );
          })}
          <output data-overlap-accepted-groups>
            {t.accepted}:{' '}
            {
              current.state.receipts
                .filter((receipt) =>
                  current.state.activeReceiptIds.includes(receipt.id),
                )
                .flatMap((receipt) =>
                  receipt.decisions.filter(
                    (decision) => decision.decision === 'accepted',
                  ),
                ).length
            }
          </output>
          <h3>{t.residual}</h3>
          <p>
            {t.supplier}: <bdi>{amount(residualTotal('supplier'))}</bdi> ·{' '}
            {t.ledger}: <bdi>{amount(residualTotal('ledger'))}</bdi>
          </p>
          <OverlapRows
            originalCells={originalCells}
            rows={residualRows}
            decimals={localScope.decimals}
            currency={localScope.currency}
            title={t.residual}
            acceptedRows={acceptedRows}
          />
          <details>
            <summary>
              {t.receipts} ({current.state.receipts.length})
            </summary>
            {current.state.receipts.map((receipt) => (
              <div key={receipt.id} className="break-all">
                <bdi>
                  {receipt.id} · {receipt.action === 'undo' ? t.undo : t.commit}{' '}
                  · {receipt.reviewerLabel} · {receipt.rationale}
                </bdi>
                {receipt.decisions.map((decision) => (
                  <p key={decision.candidateId}>
                    <bdi>{decision.candidateId}</bdi> ·{' '}
                    {decision.decision === 'accepted' ? t.accepted : t.rejected}{' '}
                    · <bdi>{decision.rationale}</bdi>
                  </p>
                ))}
              </div>
            ))}
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              className={buttonClass}
              type="button"
              variant="outline"
              disabled={active || !current.state.receipts.length}
              onClick={() =>
                void run(async (live) => {
                  const bytes = await ledger.exportWorkbook(live);
                  if (!live.signal?.aborted)
                    download(
                      'invoice-overlap-review.xlsx',
                      bytes,
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    );
                  return null;
                })
              }
            >
              {t.exportWorkbook}
            </Button>
            <Button
              className={buttonClass}
              type="button"
              variant="outline"
              disabled={active || !current.state.receipts.length}
              onClick={() =>
                void run(async (live) => {
                  const session = await ledger.exportSession(live);
                  if (!live.signal?.aborted)
                    download(
                      'invoice-overlap-review.json',
                      JSON.stringify(session, null, 2),
                      'application/json',
                    );
                  return null;
                })
              }
            >
              {t.exportSession}
            </Button>
          </div>
          {archiveSession && (
            <details>
              <summary>
                {t.archived} ({archiveSession.state.receipts.length})
              </summary>
              <p>{t.archiveNote}</p>
              {archiveSession.state.receipts.map((receipt) => (
                <p key={receipt.id} className="break-all">
                  <bdi>
                    {receipt.id} · {receipt.reviewerLabel} · {receipt.rationale}
                  </bdi>
                </p>
              ))}
            </details>
          )}
          <label>
            {t.importSession}
            <input
              type="file"
              className="block w-full max-w-full min-w-0"
              accept=".json"
              data-overlap-session-import
              disabled={active}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async (live) => {
                    if (file.size > 8 * 1024 * 1024)
                      throw new Error('Review session exceeds 8 MB.');
                    const restored = await ledger.reimportSession(
                      live,
                      JSON.parse(await file.text()),
                    );
                    if (!live.signal?.aborted)
                      setArchived({ input, session: restored.archive });
                    return null;
                  });
                e.target.value = '';
              }}
            />
          </label>
        </>
      )}
    </section>
  );
}
function OverlapRows({
  rows,
  originalCells,
  decimals,
  currency,
  title,
  acceptedRows,
}: {
  rows: InvoiceOverlapRow[];
  originalCells: Map<string, readonly string[]>;
  decimals: number;
  currency: string;
  title: string;
  acceptedRows: Set<string>;
}) {
  const { lang } = useI18n();
  const t = invoiceOverlapReviewCopy(lang);
  const [offset, setOffset] = useState(0);
  const safeOffset = Math.min(
    offset,
    Math.max(0, Math.floor((rows.length - 1) / 100) * 100),
  );
  return (
    <details>
      <summary>
        {title} ({rows.length})
      </summary>
      <p>
        {rows.length ? safeOffset + 1 : 0}–
        {Math.min(safeOffset + 100, rows.length)} {t.of} {rows.length}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          type="button"
          variant="outline"
          disabled={!safeOffset}
          onClick={() => setOffset(Math.max(0, safeOffset - 100))}
        >
          {t.previous}
        </Button>
        <Button
          className={buttonClass}
          type="button"
          variant="outline"
          disabled={safeOffset + 100 >= rows.length}
          onClick={() => setOffset(safeOffset + 100)}
        >
          {t.next}
        </Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                t.sheet,
                t.row,
                t.date,
                t.amount,
                t.identity,
                t.disposition,
                t.originalRow,
                t.hash,
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safeOffset, safeOffset + 100).map((row) => (
              <tr key={row.key} data-overlap-row={row.key}>
                <td>
                  {row.side === 'supplier' ? t.supplier : t.ledger} ·{' '}
                  <bdi>{row.sheet}</bdi>
                </td>
                <td>{row.row}</td>
                <td>
                  <bdi>{row.date}</bdi>
                </td>
                <td>
                  <bdi>
                    {row.amountMinor === null
                      ? t.unknown
                      : `${money(row.amountMinor, decimals)} ${currency}`}
                  </bdi>{' '}
                  · {acceptedRows.has(row.key) ? t.accepted : t.unmatched}
                </td>
                <td>
                  {row.identities.map((identity, i) => (
                    <p key={i}>
                      {sourceStructureReason(identity.role, lang)}:{' '}
                      <mark>
                        <bdi>{identity.value}</bdi>
                      </mark>
                    </p>
                  ))}
                </td>
                <td>{invoiceOverlapDisposition(row.disposition, lang)}</td>
                <td className="break-all max-w-64">
                  <bdi>{originalCells.get(row.key)?.join(' | ')}</bdi>
                </td>
                <td className="break-all max-w-40">
                  <bdi>{row.sourceHash}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
