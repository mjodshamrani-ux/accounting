// WF-1 ROLL-1 W1 code mutations: each planted defect in a private copy of the
// carrying engine, the matcher's withheld items or the roll session reading
// must make the roll and matching tests, or the proof against the sealed
// EXPECTED.json, fail with an assertion. A survivor is a rule nothing holds.
//   node scripts/test-bank-roll-mutations.mjs
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
  process.env.BANK_ROLL_MUTATION_DIR ?? join(root, 'work/bank-roll-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/bank-statement-roll.test.ts',
  'tests/bank-statement-match.test.ts',
];
const proof = 'scripts/bank-roll-proof.mjs';
const ROLL = 'lib/reconciliation/bank-statement-roll.ts';
const MATCH = 'lib/reconciliation/bank-statement-match.ts';
const LIFE = 'lib/reconciliation/bank-statement-lifecycle.ts';
const mutations = [
  // The previous period: read whole, printed, proved and closed.
  [
    'previous-table-statement-read',
    ROLL,
    '      scope.currency !== null ||\n      scope.period !== null ||\n      scope.confirmedClosing !== null\n',
    '      false\n',
  ],
  [
    'previous-held-not-named',
    ROLL,
    "if (result.status === 'held')\n    refuse('ROLL_PREVIOUS_HELD'",
    "if (false)\n    refuse('ROLL_PREVIOUS_HELD'",
  ],
  [
    'previous-undecided-carried',
    ROLL,
    "if (result.status !== 'reviewed') refuse('ROLL_PREVIOUS_UNDECIDED');",
    '',
  ],
  // Continuity.
  [
    'continuity-currency-ignored',
    ROLL,
    'if (previous.reading.currency !== current.reading.currency)',
    'if (false)',
  ],
  [
    'continuity-any-later-period',
    ROLL,
    'nextDay(before.end) !== after.start',
    'before.end >= after.start',
  ],
  [
    'continuity-opening-ignored',
    ROLL,
    '    previous.reading.closing !== current.reading.opening\n',
    '    false\n',
  ],
  // The chain.
  [
    'chain-fingerprint-unchecked',
    ROLL,
    'if ((await digest(parts.previous.original)) !== parts.previous.sha256)',
    'if (false)',
  ],
  [
    'chain-continuity-unchecked',
    ROLL,
    "    if (problem)\n      refuse('ROLL_PREVIOUS_UNREADABLE', `its previous period: ${problem}`);",
    '',
  ],
  [
    'chain-open-carried-case',
    ROLL,
    'if (cleared.cases.length)',
    'if (false)',
  ],
  ['chain-age-not-advanced', ROLL, 'left.push(...cleared.still);', 'left.push(...before.left);'],
  ['still-age-not-advanced', ROLL, '.map((c) => ({ ...c, age: c.age + 1 }))', '.map((c) => ({ ...c }))'],
  // Provenance.
  ['source-always-statement', ROLL, 'source: m ? statement256 : cashbook256,', 'source: statement256,'],
  ['session-of-current', ROLL, 'session: session256,', "session: '',"],
  // Repetition.
  [
    'repetition-voucher-ignored',
    ROLL,
    "(own === 'C' && x.id === c.id)",
    'false',
  ],
  [
    'repetition-reference-not-withheld',
    ROLL,
    '    if (c.reference)\n      for (const x of current)\n        if (x.reference === c.reference) members.add(x.key);\n',
    '',
  ],
  ['restated-amount-ignored', ROLL, '        x.amount !== c.amount ||\n', ''],
  ['restated-date-ignored', ROLL, '        x.date !== c.date,', '        false,'],
  [
    'own-matching-not-withheld',
    ROLL,
    'matchBankStatement(reading, cashbook, { ...options, withheld })',
    'matchBankStatement(reading, cashbook, { ...options })',
  ],
  // Carried items against what the own matching left.
  [
    'pairing-with-matched-items',
    ROLL,
    'const unmatched = current.filter((x) => left.has(x.key));',
    'const unmatched = current;',
  ],
  ['pairing-direction-ignored', ROLL, 'x.side === other && x.direction === c.direction', 'x.side === other'],
  ['pairing-same-side', ROLL, 'x.side === other && x.direction === c.direction', 'x.direction === c.direction'],
  ['amount-difference-as-reference', ROLL, 'byReference[0].amount === c.amount', 'true'],
  ['reference-ambiguity-picked', ROLL, 'byReference.length > 1', 'false'],
  ['amount-across-references', ROLL, '(!c.reference || !x.reference)', 'true'],
  ['amount-ambiguity-picked', ROLL, "found.length > 1 ? 'carried-ambiguous' : 'carried-amount-suggestion'", "'carried-amount-suggestion'"],
  ['shared-claim-not-ambiguous', ROLL, 'g.items.size > 1', 'false'],
  ['cases-not-in-carried-order', ROLL, '    .sort((a, b) => byRank(a.carried[0], b.carried[0]))\n', ''],
  // The matcher's withheld items.
  ['withheld-matched', MATCH, 'const used = new Set<string>(options.withheld);', 'const used = new Set<string>();'],
  [
    'withheld-statement-references-kept',
    MATCH,
    '    movements.filter((r) => !used.has(`S:${r.id}`)),\n',
    '    movements,\n',
  ],
  [
    'withheld-cashbook-references-kept',
    MATCH,
    '    cashbook.filter((r) => !used.has(`C:${r.id}`)),\n',
    '    cashbook,\n',
  ],
  // The roll session format.
  ['roll-format-key-missing', LIFE, "...(roll ? ['previous'] : []),", '...([] as string[]),'],
  ['any-session-version', LIFE, '(parsed.version !== BANK_STATEMENT_LIFECYCLE_VERSION && !roll) ||', 'false ||'],
  ['restore-reads-roll-format', LIFE, '  if (previous) fail(\'SESSION\');\n  return state;', '  return state;'],
];

const files = [...new Set(mutations.map(([, file]) => file)), ...tests, proof];
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
  const unit = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    options,
  );
  if (!completedSuccessfully(unit)) return unit;
  return spawnSync(process.execPath, ['--experimental-strip-types', proof], {
    ...options,
    env: { ...process.env, BANK_ROLL_PROOF_DIR: join(cwd, 'work/bank-roll-proof') },
  });
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
        proof,
        'audit/bank-roll-foundation',
        'audit/bank-statement-foundation',
        'audit/bank-statement-holdout-g8/frozen',
        'audit/bank-statement-holdout-g14/frozen',
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
