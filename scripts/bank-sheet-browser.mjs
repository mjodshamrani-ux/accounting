// WF-1 REPORT-1 R3 acceptance in the built application: the closing
// reconciliation sheet, on all 24 sealed stories of
// audit/bank-sheet-foundation, through real uploads into the bank workspace,
// the genuine Worker and local downloads only. Each story is played as its
// facts say the accountant plays it: the book balance, its source and the
// sheet's language typed into the page's own fields, each decision taken with
// the page's own buttons on the case holding exactly its members, each
// sign-off typed and recorded on the sheet then shown. What the page shows,
// and the result it installs, are held against the sealed EXPECTED.json,
// never against the product; every downloaded workbook is read by the
// independent checker audit/bank-sheet-foundation/check_export.py, and every
// saved session is read here from its JSON. Worker replies are only observed;
// nothing is fabricated or injected.
//   pnpm build && node --experimental-strip-types scripts/bank-sheet-browser.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { bankSheetCopy } from '../lib/i18n/bank-sheet.ts';
import { ar as arCatalogue } from '../lib/i18n/locales/ar.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_SHEET_DIST: another build of the same source, for the sheet
  // interface mutation gate (scripts/test-bank-sheet-interface-mutations.mjs).
  dist = process.env.BANK_SHEET_DIST ?? path.join(root, 'dist'),
  suite = path.join(root, 'audit/bank-sheet-foundation'),
  frozen = path.join(suite, 'frozen'),
  tables = path.join(root, 'audit/bank-statement-foundation/frozen');
const output =
  process.env.BANK_SHEET_BROWSER_DIR ??
  path.join(root, 'work/bank-sheet-browser');
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
assert.equal(facts.stories.length, 24);
const MONTHS = { 10: 'OCT', 11: 'NOV', 12: 'DEC' };
const month = (period) => MONTHS[Number(period.start.slice(5, 7))];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** A minor-unit amount as an accountant types it, written here and not by
 * the product: optionally with thousands separators or Arabic-Indic digits. */
function typed(minor, decimals, style = 'plain') {
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  let whole = decimals ? digits.slice(0, -decimals) : digits;
  const part = decimals ? digits.slice(-decimals) : '';
  if (style !== 'plain')
    whole = whole.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      style === 'arabic' ? '٬' : ',',
    );
  let text =
    (minor < 0 ? '-' : '') +
    whole +
    (decimals ? (style === 'arabic' ? '٫' : '.') + part : '');
  if (style === 'arabic') text = text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  return text;
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
    h,
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

/** The installed result in the oracle's names (as in the R2 lifecycle proof). */
function asOracle(result) {
  const previous = result.roll
    ? result.roll.previous.status === 'refused'
      ? result.roll.previous.code
      : 'accepted'
    : 'none';
  assert.ok(result.sheet, 'no sheet in the installed result');
  const { outcome } = result.sheet;
  if (outcome.refusal) return { previous, refusal: outcome.refusal };
  const s = outcome.sheet;
  const standing = (x) => x && { name: x.name, date: x.date, valid: x.valid };
  return {
    previous,
    refusal: null,
    status: s.status,
    currency: s.currency,
    period: s.period,
    bank: s.bank,
    book: s.book,
    sections: Object.fromEntries(
      Object.entries(s.sections).map(([name, x]) => [
        name,
        {
          total: x.total,
          items: x.items.map((i) => ({
            item: `${month(i.period)}:${i.id}`,
            side: i.side,
            id: i.id,
            period: month(i.period),
            page: i.page,
            row: i.row,
            date: i.date,
            direction: i.direction,
            amount: i.amount,
            reference: i.reference,
            origin: i.origin,
            reason: i.reason,
            age: i.age,
            source: i.source,
          })),
        },
      ]),
    ),
    adjustedBank: s.adjustedBank,
    adjustedBook: s.adjustedBook,
    difference: s.difference,
    language: result.sheet.language,
    signoffs: {
      prepared: standing(result.sheet.prepared),
      reviewed: standing(result.sheet.reviewed),
    },
  };
}

