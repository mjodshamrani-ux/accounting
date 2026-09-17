import { defaultMapping } from './types.ts';
import { assertNativeAccountingSource } from './source-boundary.ts';
import { transactionReferences } from './transaction-references.ts';
import { buildReconciliationCases, identityConflicts } from './cases.ts';
import { extractStatementMetadata } from './statement-metadata.ts';
import { headerMatches } from './header-labels.ts';
import {
  enforceDeclaredReport,
  collectGenericAccounts,
  assertGenericAccountsCompatible,
} from './report-scope.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
  Transaction,
  Comparison,
  Decision,
  Match,
} from './types.ts';
export function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[\u200e\u200f\u061c]/g, '');
}
export function parseMoney(
  value: string,
  format: 'dot' | 'comma' = 'dot',
  decimals = 2,
): number {
  if (![0, 2, 3].includes(decimals))
    throw new Error('عدد المنازل العشرية للعملة غير مدعوم');
  let s = latinDigits(String(value)).trim().replace(/−/g, '-');
  if (!s) throw new Error('مبلغ فارغ');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-') || s.startsWith('+')) {
    if (negative)
      throw new Error(
        'إشارة المبلغ مزدوجة: لا تجمع الأقواس مع علامة موجب أو سالب.',
      );
    negative = s[0] === '-';
    s = s.slice(1);
  }
  s = s
    .replace(/٬/g, format === 'dot' ? ',' : '.')
    .replace(/٫/g, format === 'dot' ? '.' : ',');
  const sep = format === 'dot' ? '.' : ',';
  const group = format === 'dot' ? ',' : '.';
  const pieces = s.split(sep);
  if (pieces.length > 2) throw new Error('فواصل المبلغ غير صحيحة');
  let whole = pieces[0],
    fraction = pieces[1] ?? '';
  if (whole.includes(group)) {
    const groups = whole.split(group);
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((g) => !/^\d{3}$/.test(g))
    )
      throw new Error('مواضع فواصل الآلاف غير صحيحة');
    whole = groups.join('');
  }
  if (
    !/^\d+$/.test(whole) ||
    !/^\d*$/.test(fraction) ||
    (pieces.length === 2 && !fraction) ||
    fraction.length > decimals
  )
    throw new Error('المبلغ غير صالح أو يتجاوز عدد المنازل العشرية للعملة');
  const n = Number(
    BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, '0') || '0'),
  );
  if (!Number.isSafeInteger(n) || n > 1e14)
    throw new Error('مبلغ يتجاوز الحد الآمن');
  return negative ? -n : n;
}
export function safeSum(values: number[]): number {
  let sum = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || Math.abs(v) > 1e14)
      throw new Error('قيمة غير صحيحة في الإجمالي');
    sum += BigInt(v);
  }
  if (sum > 100000000000000n || sum < -100000000000000n)
    throw new Error('الإجمالي يتجاوز الحد الآمن');
  return Number(sum);
}
export function money(value: number, decimals = 2): string {
  const sign = value < 0 ? '-' : '';
  const s = Math.abs(value)
    .toString()
    .padStart(decimals + 1, '0');
  return (
    sign +
    (decimals
      ? s.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
        '.' +
        s.slice(-decimals)
      : s.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
  );
}
export function parseDate(
  value: string,
  format: Mapping['dateFormat'],
): string {
  const s = latinDigits(value).trim();
  let y: number, m: number, d: number;
  // A spelled-out English month is unambiguous. Do not use Date.parse, which
  // varies by runtime and can silently roll impossible calendar dates forward.
  const named = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, m, d] = s.split('-').map(Number);
  else if (named) {
    const months = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const month = named[2].toLowerCase();
    m =
      months.findIndex((name) => name === month || name.slice(0, 3) === month) +
      1;
    d = Number(named[1]);
    y = Number(named[3]);
  } else {
    const p = s.split(/[\/.-]/);
    if (p.length !== 3 || p.some((x) => !/^\d+$/.test(x)))
      throw new Error('التاريخ غير صالح. حدد ترتيب اليوم والشهر والسنة.');
    if (format === 'ymd') [y, m, d] = p.map(Number);
    else if (format === 'dmy') [d, m, y] = p.map(Number);
    else [m, d, y] = p.map(Number);
  }
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31)
    throw new Error('تاريخ خارج النطاق أو صيغة غير صحيحة');
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    throw new Error('اليوم المحدد غير موجود في التقويم');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function normalizeReference(s: string): string {
  return latinDigits(s)
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s\-/]/g, '');
}
function validateScope(scope: Scope) {
  if (
    !scope ||
    typeof scope.confirmed !== 'boolean' ||
    typeof scope.coverageConfirmed !== 'boolean' ||
    ![
      scope.supplier,
      scope.entity,
      scope.account,
      scope.currency,
      scope.cutoff,
    ].every((v) => typeof v === 'string') ||
    ![0, 2, 3].includes(scope.decimals) ||
    !Number.isInteger(scope.dateWindow) ||
    scope.dateWindow < 0 ||
    scope.dateWindow > 7
  )
    throw new Error(
      'إعدادات نطاق التسوية أو تأكيداته غير صالحة. راجع إعدادات القراءة وأكد النطاق.',
    );
}
export function inferMapping(
  file: SourceFile,
  sheet = 0,
  header?: number,
): Mapping {
  const m = defaultMapping();
  m.sheet = sheet;
  const patterns = {
    date: /^(date|transaction date|posting date|invoice date|doc\.? date|document date|value date|التاريخ|تاريخ الحركة|تاريخ المستند|تاريخ القيد)$/i,
    reference:
      /^(reference|ref\.?|our ref\.?|your ref\.?|invoice|invoice no\.?|invoice number|document reference|document no\.?|doc\.? ref\.?|doc\.? no\.?|voucher|voucher no\.?|المرجع|رقم الفاتورة|رقم المستند|رقم السند|السند)$/i,
    description:
      /^(description|details|narration|particulars|memo|remarks|البيان|الوصف|التفاصيل|الشرح|ملاحظات)$/i,
    amount:
      /^(amount|signed amount|outstanding|remaining|value|net|net amount|charge|المبلغ|القيمة|المتبقي|الرصيد المتبقي|الصافي)(?:\s*\([a-z]{3}\))?$/i,
    debit: /^(debit|dr\.?|مدين)(?:\s*\([a-z]{3}\))?$/i,
    credit: /^(credit|cr\.?|دائن)(?:\s*\([a-z]{3}\))?$/i,
    currencyColumn: /^(currency|ccy|العملة)$/i,
  };
  const rows = file.sheets[sheet]?.rows ?? [];
  const headerRows = rows.slice(0, 100);
  // The FIRST plausible table is a barrier even when its money column is
  // unresolved. Skipping it for a more familiar later table can lose movements.
  const firstTable = headerRows.findIndex(
    (row) =>
      row.some((c) => headerMatches(patterns.date, c)) &&
      row.some((c) =>
        [
          patterns.reference,
          patterns.amount,
          patterns.debit,
          patterns.credit,
          /^(supplier ref(?:erence)?|مرجع المورد)$/i,
        ].some((pattern) => headerMatches(pattern, c)),
      ),
  );
  m.header =
    header ??
    (firstTable >= 0
      ? firstTable
      : headerRows.reduce((best, row, i) => {
          const score = (r: string[]) =>
            r.filter((c) =>
              Object.values(patterns).some((p) => headerMatches(p, c)),
            ).length;
          return score(row) > score(rows[best] ?? []) ? i : best;
        }, 0));
  for (const [key, regex] of Object.entries(patterns)) {
    const candidates = (rows[m.header] ?? []).flatMap((c, index) =>
      headerMatches(regex, c) ? [index] : [],
    );
    m[key as keyof typeof patterns] =
      candidates.length === 1 ? candidates[0] : -1;
  }
  if (m.amount < 0 && m.debit >= 0 && m.credit >= 0) m.mode = 'split';
  // Meaning comes from explicit labels, never from the shape or uniqueness of
  // values: a decimal quantity is not evidence of a monetary amount.
  const names = rows[m.header] ?? [];
  const posting = names.flatMap((name, i) =>
    headerMatches(/^(posting date|تاريخ القيد)$/i, name) ? [i] : [],
  );
  if (
    m.date < 0 &&
    posting.length === 1 &&
    names.some((name) => headerMatches(/^AP voucher$/i, name)) &&
    names.every(
      (name, i) =>
        i === posting[0] ||
        !headerMatches(patterns.date, name) ||
        headerMatches(/^(invoice date|تاريخ المستند)$/i, name),
    )
  )
    m.date = posting[0];
  const supplierRefs = names.flatMap((name, i) =>
    headerMatches(
      /^(supplier ref(?:erence)?|supplier invoice(?: no\.?)?|مرجع المورد|رقم فاتورة المورد)$/i,
      name,
    )
      ? [i]
      : [],
  );
  if (supplierRefs.length === 1) m.reference = supplierRefs[0];
  if (m.amount < 0 && m.debit >= 0 && m.credit >= 0) m.mode = 'split';
  return m;
}
// A cell whose whole text is one of these names marks a total or balance line,
// not a transaction. Matching the entire cell keeps a description that merely
// mentions a balance from being excluded.
export const summaryLabel =
  /^(?:total|subtotal|grand total|opening balance|balance b\/f|balance c\/f|closing (?:ap )?balance|balance brought forward|balance carried forward|المجموع|الإجمالي|الرصيد الافتتاحي|الرصيد الختامي|رصيد افتتاحي|رصيد ختامي)\s*[:：]?$/i;
