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

void test('a source reads a field from the column its role names for it', () => {
  const ledger = (entity: string, counterparty: string) =>
    file([
      ['Entity', 'Counterparty', 'Entity A'],
      [entity, counterparty, 'Not this role'],
    ]);
  const fields = [
    { field: 'entityA', header: 'Entity A' },
    { field: 'entityB', header: 'Entity B' },
  ];
  const sources = (right: [string, string]) => [
    {
      label: 'Left',
      file: ledger('A', 'B'),
      sheet: 0,
      headers: { entityA: 'Entity', entityB: 'Counterparty' },
    },
    {
      label: 'Right',
      file: ledger(...right),
      sheet: 0,
      headers: { entityB: 'Entity', entityA: 'Counterparty' },
    },
    {
      label: 'Evidence',
      file: file([
        ['Entity A', 'Entity B'],
        ['A', 'B'],
      ]),
      sheet: 0,
    },
  ];
  const agreed = suggestDeclaredScope(sources(['B', 'A']), fields);
  assert.equal(agreed.entityA.status, 'agreed');
  assert.equal(agreed.entityA.value, 'A');
  assert.deepEqual(agreed.entityA.read, [
    { label: 'Left', rows: 1, header: 'Entity' },
    { label: 'Right', rows: 1, header: 'Counterparty' },
    { label: 'Evidence', rows: 1 },
  ]);
  assert.equal(agreed.entityB.value, 'B');
  // The right ledger names another counterparty: entity A is a question.
  const mixed = suggestDeclaredScope(sources(['B', 'C']), fields);
  assert.equal(mixed.entityA.status, 'differs');
  assert.deepEqual(mixed.entityA.values, [
    {
      value: 'A',
      sources: [
        { label: 'Left', rows: 1 },
        { label: 'Evidence', rows: 1 },
      ],
    },
    { value: 'C', sources: [{ label: 'Right', rows: 1 }] },
  ]);
});

void test('a field a source does not write is not read from it, even under its own header', () => {
  // An accounts receivable file whose columns the accountant maps: its
  // "Entity" column is mapped, its "Ledger" column is not, so its reader
  // never reads that column and neither does the card.
  const mapped = file([
    ['Entity', 'Ledger'],
    ['E1', 'L-OTHER'],
  ]);
  const fields = [
    { field: 'entity', header: 'Entity' },
    { field: 'ledger', header: 'Ledger' },
  ];
  const out = suggestDeclaredScope(
    [
      {
        label: 'Mapped',
        file: mapped,
        sheet: 0,
        headers: { entity: 'Entity', ledger: null },
      },
      {
        label: 'Other',
        file: file([
          ['Entity', 'Ledger'],
          ['E1', 'L1'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'agreed');
  assert.deepEqual(out.entity.read, [
    { label: 'Mapped', rows: 1 },
    { label: 'Other', rows: 1 },
  ]);
  assert.equal(out.ledger.status, 'agreed', 'the unmapped column is not read');
  assert.equal(out.ledger.value, 'L1');
  assert.deepEqual(out.ledger.read, [{ label: 'Other', rows: 1 }]);
  // With no source writing it, the field is absent: a question.
  const alone = suggestDeclaredScope(
    [
      {
        label: 'Mapped',
        file: mapped,
        sheet: 0,
        headers: { entity: 'Entity', ledger: null },
      },
    ],
    fields,
  );
  assert.equal(alone.ledger.status, 'absent');
  assert.deepEqual(alone.ledger.read, []);
});

void test('a source that writes its scope once gives it as a block, counted once', () => {
  // The register's rows carry no scope columns, and one row even writes an
  // "Entity" column the block does not use: a block source is read from its
  // block alone.
  const out = suggestDeclaredScope(
    [
      {
        label: 'Register',
        file: file([
          ['Format', 'Sections'],
          ['Entity', 'E9'],
        ]),
        sheet: 0,
        block: { entity: ' E1 ', currency: 'SAR' },
      },
      {
        label: 'Mapping',
        file: file([
          ['ID', 'Entity', 'Currency'],
          ['1', 'E1', 'SAR'],
          ['2', 'E1', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'agreed');
  assert.equal(out.entity.value, 'E1');
  assert.deepEqual(out.entity.read, [
    { label: 'Register', rows: 1, block: true },
    { label: 'Mapping', rows: 2 },
  ]);
  assert.deepEqual(out.entity.values, [
    {
      value: 'E1',
      sources: [
        { label: 'Register', rows: 1, block: true },
        { label: 'Mapping', rows: 2 },
      ],
    },
  ]);
});

void test('a block that disagrees with the rows leaves the field a question', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'Register',
        file: file([['Format', 'Sections']]),
        sheet: 0,
        block: { entity: 'E2', currency: 'SAR' },
      },
      {
        label: 'Mapping',
        file: file([
          ['Entity', 'Currency'],
          ['E1', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.status, 'differs');
  assert.equal(out.entity.value, undefined);
  assert.deepEqual(out.entity.values, [
    // The block's value is said as its block, not as one row.
    { value: 'E2', sources: [{ label: 'Register', rows: 1, block: true }] },
    { value: 'E1', sources: [{ label: 'Mapping', rows: 1 }] },
  ]);
  assert.equal(out.currency.status, 'agreed');
});

void test('a field the block does not state is read from the other sources only', () => {
  const out = suggestDeclaredScope(
    [
      {
        label: 'Register',
        file: file([['Format', 'Matrix']]),
        sheet: 0,
        block: { entity: 'E1' },
      },
      {
        label: 'Mapping',
        file: file([
          ['Entity', 'Currency'],
          ['E1', 'KWD'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.deepEqual(out.currency.read, [{ label: 'Mapping', rows: 1 }]);
  assert.equal(out.currency.value, 'KWD');
  assert.deepEqual(out.entity.read, [
    { label: 'Register', rows: 1, block: true },
    { label: 'Mapping', rows: 1 },
  ]);
});

void test('a block needs no rows: a printed register gives its scope lines only', () => {
  const out = suggestDeclaredScope(
    [
      { label: 'Printed register', sheet: 0, block: { entity: 'E1' } },
      {
        label: 'Mapping',
        file: file([
          ['Entity', 'Currency'],
          ['E1', 'SAR'],
        ]),
        sheet: 0,
      },
    ],
    fields,
  );
  assert.equal(out.entity.value, 'E1');
  assert.deepEqual(out.entity.read, [
    { label: 'Printed register', rows: 1, block: true },
    { label: 'Mapping', rows: 1 },
  ]);
});
