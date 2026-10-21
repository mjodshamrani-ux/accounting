// BNK-PDF-1 G4 acceptance in the built application: real uploads into the
// bank workspace, the genuine Worker, and local downloads only. Every frozen
// statement goes from upload to match, session save and restore, and Excel;
// the matches read from the page must equal the independent oracle's
// EXPECTED.json, and every downloaded workbook is read by the independent
// checker (audit/bank-statement-foundation/check_export.py). Decisions are
// taken with the page's own buttons. Worker replies are only observed, or
// held and then delivered unchanged to test cancellation; nothing is
// fabricated or injected.
//   pnpm build && node --experimental-strip-types scripts/bank-statement-workspace-browser.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { ar as arCatalogue } from '../lib/i18n/locales/ar.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { heldReason } from '../lib/reconciliation/bank-statement-view.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  dist = path.join(root, 'dist'),
  suite = path.join(root, 'audit/bank-statement-foundation'),
  frozen = path.join(suite, 'frozen');
const output =
  process.env.BNK_G4_BROWSER_DIR ??
  path.join(root, 'work/bank-statement-workspace-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files)
  assert.equal(
    sha(await readFile(path.join(frozen, e.file))),
    e.sha256,
    e.file,
  );
const { factsJson } = await import(path.join(suite, 'stories.mjs'));
const factsText = factsJson();
assert.equal(
  sha(factsText),
  manifest.facts.sha256,
  'facts differ from the seal',
);
const facts = JSON.parse(factsText);
await writeFile(path.join(out, 'stories.json'), factsText);
const expected = await json(path.join(frozen, 'EXPECTED.json'));
const storyOf = (id) => facts.stories.find((s) => s.id === id);
const wantOf = (id) => expected.stories.find((s) => s.id === id);

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local'),
      f = path.resolve(
        dist,
        '.' +
          decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname),
      );
    assert.ok(f.startsWith(dist + path.sep));
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
        '.png': 'image/png',
      }[path.extname(f)] ?? 'application/octet-stream',
    );
    res.end(await readFile(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/** The engine's result in the foundation's keys. */
function inKeys(result, story) {
  const keys = story.statement.pages
    .flatMap((p) => p.lines)
    .filter((l) => l.kind === 'movement')
    .map((l) => l.key);
  const s = (id) => keys[Number(id.slice(1)) - 1];
  const voucher = new Map(story.cashbook.map((r) => [r.voucher, r.key]));
  const c = (id) => voucher.get(id);
  return { s, c, keys };
}
const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** The page's result equals the oracle's, and no automatic pair is one the
 * story's author did not intend. */
function sameAsOracle(result, id) {
  const story = storyOf(id),
    want = wantOf(id);
  if (want.statement !== 'verified') {
    assert.equal(result.status, 'held', id);
    assert.deepEqual(
      { bank: result.match.held.statement, cash: result.match.held.cashbook },
      want.held,
      `${id} held counts`,
    );
    assert.deepEqual(result.cases, [], `${id}: cases while held`);
    return { auto: 0, falseAuto: 0 };
  }
  const { s, c } = inKeys(result, story);
  const auto = result.cases
    .filter((k) => k.kind === 'automatic')
    .map((k) => `${s(k.statement[0])}|${c(k.cashbook[0])}`);
  assert.deepEqual(
    sorted(auto),
    sorted(want.auto.map((p) => p.join('|'))),
    `${id} auto`,
  );
  assert.deepEqual(
    sorted(
      result.cases
        .filter((k) => k.kind === 'review')
        .map(
          (k) =>
            `${sorted(k.statement.map(s)).join(',')}/${sorted(k.cashbook.map(c)).join(',')}/${k.reason}`,
        ),
    ),
    sorted(
      want.review.map(
        (g) =>
          `${sorted(g.bank).join(',')}/${sorted(g.cash).join(',')}/${g.reason}`,
      ),
    ),
    `${id} review`,
  );
  assert.deepEqual(
    sorted(result.match.statementOnly.map(s)),
    sorted(want.bankOnly),
    `${id} statement only`,
  );
  assert.deepEqual(
    sorted(result.match.cashbookOnly.map(c)),
    sorted(want.cashOnly),
    `${id} cashbook only`,
  );
  assert.deepEqual(
    sorted(result.match.timing.map(s)),
    sorted(want.timing),
    `${id} timing`,
  );
  const intended = new Set(story.intent.auto.map((p) => p.join('|')));
  return {
    auto: auto.length,
    falseAuto: auto.filter((p) => !intended.has(p)).length,
  };
}

const errors = [],
  external = [],
  nonGet = [],
  checks = [],
  exportsToCheck = [],
  statements = [];
let browser;
async function open(lang, width) {
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width, height: 1000 },
  });
  ctx.setDefaultTimeout(180000);
  ctx.on('request', (r) => {
    if (!r.url().startsWith(origin + '/') && !/^(blob:|data:)/.test(r.url()))
      external.push(r.url());
    if (r.method() !== 'GET') nonGet.push(r.method() + ' ' + r.url());
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    globalThis.statementReplies = [];
    globalThis.statementHold = false;
    globalThis.statementQueue = [];
    globalThis.statementTerminated = 0;
    globalThis.Worker = new Proxy(Worker, {
      construct(target, args) {
        const w = Reflect.construct(target, args);
        w.addEventListener('message', (e) => {
          if (e.data?.action?.startsWith('bank-statement-'))
            globalThis.statementReplies.push(e.data);
        });
        // Delay authentic transport only to test cancellation; never change
        // or fabricate a reply.
        const nativeSet = Object.getOwnPropertyDescriptor(
          Worker.prototype,
          'onmessage',
        ).set.bind(w);
        let handler = null;
        nativeSet((e) => {
          if (
            globalThis.statementHold &&
            e.data?.action?.startsWith('bank-statement-')
          ) {
            const receive = handler;
            globalThis.statementQueue.push(() => receive?.call(w, e));
          } else handler?.call(w, e);
        });
        Object.defineProperty(w, 'onmessage', {
          get: () => handler,
          set: (v) => {
            handler = v;
          },
          configurable: true,
        });
        const terminate = w.terminate.bind(w);
        w.terminate = () => {
          globalThis.statementTerminated++;
          return terminate();
        };
        return w;
      },
    });
  });
  await page.goto(origin);
  if (lang === 'en')
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
  const w = await openDomainWorkspace(page, 'bank', {
    advanced: false,
    requiredSources: false,
  });
  // The movement path stays the default, unchanged.
  assert.equal(await w.getByTestId('bank-source-0').count(), 1);
  assert.equal(
    await w.locator('[data-testid^="bank-statement-source-"]').count(),
    0,
  );
  await w.locator('[data-bank-source-mode] input[value="statement"]').check();
  const c = bankStatementCopy[lang],
    bank = (lang === 'ar' ? arCatalogue : enCatalogue).bank;
  const replies = () => page.evaluate(() => globalThis.statementReplies.length);
  const settle = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-domain-panel="bank"] main.bank-workspace')
          ?.getAttribute('aria-busy') === 'false',
    );
  /** Runs an action and waits for its reply and the page to settle. */
  const act = async (run) => {
    const before = await replies();
    await run();
    await page.waitForFunction(
      (n) => globalThis.statementReplies.length > n,
      before,
    );
    await settle();
    return page.evaluate(() => globalThis.statementReplies.at(-1));
  };
  const choose = async (role, file) => {
    await w
      .getByLabel(c[role], { exact: true })
      .setInputFiles(path.join(frozen, file));
    await w
      .locator(`[data-bank-statement-file="${role}"]`)
      .filter({ hasText: file })
      .waitFor();
    assert.equal(await w.locator('[data-bank-statement-result]').count(), 0);
  };
  const button = (name, scope = w) =>
    scope.getByRole('button', { name, exact: true });
  const compare = () => act(() => button(c.compare).click());
  const download = async (name, file) => {
    const pending = page.waitForEvent('download');
    await button(name).click();
    const d = await pending;
    const target = path.join(out, file);
    await d.saveAs(target);
    await settle();
    return { name: d.suggestedFilename(), target };
  };
  const restore = async (file) => {
    const advanced = w.locator('details[data-workspace-advanced]').first();
    if ((await advanced.getAttribute('open')) === null)
      await advanced.locator(':scope > summary').click();
    const input = w.getByLabel(bank.restore, { exact: true });
    return act(() => input.setInputFiles(file));
  };
  const table = (key) =>
    w
      .locator(`[data-bank-statement-table="${key}"] tbody tr`)
      .evaluateAll((rows) =>
        rows.map((r) =>
          [...r.querySelectorAll('td')].map((td) => td.textContent.trim()),
        ),
      );
  return {
    page,
    w,
    c,
    bank,
    ctx,
    act,
    settle,
    choose,
    compare,
    download,
    restore,
    table,
    button,
  };
}

