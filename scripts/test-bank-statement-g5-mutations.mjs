// BNK-PDF-1 G5 code mutations: each planted defect in the client's verified
// reading (one main-thread read per set of originals and scope, a save bound
// by its content) or in the per-result member index must make the G5 and
// interface tests fail with an assertion.
//   node scripts/test-bank-statement-g5-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
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
  process.env.BNK_G5_MUTATION_DIR ??
  join(root, 'work/bank-statement-g5-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/bank-statement-verified.test.ts',
  'tests/bank-statement-view.test.ts',
];
const LIFE = 'lib/reconciliation/bank-statement-lifecycle.ts';
const mutations = [
  [
    'verified-ignores-bytes',
    LIFE,
    '        f.sha256 === state.files[i].sha256 &&\n        sameBytes(f.original, state.files[i].original),',
    '        f.sha256 === state.files[i].sha256,',
  ],
  ['verified-ignores-scope', LIFE, '    v.scope === scope &&\n', ''],
  [
    'verified-ignores-name',
    LIFE,
    '        f.name === state.files[i].name &&\n',
    '',
  ],
  [
    'verified-ignores-fingerprint',
    LIFE,
    '        f.sha256 === state.files[i].sha256 &&\n',
    '',
  ],
  [
    'verified-never-kept',
    LIFE,
    '  verified = {',
    '  if (Math.random() > 2) verified = {',
  ],
  [
    'shared-reading-writable',
    LIFE,
    'return frozen({ reading, match, context });',
    'return { reading, match, context };',
  ],
  [
    'client-rereads-every-decision',
    LIFE,
    ': await replayVerified(requested);',
    ': await replayBankStatement(requested);',
  ],
  [
    'client-rereads-on-restore',
    LIFE,
    '          (requested as { buffer: ArrayBuffer }).buffer,\n          replayVerified,\n',
    '          (requested as { buffer: ArrayBuffer }).buffer,\n',
  ],
  [
    'client-rereads-on-export',
    LIFE,
    'exportBankStatement(state, result, replayVerified)',
    'exportBankStatement(state, result)',
  ],
  [
    'save-unbound',
    LIFE,
    "if (!sameStatementData(saved, state)) fail('WORKER_BINDING');",
    '',
  ],
];
const files = [...new Set(mutations.map(([, file]) => file)), ...tests];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
  );
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        ...tests,
        'audit/bank-statement-foundation',
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
        file,
        killed: isAssertionKill(result),
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      report.mutations.push({
        id,
        file,
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
console.log(
  JSON.stringify(
    {
      out,
      baselinePassed: report.baselinePassed,
      killed: report.mutations.filter((r) => r.killed).length,
      total: mutations.length,
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
