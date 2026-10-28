// ALL-1c browser acceptance: every sealed ALL-1 story (or, with
// ALL_ADVICE_SUITE, every story of another sealed suite) through the built
// application's allocation workspace and the real worker. Each story's three
// sealed files, readings, scope and decisions are restored as an allocation
// session made from its sealed bytes, through the workspace's own session
// input; one story is also opened through the three native file inputs, its
// readings and its scope. Then the advice review is asked for and compared
// with the sealed expectations as the page writes them: the summary, the lines
// to review by reason, every advice line with its row, status, reasons,
// competitors and twins, each reason in words with its code, and every payment
// and invoice with its remaining capacity, open advice and excess. A dense
// story's lines and items are compared on their first and last page;
// everything else in full. A story the family refuses, and a source row
// error beside decisions, must be refused at restore with no review offered;
// a source row error alone must refuse the review with its code, shown on the
// page. On the foundation also: Arabic, a phone width, the keyboard, a review
// dropped after a decision and shown again with that decision, and no request
// off the page.
//
//   pnpm build && node scripts/allocation-advice-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.ALL_ADVICE_DIST ?? 'dist');
const SUITE = process.env.ALL_ADVICE_SUITE;
const suiteDir = path.resolve(SUITE ?? 'audit/allocation-advice-foundation');
const foundation = path.resolve('audit/allocation-advice-foundation');
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.ALL_ADVICE_BROWSER_DIR ??
  'work/allocation-advice/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PAGE = 50;
const REASONS = [
  'OVER_PAYMENT',
  'OVER_INVOICE',
  'COMPETES_PAYMENT',
  'COMPETES_INVOICE',
  'TWIN',
];
const SIDES = ['Available payments', 'Open invoices', 'Proposed remittance'];
// The words the page must show for a line, in each language.
const WORDS = {
  en: {
    status: { allocated: 'Allocated', fits: 'Fits', review: 'To review' },
    rows: (rows) =>
      rows.length > 10
        ? `${rows.length} lines: rows ${rows.slice(0, 10).join(', ')}, …`
        : rows.length
          ? `rows ${rows.join(', ')}`
          : '—',
  },
  ar: {
    status: {
      allocated: 'مخصص',
      fits: 'يسع',
      review: 'للمراجعة',
    },
    rows: (rows) =>
      rows.length > 10
        ? `${rows.length} سطرًا: الصفوف ${rows.slice(0, 10).join('، ')}، …`
        : rows.length
          ? `الصفوف ${rows.join('، ')}`
          : '—',
  },
};
const SCOPE = {
  entity: 'Entity',
  ledger: 'Ledger',
  party: 'Supplier',
  account: 'Payable account',
  currency: 'Currency',
  cutoff: 'Snapshot date',
};

const cases = [];
const frozen = path.join(suiteDir, 'frozen');
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
for (const name of (await readdir(frozen)).sort(byText))
  if (name.endsWith('-input.json')) {
    const id = name.slice(0, -'-input.json'.length);
    const events = (await json(path.join(frozen, name))).events.length;
    cases.push({
      id,
      folder: frozen,
      oracle: expected[id],
      dense: false,
      events,
    });
  }
