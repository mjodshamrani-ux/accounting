import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import {
  exceptionAssertionOperators,
  comparisonAssertionOperators,
} from './fault-reporter.mjs';
import {
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
// A code or an assertion wrapper alone does not establish a financial kill.
// Domain exceptions are accepted only at the declared assertion boundary with
// exact identity and throwing origin; unknown causes always fail closed.
function validFailure(failure, intended) {
  const errors = failure.errors;
  if (
    !failure.assertion ||
    failure.errorGraphComplete !== true ||
    !Array.isArray(errors) ||
    !errors.length
  )
    return false;
  if (
    errors.length > 64 ||
    errors.some(
      (error) => !error || typeof error !== 'object' || Array.isArray(error),
    )
  )
    return false;
  const depths = [];
  return errors.every((error, index) => {
    if (
      !error ||
      error.kind !== 'error' ||
      error.sameRealmError !== true ||
      error.messageTruncated !== false ||
      typeof error.message !== 'string' ||
      !error.links ||
      typeof error.genuineAssertion !== 'boolean'
    )
      return false;
    if (
      !Array.isArray(error.propagation) ||
      error.propagation.length > 16 ||
      error.propagation.some(
        (p) =>
          !p ||
          !['throws', 'doesNotThrow', 'rejects', 'doesNotReject'].includes(
            p.operator,
          ) ||
          !['threw', 'rejected'].includes(p.outcome) ||
          !['self', 'boundary'].includes(p.source),
      ) ||
      error.propagation.filter((p) => p.source === 'boundary').length !==
        error.links.boundary
    )
      return false;
    for (const edge of ['cause', 'actual', 'aggregate', 'boundary']) {
      const count = error.links[edge];
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        count > 64 ||
        (['cause', 'actual'].includes(edge) && count > 1) ||
        errors.filter((child) => child?.parent === index && child.edge === edge)
          .length !== count
      )
        return false;
    }
    if (
      error.genuineAssertion &&
      exceptionAssertionOperators.has(error.operator)
    ) {
      const absence =
        error.actualRole === 'absence' &&
        error.links.actual === 0 &&
        error.boundary?.actualIdentityVerified === true &&
        error.boundary.operator === error.operator &&
        ((error.operator === 'throws' &&
          error.boundary.outcome === 'returned') ||
          (error.operator === 'rejects' &&
            error.boundary.outcome === 'fulfilled'));
      if (
        !absence &&
        (error.actualRole !== 'cause' || error.links.actual !== 1)
      )
        return false;
      if (
        error.boundary &&
        (error.boundary.actualIdentityVerified !== true ||
          error.boundary.operator !== error.operator ||
          (!absence && !['threw', 'rejected'].includes(error.boundary.outcome)))
      )
        return false;
    } else if (error.genuineAssertion) {
      if (
        error.boundary !== null ||
        !(
          (error.actualRole === 'operand' && error.links.actual === 0) ||
          (error.actualRole === 'cause' && error.links.actual === 1)
        )
      )
        return false;
    } else if (
      error.boundary !== null ||
      error.actualRole !== (error.links.actual === 1 ? 'cause' : null)
    ) {
      return false;
    }
    if (
      index === 0
        ? error.parent !== null || error.edge !== 'root'
        : !Number.isInteger(error.parent) ||
          error.parent < 0 ||
          error.parent >= index ||
          !['cause', 'actual', 'aggregate', 'boundary'].includes(error.edge)
    )
      return false;
    depths[index] = index === 0 ? 0 : depths[error.parent] + 1;
    if (!Number.isInteger(depths[index]) || depths[index] > 16) return false;
    if (error.genuineAssertion === true)
      return (
        error.code === 'ERR_ASSERTION' &&
        error.name === 'AssertionError' &&
        error.constructor === 'AssertionError' &&
        (exceptionAssertionOperators.has(error.operator) ||
          comparisonAssertionOperators.has(error.operator))
      );
    if (
      index === 0 &&
      error.code === 'ERR_TEST_FAILURE' &&
      error.failureType === 'testCodeFailure' &&
      error.name === 'Error' &&
      ['Error', 'TestFailureEnvelope'].includes(error.constructor)
    )
      return errors.some(
        (child) =>
          child.parent === index &&
          child.edge === 'cause' &&
          child.genuineAssertion === true,
      );
    const parent = errors[error.parent];
    return (
      error.code === null &&
      error.name === 'Error' &&
      error.constructor === 'Error' &&
      error.messageTruncated === false &&
      error.edge === 'actual' &&
      parent?.genuineAssertion === true &&
      !errors.some((child) => child.parent === index) &&
      (intended?.allowedDomainErrors ?? []).some(
        (policy) =>
          error.message === policy.message &&
          parent.operator === policy.operator &&
          error.origin?.file === policy.origin.file &&
          error.origin?.function === policy.origin.function,
      )
    );
  });
}

