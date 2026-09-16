import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  inferMapping,
  normalizeSource,
  compare,
} from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { inferScopeSuggestions } from '../lib/reconciliation/scope-inference.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import type { SourceFile, Scope } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Audit supplier',
  entity: 'Audit buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2028-02-29',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const source = (rows: string[][]): SourceFile => ({
  name: 'independent-layout.csv',
  sheets: [{ name: 'Transactions', rows, hiddenRows: [], formulaRows: [] }],
});

test('a richer later header cannot silently erase an earlier transaction table', () => {
  const file = source([
    ['Date', 'Reference', 'Amount'],
    ['2028-02-13', 'AUD-9001', '125.50'],
    ['Date', 'Reference', 'Amount', 'Description', 'Currency'],
    ['2028-02-14', 'AUD-9002', '40.00', 'second table', 'SAR'],
  ]);
  const mapping = inferMapping(file);
  assert.equal(
    mapping.header,
    0,
    'select first complete table, not the later higher score',
  );
  const normalized = normalizeSource(file, mapping, scope, 'supplier');
  assert.ok(normalized.transactions.some((t) => t.reference === 'AUD-9001'));
  assert.ok(
    normalized.errors.length,
    'incompatible second table must need review',
  );
  assert.equal(
    compare(normalized, normalizeSource(file, mapping, scope, 'ledger'), scope)
      .matches.length,
    0,
  );
  for (const unknownAmount of [
    'Debit',
    'Invoice Amount',
    'Amount (SAR) / المبلغ (USD)',
  ]) {
    const ambiguous = source([
      ['Date', 'Reference', unknownAmount],
      ['2028-02-13', 'EARLY-100', '100'],
      ['Date', 'Reference', 'Amount'],
      ['2028-02-14', 'LATER-100', '75'],
    ]);
    const inferred = inferMapping(ambiguous);
    assert.equal(
      inferred.header,
      0,
      'an unresolved first table cannot disappear behind a familiar second table',
    );
    assert.throws(
      () => normalizeSource(ambiguous, inferred, scope, 'supplier'),
      /حدد أعمدة/,
    );
  }
});

test('explicit multiline and bilingual labels map consistently without changing source text', () => {
  const file = source([
    [
      'Date / التاريخ',
      'Invoice\nNo.',
      'Amount (SAR) / المبلغ (SAR)',
      'Description | البيان',
    ],
    ['2028-02-13', 'AUD-9101', '125.50', 'one'],
  ]);
  const before = JSON.stringify(file);
  const mapping = inferMapping(file);
  assert.deepEqual(
    [mapping.date, mapping.reference, mapping.amount, mapping.description],
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    normalizeSource(file, mapping, scope, 'supplier').transactions.map((t) => [
      t.reference,
      t.amount,
    ]),
    [['AUD-9101', 12550]],
  );
  assert.equal(JSON.stringify(file), before);
});

test('long cover text does not prevent locating the first explicit table', () => {
  const file = source([
    ...Array.from({ length: 45 }, (_, i) => [`Statement note ${i + 1}`]),
    ['Date', 'Reference', 'Amount'],
    ['2028-02-13', 'AUD-9201', '125.50'],
  ]);
  assert.equal(inferMapping(file).header, 45);
  assert.equal(selectImportMapping(file, 'supplier').kind, 'unique-table');
});

test('conflicting bilingual money labels and duplicate amount columns stay unresolved', () => {
  for (const header of [
    ['Date', 'Reference', 'Amount (SAR) / المبلغ (USD)'],
    ['Date', 'Reference', 'Amount', 'المبلغ'],
    ['Date', 'Reference', 'Amount / Quantity'],
  ]) {
    const file = source([
      header,
      ['2028-02-13', 'AUD-9301', '125.50', '125.50'],
    ]);
    assert.equal(inferMapping(file).amount, -1);
  }
});

test('explicit bilingual currency tags prefill the actual currency', () => {
  const file = source([
    ['Date / التاريخ', 'Reference / المرجع', 'Amount (USD) / المبلغ (USD)'],
    ['2028-02-13', 'AUD-9351', '125.50'],
  ]);
  const mapping = inferMapping(file);
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).values.currency,
    'USD',
  );
  assert.throws(
    () => normalizeSource(file, mapping, scope, 'supplier'),
    /عملة عنوان/,
  );
});

