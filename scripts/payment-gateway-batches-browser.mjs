// PG-1c browser acceptance: every sealed PG-1 story (or, with
// PG_BATCHES_SUITE, every story of another sealed suite with the same
// layout) through the built application, in the payment gateway workspace's
// batches section, with its five native file inputs, the scope typed into the
// page and the real worker. Compared with the sealed EXPECTED.json as the
// page shows it: the refusal, or every batch (its settlement row, members by
// row, components against the row, net, paid, payouts, status and reasons in
// words with their codes), every payout (its lines, batches, total, bank
// credit, status and reasons) and every bank credit no line names. A dense
// story's batches and payouts are read on their first and last pages; its
// counts are read whole. The story whose scope is not confirmed is the
// review button that stays disabled. The batches to review are counted by
// reason as the page lists them. Also, on the foundation: Arabic, a
// phone width, the keyboard, a stale review cleared by a new file or a scope
// change, and no request off the page.
//
//   pnpm build && node scripts/payment-gateway-batches-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.PG_BATCHES_DIST ?? 'dist');
const SUITE = process.env.PG_BATCHES_SUITE;
const foundation = path.resolve('audit/payment-gateway-batches-foundation');
const suiteDir = path.resolve(SUITE ?? foundation);
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.PG_BATCHES_BROWSER_DIR ??
  'work/payment-gateway-batches/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
// For the interface mutation gate: stop at the first story that differs,
// by the same assertion.
const FAIL_FAST = process.env.PG_BATCHES_FAIL_FAST === '1';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PAGE = 50;
const ROLES = [
  'transactions',
  'fee-evidence',
  'settlements',
  'payout-lines',
  'bank-credits',
];
// The words the page must show, written here and not imported from it.
const WORDS = {
  en: {
    list: ', ',
    status: {
      consistent: 'Consistent',
      'in-transit': 'In transit',
      review: 'To review',
    },
    reasons: {
      SALES: 'The sales naming the batch do not add up to its gross sales',
      REFUNDS: 'The refunds naming the batch do not add up to its refunds',
      FEES: 'The fees naming the batch do not add up to its fees',
      NET: 'Gross sales less refunds less fees on the settlement row is not its net',
      PAID_SHORT: 'The payout lines naming the batch pay less than its net',
      PAID_OVER: 'The payout lines naming the batch pay more than its net',
      PAYOUT: 'A payout of the batch needs review',
      CREDIT: 'The bank credit is not the total of the payout lines',
      NOT_DEPOSITED: 'No bank credit names the payout by the as-of date',
      UNLINKED_CREDIT:
        'The bank received it, and no gateway file says which batches it pays',
    },
    check: 'Review the batches',
  },
  ar: {
    list: '، ',
    status: {
      consistent: 'متسقة',
      'in-transit': 'في الطريق',
      review: 'للمراجعة',
    },
    reasons: {
      SALES: 'المبيعات التي تسمي الدفعة لا تساوي إجمالي مبيعاتها',
      REFUNDS: 'المرتجعات التي تسمي الدفعة لا تساوي مرتجعاتها',
      FEES: 'الرسوم التي تسمي الدفعة لا تساوي رسومها',
      NET: 'إجمالي المبيعات ناقص المرتجعات ناقص الرسوم في صف التسوية ليس صافيه',
      PAID_SHORT: 'أسطر الإيداع التي تسمي الدفعة تدفع أقل من صافيها',
      PAID_OVER: 'أسطر الإيداع التي تسمي الدفعة تدفع أكثر من صافيها',
      PAYOUT: 'إيداع من إيداعات الدفعة للمراجعة',
      CREDIT: 'المبلغ في البنك ليس مجموع أسطر الإيداع',
      NOT_DEPOSITED: 'لا إيداع بنكي يسمي الإيداع حتى تاريخ «كما في»',
      UNLINKED_CREDIT: 'وصل إلى البنك، ولا يقول ملف من البوابة أي دفعات يسدد',
    },
    check: 'راجع الدفعات',
  },
};
// The page writes an amount at the scope's decimals with grouped thousands
// and the minus first; written here on its own, not taken from the
// application.
const minor = (v, decimals) => {
  const digits = String(Math.abs(v)).padStart(decimals + 1, '0');
  const whole = (decimals ? digits.slice(0, -decimals) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    ',',
  );
  return `${v < 0 ? '-' : ''}${whole}${decimals ? `.${digits.slice(-decimals)}` : ''}`;
};

