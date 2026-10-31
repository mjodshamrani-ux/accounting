// BNK-PDF-1 G4 code mutations: each planted defect in a private copy of the
// statement view module (what the bank workspace offers the accountant) must
// make its tests fail with an assertion. Those tests bind every enabled or
// disabled decision to what the lifecycle itself takes or refuses.
//   node scripts/test-bank-statement-g4-mutations.mjs
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
  process.env.BNK_G4_MUTATION_DIR ??
  join(root, 'work/bank-statement-g4-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/bank-statement-view.test.ts'];
const VIEW = 'lib/reconciliation/bank-statement-view.ts';
const mutations = [
  [
    'accept-any-reason',
    VIEW,
    "accept: noted && c.status === 'needs-review' && ACCEPTABLE.has(c.reason),",
    "accept: noted && c.status === 'needs-review',",
  ],
  [
    'accept-any-status',
    VIEW,
    "accept: noted && c.status === 'needs-review' && ACCEPTABLE.has(c.reason),",
    'accept: noted && ACCEPTABLE.has(c.reason),',
  ],
  [
    'reject-over-decision',
    VIEW,
    'reject: noted && c.decision === null,',
    'reject: noted,',
  ],
  [
    'undo-without-decision',
    VIEW,
    'undo: noted && c.decision !== null,',
    'undo: noted,',
  ],
  [
    'no-reason-needed',
    VIEW,
    'const noted = !!note.trim();',
    'const noted = true;',
  ],
  ['reason-untrimmed', VIEW, 'note: note.trim(),', 'note,'],
  [
    'members-shared',
    VIEW,
    'statement: [...c.statement],',
    'statement: c.statement,',
  ],
  [
    'closing-fewer-decimals',
    VIEW,
    '`\\\\.(\\\\d{${decimals}})`',
    '`\\\\.(\\\\d{1,${decimals}})`',
  ],
  [
    'closing-decimals-optional',
    VIEW,
    '`\\\\.(\\\\d{${decimals}})`',
    '`(?:\\\\.(\\\\d{${decimals}}))?`',
  ],
  ['closing-plus-sign', VIEW, '`^(-?)', '`^[+]?(-?)'],
  [
    'closing-arabic-digits',
    VIEW,
    'const s = latinDigits(text.trim())',
    'const s = text.trim()',
  ],
  [
    'closing-differs-leaks-file',
    VIEW,
    "return { kind: 'closing-differs', detail: '' };",
    "return { kind: 'closing-differs', detail: reason };",
  ],
  [
    'balance-broken-unnamed',
    VIEW,
    "for (const kind of ['balance-broken', 'incomplete-pages'] as const)",
    "for (const kind of ['incomplete-pages'] as const)",
  ],
  [
    'cashbook-refusal-as-statement',
    VIEW,
    "if (code[1] === 'CASHBOOK') return 'cashbook';",
    '',
  ],
  ['changed-file-unnamed', VIEW, "    case 'SOURCE_HASH':\n", ''],
  [
    'any-format-is-statement',
    VIEW,
    "return format === 'tarasuf-bank-statement-session'",
    "return typeof format === 'string' && format !== 'tarasuf-bank-session'",
  ],
  [
    'cashbook-cited-by-voucher',
    VIEW,
    'citation: String(c.row),',
    'citation: c.id,',
  ],
  // A period that carries (WF-1 ROLL-1 W3).
  [
    'carried-reference-not-offered',
    VIEW,
    "  'carried-reference',\n  'carried-amount-suggestion',\n]);",
    "  'carried-amount-suggestion',\n]);",
  ],
  [
    'carried-amount-suggestion-not-offered',
    VIEW,
    "  'carried-reference',\n  'carried-amount-suggestion',\n]);",
    "  'carried-reference',\n]);",
  ],
  [
    'carried-amount-difference-offered',
    VIEW,
    "  'carried-reference',\n  'carried-amount-suggestion',\n]);",
    "  'carried-reference',\n  'carried-amount-suggestion',\n  'carried-amount-difference',\n]);",
  ],
  [
    'carried-in-case-shown-still',
    VIEW,
    'result.roll?.outstanding.find((o) => o.key === item.key)?.age ?? null',
    'result.roll?.outstanding.find((o) => o.key === item.key)?.age ?? item.age',
  ],
];
const files = [...new Set(mutations.map(([, file]) => file)), ...tests];
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
    { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
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
      for (const name of [
        'lib',
        ...tests,
        'audit/bank-statement-foundation',
        'audit/bank-roll-foundation',
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
