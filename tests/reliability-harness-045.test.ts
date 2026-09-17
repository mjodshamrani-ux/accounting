// Faults are injected into wrapped return values, never into the oracle or production files.
// Only the three named development anchors are materialized; no holdout cases are opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  foundationManifest,
  buildManifest,
} from '../audit/reliability/manifest.mjs';
import { generateCase } from '../audit/reliability/generator.mjs';
import { renderCase } from '../audit/reliability/renderers.mjs';
import { evaluateCase, loadEngine } from '../audit/reliability/evaluate.mjs';
import type { Comparison } from '../lib/reconciliation/types.ts';

type Compare = typeof import('../lib/reconciliation/core.ts').compare;
type Normalize = typeof import('../lib/reconciliation/core.ts').normalizeSource;
type ReadFile = typeof import('../lib/reconciliation/io.ts').readFile;
type AuditRecord = {
  pass: boolean;
  safetyPass: boolean;
  failures: Array<{ code: string; detail: string; safety: boolean }>;
  exportChecked: boolean;
  stopped: boolean;
  correctMatches: number;
  expectedMatches: number;
  correctRequiredMatches: number;
  falseMatches: number;
};
const enginePromise = loadEngine(
  fileURLToPath(new URL('../', import.meta.url)),
);
test('a completed-balance flag cannot replace missing source evidence or a missing bridge', async () => {
  const engine = await enginePromise;
  const descriptor = buildManifest().find(
    (d) => d.split === 'development' && d.scenario === 'invalid-amount',
  )!;
  const spec = generateCase(descriptor),
    rendered = await renderCase(spec);
  let mutations = 0;
  const record = (await evaluateCase(
    spec,
    rendered,
    {
      ...engine,
      compare: (...args: Parameters<Compare>) => {
        const result = engine.compare(...args);
        assert.equal(result.bridge, null);
        mutations++;
        return { ...result, balanceComparable: true };
      },
    },
    { exports: false },
  )) as unknown as AuditRecord;
  assert.ok(mutations > 0, 'The mutation must actually execute');
  assert.ok(
    record.failures.some(
      (f: { code: string }) => f.code === 'UNPROVEN_BALANCE_STATUS',
    ),
  );
  assert.equal(record.pass, false);
});
async function run(anchor: 1 | 7 | 37, override: Record<string, unknown> = {}) {
  const engine = await enginePromise;
  const spec = generateCase(foundationManifest()[anchor - 1]);
  const rendered = await renderCase(spec);
  return (await evaluateCase(
    spec,
    rendered,
    { ...engine, ...override },
    { exports: false },
  )) as unknown as AuditRecord;
}
async function wrappedComparison(mutate: (result: Comparison) => void) {
  const engine = await enginePromise;
  return {
    compare: (...args: Parameters<Compare>) => {
      const result = structuredClone(engine.compare(...args)) as Comparison;
      mutate(result);
      return result;
    },
  };
}
function requireFailure(
  record: Awaited<ReturnType<typeof run>>,
  code: string,
  safety = true,
) {
  assert.equal(record.pass, false, 'an injected fault cannot pass the audit');
  assert.ok(
    record.failures.some((failure) => failure.code === code),
    `${code} absent: ${JSON.stringify(record.failures)}`,
  );
  if (safety)
    assert.equal(
      record.safetyPass,
      false,
      'a safety fault cannot be reported as safe',
    );
  assert.ok(
    !record.failures.some(
      (failure) => failure.code === 'HARNESS_OR_ENGINE_EXCEPTION',
    ),
    JSON.stringify(record.failures),
  );
}

test('independent evaluator accepts healthy exact matches and a controlled invalid-source rejection', async () => {
  for (const anchor of [1, 7, 37] as const) {
    const record = await run(anchor);
    assert.equal(
      record.pass,
      true,
      `F${anchor}: ${JSON.stringify(record.failures)}`,
    );
    assert.equal(record.exportChecked, false);
    if (anchor === 37) {
      assert.equal(record.stopped, true);
      assert.equal(record.correctMatches, 0);
    } else assert.equal(record.correctMatches, anchor === 7 ? 2 : 1);
  }
});

