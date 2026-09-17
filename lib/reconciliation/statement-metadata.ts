import {
  parseDate,
  parseMoney,
  safeSum,
  structuralSummaryLabel,
  inlineBalanceSummary,
} from './core.ts';
import type { Mapping, Scope, SourceFile } from './types.ts';

export type BalanceRowReference = {
  sheet: string;
  row: number;
  page?: number;
  column?: number;
  originalValue: string;
  method?: 'literal' | 'formula-evaluated' | 'mapped-opening';
  formula?: string;
  formulaReferences?: string[];
};
export type StatementMetadata = {
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string;
  periodEnd: string;
  supplierStatementAccount: string;
  supplierCode: string;
  apControlAccount: string;
  supplierName: string;
  entityName: string;
  currency: string;
  balanceRowReference: {
    opening?: BalanceRowReference;
    closing?: BalanceRowReference;
  };
  evidence: (BalanceRowReference & { field: string; value: string | number })[];
  warnings: string[];
};

const openingLabel =
  /^(?:opening balance|balance b\/f|balance brought forward|الرصيد الافتتاحي|رصيد افتتاحي)\s*[:：]?$/i;
const closingLabel =
  /^(?:closing (?:ap )?balance|balance c\/f|balance carried forward|الرصيد الختامي|رصيد ختامي)\s*[:：]?$/i;
const balanceHeader =
  /^(?:running(?: ap)? balance|الرصيد الجاري|الرصيد المتحرك|الرصيد التراكمي)(?:\s*\([a-z]{3}\))?$/i;
const normalizeLabel = (text: string) =>
  text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[:：]$/, '')
    .toLowerCase();
const labels: Record<string, keyof StatementMetadata | 'period'> = {
  supplier: 'supplierName',
  'supplier name': 'supplierName',
  vendor: 'supplierName',
  'اسم المورد': 'supplierName',
  customer: 'entityName',
  entity: 'entityName',
  'legal entity': 'entityName',
  'اسم العميل': 'entityName',
  الكيان: 'entityName',
  'customer a/c': 'supplierStatementAccount',
  'customer account': 'supplierStatementAccount',
  'supplier statement account': 'supplierStatementAccount',
  'حساب العميل': 'supplierStatementAccount',
  'supplier code': 'supplierCode',
  'vendor code': 'supplierCode',
  'رمز المورد': 'supplierCode',
  'control account': 'apControlAccount',
  'ap control account': 'apControlAccount',
  'حساب مراقبة الموردين': 'apControlAccount',
  currency: 'currency',
  العملة: 'currency',
  period: 'period',
  'statement period': 'period',
  'فترة الكشف': 'period',
  الفترة: 'period',
  'as of': 'periodEnd',
  'statement as of': 'periodEnd',
  'cut-off': 'periodEnd',
  cutoff: 'periodEnd',
  'cut-off date': 'periodEnd',
  'cutoff date': 'periodEnd',
  'period end': 'periodEnd',
  'تاريخ القطع': 'periodEnd',
  'حتى تاريخ': 'periodEnd',
  'نهاية الفترة': 'periodEnd',
};
const otherLabels =
  /^(?:statement no\.?|supplier vat no\.?|payment terms|prepared date|ledger|erp source)$/i;
const formulaIssue = (message: string) => /^صيغة Excel في /.test(message);
const mergedIssue = (message: string) => /^خلية مدمجة في /.test(message);
const boundaryIssue = (message: string) => /^نص يعبر حد عمود/.test(message);

