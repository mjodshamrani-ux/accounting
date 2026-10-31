// The decision platform (UX-3), as the reader meets it after the synthetic
// example of each workspace that has decisions, in Arabic and English at
// 390 px. No decision button is closed without a sentence that says why:
// while the fields are empty it names them (and, where one note opens the
// decisions, how long it must be), as they fill it names what is still
// missing, and then it gives the state; every decision button and every
// field is described by that sentence, which is shown; approval stays
// closed whenever the sentence says what it waits for. The other closed
// buttons of the workspace say what opens them. After a decision the focus
// is on what the decision changed (the state line, or the heading or row of
// the item decided on, on the page that shows it), in view, and not on the
// page; a second decision on the same item does the same. A long synthetic
// receivables list checks the page a decision on its second page leaves the
// reader on. Synthetic examples only; no financial truth is asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  openDomainWorkspace,
  openWorkspaceDisclosures,
} from './domain-navigation-support.mjs';
import { DECISIONS } from './ux-census-support.mjs';

const dist = path.resolve(
  process.env.DECISION_PLATFORM_DIST ??
    path.resolve(import.meta.dirname, '../dist'),
);
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
const external = [],
  errors = [];
const words = {
  ar: { language: 'AR العربية', example: /مثال/u },
  en: { language: 'EN English', example: /example|sample/iu },
};
// The example whose approval can be made to wait: withdrawing the payroll
// completeness attestation and checking again leaves reject open and closes
// approval, and the sentence says it waits for that attestation.
const WAIT = {
  payroll: {
    disclosure: {
      ar: 'تصريح الرواتب والصرف المقدمة',
      en: 'Supplied payroll and payout attestation',
    },
    attestation: {
      ar: /^راجعت كل موظف مقدم/u,
      en: /^I reviewed every supplied employee/u,
    },
    run: {
      ar: 'افحص مكونات الرواتب والأستاذ والبنك',
      en: 'Check payroll components / GL / bank',
    },
  },
};
// Waits until a condition holds, polling, or fails with what was awaited.
async function until(check, what, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function open(language) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.startsWith(base + '/') ||
      url.startsWith('blob:') ||
      url.startsWith('data:')
    )
      return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/');
  await page
    .getByRole('button', { name: words[language].language, exact: true })
    .click();
  return { context, page };
}
// What the page says about the decisions: the sentence that describes the
// recipe's first field, the fields, and for each decision button whether it
// is open, what describes it, and where the focus returns after it.
const read = (panel, labels) =>
  panel.evaluate((root, labels) => {
    const shown = (el) => {
      const box = el?.getBoundingClientRect();
      return !!box && box.width > 0 && box.height > 0;
    };
    const ids = (el) =>
      (el?.getAttribute('aria-describedby') ?? '')
        .split(/\s+/u)
        .filter(Boolean);
    const fields = labels.map((label) =>
      [...root.querySelectorAll('input, textarea')].find(
        (f) =>
          f.labels?.[0]?.textContent.trim().startsWith(label) ||
          f.getAttribute('aria-label') === label,
      ),
    );
    const hint = ids(fields[0])
      .map((id) => document.getElementById(id))
      .find((el) => el?.hasAttribute('data-decision-hint'));
    return {
      hint: hint && {
        id: hint.id,
        key: hint.getAttribute('data-decision-hint'),
        accept: hint.getAttribute('data-decision-accept'),
        wait: hint.getAttribute('data-decision-wait'),
        text: hint.textContent.trim(),
        shown: shown(hint),
      },
      fields: fields.map((f) => (f ? ids(f) : null)),
      buttons: [...root.querySelectorAll('[data-decision-action]')]
        .filter(shown)
        .map((b) => ({
          type: b.getAttribute('data-decision-action'),
          name: b.textContent.trim(),
          open: !b.disabled,
          target: b.getAttribute('data-decision-target'),
          described: ids(b)
            .map((id) => document.getElementById(id))
            .filter((el) => el && shown(el) && el.textContent.trim())
            .map((el) => el.id),
        })),
    };
  }, labels);
