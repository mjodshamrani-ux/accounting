// PAY-1c browser acceptance: every sealed PAY-1 story (or, with PLR_SUITE,
// every story of another sealed suite) through the built application, in the
// payroll workspace's long register section, with the native file input, the
// scope typed into the page and the real worker. Compared with the sealed
// EXPECTED.json as the page writes it: the refusal, or every employee's
// status and codes, for each employee that is not held its four components,
// payee account and lines, the rows not placed under an employee, the run
// codes, the excluded sections, the shared payee accounts and the run sums.
// Also, on the foundation: Arabic, a phone width, the keyboard, a stale
// result cleared by a new file or a scope change, and no request off the page.
//
//   pnpm build && node scripts/payroll-long-register-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.PLR_DIST ?? 'dist');
const SUITE = process.env.PLR_SUITE;
const suiteDir = path.resolve(
  SUITE ?? 'audit/payroll-long-register-foundation',
);
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.PLR_BROWSER_DIR ??
  'work/payroll-long-register/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const CURRENCIES = (
  await json(
    path.resolve('audit/payroll-long-register-foundation/contract.json'),
  )
).reading.currencies;
const KINDS = {
  Earning: 'earning',
  Deduction: 'deduction',
  'Employer contribution': 'employer',
  Net: 'net',
};
const SUMS = ['earnings', 'deductions', 'employer', 'net'];
const minor = (v, decimals) => {
  if (v === null || v === undefined) return '—';
  const sign = v < 0 ? '-' : '',
    digits = String(Math.abs(v)).padStart(decimals + 1, '0');
  return decimals
    ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : `${sign}${digits}`;
};

const frozen = path.join(suiteDir, 'frozen');
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const cases = [];
for (const name of (await readdir(frozen)).sort(byText))
  if (name.endsWith('-scope.json')) {
    const id = name.slice(0, -'-scope.json'.length);
    const scope = await json(path.join(frozen, name));
    cases.push({
      id,
      file: path.join(frozen, `${id}-register.csv`),
      scope,
      decimals: CURRENCIES[scope.Currency] ?? 2,
      oracle: expected[id],
    });
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
  const panel = await openDomainWorkspace(page, 'payroll');
  const details = panel.locator('details[data-plr-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-plr]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-plr]')?.getAttribute('aria-busy') ===
      'false',
  );
