// Minimises failing hard cases: for each distinct (template, variant,
// verdict) failure in a run, rebuild the first failing scenario and drop
// rows one at a time, keeping a removal only while the same verdict still
// results on the same engine. Control rows go with their oracle entries.
//   node --experimental-strip-types audit/hard-cases/minimize.mjs \
//     --run work/hard/m/base-development-logical --engine-root work/base-888415f \
//     --out audit/hard-cases/results/campaign-v1/minimized-base.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hardManifest, buildHardCase } from './scenarios.mjs';
import { evaluateHardCase, loadHardEngine } from './evaluate.mjs';

const { values: args } = parseArgs({
  options: {
    run: { type: 'string' },
    'engine-root': { type: 'string', default: '.' },
    out: { type: 'string', default: '' },
    // Optional second engine: the minimised case is also judged there.
    'check-root': { type: 'string', default: '' },
  },
});
const summary = JSON.parse(readFileSync(`${args.run}/summary.json`, 'utf8'));
const records = readFileSync(`${args.run}/cases.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const engine = await loadHardEngine(resolve(args['engine-root']));
const other = args['check-root']
  ? await loadHardEngine(resolve(args['check-root']))
  : null;
const manifest = new Map(
  hardManifest(summary.split, summary.overall.scenarios, {
    fileRuns: summary.mode === 'file',
  }).map((d) => [d.id, d]),
);
const firsts = new Map();
for (const r of records)
  if (r.verdict !== 'pass') {
    const k = `${r.template}|${r.variant}|${r.verdict}`;
    if (!firsts.has(k)) firsts.set(k, r);
  }

const without = (spec, key) => {
  const next = structuredClone(spec);
  for (const source of next.sources)
    source.rows = source.rows.filter((row) => row.key !== key);
  next.oracle.approved = next.oracle.approved.filter(
    (g) => !g.control || ![...g.a, ...g.b].includes(key),
  );
  return next;
};
const out = [];
for (const [k, record] of firsts) {
  let spec = buildHardCase(manifest.get(record.id));
  const protectedKeys = new Set([
    ...spec.oracle.targetKeys,
    ...spec.oracle.approved
      .filter((g) => !g.control)
      .flatMap((g) => [...g.a, ...g.b]),
  ]);
  const before = spec.sources.reduce((n, s) => n + s.rows.length, 0);
  for (const key of spec.sources.flatMap((s) => s.rows.map((r) => r.key))) {
    if (protectedKeys.has(key)) continue;
    const candidate = without(spec, key);
    const result = await evaluateHardCase(candidate, engine, summary.mode);
    if (result.verdict === record.verdict) spec = candidate;
  }
  const check = await evaluateHardCase(spec, engine, summary.mode);
  out.push({
    failure: k,
    id: record.id,
    seed: record.seed,
    rowsBefore: before,
    rowsAfter: spec.sources.reduce((n, s) => n + s.rows.length, 0),
    verdictAfterMinimising: check.verdict,
    ...(other
      ? {
          checkRoot: args['check-root'],
          checkVerdict: (await evaluateHardCase(spec, other, summary.mode))
            .verdict,
        }
      : {}),
    findings: check.findings,
    sources: spec.sources.map((s) => ({
      side: s.side,
      layout: s.layout,
      rows: s.rows.map(({ key, tag, ...row }) => ({ key, tag, ...row })),
    })),
    oracle: spec.oracle,
  });
  console.log(
    `${k}: ${before} -> ${out.at(-1).rowsAfter} rows (${check.verdict}${other ? `; ${args['check-root']}: ${out.at(-1).checkVerdict}` : ''})`,
  );
}
if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 2));
