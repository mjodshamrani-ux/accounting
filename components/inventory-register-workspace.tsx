import { STOCK_PDF_FAMILY } from '../lib/reconciliation/inventory-pdf-register.ts';
import {
  STOCK_PDF_LIFECYCLE_VERSION,
  STOCK_PDF_SESSION_FORMAT,
  type StockPdfState,
} from '../lib/reconciliation/inventory-pdf-request.ts';
import type { StockPdfPreview } from '../lib/reconciliation/inventory-pdf-preview.ts';
import type { StockPdfReplay } from '../lib/reconciliation/inventory-register.ts';
import type { DomainEvidenceAnswer } from '../lib/reconciliation/domain-assistant.ts';
import { stockPdfWorkbookTables } from '../lib/reconciliation/inventory-pdf-workbook-evidence.ts';
import {
  inventoryPdfCopy,
  inventoryPdfIssue,
} from '../lib/i18n/inventory-pdf.ts';
import {
  STOCK_COLUMN_FAMILY,
  isInventoryColumnHierarchy,
} from '../lib/reconciliation/inventory-column-hierarchy.ts';
import { stockColumnCitationRows } from '../lib/reconciliation/inventory-column-evidence.ts';
import {
  STOCK_HIERARCHY_FAMILY,
  isInventoryHierarchy,
  inventoryHierarchyScope,
} from '../lib/reconciliation/inventory-hierarchy-sections.ts';
import { stockHierarchyCitationRows } from '../lib/reconciliation/inventory-hierarchy-evidence.ts';
import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { InventoryMovementBridgePanel } from '@/components/inventory-movement-bridge-panel';
import { useEffect, useId, useRef, useState, useMemo, type ReactNode } from 'react';
import { useResultFocus } from '@/components/result-focus';
import { Amount, Quantity } from '@/components/amount';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import {
  EvidenceSections,
  type EvidenceSection,
} from '@/components/evidence-sections';
import { stockStrip } from '@/lib/alignment-strip';
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
  STOCK_VERSION,
  STOCK_SECTION_FAMILY,
  STOCK_MATRIX_FAMILY,
  STOCK_SCOPE_HEADERS,
  STOCK_ROLES,
  STOCK_FIELDS,
  type StockInput,
  type StockScope,
  type StockResult,
  type StockEvent,
} from '@/lib/reconciliation/inventory-register';
import {
  stockDemo,
  stockDemoScope,
} from '@/lib/reconciliation/inventory-register-demo';
import {
  stockSectionCitationRows,
  stockSourceObservations,
} from '@/lib/reconciliation/inventory-section-evidence';
import { stockMatrixCitationRows } from '@/lib/reconciliation/inventory-matrix-evidence';
import { stockCopy } from '@/lib/i18n/inventory-register';
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
const emptyScope = (): StockScope =>
  ({
    ...Object.fromEntries(STOCK_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    postingStatus: 'posted',
    confirmed: false,
  }) as StockScope;
type StockField = (typeof STOCK_FIELDS)[number];
// What the card may put in each field (UX-5(d)): the two one-option selects
// take only the value the engine accepts, and start from it while no file
// has the column; the date takes only YYYY-MM-DD.
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
} as const;
const oneOption = (k: StockField): k is keyof typeof ONLY => k in ONLY;
const isDate = (k: StockField) => k === 'asOf';
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const scopeRules: DeclaredScopeRule<StockField>[] = STOCK_FIELDS.map(
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
// The flat originals write the scope columns on every row, as the engine's
// row check reads them; a structured or printed register writes its scope
// once, in its scope block, which its own engine compares with the scope.
const scopeColumns = STOCK_FIELDS.map((field, i) => ({
  field,
  header: STOCK_SCOPE_HEADERS[i],
}));
const freshOrigins = () =>
  Object.fromEntries(
    scopeRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<StockField, ScopeOrigin>;
const readings = () =>
  STOCK_ROLES.map((role) => ({
    sheet: 0,
    role,
    family: STOCK_VERSION,
    confirmed: false,
  })) as StockInput['readings'];
function structured(file: SourceFile) {
  return (
    isInventoryHierarchy(file) ||
    /\.xlsx$/i.test(file.name) ||
    (file.sheets[0]?.rows[0]?.[0] === 'Format' &&
      ['INV1A-SECTIONS-1', 'INV1A-MATRIX-1'].includes(
        file.sheets[0]?.rows[0]?.[1] ?? '',
      ))
  );
}
function sourceScope(file: SourceFile): Partial<StockScope> | null {
  if (isInventoryHierarchy(file)) return inventoryHierarchyScope(file);
  if (
    file.sheets[0]?.rows[0]?.[0] !== 'Format' ||
    !['INV1A-SECTIONS-1', 'INV1A-MATRIX-1'].includes(
      file.sheets[0]?.rows[0]?.[1] ?? '',
    )
  )
    return null;
  const scope: Partial<StockScope> = {};
  for (const original of file.sheets[0].rows.slice(1)) {
    const row = [...original];
    while (row.at(-1) === '') row.pop();
    if (!row.length) continue;
    if (row[0] === 'Section' || row[0] === 'Field') break;
    const key = STOCK_FIELDS[STOCK_SCOPE_HEADERS.indexOf(row[1])];
    if (
      row.length !== 3 ||
      row[0] !== 'Scope' ||
      !key ||
      scope[key] !== undefined ||
      !row[2] ||
      row[2] !== row[2].trim()
    )
      return null;
    scope[key] = row[2];
  }
  return STOCK_FIELDS.every((key) => typeof scope[key] === 'string')
    ? scope
    : null;
}
/** The register's scope block, where its family writes one: the printed
 *  register's scope lines, or a structured register's Scope rows. */
function registerBlock(
  register: SourceFile | null,
  preview: StockPdfPreview | null,
): Partial<StockScope> | undefined {
  if (preview) return preview.scope;
  if (register && structured(register))
    return sourceScope(register) ?? undefined;
  return undefined;
}
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function StockWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { lang } = useI18n();
  const copy = stockCopy[lang];
  const [files, setFiles] = useState<(SourceFile | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [pdf, setPdf] = useState<StockPdfPreview | null>(null);
  const pdfCopy = inventoryPdfCopy[lang];
  const hasRegister = !!(pdf || files[0]);
  const sources = [pdf ?? files[0], ...files.slice(1)];
  const previewRows = useMemo(() => {
    if (!pdf) return [];
    const maps = pdf.reading.source.pages.map(
      (p) => new Map(p.tokens.map((t) => [t.item, t.text])),
    );
    return pdf.reading.inventory.map((l) => [
      l.page,
      l.line,
      l.kind,
      l.items.map((i) => maps[l.page - 1]?.get(i) ?? '').join(' '),
    ]);
  }, [pdf]);
  const [reading, setReading] = useState(readings);
  // The card's scope and where each value came from (UX-5(d)): a new file
  // fills what the four files agree on into the fields the accountant has
  // not entered, and a value it changes drops the confirmation.
  const blocks = useMemo(
    () => [registerBlock(files[0], pdf), undefined, undefined, undefined],
    [files, pdf],
  );
  const card = useDeclaredScope({
    initial: () => ({ scope: emptyScope(), origins: freshOrigins() }),
    rules: scopeRules,
    columns: scopeColumns,
    files,
    sheets: reading.map((r) => r.sheet),
    labels: copy.roles,
    blocks,
  });
  const { scope, origins, suggestions } = card;
  const [complete, setComplete] = useState<StockInput['completeness']>({
    confirmed: false,
    reference: '',
    note: '',
  });
  const [events, setEvents] = useState<StockEvent[]>([]),
    [result, setResult] = useState<StockResult | null>(null);
  const pdfTables = useMemo(
    () => (result?.pdfEvidence ? stockPdfWorkbookTables(result, false) : []),
    [result],
  );
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
  function state(): StockInput {
    if (pdf) throw Error('STOCK_PDF_LEGACY_INPUT');
    return {
      files: files as StockInput['files'],
      readings: reading,
      scope,
      completeness: complete,
      events,
    };
  }
  function pdfState(nextEvents = events): StockPdfState {
    if (!pdf || !files.slice(1).every(Boolean))
      throw Error('STOCK_PDF_REQUEST');
    return {
      version: STOCK_PDF_LIFECYCLE_VERSION,
      files: sources.map((f) => ({
        name: f!.name,
        sha256: f!.sha256!,
        original: f!.original!,
      })) as StockPdfState['files'],
      scope,
      completeness: complete,
      events: nextEvents,
    };
  }
  type Replay = { state: StockInput; result: StockResult } | StockPdfReplay;
  // A printed register restored from a session comes with its preview and
  // its companions, which are not on screen yet when the session installs.
  function install(
    v: Replay,
    printed?: { preview: StockPdfPreview; companion: SourceFile[] },
  ) {
    const fromPdf = 'version' in v;
    if (!fromPdf) {
      setPdf(null);
      setFiles(v.state.files);
    }
    setReading(v.result.readings);
    card.install(
      v.state.scope,
      fromPdf ? [null, ...(printed?.companion ?? files.slice(1))] : v.state.files,
      v.result.readings.map((r) => r.sheet),
      [
        fromPdf
          ? registerBlock(null, printed?.preview ?? pdf)
          : registerBlock(v.state.files[0], null),
      ],
    );
    setComplete(v.state.completeness);
    setEvents(v.state.events);
    setResult(v.result);
  }
  const compute = (signal: AbortSignal, nextEvents = events) =>
    pdf
      ? workerTask<StockPdfReplay>(
          'stock-pdf-reconcile',
          pdfState(nextEvents),
          signal,
        )
      : workerTask<{ state: StockInput; result: StockResult }>(
          'stock-reconcile',
          { ...state(), events: nextEvents },
          signal,
        );
  async function restoreSession(f: File, signal: AbortSignal) {
    if (f.size > 64 * 1024 * 1024) throw Error('STOCK_SESSION');
    const buffer = await f.arrayBuffer();
    const format = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    ).format;
    if (format !== STOCK_PDF_SESSION_FORMAT)
      return workerTask<{ state: StockInput; result: StockResult }>(
        'stock-restore',
        { buffer },
        signal,
      );
    const replay = await workerTask<StockPdfReplay>(
      'stock-pdf-restore',
      { buffer },
      signal,
    );
    const preview = await workerTask<StockPdfPreview>(
      'stock-pdf-read',
      {
        name: replay.state.files[0].name,
        buffer: replay.state.files[0].original,
      },
      signal,
    );
    const companion: SourceFile[] = [];
    for (const f of replay.state.files.slice(1))
      companion.push(
        await workerTask<SourceFile>(
          'stock-read',
          { name: f.name, buffer: f.original },
          signal,
        ),
      );
    return { replay, preview, companion };
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const resultParts = useResultParts([
    'summary',
    'explain',
    'figures',
    'links',
    'decision',
    'evidence',
  ]);
  const shown: typeof install = (v, printed) => {
    install(v, printed);
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
  function updateScope(key: StockField, value: string) {
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
  // Rows read from the files that write the scope on every row; a register
  // that states it once, in its scope block, is said apart.
  const rowsRead = Math.max(
    0,
    ...STOCK_FIELDS.map((k) =>
      suggestions[k].read
        .filter((r) => !r.block)
        .reduce((n, r) => n + r.rows, 0),
    ),
  );
  const blockRead = STOCK_FIELDS.some((k) =>
    suggestions[k].read.some((r) => r.block),
  );
  // "The four files" only when each of the four was read row by row; a
  // printed register refused before its scope lines is not one of them.
  const rowSources = new Set(
    STOCK_FIELDS.flatMap((k) =>
      suggestions[k].read.filter((r) => !r.block).map((r) => r.label),
    ),
  );
  const said = blockRead
    ? 'block'
    : rowSources.size === copy.roles.length
      ? 'four'
      : 'files';
  const ready =
    hasRegister &&
    files.slice(1).every(Boolean) &&
    reading.every((r) => r.confirmed) &&
    scope.confirmed &&
    STOCK_FIELDS.every((k) => scope[k]);
  async function upload(file: File, source: number) {
    if (runtime.current.running) return;
    if (pdf || (source === 0 && /\.pdf$/i.test(file.name))) invalidate();
    if (source === 0 && /\.pdf$/i.test(file.name)) {
      await perform(
        async (signal) => {
          if (file.size > MAX_FILE_BYTES) throw Error('STOCK_SOURCE');
          return workerTask<StockPdfPreview>(
            'stock-pdf-read',
            { name: file.name, buffer: await file.arrayBuffer() },
            signal,
          );
        },
        (value) => {
          setPdf(value);
          setFiles([null, ...files.slice(1)]);
          const next = [...reading] as StockInput['readings'];
          next[0] = { ...next[0], family: STOCK_PDF_FAMILY, confirmed: false };
          setReading(next);
          setComplete({ ...complete, confirmed: false });
        },
      );
      return;
    }
    await perform(
      async (signal) => {
        if (file.size > MAX_FILE_BYTES) throw Error('STOCK_SOURCE');
        return workerTask<SourceFile>(
          'stock-read',
          { name: file.name, buffer: await file.arrayBuffer() },
          signal,
        );
      },
      (value) => {
        if (source === 0) setPdf(null);
        const next = [...files];
        next[source] = value;
        setFiles(next);
        const r = [...reading] as StockInput['readings'];
        r[source] = {
          ...r[source],
          family:
            source === 0 && isInventoryColumnHierarchy(value)
              ? STOCK_COLUMN_FAMILY
              : source === 0 && isInventoryHierarchy(value)
                ? STOCK_HIERARCHY_FAMILY
                : source === 0 &&
                    value.sheets[0]?.rows[0]?.[1] === 'INV1A-MATRIX-1'
                  ? STOCK_MATRIX_FAMILY
                  : source === 0 && structured(value)
                    ? STOCK_SECTION_FAMILY
                    : STOCK_VERSION,
          confirmed: false,
        };
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
            'stock-read',
            {
              name: `source-${i}.csv`,
              buffer: new TextEncoder().encode(stockDemo[i]).buffer,
            },
            signal,
          ),
        );
      const s: StockInput = {
        files: f as StockInput['files'],
        readings: readings().map((r) => ({
          ...r,
          confirmed: true,
        })) as StockInput['readings'],
        scope: { ...stockDemoScope, confirmed: true },
        completeness: {
          confirmed: true,
          reference: copy.syntheticRef,
          note: copy.syntheticNote,
        },
        events: [],
      };
      return workerTask<{
        state: StockInput;
        result: StockResult;
      }>('stock-reconcile', s, signal);
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
  async function decide(type: StockEvent['type']) {
    if (!result) return;
    const e: StockEvent = {
      id: crypto.randomUUID(),
      type,
      memberIds: [...result.memberIds],
      context: result.context,
      at: new Date().toISOString(),
      reference,
      note,
    };
    await perform((signal) => compute(signal, [...events, e]), decided);
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
  // Money is shown in major units at the currency's precision, and the
  // register's quantity as a decimal at its own precision; the engine keeps
  // both as integers. Register values: item, dimensions, quantity, unit,
  // quantity precision, posted value, valuation reference. GL values:
  // account, dimensions, class, debit, credit.
  const amount = (minor: number | null | undefined) => (
    <Amount minor={minor} decimals={result?.decimals ?? 2} />
  );
  const recordCells = (role: number, values: (string | number | null)[]) =>
    values.map((v, j): ReactNode =>
      role === 0 && j === 2 && typeof v === 'number' ? (
        <Quantity key={j} scaled={v} precision={Number(values[4])} />
      ) : ((role === 0 && j === 5) || (role === 3 && (j === 3 || j === 4))) &&
        typeof v === 'number' ? (
        <Amount key={j} minor={v} decimals={result?.decimals ?? 2} />
      ) : (
        v
      ),
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
        data-stock-workspace
        aria-busy={busy}
      >
        <WorkspaceHeader
          onBack={onBack}
          backLabel={copy.back}
          disabled={busy}
          hasWork={sources.some(Boolean)}
        />
        <WorkspaceIntro title={copy.title} intro={copy.intro} detail={copy.introDetail}>
          <p>{copy.claim}</p>
          <p>{copy.family}</p>
        </WorkspaceIntro>
        <WorkspaceStart>
          <div className="gl-tb-actions workspace-toolbar">
            <Button variant="outline" disabled={busy} onClick={() => void demo()}>
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
                    void perform(
                      (signal) => restoreSession(f, signal),
                      (value) => {
                        if ('replay' in value) {
                          setPdf(value.preview);
                          setFiles([null, ...value.companion]);
                          shown(value.replay, value);
                        } else shown(value);
                      },
                    );
                }}
              />
            </label>
          </div>
        </WorkspaceStart>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 3]}
          primaryReady={!!(hasRegister && files[3])}
        >
          {STOCK_ROLES.map((role, i) => (
            <fieldset key={role} disabled={busy} className="workspace-source">
              <legend>
                <WorkspaceSourceHeading>{copy.roles[i]}</WorkspaceSourceHeading>
              </legend>
              <WorkspaceFileInput
                aria-label={copy.roles[i]}
                type="file"
                accept={i === 0 ? '.csv,.xlsx,.pdf' : '.csv'}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, i);
                }}
              />
              {i === 0 && pdf && (
                <>
                  <p>
                    <bdi>{pdf.name}</bdi>
                  </p>
                  <p>{pdfCopy.detected}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(pdf.original, pdf.name, 'application/pdf')
                    }
                  >
                    {pdfCopy.original}
                  </Button>
                  {detail(
                    pdfCopy.preview,
                    pdfCopy.previewHeaders,
                    previewRows,
                    pdf.sha256,
                  )}
                  {pdf.reading.issues.length > 0 &&
                    detail(
                      pdfCopy.diagnostics,
                      pdfCopy.diagnosticHeaders,
                      pdf.reading.issues.map((v) => [v.page, v.line, v.code]),
                    )}
                </>
              )}
              {files[i] && (
                <>
                  <p>
                    <bdi>{files[i]!.name}</bdi>
                  </p>
                  {i === 0 && structured(files[i]!) && (
                    <p>
                      {reading[i].family === STOCK_COLUMN_FAMILY
                        ? copy.columnDetected
                        : reading[i].family === STOCK_HIERARCHY_FAMILY
                          ? copy.hierarchyDetected
                          : reading[i].family === STOCK_MATRIX_FAMILY
                            ? copy.matrixDetected
                            : copy.sectionsDetected}
                    </p>
                  )}
                  {i === 0 && structured(files[i]!)
                    ? detail(
                        copy.roles[i],
                        [
                          copy.sourceRow,
                          ...Array.from(
                            {
                              length: Math.max(
                                1,
                                ...files[i]!.sheets[0].rows.map(
                                  (row) => row.length,
                                ),
                              ),
                            },
                            (_, column) => copy.sourceColumn + (column + 1),
                          ),
                        ],
                        files[i]!.sheets[0].rows.map((row, index) => [
                          index + 1,
                          ...row,
                        ]),
                        files[i]!.sha256,
                      )
                    : detail(
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
        <fieldset disabled={busy} hidden={!(hasRegister && files[3])}>
          <ScopeCard
            hidden={!(hasRegister && files[3])}
            summary={
              <Sentence
                parts={copy.cardSummary(
                  scopeValue(scope.entity),
                  scopeValue(scope.inventoryLedger, true),
                  scopeValue(scope.glLedger, true),
                  scopeValue(scope.asOf, true),
                  scopeValue(scope.currency, true),
                  rowsRead,
                  said,
                )}
              />
            }
            rows={STOCK_FIELDS.map((k) => {
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
                        })) as StockInput['readings'],
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
          {busy && (
            <Button variant="outline" onClick={cancel}>
              {copy.cancel}
            </Button>
          )}
          <Button
            disabled={busy || !ready}
            onClick={() => void perform((signal) => compute(signal), shown)}
          >
            {copy.compare}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !result}
            onClick={() =>
              void perform(
                (signal) =>
                  workerTask<ArrayBuffer>(
                    pdf ? 'stock-pdf-save' : 'stock-save',
                    pdf ? pdfState() : state(),
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    'tarasuf-inventory-session.json',
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
                    pdf ? 'stock-pdf-export' : 'stock-export',
                    pdf
                      ? { state: pdfState(), result, language: lang }
                      : { state: state(), result, lang },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    pdf
                      ? `tarasuf-inventory-evidence-${lang}.xlsx`
                      : 'tarasuf-inventory-evidence.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
              )
            }
          >
            {copy.export}
          </Button>
        </div>
        {pdf && result && <p className="muted">{pdfCopy.exportNote}</p>}
        {error && (
          <p role="alert" data-stock-error>
            {pdfCopy.failed} <bdi>{error}</bdi>
          </p>
        )}
        {result && (
          <section className="workspace-results">
            <h2
              {...resultParts.anchor('summary')}
              data-stock-status
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {status(result.status)}
            </h2>
            <AlignmentStrip
              strip={stockStrip(result)}
              sides={[copy.roles[0], copy.roles[3]]}
              decimals={result.decimals}
              state={status(result.status)}
            />
            <ResultIndex map={resultParts} />
            {pdf ? (
              <DomainEvidenceAssistant
                anchor={resultParts.anchor('explain')}
                result={result}
                busy={busy}
                verifiedAnswer={async (question) => {
                  const answer = await perform(
                    (signal) =>
                      workerTask<DomainEvidenceAnswer>(
                        'stock-pdf-ask',
                        { state: pdfState(), result, question },
                        signal,
                      ),
                    () => {},
                  );
                  if (!answer) throw Error('STALE_EVIDENCE_REPLY');
                  return answer;
                }}
              />
            ) : (
              <DomainEvidenceAssistant
                anchor={resultParts.anchor('explain')}
                result={result}
                snapshot={() => ({
                  domain: 'inventory-register',
                  input: state(),
                  result,
                })}
                busy={busy}
                replay={async (captured) => {
                  if (captured.domain !== 'inventory-register')
                    throw Error('DOMAIN');
                  const fresh = await perform(
                    (signal) =>
                      workerTask<{ state: StockInput; result: StockResult }>(
                        'stock-reconcile',
                        captured.input,
                        signal,
                      ),
                    () => {},
                  );
                  if (!fresh) throw Error('STALE_EVIDENCE_REPLY');
                  return {
                    domain: 'inventory-register',
                    input: fresh.state,
                    result: fresh.result,
                  };
                }}
              />
            )}
            {result.pdfEvidence &&
              pdfTables
                .filter((t) =>
                  [
                    'PDF records',
                    'PDF links',
                    'PDF controls',
                    'PDF diagnostics',
                  ].includes(t.name),
                )
                .map((t) => (
                  <div key={t.name}>
                    {detail(
                      t.name === 'PDF records'
                        ? pdfCopy.fields
                        : t.name === 'PDF links'
                          ? pdfCopy.links
                          : t.name === 'PDF controls'
                            ? pdfCopy.controls
                            : pdfCopy.diagnostics,
                      t.name === 'PDF records'
                        ? pdfCopy.fieldsHeaders
                        : t.name === 'PDF links'
                          ? pdfCopy.linkHeaders
                          : t.name === 'PDF controls'
                            ? pdfCopy.controlHeaders
                            : pdfCopy.diagnosticHeaders,
                      t.rows,
                    )}
                  </div>
                ))}
            {result.sectionEvidence &&
              detail(
                copy.sectionCitations,
                copy.sectionCitationHeaders,
                stockSectionCitationRows(result.sectionEvidence),
              )}
            {result.columnEvidence &&
              detail(
                copy.columnCitations,
                copy.columnCitationHeaders,
                stockColumnCitationRows(result.columnEvidence),
              )}
            {result.hierarchyEvidence &&
              detail(
                copy.hierarchyCitations,
                copy.hierarchyCitationHeaders,
                stockHierarchyCitationRows(result.hierarchyEvidence),
              )}
            {result.matrixEvidence &&
              detail(
                copy.matrixCitations,
                copy.matrixCitationHeaders,
                stockMatrixCitationRows(result.matrixEvidence),
              )}
            {(result.sectionEvidence ||
              result.matrixEvidence ||
              result.hierarchyEvidence ||
              result.columnEvidence) &&
              stockSourceObservations(files).length > 0 &&
              detail(
                copy.observations,
                copy.observationHeaders,
                stockSourceObservations(files),
              )}
            <p>
              {copy.amountsIn} <bdi dir="ltr">{result.scope.currency}</bdi>.{' '}
              {copy.quantityNote}
            </p>
            <RecordTable
              anchor={resultParts.anchor('figures')}
              label={copy.tableNames.totals}
              headers={copy.totals}
              rows={
                result.totals
                  ? [
                      [
                        amount(result.totals.registerMinor),
                        amount(result.totals.glMinor),
                      ],
                    ]
                  : []
              }
            />
            <RecordTable
              label={copy.tableNames.comparisons}
              headers={copy.comparisons}
              rows={result.comparisons.map((v) => [
                v.account,
                v.dimensions,
                amount(v.registerMinor),
                amount(v.debitMinor),
                amount(v.creditMinor),
                amount(v.glMinor),
                amount(v.differenceMinor),
              ])}
            />
            <section
              {...resultParts.anchor('links')}
              data-stock-links
              data-stock-linked={
                result.links.filter((l) => l.status === 'linked').length
              }
              aria-label={copy.links}
            >
              <h3>{copy.links}</h3>
              <p>
                {copy.linksSummary}:{' '}
                {result.links.filter((l) => l.status === 'linked').length} /{' '}
                {result.links.length}
              </p>
              {result.links.some((l) => l.status === 'unlinked') ? (
                <>
                  <h4>{copy.unlinkedTitle}</h4>
                  <RecordTable
                    label={copy.unlinkedTitle}
                    headers={copy.unlinkedHeaders}
                    pager={{ 'data-stock-pager': 'unlinked' }}
                    rows={result.links
                      .filter((l) => l.status === 'unlinked')
                      .map((l) => [
                        l.column === undefined ? l.row : `${l.row} · ${l.column}`,
                        l.item,
                        l.dimensions,
                        l.reasons
                          .map((c) => `${copy.linkReasons[c]} (${c})`)
                          .join(copy.linkSemi),
                        l.mappings.map((m) => m.row).join(copy.linkComma) ||
                          null,
                        l.evidence.map((e) => e.row).join(copy.linkComma) ||
                          null,
                        l.account &&
                          `${l.account.account} · ${l.account.dimensions}`,
                      ])}
                    marks={result.links
                      .filter((l) => l.status === 'unlinked')
                      .map((l) => ({
                        'data-stock-unlinked-row': String(l.row),
                        'data-stock-unlinked-reasons': l.reasons.join(' '),
                        'data-stock-unlinked-related': JSON.stringify([
                          l.mappings.map((m) => m.row),
                          l.evidence.map((e) => e.row),
                          l.account &&
                            `${l.account.account}|${l.account.dimensions}`,
                          l.gl.map((g) => g.row),
                        ]),
                      }))}
                  />
                </>
              ) : (
                <p data-stock-all-linked>{copy.allLinked}</p>
              )}
              {result.unlinked.length > 0 && (
                <>
                  <h4>{copy.othersTitle}</h4>
                  <RecordTable
                    label={copy.othersTitle}
                    headers={copy.othersHeaders}
                    pager={{ 'data-stock-pager': 'others' }}
                    rows={result.unlinked.map((u) => [
                      copy.linkRoles[u.role],
                      u.record?.row ?? null,
                      u.key.join(' · '),
                      `${copy.unlinkedReasons[u.reason]} (${u.reason})`,
                    ])}
                    marks={result.unlinked.map((u) => ({
                      'data-stock-unlinked-record': JSON.stringify([
                        u.role,
                        u.record?.row ?? null,
                        u.key.join('|'),
                        u.reason,
                      ]),
                    }))}
                  />
                </>
              )}
              {!pdf && (
                <div className="gl-tb-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        (signal) =>
                          workerTask<ArrayBuffer>(
                            'stock-links-export',
                            { state: state(), result },
                            signal,
                          ),
                        (b) =>
                          download(
                            b,
                            'tarasuf-inventory-links.xlsx',
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                          ),
                      )
                    }
                  >
                    {copy.exportLinks}
                  </Button>
                </div>
              )}
            </section>
            <fieldset {...resultParts.anchor('decision')} disabled={busy} data-decision-platform>
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
                ...result.records.map((rows, i) => ({
                  key: `records.${i}`,
                  name: copy.roles[i],
                  count: rows.length,
                  node: (
                    <div>
                      {detail(
                        copy.roles[i],
                        i === 0 &&
                          (result.matrixEvidence || result.columnEvidence)
                          ? [
                              copy.records[i][0],
                              copy.matrixSourceColumn,
                              ...copy.records[i].slice(1),
                            ]
                          : copy.records[i],
                        rows.map((v) => [
                          v.row,
                          ...(i === 0 &&
                          (result.matrixEvidence || result.columnEvidence)
                            ? [v.column ?? null]
                            : []),
                          ...recordCells(i, v.values),
                        ]),
                        undefined,
                        undefined,
                        { 'data-evidence-section': `records.${i}` },
                      )}
                    </div>
                  ),
                })),
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
                  [copy.missing],
                  result.missing.map((v) => {
                    const at = v.indexOf(':'),
                      kind = v.slice(0, at),
                      key = v.slice(at + 1);
                    return [
                      (copy.missingKinds as Record<string, string>)[kind] +
                        ' · ' +
                        (kind === 'source' ? copy.roles[Number(key)] : key),
                    ];
                  }),
                ),
                section(
                  'issues',
                  copy.issues,
                  result.matrixEvidence || result.columnEvidence
                    ? [
                        copy.issueHeaders[0],
                        copy.issueHeaders[1],
                        copy.matrixSourceColumn,
                        ...copy.issueHeaders.slice(2),
                      ]
                    : copy.issueHeaders,
                  result.issues.map((v) => [
                    copy.roles[v.source] ?? copy.title,
                    v.row,
                    ...(result.matrixEvidence || result.columnEvidence
                      ? [v.column ?? null]
                      : []),
                    (copy.codes as Record<string, string>)[v.code] ??
                      (pdf ? inventoryPdfIssue(lang, v.code) : copy.failed),
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
                  sources.map((f, i) => [copy.roles[i], f!.name, f!.sha256!]),
                ),
              ]}
            />
          </section>
        )}
        <InventoryMovementBridgePanel />
      </section>
    </div>
  );
}
