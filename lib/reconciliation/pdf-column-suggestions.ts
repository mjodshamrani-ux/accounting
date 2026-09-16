import type { PdfToken } from './pdf.ts';

export type PdfColumnLayout = {
  cuts: number[];
  // Zero-based line indexes use the same baseline grouping as layoutPdfPage.
  // These are evidence for header fragments, not permission to remove rows.
  headers: { lineIndexes: number[]; columns: string[] }[];
};

type HeaderBand = {
  lineIndexes: number[];
  columns: PdfToken[];
};
const dateHeader =
  /^(date|transaction date|posting date|invoice date|التاريخ|تاريخ الحركة|تاريخ الفاتورة)$/i;
const referenceHeader =
  /^(reference|document no\.?|invoice no\.?|ap voucher|supplier ref|supplier reference|vendor ref|المرجع|رقم المستند|رقم الفاتورة)$/i;
const amountHeader =
  /^(amount|signed amount|debit|credit|المبلغ|مدين|دائن)(?:\s*\([a-z]{3}\))?$/i;
const knownHeader =
  /^(date|transaction date|posting date|invoice date|type|doc type|document type|document no\.?|invoice no\.?|reference|ap voucher|supplier ref|supplier reference|vendor ref|po\s*\/\s*bank ref|customer ref\s*\/\s*po|description|details|amount|signed amount|debit|credit|running balance|running ap balance|due date|currency|التاريخ|تاريخ الحركة|تاريخ الفاتورة|النوع|نوع المستند|المرجع|رقم المستند|رقم الفاتورة|الوصف|البيان|المبلغ|مدين|دائن|الرصيد|العملة)(?:\s*\([a-z]{3}\))?$/i;
const dateCell =
  /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.](?:\d{1,2}|[a-z]+)[-/.]\d{4})$/i;
const label = (text: string) => text.trim().replace(/\s+/g, ' ');

// PDF.js may split one header cell into several text items. Join only a
// unique sequence of exact supported phrases, across an ordinary word space.
// This builds geometry evidence; layoutPdfPage still receives the original tokens.
function joinedToken(parts: PdfToken[]): PdfToken {
  const x = parts[0].x;
  return {
    text: parts.map((part) => label(part.text)).join(' '),
    x,
    width: Math.max(...parts.map((part) => part.x + part.width)) - x,
    y: parts[0].y,
    height: Math.max(...parts.map((part) => part.height)),
  };
}
function wordGap(left: PdfToken, right: PdfToken): boolean {
  const gap = right.x - left.x - left.width;
  return gap >= -0.2 && gap <= Math.min(left.height, right.height) * 0.85;
}
function headerWords(tokens: PdfLine, fragments = false): PdfLine | null {
  if (tokens.length > 100) return null;
  const fragment = /^(running|running ap|balance)$/i;
  const memo = new Map<number, PdfLine[]>();
  const visit = (index: number): PdfLine[] => {
    if (index === tokens.length) return [[]];
    if (memo.has(index)) return memo.get(index)!;
    const results: PdfLine[] = [];
    for (let end = index; end < Math.min(tokens.length, index + 6); end++) {
      if (end > index && !wordGap(tokens[end - 1], tokens[end])) break;
      const joined = joinedToken(tokens.slice(index, end + 1));
      if (
        !knownHeader.test(joined.text) &&
        !(fragments && fragment.test(joined.text))
      )
        continue;
      for (const remainder of visit(end + 1)) {
        results.push([joined, ...remainder]);
        if (results.length > 1) {
          memo.set(index, results);
          return results;
        }
      }
    }
    memo.set(index, results);
    return results;
  };
  const choices = visit(0);
  return choices.length === 1 ? choices[0] : null;
}
function bodyWords(tokens: PdfLine): PdfLine {
  const groups: PdfToken[][] = [];
  for (const token of tokens) {
    const previous = groups.at(-1);
    if (previous && wordGap(previous.at(-1)!, token)) previous.push(token);
    else groups.push([token]);
  }
  return groups.map(joinedToken);
}

