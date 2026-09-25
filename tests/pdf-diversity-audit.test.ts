import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  inferMapping,
  normalizeSource,
  compare,
} from '../lib/reconciliation/core.ts';
import { layoutPdfPage } from '../lib/reconciliation/pdf.ts';
import type { PdfToken } from '../lib/reconciliation/pdf.ts';
import {
  suggestPdfColumns,
  projectPdfColumns,
} from '../lib/reconciliation/pdf-column-suggestions.ts';
import type { Scope } from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';
import { syntheticStyledPdf } from './helpers/styled-pdf-fixture.ts';
import { readSeparately } from './helpers/separate-export.ts';

const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const text = (x: number, y: number, value: string, size = 10) =>
  `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[\\()]/g, (c) => '\\' + c)}) Tj ET`;
const positioned = (commands: string[]) =>
  syntheticPdf([[]], 10, commands.join('\n'));
const random = (seed: number) => () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const shuffled = <T>(items: T[], next: () => number) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
function moneyText(minor: number, comma: boolean, parentheses: boolean) {
  const abs = Math.abs(minor);
  const integer = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    comma ? '.' : ',',
  );
  const number = `${integer}${comma ? ',' : '.'}${String(abs % 100).padStart(2, '0')}`;
  return minor < 0 ? (parentheses ? `(${number})` : `-${number}`) : number;
}

test('PDF diversity: 64 seeded valid layouts preserve independent values under column, font and paint-order changes', async () => {
  for (let seed = 1; seed <= 64; seed++) {
    const next = random(seed);
    const size = 8 + (seed % 4);
    const positions = [30, 172, 315, 452].map(
      (x) => x + Math.floor(next() * 9),
    );
    const columns = shuffled([0, 1, 2, 3], next);
    const header = ['Date', 'Reference', 'Amount', 'Description'];
    const expected = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      reference: `AUD-${seed}-${i}`,
      amount: (i % 2 ? -1 : 1) * (10001 + seed * 17 + i * 313),
      description: `Item ${i + 1}`,
    }));
    const comma = seed % 2 === 0;
    const rows = [
      header,
      ...expected.map((row) => [
        row.date,
        row.reference,
        moneyText(row.amount, comma, seed % 3 === 0),
        row.description,
      ]),
    ].map((row) => columns.map((column) => row[column]));
    const commands = rows.flatMap((row, rowIndex) =>
      row.map((value, column) =>
        text(positions[column], 740 - rowIndex * 25, value, size),
      ),
    );
    const bytes = positioned(
      seed % 3 === 0 ? commands.reverse() : shuffled(commands, next),
    );
    const file = await readFile(`seed-${seed}.pdf`, bytes, undefined, true);
    assert.deepEqual(
      file.sheets[0].rows,
      rows,
      `seed ${seed}: no row or cell rewrite`,
    );
    assert.deepEqual(file.sheets[0].rowIssues, {}, `seed ${seed}`);
    const mapping = {
      ...inferMapping(file),
      numberFormat: comma ? ('comma' as const) : ('dot' as const),
    };
    assert.throws(
      () => normalizeSource(file, mapping, scope, 'supplier'),
      /PDF/,
      `seed ${seed}: suggestion is not review`,
    );
    mapping.pdfReviewed = true;
    const supplier = normalizeSource(file, mapping, scope, 'supplier');
    const ledger = normalizeSource(
      await readSeparately(file, undefined, true),
      mapping,
      scope,
      'ledger',
    );
    assert.deepEqual(supplier.errors, [], `seed ${seed}`);
    assert.deepEqual(
      supplier.transactions.map((row) => ({
        date: row.date,
        reference: row.reference,
        amount: row.amount,
        description: row.description,
      })),
      expected,
      `seed ${seed}: numeric oracle`,
    );
    assert.equal(
      compare(supplier, ledger, scope).matches.length,
      expected.length,
      `seed ${seed}`,
    );
    assert.ok(supplier.transactions.every((row) => row.sourcePage === 1));
    assert.deepEqual(file.original, bytes);
  }
});

