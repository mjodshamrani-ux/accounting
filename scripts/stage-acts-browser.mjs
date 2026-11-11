// UX-7(c): the three obstacles of supplier reconciliation on the type stage,
// in the built application.
// With motion reduced, in Arabic and English at 1440, 390 and 320 px: the
// supplier type shows the three acts under the stage in the words of the copy
// module, one pressed and its sentence shown; each act is drawn in its final
// state and none follows another; the buttons change the act from the
// keyboard; another type shows no act, on the papers or under them, and its
// buttons cannot take the focus; and the sentence of every act keeps one
// place, so changing the act moves nothing.
// With motion on, in both languages: the acts follow one another as each
// ends; off screen they wait; paused they show their final state and do not
// follow; an act the reader picks plays from its start and stays.
// Geometry, at 1440, 390 and 320 px: 32 samples of each act hold every record
// and frame inside its paper's table, every moving record between where it
// starts and where it ends with no step over half its travel, the state
// unseen before the move ends, and the words over the stage inside it with
// 4 px to spare.
//   node --experimental-strip-types scripts/stage-acts-browser.mjs
// STAGE_ACTS_DIST names another build (a mutation gate's copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { stageActsCopy } from '../lib/i18n/stage-acts.ts';

const root = path.resolve(process.env.STAGE_ACTS_DIST ?? 'dist');
const out = path.resolve(process.env.STAGE_ACTS_DIR ?? 'work/qa-stage-acts');
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
const ACT_MS = 7200;
const ids = ['names', 'lines', 'payments'];
// The supplier type's own panel of acts; another type must show none.
const SUPPLIER_ACTS = '[data-stage-sources="supplier"][data-stage-acts]';

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

/** Waits for what the stage should come to, failing as an assertion. */
async function expectSoon(page, predicate, arg, message, timeout = 5000) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch (error) {
    if (error?.name === 'TimeoutError')
      throw new assert.AssertionError({ message });
    throw error;
  }
}

/** The acts as the page shows them. */
const readActs = () => {
  const scene = document.querySelector('.document-scene');
  const panel = scene.querySelector(
    '[data-stage-sources="supplier"][data-stage-acts]',
  );
  // A page without the acts says so, and the first assertion names it.
  if (!panel)
    return {
      panelShown: false,
      panelsShown: scene.querySelectorAll('[data-stage-acts]').length,
    };
  // Shown: drawn with a box, and visible. display: none has no box.
  const visible = (element) =>
    !!element &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible';
  const lines = [...panel.querySelectorAll('.document-scene__act-line')];
  const current = lines.find((line) => line.dataset.current === 'true');
  const stage = scene.querySelector('.document-scene__stage');
  return {
    act: scene.dataset.act ?? null,
    running: scene.dataset.running,
    shown: scene.dataset.stageDomain,
    panelShown: visible(panel),
    // The lists of the other types share the cell and stay hidden.
    otherListsShown: [
      ...scene.querySelectorAll('.document-scene__source-list'),
    ].filter((list) => list !== panel && visible(list)).length,
    // Panels of acts that show, whichever type they stand for.
    panelsShown: [...scene.querySelectorAll('[data-stage-acts]')].filter(
      visible,
    ).length,
    title: panel.querySelector('.document-scene__type').textContent.trim(),
    mark: panel.querySelector('.document-scene__acts-mark').textContent.trim(),
    group: panel
      .querySelector('.document-scene__act-buttons > legend')
      .textContent.trim(),
    buttons: [...panel.querySelectorAll('.document-scene__act-button')].map(
      (button) => ({
        id: button.dataset.actButton,
        title: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
        shown: visible(button),
      }),
    ),
    line: current?.textContent.trim(),
    lineId: current?.dataset.actLine,
    lineShown: visible(current),
    lineTop: Math.round(current?.getBoundingClientRect().top ?? -1),
    otherLinesShown: lines.filter((line) => line !== current && visible(line))
      .length,
    ink: [...scene.querySelectorAll('[data-act-ink]')].map(
      (ink) => ink.dataset.actInk,
    ),
    relation: scene
      .querySelector('.document-scene__act-relation')
      ?.textContent.trim(),
    state: scene
      .querySelector('.document-scene__act-state')
      ?.textContent.trim(),
    actAnimations: stage
      .getAnimations({ subtree: true })
      .filter((animation) =>
        animation.effect.target.closest('[data-act-motion]'),
      )
      .map((animation) => ({
        name: animation.animationName,
        state: animation.playState,
      })),
    // Final state: every moving record at the end of its travel, and the
    // frames and words over the stage at full opacity.
    finalDrawn: [...scene.querySelectorAll('[data-ink-dy]')].every((row) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(row).transform);
      return Math.abs(matrix.m42 - Number(row.dataset.inkDy)) < 0.01;
    }),
    shownOpaque: [
      ...scene.querySelectorAll(
        '.document-scene__ink-frame, .document-scene__act-relation, .document-scene__act-state',
      ),
    ].every((element) => getComputedStyle(element).opacity === '1'),
  };
};

