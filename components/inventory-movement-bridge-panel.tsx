import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Amount, Quantity } from '@/components/amount';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import {
  IMB_INFLOWS,
  IMB_MOVES,
  IMB_OUTFLOWS,
  IMB_ROLES,
  IMB_SCOPE_FIELDS,
  IMB_TOTALS,
  IMB_VERSION,
  type ImbPair,
  type ImbResult,
  type ImbScopeField,
  type ImbSide,
} from '@/lib/reconciliation/inventory-movement-bridge';
import type { ImbReplayInput } from '@/lib/reconciliation/inventory-movement-bridge-io';
import { inventoryMovementBridgeCopy } from '@/lib/i18n/inventory-movement-bridge';
import { RecordTable } from '@/components/record-table';
import './review-section.css';

type Picked = {
  name: string;
  original: ArrayBuffer;
  sha256: string;
  confirmed: boolean;
};
const blankScope = () =>
  Object.fromEntries(IMB_SCOPE_FIELDS.map((k) => [k, ''])) as Record<
    ImbScopeField,
    string
  >;
const SIDES = ['opening', 'debit', 'credit', 'closing'] as const;

export function InventoryMovementBridgePanel() {
  const { lang } = useI18n();
  const copy = inventoryMovementBridgeCopy[lang];
  const [files, setFiles] = useState<[Picked | null, Picked | null]>([
    null,
    null,
  ]);
  const [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<ImbResult | null>(null),
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
  // Any new file, period value or confirmation makes the shown result stale.
  const invalidate = () => {
    setResult(null);
    setError('');
  };
  const place = (i: 0 | 1, picked: Picked | null) =>
    setFiles((now) => {
      const next: [Picked | null, Picked | null] = [now[0], now[1]];
      next[i] = picked;
      return next;
    });
  const ready = files.every((f) => f?.confirmed) && scopeConfirmed;
  function check() {
    const [register, gl] = files as [Picked, Picked];
    const input: ImbReplayInput = {
      files: [
        {
          name: register.name,
          original: register.original,
          sha256: register.sha256,
        },
        { name: gl.name, original: gl.original, sha256: gl.sha256 },
      ],
      readings: [
        { role: IMB_ROLES[0], family: IMB_VERSION, confirmed: true },
        { role: IMB_ROLES[1], family: IMB_VERSION, confirmed: true },
      ],
      scope: { confirmed: true, fields: { ...scope } },
    };
    void perform(
      (signal) =>
        workerTask<{ state: unknown; result: ImbResult }>(
          'inventory-movement-bridge-reconcile',
          input,
          signal,
        ),
      (v) => setResult(v.result),
    );
  }
  const reason = (code: string) => `${copy.codes[code] ?? code} (${code})`;
  const { comma, semi } = copy;
  const decimals = result?.decimals ?? 2;
  // Integers as the engine returns them, kept as strings, read through the
  // shared components: three decimals for a quantity, the period currency's
  // for a value.
  const quantity = (scaled: string | null) => (
    <Quantity scaled={scaled} precision={3} />
  );
  const amount = (minor: string | null) => (
    <Amount minor={minor} decimals={decimals} />
  );
  const pair = (p: ImbPair | null): ReactNode =>
    p ? (
      <>
        {quantity(p.quantity)} · {amount(p.value)}
      </>
    ) : (
      '—'
    );
  const side = (s: ImbSide | null): ReactNode =>
    s
      ? SIDES.map((k, i) => (
          <Fragment key={k}>
            {i > 0 && ' · '}
            {amount(s[k])}
          </Fragment>
        ))
      : '—';
  const flowSum = (
    flows: Record<string, ImbPair>,
    kinds: readonly string[],
  ): ImbPair => ({
    quantity: String(kinds.reduce((a, k) => a + BigInt(flows[k].quantity), 0n)),
    value: String(kinds.reduce((a, k) => a + BigInt(flows[k].value), 0n)),
  });
  const counts = result
    ? (['consistent', 'inconsistent', 'missing', 'held'] as const).map(
        (s) =>
          [s, result.positions.filter((p) => p.status === s).length] as const,
      )
    : [];
  const accountCounts = result
    ? (['consistent', 'difference', 'missing', 'held'] as const).map(
        (s) =>
          [s, result.accounts.filter((a) => a.status === s).length] as const,
      )
    : [];
  return (
    <details className="intercompany-batch" data-imb-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-results"
        data-imb
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {([0, 1] as const).map((i) => (
            <fieldset
              key={i}
              disabled={busy}
              className="workspace-batch-source"
            >
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept=".csv"
                data-imb-file={IMB_ROLES[i]}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void perform(
                      async () => {
                        if (f.size > MAX_FILE_BYTES || !/\.csv$/i.test(f.name))
                          throw Error('IMB_SOURCE');
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
                        place(i, picked);
                        invalidate();
                      },
                    );
                }}
              />
              <p>
                <bdi>{files[i]?.name ?? copy.empty}</bdi>
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={!!files[i]?.confirmed}
                  disabled={!files[i]}
                  data-imb-confirm={IMB_ROLES[i]}
                  onChange={(e) => {
                    const f = files[i];
                    if (f) place(i, { ...f, confirmed: e.target.checked });
                    invalidate();
                  }}
                />
                {copy.confirm[i]}
              </label>
            </fieldset>
          ))}
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {IMB_SCOPE_FIELDS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                {k === 'Negative balances' ? (
                  <select
                    value={scope[k]}
                    data-imb-scope={k}
                    onChange={(e) => {
                      setScope({ ...scope, [k]: e.target.value });
                      setScopeConfirmed(false);
                      invalidate();
                    }}
                  >
                    {['', 'not allowed', 'allowed'].map((v) => (
                      <option key={v} value={v}>
                        {copy.negative[v]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={scope[k]}
                    dir="auto"
                    data-imb-scope={k}
                    onChange={(e) => {
                      setScope({ ...scope, [k]: e.target.value });
                      setScopeConfirmed(false);
                      invalidate();
                    }}
                  />
                )}
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={scopeConfirmed}
              data-imb-scope-confirm
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
          <p role="alert" data-imb-error>
            {error}
          </p>
        )}
        {result && (
          <div
            data-imb-result
            data-imb-status={result.refused ? 'refused' : 'judged'}
          >
            {result.refused ? (
              <h3
                role="alert"
                data-imb-verdict
                data-imb-refused={result.refused}
              >
                {copy.refused}: {reason(result.refused)}
              </h3>
            ) : (
              <>
                <h3 data-imb-verdict>{copy.judged}</h3>
                <p data-imb-summary>
                  {copy.summary}:{' '}
                  {counts.map(([s, n]) => `${copy.status[s]} ${n}`).join(' · ')}
                  {' | '}
                  {copy.accountSummary}:{' '}
                  {accountCounts
                    .map(([s, n]) => `${copy.accountStatus[s]} ${n}`)
                    .join(' · ')}
                </p>
                {result.run.length > 0 && (
                  <section role="alert" data-imb-run={result.run.join(' ')}>
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
                    <RecordTable
                      label={copy.unplaced}
                      pager={{ 'data-imb-pager': 'unplaced' }}
                      headers={copy.unplacedHeaders}
                      rows={result.unplaced.map((u) => [
                        copy.files[u.file],
                        String(u.row),
                        reason(u.code),
                      ])}
                      marks={result.unplaced.map((u) => ({
                        'data-imb-unplaced': JSON.stringify([
                          u.file,
                          u.row,
                          u.code,
                        ]),
                      }))}
                    />
                  </section>
                )}
                {result.positions.length > 0 && (
                  <section>
                    <h3>
                      {copy.positions} ({result.positions.length}) · {copy.pair}
                    </h3>
                    <RecordTable
                      label={copy.positions}
                      pager={{ 'data-imb-pager': 'positions' }}
                      headers={copy.positionHeaders}
                      rows={result.positions.map((p) => [
                        p.item,
                        p.dims,
                        copy.status[p.status],
                        p.codes.map(reason).join(semi) || '—',
                        p.unit ?? '—',
                        p.account ?? '—',
                        pair(p.opening),
                        pair(p.flows && flowSum(p.flows, IMB_INFLOWS)),
                        pair(p.flows && flowSum(p.flows, IMB_OUTFLOWS)),
                        pair(p.computed),
                        pair(p.closing),
                        p.rows.join(comma),
                      ])}
                      marks={result.positions.map((p) => ({
                        'data-imb-position': p.key,
                        'data-imb-position-status': p.status,
                        'data-imb-position-codes': p.codes.join(' '),
                      }))}
                    />
                  </section>
                )}
                {result.positions.some((p) => p.flows) && (
                  <section>
                    <h3>{copy.flows}</h3>
                    <RecordTable
                      label={copy.flows}
                      pager={{ 'data-imb-pager': 'flows' }}
                      headers={copy.flowHeaders}
                      rows={result.positions.flatMap((p) =>
                        IMB_MOVES.filter(
                          (k) =>
                            p.flows &&
                            (p.flows[k].quantity !== '0' ||
                              p.flows[k].value !== '0'),
                        ).map((k) => [
                          p.key,
                          copy.kinds[k],
                          quantity(p.flows![k].quantity),
                          amount(p.flows![k].value),
                        ]),
                      )}
                      marks={result.positions.flatMap((p) =>
                        IMB_MOVES.filter(
                          (k) =>
                            p.flows &&
                            (p.flows[k].quantity !== '0' ||
                              p.flows[k].value !== '0'),
                        ).map((k) => ({
                          'data-imb-flow': JSON.stringify([p.key, k]),
                        })),
                      )}
                    />
                  </section>
                )}
                {result.positions.some((p) => p.lines) && (
                  <section>
                    <h3>{copy.lines}</h3>
                    <RecordTable
                      label={copy.lines}
                      pager={{ 'data-imb-pager': 'lines' }}
                      headers={copy.lineHeaders}
                      rows={result.positions.flatMap((p) =>
                        (p.lines ?? []).map((l) => [
                          p.key,
                          l.id,
                          copy.kinds[l.kind],
                          quantity(l.quantity),
                          amount(l.value),
                          String(l.row),
                        ]),
                      )}
                      marks={result.positions.flatMap((p) =>
                        (p.lines ?? []).map((l) => ({
                          'data-imb-line': JSON.stringify([p.key, l.id]),
                        })),
                      )}
                    />
                  </section>
                )}
                {result.accounts.length > 0 && (
                  <section>
                    <h3>
                      {copy.accounts} ({result.accounts.length}) · {copy.sides}
                    </h3>
                    <RecordTable
                      label={copy.accounts}
                      pager={{ 'data-imb-pager': 'accounts' }}
                      headers={copy.accountHeaders}
                      rows={result.accounts.map((a) => [
                        a.account,
                        copy.accountStatus[a.status],
                        a.codes.map(reason).join(semi) || '—',
                        side(a.register),
                        side(a.gl),
                        side(a.difference),
                        a.rows.join(comma) || '—',
                      ])}
                      marks={result.accounts.map((a) => ({
                        'data-imb-account': a.account,
                        'data-imb-account-status': a.status,
                        'data-imb-account-codes': a.codes.join(' '),
                      }))}
                    />
                  </section>
                )}
                {(
                  [
                    ['excluded', result.excluded, copy.excluded],
                    ['dated', result.datedOutside, copy.dated],
                  ] as const
                ).map(
                  ([name, list, title]) =>
                    list.length > 0 && (
                      <section key={name}>
                        <h3>{title}</h3>
                        <RecordTable
                          label={title}
                          pager={{ 'data-imb-pager': name }}
                          headers={copy.listHeaders}
                          rows={list.map((x) => [String(x.row), x.id])}
                          marks={list.map((x) => ({
                            [`data-imb-${name}`]: JSON.stringify([x.row, x.id]),
                          }))}
                        />
                      </section>
                    ),
                )}
                {result.unseenOrigins.length > 0 && (
                  <section>
                    <h3>{copy.unseen}</h3>
                    <RecordTable
                      label={copy.unseen}
                      pager={{ 'data-imb-pager': 'unseen' }}
                      headers={copy.unseenHeaders}
                      rows={result.unseenOrigins.map((x) => [
                        String(x.row),
                        x.id ?? '—',
                        x.origin,
                      ])}
                      marks={result.unseenOrigins.map((x) => ({
                        'data-imb-unseen': JSON.stringify([
                          x.row,
                          x.id,
                          x.origin,
                        ]),
                      }))}
                    />
                  </section>
                )}
                {result.repeatedHeaders.length > 0 && (
                  <section>
                    <h3>{copy.repeated}</h3>
                    <RecordTable
                      label={copy.repeated}
                      pager={{ 'data-imb-pager': 'repeated' }}
                      headers={copy.repeatedHeaders}
                      rows={result.repeatedHeaders.map((x) => [
                        copy.files[x.file],
                        String(x.row),
                      ])}
                      marks={result.repeatedHeaders.map((x) => ({
                        'data-imb-repeated': JSON.stringify([x.file, x.row]),
                      }))}
                    />
                  </section>
                )}
                <section data-imb-totals>
                  <h3>{copy.totals}</h3>
                  {result.totals ? (
                    <ul>
                      {IMB_TOTALS.map((k) => (
                        <li key={k} data-imb-total={k}>
                          {copy.totalNames[k]}: {amount(result.totals![k])}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noTotals}</p>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
