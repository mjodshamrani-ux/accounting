// FA-1c browser acceptance: every sealed FA-1 story (or, with
// FA_SECTIONS_SUITE, every story of another sealed suite with the same
// layout) through the built application, in the fixed assets workspace's
// sections section, with its three native file inputs, the scope typed into
// the page and the real worker. Compared with the sealed EXPECTED.json as the
// page shows it: the refusal, or the counts, the register inventory, the run
// codes, every account (component, register, GL, difference, GL row, members,
// status and codes in words), every category and component the map does not
// place, every row that cannot be placed, every section and every asset (its
// four amounts, rows, valuation reference, status and codes). A dense story's
// tables are read on their first and last pages; its counts are read whole.
// A story whose reading names another family cannot be given through the
// page, which reads every file as this family's role: it is listed apart,
// and the page is checked to wait for every file's reading confirmation.
// Also, on the foundation: every story again in Arabic, a phone width in
// both languages, the keyboard, a stale
// review cleared by a new file or a scope change, and no request off the
// page.
//
//   pnpm build && node scripts/fixed-assets-sections-browser.mjs [--out=dir] [--assert=browser-run-1.json]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';

const root = path.resolve(process.env.FA_SECTIONS_DIST ?? 'dist');
const SUITE = process.env.FA_SECTIONS_SUITE;
const foundation = path.resolve('audit/fixed-assets-sections-foundation');
const suiteDir = path.resolve(SUITE ?? foundation);
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out =
  arg('out') ??
  process.env.FA_SECTIONS_BROWSER_DIR ??
  'work/fixed-assets-sections/browser';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
