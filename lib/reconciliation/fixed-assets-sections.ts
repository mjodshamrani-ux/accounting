import type { SourceFile } from './types.ts';

// Proposed family fixed-assets-sections-1 (FA-1): a register of location and
// category sections, a category account map and GL balances, reviewed account
// by account. Review only, beside fixed-assets-posted-components-gl-1 and
// fixed-assets-long-components-gl-1, which are unchanged. Nothing here
// computes depreciation, derives a component or takes a decision.
export const FA_SECTIONS_VERSION = 'fixed-assets-sections-1' as const;
export const FA_SECTIONS_ROLES = [
  'register-sections',
  'category-map',
  'gl-balances',
] as const;
export const FA_SECTIONS_LABELS = [
  'Entity',
  'Asset ledger',
  'Currency',
  'As of',
  'Location',
  'Category',
] as const;
export const FA_SECTIONS_COLUMNS = [
  'Asset ID',
  'Asset dimensions',
  'Component',
  'Amount',
  'Valuation reference',
] as const;
export const FA_SECTIONS_MAP_HEADER = [
  'Category',
  'Component',
  'GL account',
  'GL dimensions',
  'Account class',
  'Valid from',
  'Valid to',
] as const;
export const FA_SECTIONS_GL_HEADER = [
  'GL account',
  'GL dimensions',
  'Account class',
  'Debit',
  'Credit',
  'Entity',
  'GL ledger',
  'Currency',
  'As of',
] as const;
export const FA_SECTIONS_COMPONENTS = [
  'cost',
  'depreciation',
  'impairment',
  'carrying',
] as const;
export const FA_SECTIONS_PLACED = [
  'cost',
  'depreciation',
  'impairment',
] as const;
export const FA_SECTIONS_CLASSES = {
  cost: 'fixed-asset-cost',
  depreciation: 'accumulated-depreciation',
  impairment: 'accumulated-impairment',
} as const;
export const FA_SECTIONS_PLACES: Record<string, number> = {
  SAR: 2,
  AED: 2,
  USD: 2,
  EUR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};
export const FA_SECTIONS_SCOPE_FIELDS = [
  'entity',
  'assetLedger',
  'glLedger',
  'currency',
  'asOf',
] as const;
export const FA_SECTIONS_RUN_CODES = [
  'STRAY_ROW',
  'SECTION_UNREADABLE',
  'MAP_UNREADABLE',
  'GL_UNREADABLE',
] as const;

type Component = (typeof FA_SECTIONS_COMPONENTS)[number];
type Placed = (typeof FA_SECTIONS_PLACED)[number];
export type AssetSectionsScope = Record<
  (typeof FA_SECTIONS_SCOPE_FIELDS)[number],
  string
> & { confirmed: boolean };
export type AssetSectionsReading = {
  sheet: number;
  role: string;
  family: string;
  confirmed: boolean;
};
export type AssetSectionsInput = {
  files: SourceFile[];
  readings: AssetSectionsReading[];
  scope: AssetSectionsScope;
};
export type AssetSectionsAsset = {
  section: string;
  sectionRow: number;
  assetId: string;
  dimensions: string;
  location: string;
  category: string;
  status: 'read' | 'held';
  codes: string[];
  amounts: Record<Component, number | null>;
  rows: Record<Component, number[]>;
  unread: number[];
  valuation: string | null;
};
export type AssetSectionsAccount = {
  account: string;
  dimensions: string;
  component: Placed | null;
  status: 'held' | 'missing' | 'difference' | 'consistent';
  codes: string[];
  register: number | null;
  gl: number | null;
  difference: number | null;
  glRow: number | null;
  members: [string, string, string, Placed][];
};
export type AssetSectionsResult = {
  version: typeof FA_SECTIONS_VERSION;
  refused: null;
  decimals: number;
  hashes: string[];
  run: string[];
  sections: [
    number,
    number | null,
    string | null,
    string | null,
    string | null,
    'read' | 'held' | 'excluded',
    string[],
  ][];
  assets: AssetSectionsAsset[];
  unmapped: [string, Placed, string][];
  accounts: AssetSectionsAccount[];
  unplaced: [string, number, string][];
  inventory: {
    register: Record<
      | 'blank'
      | 'section'
      | 'end'
      | 'stray'
      | 'label'
      | 'columns'
      | 'total'
      | 'record',
      number
    >;
    map: { header: number; blank: number; row: number };
    gl: { header: number; blank: number; row: number };
  };
};

