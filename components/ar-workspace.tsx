import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
} from './workspace-chrome';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import type {
  ArInput,
  ArReading,
  ArScope,
  ArResult,
  ArEvent,
  ArCase,
} from '@/lib/reconciliation/ar';
import {
  isArScopeReading,
  suggestArScopeReading,
} from '@/lib/reconciliation/ar';
import {
  arScopeDemo,
  arScopeDemoScope,
} from '@/lib/reconciliation/ar-scope-demo';
import {
  arDemo,
  arDemoReadings,
  arDemoScope,
} from '@/lib/reconciliation/ar-demo';
import './clearing-workspace.css';
import './ar-workspace.css';
const columns = [
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'related',
  'description',
] as const;
const scopeColumns = [
  'parent',
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'related',
  'open',
  'description',
] as const;
const readingColumn = (reading: ArReading, key: string) => {
  const value: unknown = Reflect.get(reading, key);
  return typeof value === 'number' ? value : -1;
};
const scopeFields = [
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'start',
  'end',
] as const;
const freshReading = (side: number): ArReading => ({
  ...arDemoReadings[side],
  ...Object.fromEntries(columns.map((k) => [k, -1])),
  confirmed: false,
});
// A printed customer statement (ar-statement-pdf-1) has no columns to map:
// the worker reads its sections from the PDF; the accountant confirms its role.
const statementReading = () =>
  ({
    family: 'ar-statement-pdf-1',
    role: 'company-issued-customer-statement',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: false,
  }) as unknown as ArReading;
const isStatementReading = (reading: ArReading) =>
  (reading as { family?: string }).family === 'ar-statement-pdf-1';
