// WF-1 cycle in the built application: the sealed two-month stories of
// audit/bank-cycle-foundation played in the bank workspace through real
// uploads, the genuine Worker and local downloads only. Each story's steps
// are taken as the accountant takes them, with the page's own fields and
// buttons:
//   - open: the statement and the ledger with their native inputs; Match is
//     refused by the declared reading, the columns panel opens, and the
//     ledger is read by columns chosen by hand (and saved as a named map),
//     by the map saved in the first month, or, when the panel says the map
//     does not fit, by hand again; in the second month, the session
//     downloaded at the end of the first is chosen as the previous session;
//   - policy: the limits and reason typed into the tolerance fields and
//     applied;
//   - group: the group's own button in the review queue; accept or reject:
//     the row's button in the review, tolerated or carried table;
//   - book and language: the sheet's fields, applied; prepare and review:
//     the sign-off fields and buttons;
//   - save: the session downloaded (it is the next month's previous file)
//     and the workbook downloaded.
// At each save the installed result, as the Worker replied it, is put in
// the oracle's terms (scripts/bank-cycle-terms.mjs, as on the library path)
// and held key by key to the sealed EXPECTED.json and to the corrected
// expectation (correction-1/), never to the product. What the page shows is
// held to the corrected expectation too: the previous verdict, the columns
// the result cites with the rows above the header and the columns left
// unread, the misfit problems by kind, role, cell and labels, the review
// queue before any decision, the sheet's status or refusal and the
// sign-offs' standing; and the downloaded session is read here from its
// JSON. The workbooks are downloaded, not judged: the cycle has no
// independent workbook checker of its own. Worker replies are only
// observed; nothing is fabricated or injected.
// A difference is recorded, not thrown: a step the page does not let the
// accountant take ends that story's record there. --out writes the record,
// --assert requires it (in the suite's results/).
//   pnpm build && node --experimental-strip-types scripts/bank-cycle-browser.mjs [--out=f | --assert=f]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { bankSheetCopy } from '../lib/i18n/bank-sheet.ts';
import { bankMapCopy } from '../lib/i18n/bank-map.ts';
import { reviewQueue } from '../lib/reconciliation/bank-review-queue.ts';
import { columnLetters } from '../lib/reconciliation/bank-cashbook-map.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { asOracle, canonical, month, same } from './bank-cycle-terms.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_CYCLE_DIST: another build of the same source.
  dist = process.env.BANK_CYCLE_DIST ?? path.join(root, 'dist'),
  arg = (name) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3),
  suite = path.join(root, arg('suite') ?? 'audit/bank-cycle-foundation'),
  frozen = path.join(suite, 'frozen');