// For the interface mutation gate: stop at the first story that differs,
// by the same assertion.
const FAIL_FAST = process.env.FA_SECTIONS_FAIL_FAST === '1';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PAGE = 50;
const FAMILY = 'fixed-assets-sections-1';
const ROLES = ['register-sections', 'category-map', 'gl-balances'];
// The words the page must show, written here and not imported from it.
const WORDS = {
  en: {
    list: ', ',
    status: {
      read: 'Read',
      held: 'Held',
      excluded: 'Excluded',
      consistent: 'Consistent',
      difference: 'Difference',
      missing: 'Missing',
    },
    components: {
      cost: 'Cost',
      depreciation: 'Depreciation',
      impairment: 'Impairment',
      carrying: 'Carrying amount',
    },
    roles: ['Register by section', 'Category account map', 'GL balances'],
    codes: {
      STRAY_ROW: 'A row outside every section',
      SECTION_UNREADABLE: 'A section whose category cannot be read',
      MAP_UNREADABLE: 'A map row whose category or component cannot be read',
      GL_UNREADABLE: 'A GL row whose account or dimensions cannot be read',
      SECTION_UNCLOSED: 'The section does not end at its own End section row',
      SECTION_HEADER: 'A label is unknown, missing, repeated or not readable',
      SECTION_SCOPE: 'Another entity, asset ledger, currency or as-of date',
      SECTION_COLUMNS: 'The column row is not the five columns',
      SECTION_DUPLICATE: 'Another section has the same ID',
      ROW_UNPLACED: 'A row whose asset ID or dimensions cannot be read',
      TOTAL_FIELD: 'A section total that cannot be read or checked',
      TOTAL_MISMATCH: 'A section total that is not the sum of its rows',
      CELLS: 'A value past the columns',
      COMPONENT: 'A component that is not one of the four',
      AMOUNT: 'An amount that is blank or not a plain number in the currency',
      TEXT: 'A valuation reference that cannot be read',
      COMPONENT_MISSING: 'A component has no row, and none is derived',
      COMPONENT_REPEATED: 'A component has more than one row',
      VALUATION: 'More than one valuation reference',
      CARRYING:
        'Cost less depreciation less impairment is not the carrying amount',
      ID_SECTIONS: 'The asset ID is in another section too',
      MAP_ABSENT: 'No map row for this category and component',
      MAP_EXPIRED: 'No map row valid at the as-of date',
      MAP_REPEATED: 'More than one map row valid at the as-of date',
      MAP_ROW: 'A map row that cannot be read',
      MAP_CLASS: 'A map row of another account class',
      GL_ROW: 'A GL row that cannot be read',
      GL_SCOPE: 'A GL row of another entity, ledger, currency or date',
      GL_REPEATED: 'More than one GL row',
      CLASS_CONFLICT: 'The GL calls the account another class',
      ACCOUNT_COMPONENTS: 'The map places two components on the account',
      UNMAPPED: 'No map row places a category on the account',
      GL_ABSENT: 'The account has no GL row',
      REGISTER_ABSENT: 'No asset of the register reaches the account',
    },
    summary: (n, c, d, m, h, s, a) =>
      `${n} accounts: ${c} consistent, ${d} with a difference, ${m} missing, ${h} held. ${s} sections, ${a} assets.`,
    check: 'Review the register',
    refused: 'Refused: nothing was reviewed',
    refusals: {
      READING: 'The readings are incomplete',
      SCOPE: 'The scope is incomplete, not confirmed or not readable',
      SOURCE: 'A file could not be read as a CSV snapshot',
      SOURCE_HASH: 'A file changed while it was read',
      CAPACITY: 'A file holds more than the reader admits',
      COLUMNS: 'The map or the GL has a missing, repeated or unknown header',
      TOTAL_LIMIT: 'A total is too large to be held exactly',
    },
  },
  ar: {
    list: '، ',
    status: {
      read: 'مقروء',
      held: 'محجوز',
      excluded: 'مستبعد',
      consistent: 'متسق',
      difference: 'فرق',
      missing: 'ناقص',
    },
    components: {
      cost: 'التكلفة',
      depreciation: 'الاستهلاك',
      impairment: 'الانخفاض',
      carrying: 'القيمة الدفترية',
    },
    roles: ['السجل بالأقسام', 'خريطة حسابات الفئات', 'أرصدة GL'],
    codes: {
      STRAY_ROW: 'صف خارج كل الأقسام',
      SECTION_UNREADABLE: 'قسم لا تُقرأ فئته',
      MAP_UNREADABLE: 'صف خريطة لا تُقرأ فئته أو مكونه',
      GL_UNREADABLE: 'صف GL لا يُقرأ حسابه أو أبعاده',
      SECTION_UNCLOSED: 'القسم لا ينتهي بصف End section الذي يحمل رقمه',
      SECTION_HEADER: 'تسمية غير معروفة أو غائبة أو مكررة أو لا تُقرأ',
      SECTION_SCOPE: 'منشأة أو دفتر أصول أو عملة أو تاريخ «كما في» آخر',
      SECTION_COLUMNS: 'صف الأعمدة ليس الأعمدة الخمسة',
      SECTION_DUPLICATE: 'قسم آخر يحمل الرقم نفسه',
      ROW_UNPLACED: 'صف لا يُقرأ رقم أصله أو أبعاده',
      TOTAL_FIELD: 'مجموع قسم لا يُقرأ أو لا يمكن فحصه',
      TOTAL_MISMATCH: 'مجموع قسم ليس مجموع صفوفه',
      CELLS: 'قيمة بعد الأعمدة',
      COMPONENT: 'مكون ليس من الأربعة',
      AMOUNT: 'مبلغ فارغ أو ليس رقمًا صريحًا بمنازل العملة',
      TEXT: 'مرجع تقييم لا يُقرأ',
      COMPONENT_MISSING: 'مكون بلا صف، ولا يُشتق',
      COMPONENT_REPEATED: 'مكون بأكثر من صف',
      VALUATION: 'أكثر من مرجع تقييم',
      CARRYING: 'التكلفة ناقص الاستهلاك ناقص الانخفاض ليست القيمة الدفترية',
      ID_SECTIONS: 'رقم الأصل في قسم آخر أيضًا',
      MAP_ABSENT: 'لا صف خريطة لهذه الفئة وهذا المكون',
      MAP_EXPIRED: 'لا صف خريطة صالح في تاريخ «كما في»',
      MAP_REPEATED: 'أكثر من صف خريطة صالح في تاريخ «كما في»',
      MAP_ROW: 'صف خريطة لا يُقرأ',
      MAP_CLASS: 'صف خريطة بفئة حساب أخرى',
      GL_ROW: 'صف GL لا يُقرأ',
      GL_SCOPE: 'صف GL لمنشأة أو دفتر أو عملة أو تاريخ آخر',
      GL_REPEATED: 'أكثر من صف GL',
      CLASS_CONFLICT: 'يسمي GL الحساب بفئة أخرى',
      ACCOUNT_COMPONENTS: 'تضع الخريطة مكونين على الحساب',
      UNMAPPED: 'لا يضع صف خريطة فئة على الحساب',
      GL_ABSENT: 'لا صف GL للحساب',
      REGISTER_ABSENT: 'لا يصل الحساب أصل من السجل',
    },
    summary: (n, c, d, m, h, s, a) =>
      `${n} حسابًا: ${c} متسقة، و${d} بفرق، و${m} ناقصة، و${h} محجوزة. ${s} قسمًا، و${a} أصلًا.`,
    check: 'راجع السجل',
    refused: 'مرفوض: لم يُراجع شيء',
    refusals: {
      READING: 'القراءات ناقصة',
      SCOPE: 'النطاق ناقص أو غير مؤكد أو لا يُقرأ',
      SOURCE: 'تعذرت قراءة ملف لقطة CSV',
      SOURCE_HASH: 'تغير ملف أثناء قراءته',
      CAPACITY: 'في ملف أكثر مما يقبله القارئ',
      COLUMNS: 'في الخريطة أو GL عنوان غائب أو مكرر أو غير معروف',
      TOTAL_LIMIT: 'مجموع أكبر من أن يُحمل بدقة',
    },
  },
};
// The page writes an amount at the scope's decimals with grouped thousands
// and the minus first; written here on its own, not taken from the
// application.
const minor = (v, decimals) => {
  const digits = String(Math.abs(v)).padStart(decimals + 1, '0');
  const whole = (decimals ? digits.slice(0, -decimals) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    ',',
  );
  const text = decimals ? `${whole}.${digits.slice(-decimals)}` : whole;
  return v < 0 ? `-${text}` : text;
};