/** What the page shows of the sheet, against EXPECTED.json. */
async function shown(u, id) {
  const want = expected[id];
  const { w, c, h } = u;
  const text = async (loc) =>
    (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const refusal = w.locator('[data-bank-sheet-refusal]');
  const status = w.locator('[data-bank-sheet-status]');
  if (want.refusal) {
    assert.equal(
      await refusal.getAttribute('data-bank-sheet-refusal'),
      want.refusal,
      `${id} refusal`,
    );
    assert.equal(
      await text(refusal),
      h.refusals[want.refusal],
      `${id} refusal words`,
    );
    assert.equal(await status.count(), 0, `${id}: a status beside a refusal`);
    assert.equal(
      await w.locator('[data-bank-statement-table="sheet"]').count(),
      0,
    );
  } else {
    assert.equal(await refusal.count(), 0, `${id}: a refusal beside a sheet`);
    assert.equal(
      await status.getAttribute('data-bank-sheet-status'),
      want.status,
      `${id} status`,
    );
    assert.equal(await text(status), h.status[want.status]);
    const sections = Object.keys(want.sections);
    const count = (name) => h.screen.count(want.sections[name].items.length);
    const rows = await u.table('sheet');
    assert.deepEqual(
      rows.map((r) => [r[0], digitsOf(r[1]), r[2]]),
      [
        [h.bank, String(want.bank.balance), h.bankSource(want.bank.page)],
        ...['bookReceiptsNotOnStatement', 'bookPaymentsNotOnStatement'].map(
          (n) => [h.sections[n], String(want.sections[n].total), count(n)],
        ),
        [h.adjustedBank, String(want.adjustedBank), ''],
        [h.book, String(want.book.balance), h.screen.declared(want.book.note)],
        ...['statementDepositsNotInBook', 'statementWithdrawalsNotInBook'].map(
          (n) => [h.sections[n], String(want.sections[n].total), count(n)],
        ),
        [h.adjustedBook, String(want.adjustedBook), ''],
        [h.difference, String(want.difference), ''],
      ],
      `${id}: the sheet as shown`,
    );
    assert.equal(sections.length, 4);
    for (const name of sections) {
      const items = want.sections[name].items;
      const key = `sheet-${name}`;
      if (!items.length) {
        assert.equal(
          await w.locator(`[data-bank-statement-table="${key}"]`).count(),
          0,
          `${id} ${name}`,
        );
        continue;
      }
      assert.deepEqual(
        (await u.table(key)).map((r) => [
          r[0],
          r[1],
          MONTHS[Number(r[2].slice(5, 7))],
          r[3],
          r[4],
          r[5],
          r[6],
          digitsOf(r[7]),
          r[8],
          r[10],
          r[11],
        ]),
        items.map((i) => [
          h.sides[i.side],
          i.id,
          i.period,
          i.page === null ? c.rowCitation(String(i.row)) : c.pageOnly(i.page),
          i.date,
          i.reference,
          c.directions[i.direction],
          String(i.amount),
          h.origins[i.origin],
          i.reason ? c.reasons[i.reason] : '',
          i.age === null ? '' : String(i.age),
        ]),
        `${id}: ${name} as shown`,
      );
    }
  }
  const signoffs = want.signoffs ?? { prepared: null, reviewed: null };
  for (const kind of ['prepared', 'reviewed']) {
    const box = w.locator(`[data-bank-sheet-signoff="${kind}"]`);
    const given = signoffs[kind];
    assert.equal(
      await box.getAttribute('data-bank-sheet-signoff-valid'),
      given ? String(given.valid) : 'none',
      `${id} ${kind} standing`,
    );
    const words = await text(box.locator('p').first());
    if (!given) assert.equal(words, h.screen.none);
    else
      assert.equal(
        words,
        `${given.name} · ${given.date} · ${given.valid ? h.signoffValid : h.signoffVoid}`,
        `${id} ${kind} as shown`,
      );
  }
  assert.equal(
    await text(w.locator('[data-bank-statement-claim]')),
    c.claimWithSheet,
    `${id}: the result claim names the sheet`,
  );
}

/** The case holding exactly a decision's members, as the lifecycle proof
 * finds it, and its row on the page. */
async function decide(u, result, d) {
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
  const wanted = [
    ...d.statement.map((s) => `${now}:${s}`),
    ...d.cashbook.map((v) => `${now}:${v}`),
    ...d.carried,
  ].sort(byText);
  const found = result.cases.filter(
    (c) =>
      c.kind !== 'automatic' &&
      JSON.stringify(members(c)) === JSON.stringify(wanted),
  );
  assert.equal(found.length, 1, `one case holds ${wanted.join(' ')}`);
  const key = found[0].kind === 'carried' ? 'carried' : 'review';
  const ids = (await u.table(key)).map((r) => r[0]);
  const at = ids.indexOf(found[0].id);
  assert.ok(at >= 0, `${found[0].id} is not shown in ${key}`);
  await u.field(u.c.note).fill('synthetic foundation decision');
  const row = u.w
    .locator(`[data-bank-statement-table="${key}"] tbody tr`)
    .nth(at);
  return u.act(() =>
    u.button(d.type === 'accept' ? u.c.accept : u.c.reject, row).click(),
  );
}

async function sign(u, kind, given, keyboard = false) {
  const box = u.w.locator(`[data-bank-sheet-signoff="${kind}"]`);
  const name = u.field(`${u.h[kind]}: ${u.h.screen.name}`, box);
  await u.field(`${u.h[kind]}: ${u.h.signoffDate}`, box).fill(given.date);
  const record = u.button(u.h.screen.sign[kind], box);
  if (!keyboard) {
    await name.fill(given.name);
    return u.act(() => record.click());
  }
  await name.fill('');
  await name.focus();
  await u.page.keyboard.type(given.name);
  let tabs = 0;
  while (!(await record.evaluate((b) => b === document.activeElement))) {
    assert.ok(
      ++tabs < 10,
      `${kind}: the record button is not reachable by Tab`,
    );
    await u.page.keyboard.press('Tab');
  }
  return u.act(() => u.page.keyboard.press('Enter'));
}

/** A story played on the page, as its facts say; the final reply. */
async function play(u, story, style = 'plain') {
  const current = story.periods.at(-1).id;
  await u.choose('statement', `${current}-statement.pdf`);
  await u.choose('cashbook', `${current}-cashbook.csv`);
  if (story.previous)
    await u.choose('previous', `${story.id}-previous-session.json`);
  else if (await u.w.locator('[data-bank-statement-file="previous"]').count())
    await u.button(u.c.priorSessionRemove).click();
  let value = await u.compare();
  assert.notEqual(
    value.state.version,
    'bank-reconciliation-sheet-1',
    `${story.id}: a comparison starts without a sheet`,
  );
  assert.equal(
    await u.w.locator('[data-bank-sheet]').count(),
    1,
    `${story.id}: the sheet form for a printed statement`,
  );
  assert.equal(
    await u.field(u.h.screen.balance).inputValue(),
    '',
    `${story.id}: no balance before it is typed`,
  );
  const apply = async (book) => {
    await u
      .field(u.h.screen.balance)
      .fill(
        book ? typed(book.balance, value.result.reading.decimals, style) : '',
      );
    await u.field(u.h.screen.note).fill(book?.note ?? '');
    await u.field(u.h.screen.language).selectOption(story.language);
    return u.act(() => u.button(u.h.screen.apply).click());
  };
  if (!story.sheet.length) value = await apply(null);
  for (const action of story.sheet) {
    if (action.book) value = await apply(action.book);
    else if (action.decide)
      value = await decide(u, value.result, action.decide);
    else
      value = await sign(
        u,
        action.prepare ? 'prepared' : 'reviewed',
        action.prepare ?? action.review,
        story.keyboard,
      );
    assert.equal(
      value.state.version,
      'bank-reconciliation-sheet-1',
      `${story.id}: the sheet kept through ${Object.keys(action)[0]}`,
    );
  }
  return value;
}

/** A saved sheet session, read here from its JSON. */
async function savedSession(file, story, state) {
  const s = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    [s.format, s.version, Object.keys(s).sort()],
    [
      'tarasuf-bank-statement-session',
      'bank-reconciliation-sheet-1',
      ['decisions', 'files', 'format', 'previous', 'scope', 'sheet', 'version'],
    ],
  );
  const current = story.periods.at(-1).id;
  const files = [
    [s.files[0], `${current}-statement.pdf`],
    [s.files[1], `${current}-cashbook.csv`],
  ];
  if (story.previous)
    files.push([s.previous, `${story.id}-previous-session.json`]);
  else assert.equal(s.previous, null);
  for (const [f, name] of files) {
    const want = await readFile(path.join(frozen, name));
    assert.equal(f.name, name);
    assert.equal(f.sha256, sha(want));
    assert.ok(
      Buffer.from(f.data, 'base64').equals(want),
      `${name} byte for byte`,
    );
  }
  assert.deepEqual(s.sheet, state.sheet, `${story.id}: the sheet inputs saved`);
  assert.equal(s.sheet.language, story.language);
  return s;
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

  // A table statement has no sheet; a printed one offers it once compared.
  {
    const u = ar;
    await u.choose('statement', 'BS01-statement.csv', tables);
    await u.choose('cashbook', 'BS01-cashbook.csv', tables);
    await u.field(u.c.currency).selectOption('SAR');
    const table = await u.compare();
    assert.equal(table.state.version, 'bank-statement-lifecycle-1');
    assert.equal(
      await u.w.locator('[data-bank-sheet]').count(),
      0,
      'no sheet for a table statement',
    );
    assert.equal(
      await u.w.locator('[data-bank-statement-claim]').innerText(),
      u.c.claim,
    );
    checks.push(
      'a table statement offers no sheet, and its claim is unchanged',
    );
  }

  // The inputs the screen refuses before anything is sent.
  {
    const u = ar;
    await u.choose('statement', 'T02-NOV-statement.pdf');
    await u.choose('cashbook', 'T02-NOV-cashbook.csv');
    await u.compare();
    const balance = u.field(u.h.screen.balance),
      note = u.field(u.h.screen.note),
      apply = u.button(u.h.screen.apply);
    for (const [typedBalance, typedNote, refusal] of [
      ['657,545.4', '', 'book'],
      ['657545', '', 'book'],
      ['', 'General ledger', 'note'],
      ['657545.46', 'x'.repeat(201), 'note'],
    ]) {
      await balance.fill(typedBalance);
      await note.fill(typedNote);
      assert.equal(
        await u.w
          .locator('[data-bank-sheet-invalid]')
          .getAttribute('data-bank-sheet-invalid'),
        refusal,
        `${typedBalance} | ${typedNote.slice(0, 20)}`,
      );
      assert.equal(
        await u.w.locator('[data-bank-sheet-invalid]').innerText(),
        u.h.screen.invalid[refusal],
      );
      assert.equal(await apply.isEnabled(), false, `${refusal}: apply offered`);
    }
    assert.equal(
      await u.w.locator('[data-bank-sheet-signoffs]').count(),
      0,
      'no sign-off before a sheet',
    );
    checks.push(
      'the screen refuses a balance off the currency decimals and a source without a balance or over 200 characters',
    );
  }

  // Every story, as its facts say: T01–T12 in Arabic at 1440, T13–T24 in
  // English at 390. T04's balance is typed in Arabic-Indic digits, T10's
  // with thousands separators; T02's review is recorded by keyboard alone.
  for (const s of facts.stories) {
    const n = Number(s.id.slice(1));
    const u = n <= 12 ? ar : en;
    const style =
      s.id === 'T04' ? 'arabic' : s.id === 'T10' ? 'grouped' : 'plain';
    const since = await u.page.evaluate(() => performance.now());
    const { state, result } = await play(
      u,
      { ...s, keyboard: s.id === 'T02' },
      style,
    );
    if (s.id === 'T23')
      timing['T23 story'] = {
        totalMs: Math.round(
          (await u.page.evaluate(() => performance.now())) - since,
        ),
        longestTaskMs: Math.round(
          await u.page.evaluate(
            (since) =>
              Math.max(
                0,
                ...globalThis.longTasks
                  .filter(([t]) => t >= since)
                  .map(([, d]) => d),
              ),
            since,
          ),
        ),
      };
    assert.deepEqual(
      asOracle(result),
      expected[s.id],
      `${s.id}: the installed sheet against EXPECTED.json`,
    );
    assert.equal(state.sheet.language, s.language);
    await shown(u, s.id);
    if (s.id === 'T04')
      await u.w
        .locator('[data-bank-sheet]')
        .screenshot({ path: path.join(out, 'ar-1440-T04-sheet.png') });
    const book = await u.download(u.c.export, `${s.id}-sheet.xlsx`);
    assert.equal(book.name, 'tarasuf-bank-statement-workpaper.xlsx');
    exportsToCheck.push({ story: s.id, path: book.target });
  }
  checks.push(
    '24/24 stories played on the page equal EXPECTED.json, on screen and in the installed result',
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
    await en.w
      .locator('[data-bank-sheet]')
      .screenshot({ path: path.join(out, 'en-390-T24-sheet.png') });
  }

  // Saved, restored cold, and the next action keeps the restored inputs:
  // T12 (a void preparation and a current review) and T23 (a chain).
  for (const id of ['T12', 'T23']) {
    const u = en;
    const s = story(id);
    const played = await play(u, s);
    assert.deepEqual(asOracle(played.result), expected[id]);
    const session = await u.download(u.c.save, `${id}-session.json`);
    assert.equal(session.name, 'tarasuf-bank-statement-session.json');
    const saved = await savedSession(session.target, s, played.state);
    await u.page.reload();
    const cold = await openDomainWorkspace(u.page, 'bank', {
      advanced: false,
      requiredSources: false,
    });
    assert.equal(await cold.locator('[data-bank-statement-result]').count(), 0);
    const back = await u.restore(session.target);
    assert.deepEqual(back.result, played.result, `${id}: the restored result`);
    await shown(u, id);
    assert.equal(
      digitsOf(await u.field(u.h.screen.balance).inputValue()),
      String(saved.sheet.book.balance),
      `${id}: the restored balance is shown`,
    );
    assert.equal(
      await u.field(u.h.screen.note).inputValue(),
      saved.sheet.book.note,
    );
    assert.equal(await u.field(u.h.screen.language).inputValue(), s.language);
    // The next action after a restore keeps every sheet input.
    const again = await u.act(() => u.button(u.h.screen.apply).click());
    assert.deepEqual(
      again.state.sheet,
      saved.sheet,
      `${id}: the sheet inputs after a restore and an action`,
    );
    assert.deepEqual(
      again.result,
      back.result,
      `${id}: the same sheet after a restore and an action`,
    );
    const restoredBook = await u.download(
      u.c.export,
      `${id}-restored-sheet.xlsx`,
    );
    exportsToCheck.push({ story: id, path: restoredBook.target });
    checks.push(
      `${id}: saved with its sheet inputs, restored cold, and kept through the next action`,
    );
  }

  // A comparison starts a new reconciliation: no sheet, no sign-off.
  {
    const u = ar;
    await play(u, story('T02'));
    const plain = await u.compare();
    assert.equal(
      plain.state.version,
      'bank-statement-lifecycle-1',
      'a comparison after a sheet carries none',
    );
    assert.equal(await u.field(u.h.screen.balance).inputValue(), '');
    assert.equal(await u.w.locator('[data-bank-sheet-signoffs]').count(), 0);
    // A plain session restored clears the sheet a page showed.
    const session = await u.download(u.c.save, 'T02-plain-session.json');
    await play(u, story('T24'));
    const back = await u.restore(session.target);
    assert.equal(back.state.version, 'bank-statement-lifecycle-1');
    assert.equal(
      await u.field(u.h.screen.balance).inputValue(),
      '',
      'a plain session brings no balance',
    );
    assert.equal(await u.w.locator('[data-bank-sheet-signoffs]').count(), 0);
    checks.push(
      'a comparison and a restored plain session bring no sheet inputs',
    );
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
  const report = {
    schema: 'tarasuf-wf1-report1-r3-browser/1',
    checks,
    workbooksChecked: checked.checked,
    timing,
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
      timing,
      seconds,
    }),
  );
} finally {
  await browser?.close();
  server.close();
}
