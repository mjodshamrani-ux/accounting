/** An explicit human-reviewed transaction source, never an OCR draft or a CSV
 * fallback. Original PNG, literal crops, header meanings, inventory and the
 * accountant's interpretation travel together and are replayed at every async
 * boundary. This v1 deliberately cannot prove a reconciled balance. */
import { parseDate, parseMoney, structuralSummaryLabel } from './core.ts';
import { defaultMapping, MAX_FILE_BYTES } from './types.ts';
import type { Mapping, Scope, SourceFile, SheetData } from './types.ts';
import { digest } from './visual-png.ts';
import { isVisualLiteral, visualRegions } from './visual-review.ts';
import type { VisualRegion } from './visual-review.ts';
import { restoreVisualTable, visualTableCounts } from './visual-table.ts';
import type { VisualTable, TableRole } from './visual-table.ts';
import { formatChoice } from './input-readiness.ts';
import { suggestFormats } from './format-inference.ts';
import { currencyPrecision } from './currency-precision.ts';

export type VisualAccountingContext = Readonly<{
  side: 'supplier' | 'ledger';
  supplier: string;
  entity: string;
  account: string;
  currency: string;
  decimals: 0 | 2 | 3;
  periodStart: string;
  cutoff: string;
  multiplier: 1 | -1;
  numberFormat: Mapping['numberFormat'];
  dateFormat: Mapping['dateFormat'];
}>;
export type VisualAccountingRecord = Readonly<{
  kind: 'reviewed-visual-source';
  version: 1 | 2;
  basis: 'human-reviewed-transactions';
  table: VisualTable;
  headers: readonly string[];
  currencyProof: string | null;
  context: VisualAccountingContext;
  review: Readonly<{ fingerprint: string; checkedAt: string }>;
}>;
export const VISUAL_SOURCE_SUFFIX = '.tarasuf-reviewed.json';
const registered = new WeakSet<object>();
export const VISUAL_SOURCE_INVALID =
  'تعذر التحقق من مصدر الصورة المراجع أو تغير سياقه. راجع العناوين والقيم والنطاق.';
const fail = (): never => {
  throw new Error(VISUAL_SOURCE_INVALID);
};
const shape = (
  v: unknown,
  keys: readonly string[],
): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every((k) => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return d?.enumerable && 'value' in d;
  });
