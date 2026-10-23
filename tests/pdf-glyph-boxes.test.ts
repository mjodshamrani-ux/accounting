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
import { glyphInkBox } from '../lib/reconciliation/pdf-font-integrity.ts';
import { placeGlyphs, type Matrix } from '../lib/reconciliation/pdf-glyph-geometry.ts';

// BNK-PDF-1 G10: Apache FOP and OpenPDF statements were refused for drawings
// and neighbouring lines that cross no glyph. FOP clips each cell's
// background to a rectangle traced back to its start, without an explicit
// close; and a run's one ink box spans every cell PDF.js joined into it, and
// every glyph's height, so a grid line in the gap between two cells, or the
// next line of an Arabic description, meets the box and no letter. Where each
// glyph's outline and place are proved, the guards test each glyph's box.

const { OPS } = await getNativePDFJS();
const BASELINE = 700,
  SIZE = 10;
const CROSSED = /يتداخل أحد رسوم PDF مع النص/;
const OVERLAP = /تتداخل نصوص من صفوف متجاورة/;

// A heading filled behind its text, the fill clipped to its cell.
const DATE = [
  { unicode: 'D', fontChar: 'D', width: 700 },
  { unicode: 'p', fontChar: 'p', width: 600 },
];
const CELL = [30, 695, 110, 712];
const square = (box: number[]) => [
  0,
  box[0],
  box[1],
  1,
  box[2],
  box[1],
  1,
  box[2],
  box[3],
  1,
  box[0],
  box[3],
];
function heading(clip: number[]) {
  checkPdfOperators(
    OPS,
    [
      OPS.save,
      OPS.clip,
      OPS.constructPath,
      OPS.setFillRGBColor,
      OPS.constructPath,
      OPS.restore,
      OPS.setFont,
      OPS.showText,
    ],
    [
      [],
      [],
      [OPS.endPath, [clip], CELL],
      ['#dde3ea'],
      [OPS.fill, [square(CELL)], CELL],
      [],
      ['F1', SIZE],
      [DATE],
    ],
    600 * 842,
    [[40, BASELINE - 3, 100, BASELINE + SIZE]],
    ['Dp'],
  );
}

void test('a clip traced back to its start is the rectangle it closes, as FOP clips a cell', () => {
  // Explicitly closed, as before.
  assert.doesNotThrow(() => heading([...square(CELL), 4]));
  // Back on its first corner without a close: the same rectangle.
  assert.doesNotThrow(() => heading([...square(CELL), 1, CELL[0], CELL[1]]));
  // Five corners that do not come back are no rectangle: the fill under that
  // clip is judged against the text and refused.
  assert.throws(
    () => heading([...square(CELL), 1, CELL[0] + 5, CELL[1]]),
    CROSSED,
  );
});

// A run of four glyphs, two and two, with a 20-point gap between them: two
// cells PDF.js joined into one item. Each glyph advances 6 points.
const RUN = [
  { unicode: 'A', fontChar: 'A', width: 600 },
  { unicode: 'B', fontChar: 'B', width: 600 },
  -2000,
  { unicode: 'C', fontChar: 'C', width: 600 },
  { unicode: 'D', fontChar: 'D', width: 600 },
];
const RUN_BOX = [40, BASELINE - 3, 84, BASELINE + SIZE];
const outline =
  (x1 = 0.55) =>
  (id: string) =>
    /^F1_path_[ABCD]$/.test(id)
      ? ([0.05, 0, id.endsWith('B') ? x1 : 0.55, 0.7] as const)
      : undefined;
const proved = (box = outline()): GlyphInk => ({
  runs: [{ baseline: BASELINE, size: SIZE }],
  glyph: (id) => {
    const b = box(id);
    return b && [b[1], b[3]];
  },
  box,
});
/** The run, then a vertical rule of 1pt at `x` across its line. */
function grid(x: number, ink: GlyphInk | undefined, runBox = RUN_BOX) {
  const glyphs = new Map<number, number[][]>();
  checkPdfOperators(
    OPS,
    [
      OPS.beginText,
      OPS.setFont,
      OPS.setTextMatrix,
      OPS.showSpacedText,
      OPS.endText,
      OPS.constructPath,
    ],
    [
      [],
      ['F1', SIZE],
      [[1, 0, 0, 1, 40, BASELINE]],
      [RUN],
      [],
      [
        OPS.stroke,
        [[0, x, BASELINE - 8, 1, x, BASELINE + 15]],
        [x, BASELINE - 8, x, BASELINE + 15],
      ],
    ],
    600 * 842,
    [runBox],
    ['ABCD'],
    undefined,
    undefined,
    ink,
    undefined,
    glyphs,
  );
  return glyphs;
}

