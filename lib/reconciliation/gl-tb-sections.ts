import { assertSourceFile } from './protocol.ts';
import { MAX_FILE_BYTES, MAX_ROWS, type SourceFile } from './types.ts';

// Proposed family (audit/gl-tb-sections-foundation/contract.json): a GL
// detail report in sections and a trial balance in pages, many accounts in
// one run, each account decided on its own. gl-tb-canonical-1 and the vertical
// TB family are unchanged beside it.
export const GLS_VERSION = 'gl-tb-sections-1';
export const GLS_ROLES = ['gl-sections', 'tb-pages'] as const;
export const GLS_CLAIM =
  'Consistency of supplied GL detail sections with supplied trial balance account rows, account by account and component by component, within one confirmed scope; no posting, no reclassification, no completeness opinion on the ledger or the trial balance';
export const GLS_SECTION_LABELS = [
  'Entity',
  'Ledger',
  'Account',
  'Complete dimensions',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
] as const;
export const GLS_PAGE_LABELS = [
  'Entity',
  'Ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
] as const;
export const GLS_GL_COLUMNS = [
  'Record ID',
  'Record kind',
  'Posting date',
  'Debit',
  'Credit',
] as const;
export const GLS_TB_AMOUNTS = [
  'Opening debit',
  'Opening credit',
  'Period debit',
  'Period credit',
  'Closing debit',
  'Closing credit',
] as const;
export const GLS_TB_COLUMNS = [
  'Account',
  'Complete dimensions',
  'Row type',
  'Parent account',
  ...GLS_TB_AMOUNTS,
] as const;
export const GLS_SCOPE_FIELDS = [
  'entity',
  'ledger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'start',
  'end',
] as const;
export const GLS_COMPONENTS = [
  'openingDebit',
  'openingCredit',
  'periodDebit',
  'periodCredit',
  'closingDebit',
  'closingCredit',
] as const;
export const GLS_CURRENCIES: Readonly<Record<string, number>> = {
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
export const GLS_BLOCKING = [
  'STRAY_ROW',
  'SECTION_UNREADABLE',
  'PAGE_UNREADABLE',
  'ROW_UNREADABLE',
  'SECTION_HEADER',
  'SECTION_COLUMNS',
  'SECTION_UNCLOSED',
  'SECTION_DUPLICATE',
  'IDENTITY',
  'KIND',
  'DATE',
  'POSTING_PERIOD',
  'AMOUNT',
  'DUPLICATE_RECORD',
  'ROLE_REPEATED',
  'ROW_FIELD',
  'TB_CONFLICT',
  'TOTAL_FIELD',
  'TOTAL_MISMATCH',
] as const;
export const GLS_MISSING = [
  'GL_SECTION_ABSENT',
  'TB_ROW_ABSENT',
  'GL_OPENING_ABSENT',
  'GL_CLOSING_ABSENT',
] as const;
const MAX_MINOR = 10 ** 14;

type Role = (typeof GLS_ROLES)[number];
export type GlsScope = Record<(typeof GLS_SCOPE_FIELDS)[number], string> & {
  confirmed: boolean;
};
export type GlsReading = {
  sheet: number;
  role: Role;
  family: typeof GLS_VERSION;
  confirmed: boolean;
};
export type GlsInput = {
  files: [SourceFile, SourceFile];
  readings: [GlsReading, GlsReading];
  scope: GlsScope;
};
export type GlsFile = 'gl' | 'tb';
export type GlsAccount = {
  key: string;
  account: string;
  dimensions: string;
  status: 'held' | 'missing' | 'inconsistent' | 'difference' | 'consistent';
  codes: string[];
  // Minor units in GLS_COMPONENTS order, where that side is present and sound.
  gl: number[] | null;
  tb: number[] | null;
  sections: { id: string | null; row: number }[];
  rows: { page: string | null; row: number }[];
};
export type GlsResult = {
  version: typeof GLS_VERSION;
  claim: typeof GLS_CLAIM;
  context: string;
  scope: GlsScope;
  decimals: number;
  sources: { name: string; hash: string; role: Role }[];
  accounts: GlsAccount[];
  excludedSections: { id: string | null; row: number }[];
  excludedPages: { id: string | null; row: number }[];
  orphanTotals: { key: string; row: number }[];
  unplaced: { file: GlsFile; row: number; code: string }[];
  run: string[];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never {
  throw new Error(`GLS_${code}`);
}
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Reading rules. Only ordinary spaces are removed at either end.
export const glsStrip = (v: string) => v.replace(/^ +| +$/g, '');
const ERRORS = [
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#DIV/0!',
  '#NAME?',
  '#NULL!',
  '#NUM!',
];
export function glsText(v: string): string | null {
  const s = glsStrip(v);
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
export function glsDate(v: string): string | null {
  const s = glsStrip(v),
    m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]
    ? s
    : null;
}
export function glsAmount(v: string, decimals: number): number | null {
  const s = glsStrip(v)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.');
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(s);
  if (!m || (m[2] ?? '').length > decimals) return null;
  const whole = m[1].replace(/^0+(?=[0-9])/, '');
  if (whole.length > 15) return null;
  const n =
    Number(whole) * 10 ** decimals +
    Number((m[2] ?? '').padEnd(decimals, '0') || 0);
  return n <= MAX_MINOR ? n : null;
}
const width = (row: readonly string[]) => {
  let n = row.length;
  while (n && !glsStrip(row[n - 1])) n--;
  return n;
};
const cell = (row: readonly string[], j: number) => row[j] ?? '';

function validate(input: GlsInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2
  )
    fail('INPUT');
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      Object.keys(r).sort().join('|') !== 'confirmed|family|role|sheet' ||
      r.sheet !== 0 ||
      r.family !== GLS_VERSION ||
      r.confirmed !== true ||
      r.role !== GLS_ROLES[i]
    )
      fail('READING');
  });
  const scope = input.scope;
  if (
    !plain(scope) ||
    Object.keys(scope).sort().join('|') !==
      [...GLS_SCOPE_FIELDS, 'confirmed'].sort().join('|') ||
    scope.confirmed !== true ||
    !GLS_SCOPE_FIELDS.every(
      (k) => typeof scope[k] === 'string' && glsText(scope[k]) === scope[k],
    ) ||
    !Object.hasOwn(GLS_CURRENCIES, scope.currency) ||
    scope.currencyBasis !== 'functional' ||
    scope.postingStatus !== 'posted' ||
    glsDate(scope.start) === null ||
    glsDate(scope.end) === null ||
    scope.start > scope.end
  )
    fail('SCOPE');
  for (const file of input.files) {
    assertSourceFile(file);
    if (
      typeof file.name !== 'string' ||
      file.name.length > 255 ||
      !/\.csv$/i.test(file.name) ||
      file.kind !== undefined ||
      file.sheets.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
      !(file.original instanceof ArrayBuffer) ||
      !file.original.byteLength ||
      file.original.byteLength > MAX_FILE_BYTES ||
      file.sheets[0].rows.length > MAX_ROWS + 30
    )
      fail('SOURCE');
  }
  if (input.files[0].sha256 === input.files[1].sha256)
    fail('INDEPENDENT_SOURCES');
  return GLS_CURRENCIES[scope.currency];
}

