// IC-1c browser acceptance: every sealed IC-1 story through the built
// application, in the intercompany workspace's batch section, with the native
// file inputs and the real worker. What the page shows for each batch (status,
// codes, every relation's status, members and residual, the unassigned rows,
// the run codes) must equal EXPECTED.json. Also: Arabic, a phone width, the
// keyboard, a stale result cleared by a new file, and no request off the page.
//
//   pnpm build && node scripts/intercompany-batch-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.IC_BATCH_DIST ?? 'dist');
// IC_BATCH_SUITE names another sealed suite with the same layout (H1); the
// language, width, keyboard and stale-result checks use the foundation's stories.
const SUITE = path.resolve(
  process.env.IC_BATCH_SUITE ?? 'audit/intercompany-batch-foundation',
);
const FOUNDATION = !process.env.IC_BATCH_SUITE;
const FROZEN = path.join(SUITE, 'frozen');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.IC_BATCH_BROWSER_DIR ??
  'work/intercompany-batch/browser';
const expected = JSON.parse(
  await readFile(path.join(FROZEN, 'EXPECTED.json'), 'utf8'),
).stories;
const names = await readdir(FROZEN);
const filesOf = (sid) => {
  const own = names.filter(
    (n) => n.startsWith(`${sid}-`) && n.endsWith('.csv'),
  );
  const p = (n) => path.join(FROZEN, n);
  return {
    declaration: p(own.find((n) => n.endsWith('-batches.csv'))),
    ledgers: own
      .filter((n) => n.includes('-ledger-'))
      .sort(
        (a, b) =>
          Number(a.match(/-(\d+)\.csv$/)[1]) -
          Number(b.match(/-(\d+)\.csv$/)[1]),
      )
      .map(p),
    relations: p(own.find((n) => n.endsWith('-relations.csv'))),
  };
};
const minor = (value, decimals) => {
  if (value === null) return '—';
  const sign = value < 0 ? '-' : '',
    digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  return decimals
    ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : `${sign}${digits}`;
};
const DECIMALS = { SAR: 2, KWD: 3, JPY: 0 };

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

async function open(page, language) {
  await page.goto(url);
  await page
    .getByRole('button', {
      name: language === 'en' ? 'EN English' : 'AR العربية',
      exact: true,
    })
    .click();
  const panel = await openDomainWorkspace(page, 'intercompany');
  const details = panel.locator('details[data-intercompany-batch-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-intercompany-batch]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document
        .querySelector('[data-intercompany-batch]')
        ?.getAttribute('aria-busy') === 'false',
  );
async function load(page, batch, files) {
  const sets = batch.locator('fieldset');
  const pick = async (i, value) => {
    await sets.nth(i).locator('input[type="file"]').setInputFiles(value);
    await idle(page);
    await sets.nth(i).locator('input[type="checkbox"]').check();
  };
  await pick(0, files.declaration);
  await pick(1, files.ledgers);
  await pick(2, files.relations);
  await batch
    .getByRole('button', { name: /Check every batch|افحص كل دفعة/ })
    .click();
  await batch
    .locator('[data-ic-batch-result], [data-ic-batch-error]')
    .first()
    .waitFor();
  await idle(page);
  assert.equal(
    await batch.locator('[data-ic-batch-error]').count(),
    0,
    'the page shows no refusal',
  );
  assert.equal(
    await batch.locator('[data-ic-batch-result]').count(),
    1,
    'the page shows a result',
  );
}
async function shown(batch) {
  return batch.evaluate((root) => {
    const batches = {};
    for (const b of root.querySelectorAll('[data-ic-batch]')) {
      const table = b.querySelector('table');
      batches[b.getAttribute('data-ic-batch')] = {
        status: b.getAttribute('data-ic-batch-status'),
        codes: (b.getAttribute('data-ic-batch-codes') || '')
          .split(' ')
          .filter(Boolean),
        relations: [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent),
        ),
      };
    }
    const run = root.querySelector('[data-ic-batch-run]');
    const loose = root.querySelector('[data-ic-batch-unassigned]');
    return {
      batches,
      run: run ? run.getAttribute('data-ic-batch-run').split(' ') : [],
      unassigned: loose
        ? Number(loose.getAttribute('data-ic-batch-unassigned'))
        : 0,
    };
  });
}
function judge(sid, seen) {
  const want = expected[sid];
  const differ = [];
  if (!isDeepStrictEqual(seen.run, want.run)) differ.push('run');
  if (seen.unassigned !== want.unassigned.length) differ.push('unassigned');
  if (!isDeepStrictEqual(Object.keys(seen.batches), Object.keys(want.batches)))
    differ.push('batch order');
  for (const [bid, w] of Object.entries(want.batches)) {
    const g = seen.batches[bid];
    if (!g || g.status !== w.status || !isDeepStrictEqual(g.codes, w.codes)) {
      differ.push(`${bid} status`);
      continue;
    }
    const decimals = decimalsOf(sid, bid);
    const rows = Object.entries(w.relations).map(([key, r]) => [
      key.slice(bid.length + 1),
      r.status,
      r.members ? r.members.A.join(', ') : null,
      r.members ? r.members.B.join(', ') : null,
      r.residual,
    ]);
    if (g.relations.length !== rows.length) {
      differ.push(`${bid} relations`);
      continue;
    }
    rows.forEach(([rid, status, a, b, residual], i) => {
      const cells = g.relations[i];
      if (
        cells[0] !== rid ||
        (a !== null && (cells[2] !== a || cells[3] !== b)) ||
        cells[6] !== minor(residual, decimals) ||
        statusOf(cells[1]) !== status
      )
        differ.push(`${bid}/${rid}`);
    });
  }
  return differ;
}
const STATUS = {
  Held: 'blocked',
  Incomplete: 'missing',
  Difference: 'difference',
  'Ready for review': 'ready',
  موقوفة: 'blocked',
  ناقصة: 'missing',
  'فيها فرق': 'difference',
  'جاهزة للمراجعة': 'ready',
};
const statusOf = (text) => STATUS[text] ?? `unknown: ${text}`;
const currencies = {};
const decimalsOf = (sid, bid) => DECIMALS[currencies[sid]?.[bid]];
for (const sid of Object.keys(expected)) {
  const decl = (await readFile(filesOf(sid).declaration, 'utf8')).replace(
    /^\uFEFF/,
    '',
  );
  const [head, ...rows] = decl
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(',').map((v) => v.replace(/^"|"$/g, '')));
  currencies[sid] = Object.fromEntries(
    rows.map((r) => [r[head.indexOf('Batch ID')], r[head.indexOf('Currency')]]),
  );
}

