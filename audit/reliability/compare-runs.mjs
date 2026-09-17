import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [beforeDir,afterDir,output='audit/reliability/evidence-0.4.5.json']=process.argv.slice(2);
if(!beforeDir||!afterDir)throw Error('Usage: compare-runs.mjs BEFORE_DIR AFTER_DIR [OUTPUT_JSON]');
const before=JSON.parse(await readFile(resolve(beforeDir,'summary.json'),'utf8'));
const after=JSON.parse(await readFile(resolve(afterDir,'summary.json'),'utf8'));
assert.equal(before.seed,after.seed);assert.equal(before.generatorVersion,after.generatorVersion);
assert.deepEqual(before.manifest,after.manifest,'Compare exactly the same corpus');
for(const key of ['generator.mjs','manifest.mjs','renderers.mjs','evaluate.mjs','verify-workbook.mjs','report.mjs'])assert.equal(before.hashes['audit/reliability/'+key],after.hashes['audit/reliability/'+key],`Different evaluator: ${key}`);
const publishable=s=>({engineVersion:s.engineVersion,generatorVersion:s.generatorVersion,seed:s.seed,node:s.node,platform:s.platform,arch:s.arch,cpu:s.cpu,memoryBytes:s.memoryBytes,startedAt:s.startedAt,finishedAt:s.finishedAt,exports:s.exports,manifest:s.manifest,hashes:s.hashes,elapsedSeconds:s.elapsedSeconds,peakRssBytes:s.peakRssBytes,durationMs:s.durationMs,distinctEconomicFingerprints:s.distinctEconomicFingerprints,overall:s.overall,byCategory:s.byCategory,bySplit:s.bySplit,byFamily:s.byFamily,byScenario:s.byScenario,warning:s.warning});
const result={before:publishable(before),after:publishable(after),note:'Counts describe synthetic cases, not accuracy on market documents. All PDF inputs require simulated visual review; explicit scope/sign and ambiguous date/number confirmations are counted. Permitted payment groups may remain for review and are reported separately from required one-to-one completion.'};
await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({before:before.overall.cases,after:after.overall.cases,afterPassed:after.overall.passed,falseMatches:{before:before.overall.falseMatches,after:after.overall.falseMatches},output:resolve(output)}));