export function refuseAssetSections(code: string): never {
  throw Error('FA_SECTIONS_' + code);
}

const BOUND = 10n ** 14n;
const SAFE = 2n ** 53n - 1n;

/** Code point order, as the contract sorts. */
export function byCodePoint(a: string, b: string): number {
  const x = Array.from(a),
    y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}
const byList = (a: (string | number)[], b: (string | number)[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d =
      typeof a[i] === 'number'
        ? Math.sign((a[i] as number) - (b[i] as number))
        : byCodePoint(a[i] as string, b[i] as string);
    if (d) return d;
  }
  return Math.sign(a.length - b.length);
};
const sorted = (codes: Iterable<string>) =>
  [...new Set(codes)].sort(byCodePoint);

/** Text by the contract: non-empty, at most 500 UTF-16 code units, no
 * control or format character, no space separator or line or paragraph
 * separator at either end, no formula sign or Excel error first. Never
 * trimmed. */
export function sectionsText(v: string | undefined | null): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 500 &&
    !/[\p{Cc}\p{Cf}]/u.test(v) &&
    !/^[\p{Zs}\u2028\u2029]|[\p{Zs}\u2028\u2029]$/u.test(v) &&
    !/^[=+@-]/.test(v) &&
    !/^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v)
  );
}

/** A real Gregorian date in ASCII YYYY-MM-DD, years 0001 to 9999. */
export function sectionsDate(v: string | undefined | null): string | null {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))
    return null;
  const y = Number(v.slice(0, 4)),
    m = Number(v.slice(5, 7)),
    d = Number(v.slice(8, 10));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] ? v : null;
}

/** ASCII digits and an optional fraction no longer than the currency's
 * decimals, in minor units, at most 10^14. A blank is not zero. */
export function sectionsAmount(
  v: string | undefined | null,
  places: number,
): bigint | null {
  if (typeof v !== 'string') return null;
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(v);
  if (!m || (m[2] ?? '').length > places) return null;
  const n = BigInt(m[1] + (m[2] ?? '').padEnd(places, '0'));
  return n <= BOUND ? n : null;
}

function exact(n: bigint): number {
  if (n > SAFE || n < -SAFE) refuseAssetSections('TOTAL_LIMIT');
  return Number(n);
}

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** READING then SCOPE, before any file is read; the currency's decimals. */
export function assetSectionsPlaces(readings: unknown, scope: unknown): number {
  if (!Array.isArray(readings) || readings.length !== 3)
    refuseAssetSections('READING');
  readings.forEach((r, i) => {
    if (
      !plain(r) ||
      Object.keys(r).sort().join('|') !== 'confirmed|family|role|sheet' ||
      r.sheet !== 0 ||
      r.role !== FA_SECTIONS_ROLES[i] ||
      r.family !== FA_SECTIONS_VERSION ||
      r.confirmed !== true
    )
      refuseAssetSections('READING');
  });
  if (
    !plain(scope) ||
    Object.keys(scope).sort().join('|') !==
      [...FA_SECTIONS_SCOPE_FIELDS, 'confirmed'].sort().join('|') ||
    scope.confirmed !== true ||
    !FA_SECTIONS_SCOPE_FIELDS.every((k) => sectionsText(scope[k] as string)) ||
    !Object.hasOwn(FA_SECTIONS_PLACES, scope.currency as string) ||
    sectionsDate(scope.asOf as string) === null
  )
    refuseAssetSections('SCOPE');
  return FA_SECTIONS_PLACES[scope.currency as string];
}