async function suiteCases(folder, oracle, dense) {
  const list = [];
  for (const id of Object.keys(oracle).sort(byText)) {
    const given = await json(path.join(folder, `${id}-input.json`));
    list.push({
      id,
      files: given.names.map((n) => path.join(folder, n)),
      readings: given.readings,
      scope: given.scope,
      oracle: oracle[id],
      dense,
    });
  }
  return list;
}
const frozen = path.join(suiteDir, 'frozen');
const cases = await suiteCases(
  frozen,
  (await json(path.join(frozen, 'EXPECTED.json'))).stories,
  false,
);
let denseDir = null;
if (!SUITE) {
  denseDir = mkdtempSync(path.join(tmpdir(), 'fa1-dense-'));
  execFileSync('python3', ['-B', path.join(foundation, 'dense.py'), denseDir], {
    stdio: 'ignore',
  });
  const raw = execFileSync(
    'python3',
    ['-B', path.join(foundation, 'oracle.py'), '--dense', denseDir],
    { maxBuffer: 1 << 30 },
  );
  const sealed = (await json(path.join(frozen, 'DENSE-MANIFEST.json')))
    .expectedSha256;
  if (createHash('sha256').update(raw).digest('hex') !== sealed)
    throw Error('the dense expectations differ from the seal');
  cases.push(
    ...(await suiteCases(denseDir, JSON.parse(raw.toString()).stories, true)),
  );
}
// The page reads every file as this family's role, in role order.
const expressible = (c) =>
  c.readings.every(
    (r, i) =>
      r.sheet === 0 &&
      r.role === ROLES[i] &&
      r.family === FAMILY &&
      r.confirmed === true,
  ) && c.readings.length === ROLES.length;

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
  const panel = await openDomainWorkspace(page, 'assets');
  const details = panel.locator('details[data-fas-details]');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  return details.locator('[data-fas]');
}
const idle = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-fas]')?.getAttribute('aria-busy') ===
      'false',
    null,
    { timeout: 600000 },
  );
