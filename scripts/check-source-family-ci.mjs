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
for (const name of ['deploy', 'mutations', 'specialized-faults'])
  assert.deepEqual(workflow.jobs[name], baseline.jobs[name]);
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
