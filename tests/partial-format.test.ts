import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMapping, normalizeSource } from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import {
  assertInputFormats,
  formatChoice,
} from '../lib/reconciliation/input-readiness.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: '',
  entity: '',
  account: '',
  currency: 'KWD',
  decimals: 3,
  cutoff: '2026-08-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const file = (rows: string[][]): SourceFile => ({
  name: 'partial-synthetic.csv',
  sheets: [
    {
      name: 'Data',
      rows: [['Date', 'Reference', 'Amount'], ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
function reading(f: SourceFile): Mapping {
  const m = inferMapping(f);
  return { ...m, ...suggestFormats(f, m, scope.decimals).patch };
}

void test('partial formats isolate malformed dates and amounts without losing original rows or choosing a default', () => {
  const f = file([
    ['2026-08-01', 'INV-001', '123,45'],
    ['impossible', 'INV-002', 'not an amount'],
    ['2026-08-03', 'INV-003', '1,234'],
  ]);
  const m = reading(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.dateFormat.status, 'proven');
  assert.equal(a.numberFormat.status, 'proven');
  assert.deepEqual(a.dateFormat.unreadRows, [3]);
  assert.deepEqual(a.numberFormat.unreadRows, [3]);
  assert.equal(m.numberFormat, 'comma');
  assert.doesNotThrow(() => assertInputFormats([f], [m], scope));
  const source = normalizeSource(f, m, scope, 'supplier');
  assert.deepEqual(
    source.transactions.map((t) => [t.row, t.amount]),
    [
      [2, 123450],
      [4, 1234],
    ],
  );
  assert.deepEqual(
    source.errors.map((e) => e.row),
    [3],
  );
  assert.equal(
    source.excluded.some((e) => e.row === 3),
    false,
  );
  assert.equal(f.sheets[0].rows[2][2], 'not an amount');
  assert.equal(source.balanceValid, false);
});

void test('partial formats cannot cherry-pick contradictory but valid conventions', () => {
  const f = file([
    ['2026-08-01', 'INV-001', '100,50'],
    ['2026-08-02', 'INV-002', '100.50'],
    ['2026-08-03', 'INV-003', 'n/a'],
  ]);
  const m = inferMapping(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.numberFormat.status, 'invalid');
  assert.deepEqual(a.numberFormat.candidates, []);
  assert.deepEqual(a.numberFormat.unreadRows, [4]);
  assert.throws(() => assertInputFormats([f], [m], scope));
});

void test('unsafe comma evidence never scales the remaining ambiguous KWD amount', () => {
  const f = file([
    ['2026-08-01', 'INV-001', '100,50'],
    ['2026-08-02', 'INV-002', '1,234'],
  ]);
  f.sheets[0].cellIssues = { '2:3': ['Untrusted amount cell'] };
  const m = inferMapping(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.numberFormat.status, 'ambiguous');
  assert.deepEqual(a.numberFormat.unreadRows, [2]);
  assert.equal(a.patch.numberFormat, undefined);
  assert.throws(() => assertInputFormats([f], [m], scope));
});

void test('partial formats do not allow a stale chosen convention to bypass proven evidence', () => {
  const f = file([
    ['2026-08-01', 'INV-001', '100,50'],
    ['2026-08-02', 'INV-002', '1,234'],
    ['2026-08-03', 'INV-003', '?'],
  ]);
  const m = { ...reading(f), numberFormat: 'dot' as const };
  assert.equal(suggestFormats(f, m, 3).numberFormat.status, 'proven');
  assert.throws(() => assertInputFormats([f], [m], scope), /الصيغة المختارة/);
});

void test('native numeric cells remain independent of display format while formula or percentage cells remain errors', () => {
  const f = file([
    ['2026-08-01', 'INV-001', '1,234'],
    ['2026-08-02', 'INV-002', '500'],
    ['2026-08-03', 'INV-003', '50%'],
  ]);
  f.sheets[0].numericCells = {
    '2:3': { value: 1.234, format: '0.000' },
    '3:3': { value: 500, format: '0.000' },
    '4:3': { value: 0.5, format: '0%' },
  };
  f.sheets[0].formulaCells = { '3:3': { formula: '1+499' } };
  f.sheets[0].formulaRows = [3];
  f.sheets[0].cellIssues = { '3:3': ['Formula amount requires review'] };
  const m = reading(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.numberFormat.status, 'proven');
  assert.deepEqual(a.numberFormat.unreadRows, [3, 4]);
  const source = normalizeSource(f, m, scope, 'supplier');
  assert.deepEqual(
    source.transactions.map((t) => t.amount),
    [1234],
  );
  assert.deepEqual(
    source.errors.map((e) => e.row),
    [3, 4],
  );
});

void test('no readable date or amount evidence remains an explicit unresolved source, not a default', () => {
  const f = file([['bad date', 'INV-001', 'unknown']]);
  const m = inferMapping(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.dateFormat.status, 'invalid');
  assert.equal(a.numberFormat.status, 'invalid');
  assert.deepEqual(a.patch, {});
  assert.throws(() => assertInputFormats([f], [m], scope));
});

void test('malformed companion rows cannot answer genuine date ambiguity or transfer a choice to different evidence', () => {
  const f = file([
    ['01/02/2026', 'INV-001', '100.50'],
    ['bad date', 'INV-002', 'bad amount'],
  ]);
  const m = reading(f),
    a = suggestFormats(f, m, 3);
  assert.equal(a.dateFormat.status, 'ambiguous');
  assert.throws(() => assertInputFormats([f], [m], scope));
  const chosen: Mapping = {
    ...m,
    dateFormat: 'dmy',
    formatChoice: {
      dateFormat: formatChoice(
        f,
        m,
        'dateFormat',
        'dmy',
        a.dateFormat.candidates,
        3,
      ),
    },
  };
  assert.doesNotThrow(() => assertInputFormats([f], [chosen], scope));
  assert.throws(() =>
    assertInputFormats(
      [f],
      [{ ...chosen, excluded: { '3': 'New exclusion' } }],
      scope,
    ),
  );
});