export function faultChildEnvironment() {
  const env = { ...process.env };
  // Each child is a new test runner, even when the caller is a runner unit test.
  delete env.NODE_TEST_CONTEXT;
  env.MIZAN_FAULT_ASSERTION_OUTCOMES = '1';
  return env;
}

export function classifyFault(result, expectedTests = []) {
  const invalid = (reason, failures = []) => ({
    status: 'infrastructure',
    reason,
    killed: false,
    failures,
  });
  if (
    result.error ||
    result.signal !== null ||
    !Number.isInteger(result.status)
  )
    return invalid('process-error-or-interruption');
  if (result.stderr?.trim()) return invalid('unexpected-process-stderr');
  let events;
  try {
    events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (
      events.some(
        (e) =>
          e.schema !== 4 ||
          ![
            'test:pass',
            'test:fail',
            'test:summary',
            'test:stderr',
            'test:stdout',
          ].includes(e.type),
      )
    )
      return invalid('invalid-reporter-event');
  } catch {
    return invalid('invalid-reporter-output');
  }
  const summary = events.filter((e) => e.type === 'test:summary').at(-1);
  const failures = events.filter((e) => e.type === 'test:fail');
  if (
    !summary ||
    !Number.isInteger(summary.counts?.tests) ||
    summary.counts.tests < 1 ||
    !Number.isInteger(summary.counts.failed) ||
    summary.counts.cancelled !== 0 ||
    events.some((e) => e.type === 'test:stderr' && e.message?.trim())
  )
    return invalid('incomplete-test-run', failures);
  if (
    result.status === 0 &&
    summary.success === true &&
    summary.counts.failed === 0 &&
    failures.length === 0
  )
    return {
      status: 'survived',
      reason: 'tests-passed',
      killed: false,
      failures: [],
    };
  if (
    result.status <= 0 ||
    result.status > 255 ||
    summary.success !== false ||
    summary.counts.failed !== failures.length ||
    !failures.length
  )
    return invalid('exit-and-summary-disagree', failures);
  if (
    failures.some(
      (f) =>
        !validFailure(
          f,
          expectedTests.find(
            (t) =>
              f.name === t.name &&
              typeof f.file === 'string' &&
              f.file.replaceAll('\\', '/').endsWith('/' + t.file),
          ),
        ),
    )
  )
    return invalid('non-assertion-or-environment-failure', failures);
  const intended = failures.filter((f) =>
    expectedTests.some(
      (t) =>
        f.name === t.name &&
        typeof f.file === 'string' &&
        f.file.replaceAll('\\', '/').endsWith('/' + t.file),
    ),
  );
  if (!intended.length)
    return {
      status: 'unrelated-assertion',
      reason: 'intended-test-did-not-fail',
      killed: false,
      failures,
    };
  return {
    status: 'killed',
    reason: 'completed-intended-assertion',
    killed: true,
    failures,
    intendedFailures: intended.map(({ name, file, line }) => ({
      name,
      file,
      line,
    })),
  };
}

