import { latinDigits, parseDate, parseMoney } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import { MAX_ROWS, type SourceFile, type SheetData } from './types.ts';

export const FINANCIAL_VERSION = 'tb-financial-position-1';
export const FINANCIAL_SESSION_LIMIT = 64 * 1024 * 1024;
export const FINANCIAL_ROLES = [
  'trial-balance',
  'proposed-mapping',
  'presentation-evidence',
  'financial-position',
] as const;
export const FINANCIAL_CATEGORIES = [
  'current-asset',
  'noncurrent-asset',
  'current-liability',
  'noncurrent-liability',
  'equity',
] as const;
export const FINANCIAL_SCOPE_FIELDS = [
  'entity',
  'ledger',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'start',
  'end',
  'asOf',
  'chartVersion',
  'mapVersion',
  'closingBasis',
] as const;
export const FINANCIAL_SCOPE_HEADERS = [
  'Entity',
  'Ledger',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
  'As of',
  'Chart version',
  'Map version',
  'Closing basis',
];
export const FINANCIAL_HEADERS = [
  [
    'Account ID',
    'Complete dimensions',
    'Account label',
    'Account class',
    'Debit',
    'Credit',
    ...FINANCIAL_SCOPE_HEADERS,
  ],
  [
    'Mapping ID',
    'Account ID',
    'Complete dimensions',
    'Line ID',
    'Sign',
    'Evidence ID',
    ...FINANCIAL_SCOPE_HEADERS,
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
    ...FINANCIAL_SCOPE_HEADERS,
  ],
  ['Line ID', 'Line label', 'Line class', 'Amount', ...FINANCIAL_SCOPE_HEADERS],
];
export const FINANCIAL_CLAIM =
  'Consistency with supplied confirmed presentation evidence only; no source authenticity, ERP completeness, fair-presentation or accounting-standards compliance opinion';
export type FinancialCategory = (typeof FINANCIAL_CATEGORIES)[number];
export type FinancialSign = 'debit-positive' | 'credit-positive';
export type FinancialScope = Record<
  (typeof FINANCIAL_SCOPE_FIELDS)[number],
  string
