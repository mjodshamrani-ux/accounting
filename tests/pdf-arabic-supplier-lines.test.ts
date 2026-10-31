// SUP-2 S3: Arabic supplier statements read through the supplier path.
// - A lam-alef ligature is one glyph mapped to «لا». PDF.js reads a
//   right-to-left run character by character and turns it inside out, «ال».
//   The statement reader has read by glyph since G7; the supplier reader did
//   not, so «الرصيد الافتتاحي» read «الرصيد االفتتاحي».
// - A right-to-left table leads each row from the right. Its balance line
//   puts the label in the row's last cell in column order, and the summary
//   label was looked for in the first cell only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { structuralSummaryLabel } from '../lib/reconciliation/core.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Mapping } from '../lib/reconciliation/types.ts';

void test('S3 a lam-alef glyph keeps «لا» in a supplier PDF, and PDF.js\'s reading is kept beside it', async () => {
  // G20's W07: an Arabic statement written by an application on PDFKit with
  // fontkit, sealed in the repository; its labels hold «الافتتاحي» and «الاستلام».
  const bytes = await readBytes(
    new URL('../audit/bank-statement-holdout-g20/frozen/W07-statement.pdf', import.meta.url),
  );
  const file = await readFile(
    'W07-statement.pdf',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    undefined,
    true,
  );
  const cells = file.sheets[0].rows.flat();
  assert.ok(cells.some((c) => c.includes('الرصيد الافتتاحي')));
  assert.ok(cells.some((c) => c.includes('الاستلام')));
  assert.ok(!cells.some((c) => /(^|\s)اال/u.test(c)), 'no word reads «اال»');
  const transforms = Object.values(file.sheets[0].pdfTextTransforms ?? {}).flat();
  const byGlyph = transforms.filter((t) => t.rule === 'verified-rtl-glyph-order');
  assert.ok(byGlyph.length > 0);
  assert.ok(byGlyph.some((t) => t.extractedText.includes('االفتتاحي') && t.usedText.includes('الافتتاحي')));
});

const rtl: Mapping = {
  ...defaultMapping(),
  header: 0,
  date: 5,
  reference: 4,
  description: 3,
  debit: 2,
  credit: 1,
  amount: -1,
  mode: 'split',
};
const rtlHeaders = ['الرصيد', 'دائن', 'مدين', 'البيان', 'رقم الفاتورة', 'التاريخ'];

void test('S3 a summary label leading a right-to-left row is found in its last cell', () => {
  for (const label of ['الرصيد الختامي', 'الرصيد الافتتاحي', 'رصيد مرحل', 'الإجمالي']) {
    assert.equal(structuralSummaryLabel(['8,725.91', '', '', '', '', label], rtl, rtlHeaders), label);
  }
  // In the reference column, as a label across the first columns lands.
  assert.equal(
    structuralSummaryLabel(['16,246.43', '', '', '', 'الرصيد الافتتاحي', ''], rtl, rtlHeaders),
    'الرصيد الافتتاحي',
  );
});

void test('S3 near cases: the last cell is not taken for a label it does not lead', () => {
  const near: [string, string[]][] = [
    ['an English label in the last cell', ['8,725.91', '', '', '', '', 'Closing balance']],
    ['a date on the row', ['8,725.91', '', '', '', 'الرصيد الختامي', '2026-07-31']],
    ['text that is not an amount', ['قيد', '', '', '', '', 'الرصيد الختامي']],
    ['an amount that does not parse', ['8,725.9.1', '', '', '', '', 'الرصيد الختامي']],
    ['a label inside longer text', ['8,725.91', '', '', '', '', 'الرصيد الختامي للفترة']],
  ];
  for (const [why, row] of near) assert.equal(structuralSummaryLabel(row, rtl, rtlHeaders), undefined, why);
});
