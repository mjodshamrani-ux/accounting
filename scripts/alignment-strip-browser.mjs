// The alignment strip (UX-4) says what the engine wrote, in every workspace.
//
// For each of the twelve workspaces, in Arabic and in English, the check
// runs the workspace's own synthetic example and keeps the engine reply the
// page drew its result from (the worker's reply to the workspace's
// reconcile request). From that reply alone, by rules written here and not
// taken from lib/alignment-strip.ts, it works out what the strip must say:
// what aligned and of how many, what awaits a decision and its main reason,
// and each difference the engine computed with its own sign. It then reads
// the strip: the numbers it shows, the amount it draws, the totals at its
// ends, and the one sentence a screen reader reads, and requires each to be
// the engine's. At 1440, 390 and 320 px the page does not scroll sideways,
// the two records stay side by side, and the strip carries no success mark,
// no share and no agreed tone.
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

const root = path.resolve(import.meta.dirname, '..');
const dist = process.env.ALIGNMENT_STRIP_DIST ?? path.join(root, 'dist');
const only = process.env.ALIGNMENT_STRIP_ONLY?.split(',');

// The engine's sign, read whole: minor units to the text the page shows,
// grouped by thousands at the currency's precision, written here apart from
// the page's own formatter.
function written(minor, decimals) {
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = decimals ? `${grouped}.${digits.slice(-decimals)}` : grouped;
  return (minor < 0 ? '-' : '') + text;
}

// The reason given most often among what waits; a tie goes to the first.
function mainReason(reasons) {
  const seen = [];
  for (const r of reasons) {
    const entry = seen.find((e) => e.reason === r);
    if (entry) entry.n++;
    else seen.push({ reason: r, n: 1 });
  }
  return seen.reduce((best, e) => (!best || e.n > best.n ? e : best), null)
    ?.reason;
}

