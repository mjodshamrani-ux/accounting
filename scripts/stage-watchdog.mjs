// A browser check that stops without an error says where it stopped.
//
// The review platform interface mutation gate gives each of its baseline
// checks fifteen minutes and keeps only the end of its output, and a page
// that stops drawing frames leaves an evaluate waiting with no timeout. So
// three such stops printed nothing: the running balance check in CI on
// 330fe25, the main overlap check in CI on 3b10017, and the section
// families check in a local run on the tree of 5714e47. Their cause is not
// established.
//
// A check names each stage as it enters it (a case, a language, a phase).
// After `limit` milliseconds on one stage the watchdog prints the stage,
// whether the current page still answers and draws a frame within a
// second, its address, the element with the focus and the notices it
// shows, and exits with an error. The limit is four minutes unless a check
// says otherwise, inside the gate's fifteen; a stage is one case or phase.
// It reads the page only; it changes nothing on it. It does not make a
// check pass: a check that stalls still fails, now with the place it
// stopped.
//
//   const watch = stageWatchdog({ page: () => activePage });
//   watch.at('ar-case-1: sources'); ... watch.stop();
//
// scripts/stage-watchdog-self-test.mjs holds it to that: a check that
// stalls on a page is stopped with its stage and the page's state, and a
// check that moves on in time is not stopped.

// What the page shows when the check stopped there; a page that does not
// answer within five seconds says so instead.
export const pageState = (page) =>
  Promise.race([
    page.evaluate(async () => ({
      url: location.href,
      visibility: document.visibilityState,
      frame: await new Promise((resolve) => {
        requestAnimationFrame(() => resolve('drawn'));
        setTimeout(() => resolve('no frame within 1 s'), 1000);
      }),
      active: `${document.activeElement?.tagName} ${(document.activeElement?.textContent ?? '').trim().slice(0, 80)}`,
      shown: [
        ...document.querySelectorAll(
          '.notice, [role=alert], .hint.warn, output',
        ),
      ]
        .map((el) => el.textContent.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 12),
    })),
    new Promise((resolve) =>
      setTimeout(() => resolve('the page did not answer within 5 s'), 5000),
    ),
  ]).catch((error) => String(error));

export function stageWatchdog({
  page = () => undefined,
  limit = 240000,
  every = 15000,
} = {}) {
  let stage = 'start';
  let since = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - since < limit) return;
    clearInterval(timer);
    const seconds = Math.round((Date.now() - since) / 1000);
    console.error(`stalled for ${seconds} s at: ${stage}`);
    const current = page();
    if (current && !current.isClosed())
      console.error(JSON.stringify(await pageState(current)));
    process.exit(1);
  }, every);
  // The watchdog alone never keeps a finished check alive.
  timer.unref();
  // Plain functions, so a check can hand `at` to a helper on its own.
  return {
    at: (name) => {
      stage = name;
      since = Date.now();
      console.log('stage: ' + name);
    },
    stop: () => {
      clearInterval(timer);
    },
  };
}
