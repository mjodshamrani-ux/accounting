import { latinDigits, parseDate, parseMoney } from './core.ts';
import { assertSourceFile } from './protocol.ts';
import {
  reconcileBank,
  BANK_SCOPE_FIELDS,
  type BankInput,
  type BankResult,
} from './bank.ts';
import type { SourceFile } from './types.ts';
export const BANK_BALANCE_VERSION = 'bank-balance-evidence-1';
export const BANK_BALANCE_HEADERS = [
  'Record ID',
  'Balance kind',
  'As of',
  'Entity',
  'Ledger',
  'Bank account',
  'Currency',
  'Period start',
  'Period end',
  'Balance basis',
  'Status',
  'Amount',
];
export const BANK_BALANCE_ROLES = [
  'bank-balances',
  'cashbook-balances',
] as const;
export type BankBalanceReading = {
  sheet: number;
  role: (typeof BANK_BALANCE_ROLES)[number];
  family: typeof BANK_BALANCE_VERSION;
  perspective: 'company-cash';
  confirmed: boolean;
};
export type BankBalanceCoverage = {
  basis: 'movement-date';
  boundary: 'end-of-day';
  openingAsOf: string;
  closingAsOf: string;
  confirmed: boolean;
};
export type BankBalanceInput = {
  bank: BankInput;
  files: [SourceFile, SourceFile];
  readings: [BankBalanceReading, BankBalanceReading];
  coverage: BankBalanceCoverage;
};
export type BankBalanceRecord = {
  id: string;
  side: 0 | 1;
  row: number;
  reference: string;
  kind: 'opening' | 'closing';
  asOf: string;
  amount: number;
  cells: { field: string; column: number; text: string }[];
};
export type BankBalanceInventory = {
  id: string;
  side: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | 'error' | 'opening' | 'closing';
  values: string[];
  error?: string;
};
export type BankBalanceComponent = {
  side: 0 | 1;
  opening: number | null;
  closing: number | null;
  movement: number | null;
  residual: number | null;
  openingIds: string[];
  closingIds: string[];
  movementIds: string[];
};
export type BankBalanceResult = {
  version: typeof BANK_BALANCE_VERSION;
  context: string;
  scope: BankResult['scope'];
  coverage: BankBalanceCoverage;
  readings: BankBalanceInput['readings'];
  decimals: number;
  sources: { name: string; hash: string; sheet: string }[];
  bank: BankResult;
  records: BankBalanceRecord[];
  inventory: BankBalanceInventory[];
  components: [BankBalanceComponent, BankBalanceComponent];
  differences: { opening: number | null; closing: number | null };
  missing: { side: 0 | 1; kind: 'opening' | 'closing' }[];
  status: 'source-error' | 'missing' | 'inconsistent' | 'balances-consistent';
  claim: typeof BANK_BALANCE_CLAIM;
};
export const BANK_BALANCE_CLAIM =
  'Balance movement evidence only; no reconciliation-item ledger, bank closure, ERP posting, source authenticity or completeness assurance';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function fail(code: string): never {
  throw new Error(`BALANCE_${code}`);
}
function identity(v: string) {
  if (
    !v ||
    v !== v.trim() ||
    v.length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    /^[=+@-]|^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(v)
  )
    fail('IDENTITY');
  return v;
}
function iso(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDate(v, 'ymd') === v;
}
function money(v: string, decimals: number) {
  const s = latinDigits(v.trim()).replace(/٫/g, '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) fail('AMOUNT');
  try {
    return parseMoney(s, 'dot', decimals);
  } catch {
    return fail('AMOUNT');
  }
}
function sum(values: number[]) {
  let result = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || Math.abs(value) > 1e14) fail('SUM');
    result += BigInt(value);
  }
  if (result > 100000000000000n || result < -100000000000000n) fail('SUM');
  return Number(result);
}
export function bankBalanceOpeningDate(start: string) {
  if (!iso(start)) fail('COVERAGE');
  const d = new Date(`${start}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function reconcileBankBalances(
  input: BankBalanceInput,
): BankBalanceResult {
  if (
    !plain(input) ||
    !keys(input, ['bank', 'files', 'readings', 'coverage']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2
  )
    fail('INPUT');
  const bank = reconcileBank(input.bank),
    coverage = input.coverage;
  if (
    !plain(coverage) ||
    !keys(coverage, [
      'basis',
      'boundary',
      'openingAsOf',
      'closingAsOf',
      'confirmed',
    ]) ||
    coverage.confirmed !== true ||
    coverage.basis !== 'movement-date' ||
    coverage.boundary !== 'end-of-day' ||
    coverage.openingAsOf !== bankBalanceOpeningDate(bank.scope.start) ||
    coverage.closingAsOf !== bank.scope.end
  )
    fail('COVERAGE');
  const records: BankBalanceRecord[] = [],
    inventory: BankBalanceInventory[] = [];
  for (const side of [0, 1] as const) {
    const file = input.files[side],
      reading = input.readings[side];
    assertSourceFile(file);
    if (
      file.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      fail('SOURCE');
    if (
      !plain(reading) ||
      !keys(reading, ['sheet', 'role', 'family', 'perspective', 'confirmed']) ||
      reading.family !== BANK_BALANCE_VERSION ||
      reading.role !== BANK_BALANCE_ROLES[side] ||
      reading.perspective !== 'company-cash' ||
      reading.confirmed !== true ||
      !Number.isSafeInteger(reading.sheet) ||
      reading.sheet < 0
    )
      fail('READING');
    const sheet = file.sheets[reading.sheet];
    if (
      !sheet?.rows.length ||
      sheet.hiddenRows.includes(1) ||
      sheet.rowIssues?.['1']?.length ||
      sheet.xlsxHeaders?.hiddenColumns.length ||
      sheet.xlsxHeaders?.merges.length ||
      [sheet.cellIssues, sheet.referenceIssues].some((m) =>
        Object.entries(m ?? {}).some(
          ([k, v]) => k.startsWith('1:') && v.length,
        ),
      ) ||
      Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'))
    )
      fail('COLUMNS');
    const head = sheet.rows[0].map((v) => v.trim());
    if (
      head.length !== BANK_BALANCE_HEADERS.length ||
      new Set(head).size !== head.length ||
      BANK_BALANCE_HEADERS.some((h) => !head.includes(h))
    )
      fail('COLUMNS');
    const columns = Object.fromEntries(
      BANK_BALANCE_HEADERS.map((h) => [h, head.indexOf(h)]),
    );
    const identityColumns = BANK_BALANCE_HEADERS.filter(
      (h) => !['Amount', 'As of', 'Period start', 'Period end'].includes(h),
    ).map((h) => columns[h]);
    const local: BankBalanceRecord[] = [];
    for (const [index, raw] of sheet.rows.entries()) {
      const row = index + 1,
        values = [...raw],
        id = JSON.stringify([
          BANK_BALANCE_VERSION,
          side,
          file.sha256,
          reading.sheet,
          row,
        ]);
      if (!index) {
        inventory.push({ id, side, row, kind: 'header', values });
        continue;
      }
      try {
        if (
          sheet.hiddenRows.includes(row) ||
          sheet.rowIssues?.[String(row)]?.length ||
          Object.values(columns).some(
            (c) =>
              sheet.formulaCells?.[`${row}:${c + 1}`] ||
              sheet.cellIssues?.[`${row}:${c + 1}`]?.length,
          ) ||
          identityColumns.some(
            (c) => sheet.referenceIssues?.[`${row}:${c + 1}`]?.length,
          )
        )
          fail('CELL');
        if (!values.some((v) => v.trim())) {
          inventory.push({ id, side, row, kind: 'blank', values });
          continue;
        }
        if (values.slice(BANK_BALANCE_HEADERS.length).some((v) => v.trim()))
          fail('COLUMNS');
        const get = (h: string) => (values[columns[h]] ?? '').trim(),
          kind = get('Balance kind'),
          asOf = get('As of'),
          reference = identity(get('Record ID'));
        for (const [i, h] of [
          'Entity',
          'Ledger',
          'Bank account',
          'Currency',
          'Period start',
          'Period end',
        ].entries())
          if (get(h) !== bank.scope[BANK_SCOPE_FIELDS[i]]) fail('ROW_SCOPE');
        if (kind !== 'opening' && kind !== 'closing') fail('KIND');
        if (
          !iso(asOf) ||
          asOf !== coverage[kind === 'opening' ? 'openingAsOf' : 'closingAsOf']
        )
          fail('DATE');
        if (get('Balance basis') !== coverage.basis) fail('BASIS');
        if (get('Status') !== (side ? 'posted' : 'booked')) fail('STATUS');
        const amount = money(get('Amount'), bank.decimals);
        local.push({
          id,
          side,
          row,
          reference,
          kind,
          asOf,
          amount,
          cells: BANK_BALANCE_HEADERS.map((field) => ({
            field,
            column: columns[field] + 1,
            text: values[columns[field]] ?? '',
          })),
        });
        inventory.push({ id, side, row, kind, values });
      } catch (error) {
        inventory.push({
          id,
          side,
          row,
          kind: 'error',
          values,
          error: error instanceof Error ? error.message : 'BALANCE_ROW',
        });
      }
    }
    const ids = new Map<string, number>(),
      kinds = new Map<string, number>();
    for (const item of inventory.filter((i) => i.side === side && i.row > 1)) {
      for (const [field, map] of [
        ['Record ID', ids],
        ['Balance kind', kinds],
      ] as const) {
        const claim = (item.values[columns[field]] ?? '').trim();
        if (claim) map.set(claim, (map.get(claim) ?? 0) + 1);
      }
    }
    for (const record of local) {
      const duplicateId = (ids.get(record.reference) ?? 0) > 1,
        duplicateKind = (kinds.get(record.kind) ?? 0) > 1;
      if (duplicateId || duplicateKind) {
        const item = inventory.find((i) => i.id === record.id)!;
        item.kind = 'error';
        item.error = duplicateId
          ? 'BALANCE_DUPLICATE_ID'
          : 'BALANCE_DUPLICATE_KIND';
      } else records.push(record);
    }
  }
  const sourceError =
      bank.status === 'source-error' ||
      inventory.some((i) => i.kind === 'error'),
    missing: BankBalanceResult['missing'] = [];
  const components = ([0, 1] as const).map((side) => {
    const opening = records.filter(
        (r) => r.side === side && r.kind === 'opening',
      ),
      closing = records.filter((r) => r.side === side && r.kind === 'closing'),
      movements = bank.records.filter((r) => r.side === side);
    if (!opening.length) missing.push({ side, kind: 'opening' });
    if (!closing.length) missing.push({ side, kind: 'closing' });
    const o = !sourceError && opening.length === 1 ? opening[0].amount : null,
      c = !sourceError && closing.length === 1 ? closing[0].amount : null,
      m = !sourceError ? sum(movements.map((r) => r.signed)) : null;
    return {
      side,
      opening: o,
      closing: c,
      movement: m,
      residual: o !== null && c !== null && m !== null ? sum([o, m, -c]) : null,
      openingIds: opening.map((r) => r.id),
      closingIds: closing.map((r) => r.id),
      movementIds: movements.map((r) => r.id),
    };
  }) as BankBalanceResult['components'];
  const difference = (kind: 'opening' | 'closing') => {
      const a = components[0][kind],
        b = components[1][kind];
      return a !== null && b !== null ? sum([a, -b]) : null;
    },
    differences = {
      opening: difference('opening'),
      closing: difference('closing'),
    };
  const status = sourceError
    ? 'source-error'
    : missing.length
      ? 'missing'
      : components.some((c) => c.residual !== 0) ||
          Object.values(differences).some((v) => v !== 0)
        ? 'inconsistent'
        : 'balances-consistent';
  return {
    version: BANK_BALANCE_VERSION,
    context: JSON.stringify([
      BANK_BALANCE_VERSION,
      bank.context,
      input.files.map((f) => f.sha256),
      input.readings,
      coverage,
    ]),
    scope: { ...bank.scope },
    coverage: { ...coverage },
    readings: structuredClone(input.readings),
    decimals: bank.decimals,
    sources: input.files.map((f, s) => ({
      name: f.name,
      hash: f.sha256!,
      sheet: f.sheets[input.readings[s].sheet].name,
    })),
    bank,
    records,
    inventory,
    components,
    differences,
    missing,
    status,
    claim: BANK_BALANCE_CLAIM,
  };
}