// What the strip must say, from the engine reply alone. `differences` are
// the values the engine computed, in its order, null where it computed none.
const count = (items, test) => items.filter(test).length;
const EXPECTED = {
  supplier: {
    action: 'reconcile',
    expect: (r) => ({
      agreed: { count: count(r.cases, (c) => c.status === 'Matched') },
      review: {
        kind: 'count',
        count: count(r.cases, (c) => c.status === 'Needs Review'),
        reason: null,
      },
      differences: r.bridge ? [r.bridge.delta] : null,
      decimals: r.scope.decimals,
    }),
  },
  ar: {
    action: 'ar-reconcile',
    expect: (r) => {
      const waiting = r.cases.filter((c) => c.status === 'review');
      return {
        agreed: { count: count(r.cases, (c) => c.status === 'matched') },
        review: {
          kind: 'count',
          count: waiting.length,
          reason: waiting.length
            ? mainReason(waiting.map((c) => c.reason))
            : null,
        },
        differences: null,
        totals: r.totals,
      };
    },
  },
  bank: {
    action: 'bank-reconcile',
    expect: (r) => {
      const waiting = r.cases.filter(
        (c) => c.status === 'needs-review' || c.status === 'source-error',
      );
      return {
        agreed: {
          count: count(r.cases, (c) =>
            ['matched-evidence', 'matched-manual'].includes(c.status),
          ),
        },
        review: {
          kind: 'count',
          count: waiting.length,
          reason: waiting.length
            ? mainReason(waiting.map((c) => c.reason))
            : null,
        },
        differences: null,
      };
    },
  },
  clearing: {
    action: 'clearing-reconcile',
    steps: async (panel) => {
      await panel
        .getByLabel(/راجعت معنى الأعمدة|I reviewed the column meanings/u)
        .check({ timeout: 30000 });
      await panel
        .getByRole('button', { name: /فحص المقاصة|Check clearing/u })
        .click();
    },
    expect: (r) => {
      const waiting = r.cases.filter((c) => c.status === 'review');
      return {
        agreed: { count: count(r.cases, (c) => c.status === 'cleared') },
        review: {
          kind: 'count',
          count: waiting.length,
          reason: waiting.length
            ? mainReason(waiting.map((c) => c.reason))
            : null,
        },
        differences: [r.total],
        sides: 1,
      };
    },
  },
  allocation: {
    action: 'allocation-reconcile',
    expect: (r) => ({
      agreed: { count: r.links.length },
      review: { kind: 'state' },
      differences: null,
    }),
  },
  'gl-tb': {
    action: 'gl-tb-reconcile',
    expect: (r) => {
      const fields = r.differences ? Object.values(r.differences) : null;
      return {
        agreed: fields
          ? { count: count(fields, (v) => v === 0), of: fields.length }
          : { count: 0 },
        review: { kind: 'state' },
        differences: fields,
      };
    },
  },
  intercompany: {
    action: 'intercompany-reconcile',
    expect: (r) => {
      const waiting = r.pairs.filter((p) => p.review === 'needs-review');
      return {
        agreed: {
          count: count(r.pairs, (p) => p.status === 'ready'),
          of: r.pairs.length,
        },
        review: {
          kind: 'count',
          count: waiting.length,
          reason: waiting.length
            ? mainReason(waiting.map((p) => p.status))
            : null,
        },
        differences: null,
      };
    },
  },
  stock: {
    action: 'stock-reconcile',
    expect: (r) => ({
      agreed: {
        count: count(r.comparisons, (c) => c.differenceMinor === 0),
        of: r.comparisons.length,
      },
      review: { kind: 'whole', review: r.review },
      differences: r.comparisons.map((c) => c.differenceMinor),
      totals: r.totals ? [r.totals.registerMinor, r.totals.glMinor] : null,
    }),
  },
  gateway: {
    action: 'gateway-reconcile',
    expect: (r) => ({
      agreed: r.residuals
        ? {
            count: count(r.residuals, (v) => v === 0),
            of: r.residuals.length,
          }
        : { count: 0 },
      review: { kind: 'whole', review: r.review },
      differences: r.residuals,
    }),
  },
  payroll: {
    action: 'payroll-reconcile',
    expect: (r) => {
      const values = [
        ...r.comparisons.map((c) => c.difference),
        r.bankComparison.difference,
      ];
      return {
        agreed: { count: count(values, (v) => v === 0), of: values.length },
        review: { kind: 'whole', review: r.review },
        differences: values,
      };
    },
  },
  assets: {
    action: 'asset-reconcile',
    expect: (r) => ({
      agreed: {
        count: count(r.comparisons, (c) => c.difference === 0),
        of: r.comparisons.length,
      },
      review: { kind: 'whole', review: r.review },
      differences: r.comparisons.map((c) => c.difference),
    }),
  },
  'tb-financial': {
    action: 'tb-financial-reconcile',
    expect: (r) => {
      const values = [
        ...(r.tb ? [r.tb.residual] : []),
        ...r.lines.map((l) => l.difference),
      ];
      return {
        agreed: { count: count(values, (v) => v === 0), of: values.length },
        review: {
          kind: 'count',
          count: count(r.lines, (l) => l.review === 'needs-review'),
          reason: null,
        },
        differences: values,
      };
    },
  },
};

const words = {
  ar: {
    language: 'AR العربية',
    example: /مثال/u,
    run: /تحقق وقارن/u,
    name: 'شريط التراصف',
  },
  en: {
    language: 'EN English',
    example: /example|sample/iu,
    run: /Check and compare/u,
    name: 'Alignment strip',
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

// Keeps every worker reply the page receives, as the page receives it.
function keepReplies() {
  const descriptor = Object.getOwnPropertyDescriptor(
    Worker.prototype,
    'onmessage',
  );
  const handlers = new WeakMap();
  globalThis.alignmentReplies = [];
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return handlers.get(this) ?? null;
    },
    set(handler) {
      handlers.set(this, handler);
      descriptor.set.call(
        this,
        typeof handler === 'function'
          ? function (event) {
              if (event.data && Object.hasOwn(event.data, 'value'))
                globalThis.alignmentReplies.push({
                  action: event.data.action,
                  value: structuredClone(event.data.value),
                });
              return handler.call(this, event);
            }
          : handler,
      );
    },
  });
}

