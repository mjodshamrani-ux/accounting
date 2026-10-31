// AI-1b code mutations: each planted defect in a private copy of the column
// role adapter (column-role-proposals.ts) must make its unit tests fail with
// an assertion. A survivor is a guard nothing holds.
//   node scripts/test-column-role-mutations.mjs
// Two guards have no mutant, because nothing could tell them apart from the
// rest: the context rebuilt after the reply (the reading snapshot before it
// already refuses any change a context could show) and the second verifier
// run on the whole patch (each role is verified alone and duplicates are
// refused before it).
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
  process.env.COLUMN_ROLE_MUTATION_DIR ??
  join(root, 'work/column-role-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/column-role-proposals.test.ts'];
const ADAPTER = 'lib/reconciliation/column-role-proposals.ts';
const mutations = [
  // The request.
  ['request-not-frozen', ADAPTER, '    Object.freeze(value);\n', ''],
  [
    'request-id-unchecked',
    ADAPTER,
    "  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(requestId))",
    "  if (typeof requestId !== 'string')",
  ],
  [
    'mode-not-honoured',
    ADAPTER,
    "    mapping.mode === 'signed'\n",
    "    true || mapping.mode === 'signed'\n",
  ],
  // The envelope.
  [
    'envelope-keys-unchecked',
    ADAPTER,
    '    !exactKeys(reply, [',
    '    !Object.keys(reply).length || false && !exactKeys(reply, [',
  ],
  [
    'foreign-request-accepted',
    ADAPTER,
    "  if (reply.requestId !== request.requestId) return fail('foreign-request');\n",
    '',
  ],
  [
    'stale-reading-accepted',
    ADAPTER,
    '  if (reply.contextRevision !== request.contextRevision)',
    '  if (false)',
  ],
  [
    'role-twice-accepted',
    ADAPTER,
    '    if (!request.allowed.includes(field) || seen.has(field))',
    '    if (!request.allowed.includes(field))',
  ],
  [
    'any-role-accepted',
    ADAPTER,
    '    if (!request.allowed.includes(field) || seen.has(field))',
    '    if (seen.has(field))',
  ],
  [
    'abstention-reasons-unchecked',
    ADAPTER,
    '      if (!ABSTAIN_REASONS.includes(item.reason as AbstainReason))',
    '      if (false)',
  ],
  [
    'proposal-reasons-unchecked',
    ADAPTER,
    '      !PROPOSE_REASONS.includes(item.reason as ProposeReason) ||\n',
    '',
  ],
  [
    'evidence-unbounded',
    ADAPTER,
    '      item.evidence.length > COLUMN_ROLE_LIMITS.evidence ||\n',
    '',
  ],
  [
    'evidence-keys-unchecked',
    ADAPTER,
    "          exactKeys(cell, ['row', 'column']) &&\n",
    '',
  ],
  // Each role.
  [
    'evidence-outside-window-accepted',
    ADAPTER,
    "    if (!found) return reject('evidence-outside-window');\n",
    '',
  ],
  [
    'evidence-of-another-column-accepted',
    ADAPTER,
    "    if (cell.column !== column + 1) return reject('evidence-elsewhere');\n",
    '',
  ],
  [
    'heading-not-required',
    ADAPTER,
    "  if (!cited.includes(window.header)) return reject('heading-not-cited');\n",
    '',
  ],
  [
    'samples-not-required',
    ADAPTER,
    "    entry.reason === 'heading-and-samples' &&\n",
    '    false &&\n',
  ],
  [
    'verifier-verdict-ignored',
    ADAPTER,
    '  if (!verdict.ok) return reject(verdict.code);\n',
    '',
  ],
  [
    'two-roles-on-one-column-kept',
    ADAPTER,
    '          other.column === outcome.column,',
    '          false,',
  ],
  // Time and the reading.
  [
    'cancel-before-asking-ignored',
    ADAPTER,
    "  if (options.signal?.aborted) return { status: 'refused', code: 'cancelled' };\n",
    '',
  ],
  [
    'timeout-uncapped',
    ADAPTER,
    '  const timeout = Math.min(\n    options.timeoutMs ?? COLUMN_ROLE_LIMITS.timeoutMs,\n    COLUMN_ROLE_LIMITS.timeoutMs,\n  );',
    '  const timeout = options.timeoutMs ?? COLUMN_ROLE_LIMITS.timeoutMs;',
  ],
  [
    'late-reply-accepted',
    ADAPTER,
    "    if (first === 'late' || controller.signal.aborted)",
    '    if (false)',
  ],
  [
    'source-change-ignored',
    ADAPTER,
    '    JSON.stringify({ sheets: file.sheets, pdf: file.pdf, mapping }) !== reading',
    '    false',
  ],
  [
    'reply-length-unchecked',
    ADAPTER,
    '    if (reply.length > COLUMN_ROLE_LIMITS.replyChars)',
    '    if (false)',
  ],
];
const files = [ADAPTER, ...tests];
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
