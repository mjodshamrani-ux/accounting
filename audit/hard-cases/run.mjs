// Hard-case campaign runner.
//   node --experimental-strip-types audit/hard-cases/run.mjs --split development --count 12000 --mode logical --out work/hard/dev
//   ... --engine-root work/base-888415f   (measure another engine tree)
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import os from 'node:os';
import {
  HARD_CASES_VERSION,
  buildHardCase,
  hardManifest,
} from './scenarios.mjs';
import {
  HARD_EVALUATOR_VERSION,
  evaluateHardCase,
  loadHardEngine,
} from './evaluate.mjs';

const { values: args } = parseArgs({
  options: {
    split: { type: 'string', default: 'development' },
    count: { type: 'string', default: '500' },
    mode: { type: 'string', default: 'logical' },
    'engine-root': { type: 'string', default: '.' },
    out: { type: 'string', default: 'work/hard/run' },
    template: { type: 'string', default: '' },
  },
});
// Every run names exactly what it measured: the engine tree's full commit
// and whether its engine files differ from that commit, and the harness
// commit with content hashes of the generator, evaluator and renderer.
const here = dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...cmd) =>
  spawnSync('git', cmd, { cwd, encoding: 'utf8' }).stdout.trim();
const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const engineRootPath = resolve(args['engine-root']);
const provenance = {
  engine: {
    root: args['engine-root'],
    commit: git(engineRootPath, 'rev-parse', 'HEAD'),
    engineFilesModified: !!git(
      engineRootPath,
      'status',
      '--porcelain',
      '--',
      'lib',
    ),
  },
  harness: {
    commit: git(here, 'rev-parse', 'HEAD'),
    modified: !!git(
      here,
      'status',
      '--porcelain',
      '--',
      '.',
      '../reliability/renderers.mjs',
    ),
    generatorSha256: sha256(resolve(here, 'scenarios.mjs')),
    evaluatorSha256: sha256(resolve(here, 'evaluate.mjs')),
    rendererSha256: sha256(resolve(here, '../reliability/renderers.mjs')),
  },
};
const engine = await loadHardEngine(resolve(args['engine-root']));
const manifest = hardManifest(args.split, Number(args.count), {
  fileRuns: args.mode === 'file',
}).filter((d) => !args.template || d.template.startsWith(args.template));
mkdirSync(args.out, { recursive: true });
// Each scenario is judged twice: as the product reads it with no help, and
// after the declared assistance a person would give (each step recorded).
const files = {
  none: resolve(args.out, 'cases-unaided.jsonl'),
  declared: resolve(args.out, 'cases.jsonl'),
};
for (const f of Object.values(files)) writeFileSync(f, '');
const runs = { none: [], declared: [] };
const started = Date.now();
for (const d of manifest) {
  const spec = buildHardCase(d);
  for (const assist of ['none', 'declared']) {
    const record = await evaluateHardCase(spec, engine, args.mode, {
      assist,
    });
    runs[assist].push(record);
    appendFileSync(files[assist], JSON.stringify(record) + '\n');
  }
}
const records = runs.declared;
const sum = (rs, k) => rs.reduce((t, r) => t + r.counts[k], 0);
const aggregate = (rs) => ({
  scenarios: rs.length,
  verdicts: Object.fromEntries(
    [...new Set(rs.map((r) => r.verdict))]
      .sort()
      .map((v) => [v, rs.filter((r) => r.verdict === v).length]),
  ),
  outcomes: Object.fromEntries(
    [...new Set(rs.map((r) => r.outcome))]
      .sort()
      .map((v) => [v, rs.filter((r) => r.outcome === v).length]),
  ),
  ...Object.fromEntries(
    Object.keys(rs[0]?.counts ?? {}).map((k) => [k, sum(rs, k)]),
  ),
  contracts: Object.fromEntries(
    [...new Set(rs.map((r) => r.contract))].sort().map((k) => [
      k,
      {
        scenarios: rs.filter((r) => r.contract === k).length,
        pass: rs.filter((r) => r.contract === k && r.verdict === 'pass').length,
      },
    ]),
  ),
  assistance: Object.fromEntries(
    [...new Set(rs.flatMap((r) => r.assistance.map((a) => a.kind)))]
      .sort()
      .map((k) => [
        k,
        rs.filter((r) => r.assistance.some((a) => a.kind === k)).length,
      ]),
  ),
  scenariosNeedingAssistance: rs.filter((r) => r.assistance.length).length,
  crashes: rs.filter((r) =>
    ['crash', 'internal-error'].includes(r.stopped?.kind),
  ).length,
});
const by = (key, rs = records) =>
  Object.fromEntries(
    [...new Set(rs.map((r) => r[key]))]
      .sort()
      .map((k) => [k, aggregate(rs.filter((r) => r[key] === k))]),
  );
const times = records.map((r) => r.ms).sort((x, y) => x - y);
const summary = {
  versions: {
    scenarios: HARD_CASES_VERSION,
    evaluator: HARD_EVALUATOR_VERSION,
    node: process.version,
  },
  environment: {
    platform: `${os.platform()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cpus: os.cpus().length,
  },
  provenance,
  engineRoot: args['engine-root'],
  split: args.split,
  mode: args.mode,
  elapsedSeconds: (Date.now() - started) / 1000,
  timingMs: {
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    max: times.at(-1),
    samples: times.length,
  },
  overall: aggregate(records),
  byFamily: by('family'),
  byTemplate: by('template'),
  unaided: {
    overall: aggregate(runs.none),
    byTemplate: by('template', runs.none),
  },
};
writeFileSync(
  resolve(args.out, 'summary.json'),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify(
    {
      split: summary.split,
      mode: summary.mode,
      overall: summary.overall.verdicts,
      unaided: summary.unaided.overall.verdicts,
      timingMs: summary.timingMs,
    },
    null,
    1,
  ),
);
