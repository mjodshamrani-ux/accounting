import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { checkPdfOperators, type GlyphInk } from '../lib/reconciliation/pdf.ts';
import { readNativePdfSource } from '../lib/reconciliation/pdf.ts';
import { glyphInkExtent } from '../lib/reconciliation/pdf-font-integrity.ts';
import { getNativePDFJS } from '../lib/reconciliation/pdfjs-native.ts';

// A run's text box is padded to a full font size above the baseline and 0.3
// below. When every glyph outline of the run is known, the clip test uses
// the outlines' ink instead: browser-printed pages clip each page to its
// content area, and the padded box of a heading at the top crosses that edge
// while its letters are whole. Ink that is cut is still refused.

const { OPS } = await getNativePDFJS();
const BASELINE = 790.92,
  SIZE = 12;
// The padded box readGuardedPdf builds for this run.
const padded = [40, BASELINE - SIZE * 0.3, 100, BASELINE + SIZE];
const rect = (top: number, bottom: number) => [
  [0, 0, bottom, 1, 600, bottom, 1, 600, top, 1, 0, top, 4],
];
const glyphs = [
  { unicode: 'B', fontChar: 'B' },
  { unicode: 'k', fontChar: 'k' },
];
function check(
  top: number,
  ink: GlyphInk | undefined,
  options: { rise?: number; shown?: object[]; bottom?: number } = {},
) {
  const fn = [OPS.setFont, OPS.save, OPS.clip, OPS.constructPath];
  const args: unknown[][] = [
    ['F1', SIZE],
    [],
    [],
    [OPS.endPath, rect(top, options.bottom ?? 0)],
  ];
  if (options.rise !== undefined) {
    fn.push(OPS.setTextRise);
    args.push([options.rise]);
  }
  fn.push(OPS.showText, OPS.restore);
  args.push([options.shown ?? glyphs], []);
  checkPdfOperators(
    OPS,
    fn,
    args,
    600 * 842,
    [padded],
    ['Bk'],
    undefined,
    undefined,
    ink,
  );
}
const known = (extent: readonly [number, number] | undefined): GlyphInk => ({
  runs: [{ baseline: BASELINE, size: SIZE }],
  glyph: (id) =>
    id === 'F1_path_B' ? [0, 0.729] : id === 'F1_path_k' ? extent : undefined,
});
const CLIPPED = /قص/;

void test('ink inside the clip passes where the padded box crosses it', () => {
  // Ink top 790.92 + 12 × (0.76 + 0.01) = 800.16; padded top 802.92.
  assert.doesNotThrow(() => check(801, known([0, 0.76])));
  assert.throws(() => check(801, undefined), CLIPPED);
});

void test('ink cut by the clip is refused, even by a fraction of a point', () => {
  assert.throws(() => check(800, known([0, 0.76])), CLIPPED);
  // Within the half-float margin (0.01 em) of the ink: refused, not rounded in.
  assert.throws(() => check(800.1, known([0, 0.76])), CLIPPED);
  assert.throws(() => check(795, known([0, 0.76])), CLIPPED);
  // Below the baseline too. The clip's bottom edge at 786 is under the
  // padded box (787.32); a descender to -0.6 em reaches 783.6.
  assert.doesNotThrow(() => check(801, known([-0.2, 0.76]), { bottom: 786 }));
  assert.throws(
    () => check(801, known([-0.6, 0.76]), { bottom: 786 }),
    CLIPPED,
  );
});

void test('ink beyond the padded box is refused although the box fits', () => {
  // Before ink was known this passed: the padded box ends at 802.92.
  assert.doesNotThrow(() => check(803, undefined));
  assert.throws(() => check(803, known([0, 1.1])), CLIPPED);
});

void test('any glyph without proved ink keeps the padded box for its run', () => {
  assert.throws(() => check(801, known(undefined)), CLIPPED);
  const accented = [glyphs[0], { ...glyphs[1], accent: { fontChar: 'a' } }];
  assert.throws(
    () => check(801, known([0, 0.76]), { shown: accented }),
    CLIPPED,
  );
  const vertical = [glyphs[0], { ...glyphs[1], vmetric: [1, 0, 0] }];
  assert.throws(
    () => check(801, known([0, 0.76]), { shown: vertical }),
    CLIPPED,
  );
});

void test('text rise moves glyphs off the baseline, so the page keeps padded boxes', () => {
  assert.throws(() => check(801, known([0, 0.76]), { rise: 2 }), CLIPPED);
  assert.doesNotThrow(() => check(801, known([0, 0.76]), { rise: 0 }));
});

