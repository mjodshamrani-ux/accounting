import type {
  NativePdfSource,
  NativePdfLiteralSource,
  NativePdfWordSource,
  PdfLiteralTrace,
} from './pdf-native-source.ts';
import {
  placeGlyphs,
  splitTextItems,
  type Matrix,
  type PdfTokenPart,
} from './pdf-glyph-geometry.ts';
import { getNativePDFJS } from './pdfjs-native.ts';
import { guardPdfFontIntegrity } from './pdf-font-integrity.ts';
import { glyphOrderText } from './pdf-glyph-order.ts';
import type { SheetData } from './types.ts';
import { MAX_FILE_BYTES, MAX_PDF_PAGES, MAX_ROWS } from './types.ts';
import type { ProcessingProgress } from './processing-progress.ts';
import { normalizeHeaderLabel } from './header-labels.ts';
import { bindTextPaints, visibleOnBackground } from './pdf-paint-order.ts';
import type { PdfBackground } from './pdf-paint-order.ts';
import {
  ImportDiagnosticError,
  isImportDiagnosis,
} from './import-diagnostics.ts';
import type { ImportDiagnosis } from './import-diagnostics.ts';
import { guardPdfOperatorStreams } from './pdf-stream-integrity.ts';
import {
  suggestPdfColumnLayout,
  projectPdfColumns,
} from './pdf-column-suggestions.ts';

export type PdfToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ascent?: number;
  descent?: number;
  direction?: string;
  extractionText?: string;
  glyphText?: string;
};
type PdfPoint = [number, number];
const boxOverlaps = (a: number[], b: number[]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

const imageOperators = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintImageXObjectRepeat',
  'paintInlineImageXObjectGroup',
  'paintImageMaskXObjectRepeat',
  'paintImageMaskXObjectGroup',
  'paintSolidColorImageMask',
] as const;
const isImagePaint = (ops: Record<string, number>, op: number) =>
  imageOperators.some((name) => ops[name] === op);
class PdfImageContentError extends Error {}

function glyphBounds(token: PdfToken): number[] {
  const ascent = token.ascent ?? 0.8;
  const descent = token.descent ?? -0.2;
  if (
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent) ||
    ascent <= descent
  )
    throw new Error('تعذر التحقق من حدود حروف PDF. اطلب نسخة Excel.');
  return [
    token.x,
    token.y + token.height * descent,
    token.x + token.width,
    token.y + token.height * ascent,
  ];
}

// PDF.js 6 DrawOPS is a compact path stream, separate from its page OPS enum.
// A stroke paints the edges, not the full bounding box of a compound table grid.
// Keep unknown/curved paths conservative; do not infer an empty interior for them.
function decodeStraightPaths(
  encoded: unknown,
  matrix: number[],
  closeLast: boolean,
) {
  if (!Array.isArray(encoded) || encoded.length !== 1) return undefined;
  const data = encoded[0];
  if (!Array.isArray(data) && !ArrayBuffer.isView(data)) return undefined;
  const values = Array.from(data as ArrayLike<number>);
  if (!values.every(Number.isFinite)) return undefined;
  const paths: {
    points: PdfPoint[];
    localPoints: PdfPoint[];
    closed: boolean;
  }[] = [];
  let path: (typeof paths)[number] | undefined;
  const point = (x: number, y: number): PdfPoint => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
  for (let i = 0; i < values.length;) {
    const op = values[i++];
    if (op === 0 || op === 1) {
      if (i + 2 > values.length) return undefined;
      const local: PdfPoint = [values[i++], values[i++]];
      const p = point(...local);
      if (!p.every(Number.isFinite)) return undefined;
      if (op === 0) {
        path = { points: [p], localPoints: [local], closed: false };
        paths.push(path);
      } else {
        if (!path || path.closed) return undefined;
        path.points.push(p);
        path.localPoints.push(local);
      }
    } else if (op === 4) {
      if (!path || path.closed) return undefined;
      path.closed = true;
    } else return undefined;
  }
  if (closeLast && path) path.closed = true;
  for (const current of paths) {
    const { points, localPoints, closed } = current;
    if (
      closed &&
      points.length > 1 &&
      points[0][0] === points.at(-1)![0] &&
      points[0][1] === points.at(-1)![1]
    ) {
      points.pop();
      localPoints.pop();
    }
  }
  return paths;
}
function filledRectangles(
  encoded: unknown,
  matrix: number[],
): number[][] | null {
  const paths = decodeStraightPaths(encoded, matrix, false);
  if (!paths) return null;
  const boxes: number[][] = [];
  for (const path of paths) {
    // A fill or a clip closes each subpath itself, so a final point back on
    // the first is that same corner, as with an explicit close.
    const last = path.points.at(-1)!;
    const points =
      path.points.length === 5 &&
      last[0] === path.points[0][0] &&
      last[1] === path.points[0][1]
        ? path.points.slice(0, 4)
        : path.points;
    if (
      points.length !== 4 ||
      new Set(points.map((p) => p.join(':'))).size !== 4
    )
      return null;
    if (
      points.some((p, i) => {
        const next = points[(i + 1) % 4];
        return p[0] !== next[0] && p[1] !== next[1];
      })
    )
      return null;
    const box = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    if (
      box[0] === box[2] ||
      box[1] === box[3] ||
      boxes.some((b) => boxOverlaps(b, box))
    )
      return null;
    boxes.push(box);
  }
  return boxes;
}
function straightPathOverlaps(
  encoded: unknown,
  matrix: number[],
  halfWidth: number,
  lineJoin: number,
  miterLimit: number,
  textBoxes: number[][],
  closeLast: boolean,
  fillOnly: boolean,
): boolean | undefined {
  const paths = decodeStraightPaths(encoded, matrix, closeLast);
  if (!paths) return undefined;
  if (fillOnly) {
    // A fill can contain several disconnected subpaths, e.g. thin rectangles
    // used as table rules. Bound each filled component, retaining a conservative
    // bound for holes/concave polygons rather than painting the space between.
    return paths.some(({ points }) => {
      if (points.length < 3) return false;
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of points) {
        box[0] = Math.min(box[0], p[0]);
        box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]);
        box[3] = Math.max(box[3], p[1]);
      }
      return textBoxes.some((t) => boxOverlaps(box, t));
    });
  }
  const segmentHits = (p: PdfPoint, q: PdfPoint, t: number[]) => {
    // Bound even rotated square caps at endpoints, then clip the actual
    // segment. A diagonal stroke still does not fill its aggregate bbox.
    const cap = halfWidth * Math.SQRT2;
    if (
      [p, q].some((end) =>
        boxOverlaps(
          [end[0] - cap, end[1] - cap, end[0] + cap, end[1] + cap],
          t,
        ),
      )
    )
      return true;
    const box = [
      t[0] - halfWidth,
      t[1] - halfWidth,
      t[2] + halfWidth,
      t[3] + halfWidth,
    ];
    let from = 0,
      to = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = q[axis] - p[axis];
      if (delta === 0) {
        if (p[axis] < box[axis] || p[axis] > box[axis + 2]) return false;
      } else {
        const a = (box[axis] - p[axis]) / delta;
        const b = (box[axis + 2] - p[axis]) / delta;
        from = Math.max(from, Math.min(a, b));
        to = Math.min(to, Math.max(a, b));
        if (from > to) return false;
      }
    }
    return true;
  };
  for (const { points, localPoints, closed } of paths) {
    for (let i = 1; i < points.length; i++)
      if (textBoxes.some((t) => segmentHits(points[i - 1], points[i], t)))
        return true;
    if (closed && points.length > 1)
      if (textBoxes.some((t) => segmentHits(points.at(-1)!, points[0], t)))
        return true;
    // A miter join may project beyond the normal stroke half-width. Bound
    // that projection separately at actual corners, including a closed start.
    if (lineJoin === 0 && points.length > 2) {
      const start = closed ? 0 : 1;
      const end = closed ? points.length : points.length - 1;
      for (let i = start; i < end; i++) {
        const p = points[i],
          local = localPoints[i],
          before = localPoints[(i + points.length - 1) % points.length],
          after = localPoints[(i + 1) % points.length];
        // Join angles belong to the untransformed path. The half-width already
        // uses maximum transform scale, so this also bounds skewed miter tips.
        const u = [before[0] - local[0], before[1] - local[1]];
        const v = [after[0] - local[0], after[1] - local[1]];
        const product = Math.hypot(...u) * Math.hypot(...v);
        if (!product) continue;
        const cosine = Math.max(
          -1,
          Math.min(1, (u[0] * v[0] + u[1] * v[1]) / product),
        );
        const sineHalf = Math.sqrt((1 - cosine) / 2);
        const pad =
          halfWidth *
          Math.min(miterLimit, sineHalf ? 1 / sineHalf : miterLimit);
        if (
          textBoxes.some((t) =>
            boxOverlaps([p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad], t),
          )
        )
          return true;
      }
    }
  }
  return false;
}