export function inlineBalanceSummary(row: string[], mapping: Mapping) {
  const nonempty = row.flatMap((value, column) =>
    value.trim() ? [{ value: value.trim(), column }] : [],
  );
  if (nonempty.length !== 1) return;
  const match =
    /^(opening balance|closing (?:ap )?balance|الرصيد الافتتاحي|الرصيد الختامي|رصيد افتتاحي|رصيد ختامي)\s*[:：]\s*([^\s]+)(?:\s+([A-Za-z]{3}))?$/i.exec(
      nonempty[0].value,
    );
  if (!match) return;
  try {
    parseMoney(match[2], mapping.numberFormat, 3);
  } catch {
    return;
  }
  return {
    label: match[1],
    amount: match[2],
    currency: match[3]?.toUpperCase(),
    column: nonempty[0].column,
    original: nonempty[0].value,
  };
}
// A label in a description/helper cell cannot erase a dated invoice. Only
// an isolated structural label, or the leading B/F opening record, qualifies.
export function structuralSummaryLabel(
  row: string[],
  mapping: Mapping,
  headers: string[],
  leading = false,
): string | undefined {
  const inline = inlineBalanceSummary(row, mapping);
  if (inline) return inline.label;
  const cells = row
    .map((value, column) => ({ value: value.trim(), column }))
    .filter((x) => x.value);
  const first = cells[0];
  if (!first) return;
  const date = row[mapping.date]?.trim() ?? '';
  const reference = row[mapping.reference]?.trim() ?? '';
  // A numeric reference is still a document identity. Consider explicit source
  // headers as well when reference mapping is absent or ambiguous.
  const referenceColumns = new Set(
    [
      mapping.reference,
      ...headers.flatMap((header, column) =>
        /^(?:reference|ref\.?|our ref\.?|your ref\.?|invoice|invoice no\.?|invoice number|document reference|document no\.?|doc\.? ref\.?|doc\.? no\.?|voucher|voucher no\.?|supplier ref(?:erence)?|supplier invoice(?: no\.?)?|customer ref\s*\/\s*po|المرجع|رقم الفاتورة|رقم المستند|رقم السند|السند|مرجع المورد|رقم فاتورة المورد)$/i.test(
          header.trim(),
        )
          ? [column]
          : [],
      ),
    ].filter((column) => column >= 0),
  );
  const references = [...referenceColumns]
    .map((column) => row[column]?.trim() ?? '')
    .filter(Boolean);
  const typeColumns = headers.flatMap((header, column) =>
    /^(type|doc type|document type|النوع|نوع المستند)$/i.test(header.trim())
      ? [column]
      : [],
  );
  const type =
    typeColumns.length === 1 ? (row[typeColumns[0]]?.trim() ?? '') : '';
  const openingType =
    /^(opening balance|balance b\/f|balance brought forward|الرصيد الافتتاحي|رصيد افتتاحي)$/i;
  const closingType =
    /^(closing (?:ap )?balance|balance c\/f|balance carried forward|الرصيد الختامي|رصيد ختامي)$/i;
  const openingReference = /^(B\/F|B-F|BF|OPENING|افتتاحي)$/i;
  const closingReference = /^(C\/F|C-F|CF|CLOSING|ختامي)$/i;
  const balanceIdentity =
    leading && openingType.test(type) && openingReference.test(reference)
      ? openingReference
      : closingType.test(type) && closingReference.test(reference)
        ? closingReference
        : undefined;
  if (
    balanceIdentity &&
    references.every((value) => balanceIdentity.test(value))
  ) {
    // An explicit balance identity can have an as-of date, but a malformed date
    // must remain a parsing issue rather than being erased by classification.
    if (date) {
      try {
        parseDate(date, mapping.dateFormat);
      } catch {
        return;
      }
    }
    return type;
  }
  // Date-like punctuation is also accepted by simpleValue below. Check mapped
  // identities first, so changing column order cannot erase a dated transaction.
  // Nonempty malformed dates are retained for normal parsing for the same reason.
  if (
    (date && date !== first.value) ||
    references.some((value) => value !== first.value)
  )
    return;
  const simpleValue = (value: string) =>
    /^[A-Z]{3}$/.test(value) || /^[()\s+−\-0-9٠-٩۰-۹.,٬٫]+$/.test(value);
  if (
    summaryLabel.test(first.value) &&
    cells.slice(1).every((x) => x.value === first.value || simpleValue(x.value))
  )
    return first.value;
}
export function nonFinancialFooter(row: string[]): boolean {
  const nonempty = [...new Set(row.map((v) => v.trim()).filter(Boolean))];
  if (
    row.filter((value) => value.trim()).length === 1 &&
    /^(?:Page|صفحة|الصفحة)\s+[1-9]\d*(?:\s+(?:of|من)\s+[1-9]\d*)?$/i.test(
      latinDigits(nonempty[0] ?? ''),
    )
  )
    return true;
  return (
    nonempty.length === 1 &&
    !/[0-9٠-٩۰-۹]/.test(nonempty[0]) &&
    /^(?:This (?:document|export|statement) (?:contains|is) .{20,}|(?:هذا المستند|هذا التقرير) .{20,})[.!؟]?$/i.test(
      nonempty[0],
    )
  );
}
const scopeColumnPatterns = {
  supplierName:
    /^(?:supplier|supplier name|vendor|vendor name|المورد|اسم المورد)$/i,
  entityName:
    /^(?:entity|legal entity|customer name|buyer name|الجهة القانونية|الكيان القانوني|اسم العميل)$/i,
  supplierCode: /^(?:supplier code|vendor code|رمز المورد)$/i,
  supplierStatementAccount:
    /^(?:customer account|customer a\/c|supplier statement account|حساب العميل)$/i,
  apControlAccount:
    /^(?:ap control account|control account|حساب مراقبة الموردين)$/i,
  currency: /^(?:currency|ccy|transaction currency|العملة|عملة الحركة)$/i,
};
const identityKey = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toUpperCase();

