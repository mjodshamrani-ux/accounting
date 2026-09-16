import test from 'node:test';
import assert from 'node:assert/strict';
import { inferStatementDirection } from '../lib/reconciliation/statement-direction.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Mapping, SourceFile } from '../lib/reconciliation/types.ts';

const headers = [
  'Date',
  'Type',
  'Reference',
  'Debit',
  'Credit',
  'Running Balance',
];
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  debit: 3,
  credit: 4,
  mode: 'split',
};
const fixture = (reverse = false): SourceFile => ({
  name: 'synthetic-direction.csv',
  sheets: [
    {
      name: 'Statement',
      rows: [
        [
          ...headers.slice(0, 5),
          reverse ? 'Running AP Balance' : 'Running Balance',
        ],
        [
          '2026-07-01',
          'Opening Balance',
          'B/F',
          reverse ? '0' : '100',
          reverse ? '100' : '0',
          '100',
        ],
        [
          '2026-07-02',
          'Invoice',
          'INV-100',
          reverse ? '0' : '25',
          reverse ? '25' : '0',
          '125',
        ],
        [
          '2026-07-03',
          'Payment',
          'PAY-100',
          reverse ? '10' : '0',
          reverse ? '0' : '10',
          '115',
        ],
      ],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});

test('both supplier and AP directions require exact running-balance recurrences', () => {
  for (const reverse of [false, true]) {
    const file = fixture(reverse);
    const before = structuredClone({ file, mapping });
    const result = inferStatementDirection(file, mapping);
    assert.equal(result?.multiplier, reverse ? -1 : 1);
    assert.equal(result.balanceColumn, 5);
    assert.equal(result.checkedRows, 2);
    assert.match(result.reason, /الرصيد الافتتاحي/);
    assert.deepEqual({ file, mapping }, before);
  }
});

test('an explicit leading label can supply the baseline without invented zero opening', () => {
  const file = fixture();
  file.sheets[0].rows[1] = ['Opening balance', '', '', '', '', '100'];
  assert.equal(inferStatementDirection(file, mapping)?.multiplier, 1);
  file.sheets[0].rows.splice(1, 1);
  assert.equal(inferStatementDirection(file, mapping), undefined);
});

test('no single recurrence or zero-only activity can establish direction', () => {
  const file = fixture();
  file.sheets[0].rows.pop();
  assert.equal(inferStatementDirection(file, mapping), undefined);
  file.sheets[0].rows.push(['2026-07-03', 'Zero', 'ZERO-100', '0', '0', '125']);
  assert.equal(inferStatementDirection(file, mapping), undefined);
  file.sheets[0].rows.push([
    '2026-07-04',
    'Payment',
    'PAY-100',
    '',
    '10',
    '115',
  ]);
  const result = inferStatementDirection(file, mapping);
  assert.equal(result?.multiplier, 1);
  assert.equal(result.checkedRows, 3);
});

test('any later inconsistency cancels earlier proof, including zero movements with balance changes', () => {
  for (const tail of [
    ['2026-07-04', 'Invoice', 'INV-200', '5', '0', '110'],
    ['2026-07-04', 'Invoice', 'INV-200', '5', '0', '121'],
    ['2026-07-04', 'Zero', 'ZERO-200', '0', '0', '116'],
  ]) {
    const file = fixture();
    file.sheets[0].rows.push(tail);
    assert.equal(inferStatementDirection(file, mapping), undefined);
  }
});

test('malformed or omitted movements cannot be skipped to recover a sign suggestion', () => {
  for (const column of [0, 3, 4, 5]) {
    const file = fixture();
    file.sheets[0].rows[2][column] = 'bad';
    assert.equal(
      inferStatementDirection(file, mapping),
      undefined,
      String(column),
    );
  }
  const file = fixture();
  assert.equal(
    inferStatementDirection(file, {
      ...mapping,
      excluded: { '3': 'Reviewed separately' },
    }),
    undefined,
  );
  file.sheets[0].rows.push(['', '', 'Unrecognized note', '', '', '']);
  assert.equal(inferStatementDirection(file, mapping), undefined);
});

test('descending dates, negative split values and simultaneous debit/credit prevent proof', () => {
  const descending = fixture();
  descending.sheets[0].rows[3][0] = '2026-07-01';
  assert.equal(inferStatementDirection(descending, mapping), undefined);
  const earlierThanOpening = fixture();
  earlierThanOpening.sheets[0].rows[1][0] = '2026-07-05';
  assert.equal(inferStatementDirection(earlierThanOpening, mapping), undefined);
  for (const pair of [
    ['-25', '0'],
    ['30', '5'],
    ['', ''],
  ]) {
    const file = fixture();
    file.sheets[0].rows[2][3] = pair[0];
    file.sheets[0].rows[2][4] = pair[1];
    assert.equal(inferStatementDirection(file, mapping), undefined);
  }
});

test('only a unique explicit running-balance column qualifies', () => {
  for (const label of ['Balance', 'Outstanding', 'Remaining', 'Unfamiliar']) {
    const file = fixture();
    file.sheets[0].rows[0][5] = label;
    assert.equal(inferStatementDirection(file, mapping), undefined, label);
  }
  const duplicate = fixture();
  duplicate.sheets[0].rows[0].push('Running AP Balance');
  assert.equal(inferStatementDirection(duplicate, mapping), undefined);
  const mismatch = fixture();
  mismatch.sheets[0].rows[0][3] = 'Debit (USD)';
  mismatch.sheets[0].rows[0][5] = 'Running Balance (SAR)';
  assert.equal(inferStatementDirection(mismatch, mapping), undefined);
  assert.equal(
    inferStatementDirection(fixture(), { ...mapping, mode: 'signed' }),
    undefined,
  );
});

test('native Excel numeric values are read independently of displayed locale', () => {
  const file = fixture(true);
  file.name = 'synthetic-native.xlsx';
  const sheet = file.sheets[0];
  sheet.numericCells = {};
  for (let i = 1; i < sheet.rows.length; i++)
    for (const column of [3, 4, 5]) {
      const value = Number(sheet.rows[i][column]);
      sheet.rows[i][column] = value.toFixed(2).replace('.', ',');
      sheet.numericCells[`${i + 1}:${column + 1}`] = { value, format: '0.00' };
    }
  assert.equal(inferStatementDirection(file, mapping)?.multiplier, -1);
  sheet.numericCells['3:4'].format = '0%';
  assert.equal(inferStatementDirection(file, mapping), undefined);
});

test('currency precision and Arabic numeric notation use exact engine parsing', () => {
  const file = fixture();
  file.sheets[0].rows[1] = ['Opening balance', '', '', '', '', '١٠٠٫٠٠٠'];
  file.sheets[0].rows[2] = [
    '٢٠٢٦-٠٧-٠٢',
    'Invoice',
    'INV-100',
    '٠٫١٢٥',
    '٠',
    '١٠٠٫١٢٥',
  ];
  file.sheets[0].rows[3] = [
    '٢٠٢٦-٠٧-٠٣',
    'Payment',
    'PAY-100',
    '٠',
    '٠٫٠٢٥',
    '١٠٠٫١٠٠',
  ];
  assert.equal(inferStatementDirection(file, mapping, 3)?.multiplier, 1);
  assert.equal(inferStatementDirection(file, mapping, 2), undefined);
});

test('selected-cell issues, unsafe opening identities and formula-only metadata cancel proof', () => {
  for (const column of [0, 3, 4, 5]) {
    const file = fixture();
    file.sheets[0].cellIssues = {
      [`3:${column + 1}`]: ['Untrusted source cell'],
    };
    assert.equal(
      inferStatementDirection(file, mapping),
      undefined,
      String(column),
    );
  }
  const rowIssue = fixture();
  rowIssue.sheets[0].rowIssues = { '3': ['PDF column crossing'] };
  assert.equal(inferStatementDirection(rowIssue, mapping), undefined);
  const formula = fixture();
  formula.sheets[0].formulaRows = [3];
  assert.equal(inferStatementDirection(formula, mapping), undefined);
  const opening = fixture();
  opening.sheets[0].referenceIssues = {
    '2:3': ['Opening reference is not reliable'],
  };
  assert.equal(inferStatementDirection(opening, mapping), undefined);
  const unused = fixture();
  unused.sheets[0].cellIssues = { '3:7': ['Unused helper formula'] };
  unused.sheets[0].formulaRows = [3];
  assert.equal(inferStatementDirection(unused, mapping)?.multiplier, 1);
});

test('repeated headers and structural footers preserve the full recurrence chain', () => {
  const file = fixture();
  file.sheets[0].rows.splice(3, 0, [...headers]);
  file.sheets[0].rows.push(
    ['Total', '', '', '25', '10', ''],
    ['Closing Balance', '', '', '', '', '115'],
    [
      '',
      '',
      'This export contains demonstration information for internal testing only.',
      '',
      '',
      '',
    ],
  );
  const before = structuredClone(file);
  const result = inferStatementDirection(file, mapping);
  assert.equal(result?.multiplier, 1);
  assert.equal(result.checkedRows, 2);
  assert.deepEqual(file, before);
  file.sheets[0].rows[6][5] = '999';
  assert.equal(inferStatementDirection(file, mapping), undefined);
});

test('a late opening record or transaction named Total cannot reset or evade the chain', () => {
  const late = fixture();
  late.sheets[0].rows.push(['Opening Balance', '', '', '', '', '115']);
  assert.equal(inferStatementDirection(late, mapping), undefined);
  const named = fixture();
  named.sheets[0].rows[3][1] = 'Total';
  assert.equal(inferStatementDirection(named, mapping)?.multiplier, 1);
  named.sheets[0].rows[3][5] = '116';
  assert.equal(inferStatementDirection(named, mapping), undefined);
  const conflictingOpening = fixture();
  conflictingOpening.sheets[0].rows[1][3] = '99';
  assert.equal(inferStatementDirection(conflictingOpening, mapping), undefined);
});

test('an independently aligned closing footer must have exactly one matching amount beside its currency', () => {
  const file = fixture(true);
  file.sheets[0].rows[0][3] = 'Debit (SAR)';
  file.sheets[0].rows[0][4] = 'Credit (SAR)';
  file.sheets[0].rows.push(['Closing AP Balance', '', '', '', '115.00', 'SAR']);
  const before = structuredClone(file);
  const proof = inferStatementDirection(file, mapping);
  assert.equal(proof?.multiplier, -1);
  assert.equal(proof.checkedRows, 2);
  assert.deepEqual(file, before);
  for (const [column, value] of [
    [4, '999.00'],
    [3, '0.00'],
    [5, 'USD'],
    [4, ''],
  ] as const) {
    const changed = structuredClone(file);
    changed.sheets[0].rows.at(-1)![column] = value;
    assert.equal(
      inferStatementDirection(changed, mapping),
      undefined,
      `${column}:${value}`,
    );
  }
  const untrusted = structuredClone(file);
  untrusted.sheets[0].cellIssues = { '5:5': ['Untrusted footer amount'] };
  assert.equal(inferStatementDirection(untrusted, mapping), undefined);
});
