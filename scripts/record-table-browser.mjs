// The frame of the shared record table (UX-3), as the reader meets it: the
// payroll example in Arabic and English at 390 px, where its tables are
// wider than the screen. Every frame wider than its table space is a named
// region the keyboard reaches, says that it scrolls, and marks the side
// where columns lie out of view: the left at the start of an Arabic table
// and the right at its end, the mirror in English. The shade is measured as
// drawn: a picture of the frame with its mark is darker than one without it
// along the marked side, and nowhere else beyond the anti-aliasing of text.
// A frame that fits is none of these. Then long text is read whole: in the
// receivables and gateway examples, Arabic and English at 390 and 1440 px,
// no cell of a record table is cut off, and the fields of a source row each
// stay on one line, so a wrapped row breaks between fields, never inside a
// date, an identity or a hyphenated word. Synthetic example only; no
// financial truth is asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const dist = path.resolve(import.meta.dirname, '../dist');
const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
const external = [],
  errors = [];
// Pictures are compared in a page of their own, away from the application.
const diffContext = await browser.newContext();
const diffPage = await diffContext.newPage();
// How much darker each column of the frame's picture is with its side mark
// than without it, in levels of 255 averaged down the column: the frame is
// captured with the mark and again with the mark taken away for a moment.
// The picture is what the screen shows of the frame, below the bar at the
// top: a frame taller than the screen captured whole is drawn without its
// shade, as Chromium captures beyond the screen, though the screen shows it.
async function shade(page, frame, side) {
  await frame.evaluate((f) => f.scrollIntoView({ block: 'center' }));
  const box = await frame.boundingBox(),
    height = page.viewportSize().height,
    top = Math.max(box.y, 96),
    clip = {
      x: box.x,
      y: top,
      width: box.width,
      height: Math.min(box.y + box.height, height - 8) - top,
    };
  const shoot = () =>
    page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const marked = await shoot();
  await frame.evaluate((f, s) => f.removeAttribute(s), side);
  const plain = await shoot();
  await frame.evaluate((f, s) => f.setAttribute(s, ''), side);
  return diffPage.evaluate(
    async ([x, y]) => {
      const load = (data) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.src = 'data:image/png;base64,' + data;
        });
      const read = (image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0);
        return g.getImageData(0, 0, image.width, image.height).data;
      };
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const da = read(ia),
        db = read(ib),
        dark = Array.from({ length: ia.width }, () => 0);
      for (let i = 0; i < da.length; i += 4)
        dark[(i / 4) % ia.width] +=
          (db[i] + db[i + 1] + db[i + 2] - da[i] - da[i + 1] - da[i + 2]) /
          3 /
          ia.height;
      return dark;
    },
    [marked.toString('base64'), plain.toString('base64')],
  );
}
// The shade of the marked side is drawn along it, past the frame's border,
// and the rest of the frame keeps its colours: what changes there is the
// anti-aliasing of text, under one level in any column. The shade lies
// under the cells, so the header row's own background covers it: it is
// measured on frames whose table has rows, and a table of headers alone
// says that it scrolls by its name and its marks.
let drawn = 0,
  headersOnly = 0;
async function assertShade(page, frame, side, label) {
  if (!(await frame.evaluate((f) => f.querySelector('tbody td') !== null))) {
    headersOnly++;
    return;
  }
  drawn++;
  const dark = await shade(page, frame, side),
    left = side === 'data-more-left',
    w = dark.length,
    strip = left ? dark.slice(1, 13) : dark.slice(w - 13, w - 1),
    level = strip.reduce((a, b) => a + b, 0) / strip.length,
    rest = (left ? dark.slice(24) : dark.slice(0, w - 24)).reduce(
      (a, b) => Math.max(a, Math.abs(b)),
      0,
    );
  assert.ok(
    level >= 3,
    `${label}: the ${side} shade is drawn along its side (${level.toFixed(2)} levels)`,
  );
  assert.ok(
    rest < 1,
    `${label}: nothing else in the frame changes with the ${side} mark (${rest.toFixed(2)} levels)`,
  );
}
const words = {
  ar: { language: 'AR العربية', example: /مثال/u, wide: /أعرض من إطاره/u },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    wide: /wider than its frame/u,
  },
};
let checked = 0,
  whole = 0,
  fields = 0;
