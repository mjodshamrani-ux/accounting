import { suggestFormats } from './format-inference.ts';
import type { FormatChoice, Mapping, Scope, SourceFile } from './types.ts';

const fieldLabel = (field: 'numberFormat' | 'dateFormat') =>
  field === 'numberFormat' ? 'المبالغ' : 'التواريخ';

/** The columns whose values a format decides. A choice made for one reading of
 * the source is not evidence for another reading of it. */
export function formatChoiceColumns(
  mapping: Mapping,
  field: 'numberFormat' | 'dateFormat',
): number[] {
  return field === 'dateFormat'
    ? [mapping.date]
    : mapping.mode === 'signed'
      ? [mapping.amount]
      : [mapping.debit, mapping.credit];
}

/** Records that the accountant answered an ambiguity the document cannot settle.
 * It is bound to the source hash and the reading it was made under, so it cannot
 * travel to another document, another column or another currency precision. */
export function formatChoice(
  file: SourceFile,
  mapping: Mapping,
  field: 'numberFormat' | 'dateFormat',
  value: string,
  candidates: readonly string[],
  decimals: Scope['decimals'],
): FormatChoice {
  return {
    value,
    sourceHash: file.sha256 ?? '',
    sheet: mapping.sheet,
    header: mapping.header,
    columns: formatChoiceColumns(mapping, field),
    decimals,
    candidates: [...candidates],
  };
}

function choiceMatchesContext(
  choice: FormatChoice | undefined,
  file: SourceFile,
  mapping: Mapping,
  field: 'numberFormat' | 'dateFormat',
  candidates: readonly string[],
  decimals: Scope['decimals'],
): boolean {
  if (!choice || typeof choice !== 'object') return false;
  const columns = formatChoiceColumns(mapping, field);
  return (
    choice.value === mapping[field] &&
    // The candidate list is recomputed from the document on every check, so a
    // stored choice can never widen what the source actually allows.
    candidates.includes(choice.value) &&
    choice.sourceHash === (file.sha256 ?? '') &&
    choice.sheet === mapping.sheet &&
    choice.header === mapping.header &&
    choice.decimals === decimals &&
    Array.isArray(choice.columns) &&
    choice.columns.length === columns.length &&
    choice.columns.every((column, i) => column === columns[i])
  );
}

/** Product entry guard, shared by the UI, the worker, session restore and
 * export. A failed whole-column interpretation cannot silently fall through to
 * a default format and produce plausible partial amounts. An ambiguity whose
 * readings disagree needs the accountant's explicit answer, carried with the
 * document it was given for. Where every permitted reading yields the same
 * values, format inference reports `proven` and no choice is asked for.
 * Empty sources remain the normalizer's responsibility; invalid extraction must
 * be corrected first and no confirmation can make it valid. */
export function assertInputFormats(
  files: readonly SourceFile[],
  mappings: readonly Mapping[],
  scope: Scope,
): void {
  for (const [i, file] of files.entries()) {
    const mapping = mappings[i];
    const formats = suggestFormats(file, mapping, scope.decimals);
    for (const field of ['numberFormat', 'dateFormat'] as const) {
      const assessment = formats[field];
      if (assessment.status === 'invalid')
        throw new Error(
          `${file.name}: تعذر التحقق من صيغة ${fieldLabel(field)}. صحح قراءة الأعمدة أو الصفوف المشار إليها قبل المقارنة. ${assessment.reason}`,
        );
      if (
        assessment.status === 'ambiguous' &&
        !choiceMatchesContext(
          mapping.formatChoice?.[field],
          file,
          mapping,
          field,
          assessment.candidates,
          scope.decimals,
        )
      )
        throw new Error(
          `${file.name}: صيغة ${fieldLabel(field)} تحتمل أكثر من قراءة بنتائج مختلفة. اختر الصيغة الصحيحة لهذا المصدر قبل المقارنة. ${assessment.reason}`,
        );
    }
  }
}
