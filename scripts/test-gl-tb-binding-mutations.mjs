import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  isAssertionKill,
} from './mutation-runner-support.mjs';
const root = resolve(import.meta.dirname, '..'),
  output = resolve(
    process.env.GL_TB_BINDING_MUTATION_DIR ?? 'work/gl-tb-binding-mutations',
  );
await mkdir(output, { recursive: true });
const source = await readFile(
  join(root, 'lib/reconciliation/worker-client.ts'),
  'utf8',
);
const mutations = [
  [
    'snapshot-reconcile',
    "if (action.startsWith('gl-tb-')) {",
    "if (action === 'gl-tb-restore') {",
  ],
  [
    'snapshot-restore',
    "if (action.startsWith('gl-tb-')) {",
    "if (action !== 'gl-tb-restore' && action.startsWith('gl-tb-')) {",
  ],
  [
    'requested-original-replay',
    "await replayGlTb(payload as import('./gl-tb.ts').GlTbInput)",
    "await replayGlTb((response.value as { state: import('./gl-tb.ts').GlTbInput }).state)",
  ],
  [
    'requested-session-restore',
    'await restoreGlTb((payload as { buffer: ArrayBuffer }).buffer)',
    "await replayGlTb((response.value as { state: import('./gl-tb.ts').GlTbInput }).state)",
  ],
  [
    'identity-binding',
    'identity(returned.state) !== identity(requested.state)',
    'false',
  ],
  [
    'result-binding',
    'JSON.stringify(returned.result) !==\n                JSON.stringify(requested.result)',
    'false',
  ],
  [
    'exact-source-bytes',
    "a.some((byte, offset) => byte !== b[offset])\n              )\n                throw Error('GL_TB_WORKER_BINDING');",
    "false\n              )\n                throw Error('GL_TB_WORKER_BINDING');",
  ],
  [
    'install-request-reread',
    'response.value = requested;',
    'response.value = returned;',
  ],
  ['terminate-rejected-worker', 'worker.terminate();', 'void worker;'],
];
const sha = (s) => createHash('sha256').update(s).digest('hex'),
  temp = await createPrivateTree();
try {
  for (const name of ['lib', 'tests', 'audit', 'package.json'])
    await cp(join(root, name), join(temp, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  const file = join(temp, 'lib/reconciliation/worker-client.ts'),
    results = [];
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        '--test-reporter=tap',
        '--test-name-pattern=^binding:',
        'tests/gl-tb-binding.test.ts',
        'tests/gl-tb-binding-envelope.test.ts',
      ],
      {
        cwd: temp,
        encoding: 'utf8',
        timeout: 120000,
        env: { ...process.env, GL_TB_BINDING_REPORT_DIR: '' },
      },
    );
  const baseline = run();
  await writeFile(
    join(output, 'baseline.log'),
    baseline.stdout + baseline.stderr,
  );
  assert.ok(completedSuccessfully(baseline), 'baseline');
  for (const [name, find, replacement] of mutations) {
    assert.equal(source.split(find).length, 2, name + ' unique anchor');
    const changed = source.replace(find, replacement);
    await writeFile(file, changed);
    await writeFile(join(output, name + '.source'), changed);
    const syntax = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--check', file],
      { encoding: 'utf8' },
    );
    assert.ok(completedSuccessfully(syntax), name + ' syntax');
    const actual = run();
    await writeFile(join(output, name + '.log'), actual.stdout + actual.stderr);
    const detected = isAssertionKill(actual);
    await writeFile(file, source);
    assert.equal(await readFile(file, 'utf8'), source);
    const record = {
      name,
      detected,
      status: actual.status,
      signal: actual.signal,
      error: actual.error ? String(actual.error) : null,
      syntaxStatus: syntax.status,
      restoredSha256: sha(await readFile(file)),
      mutantSha256: sha(changed),
    };
    results.push(record);
    await writeFile(
      join(output, 'RESULTS.json'),
      JSON.stringify(
        {
          baselinePassed: true,
          sourceSha256: sha(source),
          mutations: results,
          passed:
            results.length === mutations.length &&
            results.every((r) => r.detected),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(name, detected ? 'ASSERTION_KILL' : 'FAIL');
    assert.ok(detected, name + ' assertion kill');
  }
  assert.equal(
    sha(await readFile(join(root, 'lib/reconciliation/worker-client.ts'))),
    sha(source),
  );
  console.log(
    'PASS',
    results.length,
    'syntax/assertion kills/restorations; source unchanged',
  );
} finally {
  await removePrivateTree(temp);
}
