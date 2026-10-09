import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { assertSourceFile } from './protocol.ts';
import type { SourceFile } from './types.ts';

export const CLEARING_VERSION = 'clearing-1';
export type ClearingReading = {
  sheet: number;
  header: number;
  posting: number;
  reference: number;
  date: number;
  amount: number;
  debit: number;
  credit: number;
  account: number;
  currency: number;
  description: number;
  mode: 'signed' | 'split';
};
export type ClearingScope = {
  entity: string;
  ledger: string;
  account: string;
  currency: string;
  start: string;
  end: string;
  confirmed: boolean;
};
export type ClearingRow = {
  id: string;
  row: number;
  posting: string;
  reference: string;
  date: string;
  amount: number;
  description: string;
};
export type ClearingEvent = {
  context: string;
  action: 'clear' | 'reopen';
  ids: string[];
  note: string;
};
export type ClearingCase = {
  id: string;
  ids: string[];
  reference: string;
  net: number;
  status: 'cleared' | 'review';
  basis: 'explicit-reference' | 'human-decision' | 'none';
  reason:
    | 'reference-zero'
    | 'residual'
    | 'missing-reference'
    | 'unverified-reference-role'
    | 'source-errors'
    | 'group-limit'
    | 'human-decision'
    | 'reopened';
  note: string;
};
export type ClearingInput = {
  file: SourceFile;
  reading: ClearingReading;
  scope: ClearingScope;
  events: ClearingEvent[];
};
export type ClearingResult = {
  version: string;
  context: string;
  sourceHash: string;
  sheet: string;
  scope: ClearingScope;
  reading: ClearingReading;
  rows: ClearingRow[];
  inventory: {
    row: number;
    kind: 'header' | 'blank' | 'movement' | 'error';
    values: string[];
    error?: string;
  }[];
  cases: ClearingCase[];
  total: number;
  decimals: number;
};
const refuse = (code: string): never => {
  throw new Error(`CLEARING_${code}`);
};
const text = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length <= max;
const required = (v: unknown): v is string => text(v) && !!v.trim();
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (value: object, names: string[]) =>
  Object.keys(value).sort().join('|') === [...names].sort().join('|');
