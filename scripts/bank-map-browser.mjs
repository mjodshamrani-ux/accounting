// WF-1 MAP-1 M3 acceptance in the built application: the cashbook columns
// (bank-cashbook-map-1, proposed) on all 21 sealed stories of
// audit/bank-map-foundation, through real uploads into the bank workspace,
// the genuine Worker, this browser's storage and local downloads only. Each
// story starts with no saved map, and is played on the page as its facts say:
// the declared reading first, which reads the declared twin and refuses every
// other cashbook's header row; then a choice by hand or a saved map in the
// columns panel; a map saved, imported or downloaded. Every outcome is held
// against the sealed EXPECTED.json: a refused map by its code, a map that
// does not fit by its problems with nothing read, a refused reading by its
// code and row, a settled period by its cases and the items left
// outstanding, the columns shown with the result, and the names saved on
// this device after every action. Every settled period is saved and its
// workbook downloaded: the session is read here from its JSON, and the
// workbook by the independent audit/bank-map-foundation/check_export.py. A
// downloaded map is held against the map the story saved. A session read
// with columns is restored on a new page, and its columns chosen again.
// The accountant's actions to read a cashbook by hand and by a saved map are
// counted (reported, not required). Worker replies are only observed.
//   pnpm build && node --experimental-strip-types scripts/bank-map-browser.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { bankStatementCopy } from '../lib/i18n/bank-statement.ts';
import { bankMapCopy } from '../lib/i18n/bank-map.ts';
import { ar as arCatalogue } from '../lib/i18n/locales/ar.ts';
import { en as enCatalogue } from '../lib/i18n/locales/en.ts';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  // BANK_MAP_DIST: another build of the same source, for the interface
  // mutation gate (scripts/test-bank-map-interface-mutations.mjs).
  dist = process.env.BANK_MAP_DIST ?? path.join(root, 'dist'),
  suite = path.join(root, 'audit/bank-map-foundation'),
  frozen = path.join(suite, 'frozen'),
  checker = path.join(suite, 'check_export.py');
const output =
  process.env.BANK_MAP_BROWSER_DIR ?? path.join(root, 'work/bank-map-browser');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const KEY = 'tarasuf.column-maps.v1';
const ROLES = [
  'date',
  'voucher',
  'description',
  'reference',
  'receipts',
  'payments',
];
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const letters = (n) => {
  let s = '';
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26))
    s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};
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

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
for (const [name, digest] of Object.entries(manifest.external))
  assert.equal(
    sha(await readFile(path.join(root, 'audit', name))),
    digest,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
assert.equal(facts.stories.length, 21);

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
  exportsToCheck = [],
  measure = { hand: [], map: [] },
  counts = {
    stories: 0,
    reads: 0,
    declared: 0,
    settled: 0,
    refused: 0,
    misfits: 0,
    invalid: 0,
    imports: 0,
    exports: 0,
    saves: 0,
    sessions: 0,
    workbooks: 0,
    restored: 0,
    keyboard: 0,
  };
let browser;

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
              value: a === 'bank-statement-reconcile' ? e.data.value : null,
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
  const u = {
    lang,
    page,
    w,
    ctx,
    c: bankStatementCopy[lang],
    m: bankMapCopy[lang],
    bank: (lang === 'ar' ? arCatalogue : enCatalogue).bank,
    current: { statement: null, cashbook: null },
    actions: 0,
  };
  return u;
}

const replies = (u) => u.page.evaluate(() => globalThis.replies.length);
const settle = (u) =>
  u.page.waitForFunction(
    () =>
      document
        .querySelector('[data-domain-panel="bank"] main.bank-workspace')
        ?.getAttribute('aria-busy') === 'false',
  );
/** The next reply of an action after a count, as an assertion: a missing
 * reply is a failed check, not a timeout, so a planted defect is caught. */
