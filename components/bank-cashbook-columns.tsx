import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceFileInput } from './workspace-chrome';
import { useI18n } from '@/lib/i18n/context';
import { bankMapCopy } from '@/lib/i18n/bank-map';
import {
  CASHBOOK_MAP_LIMITS,
  CASHBOOK_MAP_STORAGE_KEY,
  CASHBOOK_ROLES,
  CashbookMapError,
  cashbookMapProblems,
  chooseCashbookColumns,
  columnLetters,
  mapColumns,
  namedCashbookMap,
  normalLabel,
  parseCashbookMap,
  readStoredCashbookMaps,
  serializeCashbookMap,
  withCashbookMap,
  type CashbookColumns,
  type CashbookMap,
  type CashbookMapCode,
  type CashbookMapProblem,
  type CashbookRole,
  type MappedColumn,
} from '@/lib/reconciliation/bank-cashbook-map';
import type { BankStatementResult } from '@/lib/reconciliation/bank-statement-lifecycle';
import type { SourceFile } from '@/lib/reconciliation/types';
import type { BankStatementSession } from './bank-statement-workspace';

// The cashbook's columns (bank-cashbook-map-1, proposed). The declared
// reading comes first; this panel appears only once it refuses the header
// row, or for a cashbook already read with columns. Nothing is proposed from
// a label (M3), a saved map that does not fit is shown with its problems and
// reads nothing (M2), and maps stay in this browser's storage (M7).

type Stored = { maps: CashbookMap[]; unreadable: number };
/** Description and reference may be left unread (M5); the library refuses
 * any other role without a column, and this set only labels the choice. */
const OPTIONAL: ReadonlySet<CashbookRole> = new Set([
  'description',
  'reference',
]);
/** The cashbook as a result cites it when read with columns. */
type CitedCashbook = BankStatementResult['sources'][number] & {
  columns?: CashbookColumns;
  above?: number;
  unread?: MappedColumn[];
};
type Notice =
  | { kind: 'refused'; code: CashbookMapCode }
  | { kind: 'saved' | 'replaced' | 'imported'; name: string }
  | { kind: 'full' | 'storage' | 'cleared' };