/** The state and reason the stage shows at the end of an act. */
const stateWords = (act) =>
  act.reason ? `${act.state}${act.reason}` : act.state;

function expectAct(acts, copy, index, where) {
  const act = copy.acts[index];
  assert.equal(acts.act, act.id, `${where}: the stage plays ${act.id}`);
  assert.deepEqual(
    acts.buttons.map((button) => button.pressed),
    copy.acts.map((_, i) => String(i === index)),
    `${where}: the button of ${act.id} is the one pressed`,
  );
  assert.equal(acts.lineId, act.id, `${where}: the sentence follows the act`);
  assert.equal(acts.line, act.line, `${where}: the sentence is the act's`);
  assert.equal(acts.lineShown, true, `${where}: the sentence shows`);
  assert.equal(acts.otherLinesShown, 0, `${where}: one sentence shows`);
  assert.deepEqual(
    acts.ink,
    [act.id, act.id],
    `${where}: both papers play ${act.id}`,
  );
  assert.equal(
    acts.state?.replaceAll(/\s+/g, ''),
    stateWords(act).replaceAll(/\s+/g, ''),
    `${where}: the stage shows the act's state`,
  );
  assert.equal(
    acts.relation,
    act.id === 'names' ? copy.relation : undefined,
    `${where}: the relation between the two heads, in the first act only`,
  );
}