const meaningful = (cells: string[]) => {
  let k = cells.length;
  while (k && cells[k - 1] === '') k--;
  return cells.slice(0, k);
};
const blank = (cells: string[]) => cells.every((c) => c === '');
const first = (cells: string[]) => (cells.length ? cells[0] : undefined);

/** The positions of a flat file's header: exactly its columns, each once, in
 * any order, trailing empty cells aside; otherwise COLUMNS. */
function flatHeader(rows: string[][], header: readonly string[]) {
  const head = rows.length ? meaningful(rows[0]) : [];
  if (
    head.length !== header.length ||
    new Set(head).size !== header.length ||
    !header.every((h) => head.includes(h))
  )
    refuseAssetSections('COLUMNS');
  return new Map(head.map((h, i) => [h, i]));
}
const cell = (cells: string[], pos: Map<string, number>, name: string) => {
  const p = pos.get(name)!;
  return p < cells.length ? cells[p] : undefined;
};

type Kind =
  | 'blank'
  | 'section'
  | 'end'
  | 'stray'
  | 'label'
  | 'columns'
  | 'total'
  | 'record';
type AssetWork = {
  id: string;
  dims: string;
  codes: Set<string>;
  rows: Record<Component, number[]>;
  minor: Record<Component, (bigint | null)[]>;
  unread: number[];
  vals: Set<string>;
  amount?: Record<Component, bigint | null>;
};
type Section = {
  start: number;
  end: number | null;
  body: number[];
  row: number;
  endRow: number | null;
  id: string | null;
  location: string | null;
  category: string | null;
  column: number | null;
  after: number[];
  code: string | null;
  codes: string[];
  assets: Map<string, AssetWork>;
};

const SECTION_SCOPE = [
  ['Entity', 'entity'],
  ['Asset ledger', 'assetLedger'],
  ['Currency', 'currency'],
  ['As of', 'asOf'],
] as const;
const GL_SCOPE = [
  ['Entity', 'entity'],
  ['GL ledger', 'glLedger'],
  ['Currency', 'currency'],
  ['As of', 'asOf'],
] as const;

function splitRegister(records: string[][]) {
  const kinds = Array.from<Kind>({ length: records.length });
  const sections: Section[] = [];
  let i = 0;
  while (i < records.length) {
    if (first(records[i]) === 'Section') {
      let j = i + 1;
      while (
        j < records.length &&
        first(records[j]) !== 'Section' &&
        first(records[j]) !== 'End section'
      )
        j++;
      const end =
        j < records.length && first(records[j]) === 'End section' ? j : null;
      sections.push({
        start: i,
        end,
        body: Array.from({ length: j - i - 1 }, (_, k) => i + 1 + k),
        row: i + 1,
        endRow: end === null ? null : end + 1,
        id: null,
        location: null,
        category: null,
        column: null,
        after: [],
        code: null,
        codes: [],
        assets: new Map(),
      });
      kinds[i] = 'section';
      if (end !== null) kinds[end] = 'end';
      i = end !== null ? j + 1 : j;
    } else {
      kinds[i] = blank(records[i]) ? 'blank' : 'stray';
      i++;
    }
  }
  return { sections, kinds };
}

