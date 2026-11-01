// Self-test of scripts/stage-watchdog.mjs, the watchdog that makes a
// browser check that stops without an error say where it stopped.
//
// Each case runs as its own process, as a check runs, on a synthetic page
// with a two-second limit, and must end by itself, well before this
// self-test's limit of 45 seconds per case:
// - stalled: the check waits on a page that answers. It must exit with an
//   error, name its stage, and print the page's state: a frame drawn, the
//   focused element and the notice the page shows.
// - frozen: the page's main thread never yields, as when a page stops
//   drawing frames. It must still exit with an error and its stage, saying
//   the page did not answer.
// - moving: each stage takes less than the limit and the check ends
//   without stopping the watchdog. It must exit cleanly: moving on resets
//   the clock, and the watchdog alone never keeps a finished check alive.
// - stopped: the check stops the watchdog, then waits past the limit. It
//   must exit cleanly.
//   node scripts/stage-watchdog-self-test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { stageWatchdog } from './stage-watchdog.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = process.argv[2];

if (mode) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MIZAN_CHROMIUM
      ? { executablePath: process.env.MIZAN_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage();
  await page.setContent(
    '<p class="notice">Synthetic notice</p><button>Synthetic focus</button>',
  );
  await page.locator('button').focus();
  const watch = stageWatchdog({ page: () => page, limit: 2000, every: 250 });
  if (mode === 'stalled') {
    watch.at('synthetic: waiting on the page');
    await page.evaluate(() => new Promise(() => {}));
  } else if (mode === 'frozen') {
    watch.at('synthetic: the page stopped');
    await page.evaluate(() => {
      setTimeout(() => {
        for (;;);
      }, 0);
    });
    await new Promise(() => {});
  } else if (mode === 'moving') {
    for (const name of ['one', 'two', 'three']) {
      watch.at('synthetic: ' + name);
      await pause(900);
    }
  } else if (mode === 'stopped') {
    watch.at('synthetic: done');
    watch.stop();
    // Keeps the check alive past the limit.
    await pause(3500);
  }
  await browser.close();
} else {
  const run = (name) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {
      encoding: 'utf8',
      timeout: 45000,
    });
  const said = (r) => `\n${r.stdout}\n${r.stderr}`;
  // A case that never reached its stage failed before the watchdog was
  // tried (a browser that did not start, say); that is not a result.
  const reached = (r, label, stage) =>
    assert.ok(
      r.stdout.split('\n').includes('stage: ' + stage),
      `${label}: reached "${stage}"` + said(r),
    );
  // It ended by itself, not by this self-test's limit: a process stopped
  // from outside can still end with status 1.
  const ended = (r, label) =>
    assert.ok(
      !r.error && r.signal === null,
      `${label}: ended by itself (${r.error?.code ?? r.signal})` + said(r),
    );

  const stalled = run('stalled');
  ended(stalled, 'stalled');
  reached(stalled, 'stalled', 'synthetic: waiting on the page');
  assert.equal(
    stalled.status,
    1,
    'stalled: exits with an error' + said(stalled),
  );
  assert.match(
    stalled.stderr,
    /^stalled for \d+ s at: synthetic: waiting on the page$/mu,
    'stalled: names its stage' + said(stalled),
  );
  const state = JSON.parse(
    stalled.stderr.split('\n').find((line) => line.startsWith('{')) ?? 'null',
  );
  assert.ok(state, 'stalled: prints the page state' + said(stalled));
  assert.equal(state.frame, 'drawn');
  assert.match(state.active, /^BUTTON Synthetic focus/u);
  assert.ok(state.shown.includes('Synthetic notice'));

  const frozen = run('frozen');
  ended(frozen, 'frozen');
  reached(frozen, 'frozen', 'synthetic: the page stopped');
  assert.equal(frozen.status, 1, 'frozen: exits with an error' + said(frozen));
  assert.match(
    frozen.stderr,
    /^stalled for \d+ s at: synthetic: the page stopped$/mu,
    'frozen: names its stage' + said(frozen),
  );
  assert.match(frozen.stderr, /the page did not answer within 5 s/u);

  const moving = run('moving');
  ended(moving, 'moving');
  reached(moving, 'moving', 'synthetic: three');
  assert.equal(moving.status, 0, 'moving: exits cleanly' + said(moving));
  assert.doesNotMatch(moving.stderr, /stalled/u);

  const stopped = run('stopped');
  ended(stopped, 'stopped');
  reached(stopped, 'stopped', 'synthetic: done');
  assert.equal(stopped.status, 0, 'stopped: exits cleanly' + said(stopped));
  assert.doesNotMatch(stopped.stderr, /stalled/u);

  console.log(
    JSON.stringify({
      stalled: { status: stalled.status, frame: state.frame },
      frozen: { status: frozen.status },
      moving: { status: moving.status },
      stopped: { status: stopped.status },
    }),
  );
}