let browser;
const errors = [],
  external = [];
const report = { stories: {}, checks: {} };
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(30000);
  ctx.on('request', (r) => {
    if (
      !r.url().startsWith(url) &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    )
      external.push(r.url());
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  for (const sid of Object.keys(expected)) {
    const batch = await open(page, 'en');
    await load(page, batch, filesOf(sid));
    const differ = judge(sid, await shown(batch));
    report.stories[sid] = { equal: !differ.length, differ };
  }
  if (FOUNDATION) {
    // Arabic, right to left.
    {
      const batch = await open(page, 'ar');
      await load(page, batch, filesOf('I16'));
      const seen = await shown(batch);
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal: !judge('I16', seen).length,
        heading: await batch.locator('[data-ic-batch="AG"] h4').innerText(),
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const batch = await open(page, 'en');
      await load(page, batch, filesOf('I07'));
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file clears the shown result; nothing stale stays on the page.
    {
      const batch = await open(page, 'en');
      await load(page, batch, filesOf('I10'));
      await batch
        .locator('fieldset')
        .nth(2)
        .locator('input[type="file"]')
        .setInputFiles(filesOf('I20').relations);
      await idle(page);
      report.checks.staleCleared =
        (await batch.locator('[data-ic-batch-result]').count()) === 0 &&
        (await batch
          .getByRole('button', { name: 'Check every batch' })
          .isDisabled());
    }
    // The keyboard reaches the batch section's summary and opens it.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'intercompany');
      const summary = panel.locator(
        'details[data-intercompany-batch-details] > summary',
      );
      await summary.focus();
      await page.keyboard.press('Enter');
      report.checks.keyboard =
        (await panel
          .locator('details[data-intercompany-batch-details]')
          .getAttribute('open')) !== null &&
        (await panel
          .locator('[data-intercompany-batch] input[type="file"]')
          .first()
          .isVisible());
    }
  }
  report.errors = errors;
  report.external = external;
  const all = Object.values(report.stories);
  report.summary = {
    stories: `${all.filter((s) => s.equal).length}/${all.length}`,
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([k, v]) => [
        k,
        typeof v === 'object' ? v.equal && v.dir === 'rtl' : v,
      ]),
    ),
  };
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 1) + '\n',
  );
  for (const [sid, s] of Object.entries(report.stories))
    console.log(sid, s.equal ? 'equal' : `DIFFERS ${s.differ.join(', ')}`);
  console.log(
    JSON.stringify(report.summary),
    JSON.stringify(report.checks.arabic),
  );
  const assertFile = arg('assert');
  if (assertFile) {
    const want = JSON.parse(
      await readFile(path.join(SUITE, 'results', assertFile), 'utf8'),
    );
    assert.deepEqual(
      report,
      want,
      `the browser run differs from ${assertFile}`,
    );
    console.log('the browser run equals', assertFile);
  }
  for (const [sid, s] of Object.entries(report.stories))
    assert.ok(
      s.equal,
      `${sid} shows what EXPECTED.json says: ${s.differ.join(', ')}`,
    );
  for (const [k, v] of Object.entries(report.summary.checks)) assert.ok(v, k);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
