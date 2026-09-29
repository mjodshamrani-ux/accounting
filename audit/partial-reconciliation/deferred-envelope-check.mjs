// Performance-only refactor parity; the accounting oracle stays frozen.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--before') && process.argv.includes('--after') && process.argv.includes('--out'));
const before = path.resolve(arg('--before')), after = path.resolve(arg('--after'));
const frozen = fileURLToPath(new URL('./frozen/', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = await readFile(path.join(frozen, 'SHA256SUMS'));
for (const line of manifest.toString().trim().split('\n')) {
  const [hash, name] = line.split('  ');
  assert.equal(sha(await readFile(path.join(frozen, name))), hash);
}
const contracts = JSON.parse(await readFile(path.join(frozen, 'contracts.json'), 'utf8'));
const load = (root, name) => import(pathToFileURL(path.join(root, 'lib/reconciliation', name)));
const oldIo = await load(before, 'io.ts'), oldEngine = await load(before, 'supplier-reconciliation.ts');
const newEngine = await load(after, 'supplier-reconciliation.ts');
const { formatChoice } = await load(before, 'input-readiness.ts');
const cases = [];
for (const c of contracts.cases) {
  if (c.kind === 'read-refusal') continue; // Reader unchanged; covered by the full corpus.
  const files = [];
  for (const side of ['supplier', 'ledger']) {
    const definition = c[side], bytes = await readFile(path.join(frozen, definition.file));
    files.push(await oldIo.readFile(path.basename(definition.file), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), definition.cuts));
  }
  const mappings = [c.supplier.mapping, c.ledger.mapping].map((m) => structuredClone(m));
  const scope = structuredClone(c.scope ?? contracts.scope);
  if (c.dateChoice) {
    const { side, value, candidates } = c.dateChoice;
    mappings[side].dateFormat = value;
    mappings[side].formatChoice = { dateFormat: formatChoice(files[side], mappings[side], 'dateFormat', value, candidates, scope.decimals) };
  }
  const capture = (engine) => {
    try { return { result: engine.reconcileSupplierStatement(structuredClone({ files, mappings, scope, decisions: [], rejected: [] })) }; }
    catch (error) { return { error: { name: error.name, message: error.message } }; }
  };
  const oldResult = capture(oldEngine), newResult = capture(newEngine);
  assert.deepEqual(newResult, oldResult, c.id);
  cases.push({ id: c.id, identical: true, outcome: oldResult.error ? 'same refusal' : 'same full result', sha256: sha(JSON.stringify(oldResult)) });
}
const report = { before, after, sourceChange: 'Defer negative-envelope construction until a captured row actually fails', frozenManifestSha256: sha(manifest), passed: true, cases };
await writeFile(arg('--out'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, fullResultComparisons: cases.length, out: arg('--out') }));
