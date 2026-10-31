// Reading order by glyph for right-to-left runs. PDF.js turns a run drawn in
// visual order into reading order character by character. A glyph that maps
// to several characters (LibreOffice's lam-alef ligature maps one glyph to
// «لا», in reading order) is then turned inside out: «الافتتاحي» reads
// «االفتتاحي». Here the same pinned algorithm (pdf-bidi.js, unchanged) runs
// over glyphs instead: each glyph of several right-to-left letters stands in
// for one letter of the same direction while the run is reordered, and then
// gives back its letters in the order its mapping states. Nothing is guessed:
// the letters are the glyphs' own, and outside those glyphs the result must
// equal PDF.js's reading character for character.
import { bidi } from './pdf-bidi.js';

// Strong right-to-left letters (Hebrew, Arabic, Arabic presentation forms):
// a glyph is reordered as one letter only when all its characters are these.
const RTL_LETTER = /^[א-תؠ-يٮ-ۓەۺ-ۼﭐ-﷿ﹰ-ﻼ]$/u;
// Stand-ins: Arabic Supplement letters, strong right-to-left (AL) in the
// pinned algorithm, used only where the run does not contain them.
const STAND_INS = Array.from({ length: 0x30 }, (_, i) =>
  String.fromCharCode(0x0750 + i),
);
const compact = (text: string) => text.replace(/\s/gu, '');

/**
 * The reading-order text of one run, by glyph. `text` is PDF.js's reading of
 * the run; `raw` the characters in drawing order (spaces included); `pieces`
 * the drawing operator and glyph of each non-space UTF-16 unit of `raw`, in
 * order. Returns undefined when no glyph of several right-to-left letters is
 * drawn, or when the result would differ from `text` anywhere else.
 */
export function glyphOrderText(
  text: string,
  raw: string,
  pieces: [operator: number, glyph: number][],
): string | undefined {
  // Each non-space unit of raw with its glyph.
  const units: { char: string; glyph?: string }[] = [];
  let piece = 0;
  for (const char of raw) {
    if (/\s/u.test(char)) {
      units.push({ char });
      continue;
    }
    const at = pieces[piece];
    if (!at) return undefined;
    // A character of two UTF-16 units has one piece per unit.
    for (let k = 1; k < char.length; k++)
      if (pieces[piece + k]?.join() !== at.join()) return undefined;
    piece += char.length;
    units.push({ char, glyph: at.join() });
  }
  if (piece !== pieces.length) return undefined;
  // Glyphs of several right-to-left letters become one stand-in each.
  const pool = STAND_INS.filter((s) => !raw.includes(s) && !text.includes(s));
  const letters = new Map<string, string>();
  let replaced = '';
  for (let i = 0; i < units.length; ) {
    let j = i + 1;
    while (j < units.length && units[i].glyph && units[j].glyph === units[i].glyph)
      j++;
    const group = units.slice(i, j).map((u) => u.char);
    if (group.length > 1 && group.every((c) => RTL_LETTER.test(c))) {
      const stand = pool[letters.size];
      if (!stand) return undefined;
      letters.set(stand, group.join(''));
      replaced += stand;
    } else replaced += group.join('');
    i = j;
  }
  if (!letters.size) return undefined;
  // Reorder by glyph, then give each stand-in back its letters.
  const ordered = compact(bidi(replaced).str);
  let byGlyph = '';
  const spans: [number, number][] = [];
  for (const char of ordered) {
    const word = letters.get(char);
    if (word) {
      spans.push([byGlyph.length, byGlyph.length + word.length]);
      byGlyph += word;
    } else byGlyph += char;
  }
  // Outside those glyphs the reading is PDF.js's own, character for
  // character; inside, the same letters.
  const reading = compact(text);
  if (byGlyph.length !== reading.length) return undefined;
  const inside = Array.from({ length: byGlyph.length }, () => false);
  for (const [a, b] of spans) {
    for (let k = a; k < b; k++) inside[k] = true;
    if (
      Array.from(byGlyph.slice(a, b)).sort().join() !==
      Array.from(reading.slice(a, b)).sort().join()
    )
      return undefined;
  }
  for (let k = 0; k < byGlyph.length; k++)
    if (!inside[k] && byGlyph[k] !== reading[k]) return undefined;
  if (byGlyph === reading) return undefined;
  // PDF.js's spaces stay where it put them (UTF-16 units throughout).
  let at = 0,
    out = '';
  for (let i = 0; i < text.length; i++)
    out += /\s/u.test(text[i]) ? text[i] : byGlyph[at++];
  return out;
}
