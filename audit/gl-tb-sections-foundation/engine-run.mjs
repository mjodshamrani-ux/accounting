// GLT-1 engine run: the gl-tb-sections-1 engine on the sealed foundation,
// through the worker's replay (original bytes read again, hashes checked),
// compared in full with the sealed oracle's EXPECTED.json: every account's
// status, codes and six components on both sides, the excluded sections and
// pages, the orphan totals, what was not placed under an account, and the
// run codes.
//
//   node --experimental-strip-types audit/gl-tb-sections-foundation/engine-run.mjs [--out file] [--assert file]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SUITE = resolve(
  root,
  process.env.GLS_SUITE ?? 'audit/gl-tb-sections-foundation',
);
const FROZEN = resolve(SUITE, 'frozen');
const lib = (name) =>
  import(pathToFileURL(resolve(root, 'lib/reconciliation', name)).href);
const { readFile } = await lib('io.ts');
const { GLS_VERSION } = await lib('gl-tb-sections.ts');
const { replayGlTbSections } = await lib('gl-tb-sections-io.ts');

const FIELDS = {
  entity: 'Entity',
  ledger: 'Ledger',
  currency: 'Currency',
  currencyBasis: 'Currency basis',
  postingStatus: 'Posting status',
  postingLayer: 'Posting layer',
  start: 'Period start',
  end: 'Period end',
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The engine's result in the oracle's words.
export function asOracle(r) {
  return {
    accounts: Object.fromEntries(
      r.accounts.map((a) => [
        a.key,
        { status: a.status, codes: a.codes, gl: a.gl, tb: a.tb },
      ]),
    ),
    excludedSections: r.excludedSections.map((s) => s.id).sort(byText),
    excludedPages: r.excludedPages.map((p) => p.id).sort(byText),
    orphanTotals: r.orphanTotals.map((t) => t.key).sort(byText),
    unplaced: r.unplaced.map((u) => [u.file, `row ${u.row}`, [u.code]]),
    run: r.run,
  };
}
const canonical = (v) =>
  JSON.stringify({
    ...v,
    accounts: Object.fromEntries(
      Object.entries(v.accounts).sort(([a], [b]) => byText(a, b)),
    ),
  });

async function story(sid) {
  const bytes = (name) => {
    const b = readFileSync(resolve(FROZEN, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const run = JSON.parse(new TextDecoder().decode(bytes(`${sid}-scope.json`)));
  try {
    const files = [
      await readFile(`${sid}-gl.csv`, bytes(`${sid}-gl.csv`)),
      await readFile(`${sid}-tb.csv`, bytes(`${sid}-tb.csv`)),
    ];
    const { result } = await replayGlTbSections({
      files,
      readings: [
        { sheet: 0, role: 'gl-sections', family: GLS_VERSION, confirmed: true },
        { sheet: 0, role: 'tb-pages', family: GLS_VERSION, confirmed: true },
      ],
      scope: {
        ...Object.fromEntries(
          Object.entries(FIELDS).map(([k, label]) => [k, run[label]]),
        ),
        confirmed: true,
      },
    });
    return asOracle(result);
  } catch (error) {
    return { refused: String(error?.message ?? error) };
  }
}

const git = (...c) =>
  spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

export async function engineRun() {
  const expected = JSON.parse(
    readFileSync(resolve(FROZEN, 'EXPECTED.json'), 'utf8'),
  ).stories;
  const stories = {};
  for (const sid of Object.keys(expected)) {
    const got = await story(sid);
    const equal = canonical(got) === canonical(expected[sid]);
    stories[sid] = equal
      ? { equal }
      : {
          equal,
          got,
          accounts: Object.keys({
            ...expected[sid].accounts,
            ...got.accounts,
          })
            .sort(byText)
            .filter(
              (k) =>
                JSON.stringify(got.accounts?.[k]) !==
                JSON.stringify(expected[sid].accounts?.[k]),
            ),
        };
  }
  const accounts = Object.values(expected).reduce(
    (n, s) => n + Object.keys(s.accounts ?? {}).length,
    0,
  );
  return {
    schema: 'tarasuf-glt1-sections-engine-run/1',
    engine: GLS_VERSION,
    suite: SUITE.slice(root.length + 1),
    commit: git('rev-parse', 'HEAD'),
    summary: {
      stories: Object.keys(stories).length,
      equal: Object.values(stories).filter((s) => s.equal).length,
      accounts,
      differing: Object.entries(stories)
        .filter(([, s]) => !s.equal)
        .map(
          ([sid, s]) => `${sid}: ${(s.accounts ?? []).join(', ') || 'lists'}`,
        ),
    },
    stories,
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: { out: { type: 'string' }, assert: { type: 'string' } },
  });
  const report = await engineRun();
  console.log(JSON.stringify(report.summary));
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n');
  if (args.assert) {
    const want = JSON.parse(readFileSync(args.assert, 'utf8'));
    const strip = (r) =>
      JSON.stringify({ summary: r.summary, stories: r.stories });
    if (strip(want) !== strip(report)) {
      console.error('the run differs from', args.assert);
      process.exit(1);
    }
    console.log('the run equals', args.assert);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
