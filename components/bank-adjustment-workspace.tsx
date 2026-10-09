import {
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
} from './workspace-chrome';
import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './bank-adjustment-workspace.css';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/context';
import { bankAdjustmentCopy } from '@/lib/i18n/bank-adjustment';
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import { money } from '@/lib/reconciliation/core';
import { type BankInput, type BankResult } from '@/lib/reconciliation/bank';
import {
  BANK_BALANCE_VERSION,
  BANK_BALANCE_ROLES,
  bankBalanceOpeningDate,
  type BankBalanceInput,
} from '@/lib/reconciliation/bank-balance';
import {
  ADJUSTMENT_SESSION_LIMIT,
  ADJUSTMENT_VERSION,
  ADJUSTMENT_ROLES,
  type BankAdjustmentInput,
  type BankAdjustmentResult,
  type AdjustmentEvent,
} from '@/lib/reconciliation/bank-adjustment';

import {
  bankDemoReadings,
  bankDemoScope,
} from '@/lib/reconciliation/bank-demo';
import { adjustmentDemoSources } from '@/lib/reconciliation/bank-adjustment-demo';
const bankKey = (b: BankInput | null) =>
  b
    ? JSON.stringify([
        b.files.map((f) => f.sha256),
        b.readings,
        b.scope,
        b.events,
      ])
    : '';
