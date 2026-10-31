// INV-2c browser acceptance: every sealed INV-2 story (or, with IMB_SUITE,
// every story of another sealed suite) through the built application, in the
// inventory workspace's movement bridges section, with the two native file
// inputs, the scope entered on the page and the real worker. Compared with
// the sealed EXPECTED.json as the page writes it: the refusal, or every
// position's status and codes, for each position that is not held its unit,
// account, opening, flows, computed and printed closing, and lines, every
// position's rows, every account's status, codes and three sides, the
// excluded and dated lines, the unseen origins, the repeated headers, the
// unplaced rows, the totals and the run codes. Also, on the foundation:
// Arabic, a phone width, the keyboard, a stale result cleared by a new file
// in either role or a scope change, and no request off the page.
//
//   pnpm build && node scripts/inventory-movement-bridge-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.IMB_DIST ?? 'dist');
const SUITE = process.env.IMB_SUITE;
const suiteDir = path.resolve(SUITE ?? 'audit/inventory-movement-foundation');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.IMB_BROWSER_DIR ??
  'work/inventory-movement-bridge/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const CURRENCIES = (
  await json(path.resolve('audit/inventory-movement-foundation/contract.json'))
).reading.currencies;
const ROLES = ['movement-register', 'gl-summary'];
const MOVES = [
  'receipt',
  'issue',
  'transfer-in',
  'transfer-out',
  'adjustment-in',
  'adjustment-out',
  'return-in',
  'return-out',
];
const INFLOWS = ['receipt', 'transfer-in', 'adjustment-in', 'return-in'];
const OUTFLOWS = ['issue', 'transfer-out', 'adjustment-out', 'return-out'];
const SIDES = ['opening', 'debit', 'credit', 'closing'];
const TOTALS = [
  'opening',
  'receipt',
  'issue',
  'adjustment-in',
  'adjustment-out',
  'return-in',
  'return-out',
  'closing',
  'transferred',
];
// The kind as each language writes it, read back without the page's copy.
const KIND = {
  Opening: 'opening',
  Closing: 'closing',
  Receipt: 'receipt',
  Issue: 'issue',
  'Transfer in': 'transfer-in',
  'Transfer out': 'transfer-out',
  'Adjustment in': 'adjustment-in',
  'Adjustment out': 'adjustment-out',
  'Customer return': 'return-in',
  'Return to supplier': 'return-out',
  افتتاح: 'opening',
  ختام: 'closing',
  استلام: 'receipt',
  صرف: 'issue',
  'تحويل وارد': 'transfer-in',
  'تحويل صادر': 'transfer-out',
  'تسوية بالزيادة': 'adjustment-in',
  'تسوية بالنقص': 'adjustment-out',
  'مردود من عميل': 'return-in',
  'مردود إلى مورد': 'return-out',
};
// An integer of EXPECTED (a number, or text past the safe range) with its
// decimals, as a reader writes it.
const fixed = (v, decimals) => {
  if (v === null || v === undefined) return '—';
  const n = BigInt(String(v)),
    sign = n < 0n ? '-' : '',
    digits = String(n < 0n ? -n : n).padStart(decimals + 1, '0');
  return decimals
    ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : `${sign}${digits}`;
};
const pair = (p, d) =>
  p ? `${fixed(p.quantity, 3)} · ${fixed(p.value, d)}` : '—';
const sum = (flows, kinds, k) =>
  kinds.reduce((a, kind) => a + BigInt(String(flows[kind][k])), 0n);
const side = (s, d) => (s ? SIDES.map((k) => fixed(s[k], d)).join(' · ') : '—');
const list = (text) =>
  text === '—' ? [] : text.split(/[,،]\s*/).map((v) => Number(v));