async function pick(page, fas, c, confirm = ROLES.map(() => true)) {
  for (const [side, role] of ROLES.entries()) {
    await fas
      .locator(`input[data-fas-file="${role}"]`)
      .setInputFiles(c.files[side]);
    await idle(page);
    if (confirm[side])
      await fas.locator(`[data-fas-confirm="${role}"]`).check();
  }
  for (const [k, v] of Object.entries(c.scope))
    if (k !== 'confirmed') await fas.locator(`[data-fas-scope="${k}"]`).fill(v);
  if (c.scope.confirmed) await fas.locator('[data-fas-scope-confirm]').check();
}
async function load(page, fas, c, lang = 'en') {
  await pick(page, fas, c);
  await fas.getByRole('button', { name: WORDS[lang].check }).click();
  await fas
    .locator('[data-fas-result], [data-fas-refused], [data-fas-error]')
    .first()
    .waitFor({ timeout: 600000 });
  await idle(page);
}
// Every row of one paged table, page after page; a dense story only on its
// first and last pages.
async function rows(fas, pager, selector, dense) {
  const found = [];
  const bar = fas.locator(`[data-fas-pager="${pager}"]`);
  // The shared pager names the page, then the number of pages (UX-3).
  const pages = (await bar.count())
    ? Number(
        /(\d+)\D+(\d+)/u.exec(await bar.locator('output').textContent())[2],
      )
    : 1;
  for (let page = 0; page < pages; page++) {
    if (!dense || page === 0 || page === pages - 1)
      for (const row of await fas.locator(selector).all())
        found.push(await row.locator('td').allTextContents());
    if (page + 1 < pages) await bar.locator('button').last().click();
  }
  return { found, pages };
}
async function shown(fas, dense) {
  const state = await fas.getAttribute('data-fas-state');
  const refusal = fas.locator('[data-fas-refused]');
  if (await refusal.count())
    return {
      state,
      refused: await refusal.getAttribute('data-fas-refused'),
      heading: await refusal.locator('h3').textContent(),
      result: await fas.locator('[data-fas-result]').count(),
    };
  if (!(await fas.locator('[data-fas-result]').count()))
    return { state, error: await fas.locator('[data-fas-error]').count() };
  const run = fas.locator('[data-fas-run]');
  const summary = fas.locator('[data-fas-summary]');
  return {
    state,
    summary: JSON.parse(await summary.getAttribute('data-fas-summary')),
    summaryText: await summary.textContent(),
    inventory: JSON.parse(
      await fas
        .locator('[data-fas-inventory]')
        .getAttribute('data-fas-inventory'),
    ),
    run: (await run.count())
      ? (await run.getAttribute('data-fas-run')).split(' ')
      : [],
    runText: (await run.count())
      ? await run.locator('li').allTextContents()
      : [],
    accounts: await rows(fas, 'accounts', 'tr[data-fas-account]', dense),
    unmapped: await rows(fas, 'unmapped', 'tr[data-fas-unmapped]', dense),
    unplaced: await rows(fas, 'unplaced', 'tr[data-fas-unplaced]', dense),
    sections: await rows(fas, 'sections', 'tr[data-fas-section]', dense),
    assets: await rows(fas, 'assets', 'tr[data-fas-asset]', dense),
  };
}
const shownPages = (list, pages, dense) =>
  dense && pages > 1
    ? [...list.slice(0, PAGE), ...list.slice((pages - 1) * PAGE)]
    : list;
