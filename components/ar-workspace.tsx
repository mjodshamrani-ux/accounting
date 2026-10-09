import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState } from 'react';
import {
  WorkspaceHeader,
  WorkspaceIntro,
  WorkspaceSourceHeading,
  WorkspaceGroupTitle,
  WorkspaceFileInput,
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
    if (file.size > MAX_FILE_BYTES || !/\.(csv|xlsx)$/i.test(file.name)) {
      setError(true);
      return;
    }
    await perform(async (signal) => {
      const source = await workerTask<SourceFile>(
        'read',
        { name: file.name, buffer: await file.arrayBuffer() },
        signal,
      );
      const next = [...files] as typeof files;
      next[side] = source;
      setFiles(next);
      setReadings((previous) => {
        const next = [...previous] as typeof readings;
        next[side] = freshReading(side);
        return next;
      });
      setScope((previous) => ({ ...previous, confirmed: false }));
      invalidate();
    });
  }
  const check = () =>
    perform(async (signal) =>
      install(await workerTask('ar-reconcile', input(), signal)),
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
      aria-busy={busy}
    >
      <WorkspaceHeader onBack={onBack} backLabel={t.back} disabled={busy} />
      <WorkspaceIntro title={t.title} intro={t.intro}>
        <p>{t.limits}</p>
      </WorkspaceIntro>
      <fieldset disabled={busy}>
        <div className="clearing-actions workspace-toolbar">
          <Button
            onClick={() =>
              perform(async (signal) => {
                const source: SourceFile[] = [];
                for (const demo of arDemo())
                  source.push(await workerTask('read', demo, signal));
                install(
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
                    install(
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
        <WorkspaceGroupTitle kind="sources" />
        <div className="clearing-grid workspace-sources">
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
                <h2>
                  <WorkspaceSourceHeading>
                    {t.sides[side]}
                  </WorkspaceSourceHeading>
                </h2>
                <label>
                  {t.sides[side]}
                  <WorkspaceFileInput
                    aria-label={t.sides[side]}
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void upload(side, file);
                    }}
                  />
                </label>
                {source && (
                  <>
                    <h3>{source.name}</h3>
                    <label>
                      {t.sides[side]}: {t.sheet}
                      <select
                        aria-label={`${t.sides[side]}: ${t.sheet}`}
                        value={r.sheet}
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] = {
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
                    <div className="clearing-grid">
                      {columns.map((key) => (
                        <label key={key}>
                          {t.sides[side]}: {t.fields[key]}
                          <select
                            aria-label={`${t.sides[side]}: ${t.fields[key]}`}
                            value={r[key]}
                            onChange={(event) => {
                              const next = [...readings] as typeof readings;
                              next[side] = {
                                ...r,
                                [key]: Number(event.target.value),
                                confirmed: false,
                              };
                              setReadings(next);
                              setScope({ ...scope, confirmed: false });
                              invalidate();
                            }}
                          >
                            <option value={-1}>
                              {key === 'related' || key === 'description'
                                ? t.optional
                                : t.column}
                            </option>
                            {source.sheets[r.sheet].rows[0].map(
                              (heading, index) => (
                                <option key={index} value={index}>
                                  {index + 1}: {heading}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ))}
                    </div>
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
        </div>
        <section className="workspace-scope">
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
          <h2>{t.results}</h2>
          <DomainEvidenceAssistant
            result={result}
            snapshot={() => ({ domain: 'ar', input: input(), result })}
            busy={busy}
          />
          <p>{t.coverage}</p>
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
              [t.ledgerTotal, money(result.totals[0], result.decimals)],
              [t.statementTotal, money(result.totals[1], result.decimals)],
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
              <article key={c.id} data-testid="ar-case">
                <h3>
                  {t.kind[c.kind]}: {c.document}
                </h3>
                <p>
                  {c.status === 'matched'
                    ? c.basis === 'human-confirmation'
                      ? t.human
                      : t.automatic
                    : t.review}{' '}
                  · {t.reason[c.reason]}
                </p>
                <ul>
                  {c.ids
                    .slice(
                      (memberPages[c.id] ?? 0) * 50,
                      ((memberPages[c.id] ?? 0) + 1) * 50,
                    )
                    .map((id) => {
                      const r = rowById.get(id)!;
                      return (
                        <li key={id}>
                          {t.sides[r.side]} · {t.row} {r.row} · {r.posting} ·{' '}
                          {r.date} · {money(r.amount, result.decimals)} ·{' '}
                          {r.related} · {r.description}
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
                      <td>{i.row}</td>
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
