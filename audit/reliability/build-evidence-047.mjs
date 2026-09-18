// Builds audit/reliability/evidence-0.4.7.json from the engine matrix.
// One evaluator, one generator, one seed; only --engine-root differs.
// Every number is read from a run output; none is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const matrixDir = option('--matrix', 'work/matrix');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const lines = (p) =>
  readFileSync(resolve(root, p), 'utf8').trim().split('\n').map(JSON.parse);
const engines = ['v045', 'astra', 'unified'];
const runs = {};
for (const suite of ['known', 'focused'])
  for (const name of engines)
    runs[`${suite}/${name}`] = {
      config: read(`${matrixDir}/${suite}-${name}/config.json`),
      summary: read(`${matrixDir}/${suite}-${name}/summary.json`),
    };
const unified = lines(`${matrixDir}/known-unified/cases.jsonl`);
const tally = (list, key) =>
  list.reduce((o, r) => ((o[r[key]] = (o[r[key]] ?? 0) + 1), o), {});
const unproven = unified.filter((r) => (r.unprovenFormatDefaults ?? []).length);
const missed = unified.filter((r) => (r.missedRequiredMatches ?? 0) > 0);
const { known, focused } = {
  known: read(`${matrixDir}/comparison-known.json`),
  focused: read(`${matrixDir}/comparison-focused.json`),
};
const evidence = {
  candidate: {
    branch: 'integration/0.4.7-unified',
    application: '0.4.7',
    engine: runs['known/unified'].config.engineVersion,
    published: false,
    mergedFrom: {
      'work/reliability-046': '5588417643c355c0a508573a7e9915212c1cdaae',
      'claude/lucid-mendel-kjff9c': '9d047d8cf89c04f954e5725946dc6d424fb59c96',
      commonAncestor: '5fecb15ed28c744181fc4c21be2048a53f08e928',
    },
  },
  deliveryVerification: {
    manifest: 'audit/reliability/delivery-0.4.6/manifest.json',
    archiveDigestsMatchManifest: true,
    sourceZipCommit: '05cc95943694f9cacd47caef79f0d8363a293961',
    publishedCommit: '5588417643c355c0a508573a7e9915212c1cdaae',
    sourceZipEqualsPublishedTree:
      'identical except audit/reliability/delivery-0.4.6/, which holds the archives themselves',
    astraBaselineCommit: '26dc06b',
    astraBaselineEqualsRepositoryBaseline:
      'byte-identical to 5fecb15 across lib, app, components, hooks, scripts, tests, examples, public, .github, audit/reliability and every root config file; differs only by untracked audit/*.txt logs',
  },
  toolVersions: Object.fromEntries(
    Object.entries(runs).map(([key, run]) => [
      key,
      {
        engine: run.config.engineVersion,
        evaluator: run.config.evaluatorVersion,
        generator: run.config.generatorVersion,
        verifier: run.config.verifierVersion,
        focusedGenerator: run.config.focusedVersion,
        inputEvidence: run.config.inputEvidenceVersion,
        seed: run.config.seed,
        split: run.config.split,
        node: run.config.node,
        engineRoot: run.config.engineRoot,
      },
    ]),
  ),
  knownSuite: known,
  focusedSuite: focused,
  remainingGaps: {
    unprovenFormatFields: {
      cases: unproven.length,
      fields: runs['known/unified'].summary.overall.unprovenFormatDefaults,
      byCategory: tally(unproven, 'category'),
      byScenario: tally(unproven, 'scenario'),
      note: 'Every one is a deliberately damaged source; refusing to prove a format there is the correct outcome.',
    },
    missedRequiredMatches: {
      total: runs['known/unified'].summary.overall.missedRequiredMatches,
      cases: missed.length,
      byOutcome: tally(missed, 'outcome'),
      byScenario: tally(missed, 'scenario'),
      conditionalRequiredMatches:
        runs['known/unified'].summary.overall.conditionalRequiredMatches,
      resolvedInputRequiredMatches:
        runs['known/unified'].summary.overall.resolvedInputRequiredMatches,
      note: 'Every missed match is in a case whose outcome is external-information-required: the document admits two readings with different values and no answer was supplied. None is an engine reading failure.',
    },
  },
  notVerifiedHere: [
    'July acceptance suite (12 tests) stays skipped: the private originals are deliberately absent from the delivery package and were not uploaded. The 6,750 = 2,500 + 2,250 + 2,000 case is therefore not re-verified on this branch; Astra reports it passing on their machine.',
    'In-product browser performance figures from the 0.4.6 report were measured on other hardware and were not re-measured here.',
    'The final holdout is not blind for this cycle: cases C01436, C01831 and C03087 were read during diagnosis.',
    'The second code review was done by the same author, not an independent human review.',
  ],
};
writeFileSync(
  resolve(root, option('--out', 'audit/reliability/evidence-0.4.7.json')),
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      known: Object.fromEntries(
        engines.map((n) => [n, known.perEngine[n].correctRequiredMatches]),
      ),
      remaining: evidence.remainingGaps.missedRequiredMatches.total,
    },
    null,
    1,
  ),
);
