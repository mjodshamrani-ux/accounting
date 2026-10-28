import { MAX_FILE_BYTES, MAX_ROWS } from './types.ts';

// INV-2: one movement register (a line per opening, movement and closing of
// each item and dimensions) and one GL summary of the inventory accounts,
// read from their bytes under the proposed inventory-movement-bridge-1
// contract (audit/inventory-movement-foundation/contract.json). The existing
// inventory-posted-register-gl-1 family and its readings are untouched.
export const IMB_VERSION = 'inventory-movement-bridge-1';
export const IMB_ROLES = ['movement-register', 'gl-summary'] as const;
export const IMB_CLAIM =
  'Consistency of one movement register and one GL summary within a confirmed period: for each item and dimensions the printed opening plus the movements posted in the period equals the printed closing, in quantity and in value, transfers and returns proven by their own lines, and each GL account equal to the register component by component. No costing, valuation, write-down, count or unit conversion.';
export const IMB_SCOPE_FIELDS = [
  'Entity',
  'Currency',
  'Period start',
  'Period end',
  'Negative balances',
] as const;
export const IMB_COLUMNS = [
  'Movement ID',
  'Item ID',
  'Item dimensions',
  'Kind',
  'Quantity',
  'Unit',
  'Value',
  'Movement date',
  'Posting date',
  'GL account',
  'Transfer ID',
  'Origin ID',
] as const;
export const IMB_GL_COLUMNS = [
  'GL account',
  'Opening',
  'Debit',
  'Credit',
  'Closing',
] as const;
export const IMB_MOVES = [
  'receipt',
  'issue',
  'transfer-in',
  'transfer-out',
  'adjustment-in',
  'adjustment-out',
  'return-in',
  'return-out',
] as const;
export const IMB_KINDS = ['opening', 'closing', ...IMB_MOVES] as const;
export const IMB_INFLOWS = [
  'receipt',
  'transfer-in',
  'adjustment-in',
  'return-in',
] as const;
export const IMB_OUTFLOWS = [
  'issue',
  'transfer-out',
  'adjustment-out',
  'return-out',
] as const;
export const IMB_CURRENCIES: Readonly<Record<string, number>> = {
  SAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};
export const IMB_RUN_CODES = [
  'LINE_UNREADABLE',
  'GL_FILE',
  'GL_UNREADABLE',
] as const;
export const IMB_POSITION_CODES = [
  'IDENTITY',
  'KIND',
  'QUANTITY',
  'VALUE',
  'DATE',
  'LINK',
  'LINE_WIDTH',
  'DUPLICATE_MOVEMENT',
  'UNIT_CONFLICT',
  'ACCOUNT_CONFLICT',
  'BALANCE_DATE',
  'BALANCE_REPEATED',
  'NEGATIVE_BALANCE',
  'TRANSFER_REPEATED',
  'TRANSFER_UNPAIRED',
  'TRANSFER_MISMATCH',
  'RETURN_ORIGIN',
  'RETURN_CAPACITY',
] as const;
export const IMB_ACCOUNT_CODES = [
  'GL_AMOUNT',
  'GL_WIDTH',
  'GL_DUPLICATE',
  'POSITION',
] as const;
export const IMB_TOTALS = [
  'opening',
  'receipt',
  'issue',
  'adjustment-in',
  'adjustment-out',
  'return-in',
  'return-out',
  'closing',
  'transferred',
] as const;

