import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  createVisualDraft,
  VisualDraftValidationError,
  VISUAL_DRAFT_LIMITS,
} from '../lib/reconciliation/visual-draft.ts';
import type { VisualDraftInput } from '../lib/reconciliation/visual-draft.ts';

const sourceHash = 'a'.repeat(64);
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// A complete synthetic grayscale PNG, not a real document or OCR result.
function png(width = 40, height = 20) {
  const chunk = (type: string, bytes: Buffer) => {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64')
  );
}
const rawWord = (text = '100.00', confidence: number | null = 91.2) => ({
  text,
  confidence,
  bbox: { x0: 1, y0: 2, x1: 25, y1: 12 },
});
const blocks = (words: unknown[]) => [{ paragraphs: [{ lines: [{ words }] }] }];
const fixture = (words: unknown[] = [rawWord()]): VisualDraftInput => ({
  source: { name: 'synthetic-visual.pdf', sha256: sourceHash },
  expectedPages: 1,
  engine: {
    library: 'tesseract.js',
    version: '7.0.0',
    languages: 'eng+ara',
    assetHashes: {
      'eng.traineddata.gz': 'b'.repeat(64),
      'ara.traineddata.gz': 'c'.repeat(64),
    },
  },
  pages: [
    {
      page: 1,
      width: 40,
      height: 20,
      imageDataUrl: png(),
      blocks: blocks(words),
    },
  ],
});
const reject = (input: unknown, code?: string, expectedHash = sourceHash) => {
  assert.throws(
    () => createVisualDraft(input as VisualDraftInput, expectedHash),
    (error: unknown) => {
      assert.ok(error instanceof VisualDraftValidationError);
      if (code) assert.equal(error.code, code);
      return true;
    },
  );
};

void test('visual factory preserves literal bilingual observations and never creates financial interpretation or approval', () => {
  const words = [
    '100.00',
    '(25.50)',
    '١٢٣٫٤٥',
    '=SUM(A1)',
    'Invoice',
    'فاتورة',
  ].map((text) => ({
    ...rawWord(text, 100),
    matched: true,
    amountMinor: 10000,
    approved: true,
  }));
  const input = fixture(words);
  const draft = createVisualDraft(input, sourceHash);
  assert.equal(draft.kind, 'visual-draft');
  assert.equal(draft.status, 'unverified');
  assert.equal(draft.version, 1);
  assert.deepEqual(draft.source, input.source);
  assert.deepEqual(
    draft.pages[0].words.map((word) => word.text),
    words.map((word) => word.text),
  );
  assert.deepEqual(Object.keys(draft.pages[0].words[0]), [
    'id',
    'text',
    'confidence',
    'bbox',
  ]);
  for (const field of [
    'sheets',
    'original',
    'rows',
    'transactions',
    'reviewed',
    'approved',
    'balance',
    'mapping',
  ])
    assert.equal(Object.hasOwn(draft, field), false);
  assert.equal(draft.pages[0].imageDataUrl, input.pages[0].imageDataUrl);
});

void test('zero, perfect and unknown confidence remain unverified and are never converted to authority', () => {
  for (const confidence of [0, 100, null]) {
    const draft = createVisualDraft(
      fixture([rawWord('50,000', confidence)]),
      sourceHash,
    );
    assert.equal(draft.pages[0].words[0].confidence, confidence);
    assert.equal(draft.status, 'unverified');
    assert.equal(draft.pages[0].words[0].text, '50,000');
  }
  for (const confidence of [-1, 101, Infinity, NaN, '99', undefined])
    reject(fixture([{ ...rawWord(), confidence }]), 'invalid-words');
  reject({ ...fixture(), status: 'verified' }, 'invalid-source');
  reject({ ...fixture(), approved: true }, 'invalid-source');
});

