// Small valid PDF fixture with independent, explicit glyph positions and xref.
export function syntheticPdf(
  pages: string[][][],
  fontSize = 10,
  decoration = '',
) {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const kids: number[] = [];
  for (const rows of pages) {
    const id = objects.length + 1;
    kids.push(id);
    const stream =
      rows
        .flatMap((row, i) =>
          row.map(
            (t, j) =>
              `BT /F1 ${fontSize} Tf 1 0 0 1 ${[40, 170, 300, 420][j]} ${750 - i * 20} Tm (${t.replace(/[\\()]/g, (x) => '\\' + x)}) Tj ET`,
          ),
        )
        .join('\n') +
      '\n' +
      decoration;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((s, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${s}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer;
}