void test('outline reader: control-point bounds, refusal of anything unreadable', () => {
  // Encoded as PDF.js encodes outlines in this runtime: half floats where
  // the runtime has them (Node 24), otherwise single floats.
  const Values =
    typeof Float16Array === 'undefined' ? Float32Array : Float16Array;
  const buf = (values: number[]) => Values.from(values).buffer as ArrayBuffer;
  const as = (n: number) => Values.from([n])[0];
  assert.deepEqual(
    glyphInkExtent(buf([0, 0, 0, 2, 0.1, 0.9, 0.2, -0.3, 0.5, 0.4, 4])),
    [as(-0.3), as(0.9)],
  );
  assert.deepEqual(
    glyphInkExtent(buf([0, 0, 0.5, 3, 0, 1, 1, 0.25])),
    [0.25, 1],
  );
  for (const bad of [
    buf([]),
    buf([0, 0]),
    buf([7, 0, 0]),
    buf([0, 0, Number.NaN]),
    buf([0.5, 0, 0]),
    new ArrayBuffer(5),
    Values.from([0, 0, 0]),
    null,
  ])
    assert.equal(glyphInkExtent(bad), undefined);
});

// The real browser-printed statement: page 2 of BS01 with its single clip
// rectangle moved. Its heading has baseline 790.92, size 12 and ink from the
// outlines up to 800.04; the frozen clip ends at 802.17.
const frozen = await fsRead(
  new URL(
    '../audit/bank-statement-foundation/frozen/BS01-statement.pdf',
    import.meta.url,
  ),
);
const CLIP = '140.625 165.625 2196.9238 3177.1973 re';
function withPage2(edit: (content: string) => string): ArrayBuffer {
  const pdf = frozen.toString('latin1');
  const head =
    /\n8 0 obj\n<<\/Filter \/FlateDecode\n\/Length (\d+)>> stream\n/.exec(pdf)!;
  const start = head.index + head[0].length;
  const end = start + Number(head[1]);
  const content = inflateSync(frozen.subarray(start, end)).toString('latin1');
  const next = deflateSync(Buffer.from(edit(content), 'latin1'));
  let out =
    pdf.slice(0, head.index) +
    `\n8 0 obj\n<</Filter /FlateDecode\n/Length ${next.length}>> stream\n` +
    next.toString('latin1') +
    pdf.slice(end);
  const xref = out.lastIndexOf('\nxref\n') + 1;
  const count = Number(/^xref\n0 (\d+)\n/.exec(out.slice(xref))![1]);
  const offsets = Array.from({ length: count - 1 }, (_, i) => {
    const at = out.indexOf(`\n${i + 1} 0 obj\n`);
    assert.ok(at > 0 && out.indexOf(`\n${i + 1} 0 obj\n`, at + 1) < 0);
    return at + 1;
  });
  const trailer = out.slice(out.indexOf('trailer', xref));
  out =
    out.slice(0, xref) +
    `xref\n0 ${count}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    trailer.replace(/startxref\n\d+/, `startxref\n${xref}`);
  const bytes = Buffer.from(out, 'latin1');
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
// Clip top at `top` in page units; the bottom edge stays where it was.
const clipTop = (top: number) => (content: string) => {
  assert.ok(content.includes(CLIP));
  const y = (841.91998 - top) / 0.23999999;
  return content.replace(
    CLIP,
    `140.625 ${y.toFixed(4)} 2196.9238 ${(3342.8223 - y).toFixed(4)} re`,
  );
};

void test('the frozen browser-printed statement reads, and an identity rewrite reads the same', async () => {
  const original = await readNativePdfSource(Uint8Array.from(frozen).buffer);
  const rewritten = await readNativePdfSource(withPage2((c) => c));
  assert.deepEqual(
    rewritten.pages.map((p) => p.tokens),
    original.pages.map((p) => p.tokens),
  );
  assert.equal(original.pages.length, 2);
  assert.ok(
    original.pages[1].tokens.some((t) => t.text === 'Sample Commercial Bank'),
  );
});

void test('real page: clip just above the heading ink reads; a clip through it is refused', async () => {
  await readNativePdfSource(withPage2(clipTop(801)));
  for (const top of [800, 795, 785])
    await assert.rejects(
      readNativePdfSource(withPage2(clipTop(top))),
      /PDF 2:.*قص/,
      String(top),
    );
});

void test('real page: text rise on the page restores the padded refusal', async () => {
  await assert.rejects(
    readNativePdfSource(withPage2((c) => c.replace(CLIP, `1 Ts ${CLIP}`))),
    /PDF 2:.*قص/,
  );
});