function readSection(
  sec: Section,
  records: string[][],
  kinds: Kind[],
  scope: AssetSectionsScope,
) {
  const head = records[sec.start];
  const sid = head.length > 1 ? head[1] : null;
  const body = sec.body.filter((k) => !blank(records[k]));
  for (const k of sec.body) if (blank(records[k])) kinds[k] = 'blank';
  const column = body.find((k) => meaningful(records[k]).length > 2) ?? null;
  const labelRows = body.filter((k) => column === null || k < column);
  const after = body.filter((k) => column !== null && k > column);
  for (const k of labelRows) kinds[k] = 'label';
  if (column !== null) kinds[column] = 'columns';
  for (const k of after)
    kinds[k] = first(records[k]) === 'Section total' ? 'total' : 'record';
  const labels = new Map<string, string[]>();
  for (const k of labelRows) {
    const m = meaningful(records[k]);
    if (
      m.length === 2 &&
      (FA_SECTIONS_LABELS as readonly string[]).includes(m[0])
    )
      labels.set(m[0], [...(labels.get(m[0]) ?? []), m[1]]);
  }
  const once = new Map<string, string>();
  for (const [label, values] of labels)
    if (values.length === 1 && sectionsText(values[0]))
      once.set(label, values[0]);
  Object.assign(sec, {
    id: sid,
    location: once.get('Location') ?? null,
    category: once.get('Category') ?? null,
    column,
    after,
  });
  const end = sec.end === null ? null : meaningful(records[sec.end]);
  const closed =
    end !== null &&
    end.length === 2 &&
    end[0] === 'End section' &&
    end[1] === (sid ?? '');
  const headerOk =
    meaningful(head).length === 2 &&
    sectionsText(sid) &&
    labelRows.every((k) => {
      const m = meaningful(records[k]);
      return (
        m.length === 2 &&
        (FA_SECTIONS_LABELS as readonly string[]).includes(m[0])
      );
    }) &&
    FA_SECTIONS_LABELS.every(
      (label) =>
        labels.get(label)?.length === 1 && sectionsText(labels.get(label)![0]),
    ) &&
    sectionsDate(labels.get('As of')![0]) !== null;
  const columns = column === null ? [] : meaningful(records[column]);
  if (!once.has('Category')) sec.code = 'SECTION_UNREADABLE';
  else if (!closed) sec.code = 'SECTION_UNCLOSED';
  else if (!headerOk) sec.code = 'SECTION_HEADER';
  else if (SECTION_SCOPE.some(([label, key]) => once.get(label) !== scope[key]))
    sec.code = 'SECTION_SCOPE';
  else if (
    column === null ||
    columns.length !== FA_SECTIONS_COLUMNS.length ||
    new Set(columns).size !== FA_SECTIONS_COLUMNS.length ||
    !FA_SECTIONS_COLUMNS.every((c) => columns.includes(c))
  )
    sec.code = 'SECTION_COLUMNS';
  else sec.code = null;
  if (sec.code) sec.codes = [sec.code];
}

const isComponent = (v: string | undefined): v is Component =>
  (FA_SECTIONS_COMPONENTS as readonly string[]).includes(v as string);
const isPlaced = (v: string | undefined): v is Placed =>
  (FA_SECTIONS_PLACED as readonly string[]).includes(v as string);
const byComponent = <T>(make: () => T) =>
  Object.fromEntries(FA_SECTIONS_COMPONENTS.map((c) => [c, make()])) as Record<
    Component,
    T
  >;

