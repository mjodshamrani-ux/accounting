import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { BankAdjustmentWorkspace } from './bank-adjustment-workspace';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { BrandMark, BrandWordmark } from '@/components/brand';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n } from '@/lib/i18n/context';
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import { money } from '@/lib/reconciliation/core';
import {
  BANK_SCOPE_FIELDS,
  type BankInput,
  type BankScope,
  type BankReading,
  type BankResult,
  type BankEvent,
} from '@/lib/reconciliation/bank';
import {
  bankDemo,
  bankDemoReadings,
  bankDemoScope,
} from '@/lib/reconciliation/bank-demo';
import './gl-tb-workspace.css';
import './bank-workspace.css';
const freshScope = (): BankScope => ({
  ...bankDemoScope,
  entity: '',
  ledger: '',
  account: '',
  start: '',
  end: '',
  confirmed: false,
});
const freshReading = (side: number): BankReading => ({
  ...bankDemoReadings[side],
  confirmed: false,
});
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function BankWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue } = useI18n(),
    t = catalogue.bank;
  const [files, setFiles] = useState<[SourceFile | null, SourceFile | null]>([
      null,
      null,
    ]),
    [readings, setReadings] = useState<BankInput['readings']>([
      freshReading(0),
      freshReading(1),
    ]),
    [scope, setScope] = useState(freshScope),
    [events, setEvents] = useState<BankEvent[]>([]),
    [result, setResult] = useState<BankResult | null>(null),
    [busy, setBusy] = useState(false),
    [balanceBusy, setBalanceBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [page, setPage] = useState(0),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [bankId, setBankId] = useState(''),
    [cashId, setCashId] = useState(''),
    [evidenceId, setEvidenceId] = useState('');
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
    setEvents([]);
    setFailed(false);
    setPage(0);
    setBankId('');
    setCashId('');
    setEvidenceId('');
    setReference('');
    setNote('');
  }
  const input = (): BankInput => ({
    files: files as BankInput['files'],
    readings,
    scope,
    events,
  });
  function install(v: { state: BankInput; result: BankResult }) {
    setFiles(v.state.files);
    setReadings(v.state.readings);
    setScope(v.state.scope);
    setEvents(v.state.events);
    setResult(v.result);
    setPage(0);
    setBankId('');
    setCashId('');
    setEvidenceId('');
    setReference('');
    setNote('');
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
  async function decide(
    type: BankEvent['type'],
    bankIds: string[],
    cashIds: string[],
  ) {
    if (!result) return;
    const event: BankEvent = {
      id: crypto.randomUUID(),
      type,
      context: result.context,
      at: new Date().toISOString(),
      reference: reference.trim(),
      note: note.trim(),
      bankIds,
      cashIds,
    };
    await perform(async (signal) => {
      const next = await workerTask<{ state: BankInput; result: BankResult }>(
        'bank-reconcile',
        { ...input(), events: [...events, event] },
        signal,
      );
      setEvents(next.state.events);
      setResult(next.result);
      setBankId('');
      setCashId('');
    });
  }
  function table<T>(
    title: string,
    headers: string[],
    data: T[],
    cells: (r: T) => ReactNode[],
  ) {
    return (
      <section>
        <h2>{title}</h2>
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
              {data.slice(page * 50, (page + 1) * 50).map((r, i) => (
                <tr key={page * 50 + i}>
                  {cells(r).map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  const missingIds = new Set(
    result?.cases
      .filter((g) => g.kind === 'missing')
      .flatMap((g) => [...g.bankIds, ...g.cashIds]),
  );
  const format = (n: number) => money(n, result?.decimals ?? 2),
    byId = new Map(result?.records.map((r) => [r.id, r])),
    memberNames = (ids: string[]) =>
      ids.map((id) => byId.get(id)?.reference ?? id).join(' · '),
    evidence = byId.get(evidenceId),
    canDecide =
      !!result &&
      result.status !== 'source-error' &&
      !!reference.trim() &&
      !!note.trim(),
    maxRows = Math.max(
      result?.cases.length ?? 0,
      result?.records.length ?? 0,
      result?.inventory.length ?? 0,
      result?.events.length ?? 0,
      result?.timingItems.length ?? 0,
    );
  const locked = busy || balanceBusy;
  return (
    <>
      {active && (
        <main
          className="app-shell gl-tb-workspace bank-workspace"
          aria-busy={locked}
        >
          <header className="gl-tb-actions">
            <BrandMark />
            <BrandWordmark />
            <LanguageSwitcher />
            <Button variant="outline" disabled={locked} onClick={onBack}>
              {t.back}
            </Button>
          </header>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
          <p>{t.limits}</p>
          <p>{t.claim}</p>
          <fieldset disabled={locked}>
            <div className="gl-tb-actions">
              <Button
                onClick={() =>
                  perform(async (signal) => {
                    const sources: SourceFile[] = [];
                    for (const demo of bankDemo())
                      sources.push(await workerTask('read', demo, signal));
                    install(
                      await workerTask(
                        'bank-reconcile',
                        {
                          files: sources,
                          readings: bankDemoReadings,
                          scope: bankDemoScope,
                          events: [],
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
                  aria-label={t.restore}
                  onChange={(e) => {
                    const blob = e.target.files?.[0];
                    e.target.value = '';
                    if (!blob) return;
                    if (blob.size > 32 * 1024 * 1024) {
                      setFailed(true);
                      return;
                    }
                    void perform(async (signal) =>
                      install(
                        await workerTask(
                          'bank-restore',
                          { buffer: await blob.arrayBuffer() },
                          signal,
                        ),
                      ),
                    );
                  }}
                />
              </label>
            </div>
            <div className="gl-tb-grid">
              {([0, 1] as const).map((side) => (
                <section key={side} data-testid={`bank-source-${side}`}>
                  <h2>{t.sides[side]}</h2>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    aria-label={t.sides[side]}
                    onChange={(e) => {
                      const blob = e.target.files?.[0];
                      e.target.value = '';
                      if (blob) void upload(side, blob);
                    }}
                  />
                  {files[side] && (
                    <>
                      <p>{files[side]!.name}</p>
                      <label>
                        {t.sheet}
                        <select
                          aria-label={`${t.sides[side]} ${t.sheet}`}
                          value={readings[side].sheet}
                          onChange={(e) => {
                            setReadings((previous) => {
                              const next = [...previous] as typeof readings;
                              next[side] = {
                                ...next[side],
                                sheet: Number(e.target.value),
                                confirmed: false,
                              };
                              return next;
                            });
                            invalidate();
                          }}
                        >
                          {files[side]!.sheets.map((sheet, index) => (
                            <option key={index} value={index}>
                              {sheet.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${t.sides[side]} ${t.sourceConfirm}`}
                          checked={readings[side].confirmed}
                          onChange={(e) => {
                            setReadings((previous) => {
                              const next = [...previous] as typeof readings;
                              next[side] = {
                                ...next[side],
                                confirmed: e.target.checked,
                              };
                              return next;
                            });
                            invalidate();
                          }}
                        />
                        {t.sourceConfirm}
                      </label>
                    </>
                  )}
                </section>
              ))}
            </div>
            <div className="gl-tb-grid">
              {BANK_SCOPE_FIELDS.map((key) => (
                <label key={key}>
                  {t.fields[key]}
                  <input
                    aria-label={t.fields[key]}
                    type={key === 'start' || key === 'end' ? 'date' : 'text'}
                    value={scope[key]}
                    onChange={(e) => {
                      setScope((previous) => ({
                        ...previous,
                        [key]: e.target.value,
                        confirmed: false,
                      }));
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
                  setScope((previous) => ({
                    ...previous,
                    confirmed: e.target.checked,
                  }));
                  invalidate();
                }}
              />
              {t.scopeConfirm}
            </label>
            <Button
              disabled={
                !files.every(Boolean) ||
                !readings.every((r) => r.confirmed) ||
                !scope.confirmed
              }
              onClick={() =>
                perform(async (signal) =>
                  install(await workerTask('bank-reconcile', input(), signal)),
                )
              }
            >
              {t.compare}
            </Button>
          </fieldset>
          {busy && (
            <Button
              variant="outline"
              onClick={() => {
                serial.current++;
                controller.current?.abort();
                controller.current = null;
                setBusy(false);
              }}
            >
              {t.cancel}
            </Button>
          )}
          {failed && <p role="alert">{t.failed}</p>}
          {result && (
            <>
              <h2 data-testid="bank-result">{t.status[result.status]}</h2>
              <DomainEvidenceAssistant result={result} snapshot={() => ({ domain: "bank", input: input(), result })} busy={locked} />
              <fieldset disabled={locked}>
                <div className="gl-tb-actions">
                  <Button
                    onClick={() =>
                      perform(async (signal) =>
                        download(
                          await workerTask('bank-save', input(), signal),
                          'tarasuf-bank-session.json',
                          'application/json',
                        ),
                      )
                    }
                  >
                    {t.save}
                  </Button>
                  <Button
                    onClick={() =>
                      perform(async (signal) =>
                        download(
                          await workerTask(
                            'bank-export',
                            { state: input(), result },
                            signal,
                          ),
                          'tarasuf-bank-workpaper.xlsx',
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        ),
                      )
                    }
                  >
                    {t.export}
                  </Button>
                </div>
                <label>
                  {t.reference}
                  <input
                    aria-label={t.reference}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  {t.reason}
                  <textarea
                    aria-label={t.reason}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {table(
                  t.groups,
                  [
                    t.settlement,
                    t.kind,
                    t.policy,
                    t.bankTotal,
                    t.cashTotal,
                    t.difference,
                    t.members,
                    t.eligible,
                    t.reason,
                    t.approve,
                    t.undo,
                  ],
                  result.cases,
                  (g) => [
                    g.kind === 'reference' ? g.key : t.caseKinds[g.kind],
                    t.caseKinds[g.kind],
                    g.policy ? t.policies[g.policy] : '',
                    format(g.bankMinor),
                    format(g.cashMinor),
                    format(g.deltaMinor),
                    `${t.sides[0]}: ${memberNames(g.bankIds)}; ${t.sides[1]}: ${memberNames(g.cashIds)}`,
                    g.eligible ? t.yes : t.no,
                    t.reasons[g.reason],
                    <div key="status-approve">
                      <p>{t.caseStatus[g.status]}</p>
                      <Button
                        disabled={
                          !canDecide ||
                          !g.eligible ||
                          g.status !== 'needs-review'
                        }
                        onClick={() => decide('accept', g.bankIds, g.cashIds)}
                      >
                        {t.approve}
                      </Button>
                    </div>,
                    <Button
                      key="undo"
                      variant="outline"
                      disabled={!canDecide || !g.status.startsWith('matched')}
                      onClick={() => decide('undo', g.bankIds, g.cashIds)}
                    >
                      {t.undo}
                    </Button>,
                  ],
                )}
                <section>
                  <h2>{t.manual}</h2>
                  <div className="gl-tb-grid">
                    {([0, 1] as const).map((side) => (
                      <label key={side}>
                        {side ? t.selectCash : t.selectBank}
                        <select
                          aria-label={side ? t.selectCash : t.selectBank}
                          value={side ? cashId : bankId}
                          onChange={(e) =>
                            side
                              ? setCashId(e.target.value)
                              : setBankId(e.target.value)
                          }
                        >
                          <option value="">{t.choose}</option>
                          {result.records
                            .filter(
                              (r) =>
                                r.side === side &&
                                !r.settlement &&
                                r.policy === 'individual' &&
                                missingIds.has(r.id),
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.reference} · {format(r.signed)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <Button
                    disabled={!canDecide || !bankId || !cashId}
                    onClick={() => decide('accept', [bankId], [cashId])}
                  >
                    {t.approveManual}
                  </Button>
                </section>
                {table(
                  t.movements,
                  [
                    t.side,
                    t.row,
                    t.own,
                    t.settlement,
                    t.date,
                    t.valueDate,
                    t.direction,
                    t.role,
                    t.parent,
                    t.reverses,
                    t.amount,
                    t.reviewCells,
                  ],
                  result.records,
                  (r) => [
                    t.sides[r.side],
                    r.row,
                    r.reference,
                    r.settlement,
                    r.movementDate,
                    r.valueDate,
                    t.directions[r.direction],
                    t.roles[r.role],
                    r.parent,
                    r.reverses,
                    format(r.signed),
                    <Button
                      key="evidence"
                      variant="outline"
                      onClick={() => setEvidenceId(r.id)}
                    >
                      {t.reviewCells}
                    </Button>,
                  ],
                )}
                {evidence && (
                  <section>
                    <h2>
                      {t.evidence} · {t.sides[evidence.side]} ·{' '}
                      {evidence.reference} · {t.row} {evidence.row}
                    </h2>
                    <div className="gl-tb-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t.field}</th>
                            <th>{t.column}</th>
                            <th>{t.original}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidence.traces.map((c) => (
                            <tr key={c.field}>
                              <td>
                                {
                                  t.sourceFields[
                                    c.field as keyof typeof t.sourceFields
                                  ]
                                }
                              </td>
                              <td>{c.column}</td>
                              <td>{c.text}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <p>{t.retainedTiming}</p>
                {table(
                  t.timing,
                  [t.side, t.row, t.own, t.date, t.valueDate, t.validMovement],
                  result.timingItems,
                  (r) => [
                    t.sides[r.side],
                    r.row,
                    r.reference,
                    r.movementDate,
                    r.valueDate,
                    r.validMovement ? t.yes : t.no,
                  ],
                )}
                {table(
                  t.events,
                  [
                    t.own,
                    t.kind,
                    t.deviceTime,
                    t.reference,
                    t.reason,
                    t.members,
                  ],
                  result.events,
                  (e) => [
                    e.id,
                    t.eventType[e.type],
                    e.at,
                    e.reference,
                    e.note,
                    `${memberNames(e.bankIds)} · ${memberNames(e.cashIds)}`,
                  ],
                )}
                {table(
                  t.inventory,
                  [t.side, t.row, t.kind, t.reason, t.original],
                  result.inventory,
                  (i) => [
                    t.sides[i.side],
                    i.row,
                    t.inventoryKinds[i.kind],
                    i.error
                      ? (t.rowErrors[i.error as keyof typeof t.rowErrors] ??
                        t.rowErrors.BANK_ROW)
                      : '',
                    <pre key="original">{i.values.join(' · ')}</pre>,
                  ],
                )}
                <div className="gl-tb-actions">
                  <Button
                    variant="outline"
                    disabled={!page}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t.previous}
                  </Button>
                  <span>
                    {page + 1} / {Math.max(1, Math.ceil(maxRows / 50))}
                  </span>
                  <Button
                    variant="outline"
                    disabled={(page + 1) * 50 >= maxRows}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t.next}
                  </Button>
                </div>
              </fieldset>
            </>
          )}
        </main>
      )}
      <div
        className="app-shell gl-tb-workspace bank-workspace"
        hidden={!active}
        style={{ display: active ? undefined : 'none' }}
      >
        <BankAdjustmentWorkspace
          bank={result ? input() : null}
          disabled={busy}
          onBusy={setBalanceBusy}
          onRestoreBank={install}
        />
      </div>
    </>
  );
}
