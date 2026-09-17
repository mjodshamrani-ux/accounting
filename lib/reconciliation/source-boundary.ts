/** Visual observations are not native accounting input, even if a caller adds
 * plausible sheets or original bytes. A future reviewed replay path must be an
 * explicit integration, never the demo CSV fallback or an unchecked type cast.
 */
export function assertNativeAccountingSource(source: unknown): void {
  if (
    source !== null &&
    typeof source === 'object' &&
    'kind' in source &&
    source.kind === 'visual-draft'
  )
    throw new Error(
      'المسودة البصرية غير متحققة ولا تصلح مصدرًا للمقارنة أو التصدير المحاسبي.',
    );
}
