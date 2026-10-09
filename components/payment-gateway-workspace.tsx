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
  PG_VERSION,
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
import { gatewayCopy } from '@/lib/i18n/payment-gateway';
import './gl-tb-workspace.css';
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
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null)[][];
}) {
  const { lang } = useI18n();
  const copy = gatewayCopy[lang];
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
  async function demo() {
    await perform(async (signal) => {
      const f: SourceFile[] = [];
      for (let i = 0; i < 4; i++)
        f.push(
          await workerTask<SourceFile>(
            'gateway-read',
            {
              name: `pending-${i}.csv`,
              buffer: new TextEncoder().encode(gatewayDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: GatewayInput = {
        files: f as GatewayInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as GatewayInput['readings'],
        scope: { ...gatewayDemoScope, confirmed: true },
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
    }, install);
  }
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
    result.financial === 'ready';
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
                    if (f.size > 64 * 1024 * 1024) throw Error('PG_SESSION');
                    return workerTask<{
                      state: GatewayInput;
                      result: GatewayResult;
                    }>(
                      'gateway-restore',
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
        </div>
        <fieldset disabled={busy}>
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
                    state: GatewayInput;
                    result: GatewayResult;
                  }>('gateway-reconcile', state(), signal),
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
            <h2 data-gateway-status>{status(result.status)}</h2>
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({ domain: 'gateway', input: state(), result })}
              busy={busy}
            />
            <p>
              {copy.units}: {result.decimals} · {result.scope.currency}
            </p>
            <Table
              headers={copy.totals}
              rows={result.totals ? [result.totals] : []}
            />
            <Table
              headers={copy.residuals}
              rows={result.residuals ? [result.residuals] : []}
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
              <p>
                {result.scope.batchId} · {status(result.review)} ·{' '}
                {copy.members}: {result.memberIds.length}
              </p>
              <div className="gl-tb-actions">
                {(['accept', 'reject', 'undo'] as const).map((type) => (
                  <Button
                    key={type}
                    variant="outline"
                    disabled={
                      busy ||
                      !reference.trim() ||
                      !note.trim() ||
                      !result.memberIds.length ||
                      (type === 'undo'
                        ? result.review === 'needs-review'
                        : result.review !== 'needs-review') ||
                      (type === 'accept' && !canAccept)
                    }
                    onClick={() => void decide(type)}
                  >
                    {copy[type]}
                  </Button>
                ))}
              </div>
            </fieldset>
            {result.records.map((records, i) => (
              <details key={i}>
                <summary>
                  {copy.roles[i]} ({records.length})
                </summary>
                <Table
                  headers={copy.records[i]}
                  rows={records.map((e) => [
                    e.row,
                    ...e.values.map((v, j) =>
                      i === 0 && j === 1
                        ? v === 'sale'
                          ? copy.sale
                          : copy.refund
                        : v,
                    ),
                  ])}
                />
              </details>
            ))}
            <details>
              <summary>
                {copy.members} ({result.memberIds.length})
              </summary>
              <Table
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
              <Table
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
              <Table
                headers={copy.issueHeaders}
                rows={result.issues.map((e) => [
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
              <Table
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
              <Table
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
      </section>
    </div>
  );
}