export type ImbRole = (typeof IMB_ROLES)[number];
export type ImbKind = (typeof IMB_KINDS)[number];
export type ImbMove = (typeof IMB_MOVES)[number];
export type ImbScopeField = (typeof IMB_SCOPE_FIELDS)[number];
export type ImbFile = { name: string; sha256: string; bytes: Uint8Array };
export type ImbReading = {
  role: ImbRole;
  family: typeof IMB_VERSION;
  confirmed: boolean;
};
export type ImbInput = {
  files: [ImbFile, ImbFile];
  readings: [ImbReading, ImbReading];
  scope: { confirmed: boolean; fields: Record<ImbScopeField, string> };
};
/** Quantity in thousandths and value in minor units, as integer text. */
export type ImbPair = { quantity: string; value: string };
export type ImbLine = {
  id: string;
  kind: ImbKind;
  quantity: string;
  value: string;
  row: number;
};
export type ImbPosition = {
  key: string;
  item: string;
  dims: string;
  status: 'held' | 'missing' | 'inconsistent' | 'consistent';
  codes: string[];
  unit: string | null;
  account: string | null;
  opening: ImbPair | null;
  closing: ImbPair | null;
  flows: Record<ImbMove, ImbPair> | null;
  computed: ImbPair | null;
  lines: ImbLine[] | null;
  rows: number[];
};
export type ImbSide = {
  opening: string;
  debit: string;
  credit: string;
  closing: string;
};
export type ImbAccount = {
  account: string;
  status: 'held' | 'missing' | 'difference' | 'consistent';
  codes: string[];
  register: ImbSide | null;
  gl: ImbSide | null;
  difference: ImbSide | null;
  rows: number[];
};
export type ImbResult = {
  version: typeof IMB_VERSION;
  context: string;
  files: { name: string; sha256: string; role: ImbRole }[];
  scope: Record<ImbScopeField, string>;
  decimals: number | null;
  refused: 'SCOPE' | 'ENCODING' | 'CSV' | 'HEADER' | null;
  positions: ImbPosition[];
  accounts: ImbAccount[];
  excluded: { row: number; id: string }[];
  datedOutside: { row: number; id: string }[];
  unseenOrigins: { row: number; id: string | null; origin: string }[];
  repeatedHeaders: { file: 'register' | 'gl'; row: number }[];
  unplaced: { file: 'register' | 'gl'; row: number; code: string }[];
  totals: Record<(typeof IMB_TOTALS)[number], string> | null;
  run: string[];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never {
  throw new Error(`IMB_${code}`);
}
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const LIMIT = 10n ** 14n;
const TRANSFERS: readonly string[] = ['transfer-in', 'transfer-out'];
const RETURNS: Readonly<Record<string, string>> = {
  'return-out': 'receipt',
  'return-in': 'issue',
};
const isMove = (k: string | null) =>
  k !== null && (IMB_MOVES as readonly string[]).includes(k);
const isInflow = (k: string) => (IMB_INFLOWS as readonly string[]).includes(k);

// Reading rules. Only ordinary spaces are removed at either end.
export const imbStrip = (v: string) => v.replace(/^ +| +$/g, '');
const ERRORS = [
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#DIV/0!',
  '#NAME?',
  '#NULL!',
  '#NUM!',
];
export function imbText(v: string): string | null {
  const s = imbStrip(v);
  if (
    !s ||
    // The contract counts code points, not UTF-16 units.
    // oxlint-disable-next-line typescript/no-misused-spread
    [...s].length > 500 ||
    /^[=+@-]/.test(s) ||
    ERRORS.some((e) => s.toUpperCase().startsWith(e)) ||
    /[\p{Cc}\p{Cf}]|(?! )\p{Z}/u.test(s)
  )
    return null;
  return s;
}
export function imbDate(v: string): string | null {
  const s = imbStrip(v),
    m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]
    ? s
    : null;
}
/**
 * An integer in 10^-places, or null when the number rules refuse the cell.
 * A minus sign reads only where signed; a minus before zero reads as zero.
 */
export function imbNumber(
  v: string,
  places: number,
  signed: boolean,
): bigint | null {
  const s = imbStrip(v)
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/\u066b/g, '.');
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(s);
  if (!m || (m[1] && !signed) || (m[3] ?? '').length > places) return null;
  const n =
    BigInt(m[2]) * 10n ** BigInt(places) +
    BigInt((m[3] ?? '').padEnd(places, '0') || '0');
  if (n > LIMIT) return null;
  return m[1] ? -n : n;
}
const width = (row: readonly string[]) => {
  let n = row.length;
  while (n && !imbStrip(row[n - 1])) n--;
  return n;
};
const cell = (row: readonly string[], j: number) => row[j] ?? '';

