// New development fixtures only. Reserved combinations are never rendered by tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  focusedManifest,
  generateFocusedCase,
} from '../audit/reliability/focused-generator.mjs';
import { foundationManifest } from '../audit/reliability/manifest.mjs';
import { generateCase } from '../audit/reliability/generator.mjs';
import { renderCase } from '../audit/reliability/renderers.mjs';
import { evaluateCase, loadEngine } from '../audit/reliability/evaluate.mjs';
import type { Comparison } from '../lib/reconciliation/types.ts';
const enginePromise = loadEngine(
  fileURLToPath(new URL('../', import.meta.url)),
);
type Compare = typeof import('../lib/reconciliation/core.ts').compare;
type Normalize = typeof import('../lib/reconciliation/core.ts').normalizeSource;
const fixture = (index: number) =>
  generateFocusedCase(
    focusedManifest().filter((d) => d.split === 'development-046')[index],
  );
const codes = (r: Awaited<ReturnType<typeof evaluateCase>>) =>
  r.failures.map((f: { code: string }) => f.code);

test('20 focused development files require eight proved groups and reject twelve counterexamples through independent workbook verification', async () => {
  const engine = await enginePromise;
  let groups = 0;
  for (const d of focusedManifest().filter(
    (d) => d.split === 'development-046',
  )) {
    const spec = generateFocusedCase(d),
      record = await evaluateCase(spec, await renderCase(spec), engine);
    assert.equal(
      record.pass,
      true,
      `${d.id}: ${JSON.stringify(record.failures)}`,
    );
    if (!spec.oracle.requiresScopeStop)
      assert.equal(record.exportChecked, true, d.id);
    else assert.equal(record.correctMatches, 0, d.id);
    assert.equal(record.acceptedRequiredGroups, record.requiredGroups, d.id);
    groups += record.acceptedRequiredGroups;
    assert.equal(record.falseMatches, 0);
  }
  assert.equal(groups, 8);
  assert.equal(fixture(3).sources[0].rows[0].minor, 675000);
  assert.deepEqual(
    fixture(3).sources[1].rows.map((r: { minor: number }) => r.minor),
    [250000, 225000, 200000],
  );
});

test('disabling every group fails required completion and cannot be counted as success', async () => {
  const engine = await enginePromise,
    spec = fixture(0);
  const record = await evaluateCase(
    spec,
    await renderCase(spec),
    {
      ...engine,
      compare: (...args: Parameters<Compare>) => {
        const r = structuredClone(engine.compare(...args)) as Comparison;
        r.matches = [];
        for (const c of r.cases) {
          c.status = 'Needs Review';
          c.reviewRequired = true;
        }
        r.caseCounts.autoMatchedCases = 0;
        r.caseCounts.matchedSourceRows = 0;
        return r;
      },
    },
    { exports: false },
  );
  assert.ok(codes(record).includes('AUTO_COMPLETION_GAP'));
  assert.equal(record.acceptedRequiredGroups, 0);
  assert.equal(record.requiredGroups, 1);
  assert.equal(record.falseMatches, 0);
});

test('forcing a group on equal sums without bank or receipt proof is a false match', async () => {
  const engine = await enginePromise,
    spec = fixture(5);
  const record = await evaluateCase(
    spec,
    await renderCase(spec),
    {
      ...engine,
      compare: (...args: Parameters<Compare>) => {
        const r = structuredClone(engine.compare(...args)) as Comparison;
        const c = r.cases.find(
          (c) => c.supplierMembers.length && c.ledgerMembers.length,
        );
        assert.ok(c, 'counterexample must reach grouped candidate decision');
        c.status = 'Matched';
        c.reviewRequired = false;
        return r;
      },
    },
    { exports: false },
  );
  assert.ok(
    codes(record).includes('FALSE_MATCH'),
    JSON.stringify(record.failures),
  );
  assert.equal(record.safetyPass, false);
});

test('hidden metadata changes after rendering cannot change any engine input', async () => {
  const engine = await enginePromise,
    spec = fixture(0),
    rendered = await renderCase(spec);
  const seen: unknown[] = [];
  const wrapped = {
    ...engine,
    normalizeSource: (...args: Parameters<Normalize>) => {
      seen.push(structuredClone({ mapping: args[1], scope: args[2] }));
      return engine.normalizeSource(...args);
    },
  };
  const first = await evaluateCase(spec, rendered, wrapped, { exports: false });
  for (const source of spec.sources) {
    Object.assign(source.metadata, {
      currency: 'KWD',
      decimals: 3,
      dateFormat: 'mdy',
      numberFormat: 'comma',
      supplier: 'Hidden supplier',
      entity: 'Hidden entity',
      account: 'SECRET',
      cutoff: '2040-01-01',
      multiplier: -1,
    });
  }
  const second = await evaluateCase(spec, rendered, wrapped, {
    exports: false,
  });
  assert.equal(first.pass, true);
  assert.equal(second.pass, true, JSON.stringify(second.failures));
  assert.deepEqual(seen.slice(0, 2), seen.slice(2, 4));
  assert.deepEqual(first.inputTrace, second.inputTrace);
});

