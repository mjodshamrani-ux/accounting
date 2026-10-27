import assert from 'node:assert/strict';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const prep = resolve(
  process.env.AR_MUTATION_PREP || join(root, 'audit/ar-scope-details'),
);
const planPath = join(prep, 'MUTATION-PLAN.json');
const checker = resolve(
  process.env.AR_MUTATION_EXPORT_CHECKER ||
    join(prep, 'checker/check_export.py'),
);
const outputRoot = resolve(
  process.env.AR_SCOPE_MUTATION_DIR || join(root, '../evidence/mutations'),
);
const output = join(
  outputRoot,
  `attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`,
);
await mkdir(output, { recursive: true });
const planRaw = await readFile(planPath, 'utf8'),
  plan = JSON.parse(planRaw);
const checkerBytes = await readFile(checker);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const core = 'tests/ar-scope-details-core.test.ts',
  io = 'tests/ar-scope-details-io.test.ts';
const worker = 'tests/ar-worker-binding.test.ts',
  witness = 'tests/ar-scope-details-mutation-witness.test.ts';
const parser = 'lib/reconciliation/ar-scope-details.ts',
  engine = 'lib/reconciliation/ar.ts';
const arIo = 'lib/reconciliation/ar-io.ts',
  binding = 'lib/reconciliation/ar-worker-binding.ts';
