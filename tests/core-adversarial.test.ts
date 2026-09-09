import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSource,
  compare,
  safeSum,
  inferMapping,
} from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
test('ambiguous column meanings are left unmapped instead of selecting the first header', () => {
  const file = {
    name: 'synthetic.csv',
    sheets: [
      {
        name: 'Data',
        rows: [
          [
            'invoice date',
            'posting date',
            'reference',
            'invoice no',
            'amount',
            'remaining',
          ],
          ['2026-08-01', '2026-08-02', 'INV-100', 'INV-200', '100', '20'],
        ],
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  const mapping = inferMapping(file);
  assert.equal(mapping.date, -1);
  assert.equal(mapping.reference, -1);
  assert.equal(mapping.amount, -1);
  assert.throws(() => normalizeSource(file, mapping, scope, 'supplier'));
});
test('exact summation does not depend on ordering of large offsetting entries', () => {
  for (const values of [
    [1e14, 1, -1e14],
    [1, 1e14, -1e14],
    [-1e14, 1, 1e14],
    [1e14, -1e14, 1],
  ])
    assert.equal(safeSum(values), 1);
  assert.throws(() => safeSum([1e14, 1]));
  assert.throws(() => safeSum([1e14 + 1, -1e14]));
});
test('truthy non-boolean confirmations cannot create verified balance evidence', () => {
  for (const field of ['confirmed', 'coverageConfirmed'])
    for (const value of ['false', 'true', 1, {}, null]) {
      const invalid = { ...scope, [field]: value } as any;
      assert.throws(() =>
        compare(
          normalizeSource(demoFiles[0], demoMappings[0], invalid, 'supplier'),
          normalizeSource(demoFiles[1], demoMappings[1], invalid, 'ledger'),
          invalid,
        ),
      );
    }
});
test('unknown and out-of-range exclusions cannot silently masquerade as reviewed rows', () => {
  for (const excluded of [
    { '999': 'out of range' },
    { '2.5': 'fractional row' },
    { '0': 'zero row' },
    { '2': true },
    [],
  ]) {
    assert.throws(() =>
      normalizeSource(
        demoFiles[0],
        { ...demoMappings[0], excluded } as any,
        scope,
        'supplier',
      ),
    );
  }
});
