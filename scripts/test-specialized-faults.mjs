import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.SPECIALIZED_FAULT_OUTPUT_DIR
  ? resolve(process.env.SPECIALIZED_FAULT_OUTPUT_DIR)
  : await mkdtemp(join(tmpdir(), 'tarasuf-specialized-evidence-'));
await mkdir(out, { recursive: true });
const results = [];
for (const domain of ['inventory-register', 'fixed-assets', 'payroll']) {
  const result = spawnSync(
    process.execPath,
    [join(root, `scripts/${domain}-faults.mjs`), join(out, domain)],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  await writeFile(
    join(out, `${domain}.log`),
    (result.stdout ?? '') + (result.stderr ?? ''),
    { flag: 'wx' },
  );
  results.push({
    domain,
    exit: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(
  join(out, 'RESULTS.json'),
  JSON.stringify({ results, out }, null, 2) + '\n',
  { flag: 'wx' },
);
if (results.some((r) => r.exit !== 0 || r.signal || r.error))
  process.exitCode = 1;
