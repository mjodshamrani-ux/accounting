import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../audit/reliability/report.mjs';

// A reliability number is only useful if a collapse in achievement shows up in
// it. These guard the reported shape, not the engine: a run that stops on every
// clear case must not be able to present itself as an accurate run.
const record = (over = {}) => ({
  pass: true,
  safetyPass: true,
  stopped: false,
  currency: 'SAR',
  permittedMatches: 10,
  expectedMatches: 10,
  correctRequiredMatches: 10,
  correctMatches: 10,
  permittedGroups: 0,
  acceptedGroups: 0,
  falseMatches: 0,
  falseMatchValueMinor: '0',
  expectedRows: 20,
  validExpectedRows: 20,
  extractedRows: 20,
  excludedRows: 0,
  exceptionRows: 0,
  handledExceptionRows: 0,
  exportChecked: true,
  bridgeChecked: true,
  mappingAutomatic: true,
  confirmations: [],
  failures: [],
  ...over,
});

test('046 stopping every clear case cannot be reported as accurate work', () => {
  const stoppedRun = aggregate(
    Array.from({ length: 50 }, () =>
      record({
        stopped: true,
        correctRequiredMatches: 0,
        correctMatches: 0,
        extractedRows: 0,
        exportChecked: false,
        bridgeChecked: false,
      }),
    ),
  );
  // A safe stop may still count as a pass, so passed alone is not achievement.
  assert.equal(stoppedRun.stopped, 50);
  assert.equal(stoppedRun.correctRequiredMatches, 0);
  assert.equal(stoppedRun.expectedMatches, 500);
  assert.equal(stoppedRun.exportsChecked, 0);
  assert.equal(stoppedRun.bridgesChecked, 0);
  assert.ok(
    stoppedRun.correctRequiredMatches < stoppedRun.expectedMatches,
    'the missed required matches must stay visible next to the pass count',
  );
});

test('046 a false match is never absorbed into the correct-match total', () => {
  const run = aggregate([
    record(),
    record({
      pass: false,
      safetyPass: false,
      falseMatches: 1,
      falseMatchValueMinor: '2500',
      correctRequiredMatches: 9,
    }),
  ]);
  assert.equal(run.falseMatches, 1);
  assert.equal(run.safetyPassed, 1);
  assert.equal(run.correctRequiredMatches, 19);
  assert.deepEqual(run.falseMatchMinorByCurrency, { SAR: '2500' });
});

test('046 amounts of different currencies are never summed together', () => {
  const run = aggregate([
    record({ currency: 'SAR', falseMatches: 1, falseMatchValueMinor: '100' }),
    record({ currency: 'KWD', falseMatches: 1, falseMatchValueMinor: '250' }),
  ]);
  assert.deepEqual(run.falseMatchMinorByCurrency, { SAR: '100', KWD: '250' });
});

test('046 confirmations are counted per kind so an oracle-fed format is visible', () => {
  // Each "format invalid" confirmation marks a source the engine could not read
  // on its own. Collapsing them into one total would hide the capability gap.
  const run = aggregate([
    record({ confirmations: ['supplier: date format invalid'] }),
    record({
      confirmations: [
        'supplier: date format invalid',
        'ledger: number format ambiguous',
      ],
    }),
  ]);
  assert.deepEqual(run.confirmations, {
    'supplier: date format invalid': 2,
    'ledger: number format ambiguous': 1,
  });
});
