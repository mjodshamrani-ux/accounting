// GLT-1c browser acceptance: every sealed GLT-1 story through the built
// application, in the GL/TB workspace's sections section, with the native file
// inputs, the run scope typed into the page and the real worker. What the page
// shows for each account (status, codes, the components shown for each side),
// the excluded sections and pages, the orphan totals, what was not placed
// under an account, and the run codes must equal EXPECTED.json. Also: Arabic,
// a phone width, the keyboard, a stale result cleared by a new file or a scope
// change, and no request off the page.
//
//   pnpm build && node scripts/gl-tb-sections-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.GLS_DIST ?? 'dist');
// GLS_SUITE names another sealed suite with the same layout; the language,
// width, keyboard and stale-result checks use the foundation's stories.
const SUITE = path.resolve(
  process.env.GLS_SUITE ?? 'audit/gl-tb-sections-foundation',
);
const FOUNDATION = !process.env.GLS_SUITE;
const FROZEN = path.join(SUITE, 'frozen');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ?? process.env.GLS_BROWSER_DIR ?? 'work/gl-tb-sections/browser';
const expected = JSON.parse(
  await readFile(path.join(FROZEN, 'EXPECTED.json'), 'utf8'),
).stories;
const DECIMALS = {
  SAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};
const SCOPE = {
  entity: 'Entity',
  ledger: 'Ledger',
  currency: 'Currency',
  currencyBasis: 'Currency basis',
  postingStatus: 'Posting status',
  postingLayer: 'Posting layer',
  start: 'Period start',
  end: 'Period end',
};
const SIX = [
  ['openingDebit', 'Opening debit'],
  ['openingCredit', 'Opening credit'],
  ['periodDebit', 'Period debit'],
  ['periodCredit', 'Period credit'],
  ['closingDebit', 'Closing debit'],
  ['closingCredit', 'Closing credit'],
];
const STATUS = {
  'Held: not decided': 'held',
  'Incomplete: evidence missing': 'missing',
  'Inconsistent: a source does not bridge': 'inconsistent',
  Difference: 'difference',
  Consistent: 'consistent',
  'موقوف: لم يُقرر': 'held',
  'ناقص: دليل غائب': 'missing',
  'غير متسق: مصدر لا يكتمل جسره': 'inconsistent',
  'فيه فرق': 'difference',
  متسق: 'consistent',
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The page writes an amount at the run's decimals with grouped thousands and
// the minus first; written here on its own, not taken from the application.
const minor = (v, d) => {
  const digits = String(Math.abs(v)).padStart(d + 1, '0');
  const whole = (d ? digits.slice(0, -d) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    ',',
  );
  return `${v < 0 ? '-' : ''}${whole}${d ? `.${digits.slice(-d)}` : ''}`;
};
// What the English page should write for an account's components, from the
// sealed expectation: every component, or only those that differ.
function components(a, decimals) {
  if (!a.gl && !a.tb) return '';
  const side = (v, i) => (v ? minor(v[i], decimals) : '—');
  return SIX.map(([k, label], i) => [k, label, i])
    .filter(([k]) => a.status !== 'difference' || a.codes.includes(k))
    .map(([, label, i]) => `${label}: ${side(a.gl, i)} · ${side(a.tb, i)}`)
    .join('; ');
}

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
  const panel = await openDomainWorkspace(page, 'gl-tb');
  const details = panel.locator('details[data-gls-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-gls]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-gls]')?.getAttribute('aria-busy') ===
      'false',
  );
const scopeOf = async (sid) =>
  JSON.parse(await readFile(path.join(FROZEN, `${sid}-scope.json`), 'utf8'));