// Explicit financial labels constrain the user's mapping. Equal numbers cannot
// make invoice principal, open remaining, payments, and running balances equal
// accounting concepts. Unlabelled/generic Amount remains governed by report type.
function incompatibleAmountMeaning(
  header: string,
  reportType: Mapping['reportType'],
): boolean {
  const parts = header
    .trim()
    .replace(/\([A-Za-z]{3}\)/g, '')
    .split(/\s+\/\s+|\s*\|\s*/)
    .map((part) => part.trim());
  const nonMovement =
    /^(?:running(?: ap)? balance|cumulative balance|paid(?: amount)?|amount paid|الرصيد الجاري|الرصيد المتحرك|الرصيد التراكمي|المبلغ المدفوع|المدفوع|\d+\s*[-–—]\s*\d+(?:\s*days?)?|\d+\s*\+\s*(?:days?)?)$/i;
  const original =
    /^(?:original(?: document| invoice)? amount|invoice amount|document amount|gross amount|أصل مبلغ المستند|اصل مبلغ المستند|مبلغ الفاتورة|أصل الفاتورة|اصل الفاتورة)$/i;
  const remaining =
    /^(?:outstanding(?: amount| balance)?|remaining(?: amount| balance)?|balance(?: due)?|open amount|unpaid(?: amount)?|المتبقي|المبلغ المتبقي|الرصيد|الرصيد المتبقي|المبلغ غير المسدد)$/i;
  return parts.some(
    (part) =>
      nonMovement.test(part) ||
      (reportType === 'open-items'
        ? original.test(part)
        : remaining.test(part)),
  );
}