test('PDF diversity: 2 to 6 pages retain repeated headers, source pages and every unique transaction', async () => {
  for (let pageCount = 2; pageCount <= 6; pageCount++) {
    const pages = Array.from({ length: pageCount }, (_, page) => [
      ['Date', 'Reference', 'Amount'],
      [
        `2026-07-${String(page + 1).padStart(2, '0')}`,
        `PAGE-${page}-A`,
        `${page + 10}.25`,
      ],
      [
        `2026-07-${String(page + 1).padStart(2, '0')}`,
        `PAGE-${page}-B`,
        `-${page + 2}.50`,
      ],
    ]);
    const file = await readFile(
      'multipage-diversity.pdf',
      syntheticPdf(pages),
      undefined,
      true,
    );
    const mapping = { ...inferMapping(file), pdfReviewed: true };
    const result = normalizeSource(file, mapping, scope, 'supplier');
    assert.deepEqual(result.errors, []);
    assert.equal(result.transactions.length, pageCount * 2);
    assert.equal(result.excluded.length, pageCount);
    assert.equal(
      result.transactions.length + result.excluded.length,
      file.sheets[0].rows.length,
    );
    for (let page = 0; page < pageCount; page++) {
      assert.deepEqual(
        result.transactions
          .filter((row) => row.sourcePage === page + 1)
          .map((row) => row.reference),
        [`PAGE-${page}-A`, `PAGE-${page}-B`],
      );
      assert.equal(file.sheets[0].rowPages?.[String(page * 3 + 1)], page + 1);
    }
  }
});

test('PDF diversity requires review: a second-page column reorder cannot silently reuse the first mapping', async () => {
  const file = await readFile(
    'reordered-page.pdf',
    syntheticPdf([
      [
        ['Date', 'Reference', 'Amount'],
        ['2026-07-01', 'FIRST-1', '100.00'],
        ['2026-07-02', 'FIRST-2', '200.00'],
      ],
      [
        ['Date', 'Amount', 'Reference'],
        ['2026-07-03', '300.00', 'LAST-3'],
        ['2026-07-04', '400.00', 'LAST-4'],
      ],
    ]),
    undefined,
    true,
  );
  const mapping = { ...inferMapping(file), pdfReviewed: true };
  const supplier = normalizeSource(file, mapping, scope, 'supplier');
  const ledger = normalizeSource(
    await readSeparately(file, undefined, true),
    mapping,
    scope,
    'ledger',
  );
  assert.ok(supplier.errors.length > 0);
  assert.equal(compare(supplier, ledger, scope).matches.length, 0);
  assert.equal(
    supplier.transactions.length +
      supplier.excluded.length +
      supplier.errors.length,
    file.sheets[0].rows.length,
  );
});

test('PDF diversity requires review: wrapped transaction descriptions remain separate source rows, never invented joins', async () => {
  const commands = [
    ...['Date', 'Reference', 'Amount', 'Description'].map((value, i) =>
      text([30, 172, 315, 452][i], 760, value),
    ),
    ...['2026-07-01', 'WRAP-1', '100.00', 'First line'].map((value, i) =>
      text([30, 172, 315, 452][i], 730, value),
    ),
    text(452, 718, 'continued'),
    ...['2026-07-02', 'WRAP-2', '200.00', 'Complete'].map((value, i) =>
      text([30, 172, 315, 452][i], 690, value),
    ),
  ];
  const file = await readFile(
    'wrapped-body.pdf',
    positioned(commands),
    [24, 48, 71],
  );
  assert.equal(file.sheets[0].rows.length, 4);
  assert.deepEqual(file.sheets[0].rows[2], ['', '', '', 'continued']);
  const mapping = { ...inferMapping(file), pdfReviewed: true };
  const supplier = normalizeSource(file, mapping, scope, 'supplier');
  const ledger = normalizeSource(
    await readSeparately(file, [24, 48, 71]),
    mapping,
    scope,
    'ledger',
  );
  assert.equal(supplier.errors.length, 1);
  assert.equal(supplier.transactions.length, 2);
  assert.equal(compare(supplier, ledger, scope).matches.length, 0);
});

