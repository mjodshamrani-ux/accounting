// UX-6: one mutant for each guard the reconciliation sheet adds, as the
// design record declares them (docs/audits/UX-6-RECONCILIATION-SHEET.ar.md,
// section 7), GL/TB in 6(a) and clearing in 6(b). Each mutant changes one product file at one anchor in a private
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
    'exportGlTbWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportGlTbWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // UX-6(b), clearing. The worker ignores the language for clearing.
  [
    'clearing-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportClearingWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportClearingWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The clearing sheet is written in English whatever the language asked.
  [
    'clearing-language-not-followed',
    'lib/reconciliation/clearing-sheet.ts',
    'clearingSheet(state, result, language),',
    "clearingSheet(state, result, 'en'),",
  ],
  // A decision is written without the reason the reviewer gave.
  [
    'decision-reason-dropped',
    'lib/reconciliation/clearing-sheet.ts',
    "{ text: event.note, style: 'value' },",
    "{ text: t.note, style: 'value' },",
  ],
  // A reopen is said as a clear.
  [
    'decision-action-swapped',
    'lib/reconciliation/clearing-sheet.ts',
    "event.action === 'clear' ? 'human-decision' : 'reopened',",
    "event.action === 'clear' ? 'human-decision' : 'human-decision',",
  ],
  // Members are written as the engine's row ids, not the postings.
  [
    'members-as-ids',
    'lib/reconciliation/clearing-sheet.ts',
    'ids.map((id) => posting.get(id) ?? id)',
    'ids.map((id) => id)',
  ],
  // Every group is listed for review, cleared ones too.
  [
    'cleared-listed-for-review',
    'lib/reconciliation/clearing-sheet.ts',
    "          .filter((c) => c.status === 'review')\n          .map((c) => [",
    "          .filter((c) => c.status !== '')\n          .map((c) => [",
  ],
  // A group with no reference is written with an empty reference.
  [
    'no-reference-unsaid',
    'lib/reconciliation/clearing-sheet.ts',
    '{ text: c.reference || t.missing, style: \'value\' },',
    '{ text: c.reference || t.reference, style: \'value\' },',
  ],
  // A group's reason is written as the engine's code.
  [
    'reason-as-code',
    'lib/reconciliation/clearing-sheet.ts',
    "            { text: reason(c.reason), style: 'value' },",
    "            { text: c.reason, style: 'value' },",
  ],
  // Cleared movements are counted as groups.
  [
    'cleared-counted-as-groups',
    'lib/reconciliation/clearing-sheet.ts',
    '.reduce((n, c) => n + c.ids.length, 0),',
    '.reduce((n) => n + 1, 0),',
  ],
  // Reading errors are not counted.
  [
    'errors-uncounted',
    'lib/reconciliation/clearing-sheet.ts',
    "count: result.inventory.filter((r) => r.kind === 'error')",
    "count: result.inventory.filter((r) => r.kind === 'none')",
  ],
  // A text longer than its room is not wrapped.
  [
    'wrap-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    '      wrapped.add(`${r}:${c}`);',
    '      void r;',
  ],
  // A wrapped text's row is not given its height.
  [
    'row-height-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    "`<row r=\"${r + 1}\"${height ? ` ht=\"${height}\" customHeight=\"1\"` : ''}>",
    "`<row r=\"${r + 1}\"${height ? '' : ''}>",
  ],
  // A wrapped text's row is given one line's height.
  [
    'row-one-line',
    'lib/reconciliation/reconciliation-sheet.ts',
    'lineCount(cell.text, capacity) * LINE[cell.style] + 2,',
    'LINE[cell.style] + 2,',
  ],
  // A text's room runs on past a cell that holds a value.
  [
    'room-past-value',
    'lib/reconciliation/reconciliation-sheet.ts',
    "        (!cells[next] ||\n          ('text' in cells[next]! && !(cells[next] as { text: string }).text));",
    '        true;',
  ],
  // UX-6(b), receivables. The worker ignores the language for AR.
  [
    'ar-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportArWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportArWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The AR binding lets any language through to the worker.
  [
    'ar-binding-language-unchecked',
    'lib/reconciliation/ar-worker-binding.ts',
    "(payload.lang !== 'ar' && payload.lang !== 'en')",
    'false',
  ],
  // The page checks the worker's reply against the evidence alone.
  [
    'ar-binding-expects-evidence-only',
    'lib/reconciliation/ar-worker-binding.ts',
    'const expected = await sheet.exportArWorkpaper(\n      payload.state as ArInput,\n      payload.result as ArResult,\n      payload.lang,\n    );',
    'void sheet;\n    const expected = await io.exportAr(\n      payload.state as ArInput,\n      payload.result as ArResult,\n    );',
  ],
  // The AR sheet is written in English whatever the language asked.
  [
    'ar-language-not-followed',
    'lib/reconciliation/ar-sheet.ts',
    'arSheet(state, result, language)',
    "arSheet(state, result, 'en')",
  ],
  // A decision is written without the reason the reviewer gave.
  [
    'ar-decision-reason-dropped',
    'lib/reconciliation/ar-sheet.ts',
    '            value(event.note),',
    '            value(t.note),',
  ],
  // A reopen is said as a confirmation.
  [
    'ar-decision-action-swapped',
    'lib/reconciliation/ar-sheet.ts',
    "event.action === 'accept' ? 'human-confirmation' : 'reopened',",
    "event.action === 'accept' ? 'human-confirmation' : 'human-confirmation',",
  ],
  // A movement is attributed to the other record.
  [
    'ar-member-side-swapped',
    'lib/reconciliation/ar-sheet.ts',
    '                value(t.sides[r.side]),',
    '                value(t.sides[1 - r.side]),',
  ],
  // Matched documents are listed for review too.
  [
    'ar-matched-listed',
    'lib/reconciliation/ar-sheet.ts',
    "const review = result.cases.filter((c) => c.status === 'review');",
    "const review = result.cases.filter((c) => c.status !== '');",
  ],
  // A record without a total is written as zero.
  [
    'ar-missing-total-as-zero',
    'lib/reconciliation/ar-sheet.ts',
    '      ? value(t.unavailableTotal)',
    '      ? { minor: 0, decimals: result.decimals }',
  ],
  // Each record is given the other's total.
  [
    'ar-totals-swapped',
    'lib/reconciliation/ar-sheet.ts',
    '          value: total(minor),',
    '          value: total(result.totals[1 - side]),',
  ],
  // Reading errors are not counted.
  [
    'ar-errors-uncounted',
    'lib/reconciliation/ar-sheet.ts',
    "count: result.inventory.filter((i) => i.kind === 'error').length,",
    "count: result.inventory.filter((i) => i.kind === 'none').length,",
  ],
  // A movement's date is not the one it carries.
  [
    'ar-member-date-dropped',
    'lib/reconciliation/ar-sheet.ts',
    '                value(r.date),',
    '                value(result.scope.start),',
  ],
  // The source is named by its fingerprint's file but given another hash.
  [
    'clearing-source-hash',
    'lib/reconciliation/clearing-sheet.ts',
    'hash: result.sourceHash',
    'hash: result.context',
  ],
  // UX-6(b), printing. The page is never broken by hand.
  [
    'print-never-broken',
    'lib/reconciliation/reconciliation-sheet.ts',
    'if (tall.reduce((a, b) => a + b, 0) <= ONE_PAGE) return [];',
    'return [];',
  ],
  // A break one row below a group's first row, inside it.
  [
    'print-break-inside',
    'lib/reconciliation/reconciliation-sheet.ts',
    'breaks.push(r);',
    'breaks.push(r + 1);',
  ],
  // A group taller than a page is sent to a page of its own.
  [
    'print-tall-group-alone',
    'lib/reconciliation/reconciliation-sheet.ts',
    'if (used + group > PAGE && group <= PAGE) {',
    'if (used + group > PAGE) {',
  ],
  // The planner forgets what the page already holds.
  [
    'print-page-not-counted',
    'lib/reconciliation/reconciliation-sheet.ts',
    'used = used + height > PAGE ? height : used + height;',
    'used = 0;',
  ],
  // The groups are not handed to the writer.
  [
    'print-groups-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    'return { name: w.name, language, widths: WIDTHS, rows, keep };',
    'return { name: w.name, language, widths: WIDTHS, rows };',
  ],
  // The sign-off is not kept whole.
  [
    'print-sign-off-split',
    'lib/reconciliation/reconciliation-sheet.ts',
    "          { line: true },\n        ]);\n      whole();",
    "          { line: true },\n        ]);",
  ],
  // An AR document is not kept with its movements.
  [
    'print-ar-document-split',
    'lib/reconciliation/ar-sheet.ts',
    '        blocks: review.map((c) => 1 + c.ids.length),\n',
    '',
  ],
  // UX-6(b), bank movements. The worker ignores the language for bank.
  [
    'bank-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportBankWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportBankWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The bank sheet is written in English whatever the language asked.
  [
    'bank-language-not-followed',
    'lib/reconciliation/bank-movements-sheet.ts',
    'bankMovementsSheet(state, result, language)',
    "bankMovementsSheet(state, result, 'en')",
  ],
  // Matched cases are listed for review too.
  [
    'bank-matched-listed',
    'lib/reconciliation/bank-movements-sheet.ts',
    "(c) => c.status === 'needs-review' || c.status === 'source-error',",
    "(c) => c.status !== '',",
  ],
  // A case a source error holds is not listed as waiting.
  [
    'bank-source-error-not-listed',
    'lib/reconciliation/bank-movements-sheet.ts',
    "(c) => c.status === 'needs-review' || c.status === 'source-error',",
    "(c) => c.status === 'needs-review',",
  ],
  // The bank side's total stands where the difference does.
  [
    'bank-difference-of-bank',
    'lib/reconciliation/bank-movements-sheet.ts',
    '{ minor: c.deltaMinor, decimals: result.decimals }',
    '{ minor: c.bankMinor, decimals: result.decimals }',
  ],
  // A member's amount without its sign.
  [
    'bank-member-unsigned',
    'lib/reconciliation/bank-movements-sheet.ts',
    '{ minor: r.signed, decimals: result.decimals }',
    '{ minor: r.amount, decimals: result.decimals }',
  ],
  // A case without a settlement identity is given its internal key.
  [
    'bank-identity-for-every-kind',
    'lib/reconciliation/bank-movements-sheet.ts',
    "c.kind === 'reference' ? value(c.key) : null",
    'value(c.key)',
  ],
  // A case's members out of the order the evidence lists them.
  [
    'bank-members-out-of-order',
    'lib/reconciliation/bank-movements-sheet.ts',
    '...c.cashIds.map(member),',
    '...c.cashIds.map(member).reverse(),',
  ],
  // A decision without the reason the reviewer gave.
  [
    'bank-decision-reason-dropped',
    'lib/reconciliation/bank-movements-sheet.ts',
    '          value(event.note),\n',
    '          null,\n',
  ],
  // An undo said as the approval.
  [
    'bank-undo-said-as-accept',
    'lib/reconciliation/bank-movements-sheet.ts',
    "event.type === 'accept' ? 'human-review' : 'undone'",
    "'human-review'",
  ],
  // A word of the sheet that is not the screen's.
  [
    'bank-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "difference: 'Bank minus cashbook',",
    "difference: 'Bank less cashbook',",
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