const pause = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 150)),
        ),
      ),
  );
// The text of the element a decision names as where the focus returns; a
// decision that names an element the page lacks fails here by assertion.
async function textOf(page, id, at) {
  const text = await page.evaluate(
    (id) => document.getElementById(id)?.textContent.trim() ?? null,
    id,
  );
  assert.notEqual(text, null, `${at}: the decision names an element (${id})`);
  return text;
}
// Every closed button the reader sees says what opens it: a sentence it is
// described by, shown and not empty.
async function closedSay(panel, at) {
  const closed = await panel.evaluate((root) => {
    const shown = (el) => {
      const box = el?.getBoundingClientRect();
      return !!box && box.width > 0 && box.height > 0;
    };
    return [...root.querySelectorAll('button')]
      .filter((b) => b.disabled && shown(b))
      .map((b) => ({
        name: b.textContent.trim(),
        said: (b.getAttribute('aria-describedby') ?? '')
          .split(/\s+/u)
          .map((id) => id && document.getElementById(id))
          .some((el) => el && shown(el) && el.textContent.trim()),
      }));
  });
  for (const b of closed)
    assert.ok(b.said, `${at}: the closed «${b.name}» says what opens it`);
  return closed.length;
}
// Where the focus is, and whether it is in view.
const focused = (page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    const box = active.getBoundingClientRect();
    return {
      id: active.id,
      tag: active.tagName,
      item:
        active.hasAttribute('data-decision-item') ||
        active.hasAttribute('data-decision-state'),
      text: active.textContent.trim(),
      inView: box.bottom > 0 && box.top < innerHeight,
    };
  });
// Presses a decision button and waits until the decision is applied: the
// workspace was busy and is no longer, and the first field is open again.
async function press(page, panel, button, field, at) {
  const busy = panel.locator('[aria-busy="true"]');
  await button.click();
  await until(async () => (await busy.count()) > 0, 'busy', 2000).catch(
    () => {},
  );
  await until(
    async () => !(await busy.count()) && (await field.isEnabled()),
    `${at}: the decision applied`,
  );
  await pause(page);
}
let checked = 0,
  decided = 0;