test('PDF diversity requires review: complete rows drawn across one another are not trustworthy transactions', async () => {
  for (const gap of [2, 4, 6]) {
    const commands = [
      ...['Date', 'Reference', 'Amount'].map((value, i) =>
        text([40, 170, 300][i], 760, value),
      ),
      ...['2026-07-01', 'OVERLAP-A', '100.00'].map((value, i) =>
        text([40, 170, 300][i], 730, value),
      ),
      ...['2026-07-02', 'OVERLAP-B', '999.00'].map((value, i) =>
        text([40, 170, 300][i], 730 - gap, value),
      ),
      ...['2026-07-03', 'CLEAR-C', '50.00'].map((value, i) =>
        text([40, 170, 300][i], 690, value),
      ),
    ];
    const file = await readFile(
      'overlapping-baselines.pdf',
      positioned(commands),
      undefined,
      true,
    );
    assert.equal(file.sheets[0].rows.length, 4);
    assert.ok(
      file.sheets[0].rowIssues?.['2']?.some((issue) =>
        /تتداخل|متداخلة/.test(issue),
      ),
      `gap ${gap}`,
    );
    assert.ok(
      file.sheets[0].rowIssues?.['3']?.some((issue) =>
        /تتداخل|متداخلة/.test(issue),
      ),
      `gap ${gap}`,
    );
    assert.equal(file.sheets[0].rowIssues?.['4'], undefined);
    const mapping = { ...inferMapping(file), pdfReviewed: true };
    const supplier = normalizeSource(file, mapping, scope, 'supplier');
    const ledger = normalizeSource(
      await readSeparately(file, undefined, true),
      mapping,
      scope,
      'ledger',
    );
    assert.equal(supplier.errors.length, 2);
    assert.equal(supplier.transactions.length, 1);
    assert.equal(compare(supplier, ledger, scope).matches.length, 0);
  }
});

test('PDF diversity: close but visibly disjoint rows and staggered side-by-side cells remain accepted', async () => {
  for (const gap of [8, 10, 12, 16]) {
    const commands = [
      ...['Date', 'Reference', 'Amount'].map((value, i) =>
        text([40, 170, 300][i], 760, value),
      ),
      ...['2026-07-01', 'CLOSE-A', '100.00'].map((value, i) =>
        text([40, 170, 300][i], 730, value),
      ),
      ...['2026-07-02', 'CLOSE-B', '-25.00'].map((value, i) =>
        text([40, 170, 300][i], 730 - gap, value),
      ),
    ];
    const file = await readFile(
      'close-rows.pdf',
      positioned(commands),
      undefined,
      true,
    );
    assert.deepEqual(
      file.sheets[0].rowIssues,
      {},
      `gap ${gap}: avoid rejecting ordinary line spacing`,
    );
    const result = normalizeSource(
      file,
      { ...inferMapping(file), pdfReviewed: true },
      scope,
      'supplier',
    );
    assert.deepEqual(
      result.transactions.map((row) => row.amount),
      [10000, -2500],
    );
  }
  const result = layoutPdfPage(
    [
      { text: 'Left', x: 40, y: 700, width: 25, height: 10 },
      { text: 'Right', x: 300, y: 696, width: 30, height: 10 },
    ],
    [40],
    600,
  );
  assert.ok(result.every((row) => row.issues.length === 0));
});

test('PDF diversity unsupported: partially clipped glyphs at the page edge cannot be accepted as fully visible', async () => {
  const rows = [
    [
      ['Date', 'Reference', 'Amount'],
      ['2026-07-01', 'VISIBLE', '100.00'],
    ],
  ];
  for (const y of [797, 799]) {
    const clipped = ['2026-07-02', 'CLIPPED', '999.00']
      .map((value, i) => text([40, 170, 300][i], y, value))
      .join('\n');
    await assert.rejects(
      readFile('clipped-edge.pdf', syntheticPdf(rows, 10, clipped), [25, 45]),
      /حافة الصفحة|مقصوص/,
    );
  }
  const nearEdge = ['2026-07-02', 'VISIBLE-TOP', '99.00']
    .map((value, i) => text([40, 170, 300][i], 790, value))
    .join('\n');
  await assert.doesNotReject(
    readFile('visible-edge.pdf', syntheticPdf(rows, 10, nearEdge), [25, 45]),
  );
});

