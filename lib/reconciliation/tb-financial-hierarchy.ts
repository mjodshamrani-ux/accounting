import { currencyPrecision } from './currency-precision.ts';
import {
  FIN_HIERARCHY_CATEGORIES as CATEGORIES,
  FIN_HIERARCHY_LIMITS as LIMITS,
  FIN_HIERARCHY_NODE_HEADERS,
  FIN_HIERARCHY_SCOPE_HEADERS as SCOPE,
  type FinancialHierarchyCategory,
  type FinancialHierarchyScope,
} from './tb-financial-hierarchy-contract.ts';
import { readCSV, validDate } from './tb-financial-hierarchy-source.ts';

/**
 * FIN-1: a hierarchical statement of financial position against the trial
 * balance, the proposed mapping and the presentation evidence, on the
 * FIN-1A contract (audit/tb-financial-hierarchy/contract.json). Read and
 * review only: no decision, session or workbook. The four CSV sources are
 * read from their bytes here, strictly, as the contract reads them.
 *
 * Where the contract's oracle lets the first of two duplicates stand for
 * the rest, this engine names every contender and decides nothing that rests
 * on them. Beyond the contract it refuses identical sources and a scope it
 * cannot confirm, and names a control or format character in an identity.
 */
export const FINH_VERSION = 'tb-financial-hierarchy-1';
export const FINH_CONTRACT = 'FIN-1A-hierarchy-foundation-1';
export const FINH_CLAIM =
  'Consistency of a hierarchical statement with the supplied trial balance, proposed mapping and presentation evidence under FIN-1A only; no decision, completeness, fair-presentation or accounting-standards opinion';
export const FINH_ROLES = [
  'trial-balance',
  'proposed-mapping',
  'presentation-evidence',
  'financial-position',
] as const;
export type FinHRole = (typeof FINH_ROLES)[number];
export const FINH_HEADERS: readonly (readonly string[])[] = [
  [
    'Account ID',
    'Complete dimensions',
    'Account label',
    'Account class',
    'Debit',
    'Credit',
  ],
  [
    'Mapping ID',
    'Account ID',
    'Complete dimensions',
    'Line ID',
    'Sign',
    'Evidence ID',
  ],
  [
    'Evidence ID',
    'Account ID',
    'Complete dimensions',
    'Account class',
    'Line ID',
    'Line label',
    'Line class',
    'Sign',
    'Valid from',
    'Valid to',
    'Evidence reference',
  ],
  FIN_HIERARCHY_NODE_HEADERS,
];
const IDENTITY_FIELDS: readonly (readonly string[])[] = [
  ['Account ID', 'Complete dimensions'],
  ['Mapping ID', 'Account ID', 'Complete dimensions', 'Line ID', 'Evidence ID'],
  ['Evidence ID', 'Account ID', 'Complete dimensions', 'Line ID'],
  ['Node ID', 'Parent ID'],
];
/** A source that cannot be read as a whole; no cross-source check rests on it. */
export const FINH_SOURCE_CODES = ['BYTES', 'CSV', 'HEADERS', 'ROWS', 'TEXT'];

