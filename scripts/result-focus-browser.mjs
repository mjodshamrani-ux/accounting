// UX-2 acceptance: the result is present. In every workspace, an example
// started from the keyboard leaves the focus on the heading of what it
// produced, in view below the top bar, and Tab continues into the result; the
// focus follows a second run, a restored session too, but not a decision.
// Arabic and English at 390 px with reduced motion, and once without it.
// Synthetic examples only; no financial truth is asserted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openDomainWorkspace } from './domain-navigation-support.mjs';
import { DOMAINS } from './ux-census-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const outRoot =
  process.env.RESULT_FOCUS_DIR ?? path.join(root, 'work/result-focus');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-'));

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
  ar: { language: 'AR العربية', example: /مثال/u, run: /تحقق وقارن/u },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    run: /Check and compare/u,
  },
};
// The heading each workspace's example leads to: the result, the source the
// clearing example loads, or the supplier's workflow heading.
const target = (domain) =>
  domain === 'supplier'
    ? '.workflow-title'
    : domain === 'clearing'
      ? '[data-result-heading="loaded"]'
      : '[data-result-heading="result"]';

async function open(language, reducedMotion = 'reduce') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion,
    acceptDownloads: true,
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
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 250)),
        ),
      ),
  );
// Starts a button from the keyboard, as a reader without a mouse would.
async function press(button) {
  await button.focus();
  await button.press('Enter');
}
// Where the focus is, read in the page: whether it is the expected heading of
// this workspace, in view below the top bar, and what it says.
function where([domain, selector]) {
  const panel = document.querySelector(`[data-domain-panel="${domain}"]`);
  const active = document.activeElement;
  const bar = document.querySelector('.topbar')?.getBoundingClientRect();
  const box = active?.getBoundingClientRect();
  const described = active?.getAttribute('aria-describedby');
  return {
    tag: active?.tagName ?? null,
    onTarget: !!(active && panel?.contains(active) && active.matches(selector)),
    inView: !!(
      box &&
      box.top >= (bar ? bar.bottom : 0) - 1 &&
      box.bottom <= innerHeight + 1
    ),
    text: (active?.textContent ?? '').trim().slice(0, 80),
    description: described
      ? (document.getElementById(described)?.textContent ?? '').trim()
      : null,
  };
}
// After Tab, the focus is inside the workspace and after the heading.
function next([domain, selector]) {
  const panel = document.querySelector(`[data-domain-panel="${domain}"]`);
  const heading = panel?.querySelector(selector);
  const active = document.activeElement;
  return !!(
    heading &&
    active &&
    active !== document.body &&
    panel.contains(active) &&
    heading.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}
// Waits for the focus to reach the heading, or for the time a run may take;
// the assertion that follows decides.
async function focusReached(page, args) {
  await page
    .waitForFunction(
      ([domain, selector]) => {
        const panel = document.querySelector(`[data-domain-panel="${domain}"]`);
        const active = document.activeElement;
        return !!(
          active &&
          panel?.contains(active) &&
          active.matches(selector)
        );
      },
      args,
      { timeout: 30000 },
    )
    .catch(() => undefined);
  await settle(page);
}
// Waits for a workspace to start and finish a request.
async function idle(page, selector) {
  await page
    .waitForFunction(
      (s) => document.querySelector(s)?.getAttribute('aria-busy') === 'true',
      selector,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  await page.waitForFunction(
    (s) => document.querySelector(s)?.getAttribute('aria-busy') === 'false',
    selector,
    { timeout: 60000 },
  );
  await settle(page);
}
async function exampleFromKeyboard(page, panel, domain, language) {
  await press(
    panel.getByRole('button', { name: words[language].example }).first(),
  );
  if (domain === 'supplier') {
    // The supplier example loads the sources; the comparison is one more step.
    const run = panel.getByRole('button', { name: words[language].run });
    await run.waitFor({ timeout: 60000 });
    await press(run);
  }
  await page.waitForFunction(
    (s) => !!document.querySelector(s)?.querySelector('table'),
    `[data-domain-panel="${domain}"]`,
    { timeout: 60000 },
  );
  await settle(page);
}

const report = {
  synthetic: true,
  chromium: browser.version(),
  width: 390,
  states: [],
  runAgain: [],
  restore: null,
  decision: null,
  otherExamples: [],
  withoutReducedMotion: null,
};
let failure;
try {
  for (const domain of DOMAINS)
    for (const language of ['ar', 'en']) {
      const { context, page } = await open(language);
      try {
        const panel = await openDomainWorkspace(page, domain, {
          advanced: true,
          requiredSources: false,
        });
        await exampleFromKeyboard(page, panel, domain, language);
        const args = [domain, target(domain)];
        const state = await page.evaluate(where, args);
        report.states.push({ domain, language, ...state });
        assert.ok(
          state.onTarget,
          `${domain}/${language}: focus on ${state.tag}, not on ${args[1]}`,
        );
        assert.ok(state.inView, `${domain}/${language}: heading out of view`);
        assert.ok(
          state.text,
          `${domain}/${language}: the heading says nothing`,
        );
        if (state.description !== null)
          assert.ok(
            state.description,
            `${domain}/${language}: aria-describedby reads nothing`,
          );
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(next, args),
          `${domain}/${language}: Tab leaves the result`,
        );
        // A second run from the workspace's own run button, where it has one.
        const run = panel.locator('.workspace-run-actions button:enabled');
        if (language === 'en' && (await run.count())) {
          await press(run.first());
          await focusReached(page, args);
          const again = await page.evaluate(where, args);
          report.runAgain.push({ domain, ...again });
          assert.ok(again.onTarget, `${domain}: a second run loses the focus`);
          assert.ok(again.inView, `${domain}: a second run is out of view`);
        }
        if (domain === 'payroll' && language === 'en') {
          // The payroll workspace's English controls, as lib/i18n/payroll.ts
          // writes them.
          const copy = {
            reference: 'Payroll decision reference',
            note: 'Payroll decision explanation',
            accept: 'Approve whole payroll scope',
            reject: 'Reject whole payroll scope',
            save: 'Save payroll session',
            restore: 'Restore payroll session',
          };
          // A decision keeps the reader where they decided: the focus does
          // not move to the result heading.
          await panel.getByLabel(copy.reference, { exact: true }).fill('R-1');
          await panel.getByLabel(copy.note, { exact: true }).fill('Synthetic');
          const decision = panel
            .getByRole('button', {
              name: new RegExp(`^(${copy.reject}|${copy.accept})$`, 'u'),
            })
            .and(panel.locator(':enabled'))
            .first();
          assert.ok(await decision.count(), 'payroll: no decision available');
          await decision.focus();
          await decision.press('Enter');
          await idle(page, '[data-payroll-workspace]');
          report.decision = await page.evaluate(where, args);
          assert.equal(
            report.decision.onTarget,
            false,
            'payroll: a decision moved the focus to the result heading',
          );
          // A restored session takes the reader to its result.
          const saving = page.waitForEvent('download');
          await panel.getByRole('button', { name: copy.save }).click();
          const saved = await (await saving).path();
          await panel.getByLabel(copy.restore).setInputFiles(saved);
          await focusReached(page, args);
          report.restore = await page.evaluate(where, args);
          assert.ok(
            report.restore.onTarget,
            'payroll: restore loses the focus',
          );
          assert.ok(report.restore.inView, 'payroll: restore out of view');
        }
      } finally {
        await context.close();
      }
    }
  // The two examples the loop above does not start: the AR example that only
  // loads its sources, and the bank's balance reconciliation example.
  for (const language of ['ar', 'en']) {
    const { context, page } = await open(language);
    try {
      const ar = await openDomainWorkspace(page, 'ar', {
        advanced: true,
        requiredSources: false,
      });
      await press(
        ar.getByRole('button', {
          name:
            language === 'en'
              ? 'Open scope header and details example'
              : 'فتح مثال رأس نطاق وتفاصيل',
          exact: true,
        }),
      );
      const args = ['ar', '[data-result-heading="loaded"]'];
      await focusReached(page, args);
      const state = await page.evaluate(where, args);
      report.otherExamples.push({ domain: 'ar', language, ...state });
      assert.ok(
        state.onTarget,
        `ar/${language}: the scope example loses focus`,
      );
      assert.ok(
        state.inView,
        `ar/${language}: the loaded source is out of view`,
      );
    } finally {
      await context.close();
    }
  }
  for (const language of ['ar', 'en']) {
    const { context, page } = await open(language);
    try {
      const bank = await openDomainWorkspace(page, 'bank', {
        advanced: true,
        requiredSources: false,
        balanceFlow: true,
      });
      await press(
        bank.locator('details[data-bank-balance-flow]').getByRole('button', {
          name:
            language === 'en'
              ? 'Open a synthetic balance reconciliation example'
              : 'افتح مثال تسوية أرصدة اصطناعيًا',
          exact: true,
        }),
      );
      const args = ['bank', '[data-testid="bank-balance-result"]'];
      await focusReached(page, args);
      const state = await page.evaluate(where, args);
      report.otherExamples.push({ domain: 'bank-balance', language, ...state });
      assert.ok(state.onTarget, `bank balance/${language}: focus lost`);
      assert.ok(state.inView, `bank balance/${language}: result out of view`);
      assert.ok(
        state.text,
        `bank balance/${language}: the heading says nothing`,
      );
    } finally {
      await context.close();
    }
  }
  // Without reduced motion the page scrolls smoothly; the heading still ends
  // in view with the focus.
  {
    const { context, page } = await open('en', 'no-preference');
    try {
      const panel = await openDomainWorkspace(page, 'payroll', {
        advanced: true,
        requiredSources: false,
      });
      await exampleFromKeyboard(page, panel, 'payroll', 'en');
      const args = ['payroll', target('payroll')];
      let state;
      for (let i = 0; i < 20; i++) {
        state = await page.evaluate(where, args);
        if (state.onTarget && state.inView) break;
        await page.waitForTimeout(150);
      }
      report.withoutReducedMotion = state;
      assert.ok(state.onTarget, 'without reduced motion: focus lost');
      assert.ok(state.inView, 'without reduced motion: heading out of view');
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(external, [], 'no request leaves the local server');
  assert.deepEqual(errors, [], 'no page error');
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  server.close();
  report.passed = !failure;
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  `Result focus (UX-2): ${failure ? 'FAIL' : 'PASS'}, ${report.states.length} states, ${report.runAgain.length} second runs, ${out}`,
);
if (failure) throw failure;
