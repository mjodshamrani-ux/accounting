export type ImportDiagnosis = {
  schemaVersion: 1;
  format: 'pdf';
  totalPages: number;
  page: number;
  contentKind: 'native-text' | 'image-only' | 'mixed' | 'no-extractable-text';
  textItems: number;
  textChars: number;
  // Image-paint operator occurrences, not a count of decoded image objects.
  imagePaints: number;
  code: 'PDF_IMAGE_CONTENT' | 'PDF_NO_EXTRACTABLE_TEXT';
  route: 'visual-extraction-required';
  inspectedAllPages: false;
};

const fields = [
  'schemaVersion',
  'format',
  'totalPages',
  'page',
  'contentKind',
  'textItems',
  'textChars',
  'imagePaints',
  'code',
  'route',
  'inspectedAllPages',
] as const;
const integer = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum;

// This object crosses a worker boundary. Accept only the exact bounded factual
// schema; no raw text, user-provided labels, accessors or unchecked extensions.
export function isImportDiagnosis(value: unknown): value is ImportDiagnosis {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !fields.includes(key as (typeof fields)[number]),
      )
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (fields.some((key) => !Object.hasOwn(descriptors[key], 'value')))
      return false;
    const d = value as Record<string, unknown>;
    if (
      d.schemaVersion !== 1 ||
      d.format !== 'pdf' ||
      d.route !== 'visual-extraction-required' ||
      d.inspectedAllPages !== false
    )
      return false;
    if (
      !integer(d.totalPages, 1, 20) ||
      !integer(d.page, 1, d.totalPages as number) ||
      !integer(d.textItems, 0, 100000) ||
      !integer(d.textChars, 0, 2000000) ||
      !integer(d.imagePaints, 0, 1000000)
    )
      return false;
    if (
      (d.textItems === 0 && d.textChars !== 0) ||
      (d.textItems as number) > (d.textChars as number)
    )
      return false;
    const expected =
      d.textItems === 0
        ? d.imagePaints === 0
          ? 'no-extractable-text'
          : 'image-only'
        : d.imagePaints === 0
          ? 'native-text'
          : 'mixed';
    if (d.contentKind !== expected) return false;
    return d.code === 'PDF_IMAGE_CONTENT'
      ? (d.imagePaints as number) > 0
      : d.code === 'PDF_NO_EXTRACTABLE_TEXT' && d.textItems === 0;
  } catch {
    return false;
  }
}

export class ImportDiagnosticError extends Error {
  readonly diagnosis: ImportDiagnosis;
  constructor(message: string, diagnosis: ImportDiagnosis) {
    super(message);
    this.name = 'ImportDiagnosticError';
    if (!isImportDiagnosis(diagnosis))
      throw new TypeError('Invalid import diagnosis');
    this.diagnosis = Object.freeze({ ...diagnosis });
  }
}
