// PAY-1 code mutations: each planted defect in a private copy of the
// payroll-long-register-1 engine (payroll-long-register.ts) or its replay
// must make its unit tests fail with an assertion. A survivor is a guard
// nothing holds.
//   node scripts/test-payroll-long-register-mutations.mjs
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
  process.env.PLR_MUTATION_DIR ??
  join(root, 'work/payroll-long-register-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/payroll-long-register.test.ts'];
const ENGINE = 'lib/reconciliation/payroll-long-register.ts';
const REPLAY = 'lib/reconciliation/payroll-long-register-io.ts';
const mutations = [
  // Reading.
  [
    'every-space-trimmed',
    ENGINE,
    "export const plrStrip = (v: string) => v.replace(/^ +| +$/g, '');",
    'export const plrStrip = (v: string) => v.trim();',
  ],
  [
    'text-length-501',
    ENGINE,
    '[...s].length > 500 ||',
    '[...s].length > 501 ||',
  ],
  [
    'minus-prefix-allowed',
    ENGINE,
    '/^[=+@-]/.test(s) ||',
    '/^[=+@]/.test(s) ||',
  ],
  [
    'excel-errors-case-sensitive',
    ENGINE,
    'ERRORS.some((e) => s.toUpperCase().startsWith(e)) ||',
    'ERRORS.some((e) => s.startsWith(e)) ||',
  ],
  [
    'format-characters-allowed',
    ENGINE,
    '/[\\p{Cc}\\p{Cf}]|(?! )\\p{Z}/u.test(s)',
    '/[\\p{Cc}]|(?! )\\p{Z}/u.test(s)',
  ],
  [
    'other-spaces-allowed',
    ENGINE,
    '/[\\p{Cc}\\p{Cf}]|(?! )\\p{Z}/u.test(s)',
    '/[\\p{Cc}\\p{Cf}]/u.test(s)',
  ],
  [
    'impossible-days-allowed',
    ENGINE,
    'd >= 1 && d <= days[mo - 1]',
    'd >= 1 && d <= 31',
  ],
  [
    'arabic-digits-not-read',
    ENGINE,
    '\n    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))',
    '',
  ],
  [
    'persian-digits-not-read',
    ENGINE,
    '\n    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))',
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
    'blank-amount-is-zero',
    ENGINE,
    'const s = plrStrip(v)\n    .replace',
    "const s = (plrStrip(v) || '0')\n    .replace",
  ],
  [
    'no-amount-ceiling',
    ENGINE,
    'return n <= MAX_MINOR ? n : null;',
    'return n;',
  ],
  ['kwd-two-decimals', ENGINE, '  KWD: 3,', '  KWD: 2,'],
  // The CSV reader.
  [
    'byte-order-mark-kept',
    ENGINE,
    'if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);',
    '',
  ],
  [
    'quote-inside-a-field-tolerated',
    ENGINE,
    "        if (t[j] === '\"') return 'CSV';\n",
    '',
  ],
  [
    'unclosed-quote-tolerated',
    ENGINE,
    "if (!closed) return 'CSV';",
    'if (!closed) break;',
  ],
  [
    'lone-cr-refused',
    ENGINE,
    "if (t[i] !== '\\r' && t[i] !== '\\n') return 'CSV';",
    "if (t[i] !== '\\n' && t.slice(i, i + 2) !== '\\r\\n') return 'CSV';",
  ],
  [
    'text-after-a-quote-tolerated',
    ENGINE,
    "if (t[i] !== '\\r' && t[i] !== '\\n') return 'CSV';",
    "if (t[i] !== '\\r' && t[i] !== '\\n') {\n      i++;\n      continue;\n    }",
  ],
  [
    'doubled-quote-kept',
    ENGINE,
    "            value += '\"';\n            j += 2;",
    '            value += \'""\';\n            j += 2;',
  ],
  // Blocks, headers and columns.
  [
    'stray-rows-ignored',
    ENGINE,
    '} else if (!b) strays.push(i + 1);',
    '} else if (!b) void 0;',
  ],
  [
    'blank-rows-kept',
    ENGINE,
    '    if (!width(r)) continue;\n    const mark',
    '    if (!r.length) continue;\n    const mark',
  ],
  [
    'closure-ignores-the-id',
    ENGINE,
    ' &&\n        plrStrip(r[1]) === plrStrip(b.opening[1]);',
    ';',
  ],
  [
    'closure-ignores-the-kind',
    ENGINE,
    "        mark === (b.kind === 'Section' ? 'End section' : 'End run totals') &&\n",
    '',
  ],
  [
    'closure-ignores-the-width',
    ENGINE,
    '        width(r) === 2 &&\n        width(b.opening) === 2 &&\n',
    '',
  ],
  [
    'unknown-labels-allowed',
    ENGINE,
    '    [...counts.keys()].every((k) =>\n      (PLR_LABELS as readonly string[]).includes(k),\n    ) &&\n',
    '',
  ],
  [
    'repeated-labels-allowed',
    ENGINE,
    'counts.get(name) === 1',
    'counts.get(name)! >= 1',
  ],
  [
    'dates-read-as-text',
    ENGINE,
    '          ? plrDate(cell(r, 1))\n',
    '          ? plrText(cell(r, 1))\n',
  ],
  [
    'opening-width-unchecked',
    ENGINE,
    '    width(b.opening) === 2 &&\n    plrText(cell(b.opening, 1)) !== null &&',
    '    plrText(cell(b.opening, 1)) !== null &&',
  ],
  [
    'unclosed-section-excludable',
    ENGINE,
    'if (other && b.closed) {',
    'if (other) {',
  ],
  [
    'payment-date-not-compared',
    ENGINE,
    'const other = PLR_LABELS.some((l) => values.get(l) !== scope[l]);',
    'const other = PLR_LABELS.slice(0, -1).some((l) => values.get(l) !== scope[l]);',
  ],
  [
    'column-count-unchecked',
    ENGINE,
    'if (columns && width(columns) === PLR_COLUMNS.length) {',
    'if (columns) {',
  ],
  [
    'unclosed-other-scope-read',
    ENGINE,
    '  if (other) return s;\n  s.read = true;',
    '  s.read = true;',
  ],
  [
    'net-total-read-as-a-line',
    ENGINE,
    "(PLR_TOTALS as readonly string[]).includes(plrStrip(r.cells[0] ?? ''))",
    "(PLR_TOTALS.slice(0, 3) as readonly string[]).includes(plrStrip(r.cells[0] ?? ''))",
  ],
  [
    'line-after-totals-allowed',
    ENGINE,
    '    after ||= totals.length > 0;\n',
    '',
  ],
  [
    'kind-folded',
    ENGINE,
    "const kind = plrStrip(get('Kind'));",
    "const kind = plrStrip(get('Kind')).toLowerCase();",
  ],
  [
    'wide-lines-allowed',
    ENGINE,
    'wide: width(r.cells) > PLR_COLUMNS.length,',
    'wide: false,',
  ],
  // Totals.
  [
    'uncheckable-section-holds-nothing',
    ENGINE,
    "    s.totals = 'TOTAL_FIELD';",
    '    s.totals = null;',
  ],
  [
    'section-mismatch-ignored',
    ENGINE,
    "    s.totals = 'TOTAL_MISMATCH';",
    '    s.totals = null;',
  ],
  [
    'wide-totals-allowed',
    ENGINE,
    '    rows.some((r) => width(r) !== 2)\n',
    '    false\n',
  ],
  [
    'blank-total-skipped',
    ENGINE,
    '    if (v === null) return null;\n',
    '    if (v === null) continue;\n',
  ],
  [
    'total-label-twice-allowed',
    ENGINE,
    '    !PLR_TOTALS.every((l) => labels.filter((x) => x === l).length === 1) ||\n',
    '',
  ],
  // Input and scope.
  [
    'extra-input-keys-allowed',
    ENGINE,
    "    Object.keys(input).sort(byText).join('|') !== 'files|readings|scope' ||\n",
    '',
  ],
  [
    'reading-unconfirmed-allowed',
    ENGINE,
    "    r.confirmed !== true\n  )\n    fail('READING');",
    "    false\n  )\n    fail('READING');",
  ],
  ['reading-role-unchecked', ENGINE, '    r.role !== PLR_ROLE ||\n', ''],
  ['non-csv-name-allowed', ENGINE, '    !/\\.csv$/i.test(f.name) ||\n', ''],
  [
    'hash-format-unchecked',
    ENGINE,
    "    typeof f.sha256 !== 'string' ||\n    !/^[a-f0-9]{64}$/.test(f.sha256)\n",
    "    typeof f.sha256 !== 'string'\n",
  ],
  [
    'scope-unconfirmed-allowed',
    ENGINE,
    '    s.confirmed !== true ||\n    !plain(s.fields)',
    '    !plain(s.fields)',
  ],
  [
    'extra-scope-field-allowed',
    ENGINE,
    "  if (keys.join('|') !== [...PLR_LABELS].sort(byText).join('|')) return false;\n",
    '',
  ],
  [
    'scope-text-unchecked',
    ENGINE,
    "(k) => typeof fields[k] === 'string' && plrText(fields[k]) === fields[k],",
    "(k) => typeof fields[k] === 'string',",
  ],
  [
    'scope-dates-unchecked',
    ENGINE,
    '    PLR_DATE_LABELS.every((k) => plrDate(f[k]) !== null) &&\n',
    '',
  ],
  [
    'period-order-unchecked',
    ENGINE,
    "    f['Period start'] <= f['Period end'] &&\n",
    '',
  ],
  [
    'payment-before-posting-allowed',
    ENGINE,
    " &&\n    f['Payroll posting date'] <= f['Payment date']",
    '',
  ],
  // Judgement.
  ['stray-holds-nothing', ENGINE, "    run.add('STRAY_ROW');\n", ''],
  [
    'section-header-holds-nothing',
    ENGINE,
    "      run.add('SECTION_HEADER');\n",
    '',
  ],
  [
    'section-columns-hold-nothing',
    ENGINE,
    "      run.add('SECTION_COLUMNS');\n",
    '',
  ],
  [
    'unclosed-holds-nothing',
    ENGINE,
    "    if (!s.closed) run.add('SECTION_UNCLOSED');\n",
    '',
  ],
  [
    'duplicate-sections-allowed',
    ENGINE,
    "  if ([...ids.values()].some((c) => c > 1)) run.add('SECTION_DUPLICATE');\n",
    '',
  ],
  [
    'excluded-sections-duplicate',
    ENGINE,
    'if (!s.excluded && s.id !== null)',
    'if (s.id !== null)',
  ],
  [
    'unreadable-line-holds-nothing',
    ENGINE,
    "      run.add('LINE_UNREADABLE');\n",
    '',
  ],
  [
    'run-totals-of-another-run',
    ENGINE,
    "if (b.closed && plrText(cell(b.opening, 1)) === fields['Payroll run'])",
    'if (b.closed)',
  ],
  [
    'unclosed-run-totals-allowed',
    ENGINE,
    "if (b.closed && plrText(cell(b.opening, 1)) === fields['Payroll run'])",
    "if (plrText(cell(b.opening, 1)) === fields['Payroll run'])",
  ],
  [
    'run-totals-twice-allowed',
    ENGINE,
    'if (footers.length === 1) {',
    'if (footers.length >= 1) {',
  ],
  [
    'uncheckable-run-passes',
    ENGINE,
    "if (!printed || !result.totals) run.add('RUN_TOTALS');\n  else if (",
    "if (!printed) run.add('RUN_TOTALS');\n  else if (result.totals && ",
  ],
  [
    'run-mismatch-ignored',
    ENGINE,
    "    run.add('RUN_TOTAL_MISMATCH');",
    '    void 0;',
  ],
  [
    'payee-and-component-unchecked',
    ENGINE,
    'if (x.id === null || x.payee === null || x.component === null)',
    'if (x.id === null)',
  ],
  [
    'kind-holds-nothing',
    ENGINE,
    "if (x.kind === null) hold(key, 'KIND');",
    'if (x.kind === null) void 0;',
  ],
  [
    'amount-holds-nothing',
    ENGINE,
    "if (x.amount === null) hold(key, 'AMOUNT');",
    'if (x.amount === null) void 0;',
  ],
  [
    'width-holds-nothing',
    ENGINE,
    "if (x.wide) hold(key, 'LINE_WIDTH');",
    'if (x.wide) void 0;',
  ],
  [
    'duplicate-lines-allowed',
    ENGINE,
    "if (x.id !== null && lineIds.get(x.id)! > 1) hold(key, 'DUPLICATE_LINE');",
    'if (x.id !== null && lineIds.get(x.id)! > 1) void 0;',
  ],
  [
    'section-codes-hold-nothing',
    ENGINE,
    'if (s.totals) hold(key, s.totals);',
    'if (s.totals) void 0;',
  ],
  [
    'payee-conflict-allowed',
    ENGINE,
    "      hold(key, 'PAYEE_CONFLICT');",
    '      void 0;',
  ],
  [
    'two-nets-allowed',
    ENGINE,
    "if (nets.length > 1) hold(key, 'NET_REPEATED');",
    'if (nets.length > 1) void 0;',
  ],
  [
    'run-codes-not-spread',
    ENGINE,
    'for (const code of run) hold(key, code);',
    'for (const code of run) void code;',
  ],
  [
    'employer-taken-from-net',
    ENGINE,
    ': earnings - deductions !== net',
    ": earnings - deductions - sum('employer') !== net",
  ],
  [
    'net-equation-unchecked',
    ENGINE,
    ': earnings - deductions !== net',
    ': false',
  ],
  [
    'leading-zero-dropped',
    ENGINE,
    'const key = `${x.employee}|${x.dims}`;',
    "const key = `${x.employee.replace(/^0+/, '')}|${x.dims}`;",
  ],
  [
    'payee-is-the-employee',
    ENGINE,
    'const key = `${x.employee}|${x.dims}`;',
    'const key = `${x.payee ?? x.employee}|${x.dims}`;',
  ],
  [
    'every-payee-listed',
    ENGINE,
    '.filter(([, e]) => e.size > 1)',
    '.filter(([, e]) => e.size > 0)',
  ],
  [
    'unplaced-in-found-order',
    ENGINE,
    'result.unplaced = unplaced.sort(\n    (a, b) => a.row - b.row || byText(a.code, b.code),\n  );',
    'result.unplaced = unplaced;',
  ],
  [
    'zero-lines-dropped',
    ENGINE,
    '      lines: own\n        .map(',
    '      lines: own\n        .filter((x) => x.amount !== 0n)\n        .map(',
  ],
  [
    'lines-in-file-order',
    ENGINE,
    '        .sort((a, b) => byText(a.id, b.id)),',
    '',
  ],
  // Replay.
  [
    'claimed-hash-ignored',
    REPLAY,
    "  if (copy.claimed !== undefined && copy.claimed !== sha256)\n    throw new Error('PLR_SOURCE_HASH');\n",
    '',
  ],
  [
    'original-read-after-await',
    REPLAY,
    '    bytes: new Uint8Array(f.original.slice(0)),',
    '    bytes: new Uint8Array(f.original),',
  ],
  [
    'scope-read-after-await',
    REPLAY,
    '  const scope = structuredClone(input.scope);',
    '  const scope = input.scope;',
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