function headerBands(lines: PdfLine[]): HeaderBand[] {
  return lines.flatMap((originalRow) => {
    const row = headerWords(originalRow);
    if (!row) return [];
    if (
      row.length < 3 ||
      row.length > 20 ||
      !dateHeader.test(label(row[0].text)) ||
      !row.some((token) => referenceHeader.test(label(token.text))) ||
      !row.some((token) => amountHeader.test(label(token.text))) ||
      !row.every((token) => knownHeader.test(label(token.text)))
    )
      return [];
    const height = Math.max(...row.map((token) => token.height));
    const baseline = row[0].y;
    const lineIndexes = lines.flatMap((line, i) =>
      Math.abs(line[0].y - baseline) <= height * 1.3 ? [i] : [],
    );
    if (lineIndexes.length > 3) return [];
    const lineWords = lineIndexes.map((i) => headerWords(lines[i], true));
    if (lineWords.some((line) => line === null)) return [];
    const tokens = lineWords
      .flatMap((line) => line!)
      .sort((a, b) => a.x - b.x || b.y - a.y);
    const groups: PdfToken[][] = [];
    for (const token of tokens) {
      const previous = groups.at(-1);
      if (
        previous &&
        token.x < Math.max(...previous.map((item) => item.x + item.width))
      )
        previous.push(token);
      else groups.push([token]);
    }
    const columns: PdfToken[] = [];
    for (const group of groups) {
      const ordered = [...group].sort((a, b) => b.y - a.y);
      // Vertically wrapped labels must overlap horizontally, remain compact,
      // and join to a supported complete label. Adjacent words/cells are never guessed.
      if (
        ordered.some(
          (token, i) =>
            i > 0 &&
            Math.abs(token.y - ordered[i - 1].y) <=
              Math.min(1, token.height / 8),
        )
      )
        return [];
      if (ordered[0].y - ordered.at(-1)!.y > height * 1.8) return [];
      const text = ordered.map((token) => label(token.text)).join(' ');
      if (!knownHeader.test(text)) return [];
      const x = Math.min(...ordered.map((token) => token.x));
      const end = Math.max(...ordered.map((token) => token.x + token.width));
      columns.push({ text, x, width: end - x, y: baseline, height });
    }
    if (
      columns.length < 3 ||
      columns.length > 20 ||
      !dateHeader.test(columns[0].text)
    )
      return [];
    return [{ lineIndexes, columns }];
  });
}

// Suggestions only: one supported header band per page and an observed gap
// between every adjacent column. All source tokens and rows stay unchanged.
export function suggestPdfColumnLayout(
  pages: { width: number; tokens: PdfToken[] }[],
): PdfColumnLayout | null {
  const datedRows: { width: number; rows: PdfToken[][] }[] = [];
  const headers: PdfColumnLayout['headers'] = [];
  let signature = '',
    lower: number[] = [],
    upper: number[] = [];
  for (const page of pages) {
    if (!Number.isFinite(page.width) || page.width <= 0) return null;
    const ordered = pageLines(page);
    const candidates = headerBands(ordered);
    if (candidates.length !== 1) return null;
    const { lineIndexes, columns: header } = candidates[0];
    const key = header
      .map((token) => label(token.text).toLowerCase())
      .join('|');
    if (signature && key !== signature) return null;
    headers.push({
      lineIndexes: [...lineIndexes],
      columns: header.map((token) => token.text),
    });
    const body = ordered
      .slice(lineIndexes.at(-1)! + 1)
      .filter((row) => dateCell.test(row[0]?.text.trim() ?? ''));
    datedRows.push({ width: page.width, rows: body });
    const complete = body
      .map(bodyWords)
      .filter((row) => row.length === header.length);
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
      lower = lower.map((value, i) => Math.max(value, left[i]));
      upper = upper.map((value, i) => Math.min(value, right[i]));
    }
    // Partial rows may widen a cell. Floating text has no proven column.
    for (const row of body)
      for (const token of row) {
        const start = (token.x / page.width) * 100;
        const end = ((token.x + token.width) / page.width) * 100;
        for (let i = 0; i < lower.length; i++)
          if (start < upper[i] && end > lower[i]) {
            if (start <= lower[i] && end < upper[i]) lower[i] = end;
            else if (start > lower[i] && end >= upper[i]) upper[i] = start;
            else return null;
          }
      }
    if (lower.some((value, i) => value + 0.3 >= upper[i])) return null;
  }
  if (!signature) return null;
  const cuts = lower.map(
    (value, i) => Math.round(((value + upper[i]) / 2) * 10000) / 10000,
  );
  if (
    datedRows.some((page) =>
      page.rows.some((row) =>
        row.some((token) =>
          cuts.some(
            (cut) =>
              cut > (token.x / page.width) * 100 + 0.05 &&
              cut < ((token.x + token.width) / page.width) * 100 - 0.05,
          ),
        ),
      ),
    )
  )
    return null;
  if (
    cuts.some(
      (cut, i) => cut <= 0 || cut >= 100 || (i > 0 && cut <= cuts[i - 1]),
    )
  )
    return null;
  return { cuts, headers };
}

export function suggestPdfColumns(
  pages: { width: number; tokens: PdfToken[] }[],
): number[] | null {
  return suggestPdfColumnLayout(pages)?.cuts ?? null;
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
