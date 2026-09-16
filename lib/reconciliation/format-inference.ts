import {
  parseDate,
  parseMoney,
  structuralSummaryLabel,
  nonFinancialFooter,
} from './core.ts';
import { MAX_ROWS } from './types.ts';
import type { Mapping, Scope, SourceFile } from './types.ts';

export type FormatStatus = 'proven' | 'ambiguous' | 'invalid' | 'unavailable';
export type FormatAssessment<T extends string> = {
  status: FormatStatus;
  reason: string;
  candidates: T[];
  checkedValues: number;
};
export type FormatSuggestions = {
  patch: Partial<Pick<Mapping, 'dateFormat' | 'numberFormat'>>;
  dateFormat: FormatAssessment<Mapping['dateFormat']>;
  numberFormat: FormatAssessment<Mapping['numberFormat']>;
};

const dateFormats: Mapping['dateFormat'][] = ['ymd', 'dmy', 'mdy'];
const numberFormats: Mapping['numberFormat'][] = ['dot', 'comma'];

function assessment<T extends string>(
  status: FormatStatus,
  reason: string,
  checkedValues = 0,
  candidates: T[] = [],
): FormatAssessment<T> {
  return { status, reason, candidates, checkedValues };
}

// Consider the whole column, not a sample. A candidate must parse every value;
// several surviving formats are safe only when their complete results agree.
function inspect<T extends string, V>(
  formats: T[],
  values: V[],
  parse: (value: V, format: T) => string | number,
  label: string,
  problem: string | undefined,
): FormatAssessment<T> {
  if (problem) return assessment('invalid', problem, values.length);
  if (!values.length)
    return assessment('unavailable', `لا توجد قيم كافية للتحقق من ${label}.`);
  const candidates: T[] = [];
  let first: (string | number)[] | undefined;
  let identical = true;
  for (const format of formats) {
    try {
      const parsed = values.map((value) => parse(value, format));
      candidates.push(format);
      if (!first) first = parsed;
      else if (parsed.some((value, i) => value !== first![i]))
        identical = false;
    } catch {
      // Failure removes this format from consideration; it never removes a row.
    }
  }
  if (!candidates.length)
    return assessment(
      'invalid',
      `توجد قيم غير صالحة أو صيغ متعارضة في ${label}؛ راجع المصدر.`,
      values.length,
    );
  if (!identical)
    return assessment(
      'ambiguous',
      `قيم ${label} تقبل أكثر من تفسير؛ يلزم اختيار الصيغة.`,
      values.length,
      candidates,
    );
  return assessment(
    'proven',
    `تفسير واحد لجميع قيم ${label} (${values.length} قيمة).`,
    values.length,
    candidates,
  );
}

type AmountEvidence = {
  text: string;
  native?: { value: number; format: string };
};

/** Suggest only presentation formats proven by the existing deterministic parsers.
 * This does not approve rows, PDF geometry, signs, scope, or balances. Summary
 * rows are omitted from inference only; normalizeSource still requires review.
 */
