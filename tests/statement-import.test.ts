import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { demoScope } from '../lib/reconciliation/demo.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { syntheticStyledPdf } from './helpers/styled-pdf-fixture.ts';

test('explicit English month names are calendar-checked independently of numeric date order', () => {
  for (const format of ['ymd', 'dmy', 'mdy'] as const) {
    assert.equal(parseDate('02-Jul-2026', format), '2026-07-02');
    assert.equal(parseDate('٢٩-February-٢٠٢٤', format), '2024-02-29');
    assert.equal(parseDate('31-DEC-2026', format), '2026-12-31');
    for (const bad of [
      '29-Feb-2026',
      '31-Apr-2026',
      '02-Ju-2026',
      '02-Jul-26',
      '2026-Jul-02',
      '02-Juillet-2026',
      '00-Jul-2026',
    ])
      assert.throws(() => parseDate(bad, format));
  }
});
const file = (): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'Statement',
      formulaRows: [],
      hiddenRows: [],
      rows: [
        [
          'Date',
          'Document No.',
          'Debit (SAR)',
          'Credit (SAR)',
          'Running Balance',
        ],
        ['02-Jul-2026', 'SYN-7001', '1250.00', '', '1500.00'],
        ['12-Jul-2026', 'SYN-CN-2', '', '150.00', '1350.00'],
      ],
    },
  ],
});
const scope = {
  ...demoScope,
  cutoff: '2026-07-31',
  currency: 'SAR',
  confirmed: true,
  coverageConfirmed: true,
};
test('currency-tagged debit/credit headers select transaction values and preserve signs', () => {
  const source = file();
  const mapping = inferMapping(source);
  assert.equal(mapping.mode, 'split');
  assert.equal(mapping.debit, 2);
  assert.equal(mapping.credit, 3);
  assert.equal(mapping.amount, -1);
  const result = normalizeSource(
    source,
    { ...mapping, opening: '250', closing: '1350', periodStart: '2026-07-01' },
    scope,
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => [t.date, t.reference, t.amount]),
    [
      ['2026-07-02', 'SYN-7001', 125000],
      ['2026-07-12', 'SYN-CN-2', -15000],
    ],
  );
  assert.equal(result.balanceValid, true);
  assert.equal(result.total, 110000);
});
test('a header currency mismatch or duplicate debit column is never guessed away', () => {
  const source = file();
  assert.throws(
    () =>
      normalizeSource(
        source,
        inferMapping(source),
        { ...scope, currency: 'USD' },
        'supplier',
      ),
    /عملة عنوان/,
  );
  source.sheets[0].rows[0][3] = 'Credit (USD)';
  assert.throws(
    () => normalizeSource(source, inferMapping(source), scope, 'supplier'),
    /عملة عنوان/,
  );
  source.sheets[0].rows[0].push('Debit (SAR)');
  assert.equal(inferMapping(source).debit, -1);
});
test('styled PDF flows through strict normalization with exact source rows and amounts', async () => {
  const source = await readFile(
    'synthetic-styled.pdf',
    syntheticStyledPdf(),
    [25, 45],
  );
  const result = normalizeSource(
    source,
    { ...inferMapping(source), pdfReviewed: true },
    scope,
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.total, 110000);
  assert.deepEqual(
    result.transactions.map((t) => [t.row, t.sourcePage, t.amount]),
    [
      [3, 1, 125000],
      [4, 1, -15000],
    ],
  );
});