const report = { reduced: [], motion: [], geometry: [], passed: false };
try {
  // With motion reduced: the words, the final state, the buttons.
  for (const language of ['ar', 'en'])
    for (const width of [1440, 390, 320]) {
      const where = `${language} ${width}`;
      const copy = stageActsCopy[language];
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      try {
        const { page, errors } = await open(context, language);
        await page.locator('.document-scene').scrollIntoViewIfNeeded();
        let acts = await page.evaluate(readActs);
        assert.equal(
          acts.panelShown && acts.panelsShown === 1,
          true,
          `${where}: the acts show, once`,
        );
        assert.equal(
          acts.otherListsShown,
          0,
          `${where}: the lists of the other types stay hidden`,
        );
        assert.equal(acts.title, copy.title, `${where}: their title`);
        assert.equal(acts.mark, copy.mark, `${where}: their mark`);
        assert.equal(acts.group, copy.group, `${where}: their group's name`);
        assert.deepEqual(
          acts.buttons.map((button) => [button.id, button.title]),
          copy.acts.map((act) => [act.id, act.title]),
          `${where}: the three titles, in order`,
        );
        assert.deepEqual(
          acts.actAnimations,
          [],
          `${where}: with motion reduced nothing moves`,
        );
        assert.equal(
          acts.finalDrawn && acts.shownOpaque,
          true,
          `${where}: drawn in the final state`,
        );
        expectAct(acts, copy, 0, `${where} first`);
        // Before any act is picked the acts would follow one another, so a
        // whole act is waited out here: with motion reduced none follows.
        if (width === 1440) {
          await page.waitForTimeout(ACT_MS + 800);
          expectAct(
            await page.evaluate(readActs),
            copy,
            0,
            `${where}: with motion reduced, a whole act later, the first act stays`,
          );
        }
        const tops = new Set([acts.lineTop]);
        for (const [index, id] of ids.entries()) {
          await page
            .locator(`${SUPPLIER_ACTS} [data-act-button="${id}"]`)
            .click();
          await page.waitForTimeout(100);
          acts = await page.evaluate(readActs);
          expectAct(acts, copy, index, `${where} ${id}`);
          assert.deepEqual(
            acts.actAnimations,
            [],
            `${where} ${id}: with motion reduced nothing moves`,
          );
          assert.equal(
            acts.finalDrawn && acts.shownOpaque,
            true,
            `${where} ${id}: the act is drawn in its final state`,
          );
          tops.add(acts.lineTop);
        }
        assert.equal(
          tops.size,
          1,
          `${where}: every sentence stands in one place (${[...tops].join(', ')})`,
        );
        // No act follows another while motion is reduced.
        await page.waitForTimeout(ACT_MS / 4);
        assert.equal(
          (await page.evaluate(readActs)).act,
          'payments',
          `${where}: with motion reduced no act follows another`,
        );
        // From the keyboard: Tab back to the first act and press it.
        await page
          .locator(`${SUPPLIER_ACTS} [data-act-button="payments"]`)
          .focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset.actButton),
          'names',
          `${where}: the act buttons are reached from the keyboard`,
        );
        assert.notEqual(
          await page.evaluate(
            () => getComputedStyle(document.activeElement).outlineStyle,
          ),
          'none',
          `${where}: the focused act button shows its focus`,
        );
        await page.keyboard.press('Enter');
        expectAct(
          await page.evaluate(readActs),
          copy,
          0,
          `${where} from the keyboard`,
        );
        // Another type: no act, on the papers or under them.
        const type = page.locator('select[data-reconciliation-type-select]');
        await type.selectOption('ar');
        await expectSoon(
          page,
          () =>
            document.querySelector('.document-scene').dataset.stageDomain ===
            'ar',
          null,
          `${where}: another type is shown at once`,
        );
        acts = await page.evaluate(readActs);
        assert.equal(
          acts.panelShown || acts.panelsShown > 0,
          false,
          `${where} ar: no acts under it`,
        );
        assert.equal(
          acts.buttons.some((button) => button.shown),
          false,
          `${where} ar: the act buttons are hidden and take no focus`,
        );
        assert.deepEqual(acts.ink, [], `${where} ar: no act on the papers`);
        assert.equal(acts.act, null, `${where} ar: the stage plays no act`);
        assert.equal(acts.state, undefined, `${where} ar: no state shown`);
        await type.selectOption('supplier');
        await page.locator('.document-scene').scrollIntoViewIfNeeded();
        await expectSoon(
          page,
          () =>
            document.querySelector('.document-scene').dataset.act === 'names',
          null,
          `${where}: back on suppliers the act is shown again`,
        );
        assert.deepEqual(errors, [], 'no page errors');
        report.reduced.push({ language, width, lineTop: [...tops][0] });
      } finally {
        await context.close();
      }
    }

  // With motion on: the acts follow one another, wait off screen, show
  // their final state when paused, and stay when picked.
  for (const language of ['ar', 'en']) {
    const where = language;
    const copy = stageActsCopy[language];
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    try {
      const { page, errors } = await open(context, language);
      const scene = page.locator('.document-scene');
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'true',
        null,
        `${where}: on screen with motion on, the stage runs`,
      );
      let acts = await page.evaluate(readActs);
      expectAct(acts, copy, 0, `${where} first`);
      assert.ok(
        acts.actAnimations.some(
          (animation) => animation.name === 'document-scene-act-clock',
        ) &&
          acts.actAnimations.every(
            (animation) => animation.state === 'running',
          ),
        `${where}: the act runs (${JSON.stringify(acts.actAnimations)})`,
      );
      // Each act, ended, gives way to the next, and the last to the first.
      const endClock = () => {
        const clock = document
          .querySelector('.document-scene__act-clock')
          ?.getAnimations()[0];
        if (clock) clock.currentTime = 7200;
        return !!clock;
      };
      for (const [index, id] of [...ids.slice(1), ids[0]].entries()) {
        assert.equal(
          await page.evaluate(endClock),
          true,
          `${where}: an act times itself`,
        );
        await expectSoon(
          page,
          (id) => document.querySelector('.document-scene').dataset.act === id,
          id,
          `${where}: when an act ends the next one plays (${id})`,
        );
        expectAct(
          await page.evaluate(readActs),
          copy,
          (index + 1) % 3,
          `${where} next ${id}`,
        );
      }
      // Off screen the act waits.
      await page.locator('.site-footer').scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'false',
        null,
        `${where}: off screen the stage stops`,
      );
      acts = await page.evaluate(readActs);
      assert.ok(
        acts.actAnimations.length > 0 &&
          acts.actAnimations.every((animation) => animation.state === 'paused'),
        `${where}: off screen the act waits (${JSON.stringify(acts.actAnimations)})`,
      );
      await scene.scrollIntoViewIfNeeded();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'true',
        null,
        `${where}: seen again the stage runs`,
      );
      // Paused: the final state, still, and no act follows.
      await scene.locator('.document-scene__motion-toggle').click();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'false',
        null,
        `${where}: paused, the stage stops`,
      );
      await page.waitForTimeout(200);
      acts = await page.evaluate(readActs);
      const pausedAct = acts.act;
      assert.deepEqual(
        acts.actAnimations,
        [],
        `${where}: paused, nothing moves`,
      );
      assert.equal(
        acts.finalDrawn && acts.shownOpaque,
        true,
        `${where}: paused, the act is drawn in its final state`,
      );
      await page.waitForTimeout(ACT_MS / 4);
      assert.equal(
        (await page.evaluate(readActs)).act,
        pausedAct,
        `${where}: paused, no act follows another`,
      );
      await scene.locator('.document-scene__motion-toggle').click();
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'true',
        null,
        `${where}: the stage runs again`,
      );
      // A picked act plays from its start and stays.
      await page
        .locator(`${SUPPLIER_ACTS} [data-act-button="payments"]`)
        .click();
      acts = await page.evaluate(readActs);
      expectAct(acts, copy, 2, `${where} picked`);
      const clockTime = await page.evaluate(
        () =>
          document
            .querySelector('.document-scene__act-clock')
            ?.getAnimations()[0]?.currentTime ?? -1,
      );
      assert.ok(
        clockTime >= 0 && clockTime < ACT_MS / 4,
        `${where}: a picked act plays from its start (${clockTime})`,
      );
      // End the whole act: the clock and every record, frame and word.
      await page.evaluate((duration) => {
        for (const animation of document
          .querySelector('.document-scene__stage')
          .getAnimations({ subtree: true })
          .filter((animation) =>
            animation.effect.target.closest('[data-act-motion]'),
          ))
          animation.currentTime = duration;
      }, ACT_MS);
      await page.waitForTimeout(400);
      acts = await page.evaluate(readActs);
      expectAct(acts, copy, 2, `${where}: a picked act stays when it ends`);
      assert.equal(
        acts.finalDrawn,
        true,
        `${where}: at its end a picked act holds its final state`,
      );
      assert.deepEqual(errors, [], 'no page errors');
      report.motion.push({ language, clockTime });
    } finally {
      await context.close();
    }
  }

  // The motion runs when its stage is seen, whatever lies under the stage: on
  // a phone the acts make the scene about twice its stage. The page is put
  // where the share of the stage in view is over the scene's threshold (12%)
  // and the share of the whole scene is under it. The window is short, so the
  // page can stand there in both languages; it is checked that it does.
  for (const language of ['ar', 'en']) {
    const where = `${language} 390 seen`;
    const context = await browser.newContext({
      viewport: { width: 390, height: 420 },
      reducedMotion: 'no-preference',
    });
    try {
      const { page, errors } = await open(context, language);
      const sizes = await page.evaluate(() => {
        const scene = document.querySelector('.document-scene');
        return {
          scene: scene.getBoundingClientRect().height,
          stage: scene
            .querySelector('.document-scene__stage')
            .getBoundingClientRect().height,
        };
      });
      const shown = Math.round((0.12 * (sizes.stage + sizes.scene)) / 2);
      assert.ok(
        shown > 0.12 * sizes.stage + 4 && shown < 0.12 * sizes.scene - 4,
        `${where}: the scene is taller than its stage (${JSON.stringify(sizes)})`,
      );
      await page.evaluate((shown) => {
        const stage = document.querySelector('.document-scene__stage');
        const top = stage.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
          top: top - innerHeight + shown,
          behavior: 'instant',
        });
      }, shown);
      const inView = await page.evaluate(
        () =>
          innerHeight -
          document
            .querySelector('.document-scene__stage')
            .getBoundingClientRect().top,
      );
      assert.ok(
        Math.abs(inView - shown) <= 2,
        `${where}: the page stands with ${shown} px of the stage in view (${inView})`,
      );
      await expectSoon(
        page,
        () =>
          document.querySelector('.document-scene').dataset.running === 'true',
        null,
        `${where}: with ${shown} px of its stage in view the stage runs (${JSON.stringify(sizes)})`,
      );
      assert.deepEqual(errors, [], 'no page errors');
      report.motion.push({ language, seen: { shown, inView, ...sizes } });
    } finally {
      await context.close();
    }
  }

  // Geometry of each act, sampled by seeking its own animations.
  for (const language of ['ar', 'en'])
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'no-preference',
      });
      try {
        const { page, errors } = await open(context, language);
        await page.locator('.document-scene').scrollIntoViewIfNeeded();
        const sweep = { language, width, acts: [] };
        for (const id of ids) {
          const where = `${language} ${width} ${id}`;
          await page
            .locator(`${SUPPLIER_ACTS} [data-act-button="${id}"]`)
            .click();
          await expectSoon(
            page,
            (id) =>
              document.querySelector('.document-scene').dataset.act === id &&
              !!document.querySelector('.document-scene__act-clock'),
            id,
            `${where}: the act plays`,
          );
          const samples = await page.evaluate((duration) => {
            const stage = document.querySelector('.document-scene__stage');
            const animations = stage
              .getAnimations({ subtree: true })
              .filter((animation) =>
                animation.effect.target.closest('[data-act-motion]'),
              );
            animations.forEach((animation) => animation.pause());
            const frame = stage.getBoundingClientRect();
            // The words over the stage keep this many pixels from its edges.
            const edge = 4;
            const list = [];
            for (let k = 0; k <= 32; k += 1) {
              // The last sample stops short of the end, which would end the act.
              const time = k === 32 ? duration - 1 : (duration * k) / 32;
              animations.forEach((animation) => {
                animation.currentTime = time;
              });
              const papers = [
                ...stage.querySelectorAll('.document-scene__paper-art'),
              ].map((art) => {
                // The element's own box through its own transform into the
                // paper's units: a screen box of a turned paper is larger
                // than what it holds.
                const toPaper = art.getScreenCTM().inverse();
                const local = (element) => {
                  const box = element.getBBox();
                  const matrix = toPaper.multiply(element.getScreenCTM());
                  const corners = [
                    [box.x, box.y],
                    [box.x + box.width, box.y],
                    [box.x, box.y + box.height],
                    [box.x + box.width, box.y + box.height],
                  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
                  return {
                    left: Math.min(...corners.map((point) => point.x)),
                    top: Math.min(...corners.map((point) => point.y)),
                    right: Math.max(...corners.map((point) => point.x)),
                    bottom: Math.max(...corners.map((point) => point.y)),
                  };
                };
                // A record is its band; the em box of its reference is
                // taller than the glyphs it draws, so a reference is held to
                // the width of its band, ending before the amount mark at 130.
                const parts = [
                  ...art.querySelectorAll(
                    '.document-scene__ink-row > rect:first-child, .document-scene__ink-frame',
                  ),
                ];
                return {
                  kind: art.closest('[data-paper-kind]').dataset.paperKind,
                  inTable:
                    parts.length > 0 &&
                    parts.every((part) => {
                      const box = local(part);
                      return (
                        box.left >= 20 - 0.5 &&
                        box.right <= 176 + 0.5 &&
                        box.top >= 106 - 0.5 &&
                        box.bottom <= 224 + 0.5
                      );
                    }),
                  textsFit: [
                    ...art.querySelectorAll('.document-scene__ink-ref'),
                  ].every((text) => {
                    const box = text.getBBox();
                    return box.x >= 24 && box.x + box.width <= 128;
                  }),
                  moves: [...art.querySelectorAll('[data-ink-dy]')].map(
                    (row) => ({
                      dy: Number(row.dataset.inkDy),
                      at: new DOMMatrixReadOnly(getComputedStyle(row).transform)
                        .m42,
                    }),
                  ),
                };
              });
              const words = [
                ...stage.querySelectorAll(
                  '.document-scene__act-relation, .document-scene__act-state',
                ),
              ].map((element) => {
                const box = element.getBoundingClientRect();
                // Inside, with room to spare: text a browser draws a little
                // wider than this one still fits (DEV-107).
                return {
                  inside:
                    box.left >= frame.left + edge &&
                    box.right <= frame.right - edge &&
                    box.top >= frame.top + edge &&
                    box.bottom <= frame.bottom - edge,
                  room: Math.min(
                    box.left - frame.left,
                    frame.right - box.right,
                    box.top - frame.top,
                    frame.bottom - box.bottom,
                  ),
                  opacity: Number(getComputedStyle(element).opacity),
                  state: element.matches('.document-scene__act-state'),
                };
              });
              list.push({ k, progress: time / duration, papers, words });
            }
            animations.forEach((animation) => {
              animation.currentTime = 0;
              animation.play();
            });
            return list;
          }, ACT_MS);
          for (const sample of samples) {
            for (const paper of sample.papers) {
              assert.equal(
                paper.inTable,
                true,
                `${where} ${paper.kind}, sample ${sample.k}: every record and frame stays inside its paper's table`,
              );
              assert.equal(
                paper.textsFit,
                true,
                `${where} ${paper.kind}, sample ${sample.k}: every reference fits its record before the amount`,
              );
              for (const move of paper.moves)
                assert.ok(
                  move.at <= Math.max(0, move.dy) + 0.01 &&
                    move.at >= Math.min(0, move.dy) - 0.01,
                  `${where} ${paper.kind}, sample ${sample.k}: a record moves only between where it starts and where it ends (${move.at} of ${move.dy})`,
                );
            }
            for (const word of sample.words) {
              assert.equal(
                word.inside,
                true,
                `${where}, sample ${sample.k}: the words over the stage stay inside it, 4 px from its edges (${word.room.toFixed(1)})`,
              );
              if (word.state && sample.progress < 0.55)
                assert.equal(
                  word.opacity,
                  0,
                  `${where}, sample ${sample.k}: the state shows only after the move`,
                );
            }
          }
          // No step over half the travel: the move spans eight samples.
          for (const [paperIndex, paper] of samples[0].papers.entries())
            for (const [moveIndex, move] of paper.moves.entries()) {
              let largest = 0;
              for (let k = 1; k < samples.length; k += 1)
                largest = Math.max(
                  largest,
                  Math.abs(
                    samples[k].papers[paperIndex].moves[moveIndex].at -
                      samples[k - 1].papers[paperIndex].moves[moveIndex].at,
                  ),
                );
              assert.ok(
                largest <= Math.abs(move.dy) / 2,
                `${where} ${paper.kind}: a record jumps ${largest} of its ${move.dy} between two samples`,
              );
              const last = samples.at(-1).papers[paperIndex].moves[moveIndex];
              assert.ok(
                Math.abs(last.at - move.dy) < 0.01 &&
                  Math.abs(samples[0].papers[paperIndex].moves[moveIndex].at) <
                    0.01,
                `${where} ${paper.kind}: a record starts in place and ends at its travel`,
              );
            }
          assert.equal(
            samples.at(-1).words.find((word) => word.state)?.opacity,
            1,
            `${where}: at its end the act shows its state`,
          );
          sweep.acts.push({ id, samples: samples.length });
        }
        assert.deepEqual(errors, [], 'no page errors');
        report.geometry.push(sweep);
      } finally {
        await context.close();
      }
    }
  report.passed = true;
} finally {
  await writeFile(
    path.join(out, 'stage-acts-browser.json'),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ out, passed: report.passed }));