const client = 'lib/reconciliation/worker-client.ts';
const mutation = (id, files, pattern, edits, explanation) => ({
  id,
  files,
  pattern,
  edits,
  explanation,
});
const edit = (file, find, replacement) => ({ file, find, replacement });
// Literal anchors below must each occur once. Multi-edit mutations implement one
// coherent contract fault, such as admitting zero through both zero/sign guards.
const mutations = [
  mutation(
    'amount-open-substitution',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        'const originalRaw = cell(reading.amount);',
        'const originalRaw = cell(reading.open);',
      ),
    ],
    'Use the descriptive open balance as authoritative original money.',
  ),
  mutation(
    'invent-receipt-allocation',
    [core],
    'sealed 75',
    [
      edit(
        engine,
        'receiptAllocations: [] as never[],',
        "receiptAllocations: valid.filter((row) => row.kind === 'receipt').map((row) => ({ receipt: row.id, invoice: row.related, allocatedMinor: -row.amount })) as never[],",
      ),
    ],
    'Invent allocations from receipt reference and signed receipt amount.',
  ),
  mutation(
    'parent-forward-fill',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        'const parentScopeId = identity(cell(reading.parent));',
        'const parentScopeId = identity(cell(reading.parent) || scopeId);',
      ),
    ],
    'Fill a missing detail parent from the source scope.',
  ),
  mutation(
    'foreign-parent',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        "if (parentScopeId !== scopeId) error('PARENT_SCOPE');",
        'void parentScopeId;',
      ),
    ],
    'Accept a detail pointing to another parent.',
  ),
  mutation(
    'scope-overwrite',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        "if (own(expected, key) && value !== expected[key]) error('HEADER_SCOPE');",
        'void expected;',
      ),
    ],
    'Treat externally confirmed scope as authority despite contradictory raw header.',
  ),
  mutation(
    'late-header-bleed',
    [core],
    'sealed 75|structural failure',
    [
      edit(
        parser,
        "} else report('AR_DETAIL_AFTER_END', index, true);",
        '} else { item.classification = "detail"; detailIndexes.push(index); }',
      ),
    ],
    'Accept detail rows beyond the explicit END_DETAILS boundary.',
  ),
  mutation(
    'invent-own-identity',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        'document = identity(cell(reading.document));',
        'document = identity(cell(reading.document) || scopeId);',
      ),
    ],
    'Fill a missing own document identity from the parent scope ID.',
  ),
  mutation(
    'drop-late-invalid-competitor',
    [core],
    'sealed 75|source defects',
    [
      edit(
        parser,
        "report(cause instanceof Error ? cause.message : 'AR_CELL', index);",
        'void cause;',
      ),
    ],
    'Hide rejected detail competitors by skipping their error report.',
  ),
  mutation(
    'zero-is-original',
    [core],
    'sealed 75',
    [
      edit(parser, "if (amount === 0) error('ZERO_AMOUNT');", 'void amount;'),
      edit(
        parser,
        "if (kind === 'invoice' ? amount <= 0 : amount >= 0) error('DIRECTION');",
        "if (kind === 'invoice' ? amount < 0 : amount > 0) error('DIRECTION');",
      ),
    ],
    'Admit literal 0, +0 and -0 as original movements.',
  ),
  mutation(
    'sign-kind-mismatch',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        "if (kind === 'invoice' ? amount <= 0 : amount >= 0) error('DIRECTION');",
        'void kind;',
      ),
    ],
    'Ignore the invoice versus credit/receipt signed direction rule.',
  ),
  mutation(
    'round-precision',
    [core],
    'sealed 75',
    [
      edit(
        parser,
        "if ((rawMoney.split('.')[1]?.length ?? 0) > decimals)\n          error('AMOUNT_PRECISION');",
        'void decimals;',
      ),
      edit(
        parser,
        "return parseMoney(rawMoney, 'dot', decimals);",
        "return parseMoney(Number(rawMoney).toFixed(decimals), 'dot', decimals);",
      ),
    ],
    'Round excess precision instead of preserving a rejected original value.',
  ),
  mutation(
    'related-as-own',
    [core, witness],
    'sealed 75|receipt own identity',
    [
      edit(
        parser,
        'document = identity(cell(reading.document));',
        'document = identity(cell(reading.related).trim() || cell(reading.document));',
      ),
    ],
    'Promote a related invoice reference over the own document number.',
  ),
  mutation(
    'duplicate-document-choice',
    [core],
    'sealed 75',
    [edit(engine, ': left.length > 1 || right.length > 1', ': false')],
    'Choose the first candidates and mark duplicate own-document buckets exact.',
  ),
  mutation(
    'ignore-parent-context',
    [witness],
    'context binds',
    [
      edit(
        engine,
        'input.files.map((f) => f.sha256),',
        'input.files.map((f, side) => { const reading = input.readings[side]; return isArScopeReading(reading) ? f.sheets[reading.sheet].rows.map((row, index) => index <= reading.header ? [] : row.filter((_, column) => column !== reading.parent)) : f.sha256; }),',
      ),
    ],
    'Derive decision context from detail values while omitting the raw header and parent.',
  ),
  mutation(
    'ignore-open-raw-context',
    [witness],
    'context binds',
    [
      edit(
        engine,
        'input.files.map((f) => f.sha256),',
        'input.files.map((f, side) => { const reading = input.readings[side]; return isArScopeReading(reading) ? f.sheets[reading.sheet].rows.map((row, index) => index <= reading.header ? row : row.filter((_, column) => column !== reading.open)) : f.sha256; }),',
      ),
    ],
    'Derive context from parsed source values after dropping descriptive open bytes.',
  ),
  mutation(
    'trust-derived-cache',
    [io],
    'reads originals instead',
    [
      edit(
        arIo,
        'const captured = snapshot(input);',
        'const captured = snapshot(input);\n  if (input.files.every((file) => file.sheets?.length)) return { state: input, result: reconcileAr(input) };',
      ),
    ],
    'Prefer cached sheets over an authoritative reread.',
  ),
  mutation(
    'late-request-capture',
    [witness],
    'request captures',
    [
      edit(
        client,
        'payload = snapshotArRequest(action, payload);',
        'void payload;',
      ),
      edit(
        client,
        'if (!cached) cached = create();',
        "if (!cached) cached = create();\n      if (action.startsWith('ar-')) payload = snapshotArRequest(action, payload);",
      ),
    ],
    'Capture the AR request only after the worker factory can mutate it.',
  ),
  mutation(
    'coherent-foreign-response',
    [worker],
    'rejects coherent foreign|coherent replies with requested',
    [
      edit(
        binding,
        ': await io.replayAr(payload as unknown as ArInput);',
        ': await io.replayAr(value.state as ArInput);',
      ),
    ],
    'Validate a coherent foreign reconcile response against its own originals.',
  ),
  mutation(
    'foreign-restored-session',
    [worker],
    'rejects coherent foreign',
    [
      edit(
        binding,
        '? await io.restoreAr(payload.buffer as ArrayBuffer)',
        '? await io.replayAr(value.state as ArInput)',
      ),
    ],
    'Bind restore validation to the returned state instead of requested session bytes.',
  ),
  mutation(
    'late-result-after-cancel',
    [worker],
    'cancellation before',
    [
      edit(
        client,
        "const abort = () => fail(new Error('أُلغيت العملية'));",
        "const abort = () => action.startsWith('ar-') ? undefined : fail(new Error('أُلغيت العملية'));",
      ),
    ],
    'Ignore cancellation after an AR response enters asynchronous validation.',
  ),
  mutation(
    'export-source-corruption',
    [witness],
    'independent export audit',
    [
      edit(
        arIo,
        'raw.slice(start, start + 30000),',
        "'A' + raw.slice(start + 1, start + 30000),",
      ),
    ],
    'Corrupt a base64 source byte while retaining the advertised hash.',
  ),
  mutation(
    'export-parent-provenance-drop',
    [witness],
    'independent export audit',
    [
      edit(arIo, "r.parentScopeId ?? '',", "'',"),
      edit(
        arIo,
        "r.inheritedSourceCells\n              ? JSON.stringify(r.inheritedSourceCells)\n              : '',",
        "'',",
      ),
    ],
    'Drop raw parent and inherited header-cell lineage from movement exports.',
  ),
  mutation(
    'export-inventory-drop',
    [witness],
    'independent export audit',
    [
      edit(
        arIo,
        'const inventory = result.inventory.filter((i) => i.side === side),',
        "const inventory = result.inventory.filter((i) => i.side === side && i.kind === 'movement'),",
      ),
    ],
    'Export only valid movements and omit source headers, blanks and errors.',
  ),
  mutation(
    'native-open-formula',
    [core],
    'sealed 75|native',
    [
      edit(
        parser,
        'const native = nativeError(index);',
        'const native = sheet.formulaCells?.[`${index + 1}:${reading.open + 1}`] ? undefined : nativeError(index);',
      ),
    ],
    'Ignore native formula evidence for a row when Open balance contains a formula.',
  ),
  mutation(
    'legacy-session-break',
    [witness],
    'legacy sessions preserve',
    [
      // A printed statement (AR-1 PDF A2) made this a three-way choice; the
      // fault is the same: a legacy comparison takes the new family.
      edit(
        engine,
        '      ? AR_SCOPE_DETAILS_VERSION\n      : AR_VERSION;',
        '      ? AR_SCOPE_DETAILS_VERSION\n      : AR_SCOPE_DETAILS_VERSION;',
      ),
    ],
    'Silently change legacy reconciliation/session family and its decision context.',
  ),
  mutation(
    'export-original-open-swap',
    [witness],
    'independent export audit',
    [
      // A3 added the printed statement to the extended trail; the fault is the
      // same and still touches only scope-details rows.
      edit(
        arIo,
        'const extended = result.version === AR_SCOPE_DETAILS_VERSION || !!printed;',
        `const extended = result.version === AR_SCOPE_DETAILS_VERSION || !!printed;
  if (extended) {
    for (const row of result.rows) {
      if (isArScopeReading(result.readings[row.side])) {
        row.amount = Math.round(Number(row.openBalanceRaw || '0') * 10 ** result.decimals);
        row.originalRaw = row.openBalanceRaw;
      }
    }
    result.totals = [0, 1].map((side) => result.totals[side] === null ? null : result.rows.filter((row) => row.side === side).reduce((sum, row) => sum + row.amount, 0)) as [number | null, number | null];
  }`,
      ),
    ],
    'Export open money as original raw and minor units, recomputing coherent Summary totals from the counterfeit movements.',
  ),
];
assert.deepEqual(
  mutations.map((m) => m.id),
  plan.mutations.map((m) => m.id),
  'sealed fault IDs/order are complete and unchanged',
);
const tracked = [
  ...new Set(mutations.flatMap((m) => m.edits.map((e) => e.file))),
];
const original = Object.fromEntries(
  await Promise.all(
    tracked.map(async (file) => [
      file,
      await readFile(join(root, file), 'utf8'),
    ]),
  ),
);
const report = {
  schema: 'ar-scope-details-product-mutations-1',
  planPath,
  planSha256: sha(planRaw),
  checkerPath: checker,
  checkerSha256: sha(checkerBytes),
  sourceRoot: root,
  output,
  sourceSha256: Object.fromEntries(
    tracked.map((file) => [file, sha(original[file])]),
  ),
  baselinePassed: false,
  planned: 26,
  executed: 0,
  assertionKills: 0,
  mutations: [],
  passed: false,
  blockers: [],
};
const receipt = () =>
  writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