async function load(page, gls, sid) {
  const sets = gls.locator('fieldset');
  for (const [i, role] of [
    [0, 'gl'],
    [1, 'tb'],
  ]) {
    await sets
      .nth(i)
      .locator('input[type="file"]')
      .setInputFiles(path.join(FROZEN, `${sid}-${role}.csv`));
    await idle(page);
    await sets.nth(i).locator('input[type="checkbox"]').check();
  }
  const scope = await scopeOf(sid);
  for (const [k, label] of Object.entries(SCOPE))
    await gls.locator(`[data-gls-scope="${k}"]`).fill(scope[label]);
  await gls.locator('[data-gls-scope-confirm]').check();
  await gls
    .getByRole('button', { name: /Check every account|افحص كل حساب/ })
    .click();
  await gls.locator('[data-gls-result], [data-gls-error]').first().waitFor();
  await idle(page);
  assert.equal(
    await gls.locator('[data-gls-error]').count(),
    0,
    'the page shows no refusal',
  );
  assert.equal(
    await gls.locator('[data-gls-result]').count(),
    1,
    'the page shows a result',
  );
}
async function shown(gls) {
  const accounts = {};
  for (;;) {
    for (const row of await gls.locator('tr[data-gls-account]').all()) {
      const cells = await row.locator('td').allTextContents();
      accounts[await row.getAttribute('data-gls-account')] = {
        status: await row.getAttribute('data-gls-status'),
        codes: ((await row.getAttribute('data-gls-codes')) || '')
          .split(' ')
          .filter(Boolean),
        statusText: cells[2],
        components: cells[4],
      };
    }
    const next = gls.locator('[data-gls-pager="accounts"] button').last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return gls.evaluate((el, accounts) => {
    const list = (attr) =>
      (el.querySelector(`[${attr}]`)?.getAttribute(attr) || '')
        .split(' ')
        .filter(Boolean);
    return {
      accounts,
      run: list('data-gls-run'),
      excludedSections: list('data-gls-excluded-sections'),
      excludedPages: list('data-gls-excluded-pages'),
      orphanTotals: [...el.querySelectorAll('[data-gls-orphan]')].map((r) =>
        r.getAttribute('data-gls-orphan'),
      ),
      unplaced: [...el.querySelectorAll('[data-gls-unplaced-row]')].map((r) =>
        r.getAttribute('data-gls-unplaced-row'),
      ),
    };
  }, accounts);
}
function judge(sid, seen, english = true) {
  const want = expected[sid],
    decimals = DECIMALS[currencies[sid]];
  const differ = [];
  for (const k of ['run', 'excludedSections', 'excludedPages', 'orphanTotals'])
    if (
      !isDeepStrictEqual([...seen[k]].sort(byText), [...want[k]].sort(byText))
    )
      differ.push(k);
  if (
    !isDeepStrictEqual(
      seen.unplaced,
      want.unplaced.map(([f, row, [code]]) => `${f} ${row.slice(4)} ${code}`),
    )
  )
    differ.push('unplaced');
  if (
    !isDeepStrictEqual(
      Object.keys(seen.accounts).sort(byText),
      Object.keys(want.accounts).sort(byText),
    )
  )
    differ.push('accounts');
  for (const [key, w] of Object.entries(want.accounts)) {
    const g = seen.accounts[key];
    if (
      !g ||
      g.status !== w.status ||
      !isDeepStrictEqual(g.codes, w.codes) ||
      STATUS[g.statusText] !== w.status ||
      (english && g.components !== components(w, decimals))
    )
      differ.push(key);
  }
  return differ;
}
const currencies = {};
for (const sid of Object.keys(expected))
  currencies[sid] = (await scopeOf(sid)).Currency;

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
    const gls = await open(page, 'en');
    await load(page, gls, sid);
    const differ = judge(sid, await shown(gls));
    report.stories[sid] = { equal: !differ.length, differ };
  }
  if (FOUNDATION) {
    // Arabic, right to left, with Arabic dimensions and Arabic-Indic amounts.
    {
      const gls = await open(page, 'ar');
      await load(page, gls, 'T17');
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal: !judge('T17', await shown(gls), false).length,
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const gls = await open(page, 'en');
      await load(page, gls, 'T29');
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file, or another scope value, clears the shown result.
    {
      const gls = await open(page, 'en');
      await load(page, gls, 'T02');
      await gls
        .locator('fieldset')
        .nth(1)
        .locator('input[type="file"]')
        .setInputFiles(path.join(FROZEN, 'T03-tb.csv'));
      await idle(page);
      const fileCleared =
        (await gls.locator('[data-gls-result]').count()) === 0 &&
        (await gls
          .getByRole('button', { name: 'Check every account' })
          .isDisabled());
      await load(page, gls, 'T02');
      await gls.locator('[data-gls-scope="end"]').fill('2026-09-29');
      const scopeCleared =
        (await gls.locator('[data-gls-result]').count()) === 0 &&
        !(await gls.locator('[data-gls-scope-confirm]').isChecked()) &&
        (await gls
          .getByRole('button', { name: 'Check every account' })
          .isDisabled());
      report.checks.staleCleared = fileCleared && scopeCleared;
    }
    // The keyboard reaches the section's summary and opens it.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'gl-tb');
      const details = panel.locator('details[data-gls-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await panel
          .locator('[data-gls] input[type="file"]')
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
  console.log(JSON.stringify(report.summary));
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
