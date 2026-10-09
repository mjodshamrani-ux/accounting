// Historical frozen executables are lint exclusions only while byte-exact.
// Product files and maintained audit tools remain subject to every lint rule.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'scripts/lint-frozen-originals.json'), 'utf8'));
const config = JSON.parse(await readFile(resolve(root, '.oxlintrc.json'), 'utf8'));
const allowedPatterns = new Set([
  '.next/**', '.vinext/**', 'out/**', 'build/**', 'dist/**', 'coverage/**', 'next-env.d.ts',
  'audit/**/reviews/original/**', 'audit/**/validation/**',
  'audit/**/first-inference/**', 'audit/**/validation-first/**',
  ...manifest.files.map((file) => file.path),
]);
if (config.ignorePatterns.some((pattern) => !allowedPatterns.has(pattern)))
  throw Error('Lint configuration includes an unreviewed exclusion. Product exclusions are forbidden.');
for (const file of manifest.files) {
  if (!file.path.startsWith('audit/') || file.path.includes('..') ||
      ['*', '?', '[', ']'].some((token) => file.path.includes(token)))
    throw Error('Frozen lint exclusions must be exact audit paths.');
  const bytes = await readFile(resolve(root, file.path));
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw Error(`Frozen lint original changed: ${file.path}`);
}
console.error(`Verified ${manifest.files.length} byte-exact frozen lint originals.`);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--verify-only') process.exit(0);
// Accept presentation options only; short flags must not bypass scope checks.
const formats = new Set(['default', 'json', 'unix', 'github', 'stylish']);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const format = arg === '--format' ? args[++index]
    : arg.startsWith('--format=') ? arg.slice('--format='.length) : undefined;
  if (!formats.has(format))
    throw Error('Only output format options may override the reviewed lint command.');
}
// Archived configurations are evidence. Only the reviewed root policy governs
// maintained sources; discovery must not activate configs in excluded snapshots.
const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), [
  '--config', resolve(root, '.oxlintrc.json'), '--disable-nested-config', '.', ...args,
], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) throw Error(`Lint terminated by ${result.signal}`);
process.exit(result.status ?? 1);
