// BNK-PDF-1 holdout in the browser, on the built application: each sealed
// statement of a holdout package (G6 to G15) with its cashbook (CSV, and a
// story's XLSX) is uploaded through the bank workspace's statement path and
// matched. A statement the page matches is compared with EXPECTED.json in the
// facts' keys, saved, restored from the saved file on a fresh page and
// exported to Excel; every workbook from a CSV cashbook goes through the
// package's independent export checker. On the story named by --decide, the
// first case the page lets the accountant accept is accepted, so that one
// checked workbook carries a decision. A refused statement must leave no
// result and name its refusal. The outcome is recorded as it comes; nothing
// stops at the first difference.
//   pnpm build && node --experimental-strip-types scripts/bank-statement-holdout-browser.mjs \
//     --suite=<package under audit/> --decide=<story> [--assert=<results file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const option = (name) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
assert.ok(
  option('suite') && option('decide'),
  'Usage: --suite=<holdout package under audit/> --decide=<story>',
);
const root = path.resolve(import.meta.dirname, '..'),
  dist = process.env.BNK_HOLDOUT_DIST ?? path.join(root, 'dist'),
  suite = path.resolve(root, option('suite')),
  frozen = path.join(suite, 'frozen');
const output = path.join(
  process.env.BNK_HOLDOUT_BROWSER_DIR ??
    path.join(root, 'work/bank-statement-holdout-browser'),
  path.basename(suite),
);
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files)
  assert.equal(sha(await readFile(path.join(frozen, e.file))), e.sha256, e.file);