let dense = null;
if (!SUITE) {
  dense = mkdtempSync(path.join(tmpdir(), 'all1-dense-'));
  execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), dense], {
    stdio: 'ignore',
  });
  const raw = execFileSync(
    'python3',
    ['-B', path.join(foundation, 'oracle.py'), '--dense', dense],
    { maxBuffer: 1 << 30 },
  );
  const sealed = (await json(path.join(frozen, 'DENSE-MANIFEST.json')))
    .expectedSha256;
  if (createHash('sha256').update(raw).digest('hex') !== sealed)
    throw Error('the dense expectations differ from the seal');
  const judged = JSON.parse(raw.toString()).stories;
  for (const id of Object.keys(judged).sort(byText)) {
    const events = (await json(path.join(dense, `${id}-input.json`))).events
      .length;
    cases.push({ id, folder: dense, oracle: judged[id], dense: true, events });
  }
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
  return openDomainWorkspace(page, 'allocation');
}
const ALERT = '[data-domain-panel="allocation"] [role="alert"]';
// The session the workspace saves, made here from the story's sealed bytes.
async function session(c) {
  const given = await json(path.join(c.folder, `${c.id}-input.json`));
  const files = [];
  for (const name of given.names) {
    const bytes = await readFile(path.join(c.folder, name));
    files.push({
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    });
  }
  const file = path.join(out, 'sessions', `${c.id}-session.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      format: 'tarasuf-allocation-session',
      version: 'allocation-snapshot-1',
      files,
      readings: given.readings,
      scope: given.scope,
      events: given.events,
    }),
  );
  return file;
}
async function restore(page, w, c, times) {
  const file = await session(c);
  const t = Date.now();
  await w
    .getByLabel('Restore allocation session', { exact: true })
    .setInputFiles(file);
  await page.waitForFunction(
    (alert) =>
      document.querySelector(
        '[data-domain-panel="allocation"] [data-testid="allocation-result"]',
      ) || document.querySelector(alert),
    ALERT,
    { timeout: 600000 },
  );
  times.restore = Date.now() - t;
  return {
    restored: (await w.getByTestId('allocation-result').count()) === 1,
  };
}
const settled = (page, state) =>
  page.waitForFunction(
    (s) =>
      document.querySelector(
        `[data-allocation-advice][data-advice-state="${s}"]`,
      ) ||
      document.querySelector(
        '[data-allocation-advice][data-advice-state="refused"]',
      ) ||
      document.querySelector(
        '[data-domain-panel="allocation"] main > [role="alert"]',
      ),
    state,
    { timeout: 600000 },
  );
async function review(page, w, times = {}) {
  const t = Date.now();
  await w
    .getByRole('button', { name: 'Review the advice lines', exact: true })
    .click();
  await settled(page, 'shown');
  times.review = Date.now() - t;
}
async function pages(w, pager, selector, read, only) {
  const found = [];
  for (let page = 0; ; page++) {
    if (!only || only(page))
      for (const row of await w.locator(selector).all())
        found.push(await read(row));
    const next = w.locator(`[data-advice-pager="${pager}"] button`).last();
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  return found;
}
const ends = (n) => {
  const last = Math.max(0, Math.ceil(n / PAGE) - 1);
  return (page) => page === 0 || page === last;
};
const endsOf = (list) => {
  const last = Math.max(0, Math.ceil(list.length / PAGE) - 1);
  return [...list.slice(0, PAGE), ...(last ? list.slice(last * PAGE) : [])];
};
async function shown(w, c) {
  const section = w.locator('[data-allocation-advice]');
  if (!(await section.count())) return { state: 'absent' };
  const state = await section.getAttribute('data-advice-state');
  if (state === 'refused') {
    // A refusal the page does not show is a difference, not a wait.
    const alert = section.locator('[data-advice-refused]');
    if (!(await alert.count())) return { state, refused: null, words: '' };
    return {
      state,
      refused: await alert.getAttribute('data-advice-refused'),
      words: await alert.textContent(),
    };
  }
  if (state !== 'shown') return { state };
  const summary = JSON.parse(
    await section
      .locator('[data-advice-summary]')
      .getAttribute('data-advice-summary'),
  );
  return {
    state,
    summary,
    reasons: Object.fromEntries(
      await Promise.all(
        (await section.locator('[data-advice-reason]').all()).map(
          async (li) => [
            await li.getAttribute('data-advice-reason'),
            Number(await li.getAttribute('data-count')),
          ],
        ),
      ),
    ),
    lines: await pages(
      section,
      'lines',
      '[data-advice-line]',
      async (row) => [
        JSON.parse(await row.getAttribute('data-advice-line')),
        await row.locator('[data-advice-reasons]').textContent(),
        await row.locator('[data-advice-status]').textContent(),
        (await row.locator('[data-advice-competitors]').textContent()).trim(),
        await row.locator('[data-advice-twins]').textContent(),
      ],
      c.dense ? ends(summary[0]) : null,
    ),
    items: await pages(
      section,
      'items',
      '[data-advice-item]',
      async (row) => JSON.parse(await row.getAttribute('data-advice-item')),
      c.dense ? ends(c.oracle.items.length) : null,
    ),
  };
}
function judge(c, loaded, seen, lang = 'en') {
  const o = c.oracle,
    differ = [];
  if (o.refused && (o.refused !== 'SOURCE_ERRORS' || c.events)) {
    // The family refuses the files or decisions, and a source row error
    // beside decisions: nothing to review.
    if (loaded.restored || seen.state !== 'absent')
      differ.push('refusal at restore');
    return differ;
  }
  if (!loaded.restored) return ['not restored'];
  if (o.refused) {
    if (seen.refused !== o.refused || !seen.words.includes(`(${o.refused})`))
      differ.push('refusal');
    return differ;
  }
  if (seen.state !== 'shown') return ['not shown'];
  const count = (s) => o.lines.filter((l) => l.status === s).length;
  if (
    !isDeepStrictEqual(seen.summary, [
      o.lines.length,
      count('fits'),
      count('review'),
      count('allocated'),
    ])
  )
    differ.push('summary');
  const reasons = {};
  for (const l of o.lines)
    for (const code of l.reasons) reasons[code] = (reasons[code] ?? 0) + 1;
  if (
    !isDeepStrictEqual(
      seen.reasons,
      Object.fromEntries(
        REASONS.filter((r) => reasons[r]).map((r) => [r, reasons[r]]),
      ),
    )
  )
    differ.push('reasons');
  const lines = o.lines.map((l) => [
    l.row,
    l.status,
    l.reasons,
    l.competitors,
    l.twins,
  ]);
  if (
    !isDeepStrictEqual(
      seen.lines.map(([l]) => l),
      c.dense ? endsOf(lines) : lines,
    )
  )
    differ.push('lines');
  if (
    seen.lines.some(([l, words]) =>
      l[2].some((code) => !words.includes(`(${code})`)),
    )
  )
    differ.push('reasons in words');
  const words = WORDS[lang];
  if (
    seen.lines.some(
      ([l, , status, competitors, twins]) =>
        status !== words.status[l[1]] ||
        competitors !== words.rows(l[3]) ||
        twins !== words.rows(l[4]),
    )
  )
    differ.push('lines in words');
  const items = o.items.map((i) => [
    i.side,
    i.reference,
    i.remaining,
    i.advised,
    i.excess,
  ]);
  if (!isDeepStrictEqual(seen.items, c.dense ? endsOf(items) : items))
    differ.push('items');
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
    const loaded = await restore(page, w, c, times);
    if (loaded.restored) await review(page, w, times);
    const differ = judge(c, loaded, await shown(w, c));
    report.cases[c.id] = { equal: !differ.length, differ };
    timings[c.id] = times;
    // The mutation runner stops at the first story that differs; the record
    // of an ordinary run lists every story.
    if (process.env.ALL_ADVICE_FAIL_FAST)
      assert.ok(
        !differ.length,
        `${c.id} shows what the expectations say: ${differ.join(', ')}`,
      );
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // The three native file inputs, their readings and the scope typed on
    // the page give the same review as the restored session.
    {
      const c = byId.F33;
      const given = await json(path.join(c.folder, `${c.id}-input.json`));
      const w = await open(page, 'en');
      for (const side of [0, 1, 2]) {
        const source = w.getByTestId(`allocation-source-${side}`);
        await source
          .getByLabel(SIDES[side], { exact: true })
          .setInputFiles(path.join(c.folder, given.names[side]));
        await source
          .getByRole('heading', { name: given.names[side], exact: true })
          .waitFor();
        await source
          .getByLabel(`${SIDES[side]}: I reviewed`, { exact: false })
          .check();
      }
      for (const [key, label] of Object.entries(SCOPE))
        await w.getByLabel(label, { exact: true }).fill(given.scope[key]);
      await w
        .getByLabel(
          'I reviewed the entity, ledger, supplier, account, currency and snapshot before these allocations.',
          { exact: true },
        )
        .check();
      await w
        .getByRole('button', { name: 'Read value ledger', exact: true })
        .click();
      await w.getByTestId('allocation-result').waitFor();
      await review(page, w);
      report.checks.nativeInputs =
        given.events.length === 0 &&
        !judge(c, { restored: true }, await shown(w, c)).length;
    }
    // Arabic, right to left: the same review, the reasons in Arabic.
    {
      const c = byId.F33;
      const w = await open(page, 'en');
      await restore(page, w, c, {});
      await page
        .getByRole('button', { name: 'AR العربية', exact: true })
        .click();
      await w
        .getByRole('button', { name: 'راجع أسطر الحوالة', exact: true })
        .click();
      await settled(page, 'shown');
      const seen = await shown(w, c);
      report.checks.arabic =
        !judge(c, { restored: true }, seen, 'ar').length &&
        (await w.locator('[data-advice-reasons]').allTextContents()).every(
          (text) => !text.trim() || /[\u0600-\u06ff]/.test(text),
        ) &&
        (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const w = await open(page, 'en');
      await restore(page, w, byId.F33, {});
      await review(page, w);
      report.checks.phone =
        (await w
          .locator('[data-allocation-advice]')
          .getAttribute('data-advice-state')) === 'shown' &&
        (await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ));
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // The keyboard reaches the button and shows the review.
    {
      const c = byId.F03;
      const w = await open(page, 'en');
      await restore(page, w, c, {});
      await w
        .getByRole('button', { name: 'Review the advice lines', exact: true })
        .focus();
      await page.keyboard.press('Enter');
      await settled(page, 'shown');
      report.checks.keyboard = !judge(c, { restored: true }, await shown(w, c))
        .length;
    }
    // A decision drops the review shown before it; asked again, the review
    // shows that line allocated and the rest against what is left.
    {
      const c = byId.F01;
      const w = await open(page, 'en');
      await restore(page, w, c, {});
      await review(page, w);
      const before = await shown(w, c);
      const first = c.oracle.lines.find((l) => l.status === 'fits');
      await w
        .getByLabel('Decision or undo reason', { exact: true })
        .fill('Synthetic advice explicitly states this line');
      await w
        .getByTestId('allocation-proof')
        .filter({ hasText: `${first.reference}: ` })
        .locator('input')
        .check();
      await w
        .getByRole('button', {
          name: 'Approve selected advice atomically',
          exact: true,
        })
        .click();
      await w.getByTestId('allocation-event').first().waitFor();
      const dropped =
        (await w
          .locator('[data-allocation-advice]')
          .getAttribute('data-advice-state')) === 'idle' &&
        (await w.locator('[data-advice-line]').count()) === 0;
      await review(page, w);
      const after = await shown(w, c);
      const line = after.lines.find(([l]) => l[0] === first.row)?.[0];
      report.checks.afterDecision =
        !judge(c, { restored: true }, before).length &&
        dropped &&
        line?.[1] === 'allocated' &&
        isDeepStrictEqual(line[2], []) &&
        after.summary[3] === before.summary[3] + 1;
    }
    // A source row error refuses the review with its code, and nothing is
    // reviewed; the allocation above keeps its own source-error state.
    {
      const c = byId.F25;
      const w = await open(page, 'en');
      await restore(page, w, c, {});
      await review(page, w);
      const seen = await shown(w, c);
      report.checks.refusal =
        seen.refused === 'SOURCE_ERRORS' &&
        seen.words.includes('(SOURCE_ERRORS)') &&
        (await w.locator('[data-advice-line]').count()) === 0 &&
        (await w.getByTestId('allocation-status').count()) === 1;
    }
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