const frozen = path.join(suiteDir, 'frozen');
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const cases = [];
for (const name of (await readdir(frozen)).sort(byText))
  if (name.endsWith('-scope.json')) {
    const id = name.slice(0, -'-scope.json'.length);
    const scope = await json(path.join(frozen, name));
    cases.push({
      id,
      files: [
        path.join(frozen, `${id}-register.csv`),
        path.join(frozen, `${id}-gl.csv`),
      ],
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
  const panel = await openDomainWorkspace(page, 'stock');
  const details = panel.locator('details[data-imb-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-imb]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-imb]')?.getAttribute('aria-busy') ===
      'false',
  );
async function pick(page, imb, role, file) {
  await imb.locator(`input[data-imb-file="${role}"]`).setInputFiles(file);
  await idle(page);
}
async function load(page, imb, c) {
  for (const [i, role] of ROLES.entries()) {
    await pick(page, imb, role, c.files[i]);
    await imb.locator(`[data-imb-confirm="${role}"]`).check();
  }
  for (const [k, v] of Object.entries(c.scope)) {
    const field = imb.locator(`[data-imb-scope="${k}"]`);
    if (k === 'Negative balances') await field.selectOption(v);
    else await field.fill(v);
  }
  await imb.locator('[data-imb-scope-confirm]').check();
  await imb
    .getByRole('button', { name: /Check the bridges|افحص الجسور/ })
    .click();
  await imb.locator('[data-imb-result], [data-imb-error]').first().waitFor();
  await idle(page);
  assert.equal(
    await imb.locator('[data-imb-error]').count(),
    0,
    'the page shows no failure',
  );
  assert.equal(
    await imb.locator('[data-imb-result]').count(),
    1,
    'the page shows a result',
  );
}
// Every row of one paged table, page after page.
async function rows(imb, pager, selector, read) {
  const found = [];
  for (;;) {
    for (const row of await imb.locator(selector).all())
      found.push(await read(row));
    const next = imb.locator(`[data-imb-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return found;
}
const marked = (imb, pager, name) =>
  rows(imb, pager, `tr[data-imb-${name}]`, async (r) =>
    JSON.parse(await r.getAttribute(`data-imb-${name}`)),
  );
const attr = async (imb, selector, name) =>
  (await imb.locator(selector).count())
    ? await imb.locator(selector).first().getAttribute(name)
    : null;
async function shown(imb) {
  const result = imb.locator('[data-imb-result]');
  const status = await result.getAttribute('data-imb-status');
  const verdict = await imb.locator('[data-imb-verdict]').textContent();
  if (status === 'refused')
    return {
      status,
      verdict,
      refused: await attr(imb, '[data-imb-verdict]', 'data-imb-refused'),
    };
  const positions = await rows(
    imb,
    'positions',
    'tr[data-imb-position]',
    async (r) => ({
      key: await r.getAttribute('data-imb-position'),
      status: await r.getAttribute('data-imb-position-status'),
      codes: (await r.getAttribute('data-imb-position-codes'))
        .split(' ')
        .filter(Boolean),
      cells: await r.locator('td').allTextContents(),
    }),
  );
  const flows = await rows(imb, 'flows', 'tr[data-imb-flow]', async (r) => {
    const [key, kind] = JSON.parse(await r.getAttribute('data-imb-flow'));
    const cells = await r.locator('td').allTextContents();
    return { key, kind, label: KIND[cells[1]], cells: cells.slice(2) };
  });
  const lines = await rows(imb, 'lines', 'tr[data-imb-line]', async (r) => {
    const [key, id] = JSON.parse(await r.getAttribute('data-imb-line'));
    const cells = await r.locator('td').allTextContents();
    return {
      key,
      id,
      kind: KIND[cells[2]],
      quantity: cells[3],
      value: cells[4],
      row: Number(cells[5]),
    };
  });
  const accounts = await rows(
    imb,
    'accounts',
    'tr[data-imb-account]',
    async (r) => ({
      account: await r.getAttribute('data-imb-account'),
      status: await r.getAttribute('data-imb-account-status'),
      codes: (await r.getAttribute('data-imb-account-codes'))
        .split(' ')
        .filter(Boolean),
      cells: await r.locator('td').allTextContents(),
    }),
  );
  const totals = {};
  for (const li of await imb.locator('[data-imb-total]').all())
    totals[await li.getAttribute('data-imb-total')] = await li
      .locator('bdi')
      .textContent();
  return {
    status,
    verdict,
    positions,
    flows,
    lines,
    accounts,
    excluded: await marked(imb, 'excluded', 'excluded'),
    dated: await marked(imb, 'dated', 'dated'),
    unseen: await marked(imb, 'unseen', 'unseen'),
    repeated: await marked(imb, 'repeated', 'repeated'),
    unplaced: await marked(imb, 'unplaced', 'unplaced'),
    run: ((await attr(imb, '[data-imb-run]', 'data-imb-run')) ?? '')
      .split(' ')
      .filter(Boolean),
    totals: Object.keys(totals).length ? totals : null,
    // A result without its totals section fails by assertion, not timeout.
    totalsSection: await imb.locator('[data-imb-totals]').count(),
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
  const keys = seen.positions.map((p) => p.key);
  if (
    !isDeepStrictEqual(
      [...keys].sort(byText),
      Object.keys(o.positions).sort(byText),
    ) ||
    new Set(keys).size !== keys.length
  )
    differ.push('positions');
  for (const p of seen.positions) {
    const want = o.positions[p.key];
    if (!want) continue;
    if (p.status !== want.status) differ.push(`status ${p.key}`);
    if (!isDeepStrictEqual(p.codes, want.codes)) differ.push(`codes ${p.key}`);
    if (!isDeepStrictEqual(list(p.cells[11]), want.rows))
      differ.push(`rows ${p.key}`);
    if (`${p.cells[0]}|${p.cells[1]}` !== p.key) differ.push(`item ${p.key}`);
    const shownFlows = seen.flows
      .filter((f) => f.key === p.key)
      .map((f) => [f.kind, f.label, ...f.cells]);
    const shownLines = seen.lines
      .filter((l) => l.key === p.key)
      .map((l) => [l.id, l.kind, l.quantity, l.value]);
    if (want.status === 'held') {
      if (p.cells.slice(4, 11).some((v) => v !== '—'))
        differ.push(`held figures ${p.key}`);
      if (shownFlows.length || shownLines.length)
        differ.push(`held detail ${p.key}`);
      continue;
    }
    const figures = [
      want.unit ?? '—',
      want.account ?? '—',
      pair(want.opening, d),
      want.flows
        ? `${fixed(sum(want.flows, INFLOWS, 'quantity'), 3)} · ${fixed(sum(want.flows, INFLOWS, 'value'), d)}`
        : '—',
      want.flows
        ? `${fixed(sum(want.flows, OUTFLOWS, 'quantity'), 3)} · ${fixed(sum(want.flows, OUTFLOWS, 'value'), d)}`
        : '—',
      pair(want.computed, d),
      pair(want.closing, d),
    ];
    if (!isDeepStrictEqual(p.cells.slice(4, 11), figures))
      differ.push(`figures ${p.key}`);
    const wantFlows = MOVES.filter(
      (k) =>
        want.flows &&
        (BigInt(String(want.flows[k].quantity)) !== 0n ||
          BigInt(String(want.flows[k].value)) !== 0n),
    ).map((k) => [
      k,
      k,
      fixed(want.flows[k].quantity, 3),
      fixed(want.flows[k].value, d),
    ]);
    if (!isDeepStrictEqual(shownFlows, wantFlows))
      differ.push(`flows ${p.key}`);
    const wantLines = (want.lines ?? []).map(([id, kind, q, v]) => [
      id,
      kind,
      fixed(q, 3),
      fixed(v, d),
    ]);
    if (!isDeepStrictEqual(shownLines, wantLines))
      differ.push(`lines ${p.key}`);
    const lineRows = seen.lines
      .filter((l) => l.key === p.key)
      .map((l) => l.row);
    if (lineRows.some((r) => !want.rows.includes(r)))
      differ.push(`line rows ${p.key}`);
  }
  const accounts = seen.accounts.map((a) => a.account);
  if (
    !isDeepStrictEqual(
      [...accounts].sort(byText),
      Object.keys(o.accounts).sort(byText),
    ) ||
    new Set(accounts).size !== accounts.length
  )
    differ.push('accounts');
  for (const a of seen.accounts) {
    const want = o.accounts[a.account];
    if (!want) continue;
    if (a.status !== want.status) differ.push(`account status ${a.account}`);
    if (!isDeepStrictEqual(a.codes, want.codes))
      differ.push(`account codes ${a.account}`);
    const sides = [want.register, want.gl, want.difference].map((s) =>
      side(s, d),
    );
    if (!isDeepStrictEqual(a.cells.slice(3, 6), sides))
      differ.push(`sides ${a.account}`);
  }
  if (!isDeepStrictEqual(seen.excluded, o.excluded)) differ.push('excluded');
  if (!isDeepStrictEqual(seen.dated, o.datedOutside)) differ.push('dated');
  if (!isDeepStrictEqual(seen.unseen, o.unseenOrigins)) differ.push('unseen');
  if (!isDeepStrictEqual(seen.repeated, o.repeatedHeaders))
    differ.push('repeated');
  if (!isDeepStrictEqual(seen.unplaced, o.unplaced)) differ.push('unplaced');
  if (!isDeepStrictEqual(seen.run, o.run)) differ.push('run');
  const totals =
    o.totals &&
    Object.fromEntries(TOTALS.map((k) => [k, fixed(o.totals[k], d)]));
  if (seen.totalsSection !== 1 || !isDeepStrictEqual(seen.totals, totals))
    differ.push('totals');
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
    const imb = await open(page, 'en');
    await load(page, imb, c);
    const seen = await shown(imb);
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
      const imb = await open(page, 'ar');
      await load(page, imb, byId.M01);
      const seen = await shown(imb);
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal: !judge(byId.M01, seen).length && seen.verdict === 'فُحص',
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const imb = await open(page, 'en');
      await load(page, imb, byId.M22);
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file in either role, or another scope value, clears the shown
    // result and needs a new confirmation before the next check.
    {
      const imb = await open(page, 'en');
      const check = imb.getByRole('button', { name: 'Check the bridges' });
      const cleared = async () =>
        (await imb.locator('[data-imb-result]').count()) === 0 &&
        (await check.isDisabled());
      const fileCleared = [];
      for (const [i, role] of ROLES.entries()) {
        await load(page, imb, byId.M01);
        await pick(page, imb, role, byId.M02.files[i]);
        fileCleared.push(
          (await cleared()) &&
            !(await imb.locator(`[data-imb-confirm="${role}"]`).isChecked()),
        );
      }
      await load(page, imb, byId.M01);
      await imb.locator('[data-imb-scope="Period end"]').fill('2026-10-30');
      const scopeCleared =
        (await cleared()) &&
        !(await imb.locator('[data-imb-scope-confirm]').isChecked());
      await load(page, imb, byId.M01);
      await imb
        .locator('[data-imb-scope="Negative balances"]')
        .selectOption('allowed');
      const negativeCleared =
        (await cleared()) &&
        !(await imb.locator('[data-imb-scope-confirm]').isChecked());
      report.checks.staleCleared =
        fileCleared.every(Boolean) && scopeCleared && negativeCleared;
    }
    // The keyboard reaches the section's summary and opens it.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'stock');
      const details = panel.locator('details[data-imb-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await panel
          .locator('[data-imb] input[type="file"]')
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