/** Ink evidence for the clip test: each text run's baseline and font size
 * (in the order of textBoxes), and each drawn glyph's vertical ink extent per
 * unit font size, when its outline was proved; and, for the drawing and row
 * tests, that outline's whole box. */
export type GlyphInk = {
  runs: { baseline: number; size: number }[];
  glyph: (id: string) => readonly [number, number] | undefined;
  box?: (id: string) => readonly [number, number, number, number] | undefined;
};
type RunGlyphs = Map<
  number,
  [operator: number, glyph: number, id: string][] | null
>;
// Outlines can arrive as half floats; this margin, in units of the font size,
// covers their rounding many times over.
const GLYPH_INK_MARGIN = 0.01;

// The clip test asks whether drawn ink can be cut away, and the drawing test
// whether a stroke or fill can cross it. A run whose every glyph outline is
// known is tested by that ink, vertically, over the run's advance width; any
// run without that proof keeps the padded text box. Text
// rise moves glyphs off the extracted baseline, so a page with rise keeps the
// padded boxes throughout.
function inkClipBoxes(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  textBoxes: number[][],
  runGlyphs: RunGlyphs | undefined,
  ink: GlyphInk | undefined,
): (padded: number[]) => number[] {
  if (
    !ink ||
    !runGlyphs ||
    fn.some((op, i) => op === ops.setTextRise && Number(args[i]?.[0]) !== 0)
  )
    return (padded) => padded;
  const boxes = new Map<number[], number[]>();
  for (const [index, glyphs] of runGlyphs) {
    const run = ink.runs[index];
    if (!glyphs?.length || !run || !(run.size > 0)) continue;
    let low = Infinity,
      high = -Infinity;
    for (const [, , id] of glyphs) {
      const extent = ink.glyph(id);
      if (!extent) {
        low = NaN;
        break;
      }
      low = Math.min(low, extent[0]);
      high = Math.max(high, extent[1]);
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const padded = textBoxes[index];
    boxes.set(padded, [
      padded[0],
      run.baseline + run.size * (low - GLYPH_INK_MARGIN),
      padded[2],
      run.baseline + run.size * (high + GLYPH_INK_MARGIN),
    ]);
  }
  return (padded) => boxes.get(padded) ?? padded;
}

// Each glyph's ink box on the page, for the drawing and row tests: the box of
// its proved outline, carried by the glyph's own matrix from the replay of
// the operators. A run gets its glyphs' boxes only when every glyph has a
// proved outline and a placement, and the placements reproduce PDF.js's own
// extent and baseline of the run; otherwise it keeps its one box. A rule
// between two cells that PDF.js joined into one run then crosses no glyph.
function glyphInkBoxes(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  textBoxes: number[][],
  runGlyphs: RunGlyphs | undefined,
  ink: GlyphInk | undefined,
): Map<number, number[][]> {
  const out = new Map<number, number[][]>();
  // Text rise is in each glyph's matrix; a run whose placements leave PDF.js's
  // baseline, raised or not, keeps its one box.
  if (!ink?.box || !runGlyphs) return out;
  const spaces = new Map<number, (Matrix | null)[]>();
  const placed = placeGlyphs(ops, fn, args, spaces);
  for (const [index, glyphs] of runGlyphs) {
    const run = ink.runs[index],
      padded = textBoxes[index];
    if (!glyphs?.length || !run || !padded) continue;
    const boxes: number[][] = [];
    let left = Infinity,
      right = -Infinity;
    for (const [operator, glyph, id] of glyphs) {
      const at = placed.get(operator)?.[glyph];
      const m = spaces.get(operator)?.[glyph];
      const outline = ink.box(id);
      if (!at || !m || !outline || Math.abs(at.y - run.baseline) > 0.5) break;
      left = Math.min(left, at.x0);
      right = Math.max(right, at.x1);
      const m0 = GLYPH_INK_MARGIN;
      const corners = [
        [outline[0] - m0, outline[1] - m0],
        [outline[0] - m0, outline[3] + m0],
        [outline[2] + m0, outline[1] - m0],
        [outline[2] + m0, outline[3] + m0],
      ].map(([x, y]) => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ]);
      const box = [
        Math.min(...corners.map((c) => c[0])),
        Math.min(...corners.map((c) => c[1])),
        Math.max(...corners.map((c) => c[0])),
        Math.max(...corners.map((c) => c[1])),
      ];
      if (!box.every(Number.isFinite)) break;
      boxes.push(box);
    }
    if (
      boxes.length === glyphs.length &&
      Math.abs(left - padded[0]) <= 0.5 &&
      Math.abs(right - padded[2]) <= 0.5
    )
      out.set(index, boxes);
  }
  return out;
}

