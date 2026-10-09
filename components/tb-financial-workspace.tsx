import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
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
import './gl-tb-workspace.css';
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
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null)[][];
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const safe = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  return (
    <>
      <div className="gl-tb-table">
        <table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safe * 50, safe * 50 + 50).map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{v ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gl-tb-actions">
        <Button
          variant="outline"
          disabled={!safe}
          onClick={() => setPage(safe - 1)}
        >
          {t.financial.previous}
        </Button>
        <span>
          {safe + 1} / {Math.max(1, Math.ceil(rows.length / 50))} ·{' '}
          {rows.length}
        </span>
        <Button
          variant="outline"
          disabled={(safe + 1) * 50 >= rows.length}
          onClick={() => setPage(safe + 1)}
        >
          {t.financial.next}
        </Button>
      </div>
    </>
  );
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
    }, install);
  }
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
      install,
    );
  }
  const status = (value: string) =>
    (t.financial.status as Record<string, string>)[value] ?? value;
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace"
        data-financial-workspace
        aria-busy={busy}
      >
        <div className="gl-tb-actions">
          <Button variant="outline" disabled={busy} onClick={onBack}>
            {t.financial.back}
          </Button>
          <LanguageSwitcher />
        </div>
        <h2 tabIndex={-1}>{t.financial.trialBalanceAndFinancialPosition}</h2>
        <p>
          {t.financial.reviewAccountsDimensionsMappingSignsPeriodAndCurrency}
        </p>
        <p>
          {t.financial.theResultIsConsistencyWithSuppliedPresentationEvidence}
        </p>
        <p>{t.financial.currentFamilyWholePostClosingTrialBalanceOne}</p>
        <div className="gl-tb-actions">
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
                    install,
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
        <div className="gl-tb-grid">
          {FINANCIAL_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy}>
              <legend>{t.financial.roles[i]}</legend>
              <input
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
        </div>
        <fieldset disabled={busy}>
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
        <div className="gl-tb-actions">
          <Button
            disabled={busy || !ready}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<{
                    state: FinancialInput;
                    result: FinancialResult;
                  }>('tb-financial-reconcile', state(), signal),
                install,
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
          <>
            <h2 data-financial-status>{status(result.status)}</h2>
            <DomainEvidenceAssistant result={result} snapshot={() => ({ domain: "financial", input: state(), result })} busy={busy} />
            <p>
              {t.financial.accounts}: {result.accounts.length} ·{' '}
              {t.financial.statementLines}: {result.lines.length} ·{' '}
              {t.financial.preservedSourceRows}: {result.inventory.length}
            </p>
            <p>
              {t.financial.allAmountsBelowAreIntegerMinorUnitsDecimals}:{' '}
              {result.decimals} · {result.scope.currency}
            </p>
            <p>
              {t.financial.trialBalanceDebitsCreditsResidual}:{' '}
              {result.tb?.debit ?? '—'} / {result.tb?.credit ?? '—'} /{' '}
              {result.tb?.residual ?? '—'}
            </p>
            <Table
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
                        result.totals![b][c],
                      ]),
                    )
                  : []
              }
            />
            <Table
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
                      result.grandTotals![b].assets,
                      result.grandTotals![b].liabilities,
                      result.grandTotals![b].equity,
                      result.grandTotals![b].equation,
                    ])
                  : []
              }
            />
            <fieldset disabled={busy}>
              <legend>{t.financial.reviewDecisionEvidence}</legend>
              <label>
                {t.financial.decisionReference}
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {t.financial.decisionReason}
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </fieldset>
            {result.lines.slice(linePage * 50, linePage * 50 + 50).map((l) => (
              <section key={l.id}>
                <h3>
                  {l.lineId} · {l.label} · {t.financial.categories[l.category]}{' '}
                  · {status(l.review)}
                </h3>
                <p>
                  {t.financial.calculatedReportedDifference}:{' '}
                  {l.calculated ?? '—'} / {l.reported} / {l.difference ?? '—'}
                </p>
                <details>
                  <summary>
                    {t.financial.allMappingMembersAndEvidence} (
                    {l.members.length})
                  </summary>
                  <Table
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
                      m.contribution,
                    ])}
                  />
                </details>
                <div className="gl-tb-actions">
                  {(['accept', 'reject', 'undo'] as const).map((type) => (
                    <Button
                      variant="outline"
                      key={type}
                      disabled={
                        busy ||
                        !reference.trim() ||
                        !note.trim() ||
                        l.review === 'blocked' ||
                        (type === 'undo'
                          ? l.review === 'needs-review'
                          : l.review !== 'needs-review') ||
                        (type === 'accept' &&
                          (!complete.confirmed ||
                            [
                              'source-error',
                              'missing',
                              'inconsistent',
                              'difference',
                            ].includes(result.status)))
                      }
                      onClick={() => void decide(l.lineId, type)}
                    >
                      {t.financial.decisionLabels[type]}
                    </Button>
                  ))}
                </div>
              </section>
            ))}
            <div className="gl-tb-actions">
              <Button
                variant="outline"
                disabled={!linePage}
                onClick={() => setLinePage(linePage - 1)}
              >
                {t.financial.previousLines}
              </Button>
              <span>
                {linePage + 1} /{' '}
                {Math.max(1, Math.ceil(result.lines.length / 50))}
              </span>
              <Button
                variant="outline"
                disabled={(linePage + 1) * 50 >= result.lines.length}
                onClick={() => setLinePage(linePage + 1)}
              >
                {t.financial.nextLines}
              </Button>
            </div>
            <details>
              <summary>
                {t.financial.sourceInventoryAndErrors} (
                {result.inventory.length})
              </summary>
              <Table
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
                  JSON.stringify(i.values),
                ])}
              />
            </details>
            <details>
              <summary>
                {t.financial.missingEvidence} ({result.missing.length})
              </summary>
              <Table
                headers={[t.financial.kind, t.financial.key]}
                rows={result.missing.map((m) => [m.kind, m.key])}
              />
            </details>
            <details>
              <summary>
                {t.financial.presentationAndPeriodEvidence} (
                {result.evidence.length})
              </summary>
              <Table
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
              <Table
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
          </>
        )}
      </section>
    </div>
  );
}
