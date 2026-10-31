// bank-cashbook-map-1, proposed (audit/bank-map-foundation/contract.json):
// the columns a bank statement path's cashbook is read with when its first
// row is not the declared headers, and the named maps that keep them.
//
// A map carries the header row and, for each role, a column and the header
// label that proves it: no currency, sign, date format, amount or decision.
// It fits a file only where every label stands at its column in the header
// row, compared in its normal form; otherwise its problems are reported and
// nothing is read with it, nothing is moved to where a label is found, and no
// other header row is searched. A choice by hand takes its labels from the
// file it is made on. Nothing here decides a match or approves anything.
import type { SourceFile } from './types.ts';

export const BANK_CASHBOOK_MAP_FAMILY = 'bank-cashbook-map-1';
export const CASHBOOK_MAP_FORMAT = 'tarasuf-column-map';
export const CASHBOOK_MAP_VERSION = 1;
export const CASHBOOK_MAP_ROLE = 'bank-cashbook';
/** Where the maps are kept, on this device only. */
export const CASHBOOK_MAP_STORAGE_KEY = 'tarasuf.column-maps.v1';
export const CASHBOOK_ROLES = [
  'date',
  'voucher',
  'description',
  'reference',
  'receipts',
  'payments',
] as const;
export type CashbookRole = (typeof CASHBOOK_ROLES)[number];
const REQUIRED: ReadonlySet<CashbookRole> = new Set([
  'date',
  'voucher',
  'receipts',
  'payments',
]);
export const CASHBOOK_MAP_LIMITS = {
  bytes: 16384,
  name: 80,
  label: 120,
  header: 30,
  column: 100,
  maps: 50,
} as const;

/** A column, 1-based, and its header label in normal form. */
export type MappedColumn = { column: number; label: string };
/** The columns one cashbook is read with: the header row, 1-based, and per
 * role a column or null for an optional role without one. */
export type CashbookColumns = {
  header: number;
  columns: Record<CashbookRole, MappedColumn | null>;
};
export type CashbookMap = {
  format: typeof CASHBOOK_MAP_FORMAT;
  version: typeof CASHBOOK_MAP_VERSION;
  role: typeof CASHBOOK_MAP_ROLE;
  name: string;
} & CashbookColumns;
/** A choice by hand: the header row and a column per role, or null. */
export type CashbookChoice = {
  header: number;
  columns: Record<CashbookRole, number | null>;
};
export type CashbookMapProblem =
  | { kind: 'sheets'; count: number }
  | { kind: 'header-row'; row: number }
  | {
      kind: 'column';
      role: CashbookRole;
      column: number;
      label: string;
      /** The normal form of what the file holds there, empty if nothing. */
      found: string;
      /** Cells of the first 30 rows holding the label, in A1 form. */
      elsewhere: string[];
    };

/** The contract's codes, first failing rule first. */
export type CashbookMapCode =
  | 'MAP_JSON'
  | 'MAP_FORMAT'
  | 'MAP_KEYS'
  | 'MAP_NAME'
  | 'MAP_HEADER'
  | 'MAP_COLUMN'
  | 'MAP_LABEL';
export class CashbookMapError extends Error {
  readonly code: CashbookMapCode;
  constructor(code: CashbookMapCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}
const refuse = (code: CashbookMapCode, detail: string): never => {
  throw new CashbookMapError(code, detail);
};

/** A label or a name in normal form: NFC, every run of white space one
 * space, trimmed. Case, digits, marks and the tatweel stay as written. */
export function normalLabel(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
/** A control character; every one is a single UTF-16 code unit. */
const control = (text: string) => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x08 || (c >= 0x0e && c <= 0x1f) || c === 0x7f) return true;
  }
  return false;
};
/** Text in normal form, not empty, within a limit in UTF-16 code units. */
const normalText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' &&
  normalLabel(value) === value &&
  value.length > 0 &&
  value.length <= limit &&
  !control(value);
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const sameKeys = (v: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};
const within = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;

/** Required roles have a column; every column is within limits and used by
 * one role only. */
function checkColumns(columns: Record<CashbookRole, number | null>) {
  const used = new Set<number>();
  for (const role of CASHBOOK_ROLES) {
    const column = columns[role];
    if (column === null) {
      if (REQUIRED.has(role)) refuse('MAP_COLUMN', `${role} has no column`);
      continue;
    }
    if (!within(column, CASHBOOK_MAP_LIMITS.column))
      refuse('MAP_COLUMN', `${role} column`);
    if (used.has(column)) refuse('MAP_COLUMN', `column ${column} twice`);
    used.add(column);
  }
}

