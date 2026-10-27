import { latinDigits, parseDate, parseMoney, safeSum } from './core.ts';
import { currencyPrecision } from './currency-precision.ts';
import { nativeDisplayIssue } from './xlsx-display.ts';
import { assertSourceFile } from './protocol.ts';
import type { SheetData, SourceFile } from './types.ts';
import {
  AR_SCOPE_DETAILS_VERSION,
  arScopeReadingKeys,
  arIssueCategory,
  arCsvSpans,
  isArScopeReading,
  parseArScopeDetails,
} from './ar-scope-details.ts';
import type {
  ArScopeDetailsReading,
  ArSourceCell,
  ArSourceIssue,
  ArSourceScope,
} from './ar-scope-details.ts';
import { AR_STATEMENT_PDF } from './ar-statement-pdf.ts';
import {
  arStatementSide,
  type ArStatementFile,
  type ArStatementSummary,
} from './ar-statement-scope.ts';
export {
  AR_SCOPE_DETAILS_VERSION,
  isArScopeReading,
  suggestArScopeReading,
} from './ar-scope-details.ts';
export type {
  ArScopeDetailsReading,
  ArSourceCell,
  ArSourceIssue,
  ArSourceScope,
} from './ar-scope-details.ts';

export const AR_VERSION = 'ar-limited-1';
export type ArKind = 'invoice' | 'credit-note' | 'receipt';
export type ArRole = 'company-ar-ledger' | 'company-issued-customer-statement';
export type ArLegacyReading = {
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
export type ArReading = ArLegacyReading | ArScopeDetailsReading;
/** The printed customer statement (ar-statement-pdf-1). Its lines come from
 * the statement reading bound to the file, never from columns. */
export type ArStatementPdfReading = {
  family: typeof AR_STATEMENT_PDF;
  role: 'company-issued-customer-statement';
  perspective: 'seller-receivable';
  basis: 'original-movement';
  confirmed: boolean;
};
export type { ArStatementFile, ArStatementSummary };
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
  originalRaw?: string;
  openBalanceRaw?: string;
  openBalanceRole?: 'descriptive-unverified';
  parentScopeId?: string;
  parentCell?: string;
  inheritedSourceCells?: Record<string, ArSourceCell>;
  /** A printed statement line: its page, its line and its text items. */
  pdf?: { page: number; line: number; items: number[] };
};
export type ArInventory = {
  side: 0 | 1;
  row: number;
  kind: 'header' | 'blank' | 'movement' | 'error' | 'out-of-scope';
  values: string[];
  error?: string;
  inventoryId?: string;
  classification?:
    | 'scope-marker'
    | 'scope-header'
    | 'details-marker'
    | 'detail-header'
    | 'end-marker'
    | 'blank'
    | 'detail'
    | 'movement'
    | 'error'
    | 'legacy-header'
    | 'document-header'
    | 'section-total'
    | 'page-footer'
    | 'out-of-scope';
  errors?: string[];
  lineSpan?: [number, number];
  /** A printed statement line: its place and what the reader found there. */
  pdf?: {
    page: number;
    line: number;
    items: number[];
    kind: string;
    section?: number;
  };
};
export type ArCase = {
  id: string;
  ids: string[];
  kind: ArKind | 'scope';
  document: string;
  status: 'matched' | 'review';
  basis: 'own-document' | 'human-confirmation' | 'none';
  reason:
    | 'empty-source'
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
/** The company ledger (ar-limited-1) against a printed customer statement. */
export type ArStatementInput = {
  files: [SourceFile, ArStatementFile];
  readings: [ArLegacyReading, ArStatementPdfReading];
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
  totals: [number | null, number | null];
  status?: 'matched' | 'review' | 'source-error';
  sourceIssues?: ArSourceIssue[];
  errorInventoryRefs?: string[];
  sourceScopes?: ArSourceScope[];
  receiptAllocations?: never[];
  financialCompletenessAsserted?: false;
  statement?: ArStatementSummary;
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
const statementReadingKeys = [
  'family',
  'role',
  'perspective',
  'basis',
  'confirmed',
] as const;
const isStatementReading = (value: unknown): value is ArStatementPdfReading =>
  plain(value) && value.family === AR_STATEMENT_PDF;
/** The printed statement, when the second source is one. */
function statementOf(input: ArInput): ArStatementFile | undefined {
  const file: unknown = Array.isArray(input?.files) ? input.files[1] : undefined;
  return plain(file) && file.kind === 'ar-statement-pdf'
    ? (file as ArStatementFile)
    : undefined;
}
// The statement's reading must be the one made from these bytes, and the
// accountant's confirmation of the role must be explicit.
type ArSide = {
  sheet: SheetData;
  selected: number[];
  relatedColumns: number[];
  parsed?: ReturnType<typeof parseArScopeDetails>;
  statement?: ReturnType<typeof arStatementSide>;
};
function validateStatement(input: ArInput, file: ArStatementFile): ArSide {
  const r: unknown = input.readings[1];
  if (
    !sameKeys(file, ['kind', 'name', 'sha256', 'reading']) ||
    typeof file.name !== 'string' ||
    file.name.length > 255 ||
    !/\.pdf$/i.test(file.name) ||
    !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
    !plain(file.reading) ||
    file.reading.family !== AR_STATEMENT_PDF ||
    file.reading.sha256 !== file.sha256 ||
    !Array.isArray(file.reading.lines) ||
    !Array.isArray(file.reading.sections) ||
    !Array.isArray(file.reading.errors)
  )
    fail('SOURCE');
  if (
    !isStatementReading(r) ||
    !sameKeys(r, statementReadingKeys) ||
    r.role !== roles[1] ||
    !(r.perspective === 'seller-receivable' && r.basis === 'original-movement') ||
    r.confirmed !== true
  )
    fail('READING');
  return {
    sheet: { name: 'PDF', rows: [], formulaRows: [], hiddenRows: [] },
    selected: [] as number[],
    relatedColumns: [] as number[],
    statement: arStatementSide(file, input.scope),
  };
}
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
  const statement = statementOf(input);
  // The ledger beside a printed statement is read as ar-limited-1 only.
  if (statement && (!plain(input.readings[0]) || 'family' in input.readings[0]))
    fail('READING');
  const sheets = input.files.map((file, side): ArSide => {
    if (side === 1 && statement) return validateStatement(input, statement);
    if (
      !plain(file) ||
      file.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(file.name ?? '') ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      fail('SOURCE');
    assertSourceFile(file);
    const r = input.readings[side];
    if (isArScopeReading(r)) {
      const parsed = parseArScopeDetails(file, side as 0 | 1, r, s, decimals!);
      return {
        sheet: parsed.sheet,
        selected: [] as number[],
        relatedColumns: [] as number[],
        parsed,
      };
    }
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
      sheet.rowIssues?.['1']?.some(
        (issue) => !issue.startsWith('XLSX_NATIVE_DISPLAY:'),
      ) ||
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
  const statement = statementOf(input);
  const newFamily =
    !!statement ||
    (Array.isArray(input?.readings) && input.readings.some(isArScopeReading));
  let validated: ReturnType<typeof validate>;
  try {
    validated = validate(input);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : 'AR_INPUT';
    if (!newFamily || !['AR_SCOPE', 'AR_SAME_SOURCE'].includes(code))
      throw cause;
    return invalidScopeResult(input, code);
  }
  const { sheets, decimals } = validated;
  const version = statement
    ? AR_STATEMENT_PDF
    : newFamily
      ? AR_SCOPE_DETAILS_VERSION
      : AR_VERSION;
  const context = JSON.stringify([
    version,
    input.files.map((f) => f.sha256),
    input.readings.map((r) =>
      isStatementReading(r)
        ? statementReadingKeys.map((k) => r[k])
        : isArScopeReading(r)
          ? arScopeReadingKeys.map((k) => r[k])
          : readingKeys.map((k) => r[k as keyof ArLegacyReading]),
    ),
    scopeKeys.map((k) => input.scope[k as keyof ArScope]),
  ]);
  const rows: ArRow[] = [],
    inventory: ArInventory[] = [];
  const sourceIssues: ArSourceIssue[] = [];
  const sourceScopes: ArSourceScope[] = [];
  const structuralSides = new Set<number>();
  for (const side of [0, 1] as const) {
    const { sheet, selected, relatedColumns } = sheets[side],
      r = input.readings[side],
      s = input.scope;
    const printed = sheets[side].statement;
    if (printed) {
      rows.push(...printed.rows);
      inventory.push(...printed.inventory);
      sourceIssues.push(...printed.issues);
      if (printed.structural) structuralSides.add(side);
      continue;
    }
    if (isArScopeReading(r)) {
      const parsed = sheets[side].parsed!;
      rows.push(...parsed.rows);
      inventory.push(...parsed.inventory);
      sourceIssues.push(...parsed.issues);
      if (parsed.sourceScope) sourceScopes.push(parsed.sourceScope);
      if (parsed.structural) structuralSides.add(side);
      continue;
    }
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
          error:
            nativeDisplayIssue(sheet, row, [...selected, ...relatedColumns]) ??
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
    if (newFamily) {
      item.classification = 'error';
      item.errors = ['AR_DUPLICATE_POSTING'];
    }
  }
  const valid = rows.filter((r) => !duplicateIds.has(r.id));
  const issueInventoryIds = new Set(
    sourceIssues.flatMap((issue) => issue.inventoryIds),
  );
  if (newFamily)
    for (const item of inventory) {
      item.inventoryId ??= `${item.side}:${input.files[item.side].sha256}:${input.readings[item.side].sheet}:inventory:${item.row}`;
      item.classification ??=
        item.kind === 'header' ? 'legacy-header' : item.kind;
      if (item.kind === 'error' && !issueInventoryIds.has(item.inventoryId!)) {
        item.errors ??= [item.error ?? 'AR_CELL'];
        sourceIssues.push({
          side: item.side,
          code: item.error ?? 'AR_CELL',
          category: arIssueCategory(item.error ?? 'AR_CELL'),
          inventoryIds: [item.inventoryId],
        });
      }
    }
  const totals = newFamily
    ? ([0, 1].map((side) => {
        if (newFamily && structuralSides.has(side)) return null;
        try {
          return safeSum(
            valid.filter((r) => r.side === side).map((r) => r.amount),
          );
        } catch (cause) {
          if (!newFamily) throw cause;
          sourceIssues.push({
            side: side as 0 | 1,
            code: 'AR_TOTAL_BOUND',
            category: 'total-bound',
            inventoryIds: inventory
              .filter((i) => i.side === side && i.kind === 'movement')
              .map((i) => i.inventoryId!),
          });
          return null;
        }
      }) as [number | null, number | null])
    : undefined;
  const errors =
    (newFamily && sourceIssues.length > 0) ||
    inventory.some((r) => r.kind === 'error');
  const buckets = new Map<string, ArRow[]>();
  for (const row of valid) {
    const key = JSON.stringify([row.kind, row.document]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const documentRole = input.readings.every(
    (r, side) =>
      isStatementReading(r) ||
      isArScopeReading(r) ||
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
  if (newFamily && cases.length === 0)
    cases.push({
      id: 'ar:scope',
      ids: [],
      kind: 'scope',
      document: '',
      status: 'review',
      basis: 'none',
      reason: errors ? 'source-errors' : 'empty-source',
      note: '',
    });
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
    version,
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
    totals: totals ?? [
      safeSum(valid.filter((r) => r.side === 0).map((r) => r.amount)),
      safeSum(valid.filter((r) => r.side === 1).map((r) => r.amount)),
    ],
    ...(newFamily
      ? {
          status: errors
            ? ('source-error' as const)
            : cases.every((c) => c.status === 'matched')
              ? ('matched' as const)
              : ('review' as const),
          sourceIssues,
          errorInventoryRefs: [
            ...new Set(sourceIssues.flatMap((issue) => issue.inventoryIds)),
          ],
          sourceScopes,
          receiptAllocations: [] as never[],
          financialCompletenessAsserted: false as const,
          ...(statement
            ? { statement: sheets[1].statement!.summary }
            : {}),
        }
      : {}),
  };
}

/** AR document comparison of the company ledger against a printed customer
 * statement, in the confirmed scope only. */
export function reconcileArStatement(input: ArStatementInput) {
  return reconcileAr(input as unknown as ArInput) as unknown as Omit<
    ArResult,
    'readings'
  > & {
    readings: [ArLegacyReading, ArStatementPdfReading];
    statement: ArStatementSummary;
  };
}

/** A malformed externally confirmed scope cannot grant financial authority.
 * Preserve its original inventory so callers can render a bounded source error. */
function invalidScopeResult(input: ArInput, code: string): ArResult {
  const inventory: ArInventory[] = [];
  const statement = statementOf(input);
  for (const side of [0, 1] as const) {
    if (side === 1 && statement) {
      if (!Array.isArray(statement.reading?.lines)) fail('SOURCE');
      statement.reading.lines.forEach((line, index) =>
        inventory.push({
          side,
          row: index + 1,
          kind: 'error',
          values: [line.text],
          error: code,
          errors: [code],
          classification: 'error',
          inventoryId: `1:${statement.sha256}:pdf:inventory:${line.page}:${line.line}`,
          pdf: {
            page: line.page,
            line: line.line,
            items: line.items,
            kind: line.kind,
            ...(line.section === undefined ? {} : { section: line.section }),
          },
        }),
      );
      continue;
    }
    const file = input.files[side];
    assertSourceFile(file);
    const sheetIndex = Number.isSafeInteger(input.readings[side]?.sheet)
      ? input.readings[side].sheet
      : 0;
    const sheet = file.sheets[sheetIndex] ?? file.sheets[0];
    const spans = isArScopeReading(input.readings[side])
      ? arCsvSpans(file)
      : undefined;
    sheet.rows.forEach((values, index) =>
      inventory.push({
        side,
        row: index + 1,
        kind: 'error',
        values: [...values],
        error: code,
        errors: [code],
        classification: 'error',
        inventoryId: `${side}:${file.sha256}:${sheetIndex}:inventory:${index + 1}`,
        ...(spans?.[index] ? { lineSpan: spans[index] } : {}),
      }),
    );
  }
  const sourceIssues = [0, 1].map((side) => ({
    side: side as 0 | 1,
    code,
    category: arIssueCategory(code),
    inventoryIds: inventory
      .filter((item) => item.side === side)
      .map((item) => item.inventoryId!),
  }));
  if (input.events.length) fail('DECISION');
  const version = statement ? AR_STATEMENT_PDF : AR_SCOPE_DETAILS_VERSION;
  return {
    version,
    context: JSON.stringify([
      version,
      input.files.map((file) => file.sha256),
      input.readings.map((reading) =>
        isStatementReading(reading)
          ? statementReadingKeys.map((key) => reading[key])
          : isArScopeReading(reading)
            ? arScopeReadingKeys.map((key) => reading[key])
            : readingKeys.map((key) => reading[key as keyof ArLegacyReading]),
      ),
      scopeKeys.map((key) => input.scope?.[key as keyof ArScope]),
    ]),
    sources: input.files.map((file, side) => ({
      hash: file.sha256!,
      name: file.name,
      sheet:
        side === 1 && statement
          ? 'PDF'
          : (file.sheets[input.readings[side].sheet] ?? file.sheets[0]).name,
      role: roles[side],
    })),
    readings: input.readings.map((reading) => ({ ...reading })) as [
      ArReading,
      ArReading,
    ],
    scope: { ...input.scope },
    decimals:
      typeof input.scope?.currency === 'string'
        ? (currencyPrecision(input.scope.currency) ?? 2)
        : 2,
    rows: [],
    inventory,
    cases: [
      {
        id: 'ar:scope',
        ids: [],
        kind: 'scope',
        document: '',
        status: 'review',
        basis: 'none',
        reason: 'source-errors',
        note: '',
      },
    ],
    totals: [null, null],
    status: 'source-error',
    sourceIssues,
    errorInventoryRefs: sourceIssues.flatMap((issue) => issue.inventoryIds),
    sourceScopes: [],
    receiptAllocations: [],
    financialCompletenessAsserted: false,
  };
}
