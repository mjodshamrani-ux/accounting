import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Mapping, Scope } from '../lib/reconciliation/types.ts';

const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
};
const scope: Scope = {
  supplier: 'Independent Vendor',
  entity: 'Independent Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-12-31',
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const worksheetPath = 'xl/worksheets/sheet1.xml';
async function workbook(
  edit?: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void,
) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Ledger Data');
  sheet.addRows([
    ['Date', 'Reference', 'Amount', 'Notes'],
    [
      new Date('2026-10-15T00:00:00Z'),
      'DOC-771',
      123.45,
      'Independent invoice',
    ],
    [
      new Date('2026-10-16T00:00:00Z'),
      'CREDIT-772',
      -12.34,
      'Independent credit',
    ],
  ]);
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(3).numFmt = '#,##0.00;[Red](#,##0.00)';
  edit?.(sheet, book);
  return new Uint8Array(await book.xlsx.writeBuffer({ useSharedStrings: true }))
    .buffer;
}
async function mutate(
  original: ArrayBuffer,
  transform: (xml: string) => string,
) {
  const zip = await JSZip.loadAsync(original);
  zip.file(
    worksheetPath,
    transform(await zip.file(worksheetPath)!.async('string')),
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}
const normalize = (
  file: Awaited<ReturnType<typeof readFile>>,
  m = mapping,
  s = scope,
) => normalizeSource(file, m, s, 'supplier');

test('numeric XML must be a whole valid number, never a parseFloat prefix', async () => {
  const original = await workbook();
  for (const raw of [
    '123.45BAD',
    '123,45',
    '1,234.50',
    '12 34',
    '123e',
    'NaN',
    'Infinity',
    '1e309',
  ]) {
    await assert.rejects(
      readFile(
        'independent.xlsx',
        await mutate(original, (xml) =>
          xml.replace('<v>123.45</v>', `<v>${raw}</v>`),
        ),
      ),
      /قيمة رقمية غير صالحة/,
      raw,
    );
  }
});

test('equivalent valid numeric spellings are retained exactly without locale guesses', async () => {
  const original = await workbook();
  for (const raw of [
    '+123.4500',
    '1.2345e2',
    '123450E-3',
    '000123.45',
    ' 123.45 ',
  ]) {
    const file = await readFile(
      'independent.xlsx',
      await mutate(original, (xml) =>
        xml.replace('<v>123.45</v>', `<v>${raw}</v>`),
      ),
    );
    const result = normalize(file, { ...mapping, numberFormat: 'comma' });
    assert.deepEqual(result.errors, [], raw);
    assert.deepEqual(
      result.transactions.map((t) => t.amount),
      [12345, -1234],
      raw,
    );
  }
});

test('duplicate cells, duplicate rows and coordinate conflicts cannot overwrite source transactions', async () => {
  const original = await workbook();
  const edits = [
    (xml: string) =>
      xml.replace(/(<c r="C2"[^>]*>.*?<\/c>)/, '$1<c r="C2"><v>9</v></c>'),
    (xml: string) =>
      xml.replace(/(<c r="C2"[^>]*>.*?<\/c>)/, '$1<c r="C02"><v>9</v></c>'),
    (xml: string) =>
      xml.replace(
        '</sheetData>',
        xml.match(/<row r="2"[^>]*>.*?<\/row>/)![0].replace('123.45', '9') +
          '</sheetData>',
      ),
    (xml: string) =>
      xml.replace(
        '</sheetData>',
        xml.match(/<row r="2"[^>]*>.*?<\/row>/)![0].replace('r="2"', 'r="02"') +
          '</sheetData>',
      ),
    (xml: string) => xml.replace('r="C2"', 'r="C3"'),
    (xml: string) => xml.replace('<v>123.45</v>', '<v>123.45</v><v>9</v>'),
  ];
  for (const edit of edits)
    await assert.rejects(
      readFile('independent.xlsx', await mutate(original, edit)),
      /مكرر|مكررة|لا يطابق|أكثر من قيمة/,
    );
});

test('precision lost by Number conversion becomes a cell issue, never an apparently exact financial amount', async () => {
  const original = await workbook();
  for (const raw of [
    '123.4500000000000001',
    '123.4499999999999999',
    '9007199254740.991',
    '0.100000000000000001',
  ]) {
    const file = await readFile(
      'independent.xlsx',
      await mutate(original, (xml) =>
        xml.replace('<v>123.45</v>', `<v>${raw}</v>`),
      ),
    );
    const result = normalize(file);
    assert.deepEqual(
      result.transactions.map((t) => t.amount),
      [-1234],
    );
    assert.equal(result.errors.length, 1, raw);
    assert.match(result.errors[0].message, /دقة القيمة الأصلية في C2/, raw);
    assert.equal(
      suggestFormats(file, mapping, 2).numberFormat.status,
      'invalid',
    );
  }
});

test('precision observations use workbook relationships and only block selected cells', async () => {
  let bytes = await workbook((sheet) => {
    sheet.getCell('D2').value = 123.45;
  });
  bytes = await mutate(bytes, (xml) =>
    xml.replace(/(<c r="D2"[^>]*><v>)123\.45/, '$1123.4500000000000001'),
  );
  const zip = await JSZip.loadAsync(bytes);
  zip.file(
    'xl/workbook.xml',
    (await zip.file('xl/workbook.xml')!.async('string')).replace(
      'sheetId="1"',
      'sheetId="74"',
    ),
  );
  bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const file = await readFile('independent.xlsx', bytes);
  assert.ok(file.sheets[0].cellIssues?.['2:4']);
  assert.deepEqual(normalize(file).errors, []);
  assert.deepEqual(
    normalize(file).transactions.map((t) => t.amount),
    [12345, -1234],
  );
  assert.match(
    normalize(file, { ...mapping, amount: 3 }).errors[0].message,
    /دقة القيمة الأصلية في D2/,
  );
  assert.deepEqual(new Uint8Array(file.original!), new Uint8Array(bytes));
});

test('rich text and hyperlink display text obey the same mapped-cell visibility rules as plain strings', async () => {
  for (const kind of ['plain', 'rich', 'hyperlink'] as const) {
    for (const format of [';;;', '0;0;0;"999"', '0;0;0;"INV-"@']) {
      const file = await readFile(
        'independent.xlsx',
        await workbook((sheet) => {
          sheet.getCell('C2').value =
            kind === 'plain'
              ? '123.45'
              : kind === 'rich'
                ? { richText: [{ text: '123' }, { text: '.45' }] }
                : {
                    text: '123.45',
                    hyperlink: 'https://example.invalid/inert',
                  };
          sheet.getCell('C2').numFmt = format;
        }),
      );
      assert.equal(normalize(file).errors.length, 1, `${kind} ${format}`);
      assert.match(normalize(file).errors[0].message, /تنسيق النص في C2/);
    }
  }
});

test('ordinary rich text, hyperlinks, currency and accounting formats retain exact source values', async () => {
  for (const kind of ['plain', 'rich', 'hyperlink'] as const) {
    const file = await readFile(
      'independent.xlsx',
      await workbook((sheet) => {
        sheet.getCell('C2').value =
          kind === 'plain'
            ? '123.45'
            : kind === 'rich'
              ? { richText: [{ text: '123.45' }] }
              : { text: '123.45', hyperlink: 'https://example.invalid/inert' };
        sheet.getCell('C2').numFmt = '#,##0.00;[Red](#,##0.00);"-";@';
      }),
    );
    assert.deepEqual(normalize(file).errors, []);
    assert.deepEqual(
      normalize(file).transactions.map((t) => t.amount),
      [12345, -1234],
    );
  }
  for (const format of [
    'General',
    '#,##0.00;[Red](#,##0.00)',
    '"SAR" #,##0.00;"SAR" (#,##0.00)',
    '[$ر.س.-401] #,##0.00;[$ر.س.-401] (#,##0.00)',
  ]) {
    const file = await readFile(
      'independent.xlsx',
      await workbook((sheet) => {
        sheet.getColumn(3).numFmt = format;
      }),
    );
    assert.deepEqual(normalize(file).errors, [], format);
    assert.deepEqual(
      normalize(file).transactions.map((t) => t.amount),
      [12345, -1234],
      format,
    );
  }
});

test('seeded independent minor-unit oracle survives both Excel date epochs and all supported precisions', async () => {
  let seed = 92731;
  const minors = Array.from({ length: 64 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed % 10000000) - 5000000;
  });
  for (const date1904 of [false, true])
    for (const decimals of [0, 2, 3]) {
      const book = new ExcelJS.Workbook();
      book.properties.date1904 = date1904;
      const sheet = book.addWorksheet('Epoch Oracle');
      sheet.addRow(['Date', 'Reference', 'Amount']);
      minors.forEach((minor, i) =>
        sheet.addRow([
          new Date(
            `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`,
          ),
          `NATIVE-${i + 500}`,
          minor / 10 ** decimals,
        ]),
      );
      sheet.getColumn(1).numFmt = 'yyyy-mm-dd';
      sheet.getColumn(3).numFmt = decimals
        ? '#,##0.' +
          '0'.repeat(decimals) +
          ';[Red](#,##0.' +
          '0'.repeat(decimals) +
          ')'
        : '#,##0;[Red](#,##0)';
      const file = await readFile(
        'independent.xlsx',
        new Uint8Array(await book.xlsx.writeBuffer()).buffer,
      );
      const adjustedScope = {
        ...scope,
        decimals,
        currency: decimals === 0 ? 'JPY' : decimals === 2 ? 'SAR' : 'KWD',
      };
      const formats = suggestFormats(
        file,
        { ...mapping, numberFormat: 'comma' },
        decimals,
      );
      assert.equal(formats.dateFormat.status, 'proven');
      assert.equal(formats.numberFormat.status, 'proven');
      const result = normalize(
        file,
        { ...mapping, ...formats.patch },
        adjustedScope,
      );
      assert.deepEqual(result.errors, []);
      assert.deepEqual(
        result.transactions.map((t) => t.amount),
        minors,
      );
      assert.deepEqual(
        result.transactions.map((t) => t.date),
        minors.map(
          (_, i) => `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`,
        ),
      );
      assert.equal(new Set(result.transactions.map((t) => t.id)).size, 64);
      assert.equal(
        result.total,
        minors.reduce((a, b) => a + b, 0),
      );
    }
});

