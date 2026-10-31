// INV-3c browser acceptance: every sealed INV-3 story (or, with
// INV_LINKS_SUITE, every story of another sealed suite) through the built
// application's inventory workspace, with its four native file inputs, the
// scope typed into the page and the real worker. Compared with the sealed
// expectations as the page writes them: the linked count, every unlinked
// register row with its reasons and related rows, every other unlinked
// record. The links workbook each story downloads is checked by the
// independent reader (audit/inventory-links-foundation/check_workbook.py).
// The dense stories are regenerated and checked against their seal first, and
// the time to read, check and export each is written beside the record, not
// in it. On the foundation also: Arabic, a phone width, the keyboard, a stale
// result after a scope change, and no request off the page.
//
//   pnpm build && node scripts/inventory-links-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import {
  openDomainWorkspace,
  workspaceSource,
} from './domain-navigation-support.mjs';

const root = path.resolve(process.env.INV_LINKS_DIST ?? 'dist');
const SUITE = process.env.INV_LINKS_SUITE;
const suiteDir = path.resolve(SUITE ?? 'audit/inventory-links-foundation');
const foundation = path.resolve('audit/inventory-links-foundation');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.INV_LINKS_BROWSER_DIR ??
  'work/inventory-links/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ROLES = [
  'Posted inventory register',
  'Proposed item / GL mapping',
  'Independent supplied policy evidence',
  'Selected inventory GL balances',
];
const FILES = ['register', 'mapping', 'evidence', 'gl'];
const SCOPE = {
  entity: 'Entity',
  inventoryLedger: 'Inventory ledger',
  glLedger: 'GL ledger',
  currency: 'Currency',
  currencyBasis: 'Currency basis',
  postingStatus: 'Posting status',
  postingLayer: 'Posting layer',
  asOf: 'As of',
  chartVersion: 'Chart version',
  mapVersion: 'Map version',
  valuationPolicyVersion: 'Valuation policy version',
  inventoryAccountSetVersion: 'Inventory account set version',
};

const cases = [];
const frozen = path.join(suiteDir, 'frozen');
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
for (const name of (await readdir(frozen)).sort(byText))
  if (name.endsWith('-scope.json')) {
    const id = name.slice(0, -'-scope.json'.length);
    cases.push({
      id,
      folder: frozen,
      oracle: expected[id],
      expectedFile: path.join(frozen, 'EXPECTED.json'),
    });
  }
