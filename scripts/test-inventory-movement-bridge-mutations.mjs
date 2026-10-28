// INV-2 code mutations: each planted defect in a private copy of the
// inventory-movement-bridge-1 engine (inventory-movement-bridge.ts) or its
// replay must make its unit tests fail with an assertion. A survivor is a
// guard nothing holds.
//   node scripts/test-inventory-movement-bridge-mutations.mjs
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
  process.env.IMB_MUTATION_DIR ??
  join(root, 'work/inventory-movement-bridge-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/inventory-movement-bridge.test.ts'];
const ENGINE = 'lib/reconciliation/inventory-movement-bridge.ts';
const REPLAY = 'lib/reconciliation/inventory-movement-bridge-io.ts';
const mutations = [
  [
    'every-space-trimmed',
    ENGINE,
    "export const imbStrip = (v: string) => v.replace(/^ +| +$/g, '');",
    'export const imbStrip = (v: string) => v.trim();',
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
    'impossible-dates-allowed',
    ENGINE,
    'd >= 1 && d <= days[mo - 1]',
    'd >= 1 && d <= 31',
  ],
  [
    'arabic-digits-not-read',
    ENGINE,
    '.replace(/[\\u0660-\\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))',
    '.replace(/[\\u0660-\\u0669]/g, (c) => c)',
  ],
  [
    'persian-digits-not-read',
    ENGINE,
    '.replace(/[\\u06f0-\\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6f0))',
    '.replace(/[\\u06f0-\\u06f9]/g, (c) => c)',
  ],
  ['arabic-decimal-not-read', ENGINE, ".replace(/\\u066b/g, '.');", ';'],
  [
    'extra-decimals-allowed',
    ENGINE,
    "(m[3] ?? '').length > places) return null;",
    "(m[3] ?? '').length > places + 1) return null;",
  ],
  ['minus-everywhere', ENGINE, 'if (!m || (m[1] && !signed) ||', 'if (!m ||'],
  ['minus-dropped', ENGINE, '  return m[1] ? -n : n;', '  return n;'],
  ['no-ceiling', ENGINE, '  if (n > LIMIT) return null;\n', ''],
  [
    'stray-quote-tolerated',
    ENGINE,
    "        if (t[j] === '\"') return 'CSV';\n",
    '',
  ],
  [
    'text-after-quote-tolerated',
    ENGINE,
    "    if (t[i] !== '\\r' && t[i] !== '\\n') return 'CSV';",
    "    if (t[i] !== '\\r' && t[i] !== '\\n') i++;",
  ],
  [
    'unclosed-quote-tolerated',
    ENGINE,
    "      if (!closed) return 'CSV';\n",
    '',
  ],
  [
    'byte-order-mark-kept',
    ENGINE,
    '  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);\n',
    '',
  ],
  [
    'lone-cr-not-a-line-end',
    ENGINE,
    "      while (j < n && t[j] !== ',' && t[j] !== '\\r' && t[j] !== '\\n') {",
    "      while (j < n && t[j] !== ',' && t[j] !== '\\n') {",
  ],
  [
    'doubled-quotes-kept',
    ENGINE,
    "            value += '\"';\n            j += 2;",
    '            value += \'""\';\n            j += 2;',
  ],
  [
    'no-capacity-bound',
    ENGINE,
    '    rows.some((r) => r.length > 100 || r.some((v) => v.length > 32767))',
    '    false',
  ],
  [
    'header-count-unchecked',
    ENGINE,
    '    head.length !== columns.length ||\n',
    '',
  ],
  [
    'header-in-contract-order',
    ENGINE,
    '    !columns.every((c) => head.includes(c))',
    '    !columns.every((c, j) => head[j] === c)',
  ],
  [
    'repeated-header-read-as-line',
    ENGINE,
    '    if (own.length === head.length && own.every((v, j) => v === head[j]))',
    '    if (false)',
  ],
  [
    'repeated-header-in-any-order',
    ENGINE,
    'own.every((v, j) => v === head[j])',
    'own.every((v) => head.includes(v))',
  ],
  [
    'kind-folded',
    ENGINE,
    "  const named = imbStrip(get('Kind'));",
    "  const named = imbStrip(get('Kind')).toLowerCase();",
  ],
  [
    'quantity-in-hundredths',
    ENGINE,
    "    q: imbNumber(get('Quantity'), 3, balance),",
    "    q: imbNumber(get('Quantity'), 2, balance),",
  ],
  [
    'sign-on-every-line',
    ENGINE,
    "  const balance = kind === 'opening' || kind === 'closing';",
    '  const balance = true;',
  ],
  [
    'sign-on-no-line',
    ENGINE,
    "  const balance = kind === 'opening' || kind === 'closing';",
    '  const balance = false;',
  ],
  [
    'unit-unchecked',
    ENGINE,
    '  if (x.id === null || x.unit === null || x.account === null)',
    '  if (x.id === null || x.account === null)',
  ],
  [
    'account-unchecked',
    ENGINE,
    '  if (x.id === null || x.unit === null || x.account === null)',
    '  if (x.id === null || x.unit === null)',
  ],
  [
    'kind-holds-nothing',
    ENGINE,
    "  if (kind === null) x.codes.add('KIND');",
    '  if (kind === null) void 0;',
  ],
  [
    'quantity-holds-nothing',
    ENGINE,
    "  if (x.q === null) x.codes.add('QUANTITY');",
    '  if (x.q === null) void 0;',
  ],
  [
    'movement-date-unchecked',
    ENGINE,
    "  if (x.md === null || x.pd === null) x.codes.add('DATE');",
    "  if (x.pd === null) x.codes.add('DATE');",
  ],
  [
    'transfer-origin-allowed',
    ENGINE,
    '      ? x.tid === null || !oidBlank',
    '      ? x.tid === null',
  ],
  [
    'return-transfer-allowed',
    ENGINE,
    '        ? x.oid === null || !tidBlank',
    '        ? x.oid === null',
  ],
  [
    'links-unchecked-elsewhere',
    ENGINE,
    '        : !tidBlank || !oidBlank;',
    '        : false;',
  ],
  [
    'only-origins-checked-elsewhere',
    ENGINE,
    '        : !tidBlank || !oidBlank;',
    '        : !oidBlank;',
  ],
  [
    'width-unchecked',
    ENGINE,
    "  if (width(cells) > IMB_COLUMNS.length) x.codes.add('LINE_WIDTH');",
    "  if (false) x.codes.add('LINE_WIDTH');",
  ],
  [
    'width-counts-blank-cells',
    ENGINE,
    "  if (width(cells) > IMB_COLUMNS.length) x.codes.add('LINE_WIDTH');",
    "  if (cells.length > IMB_COLUMNS.length) x.codes.add('LINE_WIDTH');",
  ],
  [
    'faulty-lines-excludable',
    ENGINE,
    '  x.whole = !x.codes.size && x.item !== null && x.dims !== null;',
    '  x.whole = x.item !== null && x.dims !== null;',
  ],
  [
    'unreadable-line-holds-nothing',
    ENGINE,
    "      run.add('LINE_UNREADABLE');\n",
    '',
  ],
  [
    'excluded-by-movement-date',
    ENGINE,
    '    (x) => x.whole && isMove(x.kind) && !inside(x.pd),',
    '    (x) => x.whole && isMove(x.kind) && !inside(x.md),',
  ],
  [
    'balances-excludable',
    ENGINE,
    '    (x) => x.whole && isMove(x.kind) && !inside(x.pd),',
    '    (x) => x.whole && x.kind !== null && !inside(x.pd),',
  ],
  [
    'dated-by-posting-date',
    ENGINE,
    'inside(x.pd) && !inside(x.md),',
    'inside(x.md) && !inside(x.pd),',
  ],
  [
    'excluded-lines-are-positions',
    ENGINE,
    '    skip.has(x) || x.item === null || x.dims === null',
    '    x.item === null || x.dims === null',
  ],
  [
    'duplicates-allowed',
    ENGINE,
    "      if (x.id !== null && ids.get(x.id)! > 1) hold(x, 'DUPLICATE_MOVEMENT');",
    "      if (false) hold(x, 'DUPLICATE_MOVEMENT');",
  ],
  [
    'duplicates-ignore-excluded',
    ENGINE,
    '    if (x.id !== null) ids.set(x.id, (ids.get(x.id) ?? 0) + 1);',
    '    if (x.id !== null && !skip.has(x)) ids.set(x.id, (ids.get(x.id) ?? 0) + 1);',
  ],
  [
    'balance-movement-date-unchecked',
    ENGINE,
    '        ((x.md !== null && x.md !== boundary) ||',
    '        ((false) ||',
  ],
  [
    'balance-posting-date-unchecked',
    ENGINE,
    '          (x.pd !== null && x.pd !== boundary))',
    '          (false))',
  ],
  [
    'closing-boundary-is-start',
    ENGINE,
    "x.kind === 'opening' ? start : x.kind === 'closing' ? end : null;",
    "x.kind === 'opening' ? start : x.kind === 'closing' ? start : null;",
  ],
  [
    'negative-always-allowed',
    ENGINE,
    "  const negativeHeld = fields['Negative balances'] === 'not allowed';",
    '  const negativeHeld = false;',
  ],
  [
    'negative-never-allowed',
    ENGINE,
    "  const negativeHeld = fields['Negative balances'] === 'not allowed';",
    '  const negativeHeld = true;',
  ],
  [
    'negative-value-only',
    ENGINE,
    '        ((x.q ?? 0n) < 0n || (x.v ?? 0n) < 0n)',
    '        (x.v ?? 0n) < 0n',
  ],
  [
    'unit-conflict-allowed',
    ENGINE,
    "      holdKey(key, 'UNIT_CONFLICT');",
    '      void 0;',
  ],
  [
    'account-conflict-allowed',
    ENGINE,
    "      holdKey(key, 'ACCOUNT_CONFLICT');",
    '      void 0;',
  ],
  [
    'two-closings-allowed',
    ENGINE,
    "      own.filter((x) => x.kind === 'opening').length > 1 ||\n      own.filter((x) => x.kind === 'closing').length > 1",
    "      own.filter((x) => x.kind === 'opening').length > 1",
  ],
  [
    'two-openings-allowed',
    ENGINE,
    "      own.filter((x) => x.kind === 'opening').length > 1 ||\n",
    '',
  ],
  [
    'transfers-of-any-period',
    ENGINE,
    '      TRANSFERS.includes(x.kind) &&\n      inside(x.pd) &&',
    '      TRANSFERS.includes(x.kind) &&',
  ],
  [
    'repeated-transfers-allowed',
    ENGINE,
    "    if (outs.length > 1 || ins.length > 1)\n      for (const x of group) hold(x, 'TRANSFER_REPEATED');\n    else if",
    '    if',
  ],
  [
    'repeated-outs-only',
    ENGINE,
    '    if (outs.length > 1 || ins.length > 1)',
    '    if (outs.length > 1)',
  ],
  [
    'unpaired-allowed',
    ENGINE,
    "    else if (!outs.length || !ins.length) hold(group[0], 'TRANSFER_UNPAIRED');",
    '    else if (!outs.length || !ins.length) void 0;',
  ],
  [
    'transfer-item-unchecked',
    ENGINE,
    "(['item', 'unit', 'q', 'v'] as const)",
    "(['unit', 'q', 'v'] as const)",
  ],
  [
    'transfer-unit-unchecked',
    ENGINE,
    "(['item', 'unit', 'q', 'v'] as const)",
    "(['item', 'q', 'v'] as const)",
  ],
  [
    'transfer-quantity-unchecked',
    ENGINE,
    "(['item', 'unit', 'q', 'v'] as const)",
    "(['item', 'unit', 'v'] as const)",
  ],
  [
    'transfer-value-unchecked',
    ENGINE,
    "(['item', 'unit', 'q', 'v'] as const)",
    "(['item', 'unit', 'q'] as const)",
  ],
  [
    'unread-sides-equal',
    ENGINE,
    '        (f) => a[f] !== null && a[f] === b[f],',
    '        (f) => a[f] === b[f],',
  ],
  [
    'mismatch-holds-the-out-side-only',
    ENGINE,
    "        hold(b, 'TRANSFER_MISMATCH');\n",
    '',
  ],
  [
    'returns-of-any-period',
    ENGINE,
    '    if (x.kind === null || !Object.hasOwn(RETURNS, x.kind) || !inside(x.pd))',
    '    if (x.kind === null || !Object.hasOwn(RETURNS, x.kind))',
  ],
  [
    'unseen-origin-holds',
    ENGINE,
    '      unseen.push({ row: x.row, id: x.id, origin: x.oid });',
    "      hold(x, 'RETURN_ORIGIN');",
  ],
  [
    'two-origins-allowed',
    ENGINE,
    '      named.length > 1 ||\n      !o.whole ||',
    '      !o.whole ||',
  ],
  ['origin-need-not-read-whole', ENGINE, '      !o.whole ||\n', ''],
  [
    'origin-kind-unchecked',
    ENGINE,
    '      o.kind !== RETURNS[x.kind] ||\n',
    '',
  ],
  [
    'return-in-needs-a-receipt',
    ENGINE,
    "  'return-in': 'issue',",
    "  'return-in': 'receipt',",
  ],
  ['origin-item-unchecked', ENGINE, '      o.item !== x.item ||\n', ''],
  [
    'origin-unit-unchecked',
    ENGINE,
    '      o.item !== x.item ||\n      o.unit !== x.unit',
    '      o.item !== x.item',
  ],
  [
    'capacity-by-value-only',
    ENGINE,
    '      rets.reduce((a, x) => a + x.q!, 0n) > o.q! ||\n',
    '',
  ],
  [
    'capacity-by-quantity-only',
    ENGINE,
    ' ||\n      rets.reduce((a, x) => a + x.v!, 0n) > o.v!',
    '',
  ],
  [
    'capacity-ignores-unread-returns',
    ENGINE,
    '      rets.some((x) => x.q === null || x.v === null) ||\n      rets.reduce((a, x) => a + x.q!, 0n) > o.q!',
    '      rets.reduce((a, x) => a + (x.q ?? 0n), 0n) > o.q!',
  ],
  [
    'capacity-holds-the-first-only',
    ENGINE,
    "      for (const x of rets) hold(x, 'RETURN_CAPACITY');",
    "      hold(rets[0], 'RETURN_CAPACITY');",
  ],
  [
    'run-codes-not-spread',
    ENGINE,
    '    const codes = [...new Set([...(held.get(key) ?? []), ...run])]',
    '    const codes = [...new Set([...(held.get(key) ?? [])])]',
  ],
  [
    'return-in-not-an-inflow',
    ENGINE,
    "  'adjustment-in',\n  'return-in',\n] as const;\nexport const IMB_OUTFLOWS",
    "  'adjustment-in',\n] as const;\nexport const IMB_OUTFLOWS",
  ],
  [
    'adjustment-out-as-inflow',
    ENGINE,
    'const isInflow = (k: string) => (IMB_INFLOWS as readonly string[]).includes(k);',
    "const isInflow = (k: string) =>\n  k === 'adjustment-out' || (IMB_INFLOWS as readonly string[]).includes(k);",
  ],
  [
    'quantity-bridge-unchecked',
    ENGINE,
    "        ...(computedQ !== closing.q ? ['QUANTITY_BRIDGE'] : []),\n",
    '',
  ],
  [
    'value-bridge-unchecked',
    ENGINE,
    "        ...(computedV !== closing.v ? ['VALUE_BRIDGE'] : []),\n",
    '',
  ],
  [
    'missing-opening-is-zero',
    ENGINE,
    '    if (opening) {\n      computedQ = opening.q!;\n      computedV = opening.v!;',
    '    {\n      computedQ = opening?.q ?? 0n;\n      computedV = opening?.v ?? 0n;',
  ],
  [
    'missing-opening-not-missing',
    ENGINE,
    '    if (!opening || !closing) {',
    '    if (!closing) {',
  ],
  [
    'lines-unsorted',
    ENGINE,
    '        .sort((a, b) => byText(a.id, b.id)),\n    });',
    '    });',
  ],
  [
    'positions-by-joined-key',
    ENGINE,
    '    return byText(ai, bi) || byText(ad, bd);',
    '    return byText(`${ai}|${ad}`, `${bi}|${bd}`);',
  ],
  [
    'gl-file-holds-nothing',
    ENGINE,
    "  if (!gl) run.add('GL_FILE');",
    '  if (!gl) void 0;',
  ],
  [
    'gl-unreadable-holds-nothing',
    ENGINE,
    "      run.add('GL_UNREADABLE');\n",
    '',
  ],
  [
    'gl-duplicate-allowed',
    ENGINE,
    "    if (own.length > 1) codes.add('GL_DUPLICATE');",
    "    if (false) codes.add('GL_DUPLICATE');",
  ],
  [
    'gl-closing-unchecked',
    ENGINE,
    '        g.credit === null ||\n        g.closing === null',
    '        g.credit === null',
  ],
  [
    'gl-debit-signed',
    ENGINE,
    "      debit: imbNumber(get('Debit'), decimals, false),",
    "      debit: imbNumber(get('Debit'), decimals, true),",
  ],
  [
    'gl-opening-unsigned',
    ENGINE,
    "      opening: imbNumber(get('Opening'), decimals, true),",
    "      opening: imbNumber(get('Opening'), decimals, false),",
  ],
  [
    'gl-width-unchecked',
    ENGINE,
    '      wide: width(cells) > IMB_GL_COLUMNS.length,',
    '      wide: false,',
  ],
  [
    'position-holds-no-account',
    ENGINE,
    "      codes.add('POSITION');",
    '      void 0;',
  ],
  [
    'inconsistent-position-compared',
    ENGINE,
    "        (k) => statusOf.get(k) !== 'consistent',",
    "        (k) => statusOf.get(k) === 'held',",
  ],
  [
    'internal-transfers-counted',
    ENGINE,
    '              if (a.account === account && b.account === account) continue;',
    '              void a; void b;',
  ],
  [
    'every-transfer-internal',
    ENGINE,
    '              if (a.account === account && b.account === account) continue;',
    '              if (a.account === account || b.account === account) continue;',
  ],
  [
    'absences-swapped',
    ENGINE,
    "        entry.codes = ['REGISTER_ABSENT'];",
    "        entry.codes = ['GL_ABSENT'];",
  ],
  [
    'difference-sign-flipped',
    ENGINE,
    '          opening: reg.opening - glSide.opening,',
    '          opening: glSide.opening - reg.opening,',
  ],
  [
    'closing-difference-ignored',
    ENGINE,
    '          closing: reg.closing - glSide.closing,',
    '          closing: 0n,',
  ],
  [
    'transfers-as-receipts',
    ENGINE,
    "        if (x.kind === 'transfer-out') totals.transferred += x.v!;\n        else if (x.kind !== 'transfer-in')",
    "        if (x.kind === 'transfer-out') totals.transferred += x.v!;\n        else if (x.kind === 'transfer-in') totals.receipt += x.v!;\n        else",
  ],
  [
    'totals-despite-missing',
    ENGINE,
    "      (p) => p.status === 'consistent' || p.status === 'inconsistent',",
    "      (p) => p.status !== 'held',",
  ],
  [
    'totals-despite-unreadable-lines',
    ENGINE,
    "    !run.has('LINE_UNREADABLE') &&\n",
    '',
  ],
  [
    'unplaced-unsorted',
    ENGINE,
    '  result.unplaced = unplaced.sort(\n    (a, b) => byText(a.file, b.file) || a.row - b.row || byText(a.code, b.code),\n  );',
    '  result.unplaced = unplaced;',
  ],
  [
    'negative-scope-unchecked',
    ENGINE,
    "    (f['Negative balances'] === 'allowed' ||\n      f['Negative balances'] === 'not allowed')",
    '    true',
  ],
  [
    'period-may-run-backwards',
    ENGINE,
    "    f['Period start'] <= f['Period end'] &&\n",
    '',
  ],
  [
    'scope-text-unchecked',
    ENGINE,
    "(k) => typeof fields[k] === 'string' && imbText(fields[k]) === fields[k],",
    "(k) => typeof fields[k] === 'string',",
  ],
  [
    'scope-extra-fields',
    ENGINE,
    "  if (keys.join('|') !== [...IMB_SCOPE_FIELDS].sort(byText).join('|'))\n    return false;",
    '',
  ],
  [
    'reading-confirmation-ignored',
    ENGINE,
    '      r.family !== IMB_VERSION ||\n      r.confirmed !== true',
    '      r.family !== IMB_VERSION',
  ],
  [
    'roles-in-any-order',
    ENGINE,
    '      r.role !== IMB_ROLES[i] ||',
    '      !IMB_ROLES.includes(r.role) ||',
  ],
  ['source-name-unchecked', ENGINE, '      !/\\.csv$/i.test(f.name) ||\n', ''],
  [
    'hash-shape-unchecked',
    ENGINE,
    '      !/^[a-f0-9]{64}$/.test(f.sha256)',
    '      false',
  ],
  ['scope-confirmation-ignored', ENGINE, '    s.confirmed !== true ||\n', ''],
  [
    'replay-hash-unchecked',
    REPLAY,
    "    if (c.claimed !== undefined && c.claimed !== sha256)\n      throw new Error('IMB_SOURCE_HASH');\n",
    '',
  ],
  [
    'replay-reads-the-caller-buffer',
    REPLAY,
    '      bytes: new Uint8Array(f.original.slice(0)),',
    '      bytes: new Uint8Array(f.original),',
  ],
  [
    'scope-read-after-await',
    REPLAY,
    '  const scope = structuredClone(input.scope);',
    '  const scope = input.scope;',
  ],
  [
    'replay-one-file-accepted',
    REPLAY,
    '  if (!plain(input) || !Array.isArray(input.files) || input.files.length !== 2)',
    '  if (!plain(input) || !Array.isArray(input.files))',
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