test('repeated safe page headers do not make proven Excel formats ambiguous or invalid', async () => {
  const file = await readFile(
    'independent.xlsx',
    await workbook((sheet) => {
      sheet.spliceRows(3, 0, ['Date', 'Reference', 'Amount', 'Notes']);
    }),
  );
  const formats = suggestFormats(file, mapping, 2);
  assert.equal(formats.dateFormat.status, 'proven');
  assert.equal(formats.numberFormat.status, 'proven');
  assert.equal(formats.dateFormat.checkedValues, 2);
  assert.deepEqual(
    normalize(file).transactions.map((t) => t.amount),
    [12345, -1234],
  );
  assert.match(
    normalize(file).excluded.find((r) => r.row === 3)!.reason,
    /عناوين مُكرر/,
  );
});

test('untrusted or hidden repeated headers cannot be used to prove input formats', async () => {
  for (const mode of ['formula', 'hidden', 'row-issue', 'reference-issue']) {
    const file = await readFile(
      'independent.xlsx',
      await workbook((sheet) => {
        sheet.spliceRows(3, 0, ['Date', 'Reference', 'Amount', 'Notes']);
      }),
    );
    if (mode === 'formula') {
      file.sheets[0].formulaRows.push(3);
      file.sheets[0].cellIssues!['3:3'] = ['صيغة Excel في C3؛ قيمة غير مثبتة'];
    }
    if (mode === 'hidden') file.sheets[0].hiddenRows.push(3);
    if (mode === 'row-issue')
      file.sheets[0].rowIssues = { '3': ['Unread cell geometry'] };
    if (mode === 'reference-issue')
      file.sheets[0].referenceIssues!['3:2'] = [
        'Ambiguous displayed reference',
      ];
    assert.equal(
      suggestFormats(file, mapping, 2).numberFormat.status,
      'invalid',
      mode,
    );
  }
});