/** Balance/identity evidence remains separate from transaction inclusion and user coverage approval. */
export function extractStatementMetadata(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
): StatementMetadata {
  const result: StatementMetadata = {
    openingBalance: null,
    closingBalance: null,
    periodStart: '',
    periodEnd: '',
    supplierStatementAccount: '',
    supplierCode: '',
    apControlAccount: '',
    supplierName: '',
    entityName: '',
    currency: '',
    balanceRowReference: {},
    evidence: [],
    warnings: [],
  };
  const sheet = file.sheets[mapping.sheet];
  if (
    !sheet ||
    !Number.isInteger(mapping.header) ||
    mapping.header < 0 ||
    mapping.header >= sheet.rows.length
  )
    return result;
  const headers = sheet.rows[mapping.header];
  const hidden = new Set(sheet.hiddenRows);
  const formulaRows = new Set(sheet.formulaRows);
  const ref = (
    row: number,
    column: number,
    originalValue: string,
  ): BalanceRowReference => ({
    sheet: sheet.name,
    row: row + 1,
    column: column + 1,
    originalValue,
    ...(sheet.rowPages?.[String(row + 1)]
      ? { page: sheet.rowPages[String(row + 1)] }
      : {}),
  });
  const rowSafe = (row: number, metadata = false) =>
    !hidden.has(row + 1) &&
    !(sheet.rowIssues?.[String(row + 1)] ?? []).some(
      (issue) => !(metadata && file.pdf && boundaryIssue(issue)),
    );
  const cellSafe = (
    row: number,
    column: number,
    options: { metadata?: boolean; formula?: boolean; merged?: boolean } = {},
  ) =>
    rowSafe(row, options.metadata) &&
    !(sheet.cellIssues?.[`${row + 1}:${column + 1}`] ?? []).some(
      (issue) =>
        !(options.formula && formulaIssue(issue)) &&
        !(options.merged && mergedIssue(issue)),
    ) &&
    !(!sheet.cellIssues && formulaRows.has(row + 1));
  const unique = new Map<string, Map<string, string>>();
  const blockedFields = new Set<string>();
  const balances: Record<
    'opening' | 'closing',
    { value: number; reference: BalanceRowReference }[]
  > = { opening: [], closing: [] };
  const invalidBalances = new Set<'opening' | 'closing'>();
  const readInlineBalance = (row: number): boolean => {
    const inline = inlineBalanceSummary(sheet.rows[row], mapping);
    if (!inline) return false;
    const kind = openingLabel.test(inline.label) ? 'opening' : 'closing';
    try {
      if (!cellSafe(row, inline.column, { metadata: true, merged: true }))
        throw new Error('خلية رصيد غير موثوقة');
      if (inline.currency && inline.currency !== scope.currency) {
        result.warnings.push(
          `BALANCE_CURRENCY_MISMATCH: ${sheet.name}، صف ${row + 1}: ${inline.currency} / ${scope.currency}`,
        );
        throw new Error('عملة الرصيد لا تطابق النطاق');
      }
      balances[kind].push({
        value: parseMoney(inline.amount, mapping.numberFormat, scope.decimals),
        reference: {
          ...ref(row, inline.column, inline.original),
          method: 'literal',
        },
      });
    } catch (error) {
      invalidBalances.add(kind);
      result.warnings.push(
        `BALANCE_VALUE_UNVERIFIED: ${sheet.name}، صف ${row + 1}: ${error instanceof Error ? error.message : 'تعذر التحقق'}`,
      );
    }
    return true;
  };
  const addText = (
    field: string,
    value: string,
    source: BalanceRowReference,
  ) => {
    const entries = unique.get(field) ?? new Map<string, string>();
    entries.set(value, value);
    unique.set(field, entries);
    result.evidence.push({ ...source, field, value, method: 'literal' });
  };
  const readDate = (text: string): string => {
    const alternatives = new Set<string>();
    for (const format of ['ymd', 'dmy', 'mdy'] as const) {
      try {
        alternatives.add(parseDate(text, format));
      } catch {
        /* Unsupported interpretation. */
      }
    }
    if (alternatives.size !== 1)
      throw new Error('تاريخ فترة ملتبس أو غير صالح');
    return [...alternatives][0];
  };
  const readLabel = (
    label: string,
    value: string,
    source: BalanceRowReference,
  ) => {
    const field = labels[normalizeLabel(label)];
    if (!field || !value.trim()) return;
    value = value.trim();
    if (field === 'period') {
      const pieces = value
        .replace(/^(?:from|من)\s+/i, '')
        .split(/\s+(?:to|until|through|إلى|الى|حتى|[-–—])\s+/i);
      try {
        if (pieces.length !== 2) throw new Error('فترة غير صريحة');
        const start = readDate(pieces[0]);
        const end = readDate(pieces[1]);
        if (start > end) throw new Error('بداية الفترة بعد نهايتها');
        addText('periodStart', start, source);
        addText('periodEnd', end, source);
      } catch {
        blockedFields.add('periodStart');
        blockedFields.add('periodEnd');
        result.warnings.push(`PERIOD_INVALID: ${sheet.name}، صف ${source.row}`);
      }
    } else if (field === 'periodEnd') {
      try {
        addText(field, readDate(value), source);
      } catch {
        blockedFields.add(field);
        result.warnings.push(`PERIOD_INVALID: ${sheet.name}، صف ${source.row}`);
      }
    } else if (field === 'currency') {
      if (/^[A-Z]{3}$/i.test(value))
        addText(field, value.toUpperCase(), source);
      else {
        blockedFields.add('currency');
        result.warnings.push(
          `CURRENCY_INVALID: ${sheet.name}، صف ${source.row}`,
        );
      }
    } else addText(field, value, source);
  };
  for (let row = 0; row < mapping.header; row++) {
    if (!rowSafe(row, true)) continue;
    if (readInlineBalance(row)) continue;
    // A PDF's pre-table line is not governed by its table column boundaries.
    // Rejoin intact cell strings with spaces; never concatenate amount fragments.
    const fullLine = sheet.rows[row]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');
    const inlineNames = [
      ...Object.keys(labels),
      'account',
      'statement no',
      'supplier vat no',
      'payment terms',
      'prepared date',
      'ledger',
      'erp source',
    ];
    const escaped = inlineNames
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|');
    const labeled = [
      ...fullLine.matchAll(
        new RegExp(`(?:^|\\s+)(${escaped})\\s*[:：]\\s*`, 'giu'),
      ),
    ];
    if (
      file.pdf &&
      labeled.length &&
      labeled[0].index === 0 &&
      sheet.rows[row].every((_, col) =>
        cellSafe(row, col, { metadata: true, merged: true }),
      )
    ) {
      for (const [index, part] of labeled.entries()) {
        const value = fullLine
          .slice(
            part.index! + part[0].length,
            labeled[index + 1]?.index ?? fullLine.length,
          )
          .trim();
        if (!labels[normalizeLabel(part[1])]) continue;
        const column = sheet.rows[row].findIndex((cell) =>
          cell.toLowerCase().includes(part[1].toLowerCase()),
        );
        readLabel(part[1], value, {
          ...ref(row, Math.max(0, column), fullLine),
          ...(column < 0 ? { column: undefined } : {}),
        });
      }
      continue;
    }
    for (let col = 0; col < sheet.rows[row].length; col++) {
      const text = sheet.rows[row][col].trim();
      if (!cellSafe(row, col, { metadata: true, merged: true })) continue;
      const inline = /^([^:：]+)[:：]\s*(.+)$/.exec(text);
      if (inline && labels[normalizeLabel(inline[1])]) {
        readLabel(inline[1], inline[2], ref(row, col, text));
        continue;
      }
      if (!labels[normalizeLabel(text)]) continue;
      // PDF column cuts can leave empty spacer cells in the report metadata.
      const next = sheet.rows[row].findIndex(
        (value, i) => i > col && value.trim(),
      );
      if (next < 0) continue;
      const value = sheet.rows[row][next].trim();
      if (
        labels[normalizeLabel(value)] ||
        otherLabels.test(value) ||
        !cellSafe(row, next, { metadata: true, merged: true })
      )
        continue;
      readLabel(text, value, ref(row, next, sheet.rows[row][next]));
    }
  }
  for (const [field, values] of unique) {
    if (values.size === 1 && !blockedFields.has(field))
      (result as unknown as Record<string, unknown>)[field] = [
        ...values.values(),
      ][0];
    else if (values.size > 1)
      result.warnings.push(`METADATA_CONFLICT: ${field}`);
  }
  if (
    blockedFields.has('currency') ||
    (unique.get('currency')?.size ?? 0) > 1
  ) {
    result.warnings.push('BALANCE_CURRENCY_UNVERIFIED');
    return result;
  }
  if (result.currency && result.currency !== scope.currency.toUpperCase()) {
    result.warnings.push(
      `BALANCE_CURRENCY_MISMATCH: ${result.currency} / ${scope.currency}`,
    );
    return result;
  }

  const memo = new Map<string, { amount: number; references: string[] }>();
  const verifyBalanceCurrency = (row: number, column: number) => {
    const codes = [...(headers[column] ?? '').matchAll(/\(([A-Z]{3})\)/gi)].map(
      (match) => match[1].toUpperCase(),
    );
    if (codes.some((code) => code !== scope.currency.toUpperCase())) {
      const warning = `BALANCE_CURRENCY_MISMATCH: ${sheet.name}، صف ${row + 1}، عمود ${column + 1}: ${codes.join(' / ')} / ${scope.currency}`;
      if (!result.warnings.includes(warning)) result.warnings.push(warning);
      throw new Error('عملة عمود الرصيد لا تطابق العملة المؤكدة');
    }
  };
  let visited = 0;
  const evaluate = (
    row: number,
    column: number,
    active = new Set<string>(),
  ): { amount: number; references: string[] } => {
    const key = `${row + 1}:${column + 1}`;
    if (memo.has(key)) return memo.get(key)!;
    if (++visited > 20000 || active.size > 200 || active.has(key))
      throw new Error('صيغة دورية أو تتجاوز حد التحقق');
    if (
      row < 0 ||
      row >= sheet.rows.length ||
      column < 0 ||
      column >= headers.length
    )
      throw new Error('مرجع صيغة خارج الجدول');
    verifyBalanceCurrency(row, column);
    const expression = sheet.formulaCells?.[key]?.formula;
    if (!cellSafe(row, column, { formula: !!expression }))
      throw new Error('خلية مبلغ غير موثوقة');
    if (!expression) {
      const native = sheet.numericCells?.[key];
      if (!native || /%/.test(native.format))
        throw new Error('الصيغة لا تستند إلى خلية رقمية أصلية');
      const value = {
        amount: parseMoney(String(native.value), 'dot', scope.decimals),
        references: [key],
      };
      memo.set(key, value);
      return value;
    }
    const formula = expression.trim().replace(/^=/, '').replace(/\s+/g, '');
    if (
      formula.length > 512 ||
      !/^\$?[A-Z]{1,3}\$?[1-9]\d*(?:[+-]\$?[A-Z]{1,3}\$?[1-9]\d*)*$/i.test(
        formula,
      )
    )
      throw new Error('صيغة الرصيد خارج قواعد الجمع والطرح المدعومة');
    const nextActive = new Set(active).add(key);
    const terms = [...formula.matchAll(/([+-]?)(\$?[A-Z]{1,3}\$?[1-9]\d*)/gi)];
    const values: number[] = [];
    const references = new Set<string>();
    for (const term of terms) {
      const coordinate = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(term[2])!;
      const col =
        [...coordinate[1].toUpperCase()].reduce(
          (n, char) => n * 26 + char.charCodeAt(0) - 64,
          0,
        ) - 1;
      const dependency = evaluate(Number(coordinate[2]) - 1, col, nextActive);
      values.push(term[1] === '-' ? -dependency.amount : dependency.amount);
      references.add(`${Number(coordinate[2])}:${col + 1}`);
      dependency.references.forEach((source) => references.add(source));
    }
    const computed = { amount: safeSum(values), references: [...references] };
    const displayed = sheet.rows[row][column]?.trim();
    if (
      displayed &&
      // Cached numeric formula results are serialized by ExcelJS as native
      // decimal strings, independently of the text-column locale selected.
      parseMoney(displayed, 'dot', scope.decimals) !== computed.amount
    )
      throw new Error(
        'FORMULA_CACHE_MISMATCH: نتيجة الصيغة المخزنة تخالف إعادة الحساب',
      );
    memo.set(key, computed);
    return computed;
  };
  const amount = (
    row: number,
    column: number,
    allowBoundary = false,
  ): { value: number; reference: BalanceRowReference } => {
    verifyBalanceCurrency(row, column);
    const original = sheet.rows[row]?.[column] ?? '';
    const formula = sheet.formulaCells?.[`${row + 1}:${column + 1}`]?.formula;
    if (formula) {
      const computed = evaluate(row, column);
      return {
        value: computed.amount,
        reference: {
          ...ref(row, column, original),
          method: 'formula-evaluated',
          formula,
          formulaReferences: computed.references,
        },
      };
    }
    if (!cellSafe(row, column, { metadata: allowBoundary }))
      throw new Error('خلية الرصيد غير موثوقة');
    const native = sheet.numericCells?.[`${row + 1}:${column + 1}`];
    if (native && /%/.test(native.format))
      throw new Error('نسبة مئوية ليست رصيدًا');
    return {
      value: parseMoney(
        native ? String(native.value) : original,
        native ? 'dot' : mapping.numberFormat,
        scope.decimals,
      ),
      reference: { ...ref(row, column, original), method: 'literal' },
    };
  };
  let leading = true;
  for (let row = mapping.header + 1; row < sheet.rows.length; row++) {
    const cells = sheet.rows[row];
    if (!cells.some((value) => value.trim())) continue;
    if (readInlineBalance(row)) continue;
    const identity = structuralSummaryLabel(cells, mapping, headers, leading);
    const kind =
      identity && openingLabel.test(identity)
        ? 'opening'
        : identity && closingLabel.test(identity)
          ? 'closing'
          : undefined;
    if (!kind) {
      leading = false;
      continue;
    }
    const currencies = cells
      .map((value) => value.trim())
      .filter((value) => /^[A-Z]{3}$/i.test(value))
      .map((value) => value.toUpperCase());
    if (
      currencies.some((currency) => currency !== scope.currency.toUpperCase())
    ) {
      invalidBalances.add(kind);
      result.warnings.push(
        `BALANCE_CURRENCY_MISMATCH: ${sheet.name}، صف ${row + 1}: ${currencies.join(' / ')} / ${scope.currency}`,
      );
      continue;
    }
    try {
      if (kind === 'opening') {
        const balanceColumns = headers.flatMap((header, col) =>
          balanceHeader.test(header.trim()) ? [col] : [],
        );
        if (balanceColumns.length === 1 && cells[balanceColumns[0]]?.trim()) {
          balances.opening.push(amount(row, balanceColumns[0]));
        } else if (mapping.mode === 'split') {
          const debit = cells[mapping.debit]?.trim()
            ? amount(row, mapping.debit)
            : { value: 0, reference: ref(row, mapping.debit, '') };
          const credit = cells[mapping.credit]?.trim()
            ? amount(row, mapping.credit)
            : { value: 0, reference: ref(row, mapping.credit, '') };
          balances.opening.push({
            value: safeSum([debit.value, -credit.value]) * mapping.multiplier,
            reference: {
              ...(debit.value ? debit.reference : credit.reference),
              method: 'mapped-opening',
            },
          });
        } else balances.opening.push(amount(row, mapping.amount));
      } else {
        const candidates = cells.flatMap((value, col) =>
          value.trim() &&
          !closingLabel.test(value.trim()) &&
          !/^[A-Z]{3}$/.test(value.trim())
            ? [col]
            : [],
        );
        if (candidates.length !== 1)
          throw new Error('أكثر من قيمة محتملة في صف الإقفال');
        // A complete closing amount remains intact when only its label crosses a table divider.
        // Any second numeric/sign fragment makes candidates ambiguous and is rejected above.
        balances.closing.push(amount(row, candidates[0], true));
      }
    } catch (error) {
      invalidBalances.add(kind);
      result.warnings.push(
        `BALANCE_VALUE_UNVERIFIED: ${sheet.name}، صف ${row + 1}: ${error instanceof Error ? error.message : 'تعذر التحقق'}`,
      );
    }
  }
  for (const kind of ['opening', 'closing'] as const) {
    const candidates = balances[kind];
    for (const candidate of candidates)
      result.evidence.push({
        ...candidate.reference,
        field: `${kind}Balance`,
        value: candidate.value,
      });
    if (
      !invalidBalances.has(kind) &&
      new Set(candidates.map((candidate) => candidate.value)).size === 1
    ) {
      result[`${kind}Balance`] = candidates[0].value;
      result.balanceRowReference[kind] = candidates[0].reference;
    } else if (candidates.length)
      result.warnings.push(`BALANCE_VALUE_CONFLICT: ${kind}`);
  }
  return result;
}
