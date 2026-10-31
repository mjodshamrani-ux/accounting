import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Amount } from '@/components/amount';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput, WorkspaceSourceHeading } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { workerTask } from '@/lib/reconciliation/client';
import { MAX_FILE_BYTES } from '@/lib/reconciliation/types';
import {
  FA_SECTIONS_GL_HEADER,
  FA_SECTIONS_MAP_HEADER,
  FA_SECTIONS_ROLES,
  FA_SECTIONS_SCOPE_FIELDS,
  FA_SECTIONS_VERSION,
  type AssetSectionsResult,
  type AssetSectionsScope,
} from '@/lib/reconciliation/fixed-assets-sections';
import type { AssetSectionsReplayInput } from '@/lib/reconciliation/fixed-assets-sections-io';
import { fixedAssetsSectionsCopy } from '@/lib/i18n/fixed-assets-sections';
import './intercompany-batch-panel.css';

type Picked = {
  name: string;
  original: ArrayBuffer;
  sha256: string;
  confirmed: boolean;
};
type ScopeKey = (typeof FA_SECTIONS_SCOPE_FIELDS)[number];
const PAGE = 50;
const blankScope = () =>
  Object.fromEntries(FA_SECTIONS_SCOPE_FIELDS.map((k) => [k, ''])) as Record<
    ScopeKey,
    string
  >;