/** A parsed map file checked by the contract's rules, in their order. */
export function validateCashbookMap(value: unknown): CashbookMap {
  if (!plain(value)) return refuse('MAP_JSON', 'not an object');
  if (
    value.format !== CASHBOOK_MAP_FORMAT ||
    value.version !== CASHBOOK_MAP_VERSION ||
    value.role !== CASHBOOK_MAP_ROLE
  )
    refuse('MAP_FORMAT', 'another format, version or role');
  const keys = ['format', 'version', 'role', 'name', 'header', 'columns'];
  const columns = value.columns;
  if (
    !sameKeys(value, keys) ||
    !plain(columns) ||
    !sameKeys(columns, CASHBOOK_ROLES) ||
    Object.values(columns).some(
      (v) => v !== null && (!plain(v) || !sameKeys(v, ['column', 'label'])),
    )
  )
    refuse('MAP_KEYS', 'a key missing or not of a map');
  const entries = columns as Record<
    CashbookRole,
    { column: unknown; label: unknown } | null
  >;
  if (!normalText(value.name, CASHBOOK_MAP_LIMITS.name))
    refuse('MAP_NAME', 'the name');
  if (!within(value.header, CASHBOOK_MAP_LIMITS.header))
    refuse('MAP_HEADER', 'the header row');
  checkColumns(
    Object.fromEntries(
      CASHBOOK_ROLES.map((role) => [role, entries[role]?.column ?? null]),
    ) as Record<CashbookRole, number | null>,
  );
  for (const role of CASHBOOK_ROLES) {
    const entry = entries[role];
    if (entry && !normalText(entry.label, CASHBOOK_MAP_LIMITS.label))
      refuse('MAP_LABEL', `${role} label`);
  }
  return {
    format: CASHBOOK_MAP_FORMAT,
    version: CASHBOOK_MAP_VERSION,
    role: CASHBOOK_MAP_ROLE,
    name: value.name as string,
    header: value.header as number,
    columns: Object.fromEntries(
      CASHBOOK_ROLES.map((role) => {
        const entry = entries[role];
        return [
          role,
          entry
            ? { column: entry.column as number, label: entry.label as string }
            : null,
        ];
      }),
    ) as CashbookColumns['columns'],
  };
}

/** A map file's bytes, as TextDecoder and JSON.parse read them. */
export function parseCashbookMap(bytes: ArrayBuffer | Uint8Array): CashbookMap {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength > CASHBOOK_MAP_LIMITS.bytes)
    refuse('MAP_JSON', 'larger than the limit');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    return refuse('MAP_JSON', 'not UTF-8 JSON');
  }
  return validateCashbookMap(value);
}

/** A map as its file holds it. */
export function serializeCashbookMap(map: CashbookMap): string {
  return `${JSON.stringify(validateCashbookMap(map), null, 1)}\n`;
}

/** A 1-based column in A1 form. */
export const columnLetters = (column: number) => {
  let s = '';
  for (let c = column; c > 0; c = Math.floor((c - 1) / 26))
    s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};
/** The text of a cell, 1-based, of the first sheet. */
const cellText = (file: SourceFile, row: number, column: number) =>
  file.sheets[0]?.rows[row - 1]?.[column - 1] ?? '';
const widthOf = (file: SourceFile) =>
  Math.max(0, ...(file.sheets[0]?.rows ?? []).map((r) => r.length));

function fileProblems(file: SourceFile, header: number): CashbookMapProblem[] {
  if (file.sheets.length !== 1)
    return [{ kind: 'sheets', count: file.sheets.length }];
  if (header > file.sheets[0].rows.length)
    return [{ kind: 'header-row', row: header }];
  return [];
}

/** Why a map's columns do not fit a file; none when they fit. */
export function cashbookMapProblems(
  file: SourceFile,
  columns: CashbookColumns,
): CashbookMapProblem[] {
  const problems = fileProblems(file, columns.header);
  if (problems.length) return problems;
  const rows = Math.min(CASHBOOK_MAP_LIMITS.header, file.sheets[0].rows.length);
  const width = widthOf(file);
  for (const role of CASHBOOK_ROLES) {
    const entry = columns.columns[role];
    if (!entry) continue;
    const found = normalLabel(cellText(file, columns.header, entry.column));
    if (found === entry.label) continue;
    const elsewhere: string[] = [];
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= width; c++)
        if (normalLabel(cellText(file, r, c)) === entry.label)
          elsewhere.push(`${columnLetters(c)}${r}`);
    problems.push({
      kind: 'column',
      role,
      column: entry.column,
      label: entry.label,
      found,
      elsewhere,
    });
  }
  return problems;
}

