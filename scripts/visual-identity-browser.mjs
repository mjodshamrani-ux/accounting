// Visual identity between two builds, for a change that must not change what
// is drawn: a renamed file, a split module, a refactor (UX-3 first step,
// UX-10). The whole page, before a type is chosen and after each
// workspace's synthetic example ran with every disclosure in it open, is
// captured in Arabic and English at 390 and 1440 px from a baseline build
// and from ./dist, and compared pixel by pixel. Any differing pixel fails.
// --domains=a,b compares only those workspaces, for a step that changes the
// others on purpose. The comparison is not a CI gate, since it needs a
// build of the commit before the change; its self-test is: it compares ./dist
// with itself, plants a faint outline, a faint line along the last row of the
// page and a one-pixel padding into the candidate, and requires the
// comparison to see each and to return to zero without it.
//   BASELINE=work/dist-base node scripts/visual-identity-browser.mjs
//   node scripts/visual-identity-browser.mjs --self-test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { DOMAINS } from './ux-census-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');
const only = args.find((a) => a.startsWith('--domains='));
assert.ok(
  args.every((a) => a === '--self-test' || a.startsWith('--domains=')),
  'flags: --self-test, --domains=a,b',
);
assert.ok(
  process.env.BASELINE || selfTest,
  'BASELINE names the baseline build folder',
);
const builds = {
  baseline: path.resolve(process.env.BASELINE ?? path.join(root, 'dist')),
  candidate: path.join(root, 'dist'),
};
const domains = selfTest
  ? ['bank']
  : only
    ? only.slice('--domains='.length).split(',')
    : DOMAINS;
assert.ok(
  domains.every((d) => DOMAINS.includes(d)),
  `unknown domain in ${domains.join(',')}`,
);
const languages = selfTest ? ['ar'] : ['ar', 'en'];
const widths = selfTest ? [1440] : [390, 1440];
const outRoot =
  process.env.VISUAL_IDENTITY_DIR ?? path.join(root, 'work/visual-identity');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, selfTest ? 'self-test-' : 'run-'));

async function fingerprint(dir) {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((f) => f.isFile())
    .map((f) => path.relative(dir, path.join(f.parentPath, f.name)))
    .sort();
  const hash = createHash('sha256');
  for (const file of files)
    hash.update(`${file}\0`).update(await readFile(path.join(dir, file)));
  return { files: files.length, sha256: hash.digest('hex') };
}
function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const rel = new URL(req.url, 'http://local').pathname;
      const file = path.resolve(dir, '.' + (rel === '/' ? '/index.html' : rel));
      if (!file.startsWith(dir + path.sep)) throw Error('path');
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
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server)),
  );
}
const servers = {
  baseline: await serve(builds.baseline),
  candidate: await serve(builds.candidate),
};
const origin = (build) => `http://127.0.0.1:${servers[build].address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
const external = [],
  errors = [];
const words = {
  ar: { language: 'AR العربية', example: /مثال/u, run: /تحقق وقارن/u },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    run: /Check and compare/u,
  },
};
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 250)),
        ),
      ),
  );

async function open(build, language) {
  const context = await browser.newContext({
    viewport: { width: widths[0], height: widths[0] < 600 ? 844 : 900 },
    reducedMotion: 'reduce',
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.startsWith(origin(build) + '/') ||
      url.startsWith('blob:') ||
      url.startsWith('data:')
    )
      return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${build}: ${error.message}`));
  await page.goto(origin(build) + '/');
  await page
    .getByRole('button', { name: words[language].language, exact: true })
    .click();
  // Ready as the type selector says it is, as the user sees it.
  await page.waitForFunction(
    () =>
      document.querySelector('select[data-reconciliation-type-select]')
        ?.disabled === false,
  );
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}
// The workspace's own synthetic example, as the interface census runs it,
// then every disclosure in the panel opened so its whole drawing is seen.
async function prepare(page, domain, language) {
  const panel = await openDomainWorkspace(page, domain, {
    advanced: true,
    requiredSources: false,
  });
  const selector = `[data-domain-panel="${domain}"]`;
  await panel
    .getByRole('button', { name: words[language].example })
    .first()
    .click();
  if (domain === 'supplier') {
    const run = panel.getByRole('button', { name: words[language].run });
    await run.waitFor({ timeout: 60000 });
    await run.click();
  }
  await page.waitForFunction(
    (s) => !!document.querySelector(s)?.querySelector('table'),
    selector,
    { timeout: 60000 },
  );
  await page.evaluate((s) => {
    for (let pass = 0; pass < 6; pass++) {
      const closed = [...document.querySelectorAll(`${s} details:not([open])`)];
      if (!closed.length) break;
      for (const d of closed) d.open = true;
    }
  }, selector);
  await settle(page);
}
// The whole page, cut into bands no taller than 4000 px, under the height
// the browser can draw into one image or canvas.
async function capture(page) {
  await settle(page);
  const box = await page.evaluate(() => ({
    x: 0,
    y: 0,
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));
  const bands = [];
  for (let y = 0; y < box.height; y += 4000)
    bands.push(
      await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        timeout: 120000,
        clip: {
          x: box.x,
          y: box.y + y,
          width: box.width,
          height: Math.min(4000, box.height - y),
        },
      }),
    );
  return { box, bands };
}

