import {
  cp,
  symlink,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  readdir,
} from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  completedSuccessfully,
  isAssertionKill,
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const parent = resolve(
  process.env.PG_SIGNED_MUTATION_REPORT_DIR ??
    join(root, '../evidence/mutations'),
);
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'payment-gateway-signed-attempt-'));
const core = 'lib/reconciliation/payment-gateway.ts';
const signed = 'lib/reconciliation/payment-gateway-signed.ts';
const native = 'lib/reconciliation/payment-gateway-native.ts';
const io = 'lib/reconciliation/payment-gateway-io.ts';
const binding = 'lib/reconciliation/payment-gateway-worker-binding.ts';
const tests = [
  'tests/payment-gateway-signed.test.ts',
  'tests/payment-gateway-worker-binding.test.ts',
];
const mutations = [
  {
    name: 'accept-negative-sale',
    file: signed,
    before: "(kind === 'sale' && sign === '-') ||",
    after: 'false ||',
    witness: 'negative-sale-negative',
  },
  {
    name: 'accept-positive-refund',
    file: signed,
    before: "(kind === 'refund' && sign !== '-' && !zero)",
    after: 'false',
    witness: 'negative-refund-positive',
  },
  {
    name: 'infer-kind-from-sign',
    file: core,
    before: "if (v[1] !== 'sale' && v[1] !== 'refund') fail('KIND');",
    after: "v[1] = str(3).startsWith('-') ? 'refund' : 'sale';",
    witness: 'negative-chargeback-kind|negative-missing-kind|sar-zero-kinds',
  },
  {
    name: 'erase-negative-zero-rejection',
    file: signed,
    before: "if (sign === '-' && zero) throw Error('PG_NEGATIVE_ZERO');",
    after: 'void zero;',
    witness: 'negative-refund-negative-zero',
  },
  {
    name: 'coerce-blank-signed-amount-to-zero',
    file: signed,
    before: 'const normalized = normalize',
    after: "raw = raw || '0';\n  const normalized = normalize",
    witness: 'blank and negative zero never coerce',
  },
  {
    name: 'omit-zero-transaction-members',
    file: core,
    before: 'i > 0 && raw.some((v) => v.trim()) ? [id(source, i + 1)] : [],',
    after:
      'i > 0 && raw.some((v) => v.trim()) && !(source === 0 && records[0].some((r) => r.row === i + 1 && r.values[3] === 0)) ? [id(source, i + 1)] : [],',
    witness: 'sar-zero-kinds|full zero/invalid membership',
  },
  {
    name: 'allow-signed-family-in-other-roles',
    file: core,
    before: '(i === 0 && r.family === PG_SIGNED_VERSION)',
    after: '(r.family === PG_SIGNED_VERSION)',
    witness: 'explicit family is transactions-only',
  },
  {
    name: 'remove-family-from-review-context',
    file: core,
    before: /input\.files\.map\(\(f\) => f\.sha256\),\s*readings,\s*scope,/,
    after:
      'input.files.map((f) => f.sha256),\n    readings.map((r) => ({ ...r, family: PG_VERSION })),\n    scope,',
    witness: 'review accept/reject/undo binds',
  },
  {
    name: 'derive-fees-from-settlement-summary',
    file: core,
    before: 'fees = sum(records[1].map((r) => r.values[2] as number));',
    after:
      'fees = records[2].length === 1 ? records[2][0].values[4] as number : sum(records[1].map((r) => r.values[2] as number));',
    witness: 'missing-positive-fee-detail|sar-fee-component-difference',
  },
  {
    name: 'compare-only-net-residual',
    file: core,
    before: 'residuals?.some((n) => n !== 0)',
    after: 'residuals?.[3] !== 0',
    witness: 'sar-component-cancellation',
  },
  {
    name: 'drop-bank-credit-residual',
    file: core,
    before: 'sum([summary[5] as number, -(bank[2] as number)]),',
    after: '0,',
    witness: 'sar-bank-credit-difference',
  },
  {
    name: 'add-refunds-to-calculated-net',
    file: core,
    before: 'sum([gross, -refunds, -fees])',
    after: 'sum([gross, refunds, -fees])',
    witness: 'sar-mixed',
  },
  {
    name: 'erase-raw-native-sign-provenance',
    file: signed,
    before: /return \{\s*raw,\s*normalized,/,
    after: 'return {\n    raw: String(Number(normalized)),\n    normalized,',
    witness: 'native original XML sign',
    pattern: 'native original XML sign',
  },
  {
    name: 'coerce-native-XML-before-sign-guard',
    file: native,
    before: 'signedGatewayMoney(raw, 2, kind, false);',
    after: 'signedGatewayMoney(String(Number(raw)), 2, kind, false);',
    witness: 'native original XML sign',
    pattern: 'native original XML sign',
  },
  {
    name: 'export-magnitude-as-raw-signed-amount',
    file: io,
    before: 'e.signedAmount!.raw,',
    after: 'e.signedAmount!.magnitude,',
    witness: 'export separates raw signed lexemes|worker preserves raw sign',
  },
  {
    name: 'unbind-reconcile-and-restore-from-captured-originals',
    file: binding,
    before:
      /if \(\s*!equalState\(value\.state, requested\.state\) \|\|\s*!same\(value\.result, requested\.result\)\s*\)/,
    after: 'if (false)',
    witness: 'coherent foreign result and restore envelope',
  },
  {
    name: 'unbind-saved-session-from-captured-originals',
    file: binding,
    before:
      /if \(\s*!equalState\(restored\.state, requested\.state\) \|\|\s*!same\(restored\.result, requested\.result\)\s*\)/,
    after: 'if (false)',
    witness: 'save and export bind downloaded contents',
  },
  {
    name: 'ignore-worker-export-display-substitution',
    file: binding,
    before: 'if (!same(await inspect(value), await inspect(expected)))',
    after: 'if (false)',
    witness:
      'export rejects display masking|save and export bind downloaded contents',
  },
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const logOf = (result) => (result.stdout ?? '') + (result.stderr ?? '');
function assertionTests(log) {
  const lines = log.split('\n'),
    names = [];
  for (let i = 0; i < lines.length; i++) {
    const failed = /^\s*not ok [0-9]+ - (.+)$/.exec(lines[i]);
    if (!failed) continue;
    const diagnostic = [];
    for (let j = i + 1; j < lines.length; j++) {
      diagnostic.push(lines[j]);
      if (lines[j].trim() === '...') break;
    }
    if (/^\s*code:\s*['"]?ERR_ASSERTION['"]?\s*$/m.test(diagnostic.join('\n')))
      names.push(failed[1]);
  }
  return names;
}
const brief = (result) => ({
  exitCode: result.status,
  signal: result.signal,
  error: result.error?.message ?? null,
  assertionFailure: /\bERR_ASSERTION\b/.test(logOf(result)),
  assertionTests: assertionTests(logOf(result)),
  failedTests: [...logOf(result).matchAll(/^\s*not ok [0-9]+ - (.+)$/gm)].map(
    (m) => m[1],
  ),
});
function run(cwd, pattern) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      ...(pattern ? ['--test-name-pattern=' + pattern] : []),
      ...tests,
    ],
    {
      cwd,
      env: process.env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}
async function inventory(directory, prefix = '') {
  const entries = [];
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, child.name),
      name = join(prefix, child.name);
    if (child.isDirectory()) entries.push(...(await inventory(path, name)));
    else if (child.isFile()) entries.push([name, digest(await readFile(path))]);
    else throw Error('Unexpected non-file snapshot input: ' + name);
  }
  return entries;
}

const tree = await createPrivateTree(true);
const report = {
  passed: false,
  syntheticOnly: true,
  node: process.version,
  python: process.env.PYTHON_BINARY ?? 'python3',
  assertionRule:
    'passing frozen baseline + completed syntax check + completed ERR_ASSERTION run + named semantic witness; never syntax/import/timeout/signal kills',
  tests,
  sourceHashes: {},
  snapshotHashes: {},
  baseline: null,
  catalogue: mutations.map((m) => ({ ...m, before: String(m.before) })),
  mutations: [],
};
console.log('REPORT ' + output);
try {
  for (const directory of [
    'lib',
    'audit/payment-gateway',
    'audit/payment-gateway-signed',
  ])
    await cp(join(root, directory), join(tree, directory), { recursive: true });
  await mkdir(join(tree, 'tests'), { recursive: true });
  for (const file of tests) await cp(join(root, file), join(tree, file));
  await cp(join(root, 'package.json'), join(tree, 'package.json'));
  await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  const originals = new Map();
  for (const file of new Set(mutations.map((m) => m.file)))
    originals.set(file, await readFile(join(tree, file), 'utf8'));
  const hashes = [];
  for (const directory of [
    'lib',
    'audit/payment-gateway',
    'audit/payment-gateway-signed',
  ])
    hashes.push(...(await inventory(join(tree, directory), directory)));
  for (const file of [...tests, 'package.json'])
    hashes.push([file, digest(await readFile(join(tree, file)))]);
  report.snapshotHashes = Object.fromEntries(
    hashes.sort(([a], [b]) => a.localeCompare(b)),
  );
  const targets = [
    ...new Set([
      ...mutations.map((m) => m.file),
      ...tests,
      'scripts/test-payment-gateway-signed-mutations.mjs',
      'scripts/mutation-runner-support.mjs',
    ]),
  ];
  for (const file of targets)
    report.sourceHashes[file] = digest(await readFile(join(root, file)));
  for (const file of [...originals.keys(), ...tests])
    if (report.sourceHashes[file] !== report.snapshotHashes[file])
      throw Error('Candidate changed while snapshotting: ' + file);
  await writeFile(
    join(output, 'SNAPSHOT-HASHES.json'),
    JSON.stringify(report.snapshotHashes, null, 2) + '\n',
  );
  await writeFile(
    join(output, 'CATALOGUE.json'),
    JSON.stringify(report.catalogue, null, 2) + '\n',
  );
  const baseline = run(tree);
  await writeFile(join(output, 'baseline.log'), logOf(baseline));
  report.baseline = { ...brief(baseline), logSHA256: digest(logOf(baseline)) };
  if (!completedSuccessfully(baseline))
    throw Error('Frozen baseline did not pass; no mutants executed');
  console.log('baseline: PASS');
  for (const mutation of mutations) {
    const original = originals.get(mutation.file);
    const count =
      typeof mutation.before === 'string'
        ? original.split(mutation.before).length - 1
        : [...original.matchAll(new RegExp(mutation.before.source, 'g'))]
            .length;
    const entry = {
      name: mutation.name,
      file: mutation.file,
      killed: false,
      syntaxPassed: false,
      witnessTests: [],
    };
    const started = Date.now();
    try {
      if (count !== 1)
        throw Error('Mutation anchor matched ' + count + ' times');
      const changed = original.replace(mutation.before, mutation.after);
      await writeFile(join(tree, mutation.file), changed);
      entry.originalSHA256 = digest(original);
      entry.mutantSHA256 = digest(changed);
      await writeFile(join(output, mutation.name + '.source'), changed);
      const syntax = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--check', mutation.file],
        {
          cwd: tree,
          env: process.env,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      await writeFile(
        join(output, mutation.name + '.syntax.log'),
        logOf(syntax),
      );
      entry.syntax = brief(syntax);
      if (!completedSuccessfully(syntax))
        throw Error('Mutant syntax did not pass');
      entry.syntaxPassed = true;
      const result = run(tree, mutation.pattern);
      const summary = brief(result);
      Object.assign(entry, summary);
      entry.witnessTests = summary.assertionTests.filter((name) =>
        new RegExp(mutation.witness).test(name),
      );
      entry.killed = isAssertionKill(result) && entry.witnessTests.length > 0;
      await writeFile(join(output, mutation.name + '.log'), logOf(result));
      entry.logSHA256 = digest(logOf(result));
    } catch (error) {
      entry.infrastructureError = String(error);
    } finally {
      await writeFile(join(tree, mutation.file), original);
    }
    entry.durationMs = Date.now() - started;
    report.mutations.push(entry);
    await writeFile(
      join(output, 'RESULTS.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      mutation.name +
        ': ' +
        (entry.killed ? 'ASSERTION KILL' : 'SURVIVED/INFRASTRUCTURE') +
        ' ' +
        entry.witnessTests.join(' | '),
    );
  }
  const unchanged = [];
  for (const [file, hash] of Object.entries(report.sourceHashes)) {
    const now = digest(await readFile(join(root, file)));
    if (now !== hash) unchanged.push({ file, before: hash, after: now });
  }
  report.candidateChangesDuringRun = unchanged;
  report.passed =
    unchanged.length === 0 &&
    report.mutations.length === mutations.length &&
    report.mutations.every((m) => m.killed && m.syntaxPassed);
} catch (error) {
  report.infrastructureError = String(error);
} finally {
  await removePrivateTree(tree);
}
report.killed = report.mutations.filter((m) => m.killed).length;
report.planned = mutations.length;
const resultBytes = JSON.stringify(report, null, 2) + '\n';
await writeFile(join(output, 'RESULTS.json'), resultBytes);
await writeFile(
  join(output, 'RECEIPT.json'),
  JSON.stringify(
    {
      passed: report.passed,
      killed: report.killed,
      planned: report.planned,
      resultsSHA256: digest(resultBytes),
      runnerSHA256:
        report.sourceHashes[
          'scripts/test-payment-gateway-signed-mutations.mjs'
        ] ?? null,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    passed: report.passed,
    killed: report.killed,
    planned: report.planned,
    output: relative(root, output),
    resultsSHA256: digest(resultBytes),
  }),
);
if (!report.passed) process.exitCode = 1;
