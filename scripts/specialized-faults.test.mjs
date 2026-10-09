import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { errorEvidence } from './fault-reporter.mjs';
import {
  classifyFault,
  faultChildEnvironment,
  runSpecializedFaults,
} from './specialized-faults.mjs';
import {
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const reporter = fileURLToPath(new URL('fault-reporter.mjs', import.meta.url));
const expected = [
  {
    file: 'tests/financial.test.mjs',
    name: 'posted amount remains exactly100',
  },
];
const testCode =
  "import test from 'node:test'; import assert from 'node:assert/strict'; import {amount} from '../lib/engine.mjs'; test('posted amount remains exactly100',()=>assert.equal(amount,100));";
async function fixture(code = testCode, amount = 100) {
  const root = await createPrivateTree();
  for (const folder of ['lib', 'tests', 'audit', 'scripts'])
    await mkdir(join(root, folder));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(root, 'lib/engine.mjs'),
    `export const amount = ${amount};\n`,
  );
  await writeFile(join(root, 'tests/financial.test.mjs'), code);
  await cp(reporter, join(root, 'scripts/fault-reporter.mjs'));
  await symlink(
    resolve(fileURLToPath(new URL('../node_modules', import.meta.url))),
    join(root, 'node_modules'),
    'dir',
  );
  return root;
}
const invoke = (root, timeout = 1000) =>
  spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-isolation=none',
      '--test-concurrency=1',
      '--import=' + reporter,
      '--test-reporter=' + reporter,
      'tests/financial.test.mjs',
    ],
    { cwd: root, encoding: 'utf8', timeout, env: faultChildEnvironment() },
  );
const fault = {
  name: 'wrong-posted-amount',
  file: 'lib/engine.mjs',
  needle: 'amount = 100',
  replacement: 'amount = 99',
  expectedTests: expected,
};

void test('specialized faults require a completed assertion in the named financial test', async () => {
  const root = await fixture(),
    out = await createPrivateTree();
  try {
    assert.equal(classifyFault(invoke(root), expected).status, 'survived');
    const report = await runSpecializedFaults({
      root,
      out,
      domain: 'isolated-test',
      tests: expected.map((t) => t.file),
      faults: [fault],
    });
    assert.equal(report.killed, 1);
    assert.equal(report.results[0].status, 'killed');
    assert.equal(report.results[0].intendedFailures[0].name, expected[0].name);
    assert.equal(report.sourceUntouched, true);
    assert.equal(
      await readFile(join(root, fault.file), 'utf8'),
      'export const amount = 100;\n',
    );
    assert.equal(
      classifyFault({ ...invoke(root), stdout: 'ERR_ASSERTION' }, expected)
        .status,
      'infrastructure',
    );
  } finally {
    await removePrivateTree(root);
    await removePrivateTree(out);
  }
});

void test('environment errors, module loading, syntax and unrelated assertions never count as a financial kill', async () => {
  const cases = [
    "throw Object.assign(new Error('fixture unavailable'),{code:'ENOENT'})",
    "throw new TypeError('environment failure')",
    'assert.equal(1,2)',
  ];
  for (const body of cases) {
    const root = await fixture(
      `import test from 'node:test';import assert from 'node:assert/strict';test('unrelated harness',()=>{${body}});`,
    );
    try {
      const result = classifyFault(invoke(root), expected);
      assert.equal(result.killed, false);
      assert.equal(
        result.status,
        body.startsWith('assert.') ? 'unrelated-assertion' : 'infrastructure',
      );
    } finally {
      await removePrivateTree(root);
    }
  }
  for (const code of ["import './missing.mjs';", 'export const = ;']) {
    const root = await fixture(code);
    try {
      assert.equal(
        classifyFault(invoke(root), expected).status,
        'infrastructure',
      );
    } finally {
      await removePrivateTree(root);
    }
  }
  const mixed = await fixture(
    testCode + "test('broken setup',()=>{throw new TypeError('harness')});",
    99,
  );
  try {
    assert.equal(
      classifyFault(invoke(mixed), expected).status,
      'infrastructure',
    );
  } finally {
    await removePrivateTree(mixed);
  }
});

