// INV-3 code mutations: each planted defect in a private copy of the
// inventory family's links (inventory-register.ts) must make the link tests
// fail with an assertion, and must not leave the family's own tests passing
// when it touches a decision. A survivor is a guard nothing holds.
//   node scripts/test-inventory-register-links-mutations.mjs
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
  process.env.STOCK_LINKS_MUTATION_DIR ??
  join(root, 'work/inventory-register-links-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/inventory-register-links.test.ts',
  'tests/inventory-register.test.ts',
];
const support = [
  'tests/inventory-column-fixture.ts',
  'audit/inventory-column-hierarchy',
  'audit/inventory-register',
];
const ENGINE = 'lib/reconciliation/inventory-register.ts';
const mutations = [
  [
    'no-mapping-read-as-two',
    ENGINE,
    "linked.reasons = [mapping.length ? 'MAPPINGS' : 'NO_MAPPING'];",
    "linked.reasons = ['MAPPINGS'];",
  ],
  [
    'two-mappings-read-as-none',
    ENGINE,
    "linked.reasons = [mapping.length ? 'MAPPINGS' : 'NO_MAPPING'];",
    "linked.reasons = ['NO_MAPPING'];",
  ],
  [
    'competing-mappings-not-listed',
    ENGINE,
    '      mappings: mapping.map(keyed),\n',
    '      mappings: mapping.slice(0, 1).map(keyed),\n',
  ],
  [
    'no-evidence-read-as-two',
    ENGINE,
    "? [evidence.length ? 'EVIDENCES' : 'NO_EVIDENCE']",
    "? ['EVIDENCES']",
  ],
  [
    'competing-evidence-not-listed',
    ENGINE,
    '    linked.evidence = evidence.map(keyed);',
    '    linked.evidence = evidence.slice(0, 1).map(keyed);',
  ],
  [
    'first-differing-field-only',
    ENGINE,
    '              (_, i) => evidence[0].values[i + 1] !== expected[i],\n            );',
    '              (_, i) => evidence[0].values[i + 1] !== expected[i],\n            ).slice(0, 1);',
  ],
  [
    'fields-compared-one-off',
    ENGINE,
    'evidence[0].values[i + 1] !== expected[i]',
    'evidence[0].values[i] !== expected[i]',
  ],
  [
    'account-from-the-evidence',
    ENGINE,
    '    linked.account = { account: m[3] as string, dimensions: m[4] as string };',
    '    linked.account = { account: (evidence[0]?.values[6] ?? m[3]) as string, dimensions: m[4] as string };',
  ],
  [
    'gl-rows-not-listed',
    ENGINE,
    '    linked.gl = (glIndex.get(compound(m.slice(3, 5))) ?? []).map(recordRef);',
    '    linked.gl = [];',
  ],
  [
    'linked-row-left-unlinked-status',
    ENGINE,
    "      status: 'linked',\n      reasons: [],",
    "      status: 'unlinked',\n      reasons: [],",
  ],
  [
    'unlinked-evidence-status-not-set',
    ENGINE,
    "      linked.status = 'unlinked';\n      linked.reasons =\n",
    '      linked.reasons =\n',
  ],
  [
    'link-without-column',
    ENGINE,
    '    ...(r.column === undefined ? {} : { column: r.column }),\n',
    '',
  ],
  [
    'link-id-of-the-row-only',
    ENGINE,
    '    id: r.id,\n    row: r.row,',
    '    id: String(r.row),\n    row: r.row,',
  ],
  [
    'orphan-mapping-not-listed',
    ENGINE,
    "        role: 'mapping',\n        record: recordRef(r),",
    "        role: 'evidence',\n        record: recordRef(r),",
  ],
  [
    'orphan-evidence-reason-wrong',
    ENGINE,
    "        key: [r.values[0] as string],\n        reason: 'NO_MAPPING',",
    "        key: [r.values[0] as string],\n        reason: 'NO_REGISTER',",
  ],
  ['unused-gl-not-listed', ENGINE, '      unlinkedGl.push({', '      void ({'],
  [
    'account-without-gl-not-listed',
    ENGINE,
    '      unlinkedAccounts.push({',
    '      void ({',
  ],
  [
    'accounts-before-gl-rows',
    ENGINE,
    '  result.unlinked.push(...unlinkedGl, ...unlinkedAccounts);',
    '  result.unlinked.push(...unlinkedAccounts, ...unlinkedGl);',
  ],
  [
    'unlinked-gl-key-without-dimensions',
    ENGINE,
    '        key: [v[0] as string, v[1] as string],',
    '        key: [v[0] as string],',
  ],
  [
    'link-pushed-only-when-linked',
    ENGINE,
    '    result.links.push(linked);\n    if (mapping.length !== 1) {',
    '    if (mapping.length !== 1) {',
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
      for (const name of ['lib', ...tests, ...support, 'package.json'])
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
      survivors: report.mutations
        .filter((r) => !r.killed)
        .map((r) => [r.id, r.infrastructureError ?? '']),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
