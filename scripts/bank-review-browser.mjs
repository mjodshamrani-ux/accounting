// WF-1 REVIEW-1 R2 acceptance in the built application: the review queue,
// on all 16 sealed stories of audit/bank-review-foundation, through real
// uploads into the bank workspace, the genuine Worker and local downloads
// only. Each story's queue as the page shows it (groups in order, their
// class, evidence and cases in order, and which group decisions are offered)
// is held against the sealed EXPECTED.json. Then the story is played as its
// facts say: a group decision with the page's own button in the group holding
// the named member, a single decision or an undo in the case table on the
// case holding exactly its members, a corrected cashbook. The decisions, the
// statuses and the queue left are held against EXPECTED.json; every
// downloaded workbook is read by the independent checker
// audit/bank-review-foundation/check_export.py, and every saved session is
// read here from its JSON. Every story with a group decision is then decided
// again case by case in the case table, as before the queue, to the same
// statuses, and both are measured: decision actions and time (Q5, reported,
// not required). Worker replies are only observed; nothing is fabricated or
// injected.
// With --suite=<sealed package> or BANK_REVIEW_SUITE (R3:
// audit/bank-review-holdout-r3) it plays that package's stories instead,
// records each story as it comes (a failing story is recorded and the page
// reloaded, not thrown), and with --record=<file> writes the record to the
// package's results/, or with --assert=<file> requires it to equal that
// record.
//   pnpm build && node --experimental-strip-types scripts/bank-review-browser.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { bankReviewCopy } from '../lib/i18n/bank-review.ts';
import { recordTableCopy } from '../lib/i18n/record-table.ts';
import { ar as arCatalogue } from '../lib/i18n/locales/ar.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_REVIEW_DIST: another build of the same source, for the review
  // interface mutation gate (scripts/test-bank-review-interface-mutations.mjs).
  dist = process.env.BANK_REVIEW_DIST ?? path.join(root, 'dist'),
  chosen =
    process.argv
      .find((a) => a.startsWith('--suite='))
      ?.slice('--suite='.length) ?? process.env.BANK_REVIEW_SUITE,
  holdout = !!chosen,
  suite = holdout
    ? path.resolve(root, chosen)
    : path.join(root, 'audit/bank-review-foundation'),
  frozen = path.join(suite, 'frozen'),
  checker = path.join(root, 'audit/bank-review-foundation/check_export.py'),
  tables = path.join(root, 'audit/bank-statement-foundation/frozen');
const output =
  process.env.BANK_REVIEW_BROWSER_DIR ??
  path.join(root, 'work/bank-review-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
if (!holdout) assert.equal(facts.stories.length, 16);
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const NOTE = 'synthetic foundation decision';
const STATUS = {
  'matched-accepted': 'accepted',
  rejected: 'rejected',
  'needs-review': 'needs-review',
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) =>
  JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));
/** The signed digits of an amount as a cell shows it. */
const digitsOf = (cell) => String(Number(cell.replace(/[^\d-]/g, '')));

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
  measure = {};
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
    q = bankReviewCopy[lang],
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
    const reply = await page.evaluate(() => globalThis.statementReplies.at(-1));
    assert.equal(reply.ok, true, `${reply.action}: ${reply.error ?? ''}`);
    return reply.value;
  };
  const label = {
    statement: c.statement,
    cashbook: c.cashbook,
    previous: c.priorSession,
  };
  const choose = async (role, file, dir = frozen) => {
    await w
      .getByLabel(label[role], { exact: true })
      .setInputFiles(path.join(dir, file));
    await w
      .locator(`[data-bank-statement-file="${role}"]`)
      .filter({ hasText: file })
      .waitFor({ timeout: 30000 })
      .catch(() => assert.fail(`${file} is not shown as the ${role}`));
    assert.equal(await w.locator('[data-bank-statement-result]').count(), 0);
  };
  const button = (name, scope = w) =>
    scope.getByRole('button', { name, exact: true });
  const field = (name, scope = w) => scope.getByLabel(name, { exact: true });
  const compare = async () => {
    assert.equal(await button(c.compare).isEnabled(), true, 'compare enabled');
    return act(() => button(c.compare).click());
  };
  const download = async (name, file) => {
    assert.equal(await button(name).isEnabled(), true, name);
    const pending = page
      .waitForEvent('download', { timeout: 120000 })
      .catch(() => null);
    await act(() => button(name).click());
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
    return act(() =>
      w.getByLabel(bank.restore, { exact: true }).setInputFiles(file),
    );
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
  return {
    lang,
    page,
    w,
    c,
    q,
    pages: recordTableCopy[lang],
    ctx,
    act,
    settle,
    choose,
    compare,
    download,
    restore,
    table,
    button,
    field,
  };
}