function enforceSourceScope(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  result: SourceResult,
) {
  const sheet = file.sheets[mapping.sheet];
  const metadata = result.metadata!;
  for (const [field, pattern] of Object.entries(scopeColumnPatterns)) {
    const key = field as keyof typeof scopeColumnPatterns;
    const columns = sheet.rows[mapping.header].flatMap((header, column) =>
      headerMatches(pattern, header) ? [column] : [],
    );
    if (!columns.length) continue;
    const values = new Map<string, string>();
    if (metadata[key]) values.set(identityKey(metadata[key]), metadata[key]);
    let invalid = columns.some(
      (column) =>
        sheet.cellIssues?.[`${mapping.header + 1}:${column + 1}`]?.length ||
        sheet.referenceIssues?.[`${mapping.header + 1}:${column + 1}`]?.length,
    );
    for (const transaction of result.transactions)
      for (const column of columns) {
        const rn = transaction.row;
        const rawValue = sheet.rows[rn - 1][column]?.trim() ?? '';
        if (
          !rawValue ||
          sheet.cellIssues?.[`${rn}:${column + 1}`]?.length ||
          sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length ||
          (!sheet.cellIssues && sheet.formulaRows.includes(rn))
        ) {
          invalid = true;
          continue;
        }
        const value = key === 'currency' ? rawValue.toUpperCase() : rawValue;
        if (!values.has(identityKey(value)))
          metadata.evidence.push({
            field: key,
            value,
            sheet: sheet.name,
            row: rn,
            column: column + 1,
            originalValue: rawValue,
            method: 'literal',
            ...(transaction.sourcePage ? { page: transaction.sourcePage } : {}),
          });
        values.set(identityKey(value), value);
      }
    if (
      invalid ||
      values.size !== 1 ||
      (key === 'currency' && [...values.values()][0] !== scope.currency)
    ) {
      result.errors.push({
        row: 0,
        message: `نطاق غير متحقق في عمود ${sheet.rows[mapping.header][columns[0]]}: توجد قيم ناقصة أو متعارضة أو أكثر من نطاق. افصل نطاق المورد والجهة والحساب والعملة قبل المطابقة.`,
      });
    } else metadata[key] = [...values.values()][0];
  }
  if (
    metadata.warnings.some((warning) =>
      /^METADATA_CONFLICT: (?:supplierName|entityName|supplierCode|supplierStatementAccount|apControlAccount)$/.test(
        warning,
      ),
    )
  )
    result.errors.push({
      row: 0,
      message:
        'هوية المورد أو الجهة أو الحساب متعارضة داخل المصدر. لا يمكن اعتماد نطاق موحد.',
    });
  if (metadata.warnings.some((warning) => /^CURRENCY_INVALID:/.test(warning)))
    result.errors.push({
      row: 0,
      message:
        'عملة المصدر المعلنة غير صالحة؛ لا يجوز استبدالها بعملة النطاق دون تحقق.',
    });
  if (
    metadata.warnings.some((warning) =>
      /^BALANCE_CURRENCY_MISMATCH:/.test(warning),
    )
  )
    result.errors.push({
      row: 0,
      message:
        'عملة رصيد المصدر لا تطابق نطاق المقارنة؛ إدخال رصيد يدوي لا يلغي هذا التعارض.',
    });
}
export function normalizeSource(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  side: 'supplier' | 'ledger',
): SourceResult {
  assertNativeAccountingSource(file);
  validateScope(scope);
  if (
    ![0, 2, 3].includes(scope.decimals) ||
    ![1, -1].includes(mapping.multiplier) ||
    !['signed', 'split'].includes(mapping.mode) ||
    !['dot', 'comma'].includes(mapping.numberFormat) ||
    !['ymd', 'dmy', 'mdy'].includes(mapping.dateFormat) ||
    !['transactions', 'open-items'].includes(mapping.reportType)
  )
    throw new Error('إعدادات القراءة غير صالحة');
  if (!Number.isInteger(mapping.sheet) || mapping.sheet < 0)
    throw new Error('ورقة غير صالحة');
  const sheet = file.sheets[mapping.sheet];
  if (!sheet) throw new Error('ورقة غير موجودة');
  if (
    !mapping.excluded ||
    typeof mapping.excluded !== 'object' ||
    Array.isArray(mapping.excluded) ||
    Object.entries(mapping.excluded).some(
      ([row, reason]) =>
        !/^[1-9]\d*$/.test(row) ||
        Number(row) > sheet.rows.length ||
        typeof reason !== 'string' ||
        !reason.trim(),
    )
  )
    throw new Error(
      'تعذر استبعاد الصف. اختر صفًا موجودًا واكتب سببًا واضحًا للاستبعاد.',
    );
  if (
    !Number.isInteger(mapping.header) ||
    mapping.header < 0 ||
    mapping.header >= sheet.rows.length
  )
    throw new Error('صف العناوين غير صالح');
  const width = sheet.rows[mapping.header].length;
  for (const col of [
    mapping.date,
    mapping.reference,
    mapping.description,
    mapping.currencyColumn,
    ...(mapping.mode === 'signed'
      ? [mapping.amount]
      : [mapping.debit, mapping.credit]),
  ])
    if (!Number.isInteger(col) || col < -1 || col >= width)
      throw new Error('العمود المختار خارج نطاق صف العناوين');
  const result: SourceResult = {
    transactions: [],
    excluded: [],
    errors: [],
    warnings: [],
    total: 0,
    opening: null,
    closing: null,
    balanceValid: false,
    rowCount: 0,
    mapping,
    sourceName: file.name,
    sourceHash: file.sha256,
  };
  if (
    mapping.mode === 'signed' &&
    incompatibleAmountMeaning(
      sheet.rows[mapping.header][mapping.amount] ?? '',
      mapping.reportType,
    )
  )
    result.errors.push({
      row: 0,
      message:
        'معنى عمود المبلغ لا يوافق نوع التقرير: أصل المستند والمتبقي والمدفوع والرصيد الجاري حقول مختلفة. حدد حقل المبلغ الموافق لنوع التقرير.',
    });
  if (file.pdf && mapping.pdfReviewed !== true)
    throw new Error(
      'راجع الصفوف المستخرجة من PDF مع الملف الأصلي، ثم أكد اكتمال المراجعة.',
    );
  const selected = [
    mapping.date,
    mapping.reference,
    mapping.description,
    mapping.currencyColumn,
    ...(mapping.mode === 'signed'
      ? [mapping.amount]
      : [mapping.debit, mapping.credit]),
  ].filter((i) => i >= 0);
  if (new Set(selected).size !== selected.length)
    throw new Error('لا يمكن تعيين العمود نفسه لأكثر من حقل');
  if (
    mapping.date < 0 ||
    (mapping.mode === 'signed'
      ? mapping.amount < 0
      : mapping.debit < 0 || mapping.credit < 0)
  )
    throw new Error('حدد أعمدة التاريخ والمبلغ أو المدين والدائن');
  // Currency in a selected value header is evidence, not decorative text.
  for (const column of mapping.mode === 'signed'
    ? [mapping.amount]
    : [mapping.debit, mapping.credit]) {
    const codes = [
      ...(sheet.rows[mapping.header]?.[column] ?? '').matchAll(
        /\(([A-Za-z]{3})\)/g,
      ),
    ].map((match) => match[1].toUpperCase());
    if (codes.some((code) => code !== scope.currency.toUpperCase()))
      throw new Error('عملة عنوان المبلغ لا تطابق العملة المؤكدة');
  }
  const cutoff = parseDate(scope.cutoff, 'ymd');
  result.metadata = extractStatementMetadata(file, mapping, scope);
  enforceDeclaredReport(file, mapping, result);
  result.warnings.push(...result.metadata.warnings);
  const periodEvidenceValid = !result.metadata.warnings.some((warning) =>
    /^PERIOD_INVALID:|^METADATA_CONFLICT: period(?:Start|End)$/.test(warning),
  );
  let start = '';
  if (mapping.periodStart) start = parseDate(mapping.periodStart, 'ymd');
  else if (periodEvidenceValid) start = result.metadata.periodStart;
  if (start && start > cutoff)
    throw new Error('بداية الفترة تأتي بعد تاريخ المقارنة');
  const get = (row: string[], col: number) =>
    col < 0 ? '' : (row[col] ?? '').trim();
  const headerRow = sheet.rows[mapping.header];
  const repeatedHeader = (row: string[]) =>
    row.length === headerRow.length &&
    headerRow.some((value) => value.trim()) &&
    row.every((value, i) => value.trim() === headerRow[i].trim());
  const repeatedPageMetadata = new Set<number>();
  if (file.pdf && sheet.rowPages) {
    const signature = (row: string[]) =>
      JSON.stringify(row.map((value) => value.trim()));
    const prefix = new Set(sheet.rows.slice(0, mapping.header).map(signature));
    const pages = new Map<number, number[]>();
    sheet.rows.forEach((_, index) => {
      const page = sheet.rowPages![String(index + 1)];
      if (page !== undefined) {
        const indexes = pages.get(page);
        if (indexes) indexes.push(index);
        else pages.set(page, [index]);
      }
    });
    for (const [page, rows] of pages) {
      if (page === sheet.rowPages[String(mapping.header + 1)]) continue;
      const headerIndex = rows.find((index) =>
        repeatedHeader(sheet.rows[index]),
      );
      if (headerIndex === undefined) continue;
      for (const index of rows) {
        if (index >= headerIndex) break;
        const row = sheet.rows[index];
        const amountPresent = (
          mapping.mode === 'signed'
            ? [mapping.amount]
            : [mapping.debit, mapping.credit]
        ).some((column) => (row[column] ?? '').trim());
        const identityPresent = [mapping.date, mapping.reference].some(
          (column) => column >= 0 && (row[column] ?? '').trim(),
        );
        // A page prefix is structural only when it repeats the original prefix,
        // precedes an identical table header, and contains no amount/identity pair.
        if (prefix.has(signature(row)) && !(amountPresent && identityPresent))
          repeatedPageMetadata.add(index + 1);
      }
    }
  }
  const formulaRows = new Set(sheet.formulaRows);
  const hiddenRows = new Set(sheet.hiddenRows);
  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rn = i + 1;
    if (i <= mapping.header) {
      result.excluded.push({
        row: rn,
        reason: i === mapping.header ? 'صف العناوين المؤكد' : 'قبل صف العناوين',
        values: row,
      });
      continue;
    }
    result.rowCount++;
    if (mapping.excluded[String(rn)]?.trim()) {
      result.excluded.push({
        row: rn,
        reason: mapping.excluded[String(rn)],
        values: row,
      });
      continue;
    }
    try {
      if (
        row.slice(sheet.rows[mapping.header]?.length ?? 0).some((v) => v.trim())
      )
        throw new Error(
          'توجد قيم إضافية خارج أعمدة العناوين. تحقق من فاصل CSV وترتيب بيانات الصف.',
        );
      // A statement's own totals and its headers repeated on each page are not
      // transactions. Exclude them with a recorded reason instead of demanding a
      // typed justification per row; they stay listed, counted and exported.
      const label = structuralSummaryLabel(
        row,
        mapping,
        headerRow,
        sheet.rows
          .slice(mapping.header + 1, i)
          .every((r) => r.every((v) => !v.trim())),
      );
      const unsafeLabel =
        label &&
        row.some(
          (value, column) =>
            (value.trim() === label ||
              inlineBalanceSummary(row, mapping)?.column === column) &&
            ((sheet.cellIssues?.[`${rn}:${column + 1}`] ?? []).some(
              (issue) => !issue.startsWith('خلية مدمجة في '),
            ) ||
              sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length),
        );
      const structuralReadingSafe =
        !hiddenRows.has(rn) &&
        !unsafeLabel &&
        !(sheet.rowIssues?.[rn] ?? []).some(
          (issue) => !issue.startsWith('نص يعبر حد عمود؛'),
        );
      const wholeTextRowSafe = (allowTextLayout = false) =>
        structuralReadingSafe &&
        !formulaRows.has(rn) &&
        !(sheet.rowIssues?.[rn] ?? []).some(
          (issue) => !(allowTextLayout && issue.startsWith('نص يعبر حد عمود؛')),
        ) &&
        row.every(
          (_, column) =>
            !(sheet.cellIssues?.[`${rn}:${column + 1}`] ?? []).some(
              (issue) =>
                !(allowTextLayout && issue.startsWith('خلية مدمجة في ')),
            ) && !sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length,
        );
      if (repeatedPageMetadata.has(rn) && wholeTextRowSafe(true)) {
        result.excluded.push({
          row: rn,
          reason:
            'بيانات رأس صفحة متكررة حرفيًا قبل عنوان الجدول المطابق — محفوظة في المصدر',
          values: row,
        });
        continue;
      }
      if (label && structuralReadingSafe) {
        result.excluded.push({
          row: rn,
          reason: `صف إجمالي أو رصيد — استُبعد تلقائيًا («${label.trim()}»)`,
          values: row,
        });
        continue;
      }
      if (nonFinancialFooter(row) && wholeTextRowSafe(true)) {
        result.excluded.push({
          row: rn,
          reason:
            'تذييل نصي أو ترقيم صفحة مستقل بلا بيانات حركة — استُبعد تلقائيًا',
          values: row,
        });
        continue;
      }
      if (repeatedHeader(row) && wholeTextRowSafe()) {
        result.excluded.push({
          row: rn,
          reason: 'صف عناوين مُكرر — استُبعد تلقائيًا',
          values: row,
        });
        continue;
      }
      if (sheet.rowIssues?.[rn]?.length)
        throw new Error(sheet.rowIssues[rn].join('؛ '));
      const mappedIssues = selected.flatMap(
        (column) => sheet.cellIssues?.[`${rn}:${column + 1}`] ?? [],
      );
      if (mapping.reference >= 0)
        mappedIssues.push(
          ...(sheet.referenceIssues?.[`${rn}:${mapping.reference + 1}`] ?? []),
        );
      if (mappedIssues.length) throw new Error(mappedIssues.join('؛ '));
      // Older in-memory sources have only row-level formula metadata. Parsed
      // Excel files carry precise cell issues, including formulas, instead.
      if (!sheet.cellIssues && formulaRows.has(rn))
        throw new Error(
          'الصف يحتوي معادلة. استخدم نسخة موثوقة بقيم ثابتة، أو استبعد الصف مع توضيح السبب.',
        );
      if (row.every((v) => !v.trim())) {
        result.excluded.push({ row: rn, reason: 'صف فارغ', values: row });
        continue;
      }
      if (hiddenRows.has(rn))
        result.warnings.push(`الصف ${rn} مخفي في المصدر وأُدرج في المقارنة`);
      const date = parseDate(get(row, mapping.date), mapping.dateFormat);
      if (
        date > cutoff ||
        (mapping.reportType === 'transactions' && start && date < start)
      ) {
        result.excluded.push({
          row: rn,
          reason:
            date > cutoff ? 'بعد تاريخ المقارنة' : 'قبل بداية الفترة المؤكدة',
          values: row,
        });
        continue;
      }
      if (
        mapping.currencyColumn >= 0 &&
        get(row, mapping.currencyColumn).toUpperCase() !==
          scope.currency.toUpperCase()
      )
        throw new Error('عملة الصف لا تطابق العملة المؤكدة');
      if (
        result.metadata.currency &&
        result.metadata.currency !== scope.currency
      )
        throw new Error(
          'عملة المصدر المعلنة لا تطابق العملة المؤكدة. لم تُحوّل مبالغ المصدر إلى عملة أخرى.',
        );
      const original =
        mapping.mode === 'signed'
          ? get(row, mapping.amount)
          : `${get(row, mapping.debit)} | ${get(row, mapping.credit)}`;
      const readAmount = (col: number, text: string) => {
        const native = sheet.numericCells?.[`${rn}:${col + 1}`];
        if (!native)
          return parseMoney(text, mapping.numberFormat, scope.decimals);
        if (/%/.test(native.format))
          throw new Error(
            'الخلية تحتوي نسبة مئوية وليست مبلغًا. حدد العمود الذي يحتوي قيمة المبلغ.',
          );
        // Excel numeric cells are locale-independent. Never interpret their decimal point as grouping.
        return parseMoney(String(native.value), 'dot', scope.decimals);
      };
      let amount: number;
      if (mapping.mode === 'signed')
        amount = readAmount(mapping.amount, original);
      else {
        const debit = get(row, mapping.debit);
        const credit = get(row, mapping.credit);
        if (!debit && !credit) throw new Error('المدين والدائن فارغان');
        const d = debit ? readAmount(mapping.debit, debit) : 0;
        const c = credit ? readAmount(mapping.credit, credit) : 0;
        if (d < 0 || c < 0)
          throw new Error(
            'توجد قيمة سالبة في عمود المدين أو الدائن. يلزم مصدر يوضح إشارات المبالغ.',
          );
        if (d !== 0 && c !== 0)
          throw new Error(
            'يحتوي الصف نفسه مبلغًا غير صفري في كل من المدين والدائن',
          );
        amount = d - c;
      }
      amount *= mapping.multiplier;
      const references = transactionReferences(sheet, mapping, row, rn);
      const reference = references.primaryReference;
      result.transactions.push({
        id: `${side}:${mapping.sheet}:${rn}`,
        side,
        row: rn,
        sheet: sheet.name,
        date,
        reference,
        normalizedReference: normalizeReference(reference),
        description: get(row, mapping.description),
        amount,
        amountMinor: amount,
        currency: scope.currency,
        ...references,
        originalAmount: original,
        ...(sheet.rowPages ? { sourcePage: sheet.rowPages[String(rn)] } : {}),
      });
    } catch (error) {
      result.errors.push({ row: rn, message: (error as Error).message });
    }
  }
  result.total = safeSum(result.transactions.map((t) => t.amount));
  enforceSourceScope(file, mapping, scope, result);
  collectGenericAccounts(file, mapping, scope, result);
  if (
    mapping.reportType === 'open-items' &&
    (!periodEvidenceValid ||
      (result.metadata.periodEnd && result.metadata.periodEnd !== cutoff))
  )
    result.errors.push({
      row: 0,
      message:
        'تاريخ لقطة البنود المفتوحة لا يطابق تاريخ القطع أو لم يُقرأ بثقة. لا يمكن إعادة بناء المتبقي التاريخي بحذف المستندات الأحدث.',
    });
  if (
    (result.metadata.currency && result.metadata.currency !== scope.currency) ||
    result.metadata.warnings.includes('METADATA_CONFLICT: currency')
  )
    result.errors.push({
      row: 0,
      message:
        'عملة الكشف تتعارض مع العملة المؤكدة أو مع عملة أخرى مذكورة في الملف. راجع نطاق التسوية والمصدر.',
    });
  if (!start) start = result.metadata.periodStart;
  try {
    result.opening = mapping.opening.trim()
      ? parseMoney(mapping.opening, mapping.numberFormat, scope.decimals)
      : result.metadata.openingBalance;
    result.closing = mapping.closing.trim()
      ? parseMoney(mapping.closing, mapping.numberFormat, scope.decimals)
      : result.metadata.closingBalance;
  } catch (error) {
    result.errors.push({
      row: 0,
      message: `الأرصدة: ${(error as Error).message}`,
    });
  }
  const explicitEmptyPeriod =
    result.transactions.length === 0 &&
    result.metadata.periodEnd === cutoff &&
    !!result.metadata.balanceRowReference.closing &&
    (mapping.reportType === 'open-items'
      ? result.metadata.closingBalance === 0
      : !!result.metadata.periodStart &&
        !!result.metadata.balanceRowReference.opening &&
        result.metadata.openingBalance === result.metadata.closingBalance);
  const hasData =
    (result.transactions.length > 0 || explicitEmptyPeriod) &&
    result.errors.length === 0;
  const arithmeticValid =
    hasData &&
    periodEvidenceValid &&
    !result.metadata.warnings.some((warning) =>
      /^BALANCE_VALUE_(?:CONFLICT|UNVERIFIED):/.test(warning),
    ) &&
    (!mapping.periodStart ||
      !result.metadata.periodStart ||
      mapping.periodStart === result.metadata.periodStart) &&
    result.closing !== null &&
    (mapping.reportType === 'open-items'
      ? result.total === result.closing
      : !!start &&
        result.opening !== null &&
        safeSum([result.opening, result.total]) === result.closing);
  result.balanceArithmeticStatus =
    result.closing === null ||
    (mapping.reportType === 'transactions' && result.opening === null)
      ? 'BALANCE_ROW_NOT_FOUND'
      : arithmeticValid
        ? 'BALANCE_ARITHMETIC_VERIFIED'
        : 'BALANCE_ARITHMETIC_FAILED';
  result.periodStatus =
    result.metadata.periodStart && result.metadata.periodEnd
      ? 'PERIOD_DETECTED'
      : 'PERIOD_NOT_DETECTED';
  result.coverageStatus = scope.coverageConfirmed
    ? 'PERIOD_COVERAGE_CONFIRMED'
    : 'PERIOD_COVERAGE_UNCONFIRMED';
  result.balanceValid = arithmeticValid && scope.coverageConfirmed;
  if (result.closing !== null) {
    const expected =
      mapping.reportType === 'open-items'
        ? result.total
        : result.opening !== null && start
          ? safeSum([result.opening, result.total])
          : null;
    if (expected !== null && expected !== result.closing)
      result.warnings.push(
        `عدم اتساق الرصيد: المحسوب ${money(expected, scope.decimals)}؛ المدخل ${money(result.closing, scope.decimals)}؛ الفرق ${money(safeSum([expected, -result.closing]), scope.decimals)}. راجع تغطية الفترة وإشارات المبالغ والصفوف المستبعدة.`,
      );
  }
  return result;
}
const key = (t: Transaction) => `${t.normalizedReference}\u0000${t.amount}`;
const explicitNumericDocument = (t: Transaction) =>
  (t.documentType === 'Invoice' || t.documentType === 'Credit Note') &&
  t.documentReference === t.reference &&
  /^\d{4,}$/.test(latinDigits(t.reference)) &&
  !t.referenceEvidenceIssues?.length;