export function checkPdfOperators(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  _area: number,
  textBoxes: number[][] = [],
  textRuns?: string[],
  rawRuns?: Map<number, string>,
  literal?: { trace: PdfLiteralTrace; maxChars: number; maxOperators?: number },
  ink?: GlyphInk,
  runPieces?: Map<number, [operator: number, glyph: number][]>,
  // Receives each run's glyph ink boxes, where they were proved.
  glyphs?: Map<number, number[][]>,
): (number[] | undefined)[] {
  const runGlyphs: RunGlyphs | undefined = ink ? new Map() : undefined;
  const paints = textRuns
    ? bindTextPaints(
        ops,
        fn,
        args,
        textRuns,
        textBoxes,
        rawRuns,
        literal,
        runGlyphs,
        runPieces,
      )
    : null;
  const clipBoxOf = inkClipBoxes(ops, fn, args, textBoxes, runGlyphs, ink);
  // A drawing over text is judged by the same ink: a rule or grid line that
  // passes beside a run's glyphs crosses no glyph, whatever the font's
  // ascent and descent say.
  const inkBoxes = textBoxes.map(clipBoxOf);
  const glyphBoxes = glyphInkBoxes(ops, fn, args, textBoxes, runGlyphs, ink);
  for (const [index, boxes] of glyphBoxes) glyphs?.set(index, boxes);
  const inkTargets = inkBoxes.flatMap((box, i) => glyphBoxes.get(i) ?? [box]);
  const paintedBoxes: number[][] = [];
  const backgrounds: PdfBackground[] = [];
  let state = {
    mode: 0,
    fillColor: '#000000',
    strokeColor: '#000000',
    fillAlpha: 1,
    strokeAlpha: 1,
    masked: false,
    blended: false,
    transferred: false,
    clipped: false,
    clipBox: undefined as number[] | undefined,
    matrix: [1, 0, 0, 1, 0, 0],
    lineWidth: 1,
    lineJoin: 0,
    miterLimit: 10,
    maskResource: false,
  };
  let seenText = false;
  let pendingClip: { clipped: boolean; box?: number[] } | undefined;
  const transform = (m: number[]) => {
    if (m.length !== 6 || !m.every(Number.isFinite))
      throw new Error('تحويل رسم PDF غير صالح');
    const [a, b, c, d, e, f] = state.matrix;
    state.matrix = [
      a * m[0] + c * m[1],
      b * m[0] + d * m[1],
      a * m[2] + c * m[3],
      b * m[2] + d * m[3],
      a * m[4] + c * m[5] + e,
      b * m[4] + d * m[5] + f,
    ];
  };
  const stack: (typeof state)[] = [];
  // PDF.js resolves supported solid color spaces to RGB. Patterns and unknown
  // colors cannot prove visibility, even when their text is extractable.
  const solidColor = (args: unknown[]) =>
    typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])
      ? args[0].toLowerCase()
      : '';
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i],
      a = args[i] ?? [];
    // PDF.js emits clip/eoClip immediately before its packed path. Unknown
    // paths keep the prior conservative rejection. A single exact rectangle
    // can instead prove that every glyph remains inside the visible region.
    if (pendingClip && op !== ops.constructPath) pendingClip = undefined;
    if (
      op === ops.save ||
      op === ops.paintFormXObjectBegin ||
      op === ops.beginGroup
    ) {
      stack.push({ ...state });
      // Form bounding boxes and transparency groups introduce clipping or
      // compositing that this text-only importer does not visually validate.
      if (op === ops.paintFormXObjectBegin && a[1]) state.clipped = true;
      if (op === ops.paintFormXObjectBegin && a[0])
        transform(Array.from(a[0] as ArrayLike<number>));
      if (op === ops.beginGroup) state.masked = true;
      if (
        op === ops.beginGroup &&
        (a[0] as { smask?: unknown } | undefined)?.smask
      )
        state.maskResource = true;
    } else if (
      op === ops.restore ||
      op === ops.paintFormXObjectEnd ||
      op === ops.endGroup
    ) {
      const previous = stack.pop();
      if (previous) state = previous;
    } else if (op === ops.transform) transform(a as number[]);
    else if (op === ops.setLineWidth) state.lineWidth = Number(a[0]);
    else if (op === ops.setLineJoin) state.lineJoin = Number(a[0]);
    else if (op === ops.setMiterLimit) state.miterLimit = Number(a[0]);
    else if (op === ops.setGState) {
      if (!Array.isArray(a[0]))
        throw new Error(
          'تعذر تفسير إعدادات عرض PDF. اطلب PDF نصيًا بسيطًا أو Excel.',
        );
      for (const entry of a[0] as unknown[]) {
        if (!Array.isArray(entry))
          throw new Error('تعذر تفسير إعدادات عرض PDF. اطلب Excel.');
        const [key, value] = entry;
        if (key === 'ca') state.fillAlpha = Number(value);
        else if (key === 'LW') state.lineWidth = Number(value);
        else if (key === 'LJ') state.lineJoin = Number(value);
        else if (key === 'ML') state.miterLimit = Number(value);
        else if (key === 'CA') state.strokeAlpha = Number(value);
        else if (key === 'SMask')
          state.masked = value !== false && value !== null;
        else if (key === 'BM') state.blended = value !== 'source-over';
        else if (key === 'TR') state.transferred = value !== null;
      }
    } else if (op === ops.setTextRenderingMode) state.mode = Number(a[0]);
    else if (op === ops.setFillRGBColor) state.fillColor = solidColor(a);
    else if (op === ops.setStrokeRGBColor) state.strokeColor = solidColor(a);
    else if ([ops.setFillColorN, ops.setFillTransparent].includes(op))
      state.fillColor = '';
    else if ([ops.setStrokeColorN, ops.setStrokeTransparent].includes(op))
      state.strokeColor = '';
    else if (op === ops.clip || op === ops.eoClip) {
      pendingClip = { clipped: state.clipped, box: state.clipBox };
      state.clipped = true;
    } else if (
      [
        ops.showText,
        ops.showSpacedText,
        ops.nextLineShowText,
        ops.nextLineSetSpacingShowText,
      ].includes(op)
    ) {
      seenText = true;
      if (state.mode === 3 || state.mode === 7)
        throw new Error(
          'يحتوي PDF نصًا مخفيًا أو طبقة نص مستخرجة من الصور (OCR). اطلب كشفًا نصيًا أصليًا أو Excel.',
        );
      const currentBoxes = paints?.get(i) ?? textBoxes;
      if (
        state.clipped ||
        (state.clipBox &&
          ((!paints && !currentBoxes.length) ||
            currentBoxes.some((padded) => {
              const box = clipBoxOf(padded);
              return (
                box[0] < state.clipBox![0] - 0.01 ||
                box[1] < state.clipBox![1] - 0.01 ||
                box[2] > state.clipBox![2] + 0.01 ||
                box[3] > state.clipBox![3] + 0.01
              );
            }))) ||
        state.mode >= 4 ||
        state.mode < 0 ||
        !Number.isInteger(state.mode)
      )
        throw new Error(
          'يحتوي PDF نصًا مقصوصًا أو طريقة قص غير مدعومة. اطلب نسخة نصية بسيطة أو Excel.',
        );
      const fill = state.mode === 0 || state.mode === 2;
      const stroke = state.mode === 1 || state.mode === 2;
      if (
        state.masked ||
        state.blended ||
        state.transferred ||
        (fill && state.fillAlpha !== 1) ||
        (stroke && state.strokeAlpha !== 1)
      )
        throw new Error(
          'تؤثر شفافية PDF أو إعدادات إظهار محتواه في النص، ولا يمكن التحقق من ظهوره. اطلب Excel.',
        );
      const visible = (color: string) =>
        paints
          ? currentBoxes.every((box) =>
              visibleOnBackground(color, box, backgrounds),
            )
          : color !== '#ffffff';
      const visibleFill = fill && state.fillColor && visible(state.fillColor);
      const visibleStroke =
        stroke && state.strokeColor && visible(state.strokeColor);
      if (
        (!visibleFill && !visibleStroke) ||
        (fill && !state.fillColor) ||
        (stroke && !state.strokeColor)
      )
        throw new Error(
          'يحتوي PDF نصًا أبيض أو ضعيف التباين، ولا يمكن التحقق من ظهوره على الخلفية. اطلب نسخة نصية بسيطة أو Excel.',
        );
      paintedBoxes.push(...currentBoxes);
    } else if (
      [
        ops.constructPath,
        ops.rawFillPath,
        ops.fill,
        ops.eoFill,
        ops.stroke,
        ops.closeStroke,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
        ops.shadingFill,
      ].includes(op)
    ) {
      // Soft-mask definitions render to a resource canvas, not the page. The
      // active mask is checked separately when any transaction text is painted.
      if (state.maskResource) continue;
      const kind = op === ops.constructPath ? a[0] : op;
      if (pendingClip) {
        const clip = filledRectangles(a[1], state.matrix);
        if (kind === ops.endPath && clip?.length === 1) {
          const box = clip[0],
            prior = pendingClip.box;
          state.clipBox = prior
            ? [
                Math.max(prior[0], box[0]),
                Math.max(prior[1], box[1]),
                Math.min(prior[2], box[2]),
                Math.min(prior[3], box[3]),
              ]
            : box;
          state.clipped = pendingClip.clipped;
        }
        pendingClip = undefined;
      }
      if (kind === ops.endPath) continue;
      const fillOnly = kind === ops.fill || kind === ops.eoFill;
      // A plain white background painted before text cannot cover later glyphs.
      if (
        !paints &&
        !seenText &&
        fillOnly &&
        state.fillColor === '#ffffff' &&
        state.fillAlpha === 1 &&
        !state.masked &&
        !state.blended &&
        !state.transferred
      )
        continue;
      const bounds =
        op === ops.constructPath &&
        a[2] &&
        (Array.isArray(a[2]) || ArrayBuffer.isView(a[2]))
          ? Array.from(a[2] as ArrayLike<number>)
          : [];
      if (bounds.length !== 4 || !bounds.every(Number.isFinite))
        throw new Error(
          'قد يغطي أحد رسوم PDF النص، وتعذر التحقق من حدود الرسم. اطلب نسخة نصية بسيطة أو Excel.',
        );
      const [x0, y0, x1, y1] = bounds;
      const [ma, mb, mc, md, me, mf] = state.matrix;
      const corners = [
        [x0, y0],
        [x0, y1],
        [x1, y0],
        [x1, y1],
      ].map(([x, y]) => [ma * x + mc * y + me, mb * x + md * y + mf]);
      // Largest singular value bounds stroke expansion under scale/shear.
      const squareScale = ma * ma + mb * mb + mc * mc + md * md;
      const determinant = ma * md - mb * mc;
      const scale = Math.sqrt(
        (squareScale +
          Math.sqrt(
            Math.max(
              0,
              squareScale * squareScale - 4 * determinant * determinant,
            ),
          )) /
          2,
      );
      const pad = fillOnly
        ? 0
        : Math.max(0.5, (Math.abs(state.lineWidth) * scale) / 2);
      if (
        !Number.isFinite(pad) ||
        ![0, 1, 2].includes(state.lineJoin) ||
        !Number.isFinite(state.miterLimit) ||
        state.miterLimit < 1
      )
        throw new Error(
          'إعدادات حدود أحد رسوم PDF غير صالحة. اطلب نسخة نصية بسيطة أو Excel.',
        );
      const rectangles =
        paints &&
        fillOnly &&
        state.fillColor &&
        state.fillAlpha === 1 &&
        !state.masked &&
        !state.blended &&
        !state.transferred &&
        !state.clipped
          ? filledRectangles(a[1], state.matrix)
          : null;
      if (rectangles) {
        if (
          rectangles.some((box) =>
            paintedBoxes.some((text) => boxOverlaps(box, text)),
          )
        )
          throw new Error(
            'يغطي أحد رسوم PDF نصًا تحته، لذلك لا يمكن اعتماد القراءة.',
          );
        for (const originalBox of rectangles) {
          const clip = state.clipBox;
          const box = clip
            ? [
                Math.max(clip[0], originalBox[0]),
                Math.max(clip[1], originalBox[1]),
                Math.min(clip[2], originalBox[2]),
                Math.min(clip[3], originalBox[3]),
              ]
            : originalBox;
          if (box[0] < box[2] && box[1] < box[3])
            backgrounds.push({ box, color: state.fillColor });
        }
        continue;
      }
      const strokeOnly = kind === ops.stroke || kind === ops.closeStroke;
      if (
        (strokeOnly || fillOnly) &&
        op === ops.constructPath &&
        textBoxes.length
      ) {
        const overlaps = straightPathOverlaps(
          a[1],
          state.matrix,
          pad,
          state.lineJoin,
          state.miterLimit,
          inkTargets,
          kind === ops.closeStroke,
          fillOnly,
        );
        if (overlaps === false) continue;
        if (overlaps === true)
          throw new Error(
            'يتداخل أحد رسوم PDF مع النص وقد يغطي رقمًا. راجع الملف الأصلي واطلب نسخة نصية بسيطة أو Excel.',
          );
      }
      const box = [
        Math.min(...corners.map((p) => p[0])) - pad,
        Math.min(...corners.map((p) => p[1])) - pad,
        Math.max(...corners.map((p) => p[0])) + pad,
        Math.max(...corners.map((p) => p[1])) + pad,
      ];
      if (
        !box.every(Number.isFinite) ||
        !textBoxes.length ||
        inkTargets.some((t) => boxOverlaps(box, t))
      )
        throw new Error(
          'يتداخل أحد رسوم PDF مع النص وقد يغطي رقمًا. راجع الملف الأصلي واطلب نسخة نصية بسيطة أو Excel.',
        );
    } else if (isImagePaint(ops, op))
      throw new PdfImageContentError(
        'يحتوي PDF صورة قد تضم بيانات لا تُقرأ نصيًا، حتى لو كانت صغيرة. أرقام القراءة البصرية (OCR) لا تدخل التسوية حاليًا. اطلب PDF نصيًا أو Excel.',
      );
  }
  // Each run's ink box where its glyph outlines were proved, else undefined.
  return inkBoxes.map((box, i) => (box === textBoxes[i] ? undefined : box));
}
export function validateCuts(cuts: number[]): void {
  if (
    !Array.isArray(cuts) ||
    cuts.length > 19 ||
    cuts.some(
      (c, i) =>
        !Number.isFinite(c) ||
        c <= 0 ||
        c >= 100 ||
        (i > 0 && c <= cuts[i - 1]),
    )
  )
    throw new Error(
      'أدخل حدود أعمدة PDF بترتيب تصاعدي كنسب بين 0 و100، وبحد أقصى 19 حدًا.',
    );
}
// Geometry only: never infer dates, signs, amounts, headers or missing cells.
export function layoutPdfPage(
  tokens: PdfToken[],
  cuts: number[],
  width: number,
  // A token's ink box where its glyph outlines were proved.
  ink?: Map<PdfToken, number[]>,
  // Its glyphs' ink boxes where each glyph's outline and place were proved.
  glyphs?: Map<PdfToken, number[][]>,
) {
  validateCuts(cuts);
  if (!Number.isFinite(width) || width <= 0)
    throw new Error('عرض صفحة PDF غير صالح');
  const lines: { y: number; tokens: PdfToken[] }[] = [];
  for (const t of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (
      ![t.x, t.y, t.width, t.height].every(Number.isFinite) ||
      t.width < 0 ||
      t.height <= 0 ||
      t.text.includes('\uFFFD')
    )
      throw new Error('تعذر التحقق من ترميز نص PDF أو موضعه. اطلب نسخة Excel.');
    if (!t.text.trim()) continue;
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - t.y) <= Math.min(1, t.height / 8))
      previous.tokens.push(t);
    else lines.push({ y: t.y, tokens: [t] });
  }
  // Separate baselines do not prove separate visible rows: two complete lines
  // can be painted over one another and still parse into valid dates/amounts.
  // Use each glyph's proved ink where a run has it, else the run's proved
  // ink, else actual font metrics where available; line spacing itself is
  // not evidence. Boxes of one line are sorted by their left edge.
  const bounds = lines.map((line) =>
    line.tokens
      .sort((a, b) => a.x - b.x)
      .flatMap((t) => glyphs?.get(t) ?? [ink?.get(t) ?? glyphBounds(t)])
      .sort((a, b) => a[0] - b[0]),
  );
  const widest = bounds.map((boxes) =>
    boxes.reduce((w, b) => Math.max(w, b[2] - b[0]), 0),
  );
  let reach = 0;
  for (let i = 0; i < lines.length; i++)
    for (const box of bounds[i])
      reach = Math.max(
        reach,
        Math.abs(box[1] - lines[i].y),
        Math.abs(box[3] - lines[i].y),
      );
  const overlapRows = new Set<number>();
  let comparisons = 0;
  for (let i = 1; i < lines.length; i++)
    for (let j = i - 1; j >= 0 && lines[j].y - lines[i].y <= reach * 2; j--) {
      // A box of line j that starts further left than its line's widest box
      // ends before any box of line i starting at a[0] begins.
      let start = 0;
      search: for (const a of bounds[i]) {
        while (
          start < bounds[j].length &&
          bounds[j][start][0] < a[0] - widest[j]
        )
          start++;
        for (let k = start; k < bounds[j].length; k++) {
          const b = bounds[j][k];
          if (b[0] >= a[2]) break;
          if (++comparisons > 1_000_000)
            throw new Error(
              'تداخل نصوص PDF كثيف ويتجاوز حدود التحقق. اطلب نسخة أبسط أو Excel.',
            );
          if (
            a[0] < b[2] - 0.2 &&
            a[2] > b[0] + 0.2 &&
            a[1] < b[3] - 0.2 &&
            a[3] > b[1] + 0.2
          ) {
            overlapRows.add(i);
            overlapRows.add(j);
            break search;
          }
        }
      }
    }
  return lines.map((line, lineIndex) => {
    const cells = Array.from(
      { length: cuts.length + 1 },
      () => [] as PdfToken[],
    );
    const issues: string[] = [];
    if (overlapRows.has(lineIndex))
      issues.push(
        'تتداخل نصوص من صفوف متجاورة، لذلك لا يمكن التحقق من صحة القراءة.',
      );
    for (const t of line.tokens.sort((a, b) => a.x - b.x)) {
      const left = (t.x / width) * 100,
        right = ((t.x + t.width) / width) * 100;
      if (left < -0.1 || right > 100.1) issues.push('نص خارج حدود الصفحة');
      if (cuts.some((c) => c > left + 0.05 && c < right - 0.05))
        issues.push(
          'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع',
        );
      const col = cuts.findIndex((c) => left < c);
      cells[col < 0 ? cuts.length : col].push(t);
    }
    const cellTransforms: Omit<
      NonNullable<SheetData['pdfTextTransforms']>[string][number],
      'page'
    >[] = [];
    const row = cells.map((cell, column) => {
      for (let i = 1; i < cell.length; i++)
        if (cell[i].x < cell[i - 1].x + cell[i - 1].width - 0.2)
          issues.push('توجد نصوص متداخلة، لذلك لا يمكن التحقق من صحة القراءة.');
      const extractedText = cell.map((token) => token.text).join(' ');
      const rtlWords =
        cell.length > 1 &&
        cell.every(
          (token) =>
            token.direction === 'rtl' &&
            /^[\p{Script=Arabic}\p{M}\s]+$/u.test(token.text) &&
            !/\p{N}/u.test(token.text),
        );
      const ordered = rtlWords ? [...cell].reverse() : cell;
      const value = ordered
        .map((token, i) => {
          if (!i) return token.text;
          const previous = ordered[i - 1];
          const gap = token.x - previous.x - previous.width;
          const adjacent =
            gap >= -0.2 &&
            gap <= Math.min(token.height, previous.height) * 0.08;
          const signBefore =
            /^[+(−-]$/.test(previous.text) &&
            /^[0-9٠-٩۰-۹.,٬٫]+$/u.test(token.text);
          const closeAfter =
            /^[0-9٠-٩۰-۹.,٬٫]+$/u.test(previous.text) && token.text === ')';
          // Preserve contiguous sign/parenthesis glyph fragments. Never join two
          // digit groups, repair a missing digit, or cross a column boundary.
          return (
            (adjacent && (signBefore || closeAfter) ? '' : ' ') + token.text
          );
        })
        .join('');
      if (value !== extractedText)
        cellTransforms.push({
          column: column + 1,
          extractedText,
          glyphText: cell
            .map((token) => token.glyphText ?? token.text)
            .join(''),
          usedText: value,
          rule: rtlWords
            ? 'verified-rtl-word-order'
            : 'verified-adjacent-numeric-fragments',
        });
      return value;
    });
    const textTransforms = line.tokens.flatMap((token) => {
      if (token.extractionText === undefined) return [];
      const cut = cuts.findIndex((c) => (token.x / width) * 100 < c);
      return [
        {
          column: (cut < 0 ? cuts.length : cut) + 1,
          extractedText: token.extractionText,
          glyphText: token.glyphText ?? token.text,
          usedText: token.text,
          rule: 'verified-numeric-glyph-order' as const,
        },
      ];
    });
    return {
      row,
      issues: [...new Set(issues)],
      textTransforms: [...textTransforms, ...cellTransforms],
    };
  });
}
type GuardedPdfPage = {
  literals?: PdfLiteralTrace;
  view: [number, number, number, number];
  width: number;
  height: number;
  tokens: (PdfToken & { item: number; parts?: PdfTokenPart[] })[];
  ink: Map<PdfToken, number[]>;
  glyphInk: Map<PdfToken, number[][]>;
};

