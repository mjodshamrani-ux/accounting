// Once opened, the independently authored P2 corpora become permanent
// regression gates. Re-running them is not fresh holdout evidence.
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'work', 'p2-regression');
await mkdir(work, { recursive: true });
const out = await mkdtemp(path.join(work, 'run-'));
for (const corpus of ['independent', 'holdout', 'holdout-v2']) {
  const run = spawnSync(process.execPath, [
    '--experimental-strip-types',
    path.join(root, 'audit', 'p2-group-resolution', corpus, 'frozen', 'run.mjs'),
    '--engine-root', root, '--out', path.join(out, `${corpus}.json`),
  ], { cwd: root, stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
}
console.log(`P2 regression contracts passed. Evidence: ${out}`);
