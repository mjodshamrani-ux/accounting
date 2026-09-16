import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import { currencyPrecision } from '../lib/reconciliation/currency-precision.ts';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { inferScopeSuggestions } from '../lib/reconciliation/scope-inference.ts';
import { inferMapping } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { syntheticStyledPdf } from './helpers/styled-pdf-fixture.ts';
const unnamed = {
  ...demoScope,
  supplier: '',
  entity: '',
  account: '',
  confirmed: true,
  coverageConfirmed: false,
};
const run = (scope = unnamed) =>
  compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
test('transaction comparison needs verified scope but not optional descriptive names', async () => {
  const result = run();
  assert.equal(result.matches.length, 2);
  assert.equal(result.balanceComparable, false);
  assert.equal(result.bridge?.residual, 0);
  assert.equal(result.balanceComparable, false);
  assert.equal(
    result.supplier.balanceArithmeticStatus,
    'BALANCE_ARITHMETIC_VERIFIED',
  );
  assert.equal(result.supplier.coverageStatus, 'PERIOD_COVERAGE_UNCONFIRMED');
  assert.throws(() => run({ ...unnamed, confirmed: false }));
  assert.throws(() => run({ ...unnamed, currency: '' }));
  assert.throws(() => run({ ...unnamed, coverageConfirmed: true }));
  const bytes = await exportWorkbook(result, demoFiles, {
    checked: false,
    name: '',
    notes: '',
  });
  assert.ok(bytes.byteLength > 1000);
});
test('known currency precision is explicit and unknown currencies are not assigned two decimals', () => {
  assert.equal(currencyPrecision('SAR'), 2);
  assert.equal(currencyPrecision('KWD'), 3);
  assert.equal(currencyPrecision('JPY'), 0);
  assert.equal(currencyPrecision('ZZZ'), undefined);
  assert.equal(currencyPrecision('constructor'), undefined);
});
test('currency precision changes the ambiguity assessment, not the transaction value', () => {
  const file = {
    name: 'synthetic.csv',
    sheets: [
      {
        name: 'CSV',
        rows: [
          ['date', 'reference', 'amount'],
          ['2026-06-01', 'SYN-3', '1.234'],
        ],
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  const m = inferMapping(file);
  assert.equal(suggestFormats(file, m, 3).numberFormat.status, 'ambiguous');
  assert.equal(suggestFormats(file, m, 2).numberFormat.status, 'proven');
});
test('PDF automatic column suggestions retain required human review and original row provenance', async () => {
  const file = await readFile(
    'synthetic.pdf',
    syntheticStyledPdf(),
    undefined,
    true,
  );
  assert.equal(file.pdf?.autoColumns, true);
  assert.equal(file.pdf?.cuts.length, 2);
  const map = inferMapping(file);
  assert.equal(map.header, 1);
  assert.equal(map.pdfReviewed, undefined);
  assert.throws(() => normalizeSource(file, map, unnamed, 'supplier'), /PDF/);
  const result = normalizeSource(
    file,
    { ...map, pdfReviewed: true },
    unnamed,
    'supplier',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, 110000);
  const reread = await readFile(file.name, file.original!, file.pdf?.cuts);
  assert.deepEqual(reread.sheets, file.sheets);
});
test('transaction column spans do not invalidate intact labeled PDF metadata; other parsing issues do', () => {
  const file = {
    name: 'synthetic.pdf',
    pdf: { cuts: [25, 45], pages: 1 },
    sheets: [
      {
        name: 'PDF',
        rows: [
          ['Supplier', 'Synthetic Long Supplier', ''],
          ['Customer A/C', '0009', ''],
          ['date', 'reference', 'amount'],
          ['2026-06-01', 'SYN-3', '100'],
        ],
        formulaRows: [],
        hiddenRows: [],
        rowIssues: {
          '1': [
            'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع',
          ],
        },
      },
    ],
  };
  const map = inferMapping(file);
  let info = inferScopeSuggestions([file, null], [map, defaultMapping()]);
  assert.equal(info.values.supplier, 'Synthetic Long Supplier');
  assert.equal(info.values.account, '0009');
  file.sheets[0].rowIssues['1'] = ['نصوص متراكبة؛ لا يمكن إثبات القراءة'];
  info = inferScopeSuggestions([file, null], [map, defaultMapping()]);
  assert.equal(info.values.supplier, undefined);
});