function judge(c, seen, lang = 'en') {
  const o = c.oracle,
    w = WORDS[lang],
    d = o.decimals,
    differ = [];
  const none = '—';
  const amount = (v) => (v === null ? none : minor(v, d));
  const coded = (codes) =>
    codes.length ? codes.map((k) => `${w.codes[k]} (${k})`).join('; ') : none;
  if (o.refused) {
    if (
      seen.state !== 'refused' ||
      seen.refused !== o.refused ||
      seen.result !== 0 ||
      seen.heading?.replace(/\s+/g, ' ').trim() !==
        `${w.refused}: ${w.refusals[o.refused]} (${o.refused})`
    )
      differ.push('refusal');
    return differ;
  }
  if (seen.state !== 'shown' || !seen.accounts) return ['state'];
  const n = (s) => o.accounts.filter((a) => a.status === s).length;
  if (
    !isDeepStrictEqual(seen.summary, [
      o.accounts.length,
      o.sections.length,
      o.assets.length,
    ]) ||
    seen.summaryText !==
      w.summary(
        o.accounts.length,
        n('consistent'),
        n('difference'),
        n('missing'),
        n('held'),
        o.sections.length,
        o.assets.length,
      )
  )
    differ.push('summary');
  if (!isDeepStrictEqual(seen.inventory, o.inventory.register))
    differ.push('inventory');
  if (
    !isDeepStrictEqual(seen.run, o.run) ||
    !isDeepStrictEqual(
      seen.runText,
      o.run.map((k) => `${w.codes[k]} (${k})`),
    )
  )
    differ.push('run');
  const table = (name, want) => {
    const list = shownPages(want, seen[name].pages, c.dense);
    if (!isDeepStrictEqual(seen[name].found, list)) {
      const at = list.findIndex(
        (r, i) => !isDeepStrictEqual(r, seen[name].found[i]),
      );
      differ.push(`${name} ${at < 0 ? 'rows' : at}`);
    }
  };
  table(
    'accounts',
    o.accounts.map((a) => [
      a.account,
      a.dimensions,
      a.component ? w.components[a.component] : none,
      amount(a.register),
      amount(a.gl),
      amount(a.difference),
      a.glRow === null ? none : String(a.glRow),
      String(a.members.length),
      w.status[a.status],
      coded(a.codes),
    ]),
  );
  table(
    'unmapped',
    o.unmapped.map(([cat, comp, code]) => [
      cat,
      w.components[comp],
      `${w.codes[code]} (${code})`,
    ]),
  );
  table(
    'unplaced',
    o.unplaced.map(([role, row, code]) => [
      w.roles[ROLES.indexOf(role)],
      String(row),
      `${w.codes[code]} (${code})`,
    ]),
  );
  table(
    'sections',
    o.sections.map((s) => [
      String(s[0]),
      s[1] === null ? none : String(s[1]),
      s[2] ?? none,
      s[3] ?? none,
      s[4] ?? none,
      w.status[s[5]],
      coded(s[6]),
    ]),
  );
  table(
    'assets',
    o.assets.map((a) => {
      const at = [
        ...a.rows.cost,
        ...a.rows.depreciation,
        ...a.rows.impairment,
        ...a.rows.carrying,
        ...a.unread,
      ];
      return [
        a.section,
        a.assetId,
        a.dimensions,
        amount(a.amounts.cost),
        amount(a.amounts.depreciation),
        amount(a.amounts.impairment),
        amount(a.amounts.carrying),
        at.length ? at.join(w.list) : none,
        a.valuation ?? none,
        w.status[a.status],
        coded(a.codes),
      ];
    }),
  );
  return differ;
}

let browser;
const errors = [],
  external = [];