async function reply(u, before, action) {
  await u.page
    .waitForFunction(
      ([n, a]) => globalThis.replies.slice(n).some((r) => r.action === a),
      [before, action],
      { timeout: 120000 },
    )
    .catch(() => assert.fail(`no ${action} reply from the Worker`));
  return u.page.evaluate(
    ([n, a]) => globalThis.replies.slice(n).find((r) => r.action === a),
    [before, action],
  );
}
/** No reconciliation was asked of the Worker since a count. */
async function nothingRead(u, before, what) {
  await settle(u);
  const since = await u.page.evaluate(
    (n) => globalThis.replies.slice(n).map((r) => r.action),
    before,
  );
  assert.deepEqual(
    since.filter((a) => a === 'bank-statement-reconcile'),
    [],
    `${what}: nothing is read`,
  );
}
/** An element shown, or a failed assertion naming it (DEV-22). */
const shown = (locator, what, timeout = 30000) =>
  locator.waitFor({ timeout }).catch(() => assert.fail(`${what}: not shown`));
const button = (u, name, scope = u.w) =>
  scope.getByRole('button', { name, exact: true });
const panel = (u) => u.w.locator('[data-bank-map]');
async function click(u, target, what) {
  assert.equal(await target.count(), 1, `${what}: not shown`);
  assert.equal(await target.isEnabled(), true, `${what}: not enabled`);
  u.actions++;
  await target.click();
}
async function select(u, target, value, what) {
  assert.equal(await target.count(), 1, `${what}: not shown`);
  if ((await target.inputValue()) === value) return;
  u.actions++;
  await target.selectOption(value);
}

/** A source chosen with the native input, under the name the story gives. */
async function choose(u, role, file, name) {
  const label = role === 'statement' ? u.c.statement : u.c.cashbook;
  u.actions++;
  await u.w.getByLabel(label, { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith('.pdf')
      ? 'application/pdf'
      : name.endsWith('.csv')
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(file),
  });
  await u.w
    .locator(`[data-bank-statement-file="${role}"]`)
    .filter({ hasText: name })
    .waitFor({ timeout: 30000 })
    .catch(() => assert.fail(`${name} is not shown as the ${role}`));
  u.current[role] = file + '|' + name;
}

/** The names saved on this device, each a map of the contract's form. */
async function storedNames(u) {
  const raw = await u.page.evaluate((k) => localStorage.getItem(k), KEY);
  if (raw === null) return [];
  const list = JSON.parse(raw);
  for (const m of list)
    assert.deepEqual(
      Object.keys(m).sort(),
      ['columns', 'format', 'header', 'name', 'role', 'version'],
      'a stored map holds its form only',
    );
  return list.map((m) => m.name).sort();
}

/** The settled period held against the sealed expectation, on the reply
 * and on the page. */
async function settledAgrees(u, value, want, where, columns) {
  const { result } = value;
  assert.deepEqual(
    result.cases.map((c) => ({
      id: c.id,
      kind: c.kind,
      reason: c.reason,
      statement: c.statement,
      cashbook: c.cashbook,
      status: STATUS[c.status] ?? c.status,
    })),
    want.period.cases,
    `${where}: cases`,
  );
  assert.deepEqual(
    result.outstanding.map((o) => [
      o.side === 'statement' ? 'S' : 'C',
      o.id,
      o.origin,
    ]),
    want.period.outstanding,
    `${where}: outstanding`,
  );
  await shown(u.w.locator('[data-bank-statement-result]'), `${where}: result`);
  const columnRows = u.w.locator(
    '[data-bank-statement-table="cashbook-columns"] tbody tr',
  );
  if (!columns) {
    assert.equal(await columnRows.count(), 0, `${where}: no columns shown`);
    assert.ok(!('columns' in result.sources[1]), `${where}: declared`);
    return;
  }
  const cited = result.sources[1];
  assert.deepEqual(
    canonical(cited.columns),
    canonical(columns),
    `${where}: the columns read with`,
  );
  assert.deepEqual(
    [cited.above, cited.unread],
    [want.reading.above, want.reading.unread],
    `${where}: what was left out`,
  );
  // The page shows the columns the result cites, in the workbook's order.
  const rows = await columnRows.evaluateAll((trs) =>
    trs.map((tr) =>
      [...tr.querySelectorAll('td')].map((td) =>
        td.textContent.replace(/\s+/g, ' ').trim(),
      ),
    ),
  );
  assert.deepEqual(
    rows,
    [
      [u.m.usedHeader, String(columns.header), ''],
      ...ROLES.map((r) =>
        columns.columns[r]
          ? [
              u.m.roles[r],
              letters(columns.columns[r].column),
              columns.columns[r].label,
            ]
          : [u.m.roles[r], u.m.notRead, ''],
      ),
      [u.m.above, String(want.reading.above), ''],
      ...want.reading.unread.map((x) => [
        u.m.unread,
        letters(x.column),
        x.label,
      ]),
    ],
    `${where}: the columns shown`,
  );
}