try {
  for (const language of ['ar', 'en']) {
    for (const [domain, recipe] of Object.entries(DECISIONS)) {
      const { context, page } = await open(language);
      const panel = await openDomainWorkspace(page, domain, {
        advanced: true,
        requiredSources: false,
      });
      await panel
        .getByRole('button', { name: words[language].example })
        .first()
        .click();
      await page.waitForFunction(
        (d) =>
          !!document
            .querySelector(`[data-domain-panel="${d}"]`)
            ?.querySelector('table'),
        domain,
        { timeout: 60000 },
      );
      const at = `${domain}/${language}`;
      if (recipe.run) {
        await panel
          .getByRole('button', { name: recipe.run[language], exact: true })
          .click();
        await until(
          async () => !(await panel.locator('[aria-busy="true"]').count()),
          `${at}: the run`,
          60000,
        );
      }
      const labels = recipe.fields[language];
      // The fields, then the sentence they are described by: a build
      // without one fails here by assertion, not by a wait. Each field is
      // held by its element, found once by its label: the label text
      // Playwright matches takes in what a field wrapped in its label holds,
      // though the name Chromium gives the field does not change.
      await until(
        async () =>
          (await panel.getByLabel(labels[0], { exact: true }).count()) > 0,
        `${at}: the decision fields`,
      );
      const fields = await Promise.all(
        labels.map((label) =>
          panel.getByLabel(label, { exact: true }).elementHandle(),
        ),
      );
      let now = await read(panel, labels);
      assert.ok(now.hint?.shown, `${at}: the sentence is shown`);
      // Fields empty: every decision described by the sentence is closed,
      // and the sentence names the fields.
      const mine = (state) =>
        state.buttons.filter((b) => b.described.includes(state.hint.id));
      assert.ok(mine(now).length >= 1, `${at}: decision buttons`);
      for (const b of mine(now))
        assert.equal(b.open, false, `${at}: ${b.name} closed while empty`);
      for (const b of now.buttons)
        assert.ok(
          b.described.length,
          `${at}: ${b.name} is described by a shown sentence`,
        );
      for (const label of labels)
        assert.ok(
          now.hint.text.includes(label),
          `${at}: the sentence names «${label}» (${now.hint.text})`,
        );
      assert.deepEqual(
        now.fields.map((ids) => !!ids?.includes(now.hint.id)),
        labels.map(() => true),
        `${at}: every field is described by the sentence`,
      );
      if (labels.length === 2) {
        assert.equal(now.hint.key, 'both', `${at}: both fields named`);
        // One field: the sentence names the other.
        await fields[0].fill('REF-UX3');
        now = await read(panel, labels);
        assert.equal(now.hint.key, 'reason', `${at}: the reason still wanted`);
        assert.ok(
          mine(now).every((b) => !b.open),
          `${at}: closed with one`,
        );
        await fields[0].fill('');
        await fields[1].fill('Checked against the synthetic sources');
        now = await read(panel, labels);
        assert.equal(now.hint.key, 'reference', `${at}: the reference wanted`);
        await fields[0].fill('REF-UX3');
      } else if (now.hint.key === 'note') {
        // One note of a minimum length: seven characters keep it closed.
        assert.match(now.hint.text, /8/u, `${at}: the length is named`);
        await fields[0].fill('Seven c');
        now = await read(panel, labels);
        assert.equal(now.hint.key, 'note', `${at}: seven are not enough`);
        assert.ok(
          mine(now).every((b) => !b.open),
          `${at}: closed at seven`,
        );
        await fields[0].fill('Checked against the synthetic sources');
      } else {
        assert.equal(now.hint.key, 'reason', `${at}: the reason named`);
        await fields[0].fill('Checked against the synthetic sources');
      }
      if (recipe.select) {
        // What an approval waits for is named until it is given: approving
        // advice waits for a selected line, then opens.
        now = await read(panel, labels);
        const advice = () =>
          now.buttons.find((b) => b.name === recipe.press[language][0]);
        assert.match(now.hint.wait ?? '', /advice/u, `${at}: advice waits`);
        assert.equal(advice()?.open, false, `${at}: advice closed`);
        await panel.locator(recipe.select).first().check();
        now = await read(panel, labels);
        assert.doesNotMatch(now.hint.wait ?? '', /advice/u, `${at}: selected`);
        assert.equal(advice()?.open, true, `${at}: advice open`);
      }
      now = await read(panel, labels);
      assert.ok(
        !['both', 'reference', 'reason', 'note'].includes(now.hint.key),
        `${at}: the state once the fields are written (${now.hint.key})`,
      );
      const opened = (type) =>
        mine(now).filter((b) => b.type === type && b.open);
      if (opened('reject').length && !opened('accept').length)
        assert.ok(
          now.hint.accept,
          `${at}: approval closed while reject is open says why (${now.hint.text})`,
        );
      if (now.hint.accept)
        assert.equal(
          opened('accept').length,
          0,
          `${at}: approval stays closed while it waits (${now.hint.accept})`,
        );
      // The workspace's other closed buttons say what opens them.
      await closedSay(panel, at);
      // A decision: the first open button of the recipe.
      let button = null;
      for (const name of recipe.press[language]) {
        const named = panel.getByRole('button', { name, exact: true });
        for (let i = 0; i < (await named.count()) && !button; i++)
          if (await named.nth(i).isEnabled()) button = named.nth(i);
        if (button) break;
      }
      assert.ok(button, `${at}: a decision to make`);
      // Where the focus returns: the item the button names, or the state
      // line of a decision on the whole result.
      const item = await button.getAttribute('data-decision-target');
      const target =
        item ??
        (await button.evaluate(
          (b) =>
            b
              .closest('[data-decision-platform]')
              ?.querySelector('[data-decision-state]')?.id ?? null,
        ));
      const before = target && (await textOf(page, target, at));
      await press(page, panel, button, fields[0], at);
      let focus = await focused(page);
      if (target) {
        assert.equal(focus.id, target, `${at}: the focus is on what changed`);
        assert.notEqual(focus.text, before, `${at}: its state changed`);
      } else
        assert.ok(focus.item, `${at}: the focus is on the decision recorded`);
      assert.ok(focus.inView, `${at}: and it is in view`);
      decided++;
      // A second decision on the same item, where it offers one: undo, or
      // the decision that follows a reopening; on a whole result, its undo;
      // on a decision recorded in a list, the undo it carries.
      const again = item
        ? panel.locator(
            `[data-decision-target="${item}"][data-decision-action]:not([disabled])`,
          )
        : target
          ? panel.locator(
              `[data-decision-platform]:has([id="${target}"]) [data-decision-action]:not([disabled])`,
            )
          : page.locator(
              `[id="${focus.id}"] [data-decision-action="undo"]:not([disabled])`,
            );
      if (await again.count()) {
        const type = await again.first().getAttribute('data-decision-action');
        const after = focus.text;
        await press(page, panel, again.first(), fields[0], at);
        focus = await focused(page);
        if (target) {
          assert.equal(focus.id, target, `${at}: ${type} returns to it`);
          if (type === 'undo')
            assert.equal(focus.text, before, `${at}: undo restored it`);
          else assert.notEqual(focus.text, after, `${at}: ${type} changed it`);
        } else assert.ok(focus.item, `${at}: ${type} is recorded in focus`);
        assert.ok(focus.inView, `${at}: after ${type} it is in view`);
        decided++;
      }
      if (domain === 'bank') {
        // The balance reconciliation under the movements: its decisions on
        // each item lifecycle stand on the same platform.
        const adjust = {
          ar: {
            example: 'افتح مثال تسوية أرصدة اصطناعيًا',
            fields: ['مرجع دليل قرار البند', 'سبب قرار البند'],
          },
          en: {
            example: 'Open a synthetic balance reconciliation example',
            fields: [
              'Adjustment decision evidence reference',
              'Adjustment decision reason',
            ],
          },
        }[language];
        const idle = () =>
          until(
            async () => !(await panel.locator('[aria-busy="true"]').count()),
            `${at}: the balance reconciliation`,
            60000,
          );
        const flow = panel.locator('details[data-bank-balance-flow]');
        if ((await flow.getAttribute('open')) === null)
          await flow.locator(':scope > summary').click();
        await openWorkspaceDisclosures(panel, { requiredSources: false });
        assert.ok(
          await closedSay(panel, `${at} balance`),
          `${at}: the balance reconciliation waits for its sources`,
        );
        await panel
          .getByRole('button', { name: adjust.example, exact: true })
          .click();
        const cycles = panel.locator('[data-testid="bank-balance-lifecycles"]');
        await until(
          async () => (await cycles.count()) > 0,
          `${at}: the item lifecycles`,
          60000,
        );
        await idle();
        const two = await Promise.all(
          adjust.fields.map((label) =>
            panel.getByLabel(label, { exact: true }).elementHandle(),
          ),
        );
        let state = await read(panel, adjust.fields);
        assert.ok(state.hint?.shown, `${at}: the balance sentence is shown`);
        assert.equal(state.hint.key, 'both', `${at}: the balance fields named`);
        const lifecycle = cycles.locator('[data-decision-action]');
        assert.ok(await lifecycle.count(), `${at}: lifecycle decisions`);
        for (const b of state.buttons.filter((b) =>
          b.described.includes(state.hint.id),
        ))
          assert.equal(b.open, false, `${at}: ${b.name} closed while empty`);
        await two[0].fill('REF-UX3');
        await two[1].fill('Checked against the synthetic balances');
        state = await read(panel, adjust.fields);
        assert.equal(state.hint.key, 'each', `${at}: the balance rule`);
        const first = cycles
          .locator('[data-decision-action]:not([disabled])')
          .first();
        assert.ok(await first.count(), `${at}: a lifecycle decision to make`);
        const cycle = await first.getAttribute('data-decision-target');
        const was = await textOf(page, cycle, at);
        await press(page, panel, first, two[0], `${at} balance`);
        focus = await focused(page);
        assert.equal(focus.id, cycle, `${at}: the focus is on the lifecycle`);
        assert.notEqual(focus.text, was, `${at}: the lifecycle changed`);
        assert.ok(focus.inView, `${at}: the lifecycle is in view`);
        const undo = cycles.locator(
          `[data-decision-target="${cycle}"][data-decision-action="undo"]:not([disabled])`,
        );
        assert.ok(await undo.count(), `${at}: the lifecycle can be undone`);
        await press(page, panel, undo, two[0], `${at} balance undo`);
        focus = await focused(page);
        assert.equal(focus.id, cycle, `${at}: undo returns to the lifecycle`);
        assert.equal(focus.text, was, `${at}: undo restored the lifecycle`);
        assert.ok(focus.inView, `${at}: after undo it is in view`);
        decided += 2;
      }
      if (domain === 'clearing') {
        // Clearing by hand opens only on a selection the engine accepts,
        // and the sentence says what the selection lacks: one member, then
        // members that do not net to zero, then an offsetting pair.
        const box = (posting) =>
          panel
            .locator('[data-testid="clearing-case"]', { hasText: posting })
            .locator('input[type="checkbox"]');
        const manual = panel.locator('[data-decision-action="clear"]');
        const state = async (what, wait, open) => {
          const now = await read(panel, labels);
          assert.equal(now.hint.wait, wait, `${at}: ${what}`);
          assert.equal(await manual.isEnabled(), open, `${at}: ${what}`);
        };
        await box('P006').check();
        await state('one member', 'select', false);
        await box('P008').check();
        await state('members that do not net to zero', 'net', false);
        await box('P008').uncheck();
        await box('P007').check();
        await state('an offsetting pair', 'ready', true);
        await press(page, panel, manual, fields[0], at);
        focus = await focused(page);
        assert.ok(focus.item, `${at}: the focus is on the group cleared`);
        assert.match(focus.text, /P006.*P007/su, `${at}: its members`);
        assert.ok(focus.inView, `${at}: and it is in view`);
        decided++;
      }
      const wait = WAIT[domain];
      if (wait) {
        await panel.evaluate((root, title) => {
          for (const summary of root.querySelectorAll('summary'))
            if (summary.textContent.trim() === title)
              summary.parentElement.open = true;
        }, wait.disclosure[language]);
        await panel
          .getByRole('checkbox', { name: wait.attestation[language] })
          .uncheck();
        await panel
          .getByRole('button', { name: wait.run[language], exact: true })
          .click();
        // The result is read again, so are its fields.
        await until(
          async () =>
            (await panel.locator('[data-decision-platform]').count()) > 0 &&
            (await panel.getByLabel(labels[0], { exact: true }).isEnabled()),
          `${at}: checked again`,
        );
        for (const [i, label] of labels.entries())
          await panel
            .getByLabel(label, { exact: true })
            .fill(i ? 'Checked against the synthetic sources' : 'REF-UX3');
        now = await read(panel, labels);
        assert.equal(
          now.hint.accept,
          'unconfirmed',
          `${at}: approval waits for the attestation (${now.hint.text})`,
        );
        assert.ok(opened('reject').length, `${at}: reject open while it waits`);
        assert.equal(
          opened('accept').length,
          0,
          `${at}: approval closed while it waits`,
        );
      }
      checked++;
      await context.close();
    }
  }
  assert.equal(checked, Object.keys(DECISIONS).length * 2, 'every platform');

  // A receivables list longer than a page: a decision on its second page
  // leaves the reader on that page, with the focus on the pair decided.
  const { context, page } = await open('en');
  const panel = await openDomainWorkspace(page, 'ar', {
    advanced: true,
    requiredSources: true,
  });
  const header =
    'Posting ID,Document type,Own document number,Posting date,Original signed amount,Entity,Ledger,Customer,Account,Currency,Related invoice,Description';
  const rows = (prefix) =>
    Array.from(
      { length: 60 },
      (_, i) =>
        `${prefix}${String(i + 1).padStart(3, '0')},invoice,I${String(i + 1).padStart(3, '0')},2026-09-15,${100 + i},Synthetic Seller,AR Book,C0001,1200,SAR,,Synthetic long list`,
    );
  const sides = ['Company AR ledger', 'Company-issued customer statement'];
  const columns = [
    'Unique posting ID',
    'Document type',
    'Own document number',
    'Posting date',
    'Original signed amount',
    'Entity',
    'Ledger',
    'Customer ID',
    'Account',
    'Currency',
    'Related invoice',
    'Description',
  ];
  for (const [side, label] of sides.entries()) {
    const name = `synthetic-long-${side ? 'statement' : 'ledger'}.csv`;
    await panel.getByLabel(label, { exact: true }).setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [header, ...rows(side ? 'S' : 'L')].join('\n') + '\n',
      ),
    });
    await panel
      .getByRole('heading', { name, exact: true })
      .waitFor({ timeout: 60000 });
    for (const [index, field] of columns.entries())
      await panel
        .getByLabel(`${label}: ${field}`, { exact: true })
        .selectOption(String(index));
    await panel
      .getByLabel(`${label}: I reviewed this source:`, { exact: false })
      .check();
  }
  for (const [key, value] of Object.entries({
    Entity: 'Synthetic Seller',
    Ledger: 'AR Book',
    'Customer ID': 'C0001',
    Account: '1200',
    Currency: 'SAR',
    'Period start': '2026-09-01',
    'Period end': '2026-09-30',
  }))
    await panel.getByLabel(key, { exact: true }).fill(value);
  await panel
    .getByLabel(
      'I reviewed the common entity, ledger, customer, account, currency and period.',
      { exact: false },
    )
    .check();
  await panel
    .getByRole('button', { name: 'Compare AR documents', exact: true })
    .click();
  await panel
    .getByRole('heading', {
      name: 'AR document comparison result',
      exact: true,
    })
    .waitFor({ timeout: 60000 });
  const note = await panel
    .getByLabel('Document review reason', { exact: true })
    .elementHandle();
  await note.fill('Reviewed on the second page of a long synthetic list');
  const pager = panel.getByRole('navigation', {
    name: 'Pages of AR document comparison result',
  });
  await pager.getByRole('button', { name: 'Next page', exact: true }).click();
  const status = () => pager.locator('output').textContent();
  assert.match(await status(), /^Page 2 of 2/u, 'long list: on page two');
  const reopen = panel
    .locator('[data-decision-action="reopen"]:not([disabled])')
    .first();
  assert.ok(await reopen.count(), 'long list: a pair to reopen on page two');
  const target = await reopen.getAttribute('data-decision-target');
  const before = await textOf(page, target, 'long list');
  for (const type of ['reopen', 'accept']) {
    const button = panel.locator(
      `[data-decision-target="${target}"][data-decision-action="${type}"]`,
    );
    await press(page, panel, button, note, `long list ${type}`);
    const focus = await focused(page);
    assert.match(
      await status(),
      /^Page 2 of 2/u,
      `long list: still on page two after ${type}`,
    );
    assert.equal(focus.id, target, `long list: ${type} returns to the pair`);
    assert.ok(focus.inView, `long list: after ${type} the pair is in view`);
    assert.notEqual(focus.text, before, `long list: ${type} changed the pair`);
    decided++;
  }
  await context.close();
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `Decision platform: PASS, ${checked} platforms in Arabic and English at 390 px and a long receivables list, ${decided} decisions with the focus on what they changed`,
);