void test('wrapped IO environment errors retain their original codes and cannot count as intended assertion kills', async () => {
  for (const code of [
    'ENOENT',
    'EIO',
    'ERR_ACCESS_DENIED',
    'UNKNOWN_ENVIRONMENT_CODE',
    'ERR_MODULE_NOT_FOUND',
    'ETIMEDOUT',
    'TYPE_ERROR',
  ]) {
    const thrown =
      code === 'TYPE_ERROR'
        ? "new TypeError('synthetic environment failure')"
        : `Object.assign(new Error('synthetic environment failure'),{code:${JSON.stringify(code)}})`;
    const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{if(amount===99)await assert.doesNotReject(async()=>{throw ${thrown};});else assert.equal(amount,100);});`,
      ),
      out = await createPrivateTree();
    try {
      await assert.rejects(
        runSpecializedFaults({
          root,
          out,
          domain: 'wrapped-environment',
          tests: expected.map((t) => t.file),
          faults: [fault],
        }),
        /infrastructure failures are not kills/,
      );
      const report = JSON.parse(
        await readFile(join(out, 'report.json'), 'utf8'),
      );
      assert.equal(report.baseline.status, 'survived');
      assert.equal(report.restored.status, 'survived');
      assert.equal(report.sourceUntouched, true);
      const classified = report.results[0];
      assert.equal(classified.status, 'infrastructure', code);
      assert.equal(classified.killed, false, code);
      assert.ok(
        classified.failures.some((f) =>
          f.errors.some((e) =>
            code === 'TYPE_ERROR' ? e.name === 'TypeError' : e.code === code,
          ),
        ),
        'Underlying environment identity must survive reporter delivery',
      );
    } finally {
      await removePrivateTree(root);
      await removePrivateTree(out);
    }
  }
});

void test('uncoded wrapped timeout, loading and unknown runtime errors cannot earn mutation kills', async () => {
  for (const thrown of [
    "'Operation timed out'",
    "({message:'Failed to load source fixture',name:'Error'})",
    'null',
    'undefined',
    '42',
    'false',
    '1n',
    "Symbol('unknown rejection')",
    'Object.create(null)',
    "new Error('outer',{cause:undefined})",
    "new Error('outer',{cause:null})",
    "new Error('outer',{cause:'hidden timeout'})",
    "new Error('outer',{cause:{message:'hidden load failure'}})",
    "new Error('Operation timed out')",
    "new Error('Failed to load source fixture')",
    "Object.assign(new Error('Operation timed out'),{name:'TimeoutError'})",
    "new Error('unknown dependency failure')",
    "Object.assign(new Error('forged assertion'),{code:'ERR_ASSERTION',name:'AssertionError'})",
    "new AggregateError([new Error('hidden load failure')],'aggregate')",
    "new Error('outer',{cause:new Error('hidden timeout')})",
  ]) {
    const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{await assert.doesNotReject(async()=>{if(amount===99)throw ${thrown};});assert.equal(amount,100);});`,
      ),
      out = await createPrivateTree();
    try {
      await assert.rejects(
        runSpecializedFaults({
          root,
          out,
          domain: 'uncoded-runtime',
          tests: expected.map((t) => t.file),
          faults: [fault],
        }),
        /infrastructure failures are not kills/,
      );
      const report = JSON.parse(
        await readFile(join(out, 'report.json'), 'utf8'),
      );
      assert.equal(report.baseline.status, 'survived');
      assert.equal(report.restored.status, 'survived');
      assert.equal(report.results[0].killed, false);
      assert.equal(report.results[0].status, 'infrastructure');
      assert.equal(report.sourceUntouched, true);
    } finally {
      await removePrivateTree(root);
      await removePrivateTree(out);
    }
  }
});

