// The census compares a run with its baseline and reports every difference;
// the browser run itself is scripts/ux-census-browser.mjs. These tests cover
// the comparison and the shape of the recorded baseline without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  DOMAINS,
  METRICS,
  PALETTE_CEILING,
  STATES,
  censusInPage,
  compare,
  comparePalette,
  focusInPage,
  paletteSizes,
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
  for (const [role, ceiling] of Object.entries(PALETTE_CEILING))
    assert.ok(
      Number.isInteger(baseline.palette[role]) &&
        baseline.palette[role] <= ceiling,
      `palette.${role} is recorded within its ceiling`,
    );
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

const state = (palette) => ({ palette });
void test('the palette counts each colour once by role over every state and domain', () => {
  const sizes = paletteSizes({
    bank: {
      states: [
        state({
          text: { '#0a1b2e': 9, '#637088': 2 },
          surface: { '#ffffff': 4 },
          border: {},
        }),
        state({
          text: { '#0a1b2e': 1 },
          surface: { '#f7f8fc': 1 },
          border: { '#e3e7ef': 3 },
        }),
      ],
    },
    ar: {
      states: [
        state({
          text: { '#573790': 1 },
          surface: { '#ffffff': 1 },
          border: { '#e3e7ef': 1 },
        }),
      ],
    },
  });
  assert.deepEqual(sizes, { text: 3, surface: 2, border: 1 });
});

void test('a palette above its record or its declared ceiling fails, a smaller one asks to be recorded', () => {
  const recorded = { text: 7, surface: 7, border: 8 };
  assert.deepEqual(comparePalette(recorded, recorded), {
    increases: [],
    decreases: [],
    missing: [],
  });
  const diff = comparePalette(recorded, { text: 8, surface: 6, border: 8 });
  assert.deepEqual(diff.increases, ['palette.text: 7 → 8']);
  assert.deepEqual(diff.decreases, ['palette.surface: 7 → 6']);
  // A record above the ceiling does not excuse the run.
  const loose = comparePalette(
    { text: 40, surface: 30, border: 40 },
    { text: 13, surface: 8, border: 9 },
  );
  assert.deepEqual(loose.increases, [
    'palette.text: 13 colours, above the 12 the UX-8 record declared',
    'palette.border: 9 colours, above the 8 the UX-8 record declared',
  ]);
  assert.deepEqual(comparePalette(undefined, recorded).missing, [
    'palette.text: no baseline',
    'palette.surface: no baseline',
    'palette.border: no baseline',
  ]);
});

void test('the workspace stylesheets name at most 30 colours of their own (UX-8(d))', async () => {
  const root = path.join(import.meta.dirname, '..');
  const files = [
    ...(await readdir(path.join(root, 'components')))
      .filter((name) => name.endsWith('.css'))
      .map((name) => path.join('components', name)),
    path.join('app', 'reconciliation-shell.css'),
  ];
  assert.ok(files.length >= 14, 'the fourteen stylesheets are read');
  const colours = new Set();
  for (const file of files) {
    const text = (await readFile(path.join(root, file), 'utf8')).replace(
      /\/\*[\s\S]*?\*\//gu,
      '',
    );
    for (const hex of text.match(/#[0-9a-f]{3,8}\b/giu) ?? [])
      colours.add(hex.toLowerCase());
  }
  assert.ok(
    colours.size <= 30,
    `${colours.size} colours: ${[...colours].join(' ')}`,
  );
});
