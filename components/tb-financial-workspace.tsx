import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useId, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount, Figures } from '@/components/amount';
import {
  RecordFields,
  RecordPager,
  RecordTable,
} from '@/components/record-table';
import { pageOfRow, recordPage } from '@/lib/record-page';
import { Button } from '@/components/ui/button';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
} from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import {
  FINANCIAL_VERSION,
  FINANCIAL_ROLES,
  FINANCIAL_SCOPE_FIELDS,
  FINANCIAL_CATEGORIES,
  type FinancialInput,
  type FinancialScope,
  type FinancialResult,
  type FinancialEvent,
} from '@/lib/reconciliation/tb-financial';
import { financialDemo } from '@/lib/reconciliation/tb-financial-demo';
import { TbFinancialHierarchyPanel } from '@/components/tb-financial-hierarchy-panel';
import './workspace-record.css';
import {
  DecisionButtons,
  DecisionHint,
  useDecisionFocus,
} from './decision-platform';
import type { AcceptBlock } from '@/lib/decision-platform';
const emptyScope = (): FinancialScope => ({
  entity: '',
  ledger: '',
  currency: '',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: '',
  start: '',
  end: '',
  asOf: '',
  chartVersion: '',
  mapVersion: '',
  closingBasis: 'post-closing',
  confirmed: false,
});
const readings = () =>
  FINANCIAL_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: FINANCIAL_VERSION,
    confirmed: false,
  })) as FinancialInput['readings'];
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function FinancialWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { engineText, t } = useI18n();
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings),
    [scope, setScope] = useState(emptyScope);
  const [complete, setComplete] = useState<FinancialInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<FinancialEvent[]>([]),
    [result, setResult] = useState<FinancialResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  const [linePage, setLinePage] = useState(0);
  function cancel() {
    runtime.current.serial++;
    runtime.current.controller?.abort();
    runtime.current.running = false;
    setBusy(false);
  }
  useEffect(() => {
    const live = runtime.current;
    return () => {
      live.serial++;
      live.controller?.abort();
    };
  }, []);
  function invalidate() {
    setLinePage(0);
    setResult(null);
    setEvents([]);
    setError('');
  }
  function state(): FinancialInput {
    return {
      files: files as FinancialInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: { state: FinancialInput; result: FinancialResult }) {
    setFiles(v.state.files);
    setReading(v.state.readings);
    setScope(v.state.scope);
    setComplete(v.state.completeness);
    setEvents(v.state.events);
    setLinePage(0);
    setResult(v.result);
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
  async function perform<T>(
    work: (signal: AbortSignal) => Promise<T>,
    apply: (v: T) => void,
  ) {
    if (runtime.current.running) return;
    runtime.current.running = true;
    const id = ++runtime.current.serial,
      control = new AbortController();
    runtime.current.controller = control;
    setBusy(true);
    setError('');
    try {
      const value = await work(control.signal);
      if (id === runtime.current.serial && !control.signal.aborted)
        apply(value);
    } catch (e) {
      if (id === runtime.current.serial && !control.signal.aborted)
        setError(e instanceof Error ? e.message : '');
    } finally {
      if (id === runtime.current.serial) {
        runtime.current.running = false;
        setBusy(false);
      }
    }
  }
  const ready =
    files.every(Boolean) &&
    reading.every((r) => r.confirmed) &&
    scope.confirmed &&
    FINANCIAL_SCOPE_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error(t.financial.fileExceeds8MB);
        return workerTask<SourceFile>(
          'read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as FinancialInput['readings'];
        r[source] = { ...r[source], confirmed: false };
        setReading(r);
        setComplete({ ...complete, confirmed: false });
        invalidate();
      },
    );
  }
  async function demo() {
    await perform(async (signal) => {
      const f: SourceFile[] = [];
      for (let i = 0; i < 4; i++)
        f.push(
          await workerTask<SourceFile>(
            'read',
            {
              name: `whole-post-closing-${i}.csv`,
              buffer: new TextEncoder().encode(financialDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: FinancialInput = {
        files: f as FinancialInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as FinancialInput['readings'],
        scope: {
          entity: 'Synthetic Financial Owner',
          ledger: 'Primary Book',
          currency: 'SAR',
          currencyBasis: 'functional',
          postingStatus: 'posted',
          postingLayer: 'actual',
          start: '2026-09-01',
          end: '2026-09-30',
          asOf: '2026-09-30',
          chartVersion: 'CHART-1',
          mapVersion: 'MAP-1',
          closingBasis: 'post-closing',
          confirmed: true,
        },
        completeness: {
          confirmed: true,
          reference: 'Synthetic inventory attestation',
          note: 'Synthetic supplied inventory reviewed; not field evidence',
        },
        events: [],
      };
      return workerTask<{ state: FinancialInput; result: FinancialResult }>(
        'tb-financial-reconcile',
        s,
        signal,
      );
    }, shown);
  }
  // The decision platform (UX-3): after a decision on a statement line the
  // focus returns to that line's heading, which holds its state, on the page
  // that shows it, not to the page.
  const hint = useId(),
    lineHeading = useId(),
    settle = useDecisionFocus();
  const headingAt = (at: number) => `${lineHeading}-${at}`;
  async function decide(line: string, type: FinancialEvent['type']) {
    if (!result) return;
    const l = result.lines.find((l) => l.lineId === line)!;
    const e: FinancialEvent = {
      id: crypto.randomUUID(),
      type,
      context: result.context,
      lineId: line,
      mappingIds: l.members.map((m) => m.mappingId),
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: FinancialInput; result: FinancialResult }>(
          'tb-financial-reconcile',
          { ...state(), events: [...events, e] },
          signal,
        ),
      (v) => {
        install(v);
        const at = v.result.lines.findIndex((n) => n.lineId === line);
        if (at < 0) return;
        setLinePage(pageOfRow(at));
        settle(headingAt(at));
      },
    );
  }
  // What the decision buttons open on, as before: approval also needs the
  // completeness confirmation and a result without a source error, a gap,
  // an inconsistency or a difference, and the sentence under the fields says
  // which of these is missing.
  const acceptBlock: AcceptBlock | null = !result
    ? null
    : !complete.confirmed
      ? 'unconfirmed'
      : ((
          ['source-error', 'missing', 'inconsistent', 'difference'] as const
        ).find((s) => s === result.status) ?? null);
  const linesShown = recordPage(result?.lines.length ?? 0, linePage);
  const status = (value: string) =>
    (t.financial.status as Record<string, string>)[value] ?? value;
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-financial-workspace
        aria-busy={busy}
      >
        <WorkspaceHeader
          onBack={onBack}
          backLabel={t.financial.back}
          disabled={busy}
          hasWork={files.some(Boolean)}
        />
        <WorkspaceIntro
          title={t.financial.trialBalanceAndFinancialPosition}
          intro={
            t.financial.reviewAccountsDimensionsMappingSignsPeriodAndCurrency
          }
        >
          <p>
            {t.financial.theResultIsConsistencyWithSuppliedPresentationEvidence}
          </p>
          <p>{t.financial.currentFamilyWholePostClosingTrialBalanceOne}</p>
        </WorkspaceIntro>
        <WorkspaceAdvanced>
          <div className="gl-tb-actions workspace-toolbar">
            <Button disabled={busy} onClick={() => void demo()}>
              {t.financial.syntheticExample}
            </Button>
            <label>
              {t.financial.restoreSession}
              <input
                type="file"
                accept=".json"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void perform(
                      async (signal) =>
                        workerTask<{
                          state: FinancialInput;
                          result: FinancialResult;
                        }>(
                          'tb-financial-restore',
                          { buffer: await f.arrayBuffer() },
                          signal,
                        ),
                      shown,
                    );
                }}
              />
            </label>
            {busy && (
              <Button variant="outline" onClick={cancel}>
                {t.financial.cancelOperation}
              </Button>
            )}
          </div>
        </WorkspaceAdvanced>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 3]}
          primaryReady={!!(files[0] && files[3])}
        >
          {FINANCIAL_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>
                  {t.financial.roles[i]}
                </WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={t.financial.roles[i]}
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              <p>{files[i]?.name ?? t.financial.noOriginalUploaded}</p>
              <label>
                <input
                  type="checkbox"
                  checked={reading[i].confirmed}
                  disabled={!files[i]}
                  onChange={(e) => {
                    const r = [...reading] as FinancialInput['readings'];
                    r[i] = { ...r[i], confirmed: e.target.checked };
                    setReading(r);
                    invalidate();
                  }}
                />
                {t.financial.iReviewedThisOriginalAndConfirmItsRole}
              </label>
            </fieldset>
          ))}
        </WorkspaceSources>
        <fieldset disabled={busy} hidden={!(files[0] && files[3])}>
          <legend>{t.financial.confirmedComparisonScope}</legend>
          <div className="gl-tb-grid">
            {FINANCIAL_SCOPE_FIELDS.map((k, i) => (
              <label key={k}>
                {t.financial.scope[i]}
                <input
                  aria-label={`${t.financial.scopeFieldPrefix} ${t.financial.scope[i]}`}
                  value={scope[k]}
                  onChange={(e) => {
                    setScope({
                      ...scope,
                      [k]: e.target.value,
                      confirmed: false,
                    });
                    invalidate();
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={scope.confirmed}
              onChange={(e) => {
                setScope({ ...scope, confirmed: e.target.checked });
                invalidate();
              }}
            />
            {t.financial.iConfirmTheScopeAgreesAcrossAllFour}
          </label>
        </fieldset>
        <WorkspaceAdvanced summary={t.financial.suppliedInventoryAttestation}>
          <fieldset disabled={busy}>
            <legend>{t.financial.suppliedInventoryAttestation}</legend>
            <label>
              <input
                type="checkbox"
                checked={complete.confirmed}
                onChange={(e) => {
                  setComplete({ ...complete, confirmed: e.target.checked });
                  invalidate();
                }}
              />
              {
                t.financial
                  .iReviewedCompletenessOfSuppliedAccountsDimensionsMappings
              }
            </label>
            <label>
              {t.financial.attestationReference}
              <input
                value={complete.reference}
                onChange={(e) => {
                  setComplete({ ...complete, reference: e.target.value });
                  invalidate();
                }}
              />
            </label>
            <label>
              {t.financial.attestationReason}
              <input
                value={complete.note}
                onChange={(e) => {
                  setComplete({ ...complete, note: e.target.value });
                  invalidate();
                }}
              />
            </label>
          </fieldset>
        </WorkspaceAdvanced>
        <div className="gl-tb-actions workspace-run-actions">
          <Button
            disabled={busy || !ready}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<{
                    state: FinancialInput;
                    result: FinancialResult;
                  }>('tb-financial-reconcile', state(), signal),
                shown,
              )
            }
          >
            {t.financial.checkMappingAndAmounts}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>('tb-financial-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-financial-session.json',
                    'application/json',
                  ),
              )
            }
          >
            {t.financial.saveSession}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>(
                    'tb-financial-export',
                    { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-financial-workpaper.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {t.financial.exportEvidence}
          </Button>
        </div>
        {error && (
          <p role="alert">
            {error.startsWith('TB_FIN_')
              ? t.financial.theOperationCouldNotCompleteReviewTheSource
              : engineText(error)}
          </p>
        )}
        {result && (
          <section className="workspace-results">
            <h2
              data-financial-status={result.status}
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({ domain: 'financial', input: state(), result })}
              busy={busy}
            />
            <p>
              {t.financial.accounts}: {result.accounts.length} ·{' '}
              {t.financial.statementLines}: {result.lines.length} ·{' '}
              {t.financial.preservedSourceRows}: {result.inventory.length}
            </p>
            <p>
              {t.financial.amountsIn}{' '}
              <bdi dir="ltr">{result.scope.currency}</bdi>
            </p>
            <p>
              <Figures
                decimals={result.decimals}
                items={[
                  [t.financial.trialBalanceFigures[0], result.tb?.debit],
                  [t.financial.trialBalanceFigures[1], result.tb?.credit],
                  [t.financial.trialBalanceFigures[2], result.tb?.residual],
                ]}
              />
            </p>
            <RecordTable
              label={t.financial.tableNames.byClass}
              headers={[
                t.financial.basis,
                t.financial.class,
                t.financial.amount,
              ]}
              rows={
                result.totals
                  ? (['calculated', 'reported'] as const).flatMap((b) =>
                      FINANCIAL_CATEGORIES.map((c) => [
                        t.financial.basisLabels[b],
                        t.financial.categories[c],
                        <Amount
                          key="amount"
                          minor={result.totals![b][c]}
                          decimals={result.decimals}
                        />,
                      ]),
                    )
                  : []
              }
            />
            <RecordTable
              label={t.financial.tableNames.position}
              headers={[
                t.financial.basis,
                t.financial.assets,
                t.financial.liabilities,
                t.financial.equity,
                t.financial.positionEquation,
              ]}
              rows={
                result.grandTotals
                  ? (['calculated', 'reported'] as const).map((b) => [
                      t.financial.basisLabels[b],
                      ...(
                        ['assets', 'liabilities', 'equity', 'equation'] as const
                      ).map((k) => (
                        <Amount
                          key={k}
                          minor={result.grandTotals![b][k]}
                          decimals={result.decimals}
                        />
                      )),
                    ])
                  : []
              }
            />
            <fieldset disabled={busy} data-decision-platform>
              <legend>{t.financial.reviewDecisionEvidence}</legend>
              <label>
                {t.financial.decisionReference}
                <input
                  aria-describedby={hint}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {t.financial.decisionReason}
                <input
                  aria-describedby={hint}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <DecisionHint
                id={hint}
                input={{
                  reference,
                  reason: note,
                  review: 'eachBlocked',
                  acceptBlock,
                }}
                labels={{
                  reference: t.financial.decisionReference,
                  reason: t.financial.decisionReason,
                }}
              />
            </fieldset>
            {result.lines.slice(linesShown.from, linesShown.to).map((l, i) => (
              <section key={l.id}>
                <h3
                  id={headingAt(linesShown.from + i)}
                  tabIndex={-1}
                  data-decision-item
                >
                  {l.lineId} · {l.label} · {t.financial.categories[l.category]}{' '}
                  · {status(l.review)}
                </h3>
                <p>
                  <Figures
                    decimals={result.decimals}
                    items={[
                      [t.financial.lineFigures[0], l.calculated],
                      [t.financial.lineFigures[1], l.reported],
                      [t.financial.lineFigures[2], l.difference],
                    ]}
                  />
                </p>
                <details>
                  <summary>
                    {t.financial.allMappingMembersAndEvidence} (
                    {l.members.length})
                  </summary>
                  <RecordTable
                    label={`${t.financial.allMappingMembersAndEvidence} · ${l.lineId}`}
                    headers={[
                      t.financial.mapping,
                      t.financial.account,
                      t.financial.dimensions,
                      t.financial.evidence,
                      t.financial.contribution,
                    ]}
                    rows={l.members.map((m) => [
                      m.mappingId,
                      m.account,
                      m.dimensions,
                      m.evidenceId,
                      <Amount
                        key="contribution"
                        minor={m.contribution}
                        decimals={result.decimals}
                      />,
                    ])}
                  />
                </details>
                <DecisionButtons
                  input={{
                    reference,
                    reason: note,
                    review: l.review,
                    acceptBlock,
                  }}
                  labels={t.financial.decisionLabels}
                  busy={busy}
                  describedBy={`${hint} ${headingAt(linesShown.from + i)}`}
                  target={headingAt(linesShown.from + i)}
                  onDecide={(type) => void decide(l.lineId, type)}
                />
              </section>
            ))}
            <RecordPager
              label={t.financial.statementLines}
              length={result.lines.length}
              page={linePage}
              onPage={setLinePage}
            />
            <details>
              <summary>
                {t.financial.sourceInventoryAndErrors} (
                {result.inventory.length})
              </summary>
              <RecordTable
                label={t.financial.sourceInventoryAndErrors}
                headers={[
                  t.financial.source,
                  t.financial.row,
                  t.financial.state,
                  t.financial.errors,
                  t.financial.originalCells,
                ]}
                rows={result.inventory.map((i) => [
                  t.financial.roles[i.source],
                  i.row,
                  i.kind,
                  i.errors.join(', '),
                  <RecordFields key="values" values={i.values} />,
                ])}
                wrap={[4]}
              />
            </details>
            <details>
              <summary>
                {t.financial.missingEvidence} ({result.missing.length})
              </summary>
              <RecordTable
                label={t.financial.missingEvidence}
                headers={[t.financial.kind, t.financial.key]}
                rows={result.missing.map((m) => [m.kind, m.key])}
              />
            </details>
            <details>
              <summary>
                {t.financial.presentationAndPeriodEvidence} (
                {result.evidence.length})
              </summary>
              <RecordTable
                label={t.financial.presentationAndPeriodEvidence}
                headers={[
                  t.financial.evidence,
                  t.financial.account,
                  t.financial.dimensions,
                  t.financial.line,
                  t.financial.class,
                  t.financial.sign,
                  t.financial.from,
                  t.financial.to,
                  t.financial.reference,
                ]}
                rows={result.evidence.map((e) => [
                  e.evidenceId,
                  e.account,
                  e.dimensions,
                  e.lineId,
                  e.category,
                  e.sign,
                  e.validFrom,
                  e.validTo,
                  e.reference,
                ])}
              />
            </details>
            <details>
              <summary>
                {t.financial.decisionHistory} ({events.length})
              </summary>
              <RecordTable
                label={t.financial.decisionHistory}
                headers={[
                  t.financial.decision,
                  t.financial.line,
                  t.financial.members,
                  t.financial.time,
                  t.financial.reference,
                  t.financial.reason,
                ]}
                rows={events.map((e) => [
                  e.type,
                  e.lineId,
                  e.mappingIds.join(', '),
                  e.at,
                  e.reference,
                  e.note,
                ])}
              />
            </details>
          </section>
        )}
        <TbFinancialHierarchyPanel />
      </section>
    </div>
  );
}
