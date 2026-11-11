import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import { clearingStrip } from '@/lib/alignment-strip';
import { ClearingGroupsPanel } from './clearing-groups-panel';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import {
  ClosedReason,
  NoteHint,
  useDecisionFocus,
} from '@/components/decision-platform';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
  WorkspaceStart,
} from './workspace-chrome';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { decisionPlatformCopy } from '@/lib/i18n/decision-platform';
import { clearingSelection, noteReady } from '@/lib/decision-platform';
import { pageOfRow } from '@/lib/record-page';
import { workerTask, prepareWorker } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import type {
  ClearingInput,
  ClearingResult,
  ClearingReading,
  ClearingScope,
  ClearingEvent,
} from '@/lib/reconciliation/clearing';
import {
  clearingDemo,
  clearingDemoReading,
  clearingDemoScope,
} from '@/lib/reconciliation/clearing-demo';
import { RecordRows } from '@/components/record-table';
import { Figures } from '@/components/amount';
import { EvidenceDrawer, ThreadSources } from '@/components/evidence-drawer';
import { useEvidenceThread } from '@/hooks/use-evidence-thread';
import { clearingThread } from '@/lib/evidence-thread';
import { evidenceThreadCopy } from '@/lib/i18n/evidence-thread';
import { StatusBadge } from '@/components/status-badge';
import { clearingGroupTone } from '@/lib/status-tone';
import { ScopeCard, Sentence } from '@/components/scope-card';
import { scopeCardCopy } from '@/lib/i18n/scope-card';
import { useDeclaredScope } from '@/hooks/use-declared-scope';
import type {
  DeclaredScopeRule,
  ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import { SheetPrint, useSheetPrint } from '@/components/reconciliation-sheet-print';
import { sheetPrintCopy } from '@/lib/i18n/sheet-print';
import './clearing-workspace.css';

const freshReading = (): ClearingReading => ({
  sheet: 0,
  header: 0,
  posting: -1,
  reference: -1,
  date: -1,
  amount: -1,
  debit: -1,
  credit: -1,
  account: -1,
  currency: -1,
  description: -1,
  mode: 'signed',
});
const freshScope = (): ClearingScope => ({
  entity: '',
  ledger: '',
  account: '',
  currency: 'SAR',
  start: '',
  end: '',
  confirmed: false,
});
// The card «ما فهمناه من ملفاتك» (UX-5(d)). The engine compares the account
// and the currency with every row, in the columns the accountant maps
// (ROW_SCOPE): the card reads those two from the mapped columns, and from no
// column while one is unmapped. No column of this family writes the entity
// or the ledger, and the period is never taken from movement dates: those
// are asked. The currency starts from SAR, marked as the default, while no
// file writes it; the period takes only YYYY-MM-DD.
const CARD_FIELDS = [
  'entity',
  'ledger',
  'account',
  'currency',
  'start',
  'end',
] as const;
type CardField = (typeof CARD_FIELDS)[number];
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const cardRules: DeclaredScopeRule<CardField>[] = CARD_FIELDS.map((field) =>
  field === 'currency'
    ? { field, fallback: 'SAR' }
    : field === 'start' || field === 'end'
      ? { field, accepts: isoDate }
      : { field },
);
// Every field has a suggestion; the headers below say which are read.
const CARD_HEADERS: Record<CardField, string> = {
  entity: 'Entity',
  ledger: 'Ledger',
  account: 'Account',
  currency: 'Currency',
  start: 'Period start',
  end: 'Period end',
};
const cardColumns = CARD_FIELDS.map((field) => ({
  field,
  header: CARD_HEADERS[field],
}));
const freshOrigins = () =>
  Object.fromEntries(
    cardRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<CardField, ScopeOrigin>;
// The column mapped to the account and to the currency, as the reader names
// it; no column for a field left unmapped or one this family never writes.
function cardHeadersOf(file: SourceFile | null, reading: ClearingReading) {
  const header = file?.sheets[reading.sheet]?.rows[reading.header] ?? [];
  const named = (at: number) =>
    at >= 0 && header[at]?.trim() ? header[at].trim() : null;
  return [
    {
      entity: null,
      ledger: null,
      account: named(reading.account),
      currency: named(reading.currency),
      start: null,
      end: null,
    },
  ];
}
function download(bytes: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The sheet on paper (UX-6(d)), composed on the page by the function the
// worker writes the workbook's first sheet with, from the state and result
// the export sends.
const composeSheet = async (
  { state, result }: { state: ClearingInput; result: ClearingResult },
  language: 'ar' | 'en',
) =>
  (await import('@/lib/reconciliation/clearing-sheet')).clearingSheet(
    state,
    result,
    language,
  );

export function ClearingWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue, lang } = useI18n();
  const t = catalogue.clearing;
  const [file, setFile] = useState<SourceFile | null>(null),
    [reading, setReading] = useState(freshReading),
    [events, setEvents] = useState<ClearingEvent[]>([]),
    [result, setResult] = useState<ClearingResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [note, setNote] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [inventoryPage, setInventoryPage] = useState(0);
  // The card's scope and where each value came from (UX-5(d)): a new file
  // starts it afresh; a sheet, layout or column change drops the
  // confirmation; what the mapped columns agree on fills the fields the
  // accountant has not entered.
  const cardFiles = useMemo(() => [file], [file]),
    cardHeaders = useMemo(() => cardHeadersOf(file, reading), [file, reading]);
  // The hook re-reads when its inputs change identity: each is kept until
  // what it holds changes.
  const cardLabels = useMemo(() => [t.upload], [t.upload]);
  const card = useDeclaredScope({
    initial: () => ({ scope: freshScope(), origins: freshOrigins() }),
    rules: cardRules,
    columns: cardColumns,
    files: cardFiles,
    sheets: [reading.sheet],
    labels: cardLabels,
    headers: cardHeaders,
  });
  const { scope, origins, suggestions } = card;
  const operation = useRef<AbortController | null>(null),
    serial = useRef(0);
  useEffect(
    () => () => {
      serial.current++;
      operation.current?.abort();
    },
    [],
  );
  const invalidate = () => {
    setResult(null);
    setEvents([]);
    setSelected([]);
    setNote('');
    setPage(0);
    setInventoryPage(0);
    setError(false);
  };
  const install = ({
    state,
    result,
  }: {
    state: ClearingInput;
    result: ClearingResult;
  }) => {
    setFile(state.file);
    setReading(state.reading);
    card.install(
      state.scope,
      [state.file],
      [state.reading.sheet],
      undefined,
      cardHeadersOf(state.file, state.reading),
    );
    setEvents(state.events);
    setResult(result);
    setSelected([]);
    setError(false);
  };
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const resultParts = useResultParts(
    ['summary', 'explain', 'figures', 'groups', 'evidence'],
    { summary: 'clearing-result-title' },
  );
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
  // An example that only loads sources takes the reader to what it loaded.
  const { heading: loadedHeading, reveal: revealLoaded } = useResultFocus();
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current;
    const control = new AbortController();
    operation.current = control;
    setBusy(true);
    setError(false);
    try {
      await prepareWorker();
      if (control.signal.aborted) return;
      await work(control.signal);
    } catch {
      if (id === serial.current && !control.signal.aborted) setError(true);
    } finally {
      if (id === serial.current) {
        setBusy(false);
        operation.current = null;
      }
    }
  }
  const input = (): ClearingInput => ({ file: file!, reading, scope, events });
  const printed = useMemo(
    () =>
      file && result
        ? { state: { file, reading, scope, events }, result }
        : null,
    [file, reading, scope, events, result],
  );
  const paper = useSheetPrint(printed, lang, composeSheet);
  // Each case opens the movement rows the engine put in it, every cell as
  // the reader recorded it (UX-10). The table keeps its own page, which a
  // decision moves to the group it changed; the way back takes it to the
  // case's page.
  const thread = useEvidenceThread(active, result),
    words = evidenceThreadCopy[lang],
    opened =
      result && thread.open?.table === 'cases'
        ? { at: thread.open.at, case: result.cases[thread.open.at] }
        : null;
  const check = () =>
    perform(async (signal) =>
      shown(await workerTask('clearing-reconcile', input(), signal)),
    );
  // The decision platform (UX-3): a decision needs a review reason of eight
  // characters, as the engine requires, and clearing by hand a selection
  // the engine accepts; the sentence under the reason says which is
  // missing. After a decision the focus returns to the group it changed,
  // on the page that shows it, not to the page.
  const hint = useId(),
    caseRow = useId(),
    exampleWhy = useId(),
    settle = useDecisionFocus();
  const rowAt = (at: number) => `${caseRow}-${at}`;
  const decide = (action: ClearingEvent['action'], ids: string[]) =>
    perform(async (signal) => {
      const value = await workerTask<{
        state: ClearingInput;
        result: ClearingResult;
      }>(
        'clearing-reconcile',
        {
          ...input(),
          events: [...events, { context: result!.context, action, ids, note }],
        },
        signal,
      );
      install(value);
      const at = value.result.cases.findIndex((c) => c.ids.includes(ids[0]));
      if (at < 0) return;
      setPage(pageOfRow(at));
      settle(rowAt(at));
    });
  async function upload(uploaded: File) {
    if (
      uploaded.size > MAX_FILE_BYTES ||
      !/\.(csv|xlsx)$/i.test(uploaded.name)
    ) {
      setError(true);
      return;
    }
    await perform(async (signal) => {
      const value: SourceFile = await workerTask(
        'read',
        { name: uploaded.name, buffer: await uploaded.arrayBuffer() },
        signal,
      );
      if (signal.aborted) return;
      invalidate();
      setFile(value);
      setReading(freshReading());
      card.reset();
    });
  }
  const sheet = file?.sheets[reading.sheet],
    header = sheet?.rows[reading.header] ?? [];
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
    ...CARD_FIELDS.flatMap((k) => suggestions[k].read.map((r) => r.rows)),
  );
  const col = (key: keyof ClearingReading) => (
    <label key={key}>
      {t[key as 'posting']}
      <select
        aria-label={t[key as 'posting']}
        value={Number(reading[key])}
        disabled={busy}
        onChange={(e) => {
          invalidate();
          setReading({ ...reading, [key]: Number(e.target.value) });
          card.confirm(false);
        }}
      >
        <option value={-1}>{t.column}</option>
        {header.map((h, i) => (
          <option value={i} key={i}>
            {i + 1} · {h || '—'}
          </option>
        ))}
      </select>
    </label>
  );
  const owners = result
    ? new Map(result.rows.map((row) => [row.id, row]))
    : new Map();
  const selection = clearingSelection(
    selected.map((id) => owners.get(id)?.amount ?? Number.NaN),
  );
  // While the source has reading errors no member can be selected, and the
  // engine clears nothing by hand: the sentence says so instead.
  const wait = result?.inventory.some((r) => r.kind === 'error')
    ? 'errors'
    : selection;
  if (!active) return null;
  return (
    <>
      <main
        className="workspace clearing-workspace reconciliation-workspace"
        id="clearing"
        aria-busy={busy}
      >
        <WorkspaceHeader
          onBack={onBack}
          backLabel={t.back}
          disabled={busy}
          hasWork={!!file}
        />
        <WorkspaceIntro title={t.title} intro={t.intro} detail={t.introDetail}>
          <p>{t.limits}</p>
        </WorkspaceIntro>
        <section className="surface pad stack workspace-preparation">
          <WorkspaceStart>
            <div className="clearing-actions workspace-toolbar">
              <Button
                variant="outline"
                disabled={busy || !!file}
                aria-describedby={exampleWhy}
                onClick={() =>
                  void perform(async (signal) => {
                    const f: SourceFile = await workerTask(
                      'read',
                      {
                        name: 'synthetic-clearing.csv',
                        buffer: new TextEncoder().encode(clearingDemo).buffer,
                      },
                      signal,
                    );
                    if (signal.aborted) return;
                    invalidate();
                    setFile(f);
                    setReading({ ...clearingDemoReading });
                    card.install(
                      { ...clearingDemoScope },
                      [f],
                      [clearingDemoReading.sheet],
                      undefined,
                      cardHeadersOf(f, clearingDemoReading),
                    );
                    revealLoaded();
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
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void perform(async (signal) => {
                        if (f.size > 16 * 1024 * 1024) throw new Error('size');
                        const restored = await workerTask<{
                          state: ClearingInput;
                          result: ClearingResult;
                        }>(
                          'clearing-restore',
                          { buffer: await f.arrayBuffer() },
                          signal,
                        );
                        if (!signal.aborted) {
                          invalidate();
                          shown(restored);
                        }
                      });
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <ClosedReason
              id={exampleWhy}
              closed={!!file}
              waits="example"
              label={t.sample}
            />
          </WorkspaceStart>
          <WorkspaceSources primaryIndices={[0]} primaryReady={!!file}>
            <section className="workspace-source">
              <h2>
                <WorkspaceSourceHeading>{t.upload}</WorkspaceSourceHeading>
              </h2>
              <label>
                {t.upload}
                <WorkspaceFileInput
                  aria-label={t.upload}
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </section>
          </WorkspaceSources>
          {error && <p role="alert">{t.error}</p>}
          {busy && (
            <output>
              {t.working}{' '}
              <Button
                onClick={() => {
                  serial.current++;
                  operation.current?.abort();
                  operation.current = null;
                  setBusy(false);
                }}
              >
                {t.cancel}
              </Button>
            </output>
          )}
        </section>
        {file && (
          <section className="surface pad stack">
            <h2 ref={loadedHeading} tabIndex={-1} data-result-heading="loaded">
              {file.name}
            </h2>
            <fieldset disabled={busy}>
              <div className="clearing-grid">
                <label>
                  {t.sheet}
                  <select
                    value={reading.sheet}
                    onChange={(e) => {
                      invalidate();
                      setReading({
                        ...freshReading(),
                        sheet: Number(e.target.value),
                      });
                      card.confirm(false);
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
                  {t.header}
                  <input
                    type="number"
                    min="1"
                    max={1}
                    value={reading.header + 1}
                    onChange={(e) => {
                      invalidate();
                      setReading({
                        ...freshReading(),
                        sheet: reading.sheet,
                        header: Number(e.target.value) - 1,
                      });
                      card.confirm(false);
                    }}
                  />
                </label>
                <label>
                  {t.mode}
                  <select
                    value={reading.mode}
                    onChange={(e) => {
                      invalidate();
                      setReading({
                        ...reading,
                        mode: e.target.value as 'signed' | 'split',
                        amount: -1,
                        debit: -1,
                        credit: -1,
                      });
                      card.confirm(false);
                    }}
                  >
                    <option value="signed">{t.signed}</option>
                    <option value="split">{t.split}</option>
                  </select>
                </label>
                {(
                  [
                    'posting',
                    'reference',
                    'date',
                    ...(reading.mode === 'signed'
                      ? ['amount']
                      : ['debit', 'credit']),
                    'account',
                    'currency',
                    'description',
                  ] as (keyof ClearingReading)[]
                ).map(col)}
              </div>
              <ScopeCard
                summary={
                  <Sentence
                    parts={t.cardSummary(
                      scopeValue(scope.entity),
                      scopeValue(scope.ledger, true),
                      scopeValue(scope.account, true),
                      scopeValue(scope.start, true),
                      scopeValue(scope.end, true),
                      scopeValue(scope.currency, true),
                      rowsRead,
                    )}
                  />
                }
                rows={CARD_FIELDS.map((k) => ({
                  key: k,
                  label: t[k],
                  origin: origins[k],
                  value: scope[k],
                  fixed: false,
                  suggestion: suggestions[k],
                  control: (describedBy: string) => (
                    <input
                      aria-label={t[k]}
                      aria-describedby={describedBy}
                      type={k === 'start' || k === 'end' ? 'date' : 'text'}
                      value={scope[k]}
                      onChange={(event) => {
                        invalidate();
                        card.edit(k, event.target.value);
                      }}
                    />
                  ),
                }))}
                confirm={
                  <label className="scope-card__confirm">
                    <input
                      type="checkbox"
                      checked={scope.confirmed}
                      onChange={(event) => {
                        invalidate();
                        card.confirm(event.target.checked);
                      }}
                    />
                    <span>
                      <Sentence
                        parts={t.cardConfirm(
                          scopeValue(scope.entity),
                          scopeValue(scope.ledger, true),
                          scopeValue(scope.account, true),
                          scopeValue(scope.start, true),
                          scopeValue(scope.end, true),
                        )}
                      />
                    </span>
                  </label>
                }
              />
            </fieldset>
            <Button
              disabled={busy || !scope.confirmed}
              onClick={() => void check()}
            >
              {t.run}
            </Button>
            <WorkspaceAdvanced summary={t.source}>
              <div className="clearing-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t.row}</th>
                      {header.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet?.rows
                      .slice(reading.header + 1, reading.header + 11)
                      .map((r, i) => (
                        <tr key={i}>
                          <th>{reading.header + i + 2}</th>
                          {r.map((v, j) => (
                            <td key={j}>
                              <bdi>{v}</bdi>
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </WorkspaceAdvanced>
          </section>
        )}
        {result && (
          <section
            className="surface pad stack"
            aria-labelledby="clearing-result-title"
          >
            <h2
              {...resultParts.anchor('summary')}
              id="clearing-result-title"
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {t.results}
            </h2>
            <AlignmentStrip
              strip={clearingStrip(result)}
              sides={[t.upload]}
              decimals={result.decimals}
              reason={(code) => t.reason[code as keyof typeof t.reason] ?? code}
            />
            <ResultIndex map={resultParts} />
            <DomainEvidenceAssistant
              anchor={resultParts.anchor('explain')}
              result={result}
              snapshot={() => ({ domain: 'clearing', input: input(), result })}
              busy={busy}
            />
            <div
              {...resultParts.anchor('figures')}
              className="clearing-grid"
              data-testid="clearing-metrics"
            >
              {/* The account's net is the strip's gap, not repeated here
                  (UX-4); cleared movements count postings, the strip groups. */}
              {[
                [t.valid, result.rows.length],
                [
                  t.cleared,
                  result.cases
                    .filter((c) => c.status === 'cleared')
                    .reduce((n, c) => n + c.ids.length, 0),
                ],
                [
                  t.errors,
                  result.inventory.filter((r) => r.kind === 'error').length,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="muted">{t.coverage}</p>
            <RecordRows
              anchor={resultParts.anchor('groups')}
              label={t.results}
              headers={[
                words.way,
                t.members,
                t.reference,
                t.net,
                t.status,
                t.basis,
                t.note,
              ]}
              page={page}
              onPage={setPage}
              rows={result.cases}
              mark={(_, at) => ({
                'data-testid': 'clearing-case',
                ...thread.mark('cases', at),
              })}
              target={(_, at) => rowAt(at)}
              cells={(c, at) => [
                <Button
                  key="thread"
                  variant="outline"
                  {...thread.way('cases', at)}
                  onClick={() => thread.show('cases', at)}
                >
                  {words.way}
                  <span className="sr-only">
                    {' · '}
                    {c.ids.map((id) => owners.get(id)?.posting).join(', ')}
                  </span>
                </Button>,
                <label key="members">
                  <input
                    type="checkbox"
                    aria-label={`${t.members}: ${c.ids.map((id) => owners.get(id)?.posting).join(', ')}`}
                    disabled={
                      busy ||
                      c.status === 'cleared' ||
                      result.inventory.some((r) => r.kind === 'error')
                    }
                    checked={c.ids.every((id) => selected.includes(id))}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...new Set([...selected, ...c.ids])]
                          : selected.filter((id) => !c.ids.includes(id)),
                      )
                    }
                  />
                  <bdi>
                    {c.ids.map((id) => owners.get(id)?.posting).join(', ')}
                  </bdi>
                </label>,
                c.reference || t.missing,
                money(c.net, result.decimals),
                <StatusBadge
                  key="status"
                  tone={clearingGroupTone(c.status)}
                  status={c.status}
                >
                  {c.status === 'cleared' ? t.cleared : t.review}
                </StatusBadge>,
                <div key="basis">
                  {c.basis === 'explicit-reference'
                    ? t.automatic
                    : c.basis === 'human-decision'
                      ? t.human
                      : t.none}
                  <p className="muted">{t.reason[c.reason]}</p>
                </div>,
                <div key="note">
                  {c.note}
                  {c.status === 'cleared' && (
                    <Button
                      variant="outline"
                      data-decision-action="reopen"
                      data-decision-target={rowAt(at)}
                      aria-describedby={hint}
                      disabled={busy || !noteReady(note)}
                      onClick={() => void decide('reopen', c.ids)}
                    >
                      {t.reopen}
                    </Button>
                  )}
                </div>,
              ]}
            />
            {opened?.case && (
              <EvidenceDrawer
                id={thread.id}
                headingRef={thread.heading}
                heading={`${words.heading} · ${opened.case.ids.map((id) => owners.get(id)?.posting).join(', ')}`}
                back={words.back}
                onBack={() => {
                  setPage(pageOfRow(opened.at));
                  thread.back();
                }}
                amount={
                  <Figures
                    decimals={result.decimals}
                    items={[[t.net, opened.case.net]]}
                  />
                }
              >
                <ThreadSources
                  thread={clearingThread(result, file?.name ?? '', opened.at)}
                  role={() => t.upload}
                />
              </EvidenceDrawer>
            )}
            <label>
              {t.note}
              <textarea
                value={note}
                maxLength={200}
                disabled={busy}
                aria-describedby={hint}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <NoteHint id={hint} note={note} label={t.note} wait={wait}>
              {decisionPlatformCopy[lang].clearing.reopen}{' '}
              {decisionPlatformCopy[lang].clearing[wait]}
            </NoteHint>
            <Button
              data-decision-action="clear"
              aria-describedby={hint}
              disabled={busy || selection !== 'ready' || !noteReady(note)}
              onClick={() => void decide('clear', selected)}
            >
              {t.manual}
            </Button>
            <details {...resultParts.anchor('evidence')}>
              <summary>
                {t.source} · {t.errors}
              </summary>
              <RecordRows
                label={`${t.source} · ${t.errors}`}
                headers={[t.row, t.status, t.source]}
                rowHeader={0}
                page={inventoryPage}
                onPage={setInventoryPage}
                rows={result.inventory}
                cells={(row) => [
                  row.row,
                  row.kind === 'error' ? t.readingIssue : t.inventory[row.kind],
                  row.values.join(' | '),
                ]}
              />
            </details>
            <div className="clearing-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async (signal) => {
                    const bytes = await workerTask<ArrayBuffer>(
                      'clearing-save',
                      input(),
                      signal,
                    );
                    if (!signal.aborted)
                      download(
                        bytes,
                        'clearing-session.json',
                        'application/json',
                      );
                  })
                }
              >
                {t.save}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async (signal) => {
                    const bytes = await workerTask<ArrayBuffer>(
                      'clearing-export',
                      // The reconciliation sheet is written in the
                      // interface's language (UX-6).
                      { state: input(), result, lang },
                      signal,
                    );
                    if (!signal.aborted)
                      download(
                        bytes,
                        'clearing-workpaper.xlsx',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      );
                  })
                }
              >
                {t.export}
              </Button>
              <Button disabled={busy} onClick={paper.print}>
                {sheetPrintCopy[lang].print}
              </Button>
            </div>
            <SheetPrint sheet={paper.sheet} />
          </section>
        )}
        {file && (
          <ClearingGroupsPanel
            key={JSON.stringify([file.sha256, reading, scope])}
            file={file}
            reading={reading}
            scope={scope}
            disabled={busy || !scope.confirmed}
            run={perform}
          />
        )}
      </main>
    </>
  );
}
