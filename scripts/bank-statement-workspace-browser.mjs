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
import { money as formatMoney } from '../lib/reconciliation/core.ts';
import {
  heldDetail,
  heldReason,
} from '../lib/reconciliation/bank-statement-view.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BNK_G4_DIST: another build of the same source, for the interface mutation
  // gate; BNK_G4_BROWSER_QUICK=1 skips the sixteen-statement pass.
  dist = process.env.BNK_G4_DIST ?? path.join(root, 'dist'),
  quick = process.env.BNK_G4_BROWSER_QUICK === '1',
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
    globalThis.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        globalThis.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
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
  // A missing reply is an assertion failure, not a timeout, so that a
  // planted interface defect counts as caught (scripts/test-bank-statement-
  // interface-mutations.mjs).
  const act = async (run) => {
    const before = await replies();
    await run();
    await page
      .waitForFunction((n) => globalThis.statementReplies.length > n, before, {
        timeout: 120000,
      })
      .catch(() => assert.fail('no statement reply from the Worker'));
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
  // A refusal is a failed check unless the check expects one.
  const compare = async (refusal = false) => {
    assert.equal(await button(c.compare).isEnabled(), true, 'compare enabled');
    const reply = await act(() => button(c.compare).click());
    assert.equal(reply.ok, !refusal, `compare: ${reply.error ?? 'accepted'}`);
    return reply;
  };
  // A refused save or export, or one the page does not hand over, is a failed
  // check, not a timeout.
  const download = async (name, file) => {
    assert.equal(await button(name).isEnabled(), true, name);
    const pending = page
      .waitForEvent('download', { timeout: 120000 })
      .catch(() => null);
    const reply = await act(() => button(name).click());
    assert.equal(reply.ok, true, `${name}: ${reply.error ?? ''}`);
    const d = await pending;
    assert.ok(d, `${name}: no download`);
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
    const reply = await act(() => input.setInputFiles(file));
    assert.equal(reply.ok, true, `restore: ${reply.error ?? ''}`);
    return reply;
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
    const held = heldReason(result.match.held.reason);
    const message = u.w.locator('[data-bank-statement-held]');
    assert.equal(await message.getAttribute('data-bank-statement-held'), held.kind);
    // The accountant reads the reason in the page's words, never the engine's.
    assert.equal(
      (await message.innerText()).replace(/\s+/g, ' ').trim(),
      [
        u.c.held[held.kind],
        held.detail && heldWords(u.c, held.detail, result.reading.decimals),
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (heldDetail(held.detail).kind !== 'as-written')
      assert.equal(
        await u.w.locator('[data-bank-statement-held-raw] code').textContent(),
        held.detail,
        'the reader’s own detail stays one click away',
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
  for (const [i, story] of quick ? [] : facts.stories.entries()) {
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
  if (!quick)
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
  // A decision the lifecycle refuses is a failed check here, not a crash.
  const decide = async (row, name) => {
    const target = u.button(name, row);
    assert.equal(await target.isEnabled(), true, name);
    const reply = await u.act(() => target.click());
    assert.equal(reply.ok, true, `${name}: ${reply.error ?? ''}`);
    return reply;
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
  const suggested = result.cases.find((k) => k.status === 'needs-review').id;
  for (const name of [u.c.accept, u.c.reject, u.c.undo])
    assert.equal(await u.button(name, reviewRow()).isEnabled(), false, name);
  await note.fill('Deposit slip matches the receipt');
  assert.equal(await u.button(u.c.undo, reviewRow()).isEnabled(), false);
  let reply = await decide(reviewRow(), u.c.accept);
  result = reply.value.result;
  assert.equal(result.status, 'reviewed');
  // The button named accept records an acceptance of that case, with the
  // reason as written.
  assert.deepEqual(
    result.decisions.map((d) => [d.type, d.case, d.note]),
    [['accept', suggested, 'Deposit slip matches the receipt']],
  );
  assert.equal(
    result.cases.find((k) => k.id === suggested).status,
    'matched-accepted',
  );
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

  // A printed statement held on a broken balance chain, and one with a
  // missing page: the reason in the page's words, the amounts at the
  // currency's precision (never its minor units), written out here by hand.
  for (const [id, want] of [
    [
      'BS09',
      'سلسلة الرصيد في الكشف لا تتصل: صفحة 2، عناصر 46,48,50,52,54,56: رصيد سطر الحركة المطبوع 37,111.79، والمحسوب من الرصيد الافتتاحي والحركات 37,101.79؛ المطبوع ناقص المحسوب 10.00.',
    ],
    [
      'BS10',
      'صفحات الكشف ناقصة أو خارج الترتيب: قُرئت الصفحات 1، 3 من أصل 3.',
    ],
  ]) {
    await u.choose('statement', `${id}-statement.pdf`);
    await u.choose('cashbook', `${id}-cashbook.csv`);
    result = (await u.compare()).value.result;
    assert.equal(result.status, 'held', id);
    const shown = (
      await u.w.locator('[data-bank-statement-held]').innerText()
    )
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(shown, want, `${id}: the held reason as the page states it`);
    assert.ok(!/\d{7}/u.test(shown), `${id}: no amount in minor units`);
    await rendered(u, result);
  }
  checks.push(
    'held printed statements: the reason in the page’s words, amounts at the currency’s precision, the reader’s detail one click away',
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
  const heldText = await u.w.locator('[data-bank-statement-held]').innerText();
  for (const shown of [money(own).replace('-', ''), String(Math.abs(own))])
    assert.ok(!heldText.includes(shown), 'the file’s own closing is not shown');
  await rendered(u, result);
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
  reply = await u.compare(true);
  assert.equal(reply.ok, false);
  assert.equal(
    await u.w
      .locator('[data-bank-statement-failure]')
      .getAttribute('data-bank-statement-failure'),
    'statement-layout',
  );
  await u.choose('statement', 'BS04-statement.pdf');
  await u.choose('cashbook', 'BS01-statement.csv');
  reply = await u.compare(true);
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
  assert.equal(await u.button(u.bank.cancel).count(), 1, 'cancel shown');
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

  // A file dropped on a card, as the browser delivers a drop to the native
  // input (Chromium's drag input, not synthetic DOM events).
  const cdp = await u.ctx.newCDPSession(u.page);
  const drop = async (role, file) => {
    const input = u.w.getByLabel(u.c[role], { exact: true });
    const box = await input.boundingBox();
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const data = {
      items: [],
      files: [path.join(frozen, file)],
      dragOperationsMask: 1,
    };
    const zone = input.locator('xpath=..');
    await cdp.send('Input.dispatchDragEvent', {
      type: 'dragEnter',
      ...at,
      data,
    });
    assert.equal(await zone.getAttribute('data-drag-active'), 'true', role);
    await cdp.send('Input.dispatchDragEvent', {
      type: 'dragOver',
      ...at,
      data,
    });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...at, data });
    await u.w
      .locator(`[data-bank-statement-file="${role}"]`)
      .filter({ hasText: file })
      .waitFor();
    assert.equal(await zone.getAttribute('data-drag-active'), 'false', role);
  };
  await drop('statement', 'BS12-statement.pdf');
  assert.equal(await u.w.locator('[data-bank-statement-result]').count(), 0);
  await drop('cashbook', 'BS12-cashbook.csv');
  sameAsOracle((await u.compare()).value.result, 'BS12');
  checks.push('statement and cashbook dropped on their cards');

  // The whole path by keyboard on a fresh page: the source type by arrow
  // key, the file choosers by Enter and by Space, matching and a decision by
  // Enter. One file chooser listener for the whole page: Playwright turns its
  // chooser interception on and off with the listener, without waiting, so a
  // listener per chooser races the key press.
  const k = await open('en', 1440);
  const choosers = [];
  k.page.on('filechooser', (chooser) => choosers.push(chooser));
  await k.w.locator('[data-bank-source-mode] input[value="statement"]').check();
  await k.w.locator('[data-bank-source-mode] input[value="movements"]').check();
  await k.w.locator('[data-bank-source-mode] input[value="movements"]').focus();
  await k.page.keyboard.press('ArrowDown');
  assert.equal(
    await k.w
      .locator('[data-bank-source-mode] input[value="statement"]')
      .isChecked(),
    true,
  );
  const focused = () =>
    k.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  for (const [role, file, key] of [
    ['statement', 'BS04-statement.pdf', 'Enter'],
    ['cashbook', 'BS04-cashbook.csv', 'Space'],
  ]) {
    await k.page.keyboard.press('Tab');
    assert.equal(await focused(), k.c[role]);
    const opened = choosers.length;
    await k.page.keyboard.press(key);
    for (let i = 0; i < 300 && choosers.length === opened; i++)
      await k.page.waitForTimeout(100);
    assert.equal(choosers.length, opened + 1, `${key} opens the ${role} chooser`);
    await choosers[opened].setFiles(path.join(frozen, file));
    await k.w
      .locator(`[data-bank-statement-file="${role}"]`)
      .filter({ hasText: file })
      .waitFor();
  }
  const tabTo = async (name) => {
    for (let i = 0; i < 40; i++) {
      await k.page.keyboard.press('Tab');
      if (
        await k.page.evaluate(
          (name) => document.activeElement?.textContent?.trim() === name,
          name,
        )
      )
        return;
    }
    assert.fail(`not reachable by Tab: ${name}`);
  };
  await tabTo(k.c.compare);
  const keyed = await k.act(() => k.page.keyboard.press('Enter'));
  assert.equal(keyed.value.result.status, 'needs-review');
  await k.w.getByLabel(k.c.note, { exact: true }).focus();
  await k.page.keyboard.type('Deposit slip seen');
  await tabTo(k.c.accept);
  const accepted = await k.act(() => k.page.keyboard.press('Enter'));
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.value.result.status, 'reviewed');
  assert.deepEqual(
    accepted.value.result.decisions.map((d) => [d.type, d.note]),
    [['accept', 'Deposit slip seen']],
  );
  await k.ctx.close();
  checks.push(
    'keyboard only: source type, both files, matching and a decision',
  );

  // The longest statement must not freeze the page: the client verifies a
  // reply from its own reading of the originals, read once and in page-sized
  // turns. Budgets are for one uninterrupted main-thread task.
  const longest = (since) =>
    u.page.evaluate(
      (since) =>
        Math.max(
          0,
          ...globalThis.longTasks
            .filter(([start]) => start >= since)
            .map(([, duration]) => duration),
        ),
      since,
    );
  const now = () => u.page.evaluate(() => performance.now());
  const timing = {};
  const timed = async (label, budget, run) => {
    const since = await now();
    const value = await run();
    const total = (await now()) - since;
    const task = await longest(since);
    timing[label] = {
      totalMs: Math.round(total),
      longestTaskMs: Math.round(task),
      budgetMs: budget,
    };
    assert.ok(
      task < budget,
      `${label}: a ${Math.round(task)} ms main-thread task`,
    );
    return value;
  };
  await u.choose('statement', 'BS15-statement.pdf');
  await u.choose('cashbook', 'BS15-cashbook.csv');
  result = (await timed('BS15 compare', 1000, () => u.compare())).value.result;
  sameAsOracle(result, 'BS15');
  await note.fill('Timing check');
  result = (
    await timed('BS15 decision', 1000, () => decide(automaticRow(), u.c.reject))
  ).value.result;
  const timingSession = await timed('BS15 save', 1000, () =>
    u.download(u.c.save, 'BS15-timing-session.json'),
  );
  await timed('BS15 restore', 1000, () => u.restore(timingSession.target));
  book = await timed('BS15 export', 1500, () =>
    u.download(u.c.export, 'BS15-timing.xlsx'),
  );
  toCheck(
    'BS15-rejected',
    'BS15',
    book.target,
    'BS15-statement.pdf',
    'BS15-cashbook.csv',
    result,
    null,
  );
  checks.push('100-page statement within main-thread budgets');
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
    schema: 'tarasuf-bnk-pdf1-g4-browser/2',
    quick,
    timing,
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
  if (!quick) {
    assert.equal(report.capacity.eligible, 14);
    assert.equal(report.capacity.completed, 14);
    assert.equal(report.capacity.held, 2);
  }
  assert.equal(report.capacity.falseAutomatic, 0);
  await writeFile(
    path.join(out, 'checks.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      out: path.relative(root, out),
      capacity: report.capacity,
      timing,
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
/** The held detail as the page should word it, amounts as strings. */
function heldWords(c, detail, decimals) {
  const d = heldDetail(detail);
  const f = (n) => formatMoney(n, decimals);
  switch (d.kind) {
    case 'balance':
      return c.heldDetail
        .balance(
          d.items ? c.pageCitation(d.page, d.items) : c.pageOnly(d.page),
          c.heldLines[d.line],
          f(d.printed),
          f(d.computed),
          f(d.printed - d.computed),
        )
        .join('');
    case 'page-totals':
      return c.heldDetail.pageTotals(c.pageOnly(d.page));
    case 'page-start':
      return c.heldDetail.pageStart(c.pageOnly(d.page));
    case 'page-end':
      return c.heldDetail.pageEnd(c.pageOnly(d.page));
    case 'statement-totals':
      return c.heldDetail.statementTotals;
    case 'second-opening':
      return c.heldDetail.secondOpening;
    case 'no-closing':
      return c.heldDetail.noClosing;
    case 'pages':
      return c.heldDetail.pages(
        c.heldDetail.list(d.read),
        c.heldDetail.list(d.declared),
      );
    case 'as-written':
      return d.text;
  }
}
function money(minor) {
  const sign = minor < 0 ? '-' : '';
  const s = String(Math.abs(minor)).padStart(3, '0');
  return `${sign}${s.slice(0, -2)}.${s.slice(-2)}`;
}
