// FA-1b and FA-1c code mutations: each planted defect in a private copy of
// fixed-assets-sections-1 (fixed-assets-sections.ts), its replay from bytes
// (fixed-assets-sections-io.ts), the worker protocol or the page's binding
// must make its tests fail with an assertion. A survivor is a guard nothing
// holds.
//   node scripts/test-fixed-assets-sections-mutations.mjs
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
  process.env.FA_SECTIONS_MUTATION_DIR ??
  join(root, 'work/fixed-assets-sections-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/fixed-assets-sections.test.ts',
  'tests/fixed-assets-sections-protocol.test.ts',
  'tests/fixed-assets-sections-binding.test.ts',
];
const support = ['tests/helpers'];
const ENGINE = 'lib/reconciliation/fixed-assets-sections.ts';
const IO = 'lib/reconciliation/fixed-assets-sections-io.ts';
const PROTOCOL = 'lib/reconciliation/protocol.ts';
const WORKER = 'lib/reconciliation/worker.ts';
const CLIENT = 'lib/reconciliation/worker-client.ts';
const mutations = [
  [
    'reading-family-unchecked',
    ENGINE,
    '      r.family !== FA_SECTIONS_VERSION ||\n',
    '      false ||\n',
  ],
  [
    'reading-role-order-unchecked',
    ENGINE,
    '      r.role !== FA_SECTIONS_ROLES[i] ||\n',
    '      false ||\n',
  ],
  [
    'reading-unconfirmed',
    ENGINE,
    '      r.confirmed !== true\n    )',
    '      false\n    )',
  ],
  [
    'scope-unconfirmed',
    ENGINE,
    '    scope.confirmed !== true ||\n',
    '    false ||\n',
  ],
  [
    'scope-date-unchecked',
    ENGINE,
    '    sectionsDate(scope.asOf as string) === null\n',
    '    false\n',
  ],
  [
    'text-edges-unchecked',
    ENGINE,
    '    !/^[\\p{Zs}\\u2028\\u2029]|[\\p{Zs}\\u2028\\u2029]$/u.test(v) &&\n',
    '',
  ],
  [
    'text-format-characters-read',
    ENGINE,
    '    !/[\\p{Cc}\\p{Cf}]/u.test(v) &&\n',
    '    !/[\\p{Cc}]/u.test(v) &&\n',
  ],
  ['text-formula-signs-read', ENGINE, '    !/^[=+@-]/.test(v) &&\n', ''],
  ['text-length-uncapped', ENGINE, '    v.length <= 500 &&\n', ''],
  [
    'date-leap-years-ignored',
    ENGINE,
    '  const days = [31, leap ? 29 : 28,',
    '  const days = [31, 29,',
  ],
  [
    'amount-extra-decimals-read',
    ENGINE,
    "  if (!m || (m[2] ?? '').length > places) return null;",
    '  if (!m) return null;',
  ],
  [
    'amount-bound-off',
    ENGINE,
    '  return n <= BOUND ? n : null;',
    '  return n;',
  ],
  [
    'amount-signs-read',
    ENGINE,
    '  const m = /^([0-9]+)(?:\\.([0-9]+))?$/.exec(v);',
    '  const m = /^\\+?([0-9]+)(?:\\.([0-9]+))?$/.exec(v);',
  ],
  [
    'total-limit-off',
    ENGINE,
    "  if (n > SAFE || n < -SAFE) refuseAssetSections('TOTAL_LIMIT');\n",
    '',
  ],
  [
    'trailing-empty-cells-meaningful',
    ENGINE,
    "  while (k && cells[k - 1] === '') k--;\n",
    '',
  ],
  [
    'headers-in-fixed-order',
    ENGINE,
    '    !header.every((h) => head.includes(h))\n',
    '    head.some((h, i) => h !== header[i])\n',
  ],
  ['any-end-closes', ENGINE, "    end[1] === (sid ?? '');", '    true;'],
  [
    'unclosed-read',
    ENGINE,
    "  else if (!closed) sec.code = 'SECTION_UNCLOSED';\n",
    '',
  ],
  [
    'header-unchecked',
    ENGINE,
    "  else if (!headerOk) sec.code = 'SECTION_HEADER';\n",
    '',
  ],
  [
    'unknown-labels-read',
    ENGINE,
    '      return (\n        m.length === 2 &&\n        (FA_SECTIONS_LABELS as readonly string[]).includes(m[0])\n      );',
    '      return true;',
  ],
  [
    'as-of-label-not-a-date',
    ENGINE,
    "    sectionsDate(labels.get('As of')![0]) !== null;",
    '    true;',
  ],
  [
    'section-scope-unchecked',
    ENGINE,
    '  else if (SECTION_SCOPE.some(([label, key]) => once.get(label) !== scope[key]))',
    '  else if (false)',
  ],
  [
    'section-columns-unchecked',
    ENGINE,
    '    !FA_SECTIONS_COLUMNS.every((c) => columns.includes(c))\n  )\n    sec.code',
    '    false\n  )\n    sec.code',
  ],
  [
    'category-unreadable-read',
    ENGINE,
    "  if (!once.has('Category')) sec.code = 'SECTION_UNREADABLE';\n  else if",
    '  if',
  ],
  ['stray-rows-ignored', ENGINE, "      run.add('STRAY_ROW');\n", ''],
  [
    'duplicate-sections-read',
    ENGINE,
    "    if (judged.filter((t) => t.id === s.id).length > 1)\n      s.codes.push('SECTION_DUPLICATE');\n",
    '',
  ],
  [
    'unplaced-row-kept-silently',
    ENGINE,
    "      sec.codes.push('ROW_UNPLACED');\n",
    '',
  ],
  [
    'cells-past-the-columns-read',
    ENGINE,
    "      a.codes.add('CELLS');\n",
    '      a.codes;\n',
  ],
  ['unknown-component-read', ENGINE, "      a.codes.add('COMPONENT');\n", ''],
  [
    'amount-failures-read',
    ENGINE,
    "    if (minor === null) a.codes.add('AMOUNT');\n",
    '',
  ],
  ['valuation-text-unchecked', ENGINE, "    else a.codes.add('TEXT');\n", ''],
  [
    'missing-carrying-derived',
    ENGINE,
    "    if (counts.some((n) => n === 0)) a.codes.add('COMPONENT_MISSING');",
    "    if (counts.slice(0, 3).some((n) => n === 0)) a.codes.add('COMPONENT_MISSING');",
  ],
  [
    'repeated-component-read',
    ENGINE,
    "    if (counts.some((n) => n > 1)) a.codes.add('COMPONENT_REPEATED');\n",
    '',
  ],
  [
    'valuations-unchecked',
    ENGINE,
    "    if (a.vals.size > 1) a.codes.add('VALUATION');\n",
    '',
  ],
  [
    'carrying-unchecked',
    ENGINE,
    '      once.cost! - once.depreciation! - once.impairment! !== once.carrying',
    '      once.cost! - once.depreciation! !== once.carrying',
  ],
  [
    'asset-id-in-two-sections-read',
    ENGINE,
    "      if (where.get(a.id)!.size > 1) a.codes.add('ID_SECTIONS');",
    "      if (where.get(a.id)!.size > 2) a.codes.add('ID_SECTIONS');",
  ],
  [
    'totals-unchecked',
    ENGINE,
    "    if (sum !== total) sec.codes.push('TOTAL_MISMATCH');\n",
    '',
  ],
  [
    'total-fields-unchecked',
    ENGINE,
    "  if (field) sec.codes.push('TOTAL_FIELD');\n",
    '',
  ],
  [
    'totals-past-unknown-components',
    ENGINE,
    '      rows.some((r) => !isComponent(r.comp)) ||\n',
    '',
  ],
  [
    'totals-past-unread-amounts',
    ENGINE,
    '      rows.some((r) => r.comp === c && r.minor === null)\n',
    '      false\n',
  ],
  [
    'repeated-totals-read',
    ENGINE,
    '      value === null ||\n      seen.has(m[1])\n',
    '      value === null\n',
  ],
  [
    'map-class-unchecked',
    ENGINE,
    "      codes.add('MAP_CLASS');\n",
    '      void 0;\n',
  ],
  ['map-row-dates-in-any-order', ENGINE, '      from > to ||\n', ''],
  ['map-unreadable-ignored', ENGINE, "      run.add('MAP_UNREADABLE');\n", ''],
  [
    'map-validity-ignored',
    ENGINE,
    '      (r) => r.from! <= scope.asOf && scope.asOf <= r.to!,',
    '      (r) => r.from! <= scope.asOf,',
  ],
  [
    'map-validity-exclusive',
    ENGINE,
    '      (r) => r.from! <= scope.asOf && scope.asOf <= r.to!,',
    '      (r) => r.from! < scope.asOf && scope.asOf <= r.to!,',
  ],
  [
    'first-valid-map-row-taken',
    ENGINE,
    '    if (valid.length === 1) placed.set(pair, valid[0].key);',
    '    if (valid.length) placed.set(pair, valid[0].key);',
  ],
  [
    'map-absent-ignored',
    ENGINE,
    "      if (!pairs.has(pair)) notPlaced.set(pair, new Set(['MAP_ABSENT']));\n",
    '',
  ],
  [
    'excluded-category-needs-a-map',
    ENGINE,
    "        (s) => s.code !== 'SECTION_SCOPE' && s.code !== 'SECTION_UNREADABLE',",
    "        (s) => s.code !== 'SECTION_UNREADABLE',",
  ],
  [
    'other-category-pairs-hold',
    ENGINE,
    '    if (!registerCategories.has(JSON.parse(pair)[0])) notPlaced.delete(pair);\n',
    '',
  ],
  [
    'gl-row-unchecked',
    ENGINE,
    "      codes.add('GL_ROW');\n",
    '      void 0;\n',
  ],
  [
    'gl-scope-unchecked',
    ENGINE,
    "      codes.add('GL_SCOPE');\n",
    '      void 0;\n',
  ],
  ['gl-unreadable-ignored', ENGINE, "      run.add('GL_UNREADABLE');\n", ''],
  [
    'repeated-gl-read',
    ENGINE,
    "    if (rows.length > 1) codes.add('GL_REPEATED');\n",
    '',
  ],
  [
    'account-components-unchecked',
    ENGINE,
    "    else if (comps.size) codes.add('ACCOUNT_COMPONENTS');\n",
    '',
  ],
  [
    'held-sections-hold-nothing',
    ENGINE,
    '      if (cats.has(s.category!)) for (const c of s.codes) codes.add(c);',
    '      if (false) for (const c of s.codes) codes.add(c);',
  ],
  [
    'held-assets-hold-nothing',
    ENGINE,
    '      if (cats.has(s.category!)) for (const c of a.codes) codes.add(c);',
    '      if (false) for (const c of a.codes) codes.add(c);',
  ],
  [
    'unplaced-pairs-hold-nothing',
    ENGINE,
    '      if (JSON.parse(pair)[1] === component) for (const x of c) codes.add(x);',
    '      if (false) for (const x of c) codes.add(x);',
  ],
  [
    'run-codes-hold-nothing',
    ENGINE,
    '    const codes = new Set<string>(run);',
    '    const codes = new Set<string>();',
  ],
  [
    'class-conflict-unchecked',
    ENGINE,
    "      codes.add('CLASS_CONFLICT');\n",
    '      void 0;\n',
  ],
  [
    'unmapped-not-missing',
    ENGINE,
    "      if (!on.length) missing.add('UNMAPPED');\n",
    '',
  ],
  [
    'gl-absent-not-missing',
    ENGINE,
    "      if (!rows.length) missing.add('GL_ABSENT');\n",
    '',
  ],
  [
    'empty-account-consistent',
    ENGINE,
    "      if (on.length && !members.length) missing.add('REGISTER_ABSENT');\n",
    '',
  ],
  [
    'register-absent-on-unmapped',
    ENGINE,
    "      if (on.length && !members.length) missing.add('REGISTER_ABSENT');",
    "      if (!members.length) missing.add('REGISTER_ABSENT');",
  ],
  [
    'gl-sign-of-cost-everywhere',
    ENGINE,
    "          component === 'cost' ? r.debit! - r.credit! : r.credit! - r.debit!;",
    '          r.debit! - r.credit!;',
  ],
  [
    'negative-gl-flipped',
    ENGINE,
    '        balance = Number(normal);',
    '        balance = Math.abs(Number(normal));',
  ],
  [
    'members-of-other-accounts',
    ENGINE,
    '          if (placed.get(JSON.stringify([s.category, comp])) === key) {',
    '          if (placed.has(JSON.stringify([s.category, comp]))) {',
  ],
  [
    'csv-empty-file-read',
    IO,
    "  if (!original.byteLength) refuseAssetSections('SOURCE');\n",
    '',
  ],
  [
    'csv-capacity-called-source',
    IO,
    "      refuseAssetSections('CAPACITY');\n    return refuseAssetSections('SOURCE');",
    "      refuseAssetSections('SOURCE');\n    return refuseAssetSections('SOURCE');",
  ],
  ['file-type-unchecked', IO, '    !/\\.csv$/i.test(name) ||\n', ''],
  [
    'hash-unchecked',
    IO,
    "    if (file.sha256 !== f.sha256) refuseAssetSections('SOURCE_HASH');\n",
    '',
  ],
  [
    'reading-after-files',
    IO,
    '  assetSectionsPlaces(snapshot.readings, snapshot.scope);\n  if',
    '  if',
  ],
  [
    'protocol-action-unlisted',
    PROTOCOL,
    "  'fixed-assets-sections-review',\n] as const;",
    '] as const;',
  ],
  [
    'protocol-scope-unchecked',
    PROTOCOL,
    "        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)\n      )\n        throw new Error('invalid');\n      // The register,",
    "        false\n      )\n        throw new Error('invalid');\n      // The register,",
  ],
  [
    'protocol-file-name-unchecked',
    PROTOCOL,
    '          requested.name !== returned.name ||\n',
    '          false ||\n',
  ],
  [
    'protocol-bytes-unchecked',
    PROTOCOL,
    "          if (back[at] !== sent[at]) throw new Error('invalid');",
    "          if (false) throw new Error('invalid');",
  ],
  [
    'protocol-review-not-recomputed',
    PROTOCOL,
    '          reviewAssetSections(value.state as unknown as AssetSectionsInput),\n        ) !== JSON.stringify(value.result)',
    '          value.result,\n        ) !== JSON.stringify(value.result)',
  ],
  [
    'worker-not-dispatched',
    WORKER,
    "    else if (action === 'fixed-assets-sections-review')\n      value = await replayAssetSections(payload);\n",
    '',
  ],
  [
    'client-review-not-compared',
    CLIENT,
    '              JSON.stringify(given.result) !== JSON.stringify(mine.result)',
    '              false',
  ],
  [
    'client-sources-not-compared',
    CLIENT,
    '              sources(given.state) !== sources(mine.state) ||',
    '              false ||',
  ],
  [
    'client-bytes-unchecked',
    CLIENT,
    '              if (a.length !== b.length || a.some((v, at) => v !== b[at]))',
    '              if (false)',
  ],
];
const files = [ENGINE, IO, PROTOCOL, WORKER, CLIENT, ...tests];
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
