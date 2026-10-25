import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  placeGlyphs,
  splitTextItems,
} from '../lib/reconciliation/pdf-glyph-geometry.ts';
import {
  readNativePdfSource,
  readNativePdfWordSource,
} from '../lib/reconciliation/pdf.ts';
import { getNativePDFJS } from '../lib/reconciliation/pdfjs-native.ts';

// PDF.js combines text runs that sit close on one line into one extracted
// item. Word geometry replays the text layout to place each glyph, and an
// item is split only where that replay reproduces PDF.js's own geometry.

const { OPS } = await getNativePDFJS();
const glyph = (unicode: string, width = 500, isSpace = false) => ({
  unicode,
  fontChar: unicode,
  width,
  isSpace,
});
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

void test('placement follows text matrix, font size, TJ, spacing, scale and CTM', () => {
  const fn = [
    OPS.save,
    OPS.transform,
    OPS.beginText,
    OPS.setFont,
    OPS.setTextMatrix,
    OPS.showText,
    OPS.setCharSpacing,
    OPS.setWordSpacing,
    OPS.showText,
    OPS.setHScale,
    OPS.moveText,
    OPS.showText,
    OPS.endText,
    OPS.restore,
  ];
  const args: unknown[][] = [
    [],
    [2, 0, 0, 2, 10, 20],
    [],
    ['F1', 10],
    [new Float32Array([1, 0, 0, 1, 100, 300])],
    [[glyph('A'), -1000, glyph('B')]],
    [1],
    [3],
    [[glyph(' ', 250, true), glyph('C')]],
    [50],
    [0, -12],
    [[glyph('D')]],
    [],
    [],
  ];
  const placed = placeGlyphs(OPS, fn, args);
  // Text space x 100 → page 2 × 100 + 10 = 210; a 500-unit glyph at size 10
  // advances 5 text units = 10 page units; TJ -1000 moves 10 text units.
  const [a, gap, b] = placed.get(5)!;
  assert.equal(gap, null);
  near(a!.x0, 210);
  near(a!.x1, 220);
  near(a!.y, 620);
  near(b!.x0, 240);
  near(b!.x1, 250);
  // Space: 2.5 + char 1 + word 3 = 6.5 text units; C: 5 + 1 = 6.
  const [space, c] = placed.get(8)!;
  near(space!.x0, 250);
  near(space!.x1, 263);
  near(c!.x0, 263);
  near(c!.x1, 275);
  // A new line from the line start (100, 0) - 12; at 50% scale D's advance
  // (5 + 1 char spacing) shrinks to 3 text units.
  const [d] = placed.get(11)!;
  near(d!.x0, 210);
  near(d!.x1, 216);
  near(d!.y, 596);
});

void test('q/Q restores the text matrix and position, as PDF.js does', () => {
  const fn = [
    OPS.beginText,
    OPS.setFont,
    OPS.setTextMatrix,
    OPS.save,
    OPS.setTextMatrix,
    OPS.restore,
    OPS.showText,
  ];
  const args: unknown[][] = [
    [],
    ['F1', 10],
    [[1, 0, 0, 1, 50, 50]],
    [],
    [[1, 0, 0, 1, 400, 400]],
    [],
    [[glyph('A')]],
  ];
  const [a] = placeGlyphs(OPS, fn, args).get(6)!;
  near(a!.x0, 50);
  near(a!.y, 50);
});

void test('unreadable matrices and vertical glyphs are not placed', () => {
  const fn = [OPS.beginText, OPS.setFont, OPS.setTextMatrix, OPS.showText];
  const bad = placeGlyphs(OPS, fn, [
    [],
    ['F1', 10],
    [[1, 0, 0]],
    [[glyph('A')]],
  ]);
  assert.deepEqual(bad.get(3), [null]);
  const vertical = placeGlyphs(OPS, fn, [
    [],
    ['F1', 10],
    [[1, 0, 0, 1, 0, 0]],
    [[{ ...glyph('A'), vmetric: [1, 0, 0] }]],
  ]);
  assert.deepEqual(vertical.get(3), [null]);
});

