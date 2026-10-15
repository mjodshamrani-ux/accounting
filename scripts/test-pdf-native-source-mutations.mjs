import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.PDF_NATIVE_SOURCE_MUTATION_DIR ??
  join(root, 'work/pdf-native-source-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const file = 'lib/reconciliation/pdf.ts';
const test = 'tests/pdf-native-source.test.ts';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    [file, test].map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--test', test], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
const mutations = [
  ['caller-bytes', 'const buffer = input.slice(0);', 'const buffer = input;'],
  [
    'page-ownership',
    'pages: pages.map((page, index) => ({\n      page: index + 1,',
    'pages: pages.map((page, index) => ({\n      page: 1,',
  ],
  ['visible-origin', 'y: token.y - page.view[1],', 'y: token.y,'],
  [
    'layout-warnings',
    'if (line.issues.length)\n        readingIssues.push(',
    'if (false)\n        readingIssues.push(',
  ],
  [
    'paint-guard',
    '          checkPdfOperators(\n            OPS,',
    '          false && checkPdfOperators(\n            OPS,',
  ],
  ['font-guard', '        fontGuard.assertComplete();', ''],
  ['stream-guard', '        await streamGuard.assertComplete();', ''],
];
if (report.baselinePassed)
  for (const [id, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        'audit/native-unicode',
        test,
        'tests/helpers/pdf-fixture.ts',
        'package.json',
      ])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const result = run(tree);
      await log(id, result);
      report.mutations.push({
        id,
        killed: isAssertionKill(result),
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      report.mutations.push({
        id,
        killed: false,
        infrastructureError: error.message,
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
for (const [p, hash] of Object.entries(before))
  if (digest(await readFile(join(root, p))) !== hash)
    throw Error('Mutation touched source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((r) => r.killed);
await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
