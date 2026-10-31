import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocationNeed,
  clearingSelection,
  decisionHint,
  decisionNeed,
  decisionOpen,
  NOTE_MINIMUM,
  noteReady,
  type AcceptBlock,
  type DecisionReview,
} from '../lib/decision-platform.ts';
import { decisionPlatformCopy } from '../lib/i18n/decision-platform.ts';
import { bankAdjustmentCopy } from '../lib/i18n/bank-adjustment.ts';

// The decision platform (UX-3) writes once the conditions each workspace
// applied to its own decision buttons. These tests hold it to those
// conditions, copied from the buttons it replaced, over every combination.
const references = ['', '  ', 'REF-1'];
const reasons = ['', ' ', 'Checked against the source'];
const reviews: DecisionReview[] = [
  'needs-review',
  'accepted',
  'rejected',
  'blocked',
];
const blocks: (AcceptBlock | null)[] = [
  null,
  'unconfirmed',
  'source-error',
  'missing',
  'inconsistent',
  'difference',
  'pairs',
];

void test('whole-result and per-pair buttons open exactly as before', () => {
  let cases = 0;
  for (const reference of references)
    for (const reason of reasons)
      for (const members of [0, 1, 12])
        for (const review of reviews.filter((r) => r !== 'blocked'))
          for (const acceptBlock of blocks) {
            const canAccept = acceptBlock === null;
            // The disabled condition of payroll, fixed assets, inventory,
            // payment gateways and intercompany pairs, without `busy`.
            const before = (type: 'accept' | 'reject' | 'undo') =>
              !(
                !reference.trim() ||
                !reason.trim() ||
                !members ||
                (type === 'undo'
                  ? review === 'needs-review'
                  : review !== 'needs-review') ||
                (type === 'accept' && !canAccept)
              );
            const open = decisionOpen({
              reference,
              reason,
              members,
              review,
              acceptBlock,
            });
            for (const type of ['accept', 'reject', 'undo'] as const)
              assert.equal(
                open[type],
                before(type),
                `${type} ${JSON.stringify({ reference, reason, members, review, acceptBlock })}`,
              );
            cases++;
          }
  assert.equal(cases, 3 * 3 * 3 * 3 * 7);
});

void test('statement lines open exactly as before, a blocked line on none', () => {
  const statuses = [
    'ready',
    'source-error',
    'missing',
    'inconsistent',
    'difference',
  ] as const;
  let cases = 0;
  for (const reference of references)
    for (const reason of reasons)
      for (const review of reviews)
        for (const confirmed of [false, true])
          for (const status of statuses) {
            // The disabled condition of a TB and financial position line.
            const before = (type: 'accept' | 'reject' | 'undo') =>
              !(
                !reference.trim() ||
                !reason.trim() ||
                review === 'blocked' ||
                (type === 'undo'
                  ? review === 'needs-review'
                  : review !== 'needs-review') ||
                (type === 'accept' &&
                  (!confirmed ||
                    (
                      [
                        'source-error',
                        'missing',
                        'inconsistent',
                        'difference',
                      ] as string[]
                    ).includes(status)))
              );
            const acceptBlock: AcceptBlock | null = !confirmed
              ? 'unconfirmed'
              : status === 'ready'
                ? null
                : status;
            const open = decisionOpen({
              reference,
              reason,
              review,
              acceptBlock,
            });
            for (const type of ['accept', 'reject', 'undo'] as const)
              assert.equal(
                open[type],
                before(type),
                `${type} ${JSON.stringify({ reference, reason, review, confirmed, status })}`,
              );
            cases++;
          }
  assert.equal(cases, 3 * 3 * 4 * 2 * 5);
});

