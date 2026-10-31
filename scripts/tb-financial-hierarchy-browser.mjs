// FIN-1c browser acceptance: every FIN-1A case (or, with FINH_SUITE, every
// sealed H1 story) through the built application, in the TB and financial
// position workspace's hierarchical statement section, with the four native
// file inputs, the scope typed into the page and the real worker. Compared
// with the FIN-1A oracle as it is, as the engine run is: the same status;
// the case's required codes among the codes shown, and those among the
// oracle's; for an eligible case, every leaf and parent amount, every parent,
// the accounts behind every line, the TB totals, the classes and the equation
// as the page writes them. Also, on FIN-1A: Arabic, a phone width, the
// keyboard, a stale result cleared by a new file or a scope change, and no
// request off the page.
//
//   pnpm build && node scripts/tb-financial-hierarchy-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.FINH_DIST ?? 'dist');
const H1 = process.env.FINH_SUITE;
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.FINH_BROWSER_DIR ??
  'work/tb-financial-hierarchy/browser';
const ROLES = [
  'trial-balance',
  'proposed-mapping',
  'presentation-evidence',
  'financial-position',
];
const CLASSES = [
  'current-asset',
  'noncurrent-asset',
  'current-liability',
  'noncurrent-liability',
  'equity',
];
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The page writes an amount at two decimals with grouped thousands and the
// minus first; written here on its own, not taken from the application.
const minor = (v) => {
  const digits = String(Math.abs(v)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${v < 0 ? '-' : ''}${whole}.${digits.slice(-2)}`;
};

async function suite() {
  if (H1) {
    const frozen = path.resolve(H1, 'frozen');
    const facts = await json(path.join(frozen, 'stories.json'));
    const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
    const cases = [];
    for (const s of facts.stories)
      cases.push({
        id: s.id,
        folder: path.join(frozen, s.id),
        scope: await json(path.join(frozen, s.id, 'scope.json')),
        required: s.intent.codes,
        oracle: expected[s.id],
      });
    return { record: path.resolve(H1, 'results'), cases };
  }
  const fin1a = path.resolve('audit/tb-financial-hierarchy');
  const scope = (await json(path.join(fin1a, 'contract.json'))).scope;
  const oracle = JSON.parse(
    execFileSync('python3', ['-B', 'audit/fin-1-review/oracle_codes.py'], {
      encoding: 'utf8',
    }),
  );
  return {
    record: path.resolve('audit/fin-1-review/results'),
    cases: (await json(path.join(fin1a, 'frozen/cases.json'))).cases.map(
      (c) => ({
        id: c.id,
        folder: path.join(fin1a, 'frozen', c.id),
        scope,
        required: c.requiredCodes,
        oracle: oracle[c.id],
      }),
    ),
  };
}
const { record, cases } = await suite();

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
  const panel = await openDomainWorkspace(page, 'tb-financial');
  const details = panel.locator('details[data-finh-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-finh]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-finh]')?.getAttribute('aria-busy') ===
      'false',
  );
async function load(page, finh, c) {
  for (const role of ROLES) {
    await finh
      .locator(`input[data-finh-file="${role}"]`)
      .setInputFiles(path.join(c.folder, `${role}.csv`));
    await idle(page);
    await finh.locator(`[data-finh-confirm="${role}"]`).check();
  }
  for (const [k, v] of Object.entries(c.scope))
    await finh.locator(`[data-finh-scope="${k}"]`).fill(v);
  await finh.locator('[data-finh-scope-confirm]').check();
  await finh
    .getByRole('button', { name: /Check the statement|افحص القائمة/ })
    .click();
  await finh.locator('[data-finh-result], [data-finh-error]').first().waitFor();
  await idle(page);
  assert.equal(
    await finh.locator('[data-finh-error]').count(),
    0,
    'the page shows no refusal',
  );
  assert.equal(
    await finh.locator('[data-finh-result]').count(),
    1,
    'the page shows a result',
  );
}
// Every row of one paged table, page after page.
async function rows(finh, pager, selector, read) {
  const out = [];
  for (;;) {
    for (const row of await finh.locator(selector).all())
      out.push(await read(row));
    const next = finh.locator(`[data-finh-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return out;
}
async function shown(finh) {
  const result = finh.locator('[data-finh-result]');
  const nodes = await rows(finh, 'tree', 'tr[data-finh-node]', async (r) => ({
    id: await r.getAttribute('data-finh-node'),
    kind: await r.getAttribute('data-finh-kind'),
    cells: await r.locator('td').allTextContents(),
  }));
  const members = await rows(finh, 'members', 'tr[data-finh-member]', (r) =>
    r.getAttribute('data-finh-member'),
  );
  const totals = finh.locator('[data-finh-totals] tbody tr');
  return {
    status: await result.getAttribute('data-finh-status'),
    verdict: await finh.locator('[data-finh-verdict]').textContent(),
    codes: (await finh.locator('[data-finh-codes]').count())
      ? (
          (await finh
            .locator('[data-finh-codes]')
            .getAttribute('data-finh-codes')) ?? ''
        )
          .split(' ')
          .filter(Boolean)
      : [],
    nodes,
    members,
    tb: (await finh.locator('[data-finh-tb]').count())
      ? await finh.locator('[data-finh-tb]').textContent()
      : null,
    classes: (await totals.count())
      ? await Promise.all(
          (await totals.all()).map((r) => r.locator('td').allTextContents()),
        )
      : [],
    equation: (await finh.locator('[data-finh-equation]').count())
      ? await finh.locator('[data-finh-equation]').textContent()
      : null,
  };
}
function judge(c, seen) {
  const differ = [];
  if (seen.status !== c.oracle.status) differ.push('status');
  if (!c.required.every((k) => seen.codes.includes(k)))
    differ.push('required codes');
  if (!seen.codes.every((k) => c.oracle.codes.includes(k)))
    differ.push('codes beyond the oracle');
  if (c.oracle.status === 'blocked' && !seen.codes.length)
    differ.push('no reason shown');
  if (c.oracle.status !== 'eligible') return differ;
  const f = c.oracle.facts;
  for (const n of seen.nodes) {
    if (n.kind === 'title') continue;
    const amount = n.kind === 'leaf' ? f.leafMinor[n.id] : f.parentMinor[n.id];
    if (n.cells[7] !== minor(amount)) differ.push(`amount ${n.id}`);
    if (n.cells[2] !== c.oracle.ownership[n.id]) differ.push(`parent ${n.id}`);
    if (
      n.kind === 'leaf' &&
      (n.cells[8] !== minor(amount) || n.cells[9] !== '0.00')
    )
      differ.push(`from the TB ${n.id}`);
  }
  const seenNodes = seen.nodes
    .filter((n) => n.kind !== 'title')
    .map((n) => n.id);
  if (
    !isDeepStrictEqual(
      seenNodes.sort(byText),
      Object.keys(c.oracle.ownership).sort(byText),
    )
  )
    differ.push('nodes');
  const members = {};
  for (const m of seen.members) {
    const at = m.indexOf(' ');
    (members[m.slice(0, at)] ??= []).push(m.slice(at + 1));
  }
  for (const k of Object.keys(members)) members[k].sort(byText);
  if (!isDeepStrictEqual(members, f.members)) differ.push('members');
  if (!seen.tb?.includes(`${minor(f.debitMinor)} · ${minor(f.creditMinor)}`))
    differ.push('TB totals');
  if (
    !isDeepStrictEqual(
      seen.classes.map((r) => r[1]),
      CLASSES.map((k) => minor(f.categoryMinor[k])),
    ) ||
    !isDeepStrictEqual(
      seen.classes.map((r) => r[2]),
      CLASSES.map((k) => minor(f.categoryMinor[k])),
    )
  )
    differ.push('classes');
  if (
    !seen.equation?.includes(
      `${minor(f.equationMinor)} · ${minor(f.equationMinor)}`,
    )
  )
    differ.push('equation');
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
    const finh = await open(page, 'en');
    await load(page, finh, c);
    const seen = await shown(finh);
    const differ = judge(c, seen);
    report.cases[c.id] = {
      equal: !differ.length,
      status: seen.status,
      codes: seen.codes,
      differ,
    };
  }
  if (!H1) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: the same facts, the verdict in Arabic.
    {
      const finh = await open(page, 'ar');
      await load(page, finh, byId['positive-nested']);
      const seen = await shown(finh);
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal:
          !judge(byId['positive-nested'], seen).length &&
          seen.verdict === 'مؤهلة: متسقة مع الأدلة المقدمة',
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const finh = await open(page, 'en');
      await load(page, finh, byId['wrong-control-total']);
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file, or another scope value, clears the shown result.
    {
      const finh = await open(page, 'en');
      await load(page, finh, byId['positive-nested']);
      await finh
        .locator('input[data-finh-file="financial-position"]')
        .setInputFiles(
          path.join(
            byId['positive-reordered'].folder,
            'financial-position.csv',
          ),
        );
      await idle(page);
      const check = finh.getByRole('button', { name: 'Check the statement' });
      const fileCleared =
        (await finh.locator('[data-finh-result]').count()) === 0 &&
        (await check.isDisabled());
      await load(page, finh, byId['positive-nested']);
      await finh.locator('[data-finh-scope="Period end"]').fill('2026-09-29');
      const scopeCleared =
        (await finh.locator('[data-finh-result]').count()) === 0 &&
        !(await finh.locator('[data-finh-scope-confirm]').isChecked()) &&
        (await check.isDisabled());
      report.checks.staleCleared = fileCleared && scopeCleared;
    }
    // The keyboard reaches the section's summary and opens it.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'tb-financial');
      const details = panel.locator('details[data-finh-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await panel
          .locator('[data-finh] input[type="file"]')
          .first()
          .isVisible());
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
    const want = await json(path.join(record, assertFile));
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
      `${id} shows what the oracle says: ${s.differ.join(', ')}`,
    );
  for (const [k, v] of Object.entries(report.summary.checks)) assert.ok(v, k);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
