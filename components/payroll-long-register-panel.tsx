import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import {
  PLR_LABELS,
  PLR_ROLE,
  PLR_VERSION,
  type PlrLabel,
  type PlrResult,
  type PlrSums,
} from '@/lib/reconciliation/payroll-long-register';
import type { PlrReplayInput } from '@/lib/reconciliation/payroll-long-register-io';
import { payrollLongRegisterCopy } from '@/lib/i18n/payroll-long-register';
import './intercompany-batch-panel.css';

type Picked = {
  name: string;
  original: ArrayBuffer;
  sha256: string;
  confirmed: boolean;
};
// Integer minor units as the engine returns them, shown with the run
// currency's decimals; never a float.
function minorText(value: string | null, decimals: number) {
  if (value === null) return '—';
  const negative = value.startsWith('-'),
    digits = (negative ? value.slice(1) : value).padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  return `${negative ? '-' : ''}${whole}${decimals ? '.' + digits.slice(-decimals) : ''}`;
}
const difference = (a: string | null, b: string | null) =>
  a === null || b === null ? null : String(BigInt(a) - BigInt(b));
const blankScope = () =>
  Object.fromEntries(PLR_LABELS.map((k) => [k, ''])) as Record<
    PlrLabel,
    string
  >;
const SUMS = ['earnings', 'deductions', 'employer', 'net'] as const;

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
  const copy = payrollLongRegisterCopy[lang];
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
        <div className="gl-tb-actions" data-plr-pager={pager}>
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

