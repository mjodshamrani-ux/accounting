import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startReviewEffort,
  advanceReviewEffort,
  summarizeReviewEffort,
  saveReviewEffort,
  restoreReviewEffort,
  REVIEW_EVENT_LIMIT,
} from '../lib/review-effort.ts';
const start = () =>
  startReviewEffort('a'.repeat(64), 'development', '2026-10-05T00:00:00.000Z');
void test('effort replays first work, rework, stage, manual pause and explicit resume separately', () => {
  let r = start();
  r = advanceReviewEffort(r, 1000, { type: 'stage', stage: 'table' });
  r = advanceReviewEffort(r, 3000, { type: 'pause', reason: 'manual' });
  r = advanceReviewEffort(r, 13000, { type: 'resume' });
  r = advanceReviewEffort(r, 15000, { type: 'rework', enabled: true });
  r = advanceReviewEffort(r, 19000, { type: 'finish', reason: 'user' });
  const s = summarizeReviewEffort(restoreReviewEffort(saveReviewEffort(r)));
  assert.deepEqual(s.firstMs, { values: 1000, table: 4000, context: 0 });
  assert.deepEqual(s.reworkMs, { values: 0, table: 4000, context: 0 });
  assert.equal(s.pausedMs.manual, 10000);
  assert.equal(s.activeMs, 9000);
  assert.equal(s.resumes, 1);
  assert.equal(
    s.atMs,
    s.activeMs + Object.values(s.pausedMs).reduce((a, b) => a + b, 0),
  );
});
void test('throttled idle detection uses last interaction deadline and does not resume on a click', () => {
  let r = advanceReviewEffort(start(), 5000, {
    type: 'activity',
    action: 'change',
  });
  assert.doesNotThrow(() => {
    r = advanceReviewEffort(r, 100000, { type: 'activity', action: 'click' });
  });
  assert.deepEqual(r.events.at(-1), {
    type: 'pause',
    reason: 'idle',
    atMs: 35000,
  });
  r = advanceReviewEffort(r, 120000, { type: 'resume' });
  r = advanceReviewEffort(r, 121000, { type: 'finish', reason: 'user' });
  const s = summarizeReviewEffort(r);
  assert.equal(s.activeMs, 36000);
  assert.equal(s.pausedMs.idle, 85000);
  assert.deepEqual(s.actions, { click: 0, change: 1 });
});
void test('hidden and processing intervals remain excluded after foreground returns', () => {
  let r = advanceReviewEffort(start(), 1000, {
    type: 'pause',
    reason: 'hidden',
  });
  r = advanceReviewEffort(r, 6000, { type: 'resume' });
  r = advanceReviewEffort(r, 7000, { type: 'pause', reason: 'processing' });
  r = advanceReviewEffort(r, 9000, { type: 'finish', reason: 'user' });
  const s = summarizeReviewEffort(r);
  assert.equal(s.activeMs, 2000);
  assert.equal(s.pausedMs.hidden, 5000);
  assert.equal(s.pausedMs.processing, 2000);
});
void test('measurement is immutable, cannot export unfinished data or accept injected content/totals', () => {
  const r = start();
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.events));
  assert.throws(() => saveReviewEffort(r));
  const done = advanceReviewEffort(r, 1000, { type: 'finish', reason: 'user' });
  assert.equal(done.kind, 'review-effort');
  for (const mutate of [
    (v: Record<string, unknown>) => {
      v.originalPng = 'private';
    },
    (v: Record<string, unknown>) => {
      v.activeMs = 123;
    },
    (v: Record<string, unknown>) => {
      v.kind = 'reviewed-visual-source';
    },
    (v: Record<string, unknown>) => {
      v.idleAfterMs = 600000;
    },
    (v: Record<string, unknown>) => {
      v.sample = 'holdout';
    },
    (v: Record<string, unknown>) => {
      v.sourceSha256 = [v.sourceSha256];
    },
  ]) {
    const v = JSON.parse(saveReviewEffort(done));
    mutate(v);
    assert.throws(() => restoreReviewEffort(JSON.stringify(v)));
  }
});
void test('invalid times, transitions and altered events are rejected on replay', () => {
  assert.throws(() => advanceReviewEffort(start(), -1));
  assert.throws(() => advanceReviewEffort(start(), NaN));
  assert.throws(() => advanceReviewEffort(start(), 1, { type: 'resume' }));
  const done = advanceReviewEffort(start(), 1000, {
    type: 'finish',
    reason: 'user',
  });
  assert.throws(() =>
    advanceReviewEffort(done, 2000, { type: 'activity', action: 'click' }),
  );
  for (const events of [
    [
      { type: 'pause', reason: 'idle', atMs: 500 },
      { type: 'finish', reason: 'user', atMs: 1000 },
    ],
    [
      { type: 'activity', action: 'click', atMs: 40000 },
      { type: 'finish', reason: 'user', atMs: 40000 },
    ],
    [
      { type: 'pause', reason: 'manual', atMs: 1000 },
      { type: 'finish', reason: 'user', atMs: 999 },
    ],
    [
      { type: 'activity', action: 'change', atMs: 500, value: 'private' },
      { type: 'finish', reason: 'user', atMs: 1000 },
    ],
    [
      { type: 'activity', action: ['click'], atMs: 500 },
      { type: 'finish', reason: 'user', atMs: 1000 },
    ],
    [{ type: 'finish', reason: ['user'], atMs: 1000 }],
  ])
    assert.throws(() =>
      restoreReviewEffort(JSON.stringify({ ...done, events })),
    );
});
void test('event limit stops measurement visibly without dropping previous events', () => {
  const events = Array.from({ length: REVIEW_EVENT_LIMIT - 1 }, (_, i) => ({
    type: 'activity' as const,
    action: 'click' as const,
    atMs: i,
  }));
  const r = advanceReviewEffort({ ...start(), events }, REVIEW_EVENT_LIMIT, {
    type: 'activity',
    action: 'change',
  });
  assert.equal(r.events.length, REVIEW_EVENT_LIMIT);
  assert.equal(r.events.at(-1)?.type, 'finish');
  assert.equal(summarizeReviewEffort(r).actions.click, REVIEW_EVENT_LIMIT - 1);
  assert.equal(summarizeReviewEffort(r).actions.change, 0);
  const idle = advanceReviewEffort({ ...start(), events }, 100000);
  assert.equal(idle.events.length, REVIEW_EVENT_LIMIT);
  assert.equal(summarizeReviewEffort(idle).atMs, events.at(-1)!.atMs + 30000);
});
