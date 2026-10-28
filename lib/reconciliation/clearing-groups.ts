import { latinDigits, parseDate, safeSum } from './core.ts';
import {
  amount,
  cleanId,
  validate,
  type ClearingReading,
  type ClearingScope,
} from './clearing.ts';
import { summaryLabel } from './row-labels.ts';
import type { SourceFile } from './types.ts';

/** clearing-groups-1: the groups of one clearing account extract, read as
 * clearing-1 reads it, where a faulty line holds only the groups it can touch
 * when its reading proves what it can touch. Review only: no decision, and
 * clearing-1 with its decisions is unchanged. */
export const CLEARING_GROUPS_VERSION = 'clearing-groups-1';
export const CLEARING_GROUP_REASONS = [
  'UNISOLATED_ERROR',
  'CONNECTED_ERROR',
  'DUPLICATE_MEMBER',
  'GROUP_LIMIT',
  'MISSING_REFERENCE',
  'UNVERIFIED_REFERENCE_ROLE',
  'RESIDUAL',
] as const;
export type ClearingGroupReason = (typeof CLEARING_GROUP_REASONS)[number];
export const CLEARING_LINE_CODES = [
  'CELL',
  'IDENTITY',
  'POSTING',
  'ROW_SCOPE',
  'DATE',
  'PERIOD',
  'AMOUNT_FORMAT',
  'SPLIT',
] as const;
export type ClearingLineCode = (typeof CLEARING_LINE_CODES)[number];
const GROUP_LIMIT = 100;

export type ClearingGroupsInput = {
  file: SourceFile;
  reading: ClearingReading;
  scope: ClearingScope;
};
export type ClearingMovement = {
  id: string;
  row: number;
  posting: string;
  reference: string;
  date: string;
  amount: number;
  description: string;
};
export type ClearingFaultyLine = {
  row: number;
  values: string[];
  code: ClearingLineCode;
  isolated: boolean;
  keys: string[];
};
export type ClearingGroup = {
  id: string;
  reference: string;
  members: (ClearingMovement & { basis: 'REFERENCE' | 'ROW' })[];
  net: number;
  status: 'cleared' | 'review';
  reasons: ClearingGroupReason[];
  connected: { row: number; code: ClearingLineCode }[];
  duplicates: number[][];
};
export type ClearingGroupsResult = {
  version: string;
  context: string;
  sourceHash: string;
  sheet: string;
  scope: ClearingScope;
  reading: ClearingReading;
  role: boolean;
  movements: ClearingMovement[];
  faulty: ClearingFaultyLine[];
  blank: number[];
  groups: ClearingGroup[];
  total: number;
  decimals: number;
};

export const refuse = (code: string): never => {
  throw new Error(`CLEARING_GROUPS_${code}`);
};
class Line extends Error {
  code: ClearingLineCode;
  constructor(code: ClearingLineCode) {
    super(code);
    this.code = code;
  }
}
const fault = (code: ClearingLineCode): never => {
  throw new Line(code);
};
const readingKeys: (keyof ClearingReading)[] = [
  'sheet',
  'header',
  'posting',
  'reference',
  'date',
  'amount',
  'debit',
  'credit',
  'account',
  'currency',
  'description',
  'mode',
];
const scopeKeys: (keyof ClearingScope)[] = [
  'entity',
  'ledger',
  'account',
  'currency',
  'start',
  'end',
  'confirmed',
];
/** The identity rule of clearing-1, as a line code. */
const identity = (value: string) => {
  try {
    return cleanId(value);
  } catch {
    return fault('IDENTITY');
  }
};
const byRow = (a: { row: number }, b: { row: number }) => a.row - b.row;

