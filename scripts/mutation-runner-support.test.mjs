import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completedSuccessfully, isAssertionKill, createPrivateTree, removePrivateTree } from './mutation-runner-support.mjs';

const assertion = { status: 1, signal: null, stdout: 'error: ERR_ASSERTION', stderr: '' };
void test('only a completed assertion failure is a mutation kill', () => {
  assert.equal(isAssertionKill(assertion), true);
  assert.equal(isAssertionKill({ ...assertion, status: 7 }), true);
  assert.equal(isAssertionKill({ ...assertion, stdout: '', stderr: assertion.stdout }), true);
  for (const status of [0, null, undefined, -1, 1.5, 256, '1'])
    assert.equal(isAssertionKill({ ...assertion, status }), false);
  for (const code of ['ETIMEDOUT', 'ENOBUFS', 'ENOENT'])
    assert.equal(isAssertionKill({ ...assertion, status: 7, error: { code } }), false);
  assert.equal(isAssertionKill({ ...assertion, signal: 'SIGTERM' }), false);
  assert.equal(isAssertionKill({ ...assertion, stdout: 'test failure' }), false);
  for (const failure of ['SyntaxError', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND',
    'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_DIR_IMPORT',
    'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_IMPORT_NOT_DEFINED'])
    assert.equal(isAssertionKill({ ...assertion, stderr: failure }), false);
  assert.equal(completedSuccessfully({ status: 0, signal: null }), true);
  assert.equal(completedSuccessfully({ status: 0, signal: null, error: { code: 'ETIMEDOUT' } }), false);
  assert.equal(completedSuccessfully({ status: 0, signal: 'SIGTERM' }), false);
});

void test('a real timed-out child exiting 7 after ERR_ASSERTION earns no kill', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "process.on('SIGTERM', () => process.exit(7)); console.log('ERR_ASSERTION'); setInterval(() => {}, 1000);"],
  { encoding: 'utf8', timeout: 1000 });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.status, 7);
  assert.match(result.stdout, /ERR_ASSERTION/);
  assert.equal(isAssertionKill(result), false);
});

void test('cleanup removes copied read-only directories and preserves linked originals', async () => {
  const original = await createPrivateTree();
  const scratch = await createPrivateTree(true);
  const archived = join(original, 'archived');
  const source = join(archived, 'source.txt');
  try {
    await mkdir(archived);
    await writeFile(source, 'immutable audit input\n');
    await chmod(source, 0o444);
    await chmod(archived, 0o555);
    const originalMode = (await lstat(archived)).mode;
    await cp(archived, join(scratch, 'copy'), { recursive: true });
    assert.equal((await lstat(join(scratch, 'copy'))).mode & 0o777, 0o555);
    assert.deepEqual(await readFile(join(scratch, 'copy/source.txt')), await readFile(source));
    await symlink(original, join(scratch, 'node_modules'), 'dir');
    await removePrivateTree(scratch);
    await assert.rejects(lstat(scratch), { code: 'ENOENT' });
    assert.equal((await lstat(archived)).mode, originalMode);
    assert.equal((await lstat(source)).mode & 0o777, 0o444);
    assert.equal(await readFile(source, 'utf8'), 'immutable audit input\n');
    await assert.rejects(removePrivateTree(archived), /unregistered/);
    assert.equal((await lstat(archived)).mode, originalMode);
  } finally {
    await removePrivateTree(original);
    // Disposal is intentionally not repeatable: a stale historical path cannot
    // become cleanup authority merely by sharing the private naming prefix.
    await assert.rejects(removePrivateTree(scratch), /unregistered/);
  }
});

// A stale anchor otherwise fails only when its shard reaches it, after the
// shard's earlier faults have run. Every anchor is checked without running.
void test('every mutation anchor matches exactly once, and a stale anchor is reported', async () => {
  const runner = join(import.meta.dirname, 'test-mutations.mjs');
  const all = spawnSync(process.execPath, [runner, '--anchors'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(all.status, 0, all.stdout + all.stderr);
  const report = JSON.parse(all.stdout);
  assert.equal(report.checked, report.available);
  assert.deepEqual(report.stale, []);
  const copy = await createPrivateTree();
  try {
    const name = 'sup2-wrap-any-line-without-date-or-amount';
    const file = 'lib/reconciliation/transaction-references.ts';
    await mkdir(join(copy, 'scripts'));
    await mkdir(join(copy, 'lib/reconciliation'), { recursive: true });
    for (const script of ['test-mutations.mjs', 'mutation-runner-support.mjs'])
      await cp(join(import.meta.dirname, script), join(copy, 'scripts', script));
    const source = await readFile(join(import.meta.dirname, '..', file), 'utf8');
    const check = () => spawnSync(process.execPath,
      [join(copy, 'scripts/test-mutations.mjs'), '--anchors', '--filter', name],
      { encoding: 'utf8', timeout: 60000 });
    await writeFile(join(copy, file), source);
    assert.equal(check().status, 0);
    await writeFile(join(copy, file), source.replace(/rest &&\s*!summaryLabel/, '!summaryLabel'));
    const stale = check();
    assert.equal(stale.status, 1);
    assert.deepEqual(JSON.parse(stale.stdout).stale, [{ mutation: name, file, count: 0 }]);
  } finally {
    await removePrivateTree(copy);
  }
});