/** The queue as the page shows it. */
async function queueShown(u) {
  return u.w.locator('[data-bank-review-group]').evaluateAll((groups) =>
    groups.map((g) => ({
      signature: g.getAttribute('data-bank-review-group'),
      class: g.getAttribute('data-bank-review-class'),
      title: g.querySelector('h2')?.textContent.trim(),
      cases: [...g.querySelectorAll('tbody tr')].map((r) =>
        r.querySelector('td').textContent.trim(),
      ),
      impacts: [...g.querySelectorAll('tbody tr')].map((r) =>
        r.querySelectorAll('td')[3].textContent.trim(),
      ),
      evidence: g
        .querySelector('[data-bank-review-evidence]')
        ?.textContent.replace(/\s+/g, ' ')
        .trim(),
      bulk: [...g.querySelectorAll('[data-bank-review-bulk]')].map((b) => [
        b.getAttribute('data-bank-review-bulk'),
        b.textContent.trim(),
      ]),
    })),
  );
}

/** The page's queue against the oracle's queue, field by field. */
async function queueAgrees(u, want, what) {
  const { c, q } = u;
  const got = await queueShown(u);
  assert.deepEqual(
    got.map((g) => g.signature),
    want.map((g) => g.signature),
    `${what}: the groups in order`,
  );
  for (const [i, g] of want.entries()) {
    const shown = got[i];
    const n = g.cases.length;
    assert.equal(shown.class, g.class, `${what} ${g.signature}: class`);
    assert.equal(
      shown.title,
      `${q.classes[g.class]}: ${c.reasons[g.reason]}`,
      `${what} ${g.signature}: title`,
    );
    assert.deepEqual(
      shown.cases,
      g.cases.map((k) => k.case),
      `${what} ${g.signature}: cases in order`,
    );
    assert.deepEqual(
      shown.impacts.map(digitsOf),
      g.cases.map((k) => String(k.impact)),
      `${what} ${g.signature}: each case's impact`,
    );
    const parts = (shown.evidence ?? '').split(' · ');
    assert.deepEqual(
      parts.slice(0, -1),
      [
        q.directions[g.direction],
        q.shape(g.statement, g.cashbook),
        ...(g.gap === undefined ? [] : [q.gap(g.gap)]),
        q.cases(n),
      ],
      `${what} ${g.signature}: evidence`,
    );
    assert.ok(parts.at(-1).startsWith(`${q.impact}:`));
    assert.equal(digitsOf(parts.at(-1)), String(g.impact));
    assert.deepEqual(
      shown.bulk,
      [
        ...(g.offers.accept ? [['accept', q.acceptAll(n)]] : []),
        ...(g.offers.reject ? [['reject', q.rejectAll(n)]] : []),
      ],
      `${what} ${g.signature}: the group decisions offered`,
    );
  }
}

/** The review table row of a case, by its id, on whichever page of the
 * table holds it: from the first page, then with the table's own Next
 * page (the shared pager of the record kit). */
async function caseRow(u, id) {
  const table = u.w.locator('[data-bank-statement-table="review"]');
  const previous = u.button(u.pages.previous, table),
    next = u.button(u.pages.next, table);
  while ((await previous.count()) && (await previous.isEnabled()))
    await previous.click();
  for (;;) {
    const ids = (await u.table('review')).map((r) => r[0]);
    const at = ids.indexOf(id);
    if (at >= 0) return table.locator('tbody tr').nth(at);
    assert.ok(
      (await next.count()) && (await next.isEnabled()),
      `${id} is not shown in the case table`,
    );
    await next.click();
  }
}

/** A decision button pressed, once it is shown and enabled: a button the
 * page withholds is an assertion, not a wait. */
async function press(u, button, what) {
  assert.equal(await button.count(), 1, `${what}: no button`);
  assert.equal(await button.isEnabled(), true, `${what}: not enabled`);
  return u.act(() => button.click());
}

/** The case holding exactly a decision's members, and its decision. */
async function single(u, result, d, type) {
  const found = result.cases.filter(
    (c) =>
      c.kind === 'review' &&
      same(c.statement, d.statement) &&
      same(c.cashbook, d.cashbook),
  );
  assert.equal(found.length, 1, `one case holds ${d.statement} ${d.cashbook}`);
  const row = await caseRow(u, found[0].id);
  const name = { accept: u.c.accept, reject: u.c.reject, undo: u.c.undo }[type];
  return press(u, u.button(name, row), `${type} ${found[0].id}`);
}

