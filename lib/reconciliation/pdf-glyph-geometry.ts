// Glyph placement replayed from the PDF.js operator list. PDF.js combines text
// runs that sit close together on one line into a single extracted item and
// marks the gap with a space, so two adjacent table cells can arrive as one
// item. This replay follows PDF.js's own canvas text layout (text matrix and
// line matrix, font size and direction, character and word spacing,
// horizontal scale, rise, TJ adjustments, CTM and form matrices) to place each
// glyph's advance on the page. It never decides anything by itself: a caller
// may use a placement only where it reproduces PDF.js's extracted geometry.

/** Advance box of one drawn glyph in absolute page units, on its baseline. */
export type GlyphPlacement = { x0: number; x1: number; y: number };

export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const matrix = (value: unknown): Matrix | undefined => {
  const values = Array.from((value ?? []) as ArrayLike<number>, Number);
  return values.length === 6 && values.every(Number.isFinite)
    ? (values as Matrix)
    : undefined;
};

/**
 * Placements per text-showing operator index, aligned with that operator's
 * glyph array (TJ numbers and unplaceable glyphs are null). A page state the
 * replay does not model (an unreadable matrix, a vertical glyph) leaves the
 * affected glyphs null; nothing is estimated. When `glyphSpace` is given, it
 * receives, aligned the same way, the matrix from each placed glyph's space
 * (its outline per unit font size, as PDF.js sends it) to the page.
 */
export function placeGlyphs(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  glyphSpace?: Map<number, (Matrix | null)[]>,
): Map<number, (GlyphPlacement | null)[]> {
  // PDF.js saves the text matrix and position with the graphics state on q,
  // in its canvas and in its text extraction alike; so does this replay.
  type State = {
    ctm: Matrix | undefined;
    size: number;
    charSpacing: number;
    wordSpacing: number;
    scale: number;
    leading: number;
    rise: number;
    textMatrix: Matrix | undefined;
    x: number;
    y: number;
    lineX: number;
    lineY: number;
  };
  let state: State = {
    ctm: IDENTITY,
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    scale: 1,
    leading: 0,
    rise: 0,
    textMatrix: IDENTITY,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
  };
  const stack: State[] = [];
  const moveText = (dx: number, dy: number) => {
    state.x = state.lineX += dx;
    state.y = state.lineY += dy;
  };
  const placed = new Map<number, (GlyphPlacement | null)[]>();
  const show = (index: number, glyphs: unknown) => {
    const out: (GlyphPlacement | null)[] = [];
    placed.set(index, out);
    const spaces: (Matrix | null)[] = [];
    glyphSpace?.set(index, spaces);
    if (!Array.isArray(glyphs)) return;
    const direction = state.size < 0 ? -1 : 1;
    const size = Math.abs(state.size);
    // PDF.js lays glyph widths out at its identity font matrix (1/1000 em).
    const widthScale = size * 0.001;
    const step = state.scale * direction;
    const page =
      state.textMatrix && state.ctm
        ? multiply(state.textMatrix, state.ctm)
        : undefined;
    const ty = state.y + state.rise;
    const at = (tx: number) =>
      page
        ? [
            page[0] * tx + page[2] * ty + page[4],
            page[1] * tx + page[3] * ty + page[5],
          ]
        : [NaN, NaN];
    let advance = 0;
    for (const glyph of glyphs as unknown[]) {
      if (typeof glyph === 'number') {
        advance -= (glyph * size) / 1000;
        out.push(null);
        spaces.push(null);
        continue;
      }
      const g = glyph as {
        width?: unknown;
        isSpace?: unknown;
        vmetric?: unknown;
      };
      const spacing = (g?.isSpace ? state.wordSpacing : 0) + state.charSpacing;
      const width = Number(g?.width);
      const next = advance + width * widthScale + spacing * direction;
      const [x0, y0] = at(state.x + advance * step);
      const [x1, y1] = at(state.x + next * step);
      const placement =
        g?.vmetric ||
        ![x0, y0, x1, y1].every(Number.isFinite) ||
        Math.abs(y1 - y0) > 0.01
          ? null
          : { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y: y0 };
      out.push(placement);
      // The outline is scaled by the font size, and across by the
      // horizontal scale, from the pen, before the text matrix.
      const sx = state.size * state.scale,
        sy = state.size,
        pen = state.x + advance * step;
      spaces.push(
        placement && page
          ? [
              page[0] * sx,
              page[1] * sx,
              page[2] * sy,
              page[3] * sy,
              page[0] * pen + page[2] * ty + page[4],
              page[1] * pen + page[3] * ty + page[5],
            ]
          : null,
      );
      advance = next;
    }
    state.x += advance * step;
  };
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i],
      a = args[i] ?? [];
    if (op === ops.save) stack.push({ ...state });
    else if (op === ops.restore) state = stack.pop() ?? state;
    else if (op === ops.paintFormXObjectBegin) {
      stack.push({ ...state });
      const m = a[0] ? matrix(a[0]) : IDENTITY;
      state.ctm = m && state.ctm ? multiply(m, state.ctm) : undefined;
    } else if (op === ops.paintFormXObjectEnd) state = stack.pop() ?? state;
    else if (op === ops.transform) {
      const m = matrix(a);
      state.ctm = m && state.ctm ? multiply(m, state.ctm) : undefined;
    } else if (op === ops.beginText) {
      state.textMatrix = IDENTITY;
      state.x = state.y = state.lineX = state.lineY = 0;
    } else if (op === ops.setFont) state.size = Number(a[1]);
    else if (op === ops.setTextMatrix) {
      state.textMatrix = matrix(a[0]);
      state.x = state.y = state.lineX = state.lineY = 0;
    } else if (op === ops.moveText) moveText(Number(a[0]), Number(a[1]));
    else if (op === ops.setLeadingMoveText) {
      state.leading = Number(a[1]);
      moveText(Number(a[0]), Number(a[1]));
    } else if (op === ops.setLeading) state.leading = -Number(a[0]);
    else if (op === ops.nextLine) moveText(0, state.leading);
    else if (op === ops.setCharSpacing) state.charSpacing = Number(a[0]);
    else if (op === ops.setWordSpacing) state.wordSpacing = Number(a[0]);
    else if (op === ops.setHScale) state.scale = Number(a[0]) / 100;
    else if (op === ops.setTextRise) state.rise = Number(a[0]);
    else if (op === ops.showText || op === ops.showSpacedText) show(i, a[0]);
    else if (op === ops.nextLineShowText) {
      moveText(0, state.leading);
      show(i, a[0]);
    } else if (op === ops.nextLineSetSpacingShowText) {
      state.wordSpacing = Number(a[0]);
      state.charSpacing = Number(a[1]);
      moveText(0, state.leading);
      show(i, a[2]);
    }
  }
  return placed;
}

