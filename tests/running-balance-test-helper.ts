import { readFile as readNative } from '../lib/reconciliation/io.ts';
import { RUNNING_CUTS } from '../lib/reconciliation/running-balance.ts';
/** Test-only independently authored ASCII PDF; no product result creates truth. */
export function runningSyntheticPdf(pages: string[][][]): ArrayBuffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const kids: number[] = [];
  for (const page of pages) {
    const commands: string[] = [];
    page.forEach((values, ri) =>
      values.forEach((value, ci) => {
        if (value) {
          if (!/^[\x20-\x7e]*$/.test(value))
            throw new Error('ASCII test PDF only');
          const literal = value
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
          const fontSize = Math.min(
            8,
            [180, 280, 280, 480, 220, 200, 200][ci] / (0.6 * value.length),
          );
          commands.push(
            `BT /F1 ${fontSize.toFixed(6)} Tf 1 0 0 1 ${[20, 220, 520, 820, 1320, 1560, 1780][ci]} ${1500 - ri * 35} Tm (${literal}) Tj ET`,
          );
        }
      }),
    );
    const data = commands.join('\n');
    const stream = objects.length + 1;
    objects.push(`<< /Length ${data.length} >>\nstream\n${data}\nendstream`);
    const id = objects.length + 1;
    kids.push(id);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 1600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.7\n% SYNTHETIC ONLY RUNNING BALANCE TEST\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer;
}
export function readRunningSyntheticPages(
  pages: string[][][],
  name = 'synthetic-running.pdf',
) {
  return readNative(
    name,
    runningSyntheticPdf(pages),
    [...RUNNING_CUTS],
    false,
    undefined,
    32767,
  );
}
