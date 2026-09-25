// Hard-case campaign runner.
//   node --experimental-strip-types audit/hard-cases/run.mjs --split development --count 12000 --mode logical --out work/hard/dev
//   ... --engine-root work/base-888415f   (measure another engine tree)
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const engine = await loadHardEngine(resolve(args['engine-root']));
const manifest = hardManifest(args.split, Number(args.count), {
  fileRuns: args.mode === 'file',
}).filter((d) => !args.template || d.template.startsWith(args.template));
mkdirSync(args.out, { recursive: true });
const casesFile = resolve(args.out, 'cases.jsonl');
writeFileSync(casesFile, '');
const records = [];
const started = Date.now();
for (const d of manifest) {
  const spec = buildHardCase(d);
  const record = await evaluateHardCase(spec, engine, args.mode);
  records.push(record);
  appendFileSync(casesFile, JSON.stringify(record) + '\n');
}
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
  confirmations: rs.reduce((t, r) => t + r.confirmations.length, 0),
  crashes: rs.filter((r) => r.stopped?.kind === 'crash').length,
});
const by = (key) =>
  Object.fromEntries(
    [...new Set(records.map((r) => r[key]))]
      .sort()
      .map((k) => [k, aggregate(records.filter((r) => r[key] === k))]),
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
      overall: summary.overall,
      timingMs: summary.timingMs,
    },
    null,
    1,
  ),
);
