import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import {
  compare,
  normalizeSource,
  inferMapping,
} from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { layoutPdfPage } from '../lib/reconciliation/pdf.ts';
import { bindTextPaints } from '../lib/reconciliation/pdf-paint-order.ts';
import { bidi } from '../lib/reconciliation/pdf-bidi.js';
import {
  readOutputWorkbook,
  decimalMinor,
} from '../audit/reliability/verify-workbook.mjs';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import type { Scope } from '../lib/reconciliation/types.ts';
const scope: Scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const manifest = JSON.parse(
  await readBytes(
    new URL('./fixtures/pdf-arabic-046/manifest.json', import.meta.url),
    'utf8',
  ),
);
const toBuffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const readFixture = async (id: string) =>
  readFile(
    id + '.pdf',
    toBuffer(
      await readBytes(
        new URL(`./fixtures/pdf-arabic-046/${id}.pdf`, import.meta.url),
      ),
    ),
    [],
    true,
  );
for (const fixture of manifest.fixtures.filter(
  (f: { expected: unknown }) => f.expected,
)) {
  test(`046 Arabic text PDF ${fixture.id}: actual fields, provenance, matches and independent Excel values`, async () => {
    const file = await readFixture(fixture.id);
    const selected = selectImportMapping(file, 'supplier').mapping;
    assert.ok(file.pdf?.autoColumns);
    assert.ok(
      selected.date >= 0 && selected.amount >= 0 && selected.reference >= 0,
    );
    assert.throws(
      () => normalizeSource(file, selected, scope, 'supplier'),
      /PDF/,
    );
    const supplier = normalizeSource(
      file,
      { ...selected, pdfReviewed: true },
      scope,
      'supplier',
    );
    assert.deepEqual(supplier.errors, []);
    assert.deepEqual(
      supplier.transactions.map((t) => [t.date, t.reference, t.amount]),
      fixture.expected,
    );
    assert.equal(
      supplier.transactions.length + supplier.excluded.length,
      file.sheets[0].rows.length,
      'all rows retained or explicit exclusions',
    );
    assert.ok(supplier.transactions.every((t) => t.sourcePage && t.row));
    const csv = [
      'Date,Reference,Amount',
      ...fixture.expected.map(
        ([date, ref, minor]: [string, string, number]) =>
          `${date},${ref},${(minor / 100).toFixed(2)}`,
      ),
    ].join('\n');
    const ledgerFile = await readFile(
      'independent-ledger.csv',
      new TextEncoder().encode(csv).buffer,
    );
    const ledger = normalizeSource(
      ledgerFile,
      inferMapping(ledgerFile),
      scope,
      'ledger',
    );
    const result = compare(supplier, ledger, scope);
    assert.equal(
      result.matches.length,
      fixture.expected.length,
      'clear matches required, review not substitute',
    );
    assert.equal(
      result.balanceComparable,
      false,
      'equal movements do not establish balance reconciliation',
    );
    const output = await exportWorkbook(result, [file, ledgerFile], {
      checked: false,
      name: '',
      notes: '',
    });
    const workbook = await readOutputWorkbook(output);
    const source = workbook.sheets.get('Supplier transactions');
    assert.ok(source);
    for (const [index, expected] of fixture.expected.entries()) {
      const row = source.rows.get(index + 2);
      assert.equal(row.get('E').value, expected[1]);
      assert.equal(
        Number(row.get('D').value),
        Date.parse(expected[0] + 'T00:00:00Z') / 86400000 + 25569,
      );
      assert.equal(decimalMinor(row.get('H').value, 2), BigInt(expected[2]));
    }
    const transforms = file.sheets[0].pdfTextTransforms;
    if (transforms) {
      const sheet = workbook.sheets.get('PDF Text Provenance');
      assert.ok(sheet?.rtl);
      const expectedCount = Object.values(transforms).reduce(
        (n, entries) => n + entries.length,
        0,
      );
      assert.equal(sheet.rows.size - 1, expectedCount);
      for (const entries of Object.values(transforms))
        for (const entry of entries) {
          assert.equal(
            entry.page,
            file.sheets[0].rowPages?.[
              Object.keys(transforms).find((k) => transforms[k] === entries)!
            ],
          );
          assert.notEqual(entry.extractedText, entry.usedText);
          assert.equal(entry.glyphText, entry.usedText);
        }
    }
    if (fixture.id === 'reportlab-wrapped-header')
      assert.equal(
        Object.keys(file.sheets[0].pdfHeaderFragments ?? {}).length,
        1,
      );
    if (fixture.id === 'reportlab-multipage')
      assert.deepEqual(
        supplier.transactions.map((t) => t.sourcePage),
        [1, 1, 1, 2, 2, 2],
      );
  });
}
test('046 Arabic continuation and second account table remain visible and cannot claim complete reading', async () => {
  for (const id of ['reportlab-wrapped-reference', 'reportlab-second-table']) {
    const file = await readFixture(id);
    const source = normalizeSource(
      file,
      { ...selectImportMapping(file, 'supplier').mapping, pdfReviewed: true },
      scope,
      'supplier',
    );
    assert.ok(source.errors.length > 0);
    assert.equal(
      source.errors.length +
        source.transactions.length +
        source.excluded.length,
      file.sheets[0].rows.length,
    );
    assert.ok(
      file.sheets[0].rows.some((row) =>
        row.some((v) =>
          id.endsWith('reference') ? v === '00123' : v === 'Account: OTHER',
        ),
      ),
    );
  }
});
test('046 glyph provenance uses pinned bidi ordering without mutating Latin references or numeric signs', () => {
  const ops = { showText: 1 },
    box = [0, 0, 100, 10];
  for (const raw of [
    'ةرﻮﺗﺎﻔﻟا ﻢﻗر',
    'ةروتاف INV-000123',
    '(٢٥٠٫٧٥)',
    '٢٠٢٦-٠٧-٠١',
    '−٩٨٫٠٥',
  ]) {
    const text: string = bidi(raw).str;
    const sources = new Map<number, string>();
    bindTextPaints(
      ops,
      [1],
      [[[...raw].map((unicode) => ({ unicode }))]],
      [text],
      [box],
      sources,
    );
    assert.equal(sources.get(0), raw);
    for (const wrong of [
      text.replace(/[0-9٠-٩]/u, (c) => (c === '1' ? '9' : '1')),
      text.replace(/[()−]/u, '+'),
    ].filter((t) => t !== text))
      assert.throws(
        () =>
          bindTextPaints(
            ops,
            [1],
            [[[...raw].map((unicode) => ({ unicode }))]],
            [wrong],
            [box],
          ),
        /لا يطابق|بالكامل/,
      );
  }
});
test('046 source geometry may attach adjacent sign fragments but never guesses separated digits', () => {
  const tokens = [
    { text: '−', x: 20, y: 700, width: 7, height: 10 },
    { text: '٩٨٫٠٥', x: 27.05, y: 700, width: 35, height: 10 },
  ];
  assert.equal(layoutPdfPage(tokens, [], 200)[0].row[0], '−٩٨٫٠٥');
  assert.equal(
    layoutPdfPage(
      tokens.map((t, i) => (i ? { ...t, x: 40 } : t)),
      [],
      200,
    )[0].row[0],
    '− ٩٨٫٠٥',
  );
  assert.equal(
    layoutPdfPage(
      tokens.map((t, i) => (i ? { ...t, text: '34' } : { ...t, text: '12' })),
      [],
      200,
    )[0].row[0],
    '12 34',
  );
});
test('046 Arabic word fragments follow RTL geometry while financial fragments retain their source sequence', () => {
  const tokens = [
    {
      text: 'الفاتورة',
      glyphText: 'ةروتافلا',
      x: 20,
      y: 700,
      width: 40,
      height: 10,
      direction: 'rtl',
    },
    {
      text: 'رقم',
      glyphText: 'مقر',
      x: 64,
      y: 700,
      width: 20,
      height: 10,
      direction: 'rtl',
    },
  ];
  const row = layoutPdfPage(tokens, [], 200)[0];
  assert.equal(row.row[0], 'رقم الفاتورة');
  assert.equal(row.textTransforms[0].extractedText, 'الفاتورة رقم');
  assert.equal(row.textTransforms[0].glyphText, 'ةروتافلامقر');
  const mixed = layoutPdfPage(
    [tokens[0], { ...tokens[1], text: 'INV-001', direction: 'ltr' }],
    [],
    200,
  )[0];
  assert.equal(mixed.row[0], 'الفاتورة INV-001');
});
test('046 full-page rectangular clips accept visible statements but partial and unknown clips reject', async () => {
  const rows = [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', 'INV-1', '100.00'],
  ];
  const visible = syntheticPdf(
    [[]],
    10,
    `q 0 0 600 800 re W n\n${rows.flatMap((row, r) => row.map((t, c) => `BT /F1 10 Tf 1 0 0 1 ${[40, 170, 300][c]} ${750 - r * 20} Tm (${t}) Tj ET`)).join('\n')}\nQ`,
  );
  assert.equal(
    (await readFile('visible-clip.pdf', visible, [], true)).sheets[0].rows
      .length,
    2,
  );
  const text = new TextDecoder().decode(visible); // update xref offsets by same-size operator change
  const partial = new TextEncoder().encode(
    text.replace('600 800 re', '200 800 re'),
  ).buffer;
  await assert.rejects(
    readFile('partial-clip.pdf', partial, [], true),
    /مقصوص/,
  );
});

// Source fixtures use generated glyph streams, not OCR; mixed image pages never
// become a successful prefix extraction (the existing OCR boundary is retained).
test('046 native Arabic source followed by an unreadable page cannot return partial accounting data', async () => {
  const bytes = await readBytes(
    new URL(
      './fixtures/pdf-arabic-046/reportlab-mixed-image.pdf',
      import.meta.url,
    ),
  );
  await assert.rejects(
    readFile('arabic-with-image.pdf', toBuffer(bytes), [], true),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /الصفحة 2/);
      return true;
    },
  );
});
