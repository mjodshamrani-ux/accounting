import {
  mkdir,
  writeFile,
  appendFile,
  readFile,
  readdir,
} from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import {
  buildManifest,
  summarizeManifest,
  DEFAULT_SEED,
  GENERATOR_VERSION,
} from './manifest.mjs';
import { generateCase } from './generator.mjs';
import { renderCase } from './renderers.mjs';
import { loadEngine, evaluateCase } from './evaluate.mjs';
import { aggregate } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const engineRoot = resolve(value('--engine-root', root));
const engine = await loadEngine(engineRoot);
const count = Number(
  value('--count', args.includes('--quick') ? '40' : '5000'),
);
const seed = Number(value('--seed', String(DEFAULT_SEED)));
const split = value(
  '--split',
  args.includes('--quick') ? 'development' : 'development,validation',
);
let manifest = buildManifest({ seed, count });
if (value('--case', ''))
  manifest = buildManifest({ seed, count: 5000 }).filter(
    (c) => c.id === value('--case', ''),
  );
else manifest = manifest.filter((c) => split.split(',').includes(c.split));
if (!manifest.length) throw Error('No selected cases');
if (manifest.some((c) => c.split === 'final') && !args.includes('--frozen'))
  throw Error('Final holdout requires --frozen after the engine is frozen');
const output = resolve(
  value(
    '--output',
    resolve(
      root,
      'work/reliability',
      new Date().toISOString().replace(/[:.]/g, '-'),
    ),
  ),
);
await mkdir(output, { recursive: true });
const runConfig = {
  generatorVersion: GENERATOR_VERSION,
  seed,
  count,
  split,
  engineRoot,
  engineVersion: engine.ENGINE_VERSION,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0]?.model,
  memoryBytes: os.totalmem(),
  startedAt: new Date().toISOString(),
  exports: !args.includes('--no-export'),
  manifest: summarizeManifest(manifest),
  hashes: {},
};
for (const path of (await readdir(resolve(engineRoot, 'lib/reconciliation')))
  .filter((p) => p.endsWith('.ts'))
  .sort()
  .map((p) => 'lib/reconciliation/' + p))
  runConfig.hashes[path] = createHash('sha256')
    .update(await readFile(resolve(engineRoot, path)))
    .digest('hex');
for (const path of [
  'generator.mjs',
  'manifest.mjs',
  'renderers.mjs',
  'evaluate.mjs',
  'verify-workbook.mjs',
  'report.mjs',
  'run.mjs',
])
  runConfig.hashes['audit/reliability/' + path] = createHash('sha256')
    .update(await readFile(resolve(here, path)))
    .digest('hex');
if (value('--freeze-file', '')) {
  const freeze = JSON.parse(
    await readFile(resolve(value('--freeze-file', '')), 'utf8'),
  );
  if (JSON.stringify(freeze.hashes) !== JSON.stringify(runConfig.hashes))
    throw Error(
      'Frozen engine/evaluator hashes changed; do not describe this as the same holdout evaluation',
    );
}
if (args.includes('--freeze-only')) {
  await writeFile(
    resolve(output, 'freeze.json'),
    JSON.stringify(runConfig, null, 2),
  );
  console.log(
    JSON.stringify({
      frozen: output,
      engine: engine.ENGINE_VERSION,
      generator: GENERATOR_VERSION,
    }),
  );
  process.exit(0);
}
await writeFile(
  resolve(output, 'config.json'),
  JSON.stringify(runConfig, null, 2),
);
await writeFile(resolve(output, 'cases.jsonl'), '');
const records = [],
  fingerprints = new Set();
let peakRss = process.memoryUsage().rss,
  started = performance.now();
for (const descriptor of manifest) {
  const spec = generateCase(descriptor),
    rendered = await renderCase(spec);
  const record = await evaluateCase(spec, rendered, engine, {
    exports: runConfig.exports,
  });
  records.push(record);
  fingerprints.add(spec.economicFingerprint);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  await appendFile(
    resolve(output, 'cases.jsonl'),
    JSON.stringify(record) + '\n',
  );
  if (args.includes('--save-files') || value('--case', '')) {
    const folder = resolve(output, descriptor.id);
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, 'oracle.json'),
      JSON.stringify(spec, null, 2),
    );
    for (const file of rendered.files)
      await writeFile(resolve(folder, file.name), file.bytes);
  }
  if (records.length % 100 === 0 || records.length === manifest.length)
    console.log(
      JSON.stringify({
        completed: records.length,
        total: manifest.length,
        pass: records.filter((r) => r.pass).length,
        safetyFailures: records.filter((r) => !r.safetyPass).length,
        elapsedSeconds: Math.round((performance.now() - started) / 1000),
      }),
    );
}
const grouped = (field) =>
  Object.fromEntries(
    [
      ...new Set(
        records.flatMap((r) =>
          Array.isArray(r[field]) ? r[field] : [r[field]],
        ),
      ),
    ].map((v) => [
      v,
      aggregate(
        records.filter((r) =>
          Array.isArray(r[field]) ? r[field].includes(v) : r[field] === v,
        ),
      ),
    ]),
  );
const durations = records.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  ...runConfig,
  finishedAt: new Date().toISOString(),
  elapsedSeconds: (performance.now() - started) / 1000,
  peakRssBytes: peakRss,
  durationMs: {
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[
      Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
    ],
    max: durations.at(-1),
  },
  distinctEconomicFingerprints: fingerprints.size,
  overall: aggregate(records),
  byCategory: grouped('category'),
  bySplit: grouped('split'),
  byFamily: grouped('families'),
  byScenario: grouped('scenario'),
  warning:
    'Synthetic internal assessment, not market validation. Source scope/sign and ambiguous formats are explicit simulated user confirmations. PDF visual review remains required.',
};
await writeFile(
  resolve(output, 'summary.json'),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({
    output,
    overall: summary.overall,
    elapsedSeconds: summary.elapsedSeconds,
  }),
);
if (records.some((r) => !r.pass)) process.exitCode = 1;