/** The session saved and the workbook downloaded for a settled period. */
async function outputs(u, story, k, cashbookPath, columns, where) {
  const save = async (name) => {
    const target = button(u, name);
    assert.equal(await target.isEnabled(), true, name);
    const pending = u.page
      .waitForEvent('download', { timeout: 120000 })
      .catch(() => null);
    await target.click();
    const d = await pending;
    assert.ok(d, `${where}: no download for ${name}`);
    await settle(u);
    return d;
  };
  const session = await save(u.c.save);
  const sessionFile = path.join(out, `${story.id}-${k + 1}.json`);
  await session.saveAs(sessionFile);
  const parsed = await json(sessionFile);
  assert.ok(!('columns' in parsed.files[0]), `${where}: statement columns`);
  assert.deepEqual(
    canonical(parsed.files[1].columns ?? null),
    canonical(columns ?? null),
    `${where}: the session keeps the columns with the cashbook`,
  );
  counts.sessions++;
  const book = await save(u.c.export);
  const bookFile = path.join(out, `${story.id}-${k + 1}.xlsx`);
  await book.saveAs(bookFile);
  exportsToCheck.push({
    label: `${story.id}#${k + 1}`,
    story: story.id,
    action: k,
    path: bookFile,
    cashbook: cashbookPath,
  });
  counts.workbooks++;
  return sessionFile;
}

/** The problems a map or choice shows, against the sealed ones. */
async function problemsAgree(u, want, header, where) {
  const items = panel(u).locator('[data-bank-map-problem]');
  await shown(items.first(), `${where}: problems`);
  const listed = await items.evaluateAll((lis) =>
    lis.map((li) => ({
      kind: li.getAttribute('data-bank-map-problem'),
      role: li.getAttribute('data-bank-map-role'),
      text: li.textContent,
    })),
  );
  assert.deepEqual(
    listed.map((p) => [p.kind, p.role]),
    want.map((p) => [p.kind, p.role ?? null]),
    `${where}: the problems`,
  );
  for (const [i, p] of want.entries()) {
    const text = listed[i].text;
    if (p.kind === 'sheets') assert.ok(text.includes(String(p.count)), where);
    else if (p.kind === 'header-row')
      assert.ok(text.includes(String(p.row)), where);
    else {
      assert.ok(
        text.includes(`${letters(p.column)}${header}`),
        `${where}: cell`,
      );
      assert.ok(text.includes(p.label), `${where}: saved label`);
      if (p.found) assert.ok(text.includes(p.found), `${where}: found`);
      for (const cell of p.elsewhere)
        assert.ok(text.includes(cell), `${where}: ${cell}`);
    }
  }
}

/** The number of the panel's notice shown, or null. */
const lastNotice = (u) =>
  u.page.evaluate(
    () =>
      document
        .querySelector('[data-bank-map-notice]')
        ?.getAttribute('data-bank-map-seq') ?? null,
  );
/** A new notice of the panel, after the one numbered before, by its kind
 * and code: a notice left from an earlier action does not count. */
