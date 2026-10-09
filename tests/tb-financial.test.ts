import test from 'node:test';
import assert from 'node:assert/strict';
import {
  financialTruth,
  financialFixture,
  finishedFinancial,
} from '../audit/tb-financial/fixtures.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { reconcileFinancialPosition } from '../lib/reconciliation/tb-financial.ts';

void test('Financial position: all 74 pre-engine contracts preserve original inventory, exact dimensions, signed totals and atomic line membership', async () => {
  for (const c of financialTruth.cases) {
    if (c.reject) {
      await assert.rejects(
        () => finishedFinancial(c.name),
        new RegExp(`TB_FIN_${c.reject}`),
        c.name,
      );
      continue;
    }
    const { result } = await finishedFinancial(c.name);
    assert.equal(result.status, c.status, c.name);
    for (let source = 0; source < 4; source++)
      assert.deepEqual(
        result.inventory
          .filter((r) => r.source === source)
          .map((r) => r.values),
        [c.originalTables[source].headers, ...c.originalTables[source].rows],
        c.name,
      );
    const facts = c.financialFacts;
    if (!facts) {
      assert.equal(result.totals, null, c.name);
      assert.equal(result.grandTotals, null, c.name);
      assert.equal(result.events.length, 0, c.name);
      assert.ok(
        result.lines.every(
          (l) =>
            l.calculated === null &&
            l.difference === null &&
            l.review === 'blocked',
        ),
        c.name,
      );
      continue;
    }
    assert.equal(result.decimals, facts.decimals, c.name);
    assert.deepEqual(
      result.tb,
      { debit: facts.debit, credit: facts.credit, residual: facts.tbResidual },
      c.name,
    );
    assert.deepEqual(
      result.accounts.map((a) => ({
        account: a.account,
        dimensions: a.dimensions,
        debit: a.debit,
        credit: a.credit,
        net: a.net,
        sourceRow: a.row,
      })),
      facts.accounts,
      c.name,
    );
    assert.deepEqual(result.totals, facts.totals, c.name);
    assert.deepEqual(
      result.grandTotals,
      {
        calculated: {
          ...facts.grandTotals.calculated,
          equation: facts.equations.calculated,
        },
        reported: {
          ...facts.grandTotals.reported,
          equation: facts.equations.reported,
        },
      },
      c.name,
    );
    assert.deepEqual(
      result.lines.map((l) => ({
        id: l.lineId,
        label: l.label,
        category: l.category,
        row: l.row,
        calculated: l.calculated,
        reported: l.reported,
        difference: l.difference,
        review: l.review,
        members: l.members.map((m) => ({
          mappingId: m.mappingId,
          account: m.account,
          dimensions: m.dimensions,
          evidenceId: m.evidenceId,
          accountRow: result.accounts.find((a) => a.id === m.accountRecord)!
            .row,
          mappingRow: result.mappings.find((a) => a.id === m.mappingRecord)!
            .row,
          evidenceRow: result.evidence.find((a) => a.id === m.evidenceRecord)!
            .row,
          contribution: m.contribution,
          debit: m.debit,
          credit: m.credit,
          net: m.net,
        })),
      })),
      facts.lines,
      c.name,
    );
  }
});
void test('Financial position: supplied classification and line identity remain independent of a zero grand residual', async () => {
  for (const name of [
    'wrong-lines-equal-totals',
    'wrong-current-classification',
    'wrong-account-class',
    'coherent-unsupported-reclassification',
    'wrong-sign',
  ]) {
    const { result } = await finishedFinancial(name);
    assert.equal(result.status, 'source-error');
    assert.equal(result.totals, null);
    assert.ok(result.issues.length);
  }
  const { result } = await finishedFinancial('offsetting-line-differences');
  assert.equal(result.grandTotals!.reported.equation, 0);
  assert.equal(result.status, 'difference');
  assert.deepEqual(
    result.lines.slice(0, 2).map((l) => l.difference),
    [-1, 1],
  );
});
void test('Financial position: approval cannot bypass inconsistent money, missing linkage or the complete inventory attestation', async () => {
  for (const name of [
    'offsetting-line-differences',
    'unbalanced-tb',
    'unbalanced-statement',
    'incomplete-attestation',
    'missing-mapping',
    'wrong-lines-equal-totals',
  ]) {
    const state = await financialFixture(name);
    const result = reconcileFinancialPosition(state);
    const line = result.lines.find((l) => l.lineId === 'CASH')!;
    state.events = [
      {
        id: 'new',
        type: 'accept',
        context: result.context,
        lineId: 'CASH',
        mappingIds: line.members.map((m) => m.mappingId),
        at: '2026-10-06T00:00:00.000Z',
        reference: 'Independent review',
        note: 'This must not waive any original evidence gate',
      },
    ];
    assert.throws(
      () => reconcileFinancialPosition(state),
      /TB_FIN_EVENT_(FINANCIAL|SOURCE)/,
      name,
    );
  }
});
void test('Financial position: source changes invalidate prior review and repeated event ids reject', async () => {
  const { state } = await finishedFinancial('whole-post-closing');
  const changed = structuredClone(state);
  changed.completeness.note = 'Different inventory decision';
  assert.throws(
    () => reconcileFinancialPosition(changed),
    /TB_FIN_EVENT_CONTEXT/,
  );
  const repeated = structuredClone(state);
  repeated.events.push({ ...repeated.events[0], type: 'undo' });
  assert.throws(() => reconcileFinancialPosition(repeated), /TB_FIN_EVENT_ID/);
});
void test('Financial position: unsafe cells and malformed original contenders never acquire a first winner', async () => {
  const state = await financialFixture('pending');
  state.files[0].sheets[0].formulaCells = { '2:5': { formula: '1000' } };
  const r = reconcileFinancialPosition(state);
  assert.equal(r.status, 'source-error');
  assert.ok(
    r.inventory
      .find((i) => i.source === 0 && i.row === 2)!
      .errors.includes('CELL'),
  );
  const { result } = await finishedFinancial('malformed-mapping-competitor');
  assert.equal(result.status, 'source-error');
  assert.equal(
    result.inventory.filter(
      (i) => i.source === 1 && i.errors.includes('DUPLICATE'),
    ).length,
    2,
  );
});

