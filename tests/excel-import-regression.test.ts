import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping, MAX_SHEETS } from '../lib/reconciliation/types.ts';
import { demoScope } from '../lib/reconciliation/demo.ts';

const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
const scope = { ...demoScope, confirmed: true, coverageConfirmed: false };
async function parse(edit: (sheet: ExcelJS.Worksheet) => void) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transactions');
  sheet.addRow(['date', 'reference', 'amount', 'helper']);
  sheet.addRow(['2026-08-01', 'INV-100', 100, '']);
  sheet.addRow(['2026-08-02', 'INV-101', -25, '']);
  edit(sheet);
  return readFile(
    'synthetic.xlsx',
    new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
  );
}

test('unused percentage, hidden-sign format, formulas, errors and merged notes do not invalidate mapped transactions', async () => {
  const variants: ((sheet: ExcelJS.Worksheet) => void)[] = [
    (sheet) => {
      sheet.getCell('D2').value = 0.15;
      sheet.getCell('D2').numFmt = '0%';
    },
    (sheet) => {
      sheet.getCell('D2').value = 100;
      sheet.getCell('D2').numFmt = ';;;';
    },
    (sheet) => {
      sheet.getCell('D2').value = { formula: 'C2', result: 100 };
    },
    (sheet) => {
      sheet.getCell('D2').value = { error: '#DIV/0!' };
    },
    (sheet) => {
      sheet.mergeCells('D2:D3');
      sheet.getCell('D2').value = 'Notes';
    },
    (sheet) => {
      sheet.getCell('D2').value = 1234567890123456;
    },
  ];
  for (const edit of variants) {
    const file = await parse(edit);
    assert.ok(Object.keys(file.sheets[0].cellIssues ?? {}).length);
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.transactions.map((row) => row.amount),
      [10000, -2500],
    );
    assert.equal(result.total, 7500);
    const selected = normalizeSource(
      file,
      { ...mapping, description: 3 },
      scope,
      'supplier',
    );
    assert.ok(
      selected.errors.length,
      'Selecting the problematic helper must require review',
    );
  }
});

test('formula in mapped amount still blocks cached values and names its exact cell', async () => {
  const file = await parse((sheet) => {
    sheet.getCell('C2').value = { formula: '999+1', result: 100 };
  });
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /C2/);
  assert.equal(result.transactions.length, 1);
});

test('uncached formulas cannot disappear as an empty data row', async () => {
  const file = await parse((sheet) => {
    sheet.getRow(2).values = [
      { formula: 'A3' },
      { formula: 'B3' },
      { formula: 'C3' },
    ];
  });
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 2);
  assert.match(result.errors[0].message, /صيغة/);
  assert.ok(!result.excluded.some((row) => row.row === 2));
  const excluded = normalizeSource(
    file,
    { ...mapping, excluded: { '2': 'Intentional formula footer reviewed' } },
    scope,
    'supplier',
  );
  assert.deepEqual(excluded.errors, []);
});

test('displayed numeric references cannot silently collapse to a different raw identifier', async () => {
  for (const [format, conditional] of [
    ['#0000', false],
    ['0000.00', false],
    ['#,##0', false],
    ['0000', true],
  ] as const) {
    const file = await parse((sheet) => {
      sheet.getCell('B2').value = 12;
      if (conditional)
        sheet.addConditionalFormatting({
          ref: 'B2',
          rules: [
            {
              type: 'expression',
              priority: 1,
              formulae: ['TRUE'],
              style: { numFmt: format },
            },
          ],
        });
      else sheet.getCell('B2').numFmt = format;
    });
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.equal(result.errors.length, 1, format);
    assert.match(result.errors[0].message, /B2/);
  }
  const file = await parse((sheet) => {
    sheet.getCell('B2').value = 12;
    sheet.getCell('B2').numFmt = '0000';
  });
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].reference, '0012');
});

test('text formats hiding a mapped reference require review; unrelated text formats remain usable', async () => {
  for (const format of [';;;', '0;0;0;"Other"', '0;0;0;"INV-"@']) {
    const file = await parse((sheet) => {
      sheet.getCell('B2').numFmt = format;
    });
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /B2/);
    assert.deepEqual(
      normalizeSource(file, { ...mapping, reference: -1 }, scope, 'supplier')
        .errors,
      [],
    );
  }
});

test('conditional numeric formats are checked only in their affected ranges and selected columns', async () => {
  for (const [ref, expectedRows] of [
    ['D2:D3', []],
    ['$C$3', [3]],
    ['C2:C3', [2, 3]],
    ['C2 D3', [2]],
    ['D:D', []],
    ['C:C', [2, 3]],
    ['3:3', [3]],
    ['C1', []],
    ['C10:C12', []],
  ] as const) {
    const file = await parse((sheet) => {
      sheet.getCell('D2').value = 50;
      sheet.addConditionalFormatting({
        ref,
        rules: [
          {
            type: 'expression',
            priority: 1,
            formulae: ['TRUE'],
            style: { numFmt: ';;;' },
          },
        ],
      });
    });
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.deepEqual(
      result.errors.map((row) => row.row),
      [...expectedRows],
      ref,
    );
    for (const error of result.errors) assert.match(error.message, /شرطي/);
  }
});

test('ordinary conditional accounting formats retain values without evaluating Excel expressions', async () => {
  const file = await parse((sheet) =>
    sheet.addConditionalFormatting({
      ref: 'C2:C3',
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: ['TRUE'],
          style: { numFmt: '#,##0.00;[Red](#,##0.00)' },
        },
      ],
    }),
  );
  const result = normalizeSource(file, mapping, scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((row) => row.amount),
    [10000, -2500],
  );
});

test('multisheet workbooks are admitted through the declared sheet limit and fail beyond it', async () => {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < MAX_SHEETS; index++)
    workbook.addWorksheet(`Sheet ${index}`).addRow(['Notes']);
  const accepted = await readFile(
    'synthetic.xlsx',
    new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
  );
  assert.equal(accepted.sheets.length, MAX_SHEETS);
  workbook.addWorksheet('Beyond limit');
  await assert.rejects(
    readFile(
      'synthetic.xlsx',
      new Uint8Array(await workbook.xlsx.writeBuffer()).buffer,
    ),
    /40 ورقة/,
  );
});
