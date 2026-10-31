import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Amount } from '@/components/amount';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import {
  PG_BATCHES_HEADERS,
  PG_BATCHES_ROLES,
  PG_BATCHES_SCOPE_FIELDS,
  PG_BATCHES_VERSION,
  type GatewayBatchesResult,
  type GatewayBatchesScope,
} from '@/lib/reconciliation/payment-gateway-batches';
import type { GatewayBatchesReplayInput } from '@/lib/reconciliation/payment-gateway-batches-io';
import { paymentGatewayBatchesCopy } from '@/lib/i18n/payment-gateway-batches';
import './intercompany-batch-panel.css';

type Picked = {
  name: string;
  original: ArrayBuffer;
  sha256: string;
  confirmed: boolean;
};
type ScopeKey = (typeof PG_BATCHES_SCOPE_FIELDS)[number];
const PAGE = 50;
const blankScope = () =>
  Object.fromEntries(PG_BATCHES_SCOPE_FIELDS.map((k) => [k, ''])) as Record<
    ScopeKey,
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
  rows: ReactNode[][];
  label: string;
  marks: Record<string, string>[];
  pager: string;
}) {
  const { lang } = useI18n();
  const copy = paymentGatewayBatchesCopy[lang];
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)),
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
            {rows.slice(safe * PAGE, safe * PAGE + PAGE).map((row, i) => (
              <tr key={i} {...marks[safe * PAGE + i]}>
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
        <div className="gl-tb-actions" data-pgb-pager={pager}>
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

export function PaymentGatewayBatchesPanel() {
  const { lang } = useI18n();
  const copy = paymentGatewayBatchesCopy[lang];
  const [files, setFiles] = useState<(Picked | null)[]>(() =>
    PG_BATCHES_ROLES.map(() => null),
  );
  const [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<GatewayBatchesResult | null>(null),
    [refused, setRefused] = useState(''),
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
  // Any new file, scope value or confirmation makes what was shown stale.
  const invalidate = () => {
    setResult(null);
    setRefused('');
    setError('');
  };
  const ready = files.every((f) => f?.confirmed) && scopeConfirmed;
  function check() {
    const input: GatewayBatchesReplayInput = {
      files: files.map((f) => ({
        name: f!.name,
        original: f!.original,
        sha256: f!.sha256,
      })),
      readings: PG_BATCHES_ROLES.map((role) => ({
        sheet: 0 as const,
        role,
        family: PG_BATCHES_VERSION,
        confirmed: true as const,
      })),
      scope: { ...scope, confirmed: true } as GatewayBatchesScope,
    };
    void perform(
      async (signal) => {
        try {
          const reply = await workerTask<{
            state: unknown;
            result: GatewayBatchesResult;
          }>('payment-gateway-batches-reconcile', input, signal);
          return { result: reply.result, refused: '' };
        } catch (failure) {
          // The engine's own refusal is shown as a refusal; anything else
          // is a failure and shows nothing.
          const code = /^PG_BATCHES_([A-Z_]+)$/.exec(
            String((failure as Error).message),
          )?.[1];
          if (!code || !Object.hasOwn(copy.refusals, code)) throw failure;
          return { result: null, refused: code };
        }
      },
      (v) => {
        setResult(v.result);
        setRefused(v.refused);
      },
    );
  }
  const decimals = result?.decimals ?? 2;
  // Integer minor units as the engine returns them, read at the scope
  // currency's decimals through the shared component; a pair is the batch's
  // own figure beside the settlement's.
  const amount = (minor: number) => (
    <Amount minor={minor} decimals={decimals} />
  );
  const pair = (own: number, settled: number) => (
    <>
      {amount(own)} / {amount(settled)}
    </>
  );
  const rowList = (rows: number[]) =>
    rows.length ? rows.join(copy.list) : copy.none;
  const reasons = (codes: string[]) =>
    codes.length
      ? codes.map((c) => `${copy.reasons[c] ?? c} (${c})`).join('; ')
      : copy.none;
  const refusal = refused || result?.refused || '';
  const byReason = result
    ? Object.keys(copy.reasons)
        .map(
          (code) =>
            [
              code,
              result.batches.filter((b) =>
                (b.reasons as string[]).includes(code),
              ).length,
            ] as const,
        )
        .filter(([, n]) => n)
    : [];
  return (
    <details className="intercompany-batch" data-pgb-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-pgb
        data-pgb-state={refusal ? 'refused' : result ? 'shown' : 'idle'}
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {PG_BATCHES_ROLES.map((role, side) => {
            const picked = files[side];
            return (
              <fieldset
                key={role}
                disabled={busy}
                className="workspace-batch-source"
              >
                <legend>
                  <WorkspaceSourceHeading>
                    {copy.roles[side]}
                  </WorkspaceSourceHeading>
                </legend>
                <p>
                  {copy.headers}:{' '}
                  <bdi>{PG_BATCHES_HEADERS[side].join(', ')}</bdi>
                </p>
                <WorkspaceFileInput
                  aria-label={copy.roles[side]}
                  type="file"
                  accept=".csv,.xlsx"
                  data-pgb-file={role}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f)
                      void perform(
                        async () => {
                          if (
                            f.size > MAX_FILE_BYTES ||
                            !/\.(csv|xlsx)$/i.test(f.name)
                          )
                            throw Error('PG_BATCHES_SOURCE');
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
                        (next) => {
                          setFiles((all) =>
                            all.map((v, i) => (i === side ? next : v)),
                          );
                          invalidate();
                        },
                      );
                  }}
                />
                <p>
                  <bdi data-pgb-name={role}>{picked?.name ?? copy.empty}</bdi>
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={!!picked?.confirmed}
                    disabled={!picked}
                    data-pgb-confirm={role}
                    onChange={(e) => {
                      const confirmed = e.target.checked;
                      setFiles((all) =>
                        all.map((v, i) =>
                          i === side && v ? { ...v, confirmed } : v,
                        ),
                      );
                      invalidate();
                    }}
                  />
                  {copy.confirm}
                </label>
              </fieldset>
            );
          })}
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {PG_BATCHES_SCOPE_FIELDS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                <input
                  value={scope[k]}
                  dir="auto"
                  data-pgb-scope={k}
                  aria-label={`${copy.scopePrefix} ${copy.scopeFields[k]}`}
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
              data-pgb-scope-confirm
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
          <p role="alert" data-pgb-error>
            {error}
          </p>
        )}
        {refusal && (
          <div role="alert" data-pgb-refused={refusal}>
            <h3>
              {copy.refused}: {copy.refusals[refusal] ?? refusal} (
              <bdi>{refusal}</bdi>)
            </h3>
            {result?.refused && (
              <>
                <h4>
                  {copy.errorsTitle} ({result.errors.length})
                </h4>
                <Paged
                  label={copy.errorsTitle}
                  pager="errors"
                  headers={copy.errorHeaders}
                  rows={result.errors.map((e) => [
                    `${copy.roles[e.source]} · ${result.sources[e.source].name}`,
                    String(e.row),
                    `${copy.codes[e.code] ?? e.code} (${e.code})`,
                  ])}
                  marks={result.errors.map((e) => ({
                    'data-pgb-error-row': JSON.stringify([
                      e.source,
                      e.row,
                      e.code,
                    ]),
                  }))}
                />
              </>
            )}
          </div>
        )}
        {result && !result.refused && (
          <div data-pgb-result>
            <p
              data-pgb-summary={JSON.stringify([
                result.batches.length,
                result.payouts.length,
                result.credits.length,
              ])}
            >
              {copy.summary(
                result.batches.length,
                result.batches.filter((b) => b.status === 'consistent').length,
                result.batches.filter((b) => b.status === 'in-transit').length,
                result.payouts.length,
                result.credits.length,
              )}
            </p>
            {byReason.length > 0 && (
              <>
                <h4>{copy.byReason}</h4>
                <ul>
                  {byReason.map(([code, n]) => (
                    <li key={code} data-pgb-reason-count={code}>
                      {copy.reasons[code]} (<bdi>{code}</bdi>): {n}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3>
              {copy.batchesTitle} ({result.batches.length})
            </h3>
            <Paged
              label={copy.batchesTitle}
              pager="batches"
              headers={copy.batchHeaders}
              rows={result.batches.map((b) => [
                b.batch,
                String(b.row),
                pair(b.components.sales, b.settlement.gross),
                pair(b.components.refunds, b.settlement.refunds),
                pair(b.components.fees, b.settlement.fees),
                amount(b.settlement.net),
                amount(b.paid),
                b.payouts.length ? b.payouts.join(copy.list) : copy.none,
                rowList(b.sales),
                rowList(b.refunds),
                rowList(b.fees),
                copy.status[b.status],
                reasons(b.reasons),
              ])}
              marks={result.batches.map((b) => ({
                'data-pgb-batch': b.batch,
                'data-pgb-batch-status': b.status,
                'data-pgb-batch-reasons': b.reasons.join(' '),
              }))}
            />
            <h3>
              {copy.payoutsTitle} ({result.payouts.length})
            </h3>
            <Paged
              label={copy.payoutsTitle}
              pager="payouts"
              headers={copy.payoutHeaders}
              rows={result.payouts.map((p) => [
                p.payout,
                rowList(p.lines),
                p.batches.join(copy.list),
                amount(p.amount),
                p.credit ? String(p.credit.row) : copy.none,
                p.credit ? p.credit.valueDate : copy.none,
                p.credit ? amount(p.credit.amount) : copy.none,
                copy.status[p.status],
                reasons(p.reasons),
              ])}
              marks={result.payouts.map((p) => ({
                'data-pgb-payout': p.payout,
                'data-pgb-payout-status': p.status,
                'data-pgb-payout-reasons': p.reasons.join(' '),
              }))}
            />
            {result.credits.length > 0 && (
              <>
                <h3>
                  {copy.creditsTitle} ({result.credits.length})
                </h3>
                <Paged
                  label={copy.creditsTitle}
                  pager="credits"
                  headers={copy.creditHeaders}
                  rows={result.credits.map((c) => [
                    String(c.row),
                    c.reference,
                    c.payout,
                    c.valueDate,
                    amount(c.amount),
                    reasons(c.reasons),
                  ])}
                  marks={result.credits.map((c) => ({
                    'data-pgb-credit': String(c.row),
                  }))}
                />
              </>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