const time = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString() === s;
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const freeze = <T>(v: T): T => {
  if (
    v &&
    typeof v === 'object' &&
    !(v instanceof ArrayBuffer) &&
    !Object.isFrozen(v)
  ) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
function contextCopy(input: VisualAccountingContext): VisualAccountingContext {
  if (
    !shape(input, [
      'side',
      'supplier',
      'entity',
      'account',
      'currency',
      'decimals',
      'periodStart',
      'cutoff',
      'multiplier',
      'numberFormat',
      'dateFormat',
    ])
  )
    fail();
  const p = { ...input };
  if (
    !['supplier', 'ledger'].includes(p.side) ||
    !['supplier', 'entity'].every(
      (k) =>
        isVisualLiteral(p[k as 'supplier' | 'entity']) &&
        p[k as 'supplier' | 'entity'].length <= 200,
    ) ||
    typeof p.account !== 'string' ||
    p.account.length > 200 ||
    (p.account !== '' && !isVisualLiteral(p.account)) ||
    !/^[A-Z]{3}$/.test(p.currency) ||
    ![0, 2, 3].includes(p.decimals) ||
    ![1, -1].includes(p.multiplier) ||
    !['dot', 'comma'].includes(p.numberFormat) ||
    !['ymd', 'dmy', 'mdy'].includes(p.dateFormat) ||
    typeof p.periodStart !== 'string' ||
    typeof p.cutoff !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(p.periodStart) ||
    !/^\d{4}-\d\d-\d\d$/.test(p.cutoff) ||
    parseDate(p.periodStart, 'ymd') !== p.periodStart ||
    parseDate(p.cutoff, 'ymd') !== p.cutoff ||
    p.periodStart > p.cutoff
  )
    fail();
  if ([p.supplier, p.entity, p.account].some((s) => s !== s.trim())) fail();
  const precision = currencyPrecision(p.currency);
  if (precision !== undefined && precision !== p.decimals) fail();
  return p;
}
const headerPatterns: Record<TableRole, RegExp> = {
  reference:
    /^(?:reference|ref\.?|document reference|invoice no\.?|invoice number|document no\.?|document number|المرجع|رقم الفاتورة|رقم المستند)$/i,
  date: /^(?:date|transaction date|posting date|invoice date|document date|التاريخ|تاريخ الحركة|تاريخ المستند|تاريخ القيد)$/i,
  amount:
    /^(?:amount|movement(?: amount)?|transaction amount|المبلغ|مبلغ الحركة)$/i,
  debit: /^(?:debit(?: amount)?|مدين|المدين)$/i,
  credit: /^(?:credit(?: amount)?|دائن|الدائن)$/i,
  balance: /^(?:balance|running balance|الرصيد|الرصيد الجاري)$/i,
  currency: /^(?:currency|currency code|العملة|رمز العملة)$/i,
};
/** A header is a separately reviewed literal above its own column, not an AI
 * role label or a generated Reference/Amount header. Unknown meanings remain
 * in the evidence-only table and cannot acquire positive matching authority. */
export function visualHeaderCandidates(
  table: VisualTable,
  column: number,
): readonly VisualRegion[] {
  visualTableCounts(table); // requires the immutable registered table
  const role = table.grid.roles[column];
  if (!role) return fail();
  return visualRegions(table.image).filter(
    (c) =>
      c.review &&
      c.role === 'reference' &&
      c.region.x0 >= table.grid.columnCuts[column] &&
      c.region.x1 <= table.grid.columnCuts[column + 1] &&
      c.region.y1 <= table.grid.region.y0 &&
      headerPatterns[role].test(c.value.trim().normalize('NFKC')),
  );
}
function headersCopy(table: VisualTable, headers: readonly string[]) {
  if (
    !Array.isArray(headers) ||
    Object.getPrototypeOf(headers) !== Array.prototype ||
    Reflect.ownKeys(headers).length !== headers.length + 1 ||
    headers.length !== table.grid.roles.length ||
    Array.from({ length: headers.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(headers, String(i)),
    ).some((d) => !d || !('value' in d)) ||
    new Set(headers).size !== headers.length ||
    headers.some((h, i) => {
      const d = Object.getOwnPropertyDescriptor(headers, String(i));
      return (
        !d ||
        !('value' in d) ||
        typeof h !== 'string' ||
        !visualHeaderCandidates(table, i).some((c) => c.id === h)
      );
    })
  )
    return fail();
  if (
    !['reference', 'date'].every((r) =>
      table.grid.roles.includes(r as TableRole),
    ) ||
    !(
      table.grid.roles.includes('amount') ||
      (table.grid.roles.includes('debit') &&
        table.grid.roles.includes('credit'))
    )
  )
    return fail();
  return [...headers];
}
export function visualCurrencyCandidates(
  table: VisualTable,
): readonly VisualRegion[] {
  visualTableCounts(table);
  return visualRegions(table.image).filter(
    (c) =>
      c.review &&
      c.role === 'currency' &&
      /^[A-Z]{3}$/.test(c.value) &&
      (c.region.y1 <= table.grid.region.y0 ||
        c.region.y0 >= table.grid.region.y1 ||
        c.region.x1 <= table.grid.region.x0 ||
        c.region.x0 >= table.grid.region.x1),
  );
}
const fingerprint = (
  table: VisualTable,
  headers: readonly string[],
  currencyProof: string | null,
  context: VisualAccountingContext,
) =>
  digest(
    encode([
      `tarasuf-reviewed-visual-source-v${table.version}`,
      table,
      headers,
      currencyProof,
      context,
    ]),
  );
export async function createVisualAccountingRecord(
  table: VisualTable,
  headers: readonly string[],
  input: VisualAccountingContext,
  checkedAt: string,
  currencyProof: string | null = null,
): Promise<VisualAccountingRecord> {
  const counts = visualTableCounts(table);
  if (
    !table.coverage ||
    counts.unclassified ||
    counts.uncheckedExclusions ||
    counts.unassignedCrops ||
    !time(checkedAt)
  )
    fail();
  const context = contextCopy(input),
    selected = headersCopy(table, headers);
  if (
    currencyProof !== null &&
    (typeof currencyProof !== 'string' ||
      !visualCurrencyCandidates(table).some(
        (c) => c.id === currencyProof && c.value === context.currency,
      ))
  )
    fail();
  if (!table.grid.roles.includes('currency') && currencyProof === null) fail();
  // table is immutable and context/headers were copied before awaiting crypto.
  return freeze({
    kind: 'reviewed-visual-source',
    version: table.version,
    basis: 'human-reviewed-transactions',
    table,
    headers: selected,
    currencyProof,
    context,
    review: {
      fingerprint: await fingerprint(table, selected, currencyProof, context),
      checkedAt,
    },
  });
}
export async function restoreVisualAccountingRecord(
  bytes: Uint8Array,
): Promise<VisualAccountingRecord> {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_BYTES) fail();
  const own = bytes.slice();
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(own));
  } catch {
    return fail();
  }
  if (
    !shape(p, [
      'kind',
      'version',
      'basis',
      'table',
      'headers',
      'currencyProof',
      'context',
      'review',
    ]) ||
    p.kind !== 'reviewed-visual-source' ||
    ![1, 2].includes(p.version as number) ||
    p.basis !== 'human-reviewed-transactions' ||
    !shape(p.review, ['fingerprint', 'checkedAt']) ||
    !time(p.review.checkedAt)
  )
    return fail();
  const table = await restoreVisualTable(encode(p.table));
  if (p.version !== table.version) fail();
  const fresh = await createVisualAccountingRecord(
    table,
    p.headers as string[],
    p.context as VisualAccountingContext,
    p.review.checkedAt,
    p.currencyProof as string | null,
  );
  if (p.review.fingerprint !== fresh.review.fingerprint) fail();
  return fresh;
}
export async function saveVisualAccountingRecord(
  record: VisualAccountingRecord,
): Promise<Uint8Array> {
  const bytes = encode(record);
  await restoreVisualAccountingRecord(bytes);
  return bytes;
}
export function isReviewedVisualSource(value: unknown): value is SourceFile & {
  kind: 'reviewed-visual-source';
  visual: VisualAccountingRecord;
} {
  return (
    !!value &&
    typeof value === 'object' &&
    (('kind' in value && value.kind === 'reviewed-visual-source') ||
      'visual' in value ||
      ('name' in value &&
        typeof value.name === 'string' &&
        value.name.toLowerCase().endsWith(VISUAL_SOURCE_SUFFIX)))
  );
}
export function assertReviewedVisualSource(file: SourceFile) {
  if (!registered.has(file)) fail();
}
export function visualAccountingMapping(file: SourceFile): Mapping {
  if (!file.visual) return fail();
  const { context: c, table } = file.visual;
  const m = {
    ...defaultMapping(),
    header: 0,
    sheet: 0,
    date: table.grid.roles.indexOf('date'),
    reference: table.grid.roles.indexOf('reference'),
    amount: table.grid.roles.indexOf('amount'),
    debit: table.grid.roles.indexOf('debit'),
    credit: table.grid.roles.indexOf('credit'),
    currencyColumn: table.grid.roles.indexOf('currency'),
    description: -1,
    reportType: 'transactions' as const,
    mode: (table.version === 2 ? 'split' : 'signed') as Mapping['mode'],
    multiplier: c.multiplier,
    numberFormat: c.numberFormat,
    dateFormat: c.dateFormat,
    periodStart: c.periodStart,
  };
  const formats = suggestFormats(file, m, c.decimals);
  for (const field of ['numberFormat', 'dateFormat'] as const)
    if (formats[field].status === 'ambiguous') {
      m.formatChoice ??= {};
      m.formatChoice[field] = formatChoice(
        file,
        m,
        field,
        c[field],
        formats[field].candidates,
        c.decimals,
      );
    }
  return m;
}
/** Bound interpretation cannot be reassigned to a balance column, flipped,
 * filtered away or used under another economic scope through Advanced inputs. */
