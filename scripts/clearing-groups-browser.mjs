// CLR-1c browser acceptance: every sealed CLR-1 story (or, with
// CLR_GROUPS_SUITE, every story of another sealed suite) through the built
// application's clearing workspace, with its native file input, the reading
// and scope chosen on the page and the real worker. Compared with the sealed
// expectations as the page writes them: the summary, the groups to review by
// reason, every group with its members, net, status, reasons and the lines
// that hold it, every faulty line with its code and isolation, the blank
// lines, and each reason in words with its code. A dense story's groups are
// compared on its first and last page; everything else in full. A story over
// the reader's ceiling must be refused at reading, with no groups shown. On
// the foundation also: Arabic, a phone width, the keyboard, a stale result
// after a scope change, and no request off the page.
//
//   pnpm build && node scripts/clearing-groups-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.CLR_GROUPS_DIST ?? 'dist');
const SUITE = process.env.CLR_GROUPS_SUITE;
const suiteDir = path.resolve(SUITE ?? 'audit/clearing-groups-foundation');
const foundation = path.resolve('audit/clearing-groups-foundation');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.CLR_GROUPS_BROWSER_DIR ??
  'work/clearing-groups/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PAGE = 50;
const COLUMNS = {
  posting: 'Unique posting ID',
  reference: 'Clearing reference',
  date: 'Movement date',
  amount: 'Signed amount',
  debit: 'Debit',
  credit: 'Credit',
  account: 'Account',
  currency: 'Currency',
  description: 'Description',
};
const SCOPE = {
  entity: 'Entity',
  ledger: 'Ledger',
  account: 'Account',
  currency: 'Currency',
  start: 'Period start',
  end: 'Period end',
};

const cases = [];
const frozen = path.join(suiteDir, 'frozen');
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
for (const name of (await readdir(frozen)).sort(byText))
  if (name.endsWith('-input.json')) {
    const id = name.slice(0, -'-input.json'.length);
    cases.push({ id, folder: frozen, oracle: expected[id], dense: false });
  }
