import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Expectations exist before OCR. Regions are known by this drawing contract,
// not detected by the application; this does not measure table segmentation.
const values = [
  ['arabic-grouped', '١٬٢٥٠٫٠٠'],
  ['arabic-minus', '-٢٥٠٫٠٠'],
  ['arabic-total', '١٬٠٠٠٫٠٠'],
  ['arabic-zero', '٠٫٠٠'],
  ['arabic-parentheses', '(١٢٥٫٥٠)'],
  ['arabic-plus', '+٢٠٠٫٠٠'],
  ['arabic-short', '١٢٫٣٤'],
  ['arabic-large', '١٬٢٣٤٬٥٦٧٫٨٩'],
  ['arabic-unicode-minus', '−٢٥٠٫٠٠'],
  ['arabic-trailing-minus', '٢٥٠٫٠٠-'],
  ['persian-grouped', '۱٬۲۵۰٫۰۰'],
  ['ascii-minus', '-1,250.00'],
  ['ascii-parentheses', '(125.50)'],
  ['blank-control', ''],
  ['dash-control', '—'],
  ['letters-control', 'O.OO'],
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const fixture = await page.evaluate((rows) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1520;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '48px Arial';
    context.fillText('SUPPLIER / كشف المورد', 80, 80);
    const cells = rows.map(([id, expected], index) => {
      const baseline = 165 + index * 82;
      const font = index === 10 || index === 12 ? '40px Tahoma' : '48px Arial';
      context.direction = 'ltr';
      context.textAlign = 'left';
      context.font = '30px Arial';
      context.fillText(
        `ROW-${String(index + 1).padStart(2, '0')}`,
        80,
        baseline,
      );
      context.font = font;
      context.fillText(expected, 570, baseline);
      // A neighboring balance must not leak into the amount's crop.
      context.font = '32px Arial';
      context.fillText('9,999.00', 1230, baseline);
      return {
        id,
        expected,
        font,
        kind: id.endsWith('control') ? 'non-amount' : 'amount',
        rectangle: { left: 550, top: baseline - 62, width: 610, height: 78 },
      };
    });
    return { png: canvas.toDataURL('image/png').split(',')[1], cells };
  }, values);
  const image = Buffer.from(fixture.png, 'base64');
  const contract = {
    version: 1,
    classification:
      'known synthetic development; not holdout, training or field evidence',
    renderer: {
      browser: browser.version(),
      canvas: 'native Chromium 2D',
      fonts: 'Arial/Tahoma platform fonts',
    },
    source: {
      name: 'amounts.png',
      width: 1600,
      height: 1520,
      bytes: image.length,
      sha256: createHash('sha256').update(image).digest('hex'),
    },
    cells: fixture.cells,
    limitation:
      'Known hand-drawn regions. No automatic row coverage or financial promotion.',
  };
  await mkdir('audit/visual-numeric/fixtures', { recursive: true });
  await writeFile('audit/visual-numeric/fixtures/amounts.png', image);
  await writeFile(
    'audit/visual-numeric/fixtures/contract.json',
    JSON.stringify(contract, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      sha256: contract.source.sha256,
      cells: contract.cells.length,
      frozenBeforeOcr: true,
    }),
  );
} finally {
  await browser.close();
}
