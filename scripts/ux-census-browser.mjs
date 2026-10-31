// The interface census: the defect classes the October 2026 interface audit
// found, counted in every workspace after its synthetic example runs, in
// Arabic and English at 390 and 1440 px, and compared with the figures
// recorded in audit/ux-census/baseline.json. Any difference fails the gate:
// a higher count is a new defect; a lower one is an improvement, recorded
// with --record so the baseline stays exact. --self-test plants one fault of
// each class into a rendered page and requires the census to count it.
// Synthetic examples only; no financial truth is asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import {
  DOMAINS,
  METRICS,
  STATES,
  censusInPage,
  compare,
  focusInPage,
  plantInPage,
  sumStates,
} from './ux-census-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const baselinePath = path.join(root, 'audit/ux-census/baseline.json');
const flags = new Set(process.argv.slice(2));
assert.ok(
  [...flags].every((flag) => flag === '--record' || flag === '--self-test'),
  'flags: --record, --self-test',
);
const record = flags.has('--record'),
  selfTest = flags.has('--self-test');
const outRoot = process.env.UX_CENSUS_DIR ?? path.join(root, 'work/ux-census');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, selfTest ? 'self-test-' : 'run-'));

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
const words = {
  ar: { language: 'AR العربية', example: /مثال/u, run: /تحقق وقارن/u },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    run: /Check and compare/u,
  },
};

async function open(language, width) {
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
  return { context, page };
}
// Lets layout and fonts settle after a change before anything is measured.
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 250)),
        ),
      ),
  );
// Runs the workspace's own synthetic example and waits for a result table.
async function runExample(page, panel, domain, language) {
  const selector = `[data-domain-panel="${domain}"]`;
  const example = panel
    .getByRole('button', { name: words[language].example })
    .first();
  assert.ok(await example.count(), `${domain}/${language}: no example button`);
  const label = (await example.innerText()).trim();
  await example.click();
  if (domain === 'supplier') {
    // The supplier example loads the sources; the comparison is one more step.
    const run = panel.getByRole('button', { name: words[language].run });
    await run.waitFor({ timeout: 60000 });
    await run.click();
  }
  await page.waitForFunction(
    (s) => !!document.querySelector(s)?.querySelector('table'),
    selector,
    { timeout: 60000 },
  );
  await settle(page);
  return label;
}
async function measureDomain(domain) {
  const states = [];
  for (const language of ['ar', 'en']) {
    const widths = STATES.filter((s) => s.language === language).map(
      (s) => s.width,
    );
    const { context, page } = await open(language, widths[0]);
    try {
      const panel = await openDomainWorkspace(page, domain, {
        advanced: true,
        requiredSources: false,
      });
      const selector = `[data-domain-panel="${domain}"]`;
      const example = await runExample(page, panel, domain, language);
      // Focus is read once per language, right after the example ran.
      const focus = await page.evaluate(focusInPage, selector);
      for (const [i, width] of widths.entries()) {
        if (i) {
          await page.setViewportSize({
            width,
            height: width < 600 ? 844 : 900,
          });
          await settle(page);
        }
        const census = await page.evaluate(censusInPage, selector);
        states.push({
          language,
          width,
          example,
          ...census,
          focusLost: i === 0 && !focus.inside ? 1 : 0,
          focus,
        });
      }
    } finally {
      await context.close();
    }
  }
  return states;
}

let failure;
const report = {
  mode: selfTest ? 'self-test' : record ? 'record' : 'verification',
  synthetic: true,
  chromium: browser.version(),
  metrics: METRICS,
  states: STATES,
  domains: {},
};
try {
  if (selfTest) {
    // One rendered workspace, Arabic, measured twice for determinism, then
    // with a fault of every class planted. Each count must rise.
    const { context, page } = await open('ar', 1440);
    const panel = await openDomainWorkspace(page, 'bank', {
      advanced: true,
      requiredSources: false,
    });
    const selector = '[data-domain-panel="bank"]';
    await runExample(page, panel, 'bank', 'ar');
    const before = await page.evaluate(censusInPage, selector);
    const again = await page.evaluate(censusInPage, selector);
    assert.deepEqual(again, before, 'the census is deterministic on one page');
    await page.evaluate((s) => {
      const heading = document.querySelector(`${s} h2`);
      heading.tabIndex = -1;
      heading.focus();
    }, selector);
    assert.equal((await page.evaluate(focusInPage, selector)).inside, true);
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(
      (await page.evaluate(focusInPage, selector)).inside,
      false,
      'focusLost: a blurred page is counted',
    );
    const planted = await page.evaluate(plantInPage, selector);
    await settle(page);
    const after = await page.evaluate(censusInPage, selector);
    for (const metric of METRICS.filter((m) => m !== 'focusLost')) {
      assert.ok(planted.includes(metric), `${metric}: the fault was planted`);
      assert.ok(
        after[metric] > before[metric],
        `${metric}: a planted fault is counted (${before[metric]} → ${after[metric]})`,
      );
    }
    report.domains.bank = { before, after, planted };
    await context.close();
  } else {
    for (const domain of DOMAINS) {
      const states = await measureDomain(domain);
      report.domains[domain] = { sum: sumStates(states), states };
      console.log(
        `${domain.padEnd(13)} ${METRICS.map((m) => `${m}=${report.domains[domain].sum[m]}`).join(' ')}`,
      );
    }
    const current = Object.fromEntries(
      Object.entries(report.domains).map(([d, v]) => [d, v.sum]),
    );
    if (record) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      await writeFile(
        baselinePath,
        JSON.stringify(
          {
            note: 'Interface census baseline: each metric summed over the four states of a domain (Arabic and English at 390 and 1440 px) after its synthetic example ran. Recorded by scripts/ux-census-browser.mjs --record; the gate fails on any change.',
            recorded: {
              commit,
              date: new Date().toISOString().slice(0, 10),
              chromium: browser.version(),
            },
            metrics: METRICS,
            domains: current,
          },
          null,
          2,
        ) + '\n',
      );
      console.log(
        `Baseline recorded at ${commit.slice(0, 7)}: ${baselinePath}`,
      );
    } else {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
      const diff = compare(baseline.domains, current);
      report.baseline = baseline.recorded;
      report.diff = diff;
      const lines = [];
      if (diff.increases.length)
        lines.push(`new defects:\n  ${diff.increases.join('\n  ')}`);
      if (diff.decreases.length)
        lines.push(
          `improvements the baseline does not record yet (run with --record):\n  ${diff.decreases.join('\n  ')}`,
        );
      if (diff.missing.length)
        lines.push(`not comparable:\n  ${diff.missing.join('\n  ')}`);
      assert.equal(
        lines.length,
        0,
        `The interface census differs from the baseline.\n${lines.join('\n')}`,
      );
    }
  }
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
  await new Promise((resolve) => server.close(resolve));
  console.log(`Interface census (${report.mode}): ${report.status}, ${out}`);
}
if (failure) throw failure;
