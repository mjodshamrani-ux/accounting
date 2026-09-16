/** Canonicalize labels only. Source values and references are never rewritten. */
export const normalizeHeaderLabel = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ');

export function headerMatches(pattern: RegExp, value: string): boolean {
  const label = normalizeHeaderLabel(value);
  if (pattern.test(label)) return true;
  // A bilingual label is explicit only when every part names the same field.
  // E.g. Amount / المبلغ is safe; Amount / Quantity and SAR / USD are not.
  const parts = label.split(/\s+\/\s+|\s*\|\s*/);
  if (parts.length < 2 || parts.some((part) => !pattern.test(part)))
    return false;
  const currencies = new Set(
    [...label.matchAll(/\(([A-Z]{3})\)/gi)].map((m) => m[1].toUpperCase()),
  );
  return currencies.size <= 1;
}
