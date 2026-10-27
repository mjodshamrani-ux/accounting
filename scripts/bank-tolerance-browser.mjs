// WF-1 TOL-1 T3 acceptance in the built application: the declared tolerance
// in the bank workspace, on all 23 sealed stories of
// audit/bank-tolerance-foundation, through real uploads, the genuine Worker
// and local downloads only. Each story is played as its facts say the
// accountant plays it: the statement and cashbook chosen and compared, the
// policy typed into the page's own fields and applied, each decision taken
// with the page's own buttons on the case holding exactly its members, then
// the book balance applied to the sheet. A policy the lifecycle refuses must
// show its rule and leave the result as it was; a policy changed after a
// decision cannot be applied at all, the fields being fixed with the reason
// shown. What the page shows and the result it installs are held against the
// sealed EXPECTED.json, never against the product; every workbook is read by
// the independent checker audit/bank-tolerance-foundation/check_export.py,
// and every saved session is read here from its JSON and restored. Worker
// replies are only observed; nothing is fabricated or injected.
//   pnpm build && node --experimental-strip-types scripts/bank-tolerance-browser.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { bankSheetCopy } from '../lib/i18n/bank-sheet.ts';
import { ar as arCatalogue } from '../lib/i18n/locales/ar.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_TOLERANCE_DIST: another build of the same source, for the
  // interface mutation gate (scripts/test-bank-tolerance-interface-mutations.mjs).
  dist = process.env.BANK_TOLERANCE_DIST ?? path.join(root, 'dist'),
  suite = path.join(root, 'audit/bank-tolerance-foundation'),
  frozen = path.join(suite, 'frozen'),
  checker = path.join(suite, 'check_export.py');
const output =
  process.env.BANK_TOLERANCE_BROWSER_DIR ??
  path.join(root, 'work/bank-tolerance-browser');
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
assert.equal(facts.stories.length, 23);
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const SIDE = { statement: 'S', cashbook: 'C' };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sameIds = (a, b) =>
  JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));
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
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** A minor-unit amount as an accountant types it, written here and not by
 * the product: optionally with Arabic-Indic digits and decimal mark. */