async function load(page, plr, c) {
  await plr.locator('input[data-plr-file]').setInputFiles(c.file);
  await idle(page);
  await plr.locator('[data-plr-confirm]').check();
  for (const [k, v] of Object.entries(c.scope))
    await plr.locator(`[data-plr-scope="${k}"]`).fill(v);
  await plr.locator('[data-plr-scope-confirm]').check();
  await plr
    .getByRole('button', { name: /Check the register|افحص المسير/ })
    .click();
  await plr.locator('[data-plr-result], [data-plr-error]').first().waitFor();
  await idle(page);
  assert.equal(
    await plr.locator('[data-plr-error]').count(),
    0,
    'the page shows no failure',
  );
  assert.equal(
    await plr.locator('[data-plr-result]').count(),
    1,
    'the page shows a result',
  );
}
// Every row of one paged table, page after page.
async function rows(plr, pager, selector, read) {
  const found = [];
  for (;;) {
    for (const row of await plr.locator(selector).all())
      found.push(await read(row));
    const next = plr.locator(`[data-plr-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return found;
}
const attr = async (plr, selector, name) =>
  (await plr.locator(selector).count())
    ? await plr.locator(selector).first().getAttribute(name)
    : null;
async function shown(plr) {
  const result = plr.locator('[data-plr-result]');
  const status = await result.getAttribute('data-plr-status');
  const verdict = await plr.locator('[data-plr-verdict]').textContent();
  if (status === 'refused')
    return {
      status,
      verdict,
      refused: await attr(plr, '[data-plr-verdict]', 'data-plr-refused'),
    };
  const employees = await rows(
    plr,
    'employees',
    'tr[data-plr-employee]',
    async (r) => ({
      key: await r.getAttribute('data-plr-employee'),
      status: await r.getAttribute('data-plr-employee-status'),
      codes: (await r.getAttribute('data-plr-employee-codes'))
        .split(' ')
        .filter(Boolean),
      cells: await r.locator('td').allTextContents(),
    }),
  );
  const lines = await rows(plr, 'lines', 'tr[data-plr-line]', async (r) => {
    const [key, id] = JSON.parse(await r.getAttribute('data-plr-line'));
    const cells = await r.locator('td').allTextContents();
    return { key, id, component: cells[2], kind: cells[3], amount: cells[4] };
  });
  const unplaced = await rows(plr, 'unplaced', 'tr[data-plr-unplaced]', (r) =>
    r.getAttribute('data-plr-unplaced').then((v) => JSON.parse(v)),
  );
  const shared = [];
  for (const li of await plr.locator('[data-plr-shared]').all())
    shared.push(JSON.parse(await li.getAttribute('data-plr-shared')));
  return {
    status,
    verdict,
    employees,
    lines,
    unplaced,
    run: ((await attr(plr, '[data-plr-run]', 'data-plr-run')) ?? '')
      .split(' ')
      .filter(Boolean),
    excluded: JSON.parse(
      (await attr(plr, '[data-plr-excluded]', 'data-plr-excluded')) ?? '[]',
    ),
    shared,
    // A refusal shown as a judged result has no totals; read what is there
    // so the comparison fails by assertion, not by a timeout.
    sums: (await plr.locator('[data-plr-sums]').count())
      ? await plr.locator('[data-plr-sums]').textContent()
      : null,
  };
}
function judge(c, seen) {
  const o = c.oracle,
    d = c.decimals,
    differ = [];
  if (o.refused) {
    if (seen.status !== 'refused' || seen.refused !== o.refused)
      differ.push('refusal');
    return differ;
  }
  if (seen.status !== 'judged') return ['status'];
  const keys = seen.employees.map((e) => e.key);
  if (!isDeepStrictEqual(keys, Object.keys(o.employees).sort(byText)))
    differ.push('employees');
  for (const e of seen.employees) {
    const want = o.employees[e.key];
    if (!want) continue;
    if (e.status !== want.status) differ.push(`status ${e.key}`);
    if (!isDeepStrictEqual(e.codes, want.codes)) differ.push(`codes ${e.key}`);
    if (want.status === 'held') {
      if (e.cells.slice(4, 8).some((v) => v !== '—'))
        differ.push(`held amounts ${e.key}`);
      continue;
    }
    const amounts = SUMS.map((k) => minor(want[k], d));
    if (!isDeepStrictEqual(e.cells.slice(4, 8), amounts))
      differ.push(`components ${e.key}`);
    if (e.cells[8] !== minor(want.earnings - want.deductions, d))
      differ.push(`equation ${e.key}`);
    if (e.cells[9] !== want.payee) differ.push(`payee ${e.key}`);
    const shownLines = seen.lines
      .filter((l) => l.key === e.key)
      .map((l) => [l.id, l.component, KINDS[l.kind], l.amount]);
    const wantLines = want.lines.map(([id, comp, kind, amt]) => [
      id,
      comp,
      kind,
      minor(amt, d),
    ]);
    if (!isDeepStrictEqual(shownLines, wantLines))
      differ.push(`lines ${e.key}`);
  }
  if (seen.lines.some((l) => o.employees[l.key]?.status === 'held'))
    differ.push('lines of a held employee');
  if (!isDeepStrictEqual(seen.unplaced, o.unplaced)) differ.push('unplaced');
  if (!isDeepStrictEqual(seen.run, o.run)) differ.push('run');
  if (!isDeepStrictEqual(seen.excluded, o.excludedSections))
    differ.push('excluded');
  if (!isDeepStrictEqual(seen.shared, o.sharedPayees)) differ.push('shared');
  const sums = o.totals
    ? SUMS.map((k) => minor(o.totals[k], d)).join(' · ')
    : '—';
  if (seen.sums !== sums) differ.push('sums');
  return differ;
}

let browser;
const errors = [],
  external = [];
const report = { cases: {}, checks: {} };
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
  for (const c of cases) {
    const plr = await open(page, 'en');
    await load(page, plr, c);
    const seen = await shown(plr);
    const differ = judge(c, seen);
    report.cases[c.id] = {
      equal: !differ.length,
      status: seen.status,
      differ,
    };
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: the same facts, the verdict in Arabic.
    {
      const plr = await open(page, 'ar');
      await load(page, plr, byId.P06);
      const seen = await shown(plr);
      seen.lines = seen.lines.map((l) => ({
        ...l,
        kind: {
          استحقاق: 'Earning',
          استقطاع: 'Deduction',
          'مساهمة صاحب العمل': 'Employer contribution',
          صافٍ: 'Net',
        }[l.kind],
      }));
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal: !judge(byId.P06, seen).length && seen.verdict === 'فُحص',
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const plr = await open(page, 'en');
      await load(page, plr, byId.P27);
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file, or another scope value, clears the shown result.
    {
      const plr = await open(page, 'en');
      await load(page, plr, byId.P01);
      await plr.locator('input[data-plr-file]').setInputFiles(byId.P02.file);
      await idle(page);
      const check = plr.getByRole('button', { name: 'Check the register' });
      const fileCleared =
        (await plr.locator('[data-plr-result]').count()) === 0 &&
        (await check.isDisabled());
      await load(page, plr, byId.P01);
      await plr.locator('[data-plr-scope="Payment date"]').fill('2026-09-29');
      const scopeCleared =
        (await plr.locator('[data-plr-result]').count()) === 0 &&
        !(await plr.locator('[data-plr-scope-confirm]').isChecked()) &&
        (await check.isDisabled());
      report.checks.staleCleared = fileCleared && scopeCleared;
    }
    // The keyboard reaches the section's summary and opens it.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'payroll');
      const details = panel.locator('details[data-plr-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await panel.locator('[data-plr] input[type="file"]').isVisible());
    }
  }
  report.errors = errors;
  report.external = external;
  const all = Object.values(report.cases);
  report.summary = {
    cases: `${all.filter((s) => s.equal).length}/${all.length}`,
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
  for (const [id, s] of Object.entries(report.cases))
    console.log(id, s.equal ? 'equal' : `DIFFERS ${s.differ.join(', ')}`);
  console.log(JSON.stringify(report.summary));
  const assertFile = arg('assert');
  if (assertFile) {
    const want = await json(path.join(suiteDir, 'results', assertFile));
    assert.deepEqual(
      report,
      want,
      `the browser run differs from ${assertFile}`,
    );
    console.log('the browser run equals', assertFile);
  }
  for (const [id, s] of Object.entries(report.cases))
    assert.ok(
      s.equal,
      `${id} shows what EXPECTED says: ${s.differ.join(', ')}`,
    );
  for (const [k, v] of Object.entries(report.summary.checks)) assert.ok(v, k);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
