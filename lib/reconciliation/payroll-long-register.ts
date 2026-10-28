import { MAX_FILE_BYTES, MAX_ROWS } from './types.ts';

// PAY-1: one long payroll register (a line per employee, dimensions and
// component, in sections that restate the run scope, with section and run
// totals) read from its bytes under the proposed payroll-long-register-1
// contract (audit/payroll-long-register-foundation/contract.json). The
// existing five-source payroll family is untouched; joining the two is owner
// decision P9.
export const PLR_VERSION = 'payroll-long-register-1';
export const PLR_ROLE = 'long-register';
export const PLR_CLAIM =
  'Consistency of one long payroll register within its confirmed run scope: each employee with every component, the net equal to earnings minus deductions, every printed total equal to its lines. No posting, no tax or social insurance calculation, no payment proof.';
export const PLR_LABELS = [
  'Entity',
  'Payroll run',
  'Currency',
  'Period start',
  'Period end',
  'Payroll posting date',
  'Payment date',
] as const;
export const PLR_DATE_LABELS = [
  'Period start',
  'Period end',
  'Payroll posting date',
  'Payment date',
] as const;
export const PLR_COLUMNS = [
  'Line ID',
  'Employee ID',
  'Employee dimensions',
  'Payee account',
  'Component',
  'Kind',
  'Amount',
] as const;
export const PLR_KINDS = ['earning', 'deduction', 'employer', 'net'] as const;
export const PLR_TOTALS = [
  'Total earnings',
  'Total deductions',
  'Total employer',
  'Total net',
] as const;
export const PLR_CURRENCIES: Readonly<Record<string, number>> = {
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
export const PLR_RUN_CODES = [
  'STRAY_ROW',
  'SECTION_HEADER',
  'SECTION_COLUMNS',
  'SECTION_UNCLOSED',
  'SECTION_DUPLICATE',
  'LINE_UNREADABLE',
  'RUN_TOTALS',
  'RUN_TOTAL_MISMATCH',
] as const;
export const PLR_EMPLOYEE_CODES = [
  'IDENTITY',
  'KIND',
  'AMOUNT',
  'LINE_WIDTH',
  'DUPLICATE_LINE',
  'PAYEE_CONFLICT',
  'NET_REPEATED',
  'TOTAL_FIELD',
  'TOTAL_MISMATCH',
] as const;

export type PlrKind = (typeof PLR_KINDS)[number];
export type PlrLabel = (typeof PLR_LABELS)[number];
export type PlrFile = { name: string; sha256: string; bytes: Uint8Array };
export type PlrReading = {
  role: typeof PLR_ROLE;
  family: typeof PLR_VERSION;
  confirmed: boolean;
};
export type PlrInput = {
  files: [PlrFile];
  readings: [PlrReading];
  scope: { confirmed: boolean; fields: Record<PlrLabel, string> };
};
export type PlrSums = {
  earnings: string;
  deductions: string;
  employer: string;
  net: string;
};
export type PlrLine = {
  id: string;
  component: string;
  kind: PlrKind;
  amount: string;
  row: number;
};
export type PlrEmployee = {
  key: string;
  employee: string;
  dims: string;
  status: 'held' | 'missing' | 'inconsistent' | 'consistent';
  codes: string[];
  earnings: string | null;
  deductions: string | null;
  employer: string | null;
  net: string | null;
  payee: string | null;
  lines: PlrLine[] | null;
  rows: number[];
};
export type PlrSection = {
  row: number;
  id: string;
  state: 'read' | 'excluded' | 'unread';
  codes: string[];
  printed: PlrSums | null;
  sums: PlrSums | null;
};
export type PlrResult = {
  version: typeof PLR_VERSION;
  context: string;
  file: { name: string; sha256: string };
  scope: Record<PlrLabel, string>;
  decimals: number | null;
  refused: 'SCOPE' | 'ENCODING' | 'CSV' | null;
  employees: PlrEmployee[];
  excludedSections: string[];
  sharedPayees: { payee: string; employees: string[] }[];
  unplaced: { row: number; code: string }[];
  totals: PlrSums | null;
  printedRunTotals: PlrSums | null;
  sections: PlrSection[];
  run: string[];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never {
  throw new Error(`PLR_${code}`);
}
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MAX_MINOR = 10n ** 14n;
const SUM_NAMES = ['earnings', 'deductions', 'employer', 'net'] as const;

// Reading rules. Only ordinary spaces are removed at either end.
export const plrStrip = (v: string) => v.replace(/^ +| +$/g, '');
const ERRORS = [
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#DIV/0!',
  '#NAME?',
  '#NULL!',
  '#NUM!',
];
export function plrText(v: string): string | null {
  const s = plrStrip(v);
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
export function plrDate(v: string): string | null {
  const s = plrStrip(v),
    m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]
    ? s
    : null;
}
/** Minor units, or null when the amount rules refuse the cell. */
export function plrAmount(v: string, decimals: number): bigint | null {
  const s = plrStrip(v)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.');
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(s);
  if (!m || (m[2] ?? '').length > decimals) return null;
  const n =
    BigInt(m[1]) * 10n ** BigInt(decimals) +
    BigInt((m[2] ?? '').padEnd(decimals, '0') || '0');
  return n <= MAX_MINOR ? n : null;
}
const width = (row: readonly string[]) => {
  let n = row.length;
  while (n && !plrStrip(row[n - 1])) n--;
  return n;
};
const cell = (row: readonly string[], j: number) => row[j] ?? '';

/**
 * RFC 4180 records as the contract reads them: a byte-order mark is dropped,
 * LF, CRLF and CR end a record, and a quote inside an unquoted field, text
 * after a closing quote or an unclosed quote refuses the file. A blank line is
 * a record of one empty field.
 */
export function plrRecords(bytes: Uint8Array): string[][] | 'ENCODING' | 'CSV' {
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

type Block = {
  kind: 'Section' | 'Run totals';
  row: number;
  opening: string[];
  rows: { row: number; cells: string[] }[];
  closed: boolean;
};
// A block runs from its start row to the first later row that starts or ends
// a block; an end row belongs to the block it ends. Blank rows go nowhere.
function blocks(rows: string[][]) {
  const out: Block[] = [],
    strays: number[] = [];
  let b: Block | null = null;
  for (const [i, r] of rows.entries()) {
    if (!width(r)) continue;
    const mark = plrStrip(r[0]);
    if (mark === 'Section' || mark === 'Run totals') {
      b = { kind: mark, row: i + 1, opening: r, rows: [], closed: false };
      out.push(b);
    } else if (!b) strays.push(i + 1);
    else if (mark === 'End section' || mark === 'End run totals') {
      b.closed =
        mark === (b.kind === 'Section' ? 'End section' : 'End run totals') &&
        width(r) === 2 &&
        width(b.opening) === 2 &&
        plrStrip(r[1]) === plrStrip(b.opening[1]);
      b = null;
    } else b.rows.push({ row: i + 1, cells: r });
  }
  return { blocks: out, strays };
}

type Line = {
  row: number;
  id: string | null;
  employee: string | null;
  dims: string | null;
  payee: string | null;
  component: string | null;
  kind: PlrKind | null;
  amount: bigint | null;
  wide: boolean;
};
type Section = {
  row: number;
  id: string | null;
  raw: string;
  whole: boolean;
  closed: boolean;
  excluded: boolean;
  columns: boolean;
  read: boolean;
  lines: Line[];
  totals: 'TOTAL_FIELD' | 'TOTAL_MISMATCH' | null;
  printed: Map<string, bigint> | null;
};

/** The four totals by label, or null unless each total label is there once,
 * with two meaningful cells and a readable amount. */
function foot(rows: string[][], decimals: number) {
  const labels = rows.map((r) => plrStrip(r[0]));
  if (
    labels.length !== PLR_TOTALS.length ||
    !PLR_TOTALS.every((l) => labels.filter((x) => x === l).length === 1) ||
    rows.some((r) => width(r) !== 2)
  )
    return null;
  const printed = new Map<string, bigint>();
  for (const r of rows) {
    const v = plrAmount(r[1], decimals);
    if (v === null) return null;
    printed.set(plrStrip(r[0]), v);
  }
  return printed;
}

function section(
  b: Block,
  scope: Record<PlrLabel, string>,
  decimals: number,
): Section {
  const labels: string[][] = [],
    body: { row: number; cells: string[] }[] = [];
  let columns: string[] | null = null;
  for (const r of b.rows) {
    if (!columns && width(r.cells) > 2) columns = r.cells;
    else if (!columns) labels.push(r.cells);
    else body.push(r);
  }
  const counts = new Map<string, number>();
  for (const r of labels)
    counts.set(plrStrip(r[0]), (counts.get(plrStrip(r[0])) ?? 0) + 1);
  const values = new Map<string, string | null>(
    PLR_LABELS.map((l) => [l, null]),
  );
  for (const r of labels) {
    const name = plrStrip(r[0]);
    if (values.has(name) && counts.get(name) === 1)
      values.set(
        name,
        (PLR_DATE_LABELS as readonly string[]).includes(name)
          ? plrDate(cell(r, 1))
          : plrText(cell(r, 1)),
      );
  }
  const whole =
    width(b.opening) === 2 &&
    plrText(cell(b.opening, 1)) !== null &&
    [...counts.keys()].every((k) =>
      (PLR_LABELS as readonly string[]).includes(k),
    ) &&
    [...values.values()].every((v) => v !== null);
  const s: Section = {
    row: b.row,
    id: plrText(cell(b.opening, 1)),
    raw: cell(b.opening, 1),
    whole,
    closed: b.closed,
    excluded: false,
    columns: true,
    read: false,
    lines: [],
    totals: null,
    printed: null,
  };
  if (!whole) return s;
  const other = PLR_LABELS.some((l) => values.get(l) !== scope[l]);
  if (other && b.closed) {
    s.excluded = true;
    return s;
  }
  let map: Map<string, number> | null = null;
  if (columns && width(columns) === PLR_COLUMNS.length) {
    map = new Map(
      columns.slice(0, PLR_COLUMNS.length).map((c, j) => [plrStrip(c), j]),
    );
    if (
      map.size !== PLR_COLUMNS.length ||
      !PLR_COLUMNS.every((c) => map!.has(c))
    )
      map = null;
  }
  if (!map) {
    s.columns = false;
    return s;
  }
  if (other) return s;
  s.read = true;
  const totals: string[][] = [];
  let after = false;
  for (const r of body) {
    if (
      (PLR_TOTALS as readonly string[]).includes(plrStrip(r.cells[0] ?? ''))
    ) {
      totals.push(r.cells);
      continue;
    }
    after ||= totals.length > 0;
    const get = (c: string) => cell(r.cells, map!.get(c)!);
    const kind = plrStrip(get('Kind'));
    s.lines.push({
      row: r.row,
      id: plrText(get('Line ID')),
      employee: plrText(get('Employee ID')),
      dims: plrText(get('Employee dimensions')),
      payee: plrText(get('Payee account')),
      component: plrText(get('Component')),
      kind: (PLR_KINDS as readonly string[]).includes(kind)
        ? (kind as PlrKind)
        : null,
      amount: plrAmount(get('Amount'), decimals),
      wide: width(r.cells) > PLR_COLUMNS.length,
    });
  }
  s.printed = after ? null : foot(totals, decimals);
  if (!s.printed || s.lines.some((x) => x.kind === null || x.amount === null))
    s.totals = 'TOTAL_FIELD';
  else if (
    PLR_KINDS.some(
      (k, i) =>
        s.printed!.get(PLR_TOTALS[i]) !==
        s.lines.reduce((a, x) => (x.kind === k ? a + x.amount! : a), 0n),
    )
  )
    s.totals = 'TOTAL_MISMATCH';
  return s;
}

const sumsOf = (lines: Line[]): PlrSums | null =>
  lines.every((x) => x.kind !== null && x.amount !== null)
    ? (Object.fromEntries(
        PLR_KINDS.map((k, i) => [
          SUM_NAMES[i],
          String(
            lines.reduce((a, x) => (x.kind === k ? a + x.amount! : a), 0n),
          ),
        ]),
      ) as PlrSums)
    : null;
const printedSums = (m: Map<string, bigint> | null): PlrSums | null =>
  m
    ? (Object.fromEntries(
        PLR_TOTALS.map((l, i) => [SUM_NAMES[i], String(m.get(l))]),
      ) as PlrSums)
    : null;

function validate(input: PlrInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort(byText).join('|') !== 'files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 1 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 1
  )
    fail('INPUT');
  const r = input.readings[0];
  if (
    !plain(r) ||
    Object.keys(r).sort(byText).join('|') !== 'confirmed|family|role' ||
    r.role !== PLR_ROLE ||
    r.family !== PLR_VERSION ||
    r.confirmed !== true
  )
    fail('READING');
  const f = input.files[0];
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
  if (keys.join('|') !== [...PLR_LABELS].sort(byText).join('|')) return false;
  if (
    !PLR_LABELS.every(
      (k) => typeof fields[k] === 'string' && plrText(fields[k]) === fields[k],
    )
  )
    return false;
  const f = fields as Record<PlrLabel, string>;
  return (
    Object.hasOwn(PLR_CURRENCIES, f.Currency) &&
    PLR_DATE_LABELS.every((k) => plrDate(f[k]) !== null) &&
    f['Period start'] <= f['Period end'] &&
    f['Payroll posting date'] <= f['Payment date']
  );
}

export function reconcileLongRegister(input: PlrInput): PlrResult {
  validate(input);
  const file = input.files[0];
  const fields = { ...input.scope.fields } as Record<PlrLabel, string>;
  const result: PlrResult = {
    version: PLR_VERSION,
    context: JSON.stringify([PLR_VERSION, file.sha256, fields]),
    file: { name: file.name, sha256: file.sha256 },
    scope: fields,
    decimals: null,
    refused: null,
    employees: [],
    excludedSections: [],
    sharedPayees: [],
    unplaced: [],
    totals: null,
    printedRunTotals: null,
    sections: [],
    run: [],
  };
  if (!scopeOk(fields)) {
    result.refused = 'SCOPE';
    return result;
  }
  const decimals = PLR_CURRENCIES[fields.Currency];
  result.decimals = decimals;
  const records = plrRecords(file.bytes);
  if (typeof records === 'string') {
    result.refused = records;
    return result;
  }
  // Beyond the contract: the same row and cell bounds as the other families.
  if (
    records.length > MAX_ROWS ||
    records.some((r) => r.length > 100 || r.some((v) => v.length > 32767))
  )
    fail('SOURCE_CAPACITY');

  const found = blocks(records);
  const sections = found.blocks
    .filter((b) => b.kind === 'Section')
    .map((b) => section(b, fields, decimals));
  const footers = found.blocks.filter((b) => b.kind === 'Run totals');
  const read = sections.filter((s) => s.read);
  const lines = read.flatMap((s) => s.lines);

  const run = new Set<string>(),
    unplaced: { row: number; code: string }[] = [];
  for (const row of found.strays) {
    run.add('STRAY_ROW');
    unplaced.push({ row, code: 'STRAY_ROW' });
  }
  for (const s of sections) {
    if (!s.whole) {
      run.add('SECTION_HEADER');
      unplaced.push({ row: s.row, code: 'SECTION_HEADER' });
    } else if (!s.columns) {
      run.add('SECTION_COLUMNS');
      unplaced.push({ row: s.row, code: 'SECTION_COLUMNS' });
    }
    if (!s.closed) run.add('SECTION_UNCLOSED');
  }
  const ids = new Map<string, number>();
  for (const s of sections)
    if (!s.excluded && s.id !== null) ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
  if ([...ids.values()].some((c) => c > 1)) run.add('SECTION_DUPLICATE');
  for (const x of lines)
    if (x.employee === null || x.dims === null) {
      run.add('LINE_UNREADABLE');
      unplaced.push({ row: x.row, code: 'LINE_UNREADABLE' });
    }

  result.totals = sumsOf(lines);
  let printed: Map<string, bigint> | null = null;
  if (footers.length === 1) {
    const b = footers[0];
    // A closed block's opening row has two cells: the closure checks it.
    if (b.closed && plrText(cell(b.opening, 1)) === fields['Payroll run'])
      printed = foot(
        b.rows.map((r) => r.cells),
        decimals,
      );
  }
  result.printedRunTotals = printedSums(printed);
  if (!printed || !result.totals) run.add('RUN_TOTALS');
  else if (
    PLR_TOTALS.some(
      (l, i) => String(printed!.get(l)) !== result.totals![SUM_NAMES[i]],
    )
  )
    run.add('RUN_TOTAL_MISMATCH');

  const held = new Map<string, Set<string>>(),
    mine = new Map<string, Line[]>();
  const hold = (key: string, code: string) => {
    if (!held.has(key)) held.set(key, new Set());
    held.get(key)!.add(code);
  };
  const lineIds = new Map<string, number>();
  for (const x of lines)
    if (x.id !== null) lineIds.set(x.id, (lineIds.get(x.id) ?? 0) + 1);
  for (const s of read)
    for (const x of s.lines) {
      if (x.employee === null || x.dims === null) continue;
      const key = `${x.employee}|${x.dims}`;
      if (!mine.has(key)) mine.set(key, []);
      mine.get(key)!.push(x);
      if (x.id === null || x.payee === null || x.component === null)
        hold(key, 'IDENTITY');
      if (x.kind === null) hold(key, 'KIND');
      if (x.amount === null) hold(key, 'AMOUNT');
      if (x.wide) hold(key, 'LINE_WIDTH');
      if (x.id !== null && lineIds.get(x.id)! > 1) hold(key, 'DUPLICATE_LINE');
      if (s.totals) hold(key, s.totals);
    }
  const blocking = new Set<string>([...PLR_RUN_CODES, ...PLR_EMPLOYEE_CODES]);
  for (const key of [...mine.keys()].sort(byText)) {
    const own = mine.get(key)!,
      first = own[0];
    if (
      new Set(own.filter((x) => x.payee !== null).map((x) => x.payee)).size > 1
    )
      hold(key, 'PAYEE_CONFLICT');
    const nets = own.filter((x) => x.kind === 'net');
    if (nets.length > 1) hold(key, 'NET_REPEATED');
    for (const code of run) hold(key, code);
    const codes = [...(held.get(key) ?? [])]
      .filter((c) => blocking.has(c))
      .sort(byText);
    const base = {
      key,
      employee: first.employee!,
      dims: first.dims!,
      rows: own.map((x) => x.row),
    };
    if (codes.length) {
      result.employees.push({
        ...base,
        status: 'held',
        codes,
        earnings: null,
        deductions: null,
        employer: null,
        net: null,
        payee: null,
        lines: null,
      });
      continue;
    }
    const sum = (k: PlrKind) =>
      own.reduce((a, x) => (x.kind === k ? a + x.amount! : a), 0n);
    const earnings = sum('earning'),
      deductions = sum('deduction'),
      net = nets.length ? nets[0].amount! : null;
    const status =
      net === null
        ? 'missing'
        : earnings - deductions !== net
          ? 'inconsistent'
          : 'consistent';
    result.employees.push({
      ...base,
      status,
      codes:
        status === 'missing'
          ? ['NET_ABSENT']
          : status === 'inconsistent'
            ? ['NET_EQUATION']
            : [],
      earnings: String(earnings),
      deductions: String(deductions),
      employer: String(sum('employer')),
      net: net === null ? null : String(net),
      payee: first.payee,
      lines: own
        .map((x) => ({
          id: x.id!,
          component: x.component!,
          kind: x.kind!,
          amount: String(x.amount),
          row: x.row,
        }))
        .sort((a, b) => byText(a.id, b.id)),
    });
  }

  const payees = new Map<string, Set<string>>();
  for (const x of lines)
    if (x.employee !== null && x.payee !== null) {
      if (!payees.has(x.payee)) payees.set(x.payee, new Set());
      payees.get(x.payee)!.add(x.employee);
    }
  result.sharedPayees = [...payees.entries()]
    .filter(([, e]) => e.size > 1)
    .map(([payee, e]) => ({ payee, employees: [...e].sort(byText) }))
    .sort((a, b) => byText(a.payee, b.payee));
  result.excludedSections = sections
    .filter((s) => s.excluded)
    .map((s) => s.id!)
    .sort(byText);
  result.unplaced = unplaced.sort(
    (a, b) => a.row - b.row || byText(a.code, b.code),
  );
  result.run = [...run].sort(byText);
  result.sections = sections.map((s) => ({
    row: s.row,
    id: s.raw,
    state: s.read ? 'read' : s.excluded ? 'excluded' : 'unread',
    codes: [
      ...(!s.whole
        ? ['SECTION_HEADER']
        : !s.columns
          ? ['SECTION_COLUMNS']
          : []),
      ...(s.closed ? [] : ['SECTION_UNCLOSED']),
      ...(s.excluded ? ['SECTION_SCOPE'] : []),
      ...(s.totals ? [s.totals] : []),
    ],
    printed: printedSums(s.printed),
    sums: s.read ? sumsOf(s.lines) : null,
  }));
  return result;
}
