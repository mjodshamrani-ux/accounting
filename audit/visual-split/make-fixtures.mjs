import { chromium } from 'playwright';
import { createWorker } from 'tesseract.js';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const contract = JSON.parse(
  await readFile('audit/visual-split/contract.json', 'utf8'),
);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const require = createRequire(import.meta.url);
await mkdir('work/visual-split/tessdata', { recursive: true });
for (const lang of ['eng', 'ara'])
  await copyFile(
    resolve(
      dirname(require.resolve('@tesseract.js-data/' + lang + '/package.json')),
      '4.0.0_best_int',
      lang + '.traineddata.gz',
    ),
    'work/visual-split/tessdata/' + lang + '.traineddata.gz',
  );
const browser = await chromium.launch({ headless: true });
const manifest = {};
try {
  for (const lang of ['en', 'ar']) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 860 },
      deviceScaleFactor: 1,
    });
    const literal = (v) =>
      v === null
        ? ''
        : lang === 'ar'
          ? String(v)
              .replace('Total', 'الإجمالي')
              .replaceAll('.', '٫')
              .replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
          : v;
    const cell = (v, col, y, h) =>
      `<div style="position:absolute;left:${contract.grid.columnCuts[col] + 10}px;top:${y}px;width:${contract.grid.columnCuts[col + 1] - contract.grid.columnCuts[col] - 20}px;height:${h}px;display:flex;align-items:center;justify-content:center;font-size:24px;white-space:nowrap;unicode-bidi:isolate-override" dir="${/[\u0621-\u064a]/.test(v) ? 'rtl' : 'ltr'}">${v}</div>`;
    const html = `<!doctype html><html><meta charset="utf-8"><body style="margin:0;background:white;color:#101828;font-family:Arial,sans-serif"><h1 style="position:absolute;left:70px;top:45px;font-size:30px">${lang === 'ar' ? 'كشف مورد اصطناعي للاختبار' : 'Synthetic Supplier Statement'}</h1><div style="position:absolute;left:1120px;top:88px;font-size:24px">SAR</div>${contract.headers[lang].map((v, col) => cell(v, col, 165, 45)).join('')}${contract.rows.map((row, i) => row.map((v, col) => cell(literal(v), col, 220 + i * 80, 80)).join('')).join('')}<svg width="1400" height="860" style="position:absolute;top:0;left:0;pointer-events:none">${contract.grid.rowCuts.map((y) => `<path d="M70 ${y} H1330" stroke="#cbd5e1"/>`).join('')}${contract.grid.columnCuts.map((x) => `<path d="M${x} 165 V780" stroke="#cbd5e1"/>`).join('')}</svg></body></html>`;
    await writeFile(`audit/visual-split/fixtures/${lang}.html`, html);
    await page.setContent(html);
    const bytes = await page.screenshot({
      path: `audit/visual-split/fixtures/${lang}.png`,
    });
    await page.close();
    manifest[lang] = {
      sha256: sha(bytes),
      bytes: bytes.length,
      width: 1400,
      height: 860,
    };
    const worker = await createWorker(['eng', 'ara'], 1, {
      langPath: resolve('work/visual-split/tessdata'),
      corePath: resolve('public/ocr/tesseract-core-lstm.wasm.js'),
      cacheMethod: 'none',
      gzip: true,
      logger: () => {},
    });
    try {
      const { data } = await worker.recognize(
        bytes,
        {},
        { text: true, blocks: true },
      );
      await writeFile(
        `audit/visual-split/fixtures/${lang}-ocr.json`,
        JSON.stringify(data.blocks) + '\n',
      );
      manifest[lang].rawOCRSHA256 = sha(
        Buffer.from(JSON.stringify(data.blocks) + '\n'),
      );
    } finally {
      await worker.terminate();
    }
  }
  await writeFile(
    'audit/visual-split/fixtures/manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(JSON.stringify(manifest));
} finally {
  await browser.close();
}
