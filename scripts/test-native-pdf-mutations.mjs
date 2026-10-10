import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
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
const tests = ['tests/pdf-native-unicode.test.ts'];
const generated = 'lib/reconciliation/pdfjs-native.generated.mjs';
const guards = 'lib/reconciliation/pdf-font-integrity.ts';
const output = resolve(
  process.env.NATIVE_PDF_MUTATION_REPORT_DIR ??
    join(root, '../evidence/native-pdf-mutations'),
);
await mkdir(output, { recursive: true });
const digest = (data) => createHash('sha256').update(data).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    [generated, guards, ...tests].map(async (file) => [
      file,
      digest(await readFile(join(root, file))),
    ]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  );
const log = async (name, result) =>
  writeFile(
    join(output, name + '.log'),
    (result.stdout ?? '') + (result.stderr ?? ''),
  );
const baseline = run(root);
await log('baseline', baseline);
const report = {
  synthetic: true,
  sourceHashes: before,
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
const mutations = [
  {
    name: 'replace-explicit-source-map-with-glyph-ids',
    file: generated,
    from: 'e.hasIncludedToUnicodeMap||(this.toUnicode=new ToUnicodeMap(r))',
    to: 'this.toUnicode=new ToUnicodeMap(r)',
  },
  {
    name: 'accept-invalid-surrogate-pair',
    file: generated,
    from: 'if(i<56320||i>57343)throw new FormatError$1(`Invalid ToUnicode pair`);',
    to: '',
  },
  {
    name: 'pad-odd-utf16-source-bytes',
    file: generated,
    from: 'if(t.length%2!==0)throw new FormatError$1(`Invalid ToUnicode UTF-16BE length`);',
    to: 't.length%2!==0&&(t=`\\0`+t);',
  },
  {
    name: 'accept-partial-page-after-font-failure',
    file: guards,
    from: 'failed = true',
    to: 'failed = false',
  },
];
if (report.baselinePassed)
  for (const mutation of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        'audit/native-unicode',
        'tests/pdf-native-unicode.test.ts',
        'package.json',
      ])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const file = join(tree, mutation.file);
      const text = await readFile(file, 'utf8');
      if (text.split(mutation.from).length !== 2)
        throw Error('Mutation anchor drift');
      await writeFile(file, text.replace(mutation.from, mutation.to));
      const result = run(tree);
      await log(mutation.name, result);
      report.mutations.push({
        name: mutation.name,
        killed: isAssertionKill(result),
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      report.mutations.push({
        name: mutation.name,
        killed: false,
        infrastructureError: error.message,
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
for (const [file, hash] of Object.entries(before))
  if (digest(await readFile(join(root, file))) !== hash)
    throw Error('Mutation touched product source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((x) => x.killed);
await writeFile(
  join(output, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
