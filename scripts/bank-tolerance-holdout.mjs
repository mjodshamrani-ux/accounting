// WF-1 TOL-1 T4: the product on a sealed tolerance holdout, on the library and
// lifecycle path. The seal is checked first (check_seal.py); then the T1
// proof (bank-tolerance-proof.mjs) judges every story field by field against
// the sealed EXPECTED.json, and the T2 lifecycle (bank-tolerance-lifecycle.mjs)
// saves, restores, tampers with and exports every story, its workbooks read
// by the independent checker with a self-test on every one of them. Each runs
// on the holdout through BANK_TOLERANCE_SUITE, as it came: a failure is
// recorded with the rest, not thrown. --out writes the record; --assert
// requires the run to give the recorded one again, failures included.
//   node --experimental-strip-types scripts/bank-tolerance-holdout.mjs [--suite=dir] [--out=f | --assert=f]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const suite = arg('suite') ?? 'audit/bank-tolerance-holdout-t4';
const results = path.join(root, suite, 'results');

const seal = spawnSync(
  'python3',
  ['-B', path.join(root, suite, 'check_seal.py')],
  { encoding: 'utf8' },
);
assert.equal(seal.status, 0, `the seal: ${seal.stdout}${seal.stderr}`);

/** A script's summary line, whatever its exit: the run as it came. */
function run(script) {
  const done = spawnSync(
    process.execPath,
    ['--experimental-strip-types', path.join(root, 'scripts', script)],
    {
      encoding: 'utf8',
      env: { ...process.env, BANK_TOLERANCE_SUITE: suite },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const line = done.stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{"stories"'));
  if (!line)
    return { exit: done.status, error: done.stderr.trim().slice(-2000) };
  // The folder of a run's workbooks is not part of what it found.
  const { dir: _dir, ...summary } = JSON.parse(line);
  return { exit: done.status, ...summary };
}

const record = {
  suite,
  proof: run('bank-tolerance-proof.mjs'),
  lifecycle: run('bank-tolerance-lifecycle.mjs'),
};
console.log(JSON.stringify(record));
if (arg('out'))
  await writeFile(
    path.join(results, arg('out')),
    JSON.stringify(record, null, 1) + '\n',
  );
if (arg('assert'))
  assert.deepEqual(
    record,
    JSON.parse(await readFile(path.join(results, arg('assert')), 'utf8')),
    'the run differs from the recorded first run',
  );