> & { confirmed: boolean };
export type FinancialReading = {
  sheet: number;
  role: (typeof FINANCIAL_ROLES)[number];
  family: typeof FINANCIAL_VERSION;
  confirmed: boolean;
};
export type FinancialEvent = {
  id: string;
  type: 'accept' | 'reject' | 'undo';
  context: string;
  lineId: string;
  mappingIds: string[];
  at: string;
  reference: string;
  note: string;
};
export type FinancialInput = {
  files: [SourceFile, SourceFile, SourceFile, SourceFile];
  readings: [
    FinancialReading,
    FinancialReading,
    FinancialReading,
    FinancialReading,
  ];
  scope: FinancialScope;
  completeness: { confirmed: boolean; reference: string; note: string };
  events: FinancialEvent[];
};
type OriginalRow = { id: string; source: number; row: number };
export type FinancialAccount = OriginalRow & {
  account: string;
  dimensions: string;
  label: string;
  category: FinancialCategory;
  debit: number;
  credit: number;
  net: number;
};
export type FinancialMapping = OriginalRow & {
  mappingId: string;
  account: string;
  dimensions: string;
  lineId: string;
  sign: FinancialSign;
  evidenceId: string;
};
export type FinancialEvidence = OriginalRow & {
  evidenceId: string;
  account: string;
  dimensions: string;
  accountClass: FinancialCategory;
  lineId: string;
  label: string;
  category: FinancialCategory;
  sign: FinancialSign;
  validFrom: string;
  validTo: string;
  reference: string;
};
export type FinancialStatement = OriginalRow & {
  lineId: string;
  label: string;
  category: FinancialCategory;
  amount: number;
};
export type FinancialInventory = OriginalRow & {
  kind: 'header' | 'blank' | 'record' | 'error';
  values: string[];
  errors: string[];
};
export type FinancialCell = OriginalRow & {
  field: string;
  column: number;
  text: string;
};
export type FinancialIssue = {
  code: string;
  source: number;
  row: number;
  key: string;
  related: string;
};
export type FinancialMember = {
  mappingId: string;
  accountRecord: string;
  mappingRecord: string;
  evidenceRecord: string;
  account: string;
  dimensions: string;
  evidenceId: string;
  debit: number;
  credit: number;
  net: number;
  contribution: number | null;
};
export type FinancialLine = FinancialStatement & {
  members: FinancialMember[];
  calculated: number | null;
  reported: number;
  difference: number | null;
  review: 'blocked' | 'needs-review' | 'accepted' | 'rejected';
};
type CategoryTotals = Record<FinancialCategory, number>;
type GrandTotals = {
  assets: number;
  liabilities: number;
  equity: number;
  equation: number;
};
export type FinancialResult = {
  version: typeof FINANCIAL_VERSION;
  claim: typeof FINANCIAL_CLAIM;
  context: string;
  scope: FinancialScope;
  readings: FinancialInput['readings'];
  completeness: FinancialInput['completeness'];
  decimals: number;
  sources: {
    hash: string;
    name: string;
    sheet: string;
    role: FinancialReading['role'];
  }[];
  accounts: FinancialAccount[];
  mappings: FinancialMapping[];
  evidence: FinancialEvidence[];
  statements: FinancialStatement[];
  inventory: FinancialInventory[];
  cells: FinancialCell[];
  issues: FinancialIssue[];
  missing: { kind: string; key: string }[];
  lines: FinancialLine[];
  tb: { debit: number; credit: number; residual: number } | null;
  totals: { calculated: CategoryTotals; reported: CategoryTotals } | null;
  grandTotals: { calculated: GrandTotals; reported: GrandTotals } | null;
  events: FinancialEvent[];
  status:
    | 'source-error'
    | 'missing'
    | 'inconsistent'
    | 'difference'
    | 'needs-review'
    | 'consistent-with-evidence';
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`TB_FIN_${code}`);
}
function text(v: string, limit = 500, identity = true) {
  if (
    typeof v !== 'string' ||
    !v ||
    v !== v.trim() ||
    v.length > limit ||
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    (identity && /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v))
  )
    fail('IDENTITY');
  return v;
}
function date(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || parseDate(v, 'ymd') !== v) fail('DATE');
  return v;
}
function amount(raw: string, decimals: number, signed = false) {
  const value = latinDigits(raw).replace(/٫/g, '.');
  if (
    !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value) ||
    (value.split('.')[1]?.length ?? 0) > decimals
  )
    fail('AMOUNT');
  let n: number | undefined;
  try {
    n = parseMoney(value, 'dot', decimals);
  } catch {
    fail('AMOUNT');
  }
  if (
    n === undefined ||
    !Number.isSafeInteger(n) ||
    Math.abs(n) > 1e14 ||
    (!signed && n < 0)
  )
    fail('AMOUNT');
  return n === 0 ? 0 : n;
}
function sum(values: number[]) {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || Math.abs(value) > 1e14) fail('SUM');
    total += BigInt(value);
  }
  if (total > 100000000000000n || total < -100000000000000n) fail('SUM');
  return Number(total);
}
function category(v: string): FinancialCategory {
  if (!FINANCIAL_CATEGORIES.includes(v as FinancialCategory)) fail('CLASS');
  return v as FinancialCategory;
}
function sign(v: string): FinancialSign {
  if (v !== 'debit-positive' && v !== 'credit-positive') fail('SIGN');
  return v;
}
const expectedSign = (v: FinancialCategory): FinancialSign =>
  v.endsWith('asset') ? 'debit-positive' : 'credit-positive';
const accountKey = (v: { account: string; dimensions: string }) =>
  JSON.stringify([v.account, v.dimensions]);