let dense = null;
if (!SUITE) {
  dense = mkdtempSync(path.join(tmpdir(), 'clr1-dense-'));
  execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), dense], {
    stdio: 'ignore',
  });
  const judged = JSON.parse(
    execFileSync(
      'python3',
      ['-B', path.join(foundation, 'oracle.py'), '--dense', dense],
      { maxBuffer: 1 << 30 },
    ).toString(),
  );
  const sealed = (await json(path.join(frozen, 'DENSE-MANIFEST.json')))
    .expectedSha256;
  if (!isDeepStrictEqual(judged.sha256, sealed))
    throw Error('the dense expectations differ from the seal');
  for (const id of Object.keys(judged.stories).sort(byText))
    cases.push({
      id,
      folder: dense,
      oracle: judged.stories[id],
      dense: true,
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
  await openDomainWorkspace(page, 'clearing');
  return page.locator('#clearing');
}
const settled = (page, selector) =>
  page.waitForFunction(
    (s) =>
      document.querySelector(s) ||
      document.querySelector('#clearing [role="alert"]'),
    selector,
    { timeout: 600000 },
  );
async function load(page, w, c, times) {
  const given = await json(path.join(c.folder, `${c.id}-input.json`));
  let t = Date.now();
  await w
    .getByLabel('Clearing movements file', { exact: true })
    .setInputFiles(path.join(c.folder, given.name));
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('#clearing h2')].some(
        (h) => h.textContent === name,
      ) || document.querySelector('#clearing [role="alert"]'),
    given.name,
    { timeout: 600000 },
  );
  times.read = Date.now() - t;
  if (await w.locator('[role="alert"]').count()) return { loaded: false };
  const r = given.reading;
  if (r.mode === 'split')
    await w.getByLabel('Amount layout').selectOption('split');
  for (const [key, label] of Object.entries(COLUMNS))
    if (r[key] >= 0)
      await w
        .getByLabel(label, { exact: true })
        .filter({ has: page.locator('option') })
        .selectOption(String(r[key]));
  for (const [key, label] of Object.entries(SCOPE))
    await w
      .getByLabel(label, { exact: true })
      .filter({ hasNot: page.locator('option') })
      .fill(given.scope[key]);
  await w
    .getByLabel('I reviewed the column meanings and scope:', { exact: false })
    .check();
  t = Date.now();
  await w
    .getByRole('button', { name: 'Show the clearing groups', exact: true })
    .click();
  await settled(
    page,
    '[data-clearing-groups][data-groups-state="shown"], [data-clearing-groups][data-groups-state="refused"]',
  );
  times.check = Date.now() - t;
  return { loaded: true };
}
async function pages(w, pager, selector, read, only) {
  const found = [];
  for (let page = 0; ; page++) {
    if (!only || only(page))
      for (const row of await w.locator(selector).all())
        found.push(await read(row));
    const next = w.locator(`[data-groups-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return found;
}
async function shown(w, c) {
  const section = w.locator('[data-clearing-groups]');
  const state = await section.getAttribute('data-groups-state');
  if (state === 'refused')
    return {
      state,
      refused: await section
        .locator('[data-groups-refused]')
        .getAttribute('data-groups-refused'),
    };
  if (state !== 'shown') return { state };
  const groupCount = JSON.parse(
    await section
      .locator('[data-groups-summary]')
      .getAttribute('data-groups-summary'),
  )[0];
  const lastPage = Math.max(0, Math.ceil(groupCount / PAGE) - 1);
  const groups = await pages(
    section,
    'groups',
    '[data-group]',
    async (row) => [
      JSON.parse(await row.getAttribute('data-group')),
      await row.locator('[data-group-reasons]').textContent(),
    ],
    c.dense ? (page) => page === 0 || page === lastPage : null,
  );
  return {
    state,
    summary: JSON.parse(
      await section
        .locator('[data-groups-summary]')
        .getAttribute('data-groups-summary'),
    ),
    reasons: Object.fromEntries(
      await Promise.all(
        (await section.locator('[data-groups-reason]').all()).map(
          async (li) => [
            await li.getAttribute('data-groups-reason'),
            Number(await li.getAttribute('data-count')),
          ],
        ),
      ),
    ),
    groups,
    faulty: await pages(section, 'faulty', '[data-faulty]', async (row) =>
      JSON.parse(await row.getAttribute('data-faulty')),
    ),
    blank: (await section.locator('[data-groups-blank]').count())
      ? JSON.parse(
          await section
            .locator('[data-groups-blank]')
            .getAttribute('data-groups-blank'),
        )
      : [],
  };
}
function judge(c, loaded, seen) {
  const o = c.oracle,
    differ = [];
  if (o.refused) {
    if (o.refused === 'ROWS') {
      if (loaded.loaded || seen) differ.push('refusal at reading');
    } else if (seen?.refused !== o.refused) differ.push('refusal');
    return differ;
  }
  if (!seen || seen.state !== 'shown') return ['not shown'];
  const want = o.groups.map((g) => [
    g.reference,
    g.members,
    g.net,
    g.status,
    g.reasons,
    g.connected,
    g.duplicates,
  ]);
  const lastPage = Math.max(0, Math.ceil(want.length / PAGE) - 1);
  const wantShown = c.dense
    ? [...want.slice(0, PAGE), ...(lastPage ? want.slice(lastPage * PAGE) : [])]
    : want;
  if (
    !isDeepStrictEqual(seen.summary, [
      o.groups.length,
      o.groups.filter((g) => g.status === 'cleared').length,
      o.errors.length,
      o.errors.filter((e) => e[2]).length,
    ])
  )
    differ.push('summary');
  const reasons = {};
  for (const g of o.groups)
    for (const code of g.reasons) reasons[code] = (reasons[code] ?? 0) + 1;
  if (!isDeepStrictEqual(seen.reasons, reasons)) differ.push('reasons');
  if (
    !isDeepStrictEqual(
      seen.groups.map(([g]) => g),
      wantShown,
    )
  )
    differ.push('groups');
  if (
    seen.groups.some(([g, words]) =>
      g[4].some((code) => !words.includes(`(${code})`)),
    )
  )
    differ.push('reasons in words');
  if (!isDeepStrictEqual(seen.faulty, o.errors)) differ.push('faulty lines');
  if (!isDeepStrictEqual(seen.blank, o.blank)) differ.push('blank lines');
  return differ;
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
  const ctx = await browser.newContext();
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
    const loaded = await load(page, w, c, times);
    const seen = loaded.loaded ? await shown(w, c) : null;
    const differ = judge(c, loaded, seen);
    report.cases[c.id] = { equal: !differ.length, differ };
    timings[c.id] = times;
    // The mutation runner stops at the first story that differs; the record
    // of an ordinary run lists every story.
    if (process.env.CLR_GROUPS_FAIL_FAST)
      assert.ok(
        !differ.length,
        `${c.id} shows what the expectations say: ${differ.join(', ')}`,
      );
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: the same groups, the reasons in Arabic.
    {
      const w = await open(page, 'ar');
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      await load(page, w, byId.F11, {});
      await page
        .getByRole('button', { name: 'AR العربية', exact: true })
        .click();
      const seen = await shown(w, byId.F11);
      report.checks.arabic =
        !judge(byId.F11, { loaded: true }, seen).length &&
        seen.groups.every(([g, words]) =>
          g[4].every((code) => words.includes(`(${code})`)),
        ) &&
        (await w.locator('[data-group-reasons]').allTextContents()).every(
          (text) => !text.trim() || /[\u0600-\u06ff]/.test(text),
        ) &&
        (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const w = await open(page, 'en');
      await load(page, w, byId.F17, {});
      report.checks.phone = await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A scope change after a result drops it.
    {
      const w = await open(page, 'en');
      await load(page, w, byId.F08, {});
      const before = await w.locator('[data-group]').count();
      await w
        .getByLabel('Ledger', { exact: true })
        .filter({ hasNot: page.locator('option') })
        .fill('Another ledger');
      report.checks.staleCleared =
        before > 0 &&
        (await w.locator('[data-group]').count()) === 0 &&
        (await w
          .locator('[data-clearing-groups]')
          .getAttribute('data-groups-state')) === 'idle';
    }
    // The keyboard reaches the button and shows the groups.
    {
      const w = await open(page, 'en');
      const c = byId.F04;
      const given = await json(path.join(c.folder, `${c.id}-input.json`));
      await load(page, w, c, {});
      await w
        .getByLabel('Ledger', { exact: true })
        .filter({ hasNot: page.locator('option') })
        .fill(given.scope.ledger + ' ');
      await w
        .getByLabel('Ledger', { exact: true })
        .filter({ hasNot: page.locator('option') })
        .fill(given.scope.ledger);
      const button = w.getByRole('button', {
        name: 'Show the clearing groups',
        exact: true,
      });
      // Not before the reading and scope are confirmed again.
      report.checks.needsConfirmation = await button.isDisabled();
      await w
        .getByLabel('I reviewed the column meanings and scope:', {
          exact: false,
        })
        .check();
      await button.focus();
      await page.keyboard.press('Enter');
      await settled(page, '[data-clearing-groups][data-groups-state="shown"]');
      report.checks.keyboard = !judge(c, { loaded: true }, await shown(w, c))
        .length;
    }
  }
  if (!SUITE) {
    // A refusal is shown with its code, and nothing is grouped.
    const w = await open(page, 'en');
    await load(
      page,
      w,
      cases.find((c) => c.id === 'F01'),
      {},
    );
    await w
      .getByLabel('Unique posting ID', { exact: true })
      .filter({ has: page.locator('option') })
      .selectOption('1');
    await w
      .getByLabel('I reviewed the column meanings and scope:', { exact: false })
      .check();
    await w
      .getByRole('button', { name: 'Show the clearing groups', exact: true })
      .click();
    await settled(page, '[data-clearing-groups][data-groups-state="refused"]');
    const alert = w.locator('[data-groups-refused]');
    report.checks.refusal =
      (await alert.getAttribute('data-groups-refused')) === 'COLUMNS' &&
      (await alert.textContent()).includes('(COLUMNS)') &&
      (await w.locator('[data-group]').count()) === 0;
  }
  report.errors = errors;
  report.external = external;
  const all = Object.values(report.cases);
  report.summary = {
    cases: `${all.filter((s) => s.equal).length}/${all.length}`,
    checks: report.checks,
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
  server.close();
  if (dense) rmSync(dense, { recursive: true, force: true });
}
