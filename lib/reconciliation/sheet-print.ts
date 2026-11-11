import type {
  ReconciliationSheet,
  SheetTextStyle,
} from './reconciliation-sheet.ts';

/**
 * The reconciliation sheet on paper (UX-6(d)): the rows and cells of the
 * model the workbook's first sheet is written from, nothing added and
 * nothing left out, each as the workbook shows it. A text runs on over the
 * empty cells after it, as it does in the workbook; the rows the model keeps
 * together on a printed page stay one group.
 */
export type PrintCell =
  | { kind: 'text'; text: string; style: SheetTextStyle; span: number }
  | { kind: 'amount'; text: string; start: boolean; span: 1 }
  | { kind: 'count'; text: string; span: 1 }
  | { kind: 'line'; span: 1 }
  | { kind: 'empty'; span: number };

export type SheetPrint = {
  language: 'ar' | 'en';
  /** Each column's share of the width, in percent, from the model's widths. */
  widths: number[];
  /** The rows in order, in groups: `keep` where the model keeps them on one
   * page, otherwise one row. A row with no cells is the model's blank row. */
  groups: { keep: boolean; rows: PrintCell[][] }[];
};

/**
 * An amount as the workbook shows it: `#,##0.00;-#,##0.00;0.00` at its
 * currency's precision (`#,##0;-#,##0;0` with none), from minor units, with
 * no rounding and no floating point.
 */
export function sheetAmountText(minor: number, decimals: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error('SHEET_PRINT_AMOUNT');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4)
    throw new Error('SHEET_PRINT_DECIMALS');
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits
    .slice(0, digits.length - decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = decimals ? `${whole}.${digits.slice(-decimals)}` : whole;
  return minor < 0 ? `-${text}` : text;
}

function printRow(cells: ReconciliationSheet['rows'][number], n: number) {
  if (!cells.length) return [];
  const row: PrintCell[] = [];
  for (let j = 0; j < n; ) {
    const cell = cells[j] ?? null;
    if (cell === null) {
      row.push({ kind: 'empty', span: 1 });
      j++;
    } else if ('text' in cell) {
      // Over the empty cells after it, as the workbook lets it run on.
      let span = 1;
      while (j + span < n && (cells[j + span] ?? null) === null) span++;
      row.push({ kind: 'text', text: cell.text, style: cell.style, span });
      j += span;
    } else if ('minor' in cell) {
      row.push({
        kind: 'amount',
        text: sheetAmountText(cell.minor, cell.decimals),
        start: cell.start === true,
        span: 1,
      });
      j++;
    } else if ('count' in cell) {
      row.push({ kind: 'count', text: String(cell.count), span: 1 });
      j++;
    } else {
      row.push({ kind: 'line', span: 1 });
      j++;
    }
  }
  return row;
}

/** The sheet laid out for print, row for row and cell for cell. */
export function sheetPrint(sheet: ReconciliationSheet): SheetPrint {
  const n = sheet.widths.length;
  if (sheet.rows.some((cells) => cells.length > n))
    throw new Error('SHEET_PRINT_WIDTHS');
  const total = sheet.widths.reduce((a, b) => a + b, 0);
  const keep = [...(sheet.keep ?? [])].sort((a, b) => a[0] - b[0]);
  const groups: SheetPrint['groups'] = [];
  for (let i = 0, k = 0; i < sheet.rows.length; ) {
    while (k < keep.length && keep[k][0] < i) k++;
    const range = k < keep.length && keep[k][0] === i ? keep[k] : null;
    const last = range ? Math.min(range[1], sheet.rows.length - 1) : i;
    groups.push({
      keep: range !== null,
      rows: sheet.rows.slice(i, last + 1).map((cells) => printRow(cells, n)),
    });
    i = last + 1;
  }
  return {
    language: sheet.language,
    widths: sheet.widths.map((w) => (100 * w) / total),
    groups,
  };
}
