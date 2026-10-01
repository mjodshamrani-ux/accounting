// Current safe entry point; the frozen historical runners remain byte-identical.
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const [threads, name] = process.argv.slice(2);
if (!['1', '4'].includes(threads) || !/^replay-[a-z0-9-]+$/.test(name ?? ''))
  throw Error(
    'Supply thread count 1 or 4 and a NEW replay-* result name; historical results cannot be overwritten',
  );
const exists = await access(`audit/local-provider/results/${name}`).then(
  () => true,
  () => false,
);
if (exists)
  throw Error(
    'Result directory already exists. Historical results cannot be overwritten',
  );
const child = spawn(
  process.execPath,
  ['audit/local-provider/supervise.mjs', threads, name],
  { stdio: 'inherit' },
);
const code = await new Promise((resolve) =>
  child.once('exit', (code) => resolve(code)),
);
process.exitCode = typeof code === 'number' ? code : 1;