/** A word of an extracted text item, in the item's x convention.
 * `drawnSpace` when the writer drew a space glyph before it, not a gap that
 * PDF.js read as a space. */
export type PdfTokenPart = {
  text: string;
  x: number;
  width: number;
  drawnSpace?: true;
};

// Within half a point of PDF.js's own item geometry.
const ITEM_TOLERANCE = 0.5;

/**
 * Splits left-to-right extracted items that contain spaces into their words,
 * each with the span of its own glyphs. An item is split only when its glyphs
 * were drawn in the order of its text, every glyph was placed, and the
 * placements reproduce the item's extracted start, end and baseline. Any
 * other item stays whole; right-to-left items always do.
 */
export function splitTextItems(
  tokens: {
    text: string;
    extractionText?: string;
    x: number;
    y: number;
    width: number;
    direction?: string;
  }[],
  pieces: Map<number, [operator: number, glyph: number][]>,
  rawRuns: Map<number, string>,
  placed: Map<number, (GlyphPlacement | null)[]>,
  offsetX: number,
): Map<number, PdfTokenPart[]> {
  const split = new Map<number, PdfTokenPart[]>();
  for (const [index, token] of tokens.entries()) {
    // Word boundaries come from a reading that marks the gap with a space
    // and holds exactly the drawn glyphs in drawing order: the extracted
    // text, or PDF.js's own reading where a numeric run was restored to
    // glyph order (which drops the space PDF.js inserted for a gap).
    const raw = rawRuns.get(index)?.replace(/\s/gu, '');
    const spaced = [token.text, token.extractionText].find(
      (text) =>
        text !== undefined &&
        /\S\s+\S/u.test(text) &&
        text.replace(/\s/gu, '') === raw,
    );
    const words = spaced?.trim().split(/\s+/u) ?? [];
    const own = pieces.get(index);
    if (
      words.length < 2 ||
      token.direction === 'rtl' ||
      !own ||
      own.length !== words.join('').length
    )
      continue;
    const glyphs = own.map(([op, glyph]) => placed.get(op)?.[glyph] ?? null);
    if (glyphs.some((g) => !g)) continue;
    const boxes = glyphs as GlyphPlacement[];
    const start = token.x + offsetX;
    if (
      Math.abs(Math.min(...boxes.map((g) => g.x0)) - start) > ITEM_TOLERANCE ||
      Math.abs(Math.max(...boxes.map((g) => g.x1)) - (start + token.width)) >
        ITEM_TOLERANCE ||
      boxes.some((g) => Math.abs(g.y - token.y) > ITEM_TOLERANCE)
    )
      continue;
    // The writer drew a space glyph at every boundary when its own glyphs,
    // spaces included, read as these words; a kerned space is still a space.
    const drawn = rawRuns.get(index)?.trim().split(/\s+/u) ?? [];
    const spacesDrawn =
      drawn.length === words.length && drawn.every((w, k) => w === words[k]);
    const parts: PdfTokenPart[] = [];
    let at = 0,
      end = -Infinity,
      ordered = true;
    for (const word of words) {
      const span = boxes.slice(at, (at += word.length));
      const x0 = Math.min(...span.map((g) => g.x0)),
        x1 = Math.max(...span.map((g) => g.x1));
      if (x0 < end - 0.01) ordered = false;
      end = x1;
      parts.push({
        text: word,
        x: x0 - offsetX,
        width: x1 - x0,
        ...(spacesDrawn && parts.length ? { drawnSpace: true as const } : {}),
      });
    }
    if (ordered) split.set(index, parts);
  }
  return split;
}
