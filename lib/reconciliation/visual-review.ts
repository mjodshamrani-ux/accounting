/** Cell evidence only. A reviewed word does not prove row coverage, column
 * meaning, a transaction, a match or a reconciled balance. */
import { createVisualDraft } from './visual-draft.ts';
import type { VisualDraft, VisualWord } from './visual-draft.ts';
import { VISUAL_ENGINE } from './visual-assets.ts';
import {
  decodePngUrl,
  encodePngUrl,
  digest,
  pngPixelEvidence,
  VisualEvidenceError,
  VISUAL_EVIDENCE_LIMITS,
} from './visual-png.ts';
export { VisualEvidenceError } from './visual-png.ts';
export type VisualCellRole = 'amount' | 'date' | 'reference' | 'currency';
export type VisualCell = Readonly<{
  wordId: string;
  role: VisualCellRole;
  observed: string;
  value: string;
  region: Readonly<{ x0: number; y0: number; x1: number; y1: number }>;
  review: Readonly<{
    revision: string;
    fingerprint: string;
    checkedAt: string;
  }> | null;
}>;
export type VisualRegion = Readonly<{
  id: string;
  origin: 'manual-crop';
  role: VisualCellRole;
  observed: readonly Readonly<{
    wordId: string;
    text: string;
    complete: boolean;
  }>[];
  value: string;
  region: VisualCell['region'];
  review: VisualCell['review'];
}>;
type VisualReviewBase = Readonly<{
  kind: 'visual-review';
  status: 'cell-evidence-only';
  source: Readonly<{ name: string; sha256: string; originalPng: string }>;
  draft: VisualDraft;
  pixelSha256: string;
  revision: string;
  cells: readonly VisualCell[];
}>;
export type VisualReview = VisualReviewBase &
  (
    | Readonly<{ version: 1 }>
    | Readonly<{ version: 2; regions: readonly VisualRegion[] }>
  );
export const visualRegions = (value: VisualReview): readonly VisualRegion[] =>
  value.version === 2 ? value.regions : [];
const accepted = new WeakSet<object>();
const reject = (
  code: ConstructorParameters<typeof VisualEvidenceError>[0],
): never => {
  throw new VisualEvidenceError(code);
};
const textDigest = (value: unknown) =>
  digest(new TextEncoder().encode(JSON.stringify(value)));
const roles = ['amount', 'date', 'reference', 'currency'];
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every(
    (k) =>
      typeof k === 'string' &&
      Object.getOwnPropertyDescriptor(v, k)?.enumerable &&
      'value' in Object.getOwnPropertyDescriptor(v, k)!,
  );
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const freeze = <T extends VisualReview>(value: T): T => {
  Object.freeze(value.source);
  value.cells.forEach((cell) => {
    Object.freeze(cell.region);
    if (cell.review) Object.freeze(cell.review);
    Object.freeze(cell);
  });
  Object.freeze(value.cells);
  if (value.version === 2) {
    value.regions.forEach((r) => {
      r.observed.forEach(Object.freeze);
      Object.freeze(r.observed);
      Object.freeze(r.region);
      if (r.review) Object.freeze(r.review);
      Object.freeze(r);
    });
    Object.freeze(value.regions);
  }
  Object.freeze(value);
  accepted.add(value);
  return value;
};
export function assertVisualReview(value: VisualReview) {
  if (!accepted.has(value)) reject('record');
}
const assertAccepted = assertVisualReview;
export const isVisualLiteral = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 512 &&
  !!value.trim() &&
  !Array.from(value).some(
    (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
  );
const regionOf = (word: VisualWord, width: number, height: number) => ({
  x0: Math.max(0, word.bbox.x0 - 64),
  y0: Math.max(0, word.bbox.y0 - 24),
  x1: Math.min(width, word.bbox.x1 + 64),
  y1: Math.min(height, word.bbox.y1 + 24),
});
function validRegion(
  region: unknown,
  word: VisualWord,
  width: number,
  height: number,
) {
  return (
    shape(region, ['x0', 'y0', 'x1', 'y1']) &&
    Object.values(region).every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) &&
    Number(region.x0) >= 0 &&
    Number(region.y0) >= 0 &&
    Number(region.x1) <= width &&
    Number(region.y1) <= height &&
    Number(region.x0) <= word.bbox.x0 &&
    Number(region.y0) <= word.bbox.y0 &&
    Number(region.x1) >= word.bbox.x1 &&
    Number(region.y1) >= word.bbox.y1
  );
}
const fingerprint = (revision: string, cell: VisualCell) =>
  textDigest([
    revision,
    cell.wordId,
    cell.role,
    cell.observed,
    cell.value,
    cell.region,
  ]);

