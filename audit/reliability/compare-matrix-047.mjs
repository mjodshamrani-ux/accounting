// Compares runs of the SAME evaluator, generator and inputs across engine roots.
// Counts are reported per unit: cases, fields, matches and groups never mix.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (n, d) => {
  const i = args.indexOf(n);
  return i < 0 ? d : args[i + 1];
};
const suite = value('--suite', 'known');
const names = value('--engines', 'v045,astra,unified').split(',');
const load = (name) => {
  const dir = resolve(root, 'work/matrix', `${suite}-${name}`);
  return {
    name,
    summary: JSON.parse(readFileSync(resolve(dir, 'summary.json'), 'utf8')),
    cases: readFileSync(resolve(dir, 'cases.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse),
  };
};
const runs = names.map(load);
const tally = (list, key) =>
  list.reduce((o, r) => ((o[r[key]] = (o[r[key]] ?? 0) + 1), o), {});

/** A format field is "proved from the document" when the engine reported proven
 * for it. Fields, not cases: one case carries up to four of them. */
const fields = (record) =>
  (record.formatAssessments ?? []).map((a) => ({
    key: `${record.id}:${a.source}.${a.field}`,
    status: a.status,
  }));
const fieldMap = (run) =>
  new Map(run.cases.flatMap((r) => fields(r).map((f) => [f.key, f.status])));

const report = { suite, engines: {}, perEngine: {}, movement: {} };
for (const run of runs) {
  const o = run.summary.overall;
  report.engines[run.name] = {
    engineVersion: run.summary.engineVersion,
    engineRoot: run.summary.engineRoot,
    evaluatorVersion: run.summary.evaluatorVersion,
    generatorVersion: run.summary.generatorVersion,
    verifierVersion: run.summary.verifierVersion,
  };
  const statuses = {};
  for (const status of fieldMap(run).values())
    statuses[status] = (statuses[status] ?? 0) + 1;
  report.perEngine[run.name] = {
    cases: o.cases,
    passed: o.passed,
    safetyPassed: o.safetyPassed,
    completedComparisons: o.completedComparisons,
    completedAutomatically: o.completedAutomatically,
    casesWithUnprovenFormatDefaults: o.casesWithUnprovenFormatDefaults,
    unprovenFormatDefaultFields: o.unprovenFormatDefaults,
    stopped: o.stopped,
    outcomes: o.outcomes,
    requiredInterventionLevels: o.requiredInterventionLevels,
    ambiguityGate: o.ambiguityGate,
    formatFieldStatuses: statuses,
    expectedMatches: o.expectedMatches,
    correctRequiredMatches: o.correctRequiredMatches,
    missedRequiredMatches: o.missedRequiredMatches,
    falseMatches: o.falseMatches,
    requiredGroups: o.requiredGroups,
    acceptedRequiredGroups: o.acceptedRequiredGroups,
    missedRequiredGroups: o.missedRequiredGroups,
    extractedRows: o.extractedRows,
    exportsChecked: o.exportsChecked,
    bridgesChecked: o.bridgesChecked,
    unresolvedInputs: o.unresolvedInputs,
  };
}
// Field-level movement, the only honest measure of "format recovery":
// a field that the engine could not prove and now proves from the document.
for (let i = 1; i < runs.length; i++) {
  const before = fieldMap(runs[i - 1]),
    after = fieldMap(runs[i]);
  const moved = {
    provedNow: [],
    lostProof: [],
    invalidToAmbiguous: [],
    stillUnproven: 0,
  };
  for (const [key, status] of after) {
    const was = before.get(key);
    if (was === undefined) continue;
    if (was !== 'proven' && status === 'proven') moved.provedNow.push(key);
    else if (was === 'proven' && status !== 'proven') moved.lostProof.push(key);
    else if (was === 'invalid' && status === 'ambiguous')
      moved.invalidToAmbiguous.push(key);
    if (status !== 'proven') moved.stillUnproven++;
  }
  const caseMap = (run) => new Map(run.cases.map((r) => [r.id, r]));
  const b = caseMap(runs[i - 1]),
    a = caseMap(runs[i]);
  const caseMoves = {
    newlyCompleted: [],
    noLongerCompleted: [],
    newSafetyFailures: [],
    newFalseMatches: [],
  };
  for (const [id, after] of a) {
    const prior = b.get(id);
    if (!prior) continue;
    if (!prior.completedComparison && after.completedComparison)
      caseMoves.newlyCompleted.push(id);
    if (prior.completedComparison && !after.completedComparison)
      caseMoves.noLongerCompleted.push(id);
    if (prior.safetyPass && !after.safetyPass)
      caseMoves.newSafetyFailures.push(id);
    if ((after.falseMatches ?? 0) > (prior.falseMatches ?? 0))
      caseMoves.newFalseMatches.push(id);
  }
  report.movement[`${runs[i - 1].name} -> ${runs[i].name}`] = {
    formatFieldsProvedNow: moved.provedNow.length,
    formatFieldsLostProof: moved.lostProof.length,
    formatFieldsInvalidToAmbiguous: moved.invalidToAmbiguous.length,
    formatFieldsStillUnproven: moved.stillUnproven,
    casesNewlyCompleted: caseMoves.newlyCompleted.length,
    casesNoLongerCompleted: caseMoves.noLongerCompleted.length,
    newSafetyFailures: caseMoves.newSafetyFailures,
    newFalseMatches: caseMoves.newFalseMatches,
    sampleProvedNow: moved.provedNow.slice(0, 10),
    sampleNoLongerCompleted: caseMoves.noLongerCompleted.slice(0, 10),
  };
}
const out = value('--out', `work/matrix/comparison-${suite}.json`);
writeFileSync(resolve(root, out), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 1));