function judgeRecords(
  sec: Section,
  records: string[][],
  places: number,
  unplaced: [string, number, string][],
) {
  const pos = new Map(meaningful(records[sec.column!]).map((h, i) => [h, i]));
  const rows: { comp: string | undefined; minor: bigint | null }[] = [];
  const totals: number[] = [];
  for (const k of sec.after) {
    const cells = records[k];
    if (first(cells) === 'Section total') {
      totals.push(k);
      continue;
    }
    const aid = cell(cells, pos, 'Asset ID'),
      dims = cell(cells, pos, 'Asset dimensions'),
      comp = cell(cells, pos, 'Component'),
      val = cell(cells, pos, 'Valuation reference'),
      minor = sectionsAmount(cell(cells, pos, 'Amount'), places);
    rows.push({ comp, minor });
    if (!sectionsText(aid) || !sectionsText(dims)) {
      unplaced.push(['register-sections', k + 1, 'ROW_UNPLACED']);
      sec.codes.push('ROW_UNPLACED');
      continue;
    }
    const key = JSON.stringify([aid, dims]);
    let a = sec.assets.get(key);
    if (!a) {
      a = {
        id: aid,
        dims,
        codes: new Set(),
        rows: byComponent<number[]>(() => []),
        minor: byComponent<(bigint | null)[]>(() => []),
        unread: [],
        vals: new Set(),
      };
      sec.assets.set(key, a);
    }
    if (meaningful(cells).length > FA_SECTIONS_COLUMNS.length)
      a.codes.add('CELLS');
    if (isComponent(comp)) {
      a.rows[comp].push(k + 1);
      a.minor[comp].push(minor);
    } else {
      a.codes.add('COMPONENT');
      a.unread.push(k + 1);
    }
    if (minor === null) a.codes.add('AMOUNT');
    if (sectionsText(val)) a.vals.add(val);
    else a.codes.add('TEXT');
  }
  for (const a of sec.assets.values()) {
    const counts = FA_SECTIONS_COMPONENTS.map((c) => a.rows[c].length);
    if (counts.some((n) => n === 0)) a.codes.add('COMPONENT_MISSING');
    if (counts.some((n) => n > 1)) a.codes.add('COMPONENT_REPEATED');
    if (a.vals.size > 1) a.codes.add('VALUATION');
    const once = byComponent<bigint | null>(() => null);
    for (const c of FA_SECTIONS_COMPONENTS)
      if (a.rows[c].length === 1) once[c] = a.minor[c][0];
    if (
      FA_SECTIONS_COMPONENTS.every(
        (c) => a.rows[c].length === 1 && once[c] !== null,
      ) &&
      once.cost! - once.depreciation! - once.impairment! !== once.carrying
    )
      a.codes.add('CARRYING');
    a.amount = once;
  }
  const seen = new Map<string, bigint | null>();
  let field = false;
  for (const k of totals) {
    const m = meaningful(records[k]);
    const value = m.length === 3 ? sectionsAmount(m[2], places) : null;
    if (
      m.length !== 3 ||
      !isComponent(m[1]) ||
      value === null ||
      seen.has(m[1])
    ) {
      field = true;
      if (m.length >= 2 && isComponent(m[1])) seen.set(m[1], null);
      continue;
    }
    seen.set(m[1], value);
  }
  for (const [c, total] of seen) {
    if (total === null) continue;
    if (
      rows.some((r) => !isComponent(r.comp)) ||
      rows.some((r) => r.comp === c && r.minor === null)
    ) {
      field = true;
      continue;
    }
    const sum = rows
      .filter((r) => r.comp === c)
      .reduce((s, r) => s + r.minor!, 0n);
    exact(sum);
    if (sum !== total) sec.codes.push('TOTAL_MISMATCH');
  }
  if (field) sec.codes.push('TOTAL_FIELD');
}

/** The review of one run, from the three files' rows. Refuses COLUMNS when
 * the map's or the GL's header is not its columns, and TOTAL_LIMIT when a sum
 * it computes is not held exactly; READING, SCOPE, SOURCE and CAPACITY are
 * the reader's and the replay's. */
