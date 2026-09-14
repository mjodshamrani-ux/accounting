import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { defaultMapping, MAX_ROWS } from '../lib/reconciliation/types.ts';
import type { Mapping, SourceFile } from '../lib/reconciliation/types.ts';

const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
};
const fixture = (rows: string[][]): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'Source',
      rows: [['Date', 'Reference', 'Amount'], ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});

test('ISO dates, explicit month names and whole numbers need no locale question', () => {
  const result = suggestFormats(
    fixture([
      ['2026-07-01', 'A', '100'],
      ['02-Jul-2026', 'B', '-25'],
      ['٠٣-July-٢٠٢٦', 'C', '٠'],
    ]),
    mapping,
    2,
  );
  assert.equal(result.dateFormat.status, 'proven');
  assert.deepEqual(result.dateFormat.candidates, ['ymd', 'dmy', 'mdy']);
  assert.equal(result.numberFormat.status, 'proven');
  assert.deepEqual(result.patch, { dateFormat: 'ymd', numberFormat: 'dot' });
});

test('calendar ambiguity remains visible until a whole-column interpretation is unique', () => {
  const file = fixture([['01/02/2026', 'A', '1234.56']]);
  const ambiguous = suggestFormats(file, mapping, 2);
  assert.equal(ambiguous.dateFormat.status, 'ambiguous');
  assert.deepEqual(ambiguous.dateFormat.candidates, ['dmy', 'mdy']);
  assert.equal(ambiguous.patch.dateFormat, undefined);
  file.sheets[0].rows.push(['13/02/2026', 'B', '(500.00)']);
  assert.equal(suggestFormats(file, mapping, 2).patch.dateFormat, 'dmy');
  const american = suggestFormats(
    fixture([['02/13/2026', 'A', '10']]),
    mapping,
    2,
  );
  assert.equal(american.patch.dateFormat, 'mdy');
  const same = suggestFormats(fixture([['02/02/2026', 'A', '10']]), mapping, 2);
  assert.equal(same.dateFormat.status, 'proven');
});

test('impossible dates, short years and mutually incompatible date orders are invalid', () => {
  for (const dates of [
    ['2026-02-29'],
    ['31-Apr-2026'],
    ['14-Mystery-2026'],
    ['01/02/26'],
    ['13/02/2026', '02/13/2026'],
    ['2026-07-01', ''],
  ]) {
    const result = suggestFormats(
      fixture(dates.map((date) => [date, 'A', '10'])),
      mapping,
      2,
    );
    assert.equal(result.dateFormat.status, 'invalid', dates.join(','));
    assert.equal(result.patch.dateFormat, undefined);
  }
});

test('number format inference obeys grouping, decimal precision and Arabic separators', () => {
  for (const [amount, format] of [
    ['1,234.56', 'dot'],
    ['(1.234,56)', 'comma'],
    ['١٬٢٣٤٫٥٦', 'dot'],
  ]) {
    const result = suggestFormats(
      fixture([['٢٠٢٦-٠٧-٠١', 'A', amount]]),
      mapping,
      2,
    );
    assert.equal(result.numberFormat.status, 'proven', amount);
    // Arabic grouping/decimal symbols are explicit under both accepted formats.
    if (!amount.includes('٫')) assert.equal(result.patch.numberFormat, format);
  }
  for (const amount of ['1,23.45', '1e3', '1.', '1,234,56', 'SAR 100']) {
    const result = suggestFormats(
      fixture([['2026-07-01', 'A', amount]]),
      mapping,
      2,
    );
    assert.equal(result.numberFormat.status, 'invalid', amount);
    assert.equal(result.patch.numberFormat, undefined);
  }
});

test('three-decimal currencies never guess between decimal and thousands separators', () => {
  for (const amount of ['1.234', '1,234', '-12.345']) {
    const result = suggestFormats(
      fixture([['2026-07-01', 'A', amount]]),
      mapping,
      3,
    );
    assert.equal(result.numberFormat.status, 'ambiguous', amount);
    assert.deepEqual(result.numberFormat.candidates, ['dot', 'comma']);
    assert.equal(result.patch.numberFormat, undefined);
  }
  const complete = fixture([
    ['2026-07-01', 'A', '1.234'],
    ['2026-07-02', 'B', '12.34'],
  ]);
  assert.equal(suggestFormats(complete, mapping, 3).patch.numberFormat, 'dot');
  const incompatible = fixture([
    ['2026-07-01', 'A', '1.23'],
    ['2026-07-02', 'B', '1,23'],
  ]);
  assert.equal(
    suggestFormats(incompatible, mapping, 3).numberFormat.status,
    'invalid',
  );
});