const readingKeys = [
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
const scopeKeys = [
  'entity',
  'ledger',
  'account',
  'currency',
  'start',
  'end',
  'confirmed',
];
const cleanId = (v: string) => {
  const s = v.trim();
  if (
    s.length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(s) ||
    /^[=+@-]/.test(s) ||
    /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(s)
  )
    refuse('IDENTITY');
  return s;
};
function amount(value: string, decimals: number) {
  const raw = latinDigits(value.trim()).replace(/−/g, '-').replace(/٫/g, '.');
  // No implicit thousands/decimal convention, parentheses or blank-as-zero.
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) refuse('AMOUNT_FORMAT');
  return parseMoney(raw, 'dot', decimals);
}
function validate(input: ClearingInput) {
  if (
    !plain(input) ||
    !plain(input.file) ||
    input.file.kind !== undefined ||
    !/\.(csv|xlsx)$/i.test(input.file.name ?? '') ||
    !/^[a-f0-9]{64}$/.test(input.file.sha256 ?? '')
  )
    refuse('SOURCE');
  assertSourceFile(input.file);
  const { file, reading: r, scope: s, events } = input;
  if (
    !plain(r) ||
    !keys(r, readingKeys) ||
    !['signed', 'split'].includes(r.mode) ||
    !readingKeys
      .filter((k) => k !== 'mode')
      .every(
        (k) =>
          Number.isSafeInteger(r[k as keyof ClearingReading]) &&
          (r[k as keyof ClearingReading] as number) >= -1,
      )
  )
    refuse('READING');
  if (
    !plain(s) ||
    !keys(s, scopeKeys) ||
    !['entity', 'ledger', 'account', 'currency', 'start', 'end'].every((k) =>
      required(s[k as keyof ClearingScope]),
    ) ||
    s.confirmed !== true
  )
    refuse('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (
    decimals === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.end) ||
    parseDate(s.start, 'ymd') !== s.start ||
    parseDate(s.end, 'ymd') !== s.end ||
    s.start > s.end ||
    s.account !== cleanId(s.account)
  )
    refuse('SCOPE');
  const sheet = file.sheets[r.sheet];
  if (!sheet || r.header !== 0 || r.header >= sheet.rows.length)
    refuse('READING');
  const header = sheet.rows[r.header];
  const selected = [
    r.posting,
    r.reference,
    r.date,
    r.account,
    r.currency,
    ...(r.mode === 'signed' ? [r.amount] : [r.debit, r.credit]),
    ...(r.description >= 0 ? [r.description] : []),
  ];
  if (
    selected.some((c) => c < 0 || c >= header.length || !header[c].trim()) ||
    new Set(selected).size !== selected.length
  )
    refuse('COLUMNS');
  if (r.mode === 'signed' ? r.debit !== -1 || r.credit !== -1 : r.amount !== -1)
    refuse('COLUMNS');
  if (
    sheet.hiddenRows.includes(r.header + 1) ||
    sheet.xlsxHeaders?.hiddenColumns.some((c) => selected.includes(c - 1)) ||
    selected.some(
      (c) =>
        sheet.cellIssues?.[`${r.header + 1}:${c + 1}`]?.length ||
        sheet.formulaCells?.[`${r.header + 1}:${c + 1}`],
    )
  )
    refuse('COLUMNS');
  if (!Array.isArray(events) || events.length > 1000) refuse('EVENTS');
  return { sheet, decimals: decimals!, selected };
}
/** Domain-specific rules: never invokes compare(), AP cases or AP decisions. */
export function reconcileClearing(input: ClearingInput): ClearingResult {
  const { sheet, decimals, selected } = validate(input);
  const { file, reading: r, scope: s, events } = input;
  const context = JSON.stringify([
    CLEARING_VERSION,
    file.sha256,
    readingKeys.map((k) => r[k as keyof ClearingReading]),
    scopeKeys.map((k) => s[k as keyof ClearingScope]),
  ]);
  const rows: ClearingRow[] = [];
  const inventory: ClearingResult['inventory'] = [];
  for (const [index, sourceValues] of sheet.rows.entries()) {
    const values = [...sourceValues];
    const row = index + 1;
    if (index <= r.header) {
      inventory.push({ row, kind: 'header', values });
      continue;
    }
    try {
      if (
        sheet.hiddenRows.includes(row) ||
        sheet.rowIssues?.[String(row)]?.length ||
        selected.some(
          (c) =>
            sheet.cellIssues?.[`${row}:${c + 1}`]?.length ||
            (sheet.referenceIssues?.[`${row}:${c + 1}`]?.length &&
              [r.posting, r.reference, r.account].includes(c)) ||
            sheet.formulaCells?.[`${row}:${c + 1}`],
        )
      )
        refuse('CELL');
      // Unreadable cells can have empty display values; validate evidence before blank classification.
      if (!values.some((v) => v.trim())) {
        inventory.push({ row, kind: 'blank', values });
        continue;
      }
      const cell = (column: number) => values[column] ?? '';
      const posting = cleanId(cell(r.posting));
      const reference = cleanId(cell(r.reference));
      if (!posting) refuse('POSTING');
      if (
        cleanId(cell(r.account)) !== s.account ||
        cell(r.currency).trim() !== s.currency
      )
        refuse('ROW_SCOPE');
      const rawDate = latinDigits(cell(r.date).trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) refuse('DATE');
      const date = parseDate(rawDate, 'ymd');
      if (date < s.start || date > s.end) refuse('PERIOD');
      let value: number;
      if (r.mode === 'signed') value = amount(cell(r.amount), decimals);
      else {
        const debit = amount(cell(r.debit), decimals),
          credit = amount(cell(r.credit), decimals);
        if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0))
          refuse('SPLIT');
        value = safeSum([debit, -credit]);
      }
      rows.push({
        id: `${file.sha256}:${r.sheet}:${row}`,
        row,
        posting,
        reference,
        date,
        amount: value,
        description: r.description < 0 ? '' : cell(r.description),
      });
      inventory.push({ row, kind: 'movement', values });
    } catch (error) {
      inventory.push({
        row,
        kind: 'error',
        values,
        error: error instanceof Error ? error.message : 'CLEARING_CELL',
      });
    }
  }
  const postings = new Map<string, ClearingRow[]>();
  rows.forEach((row) =>
    postings.has(row.posting)
      ? postings.get(row.posting)!.push(row)
      : postings.set(row.posting, [row]),
  );
  const duplicates = new Set(
    [...postings.values()]
      .filter((v) => v.length > 1)
      .flat()
      .map((v) => v.row),
  );
  for (const entry of inventory)
    if (duplicates.has(entry.row)) {
      entry.kind = 'error';
      entry.error = 'CLEARING_DUPLICATE_POSTING';
    }
  const valid = rows.filter((row) => !duplicates.has(row.row));
  const errors = inventory.some((row) => row.kind === 'error');
  const buckets = new Map<string, ClearingRow[]>();
  for (const row of valid) {
    const key = row.reference ? `ref:${row.reference}` : `row:${row.id}`;
    if (buckets.has(key)) buckets.get(key)!.push(row);
    else buckets.set(key, [row]);
  }
  let cases: ClearingCase[] = [...buckets.values()].map((members) => {
    const reference = members[0].reference;
    const net = safeSum(members.map((row) => row.amount));
    const balanced =
      net === 0 &&
      members.some((row) => row.amount > 0) &&
      members.some((row) => row.amount < 0);
    const referenceRole =
      /^(?:clearingreference|clearingdocument|مرجعالمقاصة|رقمالمقاصة)$/.test(
        sheet.rows[r.header][r.reference].toLowerCase().replace(/\s/g, ''),
      );
    const automatic =
      !!reference &&
      referenceRole &&
      balanced &&
      !errors &&
      members.length <= 100;
    const ids = members.map((row) => row.id);
    return {
      id: `group:${ids[0]}`,
      ids,
      reference,
      net,
      status: automatic ? 'cleared' : 'review',
      basis: automatic ? 'explicit-reference' : 'none',
      reason: errors
        ? 'source-errors'
        : members.length > 100
          ? 'group-limit'
          : automatic
            ? 'reference-zero'
            : reference && !referenceRole
              ? 'unverified-reference-role'
              : reference
                ? 'residual'
                : 'missing-reference',
      note: '',
    };
  });
  const byId = new Map(valid.map((row) => [row.id, row]));
  for (const event of events) {
    if (
      !plain(event) ||
      !keys(event, ['context', 'action', 'ids', 'note']) ||
      event.context !== context ||
      !['clear', 'reopen'].includes(event.action) ||
      !required(event.note) ||
      event.note.trim().length < 8 ||
      !Array.isArray(event.ids) ||
      event.ids.length < 2 ||
      event.ids.length > 100 ||
      !event.ids.every((id) => text(id) && byId.has(id)) ||
      new Set(event.ids).size !== event.ids.length
    )
      refuse('DECISION');
    const selectedIds = new Set(event.ids);
    const members = event.ids.map((id) => byId.get(id)!);
    const intersecting = cases.filter((c) =>
      c.ids.some((id) => selectedIds.has(id)),
    );
    // Whole case ownership: a human decision cannot manufacture a valid subset
    // by taking one offset from a larger explicit clearing-reference bucket.
    if (intersecting.some((c) => c.ids.some((id) => !selectedIds.has(id))))
      refuse('PARTIAL_GROUP');
    if (event.action === 'reopen') {
      if (intersecting.length !== 1 || intersecting[0].status !== 'cleared')
        refuse('DECISION');
      cases = cases.map((c) =>
        c === intersecting[0]
          ? {
              ...c,
              status: 'review',
              basis: 'none',
              reason: 'reopened',
              note: event.note,
            }
          : c,
      );
    } else {
      if (
        errors ||
        intersecting.some((c) => c.status === 'cleared') ||
        safeSum(members.map((row) => row.amount)) !== 0 ||
        !members.some((row) => row.amount > 0) ||
        !members.some((row) => row.amount < 0)
      )
        refuse('DECISION');
      const ids = members.map((row) => row.id);
      cases = cases.filter((c) => !intersecting.includes(c));
      cases.push({
        id: `group:${ids[0]}`,
        ids,
        reference: '',
        net: 0,
        status: 'cleared',
        basis: 'human-decision',
        reason: 'human-decision',
        note: event.note,
      });
    }
  }
  const owned = cases.flatMap((c) => c.ids);
  if (owned.length !== valid.length || new Set(owned).size !== valid.length)
    refuse('OWNERSHIP');
  const total = safeSum(valid.map((row) => row.amount));
  if (safeSum(cases.map((c) => c.net)) !== total) refuse('TOTAL');
  return {
    version: CLEARING_VERSION,
    context,
    sourceHash: file.sha256!,
    sheet: sheet.name,
    scope: { ...s },
    reading: { ...r },
    rows: valid,
    inventory,
    cases,
    total,
    decimals,
  };
}
