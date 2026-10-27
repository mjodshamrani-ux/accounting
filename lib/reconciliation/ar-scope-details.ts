import { latinDigits, parseDate, parseMoney } from './core.ts';
import { nativeDisplayIssue } from './xlsx-display.ts';
import type { SourceFile } from './types.ts';
import type { ArInventory, ArKind, ArRole, ArRow, ArScope } from './ar.ts';

export const AR_SCOPE_DETAILS_VERSION = 'ar-scope-details-1';
export type ArScopeDetailsReading = {
  family: 'ar-scope-details-1';
  sheet: number;
  /** Zero-based original detail-header row, never a derived-table position. */
  header: number;
  parent: number;
  posting: number;
  kind: number;
  document: number;
  date: number;
  amount: number;
  related: number;
  open: number;
  description: number;
  role: ArRole;
  perspective: 'seller-receivable';
  basis: 'original-movement';
  confirmed: boolean;
};
export type ArSourceCell = {
  hash: string;
  sheet: number;
  sheetName: string;
  row: number;
  column: number;
  raw: string;
  parentScopeId: string;
  detailRow: number;
  parentCell: string;
};
export type ArSourceScope = {
  side: 0 | 1;
  scopeId: string;
  reference: string;
  cells: Record<string, ArSourceCell>;
  detailsMarkerRow: number;
  headerRow: number;
  endRow: number;
};
export type ArSourceIssue = {
  side: 0 | 1;
  code: string;
  category: string;
  inventoryIds: string[];
};
export const arIssueCategories: Record<string, string> = {
  AR_SCOPE_MARKER: 'invalid-scope-marker',
  AR_SECOND_SCOPE: 'data-after-end',
  AR_DETAILS_MARKER: 'repeated-or-late-header',
  AR_END_MARKER: 'repeated-or-late-header',
  AR_SCOPE_KEY: 'unknown-scope-key',
  AR_DUPLICATE_SCOPE_KEY: 'duplicate-scope-key',
  AR_SCOPE_KEYS: 'missing-scope-key',
  AR_DETAIL_COLUMNS: 'unknown-detail-column',
  AR_DUPLICATE_DETAIL_COLUMN: 'duplicate-detail-column',
  AR_MISSING_DETAIL_COLUMN: 'missing-detail-column',
  AR_COLUMN_ROLE: 'original-amount-role-required',
  AR_MISSING_DETAILS: 'missing-details',
  AR_DETAIL_AFTER_END: 'data-after-end',
  AR_MISSING_END_DETAILS: 'missing-end-details',
  AR_DETAIL_LIMIT: 'detail-limit',
  AR_READING: 'invalid-reading',
  AR_READING_UNCONFIRMED: 'reading-unconfirmed',
  AR_HEADER_SCOPE: 'scope-header-mismatch',
  AR_IDENTITY: 'missing-identity',
  AR_KIND: 'invalid-document-type',
  AR_DATE: 'invalid-date',
  AR_PERIOD: 'date-outside-period',
  AR_AMOUNT: 'invalid-amount',
  AR_AMOUNT_PRECISION: 'amount-precision',
  AR_AMOUNT_BOUND: 'amount-bound',
  AR_ZERO_AMOUNT: 'zero-amount',
  AR_DIRECTION: 'amount-sign',
  AR_PARENT_SCOPE: 'parent-scope-mismatch',
  AR_DUPLICATE_POSTING: 'duplicate-posting-id',
  AR_TOTAL_BOUND: 'total-bound',
  AR_SCOPE: 'scope-unconfirmed',
  AR_SAME_SOURCE: 'identical-source-hashes',
  AR_FORMULA_CELL: 'formula-cell',
  AR_HIDDEN_ROW: 'hidden-row',
  AR_HIDDEN_COLUMN: 'hidden-column',
  AR_MERGED_CELLS: 'merged-cells',
  AR_CELL: 'error-cell',
  AR_DETAIL_EXTRA_CELL: 'unknown-detail-column',
  AR_TEXT_LIMIT: 'text-limit',
  // A printed customer statement (ar-statement-pdf-1).
  AR_PDF_DOCUMENT_HEADER: 'document-header',
  AR_PDF_HEADER: 'section-header',
  AR_PDF_COLUMNS: 'column-headings',
  AR_PDF_ORPHAN_LINE: 'line-before-header',
  AR_PDF_LINE: 'unplaced-value',
  AR_PDF_SCOPE_NOT_FOUND: 'scope-not-found',
  AR_PDF_SCOPE_REPEATED: 'scope-repeated',
  AR_ORIGINAL_MISSING: 'original-amount-missing',
};
export const arIssueCategory = (code: string) =>
  arIssueCategories[code] ??
  (code.startsWith('XLSX_NATIVE_DISPLAY:') ? 'native-display' : 'error-cell');
