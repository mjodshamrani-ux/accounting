// The interface census class `inputsBeforeRun` (UX-5): in every workspace,
// the inputs a reader sets after loading committed synthetic sources and
// before the first run, by the recipes in scripts/ux-census-start.mjs. In
// English each step is found by its name and left out in turn; in Arabic
// the same steps are repeated on the same controls. The count is compared
// with audit/ux-census/start.json, and any difference fails, as the census
// does: a higher count is a new question asked of the reader; a lower one an
// improvement recorded with --record. A step the workspace no longer needs
// fails the run until its recipe drops it. --self-test plants a step the
// workspace does not need, one it does not ask for, and drops one it needs,
// and requires each to be caught. It runs in its own job because it runs
// each workspace through the engine once per step.
// Synthetic sources only; no financial truth is asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { DOMAINS } from './ux-census-support.mjs';
import { START, compareStart, measureStart } from './ux-census-start.mjs';
import { keepReplies } from './worker-replies.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const recordPath = path.join(root, 'audit/ux-census/start.json');
const flags = new Set(process.argv.slice(2));
assert.ok(
  [...flags].every((flag) => flag === '--record' || flag === '--self-test'),
  'flags: --record, --self-test',
);
const record = flags.has('--record'),
  selfTest = flags.has('--self-test');
const only = process.env.UX_CENSUS_START_ONLY?.split(',');
assert.ok(!(only && record), 'a record covers every workspace');
const outRoot = process.env.UX_CENSUS_DIR ?? path.join(root, 'work/ux-census');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(
  path.join(outRoot, selfTest ? 'start-self-test-' : 'start-run-'),
);

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
const languages = { ar: 'AR العربية', en: 'EN English' };

// A fresh workspace in one language, the worker's replies kept so a run is
// waited for until the engine answers.
async function open(language, domain) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(keepReplies);
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
    .getByRole('button', { name: languages[language], exact: true })
    .click();
  await openDomainWorkspace(page, domain, {
    advanced: false,
    requiredSources: true,
  });
  return { context, page };
}

// English with each step left out, then Arabic on the same controls.
async function measure(domain, recipe = START[domain]) {
  const english = await open('en', domain);
  let en;
  try {
    en = await measureStart(english.page, domain, { necessity: true, recipe });
  } finally {
    await english.context.close();
  }
  const arabic = await open('ar', domain);
  try {
    const ar = await measureStart(arabic.page, domain, {
      plan: en.plan,
      recipe,
    });
    assert.equal(ar.count, en.count);
    return { count: en.count, needless: en.needless, outcome: en.outcome };
  } finally {
    await arabic.context.close();
  }
}

let failure;
const report = {
  mode: selfTest ? 'self-test' : record ? 'record' : 'verification',
  synthetic: true,
  chromium: browser.version(),
  metric: 'inputsBeforeRun',
  domains: {},
};
try {
  if (selfTest) {
    // A step the workspace does not need, because the field already holds
    // the value (the GL/TB currency is SAR before anyone types it).
    const gl = START['gl-tb'];
    const planted = {
      ...gl,
      steps: [
        ...gl.steps.slice(0, -1),
        ['fill', 'Currency', 'SAR'],
        gl.steps.at(-1),
      ],
    };
    const held = await measure('gl-tb', planted);
    assert.ok(
      held.needless.includes('fill Currency'),
      `a step whose field already holds its value is caught (${held.needless.join(', ')})`,
    );
    // A step that changes a field the result does not depend on (the
    // clearing description column).
    const clearing = START.clearing;
    const description = {
      ...clearing,
      steps: [
        ...clearing.steps.slice(0, 6),
        ['select', 'Description', 'Description'],
        ...clearing.steps.slice(6),
      ],
    };
    const unread = await measure('clearing', description);
    assert.ok(
      unread.needless.includes('select Description'),
      `a step the result does not depend on is caught (${unread.needless.join(', ')})`,
    );
    // A recipe that misses a step the workspace needs never reaches a run.
    await assert.rejects(
      measure('gl-tb', { ...gl, steps: gl.steps.slice(0, -1) }),
      /the run is closed after the recipe/,
      'a recipe without the scope confirmation fails',
    );
    // Arabic on controls of another kind fails instead of counting.
    const swapped = await open('ar', 'gl-tb');
    try {
      const english = await open('en', 'gl-tb');
      let plan;
      try {
        ({ plan } = await measureStart(english.page, 'gl-tb'));
      } finally {
        await english.context.close();
      }
      const wrong = plan.map((p, i) =>
        i === plan.length - 2 ? { ...p, kind: 'INPUT:text' } : p,
      );
      await assert.rejects(
        measureStart(swapped.page, 'gl-tb', { plan: wrong }),
        /another kind of control/,
        'a plan whose control is of another kind fails',
      );
    } finally {
      await swapped.context.close();
    }
    report.selfTest = { held: held.needless, unread: unread.needless };
  } else {
    for (const domain of DOMAINS) {
      if (only && !only.includes(domain)) continue;
      const started = Date.now();
      const result = await measure(domain);
      report.domains[domain] = result;
      console.log(
        `${domain.padEnd(13)} inputsBeforeRun=${result.count} (${((Date.now() - started) / 1000).toFixed(0)} s)`,
      );
      assert.deepEqual(
        result.needless,
        [],
        `${domain}: steps the workspace does not need; drop them from its recipe in scripts/ux-census-start.mjs`,
      );
    }
    const current = Object.fromEntries(
      Object.entries(report.domains).map(([d, v]) => [d, v.count]),
    );
    if (record) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      await writeFile(
        recordPath,
        JSON.stringify(
          {
            note: 'Interface census class inputsBeforeRun (UX-5): in each workspace, the inputs a reader sets after loading committed synthetic sources and before the first run, by the recipes in scripts/ux-census-start.mjs, each step shown to be needed in English and repeated in Arabic. Recorded by scripts/ux-census-start-browser.mjs --record; the gate fails on any change.',
            recorded: {
              commit,
              date: new Date().toISOString().slice(0, 10),
              chromium: browser.version(),
            },
            metric: 'inputsBeforeRun',
            domains: current,
            total: Object.values(current).reduce((a, b) => a + b, 0),
          },
          null,
          2,
        ) + '\n',
      );
      console.log(`Recorded at ${commit.slice(0, 7)}: ${recordPath}`);
    } else {
      const recorded = JSON.parse(await readFile(recordPath, 'utf8'));
      const diff = compareStart(recorded.domains, current, { only });
      report.recorded = recorded.recorded;
      report.diff = diff;
      const lines = [];
      if (diff.increases.length)
        lines.push(`more inputs:\n  ${diff.increases.join('\n  ')}`);
      if (diff.decreases.length)
        lines.push(
          `fewer inputs the record does not hold yet (run with --record):\n  ${diff.decreases.join('\n  ')}`,
        );
      if (diff.missing.length)
        lines.push(`not comparable:\n  ${diff.missing.join('\n  ')}`);
      assert.equal(
        lines.length,
        0,
        `The inputs before the first run differ from the record.\n${lines.join('\n')}`,
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
  console.log(
    `Inputs before the first run (${report.mode}): ${report.status}, ${out}`,
  );
}
if (failure) throw failure;
