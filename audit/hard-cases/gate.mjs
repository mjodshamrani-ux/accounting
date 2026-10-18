// EVAL-1 gate: the living hard-case measurement, run on every change.
//   node --experimental-strip-types audit/hard-cases/gate.mjs \
//     [--engine-root .] [--out work/hard/gate] [--scale 1]
// Runs the development, holdout and counter splits (logical mode, unaided and
// after declared assistance) and fails when:
//   1. any case approves wrongly, approves wrong members, misreads silently,
//      loses a row or crashes; no triage entry excuses these;
//   2. any other non-passing verdict is not named in triage.mjs;
//   3. a triage key ran and no longer fails (the register went stale).
// Writes summary.json and summary.md to --out, and appends the Markdown to
// $GITHUB_STEP_SUMMARY when present, so each CI run publishes the figures.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { judge } from './gate-rules.mjs';
import { CONTRACT_HISTORY } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    'engine-root': { type: 'string', default: '.' },
    out: { type: 'string', default: 'work/hard/gate' },
    scale: { type: 'string', default: '1' },
  },
});
const scale = Number(args.scale);
if (!(scale > 0)) throw new Error('--scale must be positive');
const SPLITS = [
  ['development', 1200],
  ['holdout', 800],
  ['counter', 600],
];

const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const runs = [];
for (const [split, base] of SPLITS) {
  const count = Math.round(base * scale);
  const dir = resolve(out, split);
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      resolve(here, 'run.mjs'),
      '--split',
      split,
      '--count',
      String(count),
      '--mode',
      'logical',
      '--engine-root',
      args['engine-root'],
      '--out',
      dir,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error(`run.mjs failed for ${split}`);
  }
  const lines = (file) =>
    readFileSync(resolve(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  runs.push({
    split,
    count,
    summary: JSON.parse(readFileSync(resolve(dir, 'summary.json'), 'utf8')),
    records: [...lines('cases.jsonl'), ...lines('cases-unaided.jsonl')],
  });
}

const { unsafe, untriaged, stale, triaged } = judge(
  runs.flatMap((run) => run.records),
);

const total = (pick) => runs.reduce((n, run) => n + pick(run.summary), 0);
const figures = {
  scenarios: total((s) => s.overall.scenarios),
  declaredPass: total((s) => s.overall.verdicts.pass ?? 0),
  unaidedPass: total((s) => s.unaided.overall.verdicts.pass ?? 0),
  falseApprovals: total(
    (s) =>
      s.overall.falseApprovals +
      s.overall.wrongMemberGroups +
      s.unaided.overall.falseApprovals +
      s.unaided.overall.wrongMemberGroups,
  ),
  silentMisreads: total(
    (s) => s.overall.silentMisreads + s.unaided.overall.silentMisreads,
  ),
  evidenceLostDeclared: total((s) => s.overall.evidenceLost),
  crashes: total((s) => s.overall.crashes + s.unaided.overall.crashes),
};
const passed = !unsafe.length && !untriaged.length && !stale.length;
const first = runs[0].summary;
const summary = {
  gate: 'tarasuf-eval-1',
  passed,
  provenance: first.provenance,
  versions: first.versions,
  splits: runs.map((r) => ({
    split: r.split,
    scenarios: r.summary.overall.scenarios,
    declaredPass: r.summary.overall.verdicts.pass ?? 0,
    unaidedPass: r.summary.unaided.overall.verdicts.pass ?? 0,
  })),
  figures,
  unsafe: unsafe.slice(0, 50),
  untriaged: untriaged.slice(0, 50),
  stale,
  triaged: Object.fromEntries(triaged),
  contractHistory: CONTRACT_HISTORY,
};
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));

const md = [
  `## EVAL-1 hard-case gate: ${passed ? 'passed' : 'FAILED'}`,
  '',
  `Engine \`${first.provenance.engine.commit.slice(0, 12)}\`${first.provenance.engine.engineFilesModified ? ' (modified)' : ''} · ${first.versions.scenarios} · ${first.versions.evaluator}`,
  '',
  '| split | scenarios | pass (declared) | pass (unaided) |',
  '| --- | ---: | ---: | ---: |',
  ...summary.splits.map(
    (s) =>
      `| ${s.split} | ${s.scenarios} | ${s.declaredPass} | ${s.unaidedPass} |`,
  ),
  '',
  `False approvals (incl. wrong members, both modes): **${figures.falseApprovals}** · silent misreads: **${figures.silentMisreads}** · crashes: **${figures.crashes}** · evidence lost (declared): **${figures.evidenceLostDeclared}**`,
  '',
  '### Triaged known failures',
  '',
  ...(triaged.size ? [...triaged].map(([k, n]) => `- ${k}: ${n}`) : ['- none']),
  ...(unsafe.length
    ? ['', '### Unsafe', '', ...unsafe.slice(0, 20).map((l) => `- ${l}`)]
    : []),
  ...(untriaged.length
    ? ['', '### Untriaged', '', ...untriaged.slice(0, 20).map((l) => `- ${l}`)]
    : []),
  ...(stale.length
    ? ['', '### Stale triage', '', ...stale.map((l) => `- ${l}`)]
    : []),
  '',
].join('\n');
writeFileSync(resolve(out, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
if (!passed) process.exitCode = 1;
