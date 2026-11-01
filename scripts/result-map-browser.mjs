// The result map (UX-4), in two parts.
//
// First, the index: in the twelve workspaces, Arabic and English, at 1440,
// 390 and 320 px, under the alignment strip one index lists the parts of the
// result, by a list of parts and words written here for each workspace and
// not read from the page, each link reaching the part it names, in the
// order the page draws them. From the keyboard a link takes the reader to
// its part and gives it the focus: the part begins below the index, the
// index holds under the top bar, and the part is marked as the one being
// read. On a phone the list folds behind one button, which opens it, and
// Escape closes it again. Nothing scrolls sideways. With motion allowed, a
// link still arrives at its part once the page has stopped moving.
//
// Then the empty sections: the evidence at the foot of a result draws the
// sections that hold something, each with the count the engine gave, and
// names the ones that hold nothing together, once, in words, with no count.
//
// For the seven workspaces whose results end in evidence sections, in Arabic
// and in English, the check runs the workspace's own synthetic example and
// keeps the worker reply the page drew its result from. From that reply
// alone, by a list of sections written here and not taken from the page, it
// works out which sections hold records and how many. Then it reads the
// page: each section that holds something is drawn once, in the list's
// order, its title ending in the engine's count; each that holds nothing is
// not drawn and is named, in the same order, on the one quiet line after the
// others; no title anywhere in the result ends in a count of none; the line
// is seen, at 1440 and 390 px, and the page does not scroll sideways. Then it
// takes one decision as a reader would, and the decision log leaves the line
// for a section of its own, by the reply to that decision.
//
// Synthetic examples only; this checks the screen against the engine, not
// the engine against the books.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { stageWatchdog } from './stage-watchdog.mjs';
import { DECISIONS } from './ux-census-support.mjs';
import { keepReplies } from './worker-replies.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = process.env.RESULT_MAP_DIST ?? path.join(root, 'dist');
const only = process.env.RESULT_MAP_ONLY?.split(',');

// Each workspace's evidence sections in the order it draws them, and what
// each lists in the engine reply. `counted`: the title carries the count.
const records = (r) => r.records.map((rows, i) => [`records.${i}`, rows]);
const SECTIONS = {
  bank: {
    action: 'bank-reconcile',
    counted: false,
    sections: (r) => [
      ['timingItems', r.timingItems],
      ['events', r.events],
      ['inventory', r.inventory],
    ],
  },
  'tb-financial': {
    action: 'tb-financial-reconcile',
    counted: true,
    sections: (r) => [
      ['inventory', r.inventory],
      ['missing', r.missing],
      ['evidence', r.evidence],
      ['events', r.events],
    ],
  },
  intercompany: {
    action: 'intercompany-reconcile',
    counted: true,
    sections: (r) => [
      ['relations', r.relations],
      ['timing', r.timing],
      ['missing', r.missing],
      ['issues', r.issues],
      ['inventory', r.inventory],
      ['events', r.events],
    ],
  },
  gateway: {
    action: 'gateway-reconcile',
    counted: true,
    sections: (r) => [
      ...records(r),
      ['memberIds', r.memberIds],
      ['missing', r.missing],
      ['issues', r.issues],
      ['inventory', r.inventory],
      ['events', r.events],
    ],
  },
  stock: {
    action: 'stock-reconcile',
    counted: true,
    sections: (r, s) => [
      ...records(r),
      ['memberIds', r.memberIds],
      ['missing', r.missing],
      ['issues', r.issues],
      ['cells', r.cells],
      ['inventory', r.inventory],
      ['events', r.events],
      ['sources', s.files],
    ],
  },
  assets: {
    action: 'asset-reconcile',
    counted: true,
    sections: (r, s) => [
      ...records(r).slice(0, 1),
      ...(r.componentEvidence
        ? [['componentEvidence', r.componentEvidence]]
        : []),
      ...records(r).slice(1),
      ['memberIds', r.memberIds],
      ['missing', r.missing],
      ['issues', r.issues],
      ['cells', r.cells],
      ['inventory', r.inventory],
      ['events', r.events],
      ['sources', s.files],
    ],
  },
  payroll: {
    action: 'payroll-reconcile',
    counted: true,
    sections: (r, s) => [
      ...records(r),
      ['memberIds', r.memberIds],
      ['missing', r.missing],
      ['issues', r.issues],
      ['cells', r.cells],
      ['inventory', r.inventory],
      ['events', r.events],
      ['sources', s.files],
    ],
  },
};