test('ambiguous decimal convention stays unresolved without outside information and is labelled external when provided', async () => {
  const engine = await enginePromise,
    spec = generateCase(foundationManifest()[0]),
    rendered = await renderCase(spec);
  const unresolved = await evaluateCase(spec, rendered, engine, {
    exports: false,
  });
  assert.equal(unresolved.completedComparison, false);
  assert.equal(unresolved.outcome, 'external-information-required');
  assert.equal(unresolved.requiredInterventionLevel, 'human-external');
  assert.equal(unresolved.correctMatches, 0);
  const completed = await evaluateCase(spec, rendered, engine, {
    exports: false,
    externalInputs: {
      'supplier.numberFormat': {
        value: 'dot',
        source: 'Explicit test reviewer declaration, outside the document',
      },
      'ledger.numberFormat': {
        value: 'dot',
        source: 'Explicit test reviewer declaration, outside the document',
      },
    },
  });
  assert.equal(completed.pass, true, JSON.stringify(completed.failures));
  assert.equal(completed.completedComparison, true);
  assert.equal(completed.interventionLevel, 'human-external');
  assert.ok(
    completed.inputTrace.some(
      (v: { origin: string }) => v.origin === 'explicit-external-input',
    ),
  );
});

test('the workbook verifier rejects accepted groups outside an independently supplied permission set', async () => {
  const engine = await enginePromise,
    spec = fixture(0),
    rendered = await renderCase(spec);
  spec.oracle.permittedAutoMatches = [];
  const record = await evaluateCase(spec, rendered, engine);
  assert.ok(codes(record).includes('FALSE_MATCH'));
  assert.ok(
    codes(record).includes('EXPORT_VALIDATION'),
    JSON.stringify(record.failures),
  );
  assert.ok(
    record.failures.some(
      (f: { code: string; detail: string }) =>
        f.code === 'EXPORT_VALIDATION' &&
        /independent visible-evidence permission/.test(f.detail),
    ),
  );
});

test('a diagnostic result with source errors is never labelled a completed comparison', async () => {
  const engine = await enginePromise,
    spec = fixture(0);
  const record = await evaluateCase(
    spec,
    await renderCase(spec),
    {
      ...engine,
      normalizeSource: (...args: Parameters<Normalize>) => {
        const source = engine.normalizeSource(...args);
        if (args[3] === 'supplier')
          source.errors.push({
            row: 9,
            message: 'Injected unread source field',
          });
        return source;
      },
    },
    { exports: false },
  );
  assert.equal(record.resultProduced, true);
  assert.equal(record.completeSourceRead, false);
  assert.equal(record.completedComparison, false);
  assert.equal(record.sourceReadErrors, 1);
  assert.equal(record.outcome, 'partial-or-unverified-result');
  assert.ok(
    codes(record).includes('AUTO_COMPLETION_GAP'),
    'row errors still prevent the required group; no hidden pass',
  );
});

test('invalid format inference records an unproven implicit default even when downstream parsing returns values', async () => {
  const engine = await enginePromise,
    spec = fixture(0);
  const record = await evaluateCase(
    spec,
    await renderCase(spec),
    {
      ...engine,
      suggestFormats: (...args: Parameters<typeof engine.suggestFormats>) => {
        const formats = engine.suggestFormats(...args);
        const { numberFormat: _discarded, ...patch } = formats.patch;
        return {
          ...formats,
          patch,
          numberFormat: {
            status: 'invalid',
            reason: 'Injected invalid column evidence',
            candidates: [],
            checkedValues: 4,
          },
        };
      },
    },
    { exports: false },
  );
  assert.equal(record.completedComparison, false);
  assert.equal(record.automaticInputDerivation, false);
  assert.equal(record.unprovenFormatDefaults.length, 2);
  assert.equal(record.needsChosenInterpretation, true);
  assert.equal(record.requiredInterventionLevel, 'manual-correction');
  assert.ok(
    record.inputTrace.some(
      (item: { origin: string }) => item.origin === 'unproven-engine-default',
    ),
  );
  assert.ok(
    !record.inputTrace.some(
      (item: { origin: string; field: string }) =>
        item.origin === 'engine-format-proof' &&
        item.field.endsWith('numberFormat'),
    ),
  );
});