export async function runSpecializedFaults({
  root,
  out,
  domain,
  tests,
  faults,
  timeoutMs = 60000,
}) {
  root = resolve(root);
  out = resolve(out);
  assert.ok(
    out !== root && !out.startsWith(root + '/'),
    'Fault evidence must be outside the source checkout',
  );
  assert.equal(
    new Set(faults.map((f) => f.name)).size,
    faults.length,
    'Unique fault names',
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(faults.map((f) => f.file))].map(async (file) => [
        file,
        await readFile(join(root, file), 'utf8'),
      ]),
    ),
  );
  const inputPins = Object.fromEntries(
    await Promise.all(
      [...originals.keys(), ...tests].map(async (file) => [
        file,
        hash(await readFile(join(root, file))),
      ]),
    ),
  );
  for (const fault of faults) {
    assert.ok(/^[a-z0-9-]+$/.test(fault.name), 'Canonical fault name');
    assert.equal(
      originals.get(fault.file).split(fault.needle).length,
      2,
      `${fault.name}: exactly one target`,
    );
    assert.ok(
      fault.expectedTests.length > 0 &&
        fault.expectedTests.every((t) => tests.includes(t.file)),
      'Named intended assertions',
    );
    for (const test of fault.expectedTests)
      for (const policy of test.allowedDomainErrors ?? [])
        assert.ok(
          typeof policy.message === 'string' &&
            policy.message.length > 0 &&
            policy.message.length <= 4000 &&
            ['throws', 'doesNotThrow', 'doesNotReject'].includes(
              policy.operator,
            ) &&
            /^lib\/[a-zA-Z0-9/._-]+$/.test(policy.origin?.file) &&
            !policy.origin.file.split('/').includes('..') &&
            typeof policy.origin.function === 'string' &&
            policy.origin.function.length > 0,
          'Exact domain error identity and throwing origin',
        );
  }
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'catalogue.json'),
    JSON.stringify({ domain, inputPins, faults }, null, 2) + '\n',
    { flag: 'wx' },
  );
  const scratch = await createPrivateTree();
  const report = {
    domain,
    baseline: null,
    runs: 0,
    uniqueFaults: faults.length,
    killed: 0,
    results: [],
    restored: null,
    sourceUntouched: false,
    privateWorkspace: scratch,
    evidencePolicy:
      'Originals and tests are copied; mutants execute only in a disposable tree.',
  };
  const persist = () =>
    writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const run = (expectedTests = []) =>
    spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        // A fresh disposable child still isolates every mutant. Keep test
        // events in that process: Node IPC serialization loses nested Error
        // codes inside assertion.actual and could misclassify ENOENT as a kill.
        '--experimental-test-isolation=none',
        '--test-concurrency=1',
        '--import=' + join(scratch, 'scripts/fault-reporter.mjs'),
        '--test-reporter=' + join(scratch, 'scripts/fault-reporter.mjs'),
        ...(expectedTests.length
          ? [
              '--test-name-pattern=^(?:' +
                expectedTests
                  .map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  .join('|') +
                ')$',
            ]
          : []),
        ...tests,
      ],
      {
        cwd: scratch,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: faultChildEnvironment(),
      },
    );
  const save = async (name, result, expectedTests = []) => {
    const folder = join(out, name);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'events.jsonl'), result.stdout ?? '');
    await writeFile(join(folder, 'stderr.log'), result.stderr ?? '');
    const classification = classifyFault(result, expectedTests);
    return {
      exit: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      ...classification,
    };
  };
  try {
    for (const folder of ['lib', 'tests', 'audit', 'scripts'])
      await cp(join(root, folder), join(scratch, folder), { recursive: true });
    await cp(join(root, 'package.json'), join(scratch, 'package.json'));
    await symlink(
      await realpath(join(root, 'node_modules')),
      join(scratch, 'node_modules'),
      'dir',
    );
    await persist();
    report.baseline = await save('baseline', run());
    await persist();
    assert.equal(
      report.baseline.status,
      'survived',
      'Baseline must complete successfully',
    );
    for (const fault of faults) {
      await rm(join(scratch, 'work'), { recursive: true, force: true });
      const source = originals.get(fault.file),
        mutant = source.replace(fault.needle, fault.replacement);
      const target = join(scratch, fault.file);
      assert.ok(
        relative(scratch, target).startsWith('lib/'),
        'Only a private engine/IO target is mutable',
      );
      const folder = join(out, fault.name);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'original.txt'), source);
      await writeFile(join(folder, 'mutant.txt'), mutant);
      await writeFile(target, mutant);
      let result;
      try {
        result = run(fault.expectedTests);
      } finally {
        await writeFile(target, source);
      }
      const actual = await save(fault.name, result, fault.expectedTests);
      report.results.push({
        name: fault.name,
        file: fault.file,
        sourceSha256: hash(source),
        mutantSha256: hash(mutant),
        expectedTests: fault.expectedTests,
        ...actual,
      });
      report.runs = report.results.length;
      report.killed = report.results.filter((r) => r.killed).length;
      await persist();
      console.log(
        JSON.stringify({
          domain,
          name: fault.name,
          status: actual.status,
          killed: actual.killed,
        }),
      );
    }
    report.restored = await save('restored', run());
    for (const [file, sha256] of Object.entries(inputPins))
      assert.equal(
        hash(await readFile(join(root, file))),
        sha256,
        `Source checkout changed: ${file}`,
      );
    for (const [file, source] of originals)
      assert.equal(
        await readFile(join(scratch, file), 'utf8'),
        source,
        'Private source restored',
      );
    report.sourceUntouched = true;
    await persist();
  } finally {
    await removePrivateTree(scratch);
  }
  assert.equal(
    report.restored?.status,
    'survived',
    'Restored tests must complete',
  );
  assert.equal(
    report.killed,
    faults.length,
    'Every fault must fail its intended assertion; infrastructure failures are not kills',
  );
  return report;
}
