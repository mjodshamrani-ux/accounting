import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeclaredScope,
  originsOf,
  suggestDeclaredScope,
} from '../lib/reconciliation/declared-scope.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';

const file = (rows: string[][]): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [{ name: 'Sheet1', rows, hiddenRows: [], formulaRows: [] }],
});
const fields = [
  { field: 'entity', header: 'Entity' },
  { field: 'currency', header: 'Currency' },
];

void test('a value every row agrees on is suggested, with its evidence', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'GL',
        file: file([
          ['ID', 'Entity', 'Currency'],
          ['1', 'E1', 'SAR'],
          ['2', ' E1 ', 'SAR'],
        ]),
        sheet: 0,
      },
      {
        label: 'TB',
        file: file([
          ['Entity', 'ID', 'Currency'],
          ['E1', 'a', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'agreed');
  assert.equal(out.entity.value, 'E1');
  assert.deepEqual(out.entity.read, [
    { label: 'GL', rows: 2 },
    { label: 'TB', rows: 1 },
  ]);
  assert.deepEqual(out.entity.values, [
    {
      value: 'E1',
      sources: [
        { label: 'GL', rows: 2 },
        { label: 'TB', rows: 1 },
      ],
    },
  ]);
});

void test('one differing row leaves the field a question, no majority wins', () => {
  const rows = [
    ['Entity', 'Currency'],
    ...Array.from({ length: 9 }, () => ['E1', 'SAR']),
    ['E2', 'SAR'],
  ];
  const out = suggestDeclaredScope(
    [{ label: 'GL', file: file(rows), sheet: 0 }],
    fields,
  );
  assert.equal(out.entity.status, 'differs');
  assert.equal(out.entity.value, undefined);
  assert.deepEqual(
    out.entity.values.map((v) => [v.value, v.sources[0].rows]),
    [
      ['E1', 9],
      ['E2', 1],
    ],
  );
  assert.equal(out.currency.status, 'agreed');
});

void test('a blank cell is a value of its own, never skipped', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'GL',
        file: file([
          ['Entity', 'Currency'],
          ['E1', 'SAR'],
          ['', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'differs');
  assert.deepEqual(
    out.entity.values.map((v) => v.value),
    ['E1', ''],
  );
  const empty = suggestDeclaredScope(
    [
      {
        label: 'GL',
        file: file([
          ['Entity', 'Currency'],
          ['', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(empty.entity.status, 'blank');
});

void test('blank rows are not read, as the reader skips them', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'GL',
        file: file([
          ['Entity', 'Currency'],
          ['E1', 'SAR'],
          ['', ''],
          [' ', ''],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'agreed');
  assert.deepEqual(out.entity.read, [{ label: 'GL', rows: 1 }]);
});

void test('a column no source has, or has twice, gives nothing to suggest', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'GL',
        file: file([
          ['Entity', 'Entity', 'Currency'],
          ['E1', 'E1', 'SAR'],
        ]),
        sheet: 0,
      },
      {
        label: 'TB',
        file: file([
          ['ID', 'Currency'],
          ['a', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'absent');
  assert.deepEqual(out.entity.read, []);
  assert.equal(out.currency.status, 'agreed');
});

void test('only the named sheet and its first row as the header are read', () => {
  const two: SourceFile = {
    name: 'two.xlsx',
    sheets: [
      {
        name: 'Other',
        rows: [['Entity'], ['WRONG']],
        hiddenRows: [],
        formulaRows: [],
      },
      {
        name: 'Data',
        rows: [['Entity'], ['E1']],
        hiddenRows: [],
        formulaRows: [],
      },
    ],
  };
  const out = suggestDeclaredScope(
    [{ label: 'GL', file: two, sheet: 1 }],
    [fields[0]],
  );
  assert.equal(out.entity.value, 'E1');
  const shifted = suggestDeclaredScope(
    [{ label: 'GL', file: file([['note'], ['Entity'], ['E1']]), sheet: 0 }],
    [fields[0]],
  );
  assert.equal(shifted.entity.status, 'absent');
});

const rules = [
  { field: 'entity' },
  { field: 'currency', fallback: 'SAR' },
  { field: 'start', accepts: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) },
  { field: 'basis', fixed: true },
] as const;
type Key = (typeof rules)[number]['field'];
const blank: Record<Key, string> = {
  entity: '',
  currency: 'SAR',
  start: '',
  basis: 'functional',
};
const asked: Record<Key, 'question' | 'default'> = {
  entity: 'question',
  currency: 'default',
  start: 'question',
  basis: 'question',
};
const suggest = (rows: string[][]) =>
  suggestDeclaredScope(
    [{ label: 'GL', file: file(rows), sheet: 0 }],
    ['entity', 'currency', 'start', 'basis'].map((f) => ({
      field: f,
      header: f,
    })),
  );

void test('what the files agree on fills the fields nobody entered', () => {
  const out = applyDeclaredScope(
    blank,
    asked,
    suggest([
      ['entity', 'currency', 'start', 'basis'],
      ['E1', 'USD', '2026-09-01', 'functional'],
    ]),
    rules,
  );
  assert.deepEqual(out.values, {
    entity: 'E1',
    currency: 'USD',
    start: '2026-09-01',
    basis: 'functional',
  });
  assert.deepEqual(out.origins, {
    entity: 'file',
    currency: 'file',
    start: 'file',
    basis: 'file',
  });
  assert.equal(out.valuesChanged, true);
});

void test("the accountant's entry is never written over", () => {
  const out = applyDeclaredScope(
    { ...blank, entity: 'Mine' },
    { ...asked, entity: 'user' },
    suggest([
      ['entity', 'currency', 'start', 'basis'],
      ['E1', 'SAR', '2026-09-01', 'functional'],
    ]),
    rules,
  );
  assert.equal(out.values.entity, 'Mine');
  assert.equal(out.origins.entity, 'user');
});

void test('a field the files disagree on is emptied and asked, even after a file filled it', () => {
  const filled = applyDeclaredScope(
    blank,
    asked,
    suggest([
      ['entity', 'currency', 'start', 'basis'],
      ['E1', 'SAR', '2026-09-01', 'functional'],
    ]),
    rules,
  );
  const out = applyDeclaredScope(
    filled.values,
    filled.origins,
    suggest([
      ['entity', 'currency', 'start', 'basis'],
      ['E1', 'SAR', '2026-09-01', 'functional'],
      ['E2', 'SAR', '2026-09-01', 'local'],
    ]),
    rules,
  );
  assert.equal(out.values.entity, '');
  assert.equal(out.origins.entity, 'question');
  assert.equal(
    out.values.basis,
    'functional',
    'a one-option control keeps its option',
  );
  assert.equal(out.origins.basis, 'question');
  assert.equal(out.valuesChanged, true);
});

void test('a value the control cannot hold stays a question', () => {
  const out = applyDeclaredScope(
    blank,
    asked,
    suggest([
      ['entity', 'currency', 'start', 'basis'],
      ['E1', 'SAR', '01/09/2026', 'functional'],
    ]),
    rules,
  );
  assert.equal(out.values.start, '');
  assert.equal(out.origins.start, 'question');
});

void test('no column keeps the default and asks the rest; nothing changes twice', () => {
  const none = suggest([['other'], ['x']]);
  const out = applyDeclaredScope(blank, asked, none, rules);
  assert.deepEqual(out.origins, asked);
  assert.equal(out.valuesChanged, false);
  assert.equal(out.originsChanged, false);
});

void test('an example or a restored scope says which values the files hold', () => {
  const s = suggest([
    ['entity', 'currency', 'start', 'basis'],
    ['E1', 'SAR', '2026-09-01', 'functional'],
  ]);
  assert.deepEqual(
    originsOf(
      {
        entity: 'E1',
        currency: 'USD',
        start: '2026-09-01',
        basis: 'functional',
      },
      s,
      ['entity', 'currency', 'start', 'basis'],
    ),
    {
      entity: 'file',
      currency: 'user',
      start: 'file',
      basis: 'file',
    },
  );
});

void test('a value carried from another comparison is never written over', () => {
  const handoff = { ...asked, entity: 'handoff' as const };
  for (const entity of ['Carried', 'E1']) {
    const next = applyDeclaredScope(
      { ...blank, entity },
      handoff,
      suggest([
        ['entity', 'currency', 'start', 'basis'],
        ['E1', 'SAR', '2026-09-01', 'functional'],
      ]),
      rules,
    );
    assert.equal(next.values.entity, entity, 'the files never write over it');
    assert.equal(next.origins.entity, 'handoff', 'it stays carried');
    assert.equal(next.values.currency, 'SAR', 'the other fields still fill');
  }
});