const words = {
  ar: {
    language: 'AR العربية',
    example: /مثال/u,
    one: /: لا شيء$/u,
    many: /^لا شيء في: /u,
  },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    one: /: none$/u,
    many: /^Nothing in: /u,
  },
};

const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MIZAN_CHROMIUM,
});
let activePage;
const watch = stageWatchdog({ page: () => activePage });
const errors = [];

// The engine's state and result in a worker reply.
const split = (value) =>
  value && typeof value === 'object' && 'result' in value
    ? { state: value.state, result: value.result }
    : { state: {}, result: value };

// What the evidence part of the result shows, read from the page.
const readSections = (panel) =>
  panel.evaluate((el) => {
    const text = (node) => node.textContent.replace(/\s+/gu, ' ').trim();
    const drawn = [...el.querySelectorAll('[data-evidence-section]')].map(
      (node) => ({
        key: node.dataset.evidenceSection,
        title: text(
          node.querySelector(':scope > summary, :scope > h2') ?? node,
        ),
        seen: node.checkVisibility(),
      }),
    );
    const lines = [...el.querySelectorAll('[data-empty-sections]')];
    const line = lines[0];
    const order = (a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    const last = [...el.querySelectorAll('[data-evidence-section]')].at(-1);
    return {
      drawn,
      lines: lines.length,
      line: line && {
        text: text(line),
        seen: line.checkVisibility(),
        inClosed: !!line.closest('details:not([open])'),
        afterDrawn: !last || !!order(last, line),
        wider: line.scrollWidth - line.clientWidth,
        names: [...line.querySelectorAll('[data-empty-section]')].map(
          (node) => ({ key: node.dataset.emptySection, name: text(node) }),
        ),
      },
      strayNames: [...el.querySelectorAll('[data-empty-section]')].filter(
        (node) => !node.closest('[data-empty-sections]'),
      ).length,
      zeroTitles: [
        ...el.querySelectorAll('summary, h2, h3, h4, h5, h6, legend'),
      ]
        .filter(
          (node) => node.checkVisibility() && /\(\s*0\s*\)$/u.test(text(node)),
        )
        .map(text),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

// The page against the reply: what must be drawn, what must be named.
function verify(stage, spec, reply, seen, language) {
  const { state, result } = split(reply);
  const expected = spec.sections(result, state).map(([key, list]) => {
    assert.ok(Array.isArray(list), `${stage}: the reply lists ${key}`);
    return { key, count: list.length };
  });
  const keys = expected.map((e) => e.key);
  for (const d of seen.drawn)
    assert.ok(keys.includes(d.key), `${stage}: ${d.key} is a known section`);
  const full = expected.filter((e) => e.count > 0);
  const empty = expected.filter((e) => e.count === 0);
  assert.deepEqual(
    seen.drawn.map((d) => d.key),
    full.map((e) => e.key),
    `${stage}: the sections drawn are those that hold something, in order`,
  );
  for (const [i, d] of seen.drawn.entries()) {
    assert.ok(d.seen, `${stage}: ${d.key} is seen`);
    if (spec.counted)
      assert.ok(
        d.title.endsWith(`(${full[i].count})`),
        `${stage}: ${d.key} is titled with the engine's count ${full[i].count}: "${d.title}"`,
      );
  }
  assert.equal(seen.strayNames, 0, `${stage}: no empty name off the line`);
  assert.deepEqual(
    seen.zeroTitles,
    [],
    `${stage}: no title in the result ends in a count of none`,
  );
  if (!empty.length) {
    assert.equal(seen.lines, 0, `${stage}: no line when nothing is empty`);
    return { drawn: full.length, named: 0 };
  }
  assert.equal(seen.lines, 1, `${stage}: one line names the empty sections`);
  const line = seen.line;
  assert.deepEqual(
    line.names.map((n) => n.key),
    empty.map((e) => e.key),
    `${stage}: the line names the sections that hold nothing, in order`,
  );
  for (const n of line.names)
    assert.ok(
      n.name && !/\d/u.test(n.name),
      `${stage}: ${n.key} is named in words: "${n.name}"`,
    );
  assert.match(
    line.text,
    empty.length === 1 ? words[language].one : words[language].many,
    `${stage}: the line says they hold nothing: "${line.text}"`,
  );
  assert.ok(line.seen && !line.inClosed, `${stage}: the line is seen`);
  assert.ok(line.afterDrawn, `${stage}: the line follows the drawn sections`);
  assert.ok(line.wider <= 1, `${stage}: the line fits its width`);
  return { drawn: full.length, named: empty.length };
}

// The page draws a reply within a few frames, and an example may send more
// than one: read again, against the latest reply, until what is drawn and
// named agrees with it or ten seconds pass. The assertions that follow are
// the same either way; this only waits for the page to settle.
async function settle(panel, spec, latest) {
  const end = Date.now() + 10000;
  for (;;) {
    const reply = await latest();
    const seen = await readSections(panel);
    const { state, result } = split(reply);
    const expected = spec.sections(result, state);
    const drawn = expected.filter(([, l]) => l?.length > 0).map(([k]) => k);
    const named = expected.filter(([, l]) => l?.length === 0).map(([k]) => k);
    const agrees =
      JSON.stringify(seen.drawn.map((d) => d.key)) === JSON.stringify(drawn) &&
      JSON.stringify((seen.line?.names ?? []).map((n) => n.key)) ===
        JSON.stringify(named);
    if (agrees || Date.now() > end) return { reply, seen };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function until(test, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`timed out: ${label}`);
}

// One decision as a reader takes it, by the census recipe's names.
async function decide(panel, recipe, language) {
  for (const [i, label] of recipe.fields[language].entries())
    await panel
      .getByLabel(label, { exact: true })
      .fill(
        i === recipe.fields[language].length - 1
          ? 'Result map check decision'
          : 'Result map reference',
      );
  let button = null;
  for (const name of recipe.press[language]) {
    const buttons = panel.getByRole('button', { name, exact: true });
    for (let i = 0; i < (await buttons.count()) && !button; i++)
      if (await buttons.nth(i).isEnabled()) button = buttons.nth(i);
    if (button) break;
  }
  assert.ok(button, `${language}: an open decision to make`);
  await button.click();
}

// The parts of each result and the words of the index, written here.
const PARTS = {
  supplier: ['summary', 'figures', 'cases'],
  ar: ['summary', 'explain', 'figures', 'cases', 'evidence'],
  bank: ['summary', 'explain', 'decision', 'cases', 'movements', 'evidence'],
  clearing: ['summary', 'explain', 'figures', 'groups', 'evidence'],
  allocation: [
    'summary',
    'explain',
    'figures',
    'decision',
    'allocations',
    'evidence',
  ],
  'gl-tb': ['summary', 'explain', 'figures', 'evidence'],
  intercompany: [
    'summary',
    'explain',
    'figures',
    'decision',
    'pairs',
    'evidence',
  ],
  stock: ['summary', 'explain', 'figures', 'links', 'decision', 'evidence'],
  gateway: ['summary', 'explain', 'figures', 'decision', 'evidence'],
  payroll: ['summary', 'explain', 'figures', 'decision', 'evidence'],
  assets: ['summary', 'explain', 'figures', 'decision', 'evidence'],
  'tb-financial': [
    'summary',
    'explain',
    'figures',
    'decision',
    'lines',
    'evidence',
  ],
};
const INDEX_WORDS = {
  ar: {
    name: 'أقسام النتيجة',
    summary: 'الخلاصة',
    explain: 'شرح الأدلة',
    figures: 'الأرقام',
    cases: 'الحالات',
    pairs: 'الأزواج',
    lines: 'البنود',
    links: 'الروابط',
    groups: 'المجموعات',
    movements: 'الحركات',
    allocations: 'التخصيصات',
    decision: 'القرار',
    evidence: 'الأدلة',
  },
  en: {
    name: 'Sections of the result',
    summary: 'Summary',
    explain: 'Explain',
    figures: 'Figures',
    cases: 'Cases',
    pairs: 'Pairs',
    lines: 'Lines',
    links: 'Links',
    groups: 'Groups',
    movements: 'Movements',
    allocations: 'Allocations',
    decision: 'Decision',
    evidence: 'Evidence',
  },
};
// What a workspace runs after its example, where the example alone does not
// run it.
const RUN = {
  supplier: async (panel, language) => {
    const run = panel.getByRole('button', {
      name: language === 'ar' ? /تحقق وقارن/u : /Check and compare/u,
    });
    await run.waitFor({ timeout: 60000 });
    await run.click();
  },
  clearing: async (panel) => {
    await panel
      .getByLabel(/راجعت معنى الأعمدة|I reviewed the column meanings/u)
      .check({ timeout: 30000 });
    await panel
      .getByRole('button', { name: /فحص المقاصة|Check clearing/u })
      .click();
  },
};

// The index as the page draws it, and where the focus and the parts are.
const readIndex = (panel) =>
  panel.evaluate((root) => {
    const text = (node) => node.textContent.replace(/\s+/gu, ' ').trim();
    const navs = [...root.querySelectorAll('[data-result-index]')];
    const nav = navs[0];
    if (!nav) return { navs: 0 };
    const box = nav.getBoundingClientRect();
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const toggle = nav.querySelector('button[aria-controls]');
    const list =
      toggle && document.getElementById(toggle.getAttribute('aria-controls'));
    const links = [...nav.querySelectorAll('a[data-result-link]')].map((a) => {
      const id = decodeURIComponent(a.getAttribute('href').replace(/^#/u, ''));
      const target = document.getElementById(id);
      return {
        part: a.dataset.resultLink,
        word: text(a),
        current: a.getAttribute('aria-current'),
        seen: a.checkVisibility(),
        top: Math.round(a.getBoundingClientRect().top),
        target: target
          ? {
              part: target.dataset.resultPart,
              inside: root.contains(target),
            }
          : null,
      };
    });
    const parts = [...root.querySelectorAll('[data-result-part]')].map(
      (el) => el.dataset.resultPart,
    );
    const active = document.activeElement;
    return {
      navs: navs.length,
      name: nav.getAttribute('aria-label'),
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      wider: nav.scrollWidth - nav.clientWidth,
      bar: bar ? bar.bottom : 0,
      toggle: toggle && {
        seen: toggle.checkVisibility(),
        expanded: toggle.getAttribute('aria-expanded'),
        listOk: list === nav.querySelector('ol'),
        height: toggle.getBoundingClientRect().height,
        focused: active === toggle,
      },
      links,
      parts,
      focus: active?.dataset?.resultPart ?? null,
      focusTop: active?.getBoundingClientRect().top ?? null,
      viewport: innerHeight,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

// The keyboard opens a part: the link is reached and pressed with Enter.
async function open(page, panel, part, narrow) {
  const nav = panel.locator('[data-result-index]');
  if (narrow) {
    const toggle = nav.locator('button[aria-controls]');
    await toggle.focus();
    await page.keyboard.press('Enter');
  }
  await nav.locator(`a[data-result-link="${part}"]`).focus();
  await page.keyboard.press('Enter');
}

// The page holds still: two readings of the scroll a few frames apart.
async function still(page) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const y = await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(scrollY))),
    );
    if (y === last) return;
    last = y;
    await page.waitForTimeout(50);
  }
}

function verifyIndex(at, seen, expected, language, width) {
  const w = INDEX_WORDS[language];
  assert.equal(seen.navs, 1, `${at}: one index`);
  assert.equal(seen.name, w.name, `${at}: the index is named`);
  assert.deepEqual(
    seen.links.map((l) => l.part),
    expected,
    `${at}: the index lists the parts of the result, in order`,
  );
  assert.deepEqual(
    seen.parts,
    expected,
    `${at}: each part the page draws is listed, in the order drawn`,
  );
  for (const l of seen.links) {
    assert.equal(l.word, w[l.part], `${at}: ${l.part} is named "${w[l.part]}"`);
    assert.ok(
      l.target && l.target.inside && l.target.part === l.part,
      `${at}: the ${l.part} link reaches its part`,
    );
  }
  assert.ok(seen.overflow <= 0, `${at}: no sideways scroll`);
  assert.ok(seen.wider <= 1, `${at}: the index fits its width`);
  if (width < 640) {
    assert.ok(seen.toggle?.seen, `${at}: on a phone one button opens the list`);
    assert.ok(seen.toggle.listOk, `${at}: the button controls the list`);
    assert.ok(seen.toggle.height <= 48, `${at}: the folded index is one line`);
  } else {
    assert.ok(!seen.toggle?.seen, `${at}: the list shows without a button`);
    assert.equal(
      new Set(seen.links.map((l) => l.top)).size,
      1,
      `${at}: the list is one line`,
    );
  }
}

// After a link: the part has the focus, begins below the index and in the
// upper half of the screen, the index holds under the top bar, and the link
// is marked as the part being read.
function verifyArrival(at, seen, part, width) {
  assert.equal(seen.focus, part, `${at}: the focus is on the ${part} part`);
  if (part !== 'summary') {
    assert.ok(
      Math.abs(seen.top - seen.bar) <= 1,
      `${at}: the index holds under the top bar (${seen.top} / ${seen.bar})`,
    );
    assert.ok(
      seen.focusTop >= seen.bottom - 1,
      `${at}: the ${part} part begins below the index (${seen.focusTop} / ${seen.bottom})`,
    );
  }
  assert.ok(
    seen.focusTop >= 0 && seen.focusTop <= seen.viewport / 2,
    `${at}: the ${part} part is in view (${seen.focusTop})`,
  );
  const current = seen.links.filter((l) => l.current === 'location');
  assert.deepEqual(
    current.map((l) => l.part),
    [part],
    `${at}: the ${part} part is marked as the one being read`,
  );
  if (width < 640)
    assert.equal(seen.toggle.expanded, 'false', `${at}: the list folds again`);
}

let indexStates = 0,
  jumps = 0;
const indexed = new Set();
for (const domain of Object.keys(PARTS)) {
  if (only && !only.includes(domain)) continue;
  const expected = PARTS[domain];
  for (const language of ['ar', 'en']) {
    for (const motion of language === 'ar'
      ? ['reduce', 'no-preference']
      : ['reduce']) {
      const stage = `index/${domain}/${language}/${motion}`;
      watch.at(stage);
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: motion,
      });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        return url.startsWith(base + '/') ||
          url.startsWith('blob:') ||
          url.startsWith('data:')
          ? route.continue()
          : route.abort();
      });
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', (e) => errors.push(`${stage}: ${e.message}`));
      try {
        await page.goto(base + '/');
        await page
          .getByRole('button', { name: words[language].language, exact: true })
          .click();
        const panel = await openDomainWorkspace(page, domain, {
          advanced: true,
          requiredSources: false,
        });
        await panel
          .getByRole('button', { name: words[language].example })
          .first()
          .click();
        if (RUN[domain]) await RUN[domain](panel, language);
        // The strip heads every result; a result without its index then
        // fails by assertion, not by a wait.
        await panel
          .locator('[data-alignment-strip]')
          .waitFor({ timeout: 60000 });
        const until = Date.now() + 5000;
        while (
          !(await panel.locator('[data-result-index]').count()) &&
          Date.now() < until
        )
          await page.waitForTimeout(100);
        await page.waitForTimeout(300);
        const widths = motion === 'reduce' ? [1440, 390, 320] : [1440];
        for (const width of widths) {
          await page.setViewportSize({
            width,
            height: width < 640 ? 844 : 900,
          });
          await page.evaluate(() => scrollTo(0, 0));
          await still(page);
          const at = `${stage}/${width}`;
          verifyIndex(at, await readIndex(panel), expected, language, width);
          indexStates++;
          indexed.add(domain);
          // The last part, then the first: down the result and back.
          for (const part of [
            expected.at(-1),
            expected[0],
            expected[2] ?? expected[1],
          ]) {
            await open(page, panel, part, width < 640);
            // With reduced motion the move is done within two frames; with
            // motion allowed it may glide, and is read once it rests.
            const early = await page.evaluate(
              () =>
                new Promise((r) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => r(scrollY)),
                  ),
                ),
            );
            await still(page);
            if (motion === 'reduce')
              assert.ok(
                Math.abs(early - (await page.evaluate(() => scrollY))) <= 1,
                `${at}/${part}: with reduced motion the page moves at once`,
              );
            await page.waitForTimeout(100);
            verifyArrival(`${at}/${part}`, await readIndex(panel), part, width);
            jumps++;
          }
          if (width < 640) {
            const toggle = panel.locator(
              '[data-result-index] button[aria-controls]',
            );
            await toggle.focus();
            await page.keyboard.press('Enter');
            assert.equal(
              await toggle.getAttribute('aria-expanded'),
              'true',
              `${at}: the button opens the list`,
            );
            await panel.locator('[data-result-index] a').first().focus();
            await page.keyboard.press('Escape');
            const after = await readIndex(panel);
            assert.equal(
              after.toggle.expanded,
              'false',
              `${at}: Escape folds the list`,
            );
            assert.ok(
              after.toggle.focused,
              `${at}: the focus returns to the button`,
            );
            assert.ok(
              after.links.every((l) => !l.seen),
              `${at}: the folded list is not shown`,
            );
          }
        }
      } finally {
        await context.close();
      }
    }
  }
}

