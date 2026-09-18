// Builds audit/reliability/evidence-0.4.6.json from the two frozen runs.
// Run from the repository root after both runs exist under work/.
// Every number here is read from a run output; none is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = (dir) => ({
  summary: JSON.parse(readFileSync(resolve(root, dir, 'summary.json'), 'utf8')),
  cases: readFileSync(resolve(root, dir, 'cases.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse),
});
const before = load('work/baseline/full');
const after = load('work/final/full');
const invalidFormat = (r) =>
  (r.confirmations ?? []).filter((c) => /format invalid$/.test(c));
const index = (run) => new Map(run.cases.map((r) => [r.id, r]));
const b = index(before),
  a = index(after);
const tally = (list, key) =>
  list.reduce((o, r) => ((o[r[key]] = (o[r[key]] ?? 0) + 1), o), {});
const famTally = (list) =>
  list.reduce((o, r) => {
    for (const f of r.families ?? []) o[f] = (o[f] ?? 0) + 1;
    return o;
  }, {});
const rows = [...b.keys()].map((id) => ({
  id,
  before: b.get(id),
  after: a.get(id),
}));
const missing = rows.filter((r) => !r.after).map((r) => r.id);
const paired = rows.filter((r) => r.after);
const recovered = paired.filter(
  (r) => invalidFormat(r.before).length && !invalidFormat(r.after).length,
);
const introduced = paired.filter(
  (r) => !invalidFormat(r.before).length && invalidFormat(r.after).length,
);
const stillInvalid = paired.filter((r) => invalidFormat(r.after).length);
const sum = (list, side, key) =>
  list.reduce((n, r) => n + (r[side][key] ?? 0), 0);
const evidence = {
  scope:
    'Local reliability cycle on top of the repository state (app 0.4.5, engine 0.3.10-experimental). ' +
    'The 0.4.6 / engine 0.3.13 candidate described in the handover report is NOT present in this repository ' +
    'and none of its figures were reproduced or restored here.',
  repository: { headAtStart: '5fecb15', branch: 'claude/lucid-mendel-kjff9c' },
  versions: {
    before: {
      app: '0.4.5',
      engine: before.summary.engineVersion,
      generator: before.summary.generatorVersion,
    },
    after: {
      app: '0.4.6',
      engine: after.summary.engineVersion,
      generator: after.summary.generatorVersion,
    },
    evaluator:
      'audit/reliability/evaluate.mjs unchanged in this cycle (no version constant)',
    exportVerifier:
      'audit/reliability/verify-workbook.mjs unchanged in this cycle (no version constant)',
  },
  runConfiguration: {
    command:
      'node --experimental-strip-types audit/reliability/run.mjs --split development,validation,final --frozen',
    seed: after.summary.seed,
    count: after.summary.count,
    split: after.summary.split,
    node: after.summary.node,
    platform: after.summary.platform,
    arch: after.summary.arch,
    cpu: after.summary.cpu,
    memoryBytes: after.summary.memoryBytes,
  },
  engineFileHashes: {
    before: before.summary.hashes,
    after: after.summary.hashes,
  },
  overall: { before: before.summary.overall, after: after.summary.overall },
  elapsedSeconds: {
    before: before.summary.elapsedSeconds,
    after: after.summary.elapsedSeconds,
  },
  peakRssBytes: {
    before: before.summary.peakRssBytes,
    after: after.summary.peakRssBytes,
  },
  durationMs: {
    before: before.summary.durationMs,
    after: after.summary.durationMs,
  },
  formatProof: {
    definition:
      "A case counts here when the evaluator had to supply the generator's date or number format because " +
      'the engine reported "invalid" for that source. Those are sources the engine could not read on its own.',
    casesBefore: paired.filter((r) => invalidFormat(r.before).length).length,
    casesAfter: stillInvalid.length,
    recoveredCases: recovered.length,
    recoveredByCategory: tally(
      recovered.map((r) => r.before),
      'category',
    ),
    recoveredBySplit: tally(
      recovered.map((r) => r.before),
      'split',
    ),
    recoveredByFamily: famTally(recovered.map((r) => r.before)),
    recoveredIds: recovered.map((r) => r.id),
    introducedCases: introduced.length,
    introducedIds: introduced.map((r) => r.id),
    remainingByCategory: tally(
      stillInvalid.map((r) => r.after),
      'category',
    ),
    remainingByScenario: tally(
      stillInvalid.map((r) => r.after),
      'scenario',
    ),
    remainingIds: stillInvalid.map((r) => r.id),
  },
  invariants: {
    missingAfter: missing,
    passRegressed: paired
      .filter((r) => r.before.pass && !r.after.pass)
      .map((r) => r.id),
    safetyRegressed: paired
      .filter((r) => r.before.safetyPass && !r.after.safetyPass)
      .map((r) => r.id),
    newlyStopped: paired
      .filter((r) => !r.before.stopped && r.after.stopped)
      .map((r) => r.id),
    noLongerStopped: paired
      .filter((r) => r.before.stopped && !r.after.stopped)
      .map((r) => r.id),
    correctRequiredMatches: {
      before: sum(paired, 'before', 'correctRequiredMatches'),
      after: sum(paired, 'after', 'correctRequiredMatches'),
    },
    expectedMatches: {
      before: sum(paired, 'before', 'expectedMatches'),
      after: sum(paired, 'after', 'expectedMatches'),
    },
    falseMatches: {
      before: sum(paired, 'before', 'falseMatches'),
      after: sum(paired, 'after', 'falseMatches'),
    },
    extractedRows: {
      before: sum(paired, 'before', 'extractedRows'),
      after: sum(paired, 'after', 'extractedRows'),
    },
    excludedRows: {
      before: sum(paired, 'before', 'excludedRows'),
      after: sum(paired, 'after', 'excludedRows'),
    },
    acceptedGroups: {
      before: sum(paired, 'before', 'acceptedGroups'),
      after: sum(paired, 'after', 'acceptedGroups'),
    },
    permittedGroups: {
      before: sum(paired, 'before', 'permittedGroups'),
      after: sum(paired, 'after', 'permittedGroups'),
    },
  },
  notVerifiedHere: [
    'audit/reliability/evidence-0.4.6.json and GAPS-0.4.6.ar.md from the handover report: absent from this repository.',
    'The 147 regressed cases and 3,164 lost matches reported for the other 0.4.6 candidate: not reproducible, that candidate is not in this repository.',
    'July acceptance suite (12 tests, including 6,750 = 2,500 + 2,250 + 2,000): skipped, private originals not present (MIZAN_SAMPLE_DIR unset).',
    'Browser and in-product performance figures from the handover report: measured on other hardware, not re-measured here.',
  ],
};
writeFileSync(
  resolve(root, 'audit/reliability/evidence-0.4.6.json'),
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      recovered: recovered.length,
      remaining: stillInvalid.length,
      introduced: introduced.length,
      invariants: evidence.invariants,
    },
    null,
    1,
  ),
);