/** A group decision with the page's button in the group holding a member;
 * by the keyboard alone when asked. */
async function bulk(u, a, keyboard = false) {
  const groups = u.w.locator('[data-bank-review-group]');
  const holding = [];
  for (let i = 0; i < (await groups.count()); i++) {
    const ids = await groups
      .nth(i)
      .locator('bdi.bank-statement-id')
      .allTextContents();
    if (ids.map((t) => t.trim()).includes(a.with)) holding.push(i);
  }
  assert.equal(holding.length, 1, `one group holds ${a.with}`);
  const button = groups
    .nth(holding[0])
    .locator(`[data-bank-review-bulk="${a.type}"]`);
  assert.equal(await button.count(), 1, `a group ${a.type} for ${a.with}`);
  assert.equal(await button.isEnabled(), true, `group ${a.type} enabled`);
  if (!keyboard) return u.act(() => button.click());
  await u.field(u.c.note).focus();
  let tabs = 0;
  while (!(await button.evaluate((b) => b === document.activeElement))) {
    assert.ok(++tabs < 400, 'the group button is not reachable by Tab');
    await u.page.keyboard.press('Tab');
  }
  return u.act(() => u.page.keyboard.press('Enter'));
}

const now = (u) => u.page.evaluate(() => performance.now());

/** A story played on the page with the queue, as its facts say. */
async function play(u, story, keyboard = false) {
  const period = story.periods.at(-1).id;
  const want = expected[story.id];
  await u.choose('statement', `${period}-statement.pdf`);
  await u.choose('cashbook', `${period}-cashbook.csv`);
  let value = await u.compare();
  assert.equal(value.result.status === 'held', want.held, `${story.id} held`);
  if (want.held) {
    assert.equal(
      await u.w.locator('[data-bank-review-queue]').count(),
      0,
      `${story.id}: a held statement has no queue`,
    );
    return { value, actions: 0, ms: 0 };
  }
  // Counted first, so that a missing queue is an assertion, not a wait.
  const queue = u.w.locator('[data-bank-review-queue]');
  assert.equal(await queue.count(), 1, `${story.id}: the queue is shown`);
  assert.equal(
    await queue.getAttribute('data-bank-review-queue'),
    String(want.queue.length),
  );
  assert.equal(
    await u.w.locator('[data-bank-review-empty]').count(),
    want.queue.length ? 0 : 1,
    `${story.id}: the empty queue says so`,
  );
  await queueAgrees(u, want.queue, story.id);
  if (['Q02', 'Q14'].includes(story.id))
    await u.w.locator('[data-bank-review-queue]').screenshot({
      path: path.join(out, `${u.lang}-${story.id}-queue.png`),
    });
  // Without a note no group decision is taken.
  if (await u.field(u.c.note).count()) await u.field(u.c.note).fill('');
  for (const b of await u.w.locator('[data-bank-review-bulk]').all())
    assert.equal(await b.isEnabled(), false, `${story.id}: bulk without note`);
  if (story.actions.length) await u.field(u.c.note).fill(NOTE);
  let actions = 0;
  const since = await now(u);
  for (const action of story.actions) {
    if (action.group) value = await bulk(u, action.group, keyboard);
    else if (action.decide)
      value = await single(u, value.result, action.decide, action.decide.type);
    else if (action.undo)
      value = await single(u, value.result, action.undo, 'undo');
    else {
      // A corrected cashbook: the comparison starts again, and nothing of
      // the earlier decisions is carried to it.
      await u.choose('cashbook', `${period}-cashbook-corrected.csv`);
      value = await u.compare();
      continue;
    }
    actions += 1;
  }
  return { value, actions, ms: Math.round((await now(u)) - since) };
}

/** The same decisions as the queue records them, taken case by case in the
 * case table, as before the queue. */
async function playSingly(u, story) {
  const want = expected[story.id];
  let value = await u.compare();
  await u.field(u.c.note).fill(NOTE);
  const since = await now(u);
  for (const [type, id] of want.decisions) {
    const row = await caseRow(u, id);
    const name = { accept: u.c.accept, reject: u.c.reject, undo: u.c.undo }[
      type
    ];
    value = await press(u, u.button(name, row), `${type} ${id}`);
  }
  return {
    value,
    actions: want.decisions.length,
    ms: Math.round((await now(u)) - since),
  };
}

