import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocationAdviceTone,
  arCaseTone,
  assetSectionTone,
  bankCaseTone,
  clearingGroupTone,
  gatewayBatchTone,
  glSectionTone,
  intercompanyRelationTone,
  inventoryBridgeTone,
  payrollEmployeeTone,
  STATUS_TONES,
  supplierCaseTone,
  toned,
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

const agreedOf = (map: Record<string, string>) =>
  Object.entries(map)
    .filter(([, tone]) => tone === 'agreed')
    .map(([status]) => status)
    .sort();

void test('review sections: only a consistent section or batch is agreed', () => {
  for (const map of [
    gatewayBatchTone,
    glSectionTone,
    assetSectionTone,
    inventoryBridgeTone,
    payrollEmployeeTone,
  ])
    assert.deepEqual(agreedOf(map), ['consistent']);
});

void test('review sections: advice and a ready pair wait for a decision', () => {
  assert.deepEqual(agreedOf(allocationAdviceTone), []);
  assert.equal(allocationAdviceTone.fits, 'suggestion');
  assert.equal(allocationAdviceTone.allocated, 'neutral');
  assert.deepEqual(agreedOf(intercompanyRelationTone), []);
  assert.equal(intercompanyRelationTone.ready, 'suggestion');
});

void test('review sections: what cannot be judged is held, a gap a difference', () => {
  for (const map of [glSectionTone, inventoryBridgeTone, payrollEmployeeTone]) {
    assert.equal(map.held, 'held');
    assert.equal(map.missing, 'held');
    assert.equal(map.inconsistent, 'difference');
  }
  assert.equal(assetSectionTone.missing, 'held');
  assert.equal(assetSectionTone.difference, 'difference');
  assert.equal(gatewayBatchTone['in-transit'], 'neutral');
});

void test('a row status carries its tone and the engine status', () => {
  assert.deepEqual(toned(glSectionTone, 'held'), {
    tone: 'held',
    status: 'held',
  });
});

void test('every tone is one of the badge tones', () => {
  const tones = [
    arCaseTone('matched'),
    arCaseTone('review'),
    clearingGroupTone('cleared'),
    clearingGroupTone('review'),
    ...Object.values(bankCaseTone),
    ...Object.values(supplierCaseTone),
    ...[
      allocationAdviceTone,
      gatewayBatchTone,
      intercompanyRelationTone,
      glSectionTone,
      assetSectionTone,
      inventoryBridgeTone,
      payrollEmployeeTone,
    ].flatMap((map) => Object.values(map)),
  ];
  for (const tone of tones) assert.ok(STATUS_TONES.includes(tone), tone);
});