const factsRun = spawnSync('python3', ['-B', path.join(suite, 'stories.py')], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(sha(factsRun.stdout), manifest.facts.sha256, 'facts differ from the seal');
const factsFile = path.join(out, 'stories.json');
await writeFile(factsFile, factsRun.stdout);
const stories = JSON.parse(factsRun.stdout).stories;
const expected = await json(path.join(frozen, 'EXPECTED.json'));

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local'),
      f = path.resolve(dist, '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    assert.ok(f.startsWith(dist + path.sep));
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.png': 'image/png' }[path.extname(f)] ??
        'application/octet-stream',
    );
    res.end(await readFile(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const c = bankStatementCopy.en;
const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const errors = [],
  external = [];

async function open(browser) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  ctx.setDefaultTimeout(180000);
  ctx.on('request', (r) => {
    if (!r.url().startsWith(origin + '/') && !/^(blob:|data:)/.test(r.url())) external.push(r.url());
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    globalThis.statementReplies = [];
    globalThis.Worker = new Proxy(Worker, {
      construct(target, args) {
        const w = Reflect.construct(target, args);
        w.addEventListener('message', (e) => {
          if (e.data?.action?.startsWith('bank-statement-')) globalThis.statementReplies.push(e.data);
        });
        return w;
      },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const w = await openDomainWorkspace(page, 'bank', { advanced: false, requiredSources: false });
  await w.locator('[data-bank-source-mode] input[value="statement"]').check();
  const act = async (run) => {
    const before = await page.evaluate(() => globalThis.statementReplies.length);
    await run();
    await page.waitForFunction((n) => globalThis.statementReplies.length > n, before, { timeout: 180000 });
    await page.waitForFunction(
      () => document.querySelector('[data-domain-panel="bank"] main.bank-workspace')?.getAttribute('aria-busy') === 'false',
    );
    return page.evaluate(() => globalThis.statementReplies.at(-1));
  };
  const button = (name) => w.getByRole('button', { name, exact: true });
  const download = async (name, file) => {
    const pending = page.waitForEvent('download', { timeout: 180000 }).catch(() => null);
    const reply = await act(() => button(name).click());
    const d = reply.ok ? await pending : null;
    if (!d) return { reply, target: null };
    const target = path.join(out, file);
    await d.saveAs(target);
    return { reply, target };
  };
  return { ctx, page, w, act, button, download };
}

/** The page's result in the facts' keys, against EXPECTED.json. */
function outcome(result, story, want) {
  if (want.statement !== 'verified')
    return {
      equal:
        result.status === 'held' &&
        result.match.held?.statement === want.held.bank &&
        result.match.held?.cashbook === want.held.cash &&
        result.cases.length === 0,
      falseAutomatic: result.cases.filter((k) => k.kind === 'automatic').length,
    };
  const keys = story.statement.pages.flatMap((p) => p.lines).filter((l) => l.kind === 'movement').map((l) => l.key);
  const s = (id) => keys[Number(id.slice(1)) - 1];
  const voucher = new Map(story.cashbook.map((r) => [r.voucher, r.key]));
  const k = (id) => voucher.get(id);
  const auto = result.cases.filter((x) => x.kind === 'automatic').map((x) => `${s(x.statement[0])}|${k(x.cashbook[0])}`);
  const review = result.cases
    .filter((x) => x.kind === 'review')
    .map((x) => `${sorted(x.statement.map(s)).join(',')}/${sorted(x.cashbook.map(k)).join(',')}/${x.reason}`);
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const allowed = new Set(want.auto.map((p) => p.join('|')));
  return {
    equal:
      result.status !== 'held' &&
      same(auto, want.auto.map((p) => p.join('|'))) &&
      same(review, want.review.map((g) => `${sorted(g.bank).join(',')}/${sorted(g.cash).join(',')}/${g.reason}`)) &&
      same(result.match.statementOnly.map(s), want.bankOnly) &&
      same(result.match.cashbookOnly.map(k), want.cashOnly) &&
      same(result.match.timing.map(s), want.timing),
    falseAutomatic: auto.filter((p) => !allowed.has(p)).length,
  };
}

const runs = [],
  exportsToCheck = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM ? { executablePath: process.env.MIZAN_CHROMIUM } : {}),
});
try {
  const u = await open(browser);
  for (const story of stories) {
    const want = expected.stories.find((x) => x.id === story.id);
    for (const cashbookFile of [
      `${story.id}-cashbook.csv`,
      ...(story.cashbookXlsx ? [`${story.id}-cashbook.xlsx`] : []),
    ]) {
      const run = { id: story.id, cashbook: cashbookFile };
      runs.push(run);
      for (const [role, file] of [['statement', `${story.id}-statement.pdf`], ['cashbook', cashbookFile]]) {
        await u.w.getByLabel(c[role], { exact: true }).setInputFiles(path.join(frozen, file));
        await u.w.locator(`[data-bank-statement-file="${role}"]`).filter({ hasText: file }).waitFor();
      }
      const reply = await u.act(() => u.button(c.compare).click());
      if (!reply.ok) {
        run.refused = reply.error;
        run.failureShown = await u.w
          .locator('[data-bank-statement-failure]')
          .getAttribute('data-bank-statement-failure')
          .catch(() => null);
        run.resultShown = await u.w.locator('[data-bank-statement-result]').count();
        continue;
      }
      let result = reply.value.result;
      Object.assign(run, { status: result.status, ...outcome(result, story, want) });
      // One decision on a new producer's statement: accept the first case
      // the page lets the accountant accept, with a written reason.
      if (story.id === option('decide') && run.equal) {
        await u.w.getByLabel(c.note, { exact: true }).fill('Bank slip seen for the cash deposit');
        const rows = u.w.locator('[data-bank-statement-table="review"] tbody tr');
        for (let i = 0; i < (await rows.count()); i++) {
          const accept = rows.nth(i).getByRole('button', { name: c.accept, exact: true });
          if (!(await accept.isEnabled())) continue;
          const decided = await u.act(() => accept.click());
          run.decision = decided.ok ? decided.value.result.decisions.map((d) => [d.type, d.note]) : decided.error;
          if (decided.ok) result = decided.value.result;
          break;
        }
      }
      const saved = await u.download(c.save, `${story.id}-${path.extname(cashbookFile).slice(1)}-session.json`);
      run.saved = !!saved.target;
      if (saved.target) {
        const cold = await open(browser);
        const advanced = cold.w.locator('details[data-workspace-advanced]').first();
        if ((await advanced.getAttribute('open')) === null) await advanced.locator(':scope > summary').click();
        const back = await cold.act(() =>
          cold.w.getByLabel(enCatalogue.bank.restore, { exact: true }).setInputFiles(saved.target),
        );
        run.restored = back.ok && JSON.stringify(back.value.result) === JSON.stringify(result);
        await cold.ctx.close();
      }
      const book = await u.download(c.export, `${story.id}-${path.extname(cashbookFile).slice(1)}.xlsx`);
      run.exported = !!book.target;
      if (book.target && cashbookFile.endsWith('.csv')) {
        const keys = story.statement.pages.flatMap((p) => p.lines).filter((l) => l.kind === 'movement').map((l) => l.key);
        const voucher = new Map(story.cashbook.map((r) => [r.voucher, r.key]));
        exportsToCheck.push({
          name: `${story.id}-csv`,
          story: story.id,
          path: book.target,
          statement: `${story.id}-statement.pdf`,
          cashbook: cashbookFile,
          confirmedClosing: null,
          decisions: result.decisions.map((d) => ({
            id: d.id,
            type: d.type,
            bank: d.statement.map((id) => keys[Number(id.slice(1)) - 1]),
            cash: d.cashbook.map((id) => voucher.get(id)),
            at: d.at,
            note: d.note,
          })),
        });
      }
    }
  }
  await u.ctx.close();
} finally {
  await browser.close();
  server.close();
}
const check = exportsToCheck.length
  ? spawnSync('python3', ['-B', path.join(suite, 'check_export.py')], {
      // The checker's self-test alters a decided case, so it runs on a
      // workbook that carries a decision.
      input: JSON.stringify({
        facts: factsFile,
        frozen,
        selfTest: exportsToCheck.find((e) => e.decisions.length)?.name ?? null,
        exports: exportsToCheck,
      }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  : null;
const checked = check?.status === 0 ? JSON.parse(check.stdout) : null;
const holdout = await json(path.join(suite, 'holdout.json'));
const complete = (r) => !r.refused && r.equal && r.saved && r.restored && r.exported;
const report = {
  schema: 'tarasuf-bnk-pdf1-holdout-browser/1',
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  summary: {
    capacity: holdout.eligibility.positives.filter((id) =>
      runs.filter((r) => r.id === id).every((r) => complete(r) && r.status !== 'held'),
    ),
    eligiblePositives: holdout.eligibility.positives.length,
    heldWhole: Object.keys(holdout.eligibility.held).filter((id) =>
      runs.filter((r) => r.id === id).every((r) => complete(r) && r.status === 'held'),
    ),
    refused: [...new Set(runs.filter((r) => r.refused).map((r) => r.id))],
    refusedWithResultShown: runs.filter((r) => r.refused && r.resultShown).map((r) => r.id),
    falseAutomatic: runs.reduce((t, r) => t + (r.falseAutomatic ?? 0), 0),
    workbooksChecked: checked?.exports.length ?? 0,
    exportCheck: check ? (check.status === 0 ? 'passed' : check.stderr.trim()) : 'no export',
    checkerSelfTest: checked?.selfTest?.alterations ?? null,
    pageErrors: errors.length,
    externalRequests: external.length,
  },
  runs,
};
await writeFile(path.join(out, 'browser.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ out, ...report.summary }));
// With --assert=<results file under audit/>, the outcome must equal the
// recorded one: a recorded failure stays visible, and a
// change in either direction is noticed.
const recordedFile = option('assert');
if (recordedFile) {
  const recorded = await json(path.join(root, recordedFile));
  assert.deepEqual(report.summary, recorded.summary, 'holdout outcome changed');
  assert.deepEqual(report.runs, recorded.runs, 'holdout runs changed');
}
