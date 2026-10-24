import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  checkPdfOperators,
  layoutPdfPage,
  readNativePdfWordSource,
  type GlyphInk,
  type PdfToken,
} from '../lib/reconciliation/pdf.ts';
import { getNativePDFJS } from '../lib/reconciliation/pdfjs-native.ts';

// BNK-PDF-1 G8: a table rule or a neighbouring line is judged by the glyphs'
// proved ink, as the clip test already was (G1). A font's ascent and descent
// reach beyond its letters; a rule two points under a heading's baseline, or
// a title set close under a larger bank name, touches those boxes and no
// letter. Where any outline is unproved the padded box stays.

const { OPS } = await getNativePDFJS();
const BASELINE = 700,
  SIZE = 10;
// The padded box readGuardedPdf builds for a run: a full size above the
// baseline, 0.3 below.
const padded = [40, BASELINE - SIZE * 0.3, 100, BASELINE + SIZE];
const glyphs = [
  { unicode: 'D', fontChar: 'D' },
  { unicode: 'p', fontChar: 'p' },
];
const ink = (p: readonly [number, number]): GlyphInk => ({
  runs: [{ baseline: BASELINE, size: SIZE }],
  glyph: (id) => (id === 'F1_path_D' ? [0, 0.73] : id === 'F1_path_p' ? p : undefined),
});
/** Text drawn, then a horizontal rule of 1pt at `y` across it. */
function rule(y: number, proved: GlyphInk | undefined) {
  checkPdfOperators(
    OPS,
    [OPS.setFont, OPS.showText, OPS.constructPath],
    [['F1', SIZE], [glyphs], [OPS.stroke, [[0, 30, y, 1, 110, y]], [30, y, 110, y]]],
    600 * 842,
    [padded],
    ['Dp'],
    undefined,
    undefined,
    proved,
  );
}
const CROSSED = /يتداخل أحد رسوم PDF مع النص/;

void test('a rule beside the ink passes where the padded box meets it', () => {
  // Ink bottom: 700 + 10 × (0 − 0.01) = 699.9; padded bottom 697; the rule
  // with its half width covers 697.5–698.5.
  assert.doesNotThrow(() => rule(698, ink([0, 0.73])));
  assert.throws(() => rule(698, undefined), CROSSED);
  // Above the ink as well: ink top 707.4, padded top 710.
  assert.doesNotThrow(() => rule(709, ink([0, 0.73])));
  assert.throws(() => rule(709, undefined), CROSSED);
});

void test('a rule that reaches the ink is refused', () => {
  // Through the letters.
  assert.throws(() => rule(704, ink([0, 0.73])), CROSSED);
  // A descender down to −0.22 em reaches 697.7: the rule at 698 touches it.
  assert.throws(() => rule(698, ink([-0.22, 0.73])), CROSSED);
  // The edge: the ink with its margin (0.01 em) ends at 699.9. A rule at
  // 699.45 reaches 699.95 and is refused; at 699.35 it stops at 699.85.
  assert.throws(() => rule(699.45, ink([0, 0.73])), CROSSED);
  assert.doesNotThrow(() => rule(699.35, ink([0, 0.73])));
});

void test('one glyph without proved ink keeps the padded box for its run', () => {
  const partly: GlyphInk = {
    runs: [{ baseline: BASELINE, size: SIZE }],
    glyph: (id) => (id === 'F1_path_D' ? [0, 0.73] : undefined),
  };
  assert.throws(() => rule(698, partly), CROSSED);
});

void test('the guard returns each run’s proved ink box, and nothing for the rest', () => {
  const boxes = checkPdfOperators(
    OPS,
    [OPS.setFont, OPS.showText, OPS.showText],
    [['F1', SIZE], [glyphs], [[{ unicode: 'Q', fontChar: 'Q' }]]],
    600 * 842,
    [padded, [120, BASELINE - 3, 130, BASELINE + 10]],
    ['Dp', 'Q'],
    undefined,
    undefined,
    {
      runs: [
        { baseline: BASELINE, size: SIZE },
        { baseline: BASELINE, size: SIZE },
      ],
      glyph: ink([-0.2, 0.73]).glyph,
    },
  );
  assert.equal(boxes.length, 2);
  assert.deepEqual(
    boxes[0]!.map((v) => Math.round(v * 100) / 100),
    [40, 697.9, 100, 707.4],
  );
  assert.equal(boxes[1], undefined);
});