export function suggestFormats(
  file: SourceFile,
  mapping: Mapping,
  decimals: Scope['decimals'],
): FormatSuggestions {
  const result: FormatSuggestions = {
    patch: {},
    dateFormat: assessment('unavailable', 'حدد عمود التاريخ أولًا.'),
    numberFormat: assessment(
      'unavailable',
      'حدد عمود المبلغ أو المدين والدائن أولًا.',
    ),
  };
  const sheet = file.sheets[mapping.sheet];
  if (
    !sheet ||
    !Number.isInteger(mapping.header) ||
    mapping.header < 0 ||
    mapping.header >= sheet.rows.length
  )
    return result;
  if (sheet.rows.length > MAX_ROWS + 30) {
    result.dateFormat = assessment('invalid', 'عدد الصفوف يتجاوز حد القراءة.');
    result.numberFormat = assessment(
      'invalid',
      'عدد الصفوف يتجاوز حد القراءة.',
    );
    return result;
  }
  const validColumn = (column: number) =>
    Number.isInteger(column) && column >= 0 && column < 100;
  const amountColumns =
    mapping.mode === 'signed'
      ? [mapping.amount]
      : [mapping.debit, mapping.credit];
  const hasDate = validColumn(mapping.date);
  const hasAmounts =
    amountColumns.every(validColumn) &&
    new Set(amountColumns).size === amountColumns.length;
  const dates: string[] = [];
  const amounts: AmountEvidence[] = [];
  let dateProblem: string | undefined;
  let amountProblem: string | undefined;
  const formulaRows = new Set(sheet.formulaRows);
  const hiddenRows = new Set(sheet.hiddenRows);
  const header = sheet.rows[mapping.header];
  let precedingEmpty = true;
  const cellProblem = (row: number, column: number) =>
    Boolean(sheet.cellIssues?.[`${row}:${column + 1}`]?.length);

  for (let i = mapping.header + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rn = i + 1;
    const leading = precedingEmpty;
    precedingEmpty &&= row.every((value) => !value.trim());
    if (mapping.excluded[String(rn)]?.trim()) continue;
    const label = structuralSummaryLabel(row, mapping, header, leading);
    const structuralReadingSafe =
      !hiddenRows.has(rn) &&
      !(sheet.rowIssues?.[String(rn)] ?? []).some(
        (issue) => !issue.startsWith('نص يعبر حد عمود؛'),
      ) &&
      !(
        label &&
        row.some(
          (value, column) =>
            value.trim() === label &&
            ((sheet.cellIssues?.[`${rn}:${column + 1}`] ?? []).some(
              (issue) => !issue.startsWith('خلية مدمجة في '),
            ) ||
              sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length),
        )
      );
    const repeatedHeader =
      row.length === header.length &&
      header.some((value) => value.trim()) &&
      row.every((value, column) => value.trim() === header[column].trim());
    const headerReadingSafe =
      (!formulaRows.has(rn) || !!sheet.cellIssues) &&
      row.every(
        (_, column) =>
          !cellProblem(rn, column) &&
          !sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length,
      );
    if (
      structuralReadingSafe &&
      (label ||
        nonFinancialFooter(row) ||
        (repeatedHeader && headerReadingSafe))
    )
      continue;
    const rowProblem =
      Boolean(sheet.rowIssues?.[String(rn)]?.length) ||
      (!sheet.cellIssues && formulaRows.has(rn));
    // Empty cells with parser errors or formulas are not evidence of an empty row.
    const hasMappedIssue =
      (hasDate && cellProblem(rn, mapping.date)) ||
      (hasAmounts && amountColumns.some((column) => cellProblem(rn, column)));
    if (row.every((value) => !value.trim()) && !rowProblem && !hasMappedIssue)
      continue;
    if (hasDate) {
      dates.push((row[mapping.date] ?? '').trim());
      if (rowProblem || cellProblem(rn, mapping.date))
        dateProblem ??= `تعذر الاعتماد على تاريخ الصف ${rn} بسبب مشكلة في قراءة المصدر.`;
    }
    if (hasAmounts) {
      let populated = 0;
      for (const column of amountColumns) {
        const text = (row[column] ?? '').trim();
        if (rowProblem || cellProblem(rn, column))
          amountProblem ??= `تعذر الاعتماد على مبلغ الصف ${rn} بسبب مشكلة في قراءة المصدر.`;
        // Blank split debit/credit cells mean zero, exactly as in normalizeSource.
        if (!text && mapping.mode === 'split') continue;
        populated++;
        amounts.push({
          text,
          native: sheet.numericCells?.[`${rn}:${column + 1}`],
        });
      }
      if (!populated) amountProblem ??= `المدين والدائن فارغان في الصف ${rn}.`;
    }
  }
  if (hasDate)
    result.dateFormat = inspect(
      dateFormats,
      dates,
      parseDate,
      'التاريخ',
      dateProblem,
    );
  if (hasAmounts) {
    for (const text of [mapping.opening, mapping.closing])
      if (text.trim()) amounts.push({ text });
    if (![0, 2, 3].includes(decimals)) amountProblem = 'دقة العملة غير مدعومة.';
    result.numberFormat = inspect(
      numberFormats,
      amounts,
      ({ text, native }, format) => {
        if (native) {
          if (/%/.test(native.format))
            throw new Error('Percentage is not an amount');
          return parseMoney(String(native.value), 'dot', decimals);
        }
        return parseMoney(text, format, decimals);
      },
      'المبالغ',
      amountProblem,
    );
    if (
      result.numberFormat.status === 'proven' &&
      amounts.length &&
      amounts.every((value) => value.native)
    )
      result.numberFormat.reason = `قيم Excel الرقمية مستقلة عن تنسيق الفواصل (${amounts.length} قيمة).`;
  }
  if (result.dateFormat.status === 'proven')
    result.patch.dateFormat = result.dateFormat.candidates.includes(
      mapping.dateFormat,
    )
      ? mapping.dateFormat
      : result.dateFormat.candidates[0];
  if (result.numberFormat.status === 'proven')
    result.patch.numberFormat = result.numberFormat.candidates.includes(
      mapping.numberFormat,
    )
      ? mapping.numberFormat
      : result.numberFormat.candidates[0];
  return result;
}
