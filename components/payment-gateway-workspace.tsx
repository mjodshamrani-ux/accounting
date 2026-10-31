import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { PaymentGatewayBatchesPanel } from '@/components/payment-gateway-batches-panel';
import { useEffect, useId, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount } from '@/components/amount';
import { RecordTable } from '@/components/record-table';
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
  PG_VERSION,
  PG_SIGNED_VERSION,
  PG_ROLES,
  PG_SCOPE_FIELDS,
  type GatewayInput,
  type GatewayScope,
  type GatewayResult,
  type GatewayEvent,
} from '@/lib/reconciliation/payment-gateway';
import {
  gatewayDemo,
  gatewayDemoScope,
} from '@/lib/reconciliation/payment-gateway-demo';
import {
  gatewaySignedDemo,
  gatewaySignedDemoScope,
} from '@/lib/reconciliation/payment-gateway-signed-demo';
import { gatewayCopy } from '@/lib/i18n/payment-gateway';
import './workspace-record.css';
import {
  DecisionButtons,
  DecisionHint,
  useDecisionFocus,
} from './decision-platform';
import type { DecisionInput } from '@/lib/decision-platform';
// The value positions that hold money in each role's records, after the
// source row: the transaction amount, the fee amount, the four summary
// totals, and the bank credit.
const AMOUNT_VALUES = [[3], [2], [2, 3, 4, 5], [2]];
const emptyScope = (): GatewayScope =>
  ({
    ...Object.fromEntries(PG_SCOPE_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    fxPolicy: 'same-currency-no-conversion',
    confirmed: false,
  }) as GatewayScope;
const readings = () =>
  PG_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: PG_VERSION,
    confirmed: false,
  })) as GatewayInput['readings'];
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function GatewayWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { engineText, lang } = useI18n();
  const copy = gatewayCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings),
    [scope, setScope] = useState(emptyScope);
  const [complete, setComplete] = useState<GatewayInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<GatewayEvent[]>([]),
    [result, setResult] = useState<GatewayResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
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
    setResult(null);
    setEvents([]);
    setError('');
  }
  function state(): GatewayInput {
    return {
      files: files as GatewayInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: { state: GatewayInput; result: GatewayResult }) {
    setFiles(v.state.files);
    setReading(v.state.readings);
    setScope(v.state.scope);
    setComplete(v.state.completeness);
    setEvents(v.state.events);
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
    PG_SCOPE_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('PG_SOURCE');
        return workerTask<SourceFile>(
          'gateway-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as GatewayInput['readings'];
        r[source] = { ...r[source], confirmed: false };
        setReading(r);
        setComplete({ ...complete, confirmed: false });
        invalidate();
      },
    );
  }
  async function demo(signed = false) {
    await perform(async (signal) => {
      const f: SourceFile[] = [];
      for (let i = 0; i < 4; i++)
        f.push(
          await workerTask<SourceFile>(
            'gateway-read',
            {
              name: `${signed ? 'signed' : 'pending'}-${i}.csv`,
              buffer: new TextEncoder().encode(
                (signed ? gatewaySignedDemo : gatewayDemo)[i],
              ).buffer,
            },
            signal,
          ),
        );
      const s: GatewayInput = {
        files: f as GatewayInput['files'],
        readings: readings().map((r, i) => ({
          ...r,
          family: signed && i === 0 ? PG_SIGNED_VERSION : PG_VERSION,
          confirmed: true,
        })) as GatewayInput['readings'],
        scope: {
          ...(signed ? gatewaySignedDemoScope : gatewayDemoScope),
          confirmed: true,
        },
        completeness: {
          confirmed: true,
          reference: 'Synthetic inventory attestation',
          note: 'Synthetic supplied inventory reviewed; not field evidence',
        },
        events: [],
      };
      return workerTask<{
        state: GatewayInput;
        result: GatewayResult;
      }>('gateway-reconcile', s, signal);
    }, shown);
  }
  // The decision platform (UX-3): after a decision the focus returns to the
  // line that holds the state, not to the page.
  const hint = useId(),
    decisionState = useId(),
    settle = useDecisionFocus();
  const decided: typeof install = (v) => {
    install(v);
    settle(decisionState);
  };
  async function decide(type: GatewayEvent['type']) {
    if (!result) return;
    const e: GatewayEvent = {
      id: crypto.randomUUID(),
      type,
      batchId: result.scope.batchId,
      memberIds: [...result.memberIds],
      context: result.context,
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: GatewayInput; result: GatewayResult }>(
          'gateway-reconcile',
          { ...state(), events: [...events, e] },
          signal,
        ),
      decided,
    );
  }
  const amounts = (values: number[]) =>
    values.map((v, i) => (
      <Amount key={i} minor={v} decimals={result?.decimals ?? 2} />
    ));
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  // What the decision buttons open on, as before: approval also needs the
  // completeness confirmation and a ready result, and the sentence under the
  // buttons says which of these is missing.
  const decision: DecisionInput | null = result
    ? {
        reference,
        reason: note,
        members: result.memberIds.length,
        review: result.review,
        acceptBlock: !complete.confirmed
          ? 'unconfirmed'
          : result.issues.length
            ? 'source-error'
            : result.missing.length
              ? 'missing'
              : result.financial === 'ready'
                ? null
                : result.financial,
      }
    : null;
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-gateway-workspace
        aria-busy={busy}
      >
        <WorkspaceHeader
          onBack={onBack}
          backLabel={copy.back}
          disabled={busy}
          hasWork={files.some(Boolean)}
        />
        <WorkspaceIntro title={copy.title} intro={copy.intro}>
          <p>{copy.claim}</p>
          <p>{copy.family}</p>
        </WorkspaceIntro>
        <WorkspaceAdvanced>
          <div className="gl-tb-actions workspace-toolbar">
            <Button disabled={busy} onClick={() => void demo()}>
              {copy.demo}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void demo(true)}
            >
              {copy.signedDemo}
            </Button>
            <label>
              {copy.restore}
              <input
                type="file"
                accept=".json"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void perform(async (signal) => {
                      if (f.size > 64 * 1024 * 1024) throw Error('PG_SESSION');
                      return workerTask<{
                        state: GatewayInput;
                        result: GatewayResult;
                      }>(
                        'gateway-restore',
                        { buffer: await f.arrayBuffer() },
                        signal,
                      );
                    }, shown);
                }}
              />
            </label>
            {busy && (
              <Button variant="outline" onClick={cancel}>
                {copy.cancel}
              </Button>
            )}
          </div>
        </WorkspaceAdvanced>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 2]}
          primaryReady={!!(files[0] && files[2])}
        >
          {PG_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              <p>{files[i]?.name ?? copy.empty}</p>
              {i === 0 && (
                <label>
                  {copy.amountFamily}
                  <select
                    aria-label={copy.amountFamily}
                    value={reading[0].family}
                    onChange={(e) => {
                      const r = [...reading] as GatewayInput['readings'];
                      r[0] = {
                        sheet: 0,
                        role: 'transactions',
                        family:
                          e.target.value === PG_SIGNED_VERSION
                            ? PG_SIGNED_VERSION
                            : PG_VERSION,
                        confirmed: false,
                      };
                      setReading(r);
                      setComplete({ ...complete, confirmed: false });
                      invalidate();
                    }}
                  >
                    <option value={PG_VERSION}>{copy.unsignedFamily}</option>
                    <option value={PG_SIGNED_VERSION}>
                      {copy.signedFamily}
                    </option>
                  </select>
                  {reading[0].family === PG_SIGNED_VERSION && (
                    <span className="workspace-field-help">
                      {copy.signedHelp}
                    </span>
                  )}
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={reading[i].confirmed}
                  disabled={!files[i]}
                  onChange={(e) => {
                    const r = [...reading] as GatewayInput['readings'];
                    r[i] = { ...r[i], confirmed: e.target.checked };
                    setReading(r);
                    invalidate();
                  }}
                />
                {copy.readingConfirm}
              </label>
            </fieldset>
          ))}
        </WorkspaceSources>
        <fieldset disabled={busy} hidden={!(files[0] && files[2])}>
          <legend>{copy.scopeTitle}</legend>
          <div className="gl-tb-grid">
            {PG_SCOPE_FIELDS.map((k, i) => (
              <label key={k}>
                {copy.scope[i]}
                <input
                  aria-label={`${copy.scopePrefix} ${copy.scope[i]}`}
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
            {copy.scopeConfirm}
          </label>
        </fieldset>
        <WorkspaceAdvanced summary={copy.completenessTitle}>
          <fieldset disabled={busy}>
            <legend>{copy.completenessTitle}</legend>
            <label>
              <input
                type="checkbox"
                checked={complete.confirmed}
                onChange={(e) => {
                  setComplete({ ...complete, confirmed: e.target.checked });
                  invalidate();
                }}
              />
              {copy.complete}
            </label>
            <label>
              {copy.completeReference}
              <input
                value={complete.reference}
                onChange={(e) => {
                  setComplete({ ...complete, reference: e.target.value });
                  invalidate();
                }}
              />
            </label>
            <label>
              {copy.completeNote}
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
                    state: GatewayInput;
                    result: GatewayResult;
                  }>('gateway-reconcile', state(), signal),
                shown,
              )
            }
          >
            {copy.compare}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>('gateway-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-gateway-session.json',
                    'application/json',
                  ),
              )
            }
          >
            {copy.save}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>(
                    'gateway-export',
                    { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-gateway-workpaper.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {copy.export}
          </Button>
        </div>
        {error && (
          <p role="alert">
            {error.startsWith('PG_') || error.startsWith('BANK_NATIVE_DISPLAY')
              ? copy.failed
              : engineText(error)}
          </p>
        )}
        {result && (
          <section className="workspace-results">
            <h2
              data-gateway-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({ domain: 'gateway', input: state(), result })}
              busy={busy}
            />
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>
            </p>
            <RecordTable
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={result.totals ? [amounts(result.totals)] : []}
            />
            <RecordTable
              label={copy.tableNames.residuals}
              headers={copy.residuals}
              rows={result.residuals ? [amounts(result.residuals)] : []}
            />
            <fieldset disabled={busy} data-decision-platform>
              <legend>{copy.decisionTitle}</legend>
              <label>
                {copy.reference}
                <input
                  aria-describedby={hint}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input
                  aria-describedby={hint}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p id={decisionState} tabIndex={-1} data-decision-state>
                {result.scope.batchId} · {status(result.review)} ·{' '}
                {copy.members}: {result.memberIds.length}
              </p>
              {decision && (
                <>
                  <DecisionButtons
                    input={decision}
                    labels={copy}
                    busy={busy}
                    describedBy={hint}
                    onDecide={(type) => void decide(type)}
                  />
                  <DecisionHint
                    id={hint}
                    input={decision}
                    labels={{ reference: copy.reference, reason: copy.note }}
                  />
                </>
              )}
            </fieldset>
            {result.records.map((records, i) => (
              <details key={i}>
                <summary>
                  {copy.roles[i]} ({records.length})
                </summary>
                <RecordTable
                  source={copy.roles[i]}
                  headers={
                    i === 0 && result.readings[0].family === PG_SIGNED_VERSION
                      ? copy.signedRecords
                      : copy.records[i]
                  }
                  rows={records.map((e) => [
                    e.row,
                    ...e.values.map((v, j) =>
                      i === 0 && j === 1 ? (
                        v === 'sale' ? (
                          copy.sale
                        ) : (
                          copy.refund
                        )
                      ) : i === 0 && j === 3 && e.signedAmount ? (
                        e.signedAmount.raw
                      ) : AMOUNT_VALUES[i].includes(j) &&
                        typeof v === 'number' ? (
                        <Amount key={j} minor={v} decimals={result.decimals} />
                      ) : (
                        v
                      ),
                    ),
                    ...(e.signedAmount
                      ? amounts([
                          e.signedAmount.signedMinor,
                          e.signedAmount.magnitude,
                        ])
                      : []),
                  ])}
                />
              </details>
            ))}
            <details>
              <summary>
                {copy.members} ({result.memberIds.length})
              </summary>
              <RecordTable
                label={copy.members}
                headers={copy.memberHeaders}
                rows={result.memberIds.map((id) => {
                  const original = JSON.parse(id) as [
                    string,
                    number,
                    string,
                    number,
                    number,
                  ];
                  return [copy.roles[original[1]], original[4], id];
                })}
              />
            </details>
            <details>
              <summary>
                {copy.missing} ({result.missing.length})
              </summary>
              <RecordTable
                label={copy.missing}
                headers={[copy.missing]}
                rows={result.missing.map((k) => [
                  copy.roles[PG_ROLES.indexOf(k as (typeof PG_ROLES)[number])],
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.issues} ({result.issues.length})
              </summary>
              <RecordTable
                label={copy.issues}
                headers={copy.issueHeaders}
                rows={result.issues.map((e) => [
                  (copy.issueReasons as Record<string, string>)[e.code] ??
                    e.code,
                  copy.roles[e.source],
                  e.row || copy.aggregate,
                  e.key,
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.inventory} ({result.inventory.length})
              </summary>
              <RecordTable
                label={copy.inventory}
                headers={copy.inventoryHeaders}
                rows={result.inventory.map((e) => [
                  copy.roles[e.source],
                  e.row,
                  e.kind,
                  e.errors.join(' | '),
                  JSON.stringify(files[e.source]!.sheets[0].rows[e.row - 1]),
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.history} ({result.events.length})
              </summary>
              <RecordTable
                label={copy.history}
                headers={copy.eventHeaders}
                rows={result.events.map((e) => [
                  copy[e.type],
                  e.batchId,
                  e.at,
                  e.reference,
                  e.note,
                  JSON.stringify(e.memberIds),
                ])}
              />
            </details>
          </section>
        )}
        <PaymentGatewayBatchesPanel />
      </section>
    </div>
  );
}