void test('the sentence names the first thing missing, then the state', () => {
  const base = {
    reference: 'REF-1',
    reason: 'Checked',
    members: 3,
    acceptBlock: null,
  } as const;
  assert.equal(
    decisionNeed({ ...base, reference: ' ', reason: '', review: 'accepted' }),
    'both',
  );
  assert.equal(
    decisionNeed({ ...base, reference: '', review: 'accepted' }),
    'reference',
  );
  assert.equal(
    decisionNeed({ ...base, reason: '', review: 'accepted' }),
    'reason',
  );
  assert.equal(
    decisionNeed({ ...base, members: 0, review: 'accepted' }),
    'members',
  );
  assert.equal(decisionNeed({ ...base, review: 'accepted' }), null);
  assert.deepEqual(
    decisionHint({ ...base, reason: '', review: 'needs-review' }),
    {
      key: 'reason',
      accept: null,
    },
  );
  assert.deepEqual(
    decisionHint({ ...base, review: 'needs-review', acceptBlock: 'missing' }),
    { key: 'pending', accept: 'missing' },
  );
  assert.deepEqual(
    decisionHint({ ...base, review: 'accepted', acceptBlock: 'missing' }),
    { key: 'decided', accept: null },
  );
  assert.deepEqual(decisionHint({ ...base, review: 'blocked' }), {
    key: 'blocked',
    accept: null,
  });
  assert.deepEqual(
    decisionHint({
      ...base,
      members: undefined,
      review: 'each',
      acceptBlock: 'pairs',
    }),
    { key: 'each', accept: 'pairs' },
  );
  assert.deepEqual(
    decisionHint({
      ...base,
      members: undefined,
      review: 'eachBlocked',
      acceptBlock: null,
    }),
    { key: 'eachBlocked', accept: null },
  );
});

void test("one note opens receivables and clearing at the engines' length", () => {
  // The engines refuse a decision whose note is shorter than eight
  // characters once trimmed (ar.ts, clearing.ts); the buttons applied the
  // same rule inline.
  assert.equal(NOTE_MINIMUM, 8);
  for (const note of [
    '',
    '       ',
    'Seven c',
    ' Seven c ',
    'Eight ch',
    '  Eight ch  ',
  ])
    assert.equal(
      noteReady(note),
      note.trim().length >= 8,
      JSON.stringify(note),
    );
});

void test('clearing by hand opens only on a selection the engine accepts', () => {
  // Every selection of up to four members from these signed amounts, and
  // selections at and past the limit: open exactly when the clearing
  // engine accepts the decision (two to a hundred members, netting to zero,
  // with a debit and a credit), and never where the button was closed
  // before (fewer than two or more than a hundred members).
  const amounts = [-250, -100, 0, 100, 150, 250];
  const engine = (a: number[]) =>
    a.length >= 2 &&
    a.length <= 100 &&
    a.reduce((n, v) => n + v, 0) === 0 &&
    a.some((v) => v > 0) &&
    a.some((v) => v < 0);
  const before = (a: number[]) => a.length >= 2 && a.length <= 100;
  let cases = 0;
  const visit = (chosen: number[]) => {
    const open = clearingSelection(chosen) === 'ready';
    assert.equal(open, engine(chosen), JSON.stringify(chosen));
    if (open) assert.ok(before(chosen), JSON.stringify(chosen));
    cases++;
    if (chosen.length < 4) for (const v of amounts) visit([...chosen, v]);
  };
  visit([]);
  assert.equal(cases, 1 + 6 + 36 + 216 + 1296);
  for (const n of [99, 100, 101]) {
    const a: number[] = Array.from({ length: n }, (_, i) => (i % 2 ? 5 : -5));
    if (n % 2) a[n - 1] = 0;
    assert.equal(clearingSelection(a) === 'ready', engine(a), String(n));
  }
  assert.equal(clearingSelection(Array(101).fill(0)), 'limit');
  assert.equal(clearingSelection([100]), 'select');
  assert.equal(clearingSelection([100, -50]), 'net');
  assert.equal(clearingSelection([0, 0]), 'net');
  assert.equal(clearingSelection([Number.NaN, 5, -5]), 'net');
});