export type FinHFile = { name: string; sha256: string; bytes: Uint8Array };
export type FinHReading = {
  role: FinHRole;
  family: typeof FINH_VERSION;
  confirmed: boolean;
};
export type FinHInput = {
  files: [FinHFile, FinHFile, FinHFile, FinHFile];
  readings: [FinHReading, FinHReading, FinHReading, FinHReading];
  scope: { confirmed: boolean; fields: FinancialHierarchyScope };
};
export type FinHIssue = {
  code: string;
  source: number | null;
  row: number | null;
  field: string | null;
};
export type FinHSource = {
  role: FinHRole;
  name: string;
  sha256: string;
  bytes: number;
  header: string[] | null;
  records: number;
  readable: boolean;
};
export type FinHNode = {
  row: number;
  id: string;
  parentId: string;
  kind: string;
  label: string;
  lineClass: string;
  amount: number | null;
  depth: number | null;
};
export type FinHMember = {
  mappingId: string;
  mappingRow: number;
  account: string;
  dimensions: string;
  evidenceId: string;
  evidenceRow: number | null;
  tbRow: number | null;
  net: number | null;
  contribution: number | null;
};
export type FinHLine = {
  id: string;
  row: number;
  label: string;
  lineClass: string;
  reported: number | null;
  calculated: number | null;
  difference: number | null;
  members: FinHMember[];
};
export type FinHControl = {
  id: string;
  row: number;
  supplied: number | null;
  childTotal: number | null;
  difference: number | null;
  children: string[];
};
type Categories = Record<FinancialHierarchyCategory, number>;
export type FinHFacts = {
  debitMinor: number;
  creditMinor: number;
  leafMinor: Record<string, number>;
  parentMinor: Record<string, number>;
  members: Record<string, string[]>;
  categoryMinor: Categories;
  equationMinor: number;
};
export type FinHResult = {
  version: typeof FINH_VERSION;
  contract: typeof FINH_CONTRACT;
  claim: typeof FINH_CLAIM;
  context: string;
  scope: FinancialHierarchyScope;
  readings: FinHInput['readings'];
  sources: FinHSource[];
  status: 'eligible' | 'blocked';
  issues: FinHIssue[];
  inventory: { source: number; row: number; raw: string[] }[];
  nodes: FinHNode[];
  lines: FinHLine[];
  controls: FinHControl[];
  tb: { debit: number | null; credit: number | null } | null;
  categories: { reported: Categories; calculated: Categories } | null;
  equation: { reported: number; calculated: number } | null;
  facts: FinHFacts | null;
  ownership: Record<string, string> | null;
};

type Row = { source: number; row: number; cells: Record<string, string> };
const LIMIT = LIMITS.minorAbs;
const abs = (v: bigint) => (v < 0n ? -v : v);
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (v: object, wanted: readonly string[]) =>
  Object.keys(v).sort().join('\0') === [...wanted].sort().join('\0');
const codePoints = (v: string) => Array.from(v).length;
const hidden = (v: string) => /[\p{Cc}\p{Cf}]/u.test(v);
const isCategory = (v: string): v is FinancialHierarchyCategory =>
  (CATEGORIES as readonly string[]).includes(v);
const policy = (v: FinancialHierarchyCategory) =>
  v.endsWith('asset') ? 'debit-positive' : 'credit-positive';
const key = (r: Row) =>
  JSON.stringify([r.cells['Account ID'], r.cells['Complete dimensions']]);
const member = (r: Row) =>
  `${r.cells['Account ID']}|${r.cells['Complete dimensions']}`;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v: bigint | null) =>
  v === null || abs(v) > LIMIT ? null : Number(v);
function fail(code: string): never {
  throw new Error(`FINH_${code}`);
}

function groups(rows: Row[], identity: (r: Row) => string) {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = identity(r);
    const group = out.get(k);
    if (group) group.push(r);
    else out.set(k, [r]);
  }
  return out;
}
const only = (map: Map<string, Row[]>, k: string) => {
  const group = map.get(k);
  return group?.length === 1 ? group[0] : undefined;
};

