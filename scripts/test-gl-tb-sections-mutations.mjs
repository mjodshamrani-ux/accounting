// GLT-1 code mutations: each planted defect in a private copy of the
// gl-tb-sections-1 engine (gl-tb-sections.ts) or its replay must make its unit
// tests fail with an assertion. A survivor is a guard nothing holds.
//   node scripts/test-gl-tb-sections-mutations.mjs
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
  process.env.GLS_MUTATION_DIR ?? join(root, 'work/gl-tb-sections-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/gl-tb-sections.test.ts'];
const ENGINE = 'lib/reconciliation/gl-tb-sections.ts';
const REPLAY = 'lib/reconciliation/gl-tb-sections-io.ts';
const mutations = [
  // Inputs and scope.
  [
    'reading-unconfirmed-accepted',
    ENGINE,
    '      r.confirmed !== true ||\n',
    '',
  ],
  [
    'roles-in-any-order',
    ENGINE,
    '      r.role !== GLS_ROLES[i]\n',
    '      !GLS_ROLES.includes(r.role)\n',
  ],
  [
    'currency-from-the-prototype',
    ENGINE,
    '!Object.hasOwn(GLS_CURRENCIES, scope.currency)',
    '!(scope.currency in GLS_CURRENCIES)',
  ],
  [
    'basis-unchecked',
    ENGINE,
    "    scope.currencyBasis !== 'functional' ||\n",
    '',
  ],
  [
    'start-after-end-allowed',
    ENGINE,
    '    scope.start > scope.end\n',
    '    false\n',
  ],
  [
    'same-source-allowed',
    ENGINE,
    "  if (input.files[0].sha256 === input.files[1].sha256)\n    fail('INDEPENDENT_SOURCES');\n",
    '',
  ],
  // Reading.
  ['every-space-trimmed', ENGINE, "v.replace(/^ +| +$/g, '')", 'v.trim()'],
  ['length-in-code-units', ENGINE, '[...s].length > 500', 's.length > 500'],
  ['minus-prefix-allowed', ENGINE, '/^[=+@-]/.test(s)', '/^[=+@]/.test(s)'],
  [
    'excel-errors-case-sensitive',
    ENGINE,
    's.toUpperCase().startsWith(e)',
    's.startsWith(e)',
  ],
  ['other-spaces-allowed', ENGINE, '|(?! )\\p{Z}/u', '/u'],
  [
    'century-leap-years',
    ENGINE,
    '(y % 4 === 0 && y % 100 !== 0) || y % 400 === 0',
    'y % 4 === 0',
  ],
  ['day-31-everywhere', ENGINE, 'd <= days[mo - 1]', 'd <= 31'],
  [
    'arabic-digits-not-read',
    ENGINE,
    '    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))\n',
    '',
  ],
  [
    'persian-digits-not-read',
    ENGINE,
    '    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))\n',
    '',
  ],
  ['arabic-decimal-not-read', ENGINE, "\n    .replace(/٫/g, '.');", ';'],
  [
    'extra-decimals-allowed',
    ENGINE,
    "(m[2] ?? '').length > decimals",
    "(m[2] ?? '').length > decimals + 1",
  ],
  [
    'no-amount-ceiling',
    ENGINE,
    'return n <= MAX_MINOR ? n : null;',
    'return n;',
  ],
  [
    'blank-amount-is-zero',
    ENGINE,
    '  const s = glsStrip(v)\n',
    "  const s = (glsStrip(v) || '0')\n",
  ],
  // Sections and pages.
  [
    'closure-ignores-the-id',
    ENGINE,
    '        glsStrip(r[1]) === glsStrip(b.opening[1]);\n',
    '        true;\n',
  ],
  [
    'stray-rows-ignored',
    ENGINE,
    '    } else if (!b) strays.push(i + 1);\n',
    '    } else if (!b) void 0;\n',
  ],
  [
    'unknown-labels-allowed',
    ENGINE,
    '    [...counts.keys()].every((n) => names.includes(n)) &&\n',
    '',
  ],
  [
    'repeated-labels-allowed',
    ENGINE,
    'counts.get(name) === 1',
    'counts.get(name)! >= 1',
  ],
  [
    'columns-in-contract-order',
    ENGINE,
    'names.every((n) => map.has(n))',
    'names.every((n, j) => map.get(n) === j)',
  ],
  [
    'unclosed-section-allowed',
    ENGINE,
    "  if (!b.closed) s.codes.add('SECTION_UNCLOSED');\n",
    '',
  ],
  [
    'unclosed-section-excludable',
    ENGINE,
    '  if (s.codes.size) return s;\n  if (!inScope(values, scope)) {\n    s.excluded = true;\n    return s;\n  }\n',
    '  if (whole && !inScope(values, scope)) {\n    s.excluded = true;\n    return s;\n  }\n  if (s.codes.size) return s;\n',
  ],
  [
    'period-not-compared',
    ENGINE,
    'GLS_SCOPE_FIELDS.every((k, i) =>',
    'GLS_SCOPE_FIELDS.slice(0, 6).every((k, i) =>',
  ],
  [
    'wide-records-allowed',
    ENGINE,
    ' || b.body.some((r) => width(r.cells) > GLS_GL_COLUMNS.length)',
    '',
  ],
  [
    'record-identity-unchecked',
    ENGINE,
    "    if (id === null) s.codes.add('IDENTITY');\n",
    '    if (id === null) void 0;\n',
  ],
  [
    'kinds-from-the-prototype',
    ENGINE,
    'Object.hasOwn(roles, kind)',
    'kind in roles',
  ],
  [
    'opening-date-unchecked',
    ENGINE,
    "      (kind === 'opening' && date !== scope.start) ||\n",
    '',
  ],
  [
    'movement-end-unchecked',
    ENGINE,
    '(date < scope.start || date > scope.end)',
    '(date < scope.start)',
  ],
  [
    'repeated-record-ids-allowed',
    ENGINE,
    "  if ([...ids.values()].some((n) => n > 1)) s.codes.add('DUPLICATE_RECORD');\n",
    '',
  ],
  [
    'repeated-roles-allowed',
    ENGINE,
    "  if (roles.opening.length > 1 || roles.closing.length > 1)\n    s.codes.add('ROLE_REPEATED');\n",
    '',
  ],
  [
    'first-movement-only',
    ENGINE,
    'roles.movement.reduce(',
    'roles.movement.slice(0, 1).reduce(',
  ],
  [
    'opening-sides-swapped',
    ENGINE,
    's.six = [o[0]!, o[1]!,',
    's.six = [o[1]!, o[0]!,',
  ],
  [
    'row-type-folded',
    ENGINE,
    "const kind = glsStrip(get('Row type'));",
    "const kind = glsStrip(get('Row type')).toLowerCase();",
  ],
  [
    'parent-not-read',
    ENGINE,
    "const parent = written ? glsText(written) : '';",
    'const parent = written;',
  ],
  [
    'wide-tb-rows-allowed',
    ENGINE,
    ' && width(r.cells) <= GLS_TB_COLUMNS.length',
    '',
  ],
  [
    'tb-period-columns-swapped',
    ENGINE,
    "  'Period debit',\n  'Period credit',\n  'Closing debit',",
    "  'Period credit',\n  'Period debit',\n  'Closing debit',",
  ],
  [
    'unclosed-page-allowed',
    ENGINE,
    'unreadable: !whole || !cols || !b.closed,',
    'unreadable: !whole || !cols,',
  ],
  [
    'page-scope-unchecked',
    ENGINE,
    '  if (!inScope(values, scope)) {\n    p.excluded = true;',
    '  if (false) {\n    p.excluded = true;',
  ],
  // Judgement.
  [
    'section-unreadable-holds-nothing',
    ENGINE,
    "      run.add('SECTION_UNREADABLE');\n",
    '',
  ],
  [
    'dimensions-inherited-silently',
    ENGINE,
    "    if (byCode.has(account)) hold(key, 'SECTION_HEADER');\n",
    '',
  ],
  ['duplicate-key-allowed', ENGINE, '      found.length > 1 ||\n', ''],
  [
    'duplicate-id-allowed',
    ENGINE,
    '      found.some((s) => s.id !== null && ids.get(s.id)! > 1)\n',
    '      false\n',
  ],
  [
    'page-unreadable-holds-nothing',
    ENGINE,
    "      run.add('PAGE_UNREADABLE');\n",
    '',
  ],
  [
    'row-unreadable-holds-nothing',
    ENGINE,
    "      run.add('ROW_UNREADABLE');\n",
    '',
  ],
  [
    'leading-zero-dropped',
    ENGINE,
    '  JSON.stringify([account, dims]);',
    "  JSON.stringify([account.replace(/^0+/, ''), dims]);",
  ],
  [
    'tb-conflict-allowed',
    ENGINE,
    "    if (found.length > 1) hold(key, 'TB_CONFLICT');",
    "    if (false) hold(key, 'TB_CONFLICT');",
  ],
  ['totals-across-dimensions', ENGINE, ' && r.dims === t.dims', ''],
  [
    'child-amount-counted-as-zero',
    ENGINE,
    '      t.six.includes(null) ||\n      children.some((r) => r.six.includes(null))\n',
    '      t.six.includes(null)\n',
  ],
  [
    'total-mismatch-ignored',
    ENGINE,
    "      code = 'TOTAL_MISMATCH';",
    '      code = null;',
  ],
  [
    'stray-holds-nothing',
    ENGINE,
    '    for (const code of run) hold(key, code);',
    "    for (const code of run) if (code !== 'STRAY_ROW') hold(key, code);",
  ],
  [
    'zero-tb-row-passes',
    ENGINE,
    "      ...(s ? s.missing : ['GL_SECTION_ABSENT']),\n      ...(r ? [] : ['TB_ROW_ABSENT']),\n    ].sort(byText);\n    const g = s?.six ?? null,\n",
    "      ...(s ? s.missing : r && !r.six.some(Boolean) ? [] : ['GL_SECTION_ABSENT']),\n      ...(r ? [] : ['TB_ROW_ABSENT']),\n    ].sort(byText);\n    const g = s?.six ?? (r && !r.six.some(Boolean) ? [0, 0, 0, 0, 0, 0] : null),\n",
  ],
  [
    'bridges-after-components',
    ENGINE,
    '    } else if (bridge(g!) || bridge(t!)) {',
    '    } else if (g!.every((v, i) => v === t![i]) && (bridge(g!) || bridge(t!))) {',
  ],
  [
    'net-instead-of-components',
    ENGINE,
    '    } else if (g!.some((v, i) => v !== t![i])) {',
    '    } else if (g![4] - g![5] !== t![4] - t![5]) {',
  ],
  // Replay.
  [
    'replay-trusts-page-rows',
    REPLAY,
    '    const file = await readFile(old.name, old.original);\n',
    '    const file = input.files[snapshots.indexOf(old)];\n',
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
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