void test('a rule between two cells joined into one run crosses no glyph', () => {
  // The first pair ends at 52, the second starts at 72; the rule at 62.
  assert.doesNotThrow(() => grid(62, proved()));
  // Without the outlines' boxes the run keeps its one box, from 40 to 84.
  const vertical: GlyphInk = { runs: proved().runs, glyph: proved().glyph };
  assert.throws(() => grid(62, vertical), CROSSED);
  assert.throws(() => grid(62, undefined), CROSSED);
  // Through a glyph it is refused.
  assert.throws(() => grid(49, proved()), CROSSED);
  // The guard hands each glyph's box back: B's from 46.5 to 51.5.
  const boxes = grid(62, proved()).get(0)!;
  assert.equal(boxes.length, 4);
  assert.deepEqual(
    boxes[1].map((v) => Math.round(v * 10) / 10),
    [46.4, 699.9, 51.6, 707.1],
  );
});

void test('a glyph is tested by its outline, not its advance, across as well as up', () => {
  // B's outline reaches 1.2 em, 6 points past its advance: a rule at 55
  // crosses that ink although it lies in the gap after B's advance.
  assert.throws(() => grid(55, proved(outline(1.2))), CROSSED);
  assert.doesNotThrow(() => grid(55, proved()));
});

void test('the outline box: every point across and up, refusal of anything unreadable', () => {
  const Values =
    typeof Float16Array === 'undefined' ? Float32Array : Float16Array;
  const buf = (values: number[]) => Values.from(values).buffer as ArrayBuffer;
  const as = (n: number) => Values.from([n])[0];
  // moveTo, lineTo, a curve's three points, close.
  assert.deepEqual(
    glyphInkBox(
      buf([0, 0.25, 0, 1, -0.125, 0.5, 2, 0.5, 0.75, 1.25, -0.25, 0.5, 0, 4]),
    ),
    [as(-0.125), as(-0.25), as(1.25), as(0.75)],
  );
  assert.equal(glyphInkBox(buf([0, 0, Number.NaN])), undefined);
});

void test('each glyph’s space: font size, horizontal scale and pen, through the text matrix and CTM', () => {
  const spaces = new Map<number, (Matrix | null)[]>();
  placeGlyphs(
    OPS,
    [
      OPS.transform,
      OPS.beginText,
      OPS.setFont,
      OPS.setHScale,
      OPS.setTextMatrix,
      OPS.showSpacedText,
    ],
    [
      [2, 0, 0, 2, 10, 20],
      [],
      ['F1', SIZE],
      [50],
      [[1, 0, 0, 1, 40, BASELINE]],
      [
        [
          { unicode: 'A', fontChar: 'A', width: 600 },
          -1000,
          { unicode: 'B', fontChar: 'B', width: 600 },
        ],
      ],
    ],
    spaces,
  );
  const [a, gap, b] = spaces.get(5)!;
  assert.equal(gap, null);
  // Size 10 at half width, doubled by the CTM; A's pen at 40 in the text
  // matrix, page 2 × 40 + 10; B's after A's 6 points and the TJ's 10, each
  // halved by the scale and doubled by the CTM.
  assert.deepEqual(a, [10, 0, 0, 20, 90, 1420]);
  assert.deepEqual(b, [10, 0, 0, 20, 90 + 2 * (3 + 5), 1420]);
});

void test('a run whose replay does not reproduce PDF.js, or with one unproved glyph, keeps its box', () => {
  // The extracted item 2 points wider than the placed glyphs.
  assert.throws(
    () => grid(62, proved(), [40, BASELINE - 3, 86, BASELINE + SIZE]),
    CROSSED,
  );
  // Glyphs placed off the run's baseline.
  const raised: GlyphInk = {
    ...proved(),
    runs: [{ baseline: BASELINE - 3, size: SIZE }],
  };
  assert.throws(() => grid(62, raised), CROSSED);
  // A last glyph E drawn back between the pairs, at 54 to 60, without an
  // outline: the others still span the run, but E's ink is unknown.
  const back = [...RUN, 3000, { unicode: 'E', fontChar: 'E', width: 600 }];
  const glyphs = new Map<number, number[][]>();
  assert.throws(
    () =>
      checkPdfOperators(
        OPS,
        [
          OPS.beginText,
          OPS.setFont,
          OPS.setTextMatrix,
          OPS.showSpacedText,
          OPS.endText,
          OPS.constructPath,
        ],
        [
          [],
          ['F1', SIZE],
          [[1, 0, 0, 1, 40, BASELINE]],
          [back],
          [],
          [
            OPS.stroke,
            [[0, 57, BASELINE - 8, 1, 57, BASELINE + 15]],
            [57, BASELINE - 8, 57, BASELINE + 15],
          ],
        ],
        600 * 842,
        [RUN_BOX],
        ['ABCDE'],
        undefined,
        undefined,
        proved(),
        undefined,
        glyphs,
      ),
    CROSSED,
  );
  assert.equal(glyphs.size, 0);
  // C without an outline.
  const partly = (id: string) =>
    id === 'F1_path_C' ? undefined : outline()(id);
  assert.throws(() => grid(62, proved(partly)), CROSSED);
});