let states = 0,
  drawn = 0,
  named = 0;
for (const [domain, spec] of Object.entries(SECTIONS)) {
  if (only && !only.includes(domain)) continue;
  for (const language of ['ar', 'en']) {
    const stage = `${domain}/${language}`;
    watch.at(stage);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(keepReplies);
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(base + '/') ||
        url.startsWith('blob:') ||
        url.startsWith('data:')
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (e) => errors.push(`${stage}: ${e.message}`));
    try {
      await page.goto(base + '/');
      await page
        .getByRole('button', { name: words[language].language, exact: true })
        .click();
      const panel = await openDomainWorkspace(page, domain, {
        advanced: true,
        requiredSources: false,
      });
      await panel
        .getByRole('button', { name: words[language].example })
        .first()
        .click();
      await page.waitForFunction(
        (action) =>
          globalThis.alignmentReplies.some((r) => r.action === action),
        spec.action,
        { timeout: 60000 },
      );
      await panel.locator('[data-alignment-strip]').waitFor();
      const latest = () =>
        page.evaluate(
          (action) =>
            globalThis.alignmentReplies
              .filter((r) => r.action === action)
              .at(-1).value,
          spec.action,
        );
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const { reply, seen } = await settle(panel, spec, latest);
        const at = `${stage}/${width}`;
        const counts = verify(at, spec, reply, seen, language);
        assert.ok(seen.overflow <= 0, `${at}: no sideways scroll`);
        states++;
        drawn += counts.drawn;
        named += counts.named;
      }
      // A decision adds to the log: the log leaves the line for a section of
      // its own, as the reply to the decision says.
      watch.at(`${stage}/decision`);
      await page.setViewportSize({ width: 1440, height: 900 });
      const before = await page.evaluate(
        () => globalThis.alignmentReplies.length,
      );
      await decide(panel, DECISIONS[domain], language);
      await until(
        () =>
          page.evaluate(
            (n) =>
              globalThis.alignmentReplies
                .slice(n)
                .some((r) => Array.isArray(r.value?.result?.events)),
            before,
          ),
        `${stage}: the reply to the decision`,
      );
      const decisionReply = () =>
        page.evaluate(
          (n) =>
            globalThis.alignmentReplies
              .slice(n)
              .filter((r) => Array.isArray(r.value?.result?.events))
              .at(-1).value,
          before,
        );
      const decided = await settle(panel, spec, decisionReply);
      assert.ok(
        decided.reply.result.events.length > 0,
        `${stage}: the decision is in the reply's log`,
      );
      verify(`${stage}/decided`, spec, decided.reply, decided.seen, language);
      states++;
    } finally {
      await context.close();
    }
  }
}
watch.stop();
await browser.close();
server.close();
assert.deepEqual(errors, [], 'no page error');
assert.ok(states > 0, 'states were read');
console.log(
  `Result index: ${indexStates} states in ${indexed.size} workspaces, ${jumps} parts opened from the keyboard.`,
);
console.log(
  `Result map: ${states} states; ${drawn} sections drawn with the engine's count and ${named} named on the line of empty sections, then after a decision.`,
);
