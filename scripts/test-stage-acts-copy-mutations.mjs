// UX-7(c) copy mutations: the words of the supplier acts are held by their
// honesty test (tests/stage-acts.test.ts), not by a browser check, which can
// only compare the page with the same copy. Each planted wording (a claim the
// engine does not make, the review it leaves out, a source named otherwise,
// a mark or title that drops what it must say) is written into a private copy
// of lib/ and the test must fail with an assertion. It passes on the
// unmutated copy first.
//   node scripts/test-stage-acts-copy-mutations.mjs
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
  process.env.STAGE_ACTS_COPY_MUTATION_DIR ??
  join(root, 'work/stage-acts-copy-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'tests/stage-acts.test.ts';
const COPY = 'lib/i18n/stage-acts.ts';
const mutations = [
  [
    'it-matches-by-itself',
    COPY,
    'يجمعها تراصف تحتها',
    'يطابقها تراصف تلقائيًا تحتها',
  ],
  [
    'the-lines-not-for-review',
    COPY,
    `        id: 'lines',
        title: 'فاتورة وأسطرها',
        state: 'للمراجعة',`,
    `        id: 'lines',
        title: 'فاتورة وأسطرها',
        state: 'مكتملة',`,
  ],
  ['it-is-confirmed', COPY, 'so it stays for review.', 'so it is confirmed.'],
  [
    'the-payments-not-for-review',
    COPY,
    `        title: 'One transfer and its payments',
        state: 'for review',`,
    `        title: 'One transfer and its payments',
        state: 'reconciled',`,
  ],
  [
    'another-source-named',
    COPY,
    'وثلاث دفعات في ${arReport}:',
    'وثلاث دفعات في دفترك:',
  ],
  [
    'not-marked-synthetic',
    COPY,
    "mark: 'Synthetic records',",
    "mark: 'Records',",
  ],
  [
    'the-title-drops-the-type',
    COPY,
    "title: 'Three obstacles in supplier reconciliation',",
    "title: 'Three obstacles',",
  ],
  [
    'the-reason-not-written',
    COPY,
    'with the reason written: no single payment identity is established.',
    'with the reason written.',
  ],
  [
    'it-is-guaranteed',
    COPY,
    'for you to confirm',
    'guaranteed for you to confirm',
  ],
  [
    'the-first-act-for-review',
    COPY,
    'بمصدر كل منهما.`',
    'بمصدر كل منهما، فتبقى للمراجعة.`',
  ],
];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = digest(await readFile(join(root, COPY)));
const accept = (tree) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', acceptance],
    { cwd: tree, encoding: 'utf8', timeout: 120000 },
  );
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
async function privateTree() {
  const tree = await createPrivateTree();
  for (const name of ['lib', acceptance, 'package.json', 'tsconfig.json'])
    await cp(join(root, name), join(tree, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  return tree;
}
const report = { baselinePassed: false, mutations: [], passed: false };
{
  const tree = await privateTree();
  try {
    const baseline = accept(tree);
    await log('baseline', baseline);
    report.baselinePassed = completedSuccessfully(baseline);
  } finally {
    await removePrivateTree(tree);
  }
}
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await privateTree();
    try {
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const result = accept(tree);
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
if (digest(await readFile(join(root, COPY))) !== before)
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
