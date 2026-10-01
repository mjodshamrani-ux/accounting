import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFixture, pngFixture } from './visual-evidence-fixture.ts';
import { createVisualDraft } from '../lib/reconciliation/visual-draft.ts';
import {
  createVisualReview,
  editVisualRegion,
  confirmVisualRegion,
  removeVisualRegion,
  nextVisualRegionId,
  visualRegions,
  editVisualCell,
  confirmVisualCell,
  restoreVisualReview,
  saveVisualReview,
  type VisualReview,
} from '../lib/reconciliation/visual-review.ts';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type RegionRecord = Mutable<Extract<VisualReview, { version: 2 }>>;
const checkedAt = '2026-10-01T10:00:00.000Z';
const box = { x0: 30, y0: 5, x1: 50, y1: 35 };
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
async function fixture(empty = false) {
  const image = pngFixture(),
    draft = structuredClone(draftFixture(image.bytes));
  if (empty) (draft.pages[0].words as unknown[]) = [];
  return createVisualReview(draft, image.bytes);
}
async function reviewed(empty = false) {
  const base = await fixture(empty);
  const r = editVisualRegion(
    base,
    nextVisualRegionId(base),
    'amount',
    '-٢٥٠٫٠٠',
    box,
  );
  return confirmVisualRegion(r, 'region:1', checkedAt);
}
void test('manual source crop records an omitted Arabic literal even when OCR finds no words; v2 replays without financial promotion', async () => {
  const r = await reviewed(true);
  assert.equal(r.version, 2);
  assert.equal(r.status, 'cell-evidence-only');
  assert.deepEqual(visualRegions(r)[0].observed, []);
  assert.equal(visualRegions(r)[0].value, '-٢٥٠٫٠٠');
  assert.deepEqual(await restoreVisualReview(await saveVisualReview(r)), r);
  assert.ok(Object.isFrozen(visualRegions(r)[0].region));
  assert.ok(Object.isFrozen(visualRegions(r)[0].observed));
  assert.equal('sheets' in r, false);
  assert.equal('approved' in r, false);
});
void test('all intersecting observations and partial words are retained; neighboring words outside the crop cannot leak in', async () => {
  const r = await reviewed();
  const expected = r.draft.pages[0].words.filter(
    (w) =>
      w.bbox.x0 < box.x1 &&
      w.bbox.x1 > box.x0 &&
      w.bbox.y0 < box.y1 &&
      w.bbox.y1 > box.y0,
  );
  assert.deepEqual(
    visualRegions(r)[0].observed.map((o) => o.wordId),
    expected.map((w) => w.id),
  );
  assert.equal(visualRegions(r)[0].observed[0].complete, false);
  assert.deepEqual(await restoreVisualReview(await saveVisualReview(r)), r);
});
void test('literal sign, role and crop edits revoke only the affected region review, including after restoration', async () => {
  let r = await reviewed();
  r = editVisualRegion(r, 'region:2', 'date', '2026-08-31', {
    x0: 50,
    y0: 10,
    x1: 80,
    y1: 40,
  });
  r = await confirmVisualRegion(r, 'region:2', checkedAt);
  const unchanged = visualRegions(r)[1];
  for (const [role, literal, region] of [
    ['amount', '٢٥٠٫٠٠', box],
    ['reference', '-٢٥٠٫٠٠', box],
    ['amount', '-٢٥٠٫٠٠', { ...box, x0: 9 }],
  ] as const) {
    const changed = editVisualRegion(r, 'region:1', role, literal, region);
    assert.equal(
      visualRegions(changed).find((c) => c.id === 'region:1')!.review,
      null,
    );
    assert.deepEqual(
      visualRegions(changed).find((c) => c.id === 'region:2'),
      unchanged,
    );
    assert.deepEqual(
      await restoreVisualReview(await saveVisualReview(changed)),
      changed,
    );
    const renewed = await confirmVisualRegion(changed, 'region:1', checkedAt);
    assert.notEqual(
      visualRegions(renewed).find((c) => c.id === 'region:1')!.review!
        .fingerprint,
      visualRegions(r)[0].review!.fingerprint,
    );
  }
});
void test('v1 records and word receipts remain compatible when manually selected regions are added and removed', async () => {
  let r = await fixture();
  const word = r.draft.pages[0].words[0];
  r = editVisualCell(r, word.id, 'amount', '-250.00');
  r = await confirmVisualCell(r, word.id, checkedAt);
  const v1 = await saveVisualReview(r),
    old = r.cells[0];
  r = editVisualRegion(r, 'region:3', 'amount', '-٢٥٠٫٠٠', box);
  r = await confirmVisualRegion(r, 'region:3', checkedAt);
  assert.deepEqual(r.cells[0], old);
  assert.deepEqual(await restoreVisualReview(await saveVisualReview(r)), r);
  assert.equal(nextVisualRegionId(r), 'region:4');
  r = removeVisualRegion(r, 'region:3');
  assert.deepEqual(visualRegions(r), []);
  assert.deepEqual(await restoreVisualReview(await saveVisualReview(r)), r);
  assert.equal((await restoreVisualReview(v1)).version, 1);
});
void test('restore rejects changed crop, sign, raw observations, origin, timestamp, fingerprint, duplicate ID and schema downgrade', async () => {
  const original = await reviewed();
  const mutations = [
    (p: RegionRecord) => {
      p.regions[0].value = '٢٥٠٫٠٠';
    },
    (p: RegionRecord) => {
      p.regions[0].role = 'reference';
    },
    (p: RegionRecord) => {
      p.regions[0].region.x0 += 1;
    },
    (p: RegionRecord) => {
      p.regions[0].observed = [];
    },
    (p: RegionRecord) => {
      p.regions[0].observed[0].complete = true;
    },
    (p: RegionRecord) => {
      p.regions[0].origin = 'ocr-verified' as never;
    },
    (p: RegionRecord) => {
      p.regions[0].review!.fingerprint = '0'.repeat(64);
    },
    (p: RegionRecord) => {
      p.regions[0].review!.revision = '0'.repeat(64);
    },
    (p: RegionRecord) => {
      p.regions[0].review!.checkedAt = '2026-02-30T00:00:00.000Z';
    },
    (p: RegionRecord) => {
      p.regions.push(p.regions[0]);
    },
    (p: RegionRecord) => {
      p.version = 1 as never;
    },
    (p: RegionRecord) => {
      Reflect.deleteProperty(p, 'regions');
    },
    (p: RegionRecord) => {
      Object.assign(p.regions[0], { approved: true });
    },
    (p: RegionRecord) => {
      p.status = 'verified' as never;
    },
  ];
  for (const mutate of mutations) {
    const p = JSON.parse(JSON.stringify(original));
    mutate(p);
    await assert.rejects(restoreVisualReview(encode(p)), /visual-evidence:/);
  }
});
void test('manual crops reject non-integral, empty, reversed, out-of-image and accessor geometry without invoking document code', async () => {
  const r = await fixture();
  let invoked = false;
  for (const region of [
    { ...box, x0: -1 },
    { ...box, x1: 81 },
    { ...box, y1: 61 },
    { ...box, x0: 0.5 },
    { ...box, x1: box.x0 },
    { ...box, x0: box.x1 + 1 },
    { ...box, y1: Infinity },
    { ...box, extra: true },
    {
      ...box,
      get x0() {
        invoked = true;
        return 10;
      },
    },
  ])
    assert.throws(
      () => editVisualRegion(r, 'region:1', 'amount', '1', region),
      /visual-evidence:cell/,
    );
  assert.equal(invoked, false);
  for (const literal of ['', ' ', '1\u0000', '1'.repeat(513)])
    assert.throws(
      () => editVisualRegion(r, 'region:1', 'amount', literal, box),
      /visual-evidence:cell/,
    );
  assert.throws(
    () => editVisualRegion(structuredClone(r), 'region:1', 'amount', '1', box),
    /visual-evidence:record/,
  );
  assert.throws(
    () => editVisualRegion(r, 'word:1', 'amount', '1', box),
    /visual-evidence:cell/,
  );
  assert.throws(
    () => editVisualRegion(r, 'region:1\n', 'amount', '1', box),
    /visual-evidence:cell/,
  );
  await assert.rejects(
    confirmVisualRegion(r, 'region:1', checkedAt),
    /visual-evidence:cell/,
  );
});
void test('region evidence cannot duplicate a whole page of words or oversized observations into every cell', async () => {
  const image = pngFixture(),
    template = draftFixture(image.bytes);
  for (const words of [
    Array.from({ length: 65 }, () => ({
      text: '1',
      confidence: 50,
      bbox: { x0: 35, y0: 10, x1: 45, y1: 20 },
    })),
    Array.from({ length: 3 }, () => ({
      text: '1'.repeat(3000),
      confidence: 50,
      bbox: { x0: 35, y0: 10, x1: 45, y1: 20 },
    })),
  ]) {
    const draft = createVisualDraft(
      {
        source: template.source,
        expectedPages: 1,
        engine: template.engine,
        pages: [
          {
            page: 1,
            width: 80,
            height: 60,
            imageDataUrl: template.pages[0].imageDataUrl,
            blocks: [{ paragraphs: [{ lines: [{ words }] }] }],
          },
        ],
      },
      template.source.sha256,
    );
    const r = await createVisualReview(draft, image.bytes);
    assert.throws(
      () => editVisualRegion(r, 'region:1', 'amount', '1', box),
      /visual-evidence:limit/,
    );
  }
});
