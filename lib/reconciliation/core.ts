import { defaultMapping } from './types.ts';
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
  if (![0, 2, 3].includes(decimals)) throw new Error('دقة العملة غير مدعومة');
  let s = latinDigits(String(value)).trim().replace(/−/g, '-');
  if (!s) throw new Error('مبلغ فارغ');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-') || s.startsWith('+')) {
    if (negative) throw new Error('إشارة مزدوجة');
    negative = s[0] === '-';
    s = s.slice(1);
  }
  s = s
    .replace(/٬/g, format === 'dot' ? ',' : '.')
    .replace(/٫/g, format === 'dot' ? '.' : ',');
  const sep = format === 'dot' ? '.' : ',';
  const group = format === 'dot' ? ',' : '.';
  const pieces = s.split(sep);
  if (pieces.length > 2) throw new Error('فواصل مبلغ غير صحيحة');
  let whole = pieces[0],
    fraction = pieces[1] ?? '';
  if (whole.includes(group)) {
    const groups = whole.split(group);
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((g) => !/^\d{3}$/.test(g))
    )
      throw new Error('تجميع الآلاف غير صحيح');
    whole = groups.join('');
  }
  if (
    !/^\d+$/.test(whole) ||
    !/^\d*$/.test(fraction) ||
    (pieces.length === 2 && !fraction) ||
    fraction.length > decimals
  )
    throw new Error('مبلغ غير صالح أو منازل عشرية أكثر من دقة العملة');
  const n = Number(
    BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, '0') || '0'),
  );
  if (!Number.isSafeInteger(n) || n > 1e14)
    throw new Error('مبلغ يتجاوز الحد الآمن');
  return negative ? -n : n;
}
export function safeSum(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || Math.abs(v) > 1e14)
      throw new Error('قيمة غير صحيحة في الإجمالي');
    sum += v;
    if (!Number.isSafeInteger(sum) || Math.abs(sum) > 1e14)
      throw new Error('الإجمالي يتجاوز الحد الآمن');
  }
  return sum;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, m, d] = s.split('-').map(Number);
  else {
    const p = s.split(/[\/.-]/);
    if (p.length !== 3 || p.some((x) => !/^\d+$/.test(x)))
      throw new Error('تاريخ غير صالح؛ حدد صيغة التاريخ');
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
    throw new Error('يوم غير موجود في التقويم');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function normalizeReference(s: string): string {
  return latinDigits(s)
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s\-/]/g, '');
}
export function inferMapping(
  file: SourceFile,
  sheet = 0,
  header?: number,
): Mapping {
  const m = defaultMapping();
  m.sheet = sheet;
  const patterns = {
    date: /^(date|transaction date|posting date|invoice date|التاريخ|تاريخ الحركة|تاريخ المستند)$/i,
    reference:
      /^(reference|invoice|invoice no\.?|invoice number|document reference|document no\.?|المرجع|رقم الفاتورة|رقم المستند)$/i,
    description: /^(description|details|البيان|الوصف)$/i,
    amount:
      /^(amount|signed amount|outstanding|remaining|المبلغ|المتبقي|الرصيد المتبقي)$/i,
    debit: /^(debit|مدين)$/i,
    credit: /^(credit|دائن)$/i,
    currencyColumn: /^(currency|العملة)$/i,
  };
  const rows = file.sheets[sheet]?.rows ?? [];
  m.header =
    header ??
    rows.slice(0, 20).reduce((best, row, i) => {
      const score = (r: string[]) =>
        r.filter((c) => Object.values(patterns).some((p) => p.test(c.trim())))
          .length;
      return score(row) > score(rows[best] ?? []) ? i : best;
    }, 0);
  for (const [key, regex] of Object.entries(patterns))
    m[key as keyof typeof patterns] = (rows[m.header] ?? []).findIndex((c) =>
      regex.test(c.trim()),
    );
  if (m.amount < 0 && m.debit >= 0 && m.credit >= 0) m.mode = 'split';
  return m;
}
export function normalizeSource(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  side: 'supplier' | 'ledger',
): SourceResult {
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
      throw new Error('عمود خارج حدود العناوين');
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
  if (file.pdf && (mapping.pdfReviewed !== true || !file.pdf.cuts.length))
    throw new Error(
      'حدد حدود أعمدة PDF وراجع الصفوف المستخرجة مع الأصل، ثم أكد مراجعة الاستخراج',
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
    throw new Error('لا يمكن استخدام العمود نفسه لأكثر من معنى');
  if (
    mapping.date < 0 ||
    (mapping.mode === 'signed'
      ? mapping.amount < 0
      : mapping.debit < 0 || mapping.credit < 0)
  )
    throw new Error('حدد أعمدة التاريخ والمبلغ أو المدين والدائن');
  const cutoff = parseDate(scope.cutoff, 'ymd');
  let start = '';
  if (mapping.periodStart) start = parseDate(mapping.periodStart, 'ymd');
  if (start && start > cutoff) throw new Error('بداية الفترة بعد تاريخ القطع');
  const get = (row: string[], col: number) =>
    col < 0 ? '' : (row[col] ?? '').trim();
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
    if (row.every((v) => !v.trim())) {
      result.excluded.push({ row: rn, reason: 'صف فارغ', values: row });
      continue;
    }
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
          'قيم إضافية خارج أعمدة العناوين؛ تحقق من فاصل CSV وبنية الصف',
        );
      if (sheet.rowIssues?.[rn]?.length)
        throw new Error(sheet.rowIssues[rn].join('؛ '));
      if (formulaRows.has(rn))
        throw new Error(
          'الصف يحتوي صيغة؛ استخدم نسخة قيم ثابتة موثوقة أو استبعده مع سبب',
        );
      if (hiddenRows.has(rn))
        result.warnings.push(`الصف ${rn} مخفي في المصدر وأُدرج في المقارنة`);
      if (
        row.some((v) =>
          /^(total|subtotal|grand total|opening balance|closing balance|balance brought forward|المجموع|الإجمالي|الرصيد الافتتاحي|الرصيد الختامي|رصيد افتتاحي|رصيد ختامي)$/i.test(
            v.trim(),
          ),
        )
      )
        throw new Error(
          'صف إجمالي أو رصيد محتمل؛ راجعه واستبعده صراحة إن لم يكن حركة',
        );
      const date = parseDate(get(row, mapping.date), mapping.dateFormat);
      if (
        date > cutoff ||
        (mapping.reportType === 'transactions' && start && date < start)
      ) {
        result.excluded.push({
          row: rn,
          reason:
            date > cutoff ? 'بعد تاريخ القطع' : 'قبل بداية الفترة المؤكدة',
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
      const original =
        mapping.mode === 'signed'
          ? get(row, mapping.amount)
          : `${get(row, mapping.debit)} | ${get(row, mapping.credit)}`;
      const readAmount = (col: number, text: string) => {
        const native = sheet.numericCells?.[`${rn}:${col + 1}`];
        if (!native)
          return parseMoney(text, mapping.numberFormat, scope.decimals);
        if (/%/.test(native.format))
          throw new Error('خلية نسبة مئوية لا تصلح مبلغًا؛ حدد عمود القيمة');
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
            'قيمة سالبة في أعمدة مدين/دائن؛ يلزم مصدر بإشارات واضحة',
          );
        if (d !== 0 && c !== 0)
          throw new Error('مدين ودائن غير صفريين في الصف نفسه');
        amount = d - c;
      }
      amount *= mapping.multiplier;
      const reference = get(row, mapping.reference);
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
        originalAmount: original,
        ...(sheet.rowPages ? { sourcePage: sheet.rowPages[String(rn)] } : {}),
      });
    } catch (error) {
      result.errors.push({ row: rn, message: (error as Error).message });
    }
  }
  result.total = safeSum(result.transactions.map((t) => t.amount));
  try {
    result.opening = mapping.opening.trim()
      ? parseMoney(mapping.opening, mapping.numberFormat, scope.decimals)
      : null;
    result.closing = mapping.closing.trim()
      ? parseMoney(mapping.closing, mapping.numberFormat, scope.decimals)
      : null;
  } catch (error) {
    result.errors.push({
      row: 0,
      message: `الأرصدة: ${(error as Error).message}`,
    });
  }
  const hasData = result.transactions.length > 0 && result.errors.length === 0;
  result.balanceValid =
    hasData &&
    scope.coverageConfirmed &&
    result.closing !== null &&
    (mapping.reportType === 'open-items'
      ? result.total === result.closing
      : !!start &&
        result.opening !== null &&
        safeSum([result.opening, result.total]) === result.closing);
  if (result.closing !== null) {
    const expected =
      mapping.reportType === 'open-items'
        ? result.total
        : result.opening !== null && start
          ? safeSum([result.opening, result.total])
          : null;
    if (expected !== null && expected !== result.closing)
      result.warnings.push(
        `عدم اتساق الرصيد: المحسوب ${money(expected, scope.decimals)}؛ المدخل ${money(result.closing, scope.decimals)}؛ الفرق ${money(safeSum([expected, -result.closing]), scope.decimals)}. راجع التغطية والإشارات والاستبعادات.`,
      );
  }
  return result;
}
const key = (t: Transaction) => `${t.normalizedReference}\u0000${t.amount}`;
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
  if (
    !scope.confirmed ||
    ![scope.supplier, scope.entity, scope.account, scope.currency].every((x) =>
      x.trim(),
    )
  )
    throw new Error('أكد المورد والجهة والحساب والعملة أولًا');
  if (!/^[A-Z]{3}$/.test(scope.currency))
    throw new Error('استخدم رمز عملة من ثلاثة أحرف لاتينية');
  if (
    !Number.isInteger(scope.dateWindow) ||
    scope.dateWindow < 0 ||
    scope.dateWindow > 7
  )
    throw new Error('نافذة التاريخ من 0 إلى 7 أيام');
  if (supplier.mapping.reportType !== ledger.mapping.reportType)
    throw new Error('الزوج المختلط غير مدعوم. اختر تقريرين من النوع نفسه');
  if (supplier.errors.length || ledger.errors.length)
    throw new Error(
      'صحح أخطاء القراءة أو استبعد الصفوف مع توثيق السبب قبل المطابقة',
    );
  if (!supplier.transactions.length || !ledger.transactions.length)
    throw new Error('لا توجد حركات كافية في أحد الطرفين');
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
        'مطابقة يدوية غير صالحة: يلزم مبلغ متساوٍ وسبب وحركات غير مستخدمة',
      );
    matches.push({
      ...d,
      kind: 'manual',
      reason: 'تأكيد المحاسب؛ لا يثبت صحة المستند أو سبب الفرق',
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
  for (const s of supplier.transactions) {
    if (
      usedA.has(s.id) ||
      !s.normalizedReference ||
      s.normalizedReference.length < 4 ||
      !/[\p{L}]/u.test(s.normalizedReference) ||
      !/[0-9]/.test(s.normalizedReference) ||
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
    if (s.reference.trim() !== l.reference.trim()) continue;
    if (usedB.has(l.id) || rejectedSet.has(`${s.id}|${l.id}`)) continue;
    const days = Math.abs(Date.parse(s.date) - Date.parse(l.date)) / 86400000;
    if (days <= scope.dateWindow) {
      matches.push({
        supplierId: s.id,
        ledgerId: l.id,
        kind: 'auto',
        reason: `مرجع أصلي مطابق دون حذف رموزه؛ غير مكرر في كل طرف؛ مبلغ موقّع مطابق؛ فرق التاريخ ${days} يوم`,
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
  const supplierOnly = supplier.transactions.filter((t) => !usedA.has(t.id)),
    ledgerOnly = ledger.transactions.filter((t) => !usedB.has(t.id));
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
  const balanceComparable =
    supplier.balanceValid &&
    ledger.balanceValid &&
    (supplier.mapping.reportType === 'open-items' ||
      supplier.mapping.periodStart === ledger.mapping.periodStart);
  let bridge: Comparison['bridge'] = null;
  if (balanceComparable) {
    const openingAdjustment =
      supplier.mapping.reportType === 'transactions'
        ? safeSum([ledger.opening!, -supplier.opening!])
        : 0;
    const itemAdjustment = safeSum([
      ...ledgerOnly.map((t) => t.amount),
      ...supplierOnly.map((t) => -t.amount),
    ]);
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
  for (const [source, label] of [
    [supplier, 'المورد'],
    [ledger, 'الدفتر'],
  ] as const) {
    for (const warning of source.warnings)
      diagnostics.push({
        code: 'SOURCE_WARNING',
        message: `${label}: ${warning}`,
        transactionIds: [],
      });
    if (!source.balanceValid)
      diagnostics.push({
        code: 'BALANCE_UNVERIFIED',
        message: `${label}: اتساق الرصيد أو التغطية غير متحقق.`,
        transactionIds: [],
      });
  }
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
        'المرجع متكرر؛ لا يُحسم التكرار بالمبلغ أو ترتيب الصفوف.',
      );
    if (candidates.some((t) => t.amount === -s.amount && s.amount !== 0))
      add(
        'SIGN_CONFLICT',
        'مرجع متشابه وقيمة مطلقة متساوية بإشارتين مختلفتين؛ لا يقلب المحرك الإشارة تلقائيًا.',
      );
    if (candidates.some((t) => t.reference.trim() !== s.reference.trim()))
      add(
        'REFERENCE_VARIANT',
        'تشابه بعد توحيد المرجع فقط؛ اختلاف الرموز أو الحروف يحتاج مراجعة.',
      );
    if (candidates.some((t) => t.amount !== s.amount))
      add('AMOUNT_DIFFERENCE', 'مبلغ موقّع مختلف لدى مرشح يحمل مرجعًا متشابهًا.');
    if (
      candidates.some(
        (t) =>
          Math.abs(Date.parse(t.date) - Date.parse(s.date)) / 86400000 >
          scope.dateWindow,
      )
    )
      add('DATE_GAP', 'فرق التاريخ يتجاوز النافذة المؤكدة.');
    if (!candidates.length)
      add(
        'NO_REFERENCE_CANDIDATE',
        'لا يوجد مرجع مقابل في الملف المقدم؛ هذا لا يثبت غياب المستند عن النظام.',
      );
  }
  return {
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
