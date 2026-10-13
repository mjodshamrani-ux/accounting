import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import { prepareXlsxForExcelJs } from '../lib/reconciliation/xlsx-namespaces.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';

const relsPath = 'xl/_rels/workbook.xml.rels';
const bookPath = 'xl/workbook.xml';
const typesPath = '[Content_Types].xml';
async function source(
  names = ['Stock source'],
  edit?: (book: ExcelJS.Workbook) => void,
) {
  const book = new ExcelJS.Workbook();
  for (const [index, name] of names.entries())
    book.addWorksheet(name).addRows([
      ['Date', 'Reference', 'Amount'],
      ['2026-09-30', `000${index + 7}`, (index + 1) * 125],
    ]);
  edit?.(book);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
async function renamed(
  original: ArrayBuffer,
  parts: Record<string, string>,
  edit?: (zip: JSZip) => Promise<void>,
) {
  const zip = await JSZip.loadAsync(original);
  let rels = await zip.file(relsPath)!.async('string');
  let types = await zip.file(typesPath)!.async('string');
  // Fixture-only edits to real serialized packages. Financial values stay fixed.
  for (const [oldName, newName] of Object.entries(parts)) {
    const oldPath = `xl/worksheets/${oldName}`;
    const newPath = `xl/worksheets/${newName}`;
    zip.file(newPath, await zip.file(oldPath)!.async('uint8array'));
    zip.remove(oldPath);
    const oldRels = `xl/worksheets/_rels/${oldName}.rels`;
    if (zip.file(oldRels)) {
      zip.file(
        `xl/worksheets/_rels/${newName}.rels`,
        await zip.file(oldRels)!.async('uint8array'),
      );
      zip.remove(oldRels);
    }
    assert.ok(rels.includes(`worksheets/${oldName}`));
    rels = rels.replace(`worksheets/${oldName}`, `worksheets/${newName}`);
    types = types.replace(oldPath, newPath);
  }
  zip.file(relsPath, rels);
  zip.file(typesPath, types);
  await edit?.(zip);
  return zip.generateAsync({ type: 'arraybuffer' });
}
async function check(
  original: ArrayBuffer,
  names: string[],
  amounts = names.map((_, i) => String((i + 1) * 125)),
) {
  const file = await readFile('synthetic.xlsx', original);
  assert.deepEqual(
    file.sheets.map((s) => s.name),
    names,
  );
  assert.deepEqual(
    file.sheets.map((s) => s.rows[1][2]),
    amounts,
  );
  assert.deepEqual(
    file.original,
    original,
    'internal compatibility never replaces the original',
  );
  assert.equal(
    file.sha256,
    createHash('sha256').update(new Uint8Array(original)).digest('hex'),
  );
  return file;
}

void test('a valid custom worksheet part is read completely rather than treated as an empty workbook', async () => {
  const original = await renamed(await source(), {
    'sheet1.xml': 'report.xml',
  });
  const raw = new ExcelJS.Workbook();
  await raw.xlsx.load(original);
  assert.equal(
    raw.worksheets.length,
    0,
    'direct ExcelJS witnesses the loader limitation',
  );
  const file = await check(original, ['Stock source']);
  assert.equal(file.sheets[0].rows[1][1], '0007');
});

void test('mixed normal/custom worksheets retain both candidates and require an explicit source choice', async () => {
  const original = await renamed(await source(['First', 'Second']), {
    'sheet2.xml': 'stock.xml',
  });
  const raw = new ExcelJS.Workbook();
  await raw.xlsx.load(original);
  assert.equal(
    raw.worksheets.length,
    1,
    'unadapted loader silently drops the custom worksheet',
  );
  const file = await check(original, ['First', 'Second']);
  assert.equal(selectImportMapping(file, 'supplier').kind, 'choose-sheet');
});

void test('workbook order and sheetId remain independent from part names and relationship order', async () => {
  const original = await renamed(
    await source(['First', 'Second']),
    { 'sheet1.xml': 'register.xml', 'sheet2.xml': 'general-ledger.xml' },
    async (zip) => {
      const book = await zip.file(bookPath)!.async('string');
      const sheets = book.match(/<sheet\s[^>]*\/>/g)!;
      assert.equal(sheets.length, 2);
      zip.file(
        bookPath,
        book
          .replace(sheets[0], '@FIRST@')
          .replace(sheets[1], sheets[0].replace('sheetId="1"', 'sheetId="74"'))
          .replace(
            '@FIRST@',
            sheets[1].replace('sheetId="2"', 'sheetId="103"'),
          ),
      );
      const rels = await zip.file(relsPath)!.async('string');
      const nodes = rels.match(/<Relationship\s[^>]*\/>/g)!;
      zip.file(
        relsPath,
        rels.replace(nodes.join(''), [...nodes].reverse().join('')),
      );
    },
  );
  await check(original, ['Second', 'First'], ['250', '125']);
});

void test('validated relative and absolute relationship targets use the same source binding', async () => {
  for (const target of [
    './worksheets/report.xml',
    '/xl/worksheets/report.xml',
    'worksheets/../worksheets/report.xml',
  ]) {
    const original = await renamed(
      await source(),
      { 'sheet1.xml': 'report.xml' },
      async (zip) => {
        zip.file(
          relsPath,
          (await zip.file(relsPath)!.async('string')).replace(
            'Target="worksheets/report.xml"',
            `Target="${target}"`,
          ),
        );
      },
    );
    await check(original, ['Stock source']);
  }
});

void test('custom aliases preserve the companion relationship file without changing relative targets', async () => {
  const original = await renamed(
    await source(undefined, (book) => {
      book.worksheets[0].getCell('D2').value = {
        text: 'Synthetic document',
        hyperlink: 'https://example.invalid/document',
      };
    }),
    { 'sheet1.xml': 'report.xml' },
  );
  const adapted = await prepareXlsxForExcelJs(original);
  const zip = await JSZip.loadAsync(adapted);
  assert.equal(
    await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string'),
    await zip.file('xl/worksheets/_rels/report.xml.rels')!.async('string'),
  );
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(adapted);
  assert.deepEqual(loaded.worksheets[0].getCell('D2').value, {
    text: 'Synthetic document',
    hyperlink: 'https://example.invalid/document',
  });
  await check(original, ['Stock source']);
});

void test('hidden sheets, display restrictions and numeric lexeme faults retain the original worksheet identity', async () => {
  const original = await renamed(
    await source(['Visible', 'Hidden'], (book) => {
      book.worksheets[0].getCell('C2').numFmt = ';;;';
      book.worksheets[1].state = 'hidden';
    }),
    { 'sheet1.xml': 'visible.xml', 'sheet2.xml': 'auxiliary.xml' },
    async (zip) => {
      const path = 'xl/worksheets/auxiliary.xml';
      zip.file(
        path,
        (await zip.file(path)!.async('string')).replace(
          '<v>250</v>',
          '<v>250.000000000000001</v>',
        ),
      );
    },
  );
  const file = await readFile('synthetic.xlsx', original);
  assert.deepEqual(
    file.sheets.map((s) => s.name),
    ['Visible', 'Hidden'],
  );
  assert.ok(file.sheets[0].cellIssues?.['2:3']?.length);
  assert.ok(file.sheets[1].rowIssues?.['2']?.some((s) => /ورقة مخفية/.test(s)));
  assert.ok(
    file.sheets[1].cellIssues?.['2:3']?.some((s) =>
      /دقة|precision|رقمي|تقريب/.test(s),
    ),
  );
  assert.deepEqual(file.original, original);
});

void test('aliases cannot overwrite unreferenced recognized parts or companion relationship numbers', async () => {
  const original = await renamed(
    await source(),
    { 'sheet1.xml': 'report.xml' },
    async (zip) => {
      zip.file(
        'xl/worksheets/sheet1.xml',
        await zip.file('xl/worksheets/report.xml')!.async('uint8array'),
      );
      zip.file(
        'xl/worksheets/_rels/sheet2.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      );
    },
  );
  const zip = await JSZip.loadAsync(await prepareXlsxForExcelJs(original));
  assert.match(
    await zip.file(relsPath)!.async('string'),
    /Target="worksheets\/sheet3.xml"/,
  );
  assert.equal(
    await zip.file('xl/worksheets/sheet1.xml')!.async('string'),
    await zip.file('xl/worksheets/report.xml')!.async('string'),
  );
  await check(original, ['Stock source']);
});

void test('ordinary packages stay byte-identical and custom compatibility is idempotent', async () => {
  const ordinary = await source();
  assert.equal(await prepareXlsxForExcelJs(ordinary), ordinary);
  const custom = await renamed(ordinary, { 'sheet1.xml': 'report.xml' });
  const adapted = await prepareXlsxForExcelJs(custom);
  assert.equal(await prepareXlsxForExcelJs(adapted), adapted);
});

void test('custom paths preserve whole-workbook rejection of missing, duplicate and unsupported bindings', async () => {
  const ordinary = await source(['First', 'Second']);
  for (const target of [
    'worksheets/report.xml',
    'worksheets/sheet1.xml',
    'other/report.xml',
  ]) {
    const zip = await JSZip.loadAsync(ordinary);
    zip.file(
      relsPath,
      (await zip.file(relsPath)!.async('string')).replace(
        'Target="worksheets/sheet2.xml"',
        `Target="${target}"`,
      ),
    );
    await assert.rejects(
      readFile(
        'synthetic.xlsx',
        await zip.generateAsync({ type: 'arraybuffer' }),
      ),
      /جزئي|مكرر/,
    );
  }
});

void test('worksheet bindings reject External and invalid TargetMode even with a matching local part', async () => {
  for (const part of ['sheet1.xml', 'report.xml']) {
    for (const mode of ['External', 'external', 'invalid', '']) {
      const original = await renamed(
        await source(),
        part === 'sheet1.xml' ? {} : { 'sheet1.xml': part },
        async (zip) => {
          const target = `Target="worksheets/${part}"`;
          zip.file(
            relsPath,
            (await zip.file(relsPath)!.async('string')).replace(
              target,
              `${target} TargetMode="${mode}"`,
            ),
          );
        },
      );
      await assert.rejects(
        readFile('synthetic.xlsx', original),
        /رابط ورقة Excel خارجي أو نمطه غير صالح/,
      );
    }
  }
});

void test('explicit Internal worksheet bindings preserve ordinary and custom source bytes', async () => {
  for (const part of ['sheet1.xml', 'report.xml']) {
    const original = await renamed(
      await source(),
      part === 'sheet1.xml' ? {} : { 'sheet1.xml': part },
      async (zip) => {
        const target = `Target="worksheets/${part}"`;
        zip.file(
          relsPath,
          (await zip.file(relsPath)!.async('string')).replace(
            target,
            `${target} TargetMode="Internal"`,
          ),
        );
      },
    );
    await check(original, ['Stock source']);
    if (part === 'sheet1.xml')
      assert.equal(await prepareXlsxForExcelJs(original), original);
  }
});