const strongAutomaticReference = (t: Transaction) =>
  t.normalizedReference.length >= 4 &&
  ((/\p{L}/u.test(t.normalizedReference) &&
    /[0-9]/.test(t.normalizedReference)) ||
    explicitNumericDocument(t));
function indexBy(items: Transaction[], by: (t: Transaction) => string) {
  const map = new Map<string, Transaction[]>();
  for (const t of items) {
    const k = by(t);
    const bucket = map.get(k);
    if (bucket) bucket.push(t);
    else map.set(k, [t]);
  }
  return map;
}
export function compare(
  supplier: SourceResult,
  ledger: SourceResult,
  scope: Scope,
  decisions: Decision[] = [],
  rejected: string[] = [],
): Comparison {
  validateScope(scope);
  if (
    !scope.confirmed ||
    !scope.currency.trim() ||
    (scope.coverageConfirmed &&
      ![scope.supplier, scope.entity, scope.account].every((x) => x.trim()))
  )
    throw new Error(
      'أكد نطاق الملفين والعملة. عند طلب تسوية الأرصدة، أدخل أيضًا اسم المورد والجهة والحساب.',
    );
  if (!/^[A-Z]{3}$/.test(scope.currency))
    throw new Error('استخدم رمز عملة من ثلاثة أحرف لاتينية');
  if (
    !Number.isInteger(scope.dateWindow) ||
    scope.dateWindow < 0 ||
    scope.dateWindow > 7
  )
    throw new Error('يجب أن يكون فرق الأيام المسموح للمطابقة من 0 إلى 7 أيام.');
  if (supplier.mapping.reportType !== ledger.mapping.reportType)
    throw new Error(
      'لا يمكن مقارنة نوعين مختلفين من التقارير. اختر تقريرين من النوع نفسه.',
    );
  assertGenericAccountsCompatible(supplier, ledger);
  // Compare only identities with the same explicit role. A supplier's customer
  // account is not the AP system's vendor code, even when both are account IDs.
  for (const field of Object.keys(
    scopeColumnPatterns,
  ) as (keyof typeof scopeColumnPatterns)[]) {
    const a = supplier.metadata?.[field];
    const b = ledger.metadata?.[field];
    if (field !== 'currency' && a && b && identityKey(a) !== identityKey(b))
      throw new Error(
        `تعارض هوية نطاق الملفين (${field}). تحقق من المورد والجهة والحساب والعملة قبل المطابقة.`,
      );
  }
  if (
    decisions.length &&
    [...supplier.errors, ...ledger.errors].some((error) => error.row === 0)
  )
    throw new Error(
      'لا يمكن تجاوز خطأ منهجي في القراءة أو النطاق بقرار مطابقة يدوي. صحح معنى المبلغ أو نطاق المصدر أولًا.',
    );
  const evidencedEmpty = (source: SourceResult) =>
    source.transactions.length === 0 &&
    source.errors.length === 0 &&
    source.balanceArithmeticStatus === 'BALANCE_ARITHMETIC_VERIFIED' &&
    source.metadata?.periodEnd === scope.cutoff &&
    (source.mapping.reportType === 'open-items'
      ? source.closing === 0
      : !!source.metadata?.periodStart &&
        source.opening !== null &&
        source.opening === source.closing);
  if (
    [supplier, ledger].some(
      (source) => !source.transactions.length && !evidencedEmpty(source),
    )
  )
    throw new Error('لا توجد حركات كافية في أحد الطرفين');
  if (
    [...supplier.transactions, ...ledger.transactions].some(
      (t) => t.currency !== undefined && t.currency !== scope.currency,
    )
  )
    throw new Error(
      'عملة إحدى الحركات لا تطابق عملة نطاق المقارنة. صحح النطاق وأعد قراءة الملف.',
    );
  const a = indexBy(supplier.transactions, key),
    b = indexBy(ledger.transactions, key),
    refA = indexBy(supplier.transactions, (t) => t.normalizedReference),
    refB = indexBy(ledger.transactions, (t) => t.normalizedReference);
  const rejectedSet = new Set(rejected);
  const matches: Match[] = [],
    usedA = new Set<string>(),
    usedB = new Set<string>(),
    ambiguousIds: string[] = [];
  const byA = new Map(supplier.transactions.map((t) => [t.id, t])),
    byB = new Map(ledger.transactions.map((t) => [t.id, t]));
  for (const d of decisions) {
    const s = byA.get(d.supplierId),
      l = byB.get(d.ledgerId);
    if (
      !s ||
      !l ||
      usedA.has(s.id) ||
      usedB.has(l.id) ||
      !d.note.trim() ||
      s.amount !== l.amount
    )
      throw new Error(
        'تعذر اعتماد المطابقة اليدوية. يجب أن تتساوى المبالغ، وأن تكون الحركات غير مستخدمة، مع كتابة سبب القرار.',
      );
    matches.push({
      ...d,
      kind: 'manual',
      reason: 'أكد المحاسب هذا الربط. تأكيده لا يثبت صحة المستند أو سبب الفرق.',
    });
    usedA.add(s.id);
    usedB.add(l.id);
  }
  for (const t of [...supplier.transactions, ...ledger.transactions]) {
    if (
      t.normalizedReference &&
      ((t.side === 'supplier' ? refA : refB).get(t.normalizedReference)
        ?.length ?? 0) > 1
    )
      ambiguousIds.push(t.id);
  }
  // An unread row may contain another occurrence of the same reference. Without
  // all identities, uniqueness is not proven. Keep a review result, no auto links.
  const completeReading =
    supplier.errors.length === 0 && ledger.errors.length === 0;
  for (const s of supplier.transactions) {
    if (
      !completeReading ||
      s.referenceEvidenceIssues?.length ||
      usedA.has(s.id) ||
      !s.normalizedReference ||
      !strongAutomaticReference(s) ||
      s.amount === 0
    )
      continue;
    const ac = a.get(key(s))!,
      bc = b.get(key(s));
    if (
      ac.length !== 1 ||
      bc?.length !== 1 ||
      refA.get(s.normalizedReference)?.length !== 1 ||
      refB.get(s.normalizedReference)?.length !== 1
    )
      continue;
    const l = bc[0];
    if (l.referenceEvidenceIssues?.length) continue;
    // Numeric document IDs need explicit document-role evidence on BOTH sides.
    if (!strongAutomaticReference(l)) continue;
    if (
      explicitNumericDocument(s) &&
      (!explicitNumericDocument(l) || s.documentType !== l.documentType)
    )
      continue;
    if (identityConflicts(s, l).length) continue;
    if (s.reference.trim() !== l.reference.trim()) continue;
    if (usedB.has(l.id) || rejectedSet.has(`${s.id}|${l.id}`)) continue;
    const days = Math.abs(Date.parse(s.date) - Date.parse(l.date)) / 86400000;
    if (days <= scope.dateWindow) {
      matches.push({
        supplierId: s.id,
        ledgerId: l.id,
        kind: 'auto',
        reason: `المرجع الأصلي مطابق بكل رموزه، وغير مكرر في أي طرف. المبلغ وإشارته متطابقان، وفرق التاريخ ${days} يوم.`,
        evidence: {
          rule: 'EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2',
          supplierRow: s.row,
          ledgerRow: l.row,
          amount: s.amount,
          dateGap: days,
          reference: s.reference,
        },
      });
      usedA.add(s.id);
      usedB.add(l.id);
    }
  }
  const caseResult = buildReconciliationCases(
    supplier,
    ledger,
    scope,
    matches,
    rejected,
  );
  const cases = caseResult.cases;
  matches.splice(0, matches.length, ...caseResult.matches);
  const supplierOnly = cases
      .filter((c) => c.status === 'Unmatched')
      .flatMap((c) => c.supplierMembers),
    ledgerOnly = cases
      .filter((c) => c.status === 'Unmatched')
      .flatMap((c) => c.ledgerMembers);
  const matchedRows = new Set(
    cases
      .filter((c) => c.status === 'Matched')
      .flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)),
  );
  for (let i = ambiguousIds.length - 1; i >= 0; i--)
    if (matchedRows.has(ambiguousIds[i])) ambiguousIds.splice(i, 1);
  const suggestions: Record<string, string[]> = {};
  const unmatchedReferences = indexBy(ledgerOnly, (t) => t.normalizedReference);
  for (const s of supplierOnly) {
    if (s.normalizedReference)
      suggestions[s.id] = (unmatchedReferences.get(s.normalizedReference) ?? [])
        .slice(0, 20)
        .filter((l) => !usedB.has(l.id) && !rejectedSet.has(`${s.id}|${l.id}`))
        .slice(0, 20)
        .map((l) => l.id);
  }
  const arithmeticVerified = (source: SourceResult) =>
    source.balanceArithmeticStatus === 'BALANCE_ARITHMETIC_VERIFIED' ||
    (!source.balanceArithmeticStatus && source.balanceValid);
  const periodStart = (source: SourceResult) =>
    source.mapping.periodStart || source.metadata?.periodStart || '';
  const periodEnd = (source: SourceResult) =>
    source.metadata?.periodEnd || scope.cutoff;
  const periodsAligned =
    supplier.mapping.reportType === 'open-items' ||
    (!!periodStart(supplier) &&
      periodStart(supplier) === periodStart(ledger) &&
      periodEnd(supplier) === scope.cutoff &&
      periodEnd(ledger) === scope.cutoff);
  const arithmeticComparable =
    completeReading &&
    arithmeticVerified(supplier) &&
    arithmeticVerified(ledger) &&
    periodsAligned;
  const balanceComparable =
    arithmeticComparable && supplier.balanceValid && ledger.balanceValid;
  let bridge: Comparison['bridge'] = null;
  if (arithmeticComparable) {
    const openingAdjustment =
      supplier.mapping.reportType === 'transactions'
        ? safeSum([ledger.opening!, -supplier.opening!])
        : 0;
    const itemAdjustment = safeSum(cases.map((c) => c.bridgeEffect));
    const adjusted = safeSum([
      supplier.closing!,
      openingAdjustment,
      itemAdjustment,
    ]);
    bridge = {
      delta: safeSum([supplier.closing!, -ledger.closing!]),
      openingAdjustment,
      itemAdjustment,
      adjusted,
      residual: safeSum([adjusted, -ledger.closing!]),
    };
  }
  const diagnostics: Comparison['diagnostics'] = [];
  for (const t of [...supplier.transactions, ...ledger.transactions])
    if (t.referenceEvidenceIssues?.length)
      diagnostics.push({
        code: 'REFERENCE_EVIDENCE_UNVERIFIED',
        message: t.referenceEvidenceIssues.join('؛ '),
        transactionIds: [t.id],
      });
  for (const [source, label] of [
    [supplier, 'المورد'],
    [ledger, 'الدفتر'],
  ] as const) {
    if (source.errors.length)
      diagnostics.push({
        code: 'SKIPPED_ROWS',
        message: `${label}: ${source.errors.length} صفًا لم تُقرأ ولم تدخل المقارنة. المقارنة غير مكتملة. أُوقفت المطابقات الآلية لأن الصف غير المقروء قد يحتوي مرجعًا مكررًا. صحح القراءة أو وثّق الاستبعاد.`,
        transactionIds: [],
      });
    for (const warning of source.warnings)
      diagnostics.push({
        code: 'SOURCE_WARNING',
        message: `${label}: ${warning}`,
        transactionIds: [],
      });
    diagnostics.push({
      code:
        source.balanceArithmeticStatus ??
        (source.balanceValid
          ? 'BALANCE_ARITHMETIC_VERIFIED'
          : 'BALANCE_ROW_NOT_FOUND'),
      message: `${label}: ${arithmeticVerified(source) ? 'معادلة الرصيد متحققة من الرصيد الافتتاحي والحركات والرصيد الختامي.' : source.closing === null ? 'لم يُستخرج رصيد كافٍ لاختبار المعادلة.' : 'لم تتحقق معادلة الرصيد. راجع المصدر وإشارات المبالغ والفترة.'}`,
      transactionIds: [],
    });
    if (source.metadata?.periodStart && source.metadata?.periodEnd)
      diagnostics.push({
        code: 'PERIOD_DETECTED',
        message: `${label}: الفترة المعلنة ${source.metadata.periodStart} إلى ${source.metadata.periodEnd}.`,
        transactionIds: [],
      });
    if (!scope.coverageConfirmed)
      diagnostics.push({
        code: 'PERIOD_COVERAGE_UNCONFIRMED',
        message: `${label}: لم يؤكد المستخدم بعد اكتمال تغطية الفترة. هذا لا يغيّر نتيجة اختبار معادلة الرصيد.`,
        transactionIds: [],
      });
  }
  for (const c of cases.filter((c) => c.status !== 'Unmatched'))
    diagnostics.push({
      code: c.classification,
      message: c.evidence.join('\n'),
      transactionIds: c.sourceTrace.map((t) => t.sourceRowId),
    });
  const ambiguousSet = new Set(ambiguousIds);
  for (const s of supplierOnly) {
    const candidates = (refB.get(s.normalizedReference) ?? []).slice(0, 20);
    const ids = [s.id, ...candidates.slice(0, 20).map((t) => t.id)];
    const add = (code: string, message: string) =>
      diagnostics.push({ code, message, transactionIds: ids });
    if (
      ambiguousSet.has(s.id) ||
      candidates.some((t) => ambiguousSet.has(t.id))
    )
      add(
        'DUPLICATE_REFERENCE',
        'المرجع متكرر. تساوي المبالغ أو ترتيب الصفوف لا يكفي لحسم هذا التكرار.',
      );
    if (candidates.some((t) => t.amount === -s.amount && s.amount !== 0))
      add(
        'SIGN_CONFLICT',
        'يوجد مرجع متشابه ومبلغ بالقيمة نفسها لكن بإشارة معاكسة. لا يغيّر المحرك إشارة المبلغ تلقائيًا.',
      );
    if (candidates.some((t) => t.reference.trim() !== s.reference.trim()))
      add(
        'REFERENCE_VARIANT',
        'يتشابه المرجعان بعد توحيد كتابتهما فقط. اختلاف الرموز أو الحروف يحتاج إلى مراجعة.',
      );
    if (candidates.some((t) => t.amount !== s.amount))
      add(
        'AMOUNT_DIFFERENCE',
        'توجد حركة بمرجع متشابه، لكن مبلغها بإشارته مختلف.',
      );
    if (
      candidates.some(
        (t) =>
          Math.abs(Date.parse(t.date) - Date.parse(s.date)) / 86400000 >
          scope.dateWindow,
      )
    )
      add('DATE_GAP', 'فرق التاريخ يتجاوز فرق الأيام المسموح للمطابقة.');
    if (!candidates.length)
      add(
        'NO_REFERENCE_CANDIDATE',
        'لا يوجد مرجع مقابل في الملف المقدم. هذا لا يثبت غياب المستند عن النظام المحاسبي.',
      );
  }
  for (const l of ledgerOnly) {
    diagnostics.push({
      code: 'NO_SUPPLIER_COUNTERPART',
      message:
        'لم يُعثر في الملفات المقدمة على حركة مورد تصلح مقابلًا لهذه الحركة.',
      transactionIds: [l.id],
    });
    if (ambiguousIds.includes(l.id))
      diagnostics.push({
        code: 'DUPLICATE_REFERENCE',
        message: 'مرجع الدفتر متكرر ولم تثبت مجموعة مطابقة فريدة.',
        transactionIds: [l.id],
      });
  }
  return {
    cases,
    caseCounts: caseResult.caseCounts,
    diagnostics,
    supplier,
    ledger,
    scope,
    matches,
    supplierOnly,
    ledgerOnly,
    ambiguousIds,
    suggestions,
    rejectedPairs: [...rejected],
    balanceComparable,
    bridge,
  };
}