// Snapshot plain JSON data before the first await. Never call a supplied
// getter/toJSON or retain a caller-owned mutable draft across crypto/decoding.
function snapshotDraft(input: unknown): VisualDraft {
  const pending: unknown[] = [input],
    seen = new WeakSet<object>();
  let nodes = 0,
    characters = 0;
  while (pending.length) {
    const value = pending.pop();
    if (++nodes > 300_000) return reject('limit');
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > VISUAL_EVIDENCE_LIMITS.recordBytes)
        return reject('limit');
    } else if (value !== null && typeof value === 'object') {
      if (seen.has(value)) return reject('record');
      seen.add(value);
      if (Array.isArray(value)) {
        if (
          Object.getPrototypeOf(value) !== Array.prototype ||
          Reflect.ownKeys(value).length !== value.length + 1 ||
          value.length > 20_000
        )
          return reject('record');
        for (let i = 0; i < value.length; i++) {
          const item = Object.getOwnPropertyDescriptor(value, String(i));
          if (!item || !('value' in item)) return reject('record');
          pending.push(item.value);
        }
      } else {
        if (!record(value)) return reject('record');
        pending.push(...Object.values(value));
      }
    } else if (
      value !== null &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    )
      return reject('record');
  }
  const copy: unknown = JSON.parse(JSON.stringify(input));
  if (
    !shape(copy, [
      'kind',
      'version',
      'status',
      'source',
      'engine',
      'pageCount',
      'pages',
    ]) ||
    copy.kind !== 'visual-draft' ||
    copy.version !== 1 ||
    copy.status !== 'unverified' ||
    copy.pageCount !== 1 ||
    !shape(copy.source, ['name', 'sha256']) ||
    !Array.isArray(copy.pages) ||
    copy.pages.length !== 1
  )
    return reject('record');
  const page = copy.pages[0];
  if (
    !shape(page, ['page', 'width', 'height', 'imageDataUrl', 'words']) ||
    !Array.isArray(page.words) ||
    page.words.some((w) => !shape(w, ['id', 'text', 'confidence', 'bbox']))
  )
    return reject('record');
  return copy as unknown as VisualDraft;
}

