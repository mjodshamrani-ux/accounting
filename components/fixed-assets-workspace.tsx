import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { FixedAssetsSectionsPanel } from '@/components/fixed-assets-sections-panel';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount } from '@/components/amount';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import {
  EvidenceSections,
  type EvidenceSection,
} from '@/components/evidence-sections';
import { assetStrip } from '@/lib/alignment-strip';
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
  ASSET_VERSION,
  ASSET_LONG_FAMILY,
  ASSET_ROLES,
  ASSET_FIELDS,
  ASSET_SCOPE_HEADERS,
  ASSET_COMPONENTS,
  type AssetInput,
  type AssetScope,
  type AssetResult,
  type AssetEvent,
} from '@/lib/reconciliation/fixed-assets';
import {
  assetDemo,
  assetDemoScope,
} from '@/lib/reconciliation/fixed-assets-demo';
import { assetCopy } from '@/lib/i18n/fixed-assets';
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
import type { DecisionInput } from '@/lib/decision-platform';
const emptyScope = (): AssetScope =>
  ({
    ...Object.fromEntries(ASSET_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    postingStatus: 'posted',
    confirmed: false,
  }) as AssetScope;
type AssetField = (typeof ASSET_FIELDS)[number];
// What the card may put in each field (UX-5(d)): the two one-option selects
// take only the value the engine accepts, and start from it while no file
// has the column; the date takes only YYYY-MM-DD.
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
} as const;
const oneOption = (k: AssetField): k is keyof typeof ONLY => k in ONLY;
const isDate = (k: AssetField) => k === 'asOf';
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const scopeRules: DeclaredScopeRule<AssetField>[] = ASSET_FIELDS.map((field) =>
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
// Both register formats and the three other originals write the twelve
// scope columns on every row, as the engine's row check reads them.
const scopeColumns = ASSET_FIELDS.map((field, i) => ({
  field,
  header: ASSET_SCOPE_HEADERS[i],
}));
const freshOrigins = () =>
  Object.fromEntries(
    scopeRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<AssetField, ScopeOrigin>;
const readings = () =>
  ASSET_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: ASSET_VERSION,
    confirmed: false,
  })) as AssetInput['readings'];
