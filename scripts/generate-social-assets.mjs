import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline artwork from the same vector and unmodified fonts as the website.
// Run intentionally when changing the identity; ordinary builds use these PNGs.
const root = fileURLToPath(new URL('../', import.meta.url));
const file = (name) => path.join(root, name);
const font = async (name) => (await readFile(file(`public/fonts/${name}`))).toString('base64');
const mark = await readFile(file('public/brand/tarasuf-mark.svg'), 'utf8');
const [displayFont, bodyFont] = await Promise.all([
  font('thmanyah-serif-display-bold.woff2'),
  font('noto-sans-arabic-variable.woff2'),
]);
await mkdir(file('public/brand'), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @font-face { font-family: Thmanyah; src: url(data:font/woff2;base64,${displayFont}) format('woff2'); font-weight: 700; }
    @font-face { font-family: Noto; src: url(data:font/woff2;base64,${bodyFont}) format('woff2'); font-weight: 100 900; }
    * { box-sizing: border-box; }
    html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; background: #fff; }
    main { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 64px; color: #0A1B2E; }
    .identity { display: flex; align-items: center; justify-content: center; gap: 46px; height: 252px; }
    .identity svg { width: 133px; height: 188px; flex: none; }
    h1 { margin: 0; font: 700 174px/1.45 Thmanyah; font-synthesis: none; white-space: nowrap; }
    p { margin: 28px 0 0; font: 400 39px/1.75 Noto; color: #4c5870; white-space: nowrap; }
  </style></head><body><main><div class="identity">${mark}<h1>تَـراصُـف</h1></div><p>وضوح أكثر في تسوياتك</p></main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('700 174px Thmanyah') && document.fonts.check('400 39px Noto')), true);
  for (const selector of ['.identity', 'h1', 'p']) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds && bounds.x >= 40 && bounds.y >= 40 && bounds.x + bounds.width <= 1160 && bounds.y + bounds.height <= 590, `${selector} stays inside the card safe area`);
  }
  await page.screenshot({ path: file('public/brand/tarasuf-share-v048.png'), animations: 'disabled' });
  for (const [size, output] of [[180, 'public/brand/apple-touch-icon.png'], [32, 'public/favicon.png']]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#fff}body{display:grid;place-items:center}svg{height:74%;width:auto}</style>${mark}`);
    await page.screenshot({ path: file(output), animations: 'disabled' });
  }
  console.log('Rendered social card (1200 × 630), Apple icon (180 × 180), and favicon (32 × 32) from original brand assets.');
} finally {
  await browser.close();
}
