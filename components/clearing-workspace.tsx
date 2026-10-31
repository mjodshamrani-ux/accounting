import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { ClearingGroupsPanel } from './clearing-groups-panel';
import { useEffect, useId, useRef, useState } from 'react';
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
  WorkspaceGroupTitle,
  WorkspaceFileInput,
  WorkspaceSources,
  WorkspaceAdvanced,
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
  const { t: catalogue, lang } = useI18n();
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
        <WorkspaceIntro title={t.title} intro={t.intro}>
          <p>{t.limits}</p>
        </WorkspaceIntro>
        <section className="surface pad stack workspace-preparation">
          <WorkspaceAdvanced>
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
                    setScope({ ...clearingDemoScope });
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
          </WorkspaceAdvanced>
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
              <section className="workspace-scope">
                <WorkspaceGroupTitle kind="scope" />
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
              </section>
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
              id="clearing-result-title"
              ref={resultHeading}
              tabIndex={-1}
              data-result-heading="result"
            >
              {t.results}
            </h2>
            <DomainEvidenceAssistant
              result={result}
              snapshot={() => ({ domain: 'clearing', input: input(), result })}
              busy={busy}
            />
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
            <RecordRows
              label={t.results}
              headers={[
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
              mark={() => ({ 'data-testid': 'clearing-case' })}
              target={(_, at) => rowAt(at)}
              cells={(c, at) => [
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
                c.status === 'cleared' ? t.cleared : t.review,
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
            <details>
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