void test('Financial position: the canonical family cannot omit a second sheet or exceed its total inventory cap', async () => {
  const extra = await financialFixture(financialTruth.cases[0].name);
  extra.files[0].sheets.push({
    ...extra.files[0].sheets[0],
    name: 'Other accounts',
  });
  assert.throws(
    () => reconcileFinancialPosition(extra),
    /TB_FIN_SOURCE_SHEETS/,
  );
  const reading = await financialFixture(financialTruth.cases[0].name);
  reading.readings[0].sheet = 1;
  assert.throws(() => reconcileFinancialPosition(reading), /TB_FIN_READING/);
  const large = await financialFixture(financialTruth.cases[0].name);
  for (const file of large.files) {
    const sheet = file.sheets[0];
    sheet.rows = [
      sheet.rows[0],
      ...Array.from({ length: 5001 }, () => [...sheet.rows[1]]),
    ];
  }
  assert.throws(() => reconcileFinancialPosition(large), /TB_FIN_ROWS/);
});

void test('Financial position: an original L+1 amount remains an inventoried source error', async () => {
  const state = await financialFixture(financialTruth.cases[0].name);
  const raw = new TextDecoder()
    .decode(state.files[0].original!)
    .replace('1000.00', '1000000000000.01');
  state.files[0] = await readFile(
    'over-limit.csv',
    new TextEncoder().encode(raw).buffer,
  );
  const result = reconcileFinancialPosition(state);
  assert.equal(result.status, 'source-error');
  assert.equal(
    result.inventory.find((r) => r.source === 0 && r.row === 2)?.values[4],
    '1000000000000.01',
  );
  assert.ok(
    result.issues.some(
      (i) => i.source === 0 && i.row === 2 && i.code === 'AMOUNT',
    ),
  );
  assert.equal(result.totals, null);
  assert.equal(result.grandTotals, null);
});

void test('Financial position: coherent proposed and supplied wrong signs still violate the confirmed category policy', async () => {
  const state = await financialFixture(financialTruth.cases[0].name);
  for (const source of [1, 2]) {
    const raw = new TextDecoder()
      .decode(state.files[source].original!)
      .replace('debit-positive', 'credit-positive');
    state.files[source] = await readFile(
      `coherent-wrong-sign-${source}.csv`,
      new TextEncoder().encode(raw).buffer,
    );
  }
  const result = reconcileFinancialPosition(state);
  assert.equal(result.status, 'source-error');
  assert.ok(result.issues.some((i) => i.code === 'SIGN_POLICY'));
  assert.equal(result.totals, null);
});
