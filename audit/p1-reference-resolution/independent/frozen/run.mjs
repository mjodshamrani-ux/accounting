import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arguments_ = process.argv.slice(2);
const valueOf = (flag) => {
  const index = arguments_.indexOf(flag);
  return index < 0 ? undefined : arguments_[index + 1];
};
if (!valueOf('--engine-root') || !valueOf('--out')) {
  throw new Error('Required: --engine-root /path/to/frozen/engine --out /path/to/new-result.json');
}
const engineRoot = path.resolve(valueOf('--engine-root'));
const output = path.resolve(valueOf('--out'));
assert.ok(!output.startsWith(here + path.sep), 'Write execution evidence outside the frozen input directory');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(path.join(here, 'SHA256SUMS'));
for (const line of manifestBytes.toString().trim().split('\n')) {
  const [expected, relative] = line.split('  ');
  assert.equal(sha(await readFile(path.join(here, relative))), expected, `Frozen artifact changed: ${relative}`);
}
const contractBytes = await readFile(path.join(here, 'contracts.json'));
const contract = JSON.parse(contractBytes);
const hashTree = async (directory, prefix = '') => {
  const files = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await hashTree(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files[relative] = sha(await readFile(path.join(directory, entry.name)));
  }
  return files;
};
const git = (...args) => {
  try { return execFileSync('git', ['-C', engineRoot, ...args], { encoding: 'utf8' }).trim(); }
  catch { return null; }
};
const before = { commit: git('rev-parse', 'HEAD'), libFiles: await hashTree(path.join(engineRoot, 'lib')) };
const moduleAt = (name) => pathToFileURL(path.join(engineRoot, 'lib/reconciliation', name)).href;
const { readFile: readSource } = await import(moduleAt('io.ts'));
const { reconcileSupplierStatement } = await import(moduleAt('supplier-reconciliation.ts'));
const { ENGINE_VERSION } = await import(moduleAt('types.ts'));
const pairKeys = (pairs) => pairs.map(([a,b]) => `${a}:${b}`).sort();
const results = [];
for (const c of contract.cases) {
  const failures = [];
  const check = (label, action) => {
    try { action(); } catch (error) { failures.push({ label, message: error.message }); }
  };
  let observed;
  try {
    const definitions = [c.supplier, c.ledger];
    const files = await Promise.all(definitions.map(async (definition) => {
      const bytes = await readFile(path.join(here, definition.file));
      return readSource(path.basename(definition.file), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }));
    const { result } = reconcileSupplierStatement({ files, mappings: definitions.map((d) => structuredClone(d.mapping)), scope: structuredClone(contract.scope), decisions: [], rejected: [] });
    const sources = [result.supplier, result.ledger];
    const rowById = new Map(sources.flatMap((s) => s.transactions.map((t) => [t.id, t.row])));
    const autoPairs = [];
    const autoGroups = [];
    for (const match of result.matches) {
      check('No manual matches without decisions', () => assert.equal(match.kind, 'auto'));
      const left = match.supplierIds ?? [match.supplierId];
      const right = match.ledgerIds ?? [match.ledgerId];
      if (left.length === 1 && right.length === 1) autoPairs.push([rowById.get(left[0]), rowById.get(right[0])]);
      else autoGroups.push({ supplierRows: left.map((id) => rowById.get(id)), ledgerRows: right.map((id) => rowById.get(id)) });
    }
    check('All and only the manually specified positive pairs', () => assert.deepEqual(pairKeys(autoPairs), pairKeys(c.requiredAutoPairs)));
    check('No unrequested automatic groups', () => assert.deepEqual(autoGroups, []));
    for (let side = 0; side < 2; side++) {
      const source = sources[side];
      const definition = definitions[side];
      const label = side === 0 ? 'supplier' : 'ledger';
      check(`${label}: no source read errors`, () => assert.deepEqual(source.errors, []));
      check(`${label}: exact expected transaction rows`, () => assert.deepEqual(source.transactions.map((t) => t.row).sort((a,b) => a-b), definition.expectedRows.map((r) => r.row).sort((a,b) => a-b)));
      for (const fact of definition.expectedRows) {
        const t = source.transactions.find((t) => t.row === fact.row);
        const cells = files[side].sheets[definition.mapping.sheet].rows[fact.row - 1];
        check(`${label}/${fact.row}: literal source document retained by reader`, () => assert.equal(cells?.[definition.documentColumn], fact.document));
        check(`${label}/${fact.row}: literal chosen reference retained`, () => assert.equal(t?.chosenReference, fact.chosenReference));
        check(`${label}/${fact.row}: amount minor units`, () => assert.equal(t?.amount, fact.amountMinor));
        check(`${label}/${fact.row}: date`, () => assert.equal(t?.date, fact.date));
        check(`${label}/${fact.row}: currency`, () => assert.equal(t?.currency, fact.currency));
      }
    }
    const inputIds = sources.flatMap((s) => s.transactions.map((t) => t.id)).sort();
    const representedIds = result.cases.flatMap((c) => [...c.supplierMembers, ...c.ledgerMembers].map((t) => t.id)).sort();
    check('Every input transaction belongs to exactly one case', () => assert.deepEqual(representedIds, inputIds));
    const matchedCases = result.cases.filter((c) => c.status === 'Matched');
    check('Matched case count agrees with explicit positive pairs', () => assert.equal(matchedCases.length, c.requiredAutoPairs.length));
    for (const matched of matchedCases) {
      check('Every matched case is a requested 1:1 pair', () => {
        assert.equal(matched.supplierMembers.length, 1);
        assert.equal(matched.ledgerMembers.length, 1);
        assert.ok(pairKeys(c.requiredAutoPairs).includes(`${matched.supplierMembers[0].row}:${matched.ledgerMembers[0].row}`));
      });
    }
    const expected = new Set(pairKeys(c.requiredAutoPairs));
    const actual = new Set(pairKeys(autoPairs));
    observed = {
      autoPairs,
      autoGroups,
      satisfiedPositivePairs: [...expected].filter((p) => actual.has(p)).length,
      missingPositivePairs: [...expected].filter((p) => !actual.has(p)),
      falseApprovedPairs: [...actual].filter((p) => !expected.has(p)),
      transactions: sources.map((s) => s.transactions.map((t) => ({ row:t.row, chosenReference:t.chosenReference, documentReference:t.documentReference, reference:t.reference, amount:t.amount, date:t.date, currency:t.currency }))),
      cases: result.cases.map((c) => ({ status:c.status, classification:c.classification, supplierRows:c.supplierMembers.map((t) => t.row), ledgerRows:c.ledgerMembers.map((t) => t.row) })),
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    failures.push({ label: 'Production operation exception', message: error.stack ?? error.message });
  }
  results.push({ id:c.id, title:c.title, pass:failures.length === 0, requiredAutoPairs:c.requiredAutoPairs, failures, observed });
}
const after = { commit: git('rev-parse', 'HEAD'), libFiles: await hashTree(path.join(engineRoot, 'lib')) };
const engineUnchanged = JSON.stringify(before.libFiles) === JSON.stringify(after.libFiles);
const report = {
  purpose: contract.purpose,
  generatedAt: new Date().toISOString(),
  engineRoot,
  engineVersion: ENGINE_VERSION,
  before,
  after,
  engineLibFilesUnchanged: engineUnchanged,
  frozenManifestSha256: sha(manifestBytes),
  frozenContractsSha256: sha(contractBytes),
  cases: results.length,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  requiredPositivePairs: contract.cases.reduce((n,c) => n+c.requiredAutoPairs.length,0),
  satisfiedPositivePairs: results.reduce((n,r) => n+(r.observed?.satisfiedPositivePairs ?? 0),0),
  falseApprovedPairs: results.reduce((n,r) => n+(r.observed?.falseApprovedPairs.length ?? 0),0),
  unexpectedAutoGroups: results.reduce((n,r) => n+(r.observed?.autoGroups.length ?? 0),0),
  operationExceptions: results.filter((r) => r.failures.some((f) => f.label === 'Production operation exception')).length,
  results,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ engineVersion:report.engineVersion, cases:report.cases, passed:report.passed, failed:report.failed, requiredPositivePairs:report.requiredPositivePairs, satisfiedPositivePairs:report.satisfiedPositivePairs, falseApprovedPairs:report.falseApprovedPairs, unexpectedAutoGroups:report.unexpectedAutoGroups, operationExceptions:report.operationExceptions, engineLibFilesUnchanged:engineUnchanged, failedIds:results.filter((r) => !r.pass).map((r) => r.id), output }, null, 2));
process.exitCode = report.failed || !engineUnchanged ? 1 : 0;