test('native Excel numeric cells are locale independent, while text cells still constrain format', () => {
  const file = fixture([
    ['2026-07-01', 'A', '1.234'],
    ['2026-07-02', 'B', '25,000'],
  ]);
  file.sheets[0].numericCells = {
    '2:3': { value: 1.234, format: '0.000' },
    '3:3': { value: 25, format: '0.000' },
  };
  const result = suggestFormats(file, { ...mapping, numberFormat: 'comma' }, 3);
  assert.equal(result.numberFormat.status, 'proven');
  assert.equal(result.patch.numberFormat, 'comma');
  assert.match(result.numberFormat.reason, /Excel/);
  file.sheets[0].rows.push(['2026-07-03', 'C', '12.34']);
  assert.equal(suggestFormats(file, mapping, 3).patch.numberFormat, 'dot');
  assert.equal(suggestFormats(file, mapping, 2).numberFormat.status, 'invalid');
});

test('mapped parser defects and percentage cells cannot become format proof', () => {
  for (const mode of ['cell', 'row', 'formula', 'percent']) {
    const file = fixture([['2026-07-01', 'A', '1234.56']]);
    if (mode === 'cell') file.sheets[0].cellIssues = { '2:3': ['hidden sign'] };
    if (mode === 'row')
      file.sheets[0].rowIssues = { '2': ['PDF extraction issue'] };
    if (mode === 'formula') file.sheets[0].formulaRows = [2];
    if (mode === 'percent')
      file.sheets[0].numericCells = { '2:3': { value: 0.5, format: '0%' } };
    assert.equal(
      suggestFormats(file, mapping, 2).numberFormat.status,
      'invalid',
      mode,
    );
  }
  const file = fixture([['13/07/2026', 'A', '1234.56', 'ignored helper']]);
  file.sheets[0].cellIssues = { '2:4': ['formula'] };
  file.sheets[0].formulaRows = [2];
  assert.deepEqual(suggestFormats(file, mapping, 2).patch, {
    dateFormat: 'dmy',
    numberFormat: 'dot',
  });
  file.sheets[0].cellIssues['2:1'] = ['merged date'];
  assert.equal(suggestFormats(file, mapping, 2).dateFormat.status, 'invalid');
});

test('inference ignores explicit exclusions, preheaders and clear balance rows without changing them', () => {
  const file = fixture([
    ['not a date', 'preheader', 'bad amount'],
    ['Date', 'Reference', 'Amount'],
    ['01/02/2026', 'A', '1.234'],
    ['13/02/2026', 'B', '12.34'],
    ['02/13/2026', 'C', '12,34'],
    ['', 'Opening balance:', '8,000'],
    ['', 'الرصيد الختامي', '9,000'],
    ['', 'Total', '17,000'],
  ]);
  const m = {
    ...mapping,
    header: 2,
    excluded: { '6': 'Reviewed duplicate report row' },
  };
  const original = structuredClone({ file, m });
  const result = suggestFormats(file, m, 3);
  assert.deepEqual(result.patch, { dateFormat: 'dmy', numberFormat: 'dot' });
  assert.equal(result.dateFormat.checkedValues, 2);
  assert.equal(result.numberFormat.checkedValues, 2);
  assert.deepEqual({ file, m }, original);
});

test('split amounts allow a blank side but not an entirely missing movement value', () => {
  const split = {
    ...mapping,
    mode: 'split' as const,
    amount: -1,
    debit: 2,
    credit: 3,
  };
  const file = fixture([
    ['2026-07-01', 'A', '1.234,50', ''],
    ['2026-07-02', 'B', '', '50,00'],
  ]);
  assert.equal(suggestFormats(file, split, 2).patch.numberFormat, 'comma');
  file.sheets[0].rows.push(['2026-07-03', 'C', '', '']);
  assert.equal(suggestFormats(file, split, 2).numberFormat.status, 'invalid');
});

test('no sample cutoff hides a late incompatible value or an oversized source', () => {
  const rows = Array.from({ length: 1500 }, () => [
    '13/07/2026',
    'A',
    '1234.56',
  ]);
  rows.push(['07/13/2026', 'B', '1234,56']);
  const result = suggestFormats(fixture(rows), mapping, 2);
  assert.equal(result.dateFormat.status, 'invalid');
  assert.equal(result.numberFormat.status, 'invalid');
  assert.equal(result.dateFormat.checkedValues, 1501);
  const huge = fixture(
    Array.from({ length: MAX_ROWS + 30 }, () => ['2026-07-01', 'A', '10']),
  );
  assert.equal(suggestFormats(huge, mapping, 2).numberFormat.status, 'invalid');
});

test('existing entered balances participate in proof and missing mappings stay unavailable', () => {
  const file = fixture([['2026-07-01', 'A', '1.23']]);
  assert.equal(
    suggestFormats(file, { ...mapping, opening: '1,23' }, 2).numberFormat
      .status,
    'invalid',
  );
  const missing = suggestFormats(file, defaultMapping(), 2);
  assert.deepEqual(missing.patch, {});
  assert.equal(missing.numberFormat.status, 'unavailable');
  assert.equal(missing.dateFormat.status, 'unavailable');
  assert.equal(
    suggestFormats(fixture([]), mapping, 2).dateFormat.status,
    'unavailable',
  );
});
