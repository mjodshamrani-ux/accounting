// The decision platform (UX-3), as the reader meets it after the synthetic
// example of each workspace that has one, in Arabic and English at 390 px.
// No decision button is closed without a sentence that says why: with both
// fields empty the sentence names them, with one filled it names the other,
// and with both it gives the state; every decision button is described by
// that sentence, which is shown; approval stays closed whenever the sentence
// says what it waits for. The other closed buttons of the workspace, the
// evidence assistant's question and a review section's check, say what
// opens them. After a decision the focus is on what the decision changed,
// the state line or the item's heading, in view, and not on the page; and
// undo brings the state back. Synthetic examples only; no financial truth is
// asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
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
// What the page says about the decision buttons of the platform: the
// sentence, and for each button whether it is open and what describes it.
const read = (panel) =>
  panel.evaluate((root) => {
    const platform = root.querySelector('[data-decision-platform]');
    const hint = platform?.querySelector('[data-decision-hint]');
    const shown = (el) => {
      const box = el?.getBoundingClientRect();
      return !!box && box.width > 0 && box.height > 0;
    };
    return {
      platform: !!platform,
      hint: hint && {
        id: hint.id,
        key: hint.getAttribute('data-decision-hint'),
        accept: hint.getAttribute('data-decision-accept'),
        text: hint.textContent.trim(),
        shown: shown(hint),
      },
      fields: [...(platform?.querySelectorAll('input') ?? [])].map((i) =>
        (i.getAttribute('aria-describedby') ?? '').split(/\s+/u),
      ),
      buttons: [...root.querySelectorAll('[data-decision-action]')].map(
        (b) => ({
          type: b.getAttribute('data-decision-action'),
          open: !b.disabled,
          described: (b.getAttribute('aria-describedby') ?? '')
            .split(/\s+/u)
            .filter(Boolean)
            .map((id) => document.getElementById(id))
            .filter((el) => el && shown(el) && el.textContent.trim())
            .map((el) => el.id),
        }),
      ),
    };
  });
let checked = 0,
  decided = 0;
