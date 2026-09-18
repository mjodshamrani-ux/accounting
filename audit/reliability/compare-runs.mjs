import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [beforeDir, afterDir, output = 'audit/reliability/evidence-0.4.6.json'] =
  process.argv.slice(2);
if (!beforeDir || !afterDir)
  throw Error('Usage: compare-runs.mjs BEFORE_DIR AFTER_DIR [OUTPUT_JSON]');
const before = JSON.parse(
  await readFile(resolve(beforeDir, 'summary.json'), 'utf8'),
);
const after = JSON.parse(
  await readFile(resolve(afterDir, 'summary.json'), 'utf8'),
);
for (const field of [
  'seed',
  'generatorVersion',
  'evaluatorVersion',
  'verifierVersion',
  'focusedVersion',
  'inputEvidenceVersion',
  'suite',
  'exports',
  'externalInputs',
  'caseIds',
])
  assert.deepEqual(
    before[field],
    after[field],
    `Different comparison configuration: ${field}`,
  );
assert.deepEqual(
  before.manifest,
  after.manifest,
  'Compare exactly the same corpus',
);
for (const key of [
  'generator.mjs',
  'focused-generator.mjs',
  'group-evidence.mjs',
  'input-evidence.mjs',
  'manifest.mjs',
  'renderers.mjs',
  'evaluate.mjs',
  'verify-workbook.mjs',
  'report.mjs',
])
  assert.equal(
    before.hashes['audit/reliability/' + key],
    after.hashes['audit/reliability/' + key],
    `Different evaluator: ${key}`,
  );
const publishable = (s) => ({
  engineVersion: s.engineVersion,
  generatorVersion: s.generatorVersion,
  evaluatorVersion: s.evaluatorVersion,
  verifierVersion: s.verifierVersion,
  focusedVersion: s.focusedVersion,
  inputEvidenceVersion: s.inputEvidenceVersion,
  suite: s.suite,
  externalInputs: s.externalInputs,
  caseIds: s.caseIds,
  datasetStatus: s.datasetStatus,
  seed: s.seed,
  node: s.node,
  platform: s.platform,
  arch: s.arch,
  cpu: s.cpu,
  memoryBytes: s.memoryBytes,
  startedAt: s.startedAt,
  finishedAt: s.finishedAt,
  exports: s.exports,
  manifest: s.manifest,
  hashes: s.hashes,
  elapsedSeconds: s.elapsedSeconds,
  peakRssBytes: s.peakRssBytes,
  durationMs: s.durationMs,
  distinctEconomicFingerprints: s.distinctEconomicFingerprints,
  overall: s.overall,
  byCategory: s.byCategory,
  bySplit: s.bySplit,
  byFamily: s.byFamily,
  byScenario: s.byScenario,
  byNovelty: s.byNovelty,
  warning: s.warning,
});
const result = {
  before: publishable(before),
  after: publishable(after),
  note: 'Counts describe synthetic cases, not market accuracy. Old 5000 are known regression. Every scope/sign entry comes from visible source evidence; external inputs are separately declared and counted. Unresolved input stops are not completed reconciliations. Proved groups are mandatory, while generic payment references remain review. Compare completion and intervention distributions alongside false matches.',
};
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    before: before.overall.cases,
    after: after.overall.cases,
    afterPassed: after.overall.passed,
    falseMatches: {
      before: before.overall.falseMatches,
      after: after.overall.falseMatches,
    },
    output: resolve(output),
  }),
);