/** The maps kept on this device; storage that cannot be read holds none. */
function loadMaps(): Stored {
  try {
    return readStoredCashbookMaps(
      localStorage.getItem(CASHBOOK_MAP_STORAGE_KEY),
    );
  } catch {
    return { maps: [], unreadable: 0 };
  }
}
/** Writes the maps, or says that storage refused them. */
function storeMaps(maps: CashbookMap[] | null) {
  try {
    if (maps)
      localStorage.setItem(CASHBOOK_MAP_STORAGE_KEY, JSON.stringify(maps));
    else localStorage.removeItem(CASHBOOK_MAP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    ),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const cellOf = (file: SourceFile, row: number, column: number) =>
  file.sheets[0]?.rows[row - 1]?.[column - 1] ?? '';
const noChoice = () =>
  Object.fromEntries(CASHBOOK_ROLES.map((r) => [r, null])) as Record<
    CashbookRole,
    number | null
  >;

/** The problems of a map or a choice on this file, as the contract lists
 * them. */
function Problems({
  problems,
  header,
}: {
  problems: CashbookMapProblem[];
  header: number;
}) {
  const { lang } = useI18n(),
    c = bankMapCopy[lang];
  return (
    <div role="alert" data-bank-map-problems={problems.length}>
      <p>{c.misfit}</p>
      <ul>
        {problems.map((p, i) => (
          <li
            key={i}
            data-bank-map-problem={p.kind}
            data-bank-map-role={p.kind === 'column' ? p.role : undefined}
          >
            {p.kind === 'sheets' ? (
              c.sheets(p.count)
            ) : p.kind === 'header-row' ? (
              c.headerRow(p.row)
            ) : (
              <>
                <bdi>
                  {c.column(
                    c.roles[p.role],
                    `${columnLetters(p.column)}${header}`,
                    p.label,
                    p.found,
                  )}
                </bdi>{' '}
                <bdi>{c.elsewhere(p.elsewhere)}</bdi>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Choosing the cashbook's columns: a saved map by its name, or the header
 * row and a column per role by hand; saving, importing and downloading maps.
 * Keyed by the file, so a new file starts with nothing chosen. */
export function CashbookColumnsPanel({
  s,
  locked,
}: {
  s: BankStatementSession;
  locked: boolean;
}) {
  const { lang } = useI18n(),
    c = bankMapCopy[lang];
  const [stored, setStored] = useState<Stored>(loadMaps),
    [selected, setSelected] = useState(''),
    [header, setHeader] = useState(1),
    [choice, setChoice] = useState(noChoice),
    [problems, setProblems] = useState<{
      header: number;
      list: CashbookMapProblem[];
    } | null>(null),
    [notice, setNotice] = useState<(Notice & { at: number }) | null>(null),
    [name, setName] = useState(''),
    [choosing, setChoosing] = useState(false);
  const file = s.layout,
    columns = s.cashbook?.columns ?? null;
  // Choosing stays open until a result is read with columns; then it opens
  // again only when asked.
  const open = !!file && (!columns || !s.result || choosing);
  const rows = file ? (file.sheets[0]?.rows.length ?? 0) : 0;
  const width = file
    ? Math.min(
        CASHBOOK_MAP_LIMITS.column,
        Math.max(0, ...(file.sheets[0]?.rows ?? []).map((r) => r.length)),
      )
    : 0;
  const shown = Math.min(rows, CASHBOOK_MAP_LIMITS.header);
  const map = stored.maps.find((m) => m.name === selected) ?? null;
  // A corrupt stored list is never rewritten without the accountant: it is
  // cleared first, so nothing is lost silently.
  const writable = stored.unreadable === 0;
  const said = useRef(0);
  const say = (n: Notice) => setNotice({ ...n, at: ++said.current });
  function refused(error: unknown) {
    if (!(error instanceof CashbookMapError)) throw error;
    say({ kind: 'refused', code: error.code });
  }
  function keep(next: CashbookMap[] | null, done: Notice) {
    if (!next) return say({ kind: 'full' });
    if (!storeMaps(next)) return say({ kind: 'storage' });
    setStored({ maps: next, unreadable: 0 });
    say(done);
  }
  function read(columns: CashbookColumns) {
    setProblems(null);
    setNotice(null);
    setChoosing(false);
    void s.readWith(columns);
  }
  function readMap() {
    if (!file || !map) return;
    const found = cashbookMapProblems(file, mapColumns(map));
    if (found.length) {
      setNotice(null);
      return setProblems({ header: map.header, list: found });
    }
    read(mapColumns(map));
  }
  function readHand() {
    if (!file) return;
    try {
      const chosen = chooseCashbookColumns(file, { header, columns: choice });
      if ('problems' in chosen) {
        setNotice(null);
        return setProblems({ header, list: chosen.problems });
      }
      read(chosen.columns);
    } catch (error) {
      setProblems(null);
      refused(error);
    }
  }
  function save() {
    if (!columns || !writable) return;
    setNotice(null);
    try {
      const named = namedCashbookMap(name, columns);
      const replaced = stored.maps.some((m) => m.name === named.name);
      keep(withCashbookMap(stored.maps, named), {
        kind: replaced ? 'replaced' : 'saved',
        name: named.name,
      });
      setSelected(named.name);
    } catch (error) {
      refused(error);
    }
  }
  async function importMap(event: ChangeEvent<HTMLInputElement>) {
    const blob = event.target.files?.[0];
    event.target.value = '';
    if (!blob || !writable) return;
    setNotice(null);
    try {
      // A file beyond the limit is refused unread, as the contract's first
      // rule refuses it.
      if (blob.size > CASHBOOK_MAP_LIMITS.bytes)
        throw new CashbookMapError('MAP_JSON', 'size');
      const imported = parseCashbookMap(await blob.arrayBuffer());
      keep(withCashbookMap(stored.maps, imported), {
        kind: 'imported',
        name: imported.name,
      });
      setSelected(imported.name);
    } catch (error) {
      refused(error);
    }
  }
  function clear() {
    if (!storeMaps(null)) return say({ kind: 'storage' });
    setStored({ maps: [], unreadable: 0 });
    setSelected('');
    say({ kind: 'cleared' });
  }
  const option = (column: number) =>
    `${columnLetters(column)} · ${normalLabel(cellOf(file!, header, column)) || c.empty}`;
  return (
    <section className="bank-map" data-bank-map>
      <h2>{c.title}</h2>
      <p className="bank-source-basis">
        {s.headerRefused ? c.intro : c.withColumns}
      </p>
      <p className="bank-source-basis">{c.claim}</p>
      <fieldset disabled={locked || s.busy}>
        {columns && !open && (
          <Button
            variant="outline"
            data-bank-map-change
            onClick={() => {
              setChoosing(true);
              if (!file) void s.loadLayout();
            }}
          >
            {c.change}
          </Button>
        )}
        <h3>{c.saved}</h3>
        {stored.maps.length ? (
          <div className="gl-tb-grid">
            <label>
              {c.map}
              <select
                aria-label={c.map}
                data-bank-map-select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setProblems(null);
                }}
              >
                <option value="">{c.chooseMap}</option>
                {stored.maps.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="bank-source-basis" data-bank-map-none>
            {c.noMaps}
          </p>
        )}
        <div className="gl-tb-actions">
          {open && (
            <Button disabled={!map} data-bank-map-read="map" onClick={readMap}>
              {c.readMap}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!map}
            data-bank-map-export
            onClick={() =>
              map &&
              downloadText(
                serializeCashbookMap(map),
                'tarasuf-cashbook-map.json',
              )
            }
          >
            {c.exportMap}
          </Button>
        </div>
        {open && (
          <>
            <h3>{c.hand}</h3>
            <div className="gl-tb-table" data-bank-map-preview={shown}>
              <table>
                <caption>{c.preview(shown)}</caption>
                <thead>
                  <tr>
                    <th>{c.previewColumn}</th>
                    {Array.from({ length: width }, (_, i) => (
                      <th key={i}>{columnLetters(i + 1)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: shown }, (_, r) => (
                    <tr
                      key={r}
                      data-bank-map-header-row={r + 1 === header || undefined}
                    >
                      <th scope="row">{r + 1}</th>
                      {Array.from({ length: width }, (_, k) => (
                        <td key={k}>
                          <bdi>{cellOf(file!, r + 1, k + 1)}</bdi>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gl-tb-grid">
              <label>
                {c.header}
                <select
                  aria-label={c.header}
                  data-bank-map-header
                  value={header}
                  onChange={(e) => {
                    setHeader(Number(e.target.value));
                    setProblems(null);
                  }}
                >
                  {Array.from({ length: shown }, (_, r) => (
                    <option key={r} value={r + 1}>
                      {r + 1}
                    </option>
                  ))}
                </select>
              </label>
              {CASHBOOK_ROLES.map((role) => (
                <label key={role}>
                  {c.roles[role]} {OPTIONAL.has(role) && c.optional}
                  <select
                    aria-label={c.roles[role]}
                    data-bank-map-role-select={role}
                    value={choice[role] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setChoice((now) => ({
                        ...now,
                        [role]: value ? Number(value) : null,
                      }));
                      setProblems(null);
                    }}
                  >
                    <option value="">
                      {OPTIONAL.has(role) ? c.notRead : c.chooseColumn}
                    </option>
                    {Array.from({ length: width }, (_, k) => (
                      <option key={k} value={k + 1}>
                        {option(k + 1)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button data-bank-map-read="hand" onClick={readHand}>
              {c.readHand}
            </Button>
          </>
        )}
        {problems && (
          <Problems problems={problems.list} header={problems.header} />
        )}
        {columns && (
          <>
            <h3>{c.saveTitle}</h3>
            <div className="gl-tb-grid">
              <label>
                {c.name}
                <input
                  aria-label={c.name}
                  data-bank-map-name
                  maxLength={CASHBOOK_MAP_LIMITS.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <Button
              disabled={!writable || !name.trim()}
              data-bank-map-save
              onClick={save}
            >
              {c.save}
            </Button>
          </>
        )}
        <h3>{c.importMap}</h3>
        <WorkspaceFileInput
          type="file"
          accept=".json"
          aria-label={c.importMap}
          data-bank-map-import
          disabled={!writable}
          onChange={(e) => void importMap(e)}
        />
        {stored.unreadable > 0 && (
          <>
            <p role="alert" data-bank-map-unreadable={stored.unreadable}>
              {c.unreadable(stored.unreadable)}
            </p>
            <Button variant="outline" data-bank-map-clear onClick={clear}>
              {c.clearMaps}
            </Button>
          </>
        )}
        {stored.unreadable === 0 && stored.maps.length > 0 && (
          <Button variant="outline" data-bank-map-clear onClick={clear}>
            {c.clearMaps}
          </Button>
        )}
        <p className="bank-source-basis">{c.storageNote}</p>
      </fieldset>
      {notice && (
        <p
          role={notice.kind === 'refused' ? 'alert' : 'status'}
          data-bank-map-notice={notice.kind}
          data-bank-map-seq={notice.at}
          data-bank-map-code={
            notice.kind === 'refused' ? notice.code : undefined
          }
        >
          {notice.kind === 'refused' ? (
            <>
              {c.codes[notice.code]} <bdi dir="ltr">{notice.code}</bdi>
            </>
          ) : notice.kind === 'saved' ? (
            <bdi>{c.savedAs(notice.name)}</bdi>
          ) : notice.kind === 'replaced' ? (
            <bdi>{c.replaced(notice.name)}</bdi>
          ) : notice.kind === 'imported' ? (
            <bdi>{c.imported(notice.name)}</bdi>
          ) : (
            c[notice.kind]
          )}
        </p>
      )}
    </section>
  );
}

/** The columns a result's cashbook was read with, as the result cites them:
 * the header row, each role's column and label, the rows above the header
 * and the labelled columns not read. */
export function CashbookColumnsUsed({ r }: { r: BankStatementResult }) {
  const { lang } = useI18n(),
    c = bankMapCopy[lang];
  const cited = r.sources[1] as CitedCashbook | undefined;
  if (!cited?.columns) return null;
  const { header, columns } = cited.columns;
  const rows: [string, string, string][] = [
    [c.usedHeader, String(header), ''],
    ...CASHBOOK_ROLES.map((role): [string, string, string] => {
      const entry = columns[role];
      return entry
        ? [c.roles[role], columnLetters(entry.column), entry.label]
        : [c.roles[role], c.notRead, ''];
    }),
    [c.above, String(cited.above ?? 0), ''],
    ...(cited.unread ?? []).map((u): [string, string, string] => [
      c.unread,
      columnLetters(u.column),
      u.label,
    ]),
  ];
  return (
    <section data-bank-statement-table="cashbook-columns">
      <h2>{c.used}</h2>
      <div className="gl-tb-table">
        <table>
          <thead>
            <tr>
              {c.usedHeaders.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([item, column, label], i) => (
              <tr key={i}>
                <td>{item}</td>
                <td>
                  <bdi dir="ltr">{column}</bdi>
                </td>
                <td>
                  <bdi>{label}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
