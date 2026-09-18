import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
const scope = {
  supplier: '',
  entity: '',
  account: '',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
for (const producer of ['openpyxl', 'xlsxwriter'])
  for (const lang of ['ar', 'en'])
    test(`046 valid ${producer} ${lang}: merged preamble, native dates, long/zero-prefixed references and hidden row retained once`, async () => {
      const name = `${producer}-${lang}.xlsx`;
      const buffer = await bytes(
        new URL('./fixtures/xlsx-046/' + name, import.meta.url),
      );
      const file = await readFile(
        name,
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
      );
      assert.equal(file.sheets.length, 2);
      const mapping = selectImportMapping(file, 'supplier').mapping;
      Object.assign(mapping, suggestFormats(file, mapping, 2).patch);
      assert.equal(mapping.sheet, 0);
      assert.equal(mapping.header, 2);
      const result = normalizeSource(file, mapping, scope, 'supplier');
      assert.deepEqual(result.errors, []);
      assert.deepEqual(
        result.transactions.map((t) => t.amount),
        [12345, -2500, 1000],
      );
      assert.deepEqual(
        result.transactions.map((t) => t.reference),
        ['000123', '12345678901234567890', 'INV-HIDDEN'],
      );
      assert.deepEqual(
        result.transactions.map((t) => t.date),
        ['2026-07-15', '2026-07-16', '2026-07-17'],
      );
      assert.deepEqual(
        result.transactions.map((t) => t.row),
        [4, 5, 6],
      );
      assert.equal(result.total, 10845);
      assert.equal(result.transactions.filter((t) => t.row === 6).length, 1);
      assert.ok(result.warnings.some((w) => w.includes('مخفي')));
    });
