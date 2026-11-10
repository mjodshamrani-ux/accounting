// UX-7(b): the type stage, in the built application.
// For each of the twelve types in the type list, in Arabic and English at
// 1440, 390 and 320 px: the two papers of the intro wear the roles the
// workspace's own file inputs name, in reading order, with the formats those
// inputs accept, the first role on the blue paper; the type is named under
// the stage as the list names it; clearing is one upright paper in the
// middle; every name fits its band and every chip ends before the mark; and
// the type list does not move when the type changes.
// The scene's own geometry is held first, as the landing check holds it: a
// whole cycle of float and scan at seven widths, nothing escaping or stretched.
// Then with motion on, in both languages: a chosen type waits while the stage
// is off screen and turns when the stage is seen again, inside the stage and
// above its platform at every sample of the turn, in the 730 ms its timings
// add up to; paused, reduced or after a language change it changes at once.
//   node scripts/type-stage-browser.mjs
// TYPE_STAGE_DIST names another build (a mutation gate's copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { sceneFacts, verifySceneGeometry } from './brand-browser-cases.mjs';

const root = path.resolve(process.env.TYPE_STAGE_DIST ?? 'dist');
const out = path.resolve(process.env.TYPE_STAGE_DIR ?? 'work/qa-type-stage');
await mkdir(out, { recursive: true });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('outside');
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});

// The formats as an upload card writes them, computed here from the input's
// own `accept` and not from the application's function.
const formats = (accept) =>
  accept
    .split(',')
    .map((format) => format.trim().replace(/^\./, '').toUpperCase())
    .join(' / ');

async function open(context, language) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  if ((await page.evaluate(() => document.documentElement.lang)) !== language)
    await page
      .locator(`.language-switch button[lang="${language}"]:visible`)
      .first()
      .click();
  await page.waitForFunction(
    (language) =>
      document.documentElement.lang === language &&
      !document.querySelector('select[data-reconciliation-type-select]')
        ?.disabled,
    language,
  );
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

/** What the stage and the chosen workspace say, read from the page. */
const readStage = (domain) => {
  const panel = document.querySelector(`[data-domain-panel="${domain}"]`);
  // The main path's sources: the supplier page's file grid, or the first
  // group of main sources in a workspace (the bank panel also holds its
  // separate balance path below the movements).
  const group = panel.querySelector(
    domain === 'supplier' ? '.file-grid' : '.workspace-primary-sources',
  );
  const inputs = [...group.querySelectorAll('input[type="file"]')].map(
    (input) => ({
      name: input.getAttribute('aria-label'),
      accept: input.getAttribute('accept'),
    }),
  );
  const scene = document.querySelector('.document-scene');
  const frame = scene
    .querySelector('.document-scene__stage')
    .getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const papers = [...scene.querySelectorAll('.document-scene__sheet')]
    .filter((paper) => getComputedStyle(paper).visibility === 'visible')
    .map((paper) => {
      const box = paper.getBoundingClientRect();
      return {
        kind: paper.dataset.paperKind,
        centre: box.left + box.width / 2 - frame.left,
        name: paper
          .querySelector('.document-scene__paper-title')
          .textContent.trim(),
        chip: paper
          .querySelector('.document-scene__file-type')
          .textContent.trim(),
      };
    })
    .sort((a, b) => (rtl ? b.centre - a.centre : a.centre - b.centre));
  const current = scene.querySelector(
    '.document-scene__source-list[data-current="true"]',
  );
  const select = document.querySelector(
    'select[data-reconciliation-type-select]',
  );
  return {
    shown: scene.dataset.stageDomain,
    target: scene.dataset.stageTarget,
    running: scene.dataset.running,
    inputs,
    papers,
    frameWidth: frame.width,
    typeTitle: current
      ?.querySelector('.document-scene__type')
      ?.textContent.trim(),
    sources: [
      ...(current?.querySelectorAll('.document-scene__source') ?? []),
    ].map((source) => ({
      name: source
        .querySelector('.document-scene__source-name')
        .textContent.trim(),
      formats: source
        .querySelector('.document-scene__source-formats')
        .textContent.trim(),
    })),
    currentLists: scene.querySelectorAll(
      '.document-scene__source-list[data-current="true"]',
    ).length,
    selectTop: Math.round(select.getBoundingClientRect().top + window.scrollY),
    selectedTitle: select.selectedOptions[0].textContent.trim(),
  };
};