void test('allocation decisions open exactly as before', () => {
  let cases = 0;
  for (const ready of [false, true])
    for (const reason of ['', ' ', 'Checked'])
      for (const selected of [0, 1, 3])
        for (const reference of ['', '  ', 'REF-1'])
          for (const linksComplete of [false, true]) {
            const need = allocationNeed({
              ready,
              reason,
              selected,
              reference,
              linksComplete,
            });
            // The fieldset closed every decision without a ready result;
            // the buttons applied the rest inline.
            const advice = ready && !(!selected || !reason.trim()),
              human =
                ready &&
                !(!reason.trim() || !reference.trim() || !linksComplete),
              undo = ready && !!reason.trim();
            const free = need.key === 'waiting' || need.key === 'ready';
            const at = JSON.stringify({
              ready,
              reason,
              selected,
              reference,
              linksComplete,
            });
            assert.equal(free && !need.advice, advice, `advice ${at}`);
            assert.equal(free && !need.human, human, `human ${at}`);
            assert.equal(free, undo, `undo ${at}`);
            assert.equal(need.key === 'ready', advice && human, `ready ${at}`);
            cases++;
          }
  assert.equal(cases, 2 * 3 * 3 * 3 * 2);
});

void test('every sentence and block has words in both languages', () => {
  for (const lang of ['en', 'ar'] as const) {
    const c = decisionPlatformCopy[lang];
    for (const key of [
      'members',
      'blocked',
      'pending',
      'decided',
      'each',
      'eachBlocked',
    ] as const)
      assert.ok(c[key].trim(), `${lang} ${key}`);
    for (const block of blocks.filter((b) => b !== null))
      assert.ok(c.accept[block].trim(), `${lang} accept ${block}`);
    assert.match(c.both('A', 'B'), /A.*B/su);
    assert.match(c.reference('A'), /A/u);
    assert.match(c.reason('B'), /B/u);
    assert.match(c.note('N', NOTE_MINIMUM), /N.*8|8.*N/su);
    assert.ok(c.receivables.trim(), `${lang} receivables`);
    for (const key of [
      'reopen',
      'select',
      'net',
      'limit',
      'ready',
      'errors',
    ] as const)
      assert.ok(c.clearing[key].trim(), `${lang} clearing ${key}`);
    for (const key of ['advice', 'ready', 'blocked', 'links'] as const)
      assert.ok(c.allocation[key].trim(), `${lang} allocation ${key}`);
    assert.match(c.allocation.human('R'), /R/u);
    for (const key of ['ask', 'check', 'example'] as const)
      assert.match(c.waits[key]('L'), /L/u, `${lang} waits ${key}`);
    assert.match(c.waits.step('L', 'S'), /L.*S/su);
    // A review recorded by one button, and several buttons that wait for
    // the same step (UX-3, the reviews).
    assert.match(c.review.opens('L'), /L/u);
    assert.match(c.waits.steps(['A', 'B'], 'S'), /A.*B.*S/su);
  }
  assert.equal(
    decisionPlatformCopy.en.waits.steps(['A', 'B'], 'a decision is recorded'),
    '“A” and “B” open once a decision is recorded.',
  );
  assert.equal(
    decisionPlatformCopy.ar.waits.steps(['أ', 'ب'], 'تسجيل قرار'),
    'يُفتح «أ» و«ب» بعد تسجيل قرار.',
  );
  // The steps the balance reconciliation waits for, in both languages.
  for (const lang of ['en', 'ar'] as const) {
    const c = bankAdjustmentCopy[lang];
    assert.deepEqual(Object.keys(c.steps), [
      'bank',
      'files',
      'readings',
      'coverage',
      'complete',
    ]);
    for (const step of Object.values(c.steps)) assert.ok(step.trim());
    assert.match(c.written(c.coverageRef), new RegExp(c.coverageRef, 'u'));
    assert.ok(c.blocked.trim());
  }
  // Western digits only, as everywhere in the interface copy.
  assert.doesNotMatch(JSON.stringify(decisionPlatformCopy.ar), /[٠-٩]/u);
});
