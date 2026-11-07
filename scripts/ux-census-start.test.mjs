// The recipes and the record of the census class inputsBeforeRun (UX-5),
// without a browser: every workspace has a recipe whose sources exist and
// whose steps are well formed, the record holds a count for each, and the
// comparison reports every difference. The browser run itself is
// scripts/ux-census-start-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMAINS } from './ux-census-support.mjs';
import { START, compareStart } from './ux-census-start.mjs';

const root = path.resolve(import.meta.dirname, '..');

void test('every workspace has a recipe, and only those', () => {
  assert.deepEqual(Object.keys(START).sort(), [...DOMAINS].sort());
});

void test('each recipe loads sources that exist and ends at a named run', () => {
  for (const [domain, recipe] of Object.entries(START)) {
    assert.ok(recipe.sources.length > 0, `${domain}: no sources`);
    for (const [label, file] of recipe.sources) {
      assert.equal(typeof label, 'string', `${domain}: source label`);
      if (typeof file === 'string')
        assert.ok(existsSync(path.join(root, file)), `${domain}: ${file}`);
      else assert.ok(file.name && file.body, `${domain}: inline source`);
    }
    assert.equal(typeof recipe.run, 'string', `${domain}: run`);
  }
});

void test('each step is a known kind with what it needs, and none repeats', () => {
  for (const [domain, { steps }] of Object.entries(START)) {
    const seen = new Set();
    for (const [kind, name, value, occurrence] of steps) {
      assert.ok(['check', 'fill', 'select', 'press'].includes(kind), kind);
      assert.equal(typeof name, 'string');
      if (kind === 'fill' || kind === 'select')
        assert.equal(typeof value, 'string', `${domain}: ${name} value`);
      else assert.equal(value, undefined, `${domain}: ${name} takes no value`);
      if (occurrence !== undefined) assert.ok(Number.isInteger(occurrence));
      const key = `${kind}|${name}|${occurrence ?? 0}`;
      assert.ok(!seen.has(key), `${domain}: ${key} repeats`);
      seen.add(key);
    }
  }
});

void test('the record holds a count for each workspace and their total', async () => {
  const recorded = JSON.parse(
    await readFile(path.join(root, 'audit/ux-census/start.json'), 'utf8'),
  );
  assert.equal(recorded.metric, 'inputsBeforeRun');
  assert.deepEqual(Object.keys(recorded.domains).sort(), [...DOMAINS].sort());
  for (const [domain, count] of Object.entries(recorded.domains))
    assert.ok(Number.isInteger(count) && count >= 0, domain);
  assert.equal(
    recorded.total,
    Object.values(recorded.domains).reduce((a, b) => a + b, 0),
  );
  assert.match(recorded.recorded.commit, /^[0-9a-f]{40}$/);
  assert.match(recorded.recorded.chromium, /^\d+\./);
  // The record is what the recipes count today.
  for (const [domain, count] of Object.entries(recorded.domains))
    assert.equal(count, START[domain].steps.length, domain);
});

void test('the comparison reports more, fewer, unrecorded and unmeasured', () => {
  const recorded = { ar: 29, bank: 8, payroll: 23 };
  assert.deepEqual(compareStart(recorded, { ...recorded }), {
    increases: [],
    decreases: [],
    missing: [],
  });
  const diff = compareStart(recorded, { ar: 30, bank: 1, stock: 15 });
  assert.deepEqual(diff.increases, ['ar: 29 → 30']);
  assert.deepEqual(diff.decreases, ['bank: 8 → 1']);
  assert.deepEqual(diff.missing.sort(), [
    'payroll: not measured',
    'stock: no record',
  ]);
  assert.deepEqual(
    compareStart(recorded, { bank: 8 }, { only: ['bank'] }).missing,
    [],
    'a run limited to some workspaces does not call the others unmeasured',
  );
});