// BNK-PDF-1 G12: white letters on a filled heading are judged visible by the
// same ink. The fill is 699–709.5; the padded box (697–710) passes both
// edges, as Noto Naskh and Kufi Arabic's ascent and descent passed jsPDF's
// heading cells, while the letters (699.9–707.4) stay on the fill.
const FILL = [30, 699, 110, 709.5];
function heading(proved: GlyphInk | undefined) {
  checkPdfOperators(
    OPS,
    [
      OPS.setFillRGBColor,
      OPS.constructPath,
      OPS.setFillRGBColor,
      OPS.setFont,
      OPS.showText,
    ],
    [
      ['#126e61'],
      [
        OPS.fill,
        [[0, FILL[0], FILL[1], 1, FILL[2], FILL[1], 1, FILL[2], FILL[3], 1, FILL[0], FILL[3]]],
        FILL,
      ],
      ['#ffffff'],
      ['F1', SIZE],
      [glyphs],
    ],
    600 * 842,
    [padded],
    ['Dp'],
    undefined,
    undefined,
    proved,
  );
}
const WHITE = /نصًا أبيض أو ضعيف التباين/;

void test('white letters wholly on a heading fill are visible though the font box passes its edge', () => {
  assert.doesNotThrow(() => heading(ink([0, 0.73])));
  // Without proved ink the padded box decides, and part of it is on the page.
  assert.throws(() => heading(undefined), WHITE);
  // A descender down to −0.22 em reaches 697.7, below the fill: white on white.
  assert.throws(() => heading(ink([-0.22, 0.73])), WHITE);
});

// Rows: two lines 12pt apart whose metric boxes meet (ascent 0.95, descent
// −0.3 of 12pt) while their letters stay apart.
const token = (text: string, y: number): PdfToken => ({
  text,
  x: 40,
  y,
  width: 80,
  height: 12,
  ascent: 0.95,
  descent: -0.3,
});
const OVERLAP = /تتداخل نصوص من صفوف متجاورة/;
const issues = (rows: ReturnType<typeof layoutPdfPage>) => rows.flatMap((r) => r.issues);

void test('rows apart by their ink are separate rows, whatever the metrics say', () => {
  const upper = token('Harbor Line Bank', 100),
    lower = token('Statement of Account', 88);
  // Metrics: upper box down to 96.4, lower box up to 99.4.
  assert.ok(issues(layoutPdfPage([upper, lower], [], 600)).some((i) => OVERLAP.test(i)));
  const apart = new Map([
    [upper, [40, 99.9, 120, 108.8]],
    [lower, [40, 87.9, 120, 96.8]],
  ]);
  assert.deepEqual(issues(layoutPdfPage([upper, lower], [], 600, apart)), []);
  // Ink that meets is still an overlap.
  const meeting = new Map([
    [upper, [40, 96, 120, 108.8]],
    [lower, [40, 87.9, 120, 96.8]],
  ]);
  assert.ok(issues(layoutPdfPage([upper, lower], [], 600, meeting)).some((i) => OVERLAP.test(i)));
  // Proved ink for one row only: the other keeps its metric box.
  const one = new Map([[lower, [40, 87.9, 120, 96.8]]]);
  assert.ok(issues(layoutPdfPage([upper, lower], [], 600, one)).some((i) => OVERLAP.test(i)));
});

void test('K06, Typst: a heading rule and a tight letterhead read by ink, and the missing page holds it', async () => {
  // A G8 holdout statement, regression since G8 was fixed on it.
  const s = await readNativePdfWordSource(
    Uint8Array.from(
      await readFile(
        new URL('../audit/bank-statement-holdout-g8/frozen/K06-statement.pdf', import.meta.url),
      ),
    ).buffer,
  );
  assert.deepEqual(s.readingIssues, []);
  assert.equal(s.pages.length, 3);
});