type Block = {
  row: number;
  opening: string[];
  labels: string[][];
  columns: string[] | null;
  body: { row: number; cells: string[] }[];
  closed: boolean;
};
// A block runs from its start row to the first later row that is an end row
// or another start row. The first row with more than two meaningful cells is
// the column row; rows before it are labels, rows after it are its rows.
function blocks(rows: string[][], start: string, end: string) {
  const out: Block[] = [],
    strays: number[] = [];
  let b: Block | null = null;
  for (const [i, r] of rows.entries()) {
    if (!width(r)) continue;
    const first = glsStrip(r[0]);
    if (first === start) {
      b = {
        row: i + 1,
        opening: r,
        labels: [],
        columns: null,
        body: [],
        closed: false,
      };
      out.push(b);
    } else if (!b) strays.push(i + 1);
    else if (first === end) {
      b.closed =
        width(r) === 2 &&
        width(b.opening) === 2 &&
        glsStrip(r[1]) === glsStrip(b.opening[1]);
      b = null;
    } else if (!b.columns && width(r) > 2) b.columns = r;
    else if (!b.columns) b.labels.push(r);
    else b.body.push({ row: i + 1, cells: r });
  }
  return { blocks: out, strays };
}

// Label values by name, null when absent, repeated or refused; and whether
// the whole head (start row and labels) reads.
function head(b: Block, names: readonly string[]) {
  const counts = new Map<string, number>();
  for (const r of b.labels)
    counts.set(glsStrip(r[0]), (counts.get(glsStrip(r[0])) ?? 0) + 1);
  const values = new Map<string, string | null>(names.map((n) => [n, null]));
  for (const r of b.labels) {
    const name = glsStrip(r[0]);
    if (values.has(name) && counts.get(name) === 1)
      values.set(
        name,
        name.startsWith('Period ') ? glsDate(cell(r, 1)) : glsText(cell(r, 1)),
      );
  }
  const whole =
    width(b.opening) === 2 &&
    glsText(cell(b.opening, 1)) !== null &&
    [...counts.keys()].every((n) => names.includes(n)) &&
    [...values.values()].every((v) => v !== null);
  return { values, whole };
}
function columnsOf(row: string[] | null, names: readonly string[]) {
  if (!row || width(row) !== names.length) return null;
  const map = new Map(
    row.slice(0, names.length).map((c, j) => [glsStrip(c), j]),
  );
  return map.size === names.length && names.every((n) => map.has(n))
    ? map
    : null;
}
const inScope = (values: Map<string, string | null>, scope: GlsScope) =>
  GLS_SCOPE_FIELDS.every((k, i) => values.get(GLS_PAGE_LABELS[i]) === scope[k]);