// Long text read whole (UX-3): no cell cut off, no field of a source row
// broken across lines.
async function readWhole(domain, language, width) {
  const label = `${domain}/${language}/${width}`;
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    reducedMotion: 'reduce',
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.startsWith(base + '/') ||
      url.startsWith('blob:') ||
      url.startsWith('data:')
    )
      return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/');
  await page
    .getByRole('button', { name: words[language].language, exact: true })
    .click();
  const panel = await openDomainWorkspace(page, domain, {
    advanced: true,
    requiredSources: false,
  });
  await panel
    .getByRole('button', { name: words[language].example })
    .first()
    .click();
  const selector = `[data-domain-panel="${domain}"]`;
  await page.waitForFunction(
    (s) => !!document.querySelector(`${s} .record-frame tbody td`),
    selector,
    { timeout: 60000 },
  );
  await page.waitForTimeout(400);
  const seen = await page.evaluate((s) => {
    const cut = [],
      broken = [];
    let cells = 0,
      parts = 0;
    for (const cell of document.querySelectorAll(
      `${s} .record-frame :is(td, th)`,
    )) {
      if (!cell.checkVisibility()) continue;
      cells++;
      if (
        cell.scrollWidth > cell.clientWidth + 1 &&
        /^(hidden|clip)$/u.test(getComputedStyle(cell).overflowX)
      )
        cut.push(cell.textContent.trim().slice(0, 60));
    }
    for (const field of document.querySelectorAll(`${s} .record-field`)) {
      if (!field.checkVisibility() || !field.textContent.trim()) continue;
      parts++;
      const lines = new Set(
        [...field.getClientRects()].map((r) => Math.round(r.top)),
      );
      if (lines.size > 1) broken.push(field.textContent.trim().slice(0, 40));
    }
    return { cells, cut, parts, broken };
  }, selector);
  assert.ok(seen.cells > 0, `${label}: record cells shown`);
  assert.deepEqual(seen.cut, [], `${label}: no cell is cut off`);
  assert.deepEqual(
    seen.broken,
    [],
    `${label}: every field of a source row stays on one line`,
  );
  if (domain === 'ar')
    assert.ok(seen.parts > 0, `${label}: the source rows are shown by field`);
  whole += seen.cells;
  fields += seen.parts;
  await context.close();
}
try {
  for (const language of ['ar', 'en']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.startsWith(base + '/') ||
        url.startsWith('blob:') ||
        url.startsWith('data:')
      )
        return route.continue();
      external.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/');
    await page
      .getByRole('button', { name: words[language].language, exact: true })
      .click();
    const panel = await openDomainWorkspace(page, 'payroll', {
      advanced: true,
      requiredSources: false,
    });
    await panel
      .getByRole('button', { name: words[language].example })
      .first()
      .click();
    await page.waitForFunction(
      () =>
        !!document.querySelector('[data-domain-panel="payroll"] .record-frame'),
      null,
      { timeout: 60000 },
    );
    // Every closed section opened, so every frame is seen and measured.
    await page.evaluate(() => {
      for (let pass = 0; pass < 6; pass++)
        for (const d of document.querySelectorAll(
          '[data-domain-panel="payroll"] details:not([open])',
        ))
          d.open = true;
    });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const frames = page.locator('[data-domain-panel="payroll"] .record-frame');
    const count = await frames.count();
    assert.ok(count > 3, `${language}: record frames shown (${count})`);
    let wide = 0;
    for (let i = 0; i < count; i++) {
      const frame = frames.nth(i);
      if (!(await frame.isVisible())) continue;
      await frame.scrollIntoViewIfNeeded();
      const at = () =>
        frame.evaluate((f) => ({
          wider: f.scrollWidth > f.clientWidth + 1,
          role: f.getAttribute('role'),
          tab: f.getAttribute('tabindex'),
          name: f.getAttribute('aria-label') ?? '',
          table: f.querySelector('table')?.getAttribute('aria-label') ?? '',
          left: f.hasAttribute('data-more-left'),
          right: f.hasAttribute('data-more-right'),
        }));
      const start = await at();
      if (!start.wider) {
        assert.deepEqual(
          [start.role, start.tab, start.left, start.right],
          [null, null, false, false],
          `${language}: a frame that fits is plain (${start.table})`,
        );
        continue;
      }
      wide++;
      assert.equal(
        start.role,
        'region',
        `${language}: ${start.table} is a region`,
      );
      assert.equal(
        start.tab,
        '0',
        `${language}: ${start.table} takes the keyboard`,
      );
      assert.ok(
        start.table &&
          start.name.startsWith(start.table) &&
          words[language].wide.test(start.name),
        `${language}: ${start.table} is named and says it scrolls (${start.name})`,
      );
      // At the start of the table, columns continue towards the end of the
      // reading direction: the left in Arabic, the right in English.
      assert.deepEqual(
        [start.left, start.right],
        language === 'ar' ? [true, false] : [false, true],
        `${language}: ${start.table} at its start`,
      );
      await assertShade(
        page,
        frame,
        language === 'ar' ? 'data-more-left' : 'data-more-right',
        `${language}: ${start.table} at its start`,
      );
      await frame.evaluate((f) => {
        f.scrollLeft =
          getComputedStyle(f).direction === 'rtl'
            ? -f.scrollWidth
            : f.scrollWidth;
      });
      // The mark follows the scroll: it is given a moment to move, and then
      // the frame says where it is, so a mark that stays put fails the
      // assertion below rather than a wait.
      await page
        .waitForFunction(
          (args) => {
            const f = document.querySelectorAll(
              '[data-domain-panel="payroll"] .record-frame',
            )[args.i];
            return f.hasAttribute(args.side);
          },
          {
            i,
            side: language === 'ar' ? 'data-more-right' : 'data-more-left',
          },
          { timeout: 5000 },
        )
        .catch(() => {});
      const end = await at();
      assert.deepEqual(
        [end.left, end.right],
        language === 'ar' ? [false, true] : [true, false],
        `${language}: ${start.table} at its end`,
      );
      await assertShade(
        page,
        frame,
        language === 'ar' ? 'data-more-right' : 'data-more-left',
        `${language}: ${start.table} at its end`,
      );
      checked++;
    }
    assert.ok(wide > 0, `${language}: wide frames found at 390 px`);
    await context.close();
  }
  for (const domain of ['ar', 'gateway'])
    for (const language of ['ar', 'en'])
      for (const width of [390, 1440]) await readWhole(domain, language, width);
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} finally {
  await diffContext.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `Record table frames: PASS, ${checked} wide frames in Arabic and English at 390 px; the shade measured on both sides of ${drawn / 2} with rows, ${headersOnly / 2} of headers alone; long text read whole in ${whole} cells and ${fields} source row fields of the receivables and gateway examples`,
);