/** The installed result against the oracle: decisions, statuses, queue left. */
async function settledAgrees(u, story, value) {
  const want = expected[story.id];
  const r = value.result;
  assert.deepEqual(
    r.decisions.map((d) => [d.type, d.case]),
    want.decisions,
    `${story.id}: the decisions recorded`,
  );
  assert.deepEqual(
    Object.fromEntries(
      r.cases
        .filter((c) => c.kind === 'review')
        .map((c) => [c.id, STATUS[c.status] ?? c.status]),
    ),
    want.statuses,
    `${story.id}: the statuses`,
  );
  await queueAgrees(u, want.queueAfter, `${story.id} after`);
}

/** A saved session, read here from its JSON: the session format is
 * unchanged, and a group decision is there only as its single decisions. */
async function savedSession(file, story, state) {
  const s = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    [s.format, s.version, Object.keys(s).sort()],
    [
      'tarasuf-bank-statement-session',
      'bank-statement-lifecycle-1',
      ['decisions', 'files', 'format', 'scope', 'version'],
    ],
  );
  const period = story.periods.at(-1).id;
  for (const [f, name] of [
    [s.files[0], `${period}-statement.pdf`],
    [s.files[1], `${period}-cashbook.csv`],
  ]) {
    const want = await readFile(path.join(frozen, name));
    assert.equal(f.name, name);
    assert.equal(f.sha256, sha(want));
    assert.ok(Buffer.from(f.data, 'base64').equals(want), name);
  }
  assert.deepEqual(
    s.decisions.map((d) => Object.keys(d).sort()),
    state.decisions.map(() => [
      'at',
      'case',
      'cashbook',
      'context',
      'id',
      'note',
      'statement',
      'type',
    ]),
    'each decision as a single decision, and nothing else',
  );
  assert.deepEqual(
    s.decisions.map((d) => [d.type, d.case]),
    expected[story.id].decisions,
  );
}

/** The sealed holdout, recorded as it comes: every story played on the
 * page, alternately in Arabic at 1440 and English at 390, the first story
 * with a group decision by the keyboard alone; each story that decides saved
 * and restored, each exported, and each with a group decision decided again
 * case by case. A failing story is recorded and the page reloaded, not
 * thrown. The record holds what repeats: equality, actions and workbooks;
 * times go to the run's own report only. */
