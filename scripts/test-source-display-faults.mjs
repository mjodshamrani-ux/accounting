// Visibility faults must fail real IO/worker acceptance assertions. Mutations
// run in private copies; neither tracked sources nor independent evidence move.
import {
  cp,
  readFile,
  writeFile,
  symlink,
  mkdir,
  mkdtemp,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  completedSuccessfully,
  isAssertionKill,
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
// CI's accounting gate has six shards. Enforce this bounded additional gate
// once on shard one; unsharded local/package execution always enforces it.
if (process.env.MUTATION_SHARD) {
  const match = /^(\d+)\/(\d+)$/.exec(process.env.MUTATION_SHARD);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2]))
    throw Error('Invalid source display mutation shard');
  if (Number(match[1]) !== 1) {
    console.log('Source display faults are enforced by accounting shard one.');
    process.exit(0);
  }
}
const out = process.env.SOURCE_DISPLAY_FAULT_OUTPUT_DIR
  ? resolve(process.env.SOURCE_DISPLAY_FAULT_OUTPUT_DIR)
  : await mkdtemp(join(tmpdir(), 'mizan-display-fault-evidence-'));
await mkdir(out, { recursive: true });
const tests = [
  'tests/source-display-entry.test.ts',
  'tests/native-display-mapping.test.ts',
];
const faults = [
  [
    'bank-native-guard',
    'lib/reconciliation/bank-io.ts',
    '    await assertBankNativeDisplay(file);',
    '    // deliberately omit native replay verification',
  ],
  [
    'raw-row-inheritance',
    'lib/reconciliation/xlsx-display.ts',
    'info?.rowStyles.get(row) ??',
    'undefined ??',
  ],
  [
    'raw-column-inheritance',
    'lib/reconciliation/xlsx-display.ts',
    'info?.columnStyles.get(column) ??',
    'undefined ??',
  ],
  [
    'base-font-flag',
    'lib/reconciliation/xlsx-display.ts',
    "xf.applyFont === '0' || xf.applyFont === 'false'",
    'false',
  ],
  [
    'base-fill-flag',
    'lib/reconciliation/xlsx-display.ts',
    "xf.applyFill === '0' || xf.applyFill === 'false'",
    'false',
  ],
  [
    'hidden-sheet',
    'lib/reconciliation/xlsx-display.ts',
    "hidden: !!entry.state && entry.state !== 'visible'",
    'hidden: false',
  ],
  [
    'effective-number-format',
    'lib/reconciliation/xlsx-display.ts',
    'rawStyles[index] ??',
    '{ ...rawStyles[index], numberFormat: undefined } ??',
  ],
  [
    'text-contrast',
    'lib/reconciliation/xlsx-display.ts',
    'return result;',
    'return true;',
  ],
];
function run(cwd) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
const baseline = run(root);
await writeFile(
  join(out, 'baseline.log'),
  (baseline.stdout ?? '') + (baseline.stderr ?? ''),
  { flag: 'wx' },
);
if (!completedSuccessfully(baseline))
  throw Error('Source display faults require a passing unmodified baseline');
const results = [];
for (const [name, file, before, after] of faults) {
  const scratch = await createPrivateTree();
  try {
    for (const entry of ['lib', 'tests', 'package.json'])
      await cp(join(root, entry), join(scratch, entry), { recursive: true });
    await symlink(
      join(root, 'node_modules'),
      join(scratch, 'node_modules'),
      'dir',
    );
    const target = join(scratch, file),
      source = await readFile(target, 'utf8');
    if (source.split(before).length !== 2)
      throw Error(`Fault requires one exact anchor: ${name}`);
    await writeFile(target, source.replace(before, after));
    const execution = run(scratch),
      killed = isAssertionKill(execution);
    await writeFile(
      join(out, `${name}.log`),
      (execution.stdout ?? '') + (execution.stderr ?? ''),
      { flag: 'wx' },
    );
    results.push({
      name,
      killed,
      status: execution.status,
      signal: execution.signal,
      error: execution.error?.message ?? null,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await removePrivateTree(scratch);
  }
}
await writeFile(
  join(out, 'RESULTS.json'),
  JSON.stringify({ results, out }, null, 2) + '\n',
  { flag: 'wx' },
);
if (results.some((result) => !result.killed)) process.exitCode = 1;
