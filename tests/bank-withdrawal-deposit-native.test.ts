import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import { assertBankNativeDisplay } from '../lib/reconciliation/bank-native-display.ts';
import { reconcileBank, type BankInput } from '../lib/reconciliation/bank.ts';
import { replayBank } from '../lib/reconciliation/bank-io.ts';
import { wdFixture } from './bank-wd-fixtures.ts';

async function native(
  input: BankInput,
  edit?: (book: ExcelJS.Workbook, side: number) => void,
) {
  const files = [];
  for (const [side, f] of input.files.entries()) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Movements'),
      headers = f.sheets[0].rows[0];
    for (const [i, row] of f.sheets[0].rows.entries())
      sheet.addRow(
        row.map((v, c) => {
          if (!i || !v) return v;
          if (['Amount', 'Withdrawal', 'Deposit'].includes(headers[c]))
            return Number(v);
          if (
            [
              'Movement date',
              'Value date',
              'Period start',
              'Period end',
            ].includes(headers[c])
          )
            return new Date(`${v}T00:00:00.000Z`);
          return v;
        }),
      );
    edit?.(book, side);
    files.push(
      await readFile(
        `native-${side}.xlsx`,
        new Uint8Array(await book.xlsx.writeBuffer()).buffer,
      ),
    );
  }
  return { ...input, files: files as BankInput['files'] };
}

void test('WD native: General preserves SAR/JPY/KWD exact amounts and supported native dates', async () => {
  for (const [name, decimals, minor] of [
    ['01-bank-wd-cash-canonical', 2, -12540],
    ['07-jpy-whole', 0, -125],
    ['08-kwd-three', 3, 1234],
  ] as const) {
    const { input } = await wdFixture(name),
      state = await native(input);
    for (const file of state.files)
      await assertBankNativeDisplay(file, 'BANK_NATIVE_DISPLAY', {
        strictMovementDisplay: true,
        decimals,
      });
    const result = reconcileBank(state);
    assert.equal(result.status, 'movements-consistent', name);
    assert.equal(result.records[0].signed, minor, name);
    assert.equal(result.records[0].movementDate, '2026-09-15');
    const evidence = result.records.find(
      (r) => r.withdrawalDeposit,
    )!.withdrawalDeposit!;
    assert.ok([evidence.withdrawal, evidence.deposit].some((c) => c.numeric));
  }
});

void test('WD native: hidden precision on either money cell or canonical peer is rejected; legacy display contract stays unchanged', async () => {
  const { input } = await wdFixture('08-kwd-three');
  for (const side of [0, 1]) {
    const state = await native(input, (book, current) => {
      if (current !== side) return;
      const sheet = book.worksheets[0],
        headers = sheet.getRow(1).values as string[];
      sheet.getCell(2, headers.indexOf(side ? 'Amount' : 'Deposit')).numFmt =
        '0.00';
    });
    await assertBankNativeDisplay(state.files[side]);
    await assert.rejects(
      assertBankNativeDisplay(state.files[side], 'BANK_NATIVE_DISPLAY', {
        strictMovementDisplay: true,
        decimals: 3,
      }),
      /BANK_NATIVE_DISPLAY/,
    );
    await assert.rejects(replayBank(state), /BANK_NATIVE_DISPLAY/);
  }
  const state = await native(input, (book, side) => {
    if (!side) {
      book.worksheets[0].getCell('P2').value = 0.001;
      book.worksheets[0].getCell('P2').numFmt = '0.00';
    }
  });
  await assert.rejects(
    assertBankNativeDisplay(state.files[0], 'BANK_NATIVE_DISPLAY', {
      strictMovementDisplay: true,
      decimals: 3,
    }),
    /BANK_NATIVE_DISPLAY/,
  );
});

async function reorderedNative(
  input: BankInput,
  side: 0 | 1,
  rounded: boolean,
) {
  const state = await native(input, (book, current) => {
    if (current !== side) return;
    const sheet = book.worksheets[0],
      headers = sheet.getRow(1).values as string[];
    if (rounded)
      sheet.getCell(2, headers.indexOf(side ? 'Amount' : 'Deposit')).numFmt =
        '0.00';
    book
      .addWorksheet('Decoy')
      .addRow(Array.from({ length: 17 }, (_, i) => `Unrelated column ${i}`));
  });
  const zip = await JSZip.loadAsync(state.files[side].original!),
    xml = await zip.file('xl/workbook.xml')!.async('string');
  zip.file(
    'xl/workbook.xml',
    xml.replace(
      /<sheets>(.*?)<\/sheets>/,
      (_all, sheets: string) =>
        `<sheets>${sheets
          .match(/<sheet [^>]*\/>/g)!
          .reverse()
          .join('')}</sheets>`,
    ),
  );
  state.files[side] = await readFile(
    `reordered-${side}.xlsx`,
    await zip.generateAsync({ type: 'arraybuffer' }),
  );
  state.readings = structuredClone(state.readings);
  state.readings[side].sheet = 1;
  assert.deepEqual(
    state.files[side].sheets.map((s) => s.name),
    ['Decoy', 'Movements'],
  );
  return state;
}

void test('WD-REVIEW-001: reordered workbook relationships bind exact General and reject rounded WD or canonical peer on actual replay', async () => {
  const { input } = await wdFixture('08-kwd-three');
  for (const side of [0, 1] as const) {
    const exact = await reorderedNative(input, side, false);
    await assert.doesNotReject(async () => {
      const replay = await replayBank(exact);
      assert.equal(replay.result.status, 'movements-consistent');
      assert.equal(
        replay.result.records.find((r) => r.side === side)!.amount,
        1234,
      );
      assert.equal(replay.result.sources[side].sheet, 'Movements');
    }, `reordered exact General control must be accepted on side ${side}`);
    const rounded = await reorderedNative(input, side, true);
    // The independently parsed cell still has 1.234. Only the display contract
    // can reject the visible 1.23, so this proves strict wiring through replay.
    assert.equal(reconcileBank(rounded).status, 'movements-consistent');
    await assert.rejects(replayBank(rounded), /BANK_NATIVE_DISPLAY/);
  }
});

