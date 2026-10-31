import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Amount } from '@/components/amount';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import {
  IC_BATCH_VERSION,
  type IntercompanyBatch,
  type IntercompanyBatchInput,
  type IntercompanyBatchResult,
} from '@/lib/reconciliation/intercompany-batch';
import { intercompanyBatchCopy } from '@/lib/i18n/intercompany-batch';
import './intercompany-batch-panel.css';

type Picked = { file: SourceFile; confirmed: boolean };
// An amount at the batch currency's decimals through the shared component;
// a batch without a known precision shows none.
function amount(minor: number | null, decimals: number | null) {
  return decimals === null ? '—' : <Amount minor={minor} decimals={decimals} />;
}

function Paged({
  headers,
  rows,
  label,
}: {
  headers: string[];
  rows: ReactNode[][];
  label: string;
}) {
  const { lang } = useI18n();
  const copy = intercompanyBatchCopy[lang];
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
              <tr key={i}>
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
        <div className="gl-tb-actions">
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

function BatchView({
  batch,
  names,
}: {
  batch: IntercompanyBatch;
  names: string[];
}) {
  const { lang } = useI18n();
  const copy = intercompanyBatchCopy[lang];
  const s = batch.scope;
  return (
    <section
      data-ic-batch={batch.id}
      data-ic-batch-status={batch.status}
      data-ic-batch-codes={batch.codes.join(' ')}
    >
      <h4>
        <bdi>{batch.id}</bdi> · {copy.status[batch.status]}
      </h4>
      <p>
        <bdi>{s.entityA}</bdi> ↔ <bdi>{s.entityB}</bdi> · {copy.currency}{' '}
        <bdi>{s.currency}</bdi> · {copy.period} <bdi>{s.start}</bdi> –{' '}
        <bdi>{s.end}</bdi> · {copy.rowsA} {batch.sides.A.length} · {copy.rowsB}{' '}
        {batch.sides.B.length}
      </p>
      {batch.codes.length > 0 && (
        <ul>
          {batch.codes.map((c) => (
            <li key={c} data-ic-batch-code={c}>
              {copy.codes[c] ?? c} (<bdi>{c}</bdi>)
            </li>
          ))}
        </ul>
      )}
      <Paged
        label={`${batch.id} ${copy.relationsTitle}`}
        headers={copy.relationHeaders}
        rows={batch.relations.map((r) => [
          r.relationId,
          copy.relationStatus[r.status],
          r.members.A.join(', '),
          r.members.B.join(', '),
          amount(r.net?.A ?? null, batch.decimals),
          amount(r.net?.B ?? null, batch.decimals),
          amount(r.residual, batch.decimals),
        ])}
      />
      {batch.findings.length > 0 && (
        <details>
          <summary>
            {copy.findingsTitle} ({batch.findings.length})
          </summary>
          <Paged
            label={`${batch.id} ${copy.findingsTitle}`}
            headers={copy.findingHeaders}
            rows={batch.findings.map((f) => [
              copy.codes[f.code] ?? f.code,
              names[f.source],
              String(f.row),
            ])}
          />
        </details>
      )}
    </section>
  );
}

export function IntercompanyBatchPanel() {
  const { lang } = useI18n();
  const copy = intercompanyBatchCopy[lang];
  const [declaration, setDeclaration] = useState<Picked | null>(null),
    [ledgers, setLedgers] = useState<SourceFile[]>([]),
    [ledgersConfirmed, setLedgersConfirmed] = useState(false),
    [relations, setRelations] = useState<Picked | null>(null);
  const [result, setResult] = useState<IntercompanyBatchResult | null>(null),
    [sources, setSources] = useState<string[]>([]),
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
  // Any new file or confirmation makes the shown result stale.
  const invalidate = () => {
    setResult(null);
    setSources([]);
    setError('');
  };
  const read = async (list: File[], signal: AbortSignal) => {
    const out: SourceFile[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) throw Error('IC_BATCH_SOURCE');
      out.push(
        await workerTask<SourceFile>(
          'intercompany-read',
          { name: f.name, buffer: await f.arrayBuffer() },
          signal,
        ),
      );
    }
    return out;
  };
  const ready =
    !!declaration?.confirmed &&
    !!relations?.confirmed &&
    ledgers.length > 0 &&
    ledgersConfirmed;
  function check() {
    const files = [declaration!.file, ...ledgers, relations!.file];
    const input: IntercompanyBatchInput = {
      files,
      readings: files.map((_, i) => ({
        sheet: 0,
        role:
          i === 0
            ? 'batch-declaration'
            : i === files.length - 1
              ? 'relation-members'
              : 'entity-ledger',
        family: IC_BATCH_VERSION,
        confirmed: true,
      })),
    };
    void perform(
      (signal) =>
        workerTask<{
          state: IntercompanyBatchInput;
          result: IntercompanyBatchResult;
        }>('intercompany-batch-reconcile', input, signal),
      (v) => {
        setSources(v.state.files.map((f) => f.name));
        setResult(v.result);
      },
    );
  }
  const single = (
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
              (signal) => read([f], signal),
              ([file]) => {
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
  const counts = result
    ? (['blocked', 'missing', 'difference', 'ready'] as const)
        .map(
          (k) =>
            [k, result.batches.filter((b) => b.status === k).length] as const,
        )
        .filter(([, n]) => n)
    : [];
  return (
    <details className="intercompany-batch" data-intercompany-batch-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-intercompany-batch
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {single(copy.declaration, declaration, setDeclaration)}
          <fieldset disabled={busy} className="workspace-batch-source">
            <legend>
              <WorkspaceSourceHeading>{copy.ledgers}</WorkspaceSourceHeading>
            </legend>
            <WorkspaceFileInput
              aria-label={copy.ledgers}
              type="file"
              accept=".csv"
              multiple
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (list.length)
                  void perform(
                    (signal) => read(list, signal),
                    (files) => {
                      setLedgers(files);
                      setLedgersConfirmed(false);
                      invalidate();
                    },
                  );
              }}
            />
            <p>
              {ledgers.length ? (
                ledgers.map((f) => (
                  <bdi key={f.sha256} data-ic-batch-ledger>
                    {f.name}{' '}
                  </bdi>
                ))
              ) : (
                <bdi>{copy.empty}</bdi>
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={ledgersConfirmed}
                disabled={!ledgers.length}
                onChange={(e) => {
                  setLedgersConfirmed(e.target.checked);
                  invalidate();
                }}
              />
              {copy.confirmLedgers}
            </label>
          </fieldset>
          {single(copy.relations, relations, setRelations)}
        </div>
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
          <p role="alert" data-ic-batch-error>
            {error}
          </p>
        )}
        {result && (
          <div data-ic-batch-result>
            {result.run.length > 0 && (
              <div role="alert" data-ic-batch-run={result.run.join(' ')}>
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
              {copy.batches} ({result.batches.length})
            </h3>
            <p data-ic-batch-counts>
              {counts.map(([k, n]) => `${copy.status[k]}: ${n}`).join(' · ')}
            </p>
            {result.batches.map((b) => (
              <BatchView key={b.id} batch={b} names={sources} />
            ))}
            {result.unassigned.length > 0 && (
              <section data-ic-batch-unassigned={result.unassigned.length}>
                <h3>
                  {copy.unassigned} ({result.unassigned.length})
                </h3>
                <Paged
                  label={copy.unassigned}
                  headers={copy.unassignedHeaders}
                  rows={result.unassigned.map((u) => [
                    sources[u.source],
                    String(u.row),
                    u.entity,
                    copy.codes[u.code] ?? u.code,
                  ])}
                />
              </section>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