void test('source hash is required and bound independently; document values never enter validation errors', () => {
  const input = fixture([rawWord('SECRET-WORD-DO-NOT-LOG')]);
  for (const sha256 of ['', 'a'.repeat(63), 'z'.repeat(64), null])
    reject({ ...input, source: { ...input.source, sha256 } }, 'invalid-source');
  reject(
    { ...input, source: { ...input.source, sha256: 'd'.repeat(64) } },
    'source-mismatch',
  );
  reject(input, 'invalid-source', 'not-a-hash');
  for (const name of ['', ' ', 'x'.repeat(256), 'hidden\u0000name.pdf'])
    reject({ ...input, source: { ...input.source, name } }, 'invalid-source');
  try {
    createVisualDraft(
      { ...input, source: { ...input.source, sha256: 'd'.repeat(64) } },
      sourceHash,
    );
  } catch (error) {
    assert.ok(error instanceof Error);
    for (const privateValue of [
      input.source.name,
      'SECRET-WORD-DO-NOT-LOG',
      input.pages[0].imageDataUrl,
      sourceHash,
    ])
      assert.equal(error.message.includes(privateValue), false);
  }
});

void test('fixed OCR engine identity and bounded asset hash inventory reject unsafe or invented configuration', () => {
  const input = fixture();
  for (const engine of [
    { ...input.engine, library: 'remote-ai' },
    { ...input.engine, version: 'latest' },
    { ...input.engine, languages: 'eng' },
    { ...input.engine, approved: true },
    { ...input.engine, assetHashes: {} },
    { ...input.engine, assetHashes: { 'eng.gz': 'wrong' } },
    { ...input.engine, assetHashes: { 'https://service/model': sourceHash } },
    { ...input.engine, assetHashes: { '../model': sourceHash } },
    { ...input.engine, assetHashes: { 'folder/../model': sourceHash } },
    { ...input.engine, assetHashes: { constructor: sourceHash } },
    {
      ...input.engine,
      assetHashes: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `asset-${index}`,
          sourceHash,
        ]),
      ),
    },
  ])
    reject({ ...input, engine }, 'invalid-engine');
});

void test('every declared page is required in order and empty OCR pages remain visible unverified pages', () => {
  const input = fixture();
  const emptyPage = { ...input.pages[0], page: 2, blocks: [] };
  const draft = createVisualDraft(
    { ...input, expectedPages: 2, pages: [input.pages[0], emptyPage] },
    sourceHash,
  );
  assert.equal(draft.pageCount, 2);
  assert.equal(draft.pages.length, 2);
  assert.deepEqual(draft.pages[1].words, []);
  assert.ok(draft.pages[1].imageDataUrl.startsWith('data:image/png;base64,'));
  assert.equal(draft.status, 'unverified');
  reject({ ...input, expectedPages: 2 }, 'invalid-pages');
  reject(
    { ...input, expectedPages: 2, pages: [input.pages[0], input.pages[0]] },
    'invalid-pages',
  );
  reject(
    { ...input, expectedPages: 2, pages: [emptyPage, input.pages[0]] },
    'invalid-pages',
  );
  const sparse: typeof input.pages = [];
  sparse.length = 3;
  sparse[0] = input.pages[0];
  sparse[2] = { ...emptyPage, page: 3 };
  reject({ ...input, expectedPages: 3, pages: sparse }, 'invalid-pages');
  for (const expectedPages of [0, 6, 1.5, '1', NaN])
    reject({ ...input, expectedPages }, 'invalid-pages');
  reject({ ...input, pages: [] }, 'invalid-pages');
});

void test('word hierarchy must be present: omitted blocks output cannot masquerade as a successfully read blank page', () => {
  const input = fixture();
  for (const invalidBlocks of [
    null,
    undefined,
    {},
    'text only',
    [null],
    [{}],
    [{ paragraphs: {} }],
    [{ paragraphs: [{}] }],
    [{ paragraphs: [{ lines: [{}] }] }],
    [{ paragraphs: [{ lines: [{ words: null }] }] }],
  ])
    reject(
      { ...input, pages: [{ ...input.pages[0], blocks: invalidBlocks }] },
      'invalid-words',
    );
  const empty = createVisualDraft(
    { ...input, pages: [{ ...input.pages[0], blocks: [] }] },
    sourceHash,
  );
  assert.equal(empty.pages[0].words.length, 0);
  assert.equal(empty.pages[0].imageDataUrl, input.pages[0].imageDataUrl);
});