export async function createVisualReview(
  input: VisualDraft,
  original: Uint8Array,
): Promise<VisualReview> {
  const draft = snapshotDraft(input);
  if (!(original instanceof Uint8Array) || !original.byteLength)
    return reject('record');
  const copy = new Uint8Array(original);
  if ((await digest(copy)) !== draft.source.sha256) return reject('source');
  const page = draft.pages[0];
  const native = await pngPixelEvidence(copy);
  const displayed = await pngPixelEvidence(decodePngUrl(page.imageDataUrl));
  if (
    native.width !== page.width ||
    native.height !== page.height ||
    displayed.width !== page.width ||
    displayed.height !== page.height ||
    native.pixelSha256 !== displayed.pixelSha256
  )
    return reject('source');
  if (JSON.stringify(draft.engine) !== JSON.stringify(VISUAL_ENGINE))
    return reject('record');
  let rebuilt: VisualDraft;
  try {
    rebuilt = createVisualDraft(
      {
        source: { ...draft.source },
        expectedPages: 1,
        engine: draft.engine,
        pages: [
          {
            page: 1,
            width: page.width,
            height: page.height,
            imageDataUrl: page.imageDataUrl,
            blocks: [
              {
                paragraphs: [
                  {
                    lines: [
                      {
                        words: page.words.map((w) => ({
                          text: w.text,
                          confidence: w.confidence,
                          bbox: w.bbox,
                        })),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      draft.source.sha256,
    );
  } catch {
    return reject('record');
  }
  if (JSON.stringify(rebuilt) !== JSON.stringify(draft))
    return reject('record');
  const revision = await textDigest([
    'tarasuf-visual-review-v1',
    draft.source.sha256,
    native.pixelSha256,
    rebuilt.engine,
    rebuilt.pages[0].words,
  ]);
  return freeze({
    kind: 'visual-review',
    version: 1,
    status: 'cell-evidence-only',
    source: { ...draft.source, originalPng: encodePngUrl(copy) },
    draft: rebuilt,
    pixelSha256: native.pixelSha256,
    revision,
    cells: [],
  });
}

export function editVisualCell(
  value: VisualReview,
  wordId: string,
  role: VisualCellRole,
  text: string,
  region?: VisualCell['region'],
): VisualReview {
  assertAccepted(value);
  const page = value.draft.pages[0],
    word = page.words.find((w) => w.id === wordId);
  if (!word || !roles.includes(role) || !isVisualLiteral(text))
    return reject('cell');
  const box = region ?? regionOf(word, page.width, page.height);
  if (!validRegion(box, word, page.width, page.height)) return reject('cell');
  const cells = value.cells.filter((c) => c.wordId !== wordId);
  if (
    cells.length + visualRegions(value).length >=
    VISUAL_EVIDENCE_LIMITS.cells
  )
    return reject('limit');
  cells.push({
    wordId,
    role,
    observed: word.text,
    value: text,
    region: { ...box },
    review: null,
  });
  return freeze({ ...value, cells });
}
export function removeVisualCell(
  value: VisualReview,
  wordId: string,
): VisualReview {
  assertAccepted(value);
  return freeze({
    ...value,
    cells: value.cells.filter((c) => c.wordId !== wordId),
  });
}
export async function confirmVisualCell(
  value: VisualReview,
  wordId: string,
  checkedAt: string,
): Promise<VisualReview> {
  assertAccepted(value);
  const cell = value.cells.find((c) => c.wordId === wordId);
  if (
    !cell ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(checkedAt) ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    new Date(checkedAt).toISOString() !== checkedAt
  )
    return reject('cell');
  const proof = {
    revision: value.revision,
    fingerprint: await fingerprint(value.revision, cell),
    checkedAt,
  };
  return freeze({
    ...value,
    cells: value.cells.map((c) =>
      c.wordId === wordId ? { ...c, review: proof } : c,
    ),
  });
}
const regionFingerprint = (revision: string, cell: VisualRegion) =>
  textDigest([
    'tarasuf-visual-region-v1',
    revision,
    cell.id,
    cell.origin,
    cell.role,
    cell.observed,
    cell.value,
    cell.region,
  ]);
export function nextVisualRegionId(value: VisualReview): string {
  assertAccepted(value);
  const highest = Math.max(
    0,
    ...visualRegions(value).map((r) => Number(r.id.split(':')[1])),
  );
  if (highest >= 999999) return reject('limit');
  return `region:${highest + 1}`;
}
/** A reviewer-selected pixel region, including values OCR entirely omitted.
 * Observations are derived from every intersecting raw OCR word, never supplied
 * by the caller. Even a fully reviewed region remains cell evidence only. */
export function editVisualRegion(
  value: VisualReview,
  id: string,
  role: VisualCellRole,
  text: string,
  region: VisualCell['region'],
): VisualReview {
  assertAccepted(value);
  const page = value.draft.pages[0];
  if (
    !isVisualLiteral(id) ||
    !/^region:[1-9]\d{0,5}$/.test(id) ||
    !roles.includes(role) ||
    !isVisualLiteral(text) ||
    !shape(region, ['x0', 'y0', 'x1', 'y1']) ||
    !Object.values(region).every(
      (v) => typeof v === 'number' && Number.isSafeInteger(v),
    ) ||
    region.x0 < 0 ||
    region.y0 < 0 ||
    region.x1 > page.width ||
    region.y1 > page.height ||
    region.x0 >= region.x1 ||
    region.y0 >= region.y1
  )
    return reject('cell');
  const box = { ...region };
  const observed = page.words
    .filter(
      (w) =>
        w.bbox.x0 < box.x1 &&
        w.bbox.x1 > box.x0 &&
        w.bbox.y0 < box.y1 &&
        w.bbox.y1 > box.y0,
    )
    .map((w) => ({
      wordId: w.id,
      text: w.text,
      complete:
        w.bbox.x0 >= box.x0 &&
        w.bbox.y0 >= box.y0 &&
        w.bbox.x1 <= box.x1 &&
        w.bbox.y1 <= box.y1,
    }));
  const regions = visualRegions(value).filter((r) => r.id !== id);
  if (
    observed.length > 64 ||
    observed.reduce((n, w) => n + w.text.length, 0) > 8192
  )
    return reject('limit');
  if (regions.length + value.cells.length >= VISUAL_EVIDENCE_LIMITS.cells)
    return reject('limit');
  regions.push({
    id,
    origin: 'manual-crop',
    role,
    value: text,
    observed,
    region: box,
    review: null,
  });
  return freeze({ ...value, version: 2, regions });
}
export function removeVisualRegion(
  value: VisualReview,
  id: string,
): VisualReview {
  assertAccepted(value);
  if (value.version === 1) return value;
  return freeze({
    ...value,
    regions: value.regions.filter((r) => r.id !== id),
  });
}
export async function confirmVisualRegion(
  value: VisualReview,
  id: string,
  checkedAt: string,
): Promise<VisualReview> {
  assertAccepted(value);
  const cell = visualRegions(value).find((r) => r.id === id);
  if (
    !cell ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(checkedAt) ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    new Date(checkedAt).toISOString() !== checkedAt
  )
    return reject('cell');
  const proof = {
    revision: value.revision,
    fingerprint: await regionFingerprint(value.revision, cell),
    checkedAt,
  };
  return freeze({
    ...value,
    version: 2,
    regions: visualRegions(value).map((r) =>
      r.id === id ? { ...r, review: proof } : r,
    ),
  });
}
/** Restore proof by recomputing pixels, source bytes, OCR observations, setting
 * revision and EACH reviewed cell. Checksums bind data, not a human identity. */
export async function restoreVisualReview(
  bytes: Uint8Array,
): Promise<VisualReview> {
  if (bytes.byteLength > VISUAL_EVIDENCE_LIMITS.recordBytes)
    return reject('limit');
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return reject('record');
  }
  if (
    !record(p) ||
    !shape(p, [
      'kind',
      'version',
      'status',
      'source',
      'draft',
      'pixelSha256',
      'revision',
      'cells',
      ...(p.version === 2 ? ['regions'] : []),
    ]) ||
    p.kind !== 'visual-review' ||
    (p.version !== 1 && p.version !== 2) ||
    p.status !== 'cell-evidence-only' ||
    !shape(p.source, ['name', 'sha256', 'originalPng']) ||
    !Array.isArray(p.cells) ||
    p.cells.length > VISUAL_EVIDENCE_LIMITS.cells ||
    (p.version === 2 &&
      (!Array.isArray(p.regions) ||
        p.regions.length + p.cells.length > VISUAL_EVIDENCE_LIMITS.cells))
  )
    return reject('record');
  const base = await createVisualReview(
    p.draft as VisualDraft,
    decodePngUrl(p.source.originalPng),
  );
  if (
    JSON.stringify(base.source) !== JSON.stringify(p.source) ||
    base.pixelSha256 !== p.pixelSha256 ||
    base.revision !== p.revision
  )
    return reject('stale');
  let current: VisualReview = base;
  const ids = new Set<string>();
  for (const raw of p.cells) {
    if (
      !shape(raw, [
        'wordId',
        'role',
        'observed',
        'value',
        'region',
        'review',
      ]) ||
      typeof raw.wordId !== 'string' ||
      ids.has(raw.wordId) ||
      typeof raw.role !== 'string' ||
      !roles.includes(raw.role) ||
      !isVisualLiteral(raw.value)
    )
      return reject('cell');
    ids.add(raw.wordId);
    current = editVisualCell(
      current,
      raw.wordId,
      raw.role as VisualCellRole,
      raw.value,
      raw.region as VisualCell['region'],
    );
    const cell = current.cells.find((c) => c.wordId === raw.wordId)!;
    if (cell.observed !== raw.observed) return reject('stale');
    if (raw.review !== null) {
      if (
        !shape(raw.review, ['revision', 'fingerprint', 'checkedAt']) ||
        raw.review.revision !== base.revision ||
        raw.review.fingerprint !== (await fingerprint(base.revision, cell)) ||
        typeof raw.review.checkedAt !== 'string'
      )
        return reject('stale');
      current = await confirmVisualCell(
        current,
        raw.wordId,
        raw.review.checkedAt,
      );
    }
  }
  if (p.version === 2) {
    current = freeze({ ...current, version: 2, regions: [] });
    const ids = new Set<string>();
    for (const raw of p.regions as unknown[]) {
      if (
        !shape(raw, [
          'id',
          'origin',
          'role',
          'observed',
          'value',
          'region',
          'review',
        ]) ||
        typeof raw.id !== 'string' ||
        ids.has(raw.id) ||
        raw.origin !== 'manual-crop' ||
        typeof raw.role !== 'string' ||
        !roles.includes(raw.role) ||
        !isVisualLiteral(raw.value)
      )
        return reject('cell');
      ids.add(raw.id);
      current = editVisualRegion(
        current,
        raw.id,
        raw.role as VisualCellRole,
        raw.value,
        raw.region as VisualCell['region'],
      );
      const cell = visualRegions(current).find((r) => r.id === raw.id)!;
      if (JSON.stringify(cell.observed) !== JSON.stringify(raw.observed))
        return reject('stale');
      if (raw.review !== null) {
        if (
          !shape(raw.review, ['revision', 'fingerprint', 'checkedAt']) ||
          raw.review.revision !== base.revision ||
          raw.review.fingerprint !==
            (await regionFingerprint(base.revision, cell)) ||
          typeof raw.review.checkedAt !== 'string'
        )
          return reject('stale');
        current = await confirmVisualRegion(
          current,
          raw.id,
          raw.review.checkedAt,
        );
      }
    }
  }
  return current;
}
export async function saveVisualReview(
  value: VisualReview,
): Promise<Uint8Array> {
  assertAccepted(value);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  await restoreVisualReview(bytes);
  return bytes;
}
