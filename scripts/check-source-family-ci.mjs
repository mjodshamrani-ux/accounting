// Offline structure/syntax check. It never executes a workflow run block.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const load = (name) => yaml.load(readFileSync(path.join(root, name), 'utf8'));
assert.equal(
  createHash('sha256')
    .update(
      readFileSync(
        path.join(root, 'audit/source-families-integration/pages-0443.yml'),
      ),
    )
    .digest('hex'),
  '5160955c7de1384fc9fcead63c355ce84cc2bfd397ed7560d8db423bcb2c4936',
  'Frozen0.4.43 workflow changed',
);
const baseline = load('audit/source-families-integration/pages-0443.yml');
const legacyPath = 'audit/source-families-integration/pages-0442.yml';
assert.equal(
  createHash('sha256')
    .update(readFileSync(path.join(root, legacyPath)))
    .digest('hex'),
  'ec3e89f24aeafb36e8c5c39047a39f2b5a82cd7519075f0258e72ce053e3b638',
  'Frozen0.4.42 workflow changed',
);
const legacy = load(legacyPath);
for (const key of ['on', 'permissions', 'concurrency'])
  assert.deepEqual(baseline[key], legacy[key]);
for (const name of ['deploy', 'mutations', 'specialized-faults'])
  assert.deepEqual(baseline.jobs[name], legacy.jobs[name]);
let legacyCursor = 0;
for (const old of legacy.jobs.build.steps) {
  const index = baseline.jobs.build.steps.findIndex(
    (step, at) =>
      at >= legacyCursor && JSON.stringify(step) === JSON.stringify(old),
  );
  assert(
    index >= legacyCursor,
    `Published hotfix dropped legacy gate: ${old.name ?? old.run}`,
  );
  legacyCursor = index + 1;
}
const workflow = load('.github/workflows/pages.yml');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
assert.deepEqual(workflow.on, baseline.on);
assert.deepEqual(workflow.permissions, baseline.permissions);
assert.deepEqual(workflow.concurrency, baseline.concurrency);
assert.deepEqual(workflow.jobs.build.if, baseline.jobs.build.if);
assert.notEqual(workflow.jobs.build['continue-on-error'], true);
for (const name of ['deploy', 'specialized-faults'])
  assert.deepEqual(workflow.jobs[name], baseline.jobs[name]);
// The mutation gate may be split into more shards than the frozen 0.4.43
// job as its catalogue grows, never fewer: shards 1..N, each named and run
// as i/N (the runner takes every Nth fault, so each still runs once).
// Read back to the frozen shard count, nothing else in the job may differ.
{
  const job = structuredClone(workflow.jobs.mutations);
  const frozen = baseline.jobs.mutations;
  const shards = job.strategy.matrix.shard;
  const count = shards.length;
  assert.ok(
    count >= frozen.strategy.matrix.shard.length,
    'The mutation gate may only be split into more shards',
  );
  assert.deepEqual(
    shards,
    Array.from({ length: count }, (_, i) => i + 1),
  );
  const step = job.steps.find((s) => s.run === 'pnpm test:mutations');
  const frozenStep = frozen.steps.find((s) => s.run === 'pnpm test:mutations');
  assert.equal(job.name, `Accounting mutation gate (\${{ matrix.shard }}/${count})`);
  assert.equal(step.env.MUTATION_SHARD, `\${{ matrix.shard }}/${count}`);
  job.name = frozen.name;
  job.strategy.matrix.shard = frozen.strategy.matrix.shard;
  step.env.MUTATION_SHARD = frozenStep.env.MUTATION_SHARD;
  assert.deepEqual(job, frozen);
}
let cursor = 0;
for (const old of baseline.jobs.build.steps) {
  const i = workflow.jobs.build.steps.findIndex(
    (s, index) => index >= cursor && JSON.stringify(s) === JSON.stringify(old),
  );
  assert(
    i >= cursor,
    `Existing CI step removed/changed: ${old.name ?? old.run}`,
  );
  cursor = i + 1;
}
let shells = 0;
const refs = new Set();
for (const job of Object.values(workflow.jobs))
  for (const step of job.steps ?? []) {
    assert.notEqual(step['continue-on-error'], true);
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    if (!step.run) continue;
    const syntax = spawnSync('/bin/bash', ['-n'], {
      input: step.run.replace(/\$\{\{[^}]*\}\}/g, '/tmp/ci-expression'),
      encoding: 'utf8',
    });
    assert.equal(syntax.status, 0, syntax.stderr);
    shells++;
    for (const m of step.run.matchAll(
      /\bpnpm\s+(test(?::[\w-]+)*|lint|typecheck|build)\b/g,
    )) {
      assert.equal(typeof pkg.scripts[m[1]], 'string', m[1]);
      refs.add(m[1]);
    }
    for (const m of step.run.matchAll(
      /(?:scripts|audit)\/[\w./-]+\.(?:mjs|py)/g,
    ))
      assert(existsSync(path.join(root, m[0])), m[0]);
  }
