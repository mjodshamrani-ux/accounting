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
import {
  focusedManifest,
  generateFocusedCase,
  FOCUSED_VERSION,
} from './focused-generator.mjs';
import { VERIFIER_VERSION } from './verify-workbook.mjs';
import { INPUT_EVIDENCE_VERSION } from './input-evidence.mjs';
import { renderCase } from './renderers.mjs';
import { loadEngine, evaluateCase, EVALUATOR_VERSION } from './evaluate.mjs';
import { aggregate } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const suite = value('--suite', 'known');
if (!['known', 'focused', 'all'].includes(suite)) throw Error('Unknown suite');
const externalInputs = value('--external-inputs', '')
  ? JSON.parse(await readFile(resolve(value('--external-inputs', '')), 'utf8'))
  : {};
const engineRoot = resolve(value('--engine-root', root));
const engine = await loadEngine(engineRoot);
const count = Number(
  value('--count', args.includes('--quick') ? '40' : '5000'),
);
const seed = Number(value('--seed', String(DEFAULT_SEED)));
const split = value(
  '--split',
  suite === 'focused'
    ? 'development-046'
    : suite === 'all'
      ? 'development,validation,final,development-046'
      : args.includes('--quick')
        ? 'development'
        : 'development,validation',
);
const allKnown = buildManifest({ seed, count: 5000 });
let manifest = [
  ...(suite === 'focused' ? [] : buildManifest({ seed, count })),
  ...(suite === 'known' ? [] : focusedManifest()),
];
if (value('--case', ''))
  manifest = [...allKnown, ...focusedManifest()].filter(
    (c) => c.id === value('--case', ''),
  );
else manifest = manifest.filter((c) => split.split(',').includes(c.split));
if (!manifest.length) throw Error('No selected cases');
const selectsReserved = manifest.some((c) => c.split === 'final-046-b');
if (
  selectsReserved &&
  !args.includes('--freeze-only') &&
  (!args.includes('--frozen') || !value('--freeze-file', ''))
)
  throw Error(
    'New reserved combinations require --frozen --freeze-file after freezing engine, generator, verifier and configuration',
  );
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
  schemaVersion: 'tarasuf-evaluation-run-2.1.0',
  generatorVersion: GENERATOR_VERSION,
  evaluatorVersion: EVALUATOR_VERSION,
  verifierVersion: VERIFIER_VERSION,
  focusedVersion: FOCUSED_VERSION,
  inputEvidenceVersion: INPUT_EVIDENCE_VERSION,
  suite,
  externalInputs,
  caseIds: manifest.map((d) => d.id),
  datasetStatus: selectsReserved
    ? 'reserved-unopened-before-freeze'
    : suite === 'known'
      ? 'known-regression'
      : manifest.every((d) => d.split === 'final-046')
        ? 'previously-opened-reserved-now-regression'
        : 'new-development-plus-known-if-selected',
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
  .filter((p) => /\.(?:ts|js)$/.test(p))
  .sort()
  .map((p) => 'lib/reconciliation/' + p))
  runConfig.hashes[path] = createHash('sha256')
    .update(await readFile(resolve(engineRoot, path)))
    .digest('hex');
for (const path of [
  'generator.mjs',
  'focused-generator.mjs',
  'group-evidence.mjs',
  'input-evidence.mjs',
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
  for (const field of [
    'seed',
    'suite',
    'exports',
    'generatorVersion',
    'evaluatorVersion',
    'verifierVersion',
    'focusedVersion',
    'inputEvidenceVersion',
    'externalInputs',
  ])
    if (JSON.stringify(freeze[field]) !== JSON.stringify(runConfig[field]))
      throw Error(`Frozen evaluation configuration changed: ${field}`);
  if (!manifest.every((d) => freeze.caseIds.includes(d.id)))
    throw Error('Case selection exceeds frozen manifest');
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
  const spec = /^(?:G046|H046|J046)-/.test(descriptor.id)
      ? generateFocusedCase(descriptor)
      : generateCase(descriptor),
    rendered = await renderCase(spec);
  const record = await evaluateCase(spec, rendered, engine, {
    exports: runConfig.exports,
    externalInputs,
  });
  records.push(record);
  fingerprints.add(spec.economicFingerprint);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  await appendFile(
    resolve(output, 'cases.jsonl'),
    JSON.stringify(record) + '\n',
  );
  if (args.includes('--save-files') || value('--case', '') || !record.pass) {
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
  byNovelty: grouped('novelty'),
  warning:
    'Synthetic internal assessment, not market validation. The old 5000 are known regression cases. Scope/sign are entered only from printed source evidence and classified by actual intervention. Unproven locales stay unresolved unless separately declared as external user information. PDF review is simulated and counted. Safe stops are not completed comparisons.',
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