test('shared-string indices cannot be truncated into another source value', async () => {
  const original = await workbook();
  for (const suffix of ['BAD', '.5', 'e1']) {
    await assert.rejects(
      readFile(
        'independent.xlsx',
        await mutate(original, (xml) =>
          xml.replace(/(<c r="B2"[^>]*><v>)(\d+)(<\/v>)/, `$1$2${suffix}$3`),
        ),
      ),
      /فهرس نص Excel غير صالح/,
    );
  }
});

test('implicit next-column addresses remain supported but cannot conceal a duplicate cell', async () => {
  const original = await workbook();
  const omitted = await mutate(original, (xml) => xml.replace('r="C2"', ''));
  assert.deepEqual(
    normalize(await readFile('independent.xlsx', omitted)).transactions.map(
      (t) => t.amount,
    ),
    [12345, -1234],
  );
  const duplicate = await mutate(omitted, (xml) =>
    xml.replace(
      /(<c  s="\d+"><v>123\.45<\/v><\/c>)/,
      '$1<c r="C2"><v>9</v></c>',
    ),
  );
  assert.notDeepEqual(new Uint8Array(duplicate), new Uint8Array(omitted));
  await assert.rejects(
    readFile('independent.xlsx', duplicate),
    /خلية Excel مكررة/,
  );
});

test('native ISO date cells retain their lexical dates and can never become year-sized amounts', async () => {
  const original = await workbook();
  const dated = await mutate(original, (xml) =>
    xml.replace(
      /<c r="A2"[^>]*>.*?<\/c>/,
      '<c r="A2" t="d"><v>2026-10-15</v></c>',
    ),
  );
  const datedFile = await readFile('independent.xlsx', dated);
  assert.deepEqual(normalize(datedFile).errors, []);
  assert.equal(normalize(datedFile).transactions[0].date, '2026-10-15');
  for (const raw of ['2026-10-15', '2026-10-15T00:00:00Z']) {
    const misplaced = await mutate(original, (xml) =>
      xml.replace(
        /<c r="C2"[^>]*>.*?<\/c>/,
        `<c r="C2" t="d"><v>${raw}</v></c>`,
      ),
    );
    const file = await readFile('independent.xlsx', misplaced);
    assert.equal(file.sheets[0].rows[1][2], raw);
    assert.deepEqual(
      normalize(file).transactions.map((t) => t.amount),
      [-1234],
    );
    assert.equal(normalize(file).errors.length, 1);
  }
});
