import { suggestFormats } from './format-inference.ts';
import type { Mapping, Scope, SourceFile } from './types.ts';

/** Product entry guard. A failed whole-column interpretation cannot silently
 * fall through to a default format and produce plausible partial amounts.
 * Ambiguous formats are explicitly chosen in the UI; empty sources remain the
 * normalizer's responsibility. Invalid extraction must first be corrected. */
export function assertInputFormats(
  files: readonly SourceFile[],
  mappings: readonly Mapping[],
  scope: Scope,
): void {
  for (const [i, file] of files.entries()) {
    const formats = suggestFormats(file, mappings[i], scope.decimals);
    for (const field of ['numberFormat', 'dateFormat'] as const) {
      if (formats[field].status === 'invalid')
        throw new Error(
          `${file.name}: تعذر التحقق من صيغة ${field === 'numberFormat' ? 'المبالغ' : 'التواريخ'}. صحح قراءة الأعمدة أو الصفوف المشار إليها قبل المقارنة. ${formats[field].reason}`,
        );
    }
  }
}