export function PayrollLongRegisterPanel() {
  const { lang } = useI18n();
  const copy = payrollLongRegisterCopy[lang];
  const [file, setFile] = useState<Picked | null>(null);
  const [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<PlrResult | null>(null),
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
  const ready = !!file?.confirmed && scopeConfirmed;
  function check() {
    const input: PlrReplayInput = {
      files: [
        { name: file!.name, original: file!.original, sha256: file!.sha256 },
      ],
      readings: [{ role: PLR_ROLE, family: PLR_VERSION, confirmed: true }],
      scope: { confirmed: true, fields: { ...scope } },
    };
    void perform(
      (signal) =>
        workerTask<{ state: unknown; result: PlrResult }>(
          'payroll-long-register-reconcile',
          input,
          signal,
        ),
      (v) => setResult(v.result),
    );
  }
  const reason = (code: string) => `${copy.codes[code] ?? code} (${code})`;
  const { comma, semi } = copy;
  const decimals = result?.decimals ?? 2;
  const sums = (s: PlrSums | null) =>
    s ? SUMS.map((k) => minorText(s[k], decimals)).join(' · ') : '—';
  const counts = result
    ? (['consistent', 'inconsistent', 'missing', 'held'] as const).map(
        (s) =>
          [s, result.employees.filter((e) => e.status === s).length] as const,
      )
    : [];
  return (
    <details className="intercompany-batch" data-plr-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-plr
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          <fieldset disabled={busy} className="workspace-batch-source">
            <legend>
              <WorkspaceSourceHeading>{copy.role}</WorkspaceSourceHeading>
            </legend>
            <WorkspaceFileInput
              aria-label={copy.role}
              type="file"
              accept=".csv"
              data-plr-file
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f)
                  void perform(
                    async () => {
                      if (f.size > MAX_FILE_BYTES || !/\.csv$/i.test(f.name))
                        throw Error('PLR_SOURCE');
                      const original = await f.arrayBuffer();
                      const sha256 = Array.from(
                        new Uint8Array(
                          await crypto.subtle.digest('SHA-256', original),
                        ),
                        (n) => n.toString(16).padStart(2, '0'),
                      ).join('');
                      return {
                        name: f.name,
                        original,
                        sha256,
                        confirmed: false,
                      };
                    },
                    (picked) => {
                      setFile(picked);
                      invalidate();
                    },
                  );
              }}
            />
            <p>
              <bdi>{file?.name ?? copy.empty}</bdi>
            </p>
            <label>
              <input
                type="checkbox"
                checked={!!file?.confirmed}
                disabled={!file}
                data-plr-confirm
                onChange={(e) => {
                  if (file) setFile({ ...file, confirmed: e.target.checked });
                  invalidate();
                }}
              />
              {copy.confirm}
            </label>
          </fieldset>
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {PLR_LABELS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                <input
                  value={scope[k]}
                  dir="auto"
                  data-plr-scope={k}
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
              data-plr-scope-confirm
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
          <p role="alert" data-plr-error>
            {error}
          </p>
        )}
        {result && (
          <div
            data-plr-result
            data-plr-status={result.refused ? 'refused' : 'judged'}
          >
            {result.refused ? (
              <h3
                role="alert"
                data-plr-verdict
                data-plr-refused={result.refused}
              >
                {copy.refused}: {reason(result.refused)}
              </h3>
            ) : (
              <>
                <h3 data-plr-verdict>{copy.judged}</h3>
                <p data-plr-summary>
                  {copy.summary}:{' '}
                  {counts.map(([s, n]) => `${copy.status[s]} ${n}`).join(' · ')}
                </p>
                {result.run.length > 0 && (
                  <section role="alert" data-plr-run={result.run.join(' ')}>
                    <h3>{copy.run}</h3>
                    <ul>
                      {result.run.map((c) => (
                        <li key={c}>{reason(c)}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {result.unplaced.length > 0 && (
                  <section>
                    <h3>{copy.unplaced}</h3>
                    <Paged
                      label={copy.unplaced}
                      pager="unplaced"
                      headers={copy.unplacedHeaders}
                      rows={result.unplaced.map((u) => [
                        String(u.row),
                        reason(u.code),
                      ])}
                      marks={result.unplaced.map((u) => ({
                        'data-plr-unplaced': JSON.stringify([u.row, u.code]),
                      }))}
                    />
                  </section>
                )}
                {result.employees.length > 0 && (
                  <section>
                    <h3>
                      {copy.employees} ({result.employees.length})
                    </h3>
                    <Paged
                      label={copy.employees}
                      pager="employees"
                      headers={copy.employeeHeaders}
                      rows={result.employees.map((e) => [
                        e.employee,
                        e.dims,
                        copy.status[e.status],
                        e.codes.map(reason).join(semi) || '—',
                        minorText(e.earnings, decimals),
                        minorText(e.deductions, decimals),
                        minorText(e.employer, decimals),
                        minorText(e.net, decimals),
                        minorText(
                          difference(e.earnings, e.deductions),
                          decimals,
                        ),
                        e.payee ?? '—',
                        e.rows.join(', '),
                      ])}
                      marks={result.employees.map((e) => ({
                        'data-plr-employee': e.key,
                        'data-plr-employee-status': e.status,
                        'data-plr-employee-codes': e.codes.join(' '),
                      }))}
                    />
                  </section>
                )}
                {result.employees.some((e) => e.lines) && (
                  <section>
                    <h3>{copy.lines}</h3>
                    <Paged
                      label={copy.lines}
                      pager="lines"
                      headers={copy.lineHeaders}
                      rows={result.employees.flatMap((e) =>
                        (e.lines ?? []).map((l) => [
                          e.key,
                          l.id,
                          l.component,
                          copy.kinds[l.kind],
                          minorText(l.amount, decimals),
                          String(l.row),
                        ]),
                      )}
                      marks={result.employees.flatMap((e) =>
                        (e.lines ?? []).map((l) => ({
                          'data-plr-line': JSON.stringify([e.key, l.id]),
                        })),
                      )}
                    />
                  </section>
                )}
                {result.sections.length > 0 && (
                  <section>
                    <h3>{copy.sections}</h3>
                    <Paged
                      label={copy.sections}
                      pager="sections"
                      headers={copy.sectionHeaders}
                      rows={result.sections.map((s) => [
                        String(s.row),
                        s.id,
                        copy.states[s.state],
                        s.codes.map(reason).join(semi) || '—',
                        sums(s.printed),
                        sums(s.sums),
                      ])}
                      marks={result.sections.map((s) => ({
                        'data-plr-section': JSON.stringify([s.row, s.state]),
                        'data-plr-section-codes': s.codes.join(' '),
                      }))}
                    />
                  </section>
                )}
                <section data-plr-totals>
                  <h3>{copy.totals}</h3>
                  <p>
                    {copy.totalNames.join(' · ')}:{' '}
                    <bdi data-plr-printed>{sums(result.printedRunTotals)}</bdi>
                    {' | '}
                    <bdi data-plr-sums>{sums(result.totals)}</bdi>
                  </p>
                </section>
                {result.excludedSections.length > 0 && (
                  <p
                    data-plr-excluded={JSON.stringify(result.excludedSections)}
                  >
                    {copy.excluded}:{' '}
                    <bdi>{result.excludedSections.join(comma)}</bdi>
                  </p>
                )}
                {result.sharedPayees.length > 0 && (
                  <section>
                    <h3>{copy.shared}</h3>
                    <ul>
                      {result.sharedPayees.map((s) => (
                        <li
                          key={s.payee}
                          data-plr-shared={JSON.stringify([
                            s.payee,
                            s.employees,
                          ])}
                        >
                          <bdi>{s.payee}</bdi>:{' '}
                          <bdi>{s.employees.join(comma)}</bdi>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