const output =
  process.env.BANK_CYCLE_BROWSER_DIR ??
  path.join(root, 'work/bank-cycle-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

// A seal that does not hold stops the run with an error, never an
// assertion a mutation gate would count.
const seal = spawnSync('python3', ['-B', path.join(suite, 'check_seal.py')], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (seal.status !== 0)
  throw new Error(`the seal: ${seal.stdout}${seal.stderr}`);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const corrected = (
  await json(path.join(suite, 'correction-1', 'EXPECTED.json'))
).stories;
const ROLES = [
  'date',
  'voucher',
  'description',
  'reference',
  'receipts',
  'payments',
];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A minor-unit amount as an accountant types it, written here and not by
 * the product: optionally with Arabic-Indic digits and decimal mark. */
function typed(minor, decimals, style) {
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  let text =
    (minor < 0 ? '-' : '') +
    `${digits.slice(0, -decimals)}${style === 'arabic' ? '٫' : '.'}${digits.slice(-decimals)}`;
  if (style === 'arabic') text = text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  return text;
}

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
  nonGet = [];

/** A page on the bank workspace's statement path, in a context of its own:
 * a story starts with nothing saved on this device. */
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
    globalThis.replies = [];
    globalThis.Worker = new Proxy(Worker, {
      construct(target, args) {
        const w = Reflect.construct(target, args);
        w.addEventListener('message', (e) => {
          const a = e.data?.action;
          if (
            e.data?.kind !== 'progress' &&
            (a === 'read' || a?.startsWith('bank-statement-'))
          )
            globalThis.replies.push({
              action: a,
              ok: e.data.ok,
              error: e.data.error ?? null,
              value: a?.startsWith('bank-statement-') ? e.data.value : null,
            });
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
  return {
    lang,
    page,
    w,
    ctx,
    c: bankStatementCopy[lang],
    h: bankSheetCopy[lang],
    m: bankMapCopy[lang],
  };
}

const count = (u) => u.page.evaluate(() => globalThis.replies.length);
const settle = (u) =>
  u.page.waitForFunction(
    () =>
      document
        .querySelector('[data-domain-panel="bank"] main.bank-workspace')
        ?.getAttribute('aria-busy') === 'false',
  );
/** The first reply of an action after a count; a missing reply is a failed
 * check, not a timeout, so that a planted defect is caught. */
async function replyAfter(u, before, action) {
  await u.page
    .waitForFunction(
      ([n, a]) => globalThis.replies.slice(n).some((r) => r.action === a),
      [before, action],
      { timeout: 120000 },
    )
    .catch(() => assert.fail(`no ${action} reply from the Worker`));
  await settle(u);
  return u.page.evaluate(
    ([n, a]) => globalThis.replies.slice(n).find((r) => r.action === a),
    [before, action],
  );
}
/** A statement action taken on the page, and its reply, which must succeed. */
async function act(u, run, what) {
  const before = await count(u);
  await run();
  await u.page
    .waitForFunction(
      (n) =>
        globalThis.replies
          .slice(n)
          .some((r) => r.action.startsWith('bank-statement-')),
      before,
      { timeout: 120000 },
    )
    .catch(() => assert.fail(`${what}: no statement reply from the Worker`));
  await settle(u);
  const r = await u.page.evaluate(
    (n) =>
      globalThis.replies
        .slice(n)
        .find((x) => x.action.startsWith('bank-statement-')),
    before,
  );
  assert.equal(r.ok, true, `${what}: ${r.error ?? ''}`);
  return r.value;
}
const button = (u, name, scope = u.w) =>
  scope.getByRole('button', { name, exact: true });
const field = (u, name, scope = u.w) => scope.getByLabel(name, { exact: true });
const panel = (u) => u.w.locator('[data-bank-map]');
/** An attribute of the one element a locator names, or null when there is
 * none: an absent element is a difference, not a wait. */
const attr = async (loc, name) =>
  (await loc.count()) === 1 ? loc.getAttribute(name) : null;
/** One element shown and enabled, then clicked; or a failed assertion. */
async function click(target, what) {
  assert.equal(await target.count(), 1, `${what}: not shown`);
  assert.equal(await target.isEnabled(), true, `${what}: not enabled`);
  await target.click();
}
async function select(target, value, what) {
  assert.equal(await target.count(), 1, `${what}: not shown`);
  await target.selectOption(value);
}
async function choose(u, role, file, name = path.basename(file)) {
  const label = {
    statement: u.c.statement,
    cashbook: u.c.cashbook,
    previous: u.c.priorSession,
  }[role];
  await field(u, label).setInputFiles({
    name,
    mimeType: name.endsWith('.pdf')
      ? 'application/pdf'
      : name.endsWith('.json')
        ? 'application/json'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(file),
  });
  await u.w
    .locator(`[data-bank-statement-file="${role}"]`)
    .filter({ hasText: name })
    .waitFor({ timeout: 30000 })
    .catch(() => assert.fail(`${name} is not shown as the ${role}`));
}
async function download(u, name, file) {
  const target = button(u, name);
  assert.equal(await target.isEnabled(), true, name);
  const pending = u.page
    .waitForEvent('download', { timeout: 120000 })
    .catch(() => null);
  await act(u, () => target.click(), name);
  const d = await pending;
  assert.ok(d, `${name}: no download`);
  const saved = path.join(out, file);
  await d.saveAs(saved);
  await settle(u);
  return saved;
}
const rows = (u, key) =>
  u.w
    .locator(`[data-bank-statement-table="${key}"] tbody tr`)
    .evaluateAll((trs) =>
      trs.map((tr) =>
        [...tr.querySelectorAll('td')].map((td) =>
          td.textContent.replace(/\s+/g, ' ').trim(),
        ),
      ),
    );

/** The misfit problems the panel lists, held to the expected ones as the M3
 * acceptance holds them: kind and role, the cell, the saved label, the label
 * found and where it is elsewhere. */
async function misfitShown(u, want, header) {
  const items = panel(u).locator('[data-bank-map-problem]');
  await items
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => null);
  const listed = await items.evaluateAll((lis) =>
    lis.map((li) => ({
      kind: li.getAttribute('data-bank-map-problem'),
      role: li.getAttribute('data-bank-map-role'),
      text: li.textContent,
    })),
  );
  if (
    !same(
      listed.map((p) => [p.kind, p.role]),
      want.map((p) => [p.kind, p.role ?? null]),
    )
  )
    return false;
  return want.every((p, i) => {
    const t = listed[i].text;
    return (
      t.includes(`${columnLetters(p.column)}${header}`) &&
      t.includes(p.label) &&
      (!p.found || t.includes(p.found)) &&
      p.elsewhere.every((cell) => t.includes(cell))
    );
  });
}

/** The month opened as its step says; the reading in the oracle's terms
 * and the first installed value. */
async function openMonth(u, story, step, sessions) {
  const pid = step.open;
  await choose(u, 'statement', path.join(frozen, `${pid}-statement.pdf`));
  await choose(u, 'cashbook', path.join(frozen, story.ledgers[pid].file));
  if (step.previous) await choose(u, 'previous', sessions.get(step.previous));
  else if (await u.w.locator('[data-bank-statement-file="previous"]').count())
    await click(
      button(u, u.c.priorSessionRemove),
      'remove the previous session',
    );
  assert.equal(
    await panel(u).count(),
    0,
    `${pid}: no columns panel before Match`,
  );
  // The declared reading first, as it is: a ledger in its own layout is
  // refused at its header row, and the panel opens.
  const before = await count(u);
  await click(button(u, u.c.compare), `${pid}: match`);
  const declared = await replyAfter(u, before, 'bank-statement-reconcile');
  assert.equal(
    declared.ok,
    false,
    `${pid}: the declared reading refuses the ledger`,
  );
  assert.match(declared.error, /^BANK_CASHBOOK_/u, pid);
  assert.equal(
    (await replyAfter(u, before, 'read')).ok,
    true,
    `${pid}: the ledger read for its columns`,
  );
  await panel(u)
    .waitFor({ timeout: 30000 })
    .catch(() => assert.fail(`${pid}: the columns panel`));
  const read = {
    by: step.ledger.by,
    map: step.ledger.map ?? null,
    misfit: null,
  };
  let choice = step.ledger;
  const since = await count(u);
  if (choice.by === 'map') {
    await select(
      panel(u).locator('[data-bank-map-select]'),
      choice.map,
      `${pid}: map`,
    );
    await click(
      panel(u).locator('[data-bank-map-read="map"]'),
      `${pid}: read with the map`,
    );
    const want = corrected[story.id];
    const label = story.steps.find(
      (s, k) => k > story.steps.indexOf(step) && s.save,
    )?.save;
    const misfit = want[label].reading.misfit;
    if (misfit) {
      read.misfit = (await misfitShown(u, misfit, want[label].reading.header))
        ? misfit
        : { shown: 'other problems' };
      assert.equal(
        (
          await u.page.evaluate(
            (n) => globalThis.replies.slice(n).map((r) => r.action),
            since,
          )
        ).filter((a) => a === 'bank-statement-reconcile').length,
        0,
        `${pid}: nothing read with a map that does not fit`,
      );
      choice = step.ledger.then;
      if (!choice)
        return `${pid}: a map that does not fit, and nothing by hand`;
      const change = panel(u).locator('[data-bank-map-change]');
      if (
        !(await panel(u).locator('[data-bank-map-read="hand"]').count()) &&
        (await change.count())
      )
        await click(change, `${pid}: choose other columns`);
    }
  }
  if (choice.by === 'hand') {
    await select(
      panel(u).locator('[data-bank-map-header]'),
      String(choice.header),
      `${pid}: header`,
    );
    for (const role of ROLES)
      await select(
        panel(u).locator(`[data-bank-map-role-select="${role}"]`),
        choice.columns[role] === null ? '' : String(choice.columns[role]),
        `${pid}: ${role}`,
      );
    await click(
      panel(u).locator('[data-bank-map-read="hand"]'),
      `${pid}: read with these columns`,
    );
  }
  const r = await replyAfter(u, since, 'bank-statement-reconcile');
  assert.equal(r.ok, true, `${pid}: ${r.error}`);
  if (choice.by === 'hand' && choice.save) {
    await panel(u).locator('[data-bank-map-name]').fill(choice.save);
    await click(
      panel(u).locator('[data-bank-map-save]'),
      `${pid}: save the map`,
    );
    read.saved = choice.save;
  }
  return { read, value: r.value };
}

/** The case a step names by its members, and its row on the page. */
async function decide(u, value, type, wanted) {
  const { result } = value;
  const now = month(result.match.statement.period);
  const names = new Map(
    (result.roll?.carried ?? []).map((c) => [
      c.key,
      `${month(c.period)}:${c.id}`,
    ]),
  );
  const members = (c) =>
    [
      ...c.statement.map((s) => `${now}:${s}`),
      ...c.cashbook.map((v) => `${now}:${v}`),
      ...(c.carried ?? []).map((k) => names.get(k)),
    ].sort(byText);
  const keys = (m) =>
    [
      ...m.statement.map((s) => `${now}:${s}`),
      ...m.cashbook.map((v) => `${now}:${v}`),
      ...m.carried,
    ].sort(byText);
  const found = result.cases.filter(
    (c) => c.kind !== 'automatic' && same(members(c), keys(wanted)),
  );
  assert.equal(found.length, 1, `one case holds ${keys(wanted).join(' ')}`);
  const table = {
    review: 'review',
    tolerated: 'tolerated',
    carried: 'carried',
  }[found[0].kind];
  const ids = (await rows(u, table)).map((r) => r[0]);
  const at = ids.indexOf(found[0].id);
  assert.ok(at >= 0, `${found[0].id} is not shown in ${table}`);
  await field(u, u.c.note).fill('synthetic cycle decision');
  const row = u.w
    .locator(`[data-bank-statement-table="${table}"] tbody tr`)
    .nth(at);
  return act(
    u,
    () => button(u, type === 'accept' ? u.c.accept : u.c.reject, row).click(),
    `${type} ${found[0].id}`,
  );
}

/** A group decision with the group's own button in the review queue. */
async function decideGroup(u, value, g) {
  const { result } = value;
  const now = month(result.match.statement.period);
  const byId = new Map(result.cases.map((c) => [c.id, c]));
  const members = (c) =>
    [
      ...c.statement.map((s) => `${now}:${s}`),
      ...c.cashbook.map((v) => `${now}:${v}`),
    ].sort(byText);
  const wanted = g.cases
    .map((m) =>
      JSON.stringify(
        [
          ...m.statement.map((s) => `${now}:${s}`),
          ...m.cashbook.map((v) => `${now}:${v}`),
        ].sort(byText),
      ),
    )
    .sort(byText);
  const found = reviewQueue(result).filter((q) =>
    same(
      q.cases
        .map((x) => JSON.stringify(members(byId.get(x.case))))
        .sort(byText),
      wanted,
    ),
  );
  assert.equal(found.length, 1, `one group holds ${wanted.join(' ')}`);
  const group = u.w.locator(`[data-bank-review-group="${found[0].signature}"]`);
  assert.equal(
    await group.count(),
    1,
    `the group ${found[0].signature} is shown`,
  );
  await field(u, u.c.note).fill('synthetic cycle decision');
  const target = group.locator(`[data-bank-review-bulk="${g.type}"]`);
  assert.equal(await target.count(), 1, `a group ${g.type}`);
  return act(u, () => target.click(), `group ${g.type}`);
}

async function sign(u, kind, given) {
  const box = u.w.locator(`[data-bank-sheet-signoff="${kind}"]`);
  await field(u, `${u.h[kind]}: ${u.h.screen.name}`, box).fill(given.name);
  await field(u, `${u.h[kind]}: ${u.h.signoffDate}`, box).fill(given.date);
  return act(u, () => button(u, u.h.screen.sign[kind], box).click(), kind);
}

/** What the page shows at a save, held to the corrected expectation; the
 * names of the checks that do not hold. */
async function pageAgrees(u, want, queueShown) {
  const failed = [];
  const check = (ok, name) => (ok ? null : failed.push(name));
  const verdict = u.w.locator('[data-bank-statement-previous]');
  if (want.previous === 'none')
    check((await verdict.count()) === 0, 'previous');
  else
    check(
      (await attr(verdict, 'data-bank-statement-previous')) ===
        (want.previous === 'accepted' ? 'accepted' : 'refused') &&
        (want.previous === 'accepted' ||
          (await attr(
            verdict.locator('[data-bank-statement-previous-code]'),
            'data-bank-statement-previous-code',
          )) === want.previous),
      'previous',
    );
  // The columns the result cites, as the page lists them: the header row,
  // each role's column (its label is the file's), the rows above the header
  // and every labelled column left unread.
  const r = want.reading;
  const listed = await rows(u, 'cashbook-columns');
  const wantRows = [
    [u.m.usedHeader, String(r.header), ''],
    ...ROLES.map((role) => [u.m.roles[role], columnLetters(r.columns[role])]),
    [u.m.above, String(r.above), ''],
    ...r.unread.map((x) => [u.m.unread, columnLetters(x.column), x.label]),
  ];
  check(
    listed.length === wantRows.length &&
      wantRows.every((row, k) => row.every((cell, i) => listed[k][i] === cell)),
    'columns',
  );
  check(queueShown === want.queue.length, 'queue');
  const s = want.sheet;
  if (s.refusal)
    check(
      (await attr(
        u.w.locator('[data-bank-sheet-refusal]'),
        'data-bank-sheet-refusal',
      )) === s.refusal,
      'sheet',
    );
  else
    check(
      (await attr(
        u.w.locator('[data-bank-sheet-status]'),
        'data-bank-sheet-status',
      )) === s.status,
      'sheet',
    );
  for (const kind of ['prepared', 'reviewed']) {
    const box = u.w.locator(`[data-bank-sheet-signoff="${kind}"]`);
    // An unsigned box is shown as such ('none'), as the R3 acceptance has it.
    const given = want.signoffs[kind];
    check(
      (await attr(box, 'data-bank-sheet-signoff-valid')) ===
        (given ? String(given.valid) : 'none'),
      `signoff ${kind}`,
    );
  }
  return failed;
}

/** The downloaded session, read here from its JSON. */
async function sessionHolds(file, value, previousName) {
  const s = JSON.parse(await readFile(file, 'utf8'));
  return [
    s.format === 'tarasuf-bank-statement-session',
    s.version === 'bank-reconciliation-sheet-1',
    same(s.files[1].columns, value.state.files[1].columns),
    !('columns' in s.files[0]),
    'tolerance' in s === !!value.state.tolerance,
    (s.previous?.name ?? null) === previousName,
    same(s.decisions, value.state.decisions),
    same(s.sheet, value.state.sheet),
  ].every(Boolean);
}

const stories = {};
const browser = await chromium.launch();
try {
  for (const story of facts.stories) {
    const record = { saves: {} };
    stories[story.id] = record;
    const lang = story.layout === 'ar' ? 'ar' : 'en';
    const u = await open(lang, story.id === 'Y05' ? 390 : 1440);
    const style = story.digits === 'arabic-indic' ? 'arabic' : 'plain';
    const periods = new Map(story.periods.map((p) => [p.id, p]));
    const sessions = new Map();
    let now = null;
    try {
      for (const [i, step] of story.steps.entries()) {
        const kind = Object.keys(step)[0];
        if (step.open) {
          const opened = await openMonth(u, story, step, sessions);
          if (typeof opened === 'string') {
            record.stepRefused = { step: i, kind, why: opened };
            break;
          }
          now = {
            pid: step.open,
            period: periods.get(step.open),
            read: { out: opened.read },
            value: opened.value,
            before: opened.value.result,
            queueShown: null,
            previous: step.previous ? `${step.previous}-session.json` : null,
          };
          continue;
        }
        if (step.policy) {
          await field(u, u.c.tolerance.perItem).fill(
            typed(step.policy.perItem, 2, style),
          );
          await field(u, u.c.tolerance.perPeriod).fill(
            typed(step.policy.perPeriod, 2, style),
          );
          await field(u, u.c.tolerance.note).fill(step.policy.note);
          now.value = await act(
            u,
            () => button(u, u.c.tolerance.apply).click(),
            'policy',
          );
          now.before = now.value.result;
          continue;
        }
        if (
          now.queueShown === null &&
          (step.group || step.accept || step.reject || step.save)
        )
          now.queueShown = await u.w
            .locator('[data-bank-review-group]')
            .count();
        if (step.group) now.value = await decideGroup(u, now.value, step.group);
        else if (step.accept || step.reject)
          now.value = await decide(
            u,
            now.value,
            step.accept ? 'accept' : 'reject',
            step.accept ?? step.reject,
          );
        else if (step.book) {
          await field(u, u.h.screen.balance).fill(
            typed(step.book.balance, 2, style),
          );
          await field(u, u.h.screen.note).fill(step.book.note);
        } else if (step.language) {
          await field(u, u.h.screen.language).selectOption(step.language);
          now.value = await act(
            u,
            () => button(u, u.h.screen.apply).click(),
            'sheet',
          );
        } else if (step.prepare || step.review)
          now.value = await sign(
            u,
            step.prepare ? 'prepared' : 'reviewed',
            step.prepare ?? step.review,
          );
        else if (step.save) {
          const got = asOracle(
            now.pid,
            now.period,
            now.value.result,
            now.before,
            now.read,
          );
          const against = (want) => ({
            equal: same(got, want),
            differences: Object.keys({ ...got, ...want }).filter(
              (k) => !same(got[k], want?.[k]),
            ),
          });
          const save = against(expected[story.id]?.[step.save]);
          save.corrected = against(corrected[story.id]?.[step.save]);
          if (!save.equal || !save.corrected.equal) save.outcome = got;
          save.page = await pageAgrees(
            u,
            corrected[story.id][step.save],
            now.queueShown,
          );
          const session = await download(
            u,
            u.c.save,
            `${step.save}-session.json`,
          );
          sessions.set(step.save, session);
          save.session = await sessionHolds(session, now.value, now.previous);
          await download(u, u.c.export, `${step.save}.xlsx`);
          record.saves[step.save] = save;
        }
      }
    } catch (error) {
      record.error =
        error instanceof Error ? error.message.split('\n')[0] : String(error);
    } finally {
      await u.ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

const saves = Object.values(stories).flatMap((s) => Object.values(s.saves));
const summary = {
  stories: facts.stories.length,
  saves: saves.length,
  equalToExpected: saves.filter((s) => s.equal).length,
  equalToCorrected: saves.filter((s) => s.corrected.equal).length,
  pageAgrees: saves.filter((s) => !s.page.length).length,
  sessionsRead: saves.filter((s) => s.session).length,
  errors: Object.values(stories).filter((s) => s.error).length,
  stepsRefused: Object.values(stories).filter((s) => s.stepRefused).length,
  pageErrors: errors.length,
  externalRequests: external.length,
  nonGetRequests: nonGet.length,
};
const report = { suite: path.relative(root, suite), summary, stories };
await writeFile(
  path.join(out, 'cycle-browser.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(JSON.stringify(summary));
if (arg('out')) {
  await mkdir(path.join(suite, 'results'), { recursive: true });
  await writeFile(
    path.join(suite, 'results', arg('out')),
    `${JSON.stringify(report, null, 1)}\n`,
  );
}
if (arg('assert'))
  assert.deepEqual(
    canonical(report),
    canonical(await json(path.join(suite, 'results', arg('assert')))),
    'the run differs from the recorded one',
  );