type Section = {
  row: number;
  id: string | null;
  account: string | null;
  dims: string | null;
  codes: Set<string>;
  excluded: boolean;
  missing: string[];
  six: number[] | null;
};
function section(b: Block, scope: GlsScope, decimals: number): Section {
  const { values, whole } = head(b, GLS_SECTION_LABELS);
  const s: Section = {
    row: b.row,
    id: glsText(cell(b.opening, 1)),
    account: values.get('Account') ?? null,
    dims: values.get('Complete dimensions') ?? null,
    codes: new Set(),
    excluded: false,
    missing: [],
    six: null,
  };
  if (!whole) s.codes.add('SECTION_HEADER');
  if (!b.closed) s.codes.add('SECTION_UNCLOSED');
  if (s.codes.size) return s;
  if (!inScope(values, scope)) {
    s.excluded = true;
    return s;
  }
  const cols = columnsOf(b.columns, GLS_GL_COLUMNS);
  if (!cols || b.body.some((r) => width(r.cells) > GLS_GL_COLUMNS.length)) {
    s.codes.add('SECTION_COLUMNS');
    return s;
  }
  const ids = new Map<string, number>();
  const roles: Record<string, [number | null, number | null][]> = {
    opening: [],
    movement: [],
    closing: [],
  };
  for (const r of b.body) {
    const get = (c: string) => cell(r.cells, cols.get(c)!);
    const id = glsText(get('Record ID'));
    if (id === null) s.codes.add('IDENTITY');
    else ids.set(id, (ids.get(id) ?? 0) + 1);
    const kind = glsStrip(get('Record kind'));
    const known = Object.hasOwn(roles, kind);
    if (!known) s.codes.add('KIND');
    const date = glsDate(get('Posting date'));
    if (
      date === null ||
      (kind === 'opening' && date !== scope.start) ||
      (kind === 'closing' && date !== scope.end)
    )
      s.codes.add('DATE');
    else if (kind === 'movement' && (date < scope.start || date > scope.end))
      s.codes.add('POSTING_PERIOD');
    const debit = glsAmount(get('Debit'), decimals),
      credit = glsAmount(get('Credit'), decimals);
    if (debit === null || credit === null) s.codes.add('AMOUNT');
    if (known) roles[kind].push([debit, credit]);
  }
  if ([...ids.values()].some((n) => n > 1)) s.codes.add('DUPLICATE_RECORD');
  if (roles.opening.length > 1 || roles.closing.length > 1)
    s.codes.add('ROLE_REPEATED');
  if (s.codes.size) return s;
  if (!roles.opening.length) s.missing.push('GL_OPENING_ABSENT');
  if (!roles.closing.length) s.missing.push('GL_CLOSING_ABSENT');
  if (s.missing.length) return s;
  // Every amount read above, or AMOUNT would have held the section.
  const sum = (side: 0 | 1) => roles.movement.reduce((t, r) => t + r[side]!, 0);
  const [o, c] = [roles.opening[0], roles.closing[0]];
  s.six = [o[0]!, o[1]!, sum(0), sum(1), c[0]!, c[1]!];
  return s;
}

