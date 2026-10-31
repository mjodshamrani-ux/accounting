import { bidi } from './pdf-bidi.js';
import type { PdfLiteralTrace } from './pdf-native-source.ts';

// PDF.js applies its Unicode bidi algorithm between the glyph stream and text
// extraction. Verify that same transformation per text run. The original text
// cells remain untouched: this is provenance binding, never value repair.
export function bindTextPaints(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  texts: string[],
  boxes: number[][],
  rawRuns?: Map<number, string>,
  literal?: { trace: PdfLiteralTrace; maxChars: number; maxOperators?: number },
  // The glyphs drawn for each run, in drawing order, each once: its operator,
  // its index in that operator's glyphs and its outline id
  // (`<font>_path_<char>`); null when a glyph is placed by more than its
  // run's baseline (accent, vertical).
  runGlyphs?: Map<
    number,
    [operator: number, glyph: number, id: string][] | null
  >,
  // The drawing operator and glyph index of each non-space character of each
  // run, in drawing order.
  runPieces?: Map<number, [operator: number, glyph: number][]>,
  // For a run that a space glyph was drawn before, after the end of the run
  // drawn before it: that run's index. A space PDF.js reads from a gap is not
  // a drawn glyph and is not recorded.
  spaceAfter?: Map<number, number>,
): Map<number, number[][]> {
  const compact = (text: string) => text.replace(/\s/gu, '');
  const runs = texts
    .map((text, i) => ({ text: compact(text), box: boxes[i], index: i }))
    .filter((run) => run.text);
  const bindings = new Map<number, number[][]>();
  let run = 0,
    raw = '',
    length = 0;
  let operators = new Set<number>();
  const parts: string[] = [];
  let offset = 0,
    start = -1;
  let spacing = { char: 0, word: 0, scale: 100 };
  const states: (typeof spacing)[] = [];
  let font = '';
  for (let i = 0; i < fn.length; i++) {
    if (fn[i] === ops.setFont) {
      const name = args[i]?.[0];
      font = typeof name === 'string' ? name : '';
    }
    if (literal) {
      if (fn[i] === ops.save) states.push({ ...spacing });
      if (fn[i] === ops.restore) spacing = states.pop() ?? spacing;
      if (fn[i] === ops.setCharSpacing) spacing.char = Number(args[i]?.[0]);
      if (fn[i] === ops.setWordSpacing) spacing.word = Number(args[i]?.[0]);
      if (fn[i] === ops.setHScale) spacing.scale = Number(args[i]?.[0]);
    }
    if (
      ![
        ops.showText,
        ops.showSpacedText,
        ops.nextLineShowText,
        ops.nextLineSetSpacingShowText,
      ].includes(fn[i])
    )
      continue;
    const glyphs = args[i]?.[0];
    if (!Array.isArray(glyphs))
      throw new Error('تعذر التحقق من ترتيب رسم نص PDF');
    bindings.set(i, []);
    const operatorStart = offset;
    let adjusted =
      spacing.char !== 0 ||
      spacing.word !== 0 ||
      spacing.scale !== 100 ||
      fn[i] === ops.nextLineSetSpacingShowText;
    for (const [glyphIndex, glyph] of glyphs.entries()) {
      if (typeof glyph === 'number') {
        if (glyph !== 0) adjusted = true;
        continue;
      }
      if (
        !glyph ||
        typeof glyph !== 'object' ||
        typeof glyph.unicode !== 'string'
      )
        throw new Error('ترميز رسم PDF غير قابل للتحقق');
      if (literal) {
        if (!glyph.unicode || offset + glyph.unicode.length > literal.maxChars)
          throw new Error('PDF_LITERAL_CAPACITY_OR_ENCODING');
        parts.push(glyph.unicode);
      }
      for (const char of glyph.unicode) {
        if (literal) offset += char.length;
        if (/\s/u.test(char)) {
          // Spaces may be inserted geometrically by PDF.js. Keep real internal
          // spaces for its bidi direction threshold, without counting them.
          if (length) raw += char;
          else if (spaceAfter && run > 0 && runs[run])
            spaceAfter.set(runs[run].index, runs[run - 1].index);
          continue;
        }
        const current = runs[run];
        if (!current?.box)
          throw new Error('نص PDF المستخرج لا يطابق ترتيب الرسم');
        if (runPieces) {
          const pieces = runPieces.get(current.index) ?? [];
          for (let k = 0; k < char.length; k++) pieces.push([i, glyphIndex]);
          runPieces.set(current.index, pieces);
        }
        if (runGlyphs) {
          const used = runGlyphs.has(current.index)
            ? runGlyphs.get(current.index)!
            : [];
          const placed =
            used &&
            font &&
            typeof glyph.fontChar === 'string' &&
            !glyph.accent &&
            !glyph.vmetric;
          const last = used?.at(-1);
          // A glyph of several characters is one outline.
          if (placed && (last?.[0] !== i || last[1] !== glyphIndex))
            used.push([i, glyphIndex, `${font}_path_${glyph.fontChar}`]);
          runGlyphs.set(current.index, placed ? used : null);
        }
        if (literal && start < 0) start = offset - char.length;
        raw += char;
        length += char.length;
        operators.add(i);
        if (length > current.text.length)
          throw new Error('نص PDF المستخرج لا يطابق ترتيب الرسم');
        if (length !== current.text.length) continue;
        // Exact match remains sufficient for LTR. Bidi is accepted only when
        // the pinned reader algorithm reproduces every character, including
        // amounts, signs, decimal separators and Latin reference digits.
        if (
          compact(raw) !== current.text &&
          compact(bidi(raw).str) !== current.text
        )
          throw new Error('نص PDF المستخرج لا يطابق ترتيب الرسم');
        rawRuns?.set(current.index, raw);
        if (literal) {
          literal.trace.items.push({ item: current.index, start, end: offset });
          start = -1;
        }
        for (const op of operators) {
          const used = bindings.get(op)!;
          if (!used.includes(current.box)) used.push(current.box);
        }
        run++;
        raw = '';
        length = 0;
        operators = new Set<number>();
      }
    }
    if (literal) {
      if (literal.trace.operators.length >= (literal.maxOperators ?? 100000))
        throw new Error('PDF_LITERAL_OPERATOR_CAPACITY');
      literal.trace.operators.push({
        operator: i,
        start: operatorStart,
        end: offset,
        adjusted,
      });
    }
  }
  if (run !== runs.length || length)
    throw new Error('نص PDF لم يُربط بالكامل بمصدره المرئي');
  if (literal) literal.trace.text = parts.join('');
  return bindings;
}

