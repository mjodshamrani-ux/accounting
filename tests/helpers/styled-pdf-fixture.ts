// Synthetic values and compact PDF operators. No user file or financial data.
export function syntheticStyledPdf(cover = false) {
  const text = (x: number, y: number, value: string) =>
    `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${value}) Tj ET`;
  const stream = [
    text(40, 780, 'Statement'),
    'q 0.96 0.98 0.99 rg 30 695 500 70 re f Q',
    'q 0.09 0.21 0.36 rg 30 744 500 21 re f Q',
    '1 g',
    text(40, 750, 'date'),
    text(170, 750, 'reference'),
    text(300, 750, 'amount'),
    '0 g',
    text(40, 730, '02-Jul-2026'),
    text(170, 730, 'SYN-7001'),
    text(300, 730, '1250.00'),
    text(40, 710, '12-Jul-2026'),
    text(170, 710, 'SYN-CN-2'),
    text(300, 710, '-150.00'),
    'q 0.5 G 0.5 w 30 695 500 70 re 150 695 m 150 765 l 270 695 m 270 765 l 30 745 m 530 745 l 30 725 m 530 725 l S Q',
    cover ? 'q 1 g 298 725 60 15 re f Q' : '',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 820] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output).buffer;
}