type TbRow = {
  row: number;
  page: string | null;
  account: string | null;
  dims: string | null;
  kind: 'account' | 'total' | null;
  parent: string | null;
  fieldOk: boolean;
  six: (number | null)[];
};
type Page = {
  row: number;
  id: string | null;
  unreadable: boolean;
  excluded: boolean;
  rows: TbRow[];
};
function page(b: Block, scope: GlsScope, decimals: number): Page {
  const { values, whole } = head(b, GLS_PAGE_LABELS);
  const cols = columnsOf(b.columns, GLS_TB_COLUMNS);
  const p: Page = {
    row: b.row,
    id: glsText(cell(b.opening, 1)),
    unreadable: !whole || !cols || !b.closed,
    excluded: false,
    rows: [],
  };
  if (p.unreadable || !cols) return p;
  if (!inScope(values, scope)) {
    p.excluded = true;
    return p;
  }
  for (const r of b.body) {
    const get = (c: string) => cell(r.cells, cols.get(c)!);
    const kind = glsStrip(get('Row type'));
    const written = glsStrip(get('Parent account'));
    const parent = written ? glsText(written) : '';
    p.rows.push({
      row: r.row,
      page: p.id,
      account: glsText(get('Account')),
      dims: glsText(get('Complete dimensions')),
      kind: kind === 'account' || kind === 'total' ? kind : null,
      parent,
      fieldOk: parent !== null && width(r.cells) <= GLS_TB_COLUMNS.length,
      six: GLS_TB_AMOUNTS.map((c) => glsAmount(get(c), decimals)),
    });
  }
  return p;
}

const bridge = (s: readonly number[]) =>
  s[4] - s[5] - s[0] + s[1] - s[2] + s[3];
const keyOf = (account: string, dims: string) =>
  JSON.stringify([account, dims]);