async function suiteCases(folder, oracle, dense) {
  const list = [];
  for (const id of Object.keys(oracle).sort(byText)) {
    const given = await json(path.join(folder, `${id}-input.json`));
    list.push({
      id,
      files: given.names.map((n) => path.join(folder, n)),
      scope: given.scope,
      oracle: oracle[id],
      dense,
    });
  }
  return list;
}
const frozen = path.join(suiteDir, 'frozen');
const cases = await suiteCases(
  frozen,
  (await json(path.join(frozen, 'EXPECTED.json'))).stories,
  false,
);
let denseDir = null;
if (!SUITE) {
  denseDir = mkdtempSync(path.join(tmpdir(), 'pg1-dense-'));
  execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), denseDir], {
    stdio: 'ignore',
  });
  const raw = execFileSync(
    'python3',
    ['-B', path.join(foundation, 'oracle.py'), '--dense', denseDir],
    { maxBuffer: 1 << 30 },
  );
  const sealed = (await json(path.join(frozen, 'DENSE-MANIFEST.json')))
    .expectedSha256;
  if (createHash('sha256').update(raw).digest('hex') !== sealed)
    throw Error('the dense expectations differ from the seal');
  cases.push(
    ...(await suiteCases(denseDir, JSON.parse(raw.toString()).stories, true)),
  );
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
  const panel = await openDomainWorkspace(page, 'gateway');
  const details = panel.locator('details[data-pgb-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-pgb]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-pgb]')?.getAttribute('aria-busy') ===
      'false',
    null,
    { timeout: 600000 },
  );
async function pick(page, pgb, c, confirmScope = c.scope.confirmed) {
  for (const [side, role] of ROLES.entries()) {
    await pgb
      .locator(`input[data-pgb-file="${role}"]`)
      .setInputFiles(c.files[side]);
    await idle(page);
    await pgb.locator(`[data-pgb-confirm="${role}"]`).check();
  }
  for (const [k, v] of Object.entries(c.scope))
    if (k !== 'confirmed') await pgb.locator(`[data-pgb-scope="${k}"]`).fill(v);
  if (confirmScope) await pgb.locator('[data-pgb-scope-confirm]').check();
}
async function load(page, pgb, c, lang = 'en') {
  await pick(page, pgb, c);
  await pgb.getByRole('button', { name: WORDS[lang].check }).click();
  await pgb
    .locator('[data-pgb-result], [data-pgb-refused], [data-pgb-error]')
    .first()
    .waitFor({ timeout: 600000 });
  await idle(page);
}
// Every row of one paged table, page after page; a dense story only on its
// first and last pages.
async function rows(pgb, pager, selector, read, dense) {
  const found = [];
  const bar = pgb.locator(`[data-pgb-pager="${pager}"]`);
  const pages = (await bar.count())
    ? Number(/\/\s*(\d+)/.exec(await bar.locator('span').textContent())[1])
    : 1;
  for (let page = 0; page < pages; page++) {
    if (!dense || page === 0 || page === pages - 1)
      for (const row of await pgb.locator(selector).all())
        found.push(await read(row));
    if (page + 1 < pages) await bar.locator('button').last().click();
  }
  return { found, pages };
}
const cells = (r) => r.locator('td').allTextContents();
async function shown(pgb, dense) {
  const state = await pgb.getAttribute('data-pgb-state');
  const refusal = pgb.locator('[data-pgb-refused]');
  if (await refusal.count())
    return {
      state,
      refused: await refusal.getAttribute('data-pgb-refused'),
      heading: await refusal.locator('h3').textContent(),
      errors: await pgb.locator('tr[data-pgb-error-row]').count(),
      result: await pgb.locator('[data-pgb-result]').count(),
    };
  if (!(await pgb.locator('[data-pgb-result]').count()))
    return { state, error: await pgb.locator('[data-pgb-error]').count() };
  const batches = await rows(
    pgb,
    'batches',
    'tr[data-pgb-batch]',
    async (r) => ({
      batch: await r.getAttribute('data-pgb-batch'),
      status: await r.getAttribute('data-pgb-batch-status'),
      reasons: (await r.getAttribute('data-pgb-batch-reasons'))
        .split(' ')
        .filter(Boolean),
      cells: await cells(r),
    }),
    dense,
  );
  const payouts = await rows(
    pgb,
    'payouts',
    'tr[data-pgb-payout]',
    async (r) => ({
      payout: await r.getAttribute('data-pgb-payout'),
      status: await r.getAttribute('data-pgb-payout-status'),
      reasons: (await r.getAttribute('data-pgb-payout-reasons'))
        .split(' ')
        .filter(Boolean),
      cells: await cells(r),
    }),
    dense,
  );
  const credits = await rows(
    pgb,
    'credits',
    'tr[data-pgb-credit]',
    async (r) => ({ cells: await cells(r) }),
    dense,
  );
  const reasonCounts = [];
  for (const li of await pgb.locator('[data-pgb-reason-count]').all())
    reasonCounts.push([
      await li.getAttribute('data-pgb-reason-count'),
      await li.textContent(),
    ]);
  return {
    state,
    reasonCounts,
    summary: JSON.parse(
      await pgb.locator('[data-pgb-summary]').getAttribute('data-pgb-summary'),
    ),
    batches,
    payouts,
    credits,
  };
}
const shownPages = (list, pages, dense) =>
  dense && pages > 1
    ? [...list.slice(0, PAGE), ...list.slice((pages - 1) * PAGE)]
    : list;
