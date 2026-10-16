import { STOCK_PDF_FAMILY } from '../lib/reconciliation/inventory-pdf-register.ts';
import {
  STOCK_PDF_LIFECYCLE_VERSION,
  STOCK_PDF_SESSION_FORMAT,
  type StockPdfState,
} from '../lib/reconciliation/inventory-pdf-request.ts';
import {
  inventoryCompanionScope,
  type StockPdfPreview,
} from '../lib/reconciliation/inventory-pdf-preview.ts';
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
import { useEffect, useRef, useState, useMemo } from 'react';
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
import './gl-tb-workspace.css';
const emptyScope = (): StockScope =>
  ({
    ...Object.fromEntries(STOCK_FIELDS.map((k) => [k, ''])),
    currencyBasis: 'functional',
    postingStatus: 'posted',
    confirmed: false,
  }) as StockScope;
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
function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | null)[][];
}) {
  const { lang } = useI18n();
  const copy = stockCopy[lang];
  const [page, setPage] = useState(0);
  const safe = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  return (
    <>
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
            {rows.slice(safe * 50, safe * 50 + 50).map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{v ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gl-tb-actions">
        <Button
          variant="outline"
          disabled={!safe}
          onClick={() => setPage(safe - 1)}
        >
          {copy.previous}
        </Button>
        <span>
          {safe + 1} / {Math.max(1, Math.ceil(rows.length / 50))} ·{' '}
          {rows.length}
        </span>
        <Button
          variant="outline"
          disabled={(safe + 1) * 50 >= rows.length}
          onClick={() => setPage(safe + 1)}
        >
          {copy.next}
        </Button>
      </div>
    </>
  );
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
  const [reading, setReading] = useState(readings),
    [scope, setScope] = useState(emptyScope);
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
  function install(v: Replay) {
    if (!('version' in v)) {
      setPdf(null);
      setFiles(v.state.files);
    }
    setReading(v.result.readings);
    setScope(v.state.scope);
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
          setScope({ ...emptyScope(), ...value.scope, confirmed: false });
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
        if (pdf && source !== 0) {
          const explicit = inventoryCompanionScope(value);
          setScope((previous) => ({
            ...previous,
            ...Object.fromEntries(
              Object.entries(explicit).filter(
                ([key]) => !previous[key as keyof StockScope],
              ),
            ),
            confirmed: false,
          }));
        }
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
        if (source === 0 && structured(value)) {
          const suggested = sourceScope(value);
          if (suggested)
            setScope({ ...emptyScope(), ...suggested, confirmed: false });
          else setScope({ ...scope, confirmed: false });
        } else if (
          source === 0 &&
          [
            STOCK_SECTION_FAMILY,
            STOCK_MATRIX_FAMILY,
            STOCK_HIERARCHY_FAMILY,
            STOCK_COLUMN_FAMILY,
          ].includes(reading[0].family)
        )
          setScope({ ...scope, confirmed: false });
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
    }, install);
  }
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
    await perform((signal) => compute(signal, [...events, e]), install);
  }
  const status = (value: string) =>
    (copy.status as Record<string, string>)[value] ?? value;
  const canAccept =
    result &&
    complete.confirmed &&
    !result.issues.length &&
    !result.missing.length &&
    result.financial === 'ready';
  const detail = (
    title: string,
    headers: string[],
    rows: (string | number | null)[][],
    fingerprint?: string,
  ) => (
    <WorkspaceAdvanced
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
      <Table headers={headers} rows={rows} />
    </WorkspaceAdvanced>
  );
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
        <WorkspaceIntro title={copy.title} intro={copy.intro}>
          <p>{copy.claim}</p>
          <p>{copy.family}</p>
        </WorkspaceIntro>
        <WorkspaceAdvanced>
          <div className="gl-tb-actions workspace-toolbar">
            <Button disabled={busy} onClick={() => void demo()}>
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
                          install(value.replay);
                        } else install(value);
                      },
                    );
                }}
              />
            </label>
          </div>
        </WorkspaceAdvanced>
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
                  <label>
                    <input
                      type="checkbox"
                      checked={reading[0].confirmed}
                      onChange={(e) => {
                        const next = [...reading] as StockInput['readings'];
                        next[0] = { ...next[0], confirmed: e.target.checked };
                        setReading(next);
                        invalidate();
                      }}
                    />
                    {copy.roleConfirm}
                  </label>
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
                  <label>
                    <input
                      type="checkbox"
                      checked={reading[i].confirmed}
                      onChange={(e) => {
                        const next = [...reading] as StockInput['readings'];
                        next[i] = { ...next[i], confirmed: e.target.checked };
                        setReading(next);
                        invalidate();
                      }}
                    />
                    {copy.roleConfirm}
                  </label>
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
          <legend>{copy.scopeTitle}</legend>
          <div className="gl-tb-grid">
            {STOCK_FIELDS.map((k) => (
              <label key={k}>
                {copy.scope[k]}
                <input
                  aria-label={copy.scopePrefix + copy.scope[k]}
                  maxLength={500}
                  value={scope[k]}
                  onChange={(e) => {
                    setScope({
                      ...scope,
                      [k]: e.target.value,
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
            {copy.scopeConfirm}
          </label>
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
            onClick={() => void perform((signal) => compute(signal), install)}
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
                      : { state: state(), result },
                    signal,
                  ),
                (b) =>
                  download(
                    b,
                    `tarasuf-inventory-evidence-${lang}.xlsx`,
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
            {pdf ? (
              <DomainEvidenceAssistant
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
            <h2 data-stock-status>{status(result.status)}</h2>
            <p>
              {copy.units} · {result.scope.currency} · {result.decimals}
            </p>
            <Table
              headers={copy.totals}
              rows={
                result.totals
                  ? [[result.totals.registerMinor, result.totals.glMinor]]
                  : []
              }
            />
            <Table
              headers={copy.comparisons}
              rows={result.comparisons.map((v) => [
                v.account,
                v.dimensions,
                v.registerMinor,
                v.debitMinor,
                v.creditMinor,
                v.glMinor,
                v.differenceMinor,
              ])}
            />
            <fieldset disabled={busy}>
              <legend>{copy.decision}</legend>
              <label>
                {copy.reference}
                <input
                  maxLength={2000}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                {copy.note}
                <input
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>
                {status(result.review)} · {copy.members}:{' '}
                {result.memberIds.length}
              </p>
              <div className="gl-tb-actions">
                {(['accept', 'reject', 'undo'] as const).map((type) => (
                  <Button
                    key={type}
                    variant="outline"
                    disabled={
                      busy ||
                      !reference.trim() ||
                      !note.trim() ||
                      !result.memberIds.length ||
                      (type === 'undo'
                        ? result.review === 'needs-review'
                        : result.review !== 'needs-review') ||
                      (type === 'accept' && !canAccept)
                    }
                    onClick={() => void decide(type)}
                  >
                    {copy[type]}
                  </Button>
                ))}
              </div>
            </fieldset>
            {result.records.map((rows, i) => (
              <div key={i}>
                {detail(
                  copy.roles[i],
                  i === 0 && (result.matrixEvidence || result.columnEvidence)
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
                    ...v.values,
                  ]),
                )}
              </div>
            ))}
            {detail(
              copy.members,
              copy.memberHeaders,
              result.memberIds.map((id) => {
                const v = JSON.parse(id);
                return [copy.roles[v[1]], v[4], id];
              }),
            )}
            {detail(
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
            )}
            {detail(
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
            )}
            {detail(
              copy.cells,
              copy.cellHeaders,
              result.cells.map((v) => [
                copy.roles[v.source],
                v.row,
                v.column,
                v.field,
                v.text,
              ]),
            )}
            {detail(
              copy.inventory,
              copy.inventoryHeaders,
              result.inventory.map((v) => [
                copy.roles[v.source],
                v.row,
                copy.kinds[v.kind],
              ]),
            )}
            {detail(
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
            )}
            {detail(
              copy.sources,
              copy.sourceHeaders,
              sources.map((f, i) => [copy.roles[i], f!.name, f!.sha256!]),
            )}
          </section>
        )}
      </section>
    </div>
  );
}