/** One macrotask turn between pages on a window's main thread, where a page's
 * client re-reads an original to verify a worker's reply: input and painting
 * run in between, and a long PDF no longer freezes the page. A worker and
 * Node never wait. Scheduling only; nothing read changes. */
const yieldBetweenPages =
  typeof window === 'undefined' || typeof MessageChannel === 'undefined'
    ? undefined
    : () =>
        new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        });

// The only native-text decoder. Both projections share every integrity guard.
// Take ownership before the first await: callers may reuse or mutate their buffer.
async function readGuardedPdf<T>(
  input: ArrayBuffer,
  onProgress: ((progress: ProcessingProgress) => void) | undefined,
  project: (pages: GuardedPdfPage[], original: ArrayBuffer) => T | Promise<T>,
  captureLiteral = false,
  captureWords = false,
): Promise<T> {
  if (input.byteLength > MAX_FILE_BYTES)
    throw new Error('حجم الملف يتجاوز 8 MB');
  if (new TextDecoder().decode(input.slice(0, 5)) !== '%PDF-')
    throw new Error('محتوى الملف ليس PDF صالحًا');
  const buffer = input.slice(0);
  const { getDocument, version, OPS } = await getNativePDFJS();
  const loading = getDocument({
    data: new Uint8Array(buffer.slice(0)),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    useWasm: false,
    stopAtErrors: true,
    enableXfa: false,
  });
  let streamGuard: ReturnType<typeof guardPdfOperatorStreams> | undefined;
  let fontGuard: ReturnType<typeof guardPdfFontIntegrity> | undefined;
  try {
    const doc = await loading.promise;
    streamGuard = guardPdfOperatorStreams(doc, version);
    fontGuard = guardPdfFontIntegrity(doc, version);
    if (doc.numPages < 1 || doc.numPages > MAX_PDF_PAGES)
      throw new Error(
        'الحد الحالي لملف PDF النصي هو 100 صفحة. استخدم Excel للملفات الأكبر؛ لن تُقرأ نسخة جزئية.',
      );
    if ((await doc.getPermissions()) !== null)
      throw new Error(
        'ملف PDF المحمي غير مدعوم. اطلب من المورد نسخة غير محمية.',
      );
    const layers = await doc.getOptionalContentConfig();
    if (layers.getOrder()?.length)
      throw new Error(
        'يحتوي PDF طبقات عرض. اطلب نسخة مسطحة تظهر كل البيانات أو Excel.',
      );
    const pages: GuardedPdfPage[] = [];
    let count = 0,
      chars = 0,
      literalChars = 0,
      literalOperators = 0;
    onProgress?.({ stage: 'pdf-read', completed: 0, total: doc.numPages });
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      try {
        if (page.rotate !== 0)
          throw new Error(
            `الصفحة ${pageNo} مدوّرة. اطلب PDF باتجاه صحيح أو Excel.`,
          );
        if ((await page.getAnnotations()).some((a) => a.subtype === 'Widget'))
          throw new Error(
            'نماذج PDF التفاعلية غير مدعومة. اطلب نسخة مسطحة تظهر كل البيانات.',
          );
        const text = await page.getTextContent({ disableNormalization: true });
        const tokens: GuardedPdfPage['tokens'] = [];
        for (const [index, item] of text.items.entries()) {
          if (!('str' in item)) continue;
          if (++count > 100000 || (chars += item.str.length) > 2000000)
            throw new Error('نص PDF يتجاوز حدود المعالجة الآمنة');
          if (
            item.str.trim() &&
            (Math.abs(item.transform[1]) > 0.01 ||
              Math.abs(item.transform[2]) > 0.01 ||
              item.transform[0] <= 0 ||
              item.transform[3] <= 0)
          )
            throw new Error(
              `نص مائل أو معكوس في الصفحة ${pageNo}. اطلب Excel.`,
            );
          if (item.str.trim()) {
            const style = text.styles[item.fontName];
            const token: GuardedPdfPage['tokens'][number] = {
              item: index + 1,
              text: item.str,
              direction: item.dir,
              x: item.transform[4] - page.view[0],
              y: item.transform[5],
              width: item.width,
              height: item.height,
              ...(typeof style?.ascent === 'number'
                ? { ascent: style.ascent }
                : {}),
              ...(typeof style?.descent === 'number'
                ? { descent: style.descent }
                : {}),
            };
            const box = glyphBounds(token);
            if (box[1] < page.view[1] - 0.2 || box[3] > page.view[3] + 0.2)
              throw new Error(
                `نص مقصوص عند حافة الصفحة ${pageNo}. لا يمكن التحقق من القراءة. اطلب نسخة كاملة أو Excel.`,
              );
            tokens.push(token);
          }
        }
        const operators = await page.getOperatorList();
        await streamGuard.assertComplete();
        fontGuard.assertComplete();
        const imagePaints = operators.fnArray.reduce(
          (count, op) => count + Number(isImagePaint(OPS, op)),
          0,
        );
        const diagnosticFailure = (
          message: string,
          code: ImportDiagnosis['code'],
        ) => {
          const diagnosis: ImportDiagnosis = {
            schemaVersion: 1,
            format: 'pdf',
            totalPages: doc.numPages,
            page: pageNo,
            contentKind: tokens.length
              ? imagePaints
                ? 'mixed'
                : 'native-text'
              : imagePaints
                ? 'image-only'
                : 'no-extractable-text',
            textItems: tokens.length,
            textChars: tokens.reduce(
              (sum, token) => sum + token.text.length,
              0,
            ),
            imagePaints,
            code,
            route: 'visual-extraction-required',
            inspectedAllPages: false,
          };
          // An excessive diagnostic count cannot make the rejected source usable.
          // Keep the original rejection message even when its facts exceed schema limits.
          return isImportDiagnosis(diagnosis)
            ? new ImportDiagnosticError(message, diagnosis)
            : new Error(message);
        };
        if (!tokens.length)
          throw diagnosticFailure(
            `الصفحة ${pageNo} مصورة أو بلا نص قابل للتحقق. استخدم PDF نصيًا أو Excel للتسوية. القراءة البصرية (OCR) تنتج مسودة غير متحققة.`,
            'PDF_NO_EXTRACTABLE_TEXT',
          );
        const rawRuns = new Map<number, string>();
        const runPieces = captureWords
          ? new Map<number, [number, number][]>()
          : undefined;
        const literals: PdfLiteralTrace | undefined = captureLiteral
          ? {
              version: 'native-pdf-literals-1',
              text: '',
              items: [],
              operators: [],
            }
          : undefined;
        const ink = new Map<PdfToken, number[]>();
        const glyphInk = new Map<PdfToken, number[][]>();
        const runGlyphBoxes = new Map<number, number[][]>();
        try {
          const inkBoxes = checkPdfOperators(
            OPS,
            operators.fnArray,
            operators.argsArray,
            (page.view[2] - page.view[0]) * (page.view[3] - page.view[1]),
            tokens.map((t) => {
              const glyph = glyphBounds(t);
              return [
                t.x + page.view[0],
                Math.min(glyph[1], t.y - t.height * 0.3),
                t.x + page.view[0] + t.width,
                Math.max(glyph[3], t.y + t.height),
              ];
            }),
            tokens.map((token) => token.text),
            rawRuns,
            literals
              ? {
                  trace: literals,
                  maxChars: 2000000 - literalChars,
                  maxOperators: 100000 - literalOperators,
                }
              : undefined,
            {
              runs: tokens.map((t) => ({ baseline: t.y, size: t.height })),
              glyph: fontGuard.glyphInk,
              box: fontGuard.glyphBox,
            },
            runPieces,
            runGlyphBoxes,
          );
          // In the tokens' coordinates, for the row test of layoutPdfPage.
          for (const [i, box] of inkBoxes.entries())
            if (box)
              ink.set(tokens[i], [
                box[0] - page.view[0],
                box[1],
                box[2] - page.view[0],
                box[3],
              ]);
          for (const [i, boxes] of runGlyphBoxes)
            glyphInk.set(
              tokens[i],
              boxes.map((b) => [
                b[0] - page.view[0],
                b[1],
                b[2] - page.view[0],
                b[3],
              ]),
            );
          if (literals) {
            literalChars += literals.text.length;
            literalOperators += literals.operators.length;
            for (const range of literals.items)
              range.item = tokens[range.item].item;
          }
        } catch (error) {
          // Only annotate the existing image guard. Earlier clipping, hidden text,
          // occlusion and contrast failures keep their precedence and remain fatal.
          if (error instanceof PdfImageContentError)
            throw diagnosticFailure(error.message, 'PDF_IMAGE_CONTENT');
          throw error;
        }
        // Preserve the glyph order for purely numeric/date/sign runs when the
        // reader's bidi presentation reorders their separators. Exact glyph
        // provenance was checked above; no financial character is substituted.
        for (const [index, raw] of rawRuns) {
          const token = tokens[index];
          token.glyphText = raw;
          if (
            /^[0-9٠-٩۰-۹.,٬٫()+−\-/\s]+$/u.test(raw) &&
            raw.trim() !== token.text
          ) {
            token.extractionText = token.text;
            token.text = raw.trim();
          }
        }
        if (runPieces) {
          const parts = splitTextItems(
            tokens,
            runPieces,
            rawRuns,
            placeGlyphs(OPS, operators.fnArray, operators.argsArray),
            page.view[0],
          );
          for (const [index, words] of parts) tokens[index].parts = words;
          // A run drawn with glyphs of several right-to-left letters reads by
          // glyph (pdf-glyph-order.ts); PDF.js's own reading stays beside it.
          for (const [index, raw] of rawRuns) {
            const token = tokens[index];
            const pieces = runPieces.get(index);
            if (!pieces || token.extractionText !== undefined) continue;
            const text = glyphOrderText(token.text, raw, pieces);
            if (text === undefined) continue;
            token.extractionText = token.text;
            token.text = text;
          }
        }
        pages.push({
          ...(literals ? { literals } : {}),
          tokens,
          ink,
          glyphInk,
          view: [page.view[0], page.view[1], page.view[2], page.view[3]],
          width: page.view[2] - page.view[0],
          height: page.view[3] - page.view[1],
        });
      } catch (error) {
        if (error instanceof ImportDiagnosticError) throw error;
        const reason =
          error instanceof Error ? error.message : 'تعذر قراءة الصفحة';
        const message = `تعذرت قراءة صفحة PDF ${pageNo}: ${reason}`;
        if (error instanceof Error) {
          // Keep typed integrity failures distinguishable from ordinary parse
          // errors while adding the failing page to the worker-visible text.
          error.message = message;
          throw error;
        }
        throw new Error(message, { cause: error });
      } finally {
        page.cleanup();
      }
      onProgress?.({
        stage: 'pdf-read',
        completed: pageNo,
        total: doc.numPages,
      });
      await yieldBetweenPages?.();
    }
    return await project(pages, buffer);
  } finally {
    fontGuard?.restore();
    streamGuard?.restore();
    await loading.destroy();
  }
}

