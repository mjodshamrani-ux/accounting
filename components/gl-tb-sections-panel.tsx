import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import {
  GLS_COMPONENTS,
  GLS_SCOPE_FIELDS,
  GLS_VERSION,
  type GlsAccount,
  type GlsInput,
  type GlsResult,
  type GlsScope,
} from '@/lib/reconciliation/gl-tb-sections';
import { glTbSectionsCopy } from '@/lib/i18n/gl-tb-sections';
import './intercompany-batch-panel.css';

type Picked = { file: SourceFile; confirmed: boolean };
type Field = (typeof GLS_SCOPE_FIELDS)[number];
// Minor units shown with the run currency's decimals; never a float sum.
function minorText(value: number, decimals: number) {
  const digits = String(value).padStart(decimals + 1, '0');
  return decimals
    ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : digits;
}
const blankScope = () =>
  Object.fromEntries(GLS_SCOPE_FIELDS.map((k) => [k, ''])) as Record<
    Field,
    string
  >;

function Paged({
  headers,
  rows,
  label,
  marks,
  pager,
}: {
  headers: string[];
  rows: string[][];
  label: string;
  marks?: Record<string, string>[];
  pager?: string;
}) {
  const { lang } = useI18n();
  const copy = glTbSectionsCopy[lang];
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / 50)),
    safe = Math.min(page, pages - 1);
  return (
    <>
      <div className="gl-tb-table">
        <table aria-label={label}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safe * 50, safe * 50 + 50).map((row, i) => (
              <tr key={i} {...marks?.[safe * 50 + i]}>
                {row.map((v, j) => (
                  <td key={j}>
                    <bdi>{v}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="gl-tb-actions" data-gls-pager={pager}>
          <Button
            variant="outline"
            disabled={!safe}
            onClick={() => setPage(safe - 1)}
          >
            {copy.previous}
          </Button>
          <span>
            {safe + 1} / {pages} · {rows.length}
          </span>
          <Button
            variant="outline"
            disabled={safe + 1 >= pages}
            onClick={() => setPage(safe + 1)}
          >
            {copy.next}
          </Button>
        </div>
      )}
    </>
  );
}

export function GlTbSectionsPanel() {
  const { lang } = useI18n();
  const copy = glTbSectionsCopy[lang];
  const [gl, setGl] = useState<Picked | null>(null),
    [tb, setTb] = useState<Picked | null>(null),
    [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<GlsResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  useEffect(() => {
    const live = runtime.current;
    return () => {
      live.serial++;
      live.controller?.abort();
    };
  }, []);
  function cancel() {
    runtime.current.serial++;
    runtime.current.controller?.abort();
    runtime.current.running = false;
    setBusy(false);
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
    } catch {
      if (id === runtime.current.serial && !control.signal.aborted)
        setError(copy.failed);
    } finally {
      if (id === runtime.current.serial) {
        runtime.current.running = false;
        setBusy(false);
      }
    }
  }
  // Any new file, scope value or confirmation makes the shown result stale.
  const invalidate = () => {
    setResult(null);
    setError('');
  };
  const ready = !!gl?.confirmed && !!tb?.confirmed && scopeConfirmed;
  function check() {
    const input: GlsInput = {
      files: [gl!.file, tb!.file],
      readings: [
        { sheet: 0, role: 'gl-sections', family: GLS_VERSION, confirmed: true },
        { sheet: 0, role: 'tb-pages', family: GLS_VERSION, confirmed: true },
      ],
      scope: { ...scope, confirmed: true } as GlsScope,
    };
    void perform(
      (signal) =>
        workerTask<{ state: GlsInput; result: GlsResult }>(
          'gl-tb-sections-reconcile',
          input,
          signal,
        ),
      (v) => setResult(v.result),
    );
  }
  const pick = (
    label: string,
    picked: Picked | null,
    set: (v: Picked | null) => void,
  ) => (
    <fieldset disabled={busy} className="workspace-batch-source">
      <legend>
        <WorkspaceSourceHeading>{label}</WorkspaceSourceHeading>
      </legend>
      <WorkspaceFileInput
        aria-label={label}
        type="file"
        accept=".csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f)
            void perform(
              async (signal) => {
                if (f.size > MAX_FILE_BYTES || !/\.csv$/i.test(f.name))
                  throw Error('GLS_SOURCE');
                return workerTask<SourceFile>(
                  'read',
                  { name: f.name, buffer: await f.arrayBuffer() },
                  signal,
                );
              },
              (file) => {
                set({ file, confirmed: false });
                invalidate();
              },
            );
        }}
      />
      <p>
        <bdi>{picked?.file.name ?? copy.empty}</bdi>
      </p>
      <label>
        <input
          type="checkbox"
          checked={!!picked?.confirmed}
          disabled={!picked}
          onChange={(e) => {
            if (picked) set({ ...picked, confirmed: e.target.checked });
            invalidate();
          }}
        />
        {copy.confirm}
      </label>
    </fieldset>
  );
  const show = (a: GlsAccount, decimals: number) => {
    if (!a.gl && !a.tb) return '';
    const side = (v: number[] | null, i: number) =>
      v ? minorText(v[i], decimals) : '—';
    const fields =
      a.status === 'difference'
        ? GLS_COMPONENTS.filter((c) => a.codes.includes(c))
        : GLS_COMPONENTS;
    return fields
      .map((c) => {
        const i = GLS_COMPONENTS.indexOf(c);
        return `${copy.components[c]}: ${side(a.gl, i)} · ${side(a.tb, i)}`;
      })
      .join('; ');
  };
  const where = (a: GlsAccount) =>
    [
      ...a.sections.map((s) => `${copy.glRow} ${s.row}`),
      ...a.rows.map((r) => `${copy.tbRow} ${r.row}`),
    ].join('; ');
  const counts = result
    ? (['held', 'missing', 'inconsistent', 'difference', 'consistent'] as const)
        .map(
          (k) =>
            [k, result.accounts.filter((a) => a.status === k).length] as const,
        )
        .filter(([, n]) => n)
    : [];
  return (
    <details className="intercompany-batch" data-gls-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-gls
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {pick(copy.gl, gl, setGl)}
          {pick(copy.tb, tb, setTb)}
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {GLS_SCOPE_FIELDS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                <input
                  value={scope[k]}
                  dir="auto"
                  data-gls-scope={k}
                  onChange={(e) => {
                    setScope({ ...scope, [k]: e.target.value });
                    setScopeConfirmed(false);
                    invalidate();
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={scopeConfirmed}
              data-gls-scope-confirm
              onChange={(e) => {
                setScopeConfirmed(e.target.checked);
                invalidate();
              }}
            />
            {copy.confirmScope}
          </label>
        </fieldset>
        <div className="gl-tb-actions workspace-run-actions">
          <Button disabled={busy || !ready} onClick={check}>
            {copy.check}
          </Button>
          {busy && (
            <Button variant="outline" onClick={cancel}>
              {copy.cancel}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" data-gls-error>
            {error}
          </p>
        )}
        {result && (
          <div data-gls-result>
            {result.run.length > 0 && (
              <div role="alert" data-gls-run={result.run.join(' ')}>
                <h3>{copy.run}</h3>
                <ul>
                  {result.run.map((c) => (
                    <li key={c}>
                      {copy.codes[c] ?? c} (<bdi>{c}</bdi>)
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3>
              {copy.accounts} ({result.accounts.length})
            </h3>
            <p data-gls-counts>
              {counts.map(([k, n]) => `${copy.status[k]}: ${n}`).join(' · ')}
            </p>
            <Paged
              label={copy.accounts}
              pager="accounts"
              headers={copy.headers}
              rows={result.accounts.map((a) => [
                a.account,
                a.dimensions,
                copy.status[a.status],
                a.codes
                  .map(
                    (c) => `${copy.codes[c] ?? copy.components[c] ?? c} (${c})`,
                  )
                  .join('; '),
                show(a, result.decimals),
                where(a),
              ])}
              marks={result.accounts.map((a) => ({
                'data-gls-account': a.key,
                'data-gls-status': a.status,
                'data-gls-codes': a.codes.join(' '),
              }))}
            />
            {result.excludedSections.length > 0 && (
              <section
                data-gls-excluded-sections={result.excludedSections
                  .map((s) => s.id ?? '')
                  .join(' ')}
              >
                <h3>{copy.excludedSections}</h3>
                <Paged
                  label={copy.excludedSections}
                  headers={copy.listHeaders}
                  rows={result.excludedSections.map((s) => [
                    s.id ?? '',
                    String(s.row),
                  ])}
                />
              </section>
            )}
            {result.excludedPages.length > 0 && (
              <section
                data-gls-excluded-pages={result.excludedPages
                  .map((p) => p.id ?? '')
                  .join(' ')}
              >
                <h3>{copy.excludedPages}</h3>
                <Paged
                  label={copy.excludedPages}
                  headers={copy.listHeaders}
                  rows={result.excludedPages.map((p) => [
                    p.id ?? '',
                    String(p.row),
                  ])}
                />
              </section>
            )}
            {result.orphanTotals.length > 0 && (
              <section data-gls-orphans={result.orphanTotals.length}>
                <h3>{copy.orphans}</h3>
                <Paged
                  label={copy.orphans}
                  headers={copy.orphanHeaders}
                  rows={result.orphanTotals.map((t) => [t.key, String(t.row)])}
                  marks={result.orphanTotals.map((t) => ({
                    'data-gls-orphan': t.key,
                  }))}
                />
              </section>
            )}
            {result.unplaced.length > 0 && (
              <section data-gls-unplaced={result.unplaced.length}>
                <h3>{copy.unplaced}</h3>
                <Paged
                  label={copy.unplaced}
                  headers={copy.unplacedHeaders}
                  rows={result.unplaced.map((u) => [
                    copy.files[u.file],
                    String(u.row),
                    `${copy.codes[u.code] ?? u.code} (${u.code})`,
                  ])}
                  marks={result.unplaced.map((u) => ({
                    'data-gls-unplaced-row': `${u.file} ${u.row} ${u.code}`,
                  }))}
                />
              </section>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
