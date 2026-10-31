import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { BankAdjustmentWorkspace } from './bank-adjustment-workspace';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { RecordRows } from '@/components/record-table';
import { Button } from '@/components/ui/button';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
} from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { bankStatementCopy } from '@/lib/i18n/bank-statement';
import { bankSessionFormat } from '@/lib/reconciliation/bank-statement-view';
import {
  BankStatementResults,
  BankStatementSources,
  useBankStatement,
} from './bank-statement-workspace';
import { workspaceCopy } from '@/lib/i18n/workspace';
import { pageOfRow } from '@/lib/record-page';
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import { money } from '@/lib/reconciliation/core';
import {
  BANK_SCOPE_FIELDS,
  BANK_VERSION,
  BANK_WD_FAMILY,
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
import './workspace-record.css';
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
  const { t: catalogue, lang } = useI18n(),
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
    [balanceHasWork, setBalanceHasWork] = useState(false),
    [failed, setFailed] = useState<'general' | 'native-display' | null>(null),
    [pages, setPages] = useState<Record<string, number>>({}),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [bankId, setBankId] = useState(''),
    [cashId, setCashId] = useState(''),
    [evidenceId, setEvidenceId] = useState('');
  // The bank source type: movement files in the settlement template, or a
  // statement as the bank issues it. Each keeps its own work while the other
  // is shown.
  const [mode, setMode] = useState<'movements' | 'statement'>('movements'),
    statement = useBankStatement(),
    sourceMode = useId(),
    s = bankStatementCopy[lang];
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
    },
    [],
  );
  const decisionHint = useId();
  // Opening a movement's evidence takes the reader to it, and returning takes
  // them back to that movement's row, after the render that shows either.
  const evidenceHeading = useRef<HTMLHeadingElement>(null),
    [focusRequest, setFocusRequest] = useState<{
      to: 'evidence' | 'row';
      id: string;
    } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const element =
      focusRequest.to === 'evidence'
        ? evidenceHeading.current
        : document.querySelector<HTMLElement>(
            `[data-bank-evidence-for="${CSS.escape(focusRequest.id)}"]`,
          );
    element?.scrollIntoView({
      block: focusRequest.to === 'evidence' ? 'start' : 'center',
    });
    element?.focus({ preventScroll: true });
  }, [focusRequest]);
  function invalidate() {
    setResult(null);
    setEvents([]);
    setFailed(null);
    setPages({});
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
    setPages({});
    setBankId('');
    setCashId('');
    setEvidenceId('');
    setReference('');
    setNote('');
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current = control;
    setBusy(true);
    setFailed(null);
    try {
      await prepareWorker();
      if (!control.signal.aborted) await work(control.signal);
    } catch (error) {
      if (id === serial.current && !control.signal.aborted)
        setFailed(
          error instanceof Error && error.message === 'BANK_NATIVE_DISPLAY'
            ? 'native-display'
            : 'general',
        );
    } finally {
      if (id === serial.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function upload(side: 0 | 1, blob: File) {
    if (blob.size > MAX_FILE_BYTES || !/\.(csv|xlsx)$/i.test(blob.name)) {
      setFailed('general');
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
  // Each table pages on its own through the record kit (UX-3), as the
  // printed statement tables do, so turning one table's page leaves the
  // others where they are. The pages are held here, so that the evidence can
  // return the reader to its movement's page.
  function table<T>(
    name: string,
    title: string,
    headers: string[],
    data: T[],
    cells: (r: T) => ReactNode[],
  ) {
    return (
      <section className="bank-movement-table" data-bank-movement-table={name}>
        <h2>{title}</h2>
        <RecordRows
          label={title}
          headers={headers}
          rows={data}
          cells={cells}
          page={pages[name] ?? 0}
          onPage={(to) => setPages((p) => ({ ...p, [name]: to }))}
        />
      </section>
    );
  }
  const missingIds = new Set(
    result?.cases
      .filter((g) => g.kind === 'missing')
      .flatMap((g) => [...g.bankIds, ...g.cashIds]),
  );
  const format = (n: number) => money(n, result?.decimals ?? 2),
    // Amounts and identities keep their own direction and never wrap: the
    // tables scroll inside their frame instead (bank-workspace.css).
    amount = (n: number) => (
      <bdi dir="ltr" className="bank-movement-amount">
        {format(n)}
      </bdi>
    ),
    id = (text: string) => <bdi className="bank-movement-id">{text}</bdi>,
    date = (text: string) => (
      <bdi dir="ltr" className="bank-movement-date">
        {text}
      </bdi>
    ),
    byId = new Map(result?.records.map((r) => [r.id, r])),
    memberNames = (ids: string[]) =>
      ids.map((id) => byId.get(id)?.reference ?? id).join(' · '),
    members = (ids: string[]) =>
      ids.flatMap((member, i) => [
        i ? ' · ' : '',
        <bdi key={member} className="bank-movement-id">
          {byId.get(member)?.reference ?? member}
        </bdi>,
      ]),
    evidence = byId.get(evidenceId),
    canDecide =
      !!result &&
      result.status !== 'source-error' &&
      !!reference.trim() &&
      !!note.trim(),
    // Why the decisions are closed, or when each one opens: the same
    // conditions as canDecide and each button, in the reader's words.
    hint: keyof typeof t.decisionHint =
      result?.status === 'source-error'
        ? 'sourceError'
        : !reference.trim() && !note.trim()
          ? 'both'
          : !reference.trim()
            ? 'reference'
            : !note.trim()
              ? 'reason'
              : 'ready';
  function openEvidence(record: string) {
    setEvidenceId(record);
    setFocusRequest({ to: 'evidence', id: record });
  }
  function backToMovement() {
    const index = result?.records.findIndex((r) => r.id === evidenceId) ?? -1;
    if (index < 0) return;
    setPages((p) => ({ ...p, movements: pageOfRow(index) }));
    setFocusRequest({ to: 'row', id: evidenceId });
  }
  const locked = busy || balanceBusy || statement.busy;
  return (
    <>
      {active && (
        <main
          className="app-shell gl-tb-workspace bank-workspace reconciliation-workspace"
          aria-busy={locked}
        >
          <WorkspaceHeader
            onBack={onBack}
            backLabel={t.back}
            disabled={locked}
            hasWork={files.some(Boolean) || balanceHasWork || statement.hasWork}
          />
          <WorkspaceIntro title={t.title} intro={t.intro}>
            <p>{t.limits}</p>
            <p>{t.claim}</p>
          </WorkspaceIntro>
          <fieldset disabled={locked}>
            <WorkspaceAdvanced>
              <div className="gl-tb-actions workspace-toolbar">
                <Button
                  hidden={mode !== 'movements'}
                  onClick={() =>
                    perform(async (signal) => {
                      const sources: SourceFile[] = [];
                      for (const demo of bankDemo())
                        sources.push(await workerTask('read', demo, signal));
                      shown(
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
                        setFailed('general');
                        return;
                      }
                      // The declared format alone routes a session; each
                      // path then checks every byte it restores.
                      void blob.arrayBuffer().then((buffer) => {
                        if (bankSessionFormat(buffer) === 'statement') {
                          setMode('statement');
                          return statement.restore(buffer);
                        }
                        setMode('movements');
                        return perform(async (signal) =>
                          shown(
                            await workerTask(
                              'bank-restore',
                              { buffer },
                              signal,
                            ),
                          ),
                        );
                      });
                    }}
                  />
                </label>
              </div>
            </WorkspaceAdvanced>
            <fieldset className="bank-source-mode" data-bank-source-mode>
              <legend>{s.modeTitle}</legend>
              {(['movements', 'statement'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={sourceMode}
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <strong>{s.modes[value]}</strong>
                  <small>{s.modeHints[value]}</small>
                </label>
              ))}
            </fieldset>
            {mode === 'statement' ? (
              <BankStatementSources s={statement} />
            ) : (
              <>
                <WorkspaceGroupTitle kind="sources" />
                <WorkspaceSources
                  primaryIndices={[0, 1]}
                  primaryReady={!!(files[0] && files[1])}
                >
                  {([0, 1] as const).map((side) => (
                    <section
                      className="workspace-source"
                      key={side}
                      data-testid={`bank-source-${side}`}
                    >
                      <h2>
                        <WorkspaceSourceHeading>
                          {t.sides[side]}
                        </WorkspaceSourceHeading>
                      </h2>
                      <WorkspaceFileInput
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
                            {t.sourceFamily}
                            <select
                              aria-label={`${t.sides[side]} ${t.sourceFamily}`}
                              value={readings[side].family}
                              onChange={(e) => {
                                setReadings((previous) => {
                                  const next = [...previous] as typeof readings;
                                  next[side] = {
                                    ...next[side],
                                    family: e.target
                                      .value as BankReading['family'],
                                    confirmed: false,
                                  };
                                  return next;
                                });
                                invalidate();
                              }}
                            >
                              <option value={BANK_VERSION}>
                                {t.amountDirection}
                              </option>
                              <option value={BANK_WD_FAMILY}>
                                {t.withdrawalDeposit}
                              </option>
                            </select>
                          </label>
                          {readings[side].family === BANK_WD_FAMILY && (
                            <p className="bank-source-basis">
                              {t.withdrawalDepositHint}
                            </p>
                          )}
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
                </WorkspaceSources>
                <section
                  className="workspace-scope"
                  hidden={!(files[0] && files[1])}
                >
                  <WorkspaceGroupTitle kind="scope" />
                  <div className="gl-tb-grid">
                    {BANK_SCOPE_FIELDS.map((key) => (
                      <label key={key}>
                        {t.fields[key]}
                        <input
                          aria-label={t.fields[key]}
                          type={
                            key === 'start' || key === 'end' ? 'date' : 'text'
                          }
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
                </section>
                <Button
                  disabled={
                    !files.every(Boolean) ||
                    !readings.every((r) => r.confirmed) ||
                    !scope.confirmed
                  }
                  onClick={() =>
                    perform(async (signal) =>
                      shown(
                        await workerTask('bank-reconcile', input(), signal),
                      ),
                    )
                  }
                >
                  {t.compare}
                </Button>
              </>
            )}
          </fieldset>
          {mode === 'statement' && (
            <BankStatementResults s={statement} locked={locked} />
          )}
          {mode === 'movements' && busy && (
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
          {mode === 'movements' && failed && (
            <p role="alert">
              {failed === 'native-display' ? t.displayFailed : t.failed}
            </p>
          )}
          {mode === 'movements' && result && (
            <>
              <h2
                data-testid="bank-result"
                ref={resultHeading}
                tabIndex={-1}
                data-result-heading="result"
              >
                {t.status[result.status]}
              </h2>
              <DomainEvidenceAssistant
                result={result}
                snapshot={() => ({ domain: 'bank', input: input(), result })}
                busy={locked}
              />
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
                    aria-describedby={decisionHint}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  {t.reason}
                  <textarea
                    aria-label={t.reason}
                    aria-describedby={decisionHint}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p
                  id={decisionHint}
                  className="bank-source-basis"
                  data-bank-decision-hint={hint}
                >
                  {t.decisionHint[hint]}
                </p>
                {table(
                  'cases',
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
                    t.caseState,
                    t.approve,
                    t.undo,
                  ],
                  result.cases,
                  (g) => [
                    g.kind === 'reference' ? id(g.key) : t.caseKinds[g.kind],
                    t.caseKinds[g.kind],
                    g.policy ? t.policies[g.policy] : '',
                    amount(g.bankMinor),
                    amount(g.cashMinor),
                    amount(g.deltaMinor),
                    <span key="members">
                      {t.sides[0]}: {members(g.bankIds)}; {t.sides[1]}:{' '}
                      {members(g.cashIds)}
                    </span>,
                    g.eligible ? t.yes : t.no,
                    t.reasons[g.reason],
                    t.caseStatus[g.status],
                    <Button
                      key="approve"
                      aria-describedby={decisionHint}
                      disabled={
                        !canDecide || !g.eligible || g.status !== 'needs-review'
                      }
                      onClick={() => decide('accept', g.bankIds, g.cashIds)}
                    >
                      {t.approve}
                    </Button>,
                    <Button
                      key="undo"
                      variant="outline"
                      aria-describedby={decisionHint}
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
                    aria-describedby={decisionHint}
                    disabled={!canDecide || !bankId || !cashId}
                    onClick={() => decide('accept', [bankId], [cashId])}
                  >
                    {t.approveManual}
                  </Button>
                </section>
                {table(
                  'movements',
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
                    id(r.reference),
                    r.settlement && id(r.settlement),
                    date(r.movementDate),
                    date(r.valueDate),
                    t.directions[r.direction],
                    t.roles[r.role],
                    r.parent && id(r.parent),
                    r.reverses && id(r.reverses),
                    amount(r.signed),
                    <Button
                      key="evidence"
                      variant="outline"
                      data-bank-evidence-for={r.id}
                      onClick={() => openEvidence(r.id)}
                    >
                      {t.reviewCells}
                    </Button>,
                  ],
                )}
                {evidence && (
                  <section className="bank-movement-evidence">
                    <h2 ref={evidenceHeading} tabIndex={-1}>
                      {t.evidence} · {t.sides[evidence.side]} ·{' '}
                      {evidence.reference} · {t.row} {evidence.row}
                    </h2>
                    <Button variant="outline" onClick={backToMovement}>
                      {t.backToMovement}
                    </Button>
                    <RecordRows
                      label={`${t.evidence} · ${evidence.reference}`}
                      headers={[
                        t.field,
                        t.column,
                        t.original,
                        ...(evidence.withdrawalDeposit
                          ? [t.cashCellState]
                          : []),
                      ]}
                      rows={evidence.traces}
                      cells={(c) => [
                        t.sourceFields[c.field as keyof typeof t.sourceFields],
                        c.column,
                        c.text,
                        ...(evidence.withdrawalDeposit
                          ? [
                              c.field === 'Withdrawal' || c.field === 'Deposit'
                                ? t.cashCellStates[
                                    evidence.withdrawalDeposit[
                                      c.field === 'Withdrawal'
                                        ? 'withdrawal'
                                        : 'deposit'
                                    ].state
                                  ]
                                : '',
                            ]
                          : []),
                      ]}
                    />
                  </section>
                )}
                <p>{t.retainedTiming}</p>
                {table(
                  'timing',
                  t.timing,
                  [t.side, t.row, t.own, t.date, t.valueDate, t.validMovement],
                  result.timingItems,
                  (r) => [
                    t.sides[r.side],
                    r.row,
                    id(r.reference),
                    date(r.movementDate),
                    date(r.valueDate),
                    r.validMovement ? t.yes : t.no,
                  ],
                )}
                {table(
                  'events',
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
                    date(e.at),
                    e.reference,
                    e.note,
                    `${memberNames(e.bankIds)} · ${memberNames(e.cashIds)}`,
                  ],
                )}
                {table(
                  'inventory',
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
              </fieldset>
            </>
          )}
        </main>
      )}
      <div
        className="app-shell gl-tb-workspace bank-workspace reconciliation-workspace workspace-bank-continuation"
        hidden={!active || mode !== 'movements'}
        style={{
          display: active && mode === 'movements' ? undefined : 'none',
        }}
      >
        <details className="workspace-bank-balance-flow" data-bank-balance-flow>
          <summary>{workspaceCopy[lang].bankBalanceFlow}</summary>
          <BankAdjustmentWorkspace
            bank={result ? input() : null}
            disabled={busy}
            onBusy={setBalanceBusy}
            onWorkChange={setBalanceHasWork}
            onRestoreBank={install}
          />
        </details>
      </div>
    </>
  );
}