/**
 * RFC 4180 records as the contract reads them: a byte-order mark is dropped,
 * LF, CRLF and CR end a record, and a quote inside an unquoted field, text
 * after a closing quote or an unclosed quote refuses the file.
 */
export function imbRecords(bytes: Uint8Array): string[][] | 'ENCODING' | 'CSV' {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return 'ENCODING';
  }
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const rows: string[][] = [];
  let row: string[] = [],
    i = 0;
  const n = t.length;
  while (i < n) {
    let value = '';
    if (t[i] === '"') {
      let j = i + 1,
        closed = false;
      while (j < n) {
        if (t[j] === '"') {
          if (t[j + 1] === '"') {
            value += '"';
            j += 2;
          } else {
            closed = true;
            j++;
            break;
          }
        } else value += t[j++];
      }
      if (!closed) return 'CSV';
      i = j;
    } else {
      let j = i;
      while (j < n && t[j] !== ',' && t[j] !== '\r' && t[j] !== '\n') {
        if (t[j] === '"') return 'CSV';
        j++;
      }
      value = t.slice(i, j);
      i = j;
    }
    row.push(value);
    if (i === n) break;
    if (t[i] === ',') {
      i++;
      if (i === n) row.push('');
      continue;
    }
    if (t[i] !== '\r' && t[i] !== '\n') return 'CSV';
    i += t[i] === '\r' && t[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

// Beyond the contract: the same row and cell bounds as the other families.
function bounded(rows: string[][]) {
  if (
    rows.length > MAX_ROWS ||
    rows.some((r) => r.length > 100 || r.some((v) => v.length > 32767))
  )
    fail('SOURCE_CAPACITY');
}

/** The header's column map, the line rows and the rows that repeat the
 * header, or null when the first non-blank row is not the columns. */
function table(rows: string[][], columns: readonly string[]) {
  const numbered = rows
    .map((cells, i) => ({ row: i + 1, cells }))
    .filter((r) => width(r.cells));
  if (!numbered.length) return null;
  const head = numbered[0].cells
    .slice(0, width(numbered[0].cells))
    .map(imbStrip);
  if (
    head.length !== columns.length ||
    new Set(head).size !== columns.length ||
    !columns.every((c) => head.includes(c))
  )
    return null;
  const lines: { row: number; cells: string[] }[] = [],
    repeated: number[] = [];
  for (const r of numbered.slice(1)) {
    const own = r.cells.slice(0, width(r.cells)).map(imbStrip);
    if (own.length === head.length && own.every((v, j) => v === head[j]))
      repeated.push(r.row);
    else lines.push(r);
  }
  return {
    cols: new Map(head.map((c, j) => [c, j])),
    lines,
    repeated,
  };
}

type Line = {
  row: number;
  id: string | null;
  item: string | null;
  dims: string | null;
  kind: ImbKind | null;
  q: bigint | null;
  unit: string | null;
  v: bigint | null;
  md: string | null;
  pd: string | null;
  account: string | null;
  tid: string | null;
  oid: string | null;
  codes: Set<string>;
  whole: boolean;
};

function readLine(
  row: number,
  cells: string[],
  cols: Map<string, number>,
  decimals: number,
): Line {
  const get = (c: string) => cell(cells, cols.get(c)!);
  const named = imbStrip(get('Kind'));
  const kind = (IMB_KINDS as readonly string[]).includes(named)
    ? (named as ImbKind)
    : null;
  const balance = kind === 'opening' || kind === 'closing';
  const x: Line = {
    row,
    id: imbText(get('Movement ID')),
    item: imbText(get('Item ID')),
    dims: imbText(get('Item dimensions')),
    kind,
    q: imbNumber(get('Quantity'), 3, balance),
    unit: imbText(get('Unit')),
    v: imbNumber(get('Value'), decimals, balance),
    md: imbDate(get('Movement date')),
    pd: imbDate(get('Posting date')),
    account: imbText(get('GL account')),
    tid: imbText(get('Transfer ID')),
    oid: imbText(get('Origin ID')),
    codes: new Set(),
    whole: false,
  };
  const tidBlank = !imbStrip(get('Transfer ID')),
    oidBlank = !imbStrip(get('Origin ID'));
  if (x.id === null || x.unit === null || x.account === null)
    x.codes.add('IDENTITY');
  if (kind === null) x.codes.add('KIND');
  if (x.q === null) x.codes.add('QUANTITY');
  if (x.v === null) x.codes.add('VALUE');
  if (x.md === null || x.pd === null) x.codes.add('DATE');
  const link =
    kind !== null && TRANSFERS.includes(kind)
      ? x.tid === null || !oidBlank
      : kind !== null && Object.hasOwn(RETURNS, kind)
        ? x.oid === null || !tidBlank
        : !tidBlank || !oidBlank;
  if (link) x.codes.add('LINK');
  if (width(cells) > IMB_COLUMNS.length) x.codes.add('LINE_WIDTH');
  x.whole = !x.codes.size && x.item !== null && x.dims !== null;
  return x;
}

type GlLine = {
  row: number;
  account: string | null;
  opening: bigint | null;
  debit: bigint | null;
  credit: bigint | null;
  closing: bigint | null;
  wide: boolean;
};

/** The GL lines and repeated header rows, or null when the GL file is
 * refused as a file. */
function readGl(bytes: Uint8Array, decimals: number) {
  const records = imbRecords(bytes);
  if (typeof records === 'string') return null;
  bounded(records);
  const found = table(records, IMB_GL_COLUMNS);
  if (!found) return null;
  const lines: GlLine[] = found.lines.map(({ row, cells }) => {
    const get = (c: string) => cell(cells, found.cols.get(c)!);
    return {
      row,
      account: imbText(get('GL account')),
      opening: imbNumber(get('Opening'), decimals, true),
      debit: imbNumber(get('Debit'), decimals, false),
      credit: imbNumber(get('Credit'), decimals, false),
      closing: imbNumber(get('Closing'), decimals, true),
      wide: width(cells) > IMB_GL_COLUMNS.length,
    };
  });
  return { lines, repeated: found.repeated };
}

function validate(input: ImbInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort(byText).join('|') !== 'files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2
  )
    fail('INPUT');
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      Object.keys(r).sort(byText).join('|') !== 'confirmed|family|role' ||
      r.role !== IMB_ROLES[i] ||
      r.family !== IMB_VERSION ||
      r.confirmed !== true
    )
      fail('READING');
  });
  for (const f of input.files)
    if (
      !plain(f) ||
      typeof f.name !== 'string' ||
      !f.name ||
      f.name.length > 255 ||
      !/\.csv$/i.test(f.name) ||
      !(f.bytes instanceof Uint8Array) ||
      !f.bytes.byteLength ||
      f.bytes.byteLength > MAX_FILE_BYTES ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      fail('SOURCE');
  const s = input.scope;
  if (
    !plain(s) ||
    Object.keys(s).sort(byText).join('|') !== 'confirmed|fields' ||
    s.confirmed !== true ||
    !plain(s.fields)
  )
    fail('SCOPE');
}