export const arScopeReadingKeys = [
  'family',
  'sheet',
  'header',
  'parent',
  'posting',
  'kind',
  'document',
  'date',
  'amount',
  'related',
  'open',
  'description',
  'role',
  'perspective',
  'basis',
  'confirmed',
] as const;
const detailRoles = {
  parent: 'Parent scope ID',
  posting: 'Posting ID',
  kind: 'Document type',
  document: 'Own document number',
  date: 'Posting date',
  amount: 'Original signed amount',
  related: 'Related invoice',
  open: 'Open balance',
  description: 'Description',
} as const;
const scopeRoles = [
  'Scope ID',
  'Source role',
  'Perspective',
  'Amount basis',
  'Entity',
  'Ledger',
  'Customer',
  'Account',
  'Currency',
  'Period start',
  'Period end',
  'Scope reference',
];
const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
export function isArScopeReading(
  value: unknown,
): value is ArScopeDetailsReading {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { family?: unknown }).family === AR_SCOPE_DETAILS_VERSION
  );
}
/** Discovery is only a UI suggestion. The explicit confirmation and full raw
 * structural validation are still required before comparison. */
export function suggestArScopeReading(
  file: SourceFile,
  side: 0 | 1,
  sheet = 0,
): ArScopeDetailsReading {
  const rows = file.sheets[sheet]?.rows ?? [];
  const header = rows.findIndex((row) => row.includes('Parent scope ID'));
  const labels = rows[header] ?? [];
  const mappings = Object.fromEntries(
    Object.entries(detailRoles).map(([key, label]) => [
      key,
      labels.indexOf(label),
    ]),
  );
  return {
    family: AR_SCOPE_DETAILS_VERSION,
    sheet,
    header: Math.max(0, header),
    ...mappings,
    role:
      side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: false,
  } as ArScopeDetailsReading;
}
const error = (code: string): never => {
  throw new Error(`AR_${code}`);
};
function identity(raw: string) {
  const value = raw.trim();
  if (
    !value ||
    value.length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    /^[=+@-]/.test(value) ||
    /^#(?:REF!|VALUE!|N\/A|DIV\/0!)/i.test(value)
  )
    error('IDENTITY');
  return value;
}
/** CSV inventory row numbers count logical records. This separate span counts
 * text lines, including quoted multiline cells, directly from original bytes. */
