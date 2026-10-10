import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { nativeDisplayIssue } from './xlsx-display.ts';
import { assertSourceFile } from './protocol.ts';
import type { SourceFile } from './types.ts';

export const AR_VERSION = 'ar-limited-1';
export type ArKind = 'invoice' | 'credit-note' | 'receipt';
export type ArRole = 'company-ar-ledger' | 'company-issued-customer-statement';
export type ArReading = {
  sheet: number;
  header: number;
  posting: number;
  kind: number;
  document: number;
  date: number;
  amount: number;
  entity: number;
  ledger: number;
  customer: number;
  account: number;
  currency: number;
  related: number;
  description: number;
  role: ArRole;
  perspective: 'seller-receivable';
  basis: 'original-movement';
  confirmed: boolean;
};
export type ArScope = {
  entity: string;
  ledger: string;
  customer: string;
  account: string;
  currency: string;
  start: string;
  end: string;
  confirmed: boolean;
};
export type ArRow = {
  id: string;
  side: 0 | 1;
  row: number;
  posting: string;
  kind: ArKind;
  document: string;
  date: string;
  amount: number;
  related: string;
  relatedEvidence: string[];
  description: string;
};
export type ArInventory = {
  side: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | 'movement' | 'error';
  values: string[];
  error?: string;
};
export type ArCase = {
  id: string;
  ids: string[];
  kind: ArKind;
  document: string;
  status: 'matched' | 'review';
  basis: 'own-document' | 'human-confirmation' | 'none';
  reason:
    | 'exact-own-document'
    | 'source-errors'
    | 'duplicate-document'
    | 'missing-counterpart'
    | 'amount-difference'
    | 'date-difference'
    | 'related-conflict'
    | 'unverified-document-role'
    | 'reopened'
    | 'human-confirmation';
  note: string;
};
export type ArEvent = {
  context: string;
  at: string;
  action: 'accept' | 'reopen';
  ids: string[];
  note: string;
};
export type ArInput = {
  files: [SourceFile, SourceFile];
  readings: [ArReading, ArReading];
  scope: ArScope;
  events: ArEvent[];
};
export type ArResult = {
  version: string;
  context: string;
  sources: { hash: string; name: string; sheet: string; role: ArRole }[];
  readings: [ArReading, ArReading];
  scope: ArScope;
  decimals: number;
  rows: ArRow[];
  inventory: ArInventory[];
  cases: ArCase[];
  totals: [number, number];
};
function fail(code: string): never {
  throw new Error(`AR_${code}`);
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value: object, keys: readonly string[]) =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const columns = [
  'sheet',
  'header',
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'related',
  'description',
] as const;
const readingKeys = [...columns, 'role', 'perspective', 'basis', 'confirmed'];
const scopeKeys = [
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'start',
  'end',
  'confirmed',
];
const roles: ArRole[] = [
  'company-ar-ledger',
  'company-issued-customer-statement',
];
function identity(value: string) {
  const text = value.trim();
  if (
    text.length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(text) ||
    /^[=+@-]/.test(text) ||
    /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(text)
  )
    fail('IDENTITY');
  return text;
}
function money(value: string, decimals: number) {
  const raw = latinDigits(value.trim()).replace(/−/g, '-').replace(/٫/g, '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) fail('AMOUNT');
  return parseMoney(raw, 'dot', decimals);
}
const headerRoles = {
  posting: ['Posting ID', 'Unique posting ID', 'معرف الحركة الفريد'],
  kind: ['Document type', 'نوع المستند'],
  document: [
    'Own document number',
    'رقم المستند الأصلي',
    'Document number',
    'رقم المستند',
  ],
  date: ['Posting date', 'تاريخ الترحيل'],
  amount: ['Original signed amount', 'مبلغ الحركة الأصلي الموقع'],
  entity: ['Entity', 'الكيان'],
  ledger: ['Ledger', 'الدفتر'],
  customer: ['Customer', 'Customer ID', 'معرف العميل'],
  account: ['Account', 'الحساب'],
  currency: ['Currency', 'العملة'],
} as const;
const roleHeader = (text: string) => text.trim().toLowerCase();
function validate(input: ArInput) {
  if (
    !plain(input) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    fail('INPUT');
  const s = input.scope;
  if (
    !plain(s) ||
    !sameKeys(s, scopeKeys) ||
    s.confirmed !== true ||
    !scopeKeys
      .filter((k) => k !== 'confirmed')
      .every(
        (k) =>
          typeof s[k as keyof ArScope] === 'string' &&
          identity(s[k as keyof ArScope] as string) ===
            (s[k as keyof ArScope] as string) &&
          !!s[k as keyof ArScope],
      )
  )
    fail('SCOPE');
  const decimals = currencyPrecision(s.currency);
  if (
    decimals === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.end) ||
    parseDate(s.start, 'ymd') !== s.start ||
    parseDate(s.end, 'ymd') !== s.end ||
    s.start > s.end
  )
    fail('SCOPE');
  const sheets = input.files.map((file, side) => {
    if (
      !plain(file) ||
      file.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(file.name ?? '') ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      fail('SOURCE');
    assertSourceFile(file);
    const r = input.readings[side];
    if (
      !plain(r) ||
      !sameKeys(r, readingKeys) ||
      r.role !== roles[side] ||
      r.perspective !== 'seller-receivable' ||
      r.basis !== 'original-movement' ||
      r.confirmed !== true ||
      !columns.every((k) => Number.isSafeInteger(r[k]) && r[k] >= -1)
    )
      fail('READING');
    const sheet = file.sheets[r.sheet];
    if (!sheet || r.header !== 0 || sheet.rows.length < 1) fail('READING');
    const selected = columns
      .filter(
        (k) =>
          !['sheet', 'header'].includes(k) &&
          (!(k === 'related' || k === 'description') || r[k] >= 0),
      )
      .map((k) => r[k]);
    const header = sheet.rows[0];
    if (
      selected.some((c) => c < 0 || c >= header.length || !header[c].trim()) ||
      new Set(selected).size !== selected.length ||
      sheet.hiddenRows.includes(1) ||
      sheet.rowIssues?.['1']?.some((issue) => !issue.startsWith('XLSX_NATIVE_DISPLAY:')) ||
      sheet.xlsxHeaders?.hiddenColumns.length ||
      // Every header contributes to role uniqueness, including unmapped columns.
      Object.entries(sheet.cellIssues ?? {}).some(
        ([cell, issues]) => cell.startsWith('1:') && issues.length > 0,
      ) ||
      Object.keys(sheet.formulaCells ?? {}).some((cell) =>
        cell.startsWith('1:'),
      )
    )
      fail('COLUMNS');
    for (const key of Object.keys(
      headerRoles,
    ) as (keyof typeof headerRoles)[]) {
      const names = headerRoles[key].map(roleHeader);
      const candidates = header.flatMap((label, index) =>
        names.includes(roleHeader(label)) ? [index] : [],
      );
      if (candidates.length !== 1 || candidates[0] !== r[key])
        fail('COLUMN_ROLE');
    }
    const relatedColumns = header.flatMap((label, index) =>
      ['related invoice', 'الفاتورة المرتبطة'].includes(roleHeader(label))
        ? [index]
        : [],
    );
    if (r.related >= 0 && !relatedColumns.includes(r.related))
      fail('COLUMN_ROLE');
    return { sheet, selected, relatedColumns };
  });
  if (input.files[0].sha256 === input.files[1].sha256) fail('SAME_SOURCE');
  return { sheets, decimals: decimals! };
}
/** AR document comparison in the seller perspective, never AP matching or receipt allocation. */
export function reconcileAr(input: ArInput): ArResult {
  const { sheets, decimals } = validate(input);
  const context = JSON.stringify([
    AR_VERSION,
    input.files.map((f) => f.sha256),
    input.readings.map((r) => readingKeys.map((k) => r[k as keyof ArReading])),
    scopeKeys.map((k) => input.scope[k as keyof ArScope]),
  ]);
  const rows: ArRow[] = [],
    inventory: ArInventory[] = [];
  for (const side of [0, 1] as const) {
    const { sheet, selected, relatedColumns } = sheets[side],
      r = input.readings[side],
      s = input.scope;
    const hiddenRows = new Set(sheet.hiddenRows);
    for (const [index, original] of sheet.rows.entries()) {
      const row = index + 1,
        values = [...original];
      if (index === 0) {
        inventory.push({ side, row, kind: 'header', values });
        continue;
      }
      try {
        if (
          hiddenRows.has(row) ||
          sheet.rowIssues?.[String(row)]?.length ||
          [...selected, ...relatedColumns].some(
            (c) =>
              sheet.cellIssues?.[`${row}:${c + 1}`]?.length ||
              sheet.formulaCells?.[`${row}:${c + 1}`] ||
              sheet.referenceIssues?.[`${row}:${c + 1}`]?.length,
          )
        )
          fail('CELL');
        if (!values.some((v) => v.trim())) {
          inventory.push({ side, row, kind: 'blank', values });
          continue;
        }
        const cell = (column: number) => values[column] ?? '';
        const posting = identity(cell(r.posting)),
          document = identity(cell(r.document));
        if (!posting || !document) fail('DOCUMENT');
        const aliases: Record<string, ArKind> = {
          invoice: 'invoice',
          'credit-note': 'credit-note',
          receipt: 'receipt',
          فاتورة: 'invoice',
          'إشعار دائن': 'credit-note',
          قبض: 'receipt',
        };
        const rawKind = cell(r.kind).trim().toLowerCase();
        const kind = Object.hasOwn(aliases, rawKind)
          ? aliases[rawKind]
          : undefined;
        if (!kind) fail('KIND');
        for (const key of [
          'entity',
          'ledger',
          'customer',
          'account',
          'currency',
        ] as const)
          if (identity(cell(r[key])) !== s[key]) fail('ROW_SCOPE');
        const rawDate = latinDigits(cell(r.date).trim());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) fail('DATE');
        const date = parseDate(rawDate, 'ymd');
        if (date < s.start || date > s.end) fail('PERIOD');
        const amount = money(cell(r.amount), decimals);
        if (kind === 'invoice' ? amount <= 0 : amount >= 0) fail('DIRECTION');
        rows.push({
          id: `${side}:${input.files[side].sha256}:${r.sheet}:${row}`,
          side,
          row,
          posting,
          kind,
          document,
          date,
          amount,
          related: r.related < 0 ? '' : identity(cell(r.related)),
          relatedEvidence: [
            ...new Set(
              relatedColumns
                .map((column) => identity(cell(column)))
                .filter(Boolean),
            ),
          ],
          description: r.description < 0 ? '' : cell(r.description),
        });
        inventory.push({ side, row, kind: 'movement', values });
      } catch (error) {
        inventory.push({
          side,
          row,
          kind: 'error',
          values,
          error: nativeDisplayIssue(sheet, row, [...selected, ...relatedColumns]) ??
            (error instanceof Error ? error.message : 'AR_CELL'),
        });
      }
    }
  }
  const postingGroups = new Map<string, ArRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.side, row.posting]);
    const group = postingGroups.get(key);
    if (group) group.push(row);
    else postingGroups.set(key, [row]);
  }
  const duplicateIds = new Set(
    [...postingGroups.values()]
      .filter((g) => g.length > 1)
      .flat()
      .map((r) => r.id),
  );
  const inventoryByRow = new Map(
    inventory.map((i) => [`${i.side}:${i.row}`, i]),
  );
  for (const row of rows.filter((r) => duplicateIds.has(r.id))) {
    const item = inventoryByRow.get(`${row.side}:${row.row}`)!;
    item.kind = 'error';
    item.error = 'AR_DUPLICATE_POSTING';
  }
  const valid = rows.filter((r) => !duplicateIds.has(r.id));
  const errors = inventory.some((r) => r.kind === 'error');
  const buckets = new Map<string, ArRow[]>();
  for (const row of valid) {
    const key = JSON.stringify([row.kind, row.document]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const documentRole = input.readings.every((r, side) =>
    /^(Own document number|رقم المستند الأصلي)$/i.test(
      sheets[side].sheet.rows[0][r.document].trim(),
    ),
  );
  const cases: ArCase[] = [];
  const eligible = new Set<string>();
  for (const bucket of buckets.values()) {
    const left = bucket.filter((r) => r.side === 0),
      right = bucket.filter((r) => r.side === 1),
      a = left[0],
      b = right[0];
    const id = `ar:${bucket[0].id}`;
    const relatedIds = new Set([
      ...(a?.relatedEvidence ?? []),
      ...(b?.relatedEvidence ?? []),
    ]);
    const relatedConflict = relatedIds.size > 1;
    const reason: ArCase['reason'] = errors
      ? 'source-errors'
      : left.length > 1 || right.length > 1
        ? 'duplicate-document'
        : !a || !b
          ? 'missing-counterpart'
          : a.amount !== b.amount
            ? 'amount-difference'
            : a.date !== b.date
              ? 'date-difference'
              : relatedConflict
                ? 'related-conflict'
                : !documentRole
                  ? 'unverified-document-role'
                  : 'exact-own-document';
    const canAccept =
      !!a &&
      !!b &&
      left.length === 1 &&
      right.length === 1 &&
      !errors &&
      a.amount === b.amount &&
      a.date === b.date &&
      !relatedConflict;
    if (canAccept) eligible.add(id);
    const matched = reason === 'exact-own-document';
    cases.push({
      id,
      ids: bucket.map((r) => r.id),
      kind: bucket[0].kind,
      document: bucket[0].document,
      status: matched ? 'matched' : 'review',
      basis: matched ? 'own-document' : 'none',
      reason,
      note: '',
    });
  }
  const owner = new Map(
    cases.flatMap((c) => c.ids.map((id) => [id, c] as const)),
  );
  for (const event of input.events) {
    if (
      !plain(event) ||
      !sameKeys(event, ['context', 'at', 'action', 'ids', 'note']) ||
      event.context !== context ||
      typeof event.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      new Date(event.at).toISOString() !== event.at ||
      !['accept', 'reopen'].includes(event.action) ||
      !Array.isArray(event.ids) ||
      event.ids.length !== 2 ||
      event.ids.some((id) => typeof id !== 'string') ||
      new Set(event.ids).size !== 2 ||
      typeof event.note !== 'string' ||
      event.note.trim().length < 8 ||
      event.note.length > 200
    )
      fail('DECISION');
    const target = owner.get(event.ids[0]);
    if (
      !target ||
      target.ids.length !== 2 ||
      event.ids.some((id) => owner.get(id) !== target) ||
      !eligible.has(target.id)
    )
      fail('DECISION');
    if (event.action === 'reopen') {
      if (target.status !== 'matched') fail('DECISION');
      target.status = 'review';
      target.reason = 'reopened';
      target.basis = 'none';
    } else {
      if (target.status === 'matched') fail('DECISION');
      target.status = 'matched';
      target.reason = 'human-confirmation';
      target.basis = 'human-confirmation';
    }
    target.note = event.note;
  }
  if (
    owner.size !== valid.length ||
    cases.reduce((n, c) => n + c.ids.length, 0) !== valid.length
  )
    fail('OWNERSHIP');
  return {
    version: AR_VERSION,
    context,
    sources: input.files.map((f, side) => ({
      hash: f.sha256!,
      name: f.name,
      sheet: sheets[side].sheet.name,
      role: roles[side],
    })),
    readings: input.readings.map((r) => ({ ...r })) as [ArReading, ArReading],
    scope: { ...input.scope },
    decimals,
    rows: valid,
    inventory,
    cases,
    totals: [
      safeSum(valid.filter((r) => r.side === 0).map((r) => r.amount)),
      safeSum(valid.filter((r) => r.side === 1).map((r) => r.amount)),
    ],
  };
}