function checkInput(input: FinHInput) {
  if (
    !plain(input) ||
    !sameKeys(input, ['files', 'readings', 'scope']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4
  )
    fail('INPUT');
  input.files.forEach((f) => {
    if (
      !plain(f) ||
      !sameKeys(f, ['name', 'sha256', 'bytes']) ||
      typeof f.name !== 'string' ||
      !f.name ||
      codePoints(f.name) > 255 ||
      !/\.csv$/i.test(f.name) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !(f.bytes instanceof Uint8Array)
    )
      fail('SOURCE');
  });
  if (new Set(input.files.map((f) => f.sha256)).size !== 4)
    fail('INDEPENDENT_SOURCES');
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      !sameKeys(r, ['role', 'family', 'confirmed']) ||
      r.role !== FINH_ROLES[i] ||
      r.family !== FINH_VERSION ||
      r.confirmed !== true
    )
      fail('READING');
  });
  const s = input.scope;
  if (
    !plain(s) ||
    !sameKeys(s, ['confirmed', 'fields']) ||
    s.confirmed !== true ||
    !plain(s.fields) ||
    !sameKeys(s.fields, SCOPE)
  )
    fail('SCOPE');
  const f = s.fields;
  for (const k of SCOPE)
    if (
      typeof f[k] !== 'string' ||
      !f[k] ||
      f[k] !== f[k].trim() ||
      hidden(f[k]) ||
      codePoints(f[k]) > LIMITS.fieldCodePoints
    )
      fail('SCOPE');
  if (
    currencyPrecision(f.Currency) !== 2 ||
    f['Currency basis'] !== 'functional' ||
    f['Posting status'] !== 'posted' ||
    f['Posting layer'] !== 'actual' ||
    f['Closing basis'] !== 'post-closing' ||
    !validDate(f['Period start']) ||
    !validDate(f['Period end']) ||
    f['Period start'] > f['Period end'] ||
    f['As of'] !== f['Period end']
  )
    fail('SCOPE');
  return {
    scope: Object.fromEntries(
      SCOPE.map((k) => [k, f[k]]),
    ) as FinancialHierarchyScope,
    readings: input.readings.map((r) => ({
      role: r.role,
      family: FINH_VERSION,
      confirmed: true,
    })) as FinHInput['readings'],
  };
}