export type PdfBackground = { box: number[]; color: string };
const overlaps = (a: number[], b: number[]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function luminance(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return NaN;
  const parts = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
}
export function visibleOnBackground(
  color: string,
  box: number[],
  backgrounds: PdfBackground[],
) {
  const foreground = luminance(color);
  const contrast = (background: string) => {
    const level = luminance(background);
    return (
      (Math.max(foreground, level) + 0.05) /
        (Math.min(foreground, level) + 0.05) >=
      3
    );
  };
  const area = (b: number[]) =>
    Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  // A table rule (at most 1pt thick) that grazes a glyph box, as a printed
  // row border does where a page break cuts a row, is not a background: it
  // covers a sliver of the text and hides nothing. Only small slivers are
  // passed over, together at most a fifth of the box, so stripes that could
  // hide text are still refused.
  let rules = 0;
  // Conservative for partial overlapping regions: a full-cover rectangle proves
  // the background; an insufficient-contrast partial region requires review.
  for (let i = backgrounds.length - 1; i >= 0; i--) {
    const background = backgrounds[i];
    if (!overlaps(background.box, box)) continue;
    if (!contrast(background.color)) {
      const b = background.box;
      const cut = [
        Math.max(b[0], box[0]),
        Math.max(b[1], box[1]),
        Math.min(b[2], box[2]),
        Math.min(b[3], box[3]),
      ];
      const share = area(box) ? area(cut) / area(box) : 1;
      const thin = Math.min(b[2] - b[0], b[3] - b[1]) <= 1;
      if (thin && share <= 0.1 && (rules += share) <= 0.2) continue;
      return false;
    }
    const b = background.box;
    if (b[0] <= box[0] && b[1] <= box[1] && b[2] >= box[2] && b[3] >= box[3])
      return true;
  }
  return contrast('#ffffff');
}
