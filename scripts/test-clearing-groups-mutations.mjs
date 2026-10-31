// CLR-1b code mutations: each planted defect in a private copy of
// clearing-groups-1 (clearing-groups.ts) must make its tests fail with an
// assertion; clearing-1's own tests run beside them. A survivor is a guard
// nothing holds.
//   node scripts/test-clearing-groups-mutations.mjs
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
  process.env.CLR_GROUPS_MUTATION_DIR ??
  join(root, 'work/clearing-groups-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/clearing-groups.test.ts', 'tests/clearing.test.ts'];
const support = ['audit/clearing'];
const ENGINE = 'lib/reconciliation/clearing-groups.ts';
const IO = 'lib/reconciliation/clearing-groups-io.ts';
const mutations = [
  [
    'unisolated-lines-ignored',
    ENGINE,
    "if (unisolated) reasons.push('UNISOLATED_ERROR');",
    "if (false) reasons.push('UNISOLATED_ERROR');",
  ],
  [
    'connected-lines-ignored',
    ENGINE,
    "if (connected.length) reasons.push('CONNECTED_ERROR');",
    "if (false) reasons.push('CONNECTED_ERROR');",
  ],
  [
    'posting-numbers-not-keys',
    ENGINE,
    'line.keys.some((k) => k === reference || postings.has(k))',
    'line.keys.some((k) => k === reference)',
  ],
  [
    'keys-reference-cell-only',
    ENGINE,
    'line.keys = [...new Set(values.map((v) => v.trim()).filter(Boolean))];',
    'line.keys = [ref.trim()];',
  ],
  ['empty-reference-isolated', ENGINE, '!!cleanId(ref) &&', 'true &&'],
  ['summary-labels-isolated', ENGINE, '!summaryLabel.test(', '!/^$/.test('],
  [
    'cells-past-the-header-ignored',
    ENGINE,
    '!values.slice(width).some((v) => v.trim()) &&',
    'true &&',
  ],
  [
    'header-copies-isolated',
    ENGINE,
    'JSON.stringify([...cells].sort()) !== JSON.stringify(labels);',
    'true;',
  ],
  [
    'formula-lines-isolated',
    ENGINE,
    '!sheet.formulaRows.includes(row) &&\n      !values.some((_, c) => formulaIn(row, c)) &&',
    'true &&',
  ],
  [
    'hidden-lines-isolated',
    ENGINE,
    'refRead &&\n      !sheet.hiddenRows.includes(row) &&',
    'refRead &&',
  ],
  [
    'isolation-without-a-clearing-header',
    ENGINE,
    'line.isolated =\n      role &&',
    'line.isolated =\n      true &&',
  ],
  ['duplicates-ignored', ENGINE, 'if (rows.length > 1) for', 'if (false) for'],
  [
    'duplicates-by-amount-only',
    ENGINE,
    'm.posting,\n      m.reference,\n      m.date,\n      m.amount,\n      m.description,',
    'm.reference,\n      m.amount,',
  ],
  [
    'group-limit-one-short',
    ENGINE,
    'members.length > GROUP_LIMIT',
    'members.length >= GROUP_LIMIT',
  ],
  [
    'one-sided-zero-cleared',
    ENGINE,
    'net !== 0 ||\n        !members.some((m) => m.amount > 0) ||\n        !members.some((m) => m.amount < 0)',
    'net !== 0',
  ],
  [
    'unreferenced-lines-pooled',
    ENGINE,
    'const key = m.reference ? `ref:${m.reference}` : `row:${m.row}`;',
    'const key = `ref:${m.reference}`;',
  ],
  ['period-end-excluded', ENGINE, 'date > s.end', 'date >= s.end'],
  [
    'currency-not-checked',
    ENGINE,
    ' ||\n        cell(r.currency).trim() !== s.currency',
    '',
  ],
  [
    'calendar-not-checked',
    ENGINE,
    "date = parseDate(raw, 'ymd');",
    'date = raw;',
  ],
  ['both-sides-accepted', ENGINE, '(debit !== 0 && credit !== 0)', 'false'],
  [
    'repeated-posting-is-an-error',
    ENGINE,
    "if (!posting) fault('POSTING');",
    "if (!posting || movements.some((m) => m.posting === posting)) fault('POSTING');",
  ],
  [
    'unverified-role-ignored',
    ENGINE,
    "if (!role) reasons.push('UNVERIFIED_REFERENCE_ROLE');",
    "if (false) reasons.push('UNVERIFIED_REFERENCE_ROLE');",
  ],
  [
    'ceiling-read-as-source',
    IO,
    "? 'ROWS' : 'SOURCE'",
    "? 'SOURCE' : 'SOURCE'",
  ],
  [
    'hash-not-checked',
    IO,
    "if (file.sha256 !== source.sha256) refuse('SOURCE_HASH');",
    '',
  ],
  [
    'every-basis-reference',
    ENGINE,
    "basis: reference ? ('REFERENCE' as const) : ('ROW' as const),",
    "basis: 'REFERENCE' as const,",
  ],
  [
    'every-faulty-line-cell',
    ENGINE,
    'code: error.code,',
    "code: 'CELL' as ClearingLineCode,",
  ],
  ['blank-line-faulty', ENGINE, 'blank.push(row);', "fault('POSTING');"],
];
const files = [ENGINE, IO, ...tests];
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
