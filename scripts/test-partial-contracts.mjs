// The frozen development corpus is now a regression gate, not a fresh holdout.
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'work', 'partial-regression');
await mkdir(work, { recursive: true });
const out = await mkdtemp(path.join(work, 'run-'));
const audit = path.join(root, 'audit', 'partial-reconciliation');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [
  '--experimental-strip-types',
  path.join(audit, 'frozen', 'run.mjs'),
  '--engine-root',
  root,
  '--out',
  path.join(out, 'contracts.json'),
]);
run(process.execPath, [
  '--experimental-strip-types',
  path.join(audit, 'export_partial.mjs'),
  '--engine-root',
  root,
  '--out-dir',
  path.join(out, 'reviewed'),
  '--affirm-processed-balances',
]);
run(process.env.PYTHON ?? 'python3', [
  path.join(audit, 'check_openxml.py'),
  '--xlsx',
  path.join(out, 'reviewed', 'PR01-reviewed.xlsx'),
  '--out',
  path.join(out, 'reviewed', 'openxml.json'),
  '--require-reviewed',
  '--expected-engine',
  '0.3.26-experimental',
]);
console.log(`Partial reconciliation regression evidence: ${out}`);