/** The columns a choice by hand stands for, with their labels read from the
 * file; or why the file cannot be read with them. */
export function chooseCashbookColumns(
  file: SourceFile,
  choice: CashbookChoice,
): { columns: CashbookColumns } | { problems: CashbookMapProblem[] } {
  if (!within(choice.header, CASHBOOK_MAP_LIMITS.header))
    refuse('MAP_HEADER', 'the header row');
  checkColumns(choice.columns);
  const problems = fileProblems(file, choice.header);
  if (problems.length) return { problems };
  const columns = {} as CashbookColumns['columns'];
  for (const role of CASHBOOK_ROLES) {
    const column = choice.columns[role];
    if (column === null) {
      columns[role] = null;
      continue;
    }
    const label = normalLabel(cellText(file, choice.header, column));
    if (!normalText(label, CASHBOOK_MAP_LIMITS.label))
      refuse('MAP_LABEL', `${role} has no header label`);
    columns[role] = { column, label };
  }
  return { columns: { header: choice.header, columns } };
}

/** What the reading leaves out: the rows above the header, and the labelled
 * columns no role names. */
export function cashbookColumnsUnread(
  file: SourceFile,
  columns: CashbookColumns,
): { above: number; unread: MappedColumn[] } {
  const used = new Set(
    CASHBOOK_ROLES.flatMap((r) => columns.columns[r]?.column ?? []),
  );
  const unread: MappedColumn[] = [];
  for (let c = 1; c <= widthOf(file); c++) {
    const label = normalLabel(cellText(file, columns.header, c));
    if (label && !used.has(c)) unread.push({ column: c, label });
  }
  return { above: columns.header - 1, unread };
}

/** A map under a name, for columns that fit their file. */
export function namedCashbookMap(
  name: string,
  columns: CashbookColumns,
): CashbookMap {
  return validateCashbookMap({
    format: CASHBOOK_MAP_FORMAT,
    version: CASHBOOK_MAP_VERSION,
    role: CASHBOOK_MAP_ROLE,
    name: normalLabel(name),
    header: columns.header,
    columns: columns.columns,
  });
}

/** Columns as a session holds them with its cashbook file: the header row
 * and the roles' columns and labels of a valid map, nothing else. */
export function cashbookColumnsOf(value: unknown): CashbookColumns {
  if (!plain(value) || !sameKeys(value, ['header', 'columns']))
    return refuse('MAP_KEYS', 'columns of a session');
  return mapColumns(
    validateCashbookMap({
      format: CASHBOOK_MAP_FORMAT,
      version: CASHBOOK_MAP_VERSION,
      role: CASHBOOK_MAP_ROLE,
      name: 'session',
      header: value.header,
      columns: value.columns,
    }),
  );
}

/** The columns a map carries, without its name. */
export const mapColumns = (map: CashbookMap): CashbookColumns => ({
  header: map.header,
  columns: map.columns,
});

/** The maps kept on this device; those that are not valid are counted and
 * not offered. */
export function readStoredCashbookMaps(raw: string | null): {
  maps: CashbookMap[];
  unreadable: number;
} {
  if (raw === null) return { maps: [], unreadable: 0 };
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { maps: [], unreadable: 1 };
  }
  if (!Array.isArray(list)) return { maps: [], unreadable: 1 };
  const maps: CashbookMap[] = [];
  let unreadable = 0;
  for (const item of list.slice(0, CASHBOOK_MAP_LIMITS.maps)) {
    try {
      const map = validateCashbookMap(item);
      if (maps.some((m) => m.name === map.name)) unreadable++;
      else maps.push(map);
    } catch {
      unreadable++;
    }
  }
  return {
    maps,
    unreadable:
      unreadable + Math.max(0, list.length - CASHBOOK_MAP_LIMITS.maps),
  };
}

/** The maps with one saved: a map of the same name is replaced; a new name
 * beyond the limit is refused with null. */
export function withCashbookMap(
  maps: readonly CashbookMap[],
  map: CashbookMap,
): CashbookMap[] | null {
  const checked = validateCashbookMap(map);
  const at = maps.findIndex((m) => m.name === checked.name);
  if (at >= 0) return maps.map((m, i) => (i === at ? checked : m));
  if (maps.length >= CASHBOOK_MAP_LIMITS.maps) return null;
  return [...maps, checked];
}
