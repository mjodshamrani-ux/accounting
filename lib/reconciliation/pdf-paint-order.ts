// Bind PDF.js text items to the painting operators by exact Unicode sequence.
// Whitespace is ignored only for this provenance binding, never in source cells.
export function bindTextPaints(
  ops: Record<string, number>,
  fn: number[],
  args: unknown[][],
  texts: string[],
  boxes: number[][],
): Map<number, number[][]> {
  const runs = texts
    .map((text, i) => ({ text: text.replace(/\s/gu, ''), box: boxes[i] }))
    .filter((run) => run.text);
  let run = 0,
    offset = 0;
  const bindings = new Map<number, number[][]>();
  for (let i = 0; i < fn.length; i++) {
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
    let text = '';
    for (const glyph of glyphs) {
      if (typeof glyph === 'number') continue; // Kerning only.
      if (
        !glyph ||
        typeof glyph !== 'object' ||
        typeof glyph.unicode !== 'string'
      )
        throw new Error('ترميز رسم PDF غير قابل للتحقق');
      text += glyph.unicode.replace(/\s/gu, '');
    }
    const used: number[][] = [];
    let consumed = 0;
    while (consumed < text.length) {
      const current = runs[run];
      if (!current?.box) throw new Error('نص PDF المستخرج لا يطابق ترتيب الرسم');
      const length = Math.min(
        current.text.length - offset,
        text.length - consumed,
      );
      if (
        current.text.slice(offset, offset + length) !==
        text.slice(consumed, consumed + length)
      )
        throw new Error('نص PDF المستخرج لا يطابق ترتيب الرسم');
      if (!used.includes(current.box)) used.push(current.box);
      consumed += length;
      offset += length;
      if (offset === current.text.length) {
        run++;
        offset = 0;
      }
    }
    bindings.set(i, used);
  }
  if (run !== runs.length || offset)
    throw new Error('نص PDF لم يُربط بالكامل بمصدره المرئي');
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
  // Conservative for partial overlapping regions: a full-cover rectangle proves
  // the background; an insufficient-contrast partial region requires review.
  for (let i = backgrounds.length - 1; i >= 0; i--) {
    const background = backgrounds[i];
    if (!overlaps(background.box, box)) continue;
    if (!contrast(background.color)) return false;
    const b = background.box;
    if (b[0] <= box[0] && b[1] <= box[1] && b[2] >= box[2] && b[3] >= box[3])
      return true;
  }
  return contrast('#ffffff');
}
