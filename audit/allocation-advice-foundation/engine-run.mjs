// ALL-1b sealed-set run: allocation-advice-review-1 on every sealed story,
// through the family's replay from bytes and the review, compared with the
// sealed expectations in full: the refusal, the minor units, every advice
// line with its status, reasons, competitors and twins, and every payment and
// invoice with its capacity and advice. The dense stories are regenerated and
// checked against their sealed hashes first.
//
//   node --experimental-strip-types audit/allocation-advice-foundation/engine-run.mjs [--out name] [--assert name]
//
// ALL_ADVICE_SUITE selects another sealed suite (a holdout) with the same
// layout and no dense stories; --out and --assert name a file in that suite's
// results/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { input } from './baseline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SUITE = process.env.ALL_ADVICE_SUITE;
const suite = SUITE ? resolve(root, SUITE) : here;
const FROZEN = join(suite, 'frozen');
const lib = (name) =>
  pathToFileURL(join(root, 'lib/reconciliation', name)).href;
const { ALLOCATION_ADVICE_VERSION, competitorsOf, twinsOf } = await import(
  lib('allocation-advice.ts')
);
const { replayAllocationAdvice } = await import(lib('allocation-advice-io.ts'));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function asExpected(review) {
  return {
    decimals: review.decimals,
    lines: review.lines.map((l) => ({
      row: l.row,
      reference: l.reference,
      payment: l.payment,
      invoice: l.invoice,
      amount: l.amount,
      status: l.status,
      reasons: l.reasons,
      competitors: competitorsOf(review, l),
      twins: twinsOf(review, l),
    })),
    items: review.items.map((i) => ({
      side: i.side,
      row: i.row,
      reference: i.reference,
      available: i.available,
      allocated: i.allocated,
      remaining: i.remaining,
      advised: i.advised,
      excess: i.excess,
    })),
  };
}

async function judge(folder, sid, want) {
  let got;
  try {
    got = {
      refused: null,
      ...asExpected((await replayAllocationAdvice(input(folder, sid))).review),
    };
  } catch (error) {
    const m = String(error.message);
    got = {
      refused: m.startsWith('ALLOCATION_ADVICE_')
        ? m.slice('ALLOCATION_ADVICE_'.length)
        : `UNEXPECTED: ${m}`,
      decimals: want.decimals,
      lines: [],
      items: [],
    };
  }
  const expected = {
    refused: want.refused,
    decimals: want.decimals,
    lines: want.lines,
    items: want.items,
  };
  const differ = Object.keys(expected).filter(
    (k) => JSON.stringify(got[k]) !== JSON.stringify(expected[k]),
  );
  return { equal: !differ.length, differ, refused: got.refused };
}

async function dense(stories) {
  const dir = mkdtempSync(join(tmpdir(), 'all1-dense-'));
  try {
    execFileSync('python3', ['-B', join(here, 'dense.py'), dir], {
      stdio: 'ignore',
    });
    const raw = execFileSync(
      'python3',
      ['-B', join(here, 'oracle.py'), '--dense', dir],
      { maxBuffer: 1 << 30 },
    );
    const sealed = JSON.parse(
      readFileSync(join(FROZEN, 'DENSE-MANIFEST.json'), 'utf8'),
    ).expectedSha256;
    if (createHash('sha256').update(raw).digest('hex') !== sealed)
      throw Error('the dense expectations differ from the seal');
    const judged = JSON.parse(raw.toString()).stories;
    for (const sid of Object.keys(judged).sort(byText))
      stories[sid] = await judge(dir, sid, judged[sid]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const focused = JSON.parse(
    readFileSync(join(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const stories = {};
  for (const sid of Object.keys(focused).sort(byText))
    stories[sid] = await judge(FROZEN, sid, focused[sid]);
  if (!SUITE) await dense(stories);
  const equal = Object.values(stories).filter((s) => s.equal).length;
  const record = {
    schema: 'tarasuf-all1-engine-run/1',
    review: ALLOCATION_ADVICE_VERSION,
    ...(SUITE ? { suite: SUITE } : {}),
    rule: 'equal to the sealed expectations in full',
    equal,
    of: Object.keys(stories).length,
    stories,
  };
  const text = JSON.stringify(record, null, 1) + '\n';
  if (args.out) writeFileSync(join(suite, 'results', args.out), text);
  if (
    args.assert &&
    readFileSync(join(suite, 'results', args.assert), 'utf8') !== text
  ) {
    console.error('the engine run differs from its record');
    process.exit(1);
  }
  console.log(JSON.stringify({ equal, of: record.of }));
  for (const [sid, s] of Object.entries(stories))
    if (!s.equal) console.log(sid, s.differ.join(', '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
