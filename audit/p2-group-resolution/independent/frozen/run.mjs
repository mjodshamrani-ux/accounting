import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (!arg('--engine-root') || !arg('--out')) throw new Error('Required: --engine-root /frozen/engine --out /new/result.json');
const engineRoot = path.resolve(arg('--engine-root'));
const output = path.resolve(arg('--out'));
assert.ok(!output.startsWith(here + path.sep), 'Do not write results inside frozen inputs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(path.join(here, 'SHA256SUMS'));
for (const line of manifestBytes.toString().trim().split('\n')) {
  const [expected, relative] = line.split('  ');
  assert.equal(sha(await readFile(path.join(here, relative))), expected, `Frozen input changed: ${relative}`);
}
const contractsBytes = await readFile(path.join(here, 'contracts.json'));
const contracts = JSON.parse(contractsBytes);
const hashTree = async (directory, prefix = '') => {
  const files = {};
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name;
    if (item.isDirectory()) Object.assign(files, await hashTree(path.join(directory, item.name), name + '/'));
    else if (item.isFile()) files[name] = sha(await readFile(path.join(directory, item.name)));
  }
  return files;
};
const git = (...argv) => { try { return execFileSync('git', ['-C', engineRoot, ...argv], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim(); } catch { return null; } };
const before = { commit:git('rev-parse','HEAD'), libFiles:await hashTree(path.join(engineRoot,'lib')) };
const moduleAt = (name) => pathToFileURL(path.join(engineRoot,'lib/reconciliation',name)).href;
const { readFile:readSource } = await import(moduleAt('io.ts'));
const { prepareVerifiedSources } = await import(moduleAt('source-preparation.ts'));
const { reconcileSupplierStatement } = await import(moduleAt('supplier-reconciliation.ts'));
const { ENGINE_VERSION } = await import(moduleAt('types.ts'));
const sortRows = (rows) => [...rows].sort((a,b) => a-b);
const groupKey = (group) => `S:${sortRows(group.supplierRows).join(',')}|L:${sortRows(group.ledgerRows).join(',')}`;
const results = [];

for (const contract of contracts.cases) {
  const failures = [];
  const check = (label, operation) => { try { operation(); } catch (error) { failures.push({label,message:error.message}); } };
  let observed;
  try {
    const definitions = [contract.supplier,contract.ledger];
    const files = await Promise.all(definitions.map(async (definition) => {
      const bytes = await readFile(path.join(here,definition.file));
      return readSource(path.basename(definition.file),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    }));
    const mappings = definitions.map((d) => structuredClone(d.mapping));
    const scope = structuredClone(contracts.scope);
    // The oracle specifies source rows. This preparation only translates them
    // into the engine's opaque IDs for an explicitly authored manual decision.
    // No match, expected group or expected amount is derived from engine output.
    const prepared = prepareVerifiedSources(files,mappings,scope,['supplier','ledger']);
    const rowId = (side,row) => {
      const found = prepared.sources[side].transactions.find((t) => t.row === row);
      assert.ok(found,`Manual-decision source row missing: ${side}/${row}`);
      return found.id;
    };
    const decisions = contract.manualPairs.map((p) => ({ supplierId:rowId(0,p.supplierRow), ledgerId:rowId(1,p.ledgerRow), note:p.note }));
    const { result } = reconcileSupplierStatement({files,mappings,scope,decisions,rejected:[]});
    const sources = [result.supplier,result.ledger];
    const rowById = new Map(sources.flatMap((s) => s.transactions.map((t) => [t.id,t.row])));
    const automatic = [], manual = [];
    for (const match of result.matches) {
      const left = match.supplierIds ?? [match.supplierId];
      const right = match.ledgerIds ?? [match.ledgerId];
      const group = {supplierRows:left.map((id) => rowById.get(id)),ledgerRows:right.map((id) => rowById.get(id))};
      check('Every match member has a source row',() => assert.ok([...group.supplierRows,...group.ledgerRows].every(Number.isInteger)));
      check('Match kind is explicit',() => assert.ok(match.kind === 'auto' || match.kind === 'manual'));
      (match.kind === 'manual' ? manual : automatic).push(group);
    }
    const requiredKeys = contract.requiredAutoGroups.map(groupKey).sort();
    const actualKeys = automatic.map(groupKey).sort();
    const requiredManual = contract.manualPairs.map((p) => groupKey({supplierRows:[p.supplierRow],ledgerRows:[p.ledgerRow]})).sort();
    check('All and only the explicitly required automatic member sets',() => assert.deepEqual(actualKeys,requiredKeys));
    check('Only the explicitly supplied manual pairs are manual',() => assert.deepEqual(manual.map(groupKey).sort(),requiredManual));
    for (let side=0;side<2;side++) {
      const definition=definitions[side],source=sources[side],label=side===0?'supplier':'ledger';
      const expectedTransactions=definition.expectedRows.filter((r) => r.disposition==='transaction').map((r) => r.row);
      const expectedExcluded=definition.expectedRows.filter((r) => r.disposition==='excluded').map((r) => r.row);
      const expectedErrors=definition.expectedRows.filter((r) => r.disposition==='error').map((r) => r.row);
      check(`${label}: exact transaction rows`,() => assert.deepEqual(sortRows(source.transactions.map((t) => t.row)),sortRows(expectedTransactions)));
      check(`${label}: exact excluded data rows`,() => assert.deepEqual(sortRows(source.excluded.filter((r) => r.row>definition.mapping.header+1).map((r) => r.row)),sortRows(expectedExcluded)));
      check(`${label}: exact errored rows`,() => assert.deepEqual(sortRows([...new Set(source.errors.map((r) => r.row))]),sortRows(expectedErrors)));
      check(`${label}: exclusions and errors have explanations`,() => assert.ok([...source.excluded.map((r) => r.reason),...source.errors.map((r) => r.message)].every((text) => typeof text==='string'&&text.trim())));
      for (const fact of definition.expectedRows) {
        const cells=files[side].sheets[definition.mapping.sheet].rows[fact.row-1];
        check(`${label}/${fact.row}: every literal source cell preserved`,() => assert.deepEqual(cells,fact.values));
        if (fact.disposition!=='transaction') continue;
        const transaction=source.transactions.find((t) => t.row===fact.row);
        check(`${label}/${fact.row}: exact signed amount`,() => assert.equal(transaction?.amount,fact.amountMinor));
        check(`${label}/${fact.row}: chosen reference retained`,() => assert.equal(transaction?.chosenReference,fact.values[2]));
        check(`${label}/${fact.row}: date retained`,() => assert.equal(transaction?.date,fact.values[0]));
        check(`${label}/${fact.row}: currency retained`,() => assert.equal(transaction?.currency,fact.values[10]));
        if (['Payment','Invoice'].includes(fact.values[3])) check(`${label}/${fact.row}: explicit document type retained`,() => assert.equal(transaction?.documentType,fact.values[3]));
      }
    }
    const transactionIds=sources.flatMap((s) => s.transactions.map((t) => t.id)).sort();
    const representedIds=result.cases.flatMap((c) => [...c.supplierMembers,...c.ledgerMembers].map((t) => t.id)).sort();
    check('Each imported transaction appears in exactly one case',() => assert.deepEqual(representedIds,transactionIds));
    const matchedCases=result.cases.filter((c) => c.status==='Matched');
    const matchedCaseKeys=matchedCases.map((c) => groupKey({supplierRows:c.supplierMembers.map((t) => t.row),ledgerRows:c.ledgerMembers.map((t) => t.row)})).sort();
    check('Matched cases have exactly the required automatic and manual members',() => assert.deepEqual(matchedCaseKeys,[...requiredKeys,...requiredManual].sort()));
    for (const expected of contract.requiredAutoGroups) {
      const matched=matchedCases.find((c) => groupKey({supplierRows:c.supplierMembers.map((t) => t.row),ledgerRows:c.ledgerMembers.map((t) => t.row)})===groupKey(expected));
      check(`Required group ${groupKey(expected)} has its authored totals`,() => {
        assert.ok(matched,'Required matched case missing');
        assert.equal(matched.supplierTotal,expected.supplierTotalMinor);
        assert.equal(matched.ledgerTotal,expected.ledgerTotalMinor);
        assert.equal(matched.variance,0);
      });
    }
    if (contract.requiredReviewSignalPattern) {
      const text=[...result.diagnostics.map((d) => d.message),...result.cases.flatMap((c) => c.evidence)].join('\n');
      check('Required bounded-support explanation is visible',() => assert.match(text,new RegExp(contract.requiredReviewSignalPattern,'i')));
    }
    const expectedSet=new Set(requiredKeys),actualSet=new Set(actualKeys);
    observed={automatic,manual,satisfiedRequiredGroups:[...expectedSet].filter((key) => actualSet.has(key)).length,missingRequiredGroups:[...expectedSet].filter((key) => !actualSet.has(key)),falseApprovedGroups:[...actualSet].filter((key) => !expectedSet.has(key)),cases:result.cases.map((c) => ({status:c.status,classification:c.classification,supplierRows:c.supplierMembers.map((t) => t.row),ledgerRows:c.ledgerMembers.map((t) => t.row),supplierTotal:c.supplierTotal,ledgerTotal:c.ledgerTotal,evidence:c.evidence})),sourceErrors:sources.map((s) => s.errors),excluded:sources.map((s) => s.excluded),diagnostics:result.diagnostics};
  } catch(error) { failures.push({label:'Production operation exception',message:error.stack??error.message}); }
  results.push({id:contract.id,title:contract.title,pass:failures.length===0,requiredAutoGroups:contract.requiredAutoGroups,failures,observed});
}
const after={commit:git('rev-parse','HEAD'),libFiles:await hashTree(path.join(engineRoot,'lib'))};
const engineUnchanged=JSON.stringify(before.libFiles)===JSON.stringify(after.libFiles);
const report={purpose:contracts.purpose,generatedAt:new Date().toISOString(),engineRoot,engineVersion:ENGINE_VERSION,before,after,engineLibFilesUnchanged:engineUnchanged,frozenManifestSha256:sha(manifestBytes),frozenContractsSha256:sha(contractsBytes),cases:results.length,passed:results.filter((r) => r.pass).length,failed:results.filter((r) => !r.pass).length,requiredAutoGroups:contracts.cases.reduce((n,c) => n+c.requiredAutoGroups.length,0),satisfiedRequiredGroups:results.reduce((n,r) => n+(r.observed?.satisfiedRequiredGroups??0),0),falseApprovedGroups:results.reduce((n,r) => n+(r.observed?.falseApprovedGroups.length??0),0),operationExceptions:results.filter((r) => r.failures.some((f) => f.label==='Production operation exception')).length,results};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({engineVersion:report.engineVersion,cases:report.cases,passed:report.passed,failed:report.failed,requiredAutoGroups:report.requiredAutoGroups,satisfiedRequiredGroups:report.satisfiedRequiredGroups,falseApprovedGroups:report.falseApprovedGroups,operationExceptions:report.operationExceptions,engineLibFilesUnchanged:engineUnchanged,failedIds:results.filter((r) => !r.pass).map((r) => r.id),output},null,2));
process.exitCode=report.failed||!engineUnchanged?1:0;
