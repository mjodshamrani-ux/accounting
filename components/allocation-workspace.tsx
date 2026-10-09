import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useLayoutEffect, useRef, useState } from 'react';
import type { AllocationWorkflowHandoff } from '@/lib/reconciliation/allocation-workflow-handoff';
import { allocationWorkflowHandoffCopy } from '@/lib/i18n/allocation-workflow-handoff';
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
import { money, parseMoney } from '@/lib/reconciliation/core';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import {
  ALLOCATION_SCOPE_FIELDS,
  type AllocationInput,
  type AllocationResult,
  type AllocationEvent,
  type AllocationLink,
} from '@/lib/reconciliation/allocation';
import {
  allocationDemo,
  allocationDemoScope,
  allocationDemoReadings,
} from '@/lib/reconciliation/allocation-demo';
import './gl-tb-workspace.css';

export function AllocationWorkspace({
  active,
  onBack,
  handoff,
}: {
  active: boolean;
  onBack: () => void;
  handoff?: AllocationWorkflowHandoff | null;
}) {
  const { t: catalogue, lang } = useI18n(),
    t = catalogue.allocation;
  const h = allocationWorkflowHandoffCopy(lang);
  const freshScope = (): AllocationInput['scope'] => ({
    ...allocationDemoScope,
    entity: handoff?.scopeHints.entity ?? '',
    ledger: '',
    party: handoff?.scopeHints.party ?? '',
    account: handoff?.scopeHints.account ?? '',
    currency: handoff?.scopeHints.currency ?? allocationDemoScope.currency,
    cutoff: handoff?.scopeHints.cutoff ?? '',
    confirmed: false,
  });
  const sides = t.sides,
    labels = t.fields;
  const [files, setFiles] = useState<
      [SourceFile | null, SourceFile | null, SourceFile | null]
    >([null, null, null]),
    [readings, setReadings] = useState<AllocationInput['readings']>(
      allocationDemoReadings.map((r) => ({
        ...r,
        confirmed: false,
      })) as AllocationInput['readings'],
    ),
    [scope, setScope] = useState<AllocationInput['scope']>(freshScope),
    [events, setEvents] = useState<AllocationEvent[]>([]),
    [result, setResult] = useState<AllocationResult | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [basis, setBasis] = useState<'accountant-review' | 'external-confirmation'>(
      'accountant-review',
    ),
    [drafts, setDrafts] = useState([
      { paymentId: '', invoiceId: '', amount: '' },
    ]);
  const runtime = useRef({
    active,
    mounted: false,
    serial: 0,
    controller: null as AbortController | null,
  });
  const [binding, setBinding] = useState({
    active,
    revision: handoff?.revision,
  });
  if (binding.active !== active || binding.revision !== handoff?.revision) {
    setBinding({ active, revision: handoff?.revision });
    setBusy(false);
    setFailed(false);
    if (binding.revision !== handoff?.revision) {
      setFiles([null, null, null]);
      setReadings(
        allocationDemoReadings.map((r) => ({
          ...r,
          confirmed: false,
        })) as AllocationInput['readings'],
      );
      setScope(freshScope());
      setEvents([]);
      setResult(null);
      setSelected([]);
      setReason('');
      setReference('');
      setBasis('accountant-review');
      setDrafts([{ paymentId: '', invoiceId: '', amount: '' }]);
      setPage(0);
    }
  }
  useLayoutEffect(() => {
    const live = runtime.current;
    live.active = active;
    live.mounted = true;
    return () => {
      live.active = false;
      live.mounted = false;
      live.serial++;
      live.controller?.abort();
      live.controller = null;
    };
  }, [active, handoff?.revision]);
  const input = (): AllocationInput => ({
    files: files as AllocationInput['files'],
    readings,
    scope,
    events,
  });
  function cancelPending() {
    runtime.current.serial++;
    runtime.current.controller?.abort();
    runtime.current.controller = null;
    setBusy(false);
  }
  function invalidate() {
    cancelPending();
    setResult(null);
    setEvents([]);
    setSelected([]);
    setDrafts([{ paymentId: '', invoiceId: '', amount: '' }]);
    setReason('');
    setReference('');
    setBasis('accountant-review');
    setFailed(false);
    setPage(0);
  }
  function editReview(edit: () => void) {
    cancelPending();
    setFailed(false);
    edit();
  }
  function install(v: { state: AllocationInput; result: AllocationResult }) {
    setFiles(v.state.files);
    setReadings(v.state.readings);
    setScope(v.state.scope);
    setEvents(v.state.events);
    setResult(v.result);
    setSelected([]);
    setPage(0);
  }
  async function perform<T>(
    work: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
  ) {
    if (!runtime.current.active || !runtime.current.mounted) return;
    runtime.current.controller?.abort();
    const id = ++runtime.current.serial,
      c = new AbortController();
    runtime.current.controller = c;
    const alive = () =>
      runtime.current.active &&
      runtime.current.mounted &&
      id === runtime.current.serial &&
      runtime.current.controller === c &&
      !c.signal.aborted;
    setBusy(true);
    setFailed(false);
    try {
      await prepareWorker();
      if (!alive()) return;
      const value = await work(c.signal);
      if (alive()) publish(value);
    } catch {
      if (alive()) setFailed(true);
    } finally {
      if (id === runtime.current.serial && runtime.current.controller === c) {
        runtime.current.controller = null;
        if (runtime.current.mounted && runtime.current.active) setBusy(false);
      }
    }
  }
  async function upload(side: 0 | 1 | 2, f: File) {
    cancelPending();
    if (!f.size || f.size > MAX_FILE_BYTES || !/\.(csv|xlsx)$/i.test(f.name)) {
      setFailed(true);
      return;
    }
    const next = structuredClone(files),
      rs = structuredClone(readings);
    invalidate();
    await perform(
      (signal) =>
        f
          .arrayBuffer()
          .then((buffer) =>
            workerTask<SourceFile>('read', { name: f.name, buffer }, signal),
          ),
      (source) => {
        next[side] = source;
        rs[side] = { ...allocationDemoReadings[side], confirmed: false };
        setFiles(next);
        setReadings(rs);
      },
    );
  }
  async function decide(links: AllocationLink[], target?: string) {
    if (!result) return;
    const owned = structuredClone(input());
    const e: AllocationEvent = target
      ? {
          id: `U${owned.events.length + 1}`,
          type: 'undo',
          context: result.context,
          at: new Date().toISOString(),
          note: reason.trim(),
          target,
        }
      : {
          id: `D${owned.events.length + 1}`,
          type: 'allocate',
          context: result.context,
          at: new Date().toISOString(),
          note: reason.trim(),
          links: structuredClone(links),
        };
    owned.events.push(e);
    await perform(
      (signal) =>
        workerTask<{ state: AllocationInput; result: AllocationResult }>(
          'allocation-reconcile',
          owned,
          signal,
        ),
      install,
    );
  }
  function readLedger() {
    const owned = structuredClone(input());
    return perform(
      (signal) =>
        workerTask<{ state: AllocationInput; result: AllocationResult }>(
          'allocation-reconcile',
          owned,
          signal,
        ),
      install,
    );
  }
  function openDemo() {
    const requests = structuredClone(allocationDemo());
    const ownedReadings = structuredClone(allocationDemoReadings),
      ownedScope = structuredClone(allocationDemoScope);
    invalidate();
    return perform(async (signal) => {
      const nativeFiles: SourceFile[] = [];
      for (const request of requests)
        nativeFiles.push(await workerTask('read', request, signal));
      return workerTask<{ state: AllocationInput; result: AllocationResult }>(
        'allocation-reconcile',
        {
          files: nativeFiles,
          readings: ownedReadings,
          scope: ownedScope,
          events: [],
        },
        signal,
      );
    }, install);
  }
  function restoreSession(f: File) {
    invalidate();
    return perform(async (signal) => {
      if (f.size > 48 * 1024 * 1024) throw Error('SESSION');
      const buffer = await f.arrayBuffer();
      return workerTask<{ state: AllocationInput; result: AllocationResult }>(
        'allocation-restore',
        { buffer },
        signal,
      );
    }, install);
  }
  function saveSession() {
    const owned = structuredClone(input());
    return perform(
      (signal) => workerTask<ArrayBuffer>('allocation-save', owned, signal),
      (buffer) =>
        download(buffer, 'tarasuf-allocation-session.json', 'application/json'),
    );
  }
  function exportWorkpaper() {
    if (!result) return;
    const owned = structuredClone({ state: input(), result });
    return perform(
      (signal) => workerTask<ArrayBuffer>('allocation-export', owned, signal),
      (buffer) =>
        download(
          buffer,
          'tarasuf-allocation.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
    );
  }
  function download(buffer: ArrayBuffer, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([buffer], { type })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!active) return null;
  const fmt = (v: number) => money(v, result!.decimals),
    balances = new Map(result?.balances.map((b) => [b.id, b])),
    usedProofs = new Set(
      result?.links
        .filter((l) => l.basis.kind === 'remittance')
        .map((l) => l.basis.proofId),
    ),
    slice = <T,>(v: T[]) => v.slice(page * 50, page * 50 + 50);
  return (
    <main
      className="app-shell gl-tb-workspace reconciliation-workspace"
      data-allocation-workspace
      aria-busy={busy}
    >
      <WorkspaceHeader
        backLabel={t.backToSuppliers}
        onBack={() => {
          cancelPending();
          onBack();
        }}
      >
        {busy && (
          <Button variant="outline" onClick={cancelPending}>
            {h.cancel}
          </Button>
        )}
      </WorkspaceHeader>
      <WorkspaceIntro title={t.paymentAllocation} intro={t.intro}>
        <p>{t.limits}</p>
      </WorkspaceIntro>
      {handoff && (
        <section
          className="panel stack"
          data-testid="allocation-workflow-handoff"
          aria-label={h.title}
        >
          <h2>{h.title}</h2>
          <p>{h.intro}</p>
          <p>{h.nextStep}</p>
          <ul style={{ paddingInlineStart: 20, overflowWrap: 'anywhere' }}>
            {handoff.sourceReferences.map((source, index) => (
              <li key={`${source.sha256}:${index}`}>
                <bdi>{source.name}</bdi> · <code>{source.sha256}</code>
              </li>
            ))}
          </ul>
          <p>{h.provenance}</p>
        </section>
      )}
      <fieldset disabled={busy}>
        <div className="gl-tb-actions workspace-toolbar">
          <Button onClick={() => void openDemo()}>
            {t.openSyntheticAllocationExample}
          </Button>
          <label>
            {t.restoreAllocationSession}
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void restoreSession(f);
              }}
            />
          </label>
        </div>
        <WorkspaceGroupTitle kind="sources" />
        <div className="gl-tb-grid workspace-sources">
          {([0, 1, 2] as const).map((side) => (
            <section
              className="workspace-source"
              key={side}
              data-testid={`allocation-source-${side}`}
            >
              <h2>
                <WorkspaceSourceHeading>{sides[side]}</WorkspaceSourceHeading>
              </h2>
              <label>
                {sides[side]}
                <WorkspaceFileInput
                  aria-label={sides[side]}
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void upload(side, f);
                  }}
                />
              </label>
              {files[side] && (
                <>
                  <h3>{files[side]!.name}</h3>
                  <label>
                    {sides[side]}: {t.sheet}
                    <select
                      value={readings[side].sheet}
                      onChange={(e) => {
                        const rs = [...readings] as typeof readings;
                        rs[side] = {
                          ...rs[side],
                          sheet: Number(e.target.value),
                          confirmed: false,
                        };
                        setReadings(rs);
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
                      onChange={(e) => {
                        const rs = [...readings] as typeof readings;
                        rs[side] = { ...rs[side], confirmed: e.target.checked };
                        setReadings(rs);
                        invalidate();
                      }}
                    />
                    {sides[side]}: {t.sourceConfirm}
                  </label>
                </>
              )}
            </section>
          ))}
        </div>
        <section className="workspace-scope">
          <WorkspaceGroupTitle kind="scope" />
          <div className="gl-tb-grid">
            {ALLOCATION_SCOPE_FIELDS.map((key, i) => (
              <label key={key}>
                {labels[i]}
                <input
                  type={key === 'cutoff' ? 'date' : 'text'}
                  readOnly={key === 'basis'}
                  value={scope[key]}
                  onChange={(e) => {
                    setScope({
                      ...scope,
                      [key]: e.target.value,
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
            {t.scopeConfirm}
          </label>
        </section>
        <Button
          disabled={
            !files.every(Boolean) ||
            !readings.every((r) => r.confirmed) ||
            !scope.confirmed
          }
          onClick={() => void readLedger()}
        >
          {t.readValueLedger}
        </Button>
      </fieldset>
      {failed && <p role="alert">{t.failure}</p>}
      {result && (
        <section data-testid="allocation-result">
          <h2>{t.valueLedger}</h2>
          <DomainEvidenceAssistant
            result={result}
            snapshot={() => ({ domain: 'allocation', input: input(), result })}
            busy={busy}
          />
          <p data-testid="allocation-status">
            {result.status === 'ready' ? t.ready : t.sourceError}
          </p>
          <div className="gl-tb-actions">
            <Button disabled={busy} onClick={() => void saveSession()}>
              {t.saveAllocationSession}
            </Button>
            <Button disabled={busy} onClick={() => void exportWorkpaper()}>
              {t.downloadAllocationWorkpaper}
            </Button>
          </div>
          <div className="gl-tb-table">
            <table data-testid="allocation-ledger">
              <thead>
                <tr>
                  {[
                    t.side,
                    t.ownReference,
                    t.original,
                    t.available,
                    t.allocated,
                    t.remaining,
                    t.cellEvidence,
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice(result.items).map((i) => {
                  const b = balances.get(i.id)!;
                  return (
                    <tr key={i.id}>
                      <td>{sides[i.side]}</td>
                      <th>{i.reference}</th>
                      {[b.original, b.available, b.allocated, b.remaining].map(
                        (n, k) => (
                          <td key={k}>{fmt(n)}</td>
                        ),
                      )}
                      <td>
                        <details>
                          <summary>
                            {result.sources[i.side].name} · {i.row}
                          </summary>
                          {i.traces.map((x) => (
                            <p key={x.field}>
                              {x.field}: {x.text} · {x.column}
                            </p>
                          ))}
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <fieldset disabled={busy || result.status !== 'ready'}>
            <label>
              {t.decisionOrUndoReason}
              <input
                value={reason}
                onChange={(e) => editReview(() => setReason(e.target.value))}
              />
            </label>
            <h3>{t.adviceLinesForReview}</h3>
            {slice(result.proofs).map((p) => (
              <label key={p.id} data-testid="allocation-proof">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  disabled={
                    usedProofs.has(p.id) ||
                    (!selected.includes(p.id) && selected.length >= 100)
                  }
                  onChange={(e) =>
                    editReview(() =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      ),
                    )
                  }
                />
                {p.reference}: {p.payment} → {p.invoice}: {fmt(p.amount)}
                {usedProofs.has(p.id) ? t.used : ''}
              </label>
            ))}
            <Button
              disabled={!selected.length || !reason.trim()}
              onClick={() =>
                decide(
                  selected.map((id) => {
                    const p = result.proofs.find((p) => p.id === id)!;
                    return {
                      paymentId: result.items.find(
                        (i) => i.side === 0 && i.reference === p.payment,
                      )!.id,
                      invoiceId: result.items.find(
                        (i) => i.side === 1 && i.reference === p.invoice,
                      )!.id,
                      amount: p.amount,
                      basis: {
                        kind: 'remittance',
                        reference: p.reference,
                        reason: reason.trim(),
                        proofId: p.id,
                      },
                    };
                  }),
                )
              }
            >
              {t.approveAdvice}
            </Button>
            <h3>{t.documentedHumanAllocation}</h3>
            <label>
              {t.decisionBasis}
              <select
                value={basis}
                onChange={(e) =>
                  editReview(() => setBasis(e.target.value as typeof basis))
                }
              >
                <option value="accountant-review">{t.accountantReview}</option>
                <option value="external-confirmation">
                  {t.externalConfirmation}
                </option>
              </select>
            </label>
            <label>
              {t.humanEvidenceReference}
              <input
                value={reference}
                onChange={(e) => editReview(() => setReference(e.target.value))}
              />
            </label>
            {drafts.map((d, index) => (
              <div
                className="gl-tb-grid"
                key={index}
                data-testid="allocation-draft"
              >
                {(['paymentId', 'invoiceId'] as const).map((key, side) => (
                  <label key={key}>
                    {sides[side]}
                    <select
                      aria-label={sides[side]}
                      value={d[key]}
                      onChange={(e) =>
                        editReview(() =>
                          setDrafts(
                            drafts.map((v, j) =>
                              j === index ? { ...v, [key]: e.target.value } : v,
                            ),
                          ),
                        )
                      }
                    >
                      <option value="">{t.choose}</option>
                      {result.items
                        .filter((i) => i.side === side)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.reference}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <label>
                  {t.allocationAmount}
                  <input
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) =>
                      editReview(() =>
                        setDrafts(
                          drafts.map((v, j) =>
                            j === index ? { ...v, amount: e.target.value } : v,
                          ),
                        ),
                      )
                    }
                  />
                </label>
                {drafts.length > 1 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      editReview(() =>
                        setDrafts(drafts.filter((_, j) => j !== index)),
                      )
                    }
                  >
                    {t.removeLink}
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              disabled={drafts.length >= 100}
              onClick={() =>
                editReview(() =>
                  setDrafts([
                    ...drafts,
                    { paymentId: '', invoiceId: '', amount: '' },
                  ]),
                )
              }
            >
              {t.addAllocationLink}
            </Button>
            <Button
              disabled={
                !reason.trim() ||
                !reference.trim() ||
                drafts.some(
                  (d) => !d.paymentId || !d.invoiceId || !d.amount.trim(),
                )
              }
              onClick={() => {
                try {
                  const links = drafts.map((d) => {
                    if (!/^\d+(?:\.\d+)?$/.test(d.amount.trim()))
                      throw Error('AMOUNT');
                    const amount = parseMoney(
                      d.amount.trim(),
                      'dot',
                      result.decimals,
                    );
                    if (amount === undefined) throw Error('AMOUNT');
                    return {
                      paymentId: d.paymentId,
                      invoiceId: d.invoiceId,
                      amount,
                      basis: {
                        kind: basis,
                        reference: reference.trim(),
                        reason: reason.trim(),
                        proofId: '',
                      },
                    };
                  });
                  void decide(links);
                } catch {
                  setFailed(true);
                }
              }}
            >
              {t.approveHuman}
            </Button>
            <h3>{t.datedDecisions}</h3>
            {result.events.map((e) => (
              <div key={e.id} data-testid="allocation-event">
                <p>
                  {e.id} · {t.eventTypes[e.type]} · {e.at} · {e.note}
                  {e.type === 'undo' ? ` → ${e.target}` : ''}
                </p>
                {e.type === 'allocate' &&
                  result.activeDecisions.includes(e.id) && (
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() => decide([], e.id)}
                    >
                      {t.undoDecision} {e.id}
                    </Button>
                  )}
              </div>
            ))}
          </fieldset>
          <h3>{t.activeAllocations}</h3>
          {slice(result.links).map((l) => (
            <p key={l.id}>
              {result.items.find((i) => i.id === l.paymentId)!.reference} →{' '}
              {result.items.find((i) => i.id === l.invoiceId)!.reference}:{' '}
              {fmt(l.amount)} · {t.basisTypes[l.basis.kind]} ·{' '}
              {l.basis.reference} · {l.basis.reason}
            </p>
          ))}
          <details>
            <summary>{t.inventoryOfEverySourceRow}</summary>
            {slice(result.inventory).map((i) => (
              <p key={`${i.side}:${i.row}`}>
                {sides[i.side]} · {i.row} · {i.kind} · {i.error ?? ''} ·{' '}
                {i.values.join(' | ')}
              </p>
            ))}
          </details>
          <div className="gl-tb-actions">
            <Button disabled={busy || !page} onClick={() => setPage(page - 1)}>
              {t.previous}
            </Button>
            <span>{page + 1}</span>
            <Button
              disabled={
                busy ||
                (page + 1) * 50 >=
                  Math.max(
                    result.items.length,
                    result.proofs.length,
                    result.inventory.length,
                    result.links.length,
                  )
              }
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
