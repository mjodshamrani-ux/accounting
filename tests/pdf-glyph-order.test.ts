import test from 'node:test';
import assert from 'node:assert/strict';
import { bidi } from '../lib/reconciliation/pdf-bidi.js';
import { glyphOrderText } from '../lib/reconciliation/pdf-glyph-order.ts';

// Right-to-left runs read by glyph (BNK-PDF-1 G7). A run is given here as
// its glyphs in drawing order, each with the characters its mapping states;
// PDF.js's reading is the pinned algorithm over those characters.

/** raw text, pieces and PDF.js's reading of a run of glyphs. */
function run(glyphs: string[]) {
  let raw = '';
  const pieces: [number, number][] = [];
  for (const [i, g] of glyphs.entries()) {
    raw += g;
    for (const char of g)
      if (!/\s/u.test(char))
        for (let k = 0; k < char.length; k++) pieces.push([7, i]);
  }
  return { raw, pieces, text: bidi(raw).str };
}

void test('a lam-alef glyph keeps its letters in their mapped order', () => {
  // «الافتتاحي» drawn in visual order: ي ح ا ت ت ف [لا] ا
  const r = run(['ي', 'ح', 'ا', 'ت', 'ت', 'ف', 'لا', 'ا']);
  assert.equal(r.text, 'االفتتاحي', 'PDF.js turns the ligature inside out');
  assert.equal(glyphOrderText(r.text, r.raw, r.pieces), 'الافتتاحي');
});

void test('a line of words keeps PDF.js spacing, with every ligature fixed', () => {
  // «الرصيد الافتتاحي لا يتغير» in visual order, word by word.
  const r = run([
    'ر', 'ي', 'غ', 'ت', 'ي', ' ', 'لا', ' ',
    'ي', 'ح', 'ا', 'ت', 'ت', 'ف', 'لا', 'ا', ' ',
    // «الرصيد» opens with alef then lam: two glyphs, not a ligature.
    'د', 'ي', 'ص', 'ر', 'ل', 'ا',
  ]);
  assert.equal(
    glyphOrderText(r.text, r.raw, r.pieces),
    'الرصيد الافتتاحي لا يتغير',
  );
});

void test('digits, Latin and a ligature in one right-to-left run', () => {
  // «لا 2026 CHQ» typed in logical order, drawn in visual order.
  const r = run(['C', 'H', 'Q', ' ', '2', '0', '2', '6', ' ', 'لا']);
  const fixed = glyphOrderText(r.text, r.raw, r.pieces);
  assert.equal(fixed, r.text.replace('ال', 'لا'));
  assert.ok(fixed!.includes('2026') && fixed!.includes('CHQ'));
});

void test('nothing changes without a glyph of several right-to-left letters', () => {
  const plain = run(['د', 'ي', 'ص', 'ر', 'ل', 'ا']);
  assert.equal(glyphOrderText(plain.text, plain.raw, plain.pieces), undefined);
  // A Latin ligature (fi) is left to PDF.js.
  const latin = run(['fi', 'n', 'e']);
  assert.equal(glyphOrderText(latin.text, latin.raw, latin.pieces), undefined);
  // A glyph mapping to a letter and a digit is not reordered as one letter.
  const mixed = run(['ي', 'ل1', 'ا']);
  assert.equal(glyphOrderText(mixed.text, mixed.raw, mixed.pieces), undefined);
});

void test('a reading that does not match PDF.js outside those glyphs is refused', () => {
  const r = run(['ي', 'ح', 'ا', 'ت', 'ت', 'ف', 'لا', 'ا']);
  // Another letter elsewhere in PDF.js's reading.
  assert.equal(
    glyphOrderText(r.text.replace('ي', 'ى'), r.raw, r.pieces),
    undefined,
  );
  // Pieces that do not account for every drawn character.
  assert.equal(glyphOrderText(r.text, r.raw, r.pieces.slice(1)), undefined);
  assert.equal(
    glyphOrderText(r.text, r.raw, [...r.pieces, [7, 99]]),
    undefined,
  );
});

void test('a stand-in letter already in the run is never used for a glyph', () => {
  // U+0750 drawn in the run itself: another stand-in is chosen.
  const r = run(['ݐ', 'ف', 'لا', 'ا']);
  const fixed = glyphOrderText(r.text, r.raw, r.pieces);
  assert.ok(fixed);
  assert.equal(fixed!.split('ݐ').length, 2);
  assert.ok(fixed!.includes('الاف'));
});