const required = [
  'test:inventory-pdf:workspace',
  'test:inventory-pdf:workspace-proof',
  'test:inventory-pdf:workspace-mutations',
  'test:inventory-pdf:workspace-browser',
  'test:inventory-pdf:workbook',
  'test:inventory-pdf:workbook-proof',
  'test:inventory-pdf:workbook-mutations',
  'test:inventory-pdf:workbook-browser',
  'test:inventory-pdf:worker-browser',
  'test:inventory-pdf:lifecycle',
  'test:inventory-pdf:lifecycle-proof',
  'test:inventory-pdf:lifecycle-mutations',
  'test:inventory-pdf:oracle',
  'test:inventory-pdf:baseline',
  'test:bank-statement:oracle',
  'test:bank-statement:oracle-mutants',
  'test:bank-statement:holdout-seal',
  'test:supplier-statement:s3-seal',
  'test:ar-statement:oracle',
  'test:ar-statement:oracle-mutants',
  'test:ar-statement:seal',
  'test:ar-statement:a5-seal',
  'test:bank-roll:oracle',
  'test:bank-roll:oracle-mutants',
  'test:bank-roll:seal',
  'test:bank-roll:w4-seal',
  'test:bank-roll:w4-holdout',
  'test:bank-sheet:oracle',
  'test:bank-sheet:oracle-mutants',
  'test:bank-sheet:seal',
  'test:bank-sheet:r4-seal',
  'test:bank-sheet:r4-holdout',
  'test:bank-review:oracle',
  'test:bank-review:oracle-mutants',
  'test:bank-review:seal',
  'test:bank-review:r3-seal',
  'test:bank-review:r3-holdout',
  'test:bank-map:oracle',
  'test:bank-map:oracle-mutants',
  'test:bank-map:seal',
  'test:bank-map:baseline',
  'test:bank-map:proof',
  'test:bank-map:lifecycle',
  'test:bank-map:mutations',
  'test:bank-map:m4-seal',
  'test:bank-map:m4-intent',
  'test:bank-map:m4-holdout',
  'test:bank-tolerance:oracle',
  'test:bank-tolerance:oracle-mutants',
  'test:bank-tolerance:seal',
  'test:bank-tolerance:baseline',
  'test:bank-tolerance:proof',
  'test:bank-tolerance:lifecycle',
  'test:bank-tolerance:mutations',
  'test:bank-tolerance:t4-seal',
  'test:bank-tolerance:t4-holdout',
  'test:bank-cycle:oracle',
  'test:bank-cycle:oracle-mutants',
  'test:bank-cycle:seal',
  'test:bank-cycle:correction',
  'test:bank-cycle:run',
  'test:bank-cycle:c4-seal',
  'test:bank-cycle:c4-run',
  'test:ai-columns:seal',
  'test:ai-columns:baseline',
  'test:ai-columns:providers',
  'test:column-role:mutations',
  'test:ic-batch:oracle',
  'test:ic-batch:oracle-mutants',
  'test:ic-batch:seal',
  'test:ic-batch:baseline',
  'test:ic-batch:run',
  'test:ic-batch:mutations',
  'test:bank-review:baseline',
  'test:bank-review:proof',
  'test:bank-review:mutations',
  'test:bank-sheet:baseline',
  'test:bank-sheet:proof',
  'test:bank-sheet:lifecycle',
  'test:bank-sheet:mutations',
  'test:bank-roll:baseline',
  'test:bank-roll:proof',
  'test:bank-roll:lifecycle',
  'test:bank-roll:mutations',
  'test:ar-statement:baseline',
  'test:ar-statement:a1-proof',
  'test:ar-statement:a2-proof',
  'test:ar-statement:a3-proof',
  'test:ar-statement:a5-holdout',
  'test:ar-statement:browser',
  'test:bank-roll:browser',
  'test:bank-sheet:browser',
  'test:bank-sheet:r4-browser',
  'test:bank-review:browser',
  'test:bank-review:r3-browser',
  'test:bank-statement:baseline',
  'test:bank-statement:g1-proof',
  'test:bank-statement:g1-mutations',
  'test:bank-statement:g2-proof',
  'test:bank-statement:g2-differential',
  'test:bank-statement:g2-mutations',
  'test:bank-statement:g3-proof',
  'test:bank-statement:g3-mutations',
  'test:bank-statement:g4-mutations',
  'test:bank-statement:workspace-browser',
  'test:bank-statement:g5-mutations',
  'test:inventory-pdf:native-proof',
  'test:inventory-pdf:native-mutations',
  'test:inventory-pdf:fields-proof',
  'test:inventory-pdf:fields-mutations',
  'test:inventory-pdf:accounting',
  'test:inventory-pdf:accounting-proof',
  'test:inventory-pdf:accounting-mutations',
  'test:inventory-column',
  'test:inventory-column:proof',
  'test:inventory-column:mutations',
  'test:inventory-column:browser',
  'test:inventory-column:oracle',
  'test:inventory-column:baseline',
  'test:inventory-hierarchy',
  'test:inventory-hierarchy:oracle',
  'test:inventory-hierarchy:proof',
  'test:inventory-hierarchy:mutations',
  'test:inventory-hierarchy:browser',

  'test:inventory-matrix',
  'test:inventory-matrix:oracle',
  'test:inventory-matrix:proof',
  'test:inventory-matrix:mutations',
  'test:inventory-matrix:browser',

  'test:inventory-sections',
  'test:inventory-sections:oracle',
  'test:inventory-sections:proof',
  'test:inventory-sections:mutations',
  'test:inventory-sections:browser',
  'test:ar-scope-details',
  'test:ar-scope-details:oracle',
  'test:ar-scope-details:proof',
  'test:ar-scope-details:mutations',
  'test:ar-scope-details:browser',
  'test:payment-gateway-signed',
  'test:payment-gateway-signed:oracle',
  'test:payment-gateway-signed:proof',
  'test:payment-gateway-signed:mutations',
  'test:payment-gateway-signed:browser',
  'test:gl-tb-vertical',
  'test:gl-tb-vertical:proof',
  'test:gl-tb-vertical:mutations',
  'test:gl-tb-vertical:browser',
  'test:bank-wd:mutations',
  'test:bank-wd:browser',
  'test:fixed-assets-long',
  'test:fixed-assets-long:oracle',
  'test:fixed-assets-long:proof',
  'test:fixed-assets-long:mutations',
  'test:fixed-assets-long:browser',
];
for (const name of required) {
  assert(refs.has(name), `Required gate not wired: ${name}`);
  const owners = workflow.jobs.build.steps.filter((step) =>
    (step.run ?? '').split('\n').some((line) => line.trim() === `pnpm ${name}`),
  );
  assert.equal(owners.length, 1, `Gate must execute exactly once: ${name}`);
  const owner = owners[0];
  assert.equal(
    owner.if,
    undefined,
    `Required gate cannot be conditional: ${name}`,
  );
  assert.equal(
    owner['continue-on-error'],
    undefined,
    `Required gate cannot ignore failure: ${name}`,
  );
  assert.equal(
    owner.shell,
    undefined,
    `Required gate must use fail-fast default shell: ${name}`,
  );
  for (const line of owner.run
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    assert.match(
      line,
      /^(?:pnpm test(?::[\w-]+)*|node --experimental-strip-types [\w./-]+\.mjs(?: .*)?|python3 -B [\w./-]+\.py(?: .*)?|test -x "\$MIZAN_CHROMIUM")$/,
      `Unconditional gate command required: ${line}`,
    );
    assert(
      !/(?:\|\||&&|;|`|\$\()/.test(line),
      `Gate command must propagate failure: ${line}`,
    );
  }
  assert(
    pkg.scripts.check.includes(`pnpm ${name}`),
    `Gate omitted from check: ${name}`,
  );
}
// Gates that build the application themselves run as their own jobs beside
// the build: each unconditional, failing, exactly once, and in check.
const separate = {
  'bank-statement-interface-mutations': [
    'test:bank-statement:interface-mutations',
  ],
  'ar-statement-interface-mutations': ['test:ar-statement:interface-mutations'],
  'bank-roll-interface-mutations': ['test:bank-roll:interface-mutations'],
  'bank-sheet-interface-mutations': ['test:bank-sheet:interface-mutations'],
  'bank-review-interface-mutations': [
    'test:bank-review:interface-mutations',
  ],
  'bank-map-interface-mutations': ['test:bank-map:interface-mutations'],
  'bank-map-browser': ['test:bank-map:browser', 'test:bank-map:m4-browser'],
  'bank-tolerance-interface-mutations': [
    'test:bank-tolerance:interface-mutations',
  ],
  'bank-tolerance-browser': [
    'test:bank-tolerance:browser',
    'test:bank-tolerance:t4-browser',
  ],
  'bank-cycle-browser': [
    'test:bank-cycle:browser',
    'test:bank-cycle:c4-browser',
  ],
  'intercompany-batch-browser': ['test:ic-batch:browser'],
  'intercompany-batch-interface-mutations': [
    'test:ic-batch:interface-mutations',
  ],
  'bank-statement-holdout': [
    'test:bank-statement:g6-holdout',
    'test:bank-statement:g6-browser',
    'test:bank-statement:g8-holdout',
    'test:bank-statement:g8-browser',
    'test:bank-statement:g9-holdout',
    'test:bank-statement:g9-browser',
    'test:bank-statement:g10-holdout',
    'test:bank-statement:g10-browser',
    'test:bank-statement:g12-holdout',
    'test:bank-statement:g12-browser',
    'test:bank-statement:g14-holdout',
    'test:bank-statement:g14-browser',
    'test:bank-statement:g15-holdout',
    'test:bank-statement:g15-browser',
    'test:bank-statement:g17-holdout',
    'test:bank-statement:g17-browser',
    'test:bank-statement:g20-holdout',
    'test:bank-statement:g20-browser',
    'test:bank-statement:g23-holdout',
    'test:bank-statement:g23-browser',
    'test:supplier-statement:s3-holdout',
  ],
};
for (const [jobName, names] of Object.entries(separate)) {
  const job = workflow.jobs[jobName];
  assert(job, `Separate gate job missing: ${jobName}`);
  assert.equal(job.if, undefined, `Separate gate job cannot be conditional`);
  assert.notEqual(job['continue-on-error'], true);
  for (const name of names) {
    const owners = Object.values(workflow.jobs).flatMap((j) =>
      (j.steps ?? []).filter((step) =>
        (step.run ?? '')
          .split('\n')
          .some((line) => line.trim() === `pnpm ${name}`),
      ),
    );
    assert.equal(owners.length, 1, `Gate must execute exactly once: ${name}`);
    assert(job.steps.includes(owners[0]), `Gate outside its job: ${name}`);
    assert.equal(owners[0].if, undefined);
    assert.equal(owners[0].shell, undefined);
    assert.equal(owners[0].run.trim(), `pnpm ${name}`);
    assert(
      pkg.scripts.check.includes(`pnpm ${name}`),
      `Gate omitted from check: ${name}`,
    );
  }
}
for (const command of Object.values(pkg.scripts))
  for (const m of command.matchAll(
    /(?:scripts|audit|tests)\/[\w./-]+\.(?:mjs|ts|py)/g,
  ))
    assert(existsSync(path.join(root, m[0])), m[0]);
assert(
  existsSync(path.join(root, 'scripts/check-fixed-assets-long-browser.py')),
);
console.log(
  JSON.stringify({
    passed: true,
    mode: 'offline-YAML-Bash-references-only',
    shells,
    requiredFamilyGates: required.length,
    baselineWorkflowSha256: createHash('sha256')
      .update(
        readFileSync(
          path.join(root, 'audit/source-families-integration/pages-0443.yml'),
        ),
      )
      .digest('hex'),
    browserExecuted: false,
    remoteCIExecuted: false,
  }),
);
