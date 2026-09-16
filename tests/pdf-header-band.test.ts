import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestPdfColumnLayout,
  suggestPdfColumns,
  projectPdfColumns,
} from '../lib/reconciliation/pdf-column-suggestions.ts';
import { layoutPdfPage } from '../lib/reconciliation/pdf.ts';
import type { PdfToken } from '../lib/reconciliation/pdf.ts';

const token = (
  text: string,
  x: number,
  y: number,
  width: number,
  height = 10,
): PdfToken => ({ text, x, y, width, height });
const headerNames = [
  'Posting Date',
  'Invoice Date',
  'Doc Type',
  'AP Voucher',
  'Supplier Ref',
  'PO / Bank Ref',
  'Description',
  'Debit (SAR)',
  'Credit (SAR)',
  'Running AP Balance',
];
function ledgerPage(seed = 937) {
  // Repeatable independent geometry/data; no customer file bytes or identifiers.
  let value = seed;
  const next = () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0);
  const positions = [20, 110, 200, 290, 380, 470, 560, 730, 820, 910];
  const widths = [68, 64, 48, 62, 66, 73, 68, 61, 66];
  const tokens = [token('Synthetic AP export', 20, 750, 140)];
  for (let i = 0; i < 9; i++)
    tokens.push(token(headerNames[i], positions[i], 700, widths[i]));
  tokens.push(
    token('Running AP', 910, 706, 65),
    token('Balance', 918, 694, 44),
  );
  for (let row = 0; row < 4; row++) {
    const cells = [
      '2026-05-21',
      '2026-05-19',
      'AP Invoice',
      `V-${next() % 10000}`,
      `S-${next() % 10000}`,
      `P-${next() % 10000}`,
      `Synthetic item ${next() % 100}`,
      '0.00',
      `${100 + (next() % 900)}.25`,
      `${2000 + (next() % 1000)}.75`,
    ];
    for (let col = 0; col < cells.length; col++)
      tokens.push(
        token(
          cells[col],
          positions[col],
          675 - row * 22,
          Math.min(cells[col].length * 4.5, col === 6 ? 140 : 68),
        ),
      );
  }
  return { width: 1000, tokens };
}

test('two dates and a vertically split AP balance header produce all ten columns with exact line evidence', () => {
  const page = ledgerPage();
  const before = JSON.stringify(page);
  const layout = suggestPdfColumnLayout([page]);
  assert.ok(layout);
  assert.equal(layout.cuts.length, 9);
  assert.deepEqual(layout.headers, [
    { lineIndexes: [1, 2, 3], columns: headerNames },
  ]);
  assert.deepEqual(suggestPdfColumns([page]), layout.cuts);
  assert.equal(JSON.stringify(page), before);
  const extracted = layoutPdfPage(page.tokens, layout.cuts, page.width);
  assert.equal(extracted.length, 8);
  assert.equal(extracted[1].row[9], 'Running AP');
  assert.equal(extracted[3].row[9], 'Balance');
  assert.deepEqual(extracted[2].row.slice(0, 9), headerNames.slice(0, 9));
  assert.ok(extracted.slice(1).every((line) => !line.issues.length));
  assert.equal(extracted[4].row[0], '2026-05-21');
  assert.equal(extracted[4].row[1], '2026-05-19');
});

test('geometric header evidence remains stable for independent amounts, pages, and wrapped versus unwrapped labels', () => {
  for (let seed = 1; seed < 21; seed++) {
    const first = ledgerPage(seed);
    const second = ledgerPage(seed + 1);
    second.tokens = second.tokens.filter(
      (item) => !['Running AP', 'Balance'].includes(item.text),
    );
    second.tokens.push(token('Running AP Balance', 910, 700, 79));
    const result = suggestPdfColumnLayout([first, second]);
    assert.ok(result);
    assert.equal(result.cuts.length, 9);
    assert.deepEqual(result.headers[0].columns, result.headers[1].columns);
    assert.deepEqual(result.headers[1].lineIndexes, [1]);
  }
});

test('unknown or misaligned fragments cannot be converted to a known balance heading', () => {
  const unknown = ledgerPage();
  unknown.tokens.find((item) => item.text === 'Balance')!.text = 'Estimated';
  assert.equal(suggestPdfColumnLayout([unknown]), null);
  const displaced = ledgerPage();
  displaced.tokens.find((item) => item.text === 'Balance')!.x = 980;
  assert.equal(suggestPdfColumnLayout([displaced]), null);
  const extra = ledgerPage();
  extra.tokens.push(token('Unverified', 500, 706, 50));
  assert.equal(suggestPdfColumnLayout([extra]), null);
  const overlap = ledgerPage();
  overlap.tokens.find((item) => item.text === 'Description')!.width = 300;
  assert.equal(suggestPdfColumnLayout([overlap]), null);
});

test('a different second-page table, duplicate header or transaction crossing a candidate gap cancels the strict proposal', () => {
  const different = ledgerPage();
  different.tokens.find((item) => item.text === 'Supplier Ref')!.text =
    'Vendor Ref';
  assert.equal(suggestPdfColumnLayout([ledgerPage(), different]), null);
  const duplicate = ledgerPage();
  duplicate.tokens.push(
    ...duplicate.tokens
      .filter((item) => item.y >= 694 && item.y <= 706)
      .map((item) => ({ ...item, y: item.y - 200 })),
  );
  assert.equal(suggestPdfColumnLayout([duplicate]), null);
  const crossed = ledgerPage();
  crossed.tokens.find((item) => item.y === 675 && item.x === 470)!.width = 120;
  assert.equal(suggestPdfColumnLayout([crossed]), null);
});

test('the existing vocabulary-free geometry fallback remains available without claiming header identity', () => {
  const page = ledgerPage();
  page.tokens = page.tokens.filter((item) => item.y < 690);
  assert.equal(suggestPdfColumnLayout([page]), null);
  assert.ok(projectPdfColumns([page]));
});

test('close split header words have one exact supported interpretation, while wide gaps remain separate', () => {
  const page = ledgerPage();
  page.tokens = page.tokens.flatMap((item) =>
    item.text === 'Invoice Date'
      ? [
          token('Invoice', item.x, item.y, 35),
          token('Date', item.x + 40, item.y, 20),
        ]
      : item.text === 'AP Voucher'
        ? [
            token('AP', item.x, item.y, 12),
            token('Voucher', item.x + 17, item.y, 36),
          ]
        : item.text === 'Running AP'
          ? [
              token('Running', item.x, item.y, 37),
              token('AP', item.x + 42, item.y, 12),
            ]
          : [item],
  );
  const layout = suggestPdfColumnLayout([page]);
  assert.ok(layout);
  assert.deepEqual(layout.headers[0].columns, headerNames);
  const wide = structuredClone(page);
  wide.tokens.find((item) => item.text === 'Voucher')!.x += 10;
  assert.equal(suggestPdfColumnLayout([wide]), null);
  const unsupported = structuredClone(page);
  unsupported.tokens.find((item) => item.text === 'Voucher')!.text = 'Guess';
  assert.equal(suggestPdfColumnLayout([unsupported]), null);
});