export function assertVisualAccountingReading(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  side: string,
) {
  if (!isReviewedVisualSource(file)) return;
  assertReviewedVisualSource(file);
  const expected = visualAccountingMapping(file),
    c = file.visual.context;
  for (const k of [
    'sheet',
    'header',
    'date',
    'reference',
    'description',
    'amount',
    'debit',
    'credit',
    'currencyColumn',
    'mode',
    'multiplier',
    'numberFormat',
    'dateFormat',
    'reportType',
    'opening',
    'closing',
    'periodStart',
  ] as const)
    if (mapping[k] !== expected[k]) fail();
  if (
    mapping.directionEvidence !== undefined ||
    !mapping.excluded ||
    Object.keys(mapping.excluded).length ||
    c.side !== side ||
    ['supplier', 'entity', 'account', 'currency', 'decimals', 'cutoff'].some(
      (k) => scope[k as keyof Scope] !== c[k as keyof VisualAccountingContext],
    )
  )
    fail();
}
/** All rows stay present. Unreadable/missing cells become row errors; known
 * negative references can isolate them using the existing shared engine. */
export async function readVisualAccountingSource(
  name: string,
  input: ArrayBuffer,
): Promise<SourceFile> {
  if (
    typeof name !== 'string' ||
    name.length > 255 ||
    !name.toLowerCase().endsWith(VISUAL_SOURCE_SUFFIX) ||
    !(input instanceof ArrayBuffer)
  )
    fail();
  const original = input.slice(0),
    visual = await restoreVisualAccountingRecord(new Uint8Array(original));
  const { table, context: c } = visual,
    crops = new Map(visualRegions(table.image).map((r) => [r.id, r]));
  const sheet: SheetData = {
    name: 'Reviewed image',
    rows: [visual.headers.map((id) => crops.get(id)!.value)],
    formulaRows: [],
    hiddenRows: [],
    rowIssues: {},
    rowPages: {},
    cellNotes: {},
    cellIssues: {},
  };
  table.rows.forEach((row, i) => {
    const values = row.cells.map((id) =>
        id === null ? '' : crops.get(id)!.value,
      ),
      issues: string[] = [];
    if (row.disposition === 'unreadable')
      issues.push(`صف صورة غير مقروء: ${row.note}`);
    if (row.disposition === 'movement') {
      table.grid.roles.forEach((role, col) => {
        if (role === 'balance' && values[col] === '') return;
        if (role === 'reference') return; // blank reference can only need review, never proof
        try {
          if (['amount', 'debit', 'credit', 'balance'].includes(role))
            parseMoney(values[col], c.numberFormat, c.decimals);
          else if (role === 'date') parseDate(values[col], c.dateFormat);
          else if (role === 'currency' && values[col] !== c.currency)
            throw Error('currency');
        } catch {
          const message = `تعذرت قراءة قيمة من الصورة أو خالفت الصيغة المحددة (${role})`;
          if (role === 'balance') {
            sheet.cellNotes![`${i + 2}:${col + 1}`] = [message];
            return;
          }
          // A value valid under a different locale MUST participate in the
          // shared format intersection. Marking it unsafe here would hide a
          // contradiction and manufacture a plausible partial interpretation.
          const alternatives = ['amount', 'debit', 'credit'].includes(role)
            ? ['dot', 'comma']
            : role === 'date'
              ? ['ymd', 'dmy', 'mdy']
              : [];
          const readable = alternatives.some((format) => {
            try {
              if (['amount', 'debit', 'credit'].includes(role))
                parseMoney(
                  values[col],
                  format as Mapping['numberFormat'],
                  c.decimals,
                );
              else parseDate(values[col], format as Mapping['dateFormat']);
              return true;
            } catch {
              return false;
            }
          });
          if (!readable) sheet.cellIssues![`${i + 2}:${col + 1}`] = [message];
        }
      });
    }
    sheet.rows.push(values);
    if (issues.length) sheet.rowIssues![String(i + 2)] = issues;
  });
  const file: SourceFile = {
    kind: 'reviewed-visual-source',
    visual,
    name,
    original,
    sha256: await digest(new Uint8Array(original)),
    sheets: [sheet],
  };
  freeze(file);
  registered.add(file);
  return file;
}
/** A structured-cloned worker payload has no in-memory authority. Rebuild it
 * from its original JSON+PNG and require exact agreement, including all rows. */
