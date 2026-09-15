import type { PdfToken } from './pdf.ts';
// Suggestions only: ordinary text-table layouts, with the same header on every
// page and an observed gap between every adjacent column. No cell is rewritten
// or excluded and the accountant must still review the PDF extraction.
export function suggestPdfColumns(
  pages: { width: number; tokens: PdfToken[] }[],
): number[] | null {
  const dateHeader =
    /^(date|transaction date|posting date|التاريخ|تاريخ الحركة)$/i;
  const referenceHeader =
    /^(reference|document no\.?|invoice no\.?|المرجع|رقم المستند|رقم الفاتورة)$/i;
  const amountHeader =
    /^(amount|signed amount|debit|credit|المبلغ|مدين|دائن)(?:\s*\([a-z]{3}\))?$/i;
  const knownHeader =
    /^(date|transaction date|posting date|type|document no\.?|invoice no\.?|reference|customer ref\s*\/\s*po|description|details|amount|signed amount|debit|credit|running balance|due date|currency|التاريخ|تاريخ الحركة|النوع|المرجع|رقم المستند|رقم الفاتورة|الوصف|البيان|المبلغ|مدين|دائن|الرصيد|العملة)(?:\s*\([a-z]{3}\))?$/i;
  const dateCell =
    /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.](?:\d{1,2}|[a-z]+)[-/.]\d{4})$/i;
  const datedRows: { width: number; rows: PdfToken[][] }[] = [];
  let signature = '',
    lower: number[] = [],
    upper: number[] = [];
  for (const page of pages) {
    if (!Number.isFinite(page.width) || page.width <= 0) return null;
    const lines: { y: number; tokens: PdfToken[] }[] = [];
    for (const token of [...page.tokens].sort(
      (a, b) => b.y - a.y || a.x - b.x,
    )) {
      if (
        ![token.x, token.y, token.width, token.height].every(Number.isFinite) ||
        token.width <= 0 ||
        token.height <= 0
      )
        return null;
      const previous = lines.at(-1);
      if (
        previous &&
        Math.abs(previous.y - token.y) <= Math.min(1, token.height / 8)
      )
        previous.tokens.push(token);
      else lines.push({ y: token.y, tokens: [token] });
    }
    const ordered = lines.map((l) => l.tokens.sort((a, b) => a.x - b.x));
    const candidates = ordered.flatMap((row, i) =>
      row.length >= 3 &&
      row.length <= 20 &&
      dateHeader.test(row[0].text.trim()) &&
      row.some((t) => referenceHeader.test(t.text.trim())) &&
      row.some((t) => amountHeader.test(t.text.trim())) &&
      row.every((t) => knownHeader.test(t.text.trim()))
        ? [i]
        : [],
    );
    if (candidates.length !== 1) return null;
    const index = candidates[0],
      header = ordered[index],
      key = header.map((t) => t.text.trim().toLowerCase()).join('|');
    if (signature && key !== signature) return null;
    const body = ordered
      .slice(index + 1)
      .filter((row) => dateCell.test(row[0]?.text.trim() ?? ''));
    datedRows.push({ width: page.width, rows: body });
    const complete = body.filter((row) => row.length === header.length);
    if (!complete.length) return null;
    const rows = [header, ...complete];
    const left = header
      .slice(1)
      .map((_, i) =>
        Math.max(
          ...rows.map((row) => ((row[i].x + row[i].width) / page.width) * 100),
        ),
      );
    const right = header
      .slice(1)
      .map((_, i) =>
        Math.min(...rows.map((row) => (row[i + 1].x / page.width) * 100)),
      );
    if (!signature) {
      lower = left;
      upper = right;
      signature = key;
    } else {
      lower = lower.map((v, i) => Math.max(v, left[i]));
      upper = upper.map((v, i) => Math.min(v, right[i]));
    }
    // Partial rows can contain a wider type/description than complete rows.
    // Tighten each observed gap when a token extends from a known side. A token
    // floating entirely inside a gap has no proven column, so do not suggest.
    for (const row of body)
      for (const token of row) {
        const start = (token.x / page.width) * 100,
          end = ((token.x + token.width) / page.width) * 100;
        for (let i = 0; i < lower.length; i++) {
          if (start < upper[i] && end > lower[i]) {
            if (start <= lower[i] && end < upper[i]) lower[i] = end;
            else if (start > lower[i] && end >= upper[i]) upper[i] = start;
            else return null;
          }
        }
      }
    if (lower.some((v, i) => v + 0.3 >= upper[i])) return null;
    // Partial rows must fit the same columns. Extra split tokens are retained;
    // any token crossing a candidate gap cancels the suggestion.
    const cuts = lower.map((v, i) => (v + upper[i]) / 2);
    if (
      body.some((row) =>
        row.some((t) =>
          cuts.some(
            (c) =>
              c > (t.x / page.width) * 100 + 0.05 &&
              c < ((t.x + t.width) / page.width) * 100 - 0.05,
          ),
        ),
      )
    )
      return null;
  }
  if (!signature) return null;
  const cuts = lower.map(
    (v, i) => Math.round(((v + upper[i]) / 2) * 10000) / 10000,
  );
  // Recheck all pages after intersecting their allowed gap intervals.
  if (
    datedRows.some((page) =>
      page.rows.some((row) =>
        row.some((token) =>
          cuts.some(
            (c) =>
              c > (token.x / page.width) * 100 + 0.05 &&
              c < ((token.x + token.width) / page.width) * 100 - 0.05,
          ),
        ),
      ),
    )
  )
    return null;
  if (cuts.some((c, i) => c <= 0 || c >= 100 || (i > 0 && c <= cuts[i - 1])))
    return null;
  return cuts;
}

