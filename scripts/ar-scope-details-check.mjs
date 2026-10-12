import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
assert(process.argv.slice(2).every((x) => x === '--browser'));
const browser = process.argv.includes('--browser');
let index = path.resolve(
  process.env.AR_SCOPE_DETAILS_REPORT_DIR ?? 'work/ar-scope-details-proof',
  'evidence-index.json',
);
if (browser) {
  const parent = path.resolve(
    process.env.AR_SCOPE_BROWSER_DIR ?? '../evidence/browser',
  );
  const latest = JSON.parse(
    await readFile(path.join(parent, 'LATEST.json'), 'utf8'),
  );
  assert.equal(latest.passed, true, 'Latest browser attempt failed');
  assert.match(latest.attempt, /^attempt-[A-Za-z0-9_-]+$/);
  index = path.join(parent, latest.attempt, 'evidence-index.json');
  assert.equal(
    createHash('sha256')
      .update(await readFile(index))
      .digest('hex'),
    latest.indexSHA256,
  );
}
const output = path.resolve(
  process.env.AR_SCOPE_CHECK_DIR ??
    (browser ? '../evidence/browser-check' : '../evidence/proof-check'),
);
const result = spawnSync(
  process.env.AR_SCOPE_PYTHON ?? 'python3',
  [
    '-B',
    path.join(root, 'audit/ar-scope-details/checker/check_exports.py'),
    '--index',
    index,
    '--output-dir',
    output,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
assert.equal(result.signal, null);
process.exit(result.status ?? 1);
