import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compare,
  inferMapping,
  normalizeSource,
  structuralSummaryLabel,
} from '../lib/reconciliation/core.ts';
import type { SourceFile, Scope } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-046',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const headers = [
  'Reference',
  'Bank Reference',
  'Document Type',
  'Date',
  'Amount',
  'Description',
  'Helper',
];
const source = (
  parts: string[],
  order = [0, 1, 2, 3, 4, 5, 6],
): SourceFile => ({
  name: 'synthetic-balance-column-order.csv',
  sheets: [
    {
      name: 'Data',
      formulaRows: [],
      hiddenRows: [],
      rows: [
        ['Period: 2026-07-01 to 2026-07-31'],
        headers.map((_, i) => headers[order[i]]),
        ['', '', '', '', '0.00', 'Opening balance', ''].map(
          (_, i, row) => row[order[i]],
        ),
        ...parts.map((amount, i) =>
          [
            `PV-046-${i + 1}`,
            'BNK-046-ORDER',
            'Payment',
            '2026-07-15',
            amount,
            'Bank transfer',
            '',
          ].map((_, j, row) => row[order[j]]),
        ),
        ['', '', '', '', '-100.00', 'Closing balance', ''].map(
          (_, i, row) => row[order[i]],
        ),
      ],
    },
  ],
});
const accounted = (
  result: ReturnType<typeof normalizeSource>,
  file: SourceFile,
) => {
  const rows = [
    ...result.transactions.map((t) => t.row),
    ...result.errors.filter((e) => e.row > 0).map((e) => e.row),
    ...result.excluded.map((e) => e.row),
  ];
  assert.deepEqual(
    [...rows].sort((a, b) => a - b),
    file.sheets[0].rows.map((_, i) => i + 1),
  );
};

test('046 balance labels after the amount remain structural across column permutations and preserve complete payment groups', () => {
  for (const order of [
    [0, 1, 2, 3, 4, 5, 6],
    [4, 0, 3, 1, 6, 5, 2],
    [5, 4, 3, 2, 1, 0, 6],
  ]) {
    const a = source(['-100.00'], order),
      b = source(['-40.00', '-60.00'], order);
    const before = structuredClone([a, b]);
    const left = normalizeSource(a, inferMapping(a), scope, 'supplier');
    const right = normalizeSource(b, inferMapping(b), scope, 'ledger');
    for (const [result, file] of [
      [left, a],
      [right, b],
    ] as const) {
      assert.deepEqual(result.errors, []);
      assert.equal(result.opening, 0);
      assert.equal(result.closing, -10000);
      assert.equal(
        result.balanceArithmeticStatus,
        'BALANCE_ARITHMETIC_VERIFIED',
      );
      assert.equal(result.balanceValid, false);
      accounted(result, file);
    }
    assert.equal(compare(left, right, scope).matches.length, 1);
    assert.deepEqual([a, b], before);
  }
});

test('046 a dated invoice named Opening or Closing balance cannot disappear when its amount precedes its description', () => {
  for (const description of ['Opening balance', 'Closing balance']) {
    const file = source(['-100.00']);
    file.sheets[0].rows[3][0] = 'INV-046-DOCT';
    file.sheets[0].rows[3][1] = '';
    file.sheets[0].rows[3][2] = 'Invoice';
    file.sheets[0].rows[3][5] = description;
    const mapping = inferMapping(file);
    assert.equal(
      structuralSummaryLabel(
        file.sheets[0].rows[3],
        mapping,
        file.sheets[0].rows[mapping.header],
      ),
      undefined,
    );
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].description, description);
    assert.equal(result.transactions[0].amount, -10000);
    accounted(result, file);
  }
});

test('046 nonleading balance labels cannot conceal references, malformed dates or amounts, multiple labels or unrelated helper text', () => {
  for (const mutation of [
    { column: 0, value: 'INV-046-77' },
    { column: 3, value: '2026-07-15' },
    { column: 3, value: '2026-13-99' },
    { column: 4, value: '1..2' },
    { column: 4, value: '(-100.00)' },
    { column: 4, value: '①.00' },
    { column: 6, value: 'Closing balance' },
  ]) {
    const file = source(['-100.00']);
    file.sheets[0].rows[2][mutation.column] = mutation.value;
    const mapping = inferMapping(file);
    assert.equal(
      structuralSummaryLabel(
        file.sheets[0].rows[2],
        mapping,
        file.sheets[0].rows[mapping.header],
        true,
      ),
      undefined,
      JSON.stringify(mutation),
    );
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.ok(
      [...result.errors, ...result.transactions].some((e) => e.row === 3),
      JSON.stringify(mutation),
    );
    assert.equal(
      result.excluded.some((e) => e.row === 3),
      false,
    );
    assert.notEqual(
      result.balanceArithmeticStatus,
      'BALANCE_ARITHMETIC_VERIFIED',
    );
    accounted(result, file);
  }
  const helper = source(['-100.00']);
  helper.sheets[0].rows[2][6] = helper.sheets[0].rows[2][5];
  helper.sheets[0].rows[2][5] = '';
  const mapping = inferMapping(helper);
  assert.equal(
    structuralSummaryLabel(
      helper.sheets[0].rows[2],
      mapping,
      helper.sheets[0].rows[mapping.header],
      true,
    ),
    undefined,
  );
});

test('046 unsafe or hidden nonleading balance labels remain source errors and cannot establish complete groups', () => {
  for (const risk of ['cellIssues', 'referenceIssues', 'hiddenRows'] as const) {
    const a = source(['-100.00']),
      b = source(['-40.00', '-60.00']);
    if (risk === 'hiddenRows') a.sheets[0].hiddenRows = [3];
    else a.sheets[0][risk] = { '3:6': ['Untrusted label'] };
    const left = normalizeSource(a, inferMapping(a), scope, 'supplier'),
      right = normalizeSource(b, inferMapping(b), scope, 'ledger');
    assert.ok(left.errors.some((e) => e.row === 3));
    assert.equal(
      left.excluded.some((e) => e.row === 3),
      false,
    );
    assert.equal(compare(left, right, scope).matches.length, 0);
    accounted(left, a);
  }
});
