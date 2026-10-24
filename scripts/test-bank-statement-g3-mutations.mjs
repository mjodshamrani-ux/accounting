// BNK-PDF-1 G3 code mutations: each planted defect in a private copy of the
// statement lifecycle, its request capture or its client binding must make
// the G3 tests fail with an assertion, or else the G3 proof, whose workbooks
// are read by the independent checker. A survivor is a rule nothing holds.
//   node scripts/test-bank-statement-g3-mutations.mjs
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
  process.env.BNK_G3_MUTATION_DIR ??
  join(root, 'work/bank-statement-g3-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/bank-statement-lifecycle.test.ts',
  'tests/bank-statement-worker.test.ts',
  'tests/helpers/bank-wd-worker.mjs',
];
const proof = 'scripts/bank-statement-g3-proof.mjs';
const LIFE = 'lib/reconciliation/bank-statement-lifecycle.ts';
const REQUEST = 'lib/reconciliation/bank-statement-request.ts';
const CLIENT = 'lib/reconciliation/worker-client.ts';
const mutations = [
  [
    'accept-any-reason',
    LIFE,
    "if (c.status !== 'needs-review' || !ACCEPTABLE.has(c.reason))",
    "if (c.status !== 'needs-review')",
  ],
  [
    'accept-any-status',
    LIFE,
    "if (c.status !== 'needs-review' || !ACCEPTABLE.has(c.reason))",
    'if (!ACCEPTABLE.has(c.reason))',
  ],
  [
    'acceptable-amount-difference',
    LIFE,
    "  'date-gap',\n",
    "  'date-gap',\n  'amount-difference',\n",
  ],
  [
    'reject-over-decision',
    LIFE,
    "if (c.decision !== null) fail('INELIGIBLE');",
    "if (false) fail('INELIGIBLE');",
  ],
  [
    'undo-without-decision',
    LIFE,
    "if (c.decision === null) fail('UNDO');",
    "if (false) fail('UNDO');",
  ],
  [
    'undo-to-review',
    LIFE,
    "c.status = c.kind === 'automatic' ? 'matched-automatic' : 'needs-review';",
    "c.status = 'needs-review';",
  ],
  [
    'context-ignored',
    LIFE,
    "if (e.context !== context || seen.has(e.id)) fail('DECISION');",
    "if (seen.has(e.id)) fail('DECISION');",
  ],
  [
    'repeated-decision-id',
    LIFE,
    "if (e.context !== context || seen.has(e.id)) fail('DECISION');",
    "if (e.context !== context) fail('DECISION');",
  ],
  [
    'members-as-sets',
    LIFE,
    'a.length === b.length && a.every((id, i) => id === b[i]);',
    'a.length === b.length && a.every((id) => b.includes(id));',
  ],
  [
    'cashbook-members-ignored',
    LIFE,
    '!sameIds(c.cashbook, e.cashbook)',
    'false',
  ],
  [
    'held-takes-decisions',
    LIFE,
    "if (match.held && state.decisions.length) fail('HELD');",
    "if (false) fail('HELD');",
  ],
  [
    'statement-hash-unchecked',
    LIFE,
    "if (source.sha256 !== statementFile.sha256) fail('SOURCE_HASH');",
    "if (false) fail('SOURCE_HASH');",
  ],
  [
    'cashbook-hash-unchecked',
    LIFE,
    "if (cashbookSource.sha256 !== cashbookFile.sha256) fail('SOURCE_HASH');",
    "if (false) fail('SOURCE_HASH');",
  ],
  [
    'pdf-scope-override',
    LIFE,
    '      scope.currency !== null ||\n      scope.period !== null ||',
    '      false ||',
  ],
  [
    'confirmation-on-printed-closing',
    LIFE,
    '      scope.confirmedClosing !== null &&\n      reading.status',
    '      false &&\n      reading.status',
  ],
  [
    'context-without-cashbook',
    LIFE,
    'state.files.map((f) => f.sha256),',
    'state.files[0].sha256,',
  ],
  [
    'outstanding-without-rejected',
    LIFE,
    "if (c.status === 'rejected') {",
    'if (false) {',
  ],
  [
    'save-drops-decisions',
    LIFE,
    '      decisions: state.decisions,\n',
    '      decisions: [],\n',
  ],
  [
    'session-format-unchecked',
    LIFE,
    'parsed.format !== BANK_STATEMENT_SESSION_FORMAT ||',
    '',
  ],
  [
    'stale-export',
    LIFE,
    "if (!sameStatementData(result, expected)) fail('STALE_RESULT');",
    '',
  ],
  [
    'export-citation-shifted',
    LIFE,
    "return [m.page, m.items.join(' '), m.date, m.direction, m.amount];",
    "return [m.page, m.items.slice(1).join(' '), m.date, m.direction, m.amount];",
  ],
  [
    'export-movement-ids-shifted',
    LIFE,
    'movementId.set(i, `S${++n}`);',
    'movementId.set(i, `S${n++}`);',
  ],
  [
    'export-source-truncated',
    LIFE,
    'data.slice(at, at + 30000),',
    'data.slice(at, at + 29999),',
  ],
  [
    'worker-reply-unbound',
    LIFE,
    "if (!sameStatementData(captured, expected)) fail('WORKER_BINDING');",
    '',
  ],
  [
    'state-extra-keys',
    REQUEST,
    "!statementKeys(value, ['version', 'files', 'scope', 'decisions']) ||",
    '',
  ],
  [
    'state-shares-bytes',
    REQUEST,
    'original: f.original.slice(0) };',
    'original: f.original };',
  ],
  [
    'decision-note-optional',
    REQUEST,
    '!statementText(e.note, 2000)',
    "typeof e.note !== 'string'",
  ],
  [
    'client-installs-worker-reply',
    CLIENT,
    "          if (action.startsWith('bank-statement-')) {\n            const { validateBankStatementWorkerResponse }",
    '          if (false) {\n            const { validateBankStatementWorkerResponse }',
  ],
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
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  };
  // BNK_G3_PROOF_ONLY=1 measures the proof and its independent checker alone.
  if (!process.env.BNK_G3_PROOF_ONLY) {
    const unit = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        ...tests.filter((t) => t.endsWith('.test.ts')),
      ],
      options,
    );
    if (!completedSuccessfully(unit)) return unit;
  }
  return spawnSync(process.execPath, ['--experimental-strip-types', proof], {
    ...options,
    env: { ...process.env, BNK_G3_PROOF_DIR: join(cwd, 'work/g3-proof') },
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
        'tests/bank-statement-lifecycle.test.ts',
        'tests/bank-statement-worker.test.ts',
        'tests/helpers',
        proof,
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
