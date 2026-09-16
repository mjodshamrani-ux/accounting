import {
  nonFinancialFooter,
  parseDate,
  parseMoney,
  structuralSummaryLabel,
} from './core.ts';
import { MAX_ROWS } from './types.ts';
import type { Mapping, SourceFile } from './types.ts';

export type StatementDirection = {
  multiplier: 1 | -1;
  balanceColumn: number;
  checkedRows: number;
  reason: string;
};

const balanceHeader =
  /^(?:running(?: ap)? balance|الرصيد الجاري|الرصيد المتحرك|الرصيد التراكمي)(?:\s*\([a-z]{3}\))?$/i;
const openingLabel =
  /^(?:opening balance|balance brought forward|الرصيد الافتتاحي|رصيد افتتاحي)\s*[:：]?$/i;
const closingLabel =
  /^(?:closing (?:ap )?balance|balance carried forward|الرصيد الختامي|رصيد ختامي)\s*[:：]?$/i;

/** Prove the split-column sign convention against every running-balance step.
 * This establishes arithmetic consistency with the source's displayed balance,
 * not the economic meaning of that balance or complete reconciliation. It does
 * not change the mapping, approve the PDF extraction, or exclude source rows.
 */
export function inferStatementDirection(
  file: SourceFile,
  mapping: Mapping,
  decimals = 2,
): StatementDirection | undefined {
  if (
    mapping.mode !== 'split' ||
    mapping.reportType !== 'transactions' ||
    ![0, 2, 3].includes(decimals) ||
    !['dot', 'comma'].includes(mapping.numberFormat) ||
    !['ymd', 'dmy', 'mdy'].includes(mapping.dateFormat)
  )
    return;
  const sheet = file.sheets[mapping.sheet];
  if (
    !sheet ||
    !Number.isInteger(mapping.header) ||
    mapping.header < 0 ||
    mapping.header >= sheet.rows.length ||
    sheet.rows.length > MAX_ROWS + 30
  )
    return;
  const headers = sheet.rows[mapping.header];
  const candidates = headers.flatMap((header, column) =>
    balanceHeader.test(header.trim().replace(/\s+/g, ' ')) ? [column] : [],
  );
  if (candidates.length !== 1) return;
  const balanceColumn = candidates[0];
  const selected = [mapping.date, mapping.debit, mapping.credit, balanceColumn];
  if (
    selected.some(
      (column) =>
        !Number.isInteger(column) || column < 0 || column >= headers.length,
    ) ||
    new Set(selected).size !== selected.length
  )
    return;
  const currencyCodes = [mapping.debit, mapping.credit, balanceColumn]
    .map((column) =>
      /\(([a-z]{3})\)\s*$/i.exec(headers[column])?.[1]?.toUpperCase(),
    )
    .filter((code) => code !== undefined);
  if (new Set(currencyCodes).size > 1) return;
  const formulas = new Set(sheet.formulaRows);
  const hidden = new Set(sheet.hiddenRows);
  const cellIssue = (row: number, column: number) =>
    Boolean(sheet.cellIssues?.[`${row}:${column + 1}`]?.length);
  const rowIssue = (row: number) =>
    Boolean(sheet.rowIssues?.[row]?.length) ||
    (!sheet.cellIssues && formulas.has(row));
  const values = (row: string[], column: number) => (row[column] ?? '').trim();
  const amount = (row: string[], rn: number, column: number): number => {
    const native = sheet.numericCells?.[`${rn}:${column + 1}`];
    if (native) {
      if (
        typeof native.value !== 'number' ||
        typeof native.format !== 'string' ||
        /%/.test(native.format)
      )
        throw new Error('Unusable native amount');
      return parseMoney(String(native.value), 'dot', decimals);
    }
    return parseMoney(values(row, column), mapping.numberFormat, decimals);
  };
  const split = (row: string[], rn: number): bigint => {
    const debit = values(row, mapping.debit),
      credit = values(row, mapping.credit);
    if (!debit && !credit) throw new Error('Missing movement');
    const d = debit ? amount(row, rn, mapping.debit) : 0;
    const c = credit ? amount(row, rn, mapping.credit) : 0;
    if (d < 0 || c < 0 || (d !== 0 && c !== 0))
      throw new Error('Unproven split direction');
    return BigInt(d) - BigInt(c);
  };
  // Header semantics are evidence too; a formula/obscured header cannot prove them.
  if (
    hidden.has(mapping.header + 1) ||
    rowIssue(mapping.header + 1) ||
    selected.some((column) => cellIssue(mapping.header + 1, column))
  )
    return;

  let previousBalance: number | undefined;
  let openingSplit: bigint | undefined;
  let openingBalance: number | undefined;
  let previousDate: string | undefined;
  let multiplier: 1 | -1 | undefined;
  let checkedRows = 0;
  let nonzeroSteps = 0;
  let leading = true;
  let closed = false;
  try {
    for (let i = mapping.header + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i],
        rn = i + 1;
      if (hidden.has(rn)) return;
      const populated = row.some((value) => value.trim());
      if (!populated) {
        if (rowIssue(rn) || selected.some((column) => cellIssue(rn, column)))
          return;
        continue;
      }
      const isLeading = leading;
      leading = false;
      if (row.slice(headers.length).some((value) => value.trim())) return;
      const label = structuralSummaryLabel(row, mapping, headers, isLeading);
      const repeatedHeader =
        row.length === headers.length &&
        row.every((value, column) => value.trim() === headers[column].trim());
      if (label && openingLabel.test(label)) {
        if (
          !isLeading ||
          previousBalance !== undefined ||
          rowIssue(rn) ||
          selected.some((column) => cellIssue(rn, column))
        )
          return;
        const typeColumn = headers.findIndex((header) =>
          /^(type|doc type|document type|النوع|نوع المستند)$/i.test(
            header.trim(),
          ),
        );
        if (
          [mapping.reference, typeColumn]
            .filter((column) => column >= 0)
            .some(
              (column) =>
                cellIssue(rn, column) ||
                Boolean(sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length),
            )
        )
          return;
        previousBalance = openingBalance = amount(row, rn, balanceColumn);
        if (values(row, mapping.debit) || values(row, mapping.credit))
          openingSplit = split(row, rn);
        const dateText = values(row, mapping.date);
        if (dateText && !openingLabel.test(dateText))
          previousDate = parseDate(dateText, mapping.dateFormat);
        continue;
      }
      if (label || nonFinancialFooter(row) || repeatedHeader) {
        // A summary/footer is not an unchecked transaction. It remains present
        // in SourceFile and is independently handled by normalization. An unsafe
        // structural label cannot be used to bypass malformed movement evidence.
        if (hidden.has(rn)) return;
        if (
          (sheet.rowIssues?.[rn] ?? []).some(
            (issue) => !issue.startsWith('نص يعبر حد عمود؛'),
          )
        )
          return;
        const labelColumns = row.flatMap((value, column) =>
          label
            ? value.trim() === label
              ? [column]
              : []
            : value.trim()
              ? [column]
              : [],
        );
        if (
          labelColumns.some(
            (column) =>
              (sheet.cellIssues?.[`${rn}:${column + 1}`] ?? []).some(
                (issue) => !issue.startsWith('خلية مدمجة في '),
              ) ||
              Boolean(sheet.referenceIssues?.[`${rn}:${column + 1}`]?.length),
          )
        )
          return;
        if (label && closingLabel.test(label)) {
          if (previousBalance === undefined) return;
          const closingText = values(row, balanceColumn);
          if (closingText) {
            if (
              cellIssue(rn, balanceColumn) ||
              (!sheet.cellIssues && formulas.has(rn))
            )
              return;
            if (
              /^[A-Z]{3}$/.test(closingText) &&
              !sheet.numericCells?.[`${rn}:${balanceColumn + 1}`]
            ) {
              // A standalone footer can have different alignment from the body:
              // its currency token may occupy the running-balance column. Check
              // one explicit amount elsewhere; never move or rewrite its cell.
              const footerAmounts: number[] = [];
              for (const [column, raw] of row.entries()) {
                const text = raw.trim();
                if (!text || text === label) continue;
                if (/^[A-Z]{3}$/.test(text)) {
                  if (currencyCodes.length && !currencyCodes.includes(text))
                    return;
                  continue;
                }
                if (cellIssue(rn, column)) return;
                footerAmounts.push(amount(row, rn, column));
              }
              if (
                footerAmounts.length !== 1 ||
                footerAmounts[0] !== previousBalance
              )
                return;
            } else if (amount(row, rn, balanceColumn) !== previousBalance)
              return;
          }
          closed = true;
        }
        continue;
      }
      // User exclusions cannot fill a gap in the arithmetic proof. A skipped
      // movement (even with zero net value) means the complete chain is unknown.
      if (
        mapping.excluded[String(rn)]?.trim() ||
        closed ||
        previousBalance === undefined
      )
        return;
      if (rowIssue(rn) || selected.some((column) => cellIssue(rn, column)))
        return;
      const date = parseDate(values(row, mapping.date), mapping.dateFormat);
      if (previousDate && date < previousDate) return;
      const currentBalance = amount(row, rn, balanceColumn);
      const net = split(row, rn);
      const delta = BigInt(currentBalance) - BigInt(previousBalance);
      if (net === 0n) {
        if (delta !== 0n) return;
      } else {
        const direction = delta === net ? 1 : delta === -net ? -1 : undefined;
        if (
          direction === undefined ||
          (multiplier !== undefined && direction !== multiplier)
        )
          return;
        multiplier = direction;
        nonzeroSteps++;
      }
      checkedRows++;
      previousBalance = currentBalance;
      previousDate = date;
    }
    if (multiplier === undefined || nonzeroSteps < 2) return;
    if (
      openingSplit !== undefined &&
      openingSplit !== 0n &&
      openingSplit * BigInt(multiplier) !== BigInt(openingBalance!)
    )
      return;
    return {
      multiplier,
      balanceColumn,
      checkedRows,
      reason: `اتجاه المدين والدائن متحقق حسابيًا من الرصيد الافتتاحي وجميع الحركات (${checkedRows} حركة، منها ${nonzeroSteps} غير صفرية) مقابل عمود «${headers[balanceColumn].trim()}»: فرق الرصيد = ${multiplier === 1 ? 'المدين − الدائن' : 'الدائن − المدين'}.`,
    };
  } catch {
    return;
  }
}