export function groupClearing(
  input: ClearingGroupsInput,
): ClearingGroupsResult {
  let checked: ReturnType<typeof validate>;
  try {
    checked = validate({ ...input, events: [] });
  } catch (error) {
    // clearing-1's own refusals, under this family's name.
    return refuse(String((error as Error).message).replace(/^CLEARING_/, ''));
  }
  const { sheet, decimals, selected } = checked;
  const { file, reading: r, scope: s } = input;
  const header = sheet.rows[r.header];
  const role =
    /^(?:clearingreference|clearingdocument|مرجعالمقاصة|رقمالمقاصة)$/.test(
      header[r.reference].toLowerCase().replace(/\s/g, ''),
    );
  const context = JSON.stringify([
    CLEARING_GROUPS_VERSION,
    file.sha256,
    readingKeys.map((k) => r[k]),
    scopeKeys.map((k) => s[k]),
  ]);
  const movements: ClearingMovement[] = [];
  const faulty: ClearingFaultyLine[] = [];
  const blank: number[] = [];
  const formulaIn = (row: number, column: number) =>
    !!sheet.formulaCells?.[`${row}:${column + 1}`];
  for (const [index, values] of sheet.rows.entries()) {
    const row = index + 1;
    if (index <= r.header) continue;
    const cell = (column: number) => values[column] ?? '';
    try {
      if (
        sheet.hiddenRows.includes(row) ||
        sheet.rowIssues?.[String(row)]?.length ||
        selected.some(
          (c) =>
            sheet.cellIssues?.[`${row}:${c + 1}`]?.length ||
            (sheet.referenceIssues?.[`${row}:${c + 1}`]?.length &&
              [r.posting, r.reference, r.account].includes(c)) ||
            formulaIn(row, c),
        )
      )
        fault('CELL');
      if (!values.some((v) => v.trim())) {
        blank.push(row);
        continue;
      }
      const posting = identity(cell(r.posting));
      const reference = identity(cell(r.reference));
      if (!posting) fault('POSTING');
      if (
        identity(cell(r.account)) !== s.account ||
        cell(r.currency).trim() !== s.currency
      )
        fault('ROW_SCOPE');
      const raw = latinDigits(cell(r.date).trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fault('DATE');
      let date = '';
      try {
        date = parseDate(raw, 'ymd');
      } catch {
        fault('DATE');
      }
      if (date < s.start || date > s.end) fault('PERIOD');
      const money = (column: number) => {
        try {
          return amount(cell(column), decimals);
        } catch {
          return fault('AMOUNT_FORMAT');
        }
      };
      let value: number;
      if (r.mode === 'signed') value = money(r.amount);
      else {
        const debit = money(r.debit),
          credit = money(r.credit);
        if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0))
          fault('SPLIT');
        value = safeSum([debit, -credit]);
      }
      movements.push({
        id: `${file.sha256}:${r.sheet}:${row}`,
        row,
        posting,
        reference,
        date,
        amount: value,
        description: r.description < 0 ? '' : cell(r.description),
      });
    } catch (error) {
      if (!(error instanceof Line)) throw error;
      faulty.push({
        row,
        values: [...values],
        code: error.code,
        isolated: false,
        keys: [],
      });
    }
  }

  // Isolation: what a faulty line can touch, proven from its own reading.
  const width =
    header.reduce((last, label, i) => (label.trim() ? i + 1 : last), 0) || 0;
  const labels = header
    .slice(0, width)
    .map((v) => v.trim())
    .sort();
  for (const line of faulty) {
    const { row, values } = line;
    const ref = values[r.reference] ?? '';
    let refRead = false;
    try {
      refRead =
        !!cleanId(ref) &&
        !summaryLabel.test(
          ref
            .trim()
            .split(/[:：]/u)[0]
            .trim(),
        );
    } catch {
      refRead = false;
    }
    const cells = values.slice(0, width).map((v) => v.trim());
    line.isolated =
      role &&
      refRead &&
      !sheet.hiddenRows.includes(row) &&
      !sheet.rowIssues?.[String(row)]?.length &&
      !sheet.formulaRows.includes(row) &&
      !values.some((_, c) => formulaIn(row, c)) &&
      !sheet.cellIssues?.[`${row}:${r.reference + 1}`]?.length &&
      !sheet.referenceIssues?.[`${row}:${r.reference + 1}`]?.length &&
      !values.slice(width).some((v) => v.trim()) &&
      JSON.stringify([...cells].sort()) !== JSON.stringify(labels);
    line.keys = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  }
  const unisolated = faulty.some((line) => !line.isolated);

  // Groups: a whole reference, or one movement without a reference.
  const buckets = new Map<string, ClearingMovement[]>();
  for (const m of movements) {
    const key = m.reference ? `ref:${m.reference}` : `row:${m.row}`;
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  }
  const same = new Map<string, number[]>();
  for (const m of movements) {
    const key = JSON.stringify([
      m.posting,
      m.reference,
      m.date,
      m.amount,
      m.description,
    ]);
    const list = same.get(key);
    if (list) list.push(m.row);
    else same.set(key, [m.row]);
  }
  const duplicateOf = new Map<number, number[]>();
  for (const rows of same.values())
    if (rows.length > 1) for (const row of rows) duplicateOf.set(row, rows);

  const groups: ClearingGroup[] = [...buckets.values()].map((members) => {
    members.sort(byRow);
    const reference = members[0].reference;
    const net = safeSum(members.map((m) => m.amount));
    const postings = new Set(members.map((m) => m.posting));
    const connected = reference
      ? faulty
          .filter(
            (line) =>
              line.isolated &&
              line.keys.some((k) => k === reference || postings.has(k)),
          )
          .map((line) => ({ row: line.row, code: line.code }))
      : [];
    const duplicates = [
      ...new Map(
        members
          .filter((m) => duplicateOf.has(m.row))
          .map((m) => {
            const rows = duplicateOf.get(m.row)!;
            return [rows.join(','), rows] as const;
          }),
      ).values(),
    ];
    const reasons: ClearingGroupReason[] = [];
    if (unisolated) reasons.push('UNISOLATED_ERROR');
    if (connected.length) reasons.push('CONNECTED_ERROR');
    if (duplicates.length) reasons.push('DUPLICATE_MEMBER');
    if (members.length > GROUP_LIMIT) reasons.push('GROUP_LIMIT');
    if (!reference) reasons.push('MISSING_REFERENCE');
    else {
      if (!role) reasons.push('UNVERIFIED_REFERENCE_ROLE');
      if (
        net !== 0 ||
        !members.some((m) => m.amount > 0) ||
        !members.some((m) => m.amount < 0)
      )
        reasons.push('RESIDUAL');
    }
    return {
      id: `group:${members[0].id}`,
      reference,
      members: members.map((m) => ({
        ...m,
        basis: reference ? ('REFERENCE' as const) : ('ROW' as const),
      })),
      net,
      status: reasons.length ? ('review' as const) : ('cleared' as const),
      reasons,
      connected,
      duplicates,
    };
  });
  groups.sort((a, b) => a.members[0].row - b.members[0].row);
  const total = safeSum(movements.map((m) => m.amount));
  if (safeSum(groups.map((g) => g.net)) !== total) refuse('TOTAL');
  const owned = groups.flatMap((g) => g.members.map((m) => m.row));
  if (
    owned.length !== movements.length ||
    new Set(owned).size !== movements.length
  )
    refuse('OWNERSHIP');
  return {
    version: CLEARING_GROUPS_VERSION,
    context,
    sourceHash: file.sha256!,
    sheet: sheet.name,
    scope: { ...s },
    reading: { ...r },
    role,
    movements,
    faulty,
    blank,
    groups,
    total,
    decimals,
  };
}