async function notice(u, kind, code, where, before) {
  await u.page
    .waitForFunction(
      (b) => {
        const n = document.querySelector('[data-bank-map-notice]');
        return !!n && n.getAttribute('data-bank-map-seq') !== b;
      },
      before,
      { timeout: 30000 },
    )
    .catch(() => assert.fail(`${where}: no new notice`));
  const item = panel(u).locator('[data-bank-map-notice]');
  assert.equal(
    await item.getAttribute('data-bank-map-notice'),
    kind,
    `${where}: the notice`,
  );
  const text = await item.textContent();
  if (code) {
    assert.equal(
      await item.getAttribute('data-bank-map-code'),
      code,
      `${where}: code`,
    );
    assert.ok(
      text.includes(code) && text.includes(u.m.codes[code]),
      `${where}: the refusal says ${code} and what it means`,
    );
  }
  return text;
}

/** The columns panel open for choosing: after the declared reading refused
 * the header row, or when asked again. */
async function choosing(u, where) {
  if (await panel(u).locator('[data-bank-map-read="hand"]').count()) return;
  const change = panel(u).locator('[data-bank-map-change]');
  if (await change.count()) {
    await click(u, change, `${where}: choose other columns`);
    await shown(panel(u).locator('[data-bank-map-read="hand"]'), where);
    return;
  }
  assert.fail(`${where}: the columns panel is not shown`);
}

/** One read action of a story, as the page plays it. Outside the record
 * (record false) nothing is counted, measured or downloaded. */