void test('non-text words, invalid coordinates and accessors reject instead of being coerced', () => {
  for (const text of [
    5,
    null,
    {},
    undefined,
    'x'.repeat(4097),
    'bad\u0000text',
  ])
    reject(fixture([{ ...rawWord(), text }]), 'invalid-words');
  for (const bbox of [
    null,
    [1, 2, 25, 12],
    { x0: '1', y0: 2, x1: 25, y1: 12 },
    { x0: -1, y0: 2, x1: 25, y1: 12 },
    { x0: 1, y0: -1, x1: 25, y1: 12 },
    { x0: 10, y0: 2, x1: 1, y1: 12 },
    { x0: 1, y0: 2, x1: 1, y1: 12 },
    { x0: 1, y0: 2, x1: 41, y1: 12 },
    { x0: 1, y0: 2, x1: 25, y1: 21 },
    { x0: NaN, y0: 2, x1: 25, y1: 12 },
    { x0: 1, y0: 2, x1: Infinity, y1: 12 },
    { x0: 1, y0: 2, x1: 25, y1: 12, approved: true },
  ])
    reject(fixture([{ ...rawWord(), bbox }]), 'invalid-words');
  let reads = 0;
  reject(
    fixture([
      {
        ...rawWord(),
        get text() {
          reads++;
          return '10';
        },
      },
    ]),
    'invalid-words',
  );
  assert.equal(reads, 0);
});

void test('only local bounded PNG previews with matching dimensions are accepted', () => {
  const input = fixture();
  for (const imageDataUrl of [
    'https://example.test/scan.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'data:image/jpeg;base64,AAAA',
    'data:image/png;base64,not-base64!',
    'data:image/png;base64,' + 'A'.repeat(44),
    png(41, 20),
  ])
    reject(
      { ...input, pages: [{ ...input.pages[0], imageDataUrl }] },
      'invalid-image',
    );
  for (const dimensions of [
    { width: 0 },
    { width: 1.5 },
    { height: Infinity },
    { width: '40' },
  ])
    reject(
      { ...input, pages: [{ ...input.pages[0], ...dimensions }] },
      'invalid-pages',
    );
  reject(
    { ...input, pages: [{ ...input.pages[0], width: 4001, height: 2000 }] },
    'limit-exceeded',
  );
  reject(
    {
      ...input,
      pages: [
        {
          ...input.pages[0],
          imageDataUrl: 'x'.repeat(VISUAL_DRAFT_LIMITS.imageDataUrlChars + 1),
        },
      ],
    },
    'limit-exceeded',
  );
});

void test('word and character limits apply across all pages, with a valid exact-limit draft retained', () => {
  const words = Array.from({ length: VISUAL_DRAFT_LIMITS.words }, () =>
    rawWord('x'.repeat(100)),
  );
  const input = fixture(words);
  const draft = createVisualDraft(input, sourceHash);
  assert.equal(draft.pages[0].words.length, 20_000);
  assert.equal(
    draft.pages[0].words.reduce((sum, word) => sum + word.text.length, 0),
    2_000_000,
  );
  assert.equal(
    new Set(draft.pages[0].words.map((word) => word.id)).size,
    20_000,
  );
  reject(
    {
      ...input,
      expectedPages: 2,
      pages: [input.pages[0], { ...fixture().pages[0], page: 2 }],
    },
    'limit-exceeded',
  );
  words[0] = rawWord('x'.repeat(101));
  reject(input, 'limit-exceeded');
  assert.equal(draft.pages[0].words[0].text.length, 100);
});

void test('stable IDs derive from page, word order and geometry; outputs share no mutable OCR objects', () => {
  const input = fixture([rawWord('first'), rawWord('second')]);
  const draft = createVisualDraft(input, sourceHash);
  assert.deepEqual(
    draft.pages[0].words.map((word) => word.id),
    ['p1:w1:1,2,25,12', 'p1:w2:1,2,25,12'],
  );
  assert.deepEqual(createVisualDraft(input, sourceHash), draft);
  for (const value of [
    draft,
    draft.source,
    draft.engine,
    draft.engine.assetHashes,
    draft.pages,
    draft.pages[0],
    draft.pages[0].words,
    draft.pages[0].words[0],
    draft.pages[0].words[0].bbox,
  ])
    assert.equal(Object.isFrozen(value), true);
  input.source.name = 'changed.pdf';
  input.pages[0].imageDataUrl = 'changed';
  (
    input.pages[0].blocks as ReturnType<typeof blocks>
  )[0].paragraphs[0].lines[0].words.length = 0;
  assert.equal(draft.source.name, 'synthetic-visual.pdf');
  assert.equal(draft.pages[0].words.length, 2);
  assert.ok(draft.pages[0].imageDataUrl.startsWith('data:image/png;base64,'));
});