void test('an item is split only where placement reproduces its geometry', () => {
  // "Withdrawal Deposit" as PDF.js returns it: one item over two cells.
  const word1 = Array.from('AB'),
    word2 = Array.from('CD');
  const placed = new Map([
    [
      7,
      [
        { x0: 100, x1: 105, y: 700 },
        { x0: 105, x1: 110, y: 700 },
        null,
        { x0: 120, x1: 125, y: 700 },
        { x0: 125, x1: 130, y: 700 },
      ],
    ],
  ]);
  const pieces = new Map<number, [number, number][]>([
    [
      0,
      [
        [7, 0],
        [7, 1],
        [7, 3],
        [7, 4],
      ],
    ],
  ]);
  const raw = new Map([[0, 'ABCD']]);
  const token = { text: 'AB CD', x: 90, y: 700, width: 30 };
  // Offset 10: the item's x is relative to the visible page origin.
  assert.deepEqual(splitTextItems([token], pieces, raw, placed, 10).get(0), [
    { text: word1.join(''), x: 90, width: 10 },
    { text: word2.join(''), x: 110, width: 10 },
  ]);
  const splits = (changed: object, rawText = 'ABCD') =>
    splitTextItems(
      [{ ...token, ...changed }],
      pieces,
      new Map([[0, rawText]]),
      placed,
      10,
    ).has(0);
  assert.equal(splits({ x: 91, width: 29 }), false, 'start differs');
  assert.equal(splits({ width: 29 }), false, 'end differs');
  assert.equal(splits({ y: 699 }), false, 'baseline differs');
  assert.equal(splits({ direction: 'rtl' }), false, 'right-to-left');
  assert.equal(splits({}, 'ABDC'), false, 'glyph order differs');
  assert.equal(splits({ text: 'ABCD' }), false, 'no space in any reading');
  // A numeric run restored to glyph order keeps PDF.js's spaced reading.
  assert.equal(
    splits({ text: 'ABCD', extractionText: 'AB CD' }),
    true,
    'spaced extraction reading',
  );
});

void test('a word part records a space the writer drew before it, not one PDF.js read from a gap (G17)', () => {
  const placed = new Map([
    [
      7,
      [
        { x0: 100, x1: 105, y: 700 },
        { x0: 105, x1: 110, y: 700 },
        { x0: 110.25, x1: 113, y: 700 },
        { x0: 113.5, x1: 118, y: 700 },
      ],
    ],
  ]);
  const pieces = new Map<number, [number, number][]>([
    [
      0,
      [
        [7, 0],
        [7, 1],
        [7, 2],
        [7, 3],
      ],
    ],
  ]);
  const token = { text: 'AB - C', x: 90, y: 700, width: 18 };
  const parts = (raw: string) =>
    splitTextItems([token], pieces, new Map([[0, raw]]), placed, 10).get(0);
  // Kerned tight, the space glyphs are still drawn between the words.
  assert.deepEqual(parts('AB - C'), [
    { text: 'AB', x: 90, width: 10 },
    { text: '-', x: 100.25, width: 2.75, drawnSpace: true },
    { text: 'C', x: 103.5, width: 4.5, drawnSpace: true },
  ]);
  // The same words with no space glyph drawn: PDF.js read the gaps.
  assert.deepEqual(parts('AB-C'), [
    { text: 'AB', x: 90, width: 10 },
    { text: '-', x: 100.25, width: 2.75 },
    { text: 'C', x: 103.5, width: 4.5 },
  ]);
  // A space drawn at one boundary only marks neither.
  assert.deepEqual(
    parts('AB -C')!.map((p) => p.drawnSpace === true),
    [false, false, false],
  );
});

const frozen = (id: string) =>
  fsRead(
    new URL(
      `../audit/bank-statement-foundation/frozen/${id}-statement.pdf`,
      import.meta.url,
    ),
  );

void test('BS08 page 2: merged header and dates split at the real column edges', async () => {
  const bytes = await frozen('BS08');
  const words = await readNativePdfWordSource(Uint8Array.from(bytes).buffer);
  const tokens = words.pages[1].tokens;
  const header = tokens.find((t) => t.text === 'Withdrawal Deposit')!;
  assert.deepEqual(
    header.parts!.map((p) => [
      p.text,
      +p.x.toFixed(2),
      +(p.x + p.width).toFixed(2),
    ]),
    [
      ['Withdrawal', 393, 444.64],
      ['Deposit', 448.63, 483.21],
    ],
  );
  const dates = tokens.find(
    (t) => t.extractionText === '2026-07-20 2026-07-20',
  )!;
  assert.equal(dates.text, '2026-07-202026-07-20');
  assert.deepEqual(
    dates.parts!.map((p) => p.text),
    ['2026-07-20', '2026-07-20'],
  );
  // The established source contract is unchanged: no parts there.
  const plain = await readNativePdfSource(Uint8Array.from(bytes).buffer);
  assert.ok(plain.pages.every((p) => p.tokens.every((t) => !('parts' in t))));
  assert.deepEqual(
    plain.pages.map((p) =>
      p.tokens.map(({ text, x, y, width, item }) => [text, x, y, width, item]),
    ),
    words.pages.map((p) =>
      p.tokens.map(({ text, x, y, width, item }) => [text, x, y, width, item]),
    ),
  );
});