async function read(u, story, k, action, want, store, record = true) {
  const where = `${story.id}#${k + 1}`;
  const source = path.join(root, 'audit', action.source, 'frozen');
  const statement = path.join(source, `${action.period}-statement.pdf`);
  const cashbook = action.twin
    ? path.join(source, action.file)
    : path.join(frozen, action.file);
  const name = action.as ?? action.file;
  const started = u.actions;
  if (u.current.statement !== statement + '|' + path.basename(statement))
    await choose(u, 'statement', statement, path.basename(statement));
  const fresh = u.current.cashbook !== cashbook + '|' + name;
  if (fresh) {
    await choose(u, 'cashbook', cashbook, name);
    assert.equal(await panel(u).count(), 0, `${where}: no panel before`);
    // The declared reading first, as it is.
    const before = await replies(u);
    await click(u, button(u, u.c.compare), `${where}: compare`);
    const r = await reply(u, before, 'bank-statement-reconcile');
    await settle(u);
    if (action.by === 'declared') {
      if (record) counts.declared++;
      if (want.reading.refused) {
        assert.equal(r.ok, false, where);
        assert.match(
          r.error,
          new RegExp(
            `^BANK_CASHBOOK_${want.reading.refused.code}: row ${want.reading.refused.row}:`,
          ),
          where,
        );
        return;
      }
      assert.equal(r.ok, true, `${where}: ${r.error}`);
      await settledAgrees(u, r.value, want, where, null);
      assert.equal(await panel(u).count(), 0, `${where}: no columns panel`);
      if (record) {
        await outputs(u, story, k, cashbook, null, where);
        counts.settled++;
      }
      return;
    }
    assert.equal(r.ok, false, `${where}: the declared reading`);
    assert.match(r.error, /^BANK_CASHBOOK_HEADER: row 1:/u, where);
    const layout = await reply(u, before, 'read');
    assert.equal(layout.ok, true, `${where}: the file read for its columns`);
    assert.ok(
      (
        await u.w
          .locator('[data-bank-statement-failure="cashbook"]')
          .textContent()
      ).includes('BANK_CASHBOOK_HEADER'),
      `${where}: the refusal stays shown`,
    );
  }
  await choosing(u, where);
  const before = await replies(u);
  let columns = null;
  if (action.by === 'map') {
    const saved = store.find((m) => m.name === action.map);
    assert.ok(saved, `${where}: ${action.map} is saved`);
    columns = { header: saved.header, columns: saved.columns };
    await select(
      u,
      panel(u).locator('[data-bank-map-select]'),
      action.map,
      `${where}: map`,
    );
    await click(
      u,
      panel(u).locator('[data-bank-map-read="map"]'),
      `${where}: read with the map`,
    );
    if (!want.fit.fits) {
      await problemsAgree(u, want.fit.problems, saved.header, where);
      await nothingRead(u, before, where);
      if (record) counts.misfits++;
      return;
    }
  } else {
    await select(
      u,
      panel(u).locator('[data-bank-map-header]'),
      String(action.header),
      `${where}: header`,
    );
    for (const role of ROLES)
      await select(
        u,
        panel(u).locator(`[data-bank-map-role-select="${role}"]`),
        action.columns[role] === null ? '' : String(action.columns[role]),
        `${where}: ${role}`,
      );
    const said = await lastNotice(u);
    await click(
      u,
      panel(u).locator('[data-bank-map-read="hand"]'),
      `${where}: read with these columns`,
    );
    if (want.invalid) {
      await notice(u, 'refused', want.invalid, where, said);
      await nothingRead(u, before, where);
      if (record) counts.invalid++;
      return;
    }
    if (!want.fit.fits) {
      await problemsAgree(u, want.fit.problems, action.header, where);
      await nothingRead(u, before, where);
      if (record) counts.misfits++;
      return;
    }
  }
  const r = await reply(u, before, 'bank-statement-reconcile');
  await settle(u);
  if (record) counts.reads++;
  if (want.reading.refused) {
    assert.equal(r.ok, false, `${where}: refused`);
    assert.match(
      r.error,
      new RegExp(
        `^BANK_CASHBOOK_${want.reading.refused.code}: row ${want.reading.refused.row}:`,
      ),
      where,
    );
    await shown(
      u.w.locator('[data-bank-statement-failure="cashbook"]'),
      `${where}: the refusal`,
    );
    if (record) counts.refused++;
  } else {
    assert.equal(r.ok, true, `${where}: ${r.error}`);
    // A choice by hand takes its labels from the file: the result cites
    // them, and the independent checker derives them from the sealed file.
    columns ??= r.value.result.sources[1].columns;
    await settledAgrees(u, r.value, want, where, columns);
    if (record) {
      await outputs(u, story, k, cashbook, columns, where);
      counts.settled++;
    }
  }
  if (record)
    (action.by === 'hand' ? measure.hand : measure.map).push({
      read: where,
      actions: u.actions - started,
      fresh,
    });
  if (action.by === 'hand' && action.save) {
    u.actions++;
    await panel(u).locator('[data-bank-map-name]').fill(action.save);
    const said = await lastNotice(u);
    await click(u, panel(u).locator('[data-bank-map-save]'), `${where}: save`);
    const replaced = store.some((m) => m.name === action.save);
    const text = await notice(
      u,
      replaced ? 'replaced' : 'saved',
      null,
      where,
      said,
    );
    assert.ok(text.includes(action.save), `${where}: the name saved`);
    if (record) counts.saves++;
  }
}

/** The panel appears only once the declared reading refuses a header row:
 * a story that imports first opens it on the first of its cashbooks the
 * declared reading refuses, as an accountant would, then imports. */
async function openPanelFor(u, story) {
  const k = story.actions.findIndex(
    (a, i) =>
      a.do === 'read' &&
      (a.by !== 'declared' || expected[story.id][i].reading.refused),
  );
  const first = story.actions[k];
  const source = path.join(root, 'audit', first.source, 'frozen');
  const statement = path.join(source, `${first.period}-statement.pdf`);
  const cashbook = first.twin
    ? path.join(source, first.file)
    : path.join(frozen, first.file);
  await choose(u, 'statement', statement, path.basename(statement));
  await choose(u, 'cashbook', cashbook, first.as ?? first.file);
  const before = await replies(u);
  await click(u, button(u, u.c.compare), `${story.id}: compare`);
  assert.equal((await reply(u, before, 'read')).ok, true, story.id);
  await settle(u);
  await shown(panel(u), `${story.id}: the columns panel`);
}

