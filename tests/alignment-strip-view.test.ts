import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlignmentStrip } from '../lib/alignment-strip.ts';
import {
  stripNoteText,
  stripValueText,
  stripView,
} from '../lib/alignment-strip-view.ts';
import { alignmentStripCopy } from '../lib/i18n/alignment-strip.ts';

// What each strip cell says (UX-6): the screen's strip and the reconciliation
// sheet read the same function. Each branch below is one the screen drew
// before the function was taken out of it; the words are the catalogue's.

const en = alignmentStripCopy.en,
  ar = alignmentStripCopy.ar;
const money = (minor: number) => `[${minor}]`;

const strip = (over: Partial<AlignmentStrip>): AlignmentStrip => ({
  totals: null,
  agreed: { count: 3, of: null, unit: 'case' },
  review: { kind: 'count', count: 0, reason: null },
  gap: { kind: 'not-computed' },
  ...over,
});

void test('agreed: a count alone, or a count among what was compared, with its unit', () => {
  const [alone] = stripView(strip({}), en);
  assert.deepEqual(alone, {
    cell: 'agreed',
    label: 'Aligned',
    value: { kind: 'count', count: 3 },
    notes: [{ text: 'Matched cases' }],
  });
  assert.equal(stripValueText(alone.value, en, money), '3');
  const [among] = stripView(
    strip({ agreed: { count: 4, of: 6, unit: 'field' } }),
    ar,
  );
  assert.deepEqual(among.value, { kind: 'count', count: 4, of: 6 });
  assert.equal(stripValueText(among.value, ar, money), '4 من 6');
  assert.equal(stripNoteText(among.notes), 'حقول بلا فرق');
});

void test('review: a count with its main reason in the workspace words, and those alone', () => {
  const [, waiting] = stripView(
    strip({ review: { kind: 'count', count: 2, reason: 'R1', alone: 5 } }),
    en,
    { reason: (code) => `words for ${code}` },
  );
  assert.equal(waiting.label, 'Awaits your decision');
  assert.deepEqual(waiting.value, { kind: 'count', count: 2 });
  assert.deepEqual(waiting.notes, [
    { text: 'Main reason', value: 'words for R1' },
    { text: 'Without a counterpart', value: 5 },
  ]);
  assert.equal(
    stripNoteText(waiting.notes),
    'Main reason: words for R1 · Without a counterpart: 5',
  );
  // Nothing waits: no main reason is said, even where the engine gives one.
  const [, none] = stripView(
    strip({ review: { kind: 'count', count: 0, reason: 'R1' } }),
    en,
  );
  assert.deepEqual(none.notes, []);
});

void test('review: one decision for the whole result, and a status in the workspace words', () => {
  for (const [review, value, note] of [
    ['needs-review', 'Whole result', 'Waits for you to accept or reject it'],
    ['accepted', 'Nothing', 'Accepted by a recorded decision'],
    ['rejected', 'Nothing', 'Rejected by a recorded decision'],
  ] as const) {
    const [, cell] = stripView(strip({ review: { kind: 'whole', review } }), en);
    assert.deepEqual(cell.value, { kind: 'text', text: value });
    assert.deepEqual(cell.notes, [{ text: note }]);
  }
  const [, state] = stripView(
    strip({ review: { kind: 'state', status: 'consistent' } }),
    ar,
    { state: 'متسق ضمن النطاق المعلن' },
  );
  assert.equal(state.label, 'حالة النتيجة');
  assert.deepEqual(state.value, {
    kind: 'text',
    text: 'متسق ضمن النطاق المعلن',
  });
  assert.deepEqual(state.notes, []);
});

void test('gap: the first difference as the engine signed it, its name and direction, and how many more', () => {
  const [, , gap] = stripView(
    strip({
      gap: {
        kind: 'figures',
        compared: 6,
        items: [
          { name: 'periodDebit', between: 'ledger-tb', minor: -5000 },
          { name: 'periodCredit', between: 'ledger-tb', minor: -5000 },
        ],
      },
    }),
    en,
    { name: (key) => `component ${key}` },
  );
  assert.deepEqual(gap.value, { kind: 'amount', minor: -5000 });
  assert.equal(stripValueText(gap.value, en, money), '[-5000]');
  assert.deepEqual(gap.notes, [
    { text: 'component periodDebit', value: 'GL minus TB' },
    { text: 'Other differences in the table below', value: 1 },
  ]);
  // A name the strip's own catalogue knows is said in its words.
  const [, , closing] = stripView(
    strip({
      gap: {
        kind: 'figures',
        compared: 1,
        items: [{ name: 'closing', between: 'supplier-ledger', minor: 7 }],
      },
    }),
    en,
    { name: () => 'not used' },
  );
  assert.equal(closing.notes[0].text, 'Closing balance');
});

void test('gap: no difference in what was compared, not computed, and blocked by the status', () => {
  const [, , none] = stripView(
    strip({ gap: { kind: 'figures', compared: 6, items: [] } }),
    ar,
  );
  assert.deepEqual(none.value, { kind: 'text', text: 'لا فرق' });
  assert.deepEqual(none.notes, [{ text: 'فيما قورن', value: 6 }]);
  const [, , notComputed] = stripView(strip({}), en);
  assert.deepEqual(notComputed.value, {
    kind: 'text',
    text: 'Not computed by the engine',
  });
  assert.deepEqual(notComputed.notes, [{ text: 'for this comparison' }]);
  const blocked = strip({ gap: { kind: 'blocked', status: 'missing' } });
  const [, , said] = stripView(blocked, en, {
    state: 'Required balance evidence is missing',
  });
  assert.deepEqual(said.value, { kind: 'text', text: 'Not computed' });
  assert.deepEqual(said.notes, [
    { text: 'Required balance evidence is missing' },
  ]);
  // Without the workspace's words the engine's status stands, as before.
  const [, , raw] = stripView(blocked, en);
  assert.deepEqual(raw.notes, [{ text: 'missing' }]);
});
