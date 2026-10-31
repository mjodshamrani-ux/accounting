// The census compares a run with its baseline and reports every difference;
// the browser run itself is scripts/ux-census-browser.mjs. These tests cover
// the comparison and the shape of the recorded baseline without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DOMAINS,
  METRICS,
  STATES,
  censusInPage,
  compare,
  focusInPage,
  plantInPage,
  sumStates,
} from './ux-census-support.mjs';

const zero = () => Object.fromEntries(METRICS.map((m) => [m, 0]));
const figures = (overrides = {}) =>
  Object.fromEntries(DOMAINS.map((d) => [d, { ...zero(), ...overrides[d] }]));

void test('a run equal to its baseline reports nothing', () => {
  const baseline = figures({ bank: { minorUnits: 3 } });
  assert.deepEqual(compare(baseline, figures({ bank: { minorUnits: 3 } })), {
    increases: [],
    decreases: [],
    missing: [],
  });
});

void test('a higher count is a new defect, a lower one an unrecorded improvement', () => {
  const baseline = figures({ payroll: { minorUnits: 38, focusLost: 2 } });
  const diff = compare(
    baseline,
    figures({ payroll: { minorUnits: 39, focusLost: 0 } }),
  );
  assert.deepEqual(diff.increases, ['payroll.minorUnits: 38 → 39']);
  assert.deepEqual(diff.decreases, ['payroll.focusLost: 2 → 0']);
  assert.deepEqual(diff.missing, []);
});

void test('a domain or metric without a baseline, or not measured, is not comparable', () => {
  const baseline = figures();
  delete baseline.ar;
  delete baseline.bank.pageOverflow;
  const current = figures();
  delete current.stock;
  const diff = compare(baseline, current);
  assert.deepEqual(diff.missing.sort(), [
    'ar: no baseline',
    'bank.pageOverflow: no baseline',
    'stock: not measured',
  ]);
});

void test('a domain figure sums each metric over its states', () => {
  const states = [
    { minorUnits: 2, focusLost: 1 },
    { minorUnits: 3 },
    { brokenInsideWord: 1, focusLost: 1 },
  ];
  assert.deepEqual(sumStates(states), {
    ...zero(),
    minorUnits: 5,
    brokenInsideWord: 1,
    focusLost: 2,
  });
});

void test('the recorded baseline covers every domain and metric and names its commit', async () => {
  const baseline = JSON.parse(
    await readFile(
      path.join(import.meta.dirname, '../audit/ux-census/baseline.json'),
      'utf8',
    ),
  );
  assert.deepEqual(baseline.metrics, METRICS);
  assert.deepEqual(Object.keys(baseline.domains), DOMAINS);
  for (const figure of Object.values(baseline.domains)) {
    assert.deepEqual(Object.keys(figure), METRICS);
    for (const value of Object.values(figure))
      assert.ok(Number.isInteger(value) && value >= 0);
  }
  assert.match(baseline.recorded.commit, /^[0-9a-f]{40}$/);
  assert.match(baseline.recorded.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(STATES.length, 4);
});

void test('the in-page functions stand alone, reading nothing from the module', () => {
  for (const fn of [censusInPage, focusInPage, plantInPage]) {
    const source = fn.toString();
    for (const name of ['METRICS', 'DOMAINS', 'STATES', 'compare', 'sumStates'])
      assert.ok(
        !new RegExp(`\\b${name}\\b`).test(source),
        `${fn.name} uses ${name}`,
      );
  }
});