function Paged({
  headers,
  rows,
  label,
  marks,
  pager,
}: {
  headers: string[];
  rows: ReactNode[][];
  label: string;
  marks: Record<string, string>[];
  pager: string;
}) {
  const { lang } = useI18n();
  const copy = fixedAssetsSectionsCopy[lang];
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)),
    safe = Math.min(page, pages - 1);
  return (
    <>
      <div className="gl-tb-table">
        <table aria-label={label}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safe * PAGE, safe * PAGE + PAGE).map((row, i) => (
              <tr key={i} {...marks[safe * PAGE + i]}>
                {row.map((v, j) => (
                  <td key={j}>
                    <bdi>{v}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="gl-tb-actions" data-fas-pager={pager}>
          <Button
            variant="outline"
            disabled={!safe}
            onClick={() => setPage(safe - 1)}
          >
            {copy.previous}
          </Button>
          <span>
            {safe + 1} / {pages} · {rows.length}
          </span>
          <Button
            variant="outline"
            disabled={safe + 1 >= pages}
            onClick={() => setPage(safe + 1)}
          >
            {copy.next}
          </Button>
        </div>
      )}
    </>
  );
}

export function FixedAssetsSectionsPanel() {
  const { lang } = useI18n();
  const copy = fixedAssetsSectionsCopy[lang];
  const [files, setFiles] = useState<(Picked | null)[]>(() =>
    FA_SECTIONS_ROLES.map(() => null),
  );
  const [scope, setScope] = useState(blankScope),
    [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [result, setResult] = useState<AssetSectionsResult | null>(null),
    [refused, setRefused] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const runtime = useRef({
    serial: 0,
    controller: null as AbortController | null,
    running: false,
  });
  useEffect(() => {
    const live = runtime.current;
    return () => {
      live.serial++;
      live.controller?.abort();
    };
  }, []);
  function cancel() {
    runtime.current.serial++;
    runtime.current.controller?.abort();
    runtime.current.running = false;
    setBusy(false);
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
      if (id === runtime.current.serial && !control.signal.aborted)
        apply(value);
    } catch {
      if (id === runtime.current.serial && !control.signal.aborted)
        setError(copy.failed);
    } finally {
      if (id === runtime.current.serial) {
        runtime.current.running = false;
        setBusy(false);
      }
    }
  }
  // Any new file, scope value or confirmation makes what was shown stale.
  const invalidate = () => {
    setResult(null);
    setRefused('');
    setError('');
  };
  const ready = files.every((f) => f?.confirmed) && scopeConfirmed;
  function check() {
    const input: AssetSectionsReplayInput = {
      files: files.map((f) => ({
        name: f!.name,
        original: f!.original,
        sha256: f!.sha256,
      })),
      readings: FA_SECTIONS_ROLES.map((role) => ({
        sheet: 0 as const,
        role,
        family: FA_SECTIONS_VERSION,
        confirmed: true as const,
      })),
      scope: { ...scope, confirmed: true } as AssetSectionsScope,
    };
    void perform(
      async (signal) => {
        try {
          const reply = await workerTask<{
            state: unknown;
            result: AssetSectionsResult;
          }>('fixed-assets-sections-review', input, signal);
          return { result: reply.result, refused: '' };
        } catch (failure) {
          // The engine's own refusal is shown as a refusal; anything else
          // is a failure and shows nothing.
          const code = /^FA_SECTIONS_([A-Z_]+)$/.exec(
            String((failure as Error).message),
          )?.[1];
          if (!code || !Object.hasOwn(copy.refusals, code)) throw failure;
          return { result: null, refused: code };
        }
      },
      (v) => {
        setResult(v.result);
        setRefused(v.refused);
      },
    );
  }
  const decimals = result?.decimals ?? 2;
  // Integer minor units as the engine returns them, with their sign, read at
  // the scope currency's decimals through the shared component.
  const amount = (minor: number | null) =>
    minor === null ? copy.none : <Amount minor={minor} decimals={decimals} />;
  const rowList = (rows: number[]) =>
    rows.length ? rows.join(copy.list) : copy.none;
  const coded = (codes: string[]) =>
    codes.length
      ? codes.map((c) => `${copy.codes[c] ?? c} (${c})`).join('; ')
      : copy.none;
  const headerLines = [
    copy.sectionHeaders,
    FA_SECTIONS_MAP_HEADER.join(', '),
    FA_SECTIONS_GL_HEADER.join(', '),
  ];
  const count = (status: string) =>
    result ? result.accounts.filter((a) => a.status === status).length : 0;
  return (
    <details className="intercompany-batch" data-fas-details>
      <summary>{copy.title}</summary>
      <section
        className="workspace-review"
        data-fas
        data-fas-state={refused ? 'refused' : result ? 'shown' : 'idle'}
        aria-busy={busy}
        aria-label={copy.title}
      >
        <p>{copy.intro}</p>
        <p>{copy.limits}</p>
        <div className="workspace-sources">
          {FA_SECTIONS_ROLES.map((role, side) => {
            const picked = files[side];
            return (
              <fieldset
                key={role}
                disabled={busy}
                className="workspace-batch-source"
              >
                <legend>
                  <WorkspaceSourceHeading>
                    {copy.roles[side]}
                  </WorkspaceSourceHeading>
                </legend>
                <p>
                  {copy.headers}: <bdi>{headerLines[side]}</bdi>
                </p>
                <WorkspaceFileInput
                  aria-label={copy.roles[side]}
                  type="file"
                  accept=".csv"
                  data-fas-file={role}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f)
                      void perform(
                        async () => {
                          if (
                            f.size > MAX_FILE_BYTES ||
                            !/\.csv$/i.test(f.name)
                          )
                            throw Error('FA_SECTIONS_SOURCE');
                          const original = await f.arrayBuffer();
                          const sha256 = Array.from(
                            new Uint8Array(
                              await crypto.subtle.digest('SHA-256', original),
                            ),
                            (n) => n.toString(16).padStart(2, '0'),
                          ).join('');
                          return {
                            name: f.name,
                            original,
                            sha256,
                            confirmed: false,
                          };
                        },
                        (next) => {
                          setFiles((all) =>
                            all.map((v, i) => (i === side ? next : v)),
                          );
                          invalidate();
                        },
                      );
                  }}
                />
                <p>
                  <bdi data-fas-name={role}>{picked?.name ?? copy.empty}</bdi>
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={!!picked?.confirmed}
                    disabled={!picked}
                    data-fas-confirm={role}
                    onChange={(e) => {
                      const confirmed = e.target.checked;
                      setFiles((all) =>
                        all.map((v, i) =>
                          i === side && v ? { ...v, confirmed } : v,
                        ),
                      );
                      invalidate();
                    }}
                  />
                  {copy.confirm}
                </label>
              </fieldset>
            );
          })}
        </div>
        <fieldset disabled={busy} className="workspace-batch-source">
          <legend>
            <WorkspaceSourceHeading>{copy.scope}</WorkspaceSourceHeading>
          </legend>
          <div className="gl-tb-grid">
            {FA_SECTIONS_SCOPE_FIELDS.map((k) => (
              <label key={k}>
                {copy.scopeFields[k]}
                <input
                  value={scope[k]}
                  dir="auto"
                  data-fas-scope={k}
                  aria-label={`${copy.scopePrefix} ${copy.scopeFields[k]}`}
                  onChange={(e) => {
                    setScope({ ...scope, [k]: e.target.value });
                    setScopeConfirmed(false);
                    invalidate();
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={scopeConfirmed}
              data-fas-scope-confirm
              onChange={(e) => {
                setScopeConfirmed(e.target.checked);
                invalidate();
              }}
            />
            {copy.confirmScope}
          </label>
        </fieldset>
        <div className="gl-tb-actions workspace-run-actions">
          <Button disabled={busy || !ready} onClick={check}>
            {copy.check}
          </Button>
          {busy && (
            <Button variant="outline" onClick={cancel}>
              {copy.cancel}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" data-fas-error>
            {error}
          </p>
        )}
        {refused && (
          <div role="alert" data-fas-refused={refused}>
            <h3>
              {copy.refused}: {copy.refusals[refused] ?? refused} (
              <bdi>{refused}</bdi>)
            </h3>
          </div>
        )}
        {result && (
          <div data-fas-result>
            <p
              data-fas-summary={JSON.stringify([
                result.accounts.length,
                result.sections.length,
                result.assets.length,
              ])}
            >
              {copy.summary(
                result.accounts.length,
                count('consistent'),
                count('difference'),
                count('missing'),
                count('held'),
                result.sections.length,
                result.assets.length,
              )}
            </p>
            <p data-fas-inventory={JSON.stringify(result.inventory.register)}>
              {copy.inventory(
                Object.values(result.inventory.register).reduce(
                  (a, b) => a + b,
                  0,
                ),
                result.inventory.register.blank,
                result.inventory.register.record,
                result.inventory.register.stray,
              )}
            </p>
            {result.run.length > 0 && (
              <div role="alert" data-fas-run={result.run.join(' ')}>
                <h4>{copy.runTitle}</h4>
                <ul>
                  {result.run.map((c) => (
                    <li key={c}>
                      {copy.codes[c] ?? c} (<bdi>{c}</bdi>)
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3>
              {copy.accountsTitle} ({result.accounts.length})
            </h3>
            <Paged
              label={copy.accountsTitle}
              pager="accounts"
              headers={copy.accountHeaders}
              rows={result.accounts.map((a) => [
                a.account,
                a.dimensions,
                a.component ? copy.components[a.component] : copy.none,
                amount(a.register),
                amount(a.gl),
                amount(a.difference),
                a.glRow === null ? copy.none : String(a.glRow),
                String(a.members.length),
                copy.status[a.status],
                coded(a.codes),
              ])}
              marks={result.accounts.map((a) => ({
                'data-fas-account': `${a.account}|${a.dimensions}`,
                'data-fas-account-status': a.status,
                'data-fas-account-codes': a.codes.join(' '),
              }))}
            />
            {result.unmapped.length > 0 && (
              <>
                <h3>
                  {copy.unmappedTitle} ({result.unmapped.length})
                </h3>
                <Paged
                  label={copy.unmappedTitle}
                  pager="unmapped"
                  headers={copy.unmappedHeaders}
                  rows={result.unmapped.map(([cat, comp, code]) => [
                    cat,
                    copy.components[comp],
                    `${copy.codes[code] ?? code} (${code})`,
                  ])}
                  marks={result.unmapped.map((u) => ({
                    'data-fas-unmapped': u.join('|'),
                  }))}
                />
              </>
            )}
            {result.unplaced.length > 0 && (
              <>
                <h3>
                  {copy.unplacedTitle} ({result.unplaced.length})
                </h3>
                <Paged
                  label={copy.unplacedTitle}
                  pager="unplaced"
                  headers={copy.unplacedHeaders}
                  rows={result.unplaced.map(([role, row, code]) => [
                    copy.roles[
                      FA_SECTIONS_ROLES.indexOf(
                        role as (typeof FA_SECTIONS_ROLES)[number],
                      )
                    ],
                    String(row),
                    `${copy.codes[code] ?? code} (${code})`,
                  ])}
                  marks={result.unplaced.map((u) => ({
                    'data-fas-unplaced': u.join('|'),
                  }))}
                />
              </>
            )}
            <h3>
              {copy.sectionsTitle} ({result.sections.length})
            </h3>
            <Paged
              label={copy.sectionsTitle}
              pager="sections"
              headers={copy.sectionHeadersTable}
              rows={result.sections.map((s) => [
                String(s[0]),
                s[1] === null ? copy.none : String(s[1]),
                s[2] ?? copy.none,
                s[3] ?? copy.none,
                s[4] ?? copy.none,
                copy.status[s[5]],
                coded(s[6]),
              ])}
              marks={result.sections.map((s) => ({
                'data-fas-section': String(s[0]),
                'data-fas-section-status': s[5],
                'data-fas-section-codes': s[6].join(' '),
              }))}
            />
            <h3>
              {copy.assetsTitle} ({result.assets.length})
            </h3>
            <Paged
              label={copy.assetsTitle}
              pager="assets"
              headers={copy.assetHeaders}
              rows={result.assets.map((a) => [
                a.section,
                a.assetId,
                a.dimensions,
                amount(a.amounts.cost),
                amount(a.amounts.depreciation),
                amount(a.amounts.impairment),
                amount(a.amounts.carrying),
                rowList([
                  ...a.rows.cost,
                  ...a.rows.depreciation,
                  ...a.rows.impairment,
                  ...a.rows.carrying,
                  ...a.unread,
                ]),
                a.valuation ?? copy.none,
                copy.status[a.status],
                coded(a.codes),
              ])}
              marks={result.assets.map((a) => ({
                'data-fas-asset': `${a.sectionRow}|${a.assetId}|${a.dimensions}`,
                'data-fas-asset-status': a.status,
                'data-fas-asset-codes': a.codes.join(' '),
              }))}
            />
          </div>
        )}
      </section>
    </details>
  );
}