void test('genuine financial assertions survive nesting and diagnostic timeout or loading words', async () => {
  for (const body of [
    "assert.equal(amount,100,'timeout/load diagnostic does not change financial assertion');",
    'await assert.doesNotReject(async()=>assert.equal(amount,100));',
    'assert.deepStrictEqual({posted:amount},{posted:100});',
    'await assert.doesNotReject(async()=>assert.doesNotThrow(()=>assert.deepStrictEqual({posted:amount},{posted:100})));',
  ]) {
    const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{${body}});`,
      ),
      out = await createPrivateTree();
    try {
      const report = await runSpecializedFaults({
        root,
        out,
        domain: 'financial-positive',
        tests: expected.map((t) => t.file),
        faults: [fault],
      });
      assert.equal(report.killed, 1);
    } finally {
      await removePrivateTree(root);
      await removePrivateTree(out);
    }
  }
});

void test('non-Error causes remain conservative across every exception assertion boundary', async () => {
  const values = ["'unavailable'", '{}', 'null', 'undefined'];
  const boundaries = [
    (v) => `await assert.doesNotReject(async()=>{throw ${v}});`,
    (v) => `assert.doesNotThrow(()=>{throw ${v}});`,
    (v) => `await assert.rejects(async()=>{throw ${v}},/expected domain/);`,
    (v) => `assert.throws(()=>{throw ${v}},/expected domain/);`,
    (v) =>
      `await assert.doesNotReject(async()=>assert.doesNotThrow(()=>{throw ${v}}));`,
  ];
  for (const value of values)
    for (const boundary of boundaries) {
      const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{if(amount===99){${boundary(value)}}assert.equal(amount,100);});`,
        99,
      );
      try {
        assert.equal(
          classifyFault(invoke(root), expected).status,
          'infrastructure',
          value,
        );
      } finally {
        await removePrivateTree(root);
      }
    }
});

void test('observed absence kills validation faults while undefined throw or rejection never earns a kill', async () => {
  for (const asynchronous of [false, true]) {
    for (const mode of ['absent', 'undefined', 'object', 'string']) {
      const body =
        mode === 'absent'
          ? ''
          : `throw ${mode === 'undefined' ? 'undefined' : mode === 'object' ? "({message:'DOMAIN'})" : "'DOMAIN'"};`;
      const callback = `${asynchronous ? 'async' : ''}()=>{if(amount===100)throw new Error('KNOWN_DOMAIN');${body}}`;
      const call = `${asynchronous ? 'await assert.rejects' : 'assert.throws'}(${callback},/KNOWN_DOMAIN/,'one identical custom diagnostic');`;
      const root = await fixture(
          `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{${call}});`,
        ),
        out = await createPrivateTree();
      try {
        const run = runSpecializedFaults({
          root,
          out,
          domain: 'boundary-outcome',
          tests: expected.map((t) => t.file),
          faults: [fault],
        });
        if (mode === 'absent') await run;
        else await assert.rejects(run, /infrastructure failures are not kills/);
        const report = JSON.parse(
          await readFile(join(out, 'report.json'), 'utf8'),
        );
        assert.equal(report.baseline.status, 'survived');
        assert.equal(report.restored.status, 'survived');
        assert.equal(report.sourceUntouched, true);
        const failure = report.results[0].failures[0];
        assert.equal(
          report.results[0].status,
          mode === 'absent' ? 'killed' : 'infrastructure',
        );
        if (mode === 'absent') {
          const node = failure.errors.find((e) => e.genuineAssertion);
          assert.equal(node.actualRole, 'absence');
          assert.equal(
            node.boundary.outcome,
            asynchronous ? 'fulfilled' : 'returned',
          );
          assert.equal(node.boundary.actualIdentityVerified, true);
        }
      } finally {
        await removePrivateTree(root);
        await removePrivateTree(out);
      }
    }
  }
});

