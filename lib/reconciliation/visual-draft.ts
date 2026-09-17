/** OCR observations are a separate, unverified visual draft. This module does
 * not produce SourceFile, accounting rows, numbers, mappings or approvals.
 */
export const VISUAL_DRAFT_LIMITS = Object.freeze({
  pages: 5,
  words: 20_000,
  characters: 2_000_000,
  pixelsPerPage: 8_000_000,
  imageDataUrlChars: 50 * 1024 * 1024,
});

export type VisualDraftEngine = Readonly<{
  library: 'tesseract.js';
  version: '7.0.0';
  languages: 'eng+ara';
  assetHashes: Readonly<Record<string, string>>;
}>;
export type VisualWord = Readonly<{
  id: string;
  text: string;
  confidence: number | null;
  bbox: Readonly<{ x0: number; y0: number; x1: number; y1: number }>;
}>;
export type VisualDraftPage = Readonly<{
  page: number;
  width: number;
  height: number;
  imageDataUrl: string;
  words: readonly VisualWord[];
}>;
export type VisualDraft = Readonly<{
  kind: 'visual-draft';
  version: 1;
  status: 'unverified';
  source: Readonly<{ name: string; sha256: string }>;
  engine: VisualDraftEngine;
  pageCount: number;
  pages: readonly VisualDraftPage[];
}>;
export type VisualDraftInput = {
  source: { name: string; sha256: string };
  expectedPages: number;
  engine: VisualDraftEngine;
  pages: {
    page: number;
    width: number;
    height: number;
    imageDataUrl: string;
    blocks: unknown;
  }[];
};
export class VisualDraftValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VisualDraftValidationError';
    this.code = code;
  }
}

