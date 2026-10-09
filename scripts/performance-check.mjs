// Both package aliases execute this entry: prepare synthetic inputs outside the
// checkout, then run the real browser benchmark without weakening its verdict.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const keys = new Set([
  'sizes',
  'formats',
  'output',
  'dist',
  'fixed-clock',
  'lifecycle',
]);
const seen = new Set();
for (const arg of args) {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match || !keys.has(match[1]) || seen.has(match[1]))
    throw Error(
      'Use unique --sizes/--formats/--output/--dist/--fixed-clock/--lifecycle options',
    );
  seen.add(match[1]);
}
const outputArg = args.find((arg) => arg.startsWith('--output='));
const out = outputArg
  ? resolve(outputArg.slice('--output='.length))
  : await mkdtemp(join(tmpdir(), 'tarasuf-performance-evidence-'));
if (out === resolve(root) || out.startsWith(resolve(root) + '/'))
  throw Error('Performance evidence must be outside the source checkout');
await mkdir(out, { recursive: true });
const benchArgs = [
  ...args.filter((arg) => !arg.startsWith('--output=')),
  '--output=' + out,
  '--fixtures-dir=' + out,
];
const stages = [];
for (const stage of ['prepare', 'browser']) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'scripts/browser-performance.mjs',
      ...benchArgs,
      ...(stage === 'prepare' ? ['--prepare-only=yes'] : []),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    },
  );
  await writeFile(
    join(out, `${stage}.log`),
    (result.stdout ?? '') + (result.stderr ?? ''),
    { flag: 'wx' },
  );
  stages.push({
    stage,
    exit: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  });
  console.log(JSON.stringify({ out, ...stages.at(-1) }));
  if (result.status !== 0 || result.signal || result.error) {
    process.exitCode = 1;
    break;
  }
}
await writeFile(
  join(out, 'ENTRY-RESULTS.json'),
  JSON.stringify({ out, stages }, null, 2) + '\n',
  { flag: 'wx' },
);
