// Self-test of settledOn (scripts/decision-platform-support.mjs), the helper
// eight browser checks use to ask that the focus after a decision is on what
// it changed and in view. Under smooth scrolling an item can be in view on
// the page's way and out of view where it comes to rest (DEV-93), so the
// helper measures where the page rests. On a synthetic page with exact
// timing: the decided item is in view when the focus lands; the control must
// pass, and the plant, a smooth scroll away 250 ms later that rests with the
// item out of view, must fail by assertion. A helper that measures at the
// first moment the item is in view passes the plant, and this test fails.
//   node scripts/decision-platform-support-self-test.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { settledOn } from './decision-platform-support.mjs';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const html = `<!doctype html><style>html{scroll-behavior:smooth}
body{margin:0;height:6000px}#t{position:absolute;top:500px;height:40px}</style>
<div id="t" tabindex="-1" data-decision-item>decided</div>`;
async function outcome(plant) {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  try {
    await page.setContent(html);
    await page.evaluate((late) => {
      document.getElementById('t').focus({ preventScroll: true });
      if (late) setTimeout(() => window.scrollBy({ top: 3000 }), 250);
    }, plant);
    await settledOn(page, page.locator('#t'), plant ? 'plant' : 'control');
    return 'passed';
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message;
    throw error;
  } finally {
    await page.close();
  }
}
try {
  const control = await outcome(false);
  const plant = await outcome(true);
  console.log(JSON.stringify({ control, plant }));
  assert.equal(control, 'passed', 'the control passes');
  assert.equal(
    plant,
    'plant: and it is in view',
    'a page that rests with the decided item out of view fails',
  );
  console.log('settledOn self-test: passed');
} finally {
  await browser.close();
}
