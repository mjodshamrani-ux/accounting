import { useEffect, useRef, useState } from 'react';
import { Amount } from '@/components/amount';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import {
  FINH_ROLES,
  FINH_VERSION,
  type FinHResult,
} from '@/lib/reconciliation/tb-financial-hierarchy';
import {
  FIN_HIERARCHY_CATEGORIES,
  FIN_HIERARCHY_SCOPE_HEADERS,
  type FinancialHierarchyScope,
} from '@/lib/reconciliation/tb-financial-hierarchy-contract';
import type { FinHReplayInput } from '@/lib/reconciliation/tb-financial-hierarchy-io';
import { tbFinancialHierarchyCopy } from '@/lib/i18n/tb-financial-hierarchy';
import { RecordTable } from '@/components/record-table';
import './review-section.css';

type Picked = {
  name: string;
  original: ArrayBuffer;
  sha256: string;
  confirmed: boolean;
};
// An amount at two decimals, the contract's, through the shared component.
const amount = (minor: number | null) => <Amount minor={minor} decimals={2} />;
const blankScope = () =>
  Object.fromEntries(FIN_HIERARCHY_SCOPE_HEADERS.map((k) => [k, ''])) as Record<
    (typeof FIN_HIERARCHY_SCOPE_HEADERS)[number],
    string
  >;