async function holdoutRun(ar, en, started) {
  const keyboard = facts.stories.find((x) =>
    x.actions.some((a) => a.group),
  )?.id;
  const stories = {},
    times = {};
  const equal = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  for (const [i, s] of facts.stories.entries()) {
    const u = i % 2 ? en : ar;
    const want = expected[s.id];
    const record = (stories[s.id] = { equal: false });
    try {
      const played = await play(u, s, s.id === keyboard);
      record.shown = true;
      record.actions = played.actions;
      if (want.refusal) {
        // The corrected cashbook brings a new comparison: nothing of the
        // decisions taken before it survives, and every case waits again.
        record.equal =
          played.value.result.decisions.length === 0 &&
          played.value.result.cases
            .filter((c) => c.kind === 'review')
            .every((c) => c.status === 'needs-review' && c.decision === null);
        continue;
      }
      await settledAgrees(u, s, played.value);
      record.equal = true;
      if (want.held) continue;
      const book = await u.download(u.c.export, `${s.id}-queue.xlsx`);
      exportsToCheck.push({
        story: s.id,
        path: book.target,
        cashbook: `${s.periods.at(-1).id}-cashbook.csv`,
      });
      if (s.actions.length) {
        const session = await u.download(u.c.save, `${s.id}-session.json`);
        await savedSession(session.target, s, played.value.state);
        const back = await u.restore(session.target);
        record.restored = equal(back.result, played.value.result);
        await settledAgrees(u, s, back);
      }
      if (s.actions.some((a) => a.group)) {
        const singly = await playSingly(u, s);
        await settledAgrees(u, s, singly.value);
        record.caseByCase = singly.actions;
        times[s.id] = { withQueueMs: played.ms, caseByCaseMs: singly.ms };
      }
    } catch (error) {
      record.error = String(
        error instanceof Error ? error.message : error,
      ).split('\n')[0];
      await u.page.reload();
      await openDomainWorkspace(u.page, 'bank', {
        advanced: false,
        requiredSources: false,
      });
      await u.w
        .locator('[data-bank-source-mode] input[value="statement"]')
        .check();
    }
  }
  // Each workbook on its own, so that one rejected does not hide the others.
  const workbooks = {
    exported: exportsToCheck.length,
    accepted: 0,
    rejected: {},
  };
  for (const e of exportsToCheck) {
    const one = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
      input: JSON.stringify({ frozen, exports: [e] }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (one.status === 0 && JSON.parse(one.stdout).checked === 1)
      workbooks.accepted += 1;
    else
      workbooks.rejected[e.story] = `${one.stdout}${one.stderr}`
        .trim()
        .split('\n')
        .at(-1);
  }
  assert.deepEqual(external, [], 'external requests');
  assert.deepEqual(nonGet, [], 'non-GET requests');
  const ids = Object.keys(stories);
  const count = (f) => ids.filter((id) => f(stories[id])).length;
  const total = (f) => ids.reduce((n, id) => n + (f(stories[id]) ?? 0), 0);
  const summary = {
    stories: ids.length,
    equalToExpected: count((r) => r.equal),
    shownAsExpected: count((r) => r.shown),
    savedAndRestored: count((r) => r.restored),
    failed: count((r) => r.error),
    pageErrors: errors.length,
    decisionActions: {
      withQueue: total((r) => r.actions),
      caseByCase: total((r) => r.caseByCase),
    },
    workbooks,
  };
  const report = { holdout: path.relative(root, suite), summary, stories };
  const seconds = Math.round((performance.now() - started) / 1000);
  await writeFile(
    path.join(out, 'holdout.json'),
    `${JSON.stringify({ ...report, times, seconds }, null, 1)}\n`,
  );
  console.log(
    JSON.stringify({ out: path.relative(root, out), ...summary, seconds }),
  );
  const record = option('record');
  if (record) {
    await mkdir(path.join(suite, 'results'), { recursive: true });
    await writeFile(
      path.join(suite, 'results', record),
      `${JSON.stringify(report, null, 1)}\n`,
    );
  }
  const against = option('assert');
  if (against) {
    const recorded = JSON.parse(
      await readFile(path.join(suite, 'results', against), 'utf8'),
    );
    assert.deepEqual(
      canonical(report),
      canonical(recorded),
      `the page's outcome differs from ${against}`,
    );
  }
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
  const story = (id) => facts.stories.find((s) => s.id === id);

  if (holdout) await holdoutRun(ar, en, started);
  else {
    // A table statement has no queue: the foundation's stories are printed.
    {
      const u = ar;
      await u.choose('statement', 'BS01-statement.csv', tables);
      await u.choose('cashbook', 'BS01-cashbook.csv', tables);
      await u.field(u.c.currency).selectOption('SAR');
      await u.compare();
      assert.equal(
        await u.w.locator('[data-bank-review-queue]').count(),
        0,
        'no queue for a table statement',
      );
      checks.push('a table statement shows no queue');
    }

    // Every story, as its facts say: Q01–Q08 in Arabic at 1440, Q09–Q16 in
    // English at 390; Q10's group decision by the keyboard alone.
    for (const s of facts.stories) {
      const u = Number(s.id.slice(1)) <= 8 ? ar : en;
      const want = expected[s.id];
      const played = await play(u, s, s.id === 'Q10');
      if (want.refusal) {
        // The corrected cashbook brought a new comparison: no decision of the
        // group survives it, and every case waits again.
        assert.equal(want.refusal, 'BANK_STATEMENT_DECISION');
        assert.deepEqual(
          played.value.result.decisions,
          [],
          `${s.id}: decisions`,
        );
        assert.ok(
          played.value.result.cases
            .filter((c) => c.kind === 'review')
            .every((c) => c.status === 'needs-review' && c.decision === null),
          `${s.id}: a decided case after the cashbook changed`,
        );
        assert.equal(
          await u.w.locator('[data-bank-statement-table="decisions"]').count(),
          0,
        );
        checks.push(`${s.id}: a corrected cashbook keeps nothing of the group`);
        continue;
      }
      await settledAgrees(u, s, played.value);
      if (want.held) continue;
      const book = await u.download(u.c.export, `${s.id}-queue.xlsx`);
      exportsToCheck.push({
        story: s.id,
        path: book.target,
        cashbook: `${s.periods.at(-1).id}-cashbook.csv`,
      });
      if (s.actions.some((a) => a.group)) {
        const singly = await playSingly(u, s);
        await settledAgrees(u, s, singly.value);
        measure[s.id] = {
          cases: want.actions.single,
          withQueue: { actions: played.actions, ms: played.ms },
          caseByCase: { actions: singly.actions, ms: singly.ms },
        };
      }
    }
    checks.push(
      '16/16 stories: the queue on the page, the decisions, statuses and queue left equal EXPECTED.json',
    );
    {
      const width = await en.page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      assert.ok(
        width[0] <= width[1],
        `at 390 the page scrolls sideways ${width}`,
      );
    }

    // A group decision applies to the group it is taken on, wherever that
    // group stands: Q04's second group rejected, its own cases rejected and
    // the first group's left waiting, by the sealed queue's membership.
    {
      const u = ar;
      const s = story('Q04');
      const [first, second] = expected.Q04.queue;
      await u.choose('statement', `${s.periods.at(-1).id}-statement.pdf`);
      await u.choose('cashbook', `${s.periods.at(-1).id}-cashbook.csv`);
      await u.compare();
      await u.field(u.c.note).fill(NOTE);
      const group = u.w.locator('[data-bank-review-group]').nth(1);
      assert.equal(
        await group.getAttribute('data-bank-review-group'),
        second.signature,
      );
      const value = await press(
        u,
        group.locator('[data-bank-review-bulk="reject"]'),
        'Q04 second group reject',
      );
      const status = new Map(value.result.cases.map((c) => [c.id, c.status]));
      assert.deepEqual(
        second.cases.map((c) => status.get(c.case)),
        second.cases.map(() => 'rejected'),
        'Q04: the second group rejected',
      );
      assert.deepEqual(
        first.cases.map((c) => status.get(c.case)),
        first.cases.map(() => 'needs-review'),
        'Q04: the first group left waiting',
      );
      checks.push(
        'Q04: a group decision on the second group decides that group alone',
      );
    }

    // Saved, restored cold: Q01 (an undo after group decisions) and Q15 (a
    // group reject after undos).
    for (const id of ['Q01', 'Q15']) {
      const u = en;
      const s = story(id);
      const played = await play(u, s);
      const session = await u.download(u.c.save, `${id}-session.json`);
      await savedSession(session.target, s, played.value.state);
      await u.page.reload();
      await openDomainWorkspace(u.page, 'bank', {
        advanced: false,
        requiredSources: false,
      });
      await u.w
        .locator('[data-bank-source-mode] input[value="statement"]')
        .check();
      const back = await u.restore(session.target);
      assert.deepEqual(back.result, played.value.result, `${id}: restored`);
      await settledAgrees(u, s, back);
      const book = await u.download(u.c.export, `${id}-restored.xlsx`);
      exportsToCheck.push({
        story: id,
        path: book.target,
        cashbook: `${s.periods.at(-1).id}-cashbook.csv`,
      });
      checks.push(
        `${id}: saved as single decisions, restored cold, same queue`,
      );
    }

    const seconds = Math.round((performance.now() - started) / 1000);
    const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
      input: JSON.stringify({
        frozen,
        exports: exportsToCheck,
        selfTest: ['Q01', 'Q15'],
      }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(
      check.status,
      0,
      `the workbook check failed: ${check.stdout}${check.stderr}`,
    );
    const checked = JSON.parse(check.stdout);
    assert.equal(checked.checked, exportsToCheck.length);
    assert.deepEqual(errors, [], 'page errors');
    assert.deepEqual(external, [], 'external requests');
    assert.deepEqual(nonGet, [], 'non-GET requests');
    const totals = Object.values(measure).reduce(
      (t, m) => ({
        cases: t.cases + m.cases,
        withQueue: t.withQueue + m.withQueue.actions,
        caseByCase: t.caseByCase + m.caseByCase.actions,
        withQueueMs: t.withQueueMs + m.withQueue.ms,
        caseByCaseMs: t.caseByCaseMs + m.caseByCase.ms,
      }),
      {
        cases: 0,
        withQueue: 0,
        caseByCase: 0,
        withQueueMs: 0,
        caseByCaseMs: 0,
      },
    );
    const report = {
      schema: 'tarasuf-wf1-review1-r2-browser/1',
      checks,
      workbooksChecked: checked.checked,
      checkerSelfTest: checked.selfTest,
      measure,
      totals,
      seconds,
      errors,
      external,
      nonGet,
    };
    await writeFile(
      path.join(out, 'checks.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        out: path.relative(root, out),
        checks: checks.length,
        workbooksChecked: checked.checked,
        totals,
        seconds,
      }),
    );
  }
} finally {
  await browser?.close();
  server.close();
}
