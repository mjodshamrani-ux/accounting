// WF-1 TOL-1 code mutations: each planted defect in a private copy of the
// declared tolerance (bank-statement-tolerance.ts, and where the lifecycle,
// the sheet and the state capture carry it, T1) must make the unit tests or
// the proof against the sealed EXPECTED.json fail with an assertion. A
// survivor is a rule nothing holds.
//   node scripts/test-bank-tolerance-mutations.mjs
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
  process.env.BANK_TOLERANCE_MUTATION_DIR ??
  join(root, 'work/bank-tolerance-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
// BANK_TOLERANCE_PROOF_ONLY=1 measures the proof alone, without the unit tests.
const only = process.env.BANK_TOLERANCE_PROOF_ONLY;
const tests = only ? [] : ['tests/bank-statement-tolerance.test.ts'];
const proofs = [['scripts/bank-tolerance-proof.mjs']];
const packages = [
  'audit/bank-tolerance-foundation',
  'audit/bank-roll-foundation',
];
const TOL = 'lib/reconciliation/bank-statement-tolerance.ts';
const LIFE = 'lib/reconciliation/bank-statement-lifecycle.ts';
const SHEET = 'lib/reconciliation/bank-statement-sheet.ts';
const REQUEST = 'lib/reconciliation/bank-statement-request.ts';
const mutations = [
  // The policy and its rules.
  [
    'currency-without-minor-unit',
    TOL,
    "  if (!exponent) throw new ToleranceRefused('CURRENCY');",
    "  if (exponent === undefined) throw new ToleranceRefused('CURRENCY');",
  ],
  [
    'one-major-unit-allowed',
    TOL,
    '    perItem >= major\n',
    '    perItem > major\n',
  ],
  ['zero-allowed', TOL, '    perItem < 1 ||\n', '    perItem < 0 ||\n'],
  [
    'fraction-allowed',
    TOL,
    '    !Number.isSafeInteger(perItem) ||\n',
    '    !Number.isFinite(perItem) ||\n',
  ],
  [
    'period-below-the-pair',
    TOL,
    '    perPeriod < perItem ||\n',
    '    perPeriod < 1 ||\n',
  ],
  [
    'period-ceiling-inclusive',
    TOL,
    '    perPeriod >= 100 * major\n',
    '    perPeriod > 100 * major\n',
  ],
  ['blank-note', TOL, '    !note.trim() ||\n', '    !note ||\n'],
  [
    'line-break-in-note',
    TOL,
    '    /[\\p{Cc}\\p{Cf}]/u.test(note)\n',
    '    /[\\p{Cf}]/u.test(note)\n',
  ],
  ['note-unbounded', TOL, '    note.length > TOLERANCE_NOTE_LIMIT ||\n', ''],
  // Eligibility and the period.
  [
    'other-reasons-eligible',
    TOL,
    "      c.reason !== 'amount-difference' ||\n",
    '',
  ],
  [
    'window-ignored',
    TOL,
    '      Math.abs(dayNumber(s.date) - dayNumber(e.date)) >\n        match.policy.dateWindowDays ||\n',
    '',
  ],
  [
    'limit-exclusive',
    TOL,
    '      Math.abs(difference) > policy.perItem',
    '      Math.abs(difference) >= policy.perItem',
  ],
  [
    'differences-netted',
    TOL,
    '  const sum = eligible.reduce((t, p) => t + Math.abs(p.amounts.difference), 0);',
    '  const sum = Math.abs(eligible.reduce((t, p) => t + p.amounts.difference, 0));',
  ],
  [
    'period-total-inclusive',
    TOL,
    '    exceeded: sum > policy.perPeriod,',
    '    exceeded: sum >= policy.perPeriod,',
  ],
  // The lifecycle.
  [
    'policy-not-checked',
    LIFE,
    '    state.tolerance && tolerancePolicy(state.tolerance, reading.currency);',
    '    state.tolerance && { ...state.tolerance };',
  ],
  [
    'policy-outside-the-context',
    LIFE,
    '  const context = policy\n    ? JSON.stringify([...JSON.parse(base.context), { tolerance: policy }])\n    : base.context;',
    '  const context = base.context;',
  ],
  [
    'tolerated-in-part',
    LIFE,
    '  if (tolerance && !tolerance.exceeded)',
    '  if (tolerance)',
  ],
  [
    'tolerated-shown-as-review',
    LIFE,
    "        kind: 'tolerated',\n        reason: 'within-tolerance',",
    "        kind: 'review',\n        reason: 'within-tolerance',",
  ],
  ['amounts-dropped', LIFE, '        amounts: { ...p.amounts },\n', ''],
  [
    'undo-to-review',
    LIFE,
    "      if (c.kind === 'tolerated') c.status = 'matched-tolerated';\n",
    '',
  ],
  [
    'tolerated-accepted',
    LIFE,
    "      if (c.status !== 'needs-review' || !ACCEPTABLE.has(c.reason))",
    "      if (c.status !== 'matched-tolerated' && (c.status !== 'needs-review' || !ACCEPTABLE.has(c.reason)))",
  ],
  [
    'exported-without-the-policy',
    LIFE,
    "  if (result.tolerance) fail('EXPORT_TOLERANCE');\n",
    '',
  ],
  [
    'sheet-drops-the-policy',
    LIFE,
    '    decisions: state.decisions,\n    ...(state.tolerance ? { tolerance: state.tolerance } : {}),\n',
    '    decisions: state.decisions,\n',
  ],
  // The sheet.
  [
    'effect-sign-of-a-payment',
    SHEET,
    "          direction === 'in'\n            ? a.statement - a.cashbook\n            : a.cashbook - a.statement,",
    '          a.statement - a.cashbook,',
  ],
  [
    'tolerance-reads-as-reconciled',
    SHEET,
    "            ? 'reconciled-within-tolerance'",
    "            ? 'reconciled'",
  ],
  [
    'tolerance-hides-the-difference',
    SHEET,
    '  const unexplained = difference - tolerated;',
    '  const unexplained = toleratedDifferences.length ? 0 : difference;',
  ],
  [
    'status-by-the-whole-difference',
    SHEET,
    '          ? unexplained === 0',
    '          ? difference === 0',
  ],
  // The state capture.
  [
    'policy-form-loose',
    REQUEST,
    "    !statementKeys(value, ['perItem', 'perPeriod', 'note']) ||\n",
    '',
  ],
  [
    'sheet-state-drops-the-policy',
    REQUEST,
    '    sheet: snapshotSheetInputs(sheet),\n    ...(state.tolerance ? { tolerance: state.tolerance } : {}),\n',
    '    sheet: snapshotSheetInputs(sheet),\n',
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
      options,
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
