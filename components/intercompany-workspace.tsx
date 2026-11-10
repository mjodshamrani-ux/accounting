import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { IntercompanyBatchPanel } from '@/components/intercompany-batch-panel';
import { useEffect, useId, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount, Figures } from '@/components/amount';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import { EvidenceSections } from '@/components/evidence-sections';
import { intercompanyStrip } from '@/lib/alignment-strip';
import {
  RecordFields,
  RecordPager,
  RecordTable,
  memberPlace,
} from '@/components/record-table';
import { pageOfRow, recordPage } from '@/lib/record-page';
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
  IC_VERSION,
  IC_ROLES,
  IC_SCOPE_FIELDS,
  IC_SCOPE_HEADERS,
  IC_LEDGER_SCOPE_COLUMNS,
  type IntercompanyInput,
  type IntercompanyScope,
  type IntercompanyResult,
  type IntercompanyEvent,
} from '@/lib/reconciliation/intercompany';
import {
  intercompanyDemo,
  intercompanyDemoScope,
} from '@/lib/reconciliation/intercompany-demo';
import { intercompanyCopy } from '@/lib/i18n/intercompany';
import { ScopeCard, Sentence } from '@/components/scope-card';
import { scopeCardCopy } from '@/lib/i18n/scope-card';
import { useDeclaredScope } from '@/hooks/use-declared-scope';
import type {
  DeclaredScopeRule,
  ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import './workspace-record.css';
import {
  SheetPrint,
  useSheetPrint,
} from '@/components/reconciliation-sheet-print';
import { sheetPrintCopy } from '@/lib/i18n/sheet-print';
import {
  DecisionButtons,
  DecisionHint,
  useDecisionFocus,
} from './decision-platform';
import type { AcceptBlock } from '@/lib/decision-platform';
const emptyScope = (): IntercompanyScope => ({
  entityA: '',
  entityB: '',
  ledgerA: '',
  ledgerB: '',
  accountA: '',
  accountB: '',
  dimensionsA: '',
  dimensionsB: '',
  currency: '',
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
  postingLayer: '',
  start: '',
  end: '',
  asOf: '',
  policyVersion: '',
  confirmed: false,
});
type IcScopeField = (typeof IC_SCOPE_FIELDS)[number];
// What the card may put in each field (UX-5(d)): the three one-option
// selects take only the value the engine accepts, and start from it while no
// file has the column; the three dates take only YYYY-MM-DD.
const ONLY = {
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
} as const;
const oneOption = (k: IcScopeField): k is keyof typeof ONLY => k in ONLY;
const isDate = (k: IcScopeField) =>
  k === 'start' || k === 'end' || k === 'asOf';
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const scopeRules: DeclaredScopeRule<IcScopeField>[] = IC_SCOPE_FIELDS.map(
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
const scopeColumns = IC_SCOPE_FIELDS.map((field, i) => ({
  field,
  header: IC_SCOPE_HEADERS[i],
}));
// The two ledgers write their own side's entity, ledger, account and
// dimensions under their own columns; the evidence files under the scope's.
const sourceColumns = [...IC_LEDGER_SCOPE_COLUMNS, undefined, undefined];
const freshOrigins = () =>
  Object.fromEntries(
    scopeRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<IcScopeField, ScopeOrigin>;
const readings = () =>
  IC_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: IC_VERSION,
    confirmed: false,
  })) as IntercompanyInput['readings'];