function scopeOk(fields: Record<string, unknown>) {
  const keys = Object.keys(fields).sort(byText);
  if (keys.join('|') !== [...IMB_SCOPE_FIELDS].sort(byText).join('|'))
    return false;
  if (
    !IMB_SCOPE_FIELDS.every(
      (k) => typeof fields[k] === 'string' && imbText(fields[k]) === fields[k],
    )
  )
    return false;
  const f = fields as Record<ImbScopeField, string>;
  return (
    Object.hasOwn(IMB_CURRENCIES, f.Currency) &&
    imbDate(f['Period start']) !== null &&
    imbDate(f['Period end']) !== null &&
    f['Period start'] <= f['Period end'] &&
    (f['Negative balances'] === 'allowed' ||
      f['Negative balances'] === 'not allowed')
  );
}

const pair = (x: Line | null): ImbPair | null =>
  x === null ? null : { quantity: String(x.q), value: String(x.v) };

export function reconcileMovementBridge(input: ImbInput): ImbResult {
  validate(input);
  const [registerFile, glFile] = input.files;
  const fields = { ...input.scope.fields } as Record<ImbScopeField, string>;
  const result: ImbResult = {
    version: IMB_VERSION,
    context: JSON.stringify([
      IMB_VERSION,
      registerFile.sha256,
      glFile.sha256,
      fields,
    ]),
    files: input.files.map((f, i) => ({
      name: f.name,
      sha256: f.sha256,
      role: IMB_ROLES[i],
    })),
    scope: fields,
    decimals: null,
    refused: null,
    positions: [],
    accounts: [],
    excluded: [],
    datedOutside: [],
    unseenOrigins: [],
    repeatedHeaders: [],
    unplaced: [],
    totals: null,
    run: [],
  };
  if (!scopeOk(fields)) {
    result.refused = 'SCOPE';
    return result;
  }
  const decimals = IMB_CURRENCIES[fields.Currency];
  result.decimals = decimals;
  const start = fields['Period start'],
    end = fields['Period end'];
  const inside = (d: string | null) => d !== null && start <= d && d <= end;
  const records = imbRecords(registerFile.bytes);
  if (typeof records === 'string') {
    result.refused = records;
    return result;
  }
  bounded(records);
  const found = table(records, IMB_COLUMNS);
  if (!found) {
    result.refused = 'HEADER';
    return result;
  }
  const lines = found.lines.map((r) =>
    readLine(r.row, r.cells, found.cols, decimals),
  );

  const run = new Set<string>();
  const unplaced: ImbResult['unplaced'] = [];
  for (const x of lines)
    if (x.item === null || x.dims === null) {
      run.add('LINE_UNREADABLE');
      unplaced.push({ file: 'register', row: x.row, code: 'LINE_UNREADABLE' });
    }
  const excluded = lines.filter(
    (x) => x.whole && isMove(x.kind) && !inside(x.pd),
  );
  const skip = new Set(excluded);
  const dated = lines.filter(
    (x) => x.whole && isMove(x.kind) && inside(x.pd) && !inside(x.md),
  );
  const keyOf = (x: Line) =>
    skip.has(x) || x.item === null || x.dims === null
      ? null
      : JSON.stringify([x.item, x.dims]);
  const mine = new Map<string, Line[]>();
  for (const x of lines) {
    const key = keyOf(x);
    if (key === null) continue;
    if (!mine.has(key)) mine.set(key, []);
    mine.get(key)!.push(x);
  }
  const held = new Map<string, Set<string>>();
  const holdKey = (key: string, code: string) => {
    if (!held.has(key)) held.set(key, new Set());
    held.get(key)!.add(code);
  };
  const hold = (x: Line, code: string) => {
    const key = keyOf(x);
    if (key !== null) holdKey(key, code);
  };

  const ids = new Map<string, number>();
  for (const x of lines)
    if (x.id !== null) ids.set(x.id, (ids.get(x.id) ?? 0) + 1);
  const negativeHeld = fields['Negative balances'] === 'not allowed';
  for (const [key, own] of mine) {
    for (const x of own) {
      for (const code of x.codes) hold(x, code);
      if (x.id !== null && ids.get(x.id)! > 1) hold(x, 'DUPLICATE_MOVEMENT');
      const boundary =
        x.kind === 'opening' ? start : x.kind === 'closing' ? end : null;
      if (
        boundary !== null &&
        ((x.md !== null && x.md !== boundary) ||
          (x.pd !== null && x.pd !== boundary))
      )
        hold(x, 'BALANCE_DATE');
      if (
        boundary !== null &&
        negativeHeld &&
        ((x.q ?? 0n) < 0n || (x.v ?? 0n) < 0n)
      )
        hold(x, 'NEGATIVE_BALANCE');
    }
    if (new Set(own.filter((x) => x.unit !== null).map((x) => x.unit)).size > 1)
      holdKey(key, 'UNIT_CONFLICT');
    if (
      new Set(own.filter((x) => x.account !== null).map((x) => x.account))
        .size > 1
    )
      holdKey(key, 'ACCOUNT_CONFLICT');
    if (
      own.filter((x) => x.kind === 'opening').length > 1 ||
      own.filter((x) => x.kind === 'closing').length > 1
    )
      holdKey(key, 'BALANCE_REPEATED');
  }

  // Transfers: one out and one in, in the period, by Transfer ID.
  const groups = new Map<string, Line[]>();
  for (const x of lines)
    if (
      x.kind !== null &&
      TRANSFERS.includes(x.kind) &&
      inside(x.pd) &&
      x.tid !== null
    ) {
      if (!groups.has(x.tid)) groups.set(x.tid, []);
      groups.get(x.tid)!.push(x);
    }
  const pairs = new Map<string, [Line, Line]>();
  for (const [tid, group] of groups) {
    const outs = group.filter((x) => x.kind === 'transfer-out'),
      ins = group.filter((x) => x.kind === 'transfer-in');
    if (outs.length > 1 || ins.length > 1)
      for (const x of group) hold(x, 'TRANSFER_REPEATED');
    else if (!outs.length || !ins.length) hold(group[0], 'TRANSFER_UNPAIRED');
    else {
      const [a, b] = [outs[0], ins[0]];
      const same = (['item', 'unit', 'q', 'v'] as const).every(
        (f) => a[f] !== null && a[f] === b[f],
      );
      if (!same) {
        hold(a, 'TRANSFER_MISMATCH');
        hold(b, 'TRANSFER_MISMATCH');
      }
      pairs.set(tid, [a, b]);
    }
  }

  // Returns: each names its origin; the returns of the period on one origin
  // stay within its quantity and value.
  const unseen: ImbResult['unseenOrigins'] = [];
  const valid = new Map<Line, Line[]>();
  for (const x of lines) {
    if (x.kind === null || !Object.hasOwn(RETURNS, x.kind) || !inside(x.pd))
      continue;
    if (x.oid === null) continue;
    const named = lines.filter((o) => o.id === x.oid);
    if (!named.length) {
      unseen.push({ row: x.row, id: x.id, origin: x.oid });
      continue;
    }
    const o = named[0];
    if (
      named.length > 1 ||
      !o.whole ||
      o.kind !== RETURNS[x.kind] ||
      o.item !== x.item ||
      o.unit !== x.unit
    ) {
      hold(x, 'RETURN_ORIGIN');
      continue;
    }
    if (!valid.has(o)) valid.set(o, []);
    valid.get(o)!.push(x);
  }
  for (const [o, rets] of valid)
    if (
      rets.some((x) => x.q === null || x.v === null) ||
      rets.reduce((a, x) => a + x.q!, 0n) > o.q! ||
      rets.reduce((a, x) => a + x.v!, 0n) > o.v!
    )
      for (const x of rets) hold(x, 'RETURN_CAPACITY');

  const blocking = new Set<string>([...IMB_POSITION_CODES, 'LINE_UNREADABLE']);
  const order = [...mine.keys()].sort((a, b) => {
    const [ai, ad] = JSON.parse(a) as [string, string],
      [bi, bd] = JSON.parse(b) as [string, string];
    return byText(ai, bi) || byText(ad, bd);
  });
  const statusOf = new Map<string, ImbPosition['status']>();
  for (const key of order) {
    const own = mine.get(key)!;
    const codes = [...new Set([...(held.get(key) ?? []), ...run])]
      .filter((c) => blocking.has(c))
      .sort(byText);
    const base = {
      key: `${own[0].item}|${own[0].dims}`,
      item: own[0].item!,
      dims: own[0].dims!,
      rows: own.map((x) => x.row).sort((a, b) => a - b),
    };
    if (codes.length) {
      statusOf.set(key, 'held');
      result.positions.push({
        ...base,
        status: 'held',
        codes,
        unit: null,
        account: null,
        opening: null,
        closing: null,
        flows: null,
        computed: null,
        lines: null,
      });
      continue;
    }
    const opening = own.find((x) => x.kind === 'opening') ?? null,
      closing = own.find((x) => x.kind === 'closing') ?? null;
    const sum = (k: ImbMove, f: 'q' | 'v') =>
      own.reduce((a, x) => (x.kind === k ? a + x[f]! : a), 0n);
    const flows = Object.fromEntries(
      IMB_MOVES.map((k) => [
        k,
        { quantity: String(sum(k, 'q')), value: String(sum(k, 'v')) },
      ]),
    ) as Record<ImbMove, ImbPair>;
    let computedQ: bigint | null = null,
      computedV: bigint | null = null;
    if (opening) {
      computedQ = opening.q!;
      computedV = opening.v!;
      for (const k of IMB_MOVES) {
        const sign = isInflow(k) ? 1n : -1n;
        computedQ += sign * sum(k, 'q');
        computedV += sign * sum(k, 'v');
      }
    }
    let status: ImbPosition['status'];
    let bridge: string[];
    if (!opening || !closing) {
      status = 'missing';
      bridge = [
        ...(closing ? [] : ['CLOSING_ABSENT']),
        ...(opening ? [] : ['OPENING_ABSENT']),
      ];
    } else {
      bridge = [
        ...(computedQ !== closing.q ? ['QUANTITY_BRIDGE'] : []),
        ...(computedV !== closing.v ? ['VALUE_BRIDGE'] : []),
      ];
      status = bridge.length ? 'inconsistent' : 'consistent';
    }
    statusOf.set(key, status);
    result.positions.push({
      ...base,
      status,
      codes: bridge,
      unit: own[0].unit,
      account: own[0].account,
      opening: pair(opening),
      closing: pair(closing),
      flows,
      computed:
        computedQ === null
          ? null
          : { quantity: String(computedQ), value: String(computedV) },
      lines: own
        .map((x) => ({
          id: x.id!,
          kind: x.kind!,
          quantity: String(x.q),
          value: String(x.v),
          row: x.row,
        }))
        .sort((a, b) => byText(a.id, b.id)),
    });
  }

  // The GL summary, compared account by account.
  const gl = readGl(glFile.bytes, decimals);
  const glLines = gl ? gl.lines : [];
  if (!gl) run.add('GL_FILE');
  for (const g of glLines)
    if (g.account === null) {
      run.add('GL_UNREADABLE');
      unplaced.push({ file: 'gl', row: g.row, code: 'GL_UNREADABLE' });
    }
  const byAccount = new Map<string, GlLine[]>();
  for (const g of glLines)
    if (g.account !== null) {
      if (!byAccount.has(g.account)) byAccount.set(g.account, []);
      byAccount.get(g.account)!.push(g);
    }
  const named = new Map<string, Set<string>>();
  for (const [key, own] of mine)
    for (const x of own)
      if (x.account !== null) {
        if (!named.has(x.account)) named.set(x.account, new Set());
        named.get(x.account)!.add(key);
      }
  const accountRun = IMB_RUN_CODES.filter((c) => run.has(c));
  for (const account of [
    ...new Set([...named.keys(), ...byAccount.keys()]),
  ].sort(byText)) {
    const codes = new Set<string>(accountRun);
    const own = byAccount.get(account) ?? [];
    if (own.length > 1) codes.add('GL_DUPLICATE');
    for (const g of own) {
      if (
        g.opening === null ||
        g.debit === null ||
        g.credit === null ||
        g.closing === null
      )
        codes.add('GL_AMOUNT');
      if (g.wide) codes.add('GL_WIDTH');
    }
    if (
      [...(named.get(account) ?? [])].some(
        (k) => statusOf.get(k) !== 'consistent',
      )
    )
      codes.add('POSITION');
    const entry: ImbAccount = {
      account,
      status: 'held',
      codes: [...codes].sort(byText),
      register: null,
      gl: null,
      difference: null,
      rows: own.map((g) => g.row),
    };
    if (!codes.size) {
      let reg: Record<keyof ImbSide, bigint> | null = null;
      if (named.has(account)) {
        reg = { opening: 0n, debit: 0n, credit: 0n, closing: 0n };
        for (const key of named.get(account)!)
          for (const x of mine.get(key)!) {
            if (x.kind === 'opening' || x.kind === 'closing') {
              reg[x.kind] += x.v!;
              continue;
            }
            if (TRANSFERS.includes(x.kind!)) {
              const [a, b] = pairs.get(x.tid!)!;
              if (a.account === account && b.account === account) continue;
            }
            reg[isInflow(x.kind!) ? 'debit' : 'credit'] += x.v!;
          }
      }
      const g = own[0];
      const glSide = g
        ? {
            opening: g.opening!,
            debit: g.debit!,
            credit: g.credit!,
            closing: g.closing!,
          }
        : null;
      const text = (s: Record<keyof ImbSide, bigint>): ImbSide => ({
        opening: String(s.opening),
        debit: String(s.debit),
        credit: String(s.credit),
        closing: String(s.closing),
      });
      if (!reg) {
        entry.status = 'missing';
        entry.codes = ['REGISTER_ABSENT'];
        entry.gl = text(glSide!);
      } else if (!glSide) {
        entry.status = 'missing';
        entry.codes = ['GL_ABSENT'];
        entry.register = text(reg);
      } else {
        const diff = {
          opening: reg.opening - glSide.opening,
          debit: reg.debit - glSide.debit,
          credit: reg.credit - glSide.credit,
          closing: reg.closing - glSide.closing,
        };
        entry.codes = (Object.keys(diff) as (keyof ImbSide)[])
          .filter((k) => diff[k] !== 0n)
          .map((k) => `${k.toUpperCase()}_DIFF`)
          .sort(byText);
        entry.status = entry.codes.length ? 'difference' : 'consistent';
        entry.register = text(reg);
        entry.gl = text(glSide);
        entry.difference = text(diff);
      }
    }
    result.accounts.push(entry);
  }

  if (
    !run.has('LINE_UNREADABLE') &&
    result.positions.every(
      (p) => p.status === 'consistent' || p.status === 'inconsistent',
    )
  ) {
    const totals = Object.fromEntries(IMB_TOTALS.map((k) => [k, 0n])) as Record<
      (typeof IMB_TOTALS)[number],
      bigint
    >;
    for (const own of mine.values())
      for (const x of own) {
        if (x.kind === 'transfer-out') totals.transferred += x.v!;
        else if (x.kind !== 'transfer-in')
          totals[x.kind as (typeof IMB_TOTALS)[number]] += x.v!;
      }
    result.totals = Object.fromEntries(
      IMB_TOTALS.map((k) => [k, String(totals[k])]),
    ) as Record<(typeof IMB_TOTALS)[number], string>;
  }

  result.excluded = excluded.map((x) => ({ row: x.row, id: x.id! }));
  result.datedOutside = dated.map((x) => ({ row: x.row, id: x.id! }));
  result.unseenOrigins = unseen;
  result.repeatedHeaders = [
    ...(gl ? gl.repeated.map((row) => ({ file: 'gl' as const, row })) : []),
    ...found.repeated.map((row) => ({ file: 'register' as const, row })),
  ];
  result.unplaced = unplaced.sort(
    (a, b) => byText(a.file, b.file) || a.row - b.row || byText(a.code, b.code),
  );
  result.run = [...run].sort(byText);
  return result;
}