export function arCsvSpans(file: SourceFile): [number, number][] | undefined {
  if (!/\.csv$/i.test(file.name) || !file.original) return;
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(file.original);
  const spans: [number, number][] = [];
  let quoted = false,
    line = 1,
    start = 1,
    record = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    record = true;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') index++;
      else quoted = !quoted;
    }
    if (char === '\r' || char === '\n') {
      if (!quoted) {
        spans.push([start, line]);
        record = false;
      }
      if (char === '\r' && raw[index + 1] === '\n') index++;
      line++;
      if (!quoted) start = line;
    }
  }
  if (record) spans.push([start, line]);
  return spans;
}
export function parseArScopeDetails(
  file: SourceFile,
  side: 0 | 1,
  reading: ArScopeDetailsReading,
  scope: ArScope,
  decimals: number,
) {
  const sheet = file.sheets[reading.sheet] ?? file.sheets[0];
  const spans = arCsvSpans(file);
  const inventory: ArInventory[] = sheet.rows.map((values, index) => ({
    side,
    row: index + 1,
    values: [...values],
    kind: 'header',
    inventoryId: `${side}:${file.sha256}:${reading.sheet}:inventory:${index + 1}`,
    classification: values.some((v) => v.trim()) ? 'scope-header' : 'blank',
    ...(spans?.[index] ? { lineSpan: spans[index] } : {}),
  }));
  const issues: ArSourceIssue[] = [];
  let structural = false;
  const report = (code: string, index: number, structure = false) => {
    structural ||= structure;
    const item = inventory[index];
    if (item) {
      item.kind = 'error';
      item.classification = 'error';
      item.errors = [...(item.errors ?? []), code];
      item.error ??= code;
    }
    issues.push({
      side,
      code,
      category: arIssueCategory(code),
      inventoryIds: item ? [item.inventoryId!] : [],
    });
  };
  const hiddenRows = new Set(sheet.hiddenRows);
  const formulaRows = new Set(
    Object.keys(sheet.formulaCells ?? {}).map((key) =>
      Number(key.split(':')[0]),
    ),
  );
  const issueRows = new Set(
    Object.entries(sheet.cellIssues ?? {})
      .filter(([, issues]) => issues.length)
      .map(([key]) => Number(key.split(':')[0])),
  );
  const visibilityRows = new Set(
    Object.entries(sheet.cellNotes ?? {})
      .filter(([, notes]) =>
        notes.some((note) => note.startsWith('XLSX_NATIVE_DISPLAY:')),
      )
      .map(([key]) => Number(key.split(':')[0])),
  );
  const nativeError = (index: number) => {
    const row = index + 1;
    const cols = Array.from(
      { length: Math.max(sheet.rows[index]?.length ?? 0, 1) },
      (_, i) => i,
    );
    if (hiddenRows.has(row)) return 'AR_HIDDEN_ROW';
    if (formulaRows.has(row)) return 'AR_FORMULA_CELL';
    if (sheet.xlsxHeaders?.hiddenColumns.length) return 'AR_HIDDEN_COLUMN';
    if (
      sheet.xlsxHeaders?.merges.some(
        (merge) => merge.top <= row && merge.bottom >= row,
      )
    )
      return 'AR_MERGED_CELLS';
    if (
      sheet.rowIssues?.[String(row)]?.length ||
      issueRows.has(row) ||
      visibilityRows.has(row)
    )
      return nativeDisplayIssue(sheet, row, cols) ?? 'AR_CELL';
    // Reference display rules apply to identity cells, never to numeric money.
    const identityColumns = [
      reading.parent,
      reading.posting,
      reading.kind,
      reading.document,
      reading.date,
      reading.related,
    ];
    if (
      index > reading.header &&
      identityColumns.some(
        (col) =>
          col >= 0 && sheet.referenceIssues?.[`${row}:${col + 1}`]?.length,
      )
    )
      return 'AR_CELL';
  };
  let state: 'scope' | 'header' | 'details' | 'ended' = 'scope';
  let detailHeader = -1,
    detailsMarker = -1,
    end = -1;
  const headerValues = new Map<string, { value: string; row: number }>();
  const detailIndexes: number[] = [];
  for (const [index, values] of sheet.rows.entries()) {
    const item = inventory[index];
    const native = nativeError(index);
    const blank = !values.some((v) => v.trim());
    if (native) report(native, index, state !== 'details');
    if (values.some((value) => value.length > 4096))
      report('AR_TEXT_LIMIT', index, state !== 'details');
    if (blank) {
      if (!native) {
        item.kind = 'blank';
        item.classification = 'blank';
      }
      continue;
    }
    const marker = values[0];
    if (index === 0) {
      if (item.kind !== 'error') item.classification = 'scope-marker';
      if (
        marker !== 'AR_SCOPE' ||
        values[1] !== '1' ||
        values.slice(2).some((v) => v !== '')
      )
        report('AR_SCOPE_MARKER', index, true);
      continue;
    }
    if (marker === 'AR_SCOPE') {
      report('AR_SECOND_SCOPE', index, true);
      continue;
    }
    if (marker === 'DETAILS') {
      if (item.kind !== 'error') item.classification = 'details-marker';
      if (state !== 'scope' || values.slice(1).some((v) => v !== ''))
        report('AR_DETAILS_MARKER', index, true);
      else {
        state = 'header';
        detailsMarker = index;
      }
      continue;
    }
    if (marker === 'END_DETAILS') {
      if (item.kind !== 'error') item.classification = 'end-marker';
      if (state !== 'details' || values.slice(1).some((v) => v !== ''))
        report('AR_END_MARKER', index, true);
      else {
        state = 'ended';
        end = index;
      }
      continue;
    }
    if (state === 'scope') {
      if (headerValues.has(marker))
        report('AR_DUPLICATE_SCOPE_KEY', index, true);
      else if (
        !scopeRoles.includes(marker) ||
        values.slice(2).some((v) => v !== '')
      )
        report('AR_SCOPE_KEY', index, true);
      else headerValues.set(marker, { value: values[1] ?? '', row: index + 1 });
    } else if (state === 'header') {
      if (item.kind !== 'error') item.classification = 'detail-header';
      detailHeader = index;
      state = 'details';
      const labels = values.filter((v) => v !== '');
      if (
        labels.length !== values.length ||
        labels.some((v) => !Object.values(detailRoles).includes(v as never))
      )
        report('AR_DETAIL_COLUMNS', index, true);
      if (new Set(labels).size !== labels.length)
        report('AR_DUPLICATE_DETAIL_COLUMN', index, true);
      for (const [key, label] of Object.entries(detailRoles)) {
        const actual = values.indexOf(label);
        const optional = ['related', 'open', 'description'].includes(key);
        if (!optional && actual < 0)
          report('AR_MISSING_DETAIL_COLUMN', index, true);
        if (reading[key as keyof typeof detailRoles] !== actual)
          report('AR_COLUMN_ROLE', index, true);
      }
    } else if (state === 'details') {
      if (item.kind !== 'error') item.classification = 'detail';
      detailIndexes.push(index);
    } else report('AR_DETAIL_AFTER_END', index, true);
  }
  if (sheet.rows[0]?.[0] !== 'AR_SCOPE') report('AR_SCOPE_MARKER', 0, true);
  if (headerValues.size !== scopeRoles.length) report('AR_SCOPE_KEYS', 0, true);
  if (detailsMarker < 0 || detailHeader < 0)
    report('AR_MISSING_DETAILS', 0, true);
  if (end < 0)
    report('AR_MISSING_END_DETAILS', Math.max(0, sheet.rows.length - 1), true);
  if (detailIndexes.length > 20000)
    report('AR_DETAIL_LIMIT', detailIndexes[20000], true);
  if (
    reading.sheet < 0 ||
    !file.sheets[reading.sheet] ||
    reading.header !== detailHeader ||
    Object.keys(reading).sort().join('|') !==
      [...arScopeReadingKeys].sort().join('|') ||
    reading.role !==
      (side === 0
        ? 'company-ar-ledger'
        : 'company-issued-customer-statement') ||
    reading.perspective !== 'seller-receivable' ||
    reading.basis !== 'original-movement' ||
    ['sheet', 'header', ...Object.keys(detailRoles)].some(
      (key) =>
        !Number.isSafeInteger(reading[key as keyof ArScopeDetailsReading]) ||
        (reading[key as keyof ArScopeDetailsReading] as number) < -1,
    )
  )
    report('AR_READING', Math.max(0, detailHeader), true);
  if (reading.confirmed !== true)
    report('AR_READING_UNCONFIRMED', Math.max(0, detailHeader), true);
  const expected: Record<string, string> = {
    'Source role':
      side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
    Perspective: 'seller-receivable',
    'Amount basis': 'original-movement',
    Entity: scope.entity,
    Ledger: scope.ledger,
    Customer: scope.customer,
    Account: scope.account,
    Currency: scope.currency,
    'Period start': scope.start,
    'Period end': scope.end,
  };
  let scopeId = '',
    reference = '';
  for (const key of scopeRoles) {
    const raw = headerValues.get(key);
    if (!raw) continue;
    try {
      if (
        ['Period start', 'Period end'].includes(key) &&
        sheet.numericCells?.[`${raw.row}:2`]
      )
        error('HEADER_SCOPE');
      const value = identity(raw.value);
      if (own(expected, key) && value !== expected[key]) error('HEADER_SCOPE');
      if (key === 'Scope ID') scopeId = value;
      if (key === 'Scope reference') reference = value;
    } catch (cause) {
      report(
        cause instanceof Error ? cause.message : 'AR_HEADER_SCOPE',
        raw.row - 1,
        true,
      );
    }
  }
  const cells = Object.fromEntries(
    [...headerValues].map(([key, value]) => [
      key,
      {
        hash: file.sha256!,
        sheet: reading.sheet,
        sheetName: sheet.name,
        row: value.row,
        column: 2,
        raw: value.value,
        parentScopeId: scopeId,
        detailRow: 0,
        parentCell: '',
      },
    ]),
  );
  const sourceScope: ArSourceScope | undefined = structural
    ? undefined
    : {
        side,
        scopeId,
        reference,
        cells,
        detailsMarkerRow: detailsMarker + 1,
        headerRow: detailHeader + 1,
        endRow: end + 1,
      };
  const rows: ArRow[] = [];
  if (!structural)
    for (const index of detailIndexes) {
      const item = inventory[index],
        values = item.values,
        row = index + 1;
      if (item.kind === 'error') continue;
      try {
        if (
          values.some(
            (v, col) => col >= sheet.rows[detailHeader].length && v !== '',
          )
        )
          error('DETAIL_EXTRA_CELL');
        const cell = (column: number) => values[column] ?? '';
        const parentScopeId = identity(cell(reading.parent));
        if (parentScopeId !== scopeId) error('PARENT_SCOPE');
        const posting = identity(cell(reading.posting)),
          document = identity(cell(reading.document));
        const aliases: Record<string, ArKind> = {
          invoice: 'invoice',
          'credit-note': 'credit-note',
          receipt: 'receipt',
          فاتورة: 'invoice',
          'إشعار دائن': 'credit-note',
          قبض: 'receipt',
        };
        const rawKind = cell(reading.kind).trim().toLowerCase();
        const kind = own(aliases, rawKind) ? aliases[rawKind] : undefined;
        if (!kind) error('KIND');
        if (sheet.numericCells?.[`${row}:${reading.date + 1}`]) error('DATE');
        const rawDate = latinDigits(cell(reading.date).trim());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) error('DATE');
        const date = (() => {
          try {
            return parseDate(rawDate, 'ymd');
          } catch {
            return error('DATE');
          }
        })();
        if (date < scope.start || date > scope.end) error('PERIOD');
        const originalRaw = cell(reading.amount);
        const rawMoney = latinDigits(originalRaw.trim())
          .replace(/−/g, '-')
          .replace(/٫/g, '.');
        if (!/^[+-]?\d+(?:\.\d+)?$/.test(rawMoney)) error('AMOUNT');
        if ((rawMoney.split('.')[1]?.length ?? 0) > decimals)
          error('AMOUNT_PRECISION');
        const amount = (() => {
          try {
            return parseMoney(rawMoney, 'dot', decimals);
          } catch {
            return error('AMOUNT_BOUND');
          }
        })();
        if (amount === 0) error('ZERO_AMOUNT');
        if (kind === 'invoice' ? amount <= 0 : amount >= 0) error('DIRECTION');
        const related =
          reading.related < 0 || !cell(reading.related).trim()
            ? ''
            : identity(cell(reading.related));
        const openBalanceRaw = reading.open < 0 ? '' : cell(reading.open);
        const description =
          reading.description < 0 ? '' : cell(reading.description);
        if (openBalanceRaw.length > 4096 || description.length > 4096)
          error('TEXT_LIMIT');
        const parentCell = `${row}:${reading.parent + 1}`;
        const inheritedSourceCells = Object.fromEntries(
          ['entity', 'ledger', 'customer', 'account', 'currency'].map((key) => [
            key,
            {
              ...cells[key[0].toUpperCase() + key.slice(1)],
              detailRow: row,
              parentCell,
            },
          ]),
        );
        rows.push({
          id: `${side}:${file.sha256}:${reading.sheet}:${row}`,
          side,
          row,
          posting,
          kind: kind!,
          document,
          date,
          amount,
          related,
          relatedEvidence: related ? [related] : [],
          description,
          originalRaw,
          openBalanceRaw,
          openBalanceRole: 'descriptive-unverified',
          parentScopeId,
          parentCell,
          inheritedSourceCells,
        });
        item.kind = 'movement';
        item.classification = 'movement';
      } catch (cause) {
        report(cause instanceof Error ? cause.message : 'AR_CELL', index);
      }
    }
  return { sheet, rows, inventory, sourceScope, issues, structural };
}
