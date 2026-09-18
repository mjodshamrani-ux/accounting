import { suggestFormats } from './format-inference.ts';
import type { FormatChoice, Mapping, Scope, SourceFile } from './types.ts';

const fieldLabel = (field: 'numberFormat' | 'dateFormat') =>
  field === 'numberFormat' ? 'المبالغ' : 'التواريخ';

export type InputReadinessCode =
  | 'FORMAT_INVALID'
  | 'FORMAT_AMBIGUOUS_UNRESOLVED';
/** Facts about the refusal, small enough to cross the worker boundary intact.
 * It reports why entry was refused; it carries no source values. */
export type InputReadinessRejection = {
  code: InputReadinessCode;
  source: string;
  field: 'numberFormat' | 'dateFormat';
  candidates: string[];
};
/** A deliberate refusal by this guard, so a caller and a test can tell it apart
 * from a programming fault. Any other error escaping the guard is a defect and
 * must never be read as protection working. */
export class InputReadinessError extends Error {
  readonly readiness: InputReadinessRejection;
  constructor(message: string, readiness: InputReadinessRejection) {
    super(message);
    this.name = 'InputReadinessError';
    this.readiness = readiness;
  }
}
const codes: InputReadinessCode[] = [
  'FORMAT_INVALID',
  'FORMAT_AMBIGUOUS_UNRESOLVED',
];
/** True only for this guard's own refusal, optionally of one specific code.
 * A TypeError, a missing guard or a plain Error never satisfies it. */
export function isInputReadinessRejection(
  error: unknown,
  code?: InputReadinessCode,
): error is InputReadinessError {
  const readiness = (error as InputReadinessError | undefined)?.readiness;
  return (
    error instanceof Error &&
    error.name === 'InputReadinessError' &&
    !!readiness &&
    codes.includes(readiness.code) &&
    (code === undefined || readiness.code === code) &&
    typeof readiness.source === 'string' &&
    ['numberFormat', 'dateFormat'].includes(readiness.field) &&
    Array.isArray(readiness.candidates)
  );
}

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

/** The evidence-shaping settings behind one field's interpretation. The file
 * hash and the column numbers can all stay the same while these change what the
 * engine actually reads, so an answer given under one of them is not an answer
 * under another. Balances are typed in beside the table and join the amount
 * evidence, so they bind the number format only. */
function evidenceContext(
  file: SourceFile,
  mapping: Mapping,
  field: 'numberFormat' | 'dateFormat',
) {
  return {
    cuts: [...(file.pdf?.cuts ?? [])],
    excludedRows: Object.entries(mapping.excluded ?? {})
      .filter(([, reason]) => typeof reason === 'string' && reason.trim())
      .map(([row]) => Number(row))
      .filter(Number.isFinite)
      .sort((a, b) => a - b),
    balanceInputs:
      field === 'numberFormat'
        ? [mapping.opening, mapping.closing].map((value) =>
            (value ?? '').trim(),
          )
        : [],
  };
}
const sameNumbers = (a: unknown, b: readonly number[]) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const sameStrings = (a: unknown, b: readonly string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Records that the accountant answered an ambiguity the document cannot settle.
 * It is bound to the source hash and the reading it was made under, so it cannot
 * travel to another document, another column, another currency precision, or a
 * different set of extraction boundaries, exclusions or entered balances. */
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
    ...evidenceContext(file, mapping, field),
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
  const context = evidenceContext(file, mapping, field);
  return (
    choice.value === mapping[field] &&
    // The candidate list is recomputed from the document on every check, so a
    // stored choice can never widen what the source actually allows.
    candidates.includes(choice.value) &&
    choice.sourceHash === (file.sha256 ?? '') &&
    choice.sheet === mapping.sheet &&
    choice.header === mapping.header &&
    choice.decimals === decimals &&
    sameNumbers(choice.columns, columns) &&
    sameNumbers(choice.cuts, context.cuts) &&
    sameNumbers(choice.excludedRows, context.excludedRows) &&
    sameStrings(choice.balanceInputs, context.balanceInputs)
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
        throw new InputReadinessError(
          `${file.name}: تعذر التحقق من صيغة ${fieldLabel(field)}. صحح قراءة الأعمدة أو الصفوف المشار إليها قبل المقارنة. ${assessment.reason}`,
          {
            code: 'FORMAT_INVALID',
            source: file.name,
            field,
            candidates: [...assessment.candidates],
          },
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
        throw new InputReadinessError(
          `${file.name}: صيغة ${fieldLabel(field)} تحتمل أكثر من قراءة بنتائج مختلفة. اختر الصيغة الصحيحة لهذا المصدر قبل المقارنة. ${assessment.reason}`,
          {
            code: 'FORMAT_AMBIGUOUS_UNRESOLVED',
            source: file.name,
            field,
            candidates: [...assessment.candidates],
          },
        );
    }
  }
}
