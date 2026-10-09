import { chmod, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Output from an interrupted process cannot establish an assertion kill, even
// when assertions failed before the interruption and Node returned an exit code.
export function completedSuccessfully(result) {
  return !result.error && result.signal === null && result.status === 0;
}

export function isAssertionKill(result) {
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  return !result.error && result.signal === null &&
    Number.isInteger(result.status) && result.status > 0 && result.status <= 255 &&
    /\bERR_ASSERTION\b/.test(output) &&
    !/SyntaxError|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_DIR_IMPORT|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_PACKAGE_IMPORT_NOT_DEFINED/.test(output);
}

const privateTrees = new Set();
export async function createPrivateTree(reusable = false) {
  const path = await mkdtemp(join(tmpdir(), reusable ? 'mizan-mutant-private-' : 'mizan-mutant-'));
  privateTrees.add(path);
  return path;
}

export async function removePrivateTree(path) {
  if (!privateTrees.has(path)) throw Error('Refusing to remove an unregistered private mutation tree');
  async function makeDirectoriesWritable(directory) {
    const stat = await lstat(directory);
    // Never follow a link, including the installed node_modules dependency link.
    if (!stat.isDirectory()) return;
    await chmod(directory, stat.mode | 0o700);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await makeDirectoriesWritable(join(directory, entry.name));
    }
  }
  await makeDirectoriesWritable(path);
  await rm(path, { recursive: true, force: true });
  privateTrees.delete(path);
}