export function reconcileFinancialHierarchy(input: FinHInput): FinHResult {
  const { scope, readings } = checkInput(input);
  const issues: FinHIssue[] = [];
  const seen = new Set<string>();
  const problem = (
    code: string,
    source: number | null = null,
    row: number | null = null,
    field: string | null = null,
  ) => {
    const signature = JSON.stringify([code, source, row, field]);
    if (seen.has(signature)) return;
    seen.add(signature);
    issues.push({ code, source, row, field });
  };
  const checked = (
    values: bigint[],
    source: number | null,
    row: number | null,
    field: string,
  ) => {
    const total = values.reduce((a, b) => a + b, 0n);
    if (values.some((v) => abs(v) > LIMIT) || abs(total) > LIMIT)
      problem('SUM', source, row, field);
    return total;
  };
  const money = (r: Row, field: string, nonnegative = false) => {
    const value = r.cells[field];
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) {
      problem('MONEY', r.source, r.row, field);
      return null;
    }
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split(
      '.',
    );
    const minor =
      (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) *
      (negative ? -1n : 1n);
    if (abs(minor) > LIMIT || (nonnegative && minor < 0n)) {
      problem('MONEY', r.source, r.row, field);
      return null;
    }
    return minor;
  };

  // ---- reading: each source on its own -------------------------------
  const sources: FinHSource[] = [];
  const tables: Row[][] = [];
  // Read: the header is the contract's and nothing stopped the reading.
  // Readable (in the result): read, with at least one record to rest on.
  const read: boolean[] = [];
  const inventory: FinHResult['inventory'] = [];
  for (let source = 0; source < 4; source++) {
    const file = input.files[source];
    const entry: FinHSource = {
      role: FINH_ROLES[source],
      name: file.name,
      sha256: file.sha256,
      bytes: file.bytes.byteLength,
      header: null,
      records: 0,
      readable: false,
    };
    sources.push(entry);
    tables.push([]);
    read.push(false);
    if (file.bytes.byteLength > LIMITS.bytes) {
      problem('BYTES', source);
      continue;
    }
    let text: string;
    try {
      // The byte-order mark stays, so a header that starts with one is not the header.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        file.bytes,
      );
    } catch {
      problem('CSV', source);
      continue;
    }
    // A byte-order mark belongs to the first header name, quoted or not, so
    // the header is not the contract's (F1); it is not a broken quote.
    if (text.startsWith('\uFEFF')) {
      problem('HEADERS', source, 1);
      continue;
    }
    const parsed = readCSV(text);
    if (parsed.reason === 'CSV') {
      problem('CSV', source, parsed.records.length + 1);
      continue;
    }
    const header = parsed.records[0]?.raw ?? null;
    entry.header = header;
    const wanted = [...FINH_HEADERS[source], ...SCOPE];
    if (
      !header ||
      header.length !== wanted.length ||
      !wanted.every((h) => header.includes(h))
    ) {
      problem('HEADERS', source, 1);
      continue;
    }
    if (parsed.reason) {
      problem(parsed.reason, source, parsed.records.length);
      continue;
    }
    entry.records = parsed.records.length - 1;
    read[source] = true;
    for (const [index, record] of parsed.records.entries()) {
      if (!index) continue;
      const row = index + 1;
      inventory.push({ source, row, raw: record.raw });
      if (record.raw.length !== header.length) {
        problem('WIDTH', source, row);
        continue;
      }
      const cells = Object.fromEntries(
        header.map((h, i) => [h, record.raw[i]]),
      );
      const r: Row = { source, row, cells };
      tables[source].push(r);
      for (const field of IDENTITY_FIELDS[source])
        if (hidden(cells[field])) problem('IDENTITY', source, row, field);
      if (SCOPE.some((k) => cells[k] !== scope[k]))
        problem('SCOPE', source, row);
    }
    if (!tables[source].length) problem('EMPTY_SOURCE', source, 1);
    else entry.readable = true;
  }
  const readable = sources.every((s) => s.readable);
  const [tb, mapping, proofs, statement] = tables;
  const identity = (rows: Row[], fields: string[], code: string) => {
    const usable = rows.filter((r) => {
      if (fields.some((f) => !r.cells[f])) {
        problem('IDENTITY', r.source, r.row, fields.join('|'));
        return false;
      }
      return true;
    });
    const map = groups(usable, (r) =>
      JSON.stringify(fields.map((f) => r.cells[f])),
    );
    for (const group of map.values())
      if (group.length > 1)
        for (const r of group) problem(code, r.source, r.row, fields.join('|'));
    return map;
  };

  // ---- trial balance -------------------------------------------------
  const tbByKey = identity(
    tb,
    ['Account ID', 'Complete dimensions'],
    'DUPLICATE_ACCOUNT',
  );
  const nets = new Map<Row, bigint | null>();
  const debits: (bigint | null)[] = [],
    credits: (bigint | null)[] = [];
  for (const r of tb) {
    if (!isCategory(r.cells['Account class']))
      problem('CLASSIFICATION', 0, r.row, 'Account class');
    const dr = money(r, 'Debit', true),
      cr = money(r, 'Credit', true);
    debits.push(dr);
    credits.push(cr);
    if (dr !== null && cr !== null) {
      if (dr > 0n && cr > 0n) problem('BOTH_SIDES', 0, r.row);
      nets.set(r, checked([dr, -cr], 0, r.row, 'Net'));
    } else nets.set(r, null);
  }
  if (read[0] && !tb.length) problem('NO_ACCOUNT', 0);
  let tbTotals: FinHResult['tb'] = null;
  if (read[0] && tb.length) {
    const all = (v: (bigint | null)[]) =>
      v.every((x) => x !== null) ? (v as bigint[]) : null;
    const d = all(debits),
      c = all(credits);
    const debit = d && checked(d, 0, null, 'TB debit total');
    const credit = c && checked(c, 0, null, 'TB credit total');
    if (debit !== null && credit !== null) {
      checked([debit, -credit], 0, null, 'TB residual');
      if (debit !== credit) problem('TB_BALANCE', 0);
    }
    tbTotals = { debit: num(debit), credit: num(credit) };
  }

  // ---- mapping and evidence on their own --------------------------------
  identity(mapping, ['Mapping ID'], 'DUPLICATE_MAPPING_ID');
  const mapByKey = identity(
    mapping,
    ['Account ID', 'Complete dimensions'],
    'DUPLICATE_MAPPING_ACCOUNT',
  );
  const signs = ['debit-positive', 'credit-positive'];
  for (const r of mapping)
    if (!signs.includes(r.cells.Sign)) problem('SIGN', 1, r.row);
  const proofById = identity(proofs, ['Evidence ID'], 'DUPLICATE_PROOF');
  identity(
    proofs,
    ['Account ID', 'Complete dimensions'],
    'DUPLICATE_PROOF_ACCOUNT',
  );
  for (const r of proofs) {
    const dates: Record<string, string> = {};
    for (const field of ['Valid from', 'Valid to'])
      if (validDate(r.cells[field])) dates[field] = r.cells[field];
      else problem('DATE', 2, r.row, field);
    if (
      dates['Valid from'] &&
      dates['Valid to'] &&
      (dates['Valid from'] > scope['Period start'] ||
        dates['Valid to'] < scope['Period end'] ||
        dates['Valid from'] > dates['Valid to'])
    )
      problem('VALIDITY', 2, r.row);
    if (!r.cells['Evidence reference']) problem('PROOF_REFERENCE', 2, r.row);
    if (!signs.includes(r.cells.Sign)) problem('SIGN', 2, r.row);
  }

  // ---- statement tree -------------------------------------------------
  const KINDS = ['leaf', 'parent', 'title'];
  const nodesById = identity(statement, ['Node ID'], 'DUPLICATE_NODE');
  const amounts = new Map<Row, bigint | null>();
  for (const r of statement) {
    const kind = r.cells.Kind;
    amounts.set(r, null);
    if (!KINDS.includes(kind)) {
      problem('KIND', 3, r.row, 'Kind');
      continue;
    }
    if (kind === 'title') {
      if (r.cells['Parent ID'] || r.cells.Amount || r.cells['Line class'])
        problem('TITLE', 3, r.row);
      continue;
    }
    if (!isCategory(r.cells['Line class']))
      problem('CLASSIFICATION', 3, r.row, 'Line class');
    amounts.set(r, money(r, 'Amount'));
  }
  const financial = (r: Row) =>
    r.cells.Kind === 'leaf' || r.cells.Kind === 'parent';
  const children = new Map<string, Row[]>();
  for (const r of statement) {
    if (!financial(r) || !r.cells['Parent ID']) continue;
    const parentId = r.cells['Parent ID'];
    const contenders = nodesById.get(JSON.stringify([parentId]));
    if (contenders && contenders.length > 1) continue;
    const owner = contenders?.[0];
    if (!owner || owner.cells.Kind !== 'parent')
      problem('PARENT', 3, r.row, 'Parent ID');
    else {
      const list = children.get(parentId);
      if (list) list.push(r);
      else children.set(parentId, [r]);
      if (owner.cells['Line class'] !== r.cells['Line class'])
        problem('CLASSIFICATION', 3, r.row, 'Line class');
    }
  }
  const unique = (id: string) => only(nodesById, JSON.stringify([id]));
  const depths = new Map<Row, number | null>();
  for (const r of statement) {
    if (!financial(r)) continue;
    const visited = new Set<Row>();
    let cursor: Row | undefined = r,
      depth: number | null = null;
    while (cursor) {
      if (visited.has(cursor)) {
        problem('CYCLE', 3, r.row, 'Parent ID');
        break;
      }
      visited.add(cursor);
      if (visited.size > LIMITS.depth) {
        problem('DEPTH', 3, r.row);
        break;
      }
      const parentId: string = cursor.cells['Parent ID'];
      if (!parentId) {
        depth = visited.size;
        break;
      }
      const next = unique(parentId);
      cursor = next && financial(next) ? next : undefined;
    }
    depths.set(r, depth);
  }
  const controls: FinHControl[] = [];
  for (const r of statement) {
    if (r.cells.Kind !== 'parent') continue;
    const id = r.cells['Node ID'];
    const kids = children.get(id) ?? [];
    if (!kids.length) problem('EMPTY_PARENT', 3, r.row);
    const values = kids.map((k) => amounts.get(k) ?? null);
    const decidable =
      !!unique(id) &&
      kids.length > 0 &&
      kids.every((k) => unique(k.cells['Node ID'])) &&
      values.every((v) => v !== null);
    let childTotal: bigint | null = null,
      difference: bigint | null = null;
    const supplied = amounts.get(r) ?? null;
    if (decidable) {
      childTotal = checked(values as bigint[], 3, r.row, 'Parent child total');
      if (supplied !== null) {
        difference = supplied - childTotal;
        if (difference !== 0n) problem('CONTROL_TOTAL', 3, r.row, 'Amount');
      }
    }
    controls.push({
      id,
      row: r.row,
      supplied: num(supplied),
      childTotal: num(childTotal),
      difference: num(difference),
      children: kids.map((k) => k.cells['Node ID']),
    });
  }
  if (read[3] && !statement.some((r) => r.cells.Kind === 'leaf'))
    problem('NO_FINANCIAL_LEAF', 3);
  const leaves = statement.filter((r) => r.cells.Kind === 'leaf');
  const categoryOf = (rows: Row[], value: (r: Row) => bigint) =>
    Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        rows.filter((r) => r.cells['Line class'] === c).map(value),
      ]),
    ) as Record<FinancialHierarchyCategory, bigint[]>;
  const equationOf = (
    values: Record<FinancialHierarchyCategory, bigint[]>,
    label: string,
  ) => {
    const category = Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        checked(values[c], 3, null, `${label} category:${c}`),
      ]),
    ) as Record<FinancialHierarchyCategory, bigint>;
    const assets = checked(
      [category['current-asset'], category['noncurrent-asset']],
      3,
      null,
      `${label} assets total`,
    );
    const liabilities = checked(
      [category['current-liability'], category['noncurrent-liability']],
      3,
      null,
      `${label} liabilities total`,
    );
    const equation = checked(
      [assets, -liabilities, -category.equity],
      3,
      null,
      `${label} statement equation`,
    );
    return { category, equation };
  };
  // The reported equation needs every leaf once, readable and classified.
  const leavesDecidable =
    read[3] &&
    leaves.length > 0 &&
    statement.every((r) => !financial(r) || unique(r.cells['Node ID'])) &&
    leaves.every(
      (r) => amounts.get(r) !== null && isCategory(r.cells['Line class']),
    );
  let reported: ReturnType<typeof equationOf> | null = null;
  if (leavesDecidable) {
    reported = equationOf(
      categoryOf(leaves, (r) => amounts.get(r)!),
      'Reported',
    );
    if (reported.equation !== 0n) problem('STATEMENT_EQUATION', 3);
  }

  // ---- across the sources ---------------------------------------------
  const lines: FinHLine[] = [];
  let calculated: ReturnType<typeof equationOf> | null = null;
  if (readable) {
    const tbKeys = new Set(
      tb
        .filter((r) => r.cells['Account ID'] && r.cells['Complete dimensions'])
        .map(key),
    );
    const mappedKeys = new Set(mapping.map(key));
    for (const [k, group] of tbByKey)
      if (!mappedKeys.has(k)) problem('UNMAPPED_ACCOUNT', 0, group[0].row);
    const account = (r: Row) => only(tbByKey, key(r));
    for (const p of proofs) {
      const a = account(p);
      const ambiguousAccount = (tbByKey.get(key(p))?.length ?? 0) > 1;
      if (!a && !ambiguousAccount) problem('PROOF_ACCOUNT', 2, p.row);
      const lineContenders = nodesById.get(
        JSON.stringify([p.cells['Line ID']]),
      );
      const line = lineContenders?.length === 1 ? lineContenders[0] : undefined;
      if (
        !(lineContenders && lineContenders.length > 1) &&
        (!line || line.cells.Kind !== 'leaf')
      )
        problem('PROOF_LINE', 2, p.row, 'Line ID');
      if (a && a.cells['Account class'] !== p.cells['Account class'])
        problem('CLASSIFICATION', 2, p.row, 'Account class');
      if (
        line &&
        (p.cells['Line class'] !== line.cells['Line class'] ||
          p.cells['Line label'] !== line.cells['Line label'])
      )
        problem('CLASSIFICATION', 2, p.row, 'Line class');
      if (p.cells['Account class'] !== p.cells['Line class'])
        problem('CLASSIFICATION', 2, p.row, 'Line class');
      const cls = a?.cells['Account class'];
      if (cls && isCategory(cls) && p.cells.Sign !== policy(cls))
        problem('SIGN_POLICY', 2, p.row, 'Sign');
    }
    const used = new Set<string>();
    const byLine = new Map<
      string,
      { members: FinHMember[]; values: (bigint | null)[] }
    >();
    for (const m of mapping) {
      const k = key(m);
      const a = account(m);
      const ambiguousAccount = (tbByKey.get(k)?.length ?? 0) > 1;
      if (!tbKeys.has(k)) problem('MAPPING_ACCOUNT', 1, m.row);
      const targetContenders = nodesById.get(
        JSON.stringify([m.cells['Line ID']]),
      );
      const target =
        targetContenders?.length === 1 ? targetContenders[0] : undefined;
      if (
        !(targetContenders && targetContenders.length > 1) &&
        (!target || target.cells.Kind !== 'leaf')
      )
        problem('MAPPING_TARGET', 1, m.row, 'Line ID');
      const proofContenders = proofById.get(
        JSON.stringify([m.cells['Evidence ID']]),
      );
      const proof =
        proofContenders?.length === 1 ? proofContenders[0] : undefined;
      if (!proofContenders) problem('MISSING_PROOF', 1, m.row);
      if (proofContenders) used.add(m.cells['Evidence ID']);
      if (
        proof &&
        ['Account ID', 'Complete dimensions', 'Line ID', 'Sign'].some(
          (f) => m.cells[f] !== proof.cells[f],
        )
      )
        problem('MAPPING_PROOF', 1, m.row);
      const cls = a?.cells['Account class'];
      if (
        cls &&
        isCategory(cls) &&
        signs.includes(m.cells.Sign) &&
        m.cells.Sign !== policy(cls)
      )
        problem('SIGN_POLICY', 1, m.row, 'Sign');
      // A contribution needs one TB row, one map line for it and a known sign.
      const net = a ? (nets.get(a) ?? null) : null;
      const decided =
        !ambiguousAccount &&
        (mapByKey.get(k)?.length ?? 0) === 1 &&
        signs.includes(m.cells.Sign) &&
        (!a || net !== null);
      const contribution = !decided
        ? null
        : !a
          ? 0n
          : m.cells.Sign === 'debit-positive'
            ? net!
            : -net!;
      const entry = byLine.get(m.cells['Line ID']) ?? {
        members: [],
        values: [],
      };
      byLine.set(m.cells['Line ID'], entry);
      entry.values.push(contribution);
      entry.members.push({
        mappingId: m.cells['Mapping ID'],
        mappingRow: m.row,
        account: m.cells['Account ID'],
        dimensions: m.cells['Complete dimensions'],
        evidenceId: m.cells['Evidence ID'],
        evidenceRow: proof?.row ?? null,
        tbRow: a?.row ?? null,
        net: num(net),
        contribution: a ? num(contribution) : null,
      });
    }
    for (const p of proofs)
      if (p.cells['Evidence ID'] && !used.has(p.cells['Evidence ID']))
        problem('UNUSED_PROOF', 2, p.row);
    const totals = new Map<Row, bigint | null>();
    for (const leaf of leaves) {
      const id = leaf.cells['Node ID'];
      const entry = byLine.get(id);
      if (!entry) problem('UNMAPPED_LEAF', 3, leaf.row);
      const values = entry?.values ?? [];
      // With no member in the TB there is nothing to compute the line from.
      const total =
        entry &&
        unique(id) &&
        entry.members.some((m) => m.tbRow !== null) &&
        values.every((v) => v !== null)
          ? checked(values as bigint[], 3, leaf.row, 'Line contribution')
          : null;
      totals.set(leaf, total);
      const supplied = amounts.get(leaf) ?? null;
      let difference: bigint | null = null;
      if (total !== null && supplied !== null) {
        difference = checked(
          [total, -supplied],
          3,
          leaf.row,
          'Line difference',
        );
        if (difference !== 0n) problem('LEAF_TOTAL', 3, leaf.row, 'Amount');
      }
      lines.push({
        id,
        row: leaf.row,
        label: leaf.cells['Line label'],
        lineClass: leaf.cells['Line class'],
        reported: num(supplied),
        calculated: num(total),
        difference: num(difference),
        members: entry?.members ?? [],
      });
    }
    if (leavesDecidable && leaves.every((r) => totals.get(r) !== null))
      calculated = equationOf(
        categoryOf(leaves, (r) => totals.get(r)!),
        'Calculated',
      );
  }

  const status = issues.length ? 'blocked' : 'eligible';
  const nodes: FinHNode[] = statement.map((r) => ({
    row: r.row,
    id: r.cells['Node ID'],
    parentId: r.cells['Parent ID'],
    kind: r.cells.Kind,
    label: r.cells['Line label'],
    lineClass: r.cells['Line class'],
    amount: num(amounts.get(r) ?? null),
    depth: depths.get(r) ?? null,
  }));
  const asNumbers = (v: Record<FinancialHierarchyCategory, bigint>) =>
    Object.fromEntries(CATEGORIES.map((c) => [c, Number(v[c])])) as Categories;
  let facts: FinHFacts | null = null,
    ownership: FinHResult['ownership'] = null;
  if (status === 'eligible' && reported && tbTotals) {
    const members: Record<string, string[]> = {};
    for (const m of mapping)
      (members[m.cells['Line ID']] ??= []).push(member(m));
    facts = {
      debitMinor: tbTotals.debit!,
      creditMinor: tbTotals.credit!,
      leafMinor: Object.fromEntries(
        leaves.map((r) => [r.cells['Node ID'], Number(amounts.get(r))]),
      ),
      parentMinor: Object.fromEntries(
        statement
          .filter((r) => r.cells.Kind === 'parent')
          .map((r) => [r.cells['Node ID'], Number(amounts.get(r))]),
      ),
      members: Object.fromEntries(
        Object.entries(members).map(([k, v]) => [k, [...v].sort(byText)]),
      ),
      categoryMinor: asNumbers(reported.category),
      equationMinor: Number(reported.equation),
    };
    ownership = Object.fromEntries(
      statement
        .filter(financial)
        .map((r) => [r.cells['Node ID'], r.cells['Parent ID']]),
    );
  }
  return {
    version: FINH_VERSION,
    contract: FINH_CONTRACT,
    claim: FINH_CLAIM,
    context: JSON.stringify([
      FINH_VERSION,
      input.files.map((f) => f.sha256),
      readings,
      scope,
    ]),
    scope,
    readings,
    sources,
    status,
    issues,
    inventory,
    nodes,
    lines,
    controls,
    tb: tbTotals,
    categories:
      reported && calculated
        ? {
            reported: asNumbers(reported.category),
            calculated: asNumbers(calculated.category),
          }
        : null,
    equation:
      reported && calculated
        ? {
            reported: Number(reported.equation),
            calculated: Number(calculated.equation),
          }
        : null,
    facts,
    ownership,
  };
}
