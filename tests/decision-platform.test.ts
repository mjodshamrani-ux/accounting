import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decisionHint,
  decisionNeed,
  decisionOpen,
  type AcceptBlock,
  type DecisionReview,
} from '../lib/decision-platform.ts';
import { decisionPlatformCopy } from '../lib/i18n/decision-platform.ts';

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
  }
  // Western digits only, as everywhere in the interface copy.
  assert.doesNotMatch(JSON.stringify(decisionPlatformCopy.ar), /[٠-٩]/u);
});