export async function replayReviewedVisualSource(
  file: SourceFile,
): Promise<SourceFile> {
  if (!isReviewedVisualSource(file)) return file;
  if (
    !shape(file, ['kind', 'visual', 'name', 'original', 'sha256', 'sheets']) ||
    !(file.original instanceof ArrayBuffer)
  )
    fail();
  const fresh = await readVisualAccountingSource(file.name, file.original!);
  if (
    file.kind !== fresh.kind ||
    file.sha256 !== fresh.sha256 ||
    JSON.stringify(file.visual) !== JSON.stringify(fresh.visual) ||
    JSON.stringify(file.sheets) !== JSON.stringify(fresh.sheets)
  )
    fail();
  return fresh;
}

/** A human exclusion note is not a certificate that a movement never existed.
 * Only a literal structural label with every already-reviewed in-row fact
 * retained can acquire native non-movement semantics. Unknown exclusions stay
 * manual and participate in the engine's competing-identity checks. */
export function visualRowFactsRetained(
  file: SourceFile,
  index: number,
): boolean {
  assertReviewedVisualSource(file);
  const table = file.visual!.table,
    row = table.rows[index];
  const y0 = table.grid.rowCuts[index],
    y1 = table.grid.rowCuts[index + 1],
    x0 = table.grid.region.x0,
    x1 = table.grid.region.x1;
  return visualRegions(table.image)
    .filter(
      (c) =>
        c.review &&
        c.region.y0 < y1 &&
        c.region.y1 > y0 &&
        c.region.x0 < x1 &&
        c.region.x1 > x0,
    )
    .every((c) => row.cells.includes(c.id));
}
export function visualNonMovementProven(
  file: SourceFile,
  index: number,
  mapping: Mapping,
): boolean {
  assertReviewedVisualSource(file);
  const table = file.visual!.table,
    row = table.rows[index],
    sheet = file.sheets[0],
    values = sheet.rows[index + 1];
  // This source family prints "Closing total", which is not a native balance
  // identity. Accept the literal footer only when no dated/document facts
  // accompany it and every other retained value has its declared numeric role.
  let visualFooter = /^(Closing total|الإجمالي الختامي)$/i.test(
    values[mapping.reference]?.trim() ?? '',
  );
  if (visualFooter) {
    try {
      values.forEach((value, column) => {
        if (!value.trim() || column === mapping.reference) return;
        const role = table.grid.roles[column];
        if (!['amount', 'debit', 'credit', 'balance'].includes(role))
          throw Error('identity');
        parseMoney(
          value,
          file.visual!.context.numberFormat,
          file.visual!.context.decimals,
        );
      });
    } catch {
      visualFooter = false;
    }
  }
  if (
    row.disposition !== 'non-movement' ||
    (!visualFooter && !structuralSummaryLabel(values, mapping, sheet.rows[0]))
  )
    return false;
  return visualRowFactsRetained(file, index);
}
