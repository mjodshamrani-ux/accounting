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
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import { money } from '@/lib/reconciliation/core';
import {
  BALANCE_FIELDS,
  GL_SCOPE_FIELDS,
  type GlTbInput,
  type GlTbReading,
  type GlTbResult,
  type GlTbScope,
  type GlScopeField,
} from '@/lib/reconciliation/gl-tb';
import {
  glDemoScope,
  glDemoReadings,
  glTbDemo,
} from '@/lib/reconciliation/gl-tb-demo';
import './gl-tb-workspace.css';
const freshScope = (): GlTbScope => ({
  ...glDemoScope,
  entity: '',
  ledger: '',
  account: '',
  dimensions: '',
  postingLayer: '',
  start: '',
  end: '',
  confirmed: false,
});
const freshReading = (side: number): GlTbReading => ({
  ...glDemoReadings[side],
  confirmed: false,
});
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function GlTbWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue } = useI18n(),
    t = catalogue.glTb;
  const [files, setFiles] = useState<[SourceFile | null, SourceFile | null]>([
      null,
      null,
    ]),
    [readings, setReadings] = useState<[GlTbReading, GlTbReading]>([
      freshReading(0),
      freshReading(1),
    ]),
    [scope, setScope] = useState(freshScope),
    [result, setResult] = useState<GlTbResult | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [page, setPage] = useState(0);
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
    },
    [],
  );
  function invalidate() {
    setResult(null);
    setFailed(false);
    setPage(0);
  }
  const input = (): GlTbInput => ({
    files: files as GlTbInput['files'],
    readings,
    scope,
  });
  function install(value: { state: GlTbInput; result: GlTbResult }) {
    setFiles(value.state.files);
    setReadings(value.state.readings);
    setScope(value.state.scope);
    setResult(value.result);
    setPage(0);
  }
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current = control;
    setBusy(true);
    setFailed(false);
    try {
      await prepareWorker();
      if (!control.signal.aborted) await work(control.signal);
    } catch {
      if (id === serial.current && !control.signal.aborted) setFailed(true);
    } finally {
      if (id === serial.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function upload(side: 0 | 1, blob: File) {
    if (blob.size > MAX_FILE_BYTES || !/\.(csv|xlsx)$/i.test(blob.name)) {
      setFailed(true);
      return;
    }
    await perform(async (signal) => {
      const source = await workerTask<SourceFile>(
        'read',
        { name: blob.name, buffer: await blob.arrayBuffer() },
        signal,
      );
      setFiles((previous) => {
        const next = [...previous] as typeof files;
        next[side] = source;
        return next;
      });
      setReadings((previous) => {
        const next = [...previous] as typeof readings;
        next[side] = freshReading(side);
        return next;
      });
      invalidate();
    });
  }
  function updateScope(key: GlScopeField, value: string) {
    setScope((previous) => ({ ...previous, [key]: value, confirmed: false }));
    invalidate();
  }
  const formatted = (n: number | null | undefined) =>
    n === null || n === undefined ? t.missing : money(n, result!.decimals);
  const rowById = new Map(result?.rows.map((r) => [`${r.side}:${r.row}`, r]));
  if (!active) return null;
  return (
    <main
      className="app-shell gl-tb-workspace reconciliation-workspace"
      aria-busy={busy}
    >
      <WorkspaceHeader onBack={onBack} backLabel={t.back} disabled={busy} />
      <WorkspaceIntro title={t.title} intro={t.intro}>
        <p>{t.limits}</p>
        <p>{t.claim}</p>
      </WorkspaceIntro>
      <fieldset disabled={busy}>
        <div className="gl-tb-actions workspace-toolbar">
          <Button
            onClick={() =>
              perform(async (signal) => {
                const source: SourceFile[] = [];
                for (const demo of glTbDemo())
                  source.push(await workerTask('read', demo, signal));
                install(
                  await workerTask(
                    'gl-tb-reconcile',
                    {
                      files: source,
                      readings: glDemoReadings,
                      scope: glDemoScope,
                    },
                    signal,
                  ),
                );
              })
            }
          >
            {t.sample}
          </Button>
          <label>
            {t.restore}
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                  void perform(async (signal) => {
                    if (file.size > 32 * 1024 * 1024)
                      throw Error('GL_TB_SESSION');
                    install(
                      await workerTask(
                        'gl-tb-restore',
                        { buffer: await file.arrayBuffer() },
                        signal,
                      ),
                    );
                  });
              }}
            />
          </label>
        </div>
        <WorkspaceGroupTitle kind="sources" />
        <div className="gl-tb-grid workspace-sources">
          {([0, 1] as const).map((side) => (
            <section
              className="workspace-source"
              key={side}
              data-testid={`gl-tb-source-${side}`}
            >
              <h2>
                <WorkspaceSourceHeading>{t.sides[side]}</WorkspaceSourceHeading>
              </h2>
              <label>
                {t.sides[side]}
                <WorkspaceFileInput
                  aria-label={t.sides[side]}
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void upload(side, file);
                  }}
                />
              </label>
              {files[side] && (
                <>
                  <h3>{files[side]!.name}</h3>
                  <label>
                    {t.sides[side]}: {t.sheet}
                    <select
                      value={readings[side].sheet}
                      onChange={(event) => {
                        const next = [...readings] as typeof readings;
                        next[side] = {
                          ...readings[side],
                          sheet: Number(event.target.value),
                          confirmed: false,
                        };
                        setReadings(next);
                        invalidate();
                      }}
                    >
                      {files[side]!.sheets.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <pre dir="ltr">
                    {files[side]!.sheets[readings[side].sheet]?.rows[0]?.join(
                      ' | ',
                    )}
                  </pre>
                  <label>
                    <input
                      type="checkbox"
                      checked={readings[side].confirmed}
                      onChange={(event) => {
                        const next = [...readings] as typeof readings;
                        next[side] = {
                          ...readings[side],
                          confirmed: event.target.checked,
                        };
                        setReadings(next);
                        invalidate();
                      }}
                    />
                    {t.sides[side]}: {t.sourceConfirm}
                  </label>
                </>
              )}
            </section>
          ))}
        </div>
        <section className="workspace-scope">
          <WorkspaceGroupTitle kind="scope" />
          <div className="gl-tb-grid">
            {GL_SCOPE_FIELDS.map((key) => (
              <label key={key}>
                {t.fields[key]}
                {key === 'currencyBasis' || key === 'postingStatus' ? (
                  <select
                    value={scope[key]}
                    onChange={(event) => updateScope(key, event.target.value)}
                  >
                    <option
                      value={key === 'currencyBasis' ? 'functional' : 'posted'}
                    >
                      {key === 'currencyBasis'
                        ? t.functionalLabel
                        : t.postedLabel}
                    </option>
                  </select>
                ) : (
                  <input
                    type={key === 'start' || key === 'end' ? 'date' : 'text'}
                    value={scope[key]}
                    onChange={(event) => updateScope(key, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={scope.confirmed}
              onChange={(event) => {
                setScope({ ...scope, confirmed: event.target.checked });
                invalidate();
              }}
            />
            {t.scopeConfirm}
          </label>
        </section>
        <Button
          disabled={
            !files.every(Boolean) ||
            !readings.every((r) => r.confirmed) ||
            !scope.confirmed
          }
          onClick={() =>
            perform(async (signal) =>
              install(await workerTask('gl-tb-reconcile', input(), signal)),
            )
          }
        >
          {t.compare}
        </Button>
      </fieldset>
      {failed && <p role="alert">{t.failure}</p>}
      {result && (
        <section data-testid="gl-tb-result">
          <h2>{t.result}</h2>
          <DomainEvidenceAssistant
            result={result}
            snapshot={() => ({ domain: 'gl-tb', input: input(), result })}
            busy={busy}
          />
          <p data-testid="gl-tb-status">{t.status[result.status]}</p>
          <p>
            {t.glBridge}: <strong>{formatted(result.glBridge)}</strong>
          </p>
          <p>
            {t.tbBridge}: <strong>{formatted(result.tbBridge)}</strong>
          </p>
          {result.missing.length > 0 && (
            <p>
              {t.missing}:{' '}
              {result.missing.map((k) => t.missingLabels[k]).join(' / ')}
            </p>
          )}
          <div className="gl-tb-table">
            <table data-testid="gl-tb-balances">
              <thead>
                <tr>
                  {[t.component, t.gl, t.tb, t.difference].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BALANCE_FIELDS.map((field) => (
                  <tr key={field}>
                    <th>{t.components[field]}</th>
                    <td>{formatted(result.gl?.[field])}</td>
                    <td>{formatted(result.tb?.[field])}</td>
                    <td>{formatted(result.differences?.[field])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="gl-tb-actions">
            <Button
              disabled={busy}
              onClick={() =>
                perform(async (signal) =>
                  download(
                    await workerTask('gl-tb-save', input(), signal),
                    'tarasuf-gl-tb-session.json',
                    'application/json',
                  ),
                )
              }
            >
              {t.save}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                perform(async (signal) =>
                  download(
                    await workerTask(
                      'gl-tb-export',
                      { state: input(), result },
                      signal,
                    ),
                    'tarasuf-gl-tb-workpaper.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
                )
              }
            >
              {t.export}
            </Button>
          </div>
          <h3>{t.inventory}</h3>
          <div className="gl-tb-table">
            <table data-testid="gl-tb-inventory">
              <thead>
                <tr>
                  {[
                    t.sides.join(' / '),
                    t.row,
                    t.kind,
                    t.error,
                    t.original,
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.inventory.slice(page * 50, (page + 1) * 50).map((i) => {
                  const row = rowById.get(`${i.side}:${i.row}`);
                  return (
                    <tr key={`${i.side}:${i.row}`}>
                      <td>{t.sides[i.side]}</td>
                      <td>{i.row}</td>
                      <td>{t.kinds[i.kind]}</td>
                      <td>
                        {i.error
                          ? (t.rowErrors[i.error as keyof typeof t.rowErrors] ??
                            t.failure)
                          : ''}
                      </td>
                      <td>
                        <details>
                          <summary>{t.original}</summary>
                          <pre dir="auto">{JSON.stringify(i.values)}</pre>
                          {row && (
                            <>
                              <p>
                                {t.record}: {row.record}
                              </p>
                              <p>{t.cellEvidence}</p>
                              <ul>
                                {row.trace.map((cell) => (
                                  <li key={cell.column}>
                                    {t.column} {cell.column}:{' '}
                                    <bdi>{cell.text}</bdi> → {cell.amount} (
                                    {t.minor})
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="gl-tb-actions">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t.previous}
            </Button>
            <span>
              {page + 1} /{' '}
              {Math.max(1, Math.ceil(result.inventory.length / 50))}
            </span>
            <Button
              variant="outline"
              disabled={(page + 1) * 50 >= result.inventory.length}
              onClick={() => setPage(page + 1)}
            >
              {t.next}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