const sameMembers = (a: string[], b: string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  [...a].sort().join('\0') === [...b].sort().join('\0');
function scopeAndInput(input: FinancialInput) {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 4 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  const s = input.scope;
  if (
    !plain(s) ||
    !keys(s, [...FINANCIAL_SCOPE_FIELDS, 'confirmed']) ||
    s.confirmed !== true ||
    !FINANCIAL_SCOPE_FIELDS.every(
      (k) => typeof s[k] === 'string' && text(s[k]) === s[k],
    )
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (
    decimals === undefined ||
    s.currencyBasis !== 'functional' ||
    s.postingStatus !== 'posted' ||
    s.closingBasis !== 'post-closing' ||
    date(s.start) > date(s.end) ||
    date(s.asOf) !== s.end
  )
    fail('SCOPE');
  input.files.forEach((file) => {
    assertSourceFile(file);
    if (file.sheets.length !== 1) fail('SOURCE_SHEETS');
    if (
      file.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      fail('SOURCE');
  });
  if (new Set(input.files.map((f) => f.sha256)).size !== 4)
    fail('INDEPENDENT_SOURCES');
  input.readings.forEach((r, i) => {
    if (
      !plain(r) ||
      !keys(r, ['sheet', 'role', 'family', 'confirmed']) ||
      r.role !== FINANCIAL_ROLES[i] ||
      r.family !== FINANCIAL_VERSION ||
      r.confirmed !== true ||
      !Number.isSafeInteger(r.sheet) ||
      r.sheet !== 0 ||
      !input.files[i].sheets[r.sheet]
    )
      fail('READING');
  });
  if (
    input.files.reduce(
      (n, f) => n + Math.max(0, f.sheets[0].rows.length - 1),
      0,
    ) > MAX_ROWS
  )
    fail('ROWS');
  const c = input.completeness;
  if (
    !plain(c) ||
    !keys(c, ['confirmed', 'reference', 'note']) ||
    typeof c.confirmed !== 'boolean' ||
    typeof c.reference !== 'string' ||
    typeof c.note !== 'string'
  )
    fail('COMPLETENESS');
  if (c.confirmed) {
    text(c.reference);
    text(c.note, 2000, false);
  } else {
    if (c.reference) text(c.reference);
    if (c.note) text(c.note, 2000, false);
  }
  const scope: FinancialScope = {
    ...(Object.fromEntries(
      FINANCIAL_SCOPE_FIELDS.map((k) => [k, s[k]]),
    ) as Record<(typeof FINANCIAL_SCOPE_FIELDS)[number], string>),
    confirmed: true,
  };
  const readings = input.readings.map((r) => ({
    sheet: r.sheet,
    role: r.role,
    family: FINANCIAL_VERSION,
    confirmed: true,
  })) as FinancialInput['readings'];
  const completeness = {
    confirmed: c.confirmed,
    reference: c.reference,
    note: c.note,
  };
  return { decimals, scope, readings, completeness };
}
function headerBlocked(sheet: SheetData) {
  return (
    sheet.hiddenRows.includes(1) ||
    !!sheet.rowIssues?.['1']?.length ||
    !!sheet.xlsxHeaders?.hiddenColumns.length ||
    !!sheet.xlsxHeaders?.merges.length ||
    [sheet.cellIssues, sheet.referenceIssues].some((map) =>
      Object.entries(map ?? {}).some(
        ([key, value]) => key.startsWith('1:') && value.length,
      ),
    ) ||
    Object.keys(sheet.formulaCells ?? {}).some((key) => key.startsWith('1:'))
  );
}
export function reconcileFinancialPosition(
  input: FinancialInput,
): FinancialResult {
  const { scope, readings, completeness, decimals } = scopeAndInput(input);
  const context = JSON.stringify([
    FINANCIAL_VERSION,
    input.files.map((f) => f.sha256),
    readings,
    scope,
    completeness,
  ]);
  const accounts: FinancialAccount[] = [],
    mappings: FinancialMapping[] = [],
    evidence: FinancialEvidence[] = [],
    statements: FinancialStatement[] = [],
    inventory: FinancialInventory[] = [],
    cells: FinancialCell[] = [],
    issues: FinancialIssue[] = [],
    missing: FinancialResult['missing'] = [];
  const sources = input.files.map((f, i) => ({
    hash: f.sha256!,
    name: f.name,
    sheet: f.sheets[readings[i].sheet].name,
    role: readings[i].role,
  }));
  const inventoryById = new Map<string, FinancialInventory>();
  const issueKeys = new Set<string>(),
    missingKeys = new Set<string>();
  function issue(code: string, item: OriginalRow, key = '', related = '') {
    const signature = JSON.stringify([
      code,
      item.source,
      item.row,
      key,
      related,
    ]);
    if (!issueKeys.has(signature)) {
      issueKeys.add(signature);
      issues.push({ code, source: item.source, row: item.row, key, related });
    }
    const row = inventoryById.get(item.id);
    if (row) {
      row.kind = 'error';
      if (!row.errors.includes(code)) row.errors.push(code);
    }
  }
  for (let source = 0; source < 4; source++) {
    const file = input.files[source],
      reading = readings[source],
      sheet = file.sheets[reading.sheet],
      wanted = FINANCIAL_HEADERS[source],
      head = sheet.rows[0] ?? [];
    if (sheet.rows.length > MAX_ROWS + 1) fail('ROWS');
    const columns = Object.fromEntries(head.map((h, i) => [h, i]));
    const headerOK =
      sheet.rows.length > 0 &&
      head.length === wanted.length &&
      new Set(head).size === head.length &&
      wanted.every((h) => Object.hasOwn(columns, h)) &&
      !headerBlocked(sheet);
    const hiddenRows = new Set(sheet.hiddenRows);
    const unsafeRows = new Set(sheet.formulaRows);
    for (const [key] of Object.entries(sheet.formulaCells ?? {}))
      unsafeRows.add(Number(key.split(':')[0]));
    for (const [key, values] of Object.entries(sheet.cellIssues ?? {}))
      if (values.length) unsafeRows.add(Number(key.split(':')[0]));
    const numericFields =
      source === 0 ? ['Debit', 'Credit'] : source === 3 ? ['Amount'] : [];
    const dateFields = [
      'Period start',
      'Period end',
      'As of',
      ...(source === 2 ? ['Valid from', 'Valid to'] : []),
    ];
    const referenceColumns = wanted
      .filter((h) => ![...numericFields, ...dateFields].includes(h))
      .map((h) => columns[h] + 1);
    const rowIds: OriginalRow[] = [];
    for (const [index, original] of sheet.rows.entries()) {
      const row = index + 1,
        id = JSON.stringify([
          FINANCIAL_VERSION,
          source,
          file.sha256,
          reading.sheet,
          row,
        ]),
        base = { id, source, row },
        values = [...original];
      rowIds.push(base);
      inventory.push({
        ...base,
        kind:
          index === 0
            ? 'header'
            : values.some((v) => v.trim())
              ? 'record'
              : 'blank',
        values,
        errors: [],
      });
      inventoryById.set(id, inventory[inventory.length - 1]);
      values.forEach((value, column) =>
        cells.push({
          ...base,
          field: head[column] ?? `Column ${column + 1}`,
          column: column + 1,
          text: value,
        }),
      );
      if (!headerOK) {
        issue('COLUMNS', base);
        continue;
      }
      if (index === 0) continue;
      try {
        if (
          hiddenRows.has(row) ||
          sheet.rowIssues?.[String(row)]?.length ||
          unsafeRows.has(row)
        )
          fail('CELL');
        if (!values.some((v) => v.trim())) continue;
        if (values.length !== head.length) fail('COLUMNS');
        const get = (h: string) => values[columns[h]] ?? '';
        if (
          referenceColumns.some(
            (column) => sheet.referenceIssues?.[`${row}:${column}`]?.length,
          )
        )
          fail('CELL');
        for (const [i, k] of FINANCIAL_SCOPE_FIELDS.entries())
          if (get(FINANCIAL_SCOPE_HEADERS[i]) !== scope[k]) fail('ROW_SCOPE');
        if (source === 0) {
          const debit = amount(get('Debit'), decimals),
            credit = amount(get('Credit'), decimals);
          if (debit > 0 && credit > 0) fail('BOTH_SIDES');
          accounts.push({
            ...base,
            account: text(get('Account ID')),
            dimensions: text(get('Complete dimensions')),
            label: text(get('Account label'), 2000, false),
            category: category(get('Account class')),
            debit,
            credit,
            net: sum([debit, -credit]),
          });
        } else if (source === 1)
          mappings.push({
            ...base,
            mappingId: text(get('Mapping ID')),
            account: text(get('Account ID')),
            dimensions: text(get('Complete dimensions')),
            lineId: text(get('Line ID')),
            sign: sign(get('Sign')),
            evidenceId: text(get('Evidence ID')),
          });
        else if (source === 2) {
          const validFrom = date(get('Valid from')),
            validTo = date(get('Valid to'));
          if (
            validFrom > scope.start ||
            validTo < scope.end ||
            validFrom > validTo
          )
            fail('VALIDITY');
          evidence.push({
            ...base,
            evidenceId: text(get('Evidence ID')),
            account: text(get('Account ID')),
            dimensions: text(get('Complete dimensions')),
            accountClass: category(get('Account class')),
            lineId: text(get('Line ID')),
            label: text(get('Line label'), 2000, false),
            category: category(get('Line class')),
            sign: sign(get('Sign')),
            validFrom,
            validTo,
            reference: text(get('Evidence reference')),
          });
        } else
          statements.push({
            ...base,
            lineId: text(get('Line ID')),
            label: text(get('Line label'), 2000, false),
            category: category(get('Line class')),
            amount: amount(get('Amount'), decimals, true),
          });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('TB_FIN_'))
          throw error;
        issue(error.message.slice(7), base);
      }
    }
    if (!headerOK && !sheet.rows.length)
      issues.push({ code: 'COLUMNS', source, row: 1, key: '', related: '' });
    // Count original contenders, including malformed rows, before any parsed map can choose a winner.
    if (headerOK) {
      const signatures =
        source === 0
          ? [['Account ID', 'Complete dimensions']]
          : source === 1
            ? [['Mapping ID'], ['Account ID', 'Complete dimensions']]
            : source === 2
              ? [['Evidence ID'], ['Account ID', 'Complete dimensions']]
              : [['Line ID']];
      for (const fields of signatures) {
        const groups = new Map<string, OriginalRow[]>();
        for (const [i, values] of sheet.rows.entries()) {
          if (!i || !values.some((v) => v.trim())) continue;
          const raw = fields.map((h) => values[columns[h]] ?? '');
          if (!raw.every((v) => v && v === v.trim())) continue;
          const key = JSON.stringify(raw);
          const group = groups.get(key);
          if (group) group.push(rowIds[i]);
          else groups.set(key, [rowIds[i]]);
        }
        for (const [key, rows] of groups)
          if (rows.length > 1)
            for (const row of rows)
              issue('DUPLICATE', row, key, fields.join('|'));
      }
    }
  }
  function unique<T>(rows: T[], key: (v: T) => string) {
    const map = new Map<string, T>();
    const counts = new Map<string, number>();
    for (const value of rows) {
      const k = key(value);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const value of rows) {
      const k = key(value);
      if (counts.get(k) === 1) map.set(k, value);
    }
    return map;
  }
  const accountMap = unique(accounts, accountKey),
    mappingMap = unique(mappings, accountKey),
    proofMap = unique(evidence, (v) => v.evidenceId),
    proofAccounts = unique(evidence, accountKey),
    statementMap = unique(statements, (v) => v.lineId);
  const absent = (kind: string, key: string) => {
    const signature = JSON.stringify([kind, key]);
    if (!missingKeys.has(signature)) {
      missingKeys.add(signature);
      missing.push({ kind, key });
    }
  };
  if (!accounts.length) absent('trial-balance', 'all');
  if (!statements.length) absent('financial-position', 'all');
  for (const account of accounts) {
    const key = accountKey(account);
    if (!mappingMap.has(key)) absent('mapping', key);
    if (!proofAccounts.has(key)) absent('evidence', key);
  }
  for (const proof of evidence) {
    const key = accountKey(proof),
      account = accountMap.get(key),
      line = statementMap.get(proof.lineId);
    if (!account) issue('UNKNOWN_ACCOUNT', proof, key);
    else if (
      proof.accountClass !== account.category ||
      proof.accountClass !== proof.category
    )
      issue('CLASSIFICATION', proof, key);
    if (proof.sign !== expectedSign(proof.category))
      issue('SIGN_POLICY', proof, key);
    if (!line) absent('statement-line', proof.lineId);
    else if (line.category !== proof.category || line.label !== proof.label)
      issue('PRESENTATION', proof, proof.lineId);
  }
  for (const mapping of mappings) {
    const key = accountKey(mapping),
      account = accountMap.get(key),
      proof = proofMap.get(mapping.evidenceId);
    if (!account) issue('UNKNOWN_ACCOUNT', mapping, key);
    if (!proof) {
      if (proofAccounts.has(key))
        issue('WRONG_EVIDENCE', mapping, key, mapping.evidenceId);
      else absent('evidence-id', mapping.evidenceId);
    } else {
      if (accountKey(proof) !== key)
        issue('WRONG_EVIDENCE', mapping, key, mapping.evidenceId);
      if (mapping.lineId !== proof.lineId)
        issue('WRONG_LINE', mapping, key, proof.lineId);
      if (mapping.sign !== proof.sign)
        issue('WRONG_SIGN', mapping, key, proof.sign);
    }
    if (!statementMap.has(mapping.lineId))
      absent('statement-line', mapping.lineId);
  }
  const mappingsByLine = new Map<string, FinancialMapping[]>();
  for (const mapping of mappings) {
    const group = mappingsByLine.get(mapping.lineId);
    if (group) group.push(mapping);
    else mappingsByLine.set(mapping.lineId, [mapping]);
  }
  for (const line of statements)
    if (!mappingsByLine.has(line.lineId)) absent('line-accounts', line.lineId);
  const sourceValid = issues.length === 0,
    covered = missing.length === 0;
  let tb: FinancialResult['tb'] = null;
  if (accounts.length && !issues.some((e) => e.source === 0)) {
    const debit = sum(accounts.map((a) => a.debit)),
      credit = sum(accounts.map((a) => a.credit));
    tb = { debit, credit, residual: sum([debit, -credit]) };
  }
  const usable = sourceValid && covered;
  const lines: FinancialLine[] = statements.map((line) => {
    const members: FinancialMember[] = [];
    for (const mapping of mappingsByLine.get(line.lineId) ?? []) {
      const account = accountMap.get(accountKey(mapping)),
        proof = proofMap.get(mapping.evidenceId);
      if (account && proof)
        members.push({
          mappingId: mapping.mappingId,
          accountRecord: account.id,
          mappingRecord: mapping.id,
          evidenceRecord: proof.id,
          account: account.account,
          dimensions: account.dimensions,
          evidenceId: proof.evidenceId,
          debit: account.debit,
          credit: account.credit,
          net: account.net,
          contribution: usable
            ? sum([
                mapping.sign === 'debit-positive' ? account.net : -account.net,
              ])
            : null,
        });
    }
    const calculated = usable ? sum(members.map((m) => m.contribution!)) : null;
    return {
      ...line,
      members,
      calculated,
      reported: line.amount,
      difference: calculated === null ? null : sum([calculated, -line.amount]),
      review: usable ? 'needs-review' : 'blocked',
    };
  });
  let totals: FinancialResult['totals'] = null,
    grandTotals: FinancialResult['grandTotals'] = null;
  if (usable) {
    const grouped = (basis: 'calculated' | 'reported') =>
      Object.fromEntries(
        FINANCIAL_CATEGORIES.map((c) => [
          c,
          sum(lines.filter((l) => l.category === c).map((l) => l[basis]!)),
        ]),
      ) as CategoryTotals;
    const grand = (v: CategoryTotals): GrandTotals => {
      const assets = sum([v['current-asset'], v['noncurrent-asset']]),
        liabilities = sum([v['current-liability'], v['noncurrent-liability']]),
        equity = v.equity;
      return {
        assets,
        liabilities,
        equity,
        equation: sum([assets, -liabilities, -equity]),
      };
    };
    totals = {
      calculated: grouped('calculated'),
      reported: grouped('reported'),
    };
    grandTotals = {
      calculated: grand(totals.calculated),
      reported: grand(totals.reported),
    };
  }
  const financialReady =
    usable &&
    tb?.residual === 0 &&
    grandTotals?.calculated.equation === 0 &&
    grandTotals.reported.equation === 0 &&
    lines.every((l) => l.difference === 0);
  const events: FinancialEvent[] = [];
  const seen = new Set<string>();
  for (const event of input.events) {
    if (
      !plain(event) ||
      !keys(event, [
        'id',
        'type',
        'context',
        'lineId',
        'mappingIds',
        'at',
        'reference',
        'note',
      ]) ||
      !['accept', 'reject', 'undo'].includes(event.type) ||
      !Array.isArray(event.mappingIds) ||
      !event.mappingIds.length ||
      event.mappingIds.some((v) => typeof v !== 'string') ||
      typeof event.context !== 'string' ||
      typeof event.at !== 'string'
    )
      fail('EVENT');
    text(event.id);
    text(event.lineId);
    try {
      text(event.reference);
      text(event.note, 2000, false);
    } catch {
      fail('EVENT_EVIDENCE');
    }
    event.mappingIds.forEach((v) => text(v));
    if (seen.has(event.id)) fail('EVENT_ID');
    seen.add(event.id);
    if (event.context !== context) fail('EVENT_CONTEXT');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      new Date(event.at).toISOString() !== event.at
    )
      fail('EVENT_DATE');
    if (!usable) fail('EVENT_SOURCE');
    const line = lines.find((l) => l.lineId === event.lineId);
    if (!line) fail('EVENT_LINE');
    if (
      !sameMembers(
        event.mappingIds,
        line.members.map((m) => m.mappingId),
      )
    )
      fail('EVENT_MEMBERS');
    if (event.type === 'undo') {
      if (line.review !== 'accepted' && line.review !== 'rejected')
        fail('EVENT_STATE');
      line.review = 'needs-review';
    } else {
      if (line.review !== 'needs-review') fail('EVENT_STATE');
      if (
        event.type === 'accept' &&
        (!financialReady || !completeness.confirmed)
      )
        fail('EVENT_FINANCIAL');
      line.review = event.type === 'accept' ? 'accepted' : 'rejected';
    }
    events.push({ ...event, mappingIds: [...event.mappingIds] });
  }
  const status: FinancialResult['status'] = !sourceValid
    ? 'source-error'
    : !covered
      ? 'missing'
      : tb?.residual !== 0 ||
          grandTotals?.calculated.equation !== 0 ||
          grandTotals.reported.equation !== 0
        ? 'inconsistent'
        : lines.some((l) => l.difference !== 0)
          ? 'difference'
          : !completeness.confirmed ||
              lines.some((l) => l.review !== 'accepted')
            ? 'needs-review'
            : 'consistent-with-evidence';
  return {
    version: FINANCIAL_VERSION,
    claim: FINANCIAL_CLAIM,
    context,
    scope,
    readings,
    completeness,
    decimals,
    sources,
    accounts,
    mappings,
    evidence,
    statements,
    inventory,
    cells,
    issues,
    missing,
    lines,
    tb,
    totals,
    grandTotals,
    events,
    status,
  };
}