// Geometry fallback for statements whose headers are not in the vocabulary above.
// A column boundary is a vertical band that no table token overlaps on any page.
// This reads positions only: no cell is rewritten, merged, excluded or relabelled.
type PdfLine = PdfToken[];

function pageLines(page: { width: number; tokens: PdfToken[] }): PdfLine[] {
  const lines: { y: number; tokens: PdfToken[] }[] = [];
  for (const token of [...page.tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (
      ![token.x, token.y, token.width, token.height].every(Number.isFinite) ||
      token.width <= 0 ||
      token.height <= 0
    )
      return [];
    const previous = lines.at(-1);
    if (
      previous &&
      Math.abs(previous.y - token.y) <= Math.min(1, token.height / 8)
    )
      previous.tokens.push(token);
    else lines.push({ y: token.y, tokens: [token] });
  }
  return lines.map((line) => line.tokens.sort((a, b) => a.x - b.x));
}

const dateLike =
  /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.](?:\d{1,2}|[a-z]{3,9})[-/.]\d{2,4})$/i;

// Repeating table rows carry the column geometry. A title or a footer spans the
// page and would erase every gap, so those lines are not evidence of a column.
function tableLines(lines: PdfLine[]): PdfLine[] {
  const wide = lines.filter((line) => line.length >= 3);
  const dated = wide.filter((line) =>
    line.some((token) => dateLike.test(token.text.trim())),
  );
  if (dated.length >= 3) return dated;
  const counts = new Map<number, number>();
  for (const line of wide)
    counts.set(line.length, (counts.get(line.length) ?? 0) + 1);
  let mode = 0;
  for (const [length, count] of counts)
    if (
      count > (counts.get(mode) ?? 0) ||
      (count === (counts.get(mode) ?? 0) && length > mode)
    )
      mode = length;
  const modal = wide.filter((line) => line.length === mode);
  return modal.length >= 3 ? modal : [];
}

export function projectPdfColumns(
  pages: { width: number; tokens: PdfToken[] }[],
): number[] | null {
  const spans: [number, number][] = [];
  let heights: number[] = [];
  for (const page of pages) {
    if (!Number.isFinite(page.width) || page.width <= 0) return null;
    const rows = tableLines(pageLines(page));
    if (!rows.length) return null;
    for (const line of rows)
      for (const token of line) {
        spans.push([
          (token.x / page.width) * 100,
          ((token.x + token.width) / page.width) * 100,
        ]);
        heights.push((token.height / page.width) * 100);
      }
  }
  if (spans.length < 6) return null;
  heights = heights.sort((a, b) => a - b);
  // An inter-word space is narrower than the glyph height; a column gap is not.
  const minimum = Math.max(1, heights[heights.length >> 1] * 0.9);
  const ordered = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const covered: [number, number][] = [];
  for (const span of ordered) {
    const last = covered.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else covered.push([...span]);
  }
  const cuts: number[] = [];
  for (let i = 1; i < covered.length; i++) {
    const gap = covered[i][0] - covered[i - 1][1];
    if (gap < minimum) continue;
    cuts.push(
      Math.round(((covered[i - 1][1] + covered[i][0]) / 2) * 10000) / 10000,
    );
  }
  if (!cuts.length || cuts.length > 19) return null;
  if (cuts.some((c, i) => c <= 0 || c >= 100 || (i > 0 && c <= cuts[i - 1])))
    return null;
  // No table token may cross a boundary derived from the gaps between them.
  if (
    spans.some(([start, end]) =>
      cuts.some((c) => c > start + 0.05 && c < end - 0.05),
    )
  )
    return null;
  return cuts;
}