const freshReadings = () => [
  ...BANK_BALANCE_ROLES.map((role) => ({
    role,
    sheet: 0,
    family: BANK_BALANCE_VERSION,
    perspective: 'company-cash',
    confirmed: false,
  })),
  ...ADJUSTMENT_ROLES.map((role) => ({
    role,
    sheet: 0,
    family: ADJUSTMENT_VERSION,
    perspective: 'company-cash',
    confirmed: false,
  })),
];
function download(data: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function BankAdjustmentWorkspace({
  bank,
  disabled,
  onBusy,
  onRestoreBank,
}: {
  bank: BankInput | null;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRestoreBank: (v: { state: BankInput; result: BankResult }) => void;
}) {
  const { lang } = useI18n(),
    t = bankAdjustmentCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
      null,
      null,
      null,
      null,
    ]),
    [readings, setReadings] = useState(freshReadings),
    [coverage, setCoverage] = useState(false),
    [complete, setComplete] = useState(false),
    [coverageRef, setCoverageRef] = useState(''),
    [coverageNote, setCoverageNote] = useState(''),
    [events, setEvents] = useState<AdjustmentEvent[]>([]),
    [result, setResult] = useState<BankAdjustmentResult | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<
      { field: string; column: number; text: string }[] | null
    >(null);
  const controller = useRef<AbortController | null>(null),
    serial = useRef(0),
    lastBank = useRef(bankKey(bank)),
    key = bankKey(bank),
    locked = disabled || busy;
  function invalidate() {
    setResult(null);
    setEvents([]);
    setSelected(null);
    setPage(0);
    setFailed(false);
  }
  useEffect(() => {
    if (lastBank.current !== key) {
      lastBank.current = key;
      setResult(null);
      setEvents([]);
      setComplete(false);
      setCoverage(false);
      setSelected(null);
      setPage(0);
    }
  }, [key]);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
      onBusy(false);
    },
    [onBusy],
  );
  function input(): BankAdjustmentInput {
    if (!bank) throw Error('Bank movements required');
    return {
      balance: {
        bank,
        files: files.slice(0, 2) as BankBalanceInput['files'],
        readings: readings.slice(0, 2) as BankBalanceInput['readings'],
        coverage: {
          basis: 'movement-date',
          boundary: 'end-of-day',
          openingAsOf: bankBalanceOpeningDate(bank.scope.start),
          closingAsOf: bank.scope.end,
          confirmed: coverage,
        },
      },
      files: files.slice(2) as BankAdjustmentInput['files'],
      readings: readings.slice(2) as BankAdjustmentInput['readings'],
      completeness: {
        confirmed: complete,
        reference: coverageRef.trim(),
        note: coverageNote.trim(),
      },
      events,
    };
  }
  function install(v: {
    state: BankAdjustmentInput;
    result: BankAdjustmentResult;
  }) {
    lastBank.current = bankKey(v.state.balance.bank);
    setFiles([...v.state.balance.files, ...v.state.files]);
    setReadings([...v.state.balance.readings, ...v.state.readings]);
    setCoverage(v.state.balance.coverage.confirmed);
    setComplete(v.state.completeness.confirmed);
    setCoverageRef(v.state.completeness.reference);
    setCoverageNote(v.state.completeness.note);
    setEvents(v.state.events);
    setResult(v.result);
    setSelected(null);
    setPage(0);
    onRestoreBank({
      state: v.state.balance.bank,
      result: v.result.balance.bank,
    });
  }
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current?.abort();
    controller.current = control;
    setBusy(true);
    onBusy(true);
    setFailed(false);
    try {
      await prepareWorker();
      if (!control.signal.aborted) await work(control.signal);
    } catch {
      if (id === serial.current && !control.signal.aborted) setFailed(true);
    } finally {
      if (id === serial.current) {
        setBusy(false);
        onBusy(false);
        controller.current = null;
      }
    }
  }
  async function upload(index: number, blob: File) {
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
      if (signal.aborted) return;
      setFiles((previous) =>
        previous.map((f, i) => (i === index ? source : f)),
      );
      setReadings((previous) =>
        previous.map((r, i) =>
          i === index ? { ...r, sheet: 0, confirmed: false } : r,
        ),
      );
      setComplete(false);
      invalidate();
    });
  }
  async function decide(type: AdjustmentEvent['type'], itemIds: string[]) {
    if (!result) return;
    const event: AdjustmentEvent = {
      id: crypto.randomUUID(),
      type,
      context: result.context,
      at: new Date().toISOString(),
      reference: reference.trim(),
      note: note.trim(),
      itemIds,
    };
    await perform(async (signal) => {
      const v = await workerTask<{
        state: BankAdjustmentInput;
        result: BankAdjustmentResult;
      }>(
        'bank-adjustment-reconcile',
        { ...input(), events: [...events, event] },
        signal,
      );
      if (!signal.aborted) install(v);
    });
  }
  function table<T>(
    title: string,
    headers: readonly string[],
    rows: T[],
    cells: (r: T) => ReactNode[],
    testid?: string,
    paged = true,
  ) {
    return (
      <section>
        <h3>{title}</h3>
        <div className="gl-tb-table">
          <table data-testid={testid}>
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(paged ? rows.slice(page * 50, (page + 1) * 50) : rows).map(
                (r, i) => (
                  <tr key={page * 50 + i}>
                    {cells(r).map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  const fmt = (n: number | null) =>
      n === null ? t.missing : money(n, result?.balance.decimals ?? 2),
    itemsById = new Map(result?.items.map((i) => [i.id, i.reference])),
    proofsById = new Map(result?.proofs.map((i) => [i.id, i.reference])),
    canDecide =
      !!result &&
      !['source-error', 'missing'].includes(result.status) &&
      !!reference.trim() &&
      !!note.trim(),
    maxRows = Math.max(
      result?.items.length ?? 0,
      result?.proofs.length ?? 0,
      result?.inventory.length ?? 0,
      result?.lifecycles.length ?? 0,
      result?.events.length ?? 0,
      result?.balance.records.length ?? 0,
      result?.balance.inventory.length ?? 0,
    );
  return (
    <section
      className="gl-tb-workspace bank-balance-section"
      aria-busy={busy}
      data-testid="bank-balance-workspace"
    >
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      <p>{t.claim}</p>
      <fieldset disabled={locked}>
        <div className="gl-tb-actions workspace-toolbar">
          <Button
            onClick={() =>
              perform(async (signal) => {
                const f: SourceFile[] = [];
                for (const [i, text] of adjustmentDemoSources.entries())
                  f.push(
                    await workerTask(
                      'read',
                      {
                        name: `synthetic-balance-${i}.csv`,
                        buffer: new TextEncoder().encode(text).buffer,
                      },
                      signal,
                    ),
                  );
                const state: BankAdjustmentInput = {
                  balance: {
                    bank: {
                      files: [f[0], f[1]],
                      readings: bankDemoReadings,
                      scope: bankDemoScope,
                      events: [],
                    },
                    files: [f[2], f[3]],
                    readings: BANK_BALANCE_ROLES.map((role) => ({
                      role,
                      sheet: 0,
                      family: BANK_BALANCE_VERSION,
                      perspective: 'company-cash',
                      confirmed: true,
                    })) as BankBalanceInput['readings'],
                    coverage: {
                      basis: 'movement-date',
                      boundary: 'end-of-day',
                      openingAsOf: '2026-08-31',
                      closingAsOf: '2026-09-30',
                      confirmed: true,
                    },
                  },
                  files: [f[4], f[5]],
                  readings: ADJUSTMENT_ROLES.map((role) => ({
                    role,
                    sheet: 0,
                    family: ADJUSTMENT_VERSION,
                    perspective: 'company-cash',
                    confirmed: true,
                  })) as BankAdjustmentInput['readings'],
                  completeness: {
                    confirmed: true,
                    reference: 'SYNTHETIC coverage',
                    note: 'Supplied original synthetic endpoint inventory reviewed; no field validation',
                  },
                  events: [],
                };
                const v = await workerTask<{
                  state: BankAdjustmentInput;
                  result: BankAdjustmentResult;
                }>('bank-adjustment-reconcile', state, signal);
                if (!signal.aborted) install(v);
              })
            }
          >
            {t.demo}
          </Button>
          <label>
            {t.restore}
            <input
              type="file"
              accept=".json"
              aria-label={t.restore}
              onChange={(e) => {
                const blob = e.target.files?.[0];
                e.target.value = '';
                if (!blob) return;
                if (blob.size > ADJUSTMENT_SESSION_LIMIT) {
                  setFailed(true);
                  return;
                }
                void perform(async (signal) => {
                  const v = await workerTask<{
                    state: BankAdjustmentInput;
                    result: BankAdjustmentResult;
                  }>(
                    'bank-adjustment-restore',
                    { buffer: await blob.arrayBuffer() },
                    signal,
                  );
                  if (!signal.aborted) install(v);
                });
              }}
            />
          </label>
        </div>
        <WorkspaceGroupTitle kind="sources" />
        <div className="gl-tb-grid workspace-sources">
          {files.map((file, index) => (
            <section
              className="workspace-source"
              key={index}
              data-testid={`balance-source-${index}`}
            >
              <h3>
                <WorkspaceSourceHeading>
                  {t.sources[index]}
                </WorkspaceSourceHeading>
              </h3>
              <label>
                {t.sources[index]}
                <WorkspaceFileInput
                  type="file"
                  aria-label={t.sources[index]}
                  accept=".csv,.xlsx"
                  onChange={(e) => {
                    const blob = e.target.files?.[0];
                    e.target.value = '';
                    if (blob) void upload(index, blob);
                  }}
                />
              </label>
              {file && (
                <>
                  <p>{file.name}</p>
                  <label>
                    {t.sheet}
                    <select
                      aria-label={`${t.sources[index]} ${t.sheet}`}
                      value={readings[index].sheet}
                      onChange={(e) => {
                        setReadings((previous) =>
                          previous.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  sheet: Number(e.target.value),
                                  confirmed: false,
                                }
                              : r,
                          ),
                        );
                        setComplete(false);
                        invalidate();
                      }}
                    >
                      {file.sheets.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={readings[index].confirmed}
                      aria-label={`${t.sources[index]} ${t.review}`}
                      onChange={(e) => {
                        setReadings((previous) =>
                          previous.map((r, i) =>
                            i === index
                              ? { ...r, confirmed: e.target.checked }
                              : r,
                          ),
                        );
                        setComplete(false);
                        invalidate();
                      }}
                    />
                    {t.review}
                  </label>
                </>
              )}
            </section>
          ))}
        </div>
        {bank && (
          <p>
            {bank.scope.account} · {bank.scope.currency} ·{' '}
            {bankBalanceOpeningDate(bank.scope.start)} → {bank.scope.end}
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={coverage}
            onChange={(e) => {
              setCoverage(e.target.checked);
              invalidate();
            }}
          />
          {t.coverage}
        </label>
        <label>
          <input
            type="checkbox"
            checked={complete}
            onChange={(e) => {
              setComplete(e.target.checked);
              invalidate();
            }}
          />
          {t.complete}
        </label>
        <label>
          {t.coverageRef}
          <input
            aria-label={t.coverageRef}
            value={coverageRef}
            onChange={(e) => {
              setCoverageRef(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label>
          {t.coverageNote}
          <textarea
            aria-label={t.coverageNote}
            value={coverageNote}
            onChange={(e) => {
              setCoverageNote(e.target.value);
              invalidate();
            }}
          />
        </label>
        <Button
          disabled={
            !bank ||
            files.some((f) => !f) ||
            readings.some((r) => !r.confirmed) ||
            !coverage ||
            !complete ||
            !coverageRef.trim() ||
            !coverageNote.trim()
          }
          onClick={() =>
            perform(async (signal) => {
              const v = await workerTask<{
                state: BankAdjustmentInput;
                result: BankAdjustmentResult;
              }>('bank-adjustment-reconcile', input(), signal);
              if (!signal.aborted) install(v);
            })
          }
        >
          {t.compare}
        </Button>
      </fieldset>
      {busy && (
        <>
          <output>{t.busy}</output>
          <Button
            onClick={() => {
              serial.current++;
              controller.current?.abort();
              controller.current = null;
              setBusy(false);
              onBusy(false);
            }}
          >
            {t.cancel}
          </Button>
        </>
      )}
      {failed && <p role="alert">{t.failed}</p>}
      {result && (
        <>
          <h3 data-testid="bank-balance-result">{t.status[result.status]}</h3>
          <DomainEvidenceAssistant
            result={result}
            snapshot={() => ({
              domain: 'bank-adjustment',
              input: input(),
              result,
            })}
            busy={locked}
          />
          <p>
            {t.pending}: {result.unresolved.length}
          </p>
          <fieldset disabled={locked}>
            <div className="gl-tb-actions">
              <Button
                onClick={() =>
                  perform(async (signal) => {
                    const data = await workerTask<ArrayBuffer>(
                      'bank-adjustment-save',
                      input(),
                      signal,
                    );
                    if (!signal.aborted)
                      download(
                        data,
                        'tarasuf-bank-reconciliation-session.json',
                        'application/json',
                      );
                  })
                }
              >
                {t.save}
              </Button>
              <Button
                onClick={() =>
                  perform(async (signal) => {
                    const data = await workerTask<ArrayBuffer>(
                      'bank-adjustment-export',
                      { state: input(), result },
                      signal,
                    );
                    if (!signal.aborted)
                      download(
                        data,
                        'tarasuf-bank-reconciliation.xlsx',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      );
                  })
                }
              >
                {t.export}
              </Button>
            </div>
            {table(
              t.endpoints,
              t.endpointHead,
              result.endpoints,
              (e) => [
                t.point[e.point],
                ...[
                  e.rawBank,
                  e.rawCash,
                  e.bankAdjustment,
                  e.cashAdjustment,
                  e.adjustedBank,
                  e.adjustedCash,
                  e.difference,
                ].map(fmt),
              ],
              'bank-balance-endpoints',
              false,
            )}
            {table(
              t.raw,
              t.rawHead,
              result.balance.components,
              (c) => [
                t.sides[c.side],
                fmt(c.opening),
                fmt(c.movement),
                fmt(c.closing),
                fmt(c.residual),
              ],
              'bank-balance-raw',
              false,
            )}
            {table(t.balances, t.balanceHead, result.balance.records, (r) => [
              t.sides[r.side],
              r.reference,
              t.point[r.kind],
              r.asOf,
              fmt(r.amount),
              <Button
                key="cells"
                onClick={() => {
                  setPage(0);
                  setSelected(r.cells);
                }}
              >
                {t.evidence}
              </Button>,
            ])}
            {table(
              t.missingBalances,
              t.missingHead,
              result.balance.missing,
              (m) => [t.sides[m.side], t.point[m.kind]],
              'bank-balance-missing',
              false,
            )}
            {table(
              t.balanceInventory,
              t.inventoryHead,
              result.balance.inventory,
              (i) => [
                t.sources[i.side],
                i.row,
                t.inventoryKind[i.kind],
                i.error
                  ? (t.balanceReason[
                      i.error.replace(
                        /^BALANCE_/,
                        '',
                      ) as keyof typeof t.balanceReason
                    ] ?? t.other)
                  : '',
                JSON.stringify(i.values),
              ],
              'bank-balance-inventory',
            )}
            <label>
              {t.reference}
              <input
                aria-label={t.reference}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label>
              {t.note}
              <textarea
                aria-label={t.note}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {table(
              t.cycles,
              t.cycleHead,
              result.lifecycles,
              (l) => [
                l.reference,
                t.cycleStatus[l.status],
                l.itemIds.map((id) => itemsById.get(id)).join(' · '),
                l.proofIds.map((id) => proofsById.get(id)).join(' · '),
                <div key="actions" className="gl-tb-actions">
                  <Button
                    disabled={!canDecide || l.status !== 'needs-review'}
                    onClick={() => decide('accept', l.itemIds)}
                    aria-label={`${t.accept} ${l.reference}`}
                  >
                    {t.accept}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!canDecide || l.status !== 'needs-review'}
                    onClick={() => decide('reject', l.itemIds)}
                    aria-label={`${t.reject} ${l.reference}`}
                  >
                    {t.reject}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !canDecide || !['accepted', 'rejected'].includes(l.status)
                    }
                    onClick={() => decide('undo', l.itemIds)}
                    aria-label={`${t.undo} ${l.reference}`}
                  >
                    {t.undo}
                  </Button>
                </div>,
              ],
              'bank-balance-lifecycles',
            )}
            {table(
              t.items,
              t.itemHead,
              result.items,
              (i) => [
                i.reference,
                t.point[i.point],
                t.sides[i.side],
                i.proofReference,
                fmt(i.amount),
                i.explanation,
                <Button
                  key="cells"
                  onClick={() => {
                    setPage(0);
                    setSelected(i.cells);
                  }}
                >
                  {t.evidence}
                </Button>,
              ],
              'bank-balance-items',
            )}
            {table(
              t.proofs,
              t.proofHead,
              result.proofs,
              (p) => [
                p.reference,
                p.lifecycle,
                t.kind[p.kind],
                t.sides[p.side],
                p.recordReference,
                p.movementDate,
                p.valueDate,
                p.document,
                fmt(p.amount),
                <Button
                  key="cells"
                  onClick={() => {
                    setPage(0);
                    setSelected(p.cells);
                  }}
                >
                  {t.evidence}
                </Button>,
              ],
              'bank-balance-proofs',
            )}
            {table(
              t.inventory,
              t.inventoryHead,
              result.inventory,
              (i) => [
                t.sources[i.source + 2],
                i.row,
                t.inventoryKind[i.kind],
                i.error
                  ? (t.reason[
                      i.error.replace(
                        /^ADJUSTMENT_/,
                        '',
                      ) as keyof typeof t.reason
                    ] ?? t.other)
                  : '',
                JSON.stringify(i.values),
              ],
              'bank-balance-inventory',
            )}
            {table(
              t.history,
              t.historyHead,
              result.events,
              (e) => [
                e.type === 'accept'
                  ? t.accept
                  : e.type === 'reject'
                    ? t.reject
                    : t.undo,
                e.at,
                e.reference,
                e.note,
                e.itemIds.map((id) => itemsById.get(id)).join(' · '),
              ],
              'bank-balance-events',
            )}
            {selected &&
              table(
                t.cells,
                t.cellHead,
                selected,
                (c) => [c.field, c.column, c.text],
                'bank-balance-cells',
              )}
            <div className="gl-tb-actions">
              <Button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                {t.previous}
              </Button>
              <span>{page + 1}</span>
              <Button
                disabled={(page + 1) * 50 >= maxRows}
                onClick={() => setPage((p) => p + 1)}
              >
                {t.next}
              </Button>
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}