const fail = (code: string, message: string): never => {
  // Never put document text, image data or filenames in a thrown diagnostic.
  throw new VisualDraftValidationError(code, message);
};
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function hasControlText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
      return true;
  }
  return false;
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return (
        typeof key === 'string' &&
        descriptor.enumerable &&
        'value' in descriptor
      );
    })
  );
}
function shape(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function pngDimensions(dataUrl: string, width: number, height: number) {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix))
    fail('invalid-image', 'المعاينة البصرية يجب أن تكون صورة PNG محلية.');
  const encoded = dataUrl.slice(prefix.length);
  if (
    encoded.length < 44 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    fail('invalid-image', 'ترميز المعاينة البصرية غير صالح.');
  let header: string;
  try {
    header = atob(encoded.slice(0, 44));
  } catch {
    return fail('invalid-image', 'ترميز المعاينة البصرية غير صالح.');
  }
  const bytes = Uint8Array.from(header, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (
    bytes.length < 33 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some(
      (byte, index) => bytes[index] !== byte,
    ) ||
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' ||
    view.getUint32(16) !== width ||
    view.getUint32(20) !== height
  )
    fail('invalid-image', 'أبعاد المعاينة لا تطابق الصفحة المستخرجة.');
  // The renderer/browser must still decode the complete PNG. A matching header
  // is a structural bound, not proof that its pixels came from the source PDF.
}

/** The caller supplies a SHA computed from the original bytes independently of
 * OCR. This binds the draft identity; it cannot establish recognition accuracy.
 * Tesseract blocks/paragraphs/lines are traversed only to copy literal words.
 * Auxiliary OCR metadata is never interpreted as commands or accounting proof.
 */
export function createVisualDraft(
  input: VisualDraftInput,
  expectedSourceHash: string,
): VisualDraft {
  if (
    !shape(input, ['source', 'expectedPages', 'engine', 'pages']) ||
    !shape(input.source, ['name', 'sha256']) ||
    typeof input.source.name !== 'string' ||
    !input.source.name.trim() ||
    input.source.name.length > 255 ||
    hasControlText(input.source.name) ||
    !hash(input.source.sha256) ||
    !hash(expectedSourceHash)
  )
    fail('invalid-source', 'هوية مصدر المسودة البصرية غير صالحة.');
  if (input.source.sha256 !== expectedSourceHash)
    fail('source-mismatch', 'بصمة المسودة البصرية لا تطابق المصدر الحالي.');
  if (
    !shape(input.engine, ['library', 'version', 'languages', 'assetHashes']) ||
    input.engine.library !== 'tesseract.js' ||
    input.engine.version !== '7.0.0' ||
    input.engine.languages !== 'eng+ara' ||
    !record(input.engine.assetHashes)
  )
    fail('invalid-engine', 'إعدادات محرك القراءة البصرية غير معتمدة.');
  const assetHashes = Object.entries(input.engine.assetHashes);
  if (
    !assetHashes.length ||
    assetHashes.length > 32 ||
    assetHashes.some(
      ([name, digest]) =>
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(name) ||
        name
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        ['__proto__', 'constructor', 'prototype'].includes(name) ||
        !hash(digest),
    )
  )
    fail('invalid-engine', 'بصمات أصول القراءة البصرية غير صالحة.');
  if (
    !positiveInteger(input.expectedPages) ||
    input.expectedPages > VISUAL_DRAFT_LIMITS.pages ||
    !Array.isArray(input.pages) ||
    input.pages.length !== input.expectedPages
  )
    fail('invalid-pages', 'يجب إرفاق كل صفحات المسودة، بحد أقصى خمس صفحات.');
  let wordCount = 0,
    characterCount = 0,
    imageChars = 0,
    hierarchyNodes = 0;
  const list = (value: unknown): unknown[] => {
    if (!Array.isArray(value) || value.length > VISUAL_DRAFT_LIMITS.words)
      return fail(
        'invalid-words',
        'لم يُرجع محرك القراءة بنية كلمات كاملة وصالحة.',
      );
    return value;
  };
  const children = (value: unknown, key: string): unknown[] => {
    if (++hierarchyNodes > VISUAL_DRAFT_LIMITS.words * 3)
      return fail('limit-exceeded', 'بنية الكلمات تتجاوز حد المعالجة البصرية.');
    if (!record(value) || !Object.hasOwn(value, key))
      return fail(
        'invalid-words',
        'لم يُرجع محرك القراءة بنية كلمات كاملة وصالحة.',
      );
    return list(value[key]);
  };
  const pages = Array.from(input.pages, (page, index): VisualDraftPage => {
    if (
      !shape(page, ['page', 'width', 'height', 'imageDataUrl', 'blocks']) ||
      page.page !== index + 1 ||
      !positiveInteger(page.width) ||
      !positiveInteger(page.height)
    )
      return fail('invalid-pages', 'ترتيب صفحات المسودة أو أبعادها غير صالح.');
    if (page.width * page.height > VISUAL_DRAFT_LIMITS.pixelsPerPage)
      return fail(
        'limit-exceeded',
        'دقة صفحة المسودة تتجاوز حد المعالجة البصرية.',
      );
    if (typeof page.imageDataUrl !== 'string')
      return fail('invalid-image', 'المعاينة البصرية غير صالحة.');
    imageChars += page.imageDataUrl.length;
    if (imageChars > VISUAL_DRAFT_LIMITS.imageDataUrlChars)
      return fail('limit-exceeded', 'حجم المعاينات يتجاوز حد المسودة البصرية.');
    pngDimensions(page.imageDataUrl, page.width, page.height);
    const words: VisualWord[] = [];
    for (const block of list(page.blocks))
      for (const paragraph of children(block, 'paragraphs'))
        for (const line of children(paragraph, 'lines'))
          for (const raw of children(line, 'words')) {
            if (++wordCount > VISUAL_DRAFT_LIMITS.words)
              return fail(
                'limit-exceeded',
                'عدد الكلمات يتجاوز حد المسودة البصرية.',
              );
            if (
              !record(raw) ||
              typeof raw.text !== 'string' ||
              raw.text.length > 4096 ||
              hasControlText(raw.text) ||
              !(
                raw.confidence === null ||
                (typeof raw.confidence === 'number' &&
                  Number.isFinite(raw.confidence) &&
                  raw.confidence >= 0 &&
                  raw.confidence <= 100)
              ) ||
              !shape(raw.bbox, ['x0', 'y0', 'x1', 'y1'])
            )
              return fail(
                'invalid-words',
                'إحدى كلمات القراءة البصرية أو بياناتها غير صالحة.',
              );
            characterCount += raw.text.length;
            if (characterCount > VISUAL_DRAFT_LIMITS.characters)
              return fail('limit-exceeded', 'النص يتجاوز حد المسودة البصرية.');
            const { x0, y0, x1, y1 } = raw.bbox;
            if (
              [x0, y0, x1, y1].some(
                (coordinate) =>
                  typeof coordinate !== 'number' ||
                  !Number.isFinite(coordinate),
              ) ||
              (x0 as number) < 0 ||
              (y0 as number) < 0 ||
              (x1 as number) <= (x0 as number) ||
              (y1 as number) <= (y0 as number) ||
              (x1 as number) > page.width ||
              (y1 as number) > page.height
            )
              return fail(
                'invalid-words',
                'موضع كلمة القراءة البصرية خارج حدود الصفحة.',
              );
            const bbox = Object.freeze({
              x0: x0 as number,
              y0: y0 as number,
              x1: x1 as number,
              y1: y1 as number,
            });
            words.push(
              Object.freeze({
                // IDs are stable within this source-bound draft, not globally.
                id: `p${page.page}:w${words.length + 1}:${bbox.x0},${bbox.y0},${bbox.x1},${bbox.y1}`,
                text: raw.text,
                confidence: raw.confidence as number | null,
                bbox,
              }),
            );
          }
    return Object.freeze({
      page: page.page,
      width: page.width,
      height: page.height,
      imageDataUrl: page.imageDataUrl,
      words: Object.freeze(words),
    });
  });
  return Object.freeze({
    kind: 'visual-draft',
    version: 1,
    status: 'unverified',
    source: Object.freeze({
      name: input.source.name,
      sha256: input.source.sha256,
    }),
    engine: Object.freeze({
      library: 'tesseract.js',
      version: '7.0.0',
      languages: 'eng+ara',
      assetHashes: Object.freeze(Object.fromEntries(assetHashes)),
    }),
    pageCount: input.expectedPages,
    pages: Object.freeze(pages),
  });
}