const diffContext = await browser.newContext();
const diffPage = await diffContext.newPage();
async function differ(a, b) {
  if (a.equals(b)) return { pixels: 0 };
  return diffPage.evaluate(
    async ([x, y]) => {
      const load = (data) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.src = 'data:image/png;base64,' + data;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height)
        return {
          pixels: Math.max(ia.width * ia.height, ib.width * ib.height),
          size: [ia.width, ia.height, ib.width, ib.height],
        };
      const read = (image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0);
        return g.getImageData(0, 0, image.width, image.height).data;
      };
      const da = read(ia),
        db = read(ib);
      let pixels = 0,
        top = Infinity,
        bottom = -1;
      for (let i = 0; i < da.length; i += 4)
        if (
          da[i] !== db[i] ||
          da[i + 1] !== db[i + 1] ||
          da[i + 2] !== db[i + 2] ||
          da[i + 3] !== db[i + 3]
        ) {
          pixels++;
          const row = Math.floor(i / 4 / ia.width);
          top = Math.min(top, row);
          bottom = Math.max(bottom, row);
        }
      if (!pixels) return { pixels: 0 };
      const from = Math.max(0, top - 20),
        h = Math.min(ia.height - from, bottom - top + 40, 700);
      const canvas = document.createElement('canvas');
      canvas.width = ia.width;
      canvas.height = h * 2 + 10;
      const g = canvas.getContext('2d');
      g.fillStyle = 'red';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(ia, 0, from, ia.width, h, 0, 0, ia.width, h);
      g.drawImage(ib, 0, from, ib.width, h, 0, h + 10, ib.width, h);
      return { pixels, rows: [top, bottom], crop: canvas.toDataURL() };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}
async function compare(name, a, b) {
  const result = { state: name, size: [a.box.width, a.box.height] };
  if (a.box.width !== b.box.width || a.box.height !== b.box.height) {
    result.size.push(b.box.width, b.box.height);
    result.pixels = Math.max(
      a.box.width * a.box.height,
      b.box.width * b.box.height,
    );
    return result;
  }
  result.pixels = 0;
  for (const [i, band] of a.bands.entries()) {
    const d = await differ(band, b.bands[i]);
    result.pixels += d.pixels;
    if (d.crop) {
      const file = `${name.replaceAll('/', '-')}-band${i}.png`;
      await writeFile(
        path.join(out, file),
        Buffer.from(d.crop.split(',')[1], 'base64'),
      );
      (result.crops ??= []).push(file);
    }
  }
  return result;
}
// Plants for the self-test: a colour one step from white on every cell
// border; a line of that colour along the last row of the page, which a
// capture that stops early would miss; and one pixel of padding under the
// panel. Each is removed before the next, and the comparison must return to
// zero once it is.
const plants = {
  outline: (s) => {
    const style = document.createElement('style');
    style.id = 'visual-identity-plant';
    style.textContent = `${s} td, ${s} th { outline: 1px solid rgb(254 254 254) !important; }`;
    document.head.append(style);
  },
  'last-row': () => {
    const line = document.createElement('div');
    line.id = 'visual-identity-plant-line';
    line.style.cssText = `position: absolute; inset-inline: 0; height: 1px; background: rgb(254 254 254); top: ${document.documentElement.scrollHeight - 1}px`;
    document.body.append(line);
  },
  padding: (s) => {
    document.querySelector(s).style.paddingBottom = '1px';
  },
};
const unplant = (s) => {
  document.getElementById('visual-identity-plant')?.remove();
  document.getElementById('visual-identity-plant-line')?.remove();
  document.querySelector(s).style.paddingBottom = '';
};