test('currency inference ignores safe repeated headers and summary rows without hiding mixed currencies', () => {
  const file = source([
    ['Date', 'Reference', 'Amount', 'Currency'],
    ['2028-02-13', 'AUD-9401', '125.50', 'SAR'],
    ['Date', 'Reference', 'Amount', 'Currency'],
    ['2028-02-14', 'AUD-9402', '40.00', 'SAR'],
    ['Total', '', '165.50', ''],
  ]);
  const mapping = inferMapping(file);
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).values.currency,
    'SAR',
  );
  file.sheets[0].rows.push([
    'This statement is provided for accounting review only.',
  ]);
  file.sheets[0].cellIssues = { '6:1': ['خلية مدمجة في A6:D6'] };
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).values.currency,
    'SAR',
    'a merged plain-text footer is not a missing transaction currency',
  );
  file.sheets[0].hiddenRows.push(6);
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).values.currency,
    undefined,
    'hidden text remains unverified',
  );
  file.sheets[0].hiddenRows = [];
  file.sheets[0].rows[0].push('Running Balance');
  file.sheets[0].rows[2].push('Running Balance');
  file.sheets[0].rows[1].push('125.50');
  file.sheets[0].formulaRows = [2];
  file.sheets[0].cellIssues!['2:5'] = ['خلية صيغة في عمود مساعد'];
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).values.currency,
    'SAR',
    'an unselected helper formula does not invalidate a safe currency cell',
  );
  file.sheets[0].rows[3][3] = 'USD';
  assert.equal(
    inferScopeSuggestions([file, null], [mapping, mapping]).fields.currency
      .status,
    'conflict',
  );
});

test('384 independent CSV/XLSX layouts infer columns and retain the same signed economic records', async () => {
  // Expected minor units are literal business truth, not parsed from engine output.
  const expected = [
    ['AUD-9501', 12550],
    ['AUD-9502', -4025],
    ['AUD-9503', 875],
  ];
  const families = [
    ['Date', 'Reference', 'Amount', 'Description'],
    ['التاريخ', 'المرجع', 'المبلغ', 'البيان'],
    [
      'Date / التاريخ',
      'Reference / المرجع',
      'Amount / المبلغ',
      'Description / البيان',
    ],
    ['Document\nDate', 'Invoice\nNo.', 'Signed\nAmount', 'Particulars'],
  ];
  const permutations = (items: number[]): number[][] =>
    items.length
      ? items.flatMap((n, i) =>
          permutations(items.filter((_, j) => j !== i)).map((rest) => [
            n,
            ...rest,
          ]),
        )
      : [[]];
  let checked = 0;
  for (const extension of ['csv', 'xlsx'])
    for (const headers of families)
      for (const order of permutations([0, 1, 2, 3]))
        for (const european of [false, true]) {
          const delimiter = european ? ';' : ',';
          const amounts = european
            ? ['125,50', '(40,25)', '8,75']
            : ['125.50', '(40.25)', '8.75'];
          const rows = [
            ['Statement independently specified'],
            order.map((i) => headers[i]),
            ...amounts.map((amount, i) =>
              order.map(
                (j) =>
                  ['13/02/2028', `AUD-${9501 + i}`, amount, `Description ${i}`][
                    j
                  ],
              ),
            ),
          ];
          let bytes: ArrayBuffer;
          if (extension === 'csv') {
            const csv = rows
              .map((row) =>
                row
                  .map((c) => '"' + c.replace(/"/g, '""') + '"')
                  .join(delimiter),
              )
              .join('\r\n');
            bytes = new TextEncoder().encode(csv).buffer;
          } else {
            const workbook = new ExcelJS.Workbook();
            workbook
              .addWorksheet('Read me')
              .addRow(['Cover text with no accounting table']);
            workbook.addWorksheet('Transactions').addRows(rows);
            bytes = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
          }
          const file = await readFile(`independent-layout.${extension}`, bytes);
          let mapping = selectImportMapping(file, 'supplier').mapping;
          const formats = suggestFormats(file, mapping, 2);
          assert.equal(formats.dateFormat.status, 'proven');
          assert.equal(formats.numberFormat.status, 'proven');
          mapping = { ...mapping, ...formats.patch };
          const result = normalizeSource(file, mapping, scope, 'supplier');
          assert.deepEqual(result.errors, []);
          assert.deepEqual(
            result.transactions.map((t) => [t.reference, t.amount]),
            expected,
          );
          assert.equal(result.total, 9400);
          assert.equal(result.transactions.length, 3);
          checked++;
        }
  assert.equal(checked, 384);
});