function judge(c, seen, lang = 'en') {
  const o = c.oracle,
    w = WORDS[lang],
    d = o.decimals,
    differ = [];
  const rowsText = (list) => (list.length ? list.join(w.list) : '—');
  const words = (codes) =>
    codes.length ? codes.map((k) => `${w.reasons[k]} (${k})`).join('; ') : '—';
  if (o.refused) {
    if (
      seen.state !== 'refused' ||
      seen.refused !== o.refused ||
      seen.result !== 0 ||
      !seen.heading?.includes(`(${o.refused})`)
    )
      differ.push('refusal');
    if (o.refused === 'SOURCE_ERRORS' && !seen.errors)
      differ.push('error rows');
    return differ;
  }
  if (seen.state !== 'shown' || !seen.batches) return ['state'];
  if (
    !isDeepStrictEqual(seen.summary, [
      o.batches.length,
      o.payouts.length,
      o.credits.length,
    ])
  )
    differ.push('summary');
  const counts = Object.keys(w.reasons)
    .map((k) => [k, o.batches.filter((b) => b.reasons.includes(k)).length])
    .filter(([, n]) => n)
    .map(([k, n]) => [k, `${w.reasons[k]} (${k}): ${n}`]);
  if (!isDeepStrictEqual(seen.reasonCounts, counts))
    differ.push('reason counts');
  const batches = shownPages(o.batches, seen.batches.pages, c.dense);
  if (seen.batches.found.length !== batches.length) differ.push('batch rows');
  batches.forEach((b, i) => {
    const s = seen.batches.found[i];
    if (!s) return;
    const want = [
      b.batch,
      String(b.row),
      `${minor(b.components.sales, d)} / ${minor(b.settlement.gross, d)}`,
      `${minor(b.components.refunds, d)} / ${minor(b.settlement.refunds, d)}`,
      `${minor(b.components.fees, d)} / ${minor(b.settlement.fees, d)}`,
      minor(b.settlement.net, d),
      minor(b.paid, d),
      b.payouts.length ? b.payouts.join(w.list) : '—',
      rowsText(b.sales),
      rowsText(b.refunds),
      rowsText(b.fees),
      w.status[b.status],
      words(b.reasons),
    ];
    if (s.batch !== b.batch) differ.push(`batch ${i}`);
    if (s.status !== b.status) differ.push(`status ${b.batch}`);
    if (!isDeepStrictEqual(s.reasons, b.reasons))
      differ.push(`reasons ${b.batch}`);
    if (!isDeepStrictEqual(s.cells, want)) differ.push(`cells ${b.batch}`);
  });
  const payouts = shownPages(o.payouts, seen.payouts.pages, c.dense);
  if (seen.payouts.found.length !== payouts.length) differ.push('payout rows');
  payouts.forEach((p, i) => {
    const s = seen.payouts.found[i];
    if (!s) return;
    const want = [
      p.payout,
      rowsText(p.lines),
      p.batches.join(w.list),
      minor(p.amount, d),
      p.credit ? String(p.credit.row) : '—',
      p.credit ? p.credit.valueDate : '—',
      p.credit ? minor(p.credit.amount, d) : '—',
      w.status[p.status],
      words(p.reasons),
    ];
    if (s.payout !== p.payout) differ.push(`payout ${i}`);
    if (s.status !== p.status) differ.push(`status ${p.payout}`);
    if (!isDeepStrictEqual(s.reasons, p.reasons))
      differ.push(`reasons ${p.payout}`);
    if (!isDeepStrictEqual(s.cells, want)) differ.push(`cells ${p.payout}`);
  });
  const credits = o.credits.map((k) => [
    String(k.row),
    k.reference,
    k.payout,
    k.valueDate,
    minor(k.amount, d),
    words(k.reasons),
  ]);
  if (
    !isDeepStrictEqual(
      seen.credits.found.map((k) => k.cells),
      shownPages(credits, seen.credits.pages, c.dense),
    )
  )
    differ.push('credits');
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
  ctx.setDefaultTimeout(120000);
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
    const pgb = await open(page, 'en');
    if (c.oracle.refused === 'SCOPE' && c.scope.confirmed === false) {
      // A scope the accountant has not confirmed: nothing can be asked.
      await pick(page, pgb, c);
      const button = pgb.getByRole('button', { name: WORDS.en.check });
      const held =
        (await button.isDisabled()) &&
        (await pgb.getAttribute('data-pgb-state')) === 'idle';
      report.cases[c.id] = {
        equal: held,
        status: 'unconfirmed',
        differ: held ? [] : ['the button does not wait for the scope'],
      };
      if (FAIL_FAST) assert.ok(held, `${c.id}: the button does not wait`);
      continue;
    }
    await load(page, pgb, c);
    const seen = await shown(pgb, c.dense);
    const differ = judge(c, seen);
    report.cases[c.id] = {
      equal: !differ.length,
      status: seen.state,
      differ,
    };
    if (FAIL_FAST)
      assert.ok(!differ.length, `${c.id} differs: ${differ.join(', ')}`);
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: the same facts, the words in Arabic.
    {
      const pgb = await open(page, 'ar');
      await load(page, pgb, byId.F08, 'ar');
      const seen = await shown(pgb, false);
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal: !judge(byId.F08, seen, 'ar').length,
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const pgb = await open(page, 'en');
      await load(page, pgb, byId.F22);
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file, or another scope value, clears the shown review.
    {
      const pgb = await open(page, 'en');
      await load(page, pgb, byId.F01);
      await pgb
        .locator('input[data-pgb-file="payout-lines"]')
        .setInputFiles(byId.F02.files[3]);
      await idle(page);
      const check = pgb.getByRole('button', { name: WORDS.en.check });
      const fileCleared =
        (await pgb.locator('[data-pgb-result]').count()) === 0 &&
        !(await pgb.locator('[data-pgb-confirm="payout-lines"]').isChecked()) &&
        (await check.isDisabled());
      await load(page, pgb, byId.F01);
      await pgb.locator('[data-pgb-scope="asOf"]').fill('2026-10-11');
      const scopeCleared =
        (await pgb.locator('[data-pgb-result]').count()) === 0 &&
        !(await pgb.locator('[data-pgb-scope-confirm]').isChecked()) &&
        (await check.isDisabled());
      report.checks.staleCleared = fileCleared && scopeCleared;
    }
    // The keyboard reaches the section's summary and opens it, and its five
    // inputs are the native file inputs.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'gateway');
      const details = panel.locator('details[data-pgb-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      const inputs = panel.locator('[data-pgb] input[type="file"]');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await inputs.count()) === 5 &&
        (await inputs.first().isVisible());
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
  if (denseDir) rmSync(denseDir, { recursive: true, force: true });
}
