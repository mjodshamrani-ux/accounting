import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import type { SourceFile, SheetData } from './types.ts';

export const GL_TB_VERSION = 'gl-tb-canonical-1';
export const BALANCE_FIELDS = [
  'openingDebit',
  'openingCredit',
  'periodDebit',
  'periodCredit',
  'closingDebit',
  'closingCredit',
] as const;
export type BalanceField = (typeof BALANCE_FIELDS)[number];
export type BalanceAmounts = Record<BalanceField, number>;
export const GL_SCOPE_FIELDS = [
  'entity',
  'ledger',
  'account',
  'dimensions',
  'currency',
  'currencyBasis',
  'postingStatus',
  'postingLayer',
  'start',
  'end',
] as const;
export type GlScopeField = (typeof GL_SCOPE_FIELDS)[number];
export type GlTbScope = Record<GlScopeField, string> & { confirmed: boolean };
export type GlTbReading = {
  sheet: number;
  role: 'gl-detail' | 'trial-balance';
  family: typeof GL_TB_VERSION;
  confirmed: boolean;
};
export type GlTbInput = {
  files: [SourceFile, SourceFile];
  readings: [GlTbReading, GlTbReading];
  scope: GlTbScope;
};
export type GlTrace = {
  field: string;
  column: number;
  text: string;
  amount: number;
};
export type GlRecord = {
  id: string;
  side: 0 | 1;
  row: number;
  record: string;
  kind: 'opening' | 'movement' | 'closing' | 'balance';
  date: string;
  amounts: number[];
  trace: GlTrace[];
};
export type GlInventory = {
  side: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | GlRecord['kind'] | 'error';
  values: string[];
  error?: string;
};
export type GlReadSource = {
  rows: GlRecord[];
  inventory: GlInventory[];
  columns: Record<string, number>;
};
export type GlTbResult = {
  version: typeof GL_TB_VERSION;
  context: string;
  scope: GlTbScope;
  readings: [GlTbReading, GlTbReading];
  decimals: number;
  sources: {
    hash: string;
    name: string;
    sheet: string;
    role: GlTbReading['role'];
  }[];
  status:
    | 'consistent'
    | 'difference'
    | 'inconsistent'
    | 'missing'
    | 'source-error';
  rows: GlRecord[];
  inventory: GlInventory[];
  missing: ('gl-opening' | 'gl-closing' | 'tb-balance')[];
  gl: BalanceAmounts | null;
  tb: BalanceAmounts | null;
  glBridge: number | null;
  tbBridge: number | null;
  differences: BalanceAmounts | null;
  // A component owns the exact original cells that contributed to it.
  components: {
    side: 0 | 1;
    field: BalanceField;
    amount: number;
    cells: { id: string; column: number }[];
  }[];
};
const scopeHeaders = [
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
];
export const GL_HEADERS = [
  'Record ID',
  'Record kind',
  'Posting date',
  ...scopeHeaders,
  'Debit',
  'Credit',
];
export const TB_HEADERS = [
  'Snapshot ID',
  ...scopeHeaders,
  'Opening debit',
  'Opening credit',
  'Period debit',
  'Period credit',
  'Closing debit',
  'Closing credit',
];
const roles = ['gl-detail', 'trial-balance'] as const;
function fail(code: string): never {
  throw new Error(`GL_TB_${code}`);
}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: readonly string[]) =>
  Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function identity(v: string) {
  const s = v.trim();
  if (
    !s ||
    s.length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(s) ||
    /^[=+@-]/.test(s) ||
    /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(s)
  )
    fail('IDENTITY');
  return s;
}
function date(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || parseDate(v, 'ymd') !== v) fail('DATE');
  return v;
}
function validateScope(scope: GlTbScope) {
  if (
    !plain(scope) ||
    !keys(scope, [...GL_SCOPE_FIELDS, 'confirmed']) ||
    scope.confirmed !== true ||
    !GL_SCOPE_FIELDS.every(
      (k) => typeof scope[k] === 'string' && identity(scope[k]) === scope[k],
    )
  )
    fail('SCOPE');
  const decimals = currencyPrecision(scope.currency);
  if (
    decimals === undefined ||
    scope.currencyBasis !== 'functional' ||
    scope.postingStatus !== 'posted' ||
    date(scope.start) > date(scope.end)
  )
    fail('SCOPE');
  return decimals;
}
function amount(raw: string, decimals: number) {
  const v = latinDigits(raw.trim()).replace(/٫/g, '.');
  if (!/^\d+(?:\.\d+)?$/.test(v)) fail('AMOUNT');
  const n = parseMoney(v, 'dot', decimals);
  if (n === undefined || !Number.isSafeInteger(n) || n < 0) fail('AMOUNT');
  return n;
}
function badHeader(sheet: SheetData) {
  return (
    sheet.hiddenRows.includes(1) ||
    sheet.rowIssues?.['1']?.length ||
    sheet.xlsxHeaders?.hiddenColumns.length ||
    sheet.xlsxHeaders?.merges.length ||
    [sheet.cellIssues, sheet.referenceIssues].some((m) =>
      Object.entries(m ?? {}).some(
        ([k, v]) => k.startsWith('1:') && v.length > 0,
      ),
    ) ||
    Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'))
  );
}
function readSource(
  file: SourceFile,
  reading: GlTbReading,
  scope: GlTbScope,
  side: 0 | 1,
): GlReadSource {
  const decimals = validateScope(scope);
  if (
    !plain(file) ||
    file.kind !== undefined ||
    !/\.(csv|xlsx)$/i.test(file.name ?? '') ||
    !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
  )
    fail('SOURCE');
  assertSourceFile(file);
  if (
    !plain(reading) ||
    !keys(reading, ['sheet', 'role', 'family', 'confirmed']) ||
    reading.family !== GL_TB_VERSION ||
    reading.role !== roles[side] ||
    reading.confirmed !== true ||
    !Number.isSafeInteger(reading.sheet) ||
    reading.sheet < 0
  )
    fail('READING');
  const sheet = file.sheets[reading.sheet],
    headers = side === 0 ? GL_HEADERS : TB_HEADERS;
  if (!sheet || !sheet.rows.length || badHeader(sheet)) fail('COLUMNS');
  const header = sheet.rows[0].map((v) => v.trim());
  if (
    header.length !== headers.length ||
    new Set(header).size !== header.length ||
    headers.some((h) => !header.includes(h))
  )
    fail('COLUMNS');
  const columns = Object.fromEntries(
    headers.map((h) => [h, header.indexOf(h)]),
  );
  const referenceColumns = [
    side === 0 ? 'Record ID' : 'Snapshot ID',
    ...scopeHeaders.slice(0, 8),
  ].map((h) => columns[h]);
  const rows: GlRecord[] = [],
    inventory: GlInventory[] = [],
    hidden = new Set(sheet.hiddenRows);
  for (const [index, original] of sheet.rows.entries()) {
    const row = index + 1,
      values = [...original];
    if (!index) {
      inventory.push({ side, row, kind: 'header', values });
      continue;
    }
    try {
      if (
        hidden.has(row) ||
        sheet.rowIssues?.[String(row)]?.length ||
        Object.values(columns).some(
          (c) =>
            sheet.formulaCells?.[`${row}:${c + 1}`] ||
            sheet.cellIssues?.[`${row}:${c + 1}`]?.length,
        ) ||
        referenceColumns.some(
          (c) => sheet.referenceIssues?.[`${row}:${c + 1}`]?.length,
        )
      )
        fail('CELL');
      if (!values.some((v) => v.trim())) {
        inventory.push({ side, row, kind: 'blank', values });
        continue;
      }
      if (
        values.length > headers.length &&
        values.slice(headers.length).some((v) => v.trim())
      )
        fail('COLUMNS');
      const get = (h: string) => (values[columns[h]] ?? '').trim();
      for (const [i, k] of GL_SCOPE_FIELDS.entries())
        if (get(scopeHeaders[i]) !== scope[k]) fail('ROW_SCOPE');
      const record = identity(get(side === 0 ? 'Record ID' : 'Snapshot ID'));
      let kind: GlRecord['kind'] = 'balance',
        postingDate = '';
      if (side === 0) {
        const rawKind = get('Record kind');
        if (!['opening', 'movement', 'closing'].includes(rawKind)) fail('KIND');
        kind = rawKind as GlRecord['kind'];
        postingDate = date(get('Posting date'));
        if (
          postingDate < scope.start ||
          postingDate > scope.end ||
          (kind === 'opening' && postingDate !== scope.start) ||
          (kind === 'closing' && postingDate !== scope.end)
        )
          fail('DATE');
      }
      const moneyHeaders =
        side === 0 ? ['Debit', 'Credit'] : TB_HEADERS.slice(-6);
      const trace = moneyHeaders.map((h) => ({
        field: h,
        column: columns[h] + 1,
        text: values[columns[h]] ?? '',
        amount: amount(get(h), decimals),
      }));
      const item: GlRecord = {
        id: `${side}:${file.sha256}:${reading.sheet}:${row}`,
        side,
        row,
        record,
        kind,
        date: postingDate,
        amounts: trace.map((t) => t.amount),
        trace,
      };
      rows.push(item);
      inventory.push({ side, row, kind, values });
    } catch (e) {
      inventory.push({
        side,
        row,
        kind: 'error',
        values,
        error: e instanceof Error ? e.message : 'GL_TB_ROW',
      });
    }
  }
  // Purge every occurrence of a repeated record ID or balance role, without selecting a winner.
  const counts = new Map<string, number>(),
    kinds = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.record, (counts.get(r.record) ?? 0) + 1);
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  }
  const invalid = new Set(
    rows
      .filter(
        (r) =>
          counts.get(r.record)! > 1 ||
          (r.kind !== 'movement' && kinds.get(r.kind)! > 1),
      )
      .map((r) => r.row),
  );
  for (const entry of inventory)
    if (invalid.has(entry.row)) {
      entry.kind = 'error';
      entry.error = 'GL_TB_DUPLICATE';
    }
  return { rows: rows.filter((r) => !invalid.has(r.row)), inventory, columns };
}
export function readGlDetail(
  file: SourceFile,
  reading: GlTbReading,
  scope: GlTbScope,
) {
  return readSource(file, reading, scope, 0);
}
/** Balance-source rows retain all six balance cells; they are never Transaction objects. */
export function readBalanceSource(
  file: SourceFile,
  reading: GlTbReading,
  scope: GlTbScope,
) {
  return readSource(file, reading, scope, 1);
}
function bridge(a: BalanceAmounts) {
  return safeSum([
    a.closingDebit,
    -a.closingCredit,
    -a.openingDebit,
    a.openingCredit,
    -a.periodDebit,
    a.periodCredit,
  ]);
}
export function reconcileGlTb(input: GlTbInput): GlTbResult {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2
  )
    fail('INPUT');
  const decimals = validateScope(input.scope),
    [left, right] = [
      readGlDetail(input.files[0], input.readings[0], input.scope),
      readBalanceSource(input.files[1], input.readings[1], input.scope),
    ];
  if (input.files[0].sha256 === input.files[1].sha256) fail('SAME_SOURCE');
  const rows = [...left.rows, ...right.rows],
    inventory = [...left.inventory, ...right.inventory];
  const opening = left.rows.find((r) => r.kind === 'opening'),
    closing = left.rows.find((r) => r.kind === 'closing'),
    balance = right.rows.find((r) => r.kind === 'balance'),
    movements = left.rows.filter((r) => r.kind === 'movement');
  const missing: GlTbResult['missing'] = [];
  if (!opening) missing.push('gl-opening');
  if (!closing) missing.push('gl-closing');
  if (!balance) missing.push('tb-balance');
  const components: GlTbResult['components'] = [];
  const gl =
    opening && closing
      ? (Object.fromEntries(
          BALANCE_FIELDS.map((field, i) => {
            const group = i < 2 ? [opening] : i < 4 ? movements : [closing];
            const debitCredit = i % 2,
              total = safeSum(group.map((r) => r.amounts[debitCredit]));
            components.push({
              side: 0,
              field,
              amount: total,
              cells: group.map((r) => ({
                id: r.id,
                column: r.trace[debitCredit].column,
              })),
            });
            return [field, total];
          }),
        ) as BalanceAmounts)
      : null;
  const tb = balance
    ? (Object.fromEntries(
        BALANCE_FIELDS.map((field, i) => {
          components.push({
            side: 1,
            field,
            amount: balance.amounts[i],
            cells: [{ id: balance.id, column: balance.trace[i].column }],
          });
          return [field, balance.amounts[i]];
        }),
      ) as BalanceAmounts)
    : null;
  const glBridge = gl ? bridge(gl) : null,
    tbBridge = tb ? bridge(tb) : null;
  const differences =
    gl && tb
      ? (Object.fromEntries(
          BALANCE_FIELDS.map((f) => [f, safeSum([gl[f], -tb[f]])]),
        ) as BalanceAmounts)
      : null;
  const status: GlTbResult['status'] = inventory.some((i) => i.kind === 'error')
    ? 'source-error'
    : missing.length
      ? 'missing'
      : glBridge !== 0 || tbBridge !== 0
        ? 'inconsistent'
        : differences && BALANCE_FIELDS.some((f) => differences[f] !== 0)
          ? 'difference'
          : 'consistent';
  return {
    version: GL_TB_VERSION,
    context: JSON.stringify([
      GL_TB_VERSION,
      input.files.map((f) => f.sha256),
      input.readings.map((r) => [r.sheet, r.role, r.family, r.confirmed]),
      GL_SCOPE_FIELDS.map((k) => input.scope[k]),
      input.scope.confirmed,
    ]),
    scope: { ...input.scope },
    readings: input.readings.map((r) => ({ ...r })) as GlTbInput['readings'],
    decimals,
    sources: input.files.map((f, i) => ({
      hash: f.sha256!,
      name: f.name,
      sheet: f.sheets[input.readings[i].sheet].name,
      role: roles[i],
    })),
    status,
    rows,
    inventory,
    missing,
    gl,
    tb,
    glBridge,
    tbBridge,
    differences,
    components,
  };
}