export function reconcileGlTbSections(input: GlsInput): GlsResult {
  const decimals = validate(input);
  const scope = input.scope;
  const gl = blocks(input.files[0].sheets[0].rows, 'Section', 'End section');
  const tb = blocks(input.files[1].sheets[0].rows, 'Page', 'End page');
  const sections = gl.blocks.map((b) => section(b, scope, decimals));
  const pages = tb.blocks.map((b) => page(b, scope, decimals));

  const run = new Set<string>(),
    unplaced: GlsResult['unplaced'] = [],
    held = new Map<string, Set<string>>(),
    byCode = new Set<string>();
  const hold = (key: string, code: string) =>
    held.set(key, (held.get(key) ?? new Set()).add(code));
  for (const [file, strays] of [
    ['gl', gl.strays],
    ['tb', tb.strays],
  ] as const)
    for (const row of strays) {
      run.add('STRAY_ROW');
      unplaced.push({ file, row, code: 'STRAY_ROW' });
    }

  const live = sections.filter((s) => !s.excluded);
  const glKeys = new Map<string, Section[]>(),
    names = new Map<string, [string, string]>();
  for (const s of live) {
    if (s.account === null) {
      run.add('SECTION_UNREADABLE');
      unplaced.push({ file: 'gl', row: s.row, code: 'SECTION_UNREADABLE' });
    } else if (s.dims === null) {
      byCode.add(s.account);
      unplaced.push({ file: 'gl', row: s.row, code: 'SECTION_HEADER' });
    } else {
      const key = keyOf(s.account, s.dims);
      names.set(key, [s.account, s.dims]);
      glKeys.set(key, [...(glKeys.get(key) ?? []), s]);
      for (const code of s.codes) hold(key, code);
    }
  }
  const ids = new Map<string, number>();
  for (const s of live)
    if (s.id !== null) ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
  for (const [key, found] of glKeys)
    if (
      found.length > 1 ||
      found.some((s) => s.id !== null && ids.get(s.id)! > 1)
    )
      hold(key, 'SECTION_DUPLICATE');

  const rows: TbRow[] = [];
  for (const p of pages)
    if (p.unreadable) {
      run.add('PAGE_UNREADABLE');
      unplaced.push({ file: 'tb', row: p.row, code: 'PAGE_UNREADABLE' });
    } else if (!p.excluded) rows.push(...p.rows);
  for (const r of rows)
    if (r.account === null || r.dims === null || r.kind === null) {
      run.add('ROW_UNREADABLE');
      unplaced.push({ file: 'tb', row: r.row, code: 'ROW_UNREADABLE' });
    }
  const readable = rows.filter(
    (r) => r.account !== null && r.dims !== null && r.kind !== null,
  );
  const accountRows = readable.filter((r) => r.kind === 'account');
  const tbKeys = new Map<string, TbRow[]>();
  for (const r of accountRows) {
    const key = keyOf(r.account!, r.dims!);
    names.set(key, [r.account!, r.dims!]);
    tbKeys.set(key, [...(tbKeys.get(key) ?? []), r]);
    if (!r.fieldOk) hold(key, 'ROW_FIELD');
    if (r.six.includes(null)) hold(key, 'AMOUNT');
  }
  for (const [key, found] of tbKeys)
    if (found.length > 1) hold(key, 'TB_CONFLICT');
  const orphanTotals: GlsResult['orphanTotals'] = [];
  for (const t of readable.filter((r) => r.kind === 'total')) {
    const children = accountRows.filter(
      (r) => r.parent === t.account && r.dims === t.dims,
    );
    if (!children.length) {
      orphanTotals.push({ key: `${t.account}|${t.dims}`, row: t.row });
      continue;
    }
    let code: string | null = null;
    if (
      !t.fieldOk ||
      t.six.includes(null) ||
      children.some((r) => r.six.includes(null))
    )
      code = 'TOTAL_FIELD';
    else if (
      t.six.some(
        (v, i) => v !== children.reduce((sum, r) => sum + r.six[i]!, 0),
      )
    )
      code = 'TOTAL_MISMATCH';
    if (code) for (const r of children) hold(keyOf(r.account!, r.dims!), code);
  }

  const accounts: GlsAccount[] = [];
  for (const key of new Set([...glKeys.keys(), ...tbKeys.keys()])) {
    const [account, dims] = names.get(key)!;
    if (byCode.has(account)) hold(key, 'SECTION_HEADER');
    for (const code of run) hold(key, code);
    const found = glKeys.get(key) ?? [],
      tbRows = tbKeys.get(key) ?? [];
    const entry: GlsAccount = {
      key: `${account}|${dims}`,
      account,
      dimensions: dims,
      status: 'consistent',
      codes: [],
      gl: null,
      tb: null,
      sections: found.map((s) => ({ id: s.id, row: s.row })),
      rows: tbRows.map((r) => ({ page: r.page, row: r.row })),
    };
    const blocking = [...(held.get(key) ?? [])].sort(byText);
    if (blocking.length) {
      accounts.push({ ...entry, status: 'held', codes: blocking });
      continue;
    }
    const s = found[0],
      r = tbRows[0];
    const missing = [
      ...(s ? s.missing : ['GL_SECTION_ABSENT']),
      ...(r ? [] : ['TB_ROW_ABSENT']),
    ].sort(byText);
    const g = s?.six ?? null,
      t = r ? (r.six as number[]) : null;
    entry.gl = g;
    entry.tb = t;
    if (missing.length) {
      entry.status = 'missing';
      entry.codes = missing;
    } else if (bridge(g!) || bridge(t!)) {
      entry.status = 'inconsistent';
      entry.codes = [
        ...(bridge(g!) ? ['GL_BRIDGE'] : []),
        ...(bridge(t!) ? ['TB_BRIDGE'] : []),
      ];
    } else if (g!.some((v, i) => v !== t![i])) {
      entry.status = 'difference';
      entry.codes = GLS_COMPONENTS.filter((_, i) => g![i] !== t![i]).sort(
        byText,
      );
    }
    accounts.push(entry);
  }
  accounts.sort(
    (a, b) =>
      byText(a.account, b.account) || byText(a.dimensions, b.dimensions),
  );
  const listed = (items: { id: string | null; row: number }[]) =>
    items
      .map(({ id, row }) => ({ id, row }))
      .sort((a, b) => byText(a.id ?? '', b.id ?? '') || a.row - b.row);
  return {
    version: GLS_VERSION,
    claim: GLS_CLAIM,
    context: JSON.stringify([
      GLS_VERSION,
      input.files.map((f) => f.sha256),
      GLS_SCOPE_FIELDS.map((k) => scope[k]),
    ]),
    scope: { ...scope },
    decimals,
    sources: input.files.map((f, i) => ({
      name: f.name,
      hash: f.sha256!,
      role: GLS_ROLES[i],
    })),
    accounts,
    excludedSections: listed(sections.filter((s) => s.excluded)),
    excludedPages: listed(pages.filter((p) => p.excluded)),
    orphanTotals: orphanTotals.sort(
      (a, b) => byText(a.key, b.key) || a.row - b.row,
    ),
    unplaced: unplaced.sort((a, b) => byText(a.file, b.file) || a.row - b.row),
    run: [...run].sort(byText),
  };
}