// The sheet on paper (UX-6(d)), composed on the page by the function the
// worker writes the workbook's first sheet with, from what the export sends:
// the result, and the four files each by its name and fingerprint, as the
// worker names them.
const composeSheet = async (
  { result, files }: { result: AssetResult; files: SourceFile[] },
  language: 'ar' | 'en',
) =>
  (await import('@/lib/reconciliation/fixed-assets-sheet')).fixedAssetsSheet(
    result,
    files.map((f) => ({ name: f.name, sha256: f.sha256 })),
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
export function AssetWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { lang } = useI18n();
  const copy = assetCopy[lang];
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
  });
  const { scope, origins, suggestions } = card;
  const [complete, setComplete] = useState<AssetInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<AssetEvent[]>([]),
    [result, setResult] = useState<AssetResult | null>(null);
  // Composed only while this workspace is the one shown: it stays in the
  // page hidden otherwise, and would draw its table when another prints.
  // The files are the ones the result was read from, for any change to
  // them drops it.
  const printed = useMemo(
    () => (active && result ? { result, files: files as SourceFile[] } : null),
    [active, result, files],
  );
  const paper = useSheetPrint(printed, lang, composeSheet);
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
  function state(): AssetInput {
    return {
      files: files as AssetInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function install(v: { state: AssetInput; result: AssetResult }) {
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
    ASSET_FIELDS.every((k) => scope[k]);
  function updateScope(key: AssetField, value: string) {
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
    ...ASSET_FIELDS.map((k) =>
      suggestions[k].read.reduce((n, r) => n + r.rows, 0),
    ),
  );
  async function upload(file: File, source: number) {
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('ASSET_SOURCE');
        return workerTask<SourceFile>(
          'asset-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as AssetInput['readings'];
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
            'asset-read',
            {
              name: `source-${i}.csv`,
              buffer: new TextEncoder().encode(assetDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: AssetInput = {
        files: f as AssetInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as AssetInput['readings'],
        scope: { ...assetDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: copy.syntheticRef,
          note: copy.syntheticNote,
        },
        events: [],
      };
      return workerTask<{
        state: AssetInput;
        result: AssetResult;
      }>('asset-reconcile', s, signal);
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
  async function decide(type: AssetEvent['type']) {
    if (!result) return;
    const e: AssetEvent = {
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
        workerTask<{ state: AssetInput; result: AssetResult }>(
          'asset-reconcile',
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
        data-asset-workspace
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
                        throw Error('ASSET_SESSION');
                      return workerTask<{
                        state: AssetInput;
                        result: AssetResult;
                      }>(
                        'asset-restore',
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
          {ASSET_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              {i === 0 && (
                <label>
                  {copy.registerFormat}
                  <select
                    aria-label={copy.registerFormat}
                    value={reading[0].family}
                    onChange={(e) => {
                      const family = e.target.value;
                      if (
                        family !== ASSET_VERSION &&
                        family !== ASSET_LONG_FAMILY
                      )
                        return;
                      const next = [...reading] as AssetInput['readings'];
                      next[0] = { ...next[0], family, confirmed: false };
                      setReading(next);
                      setComplete({ ...complete, confirmed: false });
                      invalidate();
                    }}
                  >
                    <option value={ASSET_VERSION}>
                      {copy.horizontalFormat}
                    </option>
                    <option value={ASSET_LONG_FAMILY}>{copy.longFormat}</option>
                  </select>
                  <span>{copy.registerFormatHint}</span>
                </label>
              )}
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
                  scopeValue(scope.entity),
                  scopeValue(scope.assetLedger, true),
                  scopeValue(scope.glLedger, true),
                  scopeValue(scope.asOf, true),
                  scopeValue(scope.currency, true),
                  rowsRead,
                )}
              />
            }
            rows={ASSET_FIELDS.map((k) => {
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
                        })) as AssetInput['readings'],
                    );
                    card.confirm(confirmed);
                    invalidate();
                  }}
                />
                <span>
                  <Sentence
                    parts={copy.cardConfirm(
                      scopeValue(scope.entity),
                      scopeValue(scope.asOf, true),
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
                  workerTask<{ state: AssetInput; result: AssetResult }>(
                    'asset-reconcile',
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
                  workerTask<ArrayBuffer>('asset-save', state(), signal),
                (b) =>
                  download(
                    b,
                    'tarasuf-assets-session.json',
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
                    'asset-export',
                    { state: state(), result, lang },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-assets-evidence.xlsx',
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
        {error && <p role="alert">{copy.failed}</p>}
        {result && (
          <section className="workspace-results" data-asset-result>
            <h2
              {...resultParts.anchor('summary')}
              data-asset-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <AlignmentStrip
              strip={assetStrip(result)}
              sides={[copy.roles[0], copy.roles[3]]}
              decimals={result.decimals}
              name={(key) =>
                copy.components[key as keyof typeof copy.components] ?? key
              }
              state={status(result.status)}
            />
            <ResultIndex map={resultParts} />
            <DomainEvidenceAssistant
              anchor={resultParts.anchor('explain')}
              result={result}
              snapshot={() => ({
                domain: 'fixed-assets',
                input: state(),
                result,
              })}
              busy={busy}
              replay={async (captured) => {
                if (captured.domain !== 'fixed-assets') throw Error('DOMAIN');
                const fresh = await perform(
                  (signal) =>
                    workerTask<{ state: AssetInput; result: AssetResult }>(
                      'asset-reconcile',
                      captured.input,
                      signal,
                    ),
                  () => {},
                );
                if (!fresh) throw Error('STALE_EVIDENCE_REPLY');
                return {
                  domain: 'fixed-assets',
                  input: fresh.state,
                  result: fresh.result,
                };
              }}
            />
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>.{' '}
              {copy.componentsNote}
            </p>
            <RecordTable
              anchor={resultParts.anchor('figures')}
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={[...ASSET_COMPONENTS, 'carrying' as const].map((k) => [
                copy.components[k],
                amount(result.totals?.register[k]),
                amount(result.totals?.gl[k]),
              ])}
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
                  result.readings[0].family === ASSET_LONG_FAMILY
                    ? [copy.physicalRows, ...copy.records[0].slice(1)]
                    : copy.records[0],
                  result.records[0].map((v) => [
                    v.representation === 'long-components'
                      ? v.componentEvidence!.map((e) => e.row).join(', ')
                      : v.row,
                    v.asset,
                    v.dimensions,
                    amount(v.cost),
                    amount(v.depreciation),
                    amount(v.impairment),
                    amount(v.carrying),
                    v.valuation,
                  ]),
                ),
                ...(result.componentEvidence
                  ? [
                      section(
                        'componentEvidence',
                        copy.componentEvidence,
                        copy.componentEvidenceHeaders,
                        result.componentEvidence.map((v) => [
                          v.row,
                          v.column,
                          v.asset,
                          v.dimensions,
                          copy.components[
                            v.component as keyof typeof copy.components
                          ] ?? v.component,
                          v.present ? copy.presentCell : copy.absentCell,
                          v.present && v.text === '' ? copy.emptyCell : v.text,
                          amount(v.minor),
                          v.valuation,
                          v.memberId,
                          v.sourceHash,
                          v.context,
                        ]),
                      ),
                    ]
                  : []),
                section(
                  'records.1',
                  copy.roles[1],
                  copy.records[1],
                  result.records[1].map((v) => [
                    v.row,
                    v.id,
                    v.asset,
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
                    v.asset,
                    v.dimensions,
                    copy.components[v.component],
                    v.valuation,
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
                    v.account,
                    v.glDimensions,
                    v.accountClass,
                    amount(v.debit),
                    amount(v.credit),
                    copy.components[v.component],
                    amount(v.normal),
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
        <FixedAssetsSectionsPanel />
      </section>
    </div>
  );
}
