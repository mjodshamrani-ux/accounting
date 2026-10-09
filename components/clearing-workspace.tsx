import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useRef, useState } from 'react';
import { BrandMark, BrandWordmark } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
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
function download(bytes: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ClearingWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue } = useI18n();
  const t = catalogue.clearing;
  const [file, setFile] = useState<SourceFile | null>(null),
    [reading, setReading] = useState(freshReading),
    [scope, setScope] = useState(freshScope),
    [events, setEvents] = useState<ClearingEvent[]>([]),
    [result, setResult] = useState<ClearingResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [note, setNote] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [inventoryPage, setInventoryPage] = useState(0);
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
    setScope(state.scope);
    setEvents(state.events);
    setResult(result);
    setSelected([]);
    setError(false);
  };
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
  const check = () =>
    perform(async (signal) =>
      install(await workerTask('clearing-reconcile', input(), signal)),
    );
  const decide = (action: ClearingEvent['action'], ids: string[]) =>
    perform(async (signal) =>
      install(
        await workerTask(
          'clearing-reconcile',
          {
            ...input(),
            events: [
              ...events,
              { context: result!.context, action, ids, note },
            ],
          },
          signal,
        ),
      ),
    );
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
      setScope(freshScope());
    });
  }
  const sheet = file?.sheets[reading.sheet],
    header = sheet?.rows[reading.header] ?? [];
  const field = (key: keyof ClearingScope) => (
    <label>
      {t[key as 'entity']}
      <input
        aria-label={t[key as 'entity']}
        value={String(scope[key])}
        disabled={busy}
        type={key === 'start' || key === 'end' ? 'date' : 'text'}
        onChange={(e) => {
          invalidate();
          setScope({ ...scope, [key]: e.target.value, confirmed: false });
        }}
      />
    </label>
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
          setScope({ ...scope, confirmed: false });
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
  if (!active) return null;
  return (
    <>
      <header className="topbar clearing-topbar">
        <a className="brand" href="#clearing">
          <BrandMark />
          <BrandWordmark />
        </a>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <Button variant="outline" onClick={onBack} disabled={busy}>
            {t.back}
          </Button>
        </div>
      </header>
      <main className="workspace clearing-workspace" id="clearing">
        <section className="surface pad stack">
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
          <p className="muted">{t.limits}</p>
          <div className="clearing-actions">
            <label>
              {t.upload}
              <input
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
            <Button
              variant="outline"
              disabled={busy || !!file}
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
                  setScope({ ...clearingDemoScope });
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
                        install(restored);
                      }
                    });
                  e.target.value = '';
                }}
              />
            </label>
          </div>
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
            <h2>{file.name}</h2>
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
                      setScope({ ...scope, confirmed: false });
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
                      setScope({ ...scope, confirmed: false });
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
                      setScope({ ...scope, confirmed: false });
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
              <div className="clearing-grid">
                {(
                  [
                    'entity',
                    'ledger',
                    'account',
                    'currency',
                    'start',
                    'end',
                  ] as (keyof ClearingScope)[]
                ).map((key) => (
                  <div key={key}>{field(key)}</div>
                ))}
              </div>
              <label className="clearing-confirm">
                <input
                  type="checkbox"
                  checked={scope.confirmed}
                  onChange={(e) => {
                    invalidate();
                    setScope({ ...scope, confirmed: e.target.checked });
                  }}
                />
                {t.confirm}
              </label>
            </fieldset>
            <Button
              disabled={busy || !scope.confirmed}
              onClick={() => void check()}
            >
              {t.run}
            </Button>
            <details>
              <summary>{t.source}</summary>
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
            </details>
          </section>
        )}
        {result && (
          <section
            className="surface pad stack"
            aria-labelledby="clearing-result-title"
          >
            <h2 id="clearing-result-title">{t.results}</h2>
            <DomainEvidenceAssistant result={result} snapshot={() => ({ domain: "clearing", input: input(), result })} busy={busy} />
            <div className="clearing-grid" data-testid="clearing-metrics">
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
                [t.total, money(result.total, result.decimals)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="muted">{t.coverage}</p>
            <div className="clearing-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t.members}</th>
                    <th>{t.reference}</th>
                    <th>{t.net}</th>
                    <th>{t.status}</th>
                    <th>{t.basis}</th>
                    <th>{t.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cases.slice(page * 50, (page + 1) * 50).map((c) => (
                    <tr key={c.id} data-testid="clearing-case">
                      <td>
                        <label>
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
                                  : selected.filter(
                                      (id) => !c.ids.includes(id),
                                    ),
                              )
                            }
                          />
                          <bdi>
                            {c.ids
                              .map((id) => owners.get(id)?.posting)
                              .join(', ')}
                          </bdi>
                        </label>
                      </td>
                      <td>
                        <bdi>{c.reference || t.missing}</bdi>
                      </td>
                      <td>
                        <bdi>{money(c.net, result.decimals)}</bdi>
                      </td>
                      <td>{c.status === 'cleared' ? t.cleared : t.review}</td>
                      <td>
                        {c.basis === 'explicit-reference'
                          ? t.automatic
                          : c.basis === 'human-decision'
                            ? t.human
                            : t.none}
                        <p className="muted">{t.reason[c.reason]}</p>
                      </td>
                      <td>
                        {c.note}
                        {c.status === 'cleared' && (
                          <Button
                            variant="outline"
                            disabled={busy || note.trim().length < 8}
                            onClick={() => void decide('reopen', c.ids)}
                          >
                            {t.reopen}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <label>
              {t.note}
              <textarea
                value={note}
                maxLength={200}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button
              disabled={
                busy ||
                selected.length < 2 ||
                selected.length > 100 ||
                note.trim().length < 8
              }
              onClick={() => void decide('clear', selected)}
            >
              {t.manual}
            </Button>
            <details>
              <summary>
                {t.source} · {t.errors}
              </summary>
              <div className="clearing-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t.row}</th>
                      <th>{t.status}</th>
                      <th>{t.source}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.inventory
                      .slice(inventoryPage * 50, (inventoryPage + 1) * 50)
                      .map((row) => (
                        <tr key={row.row}>
                          <th>{row.row}</th>
                          <td>
                            {row.kind === 'error'
                              ? t.readingIssue
                              : t.inventory[row.kind]}
                          </td>
                          <td>
                            <bdi>{row.values.join(' | ')}</bdi>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="clearing-actions">
                <Button
                  variant="outline"
                  disabled={!inventoryPage}
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
                  disabled={(inventoryPage + 1) * 50 >= result.inventory.length}
                  onClick={() => setInventoryPage(inventoryPage + 1)}
                >
                  {t.next}
                </Button>
              </div>
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
                      { state: input(), result },
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
            </div>
          </section>
        )}
      </main>
    </>
  );
}
