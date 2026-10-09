import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
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
import './gl-tb-workspace.css';
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
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null)[][];
}) {
  const { lang } = useI18n();
  const copy = intercompanyCopy[lang];
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
          {copy.previous}
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
          {copy.next}
        </Button>
      </div>
    </>
  );
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
    }, install);
  }
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
      install,
    );
  }
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  const canAccept =
    result &&
    complete.confirmed &&
    !result.issues.length &&
    !result.missing.length &&
    result.pairs.every((p) => p.status === 'ready');
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
        />
        <WorkspaceIntro title={copy.title} intro={copy.intro}>
          <p>{copy.claim}</p>
          <p>{copy.family}</p>
        </WorkspaceIntro>
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
                  }, install);
              }}
            />
          </label>
          {busy && (
            <Button variant="outline" onClick={cancel}>
              {copy.cancel}
            </Button>
          )}
        </div>
        <WorkspaceGroupTitle kind="sources" />
        <div className="gl-tb-grid workspace-sources">
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
        </div>
        <fieldset disabled={busy}>
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
                install,
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
            <h2 data-intercompany-status>{status(result.status)}</h2>
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
              {copy.units}: {result.decimals} · {result.scope.currency}
            </p>
            <Table
              headers={copy.totals}
              rows={
                result.totals
                  ? result.totals.map((t, i) => [
                      copy.roles[i],
                      t.debit,
                      t.credit,
                      t.net,
                    ])
                  : []
              }
            />
            <fieldset disabled={busy}>
              <legend>{copy.decisionTitle}</legend>
              <label>
                {copy.reference}
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </fieldset>
            <h3>
              {copy.pairs} ({result.pairs.length})
            </h3>
            {result.pairs.slice(pairPage * 50, pairPage * 50 + 50).map((p) => (
              <section
                key={p.relationRecord}
                data-intercompany-pair={p.relationId}
              >
                <h3>
                  {p.relationId} · {status(p.status)} · {status(p.review)}
                </h3>
                <p>
                  {copy.residual}: {p.left?.net ?? '—'} / {p.right?.net ?? '—'}{' '}
                  / {p.residual ?? '—'}
                </p>
                <details>
                  <summary>
                    {copy.entries} ({p.members.length})
                  </summary>
                  <Table
                    headers={copy.pairHeaders}
                    rows={p.members.map((e) => [
                      p.relationId,
                      copy.roles[e.source],
                      e.transactionId,
                      e.counterpartyTransactionId,
                      e.account,
                      e.dimensions,
                      e.date,
                      e.debit,
                      e.credit,
                      e.net,
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
                        !p.members.length ||
                        (type === 'undo'
                          ? p.review === 'needs-review'
                          : p.review !== 'needs-review') ||
                        (type === 'accept' && !canAccept)
                      }
                      onClick={() => void decide(p.relationId, type)}
                    >
                      {copy[type]}
                    </Button>
                  ))}
                </div>
              </section>
            ))}
            <div className="gl-tb-actions">
              <Button
                variant="outline"
                disabled={!pairPage}
                onClick={() => setPairPage(pairPage - 1)}
              >
                {copy.previous}
              </Button>
              <span>
                {pairPage + 1} /{' '}
                {Math.max(1, Math.ceil(result.pairs.length / 50))}
              </span>
              <Button
                variant="outline"
                disabled={(pairPage + 1) * 50 >= result.pairs.length}
                onClick={() => setPairPage(pairPage + 1)}
              >
                {copy.next}
              </Button>
            </div>
            <details>
              <summary>
                {copy.relations} ({result.relations.length})
              </summary>
              <Table
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
              <Table
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
              <Table
                headers={copy.missingHeaders}
                rows={result.missing.map((r) => [r.kind, r.key])}
              />
            </details>
            <details>
              <summary>
                {copy.issues} ({result.issues.length})
              </summary>
              <Table
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
              <Table
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
              <Table
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
      </section>
    </div>
  );
}