/** A story played on its own page, as its facts say. */
async function play(story, lang, width) {
  const u = await open(lang, width);
  try {
    if (story.actions[0].do === 'import') await openPanelFor(u, story);
    for (const [k, action] of story.actions.entries()) {
      const want = expected[story.id][k];
      const where = `${story.id}#${k + 1}`;
      const store = await u.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '[]'),
        KEY,
      );
      if (action.do === 'import') {
        u.actions++;
        const said = await lastNotice(u);
        await panel(u)
          .getByLabel(u.m.importMap, { exact: true })
          .setInputFiles(path.join(frozen, action.file));
        if (want.accepted) await notice(u, 'imported', null, where, said);
        else await notice(u, 'refused', want.code, where, said);
        counts.imports++;
      } else if (action.do === 'export') {
        await select(
          u,
          panel(u).locator('[data-bank-map-select]'),
          action.map,
          `${where}: map`,
        );
        const pending = u.page
          .waitForEvent('download', { timeout: 60000 })
          .catch(() => null);
        await click(u, panel(u).locator('[data-bank-map-export]'), where);
        const d = await pending;
        assert.ok(d, `${where}: no map downloaded`);
        const file = path.join(out, `${story.id}-${k + 1}-map.json`);
        await d.saveAs(file);
        assert.deepEqual(
          canonical(await json(file)),
          canonical(want.map),
          `${where}: the downloaded map`,
        );
        counts.exports++;
      } else await read(u, story, k, action, want, store);
      assert.deepEqual(await storedNames(u), want.store, `${where}: saved`);
    }
    counts.stories++;
  } catch (error) {
    await u.page
      .screenshot({ path: path.join(out, `${story.id}-failure.png`) })
      .catch(() => undefined);
    throw error;
  } finally {
    await u.ctx.close();
  }
}