try {
  for (const language of ['ar', 'en']) {
    for (const [domain, recipe] of Object.entries(DECISIONS)) {
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
      const panel = await openDomainWorkspace(page, domain, {
        advanced: true,
        requiredSources: false,
      });
      await panel
        .getByRole('button', { name: words[language].example })
        .first()
        .click();
      // The example's result, then its platform: a build without one fails
      // here by assertion, not by a wait.
      await page.waitForFunction(
        (d) =>
          !!document
            .querySelector(`[data-domain-panel="${d}"]`)
            ?.querySelector('table'),
        domain,
        { timeout: 60000 },
      );
      await until(
        async () =>
          (await panel.locator('[data-decision-platform]').count()) > 0 ||
          (await panel.locator('h2').count()) > 0,
        `${domain}/${language}: the result`,
      );
      assert.ok(
        await panel.locator('[data-decision-platform]').count(),
        `${domain}/${language}: the decision platform is shown`,
      );
      const at = `${domain}/${language}`;
      const [referenceLabel, reasonLabel] = recipe.fields[language];
      const reference = panel.getByLabel(referenceLabel, { exact: true });
      const reason = panel.getByLabel(reasonLabel, { exact: true });
      // Both fields empty: every decision is closed, and the sentence that
      // describes each one names both fields.
      let now = await read(panel);
      assert.ok(now.hint?.shown, `${at}: the sentence is shown`);
      assert.equal(now.hint.key, 'both', `${at}: both fields named`);
      assert.ok(
        now.hint.text.includes(referenceLabel) &&
          now.hint.text.includes(reasonLabel),
        `${at}: the sentence names «${referenceLabel}» and «${reasonLabel}» (${now.hint.text})`,
      );
      assert.ok(now.buttons.length >= 3, `${at}: decision buttons`);
      for (const b of now.buttons) {
        assert.equal(b.open, false, `${at}: ${b.type} closed while empty`);
        assert.ok(
          b.described.includes(now.hint.id),
          `${at}: ${b.type} is described by the shown sentence`,
        );
      }
      assert.deepEqual(
        now.fields.map((ids) => ids.includes(now.hint.id)),
        [true, true],
        `${at}: both fields are described by the sentence`,
      );
      // One field: the sentence names the other.
      await reference.fill('REF-UX3');
      now = await read(panel);
      assert.equal(now.hint.key, 'reason', `${at}: the reason still wanted`);
      assert.ok(now.hint.text.includes(reasonLabel), `${at}: names the reason`);
      assert.ok(
        now.buttons.every((b) => !b.open),
        `${at}: still closed with one field`,
      );
      await reference.fill('');
      await reason.fill('Checked against the synthetic sources');
      now = await read(panel);
      assert.equal(now.hint.key, 'reference', `${at}: the reference wanted`);
      await reference.fill('REF-UX3');
      now = await read(panel);
      // Both fields: the sentence gives the state, and approval says what
      // it waits for whenever it is closed while reject is open.
      assert.ok(
        ['pending', 'decided', 'each', 'eachBlocked'].includes(now.hint.key),
        `${at}: the state (${now.hint.key})`,
      );
      const open = (type) =>
        now.buttons.filter((b) => b.type === type && b.open);
      if (open('reject').length && !open('accept').length)
        assert.ok(
          now.hint.accept,
          `${at}: approval closed while reject is open says why (${now.hint.text})`,
        );
      if (now.hint.accept)
        assert.equal(
          open('accept').length,
          0,
          `${at}: approval stays closed while it waits (${now.hint.accept})`,
        );
      // The workspace's other closed buttons say what opens them.
      const closed = await panel.evaluate((root) => {
        const shown = (el) => {
          const box = el?.getBoundingClientRect();
          return !!box && box.width > 0 && box.height > 0;
        };
        return [...root.querySelectorAll('button')]
          .filter((b) => b.disabled && shown(b))
          .filter((b) => !b.hasAttribute('data-decision-action'))
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
      // A decision: the first open reject, then its undo.
      const rejects = panel.locator('[data-decision-action="reject"]');
      let index = -1;
      for (let i = 0; i < (await rejects.count()) && index < 0; i++)
        if (await rejects.nth(i).isEnabled()) index = i;
      assert.ok(index >= 0, `${at}: a decision to make`);
      const target = await rejects
        .nth(index)
        .evaluate(
          (b) =>
            b
              .closest('[data-decision-platform]')
              ?.querySelector('[data-decision-state]')?.id ??
            b.getAttribute('aria-describedby').split(/\s+/u)[1],
        );
      assert.ok(target, `${at}: the decision has a state to return to`);
      const before = await page.evaluate(
        (id) => document.getElementById(id).textContent.trim(),
        target,
      );
      for (const type of ['reject', 'undo']) {
        const button = panel
          .locator(`[data-decision-action="${type}"]`)
          .nth(index);
        await until(() => button.isEnabled(), `${at}: ${type} open`);
        await button.click();
        await until(
          async () =>
            (await reference.isEnabled()) && !(await button.isEnabled()),
          `${at}: ${type} applied`,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => setTimeout(resolve, 150)),
              ),
            ),
        );
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          const box = active.getBoundingClientRect();
          return {
            id: active.id,
            text: active.textContent.trim(),
            inView: box.bottom > 0 && box.top < innerHeight,
          };
        });
        assert.equal(
          focus.id,
          target,
          `${at}: after ${type} the focus is on what it changed`,
        );
        assert.ok(focus.inView, `${at}: after ${type} it is in view`);
        if (type === 'reject')
          assert.notEqual(focus.text, before, `${at}: the state changed`);
        else assert.equal(focus.text, before, `${at}: undo restored it`);
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
        await until(
          async () =>
            (await panel.locator('[data-decision-platform]').count()) > 0 &&
            (await reference.isEnabled()),
          `${at}: checked again`,
        );
        await reference.fill('REF-UX3');
        await reason.fill('Checked against the synthetic sources');
        now = await read(panel);
        assert.equal(
          now.hint.accept,
          'unconfirmed',
          `${at}: approval waits for the attestation (${now.hint.text})`,
        );
        assert.ok(open('reject').length, `${at}: reject open while it waits`);
        assert.equal(
          open('accept').length,
          0,
          `${at}: approval closed while it waits`,
        );
      }
      checked++;
      await context.close();
    }
  }
  assert.equal(checked, Object.keys(DECISIONS).length * 2, 'every platform');
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `Decision platform: PASS, ${checked} platforms in Arabic and English at 390 px, ${decided} decisions with the focus on what they changed`,
);
