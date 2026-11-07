import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount } from '@/components/amount';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import {
  EvidenceSections,
  type EvidenceSection,
} from '@/components/evidence-sections';
import { payrollStrip } from '@/lib/alignment-strip';
import {
  RecordFields,
  RecordTable,
  identityFields,
} from '@/components/record-table';
import { Button } from '@/components/ui/button';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
  WorkspaceStart,
} from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import {
  PAYROLL_VERSION,
  PAYROLL_ROLES,
  PAYROLL_FIELDS,
  PAYROLL_SCOPE_HEADERS,
  PAYROLL_COMPONENTS,
  PAYROLL_AMOUNT_KEYS,
  type PayrollInput,
  type PayrollScope,
  type PayrollResult,
  type PayrollEvent,
} from '@/lib/reconciliation/payroll';
import {
  payrollDemo,
  payrollDemoScope,
} from '@/lib/reconciliation/payroll-demo';
import { payrollCopy } from '@/lib/i18n/payroll';
import { PayrollLongRegisterPanel } from '@/components/payroll-long-register-panel';
import { ScopeCard, Sentence } from '@/components/scope-card';
import { scopeCardCopy } from '@/lib/i18n/scope-card';
import { useDeclaredScope } from '@/hooks/use-declared-scope';
import type {
  DeclaredScopeRule,
  ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import './workspace-record.css';
import {
  DecisionButtons,
  DecisionHint,
  useDecisionFocus,
} from './decision-platform';
import type { DecisionInput } from '@/lib/decision-platform';
const emptyScope = (): PayrollScope =>
  ({
    ...Object.fromEntries(PAYROLL_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    postingStatus: 'posted',
    confirmed: false,
  }) as PayrollScope;
type PayrollField = (typeof PAYROLL_FIELDS)[number];
// What the card may put in each field (UX-5(d)): the two one-option selects
// take only the value the engine accepts, and start from it while no file
// has the column; the four dates take only YYYY-MM-DD.
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
} as const;
const oneOption = (k: PayrollField): k is keyof typeof ONLY => k in ONLY;
const DATES: readonly PayrollField[] = [
  'periodStart',
  'periodEnd',
  'payrollPostingDate',
  'paymentDate',
];
const isDate = (k: PayrollField) => DATES.includes(k);
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const scopeRules: DeclaredScopeRule<PayrollField>[] = PAYROLL_FIELDS.map(
  (field) =>
    oneOption(field)
      ? {
          field,
          fallback: ONLY[field],
          accepts: (v) => v === ONLY[field],
          fixed: true,
        }
      : isDate(field)
        ? { field, accepts: isoDate }
        : { field },
);
// The five originals write the nineteen scope columns on every row, as the
// engine's row check reads them.
const scopeColumns = PAYROLL_FIELDS.map((field, i) => ({
  field,
  header: PAYROLL_SCOPE_HEADERS[i],
}));
const freshOrigins = () =>
  Object.fromEntries(
    scopeRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<PayrollField, ScopeOrigin>;
const readings = () =>
  PAYROLL_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: PAYROLL_VERSION,
    confirmed: false,
  })) as PayrollInput['readings'];
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PayrollWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { lang } = useI18n();
  const copy = payrollCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings);
  // The card's scope and where each value came from (UX-5(d)): a new file
  // fills what the five files agree on into the fields the accountant has
  // not entered, and a value it changes drops the confirmation.
  const card = useDeclaredScope({
    initial: () => ({ scope: emptyScope(), origins: freshOrigins() }),
    rules: scopeRules,
    columns: scopeColumns,
    files,
    sheets: reading.map((r) => r.sheet),
    labels: copy.roles,
  });
  const { scope, origins, suggestions } = card;
  const [complete, setComplete] = useState<PayrollInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<PayrollEvent[]>([]),
    [result, setResult] = useState<PayrollResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  function cancel() {
    runtime.current.serial++;
    runtime.current.controller?.abort();
    runtime.current.running = false;
    setBusy(false);
  }
  useEffect(() => {
    const live = runtime.current;
    return () => {
      live.serial++;
      live.controller?.abort();
    };
  }, []);
  function invalidate() {
    setResult(null);
    setEvents([]);
    setError('');
  }
  function state(): PayrollInput {
    return {
      files: files as PayrollInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: { state: PayrollInput; result: PayrollResult }) {
    setFiles(v.state.files);
    setReading(v.state.readings);
    card.install(
      v.state.scope,
      v.state.files,
      v.state.readings.map((r) => r.sheet),
    );
    setComplete(v.state.completeness);
    setEvents(v.state.events);
    setResult(v.result);
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const resultParts = useResultParts([
    'summary',
    'explain',
    'figures',
    'decision',
    'evidence',
  ]);
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
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
      if (id === runtime.current.serial && !control.signal.aborted) {
        apply(value);
        return value;
      }
    } catch (e) {
      if (id === runtime.current.serial && !control.signal.aborted)
        setError(e instanceof Error ? e.message : '');
    } finally {
      if (id === runtime.current.serial) {
        runtime.current.running = false;
        setBusy(false);
      }
    }
  }
  const ready =
    files.every(Boolean) &&
    reading.every((r) => r.confirmed) &&
    scope.confirmed &&
    PAYROLL_FIELDS.every((k) => scope[k]);
  function updateScope(key: PayrollField, value: string) {
    card.edit(key, value);
    invalidate();
  }
  const unknown = scopeCardCopy[lang].unknown;
  // A value inside a sentence, isolated so mixed scripts keep their order;
  // a date, a code or a ledger is never split across lines.
  const scopeValue = (v: string, whole = false) => (
    <bdi className={whole ? 'scope-card__whole' : undefined}>
      {v || unknown}
    </bdi>
  );
  const rowsRead = Math.max(
    0,
    ...PAYROLL_FIELDS.map((k) =>
      suggestions[k].read.reduce((n, r) => n + r.rows, 0),
    ),
  );
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('PAYROLL_SOURCE');
        return workerTask<SourceFile>(
          'payroll-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as PayrollInput['readings'];
        r[source] = { ...r[source], confirmed: false };
        setReading(r);
        setComplete({ ...complete, confirmed: false });
        invalidate();
      },
    );
  }
  async function demo() {
    await perform(async (signal) => {
      const f: SourceFile[] = [];
      for (let i = 0; i < 5; i++)
        f.push(
          await workerTask<SourceFile>(
            'payroll-read',
            {
              name: `source-${i}.csv`,
              buffer: new TextEncoder().encode(payrollDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: PayrollInput = {
        files: f as PayrollInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as PayrollInput['readings'],
        scope: { ...payrollDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: copy.syntheticRef,
          note: copy.syntheticNote,
        },
        events: [],
      };
      return workerTask<{
        state: PayrollInput;
        result: PayrollResult;
      }>('payroll-reconcile', s, signal);
    }, shown);
  }
  // The decision platform (UX-3): after a decision the focus returns to the
  // line that holds the state, not to the page.
  const hint = useId(),
    decisionState = useId(),
    settle = useDecisionFocus();
  const decided: typeof install = (v) => {
    install(v);
    settle(decisionState);
  };
  async function decide(type: PayrollEvent['type']) {
    if (!result) return;
    const e: PayrollEvent = {
      id: crypto.randomUUID(),
      type,
      memberIds: [...result.memberIds],
      context: result.context,
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: PayrollInput; result: PayrollResult }>(
          'payroll-reconcile',
          { ...state(), events: [...events, e] },
          signal,
        ),
      decided,
    );
  }
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  // What the decision buttons open on, as before: approval also needs the
  // completeness confirmation and a ready result, and the sentence under the
  // buttons says which of these is missing.
  const decision: DecisionInput | null = result
    ? {
        reference,
        reason: note,
        members: result.memberIds.length,
        review: result.review,
        acceptBlock: !complete.confirmed
          ? 'unconfirmed'
          : result.issues.length
            ? 'source-error'
            : result.missing.length
              ? 'missing'
              : result.financial === 'ready'
                ? null
                : result.financial,
      }
    : null;
  const amount = (minor: number | null | undefined) => (
    <Amount minor={minor} decimals={result?.decimals ?? 2} />
  );
  const detail = (
    title: string,
    headers: string[],
    rows: (ReactNode | null)[][],
    fingerprint?: string,
    wrap?: readonly number[],
    hook?: Record<`data-${string}`, string>,
  ) => (
    <WorkspaceAdvanced
      hook={hook}
      summary={
        <>
          {title} ({rows.length})
        </>
      }
    >
      {fingerprint && (
        <p>
          <bdi>{fingerprint}</bdi>
        </p>
      )}
      <RecordTable source={title} headers={headers} rows={rows} wrap={wrap} />
    </WorkspaceAdvanced>
  );
  // An evidence section of the result: drawn as above when it holds
  // something, named on the line of empty sections when it does not (UX-4).
  const section = (
    key: string,
    title: string,
    headers: string[],
    rows: (ReactNode | null)[][],
    fingerprint?: string,
    wrap?: readonly number[],
  ): EvidenceSection => ({
    key,
    name: title,
    count: rows.length,
    node: detail(title, headers, rows, fingerprint, wrap, {
      'data-evidence-section': key,
    }),
  });
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-payroll-workspace
        aria-busy={busy}
      >
        <WorkspaceHeader
          onBack={onBack}
          backLabel={copy.back}
          disabled={busy}
          hasWork={files.some(Boolean)}
        />
        <WorkspaceIntro
          title={copy.title}
          intro={copy.intro}
          detail={copy.introDetail}
        >
          <p>{copy.claim}</p>
          <p>{copy.family}</p>
        </WorkspaceIntro>
        <WorkspaceStart>
          <div className="gl-tb-actions workspace-toolbar">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void demo()}
            >
              {copy.demo}
            </Button>
            <label>
              {copy.restore}
              <input
                type="file"
                accept=".json"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void perform(async (signal) => {
                      if (f.size > 64 * 1024 * 1024)
                        throw Error('PAYROLL_SESSION');
                      return workerTask<{
                        state: PayrollInput;
                        result: PayrollResult;
                      }>(
                        'payroll-restore',
                        { buffer: await f.arrayBuffer() },
                        signal,
                      );
                    }, shown);
                }}
              />
            </label>
            {busy && (
              <Button variant="outline" onClick={cancel}>
                {copy.cancel}
              </Button>
            )}
          </div>
        </WorkspaceStart>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 3]}
          primaryReady={!!(files[0] && files[3])}
        >
          {PAYROLL_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              {files[i] && (
                <>
                  <p>
                    <bdi>{files[i]!.name}</bdi>
                  </p>
                  {detail(
                    copy.roles[i],
                    files[i]!.sheets[0].rows[0] ?? [],
                    files[i]!.sheets[0].rows.slice(1),
                    files[i]!.sha256,
                  )}
                </>
              )}
            </fieldset>
          ))}
        </WorkspaceSources>
        <fieldset disabled={busy} hidden={!(files[0] && files[3])}>
          <ScopeCard
            hidden={!(files[0] && files[3])}
            summary={
              <Sentence
                parts={copy.cardSummary(
                  scopeValue(scope.payrollRun, true),
                  scopeValue(scope.entity),
                  scopeValue(scope.payrollLedger, true),
                  scopeValue(scope.glLedger, true),
                  scopeValue(scope.periodStart, true),
                  scopeValue(scope.periodEnd, true),
                  scopeValue(scope.paymentDate, true),
                  scopeValue(scope.currency, true),
                  rowsRead,
                )}
              />
            }
            rows={PAYROLL_FIELDS.map((k) => {
              const name = copy.scopePrefix + copy.scope[k];
              return {
                key: k,
                label: copy.scope[k],
                origin: origins[k],
                value: scope[k],
                fixed: oneOption(k),
                suggestion: suggestions[k],
                control: (describedBy: string) =>
                  oneOption(k) ? (
                    <select
                      aria-label={name}
                      aria-describedby={describedBy}
                      value={scope[k]}
                      onChange={(e) => updateScope(k, e.target.value)}
                    >
                      <option value={ONLY[k]}>{copy.only[k]}</option>
                    </select>
                  ) : (
                    <input
                      aria-label={name}
                      aria-describedby={describedBy}
                      type={isDate(k) ? 'date' : 'text'}
                      maxLength={500}
                      value={scope[k]}
                      onChange={(e) => updateScope(k, e.target.value)}
                    />
                  ),
              };
            })}
            confirm={
              <label className="scope-card__confirm">
                <input
                  type="checkbox"
                  checked={reading.every((r) => r.confirmed) && scope.confirmed}
                  onChange={(e) => {
                    const confirmed = e.target.checked;
                    setReading(
                      (previous) =>
                        previous.map((r) => ({
                          ...r,
                          confirmed,
                        })) as PayrollInput['readings'],
                    );
                    card.confirm(confirmed);
                    invalidate();
                  }}
                />
                <span>
                  <Sentence
                    parts={copy.cardConfirm(
                      scopeValue(scope.payrollRun, true),
                      scopeValue(scope.entity),
                      scopeValue(scope.paymentDate, true),
                    )}
                  />
                </span>
              </label>
            }
          />
        </fieldset>
        <WorkspaceAdvanced summary={copy.completeTitle}>
          <fieldset disabled={busy}>
            <legend>{copy.completeTitle}</legend>
            <label>
              <input
                type="checkbox"
                checked={complete.confirmed}
                onChange={(e) => {
                  setComplete({ ...complete, confirmed: e.target.checked });
                  invalidate();
                }}
              />
              {copy.complete}
            </label>
            <label>
              {copy.completeReference}
              <input
                maxLength={2000}
                value={complete.reference}
                onChange={(e) => {
                  setComplete({ ...complete, reference: e.target.value });
                  invalidate();
                }}
              />
            </label>
            <label>
              {copy.completeNote}
              <input
                maxLength={2000}
                value={complete.note}
                onChange={(e) => {
                  setComplete({ ...complete, note: e.target.value });
                  invalidate();
                }}
              />
            </label>
          </fieldset>
        </WorkspaceAdvanced>
        <div className="gl-tb-actions workspace-run-actions">
          <Button
            disabled={busy || !ready}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<{ state: PayrollInput; result: PayrollResult }>(
                    'payroll-reconcile',
                    state(),
                    signal,
                  ),
                shown,
              )
            }
          >
            {copy.compare}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>('payroll-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-payrolls-session.json',
                    'application/json',
                  ),
              )
            }
          >
            {copy.save}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>(
                    'payroll-export',
                    { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-payrolls-evidence.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {copy.export}
          </Button>
        </div>
        {error && <p role="alert">{copy.failed}</p>}
        {result && (
          <section className="workspace-results">
            <h2
              {...resultParts.anchor('summary')}
              data-payroll-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <AlignmentStrip
              strip={payrollStrip(result)}
              sides={[copy.roles[0], copy.roles[3]]}
              decimals={result.decimals}
              name={(key) =>
                copy.components[key as keyof typeof copy.components] ?? key
              }
              state={status(result.status)}
            />
            <ResultIndex map={resultParts} />
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>.{' '}
              {copy.componentsNote}
            </p>
            <DomainEvidenceAssistant
              anchor={resultParts.anchor('explain')}
              result={result}
              snapshot={() => ({ domain: 'payroll', input: state(), result })}
              busy={busy}
              replay={async (captured) => {
                if (captured.domain !== 'payroll') throw Error('DOMAIN');
                const fresh = await perform(
                  (signal) =>
                    workerTask<{ state: PayrollInput; result: PayrollResult }>(
                      'payroll-reconcile',
                      captured.input,
                      signal,
                    ),
                  () => {},
                );
                if (!fresh) throw Error('STALE_EVIDENCE_REPLY');
                return {
                  domain: 'payroll',
                  input: fresh.state,
                  result: fresh.result,
                };
              }}
            />
            <RecordTable
              anchor={resultParts.anchor('figures')}
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={PAYROLL_COMPONENTS.map((c, i) => [
                copy.components[c],
                amount(result.totals?.register[PAYROLL_AMOUNT_KEYS[i]]),
                amount(result.totals?.gl[c]),
              ])}
            />
            <RecordTable
              label={copy.tableNames.bank}
              headers={copy.bankComparison}
              rows={[
                [
                  amount(result.bankComparison.register),
                  amount(result.bankComparison.bank),
                  amount(result.bankComparison.difference),
                ],
              ]}
            />
            <RecordTable
              label={copy.tableNames.comparisons}
              headers={copy.comparisons}
              rows={result.comparisons.map((v) => [
                v.account,
                v.dimensions,
                copy.components[v.component],
                amount(v.register),
                amount(v.gl),
                amount(v.difference),
              ])}
            />
            <fieldset
              {...resultParts.anchor('decision')}
              disabled={busy}
              data-decision-platform
            >
              <legend>{copy.decision}</legend>
              <label>
                {copy.reference}
                <input
                  aria-describedby={hint}
                  maxLength={2000}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input
                  aria-describedby={hint}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p id={decisionState} tabIndex={-1} data-decision-state>
                {status(result.review)} · {copy.members}:{' '}
                {result.memberIds.length}
              </p>
              {decision && (
                <>
                  <DecisionButtons
                    input={decision}
                    labels={copy}
                    busy={busy}
                    describedBy={hint}
                    onDecide={(type) => void decide(type)}
                  />
                  <DecisionHint
                    id={hint}
                    input={decision}
                    labels={{ reference: copy.reference, reason: copy.note }}
                  />
                </>
              )}
            </fieldset>
            <EvidenceSections
              anchor={resultParts.anchor('evidence')}
              sections={[
                section(
                  'records.0',
                  copy.roles[0],
                  copy.records[0],
                  result.records[0].map((v) => [
                    v.row,
                    v.employee,
                    v.dimensions,
                    amount(v.gross),
                    amount(v.deductions),
                    amount(v.employer),
                    amount(v.net),
                    v.payrollReference,
                  ]),
                ),
                section(
                  'records.1',
                  copy.roles[1],
                  copy.records[1],
                  result.records[1].map((v) => [
                    v.row,
                    v.id,
                    v.employee,
                    v.dimensions,
                    copy.components[v.component],
                    v.account,
                    v.glDimensions,
                    v.evidence,
                  ]),
                ),
                section(
                  'records.2',
                  copy.roles[2],
                  copy.records[2],
                  result.records[2].map((v) => [
                    v.row,
                    v.id,
                    v.employee,
                    v.dimensions,
                    copy.components[v.component],
                    v.payrollReference,
                    v.account,
                    v.glDimensions,
                    v.accountClass,
                    v.sign,
                    v.basis,
                    v.validFrom,
                    v.validTo,
                    v.reference,
                  ]),
                ),
                section(
                  'records.3',
                  copy.roles[3],
                  copy.records[3],
                  result.records[3].map((v) => [
                    v.row,
                    v.id,
                    v.phase,
                    copy.components[v.component],
                    v.account,
                    v.glDimensions,
                    v.accountClass,
                    amount(v.debit),
                    amount(v.credit),
                    v.entryDate,
                    v.postingReference,
                    amount(v.normal),
                  ]),
                ),
                section(
                  'records.4',
                  copy.roles[4],
                  copy.records[4],
                  result.records[4].map((v) => [
                    v.row,
                    v.id,
                    v.bankAccount,
                    v.direction,
                    amount(v.amount),
                    v.valueDate,
                    v.payoutReference,
                  ]),
                ),
                section(
                  'memberIds',
                  copy.members,
                  copy.memberHeaders,
                  result.memberIds.map((id) => {
                    const v = JSON.parse(id);
                    return [
                      copy.roles[v[1]],
                      v[4],
                      <RecordFields key="id" values={identityFields(id)} />,
                    ];
                  }),
                  undefined,
                  [2],
                ),
                section(
                  'missing',
                  copy.missing,
                  copy.missingHeaders,
                  result.missing.map((v) => [
                    (copy.missingKinds as Record<string, string>)[v.reason] ??
                      v.reason,
                    copy.roles[v.source],
                    v.row,
                    v.component ? copy.components[v.component] : '',
                  ]),
                ),
                section(
                  'issues',
                  copy.issues,
                  copy.issueHeaders,
                  result.issues.map((v) => [
                    copy.roles[v.source] ?? copy.title,
                    v.row,
                    (copy.codes as Record<string, string>)[v.code] ??
                      copy.failed,
                  ]),
                ),
                section(
                  'cells',
                  copy.cells,
                  copy.cellHeaders,
                  result.cells.map((v) => [
                    copy.roles[v.source],
                    v.row,
                    v.column,
                    v.field,
                    v.text,
                  ]),
                ),
                section(
                  'inventory',
                  copy.inventory,
                  copy.inventoryHeaders,
                  result.inventory.map((v) => [
                    copy.roles[v.source],
                    v.row,
                    copy.kinds[v.kind],
                  ]),
                ),
                section(
                  'events',
                  copy.events,
                  copy.eventHeaders,
                  result.events.map((v) => [
                    v.id,
                    copy.actions[v.type],
                    v.at,
                    v.reference,
                    v.note,
                    v.memberIds.length,
                  ]),
                ),
                section(
                  'sources',
                  copy.sources,
                  copy.sourceHeaders,
                  files.map((f, i) => [copy.roles[i], f!.name, f!.sha256!]),
                ),
              ]}
            />
          </section>
        )}
        <PayrollLongRegisterPanel />
      </section>
    </div>
  );
}