// What the strip shows and what a screen reader reads, at the current width.
const readStrip = (strip) =>
  strip.evaluate((el) => {
    const cell = (name) => el.querySelector(`[data-strip-cell="${name}"]`);
    const box = (node) => node?.getBoundingClientRect();
    const drawn = el.querySelector('.alignment-strip__drawn');
    const sentence = el.querySelector('[data-strip-sentence]');
    const sb = box(sentence);
    const amount = cell('gap').querySelector('[data-amount-minor]');
    return {
      label: el.getAttribute('aria-label'),
      sides: el.getAttribute('data-sides'),
      drawnHidden: drawn?.getAttribute('aria-hidden'),
      sentence: sentence?.textContent ?? null,
      sentenceHidden: sentence?.getAttribute('aria-hidden'),
      sentenceSize: sb ? [sb.width, sb.height] : null,
      agreed: {
        count: cell('agreed').dataset.count,
        of: cell('agreed').dataset.of ?? null,
        text: cell('agreed').querySelector('.alignment-strip__value')
          .textContent,
      },
      review: {
        kind: cell('review').dataset.kind,
        count: cell('review').dataset.count ?? null,
        reason: cell('review').dataset.reason ?? null,
        tone: cell('review').dataset.tone,
      },
      gap: {
        kind: cell('gap').dataset.kind,
        compared: cell('gap').dataset.compared ?? null,
        differences: cell('gap').dataset.differences ?? null,
        name: cell('gap').dataset.name ?? null,
        tone: cell('gap').dataset.tone,
        minor: amount?.getAttribute('data-amount-minor') ?? null,
        text: amount?.textContent ?? null,
      },
      totals: [
        ...el.querySelectorAll('[data-strip-total] [data-amount-minor]'),
      ].map((a) => ({
        minor: a.getAttribute('data-amount-minor'),
        text: a.textContent,
      })),
      papers: [...el.querySelectorAll('[data-strip-side]')].map((p) => {
        const b = p.getBoundingClientRect();
        return { top: Math.round(b.top), left: b.left, right: b.right };
      }),
      text: el.textContent,
      // Words of the drawn strip that break inside themselves across lines.
      broken: (() => {
        const found = [];
        const walker = document.createTreeWalker(drawn, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          // A hyphen is a break of its own (Company-issued), not inside a
          // word.
          for (const m of node.textContent.matchAll(/[^\s\-\u2010]+/gu)) {
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            const tops = new Set(
              [...range.getClientRects()].map((r) => Math.round(r.top)),
            );
            if (tops.size > 1) found.push(m[0]);
          }
        }
        return found;
      })(),
      agreedTone: el.querySelectorAll('[data-tone="agreed"]').length,
      icons: el.querySelectorAll('svg').length,
      right: box(el).right,
      left: box(el).left,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });

let read = 0;
for (const [domain, spec] of Object.entries(EXPECTED)) {
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
      if (domain === 'supplier') {
        const run = panel.getByRole('button', { name: words[language].run });
        await run.waitFor({ timeout: 60000 });
        await run.click();
      }
      if (spec.steps) await spec.steps(panel);
      await page.waitForFunction(
        (action) =>
          globalThis.alignmentReplies.some((r) => r.action === action),
        spec.action,
        { timeout: 60000 },
      );
      // The reply is drawn within a few frames; a result without a strip
      // fails here by assertion, not by a timeout.
      const strip = panel.locator('[data-alignment-strip]');
      const until = Date.now() + 10000;
      while (!(await strip.count()) && Date.now() < until)
        await page.waitForTimeout(100);
      assert.equal(
        await strip.count(),
        1,
        `${stage}: the result has one strip`,
      );
      const replies = await page.evaluate(
        (action) =>
          globalThis.alignmentReplies.filter((r) => r.action === action),
        spec.action,
      );
      const reply = replies.at(-1).value;
      // A workspace's reply holds its result beside the state it ran on.
      const result =
        reply && typeof reply === 'object' && 'result' in reply
          ? reply.result
          : reply;
      assert.ok(result, `${stage}: the engine reply holds a result`);
      const expected = spec.expect(result);
      const decimals = expected.decimals ?? result.decimals;
      assert.equal(typeof decimals, 'number', `${stage}: the precision`);
      const computed = expected.differences?.filter((v) => v !== null);
      const nonzero = computed?.filter((v) => v !== 0) ?? [];

      for (const width of [1440, 390, 320]) {
        const at = `${stage}/${width}`;
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const s = await readStrip(strip);
        read++;
        // The engine's numbers.
        assert.equal(
          Number(s.agreed.count),
          expected.agreed.count,
          `${at}: what aligned is the engine's count`,
        );
        assert.equal(
          s.agreed.of === null ? null : Number(s.agreed.of),
          expected.agreed.of ?? null,
          `${at}: of how many, as the engine compared`,
        );
        assert.equal(
          s.review.kind,
          expected.review.kind,
          `${at}: what awaits a decision, by the result's kind`,
        );
        if (expected.review.kind === 'count') {
          assert.equal(
            Number(s.review.count),
            expected.review.count,
            `${at}: what awaits a decision is the engine's count`,
          );
          assert.equal(
            s.review.reason,
            expected.review.reason ?? null,
            `${at}: the main reason is the engine's most frequent reason`,
          );
        }
        const waits =
          (expected.review.kind === 'count' && expected.review.count > 0) ||
          (expected.review.kind === 'whole' &&
            expected.review.review === 'needs-review');
        assert.equal(
          s.review.tone,
          waits ? 'review' : 'neutral',
          `${at}: the review tone only while something waits`,
        );
        if (!expected.differences) {
          assert.equal(s.gap.kind, 'not-computed', `${at}: no gap computed`);
          assert.equal(s.gap.minor, null, `${at}: no amount drawn as a gap`);
        } else if (!computed.length) {
          assert.equal(
            s.gap.kind,
            'blocked',
            `${at}: the gap was not computed`,
          );
        } else {
          assert.equal(s.gap.kind, 'figures', `${at}: the engine's gap`);
          assert.equal(
            Number(s.gap.compared),
            computed.length,
            `${at}: how many differences the engine computed`,
          );
          assert.equal(
            Number(s.gap.differences),
            nonzero.length,
            `${at}: how many of them are not zero`,
          );
          if (nonzero.length) {
            assert.equal(
              Number(s.gap.minor),
              nonzero[0],
              `${at}: the first difference with the engine's sign`,
            );
            assert.equal(
              s.gap.text,
              written(nonzero[0], decimals),
              `${at}: the difference as the reader reads it`,
            );
            assert.equal(
              s.gap.tone,
              'difference',
              `${at}: the difference tone`,
            );
            assert.ok(
              s.sentence.includes(written(nonzero[0], decimals)),
              `${at}: the screen reader hears the difference`,
            );
          } else {
            assert.equal(
              s.gap.minor,
              null,
              `${at}: no amount when no difference`,
            );
            assert.equal(s.gap.tone, 'neutral', `${at}: no tone at zero`);
          }
        }
        // Each record's own total, where the engine gives one.
        const totals = expected.totals ?? null;
        assert.deepEqual(
          s.totals.map((t) => (t.minor === null ? null : Number(t.minor))),
          totals ? totals.filter((t) => t !== null) : [],
          `${at}: each record's total is the engine's`,
        );
        for (const t of s.totals)
          assert.equal(
            t.text,
            written(Number(t.minor), decimals),
            `${at}: a total as the reader reads it`,
          );
        // One sentence for a screen reader, the drawn strip hidden from it.
        assert.equal(s.label, words[language].name, `${at}: the strip's name`);
        assert.equal(s.drawnHidden, 'true', `${at}: the drawing is not read`);
        assert.ok(s.sentence, `${at}: one sentence is read`);
        assert.equal(s.sentenceHidden, null, `${at}: the sentence is read`);
        assert.ok(
          s.sentenceSize[0] <= 1 && s.sentenceSize[1] <= 1,
          `${at}: the sentence is read, not drawn`,
        );
        assert.ok(
          s.sentence.includes(String(expected.agreed.count)),
          `${at}: the screen reader hears what aligned`,
        );
        if (expected.review.kind === 'count')
          assert.ok(
            s.sentence.includes(String(expected.review.count)),
            `${at}: the screen reader hears what awaits`,
          );
        // No success mark, no share, no agreed tone.
        assert.equal(s.agreedTone, 0, `${at}: no agreed tone in the strip`);
        assert.equal(s.icons, 0, `${at}: no mark in the strip`);
        assert.ok(!/[%٪✓✔]/u.test(s.text), `${at}: no share and no tick`);
        assert.deepEqual(s.broken, [], `${at}: no word breaks inside itself`);
        // The layout: no sideways scroll, the records side by side.
        assert.ok(s.overflow <= 0, `${at}: the page does not scroll sideways`);
        assert.ok(
          s.left >= 0 && s.right <= width,
          `${at}: the strip is inside the page`,
        );
        assert.equal(
          s.papers.length,
          expected.sides ?? 2,
          `${at}: the records the engine compared`,
        );
        if (s.papers.length === 2)
          assert.equal(
            s.papers[0].top,
            s.papers[1].top,
            `${at}: the two records stay side by side`,
          );
      }
      console.log(`${stage}: the strip says what the engine wrote`);
    } finally {
      await context.close();
    }
  }
}
watch.stop();
await browser.close();
server.close();
assert.deepEqual(errors, [], 'no page errors');
console.log(
  `Alignment strip: ${read} states read, each equal to its engine reply`,
);
