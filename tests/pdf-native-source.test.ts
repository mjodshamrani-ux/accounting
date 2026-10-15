import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile as bytes } from 'node:fs/promises';
import { readNativePdfSource, readPdf } from '../lib/reconciliation/pdf.ts';
import { PdfOperatorStreamError } from '../lib/reconciliation/pdf-stream-integrity.ts';
import { ImportDiagnosticError } from '../lib/reconciliation/import-diagnostics.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const rows = [
  ['Item', 'Quantity', 'Value'],
  ['0008', '1.250', '-410.125'],
  ['00', '0', '0.000'],
];
const sha = (b: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const tokenText = (s: Awaited<ReturnType<typeof readNativePdfSource>>) =>
  s.pages.map((p) => p.tokens.map((t) => t.text));
const source = (decoration = '') => syntheticPdf([rows], 10, decoration);

void test('native source: exact literals, page coordinates, physical item IDs and original hash', async () => {
  const original = source();
  const result = await readNativePdfSource(original);
  assert.equal(result.version, 'native-pdf-source-1');
  assert.equal(result.coordinateSystem, 'visible-page-bottom-left-pdf-units');
  assert.equal(result.sha256, sha(original));
  assert.equal(result.byteLength, original.byteLength);
  assert.deepEqual(result.readingIssues, []);
  assert.equal(result.pages.length, 1);
  const page = result.pages[0];
  assert.deepEqual(page.view, [0, 0, 600, 800]);
  assert.equal(page.width, 600);
  assert.equal(page.height, 800);
  assert.equal(page.page, 1);
  assert.deepEqual(tokenText(result), [rows.flat()]);
  for (const [index, token] of page.tokens.entries()) {
    assert.equal(token.x, [40, 170, 300][index % 3]);
    assert.equal(token.y, 750 - Math.floor(index / 3) * 20);
    assert.ok(Math.abs(token.width - token.text.length * 6) < 1e-8);
    assert.equal(token.height, 10);
    assert.equal(token.glyphText, token.text);
    assert.ok(Number.isInteger(token.item) && token.item > 0);
    if (index) assert.ok(token.item > page.tokens[index - 1].item);
  }
  assert.equal('sheets' in result, false);
  assert.equal('matches' in result, false);
  assert.equal('financialApproval' in result, false);
});

void test('native source: own bytes before any await and expose no mutable cache', async () => {
  const input = source(),
    expectedHash = sha(input);
  const pending = readNativePdfSource(input);
  new Uint8Array(input).fill(0);
  const result = await pending.catch((error: unknown) =>
    assert.fail('Owned input must survive caller mutation: ' + String(error)),
  );
  assert.equal(result.sha256, expectedHash);
  assert.deepEqual(tokenText(result), [rows.flat()]);
  result.pages[0].tokens[0].text = 'foreign';
  result.pages[0].view[0] = 500;
  result.readingIssues.push({ page: 1, line: 1, reasons: ['foreign'] });
  const again = await readNativePdfSource(source());
  assert.deepEqual(tokenText(again), [rows.flat()]);
  assert.deepEqual(again.pages[0].view, [0, 0, 600, 800]);
  assert.deepEqual(again.readingIssues, []);
  const changed = await readNativePdfSource(
    syntheticPdf([[['Other', '1', '2']]]),
  );
  assert.notEqual(changed.sha256, expectedHash);
});

void test('native source: the legacy projection owns input bytes and cuts before any await', async () => {
  const input = source(),
    cuts = [25, 45];
  const pending = readPdf(input, cuts);
  new Uint8Array(input).fill(0);
  cuts[0] = 99;
  const result = await pending.catch((error: unknown) =>
    assert.fail('Owned input must survive caller mutation: ' + String(error)),
  );
  assert.deepEqual(result.sheets[0].rows, rows);
  assert.deepEqual(result.pdf.cuts, [25, 45]);
});

void test('native source: all pages retain page-local item ownership and exact progress', async () => {
  const progress: { stage: string; completed: number; total: number }[] = [];
  const input = syntheticPdf([rows, [['Other', '12.5', '0.125']], rows]);
  const result = await readNativePdfSource(input, (p) => progress.push(p));
  assert.deepEqual(
    result.pages.map((p) => p.page),
    [1, 2, 3],
  );
  assert.deepEqual(tokenText(result), [
    rows.flat(),
    ['Other', '12.5', '0.125'],
    rows.flat(),
  ]);
  assert.deepEqual(
    progress,
    [0, 1, 2, 3].map((completed) => ({
      stage: 'pdf-read',
      completed,
      total: 3,
    })),
  );
  assert.equal(result.pages[0].tokens[0].item, result.pages[2].tokens[0].item);
  assert.notEqual(result.pages[0], result.pages[2]);
});

void test('native source: cropped page coordinates are relative to its visible origin', async () => {
  // Equal-length replacement preserves the independent writer's xref offsets.
  const original = new TextDecoder().decode(source());
  const input = new TextEncoder().encode(
    original.replace('/MediaBox [0 0 600 800]', '/MediaBox [5 7 605 807]'),
  ).buffer;
  assert.notEqual(new TextDecoder().decode(input), original);
  const result = await readNativePdfSource(input);
  assert.deepEqual(result.pages[0].view, [5, 7, 605, 807]);
  assert.equal(result.pages[0].tokens[0].x, 35);
  assert.equal(result.pages[0].tokens[0].y, 743);
  assert.equal(result.pages[0].width, 600);
  assert.equal(result.pages[0].height, 800);
});

void test('native source: retain overlapping-text diagnostics and both source tokens', async () => {
  const result = await readNativePdfSource(
    source('BT /F1 10 Tf 1 0 0 1 301 710 Tm (9.000) Tj ET'),
  );
  assert.ok(
    result.readingIssues.some((i) => i.page === 1 && i.reasons.length > 0),
  );
  assert.ok(result.pages[0].tokens.some((t) => t.text === '0.000'));
  assert.ok(result.pages[0].tokens.some((t) => t.text === '9.000'));
});

for (const [name, decoration, reason] of [
  ['white text', '1 g BT /F1 10 Tf 1 0 0 1 300 650 Tm (999) Tj ET', /أبيض/],
  ['invisible text', '3 Tr BT /F1 10 Tf 1 0 0 1 300 650 Tm (999) Tj ET', /OCR/],
  [
    'clipped text',
    'q 0 0 10 10 re W n BT /F1 10 Tf 1 0 0 1 300 650 Tm (999) Tj ET Q',
    /قص/,
  ],
  ['covering paint', 'q 0 g 300 709 50 12 re f Q', /يغطي|يتداخل|تغطية/],
  [
    'low contrast text',
    '0.9 g BT /F1 10 Tf 1 0 0 1 300 650 Tm (999) Tj ET',
    /تباين|لون|وضوح|أبيض/,
  ],
] as const) {
  void test(
    'native source: cannot bypass ' + name + ' visibility guard',
    async () => {
      await assert.rejects(readNativePdfSource(source(decoration)), reason);
      assert.deepEqual(tokenText(await readNativePdfSource(source())), [
        rows.flat(),
      ]);
    },
  );
}

void test('native source: mixed raster content retains the existing visual-review diagnosis', async () => {
  await assert.rejects(
    readNativePdfSource(
      source('q 1 0 0 1 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ'),
    ),
    (error: unknown) =>
      error instanceof ImportDiagnosticError &&
      error.diagnosis.code === 'PDF_IMAGE_CONTENT',
  );
});

void test('native source: late failed operator streams expose no accepted document prefix', async () => {
  const decoration = 'q 0 g 1 1 1 1 re f Q\n'.repeat(1000) + '/Missing sh';
  const progress: number[] = [];
  await assert.rejects(
    readNativePdfSource(syntheticPdf([rows, rows], 10, decoration), (p) =>
      progress.push(p.completed),
    ),
    PdfOperatorStreamError,
  );
  assert.deepEqual(progress, [0]);
  assert.deepEqual(tokenText(await readNativePdfSource(source())), [
    rows.flat(),
  ]);
});

void test('native source: last-page font failure never returns earlier page geometry', async () => {
  // Missing font on page 2; same-length replacement preserves all xref offsets.
  const input = syntheticPdf([rows, [['Late', '1', '2']]]);
  const text = new TextDecoder().decode(input);
  const pos = text.lastIndexOf('/F1 10 Tf');
  const bad =
    text.slice(0, pos) + text.slice(pos).replace('/F1 10 Tf', '/F9 10 Tf');
  const progress: number[] = [];
  await assert.rejects(
    readNativePdfSource(new TextEncoder().encode(bad).buffer, (p) =>
      progress.push(p.completed),
    ),
    /PDF|خط/,
  );
  assert.ok(progress.includes(1));
  assert.ok(!progress.includes(2));
  assert.deepEqual(tokenText(await readNativePdfSource(source())), [
    rows.flat(),
  ]);
});

void test('native source: invalid signatures, bytes and page counts keep resource bounds', async () => {
  await assert.rejects(readNativePdfSource(new ArrayBuffer(0)), /PDF/);
  await assert.rejects(
    readNativePdfSource(new ArrayBuffer(8 * 1024 * 1024 + 1)),
    /8 MB/,
  );
  await assert.rejects(
    readNativePdfSource(
      syntheticPdf(Array.from({ length: 101 }, () => [['1']])),
    ),
    /100 صفحة/,
  );
});

const unicodeRoot = new URL('../audit/native-unicode/frozen/', import.meta.url);
for (const name of [
  'letters',
  'private-use',
  'compressed',
  'ranged',
  'multi-map',
  'unicode-reference',
]) {
  void test(
    'native source: preserve real ' +
      name +
      ' Unicode glyph/extraction evidence',
    async () => {
      const raw = await bytes(new URL(name + '.pdf', unicodeRoot));
      const expected = JSON.parse(
        await bytes(new URL(name + '.json', unicodeRoot), 'utf8'),
      ) as {
        sourceSha256: string;
        rows: string[][];
      };
      const result = await readNativePdfSource(Uint8Array.from(raw).buffer);
      assert.equal(result.sha256, expected.sourceSha256);
      assert.equal(result.pages.length, 1);
      for (const value of expected.rows.flat().filter((t) => t.trim()))
        assert.ok(
          result.pages[0].tokens.some((t) => t.text === value),
          value,
        );
    },
  );
}
for (const name of [
  'high-only',
  'low-only',
  'high-ascii',
  'reversed',
  'double-high',
  'odd-byte',
  'mixed-font',
]) {
  void test(
    'native source: malformed ' +
      name +
      ' font mappings cannot use the geometry route',
    async () => {
      const raw = await bytes(new URL('invalid-' + name + '.pdf', unicodeRoot));
      await assert.rejects(
        readNativePdfSource(Uint8Array.from(raw).buffer),
        /PDF/,
      );
    },
  );
}
