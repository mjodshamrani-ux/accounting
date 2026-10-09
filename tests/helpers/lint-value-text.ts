/** Existing fixture and whole-workbook scans intentionally preserve native
 * String(value), including object default text. This helper creates no new
 * assertion and supplies no accounting authority. */
export function testValueText(value: unknown): string {
  // oxlint-disable-next-line typescript/no-base-to-string
  return String(value);
}

function defaultSortText(value: unknown): string {
  // Array.sort's ToString rejects direct symbols; String(symbol) accepts them.
  if (typeof value === 'symbol')
    throw new TypeError('Cannot convert a Symbol value to a string');
  return testValueText(value);
}

/** Preserve native Array.sort UTF-16 order and string-hint coercion, including
 * tuple comma joins, custom object coercion and its observable side effects. */
export function compareDefaultSort(first: unknown, second: unknown): number {
  const a = defaultSortText(first),
    b = defaultSortText(second);
  return a < b ? -1 : a > b ? 1 : 0;
}