export function TbFinancialHierarchyPanel() {
  const { lang } = useI18n();
  const copy = tbFinancialHierarchyCopy[lang];
  const [files, setFiles] = useState<(Picked | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<FinHResult | null>(null),
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
  const setFile = (i: number, value: Picked | null) =>
    setFiles((old) => old.map((f, j) => (j === i ? value : f)));
  const ready = files.every((f) => f?.confirmed) && scopeConfirmed;
  function check() {
    const input: FinHReplayInput = {
      files: files.map((f) => ({
        name: f!.name,
        original: f!.original,
        sha256: f!.sha256,
      })) as FinHReplayInput['files'],
      readings: FINH_ROLES.map((role) => ({
        role,
        family: FINH_VERSION,
        confirmed: true,
      })) as FinHReplayInput['readings'],
      scope: {
        confirmed: true,
        fields: { ...scope } as FinancialHierarchyScope,
      },
    };
    void perform(
      (signal) =>
        workerTask<{ state: unknown; result: FinHResult }>(
          'tb-financial-hierarchy-reconcile',
          input,
          signal,
        ),
      (v) => setResult(v.result),
    );
  }
  const pick = (i: number) => {
    const label = copy.roles[i],
      picked = files[i];
    return (
      <fieldset key={i} disabled={busy} className="workspace-batch-source">
        <legend>
          <WorkspaceSourceHeading>{label}</WorkspaceSourceHeading>
        </legend>
        <WorkspaceFileInput
          aria-label={label}
          type="file"
          accept=".csv"
          data-finh-file={FINH_ROLES[i]}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f)
              void perform(
                async () => {
                  if (f.size > MAX_FILE_BYTES || !/\.csv$/i.test(f.name))
                    throw Error('FINH_SOURCE');
                  const original = await f.arrayBuffer();
                  const sha256 = Array.from(
                    new Uint8Array(
                      await crypto.subtle.digest('SHA-256', original),
                    ),
                    (n) => n.toString(16).padStart(2, '0'),
                  ).join('');
                  return { name: f.name, original, sha256, confirmed: false };
                },
                (file) => {
                  setFile(i, file);
                  invalidate();
                },
              );
          }}
        />
        <p>
          <bdi>{picked?.name ?? copy.empty}</bdi>
        </p>
        <label>
          <input
            type="checkbox"
            checked={!!picked?.confirmed}
            disabled={!picked}
            data-finh-confirm={FINH_ROLES[i]}
            onChange={(e) => {
              if (picked)
                setFile(i, { ...picked, confirmed: e.target.checked });
              invalidate();
            }}
          />
          {copy.confirm}
        </label>
      </fieldset>
    );
  };
  const codesAt = (source: number, row: number) =>
    result
      ? [
          ...new Set(
            result.issues
              .filter((x) => x.source === source && x.row === row)
              .map((x) => x.code),
          ),
        ]
      : [];
  const reason = (code: string) => `${copy.codes[code] ?? code} (${code})`;
  const lineOf = (id: string) => result?.lines.find((l) => l.id === id);
  return (
    <details className="intercompany-batch" data-finh-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-finh
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {FINH_ROLES.map((_, i) => pick(i))}
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {FIN_HIERARCHY_SCOPE_HEADERS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                <input
                  value={scope[k]}
                  dir="auto"
                  data-finh-scope={k}
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
              data-finh-scope-confirm
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
          <p role="alert" data-finh-error>
            {error}
          </p>
        )}
        {result && (
          <div data-finh-result data-finh-status={result.status}>
            <h3 data-finh-verdict>{copy.status[result.status]}</h3>
            {result.issues.length > 0 && (
              <section
                role="alert"
                data-finh-codes={[...new Set(result.issues.map((x) => x.code))]
                  .sort()
                  .join(' ')}
              >
                <h3>
                  {copy.issues} ({result.issues.length})
                </h3>
                <RecordTable
                  label={copy.issues}
                  pager={{ 'data-finh-pager': 'issues' }}
                  headers={copy.issueHeaders}
                  rows={result.issues.map((x) => [
                    reason(x.code),
                    x.source === null ? '—' : copy.roleNames[x.source],
                    x.row === null ? '—' : String(x.row),
                    x.field ?? '—',
                  ])}
                  marks={result.issues.map((x) => ({
                    'data-finh-issue': `${x.code} ${x.source ?? '-'} ${x.row ?? '-'}`,
                  }))}
                />
              </section>
            )}
            {result.nodes.length > 0 && (
              <section>
                <h3>
                  {copy.tree} ({result.nodes.length})
                </h3>
                <RecordTable
                  label={copy.tree}
                  pager={{ 'data-finh-pager': 'tree' }}
                  headers={copy.treeHeaders}
                  rows={result.nodes.map((n) => {
                    const line = n.kind === 'leaf' ? lineOf(n.id) : undefined;
                    return [
                      String(n.row),
                      n.id,
                      n.parentId,
                      n.kind,
                      n.label,
                      copy.classes[n.lineClass] ?? n.lineClass,
                      n.depth === null ? '—' : String(n.depth),
                      n.kind === 'title' ? '' : amount(n.amount),
                      line ? amount(line.calculated) : '',
                      line ? amount(line.difference) : '',
                    ];
                  })}
                  marks={result.nodes.map((n) => ({
                    'data-finh-node': n.id,
                    'data-finh-kind': n.kind,
                    'data-finh-node-codes': codesAt(3, n.row).sort().join(' '),
                  }))}
                />
              </section>
            )}
            {result.lines.some((l) => l.members.length) && (
              <section>
                <h3>{copy.members}</h3>
                <RecordTable
                  label={copy.members}
                  pager={{ 'data-finh-pager': 'members' }}
                  headers={copy.memberHeaders}
                  rows={result.lines.flatMap((l) =>
                    l.members.map((m) => [
                      l.id,
                      m.account,
                      m.dimensions,
                      String(m.mappingRow),
                      m.evidenceRow === null ? '—' : String(m.evidenceRow),
                      m.tbRow === null ? '—' : String(m.tbRow),
                      amount(m.contribution),
                    ]),
                  )}
                  marks={result.lines.flatMap((l) =>
                    l.members.map((m) => ({
                      'data-finh-member': `${l.id} ${m.account}|${m.dimensions}`,
                    })),
                  )}
                />
              </section>
            )}
            {result.controls.length > 0 && (
              <section>
                <h3>{copy.controls}</h3>
                <RecordTable
                  label={copy.controls}
                  pager={{ 'data-finh-pager': 'controls' }}
                  headers={copy.controlHeaders}
                  rows={result.controls.map((c) => [
                    c.id,
                    String(c.row),
                    amount(c.supplied),
                    amount(c.childTotal),
                    amount(c.difference),
                    c.children.join(', '),
                  ])}
                  marks={result.controls.map((c) => ({
                    'data-finh-control': c.id,
                  }))}
                />
              </section>
            )}
            {(result.tb || result.categories) && (
              <section data-finh-totals>
                <h3>{copy.totals}</h3>
                {result.tb && (
                  <p data-finh-tb>
                    {copy.tbTotals}: {amount(result.tb.debit)} ·{' '}
                    {amount(result.tb.credit)}
                  </p>
                )}
                {result.categories && result.equation && (
                  <>
                    <RecordTable
                      label={copy.totals}
                      headers={copy.categoryHeaders}
                      rows={FIN_HIERARCHY_CATEGORIES.map((c) => [
                        copy.classes[c],
                        amount(result.categories!.reported[c]),
                        amount(result.categories!.calculated[c]),
                      ])}
                    />
                    <p data-finh-equation>
                      {copy.equation}: {amount(result.equation.reported)} ·{' '}
                      {amount(result.equation.calculated)}
                    </p>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