try {
  browser = await chromium.launch(
    process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {},
  );
  // Arabic and English in turn; one story at a phone's width.
  for (const [i, story] of facts.stories.entries())
    await play(story, i % 2 ? 'en' : 'ar', story.id === 'M11' ? 390 : 1280);

  // A session read with a saved map (M01's August), restored on a new page:
  // the result shows its columns, and other columns can be chosen on the
  // same file once it is read again.
  {
    const u = await open('ar', 1280);
    const before = await replies(u);
    const advanced = u.w.locator('details[data-workspace-advanced]').first();
    if ((await advanced.getAttribute('open')) === null)
      await advanced.locator(':scope > summary').click();
    await u.w
      .getByLabel(u.bank.restore, { exact: true })
      .setInputFiles(path.join(out, 'M01-2.json'));
    const r = await reply(u, before, 'bank-statement-restore');
    assert.equal(r.ok, true, `restore: ${r.error}`);
    await settle(u);
    const saved = (await json(path.join(out, 'M01-2.json'))).files[1].columns;
    const rows = await u.w
      .locator('[data-bank-statement-table="cashbook-columns"] tbody tr')
      .count();
    assert.equal(
      rows,
      1 + ROLES.length + 1 + expected.M01[1].reading.unread.length,
      'restore: the columns are shown',
    );
    assert.equal(
      await panel(u).locator('[data-bank-map-read="hand"]').count(),
      0,
      'restore: choosing stays closed',
    );
    const reading = await replies(u);
    await click(u, panel(u).locator('[data-bank-map-change]'), 'restore');
    assert.equal(
      (await reply(u, reading, 'read')).ok,
      true,
      'restore: the file read for its columns',
    );
    await shown(panel(u).locator('[data-bank-map-read="hand"]'), 'restore');
    assert.ok(saved, 'restore: the session held columns');
    counts.restored++;
    await u.ctx.close();
  }

  // The keyboard alone: M01's August by the map saved on July.
  {
    const story = facts.stories.find((s) => s.id === 'M01');
    const u = await open('en', 1280);
    await read(u, story, 0, story.actions[0], expected.M01[0], [], false);
    const action = story.actions[1];
    const source = path.join(root, 'audit', action.source, 'frozen');
    await choose(
      u,
      'statement',
      path.join(source, `${action.period}-statement.pdf`),
      `${action.period}-statement.pdf`,
    );
    await choose(u, 'cashbook', path.join(frozen, action.file), action.file);
    let before = await replies(u);
    await button(u, u.c.compare).focus();
    await u.page.keyboard.press('Enter');
    assert.equal((await reply(u, before, 'read')).ok, true, 'keyboard');
    await settle(u);
    const map = panel(u).locator('[data-bank-map-select]');
    await map.focus();
    await u.page.keyboard.press('ArrowDown');
    assert.equal(await map.inputValue(), action.map, 'keyboard: the map');
    const target = panel(u).locator('[data-bank-map-read="map"]');
    let tabs = 0;
    while (!(await target.evaluate((b) => b === document.activeElement))) {
      assert.ok(++tabs < 50, 'the read button is not reachable by Tab');
      await u.page.keyboard.press('Tab');
    }
    before = await replies(u);
    await u.page.keyboard.press('Enter');
    const r = await reply(u, before, 'bank-statement-reconcile');
    await settle(u);
    assert.equal(r.ok, true, `keyboard: ${r.error}`);
    const store = await u.page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      KEY,
    );
    await settledAgrees(u, r.value, expected.M01[1], 'keyboard', {
      header: store[0].header,
      columns: store[0].columns,
    });
    counts.keyboard++;
    await u.ctx.close();
  }

  // Two maps on one device, which no story holds: M13's saved first, then
  // M01's. M01's August is read by its own map, the second in the list,
  // and that map is the one downloaded.
  {
    const m13 = facts.stories.find((s) => s.id === 'M13'),
      m01 = facts.stories.find((s) => s.id === 'M01');
    const u = await open('ar', 1280);
    await read(u, m13, 0, m13.actions[0], expected.M13[0], [], false);
    await read(u, m01, 0, m01.actions[0], expected.M01[0], [], false);
    const store = await u.page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      KEY,
    );
    assert.deepEqual(
      store.map((m) => m.name),
      ['Collections account', 'Main current account'],
      'two maps: both kept, in the order saved',
    );
    await read(u, m01, 1, m01.actions[1], expected.M01[1], store, false);
    await select(
      u,
      panel(u).locator('[data-bank-map-select]'),
      'Main current account',
      'two maps: the map to download',
    );
    const pending = u.page
      .waitForEvent('download', { timeout: 60000 })
      .catch(() => null);
    await click(u, panel(u).locator('[data-bank-map-export]'), 'two maps');
    const d = await pending;
    assert.ok(d, 'two maps: no map downloaded');
    const file = path.join(out, 'two-maps.json');
    await d.saveAs(file);
    assert.deepEqual(
      canonical(await json(file)),
      canonical(store[1]),
      'two maps: the map downloaded is the one chosen',
    );
    counts.twoMaps = 1;
    await u.ctx.close();
  }

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'requests outside the application');
  assert.deepEqual(nonGet, [], 'requests other than GET');

  const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
    input: JSON.stringify({
      frozen,
      selfTest: ['M01#1', 'M18#21'],
      exports: exportsToCheck,
    }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const report = JSON.parse(check.stdout);
  assert.equal(report.workbooks, counts.workbooks);
  // The measure (reported, not required): a cashbook opened afresh and read
  // by hand or by a saved map that fits, every action counted from opening
  // the statement and the cashbook to the result.
  const mean = (list) =>
    list.length
      ? Math.round(
          (list.reduce((sum, x) => sum + x.actions, 0) / list.length) * 10,
        ) / 10
      : null;
  const fresh = (list) => list.filter((x) => x.fresh);
  const summary = {
    ...counts,
    checker: report.passed,
    measure: {
      hand: {
        reads: fresh(measure.hand).length,
        mean: mean(fresh(measure.hand)),
      },
      map: { reads: fresh(measure.map).length, mean: mean(fresh(measure.map)) },
    },
  };
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify({ ...summary, reads: measure }, null, 1) + '\n',
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser?.close();
  server.close();
}
