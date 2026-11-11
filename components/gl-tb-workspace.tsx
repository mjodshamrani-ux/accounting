import { DomainEvidenceAssistant } from '@/components/domain-evidence-assistant';
import { useEffect, useId, useRef, useState } from 'react';
import { useResultFocus } from '@/components/result-focus';
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
import { prepareWorker, workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES, type SourceFile } from '@/lib/reconciliation/types';
import { Amount } from '@/components/amount';
import { AlignmentStrip } from '@/components/alignment-strip';
import { ResultIndex, useResultParts } from '@/components/result-index';
import { glTbStrip } from '@/lib/alignment-strip';
import {
  BALANCE_FIELDS,
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  GL_SCOPE_FIELDS,
  GL_SCOPE_HEADERS,
  type GlTbInput,
  type GlTbReading,
  type GlTbResult,
  type GlTbScope,
  type GlScopeField,
} from '@/lib/reconciliation/gl-tb';
import {
  glDemoScope,
  glDemoReadings,
  glVerticalDemoReadings,
  glTbDemo,
} from '@/lib/reconciliation/gl-tb-demo';
import { GlTbSectionsPanel } from '@/components/gl-tb-sections-panel';
import { SheetPrint, useSheetPrint } from '@/components/reconciliation-sheet-print';
import { sheetPrintCopy } from '@/lib/i18n/sheet-print';
import { ScopeCard, Sentence } from '@/components/scope-card';
import { scopeCardCopy } from '@/lib/i18n/scope-card';
import { useDeclaredScope } from '@/hooks/use-declared-scope';
import type {
  DeclaredScopeRule,
  ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import { RecordFields, RecordRows } from '@/components/record-table';
import './workspace-record.css';
const freshScope = (): GlTbScope => ({
  ...glDemoScope,
  entity: '',
  ledger: '',
  account: '',
  dimensions: '',
  postingLayer: '',
  start: '',
  end: '',
  confirmed: false,
});
// What the card may put in each field (UX-5(d)): the date fields and the
// two one-option selects take only what the engine accepts; currency and
// the two selects start from their defaults while no file has the column.
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const scopeRules: DeclaredScopeRule<GlScopeField>[] = GL_SCOPE_FIELDS.map(
  (field) =>
    field === 'currency'
      ? { field, fallback: glDemoScope.currency }
      : field === 'currencyBasis' || field === 'postingStatus'
        ? {
            field,
            fallback: glDemoScope[field],
            accepts: (v) => v === glDemoScope[field],
            fixed: true,
          }
        : field === 'start' || field === 'end'
          ? { field, accepts: isoDate }
          : { field },
);
const scopeColumns = GL_SCOPE_FIELDS.map((field, i) => ({
  field,
  header: GL_SCOPE_HEADERS[i],
}));
const freshOrigins = () =>
  Object.fromEntries(
    scopeRules.map((r) => [
      r.field,
      r.fallback === undefined ? 'question' : 'default',
    ]),
  ) as Record<GlScopeField, ScopeOrigin>;
const freshReading = (side: number): GlTbReading => ({
  ...glDemoReadings[side],
  confirmed: false,
});
// The reconciliation sheet on paper (UX-6(d)), composed on the page by the
// function the worker writes the workbook's first sheet with, loaded when a
// result is shown.
const composeSheet = async (result: GlTbResult, language: 'ar' | 'en') =>
  (await import('@/lib/reconciliation/gl-tb-sheet')).glTbSheet(
    result,
    language,
  );

function download(buffer: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function GlTbWorkspace({
  active,
  onBack,
}: {
  active: boolean;
  onBack: () => void;
}) {
  const { t: catalogue, lang } = useI18n(),
    t = catalogue.glTb;
  const [files, setFiles] = useState<[SourceFile | null, SourceFile | null]>([
      null,
      null,
    ]),
    [readings, setReadings] = useState<[GlTbReading, GlTbReading]>([
      freshReading(0),
      freshReading(1),
    ]),
    [result, setResult] = useState<GlTbResult | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [page, setPage] = useState(0);
  const paper = useSheetPrint(result, lang, composeSheet);
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
    },
    [],
  );
  function invalidate() {
    setResult(null);
    setFailed(false);
    setPage(0);
  }
  // The card's scope and where each value came from (UX-5(d)): a new file
  // or sheet fills what the files agree on into the fields the accountant
  // has not entered, and a value it changes drops the confirmation.
  const card = useDeclaredScope({
    initial: () => ({ scope: freshScope(), origins: freshOrigins() }),
    rules: scopeRules,
    columns: scopeColumns,
    files,
    sheets: [readings[0].sheet, readings[1].sheet],
    labels: t.sides,
  });
  const { scope, origins, suggestions } = card;
  const input = (): GlTbInput => ({
    files: files as GlTbInput['files'],
    readings,
    scope,
  });
  function install(value: { state: GlTbInput; result: GlTbResult }) {
    setFiles(value.state.files);
    setReadings(value.state.readings);
    card.install(value.state.scope, value.state.files, [
      value.state.readings[0].sheet,
      value.state.readings[1].sheet,
    ]);
    setResult(value.result);
    setPage(0);
  }
  // A run, an example or a restored session takes the reader to the result;
  // a decision inside the result does not (UX-2).
  const { heading: resultHeading, reveal } = useResultFocus();
  const resultParts = useResultParts([
    'summary',
    'explain',
    'figures',
    'evidence',
  ]);
  const shown: typeof install = (v) => {
    install(v);
    reveal();
  };
  const statusId = useId();
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const id = ++serial.current,
      control = new AbortController();
    controller.current = control;
    setBusy(true);
    setFailed(false);
    try {
      await prepareWorker();
      if (!control.signal.aborted) await work(control.signal);
    } catch {
      if (id === serial.current && !control.signal.aborted) setFailed(true);
    } finally {
      if (id === serial.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function upload(side: 0 | 1, blob: File) {
    if (blob.size > MAX_FILE_BYTES || !/\.(csv|xlsx)$/i.test(blob.name)) {
      setFailed(true);
      return;
    }
    await perform(async (signal) => {
      const source = await workerTask<SourceFile>(
        'read',
        { name: blob.name, buffer: await blob.arrayBuffer() },
        signal,
      );
      setFiles((previous) => {
        const next = [...previous] as typeof files;
        next[side] = source;
        return next;
      });
      setReadings((previous) => {
        const next = [...previous] as typeof readings;
        next[side] = freshReading(side);
        return next;
      });
      invalidate();
    });
  }
  function updateScope(key: GlScopeField, value: string) {
    card.edit(key, value);
    invalidate();
  }
  const formatted = (n: number | null | undefined) =>
    n === null || n === undefined ? (
      t.missing
    ) : (
      <Amount minor={n} decimals={result!.decimals} />
    );
  const unknown = scopeCardCopy[lang].unknown;
  // A value inside a sentence, isolated so mixed scripts keep their order;
  // a date, an account or a currency code is never split across lines.
  const scopeValue = (v: string, whole = false) => (
    <bdi className={whole ? 'scope-card__whole' : undefined}>
      {v || unknown}
    </bdi>
  );
  const rowsRead = Math.max(
    0,
    ...GL_SCOPE_FIELDS.map((k) =>
      suggestions[k].read.reduce((n, r) => n + r.rows, 0),
    ),
  );
  const rowById = new Map(result?.rows.map((r) => [`${r.side}:${r.row}`, r]));
  const tbRoles = ['opening', 'period', 'closing'] as const;
  if (!active) return null;
  return (
    <main
      className="app-shell gl-tb-workspace reconciliation-workspace"
      aria-busy={busy}
    >
      <WorkspaceHeader
        onBack={onBack}
        backLabel={t.back}
        disabled={busy}
        hasWork={files.some(Boolean)}
      />
      <WorkspaceIntro title={t.title} intro={t.intro} detail={t.introDetail}>
        <p>{t.limits}</p>
        <p>{t.claim}</p>
      </WorkspaceIntro>
      <fieldset disabled={busy}>
        <WorkspaceStart>
          <div className="gl-tb-actions workspace-toolbar">
            <Button
              variant="outline"
              onClick={() =>
                perform(async (signal) => {
                  const source: SourceFile[] = [];
                  for (const demo of glTbDemo())
                    source.push(await workerTask('read', demo, signal));
                  shown(
                    await workerTask(
                      'gl-tb-reconcile',
                      {
                        files: source,
                        readings: glDemoReadings,
                        scope: glDemoScope,
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
                  const source: SourceFile[] = [];
                  for (const demo of glTbDemo(true))
                    source.push(await workerTask('read', demo, signal));
                  shown(
                    await workerTask(
                      'gl-tb-reconcile',
                      {
                        files: source,
                        readings: glVerticalDemoReadings,
                        scope: glDemoScope,
                      },
                      signal,
                    ),
                  );
                })
              }
            >
              {t.sampleVertical}
            </Button>
            <label>
              {t.restore}
              <input
                type="file"
                accept=".json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file)
                    void perform(async (signal) => {
                      if (file.size > 32 * 1024 * 1024)
                        throw Error('GL_TB_SESSION');
                      shown(
                        await workerTask(
                          'gl-tb-restore',
                          { buffer: await file.arrayBuffer() },
                          signal,
                        ),
                      );
                    });
                }}
              />
            </label>
          </div>
        </WorkspaceStart>
        <WorkspaceGroupTitle kind="sources" />
        <WorkspaceSources
          primaryIndices={[0, 1]}
          primaryReady={!!(files[0] && files[1])}
        >
          {([0, 1] as const).map((side) => (
            <section
              className="workspace-source"
              key={side}
              data-testid={`gl-tb-source-${side}`}
            >
              <h2>
                <WorkspaceSourceHeading>{t.sides[side]}</WorkspaceSourceHeading>
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
              {files[side] && (
                <>
                  <h3>{files[side]!.name}</h3>
                  {side === 1 && (
                    <label>
                      {t.family}
                      <select
                        data-testid="gl-tb-family"
                        aria-label={t.family}
                        value={readings[side].family}
                        onChange={(event) => {
                          const next = [...readings] as typeof readings;
                          next[side] = {
                            ...readings[side],
                            family: event.target.value as GlTbReading['family'],
                            confirmed: false,
                          };
                          setReadings(next);
                          invalidate();
                        }}
                      >
                        <option value={GL_TB_VERSION}>
                          {t.horizontalFamily}
                        </option>
                        <option value={GL_TB_VERTICAL_FAMILY}>
                          {t.verticalFamily}
                        </option>
                      </select>
                    </label>
                  )}
                  <label>
                    {t.sides[side]}: {t.sheet}
                    <select
                      value={readings[side].sheet}
                      onChange={(event) => {
                        const next = [...readings] as typeof readings;
                        next[side] = {
                          ...readings[side],
                          sheet: Number(event.target.value),
                          confirmed: false,
                        };
                        setReadings(next);
                        invalidate();
                      }}
                    >
                      {files[side]!.sheets.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <WorkspaceAdvanced>
                    <pre dir="ltr">
                      {files[side]!.sheets[readings[side].sheet]?.rows[0]?.join(
                        ' | ',
                      )}
                    </pre>
                  </WorkspaceAdvanced>
                </>
              )}
            </section>
          ))}
        </WorkspaceSources>
        <ScopeCard
          hidden={!(files[0] && files[1])}
          summary={
            <Sentence
              parts={t.cardSummary(
                scopeValue(scope.entity),
                scopeValue(scope.account, true),
                scopeValue(scope.start, true),
                scopeValue(scope.end, true),
                scopeValue(scope.currency, true),
                rowsRead,
              )}
            />
          }
          rows={GL_SCOPE_FIELDS.map((key) => ({
            key,
            label: t.fields[key],
            origin: origins[key],
            value: scope[key],
            fixed: key === 'currencyBasis' || key === 'postingStatus',
            suggestion: suggestions[key],
            control: (describedBy) =>
              key === 'currencyBasis' || key === 'postingStatus' ? (
                <select
                  aria-label={t.fields[key]}
                  aria-describedby={describedBy}
                  value={scope[key]}
                  onChange={(event) => updateScope(key, event.target.value)}
                >
                  <option
                    value={key === 'currencyBasis' ? 'functional' : 'posted'}
                  >
                    {key === 'currencyBasis'
                      ? t.functionalLabel
                      : t.postedLabel}
                  </option>
                </select>
              ) : (
                <input
                  aria-label={t.fields[key]}
                  aria-describedby={describedBy}
                  type={key === 'start' || key === 'end' ? 'date' : 'text'}
                  value={scope[key]}
                  onChange={(event) => updateScope(key, event.target.value)}
                />
              ),
          }))}
          confirm={
            <label className="scope-card__confirm">
              <input
                type="checkbox"
                checked={readings.every((r) => r.confirmed) && scope.confirmed}
                onChange={(event) => {
                  const confirmed = event.target.checked;
                  setReadings(
                    (previous) =>
                      previous.map((r) => ({
                        ...r,
                        confirmed,
                      })) as typeof readings,
                  );
                  card.confirm(confirmed);
                  invalidate();
                }}
              />
              <span>
                <Sentence
                  parts={t.cardConfirm(
                    scopeValue(scope.entity),
                    scopeValue(scope.start, true),
                    scopeValue(scope.end, true),
                  )}
                />
              </span>
            </label>
          }
        />
        <Button
          disabled={
            !files.every(Boolean) ||
            !readings.every((r) => r.confirmed) ||
            !scope.confirmed
          }
          onClick={() =>
            perform(async (signal) =>
              shown(await workerTask('gl-tb-reconcile', input(), signal)),
            )
          }
        >
          {t.compare}
        </Button>
      </fieldset>
      {busy && (
        <Button
          variant="outline"
          onClick={() => {
            serial.current++;
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            invalidate();
          }}
        >
          {t.cancel}
        </Button>
      )}
      {failed && <p role="alert">{t.failure}</p>}
      {result && (
        <section data-testid="gl-tb-result">
          <h2
            {...resultParts.anchor('summary')}
            ref={resultHeading}
            tabIndex={-1}
            data-result-heading="result"
            aria-describedby={statusId}
          >
            {t.result}
          </h2>
          <AlignmentStrip
            strip={glTbStrip(result)}
            sides={[t.sides[0], t.sides[1]]}
            decimals={result.decimals}
            name={(key) =>
              t.components[key as keyof typeof t.components] ?? key
            }
            state={t.status[result.status]}
          />
          <ResultIndex map={resultParts} />
          <DomainEvidenceAssistant
            anchor={resultParts.anchor('explain')}
            result={result}
            snapshot={() => ({ domain: 'gl-tb', input: input(), result })}
            busy={busy}
          />
          <p id={statusId} data-testid="gl-tb-status">
            {t.status[result.status]}
          </p>
          <p {...resultParts.anchor('figures')}>
            {t.glBridge}: <strong>{formatted(result.glBridge)}</strong>
          </p>
          <p>
            {t.tbBridge}: <strong>{formatted(result.tbBridge)}</strong>
          </p>
          {result.missing.length > 0 && (
            <p>
              {t.missing}:{' '}
              {result.missing.map((k) => t.missingLabels[k]).join(' / ')}
            </p>
          )}
          {result.readings[1].family === GL_TB_VERTICAL_FAMILY && (
            <section
              className="gl-tb-role-evidence"
              data-testid="gl-tb-role-evidence"
            >
              <h3>{t.verticalEvidence}</h3>
              <div className="gl-tb-role-grid">
                {tbRoles.map((role) => {
                  const row = result.rows.find(
                    (r) => r.side === 1 && r.kind === role,
                  );
                  return (
                    <article className="gl-tb-role-card" key={role}>
                      <h4>{t.kinds[role]}</h4>
                      {row ? (
                        <>
                          <p>
                            {t.snapshot}: <bdi>{row.record}</bdi>
                          </p>
                          <p>
                            {t.row}: <bdi>{row.row}</bdi>
                          </p>
                          <dl>
                            {row.trace.map((cell, index) => (
                              <div key={cell.column}>
                                <dt>{index === 0 ? t.debit : t.credit}</dt>
                                <dd>
                                  <bdi>{cell.text}</bdi>
                                  <small>
                                    {t.column} {cell.column}
                                  </small>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </>
                      ) : (
                        <p>{t.missing}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          <RecordRows
            label={t.balances}
            headers={[t.component, t.gl, t.tb, t.difference]}
            rows={BALANCE_FIELDS}
            rowHeader={0}
            frame={{ 'data-testid': 'gl-tb-balances' }}
            cells={(field) => [
              t.components[field],
              formatted(result.gl?.[field]),
              formatted(result.tb?.[field]),
              formatted(result.differences?.[field]),
            ]}
          />
          <div className="gl-tb-actions">
            <Button
              disabled={busy}
              onClick={() =>
                perform(async (signal) =>
                  download(
                    await workerTask('gl-tb-save', input(), signal),
                    'tarasuf-gl-tb-session.json',
                    'application/json',
                  ),
                )
              }
            >
              {t.save}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                perform(async (signal) =>
                  download(
                    await workerTask(
                      'gl-tb-export',
                      // The reconciliation sheet is written in the
                      // interface's language (UX-6).
                      { state: input(), result, lang },
                      signal,
                    ),
                    'tarasuf-gl-tb-workpaper.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  ),
                )
              }
            >
              {t.export}
            </Button>
            <Button disabled={busy} onClick={paper.print}>
              {sheetPrintCopy[lang].print}
            </Button>
          </div>
          <h3 {...resultParts.anchor('evidence')}>{t.inventory}</h3>
          <RecordRows
            label={t.inventory}
            headers={[t.sides.join(' / '), t.row, t.kind, t.error, t.original]}
            frame={{ 'data-testid': 'gl-tb-inventory' }}
            wrap={[4]}
            page={page}
            onPage={setPage}
            rows={result.inventory}
            cells={(i) => {
              const row = rowById.get(`${i.side}:${i.row}`);
              return [
                t.sides[i.side],
                i.row,
                t.kinds[i.kind],
                i.error
                  ? (t.rowErrors[i.error as keyof typeof t.rowErrors] ??
                    t.failure)
                  : '',
                <details key="original">
                  <summary>{t.original}</summary>
                  <p>
                    <RecordFields values={i.values} />
                  </p>
                  {row && (
                    <>
                      <p>
                        {t.record}:{' '}
                        <bdi className="record-field">{row.record}</bdi>
                      </p>
                      <p>{t.cellEvidence}</p>
                      <ul>
                        {row.trace.map((cell) => (
                          <li key={cell.column}>
                            {t.column} {cell.column}:{' '}
                            <bdi className="record-field">{cell.text}</bdi> →{' '}
                            {cell.amount} ({t.minor})
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </details>,
              ];
            }}
          />
          <SheetPrint sheet={paper.sheet} />
        </section>
      )}
      <GlTbSectionsPanel />
    </main>
  );
}