let dense = null;
if (!SUITE) {
  dense = mkdtempSync(path.join(tmpdir(), 'inv3-dense-'));
  execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), dense], {
    stdio: 'ignore',
  });
  const judged = execFileSync(
    'python3',
    ['-B', path.join(foundation, 'oracle.py'), '--dense', dense],
    {
      maxBuffer: 1 << 30,
    },
  );
  const parsed = JSON.parse(judged.toString());
  const sealed = (await json(path.join(frozen, 'DENSE-MANIFEST.json')))
    .expectedSha256;
  if (!isDeepStrictEqual(parsed.sha256, sealed))
    throw Error('the dense expectations differ from the seal');
  await writeFile(path.join(dense, 'EXPECTED.json'), judged);
  for (const id of Object.keys(parsed.stories).sort(byText))
    cases.push({
      id,
      folder: dense,
      oracle: parsed.stories[id],
      expectedFile: path.join(dense, 'EXPECTED.json'),
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
  await openDomainWorkspace(page, 'stock');
  return page.locator('[data-stock-workspace]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document
        .querySelector('[data-stock-workspace]')
        ?.getAttribute('aria-busy') === 'false',
    null,
    { timeout: 600000 },
  );
async function load(page, w, c, times) {
  let t = Date.now();
  for (const [i, role] of ROLES.entries()) {
    await w
      .getByLabel(role, { exact: true })
      .setInputFiles(path.join(c.folder, `${c.id}-${FILES[i]}.csv`));
    await idle(page);
    await workspaceSource(w, role).getByRole('checkbox').check();
  }
  times.read = Date.now() - t;
  const scope = await json(path.join(c.folder, `${c.id}-scope.json`));
  for (const [k, label] of Object.entries(SCOPE))
    await w
      .getByLabel('Inventory scope ' + label, { exact: true })
      .fill(scope[k]);
  await w
    .getByLabel(
      'I confirmed the complete snapshot scope and the selected inventory GL account set.',
      { exact: true },
    )
    .check();
  t = Date.now();
  await w
    .getByRole('button', { name: 'Check inventory / GL', exact: true })
    .click();
  await idle(page);
  times.check = Date.now() - t;
}
async function rows(w, pager, selector, read) {
  const found = [];
  for (;;) {
    for (const row of await w.locator(selector).all())
      found.push(await read(row));
    const next = w.locator(`[data-stock-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return found;
}
async function shown(w) {
  const section = w.locator('[data-stock-links]');
  if (!(await section.count()))
    return {
      result: false,
      error: (await w.locator('[data-stock-error]').count()) > 0,
    };
  return {
    result: true,
    linked: Number(await section.getAttribute('data-stock-linked')),
    allLinked: (await w.locator('[data-stock-all-linked]').count()) > 0,
    unlinked: await rows(
      w,
      'unlinked',
      'tr[data-stock-unlinked-row]',
      async (r) => [
        Number(await r.getAttribute('data-stock-unlinked-row')),
        (await r.getAttribute('data-stock-unlinked-reasons')).split(' '),
        JSON.parse(await r.getAttribute('data-stock-unlinked-related')),
        (await r.locator('td').nth(3).textContent()) ?? '',
      ],
    ),
    others: await rows(
      w,
      'others',
      'tr[data-stock-unlinked-record]',
      async (r) =>
        JSON.parse(await r.getAttribute('data-stock-unlinked-record')),
    ),
  };
}
function judge(c, seen) {
  const o = c.oracle;
  if (o.refused) return seen.result || !seen.error ? ['refusal'] : [];
  if (!seen.result) return ['no result'];
  const differ = [];
  const unlinked = o.links.filter((l) => l[1] === 'unlinked');
  if (seen.linked !== o.links.length - unlinked.length)
    differ.push('linked count');
  if (seen.allLinked !== !unlinked.length) differ.push('all linked');
  const want = unlinked.map(([row, , reasons, maps, evs, account, gl]) => [
    row,
    reasons,
    [maps, evs, account, gl],
  ]);
  if (
    !isDeepStrictEqual(
      seen.unlinked.map(([row, reasons, related]) => [row, reasons, related]),
      want,
    )
  )
    differ.push('unlinked rows');
  if (
    seen.unlinked.some(([, reasons, , words]) =>
      reasons.some((code) => !words.includes(`(${code})`)),
    )
  )
    differ.push('reasons in words');
  if (!isDeepStrictEqual(seen.others, o.unlinked))
    differ.push('other unlinked records');
  return differ;
}
async function exportLinks(page, w, c, times) {
  const t = Date.now();
  const pending = page.waitForEvent('download', { timeout: 600000 });
  await w
    .getByRole('button', { name: 'Export register links', exact: true })
    .click();
  const file = path.join(out, `${c.id}-links.xlsx`);
  await (await pending).saveAs(file);
  await idle(page);
  times.export = Date.now() - t;
  try {
    const checked = JSON.parse(
      execFileSync('python3', [
        '-B',
        path.join(foundation, 'check_workbook.py'),
        file,
        '--story',
        c.id,
        '--folder',
        c.folder,
        '--expected',
        c.expectedFile,
      ]).toString(),
    );
    return checked.passed;
  } catch {
    return false;
  }
}

let browser;
const errors = [],
  external = [];
const report = { cases: {}, checks: {} },
  timings = {};
try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const ctx = await browser.newContext({ acceptDownloads: true });
  ctx.setDefaultTimeout(600000);
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
    const w = await open(page, 'en');
    const times = {};
    await load(page, w, c, times);
    const seen = await shown(w);
    const differ = judge(c, seen);
    const workbook = seen.result ? await exportLinks(page, w, c, times) : null;
    if (seen.result && !workbook) differ.push('workbook');
    report.cases[c.id] = { equal: !differ.length, differ, workbook };
    timings[c.id] = times;
    // The mutation runner stops at the first story that differs; the record
    // of an ordinary run lists every story.
    if (process.env.INV_LINKS_FAIL_FAST)
      assert.ok(
        !differ.length,
        `${c.id} shows what the expectations say: ${differ.join(', ')}`,
      );
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: the same rows and reasons, the reasons in Arabic.
    {
      const w = await open(page, 'ar');
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      await load(page, w, byId.L26, {});
      await page
        .getByRole('button', { name: 'AR العربية', exact: true })
        .click();
      const seen = await shown(w);
      report.checks.arabic = {
        dir: await page.evaluate(() => document.documentElement.dir),
        equal:
          !judge(byId.L26, seen).length &&
          seen.unlinked.every(([, , , words]) => /[\u0600-ۿ]/.test(words)),
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const w = await open(page, 'en');
      await load(page, w, byId.L11, {});
      report.checks.phone = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A scope change after a result removes the links with the result.
    {
      const w = await open(page, 'en');
      await load(page, w, byId.L02, {});
      const before = await w.locator('[data-stock-links]').count();
      await w
        .getByLabel('Inventory scope Map version', { exact: true })
        .fill('MAP-CHANGED');
      report.checks.staleCleared =
        before === 1 && (await w.locator('[data-stock-links]').count()) === 0;
    }
    // The keyboard reaches the links export and starts it.
    {
      const w = await open(page, 'en');
      await load(page, w, byId.L02, {});
      const button = w.getByRole('button', {
        name: 'Export register links',
        exact: true,
      });
      await button.focus();
      const pending = page.waitForEvent('download', { timeout: 600000 });
      await page.keyboard.press('Enter');
      report.checks.keyboard = !!(await pending);
      await idle(page);
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
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 1) + '\n',
  );
  await writeFile(
    path.join(out, 'times.json'),
    JSON.stringify(timings, null, 1) + '\n',
  );
  for (const [id, s] of Object.entries(report.cases))
    console.log(
      id,
      s.equal ? 'equal' : `DIFFERS ${s.differ.join(', ')}`,
      JSON.stringify(timings[id]),
    );
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
      `${id} shows what the expectations say: ${s.differ.join(', ')}`,
    );
  for (const [k, v] of Object.entries(report.summary.checks)) assert.ok(v, k);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  if (dense) rmSync(dense, { recursive: true, force: true });
}
