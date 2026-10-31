// FIN-1 code mutations: each planted defect in a private copy of the
// tb-financial-hierarchy-1 engine (tb-financial-hierarchy.ts) or its replay
// must make its unit tests fail with an assertion. A survivor is a guard
// nothing holds.
//   node scripts/test-tb-financial-hierarchy-mutations.mjs
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
  process.env.FINH_MUTATION_DIR ??
  join(root, 'work/tb-financial-hierarchy-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/tb-financial-hierarchy.test.ts'];
const ENGINE = 'lib/reconciliation/tb-financial-hierarchy.ts';
const REPLAY = 'lib/reconciliation/tb-financial-hierarchy-io.ts';
const mutations = [
  // Input and scope.
  [
    'identical-sources-accepted',
    ENGINE,
    "    fail('INDEPENDENT_SOURCES');",
    '    void 0;',
  ],
  ['non-csv-name-accepted', ENGINE, '      !/\\.csv$/i.test(f.name) ||\n', ''],
  ['roles-in-any-order', ENGINE, '      r.role !== FINH_ROLES[i] ||\n', ''],
  ['scope-unconfirmed-accepted', ENGINE, '    s.confirmed !== true ||\n', ''],
  ['any-currency', ENGINE, '    currencyPrecision(f.Currency) !== 2 ||\n', ''],
  [
    'three-decimal-currency',
    ENGINE,
    'currencyPrecision(f.Currency) !== 2',
    'currencyPrecision(f.Currency) === undefined',
  ],
  [
    'posting-status-unchecked',
    ENGINE,
    "    f['Posting status'] !== 'posted' ||\n",
    '',
  ],
  [
    'closing-basis-unchecked',
    ENGINE,
    "    f['Closing basis'] !== 'post-closing' ||\n",
    '',
  ],
  [
    'period-reversed-allowed',
    ENGINE,
    "    f['Period start'] > f['Period end'] ||\n",
    '',
  ],
  [
    'as-of-free',
    ENGINE,
    "    f['As of'] !== f['Period end']\n",
    "    !validDate(f['As of'])\n",
  ],
  [
    'period-end-date-unchecked',
    ENGINE,
    "    !validDate(f['Period end']) ||\n",
    '',
  ],
  // Reading.
  [
    'byte-limit-off',
    ENGINE,
    'if (file.bytes.byteLength > LIMITS.bytes) {',
    'if (file.bytes.byteLength > 8 * LIMITS.bytes) {',
  ],
  [
    'bom-stripped',
    ENGINE,
    '{ fatal: true, ignoreBOM: true }',
    '{ fatal: true, ignoreBOM: false }',
  ],
  [
    'bom-read-as-a-broken-quote',
    ENGINE,
    "    if (text.startsWith('\\uFEFF')) {",
    '    if (false) {',
  ],
  [
    'bad-utf8-replaced',
    ENGINE,
    '{ fatal: true, ignoreBOM: true }',
    '{ fatal: false, ignoreBOM: true }',
  ],
  [
    'csv-error-ignored',
    ENGINE,
    "    if (parsed.reason === 'CSV') {\n      problem('CSV', source, parsed.records.length + 1);\n      continue;\n    }\n",
    '',
  ],
  [
    'extra-column-allowed',
    ENGINE,
    '      header.length !== wanted.length ||\n',
    '',
  ],
  [
    'row-and-text-limits-ignored',
    ENGINE,
    '    if (parsed.reason) {\n      problem(parsed.reason, source, parsed.records.length);\n      continue;\n    }\n',
    '',
  ],
  [
    'short-row-read',
    ENGINE,
    "        problem('WIDTH', source, row);\n        continue;\n",
    '',
  ],
  [
    'hidden-identity-allowed',
    ENGINE,
    "if (hidden(cells[field])) problem('IDENTITY', source, row, field);",
    'void field;',
  ],
  [
    'row-scope-unchecked',
    ENGINE,
    '      if (SCOPE.some((k) => cells[k] !== scope[k]))\n        problem(',
    '      if (false)\n        problem(',
  ],
  [
    'empty-source-silent',
    ENGINE,
    "    if (!tables[source].length) problem('EMPTY_SOURCE', source, 1);",
    '    if (!tables[source].length) void 0;',
  ],
  [
    'empty-source-readable',
    ENGINE,
    '    else entry.readable = true;',
    '    entry.readable = true;',
  ],
  // Identity and duplicates.
  [
    'blank-identity-allowed',
    ENGINE,
    '      if (fields.some((f) => !r.cells[f])) {',
    '      if (false) {',
  ],
  [
    'first-duplicate-wins',
    ENGINE,
    '        for (const r of group) problem(code, r.source, r.row, fields.join',
    '        for (const r of group.slice(1)) problem(code, r.source, r.row, fields.join',
  ],
  // Money and the TB.
  [
    'three-decimals-read',
    ENGINE,
    '(?:\\.[0-9]{1,2})?$/.test(value)',
    '(?:\\.[0-9]{1,3})?$/.test(value)',
  ],
  ['leading-zeros-read', ENGINE, '/^-?(?:0|[1-9][0-9]*)', '/^-?(?:[0-9]+)'],
  [
    'negative-debit-read',
    ENGINE,
    '(nonnegative && minor < 0n)',
    '(nonnegative && minor < -1000000n)',
  ],
  [
    'value-limit-off',
    ENGINE,
    '    if (abs(minor) > LIMIT || (nonnegative',
    '    if (abs(minor) > 10n * LIMIT || (nonnegative',
  ],
  [
    'aggregate-limit-on-terms-only',
    ENGINE,
    '    if (values.some((v) => abs(v) > LIMIT) || abs(total) > LIMIT)',
    '    if (values.some((v) => abs(v) > LIMIT))',
  ],
  [
    'unknown-tb-class-allowed',
    ENGINE,
    "    if (!isCategory(r.cells['Account class']))\n      problem(",
    '    if (false)\n      problem(',
  ],
  [
    'both-sides-allowed',
    ENGINE,
    "      if (dr > 0n && cr > 0n) problem('BOTH_SIDES', 0, r.row);",
    '      void 0;',
  ],
  [
    'tb-balance-unchecked',
    ENGINE,
    "      if (debit !== credit) problem('TB_BALANCE', 0);",
    '      void 0;',
  ],
  [
    'no-account-silent',
    ENGINE,
    "  if (read[0] && !tb.length) problem('NO_ACCOUNT', 0);",
    '',
  ],
  // Map and evidence on their own.
  [
    'mapping-sign-unchecked',
    ENGINE,
    "    if (!signs.includes(r.cells.Sign)) problem('SIGN', 1, r.row);",
    '    void r;',
  ],
  [
    'validity-start-unchecked',
    ENGINE,
    "      (dates['Valid from'] > scope['Period start'] ||\n",
    '      (false ||\n',
  ],
  [
    'validity-end-unchecked',
    ENGINE,
    "        dates['Valid to'] < scope['Period end'] ||\n",
    '',
  ],
  [
    'validity-at-as-of',
    ENGINE,
    "        dates['Valid to'] < scope['Period end'] ||",
    "        dates['Valid to'] < scope['Period start'] ||",
  ],
  [
    'loose-dates',
    ENGINE,
    '      if (validDate(r.cells[field])) dates[field] = r.cells[field];',
    '      if (/^\\d{4}-\\d{1,2}-\\d{1,2}$/.test(r.cells[field])) dates[field] = r.cells[field];',
  ],
  [
    'reference-optional',
    ENGINE,
    "    if (!r.cells['Evidence reference']) problem('PROOF_REFERENCE', 2, r.row);",
    '',
  ],
  // The tree.
  [
    'unknown-kind-read',
    ENGINE,
    "      problem('KIND', 3, r.row, 'Kind');\n      continue;",
    '      void 0;',
  ],
  [
    'title-with-amount',
    ENGINE,
    "      if (r.cells['Parent ID'] || r.cells.Amount || r.cells['Line class'])",
    "      if (r.cells['Parent ID'])",
  ],
  [
    'unknown-line-class',
    ENGINE,
    "    if (!isCategory(r.cells['Line class']))\n      problem('CLASSIFICATION', 3, r.row, 'Line class');\n    amounts",
    '    amounts',
  ],
  [
    'leaf-may-be-a-parent',
    ENGINE,
    "    if (!owner || owner.cells.Kind !== 'parent')",
    '    if (!owner)',
  ],
  [
    'absent-parent-ignored',
    ENGINE,
    "    if (!owner || owner.cells.Kind !== 'parent')",
    "    if (owner && owner.cells.Kind !== 'parent')",
  ],
  [
    'child-class-free',
    ENGINE,
    "      if (owner.cells['Line class'] !== r.cells['Line class'])\n        problem(",
    '      if (false)\n        problem(',
  ],
  [
    'cycle-silent',
    ENGINE,
    "        problem('CYCLE', 3, r.row, 'Parent ID');",
    '        void 0;',
  ],
  [
    'depth-one-more',
    ENGINE,
    '      if (visited.size > LIMITS.depth) {',
    '      if (visited.size > LIMITS.depth + 1) {',
  ],
  [
    'empty-parent-allowed',
    ENGINE,
    "    if (!kids.length) problem('EMPTY_PARENT', 3, r.row);",
    '',
  ],
  [
    'control-unchecked',
    ENGINE,
    "        if (difference !== 0n) problem('CONTROL_TOTAL', 3, r.row, 'Amount');",
    '',
  ],
  [
    'control-on-ambiguous-children',
    ENGINE,
    "      kids.every((k) => unique(k.cells['Node ID'])) &&\n",
    '',
  ],
  [
    'no-leaf-silent',
    ENGINE,
    "    problem('NO_FINANCIAL_LEAF', 3);",
    '    void 0;',
  ],
  [
    'parents-counted-in-categories',
    ENGINE,
    '      categoryOf(leaves, (r) => amounts.get(r)!),',
    '      categoryOf(statement.filter(financial), (r) => amounts.get(r)!),',
  ],
  [
    'equation-unchecked',
    ENGINE,
    "    if (reported.equation !== 0n) problem('STATEMENT_EQUATION', 3);",
    '',
  ],
  [
    'equation-on-duplicates',
    ENGINE,
    "    statement.every((r) => !financial(r) || unique(r.cells['Node ID'])) &&\n",
    '',
  ],
  // Across the sources.
  [
    'unmapped-account-silent',
    ENGINE,
    "      if (!mappedKeys.has(k)) problem('UNMAPPED_ACCOUNT', 0, group[0].row);",
    "      if (k === '') problem('UNMAPPED_ACCOUNT', 0, group[0].row);",
  ],
  [
    'proof-account-unchecked',
    ENGINE,
    "      if (!a && !ambiguousAccount) problem('PROOF_ACCOUNT', 2, p.row);",
    '',
  ],
  [
    'proof-may-cite-a-parent',
    ENGINE,
    "        (!line || line.cells.Kind !== 'leaf')\n      )\n        problem('PROOF_LINE'",
    "        !line\n      )\n        problem('PROOF_LINE'",
  ],
  [
    'proof-class-free-of-tb',
    ENGINE,
    "      if (a && a.cells['Account class'] !== p.cells['Account class'])",
    '      if (false)',
  ],
  [
    'proof-label-free',
    ENGINE,
    " ||\n          p.cells['Line label'] !== line.cells['Line label'])",
    ')',
  ],
  [
    'proof-classes-may-differ',
    ENGINE,
    "      if (p.cells['Account class'] !== p.cells['Line class'])\n        problem(",
    '      if (false)\n        problem(',
  ],
  [
    'proof-sign-policy-off',
    ENGINE,
    '      if (cls && isCategory(cls) && p.cells.Sign !== policy(cls))',
    '      if (false)',
  ],
  [
    'mapping-account-unchecked',
    ENGINE,
    "      if (!tbKeys.has(k)) problem('MAPPING_ACCOUNT', 1, m.row);",
    '',
  ],
  [
    'mapping-may-target-a-parent',
    ENGINE,
    "        (!target || target.cells.Kind !== 'leaf')",
    '        !target',
  ],
  [
    'missing-proof-silent',
    ENGINE,
    "      if (!proofContenders) problem('MISSING_PROOF', 1, m.row);",
    '',
  ],
  [
    'mapping-sign-free-of-proof',
    ENGINE,
    "        ['Account ID', 'Complete dimensions', 'Line ID', 'Sign'].some(",
    "        ['Account ID', 'Complete dimensions', 'Line ID'].some(",
  ],
  [
    'mapping-line-free-of-proof',
    ENGINE,
    "        ['Account ID', 'Complete dimensions', 'Line ID', 'Sign'].some(",
    "        ['Account ID', 'Complete dimensions', 'Sign'].some(",
  ],
  [
    'mapping-sign-policy-off',
    ENGINE,
    '        m.cells.Sign !== policy(cls)\n',
    '        false\n',
  ],
  [
    'credit-positive-not-turned',
    ENGINE,
    "          : m.cells.Sign === 'debit-positive'\n            ? net!\n            : -net!;",
    '          : net!;',
  ],
  [
    'duplicate-map-contributes',
    ENGINE,
    '        (mapByKey.get(k)?.length ?? 0) === 1 &&\n',
    '',
  ],
  [
    'duplicate-tb-contributes',
    ENGINE,
    '        !ambiguousAccount &&\n        (mapByKey',
    '        (mapByKey',
  ],
  [
    'unused-proof-silent',
    ENGINE,
    "        problem('UNUSED_PROOF', 2, p.row);",
    '        void p;',
  ],
  [
    'unmapped-leaf-silent',
    ENGINE,
    "      if (!entry) problem('UNMAPPED_LEAF', 3, leaf.row);",
    '',
  ],
  [
    'leaf-total-unchecked',
    ENGINE,
    "        if (difference !== 0n) problem('LEAF_TOTAL', 3, leaf.row, 'Amount');",
    '',
  ],
  [
    'leaf-without-tb-member-compared',
    ENGINE,
    '        entry.members.some((m) => m.tbRow !== null) &&\n',
    '',
  ],
  // Facts.
  ['ownership-from-title', ENGINE, '        .filter(financial)\n', ''],
  // Replay.
  [
    'replay-hash-trusted',
    REPLAY,
    "    if (c.claimed !== undefined && c.claimed !== sha256)\n      throw new Error('FINH_SOURCE_HASH');\n",
    '',
  ],
  [
    'replay-reads-the-callers-buffer',
    REPLAY,
    '      bytes: new Uint8Array(f.original.slice(0)),',
    '      bytes: new Uint8Array(f.original),',
  ],
];
const files = [ENGINE, REPLAY, ...tests];
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
      survivors: report.mutations
        .filter((r) => !r.killed)
        .map((r) => [r.id, r.infrastructureError ?? '']),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
