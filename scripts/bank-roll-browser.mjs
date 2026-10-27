// WF-1 ROLL-1 W3 acceptance in the built application: a period that carries,
// on the sealed stories of audit/bank-roll-foundation, through real uploads
// into the bank workspace, the genuine Worker and local downloads only.
// The previous period's session file is chosen with the page's own native
// file input; carried cases are decided with the page's own buttons, one by
// the keyboard alone; what the page shows, and the result it installs, are
// held against the sealed EXPECTED.json (named <MONTH>:<id>), never against
// the product; every downloaded workbook is read by the independent checker
// audit/bank-roll-foundation/check_export.py, and every saved session is read
// here from its JSON. Worker replies are only observed; nothing is
// fabricated or injected.
//   pnpm build && node --experimental-strip-types scripts/bank-roll-browser.mjs
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
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_ROLL_DIST: another build of the same source, for the roll interface
  // mutation gate (scripts/test-bank-roll-interface-mutations.mjs).
  dist = process.env.BANK_ROLL_DIST ?? path.join(root, 'dist'),
  suite = path.join(root, 'audit/bank-roll-foundation'),
  frozen = path.join(suite, 'frozen'),
  tables = path.join(root, 'audit/bank-statement-foundation/frozen');
const output =
  process.env.BANK_ROLL_BROWSER_DIR ?? path.join(root, 'work/bank-roll-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const contract = await json(path.join(suite, 'contract.json'));
// The two reasons the contract lets an accountant accept, read from it.
const acceptable = Object.entries({
  ...contract.clearing.byReference,
  ...contract.clearing.byAmount,
})
  .filter(([, text]) => /may accept it/u.test(text))
  .map(([reason]) => reason);
assert.equal(acceptable.length, 2);
const MONTHS = { '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP' };
const month = (period) => MONTHS[period.start.slice(5, 7)];

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

const errors = [],
  external = [],
  nonGet = [],
  checks = [],
  exportsToCheck = [],
  timing = {};
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
    globalThis.Worker = new Proxy(Worker, {
      construct(target, args) {
        const w = Reflect.construct(target, args);
        w.addEventListener('message', (e) => {
          if (e.data?.action?.startsWith('bank-statement-'))
            globalThis.statementReplies.push(e.data);
        });
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
  // A missing reply is an assertion failure, not a timeout, so that a
  // planted interface defect counts as caught.
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
  const label = { statement: c.statement, cashbook: c.cashbook, previous: c.priorSession };
  const choose = async (role, file, dir = frozen) => {
    await w.getByLabel(label[role], { exact: true }).setInputFiles(path.join(dir, file));
    await w
      .locator(`[data-bank-statement-file="${role}"]`)
      .filter({ hasText: file })
      .waitFor({ timeout: 30000 })
      .catch(() => assert.fail(`${file} is not shown as the ${role}`));
    assert.equal(await w.locator('[data-bank-statement-result]').count(), 0);
  };
  const button = (name, scope = w) =>
    scope.getByRole('button', { name, exact: true });
  const compare = async () => {
    assert.equal(await button(c.compare).isEnabled(), true, 'compare enabled');
    const reply = await act(() => button(c.compare).click());
    assert.equal(reply.ok, true, `compare: ${reply.error ?? 'accepted'}`);
    return reply.value;
  };
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
    const reply = await act(() =>
      w.getByLabel(bank.restore, { exact: true }).setInputFiles(file),
    );
    assert.equal(reply.ok, true, `restore: ${reply.error ?? ''}`);
    return reply.value;
  };
  const table = (key) =>
    w
      .locator(`[data-bank-statement-table="${key}"] tbody tr`)
      .evaluateAll((rows) =>
        rows.map((r) =>
          [...r.querySelectorAll('td')].map((td) =>
            td.textContent.replace(/\s+/g, ' ').trim(),
          ),
        ),
      );
  return { page, w, c, bank, ctx, act, settle, choose, compare, download, restore, table, button };
}

/** The installed result against EXPECTED.json, in the oracle's names. */
function sameAsExpected(id, result, decided) {
  const want = expected[id];
  const now = month(result.match.statement.period);
  const roll = result.roll;
  assert.ok(roll, `${id}: no roll in the result`);
  if (want.previous === 'accepted')
    assert.equal(roll.previous.status, 'accepted', `${id} previous`);
  else
    assert.deepEqual(
      [roll.previous.status, roll.previous.code],
      ['refused', want.previous],
      `${id} previous`,
    );
  const name = (item) => `${month(item.period)}:${item.id}`;
  assert.deepEqual(
    roll.carried.map((i) => [name(i), i.age, i.amount, i.origin]),
    want.carried.map((i) => [i.item, i.age, i.amount, i.origin]),
    `${id} carried`,
  );
  const byKey = new Map(roll.carried.map((i) => [i.key, name(i)]));
  const cases = result.cases.filter((k) => k.kind === 'carried');
  assert.deepEqual(
    cases.map((k) => [
      k.reason,
      k.carried.map((key) => byKey.get(key)),
      [...k.statement, ...k.cashbook].map((m) => `${now}:${m}`),
    ]),
    want.cases.map((k) => [k.reason, k.carried, k.current]),
    `${id} carried cases`,
  );
  for (const k of cases)
    assert.equal(
      k.status,
      !decided
        ? 'needs-review'
        : acceptable.includes(k.reason)
          ? 'matched-accepted'
          : 'rejected',
      `${id} ${k.id} status`,
    );
  // Nothing carried or withheld is paired automatically.
  const automatic = new Set(
    result.cases
      .filter((k) => k.kind === 'automatic')
      .flatMap((k) => [...k.statement, ...k.cashbook].map((m) => `${now}:${m}`)),
  );
  for (const m of [...want.withheld, ...want.cases.flatMap((k) => k.current)])
    assert.ok(!automatic.has(m), `${id}: ${m} paired automatically`);
  // What stays carried at the period end.
  const live = new Set(
    cases.filter((k) => k.status !== 'rejected').flatMap((k) => k.carried.map((key) => byKey.get(key))),
  );
  const still = want.carried
    .filter((i) => !live.has(i.item))
    .map((i) => ({ item: i.item, age: i.age + 1 }));
  if (!decided) assert.deepEqual(still, want.stillCarried, `${id} still carried`);
  assert.deepEqual(
    roll.outstanding.map((i) => ({ item: name(i), age: i.age })),
    still,
    `${id} outstanding at the period end`,
  );
  return { live, still: new Map(still.map((s) => [s.item, s.age])) };
}

/** What the page shows for a period that carries. */
async function shown(u, id, result, decided) {
  const want = expected[id];
  const { still } = sameAsExpected(id, result, decided);
  const verdict = u.w.locator('[data-bank-statement-previous]');
  assert.equal(await verdict.count(), 1, `${id}: the previous verdict`);
  const text = (await verdict.innerText()).replace(/\s+/g, ' ').trim();
  if (want.previous === 'accepted') {
    assert.equal(await verdict.getAttribute('data-bank-statement-previous'), 'accepted');
    assert.equal(text, u.c.priorAccepted(`${id}-previous-session.json`, want.carried.length));
  } else {
    assert.equal(await verdict.getAttribute('data-bank-statement-previous'), 'refused');
    assert.equal(
      await verdict.locator('[data-bank-statement-previous-code]').getAttribute('data-bank-statement-previous-code'),
      want.previous,
    );
    // The page's words, then the detail, then what it means for this period.
    assert.ok(text.startsWith(u.c.priorRefused[want.previous]), `${id}: ${text}`);
    assert.ok(text.endsWith(u.c.priorRefusedNote), `${id}: ${text}`);
  }
  const carriedCases = result.cases.filter((k) => k.kind === 'carried');
  if (!carriedCases.length)
    assert.equal(await u.w.locator('[data-bank-statement-table="carried"]').count(), 0);
  else
    assert.deepEqual(
      (await u.table('carried')).map((r) => [r[0], r[1], r[5]]),
      carriedCases.map((k, i) => [
        k.id,
        u.c.reasons[want.cases[i].reason],
        u.c.caseStatus[k.status],
      ]),
      `${id}: carried cases as shown`,
    );
  // No carried case is shown with the period's own review or automatic cases.
  for (const key of ['review', 'automatic'])
    for (const row of await u.table(key))
      assert.ok(!carriedCases.some((k) => k.id === row[0]), `${id}: ${row[0]} in ${key}`);
  if (!want.carried.length) {
    assert.equal(await u.w.locator('[data-bank-statement-table="carried-items"]').count(), 0);
    return;
  }
  const rows = await u.table('carried-items');
  assert.deepEqual(
    rows.map((r) => [r[0], r[1], r[3], r[4], r[5], r[6], r[7].replace(/\D/g, ''), r[8], r[9], r[10]]),
    want.carried.map((i) => [
      i.id,
      u.c.sides[i.side],
      i.side === 'statement' ? u.c.pageOnly(i.page) : u.c.rowCitation(String(i.row)),
      i.date,
      i.reference,
      u.c.directions[i.direction],
      String(i.amount),
      i.origin === 'unmatched' ? u.c.unmatched : u.c.priorRejectedIn(i.origin),
      String(i.age),
      still.has(i.item) ? u.c.stillCarried(still.get(i.item)) : u.c.inCase,
    ]),
    `${id}: carried items as shown`,
  );
}
const toCheck = (story, target, decided) =>
  exportsToCheck.push({ story, path: target, decided });
/** A saved session, read here from its JSON: the period's two originals and
 * the previous session file, byte for byte, and the decisions. */
async function savedSession(file, id, current, decisions) {
  const s = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    [s.format, s.version, Object.keys(s).sort()],
    [
      'tarasuf-bank-statement-session',
      'bank-statement-roll-1',
      ['decisions', 'files', 'format', 'previous', 'scope', 'version'],
    ],
  );
  const bytes = (name) => readFile(path.join(frozen, name));
  for (const [f, name] of [
    [s.files[0], `${current}-statement.pdf`],
    [s.files[1], `${current}-cashbook.csv`],
    [s.previous, `${id}-previous-session.json`],
  ]) {
    const want = await bytes(name);
    assert.equal(f.name, name);
    assert.equal(f.sha256, sha(want));
    assert.ok(Buffer.from(f.data, 'base64').equals(want), `${name} byte for byte`);
  }
  assert.deepEqual(s.scope, { currency: null, period: null, confirmedClosing: null });
  assert.deepEqual(
    s.decisions.map((d) => [d.type, d.case, d.note]),
    decisions,
  );
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const started = performance.now();
  const ar = await open('ar', 1440),
    en = await open('en', 390);
  let tableSession;

  // A previous session is offered for a printed statement only, and must be
  // a session file.
  {
    const u = ar;
    const previous = u.w.locator('[data-testid="bank-statement-source-previous"]');
    assert.equal(await previous.isVisible(), false, 'no previous input before a statement');
    await u.choose('statement', 'R01-AUG-statement.pdf');
    assert.equal(await previous.isVisible(), true, 'previous input for a PDF statement');
    await u.w
      .getByLabel(u.c.priorSession, { exact: true })
      .setInputFiles(path.join(frozen, 'R01-JUL-statement.pdf'));
    await u.w
      .locator('[data-bank-statement-failure="other"]')
      .waitFor({ timeout: 30000 })
      .catch(() => assert.fail('a PDF is taken as a previous session'));
    assert.equal(await u.w.locator('[data-bank-statement-file="previous"]').count(), 0);
    await u.choose('previous', 'R01-previous-session.json');
    await u.choose('statement', 'BS01-statement.csv', tables);
    assert.equal(await previous.isVisible(), false, 'no previous input for a table');
    await u.choose('cashbook', 'BS01-cashbook.csv', tables);
    await u.w.getByLabel(u.c.currency, { exact: true }).selectOption('SAR');
    const table = await u.compare();
    assert.equal(table.state.version, 'bank-statement-lifecycle-1', 'a table carries nothing');
    assert.equal(table.result.roll, undefined);
    assert.equal(await u.w.locator('[data-bank-statement-previous]').count(), 0);
    tableSession = (await u.download(u.c.save, 'BS01-table-session.json')).target;
    // The previous file is kept while hidden, and carried again for a PDF.
    await u.choose('statement', 'R01-AUG-statement.pdf');
    assert.deepEqual(
      await u.w.locator('[data-bank-statement-file="previous"]').allInnerTexts(),
      ['R01-previous-session.json'],
      'the previous file is kept while a table is compared',
    );
    checks.push('previous session: PDF statement only, session files only, kept while hidden');
  }

  // R01 (Arabic, 1440): a carried cheque presented this month, accepted with
  // the keyboard alone; saved, restored cold and exported.
  {
    const u = ar,
      id = 'R01';
    await u.choose('cashbook', 'R01-AUG-cashbook.csv');
    let { state, result } = await u.compare();
    assert.equal(state.version, 'bank-statement-roll-1');
    assert.equal(state.previous.sha256, sha(await readFile(path.join(frozen, 'R01-previous-session.json'))));
    await shown(u, id, result, false);
    await u.w
      .locator('[data-bank-statement-result]')
      .screenshot({ path: path.join(out, 'ar-1440-R01-result.png') });
    const undecided = await u.download(u.c.export, 'R01-undecided.xlsx');
    toCheck(id, undecided.target, false);
    const row = u.w.locator('[data-bank-statement-table="carried"] tbody tr').first();
    for (const name of [u.c.accept, u.c.reject, u.c.undo])
      assert.equal(await u.button(name, row).count(), 1, `${name} offered on a carried case`);
    for (const name of [u.c.accept, u.c.reject, u.c.undo])
      assert.equal(await u.button(name, row).isEnabled(), false, `${name} without a reason`);
    const note = u.w.getByLabel(u.c.note, { exact: true });
    await note.focus();
    await u.page.keyboard.type('Cheque presented on the August statement');
    const accept = u.button(u.c.accept, row);
    let tabs = 0;
    while (!(await accept.evaluate((b) => b === document.activeElement))) {
      assert.ok(++tabs < 60, 'the carried accept button is not reachable by Tab');
      await u.page.keyboard.press('Tab');
    }
    const since = await u.page.evaluate(() => performance.now());
    const reply = await u.act(() => u.page.keyboard.press('Enter'));
    assert.equal(reply.ok, true, `keyboard accept: ${reply.error ?? ''}`);
    timing['R01 carried decision'] = {
      totalMs: Math.round((await u.page.evaluate(() => performance.now())) - since),
      longestTaskMs: Math.round(
        await u.page.evaluate(
          (since) =>
            Math.max(0, ...globalThis.longTasks.filter(([s]) => s >= since).map(([, d]) => d)),
          since,
        ),
      ),
    };
    ({ state, result } = reply.value);
    assert.equal(result.status, 'reviewed');
    assert.deepEqual(
      result.decisions.map((d) => [d.type, d.case, d.note]),
      [['accept', result.cases.find((k) => k.kind === 'carried').id, 'Cheque presented on the August statement']],
    );
    await shown(u, id, result, true);
    const session = await u.download(u.c.save, 'R01-session.json');
    assert.equal(session.name, 'tarasuf-bank-statement-session.json');
    await savedSession(session.target, id, 'R01-AUG', [
      ['accept', result.decisions[0].case, 'Cheque presented on the August statement'],
    ]);
    // Cold: nothing survives a reload but the saved file.
    await u.page.reload();
    const cold = await openDomainWorkspace(u.page, 'bank', { advanced: false, requiredSources: false });
    assert.equal(await cold.locator('[data-bank-statement-result]').count(), 0);
    const back = await u.restore(session.target);
    assert.deepEqual(back.result, result, 'R01: the restored result');
    assert.equal(
      await u.w.locator('[data-bank-source-mode] input[value="statement"]').isChecked(),
      true,
    );
    assert.deepEqual(
      await u.w.locator('[data-bank-statement-file="previous"]').allInnerTexts(),
      ['R01-previous-session.json'],
      'the restored session names its previous file',
    );
    await shown(u, id, back.result, true);
    const decided = await u.download(u.c.export, 'R01-decided.xlsx');
    toCheck(id, decided.target, true);
    // A session that does not carry, restored, brings no previous file.
    const plain = await u.restore(tableSession);
    assert.equal(plain.state.version, 'bank-statement-lifecycle-1');
    await u.choose('statement', 'R01-AUG-statement.pdf');
    assert.equal(
      await u.w.locator('[data-bank-statement-file="previous"]').count(),
      0,
      'a restored session without a previous file clears the one shown before',
    );
    checks.push('R01: carried reference accepted by keyboard, saved, restored cold, exported');
  }

  // R07 (Arabic): the carried cheque recorded again; it cannot be accepted,
  // only rejected, and then both it and the repeated entry stay outstanding.
  {
    const u = ar,
      id = 'R07';
    await u.choose('statement', 'R07-AUG-statement.pdf');
    await u.choose('cashbook', 'R07-AUG-cashbook.csv');
    await u.choose('previous', 'R07-previous-session.json');
    let { result } = await u.compare();
    await shown(u, id, result, false);
    const row = u.w.locator('[data-bank-statement-table="carried"] tbody tr').first();
    await u.w.getByLabel(u.c.note, { exact: true }).fill('Recorded twice in the cashbook');
    assert.equal(await u.button(u.c.accept, row).isEnabled(), false, 'a repetition is not accepted');
    const reply = await u.act(() => u.button(u.c.reject, row).click());
    assert.equal(reply.ok, true, `reject: ${reply.error ?? ''}`);
    ({ result } = reply.value);
    await shown(u, id, result, true);
    const rejected = result.cases.find((k) => k.kind === 'carried');
    const now = month(result.match.statement.period);
    assert.deepEqual(
      (await u.table('outstanding'))
        .filter((r) => r[2] === u.c.rejectedIn(rejected.id))
        .map((r) => `${now}:${r[1]}`),
      expected[id].cases[0].current,
      'the withheld entries stay outstanding, named by the rejected case',
    );
    assert.equal(await u.button(u.c.undo, row).isEnabled(), true);
    const book = await u.download(u.c.export, 'R07-decided.xlsx');
    toCheck(id, book.target, true);
    checks.push('R07: a repeated carried item is only rejected; its entries stay outstanding');
  }

  // R09 (English, phone width): an amount suggestion for one carried item;
  // the other stays carried, one period older.
  {
    const u = en,
      id = 'R09';
    await u.choose('statement', 'R09-AUG-statement.pdf');
    await u.choose('cashbook', 'R09-AUG-cashbook.csv');
    await u.choose('previous', 'R09-previous-session.json');
    let { result } = await u.compare();
    await shown(u, id, result, false);
    const undecided = await u.download(u.c.export, 'R09-undecided.xlsx');
    toCheck(id, undecided.target, false);
    const width = await u.page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    assert.ok(width[0] <= width[1], `R09 at 390: the page scrolls sideways ${width}`);
    const row = u.w.locator('[data-bank-statement-table="carried"] tbody tr').first();
    await u.w.getByLabel(u.c.note, { exact: true }).fill('Same amount, receipt voucher checked');
    const reply = await u.act(() => u.button(u.c.accept, row).click());
    assert.equal(reply.ok, true, `accept: ${reply.error ?? ''}`);
    ({ result } = reply.value);
    await shown(u, id, result, true);
    const decided = await u.download(u.c.export, 'R09-decided.xlsx');
    toCheck(id, decided.target, true);
    await u.w
      .locator('[data-bank-statement-result]')
      .screenshot({ path: path.join(out, 'en-390-R09-result.png') });
    checks.push('R09 (English, 390 px): amount suggestion accepted, the other item still carried');
  }

  // R05 (English): a chain; the previous session itself carried, so the
  // July cheque arrives two periods old.
  {
    const u = en,
      id = 'R05';
    await u.choose('statement', 'R05-SEP-statement.pdf');
    await u.choose('cashbook', 'R05-SEP-cashbook.csv');
    await u.choose('previous', 'R05-previous-session.json');
    const { result } = await u.compare();
    await shown(u, id, result, false);
    assert.equal(result.roll.carried[0].age, 2);
    const book = await u.download(u.c.export, 'R05-undecided.xlsx');
    toCheck(id, book.target, false);
    checks.push('R05: a chain of sessions, the carried item two periods old');
  }

  // R11 (English, phone width): the previous period is in another currency.
  // Nothing is carried, and the period is matched as without it.
  {
    const u = en,
      id = 'R11';
    await u.choose('statement', 'R11-AUG-statement.pdf');
    await u.choose('cashbook', 'R11-AUG-cashbook.csv');
    await u.choose('previous', 'R11-previous-session.json');
    const refused = (await u.compare()).result;
    await shown(u, id, refused, false);
    const book = await u.download(u.c.export, 'R11-refused.xlsx');
    toCheck(id, book.target, false);
    await u.button(u.c.priorSessionRemove).click();
    assert.equal(await u.w.locator('[data-bank-statement-file="previous"]').count(), 0);
    assert.equal(await u.w.locator('[data-bank-statement-result]').count(), 0);
    const alone = await u.compare();
    assert.equal(alone.state.version, 'bank-statement-lifecycle-1');
    assert.equal(await u.w.locator('[data-bank-statement-previous]').count(), 0);
    const plain = (r) => ({
      status: r.status,
      cases: r.cases.map((k) => [k.id, k.kind, k.reason, k.statement, k.cashbook, k.status]),
      outstanding: r.outstanding,
    });
    assert.deepEqual(plain(refused), plain(alone.result), 'R11: as if no previous session');
    checks.push('R11: a refused previous period is named, nothing carried, and it can be removed');
  }

  const seconds = Math.round((performance.now() - started) / 1000);
  const check = spawnSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, 'check_export.py')],
    {
      input: JSON.stringify({ frozen, exports: exportsToCheck }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(check.status, 0, `the workpaper check failed: ${check.stdout}${check.stderr}`);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.checked, exportsToCheck.length);
  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'external requests');
  assert.deepEqual(nonGet, [], 'non-GET requests');
  const report = {
    schema: 'tarasuf-wf1-roll1-w3-browser/1',
    checks,
    workpapersChecked: checked.checked,
    timing,
    seconds,
    errors,
    external,
    nonGet,
  };
  await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      out: path.relative(root, out),
      checks: checks.length,
      workpapersChecked: checked.checked,
      timing,
      seconds,
    }),
  );
} finally {
  await browser?.close();
  server.close();
}