void test('WD-REVIEW-001: missing, duplicate and reused worksheet relationships fail closed', async () => {
  const { input } = await wdFixture('08-kwd-three'),
    state = await reorderedNative(input, 0, false);
  for (const edit of [
    (xml: string) =>
      xml.replace(/<Relationship\b[^>]*\bType="[^"]*\/worksheet"[^>]*\/>/, ''),
    (xml: string) =>
      xml.replace(
        /(<Relationship\b[^>]*\bType="[^"]*\/worksheet"[^>]*\/>)/,
        '$1$1',
      ),
    (xml: string) =>
      xml.replace(
        /Target="worksheets\/sheet2.xml"/,
        'Target="worksheets/sheet1.xml"',
      ),
    (xml: string) =>
      xml.replace(
        /Target="worksheets\/sheet1.xml"/,
        'Target="https://example.invalid/sheet1.xml" TargetMode="External"',
      ),
  ]) {
    const zip = await JSZip.loadAsync(state.files[0].original!),
      relationships = await zip
        .file('xl/_rels/workbook.xml.rels')!
        .async('string'),
      edited = edit(relationships);
    assert.notEqual(edited, relationships);
    zip.file('xl/_rels/workbook.xml.rels', edited);
    const original = await zip.generateAsync({ type: 'arraybuffer' });
    await assert.rejects(
      assertBankNativeDisplay(
        { ...state.files[0], original },
        'BANK_NATIVE_DISPLAY',
        { strictMovementDisplay: true, decimals: 3 },
      ),
      /BANK_NATIVE_DISPLAY/,
    );
    await assert.rejects(async () => {
      const file = await readFile('broken-relationship.xlsx', original);
      await replayBank({ ...state, files: [file, state.files[1]] });
    });
  }
});

void test('WD native: date serial time and date formats in money or identity cannot supply an ISO date or visible identity', async () => {
  const { input } = await wdFixture();
  for (const edit of [
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('C2').value = new Date(
        '2026-09-15T12:00:00.000Z',
      );
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('A2').value = new Date(
        '2026-09-15T00:00:00.000Z',
      );
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('P2').numFmt = 'mm-dd-yy';
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('C2').value = 46280;
      book.worksheets[0].getCell('C2').numFmt = 'General';
    },
  ]) {
    const state = await native(input, (book, side) => {
      if (!side) edit(book);
    });
    await assert.rejects(
      assertBankNativeDisplay(state.files[0], 'BANK_NATIVE_DISPLAY', {
        strictMovementDisplay: true,
        decimals: 2,
      }),
      /BANK_NATIVE_DISPLAY/,
    );
  }
});

void test('WD native: rich text, hidden columns, merges and formula caches never become movement evidence', async () => {
  const { input } = await wdFixture();
  for (const edit of [
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('P2').value = {
        richText: [{ text: '125.40' }],
      };
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getColumn(16).hidden = true;
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].mergeCells('P2:Q2');
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('P2').value = {
        formula: '125.4',
        result: 125.4,
      };
    },
    (book: ExcelJS.Workbook) => {
      book.worksheets[0].getCell('A2').value = 125;
      book.worksheets[0].getCell('A2').numFmt = '0.00';
    },
  ]) {
    const state = await native(input, (book, side) => {
      if (!side) edit(book);
    });
    await assert.rejects(async () => {
      await assertBankNativeDisplay(state.files[0], 'BANK_NATIVE_DISPLAY', {
        strictMovementDisplay: true,
        decimals: 2,
      });
      const result = reconcileBank(state);
      if (result.status === 'source-error') throw Error('BANK_SOURCE_ERROR');
    }, /BANK_/);
  }
});

void test('WD native: raw money decimal precision and signed zero are checked before numeric coercion', async () => {
  const { input } = await wdFixture(),
    state = await native(input);
  for (const value of ['125.400000000000000001', '-0', '+0', '125.400']) {
    const zip = await JSZip.loadAsync(state.files[0].original!);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(/(<c r="P2"[^>]*><v>)[^<]+(<\/v>)/, `$1${value}$2`),
    );
    const file = await readFile(
      'raw.xlsx',
      await zip.generateAsync({ type: 'arraybuffer' }),
    );
    await assert.rejects(
      assertBankNativeDisplay(file, 'BANK_NATIVE_DISPLAY', {
        strictMovementDisplay: true,
        decimals: 2,
      }),
      /BANK_NATIVE_DISPLAY/,
      value,
    );
  }
});

void test('WD native: a fractional date serial cannot lose its time through numeric coercion', async () => {
  const { input } = await wdFixture(),
    state = await native(input),
    zip = await JSZip.loadAsync(state.files[0].original!),
    xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  zip.file(
    'xl/worksheets/sheet1.xml',
    xml.replace(
      /(<c r="C2"[^>]*><v>)(\d+)(<\/v>)/,
      '$1$2.000000000000000001$3',
    ),
  );
  const file = await readFile(
    'date-time.xlsx',
    await zip.generateAsync({ type: 'arraybuffer' }),
  );
  await assert.rejects(
    assertBankNativeDisplay(file, 'BANK_NATIVE_DISPLAY', {
      strictMovementDisplay: true,
      decimals: 2,
    }),
    /BANK_NATIVE_DISPLAY/,
  );
});
