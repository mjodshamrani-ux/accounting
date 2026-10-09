import { suggestFormats } from './format-inference.ts';
import { formatChoice } from './input-readiness.ts';
import type { FormatChoice, Mapping, SheetData, SourceFile } from './types.ts';
import type { SectionCellEvidence } from './section-continuation.ts';

export const SECTION_CURRENCY_POLICY = Object.freeze({
  SAR: 2,
  JPY: 0,
  KWD: 3,
} as const);
export type SectionCurrencyCode = keyof typeof SECTION_CURRENCY_POLICY;
export type SectionCurrencyContext = {
  code: SectionCurrencyCode;
  decimals: 0 | 2 | 3;
  precisionOrigin: 'finite-contract-policy';
  headerCells: SectionCellEvidence[];
};

/** Admission is an exact original-cell vocabulary, never general currency inference. */
export function qualifiedSectionCurrency(
  sheet: SheetData | undefined,
  reading: Mapping,
): SectionCurrencyCode | null {
  if (
    !sheet ||
    reading.sheet !== 0 ||
    reading.header !== 0 ||
    reading.date !== 0 ||
    reading.reference !== 1 ||
    reading.description !== 2 ||
    reading.amount !== 3
  )
    return null;
  const header = sheet.rows[reading.header];
  if (
    !header ||
    header.length !== 4 ||
    header[0] !== 'Date' ||
    header[1] !== 'Reference' ||
    header[2] !== 'Description'
  )
    return null;
  for (const code of ['SAR', 'JPY', 'KWD'] as const)
    if (header[3] === `Signed amount (${code})`) return code;
  return null;
}

export const SECTION_FORMAT_CHOICE_KEYS = [
  'value',
  'sourceHash',
  'sheet',
  'header',
  'columns',
  'decimals',
  'candidates',
  'cuts',
  'excludedRows',
  'balanceInputs',
] as const;

/** The adapter adds exact candidate agreement to the ordinary source-bound choice.
 * Callers must descriptor-preflight the owned reading before entering this helper. */
export function validateSectionNumberChoice(
  source: SourceFile,
  reading: Mapping,
  context: Pick<SectionCurrencyContext, 'code' | 'decimals'>,
): { ambiguous: boolean; choice?: FormatChoice } {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    throw new Error('A finite qualified currency context is required.');
  const code = Object.getOwnPropertyDescriptor(context, 'code');
  const decimals = Object.getOwnPropertyDescriptor(context, 'decimals');
  if (
    !code ||
    !decimals ||
    !Object.hasOwn(code, 'value') ||
    !Object.hasOwn(decimals, 'value') ||
    typeof code.value !== 'string' ||
    !Object.hasOwn(SECTION_CURRENCY_POLICY, code.value) ||
    decimals.value !==
      SECTION_CURRENCY_POLICY[code.value as SectionCurrencyCode]
  )
    throw new Error(
      'A finite qualified currency context and precision policy are required.',
    );
  if (
    context.decimals !== SECTION_CURRENCY_POLICY[context.code] ||
    qualifiedSectionCurrency(source.sheets[reading.sheet], reading) !==
      context.code ||
    reading.numberFormat !== 'dot'
  )
    throw new Error(
      'The qualified currency, precision or dot reading changed.',
    );
  const assessment = suggestFormats(
    source,
    reading,
    context.decimals,
  ).numberFormat;
  const supplied = reading.formatChoice?.numberFormat;
  if (assessment.status !== 'ambiguous' && !supplied)
    return { ambiguous: false };
  if (!supplied || reading.formatChoice?.dateFormat !== undefined)
    throw new Error(
      'An explicit original dot number interpretation choice is required.',
    );
  const expected = formatChoice(
    source,
    reading,
    'numberFormat',
    'dot',
    assessment.candidates,
    context.decimals,
  );
  // Reconstruct every binding, including the stored candidate array which the
  // shared input-readiness guard deliberately does not compare.
  if (
    Object.keys(supplied).length !== SECTION_FORMAT_CHOICE_KEYS.length ||
    SECTION_FORMAT_CHOICE_KEYS.some(
      (key) => JSON.stringify(supplied[key]) !== JSON.stringify(expected[key]),
    )
  )
    throw new Error(
      'The original or derived dot choice does not match fresh source, candidates or reading context.',
    );
  return {
    ambiguous: assessment.status === 'ambiguous',
    choice: structuredClone(supplied),
  };
}