async function pdfSource(file: File): Promise<SourceFile> {
  const original = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', original);
  return {
    name: file.name,
    sha256: [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    original,
    sheets: [],
  };
}
const freshScope = (): ArScope => ({
  entity: '',
  ledger: '',
  customer: '',
  account: '',
  currency: 'SAR',
  start: '',
  end: '',
  confirmed: false,
});
function download(bytes: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ArWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue } = useI18n(),
    t = catalogue.arDocuments;
  const [files, setFiles] = useState<[SourceFile | null, SourceFile | null]>([
    null,
    null,
  ]);
  const [readings, setReadings] = useState<[ArReading, ArReading]>([
    freshReading(0),
    freshReading(1),
  ]);
  const [scope, setScope] = useState(freshScope),
    [events, setEvents] = useState<ArEvent[]>([]),
    [result, setResult] = useState<ArResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [note, setNote] = useState(''),
    [page, setPage] = useState(0),
    [inventoryPage, setInventoryPage] = useState(0);
  const [memberPages, setMemberPages] = useState<Record<string, number>>({});
  const controller = useRef<AbortController | null>(null),
    serial = useRef(0);
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
    setNote('');
    setError(false);
    setPage(0);
    setInventoryPage(0);
    setMemberPages({});
  }
  function install(value: { state: ArInput; result: ArResult }) {
    setFiles(value.state.files);
    setReadings(value.state.readings);
    setScope(value.state.scope);
    setEvents(value.state.events);
    setResult(value.result);
    setPage(0);
    setInventoryPage(0);
    setMemberPages({});
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
  // An example that only loads sources takes the reader to what it loaded.
  const { heading: loadedHeading, reveal: revealLoaded } = useResultFocus();
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current = control;
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
        controller.current = null;
      }
    }
  }
  const input = (): ArInput => ({
    files: files as ArInput['files'],
    readings,
    scope,
    events,
  });
  function cancel() {
    serial.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }
  async function upload(side: 0 | 1, file: File) {
    // Only the customer statement may be a PDF; the ledger stays a table.
    const pdf = side === 1 && /\.pdf$/i.test(file.name);
    if (
      file.size > MAX_FILE_BYTES ||
      !(pdf || /\.(csv|xlsx)$/i.test(file.name))
    ) {
      setError(true);
      return;
    }
    await perform(async (signal) => {
      const source = pdf
        ? await pdfSource(file)
        : await workerTask<SourceFile>(
            'read',
            { name: file.name, buffer: await file.arrayBuffer() },
            signal,
          );
      if (signal.aborted) return;
      const next = [...files] as typeof files;
      next[side] = source;
      setFiles(next);
      setReadings((previous) => {
        const next = [...previous] as typeof readings;
        next[side] = pdf
          ? statementReading()
          : isArScopeReading(previous[side])
            ? suggestArScopeReading(source, side)
            : freshReading(side);
        return next;
      });
      setScope((previous) => ({ ...previous, confirmed: false }));
      invalidate();
    });
  }
  const check = () =>
    perform(async (signal) =>
      shown(await workerTask('ar-reconcile', input(), signal)),
    );
  const decide = (action: ArEvent['action'], target: ArCase) =>
    perform(async (signal) =>
      install(
        await workerTask(
          'ar-reconcile',
          {
            ...input(),
            events: [
              ...events,
              {
                context: result!.context,
                at: new Date().toISOString(),
                action,
                ids: target.ids,
                note,
              },
            ],
          },
          signal,
        ),
      ),
    );
  const rowById = new Map(result?.rows.map((r) => [r.id, r]));
  if (!active) return null;
  return (
    <main
      className="app-shell clearing-workspace ar-workspace reconciliation-workspace"
      data-ar-workspace
      aria-busy={busy}
    >
      <WorkspaceHeader
        onBack={onBack}
        backLabel={t.back}
        disabled={busy}
        hasWork={files.some(Boolean)}
      />
      <WorkspaceIntro title={t.title} intro={t.intro}>
        <p>{t.limits}</p>
        <p>{t.pdfLimits}</p>
      </WorkspaceIntro>
      <fieldset disabled={busy}>
        <WorkspaceAdvanced>
          <div className="clearing-actions workspace-toolbar">
            <Button
              onClick={() =>
                perform(async (signal) => {
                  const source: SourceFile[] = [];
                  for (const demo of arDemo())
                    source.push(await workerTask('read', demo, signal));
                  shown(
                    await workerTask(
                      'ar-reconcile',
                      {
                        files: source,
                        readings: arDemoReadings,
                        scope: arDemoScope,
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
            <Button
              variant="outline"
              onClick={() =>
                perform(async (signal) => {
                  const sources: SourceFile[] = [];
                  for (const demo of arScopeDemo())
                    sources.push(await workerTask('read', demo, signal));
                  setFiles(sources as ArInput['files']);
                  setReadings([
                    suggestArScopeReading(sources[0], 0),
                    suggestArScopeReading(sources[1], 1),
                  ]);
                  setScope({ ...arScopeDemoScope });
                  invalidate();
                  revealLoaded();
                })
              }
            >
              {t.scopeSample}
            </Button>
            <label>
              {t.restore}
              <input
                type="file"
                accept=".json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    if (file.size > 32 * 1024 * 1024) {
                      setError(true);
                      return;
                    }
                    void perform(async (signal) =>
                      shown(
                        await workerTask(
                          'ar-restore',
                          { buffer: await file.arrayBuffer() },
                          signal,
                        ),
                      ),
                    );
                  }
                }}
              />
            </label>
          </div>
        </WorkspaceAdvanced>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 1]}
          primaryReady={!!(files[0] && files[1])}
        >
          {[0, 1].map((value) => {
            const side = value as 0 | 1,
              source = files[side],
              r = readings[side];
            return (
              <section
                className="workspace-source"
                key={side}
                data-testid={`ar-source-${side}`}
              >
                <h2
                  ref={side === 0 ? loadedHeading : undefined}
                  tabIndex={side === 0 ? -1 : undefined}
                  data-result-heading={side === 0 ? 'loaded' : undefined}
                >
                  <WorkspaceSourceHeading>
                    {t.sides[side]}
                  </WorkspaceSourceHeading>
                </h2>
                <label>
                  {t.sides[side]}
                  <WorkspaceFileInput
                    aria-label={t.sides[side]}
                    type="file"
                    accept={side === 1 ? '.csv,.xlsx,.pdf' : '.csv,.xlsx'}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void upload(side, file);
                    }}
                  />
                </label>
                {source && isStatementReading(r) && (
                  <>
                    <h3>{source.name}</h3>
                    <p data-ar-statement-pdf>{t.pdfStatement}</p>
                    <p>{t.pdfReading}</p>
                    <label className="clearing-confirm">
                      <input
                        type="checkbox"
                        checked={r.confirmed}
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] = {
                            ...r,
                            confirmed: event.target.checked,
                          };
                          setReadings(next);
                          invalidate();
                        }}
                      />
                      {t.sides[side]}: {t.pdfReadingConfirm}
                    </label>
                  </>
                )}
                {source && !isStatementReading(r) && (
                  <>
                    <h3>{source.name}</h3>
                    <label>
                      {t.sides[side]}: {t.family}
                      <select
                        aria-label={`${t.sides[side]}: ${t.family}`}
                        value={
                          isArScopeReading(r)
                            ? 'ar-scope-details-1'
                            : 'ar-limited-1'
                        }
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] =
                            event.target.value === 'ar-scope-details-1'
                              ? suggestArScopeReading(source, side, r.sheet)
                              : { ...freshReading(side), sheet: r.sheet };
                          setReadings(next);
                          setScope({ ...scope, confirmed: false });
                          invalidate();
                        }}
                      >
                        <option value="ar-limited-1">{t.rowFamily}</option>
                        <option value="ar-scope-details-1">
                          {t.scopeFamily}
                        </option>
                      </select>
                    </label>
                    <label>
                      {t.sides[side]}: {t.sheet}
                      <select
                        aria-label={`${t.sides[side]}: ${t.sheet}`}
                        value={r.sheet}
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] = isArScopeReading(r)
                            ? suggestArScopeReading(
                                source,
                                side,
                                Number(event.target.value),
                              )
                            : {
                                ...freshReading(side),
                                sheet: Number(event.target.value),
                              };
                          setReadings(next);
                          setScope({ ...scope, confirmed: false });
                          invalidate();
                        }}
                      >
                        {source.sheets.map((sheet, index) => (
                          <option key={index} value={index}>
                            {sheet.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isArScopeReading(r) && (
                      <>
                        <p>{t.scopeReading}</p>
                        <label>
                          {t.sides[side]}: {t.detailHeader}
                          <input
                            aria-label={`${t.sides[side]}: ${t.detailHeader}`}
                            type="number"
                            min={1}
                            max={20030}
                            value={r.header + 1}
                            onChange={(event) => {
                              const next = [...readings] as typeof readings;
                              next[side] = {
                                ...r,
                                header: Number(event.target.value) - 1,
                                confirmed: false,
                              };
                              setReadings(next);
                              invalidate();
                            }}
                          />
                        </label>
                        <WorkspaceAdvanced summary={t.scopeHeader}>
                          <div className="clearing-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>{t.row}</th>
                                  <th>{t.sourceEvidence}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {source.sheets[r.sheet]?.rows
                                  .slice(0, Math.max(0, Math.min(r.header, 30)))
                                  .map((values, index) => (
                                    <tr key={index}>
                                      <td>{index + 1}</td>
                                      <td>{values.join(' | ')}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </WorkspaceAdvanced>
                      </>
                    )}
                    <div className="clearing-grid">
                      {(isArScopeReading(r) ? scopeColumns : columns).map(
                        (key) => (
                          <label key={key}>
                            {t.sides[side]}: {t.fields[key]}
                            <select
                              aria-label={`${t.sides[side]}: ${t.fields[key]}`}
                              value={readingColumn(r, key)}
                              onChange={(event) => {
                                const next = [...readings] as typeof readings;
                                next[side] = {
                                  ...r,
                                  [key]: Number(event.target.value),
                                  confirmed: false,
                                } as ArReading;
                                setReadings(next);
                                setScope({ ...scope, confirmed: false });
                                invalidate();
                              }}
                            >
                              <option value={-1}>
                                {key === 'related' ||
                                key === 'description' ||
                                key === 'open'
                                  ? t.optional
                                  : t.column}
                              </option>
                              {(
                                source.sheets[r.sheet]?.rows[r.header] ?? []
                              ).map((heading, index) => (
                                <option key={index} value={index}>
                                  {index + 1}: {heading}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                    </div>
                    {isArScopeReading(r) && <p>{t.openLimit}</p>}
                    <label className="clearing-confirm">
                      <input
                        type="checkbox"
                        checked={r.confirmed}
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] = {
                            ...r,
                            confirmed: event.target.checked,
                          };
                          setReadings(next);
                          invalidate();
                        }}
                      />
                      {t.sides[side]}: {t.readingConfirm}
                    </label>
                  </>
                )}
              </section>
            );
          })}
        </WorkspaceSources>
        <section className="workspace-scope" hidden={!(files[0] && files[1])}>
          <WorkspaceGroupTitle kind="scope" />
          <div className="clearing-grid">
            {scopeFields.map((key) => (
              <label key={key}>
                {key === 'start' || key === 'end' ? t[key] : t.fields[key]}
                <input
                  type={key === 'start' || key === 'end' ? 'date' : 'text'}
                  value={scope[key]}
                  onChange={(event) => {
                    setScope({
                      ...scope,
                      [key]: event.target.value,
                      confirmed: false,
                    });
                    invalidate();
                  }}
                />
              </label>
            ))}
          </div>
          <label className="clearing-confirm">
            <input
              type="checkbox"
              checked={scope.confirmed}
              onChange={(event) => {
                setScope({ ...scope, confirmed: event.target.checked });
                invalidate();
              }}
            />
            {t.scopeConfirm}
          </label>
        </section>
        <Button
          disabled={
            !files[0] ||
            !files[1] ||
            !readings.every((r) => r.confirmed) ||
            !scope.confirmed
          }
          onClick={check}
        >
          {t.run}
        </Button>
      </fieldset>
      {busy && (
        <output>
          {t.working}
          <Button variant="outline" onClick={cancel}>
            {t.cancel}
          </Button>
        </output>
      )}
      {error && <p role="alert">{t.error}</p>}
      {result && (
        <section>
          <h2 ref={resultHeading} tabIndex={-1} data-result-heading="result">{t.results}</h2>
          <DomainEvidenceAssistant
            result={result}
            snapshot={() => ({ domain: 'ar', input: input(), result })}
            busy={busy}
          />
          <p>{t.coverage}</p>
          {result.status === 'source-error' && (
            <output data-ar-status>{t.sourceErrors}</output>
          )}
          {result.statement && (
            <section data-ar-statement-sections>
              <h3>{t.sections}</h3>
              <div className="clearing-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t.section}</th>
                      <th>{t.fields.customer}</th>
                      <th>{t.customerName}</th>
                      <th>{t.fields.account}</th>
                      <th>{t.fields.currency}</th>
                      <th>{t.period}</th>
                      <th>{t.pages}</th>
                      <th>{t.detailLines}</th>
                      <th>{t.sectionStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.statement.sections.map((s, i) => (
                      <tr key={i} data-ar-section={i + 1}>
                        <td>{i + 1}</td>
                        <td>{s.scope?.customer ?? '—'}</td>
                        <td>{s.name || '—'}</td>
                        <td>{s.scope?.account ?? '—'}</td>
                        <td>{s.scope?.currency ?? '—'}</td>
                        <td>
                          <bdi>
                            {s.scope ? `${s.scope.start} – ${s.scope.end}` : '—'}
                          </bdi>
                        </td>
                        <td>{s.pages.join(', ')}</td>
                        <td>{s.lines}</td>
                        <td data-ar-section-status>
                          {s.compared
                            ? t.sectionCompared
                            : s.scope
                              ? t.sectionOther
                              : t.sectionUnreadable}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.sourceIssues?.length ? (
                <>
                  <h3>{t.holds}</h3>
                  <ul data-ar-holds>
                    {result.sourceIssues.map((issue, i) => {
                      const first = result.inventory.find(
                        (item) => item.inventoryId === issue.inventoryIds[0],
                      );
                      return (
                        <li key={i} data-ar-hold={issue.code}>
                          {t.issue[issue.code as keyof typeof t.issue] ??
                            t.issue.other}
                          {first && (
                            <>
                              {' '}
                              · {t.sides[first.side]}{' '}
                              {first.pdf
                                ? `${t.page} ${first.pdf.page} · ${t.line} ${first.pdf.line}`
                                : `${t.row} ${first.row}`}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </section>
          )}
          <div className="clearing-grid" data-testid="ar-metrics">
            {[
              [t.valid, result.rows.length],
              [
                t.matched,
                result.cases.filter((c) => c.status === 'matched').length,
              ],
              [
                t.errors,
                result.inventory.filter((i) => i.kind === 'error').length,
              ],
              [
                t.ledgerTotal,
                result.totals[0] === null
                  ? t.unavailableTotal
                  : money(result.totals[0], result.decimals),
              ],
              [
                t.statementTotal,
                result.totals[1] === null
                  ? t.unavailableTotal
                  : money(result.totals[1], result.decimals),
              ],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong style={{ display: 'block' }}>{value}</strong>
              </div>
            ))}
          </div>
          <fieldset disabled={busy}>
            <label>
              {t.note}
              <textarea
                aria-label={t.note}
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="clearing-actions">
              <Button
                onClick={() =>
                  perform(async (signal) =>
                    download(
                      await workerTask('ar-save', input(), signal),
                      'tarasuf-ar-session.json',
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
                        'ar-export',
                        { state: input(), result },
                        signal,
                      ),
                      'tarasuf-ar.xlsx',
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    ),
                  )
                }
              >
                {t.export}
              </Button>
            </div>
            {result.cases.slice(page * 50, (page + 1) * 50).map((c) => (
              <article key={c.id} data-testid="ar-case" className="ar-case">
                <div className="ar-case-heading">
                  <h3>
                    {t.kind[c.kind]}: {c.document}
                  </h3>
                  <span
                    className={`status ${c.status === 'matched' ? 'good' : 'warn'}`}
                  >
                    {c.status === 'matched'
                      ? c.basis === 'human-confirmation'
                        ? t.human
                        : t.automatic
                      : t.review}{' '}
                    · {t.reason[c.reason]}
                  </span>
                </div>
                <ul className="ar-case-members">
                  {c.ids
                    .slice(
                      (memberPages[c.id] ?? 0) * 50,
                      ((memberPages[c.id] ?? 0) + 1) * 50,
                    )
                    .map((id) => {
                      const r = rowById.get(id)!;
                      return (
                        <li key={id}>
                          <div className="ar-member-heading">
                            <span>{t.sides[r.side]}</span>
                            <span className="ar-member-amount" dir="ltr">
                              {money(r.amount, result.decimals)}
                            </span>
                          </div>
                          <dl className="ar-member-meta">
                            {r.pdf ? (
                              <div>
                                <dt>{t.page}</dt>
                                <dd>
                                  {r.pdf.page} · {t.line} {r.pdf.line}
                                </dd>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <dt>{t.row}</dt>
                                  <dd>{r.row}</dd>
                                </div>
                                <div>
                                  <dt>{t.fields.posting}</dt>
                                  <dd>{r.posting}</dd>
                                </div>
                              </>
                            )}
                            <div>
                              <dt>{t.fields.date}</dt>
                              <dd>
                                <bdi>{r.date}</bdi>
                              </dd>
                            </div>
                            {r.related && (
                              <div>
                                <dt>{t.fields.related}</dt>
                                <dd>{r.related}</dd>
                              </div>
                            )}
                          </dl>
                          {r.description && (
                            <p className="ar-member-description">
                              {r.description}
                            </p>
                          )}
                          {r.originalRaw !== undefined && (
                            <details className="ar-source-evidence">
                              <summary>{t.sourceEvidence}</summary>
                              <dl>
                                <dt>{t.originalRaw}</dt>
                                <dd>{r.originalRaw}</dd>
                                <dt>{t.openRaw}</dt>
                                <dd>{r.openBalanceRaw || '—'}</dd>
                                <dt>{t.fields.parent}</dt>
                                <dd>{r.parentScopeId ?? '—'}</dd>
                              </dl>
                              <p>{t.openLimit}</p>
                              {r.inheritedSourceCells &&
                              Object.keys(r.inheritedSourceCells).length ? (
                                <div className="clearing-scroll">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>{t.inherited}</th>
                                        <th>{t.sourceEvidence}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {Object.entries(
                                        r.inheritedSourceCells,
                                      ).map(([field, cell]) => (
                                        <tr key={field}>
                                          <td>
                                            {t.fields[
                                              field as keyof typeof t.fields
                                            ] ?? field}
                                            : {cell.raw}
                                          </td>
                                          <td>
                                            {cell.sheetName} · {t.row}{' '}
                                            {cell.row} · {t.column}{' '}
                                            {cell.column}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </details>
                          )}
                        </li>
                      );
                    })}
                </ul>
                {c.ids.length > 50 && (
                  <div className="clearing-actions">
                    <Button
                      variant="outline"
                      disabled={(memberPages[c.id] ?? 0) === 0}
                      onClick={() =>
                        setMemberPages({
                          ...memberPages,
                          [c.id]: (memberPages[c.id] ?? 0) - 1,
                        })
                      }
                    >
                      {t.prev}
                    </Button>
                    <span>
                      {(memberPages[c.id] ?? 0) + 1}/
                      {Math.ceil(c.ids.length / 50)}
                    </span>
                    <Button
                      variant="outline"
                      disabled={
                        ((memberPages[c.id] ?? 0) + 1) * 50 >= c.ids.length
                      }
                      onClick={() =>
                        setMemberPages({
                          ...memberPages,
                          [c.id]: (memberPages[c.id] ?? 0) + 1,
                        })
                      }
                    >
                      {t.next}
                    </Button>
                  </div>
                )}
                {c.note && <p>{c.note}</p>}
                {c.status === 'matched' ? (
                  <Button
                    variant="outline"
                    disabled={note.trim().length < 8}
                    onClick={() => decide('reopen', c)}
                  >
                    {t.reopen}
                  </Button>
                ) : (
                  ['unverified-document-role', 'reopened'].includes(
                    c.reason,
                  ) && (
                    <Button
                      disabled={note.trim().length < 8}
                      onClick={() => decide('accept', c)}
                    >
                      {t.accept}
                    </Button>
                  )
                )}
              </article>
            ))}
            <div className="clearing-actions">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t.prev}
              </Button>
              <span>
                {page + 1}/{Math.max(1, Math.ceil(result.cases.length / 50))}
              </span>
              <Button
                variant="outline"
                disabled={(page + 1) * 50 >= result.cases.length}
                onClick={() => setPage(page + 1)}
              >
                {t.next}
              </Button>
            </div>
          </fieldset>
          <h2>{t.inventory}</h2>
          <div className="clearing-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.inventory}</th>
                  <th>{t.row}</th>
                  <th>{t.valid}</th>
                  <th>{t.errors}</th>
                </tr>
              </thead>
              <tbody>
                {result.inventory
                  .slice(inventoryPage * 50, (inventoryPage + 1) * 50)
                  .map((i) => (
                    <tr key={`${i.side}:${i.row}`}>
                      <td>
                        {t.sides[i.side]} · {t.inventoryKind[i.kind]}
                      </td>
                      <td>
                        {i.pdf
                          ? `${t.page} ${i.pdf.page} · ${t.line} ${i.pdf.line}`
                          : i.row}
                      </td>
                      <td>{i.values.join(' | ')}</td>
                      <td>{i.error ? t.readingIssue : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="clearing-actions">
            <Button
              variant="outline"
              disabled={busy || inventoryPage === 0}
              onClick={() => setInventoryPage(inventoryPage - 1)}
            >
              {t.prev}
            </Button>
            <span>
              {inventoryPage + 1}/
              {Math.max(1, Math.ceil(result.inventory.length / 50))}
            </span>
            <Button
              variant="outline"
              disabled={
                busy || (inventoryPage + 1) * 50 >= result.inventory.length
              }
              onClick={() => setInventoryPage(inventoryPage + 1)}
            >
              {t.next}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
