// Versioned evaluator adapter. The original frozen runner and financial oracle
// stay byte-for-byte unchanged; only row-vs-source error reporting is extended.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frozenDirectory=fileURLToPath(new URL('../independent/frozen/',import.meta.url));
const originalPath=path.join(frozenDirectory,'run.mjs');
const original=await readFile(originalPath,'utf8');
const sha=(text)=>createHash('sha256').update(text).digest('hex');
const expectedOriginalSha256='001b795cccc23c4edb047fb2e69a628b82e6a936dfa26ffb51ef29b74ae21025';
assert.equal(sha(original),expectedOriginalSha256,'Unexpected original runner; do not apply a broad or unreviewed adapter');
let adapted=original;
const patchOnce=(before,after)=>{
 assert.equal(adapted.split(before).length-1,1,'Adapter anchor must occur exactly once: '+before);
 adapted=adapted.replace(before,after);
};
// A data-URL module has no filesystem directory. Pin input reads to the real
// frozen directory, including its original SHA256SUMS verification.
patchOnce('const here = path.dirname(fileURLToPath(import.meta.url));',`const here = ${JSON.stringify(frozenDirectory)};`);
const oldErrorAssertion='      check(`${label}: exact errored rows`,() => assert.deepEqual(sortRows([...new Set(source.errors.map((r) => r.row))]),sortRows(expectedErrors)));';
const newErrorAssertions=[
 '      check(`${label}: every error has an explicit valid row or source scope`,() => assert.ok(source.errors.every((r) => Number.isInteger(r.row) && r.row >= 0)));',
 '      check(`${label}: exact errored data rows`,() => assert.deepEqual(sortRows([...new Set(source.errors.filter((r) => r.row > 0).map((r) => r.row))]),sortRows(expectedErrors)));',
 '      const sourceWideErrors=source.errors.filter((r) => r.row === 0);',
 "      const expectedSourceWide=(contract.id === 'P2D14' && label === 'ledger') ? 1 : 0;",
 '      check(`${label}: exact source-wide error count`,() => assert.equal(sourceWideErrors.length,expectedSourceWide));',
 '      if (expectedSourceWide) check(`${label}: source-wide error explicitly identifies Currency scope`,() => { assert.equal(sourceWideErrors.length,1); assert.match(sourceWideErrors[0].message,/\\bCurrency\\b/i); assert.match(sourceWideErrors[0].message,/نطاق|scope/i); });',
].join('\n');
patchOnce(oldErrorAssertion,newErrorAssertions);
// Version and patch provenance are part of each new result. No prior output is
// overwritten and no original fixture/contract/financial assertion is changed.
const patchMetadata={version:'p2-sourcewide-issues-v2',originalRunnerSha256:expectedOriginalSha256,
 scope:'Preserve exact physical error rows; additionally require exactly one Currency source-scope error on P2D14 ledger and zero source-wide errors elsewhere.',
 frozenFinancialContractsChanged:false};
patchOnce('const report={purpose:contracts.purpose,',`const report={evaluator:${JSON.stringify(patchMetadata)},purpose:contracts.purpose,`);
if(process.argv.includes('--check-only')){
 console.log(JSON.stringify({...patchMetadata,originalPath,adaptedSourceSha256:sha(adapted),patches:3},null,2));
}else{
 const index=process.argv.indexOf('--out');
 assert.ok(index>=0&&process.argv[index+1],'Required --out for a new result');
 try{await access(process.argv[index+1]);throw new Error('Refusing to overwrite an existing evaluator result');}catch(error){if(error.code!=='ENOENT')throw error;}
 await import('data:text/javascript;base64,'+Buffer.from(adapted).toString('base64'));
}
