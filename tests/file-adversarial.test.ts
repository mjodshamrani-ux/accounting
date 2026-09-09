import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import { demoScope } from '../lib/reconciliation/demo.ts';
async function imported(format: string, value = 100, column = 3) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic');
  sheet.addRow(['date', 'reference', 'amount']);
  sheet.addRow(['2026-08-01', 'INV-100', 100]);
  sheet.getCell(2, column).value = value;
  sheet.getCell(2, column).numFmt = format;
  const raw = await workbook.xlsx.writeBuffer();
  const file = await readFile('synthetic.xlsx', new Uint8Array(raw).buffer);
  return normalizeSource(
    file,
    { ...defaultMapping(), date: 0, reference: 1, amount: 2 },
    { ...demoScope, confirmed: true, coverageConfirmed: false },
    'supplier',
  );
}
test('Excel formats that conceal or alter displayed values block the row', async () => {
  for (const [format, value, column] of [
    ['-0.00', 100, 3],
    ['0.00;0.00', -100, 3],
    ['0,', 1000, 3],
    ['"INV-"000', 104, 2],
    ['0.0%', 0.1, 2],
    [';;;', 100, 3],
    ['[>100]0;"zero"', 100, 3],
    ['0" CR"', 100, 3],
  ] as const)
    assert.ok((await imported(format, value, column)).errors.length, format);
});
test('ordinary numeric, negative and accounting formats retain native exact amounts', async () => {
  for (const format of [
    'General',
    '0',
    '0.00',
    '#,##0.00',
    '#,##0.00;[Red](#,##0.00)',
    '"SAR" #,##0.00;[Red]("SAR" #,##0.00)',
    '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
  ]) {
    for (const value of [100, -100]) {
      const result = await imported(format, value);
      assert.deepEqual(result.errors, [], format);
      assert.equal(result.transactions[0].amount, value * 100);
    }
  }
});

test('conditional numeric formatting cannot silently override the displayed sign', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic');
  sheet.addRow(['date', 'reference', 'amount']);
  sheet.addRow(['2026-08-01', 'INV-100', 100]);
  sheet.addConditionalFormatting({
    ref: 'C2',
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: ['TRUE'],
        style: { numFmt: '-0.00' },
      },
    ],
  });
  const raw = await workbook.xlsx.writeBuffer();
  const file = await readFile('conditional.xlsx', new Uint8Array(raw).buffer);
  const result = normalizeSource(
    file,
    { ...defaultMapping(), date: 0, reference: 1, amount: 2 },
    { ...demoScope, confirmed: true, coverageConfirmed: false },
    'supplier',
  );
  assert.ok(result.errors.some((error) => error.message.includes('شرطي')));
});