await writeFile(join(output, 'SEALED-MUTATION-PLAN.json'), planRaw);
const capturedChecker = join(output, 'CHECKER-USED.py');
await writeFile(capturedChecker, checkerBytes);
await chmod(capturedChecker, 0o444);
await receipt();
const snapshot = await createPrivateTree();
const testFiles = [
  core,
  io,
  worker,
  witness,
  'tests/ar.test.ts',
  'tests/ar-export-text.test.ts',
];
const env = (folder) => ({
  ...process.env,
  AR_MUTATION_WITNESS_OUTPUT: folder,
  AR_MUTATION_EXPORT_CHECKER: capturedChecker,
  AR_MUTATION_PREP: prep,
  AR_MUTATION_PYTHON: process.env.AR_MUTATION_PYTHON || 'python3',
});
const run = (tree, files, folder, pattern) =>
  spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
      ...files,
    ],
    {
      cwd: tree,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
      env: env(folder),
    },
  );
try {
  await cp(join(root, 'lib'), join(snapshot, 'lib'), { recursive: true });
  await cp(join(root, 'package.json'), join(snapshot, 'package.json'));
  await mkdir(join(snapshot, 'tests'), { recursive: true });
  for (const file of testFiles)
    await cp(join(root, file), join(snapshot, file));
  for (const name of ['ar-scope-details', 'ar-limited'])
    await cp(join(root, 'audit', name), join(snapshot, 'audit', name), {
      recursive: true,
    });
  await symlink(
    join(root, 'node_modules'),
    join(snapshot, 'node_modules'),
    'dir',
  );
  for (const file of tracked) {
    assert.equal(
      sha(await readFile(join(snapshot, file))),
      report.sourceSha256[file],
      `${file}: immutable baseline capture`,
    );
    await chmod(join(snapshot, file), 0o444);
  }
  for (const file of testFiles) await chmod(join(snapshot, file), 0o444);
  await mkdir(join(output, 'baseline'), { recursive: true });
  const baseline = run(
    snapshot,
    testFiles,
    join(output, 'baseline', 'exports'),
  );
  await writeFile(
    join(output, 'baseline', 'tests.log'),
    (baseline.stdout ?? '') + (baseline.stderr ?? ''),
  );
  report.baseline = {
    status: baseline.status,
    signal: baseline.signal,
    error: baseline.error ? String(baseline.error) : null,
  };
  report.baselinePassed = completedSuccessfully(baseline);
  await receipt();
  assert.ok(
    report.baselinePassed,
    `unmutated baseline must pass; evidence ${output}`,
  );
  console.log('BASELINE_PASS', output);
  for (const fault of mutations) {
    const tree = await createPrivateTree(),
      folder = join(output, fault.id);
    await mkdir(folder, { recursive: true });
    const record = {
      id: fault.id,
      plan: plan.mutations.find((m) => m.id === fault.id),
      explanation: fault.explanation,
      tests: fault.files,
      pattern: fault.pattern,
      syntaxPassed: false,
      detected: false,
      anchors: [],
    };
    report.mutations.push(record);
    try {
      await cp(snapshot, tree, { recursive: true });
      for (const file of new Set(fault.edits.map((e) => e.file))) {
        let changed = original[file];
        for (const change of fault.edits.filter((e) => e.file === file)) {
          assert.equal(
            changed.split(change.find).length,
            2,
            `${fault.id}: unique literal anchor ${file}`,
          );
          record.anchors.push({
            file,
            find: change.find,
            replacement: change.replacement,
          });
          changed = changed.replace(change.find, change.replacement);
        }
        await chmod(join(tree, file), 0o644);
        await writeFile(join(tree, file), changed);
        await writeFile(
          join(folder, file.replaceAll('/', '__') + '.mutant'),
          changed,
        );
        record.mutantSha256 ??= {};
        record.mutantSha256[file] = sha(changed);
        const syntax = spawnSync(
          process.execPath,
          ['--experimental-strip-types', '--check', join(tree, file)],
          { encoding: 'utf8', timeout: 15000 },
        );
        await writeFile(
          join(folder, file.replaceAll('/', '__') + '.syntax.log'),
          (syntax.stdout ?? '') + (syntax.stderr ?? ''),
        );
        assert.ok(
          completedSuccessfully(syntax),
          `${fault.id}: syntax/import checks cannot count as kills`,
        );
      }
      record.syntaxPassed = true;
      const actual = run(
        tree,
        fault.files,
        join(folder, 'exports'),
        fault.pattern,
      );
      await writeFile(
        join(folder, 'tests.log'),
        (actual.stdout ?? '') + (actual.stderr ?? ''),
      );
      record.status = actual.status;
      record.signal = actual.signal;
      record.error = actual.error ? String(actual.error) : null;
      record.detected = isAssertionKill(actual);
      record.semanticAssertionCount =
        ((actual.stdout ?? '') + (actual.stderr ?? '')).match(
          /code: ['"]ERR_ASSERTION['"]/g,
        )?.length ?? 0;
      record.executed = true;
      report.executed++;
      if (record.detected) report.assertionKills++;
      console.log(fault.id, record.detected ? 'ASSERTION_KILL' : 'HOLD');
      if (!record.detected)
        report.blockers.push(
          `${fault.id}: no completed semantic assertion kill`,
        );
    } catch (error) {
      record.error = String(error);
      report.blockers.push(`${fault.id}: ${error.message}`);
      await writeFile(join(folder, 'runner-error.log'), String(error) + '\n');
      console.log(fault.id, 'HOLD', error.message);
    } finally {
      await removePrivateTree(tree);
      await receipt();
    }
  }
  report.sourceUnchanged = true;
  for (const file of tracked)
    if (sha(await readFile(join(root, file))) !== report.sourceSha256[file]) {
      report.sourceUnchanged = false;
      report.blockers.push(`${file}: source changed during gate`);
    }
  report.passed =
    report.executed === 26 &&
    report.assertionKills === 26 &&
    report.sourceUnchanged &&
    report.blockers.length === 0;
  await receipt();
  assert.equal(
    report.passed,
    true,
    `all sealed product faults require completed semantic kills; evidence ${output}`,
  );
  console.log(
    'PASS 26/26 actual product mutants; baseline passed; source unchanged',
    output,
  );
} finally {
  await removePrivateTree(snapshot);
}