void test('boundary observation retains call counts, named imports, nested assertions and original error identity', async () => {
  const codes = [
    `let calls=0;assert.throws(()=>{calls++;if(amount===100)throw new Error('DOMAIN')},/DOMAIN/);assert.equal(calls,1);`,
    `let calls=0;await assert.rejects(async()=>{calls++;if(amount===100)throw new Error('DOMAIN')},/DOMAIN/);assert.equal(calls,1);`,
    `const {throws}=await import('node:assert');throws(()=>{if(amount===100)throw new Error('DOMAIN')},/DOMAIN/);`,
    `const {rejects}=await import('node:assert/strict');await rejects(async()=>{if(amount===100)throw new Error('DOMAIN')},/DOMAIN/);`,
    `await assert.doesNotReject(async()=>assert.throws(()=>{if(amount===100)throw new Error('DOMAIN')},/DOMAIN/));`,
    `const promise=amount===100?Promise.reject(new Error('DOMAIN')):Promise.resolve();await assert.rejects(promise,/DOMAIN/);`,
  ];
  for (const code of codes) {
    const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{${code}});`,
      ),
      out = await createPrivateTree();
    try {
      const report = await runSpecializedFaults({
        root,
        out,
        domain: 'boundary-preservation',
        tests: expected.map((t) => t.file),
        faults: [fault],
      });
      assert.equal(report.killed, 1);
    } finally {
      await removePrivateTree(root);
      await removePrivateTree(out);
    }
  }
  const root = await fixture(
    `import test from 'node:test';import assert from 'node:assert/strict';test(${JSON.stringify(expected[0].name)},async()=>{let calls=0;const reason=new Error('owned');try{assert.doesNotThrow(()=>{calls++;throw reason})}catch(e){assert.equal(e.actual,reason)}assert.equal(calls,1);calls=0;try{await assert.doesNotReject(async()=>{calls++;throw reason})}catch(e){assert.equal(e.actual,reason)}assert.equal(calls,1);});`,
  );
  try {
    assert.equal(classifyFault(invoke(root), expected).status, 'survived');
  } finally {
    await removePrivateTree(root);
  }
});

void test('unobserved absence, custom promise hooks and unawaited failures stay conservative', async () => {
  const codes = [
    `await assert.rejects(async()=>{});`,
    `await assert.rejects(Object.assign(Promise.resolve(),{then:Promise.prototype.then}));`,
    `await assert.rejects(new (class CustomPromise extends Promise {})((resolve)=>resolve()));`,
    `await assert.rejects((await import('node:vm')).runInNewContext('Promise.resolve()'));`,
    `assert.throws(new Proxy(()=>{},{}));`,
    `assert.rejects(async()=>{});await new Promise(resolve=>setTimeout(resolve,20));`,
    `setTimeout(()=>assert.equal(99,100),0);await new Promise(resolve=>setTimeout(resolve,20));`,
    `await assert.doesNotReject(async()=>{throw undefined},'same diagnostic');`,
  ];
  for (const [index, code] of codes.entries()) {
    const root = await fixture(
      `import test from 'node:test';import assert from 'node:assert/strict';test(${JSON.stringify(expected[0].name)},async()=>{${code}});`,
    );
    try {
      let result = invoke(root);
      if (index === 0)
        result = spawnSync(
          process.execPath,
          [
            '--test',
            '--experimental-test-isolation=none',
            '--test-reporter=' + reporter,
            'tests/financial.test.mjs',
          ],
          {
            cwd: root,
            encoding: 'utf8',
            timeout: 1000,
            env: {
              ...faultChildEnvironment(),
              MIZAN_FAULT_ASSERTION_OUTCOMES: '0',
            },
          },
        );
      assert.equal(
        classifyFault(result, expected).status,
        'infrastructure',
        code,
      );
    } finally {
      await removePrivateTree(root);
    }
  }
});

void test('validator assertions cannot hide an unknown rejection from a different boundary operator', async () => {
  for (const value of [
    'undefined',
    'null',
    "'timeout'",
    '{}',
    "new Error('unknown loader')",
  ]) {
    const code = `await assert.rejects(async()=>{throw ${value}},()=>{assert.throws(()=>{},/required/);});`;
    const root = await fixture(
      `import test from 'node:test';import assert from 'node:assert/strict';test(${JSON.stringify(expected[0].name)},async()=>{${code}});`,
    );
    try {
      const result = classifyFault(invoke(root), expected);
      assert.equal(result.status, 'infrastructure');
      assert.ok(
        result.failures.some((f) =>
          f.errors.some((e) => e.edge === 'boundary'),
        ),
      );
    } finally {
      await removePrivateTree(root);
    }
  }
});

void test('error evidence bounds unknown values, cycles, depth and fanout without executing object hooks', () => {
  const assertion = (actual, operator = 'doesNotReject') =>
    new assert.AssertionError({
      actual,
      expected: undefined,
      operator,
      message: 'contract',
    });
  for (const value of [
    {},
    'timeout',
    null,
    undefined,
    false,
    42,
    1n,
    Symbol('x'),
    () => {},
  ]) {
    const evidence = errorEvidence(assertion(value));
    assert.equal(evidence.errorGraphComplete, false);
    assert.equal(evidence.errors[1].kind, 'non-error');
    assert.equal(evidence.errors[1].edge, 'actual');
    assert.doesNotThrow(() => JSON.stringify(evidence));
  }
  let calls = 0;
  const unknown = {
    get message() {
      calls++;
      throw Error('getter');
    },
    toJSON() {
      calls++;
      throw Error('serialization');
    },
  };
  unknown.cause = unknown;
  const proxy = new Proxy(
    {},
    {
      get() {
        calls++;
        throw Error('trap');
      },
      getOwnPropertyDescriptor() {
        calls++;
        throw Error('trap');
      },
    },
  );
  for (const value of [
    unknown,
    proxy,
    runInNewContext("new Error('cross realm')"),
    Object.create(assert.AssertionError.prototype),
  ]) {
    const evidence = errorEvidence(assertion(value));
    assert.equal(evidence.errorGraphComplete, false);
    // A cross-realm native error can be represented, but is never authorized
    // by the same-realm domain identity contract.
    assert.equal(evidence.errors[1]?.genuineAssertion === true, false);
    assert.doesNotThrow(() => JSON.stringify(evidence));
  }
  assert.equal(calls, 0);
  const cycle = assertion(undefined, 'strictEqual');
  cycle.cause = cycle;
  assert.equal(errorEvidence(cycle).errorGraphComplete, false);
  let depth = assertion(99, 'strictEqual');
  for (let i = 0; i < 16; i++) {
    const wrapper = assertion(depth);
    depth = wrapper;
  }
  assert.equal(errorEvidence(depth).errorGraphComplete, true);
  depth = assertion(depth);
  assert.equal(errorEvidence(depth).errorGraphComplete, false);
  const leaves = Array.from({ length: 63 }, () => assertion(99, 'strictEqual'));
  assert.equal(errorEvidence(new AggregateError(leaves)).errors.length, 64);
  assert.equal(
    errorEvidence(new AggregateError(leaves)).errorGraphComplete,
    true,
  );
  assert.equal(
    errorEvidence(new AggregateError([...leaves, leaves[0]]))
      .errorGraphComplete,
    false,
  );
  assert.equal(
    errorEvidence(new AggregateError([undefined])).errorGraphComplete,
    false,
  );
  const accessor = assertion(99, 'strictEqual');
  Object.defineProperty(accessor, 'cause', {
    get() {
      calls++;
      return undefined;
    },
  });
  assert.equal(errorEvidence(accessor).errorGraphComplete, false);
  const stackAccessor = assertion(99, 'strictEqual');
  Object.defineProperty(stackAccessor, 'stack', {
    get() {
      calls++;
      return 'forged';
    },
  });
  assert.equal(errorEvidence(stackAccessor).errorGraphComplete, false);
  assert.equal(calls, 0);
  const omitted = assertion(99);
  delete omitted.actual;
  assert.equal(errorEvidence(omitted).errorGraphComplete, false);
  const forged = assertion(undefined, 'throws');
  forged.boundary = {
    operator: 'throws',
    outcome: 'returned',
    actualIdentityVerified: true,
  };
  assert.equal(errorEvidence(forged).errorGraphComplete, false);
  assert.equal(
    errorEvidence(assertion('x'.repeat(5000))).errors[1].preview.length,
    4000,
  );
});

void test('classifier rejects missing graph edges and false completeness without losing financial positives', () => {
  const actual = new assert.AssertionError({
    actual: 99,
    expected: 100,
    operator: 'strictEqual',
  });
  const failure = {
    schema: 4,
    type: 'test:fail',
    name: expected[0].name,
    file: '/scratch/' + expected[0].file,
    ...errorEvidence(actual),
    assertion: true,
  };
  const result = (event) => ({
    status: 1,
    signal: null,
    stderr: '',
    stdout: [
      event,
      {
        schema: 4,
        type: 'test:summary',
        success: false,
        counts: { tests: 1, failed: 1, cancelled: 0 },
      },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  });
  assert.equal(classifyFault(result(failure), expected).status, 'killed');
  const wrapped = new assert.AssertionError({
    actual: undefined,
    expected: undefined,
    operator: 'doesNotReject',
    message: 'contract',
  });
  const incomplete = {
    ...failure,
    ...errorEvidence(wrapped),
    errorGraphComplete: true,
  };
  assert.equal(
    classifyFault(result(incomplete), expected).status,
    'infrastructure',
  );
  const invalidRole = structuredClone(failure);
  invalidRole.errors[0].actualRole = 'absence';
  assert.equal(
    classifyFault(result(invalidRole), expected).status,
    'infrastructure',
  );
  incomplete.errors = incomplete.errors.slice(0, 1);
  assert.equal(
    classifyFault(result(incomplete), expected).status,
    'infrastructure',
  );
  incomplete.errors[0].links.actual = 0;
  assert.equal(
    classifyFault(result(incomplete), expected).status,
    'infrastructure',
  );
  assert.equal(
    classifyFault(result({ ...failure, errors: [null] }), expected).status,
    'infrastructure',
  );
  const crossRealm = {
    ...failure,
    ...errorEvidence(
      new assert.AssertionError({
        actual: runInNewContext("new Error('unknown')"),
        operator: 'doesNotReject',
      }),
    ),
  };
  assert.equal(
    classifyFault(result(crossRealm), expected).status,
    'infrastructure',
  );
  const ambiguous = new Error('wrapper');
  Object.assign(ambiguous, {
    code: 'ERR_TEST_FAILURE',
    cause: actual,
    actual: { message: 'unknown reason' },
  });
  const ambiguousFailure = { ...failure, ...errorEvidence(ambiguous) };
  assert.equal(
    classifyFault(result(ambiguousFailure), expected).status,
    'infrastructure',
  );
  const unsupported = new assert.AssertionError({
    actual: {},
    operator: 'unknown operator',
  });
  assert.equal(errorEvidence(unsupported).errorGraphComplete, false);
});

void test('a declared domain exception requires exact origin, assertion boundary and complete leaf identity', async () => {
  const policy = {
    message: 'DOMAIN_SNAPSHOT',
    operator: 'doesNotReject',
    origin: { file: 'lib/engine.mjs', function: 'snapshot' },
  };
  /** @type {Array<[string, string, string, typeof policy, boolean]>} */
  const cases = [
    [
      'declared',
      "throw new Error('DOMAIN_SNAPSHOT')",
      'await assert.doesNotReject(async()=>snapshot());',
      policy,
      true,
    ],
    [
      'wrong-origin',
      '',
      "await assert.doesNotReject(async()=>{if(amount===99)throw new Error('DOMAIN_SNAPSHOT')});",
      policy,
      false,
    ],
    [
      'wrong-operator',
      "throw new Error('DOMAIN_SNAPSHOT')",
      'await assert.doesNotReject(async()=>snapshot());',
      { ...policy, operator: 'throws' },
      false,
    ],
    [
      'wrong-message',
      "throw new Error('DOMAIN_SNAPSHOT extra')",
      'await assert.doesNotReject(async()=>snapshot());',
      policy,
      false,
    ],
    [
      'nested-cause',
      "throw new Error('DOMAIN_SNAPSHOT',{cause:new Error('hidden runtime error')})",
      'await assert.doesNotReject(async()=>snapshot());',
      policy,
      false,
    ],
    [
      'cycle',
      "const e=new Error('DOMAIN_SNAPSHOT');e.cause=e;throw e",
      'await assert.doesNotReject(async()=>snapshot());',
      policy,
      false,
    ],
    [
      'depth-limit',
      "let e=new Error('DOMAIN_SNAPSHOT');for(let i=0;i<20;i++)e=new Error('DOMAIN_SNAPSHOT',{cause:e});throw e",
      'await assert.doesNotReject(async()=>snapshot());',
      policy,
      false,
    ],
  ];
  for (const [name, throwing, testBody, changedPolicy, accepts] of cases) {
    const root = await fixture(
        `import test from 'node:test';import assert from 'node:assert/strict';import {amount,snapshot} from '../lib/engine.mjs';test(${JSON.stringify(expected[0].name)},async()=>{${testBody}assert.equal(amount,100);});`,
      ),
      out = await createPrivateTree();
    try {
      await writeFile(
        join(root, 'lib/engine.mjs'),
        `export const amount = 100;export function snapshot(){if(amount===99){${throwing}}return amount;}`,
      );
      const declared = {
        ...fault,
        expectedTests: expected.map((t) => ({
          ...t,
          allowedDomainErrors: [changedPolicy],
        })),
      };
      const run = runSpecializedFaults({
        root,
        out,
        domain: name,
        tests: expected.map((t) => t.file),
        faults: [declared],
      });
      if (accepts) assert.equal((await run).killed, 1);
      else {
        await assert.rejects(run, /infrastructure failures are not kills/);
        const report = JSON.parse(
          await readFile(join(out, 'report.json'), 'utf8'),
        );
        assert.equal(report.results[0].status, 'infrastructure', name);
        if (name === 'cycle' || name === 'depth-limit')
          assert.equal(report.results[0].failures[0].errorGraphComplete, false);
      }
    } finally {
      await removePrivateTree(root);
      await removePrivateTree(out);
    }
  }
});

void test('a timeout after a financial assertion and a failed baseline stop the specialized gate', async () => {
  const root = await fixture(testCode + 'setInterval(()=>{},1000);', 99),
    out = await createPrivateTree();
  try {
    const result = invoke(root, 1000);
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.match(result.stdout, /ERR_ASSERTION/);
    assert.equal(classifyFault(result, expected).status, 'infrastructure');
    await writeFile(join(root, 'tests/financial.test.mjs'), testCode);
    await assert.rejects(
      runSpecializedFaults({
        root,
        out,
        domain: 'failed-baseline',
        tests: expected.map((t) => t.file),
        faults: [
          { ...fault, needle: 'amount = 99', replacement: 'amount = 98' },
        ],
      }),
      /Baseline must complete/,
    );
    const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
    assert.equal(report.runs, 0);
    assert.equal(report.killed, 0);
    assert.equal(
      await readFile(join(root, fault.file), 'utf8'),
      'export const amount = 99;\n',
    );
  } finally {
    await removePrivateTree(root);
    await removePrivateTree(out);
  }
});

void test('killing the runner while its private mutant is active cannot alter the source checkout', async () => {
  const root = await fixture(testCode),
    out = await createPrivateTree();
  const marker = join(out, 'mutant-active');
  const code = testCode.replace(
    '()=>assert.equal(amount,100)',
    "async()=>{if(amount!==100){const {writeFile}=await import('node:fs/promises');await writeFile(process.env.FAULT_TEST_MARKER,'active');await new Promise(()=>{});}assert.equal(amount,100);}",
  );
  // A pending promise alone exits Node; a timer keeps the intentional test alive.
  await writeFile(
    join(root, 'tests/financial.test.mjs'),
    code + 'if(amount!==100)setInterval(()=>{},1000);',
  );
  const modulePath = new URL('specialized-faults.mjs', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {runSpecializedFaults} from ${JSON.stringify(modulePath)};await runSpecializedFaults(${JSON.stringify({ root, out, domain: 'interrupted-runner', tests: expected.map((t) => t.file), faults: [fault] })});`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...faultChildEnvironment(), FAULT_TEST_MARKER: marker },
    },
  );
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  const childPid = child.pid;
  assert.ok(childPid);
  let scratch;
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await readFile(marker);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      assert.ok(Date.now() < deadline, 'Private mutant must actually start');
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    scratch = JSON.parse(
      await readFile(join(out, 'report.json'), 'utf8'),
    ).privateWorkspace;
    assert.equal(
      await readFile(join(scratch, fault.file), 'utf8'),
      'export const amount = 99;\n',
    );
    process.kill(-childPid, 'SIGKILL');
    await exited;
    assert.equal(
      await readFile(join(root, fault.file), 'utf8'),
      'export const amount = 100;\n',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-childPid, 'SIGKILL');
      await exited;
    }
    // This path was created by this child and obtained before it was killed.
    if (scratch) {
      assert.equal(
        resolve(scratch).startsWith(resolve(tmpdir()) + '/mizan-mutant-'),
        true,
      );
      await rm(scratch, { recursive: true, force: true });
    }
    await removePrivateTree(root);
    await removePrivateTree(out);
  }
});
