import { headerLabels } from './header-view.ts';
import {
  parseDate,
  parseMoney,
  structuralSummaryLabel,
  mayCarrySummaryLabel,
  nonFinancialFooter,
  repeatedPageMetadataRows,
  repeatsHeaderRow,
} from './core.ts';
import { MAX_ROWS } from './types.ts';
import type { Mapping, Scope, SourceFile } from './types.ts';

export type FormatStatus = 'proven' | 'ambiguous' | 'invalid' | 'unavailable';
export type FormatAssessment<T extends string> = {
  status: FormatStatus;
  reason: string;
  candidates: T[];
  checkedValues: number;
  /** Source rows withheld from format evidence. The normalizer retains each
   * reading error; this list never authorizes exclusion or approval. Row zero
   * denotes a separately entered balance, not a transaction. */
  unreadRows: number[];
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
  unreadRows: number[] = [],
): FormatAssessment<T> {
  return { status, reason, candidates, checkedValues, unreadRows };
}

type FormatEvidence<V> = { value: V; row: number; unsafe?: boolean };

// Inspect every value, not a sample. A bad cell that NO supported reading can
// interpret is not evidence against the readable rows' convention. However a
// value valid under ANY reading must participate in the intersection: dropping
// inconvenient but valid values would manufacture a locale and scale money.
function inspect<T extends string, V>(
  formats: T[],
  values: FormatEvidence<V>[],
  parse: (value: V, format: T) => string | number,
  label: string,
  problem: string | undefined,
): FormatAssessment<T> {
  if (problem) return assessment('invalid', problem, values.length);
  if (!values.length)
    return assessment('unavailable', `لا توجد قيم كافية للتحقق من ${label}.`);
  const unread = new Set<number>();
  const readings: Map<T, string | number>[] = [];
  for (const evidence of values) {
    const row = new Map<T, string | number>();
    if (!evidence.unsafe) {
      for (const format of formats) {
        try {
          row.set(format, parse(evidence.value, format));
        } catch {
          // Failed readings never become guessed values or zero amounts.
        }
      }
    }
    if (row.size) readings.push(row);
    else unread.add(evidence.row);
  }
  const unreadRows = [...unread].sort((a, b) => a - b);
  if (!readings.length)
    return assessment(
      'invalid',
      `لا توجد قيم مقروءة للتحقق من صيغة ${label}. راجع الصفوف المشار إليها.`,
      0,
      [],
      unreadRows,
    );
  const candidates = formats.filter((format) =>
    readings.every((row) => row.has(format)),
  );
  if (!candidates.length)
    return assessment(
      'invalid',
      `توجد صيغ صحيحة لكنها متعارضة في ${label}. لا يمكن اختيار صيغة واحدة لهذا العمود. راجع المصدر.`,
      readings.length,
      [],
      unreadRows,
    );
  const identical = readings.every((row) =>
    candidates.every((format) => row.get(format) === row.get(candidates[0])),
  );
  if (!identical)
    return assessment(
      'ambiguous',
      `يمكن قراءة قيم ${label} بأكثر من طريقة. اختر الصيغة التي تطابق المصدر.`,
      readings.length,
      candidates,
      unreadRows,
    );
  return assessment(
    'proven',
    unreadRows.length
      ? `تفسير متفق للقيم المقروءة في ${label} (${readings.length} قيمة). تبقى القيم التي تعذرت قراءتها ظاهرة للمراجعة.`
      : `تفسير واحد لجميع قيم ${label} (${readings.length} قيمة).`,
    readings.length,
    candidates,
    unreadRows,
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
  const dates: FormatEvidence<string>[] = [];
  const amounts: FormatEvidence<AmountEvidence>[] = [];
  let amountProblem: string | undefined;
  const formulaRows = new Set(sheet.formulaRows);
  const hiddenRows = new Set(sheet.hiddenRows);
  const header = headerLabels(sheet, mapping.header);
  // normalizeSource excludes a verbatim repeated PDF page banner; inference must
  // use the same set, or the banner it reads into the date/amount column turns a
  // provable statement into an unprovable one and pushes a default format on it.
  const pageMetadata = repeatedPageMetadataRows(file, sheet, mapping);
  // A total or balance line is recognised by its structure, and structuralSummaryLabel
  // has to parse its printed amount and date to do that. Those formats are exactly
  // what this pass is establishing, so an unproven default would hide a balance line
  // ("Closing balance: -3,57" under a dot reading) and then let that same line
  // invalidate the column it belongs to. Accept the label under any supported
  // reading here; normalizeSource still classifies with the confirmed format only.
  // The mapping's own reading is tried first and separately; these are the rest.
  const readings = numberFormats.flatMap((numberFormat) =>
    dateFormats.flatMap((dateFormat) =>
      numberFormat === mapping.numberFormat && dateFormat === mapping.dateFormat
        ? []
        : [{ ...mapping, numberFormat, dateFormat }],
    ),
  );
  const anyReadingLabel = (row: string[], leading: boolean) => {
    const direct = structuralSummaryLabel(row, mapping, header, leading);
    if (direct || !mayCarrySummaryLabel(row)) return direct;
    for (const reading of readings) {
      const found = structuralSummaryLabel(row, reading, header, leading);
      if (found) return found;
    }
  };
  let precedingEmpty = true;
  const cellProblem = (row: number, column: number) =>
    Boolean(sheet.cellIssues?.[`${row}:${column + 1}`]?.length);

  for (let i = mapping.header + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rn = i + 1;
    const leading = precedingEmpty;
    precedingEmpty &&= row.every((value) => !value.trim());
    if (mapping.excluded[String(rn)]?.trim()) continue;
    const label = anyReadingLabel(row, leading);
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
    const repeatedHeader = repeatsHeaderRow(row, header);
    const headerReadingSafe =
      (!formulaRows.has(rn) || !!sheet.cellIssues) &&
      row.every(
        (_, column) =>
          !cellProblem(rn, column) &&
          !sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length,
      );
    // Mirrors normalizeSource's wholeTextRowSafe(true): a banner may straddle a
    // table column boundary, but any other reading problem keeps the row in view.
    const textRowSafe =
      structuralReadingSafe &&
      !formulaRows.has(rn) &&
      !(sheet.rowIssues?.[String(rn)] ?? []).some(
        (issue) => !issue.startsWith('نص يعبر حد عمود؛'),
      ) &&
      row.every(
        (_, column) =>
          !(sheet.cellIssues?.[`${rn}:${column + 1}`] ?? []).some(
            (issue) => !issue.startsWith('خلية مدمجة في '),
          ) && !sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length,
      );
    if (pageMetadata.has(rn) && textRowSafe) continue;
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
      dates.push({
        value: (row[mapping.date] ?? '').trim(),
        row: rn,
        unsafe: rowProblem || cellProblem(rn, mapping.date),
      });
    }
    if (hasAmounts) {
      let populated = 0;
      for (const column of amountColumns) {
        const text = (row[column] ?? '').trim();
        // Blank split debit/credit cells mean zero, exactly as in normalizeSource.
        if (!text && mapping.mode === 'split') continue;
        populated++;
        amounts.push({
          value: { text, native: sheet.numericCells?.[`${rn}:${column + 1}`] },
          row: rn,
          unsafe: rowProblem || cellProblem(rn, column),
        });
      }
      if (!populated)
        amounts.push({ value: { text: '' }, row: rn, unsafe: true });
    }
  }
  if (hasDate)
    result.dateFormat = inspect(
      dateFormats,
      dates,
      parseDate,
      'التاريخ',
      undefined,
    );
  if (hasAmounts) {
    for (const text of [mapping.opening, mapping.closing])
      if (text.trim()) amounts.push({ value: { text }, row: 0 });
    if (![0, 2, 3].includes(decimals))
      amountProblem = 'عدد المنازل العشرية للعملة غير مدعوم.';
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
      !result.numberFormat.unreadRows.length &&
      amounts.every((value) => value.value.native)
    )
      result.numberFormat.reason = `قيم Excel الرقمية الأصلية لا تعتمد على شكل الفواصل المعروض (${amounts.length} قيمة).`;
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