test('PDF diversity unsupported: later covers and hidden text remain rejected while styled table backgrounds are safe', async () => {
  const visible = await readFile(
    'styled-safe.pdf',
    syntheticStyledPdf(),
    undefined,
    true,
  );
  assert.equal(
    normalizeSource(
      visible,
      { ...inferMapping(visible), pdfReviewed: true },
      scope,
      'supplier',
    ).transactions.length,
    2,
  );
  await assert.rejects(
    readFile('styled-cover.pdf', syntheticStyledPdf(true), undefined, true),
    /يغطي|تغط/,
  );
  const rows = [
    [
      ['Date', 'Reference', 'Amount'],
      ['2026-07-01', 'SAFE', '100.00'],
    ],
  ];
  await assert.rejects(
    readFile(
      'hidden-followup.pdf',
      syntheticPdf(rows, 10, '3 Tr\n' + text(300, 690, '999.00')),
      undefined,
      true,
    ),
    /مخفي|OCR/,
  );
});

test('PDF diversity requires review: partial tokens cannot cross the final shared multipage column boundary', () => {
  const t = (value: string, x: number, y: number, width: number): PdfToken => ({
    text: value,
    x,
    y,
    width,
    height: 10,
  });
  const first = {
    width: 600,
    tokens: [
      t('Date', 20, 700, 25),
      t('Reference', 180, 700, 55),
      t('Amount', 410, 700, 40),
      t('2026-07-01', 20, 680, 65),
      t('A-1', 180, 680, 30),
      t('100.00', 410, 680, 40),
      t('2026-07-02', 20, 655, 65),
      t('EXTENDED', 180, 655, 175),
    ],
  };
  const second = {
    width: 600,
    tokens: [
      t('Date', 20, 700, 25),
      t('Reference', 180, 700, 55),
      t('Amount', 340, 700, 40),
      t('2026-07-03', 20, 680, 65),
      t('A-3', 180, 680, 30),
      t('200.00', 340, 680, 40),
    ],
  };
  assert.equal(suggestPdfColumns([first, second]), null);
  const projection = projectPdfColumns([first, second]);
  if (projection)
    for (const page of [first, second]) {
      const rows = layoutPdfPage(page.tokens, projection, page.width);
      assert.ok(
        rows.some((row) => row.issues.length > 0) || projection.length !== 2,
        'fallback cannot silently endorse an intersecting three-column layout',
      );
    }
});

test('PDF diversity: RTL-adjacent Arabic descriptions and Arabic numbers keep exact text without reversing identifiers', () => {
  const tokens: PdfToken[] = [
    { text: 'فاتورة أجهزة', x: 440, y: 700, width: 100, height: 10 },
    { text: '-١٬٢٣٤٫٥٦', x: 300, y: 700, width: 70, height: 10 },
    { text: 'INV-٤٢-A', x: 170, y: 700, width: 68, height: 10 },
    { text: '٢٠٢٦-٠٧-٠١', x: 40, y: 700, width: 65, height: 10 },
  ];
  const rows = layoutPdfPage(tokens, [25, 45, 70], 600);
  assert.deepEqual(rows[0].row, [
    '٢٠٢٦-٠٧-٠١',
    'INV-٤٢-A',
    '-١٬٢٣٤٫٥٦',
    'فاتورة أجهزة',
  ]);
  assert.deepEqual(rows[0].issues, []);
  const overlap = layoutPdfPage(
    [...tokens, { text: '+', x: 301, y: 698, width: 5, height: 10 }],
    [25, 45, 70],
    600,
  );
  assert.ok(
    overlap.every((row) =>
      row.issues.some((issue) => /تتداخل|متداخلة/.test(issue)),
    ),
  );
});
