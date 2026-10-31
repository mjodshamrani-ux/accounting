// pnpm audit gates the build at moderate. An advisory may be set aside only
// in pnpm-workspace.yaml, by its id, when the code it describes is not what
// the project installs; the premise is checked here on every run. When a
// premise fails, the exception no longer holds: upgrade, or reassess it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// GHSA-g3hv-75wg-m249, minimatch <11.0.1, published 30 October 2026:
// firstPhasePreProcess() with optimizationLevel >= 2 multiplies glob parts
// for patterns such as **/../ and then compares them pairwise. minimatch 3
// and 5 have neither the method nor the option. They reach the project only
// through the Node packages of exceljs (archiver, unzipper), which load them
// and never pass them a pattern; the application build carries none.
const MINIMATCH = 'GHSA-g3hv-75wg-m249';

/** Advisory ids listed under auditConfig.ignoreGhsas. */
function ignoredAdvisories(workspace: string): string[] {
  const block =
    /^auditConfig:[ \t]*\n((?:[ \t]+[^\n]*\n?)*)/mu.exec(workspace)?.[1] ?? '';
  const list =
    /^[ \t]+ignoreGhsas:[ \t]*\n((?:[ \t]+-[^\n]*\n?)*)/mu.exec(block)?.[1] ??
    '';
  return [...list.matchAll(/-[ \t]*([^\s#]+)/gu)].map((m) => m[1]);
}

/** Versions of one package in a pnpm lockfile, version 9. */
function lockedVersions(lockfile: string, name: string): string[] {
  const entry = new RegExp(`^  ${name}@(\\d[^:(\\s]*)[:(]`, 'gmu');
  return [...new Set([...lockfile.matchAll(entry)].map((m) => m[1]))];
}

/** A minimatch line without the preprocessing, or a patched release. */
function covered(version: string): 'old-line' | 'patched' | null {
  const [major, minor, patch] = version.split('.').map(Number);
  if (major === 3 || major === 5) return 'old-line';
  if (major > 11 || (major === 11 && (minor > 0 || patch >= 1)))
    return 'patched';
  return null;
}

type Matcher = new (
  pattern: string,
  options: Record<string, unknown>,
) => { set: unknown[] };

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');

void test('the build sets aside only the advisory whose premise this file checks', () => {
  assert.deepEqual(ignoredAdvisories(workspace), [MINIMATCH]);
});

void test('every locked minimatch is a line without the preprocessing, and one still needs the exception', () => {
  const versions = lockedVersions(lockfile, 'minimatch');
  assert.ok(versions.length > 0, 'minimatch is locked');
  for (const version of versions)
    assert.ok(covered(version), `minimatch ${version} may carry the advisory`);
  assert.ok(
    versions.some((version) => covered(version) === 'old-line'),
    'every locked minimatch is patched: remove the exception',
  );
});

void test('the installed minimatch has no glob-part preprocessing and does not multiply the advisory pattern', () => {
  for (const version of lockedVersions(lockfile, 'minimatch')) {
    if (covered(version) !== 'old-line') continue;
    const dir = path.resolve(
      `node_modules/.pnpm/minimatch@${version}/node_modules/minimatch`,
    );
    const { Minimatch } = createRequire(path.join(dir, 'package.json'))(
      dir,
    ) as { Minimatch: Matcher };
    assert.equal(
      'firstPhasePreProcess' in Minimatch.prototype,
      false,
      `minimatch ${version} has firstPhasePreProcess`,
    );
    for (const repeat of [8, 128]) {
      const pattern = `a/${'**/../'.repeat(repeat)}b`;
      const matcher = new Minimatch(pattern, {
        dot: true,
        optimizationLevel: 2,
      });
      assert.equal(matcher.set.length, 1, `minimatch ${version}, ${repeat}`);
    }
  }
});

void test('the browser build of exceljs carries no minimatch preprocessing', () => {
  const pkg = JSON.parse(
    readFileSync('node_modules/exceljs/package.json', 'utf8'),
  ) as { browser: string };
  const bundle = readFileSync(
    path.join('node_modules/exceljs', pkg.browser),
    'utf8',
  );
  assert.ok(bundle.length > 100_000, 'the browser bundle was read');
  assert.equal(bundle.includes('firstPhasePreProcess'), false);
});

void test('the checks refuse a workspace or lockfile that breaks the premise', () => {
  assert.deepEqual(
    ignoredAdvisories(
      'auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n    - GHSA-g3hv-75wg-m249\n',
    ),
    ['GHSA-aaaa-bbbb-cccc', MINIMATCH],
  );
  assert.deepEqual(ignoredAdvisories('overrides:\n  a: "1"\n'), []);
  const locked = lockedVersions(
    'packages:\n\n  minimatch@3.1.5:\n  minimatch@10.2.6:\n  minimatch@11.0.0:\n  minimatch@11.0.1:\n  other@1.0.0:\n',
    'minimatch',
  );
  assert.deepEqual(locked, ['3.1.5', '10.2.6', '11.0.0', '11.0.1']);
  assert.deepEqual(locked.map(covered), ['old-line', null, null, 'patched']);
});
