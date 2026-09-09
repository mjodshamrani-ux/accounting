import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';

function pdf(stream: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer;
}
const text =
  'BT /F1 10 Tf 1 0 0 1 40 730 Tm (2026-08-01) Tj ET\nBT /F1 10 Tf 1 0 0 1 170 730 Tm (INV-100) Tj ET\nBT /F1 10 Tf 1 0 0 1 300 730 Tm (1250.00) Tj ET';
const read = (stream: string) =>
  readFile('synthetic.pdf', pdf(stream), [25, 45]);
test('PDF cannot read covered amount text through an opaque vector rectangle', async () => {
  await assert.rejects(read(text + '\nq 1 g 298 725 60 20 re f Q'), /رسم|تغط/);
  await assert.rejects(
    read(text + '\nq 0 1 1 0 280 700 cm 0 g 20 0 30 100 re f Q'),
    /رسم|تغط/,
  );
});
test('PDF black background cannot silently conceal black transaction text', async () => {
  await assert.rejects(read('q 0 g 298 725 60 20 re f Q\n' + text), /رسم|تغط/);
});
test('ordinary white backgrounds and disjoint table lines preserve actual text', async () => {
  for (const decoration of [
    'q 1 g 0 0 600 800 re f Q\n' + text,
    text + '\nq 0 G 1 w 30 715 m 500 715 l S Q',
  ]) {
    const result = await read(decoration);
    assert.deepEqual(result.sheets[0].rows, [
      ['2026-08-01', 'INV-100', '1250.00'],
    ]);
  }
});
