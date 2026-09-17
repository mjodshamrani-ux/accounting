import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';

// Real PDF bytes with explicit graphics operators, resources, lengths and xref.
// These fixtures exercise PDF.js normalization before the visibility guard.
const rows = [
  ['date', 'reference', 'amount'],
  ['2026-08-01', 'INV-001', '1234.56'],
  ['2026-08-02', 'PAY-002', '-20.00'],
];
const text = rows
  .flatMap((row, i) =>
    row.map(
      (value, j) =>
        `BT /F1 10 Tf 1 0 0 1 ${[40, 170, 300][j]} ${750 - i * 20} Tm (${value}) Tj ET`,
    ),
  )
  .join('\n');
const streamObject = (stream: string, attributes = '') =>
  `<< ${attributes} /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
function pdf(stream: string, resources = '', extraObjects: string[] = []) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> ${resources} >> /Contents 5 0 R >>`,
    streamObject(stream),
    ...extraObjects,
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer;
}
const read = (stream: string, resources = '', extraObjects: string[] = []) =>
  readFile('visibility.pdf', pdf(stream, resources, extraObjects), [25, 45]);
const gs = (definition: string) => `/ExtGState << /GS1 << ${definition} >> >>`;

test('native visible PDF transaction text retains signs and exact cells', async () => {
  const file = await read(text);
  assert.deepEqual(file.sheets[0].rows, rows);
  assert.deepEqual(file.sheets[0].rowIssues, {});
});

test('actual PDF rejects transparent and partially transparent fill/stroke text', async () => {
  for (const opacity of [0, 0.5]) {
    for (const mode of [0, 1, 2]) {
      await assert.rejects(
        read(`/GS1 gs ${mode} Tr ${text}`, gs(`/ca ${opacity} /CA ${opacity}`)),
        /شفافية/,
      );
    }
  }
});

test('actual PDF rejects white text in RGB, gray and CMYK color spaces', async () => {
  for (const color of ['1 1 1 rg', '1 g', '0 0 0 0 k'])
    await assert.rejects(read(`${color} ${text}`), /أبيض/);
  await assert.rejects(read(`1 1 1 RG 1 Tr ${text}`), /أبيض/);
});

test('restoring or explicitly resetting color and alpha permits subsequent visible text', async () => {
  for (const prefix of [
    'q /GS1 gs 1 1 1 rg 3 Tr Q',
    '/GS1 gs 1 1 1 rg /GS2 gs 0 0 0 rg',
  ]) {
    const file = await read(
      prefix + '\n' + text,
      '/ExtGState << /GS1 << /ca 0 /CA 0 >> /GS2 << /ca 1 /CA 1 >> >>',
    );
    assert.deepEqual(file.sheets[0].rows, rows);
  }
  // A white page background restored before black text is ordinary PDF content.
  assert.deepEqual(
    (await read(`q 1 g 0 0 600 800 re f Q ${text}`)).sheets[0].rows,
    rows,
  );
});

test('actual PDF rejects clipped transaction text and text clipping modes', async () => {
  for (const clip of ['W', 'W*'])
    await assert.rejects(read(`q 0 0 10 10 re ${clip} n ${text} Q`), /قص/);
  for (const mode of [4, 5, 6])
    await assert.rejects(read(`${mode} Tr ${text}`), /قص/);
  for (const mode of [3, 7])
    await assert.rejects(read(`${mode} Tr ${text}`), /OCR/);
});

test('clipping restored before transaction text does not reject visible data', async () => {
  const file = await read(`q 0 0 10 10 re W n Q ${text}`);
  assert.deepEqual(file.sheets[0].rows, rows);
});

const softMask = streamObject(
  '0 g 0 0 600 800 re f',
  '/Type /XObject /Subtype /Form /BBox [0 0 600 800] /Group << /S /Transparency /CS /DeviceGray >> /Resources << >>',
);
const softMaskResources =
  '/ExtGState << /GS1 << /SMask << /S /Luminosity /G 6 0 R >> >> /GS2 << /SMask /None >> >>';
test('actual PDF soft masks reject text rather than trusting an invisible text layer', async () => {
  await assert.rejects(
    read(`/GS1 gs ${text}`, softMaskResources, [softMask]),
    /إعدادات إظهار محتواه/,
  );
});

test('a disabled soft mask no longer marks later plain text as masked', async () => {
  const file = await read(`/GS1 gs /GS2 gs ${text}`, softMaskResources, [
    softMask,
  ]);
  assert.deepEqual(file.sheets[0].rows, rows);
});

test('unsupported blending rejects active text but a restored blend does not leak', async () => {
  await assert.rejects(
    read(`/GS1 gs ${text}`, gs('/BM /Multiply')),
    /إعدادات إظهار محتواه/,
  );
  assert.deepEqual(
    (await read(`q /GS1 gs Q ${text}`, gs('/BM /Multiply'))).sheets[0].rows,
    rows,
  );
});

test('actual inline raster images reject regardless of area or neighboring native text', async () => {
  for (const [width, height] of [
    [1, 1],
    [30, 30],
    [600, 199],
    [600, 800],
  ]) {
    const raster = `q ${width} 0 0 ${height} 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ`;
    await assert.rejects(read(text + '\n' + raster), /صورة/);
  }
});

test('actual image XObjects and solid image masks cannot bypass the raster guard', async () => {
  const image = streamObject(
    'X',
    '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8',
  );
  await assert.rejects(
    read(text + '\nq 30 0 0 30 0 0 cm /Im1 Do Q', '/XObject << /Im1 6 0 R >>', [
      image,
    ]),
    /صورة/,
  );
  const mask = `q 10 0 0 10 0 0 cm\nBI /W 1 /H 1 /IM true /BPC 1 ID\n\u0000\nEI\nQ`;
  await assert.rejects(read(text + '\n' + mask), /صورة/);
});

test('unsupported Form XObject clipping rejects extracted text with an explicit error', async () => {
  const form = streamObject(
    text,
    '/Type /XObject /Subtype /Form /BBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >>',
  );
  await assert.rejects(
    read('/Form1 Do', '/XObject << /Form1 6 0 R >>', [form]),
    /قص/,
  );
});