export async function readPdf(
  buffer: ArrayBuffer,
  cuts: number[] = [],
  autoColumns = false,
  onProgress?: (progress: ProcessingProgress) => void,
) {
  validateCuts(cuts);
  cuts = [...cuts];
  return readGuardedPdf(buffer, onProgress, (pages) => {
    const sheet: SheetData = {
      name: 'PDF',
      rows: [],
      formulaRows: [],
      hiddenRows: [],
      rowIssues: {},
      rowPages: {},
    };
    // Prefer the header-signature reading; fall back to column geometry so an
    // ordinary statement is not stranded by unfamiliar header wording.
    const proposedLayout = suggestPdfColumnLayout(pages);
    const suggested =
      autoColumns && !cuts.length
        ? (proposedLayout?.cuts ?? projectPdfColumns(pages))
        : null;
    const effectiveCuts = suggested ?? cuts;
    onProgress?.({ stage: 'pdf-layout', completed: 0, total: pages.length });
    for (const [index, page] of pages.entries()) {
      const lines = layoutPdfPage(
        page.tokens,
        effectiveCuts,
        page.width,
        page.ink,
        page.glyphInk,
      );
      const band = proposedLayout?.headers[index];
      const pieces = band?.lineIndexes.map((i) => lines[i]);
      const merged =
        pieces &&
        Array.from({ length: effectiveCuts.length + 1 }, (_, col) =>
          pieces
            .map((piece) => piece.row[col]?.trim() ?? '')
            .filter(Boolean)
            .join(' '),
        );
      // Join only a proven multi-line HEADER. Every original token is retained
      // in the fragment record and original PDF; transaction rows are untouched.
      const joinHeader =
        !!band &&
        band.lineIndexes.length > 1 &&
        !!pieces &&
        pieces.every((piece) => piece && piece.issues.length === 0) &&
        merged?.length === band.columns.length &&
        merged.every(
          (value, col) => normalizeHeaderLabel(value) === band.columns[col],
        );
      for (const [lineIndex, line] of lines.entries()) {
        if (
          joinHeader &&
          band.lineIndexes.includes(lineIndex) &&
          lineIndex !== band.lineIndexes[0]
        )
          continue;
        const headerLine = joinHeader && lineIndex === band.lineIndexes[0];
        sheet.rows.push(headerLine ? merged! : line.row);
        const rn = String(sheet.rows.length);
        sheet.rowPages![rn] = index + 1;
        if (headerLine)
          (sheet.pdfHeaderFragments ??= {})[rn] = pieces!.map(
            (piece) => piece.row,
          );
        if (line.issues.length) sheet.rowIssues![rn] = line.issues;
        if (line.textTransforms.length)
          (sheet.pdfTextTransforms ??= {})[rn] = line.textTransforms.map(
            (t) => ({ ...t, page: index + 1 }),
          );
        if (sheet.rows.length > MAX_ROWS)
          throw new Error('الحد 20,000 صف مستخرج');
      }
      // Column inference checked every page before extraction. Release page
      // geometry as rows take its place; never retain PDF.js page caches too.
      page.tokens.length = 0;
      onProgress?.({
        stage: 'pdf-layout',
        completed: index + 1,
        total: pages.length,
      });
    }
    return {
      sheets: [sheet],
      pdf: {
        cuts: [...effectiveCuts],
        pages: pages.length,
        ...(suggested ? { autoColumns: true } : {}),
      },
    };
  });
}