test('evaluator independently checks source totals against source transactions', async () => {
  const engine = await enginePromise;
  const record = await run(1, {
    normalizeSource: (...args: Parameters<Normalize>) => {
      const result = engine.normalizeSource(...args);
      return { ...result, total: result.total + 1 };
    },
  });
  requireFailure(record, 'SOURCE_TOTAL_CHANGED');
});

test('evaluator rejects disagreement between accepted cases and the public match list', async () => {
  const record = await run(
    1,
    await wrappedComparison((result) => {
      result.matches = [];
    }),
  );
  requireFailure(record, 'MATCH_CASE_DISAGREEMENT');
  assert.equal(
    record.correctMatches,
    1,
    'the independent case check still sees the original proved match',
  );
});

test('evaluator does not reward abstaining from every provable automatic match', async () => {
  const record = await run(
    7,
    await wrappedComparison((result) => {
      result.matches = [];
      for (const item of result.cases) {
        item.status = 'Needs Review';
        item.reviewRequired = true;
      }
      result.caseCounts.autoMatchedCases = 0;
      result.caseCounts.matchedSourceRows = 0;
      result.caseCounts.needsReviewCases = result.cases.length;
      result.caseCounts.needsReviewSourceRows = result.cases.reduce(
        (count, item) =>
          count + item.supplierMembers.length + item.ledgerMembers.length,
        0,
      );
    }),
  );
  requireFailure(record, 'AUTO_COMPLETION_GAP', false);
  assert.equal(record.expectedMatches, 2);
  assert.equal(record.correctRequiredMatches, 0);
  assert.equal(record.falseMatches, 0);
});

test('runtime errors and cancellation on corrupt input are failures rather than valid rejections', async () => {
  const engine = await enginePromise;
  for (const error of [
    new TypeError("Cannot read properties of undefined (reading 'sheets')"),
    new RangeError('Maximum call stack size exceeded'),
    new SyntaxError('Invalid regular expression'),
    new DOMException('Cancelled', 'AbortError'),
  ]) {
    const record = await run(37, {
      readFile: (...args: Parameters<ReadFile>) => {
        if (args[0].startsWith('supplier-statement')) throw error;
        return engine.readFile(...args);
      },
    });
    requireFailure(record, 'UNCONTROLLED_FAILURE');
    assert.equal(record.stopped, true, 'stopping alone is not enough to pass');
  }
});

test('equal-valued invoices with swapped counterparties are false matches even when counts and arithmetic agree', async () => {
  const record = await run(
    7,
    await wrappedComparison((result) => {
      const accepted = result.cases.filter((item) => item.status === 'Matched');
      assert.equal(accepted.length, 2);
      const first = accepted[0],
        second = accepted[1];
      [first.ledgerMembers, second.ledgerMembers] = [
        second.ledgerMembers,
        first.ledgerMembers,
      ];
      for (const item of accepted) {
        item.sourceTrace = [...item.supplierMembers, ...item.ledgerMembers].map(
          (transaction) => ({
            sourceRowId: transaction.id,
            side: transaction.side,
            sheet: transaction.sheet,
            row: transaction.row,
            ...(transaction.sourcePage ? { page: transaction.sourcePage } : {}),
          }),
        );
        const match = result.matches.find(
          (match) => match.supplierId === item.supplierMembers[0].id,
        )!;
        match.ledgerId = item.ledgerMembers[0].id;
        match.ledgerIds = item.ledgerMembers.map(
          (transaction) => transaction.id,
        );
      }
    }),
  );
  requireFailure(record, 'FALSE_MATCH');
  assert.equal(record.falseMatches, 2);
  assert.equal(record.correctMatches, 0);
  assert.ok(
    !record.failures.some((failure) =>
      ['CASE_ARITHMETIC', 'CASE_PARTITION', 'MATCH_CASE_DISAGREEMENT'].includes(
        failure.code,
      ),
    ),
    JSON.stringify(record.failures),
  );
});
