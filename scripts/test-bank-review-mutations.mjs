// WF-1 REVIEW-1 code mutations: each planted defect in a private copy of the
// review queue (bank-review-queue.ts, R1) must make the unit tests or the
// proof against the sealed EXPECTED.json fail with an assertion. A survivor
// is a rule nothing holds.
//   node scripts/test-bank-review-mutations.mjs
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
  process.env.BANK_REVIEW_MUTATION_DIR ??
  join(root, 'work/bank-review-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
// BANK_REVIEW_PROOF_ONLY=1 measures the proof alone, without the unit tests;
// BANK_REVIEW_PROOF_ONLY=holdout measures the R3 holdout's recorded first run
// alone (scripts/bank-review-holdout.mjs --assert=run-1.json).
const only = process.env.BANK_REVIEW_PROOF_ONLY;
const tests = only ? [] : ['tests/bank-review-queue.test.ts'];
const proofs =
  only === 'holdout'
    ? [['scripts/bank-review-holdout.mjs', '--assert=run-1.json']]
    : [['scripts/bank-review-proof.mjs']];
const packages =
  only === 'holdout'
    ? ['audit/bank-review-foundation', 'audit/bank-review-holdout-r3']
    : ['audit/bank-review-foundation'];
const QUEUE = 'lib/reconciliation/bank-review-queue.ts';
const mutations = [
  // Order.
  ['exceptions-not-first', QUEUE, '      rank(a) - rank(b) ||\n', ''],
  [
    'impact-order-ignored',
    QUEUE,
    '      b.impact - a.impact ||\n      b.members',
    '      b.members',
  ],
  ['members-tie-ignored', QUEUE, '      b.members - a.members ||\n', ''],
  [
    'reason-order-ignored',
    QUEUE,
    '      REVIEW_REASON_ORDER.indexOf(a.reason) -\n        REVIEW_REASON_ORDER.indexOf(b.reason) ||\n',
    '',
  ],
  [
    'cases-by-number-only',
    QUEUE,
    '        b.impact - a.impact ||\n        Number(a.case.slice(1))',
    '        Number(a.case.slice(1))',
  ],
  // Impact.
  [
    'impact-summed',
    QUEUE,
    '      impact: Math.max(total(s), total(e)),',
    '      impact: total(s) + total(e),',
  ],
  [
    'impact-from-the-statement-only',
    QUEUE,
    '      impact: Math.max(total(s), total(e)),',
    '      impact: total(s),',
  ],
  [
    'group-impact-from-the-first-case',
    QUEUE,
    '    g.impact = Math.max(...g.cases.map((c) => c.impact));',
    '    g.impact = g.cases.at(-1)!.impact;',
  ],
  // Grouping: the evidence a group shares.
  [
    'grouped-by-reason-only',
    QUEUE,
    "    const signature = [\n      reason,\n      directions.join('+'),\n      `${s.length}:${e.length}`,\n      gap ?? '',\n    ].join('|');",
    "    const signature = [reason, '', '', ''].join('|');",
  ],
  [
    'direction-ignored',
    QUEUE,
    "      reason,\n      directions.join('+'),\n",
    "      reason,\n      '',\n",
  ],
  [
    'shape-ignored',
    QUEUE,
    '      `${s.length}:${e.length}`,\n',
    "      '1:1',\n",
  ],
  [
    'gap-ignored',
    QUEUE,
    "      `${s.length}:${e.length}`,\n      gap ?? '',\n",
    "      `${s.length}:${e.length}`,\n      '',\n",
  ],
  [
    'gap-from-the-value-date',
    QUEUE,
    '        ? Math.abs(day(s[0].date) - day(e[0].date))',
    '        ? Math.abs(day(s[0].valueDate) - day(e[0].date))',
  ],
  // Membership of the queue.
  [
    'decided-cases-queued',
    QUEUE,
    "    if (c.kind !== 'review' || c.status !== 'needs-review') continue;",
    "    if (c.kind !== 'review') continue;",
  ],
  ['held-queued', QUEUE, "  if (result.status === 'held') return [];\n", ''],
  // What a group decision offers and records.
  [
    'accept-offered-for-exceptions',
    QUEUE,
    "      accept: g.cases.length >= 2 && g.class === 'suggestion',",
    '      accept: g.cases.length >= 2,',
  ],
  [
    'group-of-one-offered',
    QUEUE,
    '      reject: g.cases.length >= 2,',
    '      reject: g.cases.length >= 1,',
  ],
  [
    'note-not-required',
    QUEUE,
    '  const noted = !!note.trim();',
    '  const noted = true;',
  ],
  [
    'group-records-one-decision',
    QUEUE,
    '  return g.cases.map((c, i) => ({',
    '  return g.cases.slice(0, 1).map((c, i) => ({',
  ],
  [
    'members-not-exact',
    QUEUE,
    '    cashbook: [...c.cashbook],\n    note: note.trim(),',
    '    cashbook: [],\n    note: note.trim(),',
  ],
  [
    'context-not-bound',
    QUEUE,
    '    context: result.context,\n    at,',
    "    context: '',\n    at,",
  ],
];
const files = [
  ...new Set(mutations.map(([, file]) => file)),
  ...tests,
  ...proofs.map(([script]) => script),
];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) => {
  const options = {
    cwd,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  };
  let last = null;
  if (tests.length) {
    last = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--test', ...tests],
      options,
    );
    if (!completedSuccessfully(last)) return last;
  }
  for (const [proof, ...args] of proofs) {
    last = spawnSync(
      process.execPath,
      ['--experimental-strip-types', proof, ...args],
      {
        ...options,
        env: { ...process.env, BANK_REVIEW_HOLDOUT_DIR: join(out, 'holdout') },
      },
    );
    if (!completedSuccessfully(last)) return last;
  }
  return last;
};
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
        ...proofs.map(([script]) => script),
        ...packages,
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