// The sheet on paper (UX-6(d)), composed on the page by the function the
// worker writes the workbook's first sheet with, from the result the export sends (the intercompany sheet reads the result alone).
const composeSheet = async (
  result: IntercompanyResult,
  language: 'ar' | 'en',
) =>
  (await import('@/lib/reconciliation/intercompany-sheet')).intercompanySheet(
    result,
    language,
  );
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function IntercompanyWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { engineText, lang } = useI18n();
  const copy = intercompanyCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [reading, setReading] = useState(readings);
  // The card's scope and where each value came from (UX-5(d)): a new file
  // fills what the four files agree on into the fields the accountant has
  // not entered, and a value it changes drops the confirmation.
  const card = useDeclaredScope({
    initial: () => ({ scope: emptyScope(), origins: freshOrigins() }),
    rules: scopeRules,
    columns: scopeColumns,
    files,
    sheets: reading.map((r) => r.sheet),
    labels: copy.roles,
    headers: sourceColumns,
  });
  const { scope, origins, suggestions } = card;
  const [complete, setComplete] = useState<IntercompanyInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<IntercompanyEvent[]>([]),
    [result, setResult] = useState<IntercompanyResult | null>(null);
  // Composed only while this workspace is the one shown: it stays in the
  // page hidden otherwise, and would draw its table when another prints.
  const paper = useSheetPrint(active ? result : null, lang, composeSheet);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  const [pairPage, setPairPage] = useState(0);
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
    setPairPage(0);
    setResult(null);
    setEvents([]);
    setError('');
  }
  function state(): IntercompanyInput {
    return {
      files: files as IntercompanyInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: {
    state: IntercompanyInput;
    result: IntercompanyResult;
  }) {
    setFiles(v.state.files);
    setReading(v.state.readings);
    card.install(
      v.state.scope,
      v.state.files,
      v.state.readings.map((r) => r.sheet),
    );
    setComplete(v.state.completeness);
    setEvents(v.state.events);
    setPairPage(0);
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
    'pairs',
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
      if (id === runtime.current.serial && !control.signal.aborted)
        apply(value);
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
  function updateScope(key: IcScopeField, value: string) {
    card.edit(key, value);
    invalidate();
  }
  const unknown = scopeCardCopy[lang].unknown;
  // A value inside a sentence, isolated so mixed scripts keep their order;
  // a date or a currency code is never split across lines.
  const scopeValue = (v: string, whole = false) => (
    <bdi className={whole ? 'scope-card__whole' : undefined}>
      {v || unknown}
    </bdi>
  );
  const rowsRead = Math.max(
    0,
    ...IC_SCOPE_FIELDS.map((k) =>
      suggestions[k].read.reduce((n, r) => n + r.rows, 0),
    ),
  );
  const ready =
    files.every(Boolean) &&
    reading.every((r) => r.confirmed) &&
    scope.confirmed &&
    IC_SCOPE_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('IC_SOURCE');
        return workerTask<SourceFile>(
          'intercompany-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as IntercompanyInput['readings'];
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
      for (let i = 0; i < 4; i++)
        f.push(
          await workerTask<SourceFile>(
            'intercompany-read',
            {
              name: `pending-${i}.csv`,
              buffer: new TextEncoder().encode(intercompanyDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: IntercompanyInput = {
        files: f as IntercompanyInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as IntercompanyInput['readings'],
        scope: { ...intercompanyDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: 'Synthetic inventory attestation',
          note: 'Synthetic supplied inventory reviewed; not field evidence',
        },
        events: [],
      };
      return workerTask<{
        state: IntercompanyInput;
        result: IntercompanyResult;
      }>('intercompany-reconcile', s, signal);
    }, shown);
  }
  // The decision platform (UX-3): after a decision on a pair the focus
  // returns to that pair's heading, which holds its state, on the page that
  // shows it, not to the page.
  const hint = useId(),
    pairHeading = useId(),
    settle = useDecisionFocus();
  const headingAt = (at: number) => `${pairHeading}-${at}`;
  async function decide(relation: string, type: IntercompanyEvent['type']) {
    if (!result) return;
    const p = result.pairs.find((p) => p.relationId === relation)!;
    const e: IntercompanyEvent = {
      id: crypto.randomUUID(),
      type,
      context: result.context,
      relationId: relation,
      memberIds: p.members.map((e) => e.id),
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform(
      (signal) =>
        workerTask<{ state: IntercompanyInput; result: IntercompanyResult }>(
          'intercompany-reconcile',
          { ...state(), events: [...events, e] },
          signal,
        ),
      (v) => {
        install(v);
        const at = v.result.pairs.findIndex((q) => q.relationId === relation);
        if (at < 0) return;
        setPairPage(pageOfRow(at));
        settle(headingAt(at));
      },
    );
  }
  const pairsShown = recordPage(result?.pairs.length ?? 0, pairPage);
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  // What the decision buttons open on, as before: approval also needs the
  // completeness confirmation and every pair ready, and the sentence under
  // the fields says which of these is missing.
  const acceptBlock: AcceptBlock | null = !result
    ? null
    : !complete.confirmed
      ? 'unconfirmed'
      : result.issues.length
        ? 'source-error'
        : result.missing.length
          ? 'missing'
          : result.pairs.every((p) => p.status === 'ready')
            ? null
            : 'pairs';
  return (
    <div hidden={!active}>
      <section
        className="app-shell gl-tb-workspace reconciliation-workspace"
        data-intercompany-workspace
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
                      if (f.size > 64 * 1024 * 1024) throw Error('IC_SESSION');
                      return workerTask<{
                        state: IntercompanyInput;
                        result: IntercompanyResult;
                      }>(
                        'intercompany-restore',
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
          primaryIndices={[0, 1]}
          primaryReady={!!(files[0] && files[1])}
        >
          {IC_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              <p>{files[i]?.name ?? copy.empty}</p>
            </fieldset>
          ))}
        </WorkspaceSources>
        <fieldset disabled={busy} hidden={!(files[0] && files[1])}>
          <ScopeCard
            hidden={!(files[0] && files[1])}
            summary={
              <Sentence
                parts={copy.cardSummary(
                  scopeValue(scope.entityA),
                  scopeValue(scope.entityB),
                  scopeValue(scope.start, true),
                  scopeValue(scope.end, true),
                  scopeValue(scope.currency, true),
                  rowsRead,
                )}
              />
            }
            rows={IC_SCOPE_FIELDS.map((k, i) => {
              const name = `${copy.scopePrefix} ${copy.scope[i]}`;
              return {
                key: k,
                label: copy.scope[i],
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
                        })) as IntercompanyInput['readings'],
                    );
                    card.confirm(confirmed);
                    invalidate();
                  }}
                />
                <span>
                  <Sentence
                    parts={copy.cardConfirm(
                      scopeValue(scope.entityA),
                      scopeValue(scope.entityB),
                      scopeValue(scope.start, true),
                      scopeValue(scope.end, true),
                    )}
                  />
                </span>
              </label>
            }
          />
        </fieldset>
        <WorkspaceAdvanced summary={copy.completenessTitle}>
          <fieldset disabled={busy}>
            <legend>{copy.completenessTitle}</legend>
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
                  workerTask<{
                    state: IntercompanyInput;
                    result: IntercompanyResult;
                  }>('intercompany-reconcile', state(), signal),
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
                  workerTask<ArrayBuffer>('intercompany-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-intercompany-session.json',
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
                    'intercompany-export',
                    { state: state(), result, lang },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-intercompany-workpaper.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {copy.export}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={paper.print}
          >
            {sheetPrintCopy[lang].print}
          </Button>
        </div>
        <SheetPrint sheet={paper.sheet} />
        {error && (
          <p role="alert">
            {error.startsWith('IC_') || error.startsWith('BANK_NATIVE_DISPLAY')
              ? copy.failed
              : engineText(error)}
          </p>
        )}
        {result && (
          <section className="workspace-results">
            <h2
              {...resultParts.anchor('summary')}
              data-intercompany-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <AlignmentStrip
              strip={intercompanyStrip(result)}
              sides={[copy.roles[0], copy.roles[1]]}
              decimals={result.decimals}
              reason={status}
              state={status(result.status)}
            />
            <ResultIndex map={resultParts} />
            <DomainEvidenceAssistant
              anchor={resultParts.anchor('explain')}
              result={result}
              snapshot={() => ({
                domain: 'intercompany',
                input: state(),
                result,
              })}
              busy={busy}
            />
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>
            </p>
            <RecordTable
              anchor={resultParts.anchor('figures')}
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={
                result.totals
                  ? result.totals.map((t, i) => [
                      copy.roles[i],
                      ...(['debit', 'credit', 'net'] as const).map((k) => (
                        <Amount
                          key={k}
                          minor={t[k]}
                          decimals={result.decimals}
                        />
                      )),
                    ])
                  : []
              }
            />
            <fieldset
              {...resultParts.anchor('decision')}
              disabled={busy}
              data-decision-platform
            >
              <legend>{copy.decisionTitle}</legend>
              <label>
                {copy.reference}
                <input
                  aria-describedby={hint}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input
                  aria-describedby={hint}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <DecisionHint
                id={hint}
                input={{ reference, reason: note, review: 'each', acceptBlock }}
                labels={{ reference: copy.reference, reason: copy.note }}
              />
            </fieldset>
            <h3 {...resultParts.anchor('pairs')}>
              {copy.pairs} ({result.pairs.length})
            </h3>
            {result.pairs.slice(pairsShown.from, pairsShown.to).map((p, i) => (
              <section
                key={p.relationRecord}
                data-intercompany-pair={p.relationId}
              >
                <h3
                  id={headingAt(pairsShown.from + i)}
                  tabIndex={-1}
                  data-decision-item
                >
                  {p.relationId} · {status(p.status)} · {status(p.review)}
                </h3>
                <p>
                  <Figures
                    decimals={result.decimals}
                    items={[
                      [copy.residualFigures[0], p.left?.net],
                      [copy.residualFigures[1], p.right?.net],
                      [copy.residualFigures[2], p.residual],
                    ]}
                  />
                </p>
                <details>
                  <summary>
                    {copy.entries} ({p.members.length})
                  </summary>
                  <RecordTable
                    label={`${copy.entries} · ${p.relationId}`}
                    headers={copy.pairHeaders}
                    rows={p.members.map((e) => [
                      p.relationId,
                      copy.roles[e.source],
                      e.transactionId,
                      e.counterpartyTransactionId,
                      e.account,
                      e.dimensions,
                      e.date,
                      ...(['debit', 'credit', 'net'] as const).map((k) => (
                        <Amount
                          key={k}
                          minor={e[k]}
                          decimals={result.decimals}
                        />
                      )),
                    ])}
                  />
                </details>
                <DecisionButtons
                  input={{
                    reference,
                    reason: note,
                    members: p.members.length,
                    review: p.review,
                    acceptBlock,
                  }}
                  labels={copy}
                  busy={busy}
                  describedBy={`${hint} ${headingAt(pairsShown.from + i)}`}
                  target={headingAt(pairsShown.from + i)}
                  onDecide={(type) => void decide(p.relationId, type)}
                />
              </section>
            ))}
            <RecordPager
              label={copy.pairs}
              length={result.pairs.length}
              page={pairPage}
              onPage={setPairPage}
            />
            <EvidenceSections
              anchor={resultParts.anchor('evidence')}
              sections={[
                {
                  key: 'relations',
                  name: copy.relations,
                  count: result.relations.length,
                  node: (
                    <details data-evidence-section="relations">
                      <summary>
                        {copy.relations} ({result.relations.length})
                      </summary>
                      <RecordTable
                        label={copy.relations}
                        headers={copy.relationHeaders}
                        rows={result.relations.map((r) => [
                          r.relationId,
                          r.leftId,
                          r.rightId,
                          r.validFrom,
                          r.validTo,
                          r.reference,
                        ])}
                      />
                    </details>
                  ),
                },
                {
                  key: 'timing',
                  name: copy.timing,
                  count: result.timing.length,
                  node: (
                    <details data-evidence-section="timing">
                      <summary>
                        {copy.timing} ({result.timing.length})
                      </summary>
                      <RecordTable
                        label={copy.timing}
                        headers={copy.timingHeaders}
                        rows={result.timing.map((r) => [
                          r.evidenceId,
                          r.side,
                          r.transactionId,
                          r.counterpartyTransactionId,
                          r.date,
                          r.amount,
                          r.reference,
                        ])}
                      />
                    </details>
                  ),
                },
                {
                  key: 'missing',
                  name: copy.missing,
                  count: result.missing.length,
                  node: (
                    <details data-evidence-section="missing">
                      <summary>
                        {copy.missing} ({result.missing.length})
                      </summary>
                      <RecordTable
                        label={copy.missing}
                        headers={copy.missingHeaders}
                        rows={result.missing.map((r) => [r.kind, r.key])}
                      />
                    </details>
                  ),
                },
                {
                  key: 'issues',
                  name: copy.issues,
                  count: result.issues.length,
                  node: (
                    <details data-evidence-section="issues">
                      <summary>
                        {copy.issues} ({result.issues.length})
                      </summary>
                      <RecordTable
                        label={copy.issues}
                        headers={copy.issueHeaders}
                        rows={result.issues.map((r) => [
                          r.code,
                          copy.roles[r.source],
                          r.row || copy.aggregate,
                          r.key,
                          r.related,
                        ])}
                      />
                    </details>
                  ),
                },
                {
                  key: 'inventory',
                  name: copy.inventory,
                  count: result.inventory.length,
                  node: (
                    <details data-evidence-section="inventory">
                      <summary>
                        {copy.inventory} ({result.inventory.length})
                      </summary>
                      <RecordTable
                        label={copy.inventory}
                        headers={copy.inventoryHeaders}
                        rows={result.inventory.map((r) => [
                          copy.roles[r.source],
                          r.row,
                          r.kind,
                          r.errors.join(', '),
                          <RecordFields key="values" values={r.values} />,
                        ])}
                        wrap={[4]}
                      />
                    </details>
                  ),
                },
                {
                  key: 'events',
                  name: copy.history,
                  count: events.length,
                  node: (
                    <details data-evidence-section="events">
                      <summary>
                        {copy.history} ({events.length})
                      </summary>
                      <RecordTable
                        label={copy.history}
                        headers={copy.eventHeaders}
                        rows={events.map((e) => [
                          copy[e.type],
                          e.relationId,
                          e.at,
                          e.reference,
                          e.note,
                          <RecordFields
                            key="members"
                            values={e.memberIds.map((id) =>
                              memberPlace(id, copy.roles),
                            )}
                          />,
                        ])}
                        wrap={[5]}
                      />
                    </details>
                  ),
                },
              ]}
            />
          </section>
        )}
        <IntercompanyBatchPanel />
      </section>
    </div>
  );
}
