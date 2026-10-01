import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVisualReview,
  editVisualCell,
  confirmVisualCell,
  saveVisualReview,
  restoreVisualReview,
  type VisualReview,
} from '../lib/reconciliation/visual-review.ts';
import { draftFixture, pngFixture, sha } from './visual-evidence-fixture.ts';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const checkedAt = '2026-10-01T09:00:00.000Z';
async function reviewed() {
  const f = pngFixture(),
    draft = draftFixture(f.bytes);
  let record = await createVisualReview(draft, f.bytes);
  record = editVisualCell(
    record,
    draft.pages[0].words[0].id,
    'amount',
    '-250.00',
  );
  return confirmVisualCell(record, record.cells[0].wordId, checkedAt);
}
const encoded = (p: unknown) => new TextEncoder().encode(JSON.stringify(p));
void test('cell evidence is immutable, source/pixel bound, locally saved and fully replayed; it is never financial approval', async () => {
  const record = await reviewed(),
    saved = await saveVisualReview(record),
    restored = await restoreVisualReview(saved);
  assert.deepEqual(restored, record);
  assert.equal(record.status, 'cell-evidence-only');
  assert.equal(record.cells[0].review?.revision, record.revision);
  assert.equal(record.pixelSha256, sha(pngFixture().rgba));
  assert.ok(
    Object.isFrozen(record) &&
      Object.isFrozen(record.cells[0].region) &&
      Object.isFrozen(record.draft.pages[0].words),
  );
  assert.equal(record.cells[0].observed, '-250.00');
  assert.equal('approved' in record, false);
  assert.equal('sheets' in record, false);
});
void test('each literal correction, role or crop edit invalidates that cell only and requires a new review', async () => {
  let r = await reviewed();
  const id = r.cells[0].wordId,
    second = r.draft.pages[0].words[1].id;
  r = editVisualCell(r, second, 'reference', 'INV-700');
  r = await confirmVisualCell(r, second, checkedAt);
  const untouched = r.cells.find((c) => c.wordId === second)!.review;
  for (const [role, value, region] of [
    ['amount', '250.00', undefined],
    ['reference', '-250.00', undefined],
    ['amount', '-250.00', { x0: 10, y0: 0, x1: 70, y1: 50 }],
  ] as const) {
    const changed = editVisualCell(r, id, role, value, region);
    assert.equal(changed.cells.find((c) => c.wordId === id)!.review, null);
    assert.deepEqual(
      changed.cells.find((c) => c.wordId === second)!.review,
      untouched,
    );
    const confirmed = await confirmVisualCell(changed, id, checkedAt);
    assert.notEqual(
      confirmed.cells.find((c) => c.wordId === id)!.review?.fingerprint,
      r.cells.find((c) => c.wordId === id)!.review?.fingerprint,
    );
    assert.deepEqual(
      await restoreVisualReview(await saveVisualReview(changed)),
      changed,
    );
  }
});
void test('a matching written SHA is insufficient when displayed PNG pixels were substituted', async () => {
  const f = pngFixture(),
    other = pngFixture({ changed: true });
  await assert.rejects(
    createVisualReview(draftFixture(f.bytes, other.bytes), f.bytes),
    /visual-evidence:source/,
  );
  await assert.rejects(
    createVisualReview(draftFixture(f.bytes), other.bytes),
    /visual-evidence:source/,
  );
});
void test('draft and original are snapshotted before awaits; edits to caller data cannot rewrite review evidence', async () => {
  const f = pngFixture(),
    input = structuredClone(draftFixture(f.bytes));
  const expected = input.pages[0].words[0].text;
  const pending = createVisualReview(input, f.bytes);
  (input.pages[0].words as unknown as { text: string }[])[0].text = 'CHANGED';
  f.bytes.fill(0);
  assert.equal((await pending).draft.pages[0].words[0].text, expected);
});
void test('malformed records and accessors are rejected without invoking document code', async () => {
  let called = false;
  const hostile = {
    get pages() {
      called = true;
      return [];
    },
  };
  for (const value of [
    null,
    {},
    { kind: 'visual-draft' },
    hostile,
    {
      toJSON() {
        called = true;
        return {};
      },
    },
  ])
    await assert.rejects(
      createVisualReview(value as never, pngFixture().bytes),
      /visual-evidence:record/,
    );
  assert.equal(called, false);
});
void test('restore rejects every changed proof member, OCR observation, source, revision, engine, duplicate ID and financial status', async () => {
  const r = await reviewed();
  const mutations: ((p: Mutable<VisualReview>) => void)[] = [
    (p) => {
      p.cells[0].value = '250.00';
    },
    (p) => {
      p.cells[0].role = 'reference';
    },
    (p) => {
      p.cells[0].observed = '250.00';
    },
    (p) => {
      p.cells[0].region.x1 -= 1;
    },
    (p) => {
      p.cells[0].review!.fingerprint = '0'.repeat(64);
    },
    (p) => {
      p.cells[0].review!.revision = '0'.repeat(64);
    },
    (p) => {
      p.cells[0].review!.checkedAt = 'yesterday';
    },
    (p) => {
      p.cells.push(p.cells[0]);
    },
    (p) => {
      p.draft.pages[0].words[0].text = '250.00';
    },
    (p) => {
      p.draft.pages[0].words.pop();
    },
    (p) => {
      p.draft.engine.assetHashes[Object.keys(p.draft.engine.assetHashes)[0]] =
        '0'.repeat(64);
    },
    (p) => {
      p.source.originalPng =
        'data:image/png;base64,' +
        pngFixture({ changed: true }).bytes.toString('base64');
    },
    (p) => {
      p.revision = '0'.repeat(64);
    },
    (p) => {
      p.pixelSha256 = '0'.repeat(64);
    },
    (p) => {
      p.status = 'verified' as never;
    },
    (p) => {
      Object.assign(p, { approved: true });
    },
    (p) => {
      p.cells[0].region.x0 = 25;
    },
  ];
  for (const mutate of mutations) {
    const p = JSON.parse(JSON.stringify(r));
    mutate(p);
    await assert.rejects(restoreVisualReview(encoded(p)), /visual-evidence:/);
  }
});
void test('plain JSON cannot bypass registered evidence or crop, literal, role and timestamp validation', async () => {
  const r = await reviewed(),
    id = r.cells[0].wordId;
  assert.throws(
    () => editVisualCell(structuredClone(r), id, 'amount', '1'),
    /visual-evidence:record/,
  );
  await assert.rejects(
    saveVisualReview(structuredClone(r)),
    /visual-evidence:record/,
  );
  for (const value of ['', ' ', '1\u0000', '1'.repeat(513)])
    assert.throws(
      () => editVisualCell(r, id, 'amount', value),
      /visual-evidence:cell/,
    );
  assert.throws(
    () => editVisualCell(r, id, 'total' as never, '1'),
    /visual-evidence:cell/,
  );
  assert.throws(
    () => editVisualCell(r, 'absent', 'amount', '1'),
    /visual-evidence:cell/,
  );
  await assert.rejects(
    confirmVisualCell(r, id, '2026-02-30T00:00:00.000Z'),
    /visual-evidence:cell/,
  );
  await assert.rejects(
    restoreVisualReview(new Uint8Array([255])),
    /visual-evidence:record/,
  );
  await assert.rejects(
    restoreVisualReview(new Uint8Array(16 * 1024 * 1024 + 1)),
    /visual-evidence:limit/,
  );
});
