import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const rootArg = option('--engine-root');
if (!rootArg) throw new Error('Required: --engine-root /absolute/path/to/frozen/engine');
const engineRoot = path.resolve(rootArg);
const output = path.resolve(option('--out') ?? path.join(here, 'result.json'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(path.join(here, 'SHA256SUMS'));
for (const line of manifestBytes.toString().trim().split('\n')) {
  const [expected, name] = line.split('  ');
  assert.equal(sha256(await readFile(path.join(here, name))), expected, `Frozen input changed: ${name}`);
}
const contracts = JSON.parse(await readFile(path.join(here, 'contracts.json'), 'utf8'));
const engineFile = (name) => pathToFileURL(path.join(engineRoot, 'lib/reconciliation', name)).href;
const io = await import(engineFile('io.ts'));
const { reconcileSupplierStatement } = await import(engineFile('supplier-reconciliation.ts'));
const { ENGINE_VERSION } = await import(engineFile('types.ts'));
const engineGit = (args) => {
  try { return execFileSync('git', ['-C', engineRoot, ...args], { encoding: 'utf8' }).trim(); }
  catch { return null; }
};
const sorted = (pairs) => pairs.map((p) => p.join(':')).sort();
const results = [];
for (const contract of contracts.cases) {
  const failures = [];
  const check = (label, action) => {
    try { action(); } catch (error) { failures.push({ label, message: error.message }); }
  };
  let observed;
  try {
    const definitions = [contract.supplier, contract.ledger];
    const files = await Promise.all(definitions.map(async (definition) => {
      const bytes = await readFile(path.join(here, definition.file));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return io.readFile(path.basename(definition.file), buffer);
    }));
    const computed = reconcileSupplierStatement({
      files,
      mappings: definitions.map((d) => structuredClone(d.mapping)),
      scope: structuredClone(contracts.scope),
      decisions: [],
      rejected: [],
    });
    const comparison = computed.result;
    const sources = [comparison.supplier, comparison.ledger];
    const idToRow = new Map(sources.flatMap((s) => s.transactions.map((t) => [t.id, t.row])));
    const observedPairs = [];
    const grouped = [];
    for (const match of comparison.matches) {
      const supplierIds = match.supplierIds ?? [match.supplierId];
      const ledgerIds = match.ledgerIds ?? [match.ledgerId];
      check('Only automatic matches without supplied decisions', () => assert.equal(match.kind, 'auto'));
      if (supplierIds.length !== 1 || ledgerIds.length !== 1) {
        grouped.push({ supplierRows: supplierIds.map((id) => idToRow.get(id)), ledgerRows: ledgerIds.map((id) => idToRow.get(id)) });
      } else observedPairs.push([idToRow.get(supplierIds[0]), idToRow.get(ledgerIds[0])]);
    }
    check('Exact required automatic pairs, without missing positives or false positives', () =>
      assert.deepEqual(sorted(observedPairs), sorted(contract.expected.exactAutoPairs)));
    check('No grouped automatic matches in these identity-only contracts', () => assert.deepEqual(grouped, []));
    for (let side = 0; side < 2; side++) {
      const source = sources[side];
      const definition = definitions[side];
      const label = side === 0 ? 'supplier' : 'ledger';
      check(`${label}: no input errors`, () => assert.deepEqual(source.errors, []));
      check(`${label}: all expected rows read`, () => assert.deepEqual(source.transactions.map((t) => t.row).sort((a,b) => a-b), definition.rows.map((t) => t.sourceRow).sort((a,b) => a-b)));
      for (const expected of definition.rows) {
        const transaction = source.transactions.find((t) => t.row === expected.sourceRow);
        check(`${label} row ${expected.sourceRow}: chosen reference preserved literally`, () => assert.equal(transaction?.chosenReference, expected.chosenReference));
        check(`${label} row ${expected.sourceRow}: correct source amount`, () => assert.equal(transaction?.amount, expected.amountMinor));
      }
    }
    const allIds = sources.flatMap((s) => s.transactions.map((t) => t.id)).sort();
    const caseIds = comparison.cases.flatMap((c) => [...c.supplierMembers, ...c.ledgerMembers].map((t) => t.id)).sort();
    check('Every transaction appears in exactly one case', () => assert.deepEqual(caseIds, allIds));
    const matchedCasePairs = comparison.cases.filter((c) => c.status === 'Matched').map((c) => [c.supplierMembers[0]?.row, c.ledgerMembers[0]?.row]);
    check('Matched cases agree with the explicit positive-pair contract', () => assert.deepEqual(sorted(matchedCasePairs), sorted(contract.expected.exactAutoPairs)));
    observed = {
      autoPairs: observedPairs,
      grouped,
      transactions: sources.map((s) => s.transactions.map((t) => ({ row: t.row, reference: t.reference, chosenReference: t.chosenReference, normalizedReference: t.normalizedReference, documentReference: t.documentReference, voucherReference: t.voucherReference, amount: t.amount }))),
      cases: comparison.cases.map((c) => ({ classification: c.classification, status: c.status, supplierRows: c.supplierMembers.map((t) => t.row), ledgerRows: c.ledgerMembers.map((t) => t.row) })),
      diagnostics: comparison.diagnostics,
    };
  } catch (error) {
    failures.push({ label: 'Production reader/recompute completed', message: error.stack ?? error.message });
  }
  results.push({ id: contract.id, title: contract.title, pass: failures.length === 0, expected: contract.expected, failures, observed });
}
const report = {
  purpose: contracts.purpose,
  generatedAt: new Date().toISOString(),
  engineRoot,
  engineVersion: ENGINE_VERSION,
  engineCommit: engineGit(['rev-parse', 'HEAD']),
  engineWorkingTree: engineGit(['status', '--short']),
  frozenManifestSha256: sha256(manifestBytes),
  cases: results.length,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  requiredPositivePairs: contracts.cases.reduce((n,c) => n + c.expected.exactAutoPairs.length, 0),
  results,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: report.cases, passed: report.passed, failed: report.failed, requiredPositivePairs: report.requiredPositivePairs, output, failures: results.filter((r) => !r.pass).map((r) => ({ id:r.id, failures:r.failures })) }, null, 2));
process.exitCode = report.failed ? 1 : 0;
