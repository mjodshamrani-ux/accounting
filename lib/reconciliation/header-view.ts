import type { SheetData, SourceFile } from './types.ts';
import { headerMatches, normalizeHeaderLabel } from './header-labels.ts';

type Geometry = NonNullable<SheetData['xlsxHeaders']>;
type Merge = Geometry['merges'][number];
export type HeaderOrigin = {
  column: number;
  row: number;
  label: string;
  range?: string;
  parent?: { row: number; column: number; label: string; range: string };
};
export type HeaderView = {
  labels: readonly string[];
  band: readonly [number, number];
  origins: readonly HeaderOrigin[];
  sourceHash: string;
  rule: 'NATIVE_XLSX_TWO_ROW_MOVEMENT_V1';
};
const registry = new WeakMap<
  SheetData,
  {
    file: SourceFile;
    original: ArrayBuffer;
    geometry: Geometry;
    views: Map<number, { signature: string; view?: HeaderView }>;
  }
>();
const mergedIssue = (message: string) => message.startsWith('خلية مدمجة في ');
const coordinate = (row: number, column: number) => {
  let letters = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row}`;
};
const range = (m: Merge) =>
  `${coordinate(m.top, m.left)}:${coordinate(m.bottom, m.right)}`;

/** Shape checking does NOT register authority. Only the native reader and its
 * validated worker read reply call registerNativeHeaderSource. Restored claims
 * are re-read from original bytes instead. */
export function validHeaderGeometry(sheet: SheetData): boolean {
  const g = sheet.xlsxHeaders;
  if (!g) return true;
  // Already validated and frozen by the native read boundary. Consumers reuse
  // this geometry; source-label/safety changes still invalidate the view below.
  if (registry.get(sheet)?.geometry === g) return true;
  if (
    !/^[a-f0-9]{64}$/.test(g.sourceHash) ||
    g.sheetName !== sheet.name ||
    !Number.isSafeInteger(g.sheetIndex) ||
    g.sheetIndex < 0 ||
    g.sheetIndex >= 40 ||
    !Array.isArray(g.hiddenColumns) ||
    !Array.isArray(g.merges) ||
    g.merges.length > 20030
  )
    return false;
  const width = Math.max(0, ...sheet.rows.map((row) => row.length));
  if (
    g.hiddenColumns.some(
      (c) => !Number.isSafeInteger(c) || c < 1 || c > width,
    ) ||
    new Set(g.hiddenColumns).size !== g.hiddenColumns.length
  )
    return false;
  const occupied = new Set<number>();
  for (const m of g.merges) {
    if (
      !m ||
      [m.top, m.left, m.bottom, m.right].some(
        (n) => !Number.isSafeInteger(n),
      ) ||
      m.top < 1 ||
      m.left < 1 ||
      m.bottom < m.top ||
      m.right < m.left ||
      m.bottom > sheet.rows.length ||
      m.right > width ||
      typeof m.text !== 'string' ||
      m.text.length > 4096 ||
      sheet.rows[m.top - 1]?.[m.left - 1] !== m.text
    )
      return false;
    for (let r = m.top; r <= m.bottom; r++)
      for (let c = m.left; c <= m.right; c++) {
        const key = r * 101 + c;
        if (occupied.has(key)) return false;
        occupied.add(key);
      }
  }
  return true;
}
export function registerNativeHeaderSource(file: SourceFile): void {
  for (const [sheetIndex, sheet] of file.sheets.entries()) {
    const g = sheet.xlsxHeaders;
    if (
      !g ||
      g.sourceHash !== file.sha256 ||
      g.sheetIndex !== sheetIndex ||
      !(file.original instanceof ArrayBuffer) ||
      !/\.xlsx$/i.test(file.name) ||
      !validHeaderGeometry(sheet)
    )
      continue;
    // Geometry is immutable, including after crossing the worker boundary.
    for (const m of g.merges) Object.freeze(m);
    Object.freeze(g.merges);
    Object.freeze(g.hiddenColumns);
    Object.freeze(g);
    registry.set(sheet, {
      file,
      original: file.original!,
      geometry: g,
      views: new Map(),
    });
  }
}
const currencies = (label: string) =>
  [...normalizeHeaderLabel(label).matchAll(/\(([A-Z]{3})\)/gi)].map((m) =>
    m[1].toUpperCase(),
  );
const parentPattern = /^(?:Movement|الحركة)(?:\s*\([a-z]{3}\))?$/i;
const debitPattern = /^(?:Debit|Dr\.?|مدين)(?:\s*\([a-z]{3}\))?$/i;
const creditPattern = /^(?:Credit|Cr\.?|دائن)(?:\s*\([a-z]{3}\))?$/i;
const amountPattern =
  /^(?:amount|signed amount|outstanding|remaining|value|net|net amount|charge|المبلغ|القيمة|المتبقي|الرصيد المتبقي|الصافي)(?:\s*\([a-z]{3}\))?$/i;
function rawIssues(
  sheet: SheetData,
  row: number,
  column: number,
  allowMerge: boolean,
): string[] {
  const key = `${row}:${column}`;
  return [
    ...(sheet.cellIssues?.[key] ?? []).filter(
      (x) => !(allowMerge && mergedIssue(x)),
    ),
    ...(sheet.referenceIssues?.[key] ?? []),
    ...(sheet.rowIssues?.[row] ?? []),
    ...(sheet.hiddenRows.includes(row) ||
    sheet.xlsxHeaders?.hiddenColumns.includes(column)
      ? ['Hidden header']
      : []),
    ...(sheet.formulaCells?.[key] ||
    (!sheet.cellIssues && sheet.formulaRows.includes(row))
      ? ['Formula header']
      : []),
  ];
}
function derive(
  sheet: SheetData,
  header: number,
  g: Geometry,
): HeaderView | undefined {
  const top = header,
    bottom = header + 1; // one-based source rows
  if (top < 1 || bottom > sheet.rows.length) return;
  const touching = g.merges.filter((m) => m.bottom >= top && m.top <= bottom);
  if (
    touching.some(
      (m) =>
        m.top !== top ||
        m.bottom > bottom ||
        !(
          (m.left === m.right && m.bottom === bottom) ||
          (m.bottom === top && m.right === m.left + 1)
        ),
    )
  )
    return;
  const parents = touching.filter((m) => m.bottom === top && m.right > m.left);
  if (parents.length !== 1 || !headerMatches(parentPattern, parents[0].text))
    return;
  const parent = parents[0];
  if (
    sheet.rows[top - 1]?.[parent.left - 1] !== parent.text ||
    sheet.rows[top - 1]?.[parent.right - 1] !== parent.text
  )
    return;
  const labels = [...sheet.rows[header]];
  const origins: HeaderOrigin[] = [];
  for (let c = 1; c <= labels.length; c++) {
    const vertical = touching.find(
      (m) => m.left === c && m.right === c && m.bottom === bottom,
    );
    const upper = sheet.rows[top - 1]?.[c - 1] ?? '';
    if (vertical) {
      if (
        upper !== vertical.text ||
        labels[c - 1] !== vertical.text ||
        rawIssues(sheet, top, c, true).length ||
        rawIssues(sheet, bottom, c, true).length
      )
        return;
      labels[c - 1] = vertical.text;
      origins.push({
        column: c,
        row: top,
        label: vertical.text,
        range: range(vertical),
      });
    } else {
      if (c !== parent.left && c !== parent.right && upper.trim()) return;
      if (
        rawIssues(sheet, bottom, c, false).length ||
        ((c === parent.left || c === parent.right) &&
          rawIssues(sheet, top, c, true).length)
      )
        return;
      origins.push({ column: c, row: bottom, label: labels[c - 1] });
    }
  }
  if (
    !headerMatches(debitPattern, labels[parent.left - 1]) ||
    !headerMatches(creditPattern, labels[parent.right - 1])
  ) {
    if (
      !headerMatches(creditPattern, labels[parent.left - 1]) ||
      !headerMatches(debitPattern, labels[parent.right - 1])
    )
      return;
  }
  if (
    labels.filter((l) => headerMatches(debitPattern, l)).length !== 1 ||
    labels.filter((l) => headerMatches(creditPattern, l)).length !== 1 ||
    labels.some((l) => headerMatches(amountPattern, l))
  )
    return;
  const codes = new Set([parent.text, ...labels].flatMap(currencies));
  if (codes.size > 1) return;
  const parentCurrency = currencies(parent.text)[0];
  for (const c of [parent.left, parent.right]) {
    // Consumers must see the same canonical currency token that made this
    // label eligible. Literal source labels remain in the origins below.
    labels[c - 1] = normalizeHeaderLabel(labels[c - 1]);
    origins[c - 1].parent = {
      row: top,
      column: parent.left,
      label: parent.text,
      range: range(parent),
    };
    if (parentCurrency && !currencies(labels[c - 1]).length)
      labels[c - 1] = labels[c - 1]
        .split(/\s+\/\s+|\s*\|\s*/)
        .map((p) => `${p} (${parentCurrency})`)
        .join(' / ');
  }
  origins.forEach((o) => {
    if (o.parent) Object.freeze(o.parent);
    Object.freeze(o);
  });
  return Object.freeze({
    labels: Object.freeze(labels),
    band: Object.freeze([top, bottom] as [number, number]),
    origins: Object.freeze(origins),
    sourceHash: g.sourceHash,
    rule: 'NATIVE_XLSX_TWO_ROW_MOVEMENT_V1' as const,
  });
}
export function layeredHeaderView(
  sheet: SheetData,
  header: number,
): HeaderView | undefined {
  const record = registry.get(sheet);
  if (
    !record ||
    sheet.xlsxHeaders !== record.geometry ||
    sheet.name !== record.geometry.sheetName ||
    record.file.sheets[record.geometry.sheetIndex] !== sheet ||
    record.file.sha256 !== record.geometry.sourceHash ||
    record.file.original !== record.original
  )
    return;
  // A small two-row snapshot invalidates cached evidence on any source-label or
  // safety change. Native merge geometry is validated once, never per row.
  const signature = JSON.stringify([
    sheet.rows[header - 1],
    sheet.rows[header],
    [header, header + 1].map((r) => ({
      hidden: sheet.hiddenRows.includes(r),
      row: sheet.rowIssues?.[r],
      formula: sheet.formulaRows.includes(r),
      cells: (sheet.rows[r - 1] ?? []).map((_, c) => [
        sheet.cellIssues?.[`${r}:${c + 1}`],
        sheet.referenceIssues?.[`${r}:${c + 1}`],
        sheet.formulaCells?.[`${r}:${c + 1}`],
      ]),
    })),
  ]);
  const cached = record.views.get(header);
  if (cached?.signature === signature) return cached.view;
  const view = derive(sheet, header, record.geometry);
  record.views.set(header, { signature, view });
  return view;
}
export function headerLabels(
  sheet: SheetData,
  header: number,
): readonly string[] {
  return layeredHeaderView(sheet, header)?.labels ?? sheet.rows[header] ?? [];
}
/** Identifies a possible two-row band only as an ambiguity barrier. It confers
 * no authority, so even forged metadata can only prevent an automatic reading. */
export function hasLayeredHeaderCandidate(
  sheet: SheetData,
  topIndex: number,
): boolean {
  const top = topIndex + 1;
  return (
    !!sheet.xlsxHeaders?.merges.some(
      (m) => m.top === top && m.bottom === top + 1 && m.left === m.right,
    ) &&
    ((sheet.rows[topIndex] ?? []).some((l) =>
      headerMatches(parentPattern, l),
    ) ||
      (sheet.rows[topIndex + 1] ?? []).some(
        (l) =>
          headerMatches(debitPattern, l) || headerMatches(creditPattern, l),
      ))
  );
}
export function headerCellIssues(
  sheet: SheetData,
  header: number,
  column: number,
): string[] {
  const view = layeredHeaderView(sheet, header);
  if (!view) return rawIssues(sheet, header + 1, column + 1, false);
  const origin = view.origins[column];
  if (!origin) return ['Missing header origin'];
  return rawIssues(sheet, origin.row, column + 1, !!origin.range);
}