export function reviewAssetSections(
  input: AssetSectionsInput,
): AssetSectionsResult {
  const places = assetSectionsPlaces(input.readings, input.scope);
  const scope = input.scope;
  if (!Array.isArray(input.files) || input.files.length !== 3)
    refuseAssetSections('SOURCE');
  const [reg, mrows, grows] = input.files.map((f) => f.sheets[0].rows);
  const mpos = flatHeader(mrows, FA_SECTIONS_MAP_HEADER);
  const gpos = flatHeader(grows, FA_SECTIONS_GL_HEADER);
  const run = new Set<string>();
  const unplaced: [string, number, string][] = [];

  const { sections, kinds } = splitRegister(reg);
  kinds.forEach((kind, k) => {
    if (kind === 'stray') {
      run.add('STRAY_ROW');
      unplaced.push(['register-sections', k + 1, 'STRAY_ROW']);
    }
  });
  for (const sec of sections) {
    readSection(sec, reg, kinds, scope);
    if (sec.code === 'SECTION_UNREADABLE') {
      run.add('SECTION_UNREADABLE');
      unplaced.push(['register-sections', sec.row, 'SECTION_UNREADABLE']);
    }
  }
  const judged = sections.filter((s) => s.code === null);
  for (const s of judged) {
    if (judged.filter((t) => t.id === s.id).length > 1)
      s.codes.push('SECTION_DUPLICATE');
    judgeRecords(s, reg, places, unplaced);
  }
  const where = new Map<string, Set<number>>();
  judged.forEach((s, n) => {
    for (const a of s.assets.values())
      where.set(a.id, (where.get(a.id) ?? new Set()).add(n));
  });
  for (const s of judged)
    for (const a of s.assets.values())
      if (where.get(a.id)!.size > 1) a.codes.add('ID_SECTIONS');
  const registerCategories = new Set(
    sections
      .filter(
        (s) => s.code !== 'SECTION_SCOPE' && s.code !== 'SECTION_UNREADABLE',
      )
      .map((s) => s.category!),
  );

  // The map: pairs of category and component.
  type MapRow = {
    codes: Set<string>;
    key: string;
    from: string | null;
    to: string | null;
  };
  const pairs = new Map<string, MapRow[]>();
  mrows.slice(1).forEach((cells, i) => {
    if (blank(cells)) return;
    const k = i + 2;
    const cat = cell(cells, mpos, 'Category'),
      comp = cell(cells, mpos, 'Component');
    if (!sectionsText(cat) || !isPlaced(comp)) {
      run.add('MAP_UNREADABLE');
      unplaced.push(['category-map', k, 'MAP_UNREADABLE']);
      return;
    }
    const codes = new Set<string>();
    if (cell(cells, mpos, 'Account class') !== FA_SECTIONS_CLASSES[comp])
      codes.add('MAP_CLASS');
    const acct = cell(cells, mpos, 'GL account'),
      dims = cell(cells, mpos, 'GL dimensions'),
      from = sectionsDate(cell(cells, mpos, 'Valid from')),
      to = sectionsDate(cell(cells, mpos, 'Valid to'));
    if (
      !sectionsText(acct) ||
      !sectionsText(dims) ||
      from === null ||
      to === null ||
      from > to ||
      meaningful(cells).length > FA_SECTIONS_MAP_HEADER.length
    )
      codes.add('MAP_ROW');
    const pair = JSON.stringify([cat, comp]);
    pairs.set(pair, [
      ...(pairs.get(pair) ?? []),
      { codes, key: JSON.stringify([acct, dims]), from, to },
    ]);
  });
  const placed = new Map<string, string>();
  const notPlaced = new Map<string, Set<string>>();
  for (const [pair, rows] of pairs) {
    const bad = new Set(rows.flatMap((r) => [...r.codes]));
    if (bad.size) {
      notPlaced.set(pair, bad);
      continue;
    }
    const valid = rows.filter(
      (r) => r.from! <= scope.asOf && scope.asOf <= r.to!,
    );
    if (valid.length === 1) placed.set(pair, valid[0].key);
    else
      notPlaced.set(
        pair,
        new Set([valid.length ? 'MAP_REPEATED' : 'MAP_EXPIRED']),
      );
  }
  for (const cat of registerCategories)
    for (const comp of FA_SECTIONS_PLACED) {
      const pair = JSON.stringify([cat, comp]);
      if (!pairs.has(pair)) notPlaced.set(pair, new Set(['MAP_ABSENT']));
    }
  for (const pair of notPlaced.keys())
    if (!registerCategories.has(JSON.parse(pair)[0])) notPlaced.delete(pair);

  // GL balances.
  type GLRow = {
    row: number;
    cls: string | undefined;
    debit: bigint | null;
    credit: bigint | null;
    codes: Set<string>;
  };
  const gl = new Map<string, GLRow[]>();
  const classOf = (cls: string | undefined) =>
    FA_SECTIONS_PLACED.find((c) => FA_SECTIONS_CLASSES[c] === cls);
  grows.slice(1).forEach((cells, i) => {
    if (blank(cells)) return;
    const k = i + 2;
    const acct = cell(cells, gpos, 'GL account'),
      dims = cell(cells, gpos, 'GL dimensions');
    if (!sectionsText(acct) || !sectionsText(dims)) {
      run.add('GL_UNREADABLE');
      unplaced.push(['gl-balances', k, 'GL_UNREADABLE']);
      return;
    }
    const cls = cell(cells, gpos, 'Account class'),
      debit = sectionsAmount(cell(cells, gpos, 'Debit'), places),
      credit = sectionsAmount(cell(cells, gpos, 'Credit'), places);
    const codes = new Set<string>();
    if (
      !classOf(cls) ||
      debit === null ||
      credit === null ||
      meaningful(cells).length > FA_SECTIONS_GL_HEADER.length
    )
      codes.add('GL_ROW');
    if (GL_SCOPE.some(([h, key]) => cell(cells, gpos, h) !== scope[key]))
      codes.add('GL_SCOPE');
    const key = JSON.stringify([acct, dims]);
    gl.set(key, [
      ...(gl.get(key) ?? []),
      { row: k, cls, debit, credit, codes },
    ]);
  });

  // Accounts.
  const keys = [...new Set([...placed.values(), ...gl.keys()])]
    .map((k) => JSON.parse(k) as [string, string])
    .sort(byList);
  const heldSections = sections.filter(
    (s) =>
      s.codes.length &&
      s.code !== 'SECTION_SCOPE' &&
      s.code !== 'SECTION_UNREADABLE',
  );
  const heldAssets = judged.flatMap((s) =>
    [...s.assets.values()].filter((a) => a.codes.size).map((a) => ({ s, a })),
  );
  const accounts: AssetSectionsAccount[] = [];
  for (const [account, dimensions] of keys) {
    const key = JSON.stringify([account, dimensions]);
    const on = [...placed]
      .filter(([, k]) => k === key)
      .map(([pair]) => JSON.parse(pair) as [string, Placed]);
    const comps = new Set(on.map(([, c]) => c));
    const rows = gl.get(key) ?? [];
    const codes = new Set<string>(run);
    let component: Placed | null = null;
    if (comps.size === 1) component = [...comps][0];
    else if (comps.size) codes.add('ACCOUNT_COMPONENTS');
    else if (rows.length === 1 && classOf(rows[0].cls))
      component = classOf(rows[0].cls)!;
    const cats = new Set(on.map(([cat]) => cat));
    for (const s of heldSections)
      if (cats.has(s.category!)) for (const c of s.codes) codes.add(c);
    for (const { s, a } of heldAssets)
      if (cats.has(s.category!)) for (const c of a.codes) codes.add(c);
    for (const [pair, c] of notPlaced)
      if (JSON.parse(pair)[1] === component) for (const x of c) codes.add(x);
    for (const r of rows) for (const c of r.codes) codes.add(c);
    if (rows.length > 1) codes.add('GL_REPEATED');
    if (
      on.length &&
      component &&
      rows.length === 1 &&
      classOf(rows[0].cls) &&
      rows[0].cls !== FA_SECTIONS_CLASSES[component]
    )
      codes.add('CLASS_CONFLICT');
    const members: [string, string, string, Placed][] = [];
    const amounts: (bigint | null)[] = [];
    for (const s of judged)
      for (const a of s.assets.values())
        for (const comp of FA_SECTIONS_PLACED)
          if (placed.get(JSON.stringify([s.category, comp])) === key) {
            members.push([s.id!, a.id, a.dims, comp]);
            amounts.push(a.amount![comp]);
          }
    members.sort(byList);
    let register: number | null = null,
      balance: number | null = null,
      difference: number | null = null,
      status: AssetSectionsAccount['status'];
    let out: string[];
    if (codes.size) {
      status = 'held';
      out = sorted(codes);
    } else {
      const missing = new Set<string>();
      if (!on.length) missing.add('UNMAPPED');
      if (!rows.length) missing.add('GL_ABSENT');
      if (on.length && !members.length) missing.add('REGISTER_ABSENT');
      let sum: bigint | null = null,
        normal: bigint | null = null;
      if (members.length) {
        sum = amounts.reduce<bigint>((x, y) => x + y!, 0n);
        register = exact(sum);
      }
      if (rows.length) {
        const r = rows[0];
        normal =
          component === 'cost' ? r.debit! - r.credit! : r.credit! - r.debit!;
        balance = Number(normal);
      }
      if (sum !== null && normal !== null) difference = exact(sum - normal);
      out = sorted(missing);
      status = missing.size
        ? 'missing'
        : difference
          ? 'difference'
          : 'consistent';
    }
    accounts.push({
      account,
      dimensions,
      component,
      status,
      codes: out,
      register,
      gl: balance,
      difference,
      glRow: rows.length === 1 ? rows[0].row : null,
      members,
    });
  }

  const assets: AssetSectionsAsset[] = [];
  for (const s of judged)
    for (const a of s.assets.values())
      assets.push({
        section: s.id!,
        sectionRow: s.row,
        assetId: a.id,
        dimensions: a.dims,
        location: s.location!,
        category: s.category!,
        status: a.codes.size ? 'held' : 'read',
        codes: sorted(a.codes),
        amounts: byComponentFrom(a.amount!),
        rows: a.rows,
        unread: a.unread,
        valuation: a.vals.size === 1 ? [...a.vals][0] : null,
      });
  assets.sort((x, y) =>
    byList(
      [x.section, x.assetId, x.dimensions, x.sectionRow],
      [y.section, y.assetId, y.dimensions, y.sectionRow],
    ),
  );
  const count = (rows: string[][]) => ({
    header: 1,
    blank: rows.slice(1).filter(blank).length,
    row: rows.slice(1).filter((r) => !blank(r)).length,
  });
  const kindCount = (k: Kind) => kinds.filter((x) => x === k).length;
  return {
    version: FA_SECTIONS_VERSION,
    refused: null,
    decimals: places,
    hashes: input.files.map((f) => f.sha256!),
    run: sorted(run),
    sections: sections.map((s) => [
      s.row,
      s.endRow,
      s.id,
      s.location,
      s.category,
      s.code === 'SECTION_SCOPE'
        ? 'excluded'
        : s.codes.length
          ? 'held'
          : 'read',
      sorted(s.codes),
    ]),
    assets,
    unmapped: [...notPlaced]
      .flatMap(([pair, c]) => {
        const [cat, comp] = JSON.parse(pair) as [string, Placed];
        return [...c].map(
          (code) => [cat, comp, code] as [string, Placed, string],
        );
      })
      .sort(byList),
    accounts,
    unplaced: unplaced.sort(
      (x, y) =>
        FA_SECTIONS_ROLES.indexOf(x[0] as (typeof FA_SECTIONS_ROLES)[number]) -
          FA_SECTIONS_ROLES.indexOf(
            y[0] as (typeof FA_SECTIONS_ROLES)[number],
          ) || x[1] - y[1],
    ),
    inventory: {
      register: {
        blank: kindCount('blank'),
        section: kindCount('section'),
        end: kindCount('end'),
        stray: kindCount('stray'),
        label: kindCount('label'),
        columns: kindCount('columns'),
        total: kindCount('total'),
        record: kindCount('record'),
      },
      map: count(mrows),
      gl: count(grows),
    },
  };
}

function byComponentFrom(
  amount: Record<Component, bigint | null>,
): Record<Component, number | null> {
  return Object.fromEntries(
    FA_SECTIONS_COMPONENTS.map((c) => [
      c,
      amount[c] === null ? null : Number(amount[c]),
    ]),
  ) as Record<Component, number | null>;
}
