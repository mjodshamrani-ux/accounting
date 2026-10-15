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
  process.env.INV_PDF_FIELDS_MUTATION_DIR ??
  join(root, 'work/inventory-pdf-local-fields-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const file = 'lib/reconciliation/inventory-pdf-register.ts';
const test = 'tests/inventory-pdf-register.test.ts';
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
  ['erase-gap-uncertainty', 'gaps.some((gap) => gap > 1e-7)', 'false'],
  ['control-word-collision', 'tag = undefined;', 'void 0;'],
  ['stale-batch', '        batch = null;', ''],
  [
    'leaked-continuation',
    'sectionIncoming = pending ? incoming : null;',
    'sectionIncoming = incoming;',
  ],
  [
    'foreign-field-role',
    'role: role.role,',
    'role: result.records[0]?.fields[role.name]?.role ?? role.role,',
  ],
  [
    'scope-conflict',
    "fail(lines[value.role.line - 1], 'SCOPE_CONFLICT');",
    'void 0;',
  ],
  ['foreign-report', 'report.value.text !== result.reportId', 'false'],
  [
    'ignored-unknown-line',
    "if (!roles) fail(line, 'UNCLASSIFIED_ROW');",
    'if (!roles) continue;',
  ],
];
if (report.baselinePassed)
  for (const [id, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        'audit/inventory-pdf-foundation',
        'audit/inventory-pdf-local-fields',
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
      const target = join(tree, file),
        text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const r = run(tree);
      await log(id, r);
      report.mutations.push({
        id,
        killed: isAssertionKill(r),
        exitCode: r.status,
        signal: r.signal,
        error: r.error?.message ?? null,
      });
    } catch (e) {
      report.mutations.push({
        id,
        killed: false,
        infrastructureError: e.message,
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