/**
 * Source geometry only. It does not infer table roles, scope, amounts or matches.
 * Layout warnings remain evidence; a later accounting reader must resolve them.
 * No caller-supplied geometry or cached result is accepted as source authority.
 */
/** The native source with combined left-to-right items split into words
 * where their glyph geometry was proved (see splitTextItems). */
export async function readNativePdfWordSource(
  buffer: ArrayBuffer,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<NativePdfWordSource> {
  return readGuardedPdf(
    buffer,
    onProgress,
    async (pages, original) => ({
      ...(await projectNativePdfSource(pages, original)),
      wordVersion: 'native-pdf-words-2',
    }),
    false,
    true,
  );
}

export async function readNativePdfSource(
  buffer: ArrayBuffer,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<NativePdfSource> {
  return readGuardedPdf(buffer, onProgress, projectNativePdfSource);
}

/** Additional, explicit evidence contract. Legacy reads do not capture glyph text. */
export async function readLiteralNativePdfSource(
  buffer: ArrayBuffer,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<NativePdfLiteralSource> {
  return readGuardedPdf(
    buffer,
    onProgress,
    async (pages, original) => {
      const source = await projectNativePdfSource(pages, original);
      return {
        ...source,
        literalVersion: 'native-pdf-literals-1',
        pages: source.pages.map((page, i) => {
          const literals = pages[i].literals;
          if (!literals) throw new Error('PDF_LITERAL_MISSING');
          return { ...page, literals };
        }),
      };
    },
    true,
  );
}
async function projectNativePdfSource(
  pages: GuardedPdfPage[],
  original: ArrayBuffer,
): Promise<NativePdfSource> {
  const readingIssues: NativePdfSource['readingIssues'] = [];
  let lines = 0;
  for (const [index, page] of pages.entries()) {
    // Keep the existing finite-coordinate, replacement-character, overlap,
    // page-edge and layout-budget checks even without global column cuts.
    const layout = layoutPdfPage(
      page.tokens,
      [],
      page.width,
      page.ink,
      page.glyphInk,
    );
    lines += layout.length;
    if (lines > MAX_ROWS) throw new Error('الحد 20,000 صف مستخرج');
    layout.forEach((line, lineIndex) => {
      if (line.issues.length)
        readingIssues.push({
          page: index + 1,
          line: lineIndex + 1,
          reasons: [...line.issues],
        });
    });
  }
  const digest = await crypto.subtle.digest('SHA-256', original);
  const sha256 = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  return {
    version: 'native-pdf-source-1',
    sha256,
    byteLength: original.byteLength,
    coordinateSystem: 'visible-page-bottom-left-pdf-units',
    readingIssues,
    pages: pages.map((page, index) => ({
      page: index + 1,
      view: [...page.view],
      width: page.width,
      height: page.height,
      tokens: page.tokens.map((token) => ({
        ...token,
        y: token.y - page.view[1],
      })),
    })),
  };
}