/** The rendered tables against the installed result. */
async function rendered(u, result) {
  assert.equal(
    await u.w
      .locator('[data-bank-statement-status]')
      .getAttribute('data-bank-statement-status'),
    result.status,
  );
  assert.equal(
    await u.w.locator('[data-bank-statement-status]').innerText(),
    u.c.status[result.status],
  );
  if (result.match.held) {
    assert.equal(
      await u.w
        .locator('[data-bank-statement-held]')
        .getAttribute('data-bank-statement-held'),
      heldReason(result.match.held.reason).kind,
    );
    for (const key of ['review', 'automatic', 'outstanding'])
      assert.equal(
        await u.w.locator(`[data-bank-statement-table="${key}"]`).count(),
        0,
      );
    assert.equal(await u.button(u.c.accept).count(), 0);
    return;
  }
  const ids = async (key) => (await u.table(key)).map((r) => r[0]);
  const review = result.cases.filter((k) => k.kind === 'review');
  const automatic = result.cases.filter((k) => k.kind === 'automatic');
  assert.deepEqual(
    await ids('review'),
    review.map((k) => k.id),
  );
  assert.deepEqual(
    await ids('automatic'),
    automatic.slice(0, 50).map((k) => k.id),
  );
  assert.deepEqual(
    (await u.table('review')).map((r) => r[5]),
    review.map((k) => u.c.caseStatus[k.status]),
  );
  assert.deepEqual(
    (await u.table('outstanding')).map((r) => r[1]),
    result.outstanding.map((o) => o.id),
  );
  assert.deepEqual(
    (await u.table('timing')).map((r) => r[0]),
    result.match.timing,
  );
}
/** A workbook for the checker, with the decisions in the foundation's keys. */
function toCheck(
  name,
  id,
  file,
  statement,
  cashbook,
  result,
  confirmedClosing,
) {
  const story = storyOf(id);
  const { s, c } = inKeys(result, story);
  exportsToCheck.push({
    name,
    story: id,
    path: file,
    statement,
    cashbook,
    confirmedClosing,
    decisions: result.decisions.map((d) => ({
      id: d.id,
      type: d.type,
      bank: d.statement.map(s),
      cash: d.cashbook.map(c),
      at: d.at,
      note: d.note,
    })),
  });
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const started = performance.now();
  // Every statement, alternating languages and a phone width, on two pages
  // that are reused: a new file must clear the previous result.
  const pages = { ar: await open('ar', 1440), en: await open('en', 390) };
  for (const [i, story] of facts.stories.entries()) {
    const id = story.id,
      u = i % 2 ? pages.en : pages.ar;
    const statementFile = `${id}-statement.pdf`,
      cashbookFile = `${id}-cashbook.csv`;
    await u.choose('statement', statementFile);
    await u.choose('cashbook', cashbookFile);
    const reply = await u.compare();
    assert.equal(reply.ok, true, `${id}: ${reply.error}`);
    const result = reply.value.result;
    const oracle = sameAsOracle(result, id);
    await rendered(u, result);
    // Save, restore on the same page, and export the restored session.
    const session = await u.download(u.c.save, `${id}-session.json`);
    assert.equal(session.name, 'tarasuf-bank-statement-session.json');
    const back = await u.restore(session.target);
    assert.equal(back.ok, true, `${id} restore: ${back.error}`);
    assert.deepEqual(back.value.result, result, `${id}: restored result`);
    await rendered(u, back.value.result);
    const book = await u.download(u.c.export, `${id}.xlsx`);
    assert.equal(book.name, 'tarasuf-bank-statement-workpaper.xlsx');
    toCheck(id, id, book.target, statementFile, cashbookFile, result, null);
    statements.push({
      id,
      status: result.status,
      verified: wantOf(id).statement === 'verified',
      automatic: oracle.auto,
      falseAutomatic: oracle.falseAuto,
      cases: result.cases.length,
      outstanding: result.outstanding.length,
    });
  }
  checks.push('16 statements: upload, match, save, restore and Excel');
  await pages.ar.page.screenshot({
    path: path.join(out, 'ar-1440-last.png'),
    fullPage: false,
  });
  await pages.en.page.screenshot({
    path: path.join(out, 'en-390-last.png'),
    fullPage: false,
  });

  // Decisions with the page's own buttons.
  const u = pages.ar;
  const decide = async (row, name) => {
    const target = u.button(name, row);
    assert.equal(await target.isEnabled(), true, name);
    return u.act(() => target.click());
  };
  const reviewRow = (n = 0) =>
    u.w.locator('[data-bank-statement-table="review"] tbody tr').nth(n);
  const automaticRow = (n = 0) =>
    u.w.locator('[data-bank-statement-table="automatic"] tbody tr').nth(n);
  const note = u.w.getByLabel(u.c.note, { exact: true });
  async function load(id) {
    await u.choose('statement', `${id}-statement.pdf`);
    await u.choose('cashbook', `${id}-cashbook.csv`);
    return (await u.compare()).value.result;
  }
  // BS04: no decision without a reason; then accept the suggestion.
  let result = await load('BS04');
  for (const name of [u.c.accept, u.c.reject, u.c.undo])
    assert.equal(await u.button(name, reviewRow()).isEnabled(), false, name);
  await note.fill('Deposit slip matches the receipt');
  assert.equal(await u.button(u.c.undo, reviewRow()).isEnabled(), false);
  let reply = await decide(reviewRow(), u.c.accept);
  result = reply.value.result;
  assert.equal(result.status, 'reviewed');
  await rendered(u, result);
  sameAsOracle(result, 'BS04');
  // Save, reload the page cold, and restore from the advanced options.
  const session = await u.download(u.c.save, 'BS04-accepted-session.json');
  await u.page.reload();
  const cold = await openDomainWorkspace(u.page, 'bank', {
    advanced: false,
    requiredSources: false,
  });
  assert.equal(
    await cold.locator('[data-bank-statement-result]').count(),
    0,
    'nothing survives a reload but the saved file',
  );
  reply = await u.restore(session.target);
  assert.deepEqual(reply.value.result, result, 'cold restore');
  assert.equal(
    await u.w
      .locator('[data-bank-source-mode] input[value="statement"]')
      .isChecked(),
    true,
    'a statement session selects the statement path',
  );
  await rendered(u, result);
  let book = await u.download(u.c.export, 'BS04-accepted.xlsx');
  toCheck(
    'BS04-accepted',
    'BS04',
    book.target,
    'BS04-statement.pdf',
    'BS04-cashbook.csv',
    result,
    null,
  );
  // BS05: an amount difference cannot be accepted, only rejected.
  await load('BS05');
  await note.fill('Reviewed');
  assert.equal(await u.button(u.c.accept, reviewRow()).isEnabled(), false);
  assert.equal(await u.button(u.c.reject, reviewRow()).isEnabled(), true);
  // BS12: reject the suggestion; both members become outstanding.
  result = await load('BS12');
  await note.fill('Different payee on the voucher');
  result = (await decide(reviewRow(), u.c.reject)).value.result;
  const rejected = result.cases.find((k) => k.status === 'rejected');
  assert.deepEqual(
    (await u.table('outstanding')).map((r) => [r[1], r[2]]),
    [...rejected.statement, ...rejected.cashbook].map((m) => [
      m,
      u.c.rejectedIn(rejected.id),
    ]),
  );
  sameAsOracle(result, 'BS12');
  book = await u.download(u.c.export, 'BS12-rejected.xlsx');
  toCheck(
    'BS12-rejected',
    'BS12',
    book.target,
    'BS12-statement.pdf',
    'BS12-cashbook.csv',
    result,
    null,
  );
  // BS02: reject an automatic match, then undo it.
  result = await load('BS02');
  await note.fill('Cheque recorded twice');
  result = (await decide(automaticRow(), u.c.reject)).value.result;
  assert.equal(result.cases[0].status, 'rejected');
  assert.equal(await u.button(u.c.reject, automaticRow()).isEnabled(), false);
  await note.fill('Rejected in error');
  result = (await decide(automaticRow(), u.c.undo)).value.result;
  assert.equal(result.cases[0].status, 'matched-automatic');
  assert.equal(result.decisions.length, 2);
  await rendered(u, result);
  book = await u.download(u.c.export, 'BS02-undone.xlsx');
  toCheck(
    'BS02-undone',
    'BS02',
    book.target,
    'BS02-statement.pdf',
    'BS02-cashbook.csv',
    result,
    null,
  );
  checks.push(
    'decisions: reason required, accept, reject, undo, refusal of an amount difference, cold restore',
  );

  // BS01 as a table: held until its closing balance is confirmed.
  await u.choose('statement', 'BS01-statement.csv');
  await u.choose('cashbook', 'BS01-cashbook.csv');
  assert.equal(await u.button(u.c.compare).isEnabled(), false, 'no currency');
  await u.w.getByLabel(u.c.currency, { exact: true }).selectOption('SAR');
  await u.w.getByLabel(u.c.periodStart, { exact: true }).fill('2026-07-01');
  await u.w.getByLabel(u.c.periodEnd, { exact: true }).fill('2026-07-31');
  result = (await u.compare()).value.result;
  assert.equal(heldReason(result.match.held.reason).kind, 'confirm-closing');
  await rendered(u, result);
  const closing = u.w.getByLabel(u.c.closing, { exact: true });
  await closing.fill('1250');
  assert.equal(
    await u.button(u.c.compare).isEnabled(),
    false,
    'invalid closing',
  );
  assert.equal(
    await u.w.getByText(u.c.closingInvalid, { exact: true }).isVisible(),
    true,
  );
  const own = bs01Closing();
  await closing.fill(money(own + 1));
  result = (await u.compare()).value.result;
  assert.equal(heldReason(result.match.held.reason).kind, 'closing-differs');
  assert.ok(
    !(await u.w.locator('[data-bank-statement-held]').innerText()).includes(
      money(own).replace('-', ''),
    ),
    'the file’s own closing is not shown',
  );
  await closing.fill(money(own));
  result = (await u.compare()).value.result;
  assert.equal(result.status, 'reviewed');
  assert.equal(result.match.statement.completeness, 'confirmed-closing');
  sameAsOracle(result, 'BS01');
  await rendered(u, result);
  book = await u.download(u.c.export, 'BS01-csv-confirmed.xlsx');
  toCheck(
    'BS01-csv-confirmed',
    'BS01',
    book.target,
    'BS01-statement.csv',
    'BS01-cashbook.csv',
    result,
    own,
  );
  checks.push(
    'table statement: currency required, held, wrong and malformed closing, confirmed',
  );

  // Refusals are named, and leave no result.
  await u.choose('statement', 'BS01-cashbook.csv');
  reply = await u.compare();
  assert.equal(reply.ok, false);
  assert.equal(
    await u.w
      .locator('[data-bank-statement-failure]')
      .getAttribute('data-bank-statement-failure'),
    'statement-layout',
  );
  await u.choose('statement', 'BS04-statement.pdf');
  await u.choose('cashbook', 'BS01-statement.csv');
  reply = await u.compare();
  assert.equal(reply.ok, false);
  assert.equal(
    await u.w
      .locator('[data-bank-statement-failure]')
      .getAttribute('data-bank-statement-failure'),
    'cashbook',
  );
  assert.equal(await u.w.locator('[data-bank-statement-result]').count(), 0);
  checks.push(
    'a cashbook as the statement and a statement as the cashbook are refused by name',
  );

  // Cancel: an authentic reply held back and delivered after cancelling is
  // never installed; the next request works on a fresh Worker.
  await u.choose('cashbook', 'BS04-cashbook.csv');
  const terminated = await u.page.evaluate(
    () => globalThis.statementTerminated,
  );
  await u.page.evaluate(() => {
    globalThis.statementHold = true;
  });
  await u.button(u.c.compare).click();
  await u.page.waitForFunction(() => globalThis.statementQueue.length > 0);
  await u.button(u.bank.cancel).click();
  await u.settle();
  await u.page.evaluate(() => {
    globalThis.statementHold = false;
    for (const deliver of globalThis.statementQueue.splice(0)) deliver();
  });
  await u.page.waitForTimeout(100);
  assert.equal(await u.w.locator('[data-bank-statement-result]').count(), 0);
  assert.ok(
    (await u.page.evaluate(() => globalThis.statementTerminated)) > terminated,
  );
  result = (await u.compare()).value.result;
  sameAsOracle(result, 'BS04');
  checks.push(
    'cancelled authentic late reply not installed; fresh Worker recovers',
  );

  // Switching the source type keeps each path's work.
  await u.w.locator('[data-bank-source-mode] input[value="movements"]').check();
  assert.equal(await u.w.getByTestId('bank-source-0').count(), 1);
  assert.equal(await u.w.locator('[data-bank-statement-result]').count(), 0);
  await u.w.locator('[data-bank-source-mode] input[value="statement"]').check();
  await rendered(u, result);
  checks.push('switching source type keeps the statement result');
  const seconds = Math.round((performance.now() - started) / 1000);

  // The independent check of every downloaded workbook.
  const check = spawnSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, 'check_export.py')],
    {
      cwd: suite,
      input: JSON.stringify({
        facts: path.join(out, 'stories.json'),
        frozen,
        exports: exportsToCheck,
      }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(check.status, 0, check.stderr);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.exports.length, exportsToCheck.length);

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'external requests');
  assert.deepEqual(nonGet, [], 'non-GET requests');
  const verified = statements.filter((s) => s.verified);
  const report = {
    schema: 'tarasuf-bnk-pdf1-g4-browser/1',
    capacity: {
      eligible: verified.length,
      completed: verified.filter(
        (s) => s.status !== 'held' && s.falseAutomatic === 0,
      ).length,
      held: statements.filter((s) => !s.verified && s.status === 'held').length,
      falseAutomatic: statements.reduce((n, s) => n + s.falseAutomatic, 0),
    },
    statements,
    checks,
    workbooksChecked: checked.exports.length,
    seconds,
    errors,
    external,
    nonGet,
  };
  assert.equal(report.capacity.eligible, 14);
  assert.equal(report.capacity.completed, 14);
  assert.equal(report.capacity.held, 2);
  assert.equal(report.capacity.falseAutomatic, 0);
  await writeFile(
    path.join(out, 'checks.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      out: path.relative(root, out),
      capacity: report.capacity,
      workbooksChecked: report.workbooksChecked,
      checks: checks.length,
      seconds,
    }),
  );
} finally {
  await browser?.close();
  server.close();
}

function bs01Closing() {
  return storyOf('BS01')
    .statement.pages.flatMap((p) => p.lines)
    .find((l) => l.kind === 'closing').balance;
}
function money(minor) {
  const sign = minor < 0 ? '-' : '';
  const s = String(Math.abs(minor)).padStart(3, '0');
  return `${sign}${s.slice(0, -2)}.${s.slice(-2)}`;
}
