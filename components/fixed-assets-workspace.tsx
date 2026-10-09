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
  ASSET_VERSION,
  ASSET_ROLES,
  ASSET_FIELDS,
  ASSET_COMPONENTS,
  type AssetInput,
  type AssetScope,
  type AssetResult,
  type AssetEvent,
} from '@/lib/reconciliation/fixed-assets';
import {
  assetDemo,
  assetDemoScope,
} from '@/lib/reconciliation/fixed-assets-demo';
import { assetCopy } from '@/lib/i18n/fixed-assets';
import './gl-tb-workspace.css';
const emptyScope = (): AssetScope =>
  ({
    ...Object.fromEntries(ASSET_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    postingStatus: 'posted',
    confirmed: false,
  }) as AssetScope;
const readings = () =>
  ASSET_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: ASSET_VERSION,
    confirmed: false,
  })) as AssetInput['readings'];
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
  const copy = assetCopy[lang];
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
export function AssetWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { lang } = useI18n();
  const copy = assetCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings),
    [scope, setScope] = useState(emptyScope);
  const [complete, setComplete] = useState<AssetInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<AssetEvent[]>([]),
    [result, setResult] = useState<AssetResult | null>(null);
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
  function state(): AssetInput {
    return {
      files: files as AssetInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: { state: AssetInput; result: AssetResult }) {
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
      if (id === runtime.current.serial && !control.signal.aborted) {
        apply(value);
        return value;
      }
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
    ASSET_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('ASSET_SOURCE');
        return workerTask<SourceFile>(
          'asset-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as AssetInput['readings'];
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
            'asset-read',
            {
              name: `source-${i}.csv`,
              buffer: new TextEncoder().encode(assetDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: AssetInput = {
        files: f as AssetInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as AssetInput['readings'],
        scope: { ...assetDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: copy.syntheticRef,
          note: copy.syntheticNote,
        },
        events: [],
      };
      return workerTask<{
        state: AssetInput;
        result: AssetResult;
      }>('asset-reconcile', s, signal);
    }, install);
  }
  async function decide(type: AssetEvent['type']) {
    if (!result) return;
    const e: AssetEvent = {
      id: crypto.randomUUID(),
      type,
      memberIds: [...result.memberIds],
      context: result.context,
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: AssetInput; result: AssetResult }>(
          'asset-reconcile',
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
  const detail = (
    title: string,
    headers: string[],
    rows: (string | number | null)[][],
  ) => (
    <details>
      <summary>
        {title} ({rows.length})
      </summary>
      <Table headers={headers} rows={rows} />
    </details>
  );
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-asset-workspace
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
                    if (f.size > 64 * 1024 * 1024) throw Error('ASSET_SESSION');
                    return workerTask<{
                      state: AssetInput;
                      result: AssetResult;
                    }>(
                      'asset-restore',
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
          {ASSET_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              {files[i] && (
                <>
                  <p>
                    <bdi>{files[i]!.name}</bdi>
                  </p>
                  <p style={{ overflowWrap: 'anywhere' }}>
                    <bdi>{files[i]!.sha256}</bdi>
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={reading[i].confirmed}
                      onChange={(e) => {
                        const next = [...reading] as AssetInput['readings'];
                        next[i] = { ...next[i], confirmed: e.target.checked };
                        setReading(next);
                        invalidate();
                      }}
                    />
                    {copy.roleConfirm}
                  </label>
                  {detail(
                    copy.roles[i],
                    files[i]!.sheets[0].rows[0] ?? [],
                    files[i]!.sheets[0].rows.slice(1),
                  )}
                </>
              )}
            </fieldset>
          ))}
        </div>
        <fieldset disabled={busy}>
          <legend>{copy.scopeTitle}</legend>
          <div className="gl-tb-grid">
            {ASSET_FIELDS.map((k) => (
              <label key={k}>
                {copy.scope[k]}
                <input
                  aria-label={copy.scopePrefix + copy.scope[k]}
                  maxLength={500}
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
          <legend>{copy.completeTitle}</legend>
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
              maxLength={2000}
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
              maxLength={2000}
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
                  workerTask<{ state: AssetInput; result: AssetResult }>(
                    'asset-reconcile',
                    state(),
                    signal,
                  ),
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
                  workerTask<ArrayBuffer>('asset-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-assets-session.json',
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
                    'asset-export',
                    { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-assets-evidence.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {copy.export}
          </Button>
        </div>
        {error && <p role="alert">{copy.failed}</p>}
        {result && (
          <section className="workspace-results">
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({
                domain: 'fixed-assets',
                input: state(),
                result,
              })}
              busy={busy}
              replay={async (captured) => {
                if (captured.domain !== 'fixed-assets') throw Error('DOMAIN');
                const fresh = await perform(
                  (signal) =>
                    workerTask<{ state: AssetInput; result: AssetResult }>(
                      'asset-reconcile',
                      captured.input,
                      signal,
                    ),
                  () => {},
                );
                if (!fresh) throw Error('STALE_EVIDENCE_REPLY');
                return {
                  domain: 'fixed-assets',
                  input: fresh.state,
                  result: fresh.result,
                };
              }}
            />
            <h2 data-asset-status>{status(result.status)}</h2>
            <p>
              {copy.units} · {result.scope.currency} · {result.decimals}
            </p>
            <Table
              headers={copy.totals}
              rows={[...ASSET_COMPONENTS, 'carrying' as const].map((k) => [
                copy.components[k],
                result.totals?.register[k] ?? null,
                result.totals?.gl[k] ?? null,
              ])}
            />
            <Table
              headers={copy.comparisons}
              rows={result.comparisons.map((v) => [
                v.account,
                v.dimensions,
                copy.components[v.component],
                v.register,
                v.gl,
                v.difference,
              ])}
            />
            <fieldset disabled={busy}>
              <legend>{copy.decision}</legend>
              <label>
                {copy.reference}
                <input
                  maxLength={2000}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>
                {status(result.review)} · {copy.members}:{' '}
                {result.memberIds.length}
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
            {detail(
              copy.roles[0],
              copy.records[0],
              result.records[0].map((v) => [
                v.row,
                v.asset,
                v.dimensions,
                v.cost,
                v.depreciation,
                v.impairment,
                v.carrying,
                v.valuation,
              ]),
            )}
            {detail(
              copy.roles[1],
              copy.records[1],
              result.records[1].map((v) => [
                v.row,
                v.id,
                v.asset,
                v.dimensions,
                copy.components[v.component],
                v.account,
                v.glDimensions,
                v.evidence,
              ]),
            )}
            {detail(
              copy.roles[2],
              copy.records[2],
              result.records[2].map((v) => [
                v.row,
                v.id,
                v.asset,
                v.dimensions,
                copy.components[v.component],
                v.valuation,
                v.account,
                v.glDimensions,
                v.accountClass,
                v.sign,
                v.basis,
                v.validFrom,
                v.validTo,
                v.reference,
              ]),
            )}
            {detail(
              copy.roles[3],
              copy.records[3],
              result.records[3].map((v) => [
                v.row,
                v.account,
                v.glDimensions,
                v.accountClass,
                v.debit,
                v.credit,
                copy.components[v.component],
                v.normal,
              ]),
            )}
            {detail(
              copy.members,
              copy.memberHeaders,
              result.memberIds.map((id) => {
                const v = JSON.parse(id);
                return [copy.roles[v[1]], v[4], id];
              }),
            )}
            {detail(
              copy.missing,
              copy.missingHeaders,
              result.missing.map((v) => [
                (copy.missingKinds as Record<string, string>)[v.reason] ??
                  v.reason,
                copy.roles[v.source],
                v.row,
                v.component ? copy.components[v.component] : '',
              ]),
            )}
            {detail(
              copy.issues,
              copy.issueHeaders,
              result.issues.map((v) => [
                copy.roles[v.source] ?? copy.title,
                v.row,
                (copy.codes as Record<string, string>)[v.code] ?? copy.failed,
              ]),
            )}
            {detail(
              copy.cells,
              copy.cellHeaders,
              result.cells.map((v) => [
                copy.roles[v.source],
                v.row,
                v.column,
                v.field,
                v.text,
              ]),
            )}
            {detail(
              copy.inventory,
              copy.inventoryHeaders,
              result.inventory.map((v) => [
                copy.roles[v.source],
                v.row,
                copy.kinds[v.kind],
              ]),
            )}
            {detail(
              copy.events,
              copy.eventHeaders,
              result.events.map((v) => [
                v.id,
                copy.actions[v.type],
                v.at,
                v.reference,
                v.note,
                v.memberIds.length,
              ]),
            )}
            {detail(
              copy.sources,
              copy.sourceHeaders,
              files.map((f, i) => [copy.roles[i], f!.name, f!.sha256!]),
            )}
          </section>
        )}
      </section>
    </div>
  );
}
