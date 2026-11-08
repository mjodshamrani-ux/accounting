// UX-6(a): one mutant for each guard the reconciliation sheet adds, as the
// design record declares them (docs/audits/UX-6-RECONCILIATION-SHEET.ar.md,
// section 7). Each mutant changes one product file at one anchor in a private
// copy of the tree; it is killed only when a test fails by an assertion
// (DEV-22), never by a syntax error, a crash or a timeout.
//
//   node scripts/test-reconciliation-sheet-mutations.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  completedSuccessfully,
  createPrivateTree,
  isAssertionKill,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..'),
  output = resolve(
    process.env.RECONCILIATION_SHEET_MUTATION_DIR ??
      'work/reconciliation-sheet-mutations',
  );
await mkdir(output, { recursive: true });

const mutations = [
  // The sheet takes an evidence sheet's part instead of a new one.
  [
    'takes-evidence-part',
    'lib/reconciliation/reconciliation-sheet.ts',
    'const part = `sheet${Math.max(',
    'const part = `sheet${0 * Math.max(',
  ],
  // The sheet is added last, not first.
  [
    'sheet-not-first',
    'lib/reconciliation/reconciliation-sheet.ts',
    "'<sheets>',\n        `<sheets><sheet name=",
    "'</sheets>',\n        `</sheets><sheet name=",
  ],
  // A style is put before the evidence's instead of after them.
  [
    'styles-before-evidence',
    'lib/reconciliation/reconciliation-sheet.ts',
    '    styles.slice(list.at + list.open.length, list.close) +\n    add.join(\'\') +',
    "    add.join('') +\n    styles.slice(list.at + list.open.length, list.close) +",
  ],
  // A list's count is left as it was after entries are added.
  [
    'style-count-kept',
    'lib/reconciliation/reconciliation-sheet.ts',
    'count="${list.entries + add.length}"',
    'count="${list.entries}"',
  ],
  // A list whose count disagrees with its entries is extended anyway.
  [
    'style-count-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (entries !== Number(count![1])) fail('STYLES');",
    'void entries;',
  ],
  // The selected tab is not refused.
  [
    'tab-selected-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (/tabSelected=\"1\"/.test(await read(name))) fail('TAB_SELECTED');",
    'await read(name);',
  ],
  // A name another sheet has is used.
  [
    'name-taken-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))\n    fail('NAME_TAKEN');",
    'void taken;',
  ],
  // A name longer than Excel allows is used.
  [
    'name-length-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    'name.length > 31 ||',
    'name.length > 310 ||',
  ],
  // A name tied to a sheet's position is left pointing at the sheet before.
  [
    'local-sheet-kept',
    'lib/reconciliation/reconciliation-sheet.ts',
    '`localSheetId="${Number(n) + 1}"`',
    '`localSheetId="${Number(n)}"`',
  ],
  // The cells are not checked before anything is built from them.
  [
    'cells-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    '  checkCells(sheet);\n',
    '',
  ],
  // A text is not checked as every exported text is.
  [
    'text-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "        validateExportText(cell.text, 'RECONCILIATION_SHEET_TEXT');",
    '        void cell.text;',
  ],
  // A number reads right to left in an Arabic sheet («50.00-»).
  [
    'number-right-to-left',
    'lib/reconciliation/reconciliation-sheet.ts',
    "readingOrder=\"1\"/>`;",
    "readingOrder=\"${rtl ? 2 : 1}\"/>`;",
  ],
  // An empty section is written with its heading.
  [
    'empty-section-written',
    'lib/reconciliation/reconciliation-sheet.ts',
    "    if (section.kind === 'pairs') {\n      if (!section.rows.length) continue;",
    "    if (section.kind === 'pairs') {",
  ],
  // The gap is written with its sign turned.
  [
    'gap-sign-flipped',
    'lib/reconciliation/reconciliation-sheet.ts',
    'minor: cell.value.minor,',
    'minor: -cell.value.minor,',
  ],
  // A source's fingerprint is the other source's.
  [
    'source-swapped',
    'lib/reconciliation/gl-tb-sheet.ts',
    'hash: s.hash,',
    'hash: result.sources[1 - side].hash,',
  ],
  // A missing balance is written as zero.
  [
    'missing-as-zero',
    'lib/reconciliation/gl-tb-sheet.ts',
    "    minor === null || minor === undefined\n      ? { text: t.missing, style: 'value' }\n      : { minor, decimals: result.decimals };",
    '    ({ minor: minor ?? 0, decimals: result.decimals });',
  ],
  // The scope's fixed values are written as the engine's codes.
  [
    'scope-code-written',
    'lib/reconciliation/gl-tb-sheet.ts',
    "    return key === 'currencyBasis' && value === 'functional'",
    "    return key === 'currencyBasis' && value === 'not-functional'",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'language-not-followed',
    'lib/reconciliation/gl-tb-sheet.ts',
    'glTbSheet(result, language));',
    "glTbSheet(result, 'en'));",
  ],
  // Any language is taken as English.
  [
    'language-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "  if (value === 'ar' || value === 'en') return value;\n  throw new Error('RECONCILIATION_SHEET_LANGUAGE');",
    "  return value === 'ar' ? 'ar' : 'en';",
  ],
  // The worker ignores the language the page sends.
  [
    'worker-language-ignored',
    'lib/reconciliation/worker.ts',
    '        payload.lang,\n      );',
    "        'ar',\n      );",
  ],
];

const sha = (s) => createHash('sha256').update(s).digest('hex'),
  temp = await createPrivateTree();
try {
  for (const name of ['lib', 'tests', 'audit', 'package.json'])
    await cp(join(root, name), join(temp, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        '--test-reporter=tap',
        'tests/reconciliation-sheet.test.ts',
        'tests/alignment-strip-view.test.ts',
      ],
      { cwd: temp, encoding: 'utf8', timeout: 180000 },
    );
  const baseline = run();
  await writeFile(join(output, 'baseline.log'), baseline.stdout + baseline.stderr);
  assert.ok(completedSuccessfully(baseline), 'baseline');
  const results = [];
  for (const [name, target, find, replacement] of mutations) {
    const file = join(temp, target),
      source = await readFile(file, 'utf8');
    assert.equal(source.split(find).length, 2, `${name}: unique anchor`);
    const changed = source.replace(find, () => replacement);
    await writeFile(file, changed);
    const syntax = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--check', file],
      { encoding: 'utf8' },
    );
    assert.ok(completedSuccessfully(syntax), `${name}: syntax`);
    const actual = run();
    await writeFile(join(output, `${name}.log`), actual.stdout + actual.stderr);
    const detected = isAssertionKill(actual);
    await writeFile(file, source);
    assert.equal(await readFile(file, 'utf8'), source, `${name}: restored`);
    results.push({
      name,
      file: target,
      detected,
      status: actual.status,
      signal: actual.signal,
      mutantSha256: sha(changed),
    });
    console.log(name, detected ? 'ASSERTION_KILL' : 'SURVIVED');
  }
  await writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(
      {
        baselinePassed: true,
        mutations: results,
        passed: results.every((r) => r.detected),
      },
      null,
      2,
    ) + '\n',
  );
  const survivors = results.filter((r) => !r.detected).map((r) => r.name);
  assert.deepEqual(survivors, [], 'every mutant is killed by an assertion');
  console.log(`${results.length}/${mutations.length} mutants killed by an assertion`);
} finally {
  await removePrivateTree(temp);
}
