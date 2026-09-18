// Reproduces the engine comparison from a clean checkout: one evaluator, one
// generator and one seed, with only the engine root changing. Engine roots are
// pinned commits checked out into throwaway worktrees, so a run does not depend
// on anything left behind by an earlier one.
//
//   node --experimental-strip-types audit/reliability/run-matrix.mjs \
//     --engines v045=5fecb15,astra=5588417,unified=. \
//     --out work/matrix --worktrees work/engine-roots
//
// An engine value is either a git commit-ish (checked out for this run) or a
// path to an existing checkout; "." means the working tree as it stands.
// --acceptance-gate applies only to the engines named in --gate (default: the
// entry called "unified"), so historical roots keep their metrics ungated.
import { mkdir, rm, symlink, access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const engines = value('--engines', 'v045=5fecb15,astra=5588417,unified=.')
  .split(',')
  .filter(Boolean)
  .map((entry) => {
    const [name, ref = '.'] = entry.split('=');
    return { name, ref };
  });
const outDir = resolve(root, value('--out', 'work/matrix'));
const treeDir = resolve(root, value('--worktrees', 'work/engine-roots'));
const gated = new Set(value('--gate', 'unified').split(',').filter(Boolean));
const suites = value('--suites', 'known,focused').split(',').filter(Boolean);
const splits = {
  known: value('--known-split', 'development,validation,final'),
  focused: value('--focused-split', 'development-046,final-046'),
};
const keepWorktrees = args.includes('--keep-worktrees');

const git = (...command) => {
  const run = spawnSync('git', command, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0)
    throw Error(`git ${command.join(' ')} failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
};
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/** A pinned commit becomes a detached worktree with node_modules linked from the
 * main checkout, so the engine under test is the committed source and nothing
 * else. A path is used as given and never modified. */
async function engineRoot({ name, ref }) {
  if (ref === '.') {
    // "." is the working tree, which may carry uncommitted edits. Say so rather
    // than labelling the result with a commit that does not describe it.
    const dirty = git('status', '--porcelain').length > 0;
    return {
      path: root,
      commit: git('rev-parse', 'HEAD') + (dirty ? '+uncommitted' : ''),
    };
  }
  if (ref.startsWith('/') || ref.startsWith('./') || isAbsolute(ref))
    return { path: resolve(root, ref), commit: 'unpinned-path' };
  const commit = git('rev-parse', ref);
  const path = resolve(treeDir, name);
  if (await exists(path)) {
    spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: root });
    await rm(path, { recursive: true, force: true });
  }
  await mkdir(treeDir, { recursive: true });
  git('worktree', 'add', '--force', '--detach', path, commit);
  const modules = resolve(path, 'node_modules');
  if (!(await exists(modules)))
    await symlink(resolve(root, 'node_modules'), modules, 'dir');
  return { path, commit, worktree: true };
}

await mkdir(outDir, { recursive: true });
const created = [];
const results = [];
try {
  for (const engine of engines) {
    const { path, commit, worktree } = await engineRoot(engine);
    if (worktree) created.push(path);
    for (const suite of suites) {
      const output = resolve(outDir, `${suite}-${engine.name}`);
      await rm(output, { recursive: true, force: true });
      const command = [
        '--experimental-strip-types',
        resolve(here, 'run.mjs'),
        '--suite',
        suite,
        '--split',
        splits[suite],
        '--engine-root',
        path,
        '--output',
        output,
        ...(gated.has(engine.name) ? ['--acceptance-gate'] : []),
      ];
      const run = spawnSync(process.execPath, command, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stderr.write(run.stderr ?? '');
      results.push({
        engine: engine.name,
        commit,
        suite,
        exitCode: run.status,
        gated: gated.has(engine.name),
        output,
      });
      console.log(
        JSON.stringify({
          engine: engine.name,
          commit,
          suite,
          exitCode: run.status,
          gated: gated.has(engine.name),
        }),
      );
    }
  }
} finally {
  if (!keepWorktrees)
    for (const path of created) {
      spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: root });
    }
}
// A non-zero exit on a gated engine is a failed acceptance gate and must stop
// the run. Ungated historical engines keep their known non-zero exits.
const blocking = results.filter((r) => r.gated && r.exitCode !== 0);
console.log(JSON.stringify({ matrix: outDir, blocking: blocking.length }));
if (blocking.length) process.exitCode = 1;
