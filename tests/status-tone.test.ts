import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arCaseTone,
  bankCaseTone,
  clearingGroupTone,
  STATUS_TONES,
  supplierCaseTone,
} from '../lib/status-tone.ts';

// The status badge (UX-3) must never show a status that waits for a person,
// or one that cannot be judged, in the agreed tone. These tests hold each
// map to the statuses its engine settles as agreeing, written out here.
void test('receivables: only a matched pair is agreed', () => {
  assert.equal(arCaseTone('matched'), 'agreed');
  assert.equal(arCaseTone('review'), 'review');
});

void test('clearing: only a cleared group is agreed', () => {
  assert.equal(clearingGroupTone('cleared'), 'agreed');
  assert.equal(clearingGroupTone('review'), 'review');
});

void test('bank: only a case matched by identity or by a person is agreed', () => {
  assert.deepEqual(
    Object.entries(bankCaseTone)
      .filter(([, tone]) => tone === 'agreed')
      .map(([status]) => status)
      .sort(),
    ['matched-evidence', 'matched-manual'],
  );
  assert.equal(bankCaseTone['needs-review'], 'review');
  assert.equal(bankCaseTone['source-error'], 'held');
});

void test('supplier: only an automatic or confirmed match is agreed', () => {
  assert.deepEqual(
    Object.entries(supplierCaseTone)
      .filter(([, tone]) => tone === 'agreed')
      .map(([status]) => status)
      .sort(),
    ['auto', 'manual'],
  );
  assert.equal(supplierCaseTone.paymentCandidate, 'suggestion');
  assert.equal(supplierCaseTone.amountVariance, 'difference');
  for (const status of ['rejected', 'needsReview', 'unmatched'] as const)
    assert.equal(supplierCaseTone[status], 'review', status);
});

void test('every tone is one of the badge tones', () => {
  const tones = [
    arCaseTone('matched'),
    arCaseTone('review'),
    clearingGroupTone('cleared'),
    clearingGroupTone('review'),
    ...Object.values(bankCaseTone),
    ...Object.values(supplierCaseTone),
  ];
  for (const tone of tones) assert.ok(STATUS_TONES.includes(tone), tone);
});
