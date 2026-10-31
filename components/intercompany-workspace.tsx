import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { IntercompanyBatchPanel } from '@/components/intercompany-batch-panel';
import { useEffect, useId, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount, Figures } from '@/components/amount';
import { RecordPager, RecordTable } from '@/components/record-table';
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
  IC_VERSION,
  IC_ROLES,
  IC_SCOPE_FIELDS,
  type IntercompanyInput,
  type IntercompanyScope,
  type IntercompanyResult,
  type IntercompanyEvent,
} from '@/lib/reconciliation/intercompany';
import {
  intercompanyDemo,
  intercompanyDemoScope,
} from '@/lib/reconciliation/intercompany-demo';
import { intercompanyCopy } from '@/lib/i18n/intercompany';
import './workspace-record.css';
import {
  DecisionButtons,
  DecisionHint,
  useDecisionFocus,
} from './decision-platform';
import type { AcceptBlock } from '@/lib/decision-platform';
const emptyScope = (): IntercompanyScope => ({
  entityA: '',
  entityB: '',
  ledgerA: '',
  ledgerB: '',
  accountA: '',
  accountB: '',
  dimensionsA: '',
  dimensionsB: '',
  currency: '',
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
  postingLayer: '',
  start: '',
  end: '',
  asOf: '',
  policyVersion: '',
  confirmed: false,
});
const readings = () =>
  IC_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: IC_VERSION,
    confirmed: false,
  })) as IntercompanyInput['readings'];
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function IntercompanyWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { engineText, lang } = useI18n();
  const copy = intercompanyCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings),
    [scope, setScope] = useState(emptyScope);
  const [complete, setComplete] = useState<IntercompanyInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<IntercompanyEvent[]>([]),
    [result, setResult] = useState<IntercompanyResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  const [pairPage, setPairPage] = useState(0);
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
    setPairPage(0);
    setResult(null);
    setEvents([]);
    setError('');
  }
  function state(): IntercompanyInput {
    return {
      files: files as IntercompanyInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: {
    state: IntercompanyInput;
    result: IntercompanyResult;
  }) {
    setFiles(v.state.files);
    setReading(v.state.readings);
    setScope(v.state.scope);
    setComplete(v.state.completeness);
    setEvents(v.state.events);
    setPairPage(0);
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
    IC_SCOPE_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('IC_SOURCE');
        return workerTask<SourceFile>(
          'intercompany-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as IntercompanyInput['readings'];
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
            'intercompany-read',
            {
              name: `pending-${i}.csv`,
              buffer: new TextEncoder().encode(intercompanyDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: IntercompanyInput = {
        files: f as IntercompanyInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as IntercompanyInput['readings'],
        scope: { ...intercompanyDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: 'Synthetic inventory attestation',
          note: 'Synthetic supplied inventory reviewed; not field evidence',
        },
        events: [],
      };
      return workerTask<{
        state: IntercompanyInput;
        result: IntercompanyResult;
      }>('intercompany-reconcile', s, signal);
    }, shown);
  }
  // The decision platform (UX-3): after a decision on a pair the focus
  // returns to that pair's heading, which holds its state, on the page that
  // shows it, not to the page.
  const hint = useId(),
    pairHeading = useId(),
    settle = useDecisionFocus();
  const headingAt = (at: number) => `${pairHeading}-${at}`;
  async function decide(relation: string, type: IntercompanyEvent['type']) {
    if (!result) return;
    const p = result.pairs.find((p) => p.relationId === relation)!;
    const e: IntercompanyEvent = {
      id: crypto.randomUUID(),
      type,
      context: result.context,
      relationId: relation,
      memberIds: p.members.map((e) => e.id),
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: IntercompanyInput; result: IntercompanyResult }>(
          'intercompany-reconcile',
          { ...state(), events: [...events, e] },
          signal,
        ),
      (v) => {
        install(v);
        const at = v.result.pairs.findIndex((q) => q.relationId === relation);
        if (at < 0) return;
        setPairPage(pageOfRow(at));
        settle(headingAt(at));
      },
    );
  }
  const pairsShown = recordPage(result?.pairs.length ?? 0, pairPage);
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  // What the decision buttons open on, as before: approval also needs the
  // completeness confirmation and every pair ready, and the sentence under
  // the fields says which of these is missing.
  const acceptBlock: AcceptBlock | null = !result
    ? null
    : !complete.confirmed
      ? 'unconfirmed'
      : result.issues.length
        ? 'source-error'
        : result.missing.length
          ? 'missing'
          : result.pairs.every((p) => p.status === 'ready')
            ? null
            : 'pairs';
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-intercompany-workspace
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
                      if (f.size > 64 * 1024 * 1024) throw Error('IC_SESSION');
                      return workerTask<{
                        state: IntercompanyInput;
                        result: IntercompanyResult;
                      }>(
                        'intercompany-restore',
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
          primaryIndices={[0, 1]}
          primaryReady={!!(files[0] && files[1])}
        >
          {IC_ROLES.map((role, i) => (
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
              <label>
                <input
                  type="checkbox"
                  checked={reading[i].confirmed}
                  disabled={!files[i]}
                  onChange={(e) => {
                    const r = [...reading] as IntercompanyInput['readings'];
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
        <fieldset disabled={busy} hidden={!(files[0] && files[1])}>
          <legend>{copy.scopeTitle}</legend>
          <div className="gl-tb-grid">
            {IC_SCOPE_FIELDS.map((k, i) => (
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
                    state: IntercompanyInput;
                    result: IntercompanyResult;
                  }>('intercompany-reconcile', state(), signal),
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
                  workerTask<ArrayBuffer>('intercompany-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-intercompany-session.json',
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
                    'intercompany-export',
                    { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-intercompany-workpaper.xlsx',
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
            {error.startsWith('IC_') || error.startsWith('BANK_NATIVE_DISPLAY')
              ? copy.failed
              : engineText(error)}
          </p>
        )}
        {result && (
          <section className="workspace-results">
            <h2
              data-intercompany-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({
                domain: 'intercompany',
                input: state(),
                result,
              })}
              busy={busy}
            />
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>
            </p>
            <RecordTable
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={
                result.totals
                  ? result.totals.map((t, i) => [
                      copy.roles[i],
                      ...(['debit', 'credit', 'net'] as const).map((k) => (
                        <Amount
                          key={k}
                          minor={t[k]}
                          decimals={result.decimals}
                        />
                      )),
                    ])
                  : []
              }
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
              <DecisionHint
                id={hint}
                input={{ reference, reason: note, review: 'each', acceptBlock }}
                labels={{ reference: copy.reference, reason: copy.note }}
              />
            </fieldset>
            <h3>
              {copy.pairs} ({result.pairs.length})
            </h3>
            {result.pairs.slice(pairsShown.from, pairsShown.to).map((p, i) => (
              <section
                key={p.relationRecord}
                data-intercompany-pair={p.relationId}
              >
                <h3
                  id={headingAt(pairsShown.from + i)}
                  tabIndex={-1}
                  data-decision-item
                >
                  {p.relationId} · {status(p.status)} · {status(p.review)}
                </h3>
                <p>
                  <Figures
                    decimals={result.decimals}
                    items={[
                      [copy.residualFigures[0], p.left?.net],
                      [copy.residualFigures[1], p.right?.net],
                      [copy.residualFigures[2], p.residual],
                    ]}
                  />
                </p>
                <details>
                  <summary>
                    {copy.entries} ({p.members.length})
                  </summary>
                  <RecordTable
                    label={`${copy.entries} · ${p.relationId}`}
                    headers={copy.pairHeaders}
                    rows={p.members.map((e) => [
                      p.relationId,
                      copy.roles[e.source],
                      e.transactionId,
                      e.counterpartyTransactionId,
                      e.account,
                      e.dimensions,
                      e.date,
                      ...(['debit', 'credit', 'net'] as const).map((k) => (
                        <Amount
                          key={k}
                          minor={e[k]}
                          decimals={result.decimals}
                        />
                      )),
                    ])}
                  />
                </details>
                <DecisionButtons
                  input={{
                    reference,
                    reason: note,
                    members: p.members.length,
                    review: p.review,
                    acceptBlock,
                  }}
                  labels={copy}
                  busy={busy}
                  describedBy={`${hint} ${headingAt(pairsShown.from + i)}`}
                  target={headingAt(pairsShown.from + i)}
                  onDecide={(type) => void decide(p.relationId, type)}
                />
              </section>
            ))}
            <RecordPager
              label={copy.pairs}
              length={result.pairs.length}
              page={pairPage}
              onPage={setPairPage}
            />
            <details>
              <summary>
                {copy.relations} ({result.relations.length})
              </summary>
              <RecordTable
                label={copy.relations}
                headers={copy.relationHeaders}
                rows={result.relations.map((r) => [
                  r.relationId,
                  r.leftId,
                  r.rightId,
                  r.validFrom,
                  r.validTo,
                  r.reference,
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.timing} ({result.timing.length})
              </summary>
              <RecordTable
                label={copy.timing}
                headers={copy.timingHeaders}
                rows={result.timing.map((r) => [
                  r.evidenceId,
                  r.side,
                  r.transactionId,
                  r.counterpartyTransactionId,
                  r.date,
                  r.amount,
                  r.reference,
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.missing} ({result.missing.length})
              </summary>
              <RecordTable
                label={copy.missing}
                headers={copy.missingHeaders}
                rows={result.missing.map((r) => [r.kind, r.key])}
              />
            </details>
            <details>
              <summary>
                {copy.issues} ({result.issues.length})
              </summary>
              <RecordTable
                label={copy.issues}
                headers={copy.issueHeaders}
                rows={result.issues.map((r) => [
                  r.code,
                  copy.roles[r.source],
                  r.row || copy.aggregate,
                  r.key,
                  r.related,
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
                rows={result.inventory.map((r) => [
                  copy.roles[r.source],
                  r.row,
                  r.kind,
                  r.errors.join(', '),
                  JSON.stringify(r.values),
                ])}
              />
            </details>
            <details>
              <summary>
                {copy.history} ({events.length})
              </summary>
              <RecordTable
                label={copy.history}
                headers={copy.eventHeaders}
                rows={events.map((e) => [
                  copy[e.type],
                  e.relationId,
                  e.at,
                  e.reference,
                  e.note,
                  JSON.stringify(e.memberIds),
                ])}
              />
            </details>
          </section>
        )}
        <IntercompanyBatchPanel />
      </section>
    </div>
  );
}