function typed(minor, decimals, style = 'plain') {
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  let text =
    (minor < 0 ? '-' : '') +
    (decimals
      ? `${digits.slice(0, -decimals)}${style === 'arabic' ? '٫' : '.'}${digits.slice(-decimals)}`
      : digits);
  if (style === 'arabic') text = text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  return text;
}
/** A minor-unit amount as the page prints it: grouped, at the decimals. */
function printed(minor, decimals) {
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = (decimals ? digits.slice(0, -decimals) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  return (
    (minor < 0 ? '-' : '') +
    whole +
    (decimals ? `.${digits.slice(-decimals)}` : '')
  );
}
/** A locator that names exactly one element on the page, or an assertion
 * failure: an element a planted defect removes must fail the acceptance by
 * assertion, not by a wait that times out (DEV-22). */
async function present(loc, what) {
  assert.equal(await loc.count(), 1, `${what}: not shown`);
  return loc;
}
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
  stories = {};
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
    t = c.tolerance,
    h = bankSheetCopy[lang],
    bank = (lang === 'ar' ? arCatalogue : enCatalogue).bank;
  const replies = () => page.evaluate(() => globalThis.statementReplies.length);
  const settle = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-domain-panel="bank"] main.bank-workspace')
          ?.getAttribute('aria-busy') === 'false',
    );
  // A reply, whatever it says. A missing reply is an assertion failure, not
  // a timeout, so that a planted interface defect counts as caught.
  const reply = async (run) => {
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
  const act = async (run) => {
    const r = await reply(run);
    assert.equal(r.ok, true, `${r.action}: ${r.error ?? ''}`);
    return r.value;
  };
  const choose = async (role, file) => {
    await w
      .getByLabel(role === 'statement' ? c.statement : c.cashbook, {
        exact: true,
      })
      .setInputFiles(path.join(frozen, file));
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
    return target;
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
  const text = async (loc) =>
    (await loc.innerText()).replace(/\s+/g, ' ').trim();
  return {
    lang,
    page,
    w,
    c,
    t,
    h,
    reply,
    act,
    choose,
    download,
    restore,
    table,
    button,
    field,
    text,
  };
}

/** The policy typed into the page's fields at the statement's decimals. */
async function typePolicy(u, policy, decimals, style) {
  await u.field(u.t.perItem).fill(typed(policy.perItem, decimals, style));
  await u.field(u.t.perPeriod).fill(typed(policy.perPeriod, decimals, style));
  await u.field(u.t.note).fill(policy.note);
}

/** The case holding exactly a decision's members, and its row on the page. */
async function decide(u, result, type, d) {
  const found = result.cases.filter(
    (c) => sameIds(c.statement, d.statement) && sameIds(c.cashbook, d.cashbook),
  );
  assert.equal(
    found.length,
    1,
    `one case holds ${[...d.statement, ...d.cashbook].join(' ')}`,
  );
  const key = found[0].kind === 'tolerated' ? 'tolerated' : 'review';
  const ids = (await u.table(key)).map((r) => r[0]);
  const at = ids.indexOf(found[0].id);
  assert.ok(at >= 0, `${found[0].id} is not shown in ${key}`);
  await u.field(u.c.note).fill('synthetic foundation decision');
  const row = u.w
    .locator(`[data-bank-statement-table="${key}"] tbody tr`)
    .nth(at);
  return u.act(() =>
    u.button(type === 'reject' ? u.c.reject : u.c.undo, row).click(),
  );
}

/** The installed result in the oracle's terms, as bank-tolerance-proof has it. */
function asOracle(result) {
  const sheet = result.sheet.outcome;
  const s = sheet.refusal === null ? sheet.sheet : null;
  return {
    cases: result.cases.map((c) => ({
      id: c.id,
      kind: c.kind,
      reason: c.reason,
      statement: [...c.statement],
      cashbook: [...c.cashbook],
      status: STATUS[c.status] ?? c.status,
      ...(c.amounts ? { amounts: { ...c.amounts } } : {}),
    })),
    exceeded: result.tolerance?.exceeded
      ? { sum: result.tolerance.sum, cap: result.tolerance.policy.perPeriod }
      : null,
    outstanding: result.outstanding.map((o) => [SIDE[o.side], o.id, o.origin]),
    sheet: s && {
      status: s.status,
      difference: s.difference,
      tolerated: s.tolerated ?? 0,
      unexplained: s.unexplained ?? s.difference,
      toleratedDifferences: (s.toleratedDifferences ?? []).map((d) => [
        d.case,
        d.effect,
      ]),
    },
  };
}
const wanted = (want) => ({
  cases: want.cases.map(({ amounts, ...c }) =>
    amounts
      ? {
          ...c,
          amounts: {
            statement: amounts.statement,
            cashbook: amounts.cashbook,
            difference: amounts.difference,
          },
        }
      : c,
  ),
  exceeded: want.exceeded,
  outstanding: want.outstanding,
  sheet: {
    status: want.sheet.status,
    difference: want.sheet.difference,
    tolerated: want.sheet.tolerated,
    unexplained: want.sheet.unexplained,
    toleratedDifferences: want.sheet.toleratedDifferences,
  },
});

/** What the page shows of the tolerance, the cases and the sheet. */
async function shown(u, id, result, policy) {
  const want = expected[id];
  const { w, c, t, h } = u;
  const decimals = result.reading.decimals;
  const applied = await present(
    w.locator('[data-bank-tolerance-applied]'),
    `${id}: the policy in force`,
  );
  assert.equal(
    await applied.getAttribute('data-bank-tolerance-applied'),
    policy ? 'yes' : 'no',
    `${id}: the policy in force`,
  );
  assert.equal(
    await u.text(applied),
    policy
      ? t.declared(
          printed(policy.perItem, decimals),
          printed(policy.perPeriod, decimals),
          policy.note,
        )
      : t.none,
    `${id}: the policy as shown`,
  );
  const outcome = w.locator('[data-bank-tolerance-outcome]');
  if (!policy)
    assert.equal(
      await outcome.count(),
      0,
      `${id}: an outcome without a policy`,
    );
  else {
    const tolerated = want.cases.filter(
      (k) => k.status === 'matched-tolerated',
    ).length;
    const eligible = result.tolerance.eligible.length;
    await present(outcome, `${id}: the outcome`);
    assert.equal(
      await outcome.getAttribute('data-bank-tolerance-outcome'),
      want.exceeded ? 'exceeded' : 'tolerated',
      `${id}: the outcome`,
    );
    assert.equal(
      await u.text(outcome),
      want.exceeded
        ? t.exceeded(
            printed(want.exceeded.sum, decimals),
            printed(want.exceeded.cap, decimals),
          )
        : t.counts(tolerated, eligible),
      `${id}: the outcome as shown`,
    );
  }
  // The tolerated cases, each with its members, difference and status.
  const listed = want.cases.filter((k) => k.kind === 'tolerated');
  const rows = await u.table('tolerated');
  assert.deepEqual(
    rows.map((r) => [
      r[0],
      r[1],
      r[2],
      r[3].split(' ')[0],
      r[4].split(' ')[0],
      digitsOf(r[5]),
      r[6],
    ]),
    listed.map((k) => [
      k.id,
      c.reasons['within-tolerance'],
      result.cases.find((x) => x.id === k.id).reference,
      k.statement[0],
      k.cashbook[0],
      String(k.amounts.difference),
      c.caseStatus[k.status === 'matched' ? 'matched-automatic' : k.status],
    ]),
    `${id}: the tolerated cases as shown`,
  );
  // The review cases are only those the expectation leaves for review.
  assert.deepEqual(
    (await u.table('review')).map((r) => r[0]),
    want.cases.filter((k) => k.kind === 'review').map((k) => k.id),
    `${id}: the review cases`,
  );
  // The sheet: its status, the tolerated sum and the unexplained rest.
  const s = want.sheet;
  assert.equal(
    await (
      await present(w.locator('[data-bank-sheet-status]'), `${id}: the sheet`)
    ).getAttribute('data-bank-sheet-status'),
    s.status,
    `${id}: the sheet status`,
  );
  const bridge = (await u.table('sheet')).slice(-2);
  if (policy)
    assert.deepEqual(
      bridge.map((r) => [r[0], digitsOf(r[1]), r[2]]),
      [
        [
          h.tolerance.section,
          String(s.tolerated),
          h.screen.count(s.toleratedDifferences.length),
        ],
        [h.tolerance.unexplained, String(s.unexplained), ''],
      ],
      `${id}: the tolerated sum and the unexplained rest`,
    );
  else assert.equal(bridge.at(-1)[0], h.difference, `${id}: no tolerance rows`);
  const items = s.toleratedDifferences;
  if (!items.length)
    assert.equal(
      await w.locator('[data-bank-statement-table="sheet-tolerated"]').count(),
      0,
    );
  else
    assert.deepEqual(
      (await u.table('sheet-tolerated')).map((r) => [
        r[1],
        r[2],
        r[3],
        digitsOf(r[6]),
        r[0],
      ]),
      items.map(([caseId, effect]) => {
        const k = want.cases.find((x) => x.id === caseId);
        return [
          caseId,
          k.statement[0],
          k.cashbook[0],
          String(effect),
          h.tolerance.directions[k.amounts.direction],
        ];
      }),
      `${id}: the tolerated differences in the sheet`,
    );
}

/** A story played on the page; what it ends with. */
async function play(u, story, style) {
  const want = expected[story.id];
  const period = story.periods[0].id;
  await u.choose('statement', `${period}-statement.pdf`);
  await u.choose('cashbook', `${period}-cashbook.csv`);
  let value = await u.act(() => u.button(u.c.compare).click());
  assert.equal(
    'tolerance' in value.state,
    false,
    `${story.id}: a comparison starts without a policy`,
  );
  const decimals = value.result.reading.decimals;
  let policy = null;
  for (const action of story.actions) {
    if (action.policy) {
      if (value.result.decisions.length) {
        // A decision is bound to the policy in force: the page does not offer
        // another one, and says why.
        assert.equal(
          await u.field(u.t.perItem).isDisabled(),
          true,
          `${story.id}: fields fixed`,
        );
        assert.equal(
          await u.button(u.t.apply).isDisabled(),
          true,
          `${story.id}: apply offered`,
        );
        assert.equal(
          await u.text(
            await present(
              u.w.locator('[data-bank-tolerance-locked]'),
              `${story.id}: why the fields are fixed`,
            ),
          ),
          u.t.locked,
        );
        return { value, policy, locked: true };
      }
      await typePolicy(u, action.policy, decimals, style);
      const refused = want.refused?.startsWith('TOLERANCE:')
        ? want.refused.slice(10)
        : null;
      // A reason that is not one line of text the screen refuses itself,
      // before anything is sent; it is the contract's NOTE rule.
      if (!action.policy.note.trim()) {
        assert.equal(refused, 'NOTE', `${story.id}: a blank reason`);
        const invalid = await present(
          u.w.locator('[data-bank-tolerance-invalid]'),
          `${story.id}: the blank reason refused on screen`,
        );
        assert.equal(
          await invalid.getAttribute('data-bank-tolerance-invalid'),
          'note',
          `${story.id}: the blank reason not refused on screen`,
        );
        assert.equal(await u.text(invalid), u.t.invalid.note);
        assert.equal(
          await u.button(u.t.apply).isDisabled(),
          true,
          `${story.id}: apply offered for a blank reason`,
        );
        return { value, policy: null, refused, screen: true };
      }
      const r = await u.reply(() => u.button(u.t.apply).click());
      if (refused && action === story.actions.at(-1)) {
        assert.equal(r.ok, false, `${story.id}: the policy was taken`);
        const shownRule = await present(
          u.w.locator('[data-bank-tolerance-refused]'),
          `${story.id}: the refused rule`,
        );
        assert.equal(
          await shownRule.getAttribute('data-bank-tolerance-refused'),
          refused,
        );
        assert.equal(await u.text(shownRule), u.t.rules[refused]);
        assert.equal(
          await (
            await present(
              u.w.locator('[data-bank-statement-failure]'),
              `${story.id}: the failure`,
            )
          ).getAttribute('data-bank-statement-failure'),
          'tolerance',
        );
        assert.equal(
          await u.w
            .locator('[data-bank-tolerance-applied]')
            .getAttribute('data-bank-tolerance-applied'),
          'no',
          `${story.id}: a refused policy shown as applied`,
        );
        return { value, policy: null, refused };
      }
      assert.equal(r.ok, true, `${r.action}: ${r.error ?? ''}`);
      value = r.value;
      policy = action.policy;
      assert.deepEqual(
        value.state.tolerance,
        policy,
        `${story.id}: the policy sent`,
      );
    } else {
      const [type, d] = action.reject
        ? ['reject', action.reject]
        : ['undo', action.undo];
      value = await decide(u, value.result, type, d);
    }
  }
  // The sheet, with the declared book balance.
  await u
    .field(u.h.screen.balance)
    .fill(typed(story.book.balance, decimals, style));
  await u.field(u.h.screen.note).fill(story.book.note);
  await u.field(u.h.screen.language).selectOption(u.lang);
  value = await u.act(() => u.button(u.h.screen.apply).click());
  if (policy)
    assert.deepEqual(
      value.state.tolerance,
      policy,
      `${story.id}: the policy kept with the sheet`,
    );
  return { value, policy };
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

  // The fields the screen refuses before anything is sent, and the way back
  // to no tolerance.
  {
    const u = en;
    await u.choose('statement', 'T01-DEC-statement.pdf');
    await u.choose('cashbook', 'T01-DEC-cashbook.csv');
    const first = await u.act(() => u.button(u.c.compare).click());
    for (const [perItem, perPeriod, note, refusal] of [
      ['0.1', '0.05', 'x', 'perItem'],
      ['0.01', '5', 'x', 'perPeriod'],
      ['0.01', '0.05', ' ', 'note'],
      ['0.01', '0.05', 'x'.repeat(201), 'note'],
    ]) {
      await u.field(u.t.perItem).fill(perItem);
      await u.field(u.t.perPeriod).fill(perPeriod);
      await u.field(u.t.note).fill(note);
      const invalid = await present(
        u.w.locator('[data-bank-tolerance-invalid]'),
        `${refusal}: refused on screen`,
      );
      assert.equal(
        await invalid.getAttribute('data-bank-tolerance-invalid'),
        refusal,
      );
      assert.equal(await u.text(invalid), u.t.invalid[refusal]);
      assert.equal(
        await u.button(u.t.apply).isDisabled(),
        true,
        `${refusal}: apply offered`,
      );
    }
    // Applied by the keyboard, then removed: the cases are as before.
    await typePolicy(u, { perItem: 1, perPeriod: 5, note: 'Rounding' }, 2);
    await u.button(u.t.apply).focus();
    const applied = await u.act(() => u.page.keyboard.press('Enter'));
    assert.equal(
      applied.result.cases.filter((k) => k.kind === 'tolerated').length,
      1,
    );
    const removed = await u.act(() => u.button(u.t.remove).click());
    assert.equal('tolerance' in removed.state, false);
    assert.ok(
      same(removed.result.cases, first.result.cases),
      'removing the policy restores the cases',
    );
    assert.equal(await u.button(u.t.remove).isDisabled(), true);
    checks.push(
      'the screen refuses limits off the currency decimals and an empty or long reason; a policy applied by the keyboard and removed leaves the cases as compared',
    );
  }

  for (const [index, story] of facts.stories.entries()) {
    const u = index % 2 ? ar : en;
    const style = index % 3 === 2 ? 'arabic' : 'plain';
    const record = { lang: u.lang };
    stories[story.id] = record;
    const want = expected[story.id];
    const { value, policy, locked, refused, screen } = await play(
      u,
      story,
      style,
    );
    if (locked) {
      assert.equal(
        want.refused,
        'DECISION',
        `${story.id}: fixed fields where none were expected`,
      );
      record.outcome = 'locked';
      continue;
    }
    if (refused) {
      assert.equal(want.refused, `TOLERANCE:${refused}`);
      record.outcome = `refused ${refused}${screen ? ' on screen' : ''}`;
      continue;
    }
    assert.equal(want.refused, null, `${story.id}: expected ${want.refused}`);
    const got = asOracle(value.result);
    assert.ok(
      same(got, wanted(want)),
      `${story.id}: the installed result differs from the expectation`,
    );
    await shown(u, story.id, value.result, policy);
    // The workbook, to the independent checker; the session, read and restored.
    const workbook = await u.download(u.c.export, `${story.id}.xlsx`);
    exportsToCheck.push({
      label: story.id,
      story: story.id,
      path: workbook,
      language: u.lang,
    });
    const session = await u.download(u.c.save, `${story.id}-session.json`);
    const saved = JSON.parse(await readFile(session, 'utf8'));
    assert.deepEqual(
      saved.tolerance ?? null,
      policy,
      `${story.id}: the policy in the session`,
    );
    assert.equal(saved.version, 'bank-reconciliation-sheet-1');
    const back = await u.restore(session);
    assert.ok(
      same(back.result, value.result),
      `${story.id}: the restored result differs`,
    );
    await shown(u, story.id, back.result, policy);
    // The restored policy is the one the form shows and the next request
    // carries: the sheet applied again keeps it.
    const decimals = back.result.reading.decimals;
    assert.deepEqual(
      [
        await u.field(u.t.perItem).inputValue(),
        await u.field(u.t.perPeriod).inputValue(),
        await u.field(u.t.note).inputValue(),
      ],
      policy
        ? [
            typed(policy.perItem, decimals),
            typed(policy.perPeriod, decimals),
            policy.note,
          ]
        : ['', '', ''],
      `${story.id}: the form after restoring`,
    );
    const again = await u.act(() => u.button(u.h.screen.apply).click());
    assert.deepEqual(
      again.state.tolerance ?? null,
      policy,
      `${story.id}: the policy after restoring`,
    );
    assert.ok(
      same(again.result, value.result),
      `${story.id}: the result after restoring`,
    );
    record.outcome = want.sheet.status;
    record.tolerated = want.cases.filter(
      (k) => k.status === 'matched-tolerated',
    ).length;
  }

  const r = spawnSync('python3', ['-B', checker], {
    input: JSON.stringify({
      frozen,
      exports: exportsToCheck,
      selfTest: ['T07', 'T04', 'T19', 'T23', 'T08'],
    }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `the workbook checker: ${r.stderr || r.stdout}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.checked, exportsToCheck.length);
  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'requests outside the page');
  assert.deepEqual(nonGet, [], 'requests other than GET');
  const all = Object.values(stories);
  console.log(
    JSON.stringify({
      stories: all.length,
      reconciled: all.filter((s) =>
        /^reconciled|^difference|^draft/u.test(s.outcome),
      ).length,
      refused: all.filter((s) => s.outcome?.startsWith('refused')).length,
      locked: all.filter((s) => s.outcome === 'locked').length,
      tolerated: all.reduce((n, s) => n + (s.tolerated ?? 0), 0),
      workbooks: report.checked,
      selfTest: Object.keys(report.selfTest).length,
      checks: checks.length,
      seconds: Math.round((performance.now() - started) / 1000),
      out: path.relative(root, out),
    }),
  );
} finally {
  await browser?.close();
  server.close();
}
