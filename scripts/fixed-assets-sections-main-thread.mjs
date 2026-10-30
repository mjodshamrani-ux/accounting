// How long the page's own replay of the FA-1 review blocks the main thread.
//
// The worker reviews the three files, then the page reads the same bytes
// again and reviews them itself before it shows anything (FA-1c). That second
// review runs on the main thread. This measures, in the built application and
// Chromium, the long tasks (over 50 ms) between the click on the review button
// and the review or its refusal on screen, for the two dense stories at the
// file ceiling and one small story, three times each. It changes nothing and asserts nothing
// about speed: it records what one machine measured.
//
//   pnpm build && node scripts/fixed-assets-sections-main-thread.mjs [--out=file.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.FA_SECTIONS_DIST ?? 'dist');
const foundation = path.resolve('audit/fixed-assets-sections-foundation');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ROLES = ['register-sections', 'category-map', 'gl-balances'];
const RUNS = 3;
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const denseDir = mkdtempSync(path.join(tmpdir(), 'fa1-main-thread-'));
execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), denseDir], {
  stdio: 'ignore',
});
const story = async (folder, id) => {
  const given = await json(path.join(folder, `${id}-input.json`));
  return {
    id,
    files: given.names.map((n) => path.join(folder, n)),
    scope: given.scope,
  };
};
const stories = [
  await story(path.join(foundation, 'frozen'), 'F01'),
  await story(denseDir, 'D1'),
  await story(denseDir, 'D2'),
];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      rel = url.pathname === '/' ? '/index.html' : url.pathname,
      file = path.resolve(root, '.' + decodeURIComponent(rel));
    if (!file.startsWith(root + path.sep)) throw Error('path');
    const b = await readFile(file);
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

let browser;
const report = {
  machine: { cpus: cpus().length, model: cpus()[0]?.model ?? '' },
  runs: RUNS,
  stories: {},
};
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  report.machine.chromium = browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);
  await page.addInitScript(() => {
    globalThis.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        globalThis.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  });
  for (const s of stories) {
    const measured = [];
    for (let run = 0; run < RUNS; run++) {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'assets');
      const details = panel.locator('details[data-fas-details]');
      if ((await details.getAttribute('open')) === null)
        await details.locator(':scope > summary').click();
      const fas = details.locator('[data-fas]');
      const idle = () =>
        page.waitForFunction(
          () =>
            document.querySelector('[data-fas]')?.getAttribute('aria-busy') ===
            'false',
        );
      for (const [side, role] of ROLES.entries()) {
        await fas
          .locator(`input[data-fas-file="${role}"]`)
          .setInputFiles(s.files[side]);
        await idle();
        await fas.locator(`[data-fas-confirm="${role}"]`).check();
      }
      for (const [k, v] of Object.entries(s.scope))
        if (k !== 'confirmed')
          await fas.locator(`[data-fas-scope="${k}"]`).fill(v);
      await fas.locator('[data-fas-scope-confirm]').check();
      const start = await page.evaluate(() => performance.now());
      await fas.getByRole('button', { name: 'Review the register' }).click();
      await fas
        .locator('[data-fas-result], [data-fas-refused], [data-fas-error]')
        .first()
        .waitFor();
      await idle();
      const end = await page.evaluate(() => performance.now());
      const tasks = (await page.evaluate(() => globalThis.longTasks)).filter(
        ([at]) => at >= start && at <= end,
      );
      measured.push({
        shown: await fas.getAttribute('data-fas-state'),
        clickToResultMs: Math.round(end - start),
        longTasks: tasks.length,
        longTaskMs: Math.round(tasks.reduce((n, [, d]) => n + d, 0)),
        longestTaskMs: Math.round(Math.max(0, ...tasks.map(([, d]) => d))),
      });
    }
    report.stories[s.id] = measured;
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(denseDir, { recursive: true, force: true });
}
const out = arg('out');
if (out) await writeFile(out, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