// Rows: two lines of an Arabic description 8 points apart. Their runs' boxes
// meet; their glyphs do not, unless a tail reaches the letter above.
const token = (text: string, y: number): PdfToken => ({
  text,
  x: 40,
  y,
  width: 60,
  height: 8,
});
const issues = (rows: ReturnType<typeof layoutPdfPage>) =>
  rows.flatMap((r) => r.issues);

void test('lines apart by their glyphs are separate rows, though their runs meet', () => {
  const upper = token('upper', 100),
    lower = token('lower', 92);
  const runs = new Map([
    [upper, [40, 97.5, 100, 107]],
    [lower, [40, 89.5, 100, 99]],
  ]);
  // The runs' boxes meet by 1.5 points.
  assert.ok(
    issues(layoutPdfPage([upper, lower], [], 600, runs)).some((i) =>
      OVERLAP.test(i),
    ),
  );
  // The deep tail is under the left of the upper line, the tall letter on the
  // right of the lower one.
  const apart = new Map([
    [
      upper,
      [
        [40, 97.5, 50, 105],
        [52, 100, 100, 107],
      ],
    ],
    [
      lower,
      [
        [40, 89.5, 90, 96],
        [92, 89.5, 100, 99],
      ],
    ],
  ]);
  assert.deepEqual(
    issues(layoutPdfPage([upper, lower], [], 600, runs, apart)),
    [],
  );
  // A tail over the tall letter is an overlap.
  const meeting = new Map([
    [
      upper,
      [
        [40, 100, 90, 107],
        [92, 97.5, 100, 105],
      ],
    ],
    [
      lower,
      [
        [40, 89.5, 90, 96],
        [92, 89.5, 100, 99],
      ],
    ],
  ]);
  assert.ok(
    issues(layoutPdfPage([upper, lower], [], 600, runs, meeting)).some((i) =>
      OVERLAP.test(i),
    ),
  );
  // Glyph boxes for one line only: the other keeps its run's box.
  const one = new Map([[upper, apart.get(upper)!]]);
  assert.ok(
    issues(layoutPdfPage([upper, lower], [], 600, runs, one)).some((i) =>
      OVERLAP.test(i),
    ),
  );
  // A wide glyph that starts far to the left still meets a later one.
  const wide = new Map([
    [
      upper,
      [
        [0, 97.5, 100, 99],
        [52, 100, 60, 107],
      ],
    ],
    [
      lower,
      [
        [10, 89.5, 20, 96],
        [95, 89.5, 99, 98],
      ],
    ],
  ]);
  assert.ok(
    issues(layoutPdfPage([upper, lower], [], 600, runs, wide)).some((i) =>
      OVERLAP.test(i),
    ),
  );
});

const holdout = async (id: string) =>
  readNativePdfWordSource(
    Uint8Array.from(
      await readFile(
        new URL(
          `../audit/bank-statement-holdout-g10/frozen/${id}-statement.pdf`,
          import.meta.url,
        ),
      ),
    ).buffer,
  );

void test('P01 and P02, FOP: a clipped heading fill, a tight grid and an Arabic letterhead read clean', async () => {
  // G10 holdout statements, regression since G10 was fixed on them.
  for (const id of ['P01', 'P02'])
    assert.deepEqual((await holdout(id)).readingIssues, [], id);
});

void test('P09, OpenPDF and Amiri: lines whose glyphs meet are still refused', async () => {
  const source = await holdout('P09');
  assert.ok(
    source.readingIssues.some((i) => i.reasons.some((r) => OVERLAP.test(r))),
  );
});