let failure;
const report = {
  mode: selfTest ? 'self-test' : 'comparison',
  synthetic: true,
  chromium: browser.version(),
  builds: {
    baseline: {
      folder: builds.baseline,
      ...(await fingerprint(builds.baseline)),
    },
    candidate: {
      folder: builds.candidate,
      ...(await fingerprint(builds.candidate)),
    },
  },
  states: [],
};
try {
  for (const language of languages) {
    if (!selfTest) {
      // The page before a type is chosen.
      const shots = {};
      for (const build of ['baseline', 'candidate']) {
        const { context, page } = await open(build, language);
        shots[build] = [];
        for (const width of widths) {
          await page.setViewportSize({
            width,
            height: width < 600 ? 844 : 900,
          });
          shots[build].push(await capture(page));
        }
        await context.close();
      }
      for (const [i, width] of widths.entries())
        report.states.push(
          await compare(
            `landing/${language}/${width}`,
            shots.baseline[i],
            shots.candidate[i],
          ),
        );
    }
    for (const domain of domains) {
      const shots = {};
      const sessions = {};
      for (const build of ['baseline', 'candidate']) {
        sessions[build] = await open(build, language);
        await prepare(sessions[build].page, domain, language);
        shots[build] = [];
        for (const width of widths) {
          await sessions[build].page.setViewportSize({
            width,
            height: width < 600 ? 844 : 900,
          });
          shots[build].push(await capture(sessions[build].page));
        }
      }
      for (const [i, width] of widths.entries())
        report.states.push(
          await compare(
            `${domain}/${language}/${width}`,
            shots.baseline[i],
            shots.candidate[i],
          ),
        );
      if (selfTest) {
        const { page } = sessions.candidate;
        const selector = `[data-domain-panel="${domain}"]`;
        for (const [plant, apply] of Object.entries(plants)) {
          await page.evaluate(apply, selector);
          const planted = await compare(
            `self-test-${plant}/${domain}/${language}/${widths[0]}`,
            shots.baseline[0],
            await capture(page),
          );
          report.states.push(planted);
          assert.ok(
            planted.pixels > 0,
            `the ${plant} plant is seen by the comparison`,
          );
          await page.evaluate(unplant, selector);
          const removed = await compare(
            `self-test-${plant}-removed/${domain}/${language}/${widths[0]}`,
            shots.baseline[0],
            await capture(page),
          );
          report.states.push(removed);
          assert.equal(
            removed.pixels,
            0,
            `without the ${plant} plant the comparison returns to zero`,
          );
        }
      }
      for (const { context } of Object.values(sessions)) await context.close();
    }
  }
  const differing = report.states.filter(
    (s) => s.pixels !== 0 && !s.state.startsWith('self-test-'),
  );
  assert.deepEqual(
    differing.map((s) => `${s.state}: ${s.pixels}`),
    [],
    'no state differs between the baseline and the candidate',
  );
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} catch (error) {
  failure = error;
} finally {
  report.status = failure ? 'FAIL' : 'PASS';
  report.failure = failure?.message;
  report.external = external;
  report.errors = errors;
  await writeFile(
    path.join(out, 'REPORT.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  for (const server of Object.values(servers))
    await new Promise((resolve) => server.close(resolve));
  console.log(
    `Visual identity (${report.mode}): ${report.status}, ${report.states.length} states, ${out}`,
  );
}
if (failure) throw failure;