// A sealed holdout's record has no Arabic pass, so it has no such key.
const report = SUITE
  ? { cases: {}, notExpressible: {}, checks: {} }
  : { cases: {}, arabic: {}, notExpressible: {}, checks: {} };
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(120000);
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
    const fas = await open(page, 'en');
    if (!expressible(c)) {
      // The page has no way to read a file as another family's role. What it
      // can hold: the review waits until every file's reading is confirmed.
      await pick(page, fas, c, [true, false, true]);
      const waits =
        (await fas
          .getByRole('button', { name: WORDS.en.check })
          .isDisabled()) &&
        (await fas.getAttribute('data-fas-state')) === 'idle';
      report.notExpressible[c.id] = {
        refused: c.oracle.refused,
        reviewWaitsForReading: waits,
      };
      if (FAIL_FAST) assert.ok(waits, `${c.id}: the button does not wait`);
      continue;
    }
    await load(page, fas, c);
    const seen = await shown(fas, c.dense);
    const differ = judge(c, seen);
    report.cases[c.id] = {
      equal: !differ.length,
      status: seen.state,
      differ,
    };
    if (FAIL_FAST)
      assert.ok(!differ.length, `${c.id} differs: ${differ.join(', ')}`);
  }
  if (!SUITE) {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    // Arabic, right to left: every story again, the same facts, the words
    // in Arabic.
    {
      let dir = null;
      for (const c of cases) {
        if (!expressible(c)) continue;
        const fas = await open(page, 'ar');
        dir ??= await page.evaluate(() => document.documentElement.dir);
        await load(page, fas, c, 'ar');
        const differ = judge(c, await shown(fas, c.dense), 'ar');
        report.arabic[c.id] = { equal: !differ.length, differ };
        if (FAIL_FAST)
          assert.ok(
            !differ.length,
            `${c.id} in Arabic differs: ${differ.join(', ')}`,
          );
      }
      report.checks.arabic = {
        dir,
        equal: Object.values(report.arabic).every((s) => s.equal),
      };
    }
    // A phone width: nothing wider than the page.
    {
      await page.setViewportSize({ width: 390, height: 844 });
      const fas = await open(page, 'en');
      await load(page, fas, byId.F41);
      const fits = () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        );
      report.checks.phone = await fits();
      const ar = await open(page, 'ar');
      await load(page, ar, byId.F41, 'ar');
      report.checks.phoneArabic = await fits();
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // A new file, or another scope value, clears the shown review.
    {
      const fas = await open(page, 'en');
      await load(page, fas, byId.F01);
      await fas
        .locator('input[data-fas-file="category-map"]')
        .setInputFiles(byId.F02.files[1]);
      await idle(page);
      const check = fas.getByRole('button', { name: WORDS.en.check });
      const fileCleared =
        (await fas.locator('[data-fas-result]').count()) === 0 &&
        !(await fas.locator('[data-fas-confirm="category-map"]').isChecked()) &&
        (await check.isDisabled());
      await load(page, fas, byId.F01);
      await fas.locator('[data-fas-scope="asOf"]').fill('2027-12-30');
      const scopeCleared =
        (await fas.locator('[data-fas-result]').count()) === 0 &&
        !(await fas.locator('[data-fas-scope-confirm]').isChecked()) &&
        (await check.isDisabled());
      report.checks.staleCleared = fileCleared && scopeCleared;
    }
    // The keyboard reaches the section's summary and opens it, and its three
    // inputs are the native file inputs.
    {
      await page.goto(url);
      await page
        .getByRole('button', { name: 'EN English', exact: true })
        .click();
      const panel = await openDomainWorkspace(page, 'assets');
      const details = panel.locator('details[data-fas-details]');
      if ((await details.getAttribute('open')) !== null)
        await details.locator(':scope > summary').click();
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      const inputs = panel.locator('[data-fas] input[type="file"]');
      report.checks.keyboard =
        (await details.getAttribute('open')) !== null &&
        (await inputs.count()) === 3 &&
        (await inputs.first().isVisible());
    }
  }
  report.errors = errors;
  report.external = external;
  const all = Object.values(report.cases);
  report.summary = {
    cases: `${all.filter((s) => s.equal).length}/${all.length}`,
    ...(SUITE
      ? {}
      : {
          arabic: `${Object.values(report.arabic).filter((s) => s.equal).length}/${Object.keys(report.arabic).length}`,
        }),
    notExpressible: Object.keys(report.notExpressible),
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([k, v]) => [
        k,
        typeof v === 'object' ? v.equal && v.dir === 'rtl' : v,
      ]),
    ),
  };
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 1) + '\n',
  );
  for (const [id, s] of Object.entries(report.cases))
    console.log(id, s.equal ? 'equal' : `DIFFERS ${s.differ.join(', ')}`);
  for (const [id, s] of Object.entries(report.arabic ?? {}))
    console.log(id, 'ar', s.equal ? 'equal' : `DIFFERS ${s.differ.join(', ')}`);
  for (const [id, s] of Object.entries(report.notExpressible))
    console.log(
      id,
      'not expressible in the page;',
      s.reviewWaitsForReading ? 'the review waits' : 'THE REVIEW DOES NOT WAIT',
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
      `${id} shows what EXPECTED says: ${s.differ.join(', ')}`,
    );
  for (const [id, s] of Object.entries(report.arabic ?? {}))
    assert.ok(s.equal, `${id} in Arabic: ${s.differ.join(', ')}`);
  for (const [id, s] of Object.entries(report.notExpressible))
    assert.ok(s.reviewWaitsForReading, `${id}: the review does not wait`);
  for (const [k, v] of Object.entries(report.summary.checks)) assert.ok(v, k);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  if (denseDir) rmSync(denseDir, { recursive: true, force: true });
}