/** Waits for what the stage should come to; a stage that never gets there
 * fails as an assertion that says what it should have done. */
async function expectSoon(page, predicate, arg, message, timeout = 5000) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch (error) {
    if (error?.name === 'TimeoutError')
      throw new assert.AssertionError({ message });
    throw error;
  }
}

const turning = () =>
  [...document.querySelectorAll('.document-scene__turn')].flatMap((turn) =>
    turn.getAnimations(),
  ).length;

const report = { sweeps: [], motion: [], passed: false };
try {
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    try {
      const { page, errors } = await open(context, 'ar');
      await verifySceneGeometry(page);
      assert.deepEqual(errors, [], 'no page errors');
      report.geometry = 'passed';
    } finally {
      await context.close();
    }
  }
  for (const language of ['ar', 'en'])
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      try {
        const { page, errors } = await open(context, language);
        const type = page.locator('select[data-reconciliation-type-select]');
        const options = await type.locator('option').evaluateAll((list) =>
          list.map((option) => ({
            domain: option.value,
            title: option.textContent.trim(),
          })),
        );
        assert.equal(options.length, 12, 'the twelve types');
        assert.equal(
          await page.locator('.document-scene[data-stage-target]').count(),
          1,
          `${language} ${width}: the intro's stage follows the type list`,
        );
        const tops = new Set();
        const sweep = { language, width, types: [] };
        for (const { domain, title } of options) {
          const where = `${language} ${width} ${domain}`;
          await type.selectOption(domain);
          await page
            .locator(`[data-domain-panel="${domain}"]`)
            .waitFor({ state: 'visible' });
          // Motion is reduced: the papers change at once, wherever the page is.
          await expectSoon(
            page,
            (domain) =>
              document.querySelector('.document-scene')?.dataset.stageDomain ===
              domain,
            domain,
            `${where}: with motion reduced the papers take the chosen type at once`,
          );
          const stage = await page.evaluate(readStage, domain);
          const facts = await page.evaluate(sceneFacts);
          tops.add(stage.selectTop);
          assert.ok(
            stage.inputs.length >= 1,
            `${where}: the workspace's inputs`,
          );
          assert.deepEqual(
            stage.papers.map((paper) => paper.name),
            stage.inputs.map((input) => input.name),
            `${where}: the papers wear the roles the workspace's inputs name, in reading order`,
          );
          assert.deepEqual(
            stage.papers.map((paper) => paper.chip),
            stage.inputs.map((input) => formats(input.accept)),
            `${where}: each paper's chip says what its input accepts`,
          );
          assert.equal(
            stage.papers[0].kind,
            'supplier',
            `${where}: the first role reads first, on the blue paper`,
          );
          assert.deepEqual(
            stage.sources,
            stage.inputs.map((input) => ({
              name: input.name,
              formats: formats(input.accept),
            })),
            `${where}: the sources under the stage are the workspace's, in order`,
          );
          assert.equal(stage.currentLists, 1, `${where}: one type shows`);
          assert.equal(
            stage.typeTitle,
            title,
            `${where}: the stage names the type as the list does`,
          );
          assert.equal(stage.selectedTitle, title);
          if (stage.inputs.length === 1)
            assert.ok(
              stage.papers.length === 1 &&
                Math.abs(stage.papers[0].centre - stage.frameWidth / 2) <
                  stage.frameWidth * 0.01,
              `${where}: one record is one paper in the middle (${JSON.stringify(stage.papers)})`,
            );
          for (const paper of facts.papers.filter((paper) => paper.shown))
            assert.equal(
              paper.titleBand && paper.titleFits && paper.chipFits,
              true,
              `${where} ${paper.kind}: the name fits its band in two lines and the chip ends before the mark (${JSON.stringify(paper)})`,
            );
          sweep.types.push({
            domain,
            roles: stage.papers.map((paper) => paper.name),
          });
        }
        assert.equal(
          tops.size,
          1,
          `${language} ${width}: choosing a type never moves the type list (${[...tops].join(', ')})`,
        );
        assert.deepEqual(errors, [], 'no page errors');
        sweep.selectTop = [...tops][0];
        report.sweeps.push(sweep);
      } finally {
        await context.close();
      }
    }

  for (const language of ['ar', 'en']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    try {
      const { page, errors } = await open(context, language);
      const type = page.locator('select[data-reconciliation-type-select]');
      const scene = page.locator('.document-scene');
      const motion = { language };
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene')?.dataset.running === 'true',
        null,
        `${language}: on screen with motion on, the stage runs`,
      );

      // Off screen the papers wait: choosing a type scrolls its workspace in.
      await type.selectOption('bank');
      await page.locator('[data-domain-panel="bank"]').waitFor();
      await page.waitForTimeout(400);
      const waiting = await page.evaluate(readStage, 'bank');
      assert.equal(
        waiting.running,
        'false',
        `${language}: the stage is off screen`,
      );
      assert.equal(waiting.target, 'bank');
      assert.equal(
        waiting.shown,
        'supplier',
        `${language}: off screen the papers keep their roles until seen`,
      );
      assert.equal(
        waiting.typeTitle,
        waiting.selectedTitle,
        'the words follow at once',
      );

      // Seen again, they turn: sample both halves of the turn, paused.
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        turning,
        null,
        `${language}: seen again, the papers turn to the chosen type`,
        3000,
      );
      const half = async (phase) => {
        const timing = await page.evaluate(() => {
          const animations = [
            ...document.querySelectorAll('.document-scene__turn'),
          ].flatMap((turn) => turn.getAnimations());
          animations.forEach((animation) => animation.pause());
          return animations.map((animation) =>
            Number(animation.effect.getComputedTiming().endTime),
          );
        });
        const samples = [];
        for (let k = 0; k <= 8; k += 1) {
          samples.push(
            await page.evaluate(async (k) => {
              const animations = [
                ...document.querySelectorAll('.document-scene__turn'),
              ].flatMap((turn) => turn.getAnimations());
              animations.forEach((animation) => {
                animation.currentTime =
                  (Number(animation.effect.getComputedTiming().endTime) * k) /
                  8;
              });
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const frame = document
                .querySelector('.document-scene__stage')
                .getBoundingClientRect();
              const portal = document
                .querySelector('.document-scene__portal-back')
                .getBoundingClientRect();
              return [...document.querySelectorAll('.document-scene__sheet')]
                .filter(
                  (paper) => getComputedStyle(paper).visibility === 'visible',
                )
                .map((paper) => {
                  const edge = paper
                    .querySelector('.document-scene__paper-edge')
                    .getBoundingClientRect();
                  const body = paper
                    .querySelector('.document-scene__paper')
                    .getBoundingClientRect();
                  return {
                    k,
                    kind: paper.dataset.paperKind,
                    inside:
                      body.left >= frame.left - 0.5 &&
                      body.right <= frame.right + 0.5 &&
                      body.top >= frame.top - 0.5 &&
                      edge.bottom < portal.top,
                  };
                });
            }, k),
          );
        }
        await page.evaluate(() =>
          [...document.querySelectorAll('.document-scene__turn')]
            .flatMap((turn) => turn.getAnimations())
            .forEach((animation) => animation.play()),
        );
        for (const sample of samples.flat())
          assert.equal(
            sample.inside,
            true,
            `${language} ${phase} ${sample.kind} at ${sample.k}/8: a turning paper stays inside the stage and above its platform`,
          );
        return Math.max(...timing);
      };
      const away = await half('away');
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.stageDomain ===
          'bank',
        null,
        `${language}: turned away, the papers take the chosen type`,
        3000,
      );
      await page
        .waitForFunction(turning, null, { timeout: 3000 })
        .catch(() => {});
      const back = (await page.evaluate(turning)) ? await half('back') : 0;
      motion.turnMs = away + back;
      assert.ok(
        away > 0 && back > 0,
        `${language}: the papers turn away and back`,
      );
      assert.ok(
        motion.turnMs <= 750,
        `${language}: the turn takes ${motion.turnMs} ms, over its 750 ms budget`,
      );
      await expectSoon(
        page,
        () =>
          ![...document.querySelectorAll('.document-scene__turn')].some(
            (turn) => turn.getAnimations().length,
          ),
        null,
        `${language}: the turn settles`,
        3000,
      );
      const settled = await page.evaluate(readStage, 'bank');
      assert.deepEqual(
        settled.papers.map((paper) => paper.name),
        settled.inputs.map((input) => input.name),
        `${language}: after the turn the papers wear the new roles`,
      );

      // A turn that runs unpaused settles in its own time.
      await type.selectOption('clearing');
      await page.locator('[data-domain-panel="clearing"]').waitFor();
      await page.waitForTimeout(300);
      const started = Date.now();
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.stageDomain ===
            'clearing' &&
          ![...document.querySelectorAll('.document-scene__turn')].some(
            (turn) => turn.getAnimations().length,
          ),
        null,
        `${language}: an unpaused turn settles on the chosen type in its time`,
        3000,
      );
      motion.settledMs = Date.now() - started;
      const one = await page.evaluate(readStage, 'clearing');
      assert.equal(one.papers.length, 1, `${language}: clearing is one paper`);

      // Paused by the reader: the papers change at once and do not turn.
      await scene
        .getByRole('button', {
          name:
            language === 'ar'
              ? 'أوقف الحركة التوضيحية'
              : 'Pause the illustration animation',
          exact: true,
        })
        .click();
      await type.selectOption('payroll');
      await page.locator('[data-domain-panel="payroll"]').waitFor();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.stageDomain ===
          'payroll',
        null,
        `${language}: paused, the papers take the chosen type at once, off screen`,
        2000,
      );
      await scene.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(turning),
        0,
        `${language}: paused, nothing turns`,
      );
      await scene
        .getByRole('button', {
          name:
            language === 'ar'
              ? 'شغّل الحركة التوضيحية'
              : 'Play the illustration animation',
          exact: true,
        })
        .click();

      // Reduced motion: at once, no turn.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await type.selectOption('ar');
      await page.locator('[data-domain-panel="ar"]').waitFor();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.stageDomain ===
          'ar',
        null,
        `${language}: reduced, the papers take the chosen type at once, off screen`,
        2000,
      );
      await scene.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(turning),
        0,
        `${language}: reduced, nothing turns`,
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      // Another language: the names change in place, without a turn.
      const other = language === 'ar' ? 'en' : 'ar';
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene')?.dataset.running === 'true',
        null,
        `${language}: on screen again, the stage runs`,
      );
      await page
        .locator(`.language-switch button[lang="${other}"]:visible`)
        .first()
        .click();
      await page.waitForFunction(
        (other) => document.documentElement.lang === other,
        other,
      );
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(turning),
        0,
        `${language}: a language change does not turn`,
      );
      const translated = await page.evaluate(readStage, 'ar');
      assert.deepEqual(
        translated.papers.map((paper) => paper.name),
        translated.inputs.map((input) => input.name),
        `${language} to ${other}: the papers speak the new language`,
      );
      assert.deepEqual(errors, [], 'no page errors');
      report.motion.push(motion);
    } finally {
      await context.close();
    }
  }
  report.passed = true;
} finally {
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(
  JSON.stringify({
    out,
    passed: report.passed,
    sweeps: report.sweeps.map(({ language, width, selectTop, types }) => ({
      language,
      width,
      selectTop,
      types: types.length,
    })),
    motion: report.motion,
  }),
);
