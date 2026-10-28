// IC-1 code mutations: each planted defect in a private copy of the
// intercompany-batch-1 engine (intercompany-batch.ts) must make its unit
// tests fail with an assertion. A survivor is a guard nothing holds.
//   node scripts/test-intercompany-batch-mutations.mjs
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
  process.env.IC_BATCH_MUTATION_DIR ??
  join(root, 'work/intercompany-batch-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/intercompany-batch.test.ts'];
const ENGINE = 'lib/reconciliation/intercompany-batch.ts';
const mutations = [
  [
    'reading-unconfirmed-accepted',
    ENGINE,
    '      r.confirmed !== true ||\n',
    '',
  ],
  [
    'roles-not-counted',
    ENGINE,
    "    roles.filter((r) => r === 'batch-declaration').length !== 1 ||\n",
    '',
  ],
  [
    'independent-sources-unchecked',
    ENGINE,
    "  if (new Set(input.files.map((f) => f.sha256)).size !== input.files.length)\n    fail('INDEPENDENT_SOURCES');\n",
    '',
  ],
  [
    'header-set-unchecked',
    ENGINE,
    '    !head.every((h) => first.includes(h))\n',
    '    false\n',
  ],
  [
    'declaration-not-validated',
    ENGINE,
    "    if (!declarationValid(r.fields)) flag(bid, 'BATCH_FIELD', at);\n",
    '',
  ],
  [
    'unreadable-declaration-ignored',
    ENGINE,
    "      run.add('BATCH_FIELD');\n",
    '',
  ],
  [
    'duplicate-batch-allowed',
    ENGINE,
    '    if (list.length > 1)\n      for (const at of list)\n',
    '    if (false)\n      for (const at of list)\n',
  ],
  [
    'overlap-unchecked',
    ENGINE,
    '        pairOf(a.d) === pairOf(b.d) &&\n',
    '        false &&\n',
  ],
  [
    'overlap-one-orientation',
    ENGINE,
    "    .sort(byText)\n    .join('\\u0000');",
    "    .join('\\u0000');",
  ],
  [
    'first-candidate-taken',
    ENGINE,
    '    if (found.length === 1)\n',
    '    if (found.length >= 1)\n',
  ],
  [
    'unassigned-blocks-nothing',
    ENGINE,
    '    for (const bid of hit) flag(bid, x.code, at);\n',
    '',
  ],
  [
    'unassigned-blocks-only-its-file',
    ENGINE,
    '            ...decls\n',
    '            ...decls.slice(0, 0)\n',
  ],
  [
    'ambiguous-blocks-the-entity',
    ENGINE,
    "      x.code === 'UNASSIGNED_AMBIGUOUS'\n",
    '      false\n',
  ],
  [
    'identity-unchecked',
    ENGINE,
    "      icText(f['Counterparty transaction ID']);\n",
    '',
  ],
  [
    'posting-period-unchecked',
    ENGINE,
    "      (posted < d['Period start'] || posted > d['Period end'])\n",
    '      false\n',
  ],
  [
    'two-decimals-everywhere',
    ENGINE,
    '    const decimals = currencyPrecision(d.Currency);\n    if (decimals === undefined) continue;\n',
    '    if (currencyPrecision(d.Currency) === undefined) continue;\n    const decimals = 2;\n',
  ],
  [
    'both-sides-allowed',
    ENGINE,
    '    if (debit > 0 && credit > 0) {\n',
    '    if (false) {\n',
  ],
  [
    'duplicate-transaction-allowed',
    ENGINE,
    '    if (list.length > 1)\n      for (const a of list)\n',
    '    if (false)\n      for (const a of list)\n',
  ],
  [
    'unattributed-relation-ignored',
    ENGINE,
    "      run.add('RELATION_UNATTRIBUTED');\n",
    '',
  ],
  [
    'relation-side-unchecked',
    ENGINE,
    "      (f.Side !== 'A' && f.Side !== 'B') ||\n",
    '',
  ],
  [
    'relations-cross-batches',
    ENGINE,
    "      if (across) flag(m.bid, 'RELATION_BATCHES', place);\n",
    '',
  ],
  [
    'relation-fields-may-differ',
    ENGINE,
    "      if (differ) flag(m.bid, 'RELATION_FIELDS_DIFFER', place);\n",
    '',
  ],
  [
    'validity-unchecked',
    ENGINE,
    "        (m.from > d['Period start'] || m.to < d['Period end'] || m.from > m.to)\n",
    '        false\n',
  ],
  [
    'duplicate-member-allowed',
    ENGINE,
    '    if (list.length > 1)\n      for (const m of list)\n',
    '    if (false)\n      for (const m of list)\n',
  ],
  [
    'counterparty-conflict-unchecked',
    ENGINE,
    '            !named[other].includes(e.counterpartyTransactionId)\n',
    '            false\n',
  ],
  [
    'run-codes-not-spread',
    ENGINE,
    '    for (const code of run) flag(bid, code);\n',
    '',
  ],
  [
    'one-sided-ready',
    ENGINE,
    "      if (oneSided) missing.add('RELATION_ONE_SIDED');\n",
    '',
  ],
  [
    'missing-member-ignored',
    ENGINE,
    "      if (absent) missing.add('RELATION_MEMBER_MISSING');\n",
    '',
  ],
  ['unrelated-ignored', ENGINE, "      missing.add('UNRELATED');\n", ''],
  [
    'side-empty-ignored',
    ENGINE,
    "    if (!sides.A.length || !sides.B.length) missing.add('SIDE_EMPTY');\n",
    '',
  ],
  [
    'netting-inside-a-batch',
    ENGINE,
    "      : out.relations.some((r) => r.status === 'difference')\n",
    '      : icSum(out.relations.map((r) => r.residual ?? 0)) !== 0\n',
  ],
  [
    'residual-from-one-side',
    ENGINE,
    '        relation.residual = icSum([net.A, net.B]);\n',
    '        relation.residual = net.A === -net.B ? 0 : icSum([net.A, net.B]) && 0;\n',
  ],
];
const files = [ENGINE, ...tests];
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
    {
      cwd,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    },
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
      for (const name of ['lib', ...tests, 'package.json'])
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
