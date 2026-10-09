import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { createAllocationWorkflowHandoff } from '../lib/reconciliation/allocation-workflow-handoff.ts';
import { reconcileAllocation, type AllocationResult } from '../lib/reconciliation/allocation.ts';
import { replayAllocation, exportAllocation, saveAllocation } from '../lib/reconciliation/allocation-io.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { allocationFixture, fixtureEvent } from '../audit/allocation/fixtures.ts';
import type { Scope } from '../lib/reconciliation/types.ts';

const truth = JSON.parse(readFileSync(new URL('../audit/allocation-handoff-v1/frozen/expected.json', import.meta.url), 'utf8')) as {
  forbiddenFields: string[];
  requirements: { id: string; paymentOriginal?: number; invoiceOriginal?: number; paymentAvailable?: number; invoiceAvailable?: number; allocate?: number[]; paymentRemaining?: number; invoiceRemaining?: number; undoDecisionIndex?: number; nextAllocate?: number }[];
};
const scope: Scope = { entity: 'E', supplier: 'S', account: 'AP', currency: 'SAR', cutoff: '2026-09-30', decimals: 2, dateWindow: 0, confirmed: true, coverageConfirmed: true };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

void test('allocation handoff is copied provenance and unconfirmed hints without financial data', async () => {
  const input = await allocationFixture('no-evidence');
  const files = [input.files[0], input.files[1]] as const;
  const context = createAllocationWorkflowHandoff(files, scope, 'handoff-1');
  assert.equal(context.authority, 'workflow-context-only');
  assert.equal(context.scopeHints.confirmed, false);
  assert.equal(context.scopeHints.party, 'S');
  assert.deepEqual(context.sourceReferences, files.map((f) => ({ name: f.name, sha256: f.sha256 })));
  for (const key of truth.forbiddenFields) assert.equal(key in context, false, key);
  assert.equal('events' in context, false);
  const before = structuredClone(context);
  files[0].name = 'changed.csv';
  scope.entity = 'changed';
  assert.deepEqual(context, before);
  scope.entity = 'E';
  assert.throws(() => createAllocationWorkflowHandoff(files, scope, ''), /HANDOFF/);
  assert.throws(() => createAllocationWorkflowHandoff([{ ...files[0], sha256: 'invalid' }, files[1]], scope, 'x'), /HANDOFF/);
});

void test('existing allocation engine proves the independently frozen partial, staged, capacity and undo transitions', async () => {
  for (const id of ['H4', 'H5', 'H6', 'H8']) {
    const c = truth.requirements.find((r) => r.id === id)!;
    const input = await allocationFixture('no-evidence');
    for (const side of [0, 1] as const) {
      const nativeRows = input.files[side].sheets[0].rows;
      // Build the independent one-payment/one-invoice synthetic source. The
      // older no-evidence fixture has two invoices and remains byte-unchanged.
      const member = nativeRows.find((row) => row[0] === (side === 0 ? 'P1' : 'I1'));
      assert.ok(member);
      const rows = structuredClone([nativeRows[0], member]);
      const original = side === 0 ? c.paymentOriginal ?? c.paymentAvailable! : c.invoiceOriginal ?? c.invoiceAvailable!;
      const available = side === 0 ? c.paymentAvailable! : c.invoiceAvailable!;
      rows[1][rows[1].length - 2] = (original / 100).toFixed(2);
      rows[1][rows[1].length - 1] = (available / 100).toFixed(2);
      input.files[side] = await readFile(input.files[side].name, new TextEncoder().encode(rows.map((row) => row.join(',')).join('\n') + '\n').buffer);
    }
    let result = (await replayAllocation(input)).result;
    const unchangedSources = input.files.map((f) => f.sha256);
    for (const [index, amount] of c.allocate!.entries()) {
      const event = fixtureEvent({ type: 'human', id: `D${index + 1}`, links: [['P1', 'I1', 1]] }, result);
      assert.equal(event.type, 'allocate');
      if (event.type !== 'allocate') throw Error('fixture event type');
      event.links[0].amount = amount;
      if (id === 'H6') {
        const before = structuredClone(result);
        await assert.rejects(replayAllocation({ ...input, events: [...input.events, event] }), /OVER_AVAILABLE/);
        assert.deepEqual((await replayAllocation(input)).result, before);
      } else {
        input.events.push(event);
        result = (await replayAllocation(input)).result;
      }
    }
    if (id === 'H8') {
      input.events.push({ id: 'U1', type: 'undo', target: 'D1', context: result.context, at: '2026-09-30T00:00:00.000Z', note: 'Undo the complete first independent decision' });
      result = (await replayAllocation(input)).result;
    }
    if (id !== 'H6') {
      assert.equal(result.balances.find((b) => b.id === result.items.find((i) => i.side === 0)!.id)!.remaining, c.paymentRemaining, id);
      assert.equal(result.balances.find((b) => b.id === result.items.find((i) => i.side === 1)!.id)!.remaining, c.invoiceRemaining, id);
    }
    assert.deepEqual(input.files.map((f) => f.sha256), unchangedSources);
  }
});

void test('allocation native replay cannot adopt events inserted while original bytes are being reread', async () => {
  const input = await allocationFixture('no-evidence');
  const event = fixtureEvent({ type: 'human', id: 'D1', links: [['P1', 'I1', 100]] }, reconcileAllocation(input));
  const pending = replayAllocation(input);
  input.events.push(event);
  await assert.rejects(pending, /ALLOCATION_INPUT_CHANGED/);
});

void test('allocation native replay cannot adopt changed reading confirmation during original replay', async () => {
  const input = await allocationFixture('no-evidence');
  const pending = replayAllocation(input);
  input.readings[0].confirmed = false;
  await assert.rejects(pending, /ALLOCATION_INPUT_CHANGED/);
});

void test('allocation export snapshots its expected result before native replay', async () => {
  const input = await allocationFixture('no-evidence');
  const actual = (await replayAllocation(input)).result;
  const repairedDuringReplay: AllocationResult = { ...actual, balances: [] };
  const pending = exportAllocation(input, repairedDuringReplay);
  repairedDuringReplay.balances = actual.balances;
  await assert.rejects(pending, /ALLOCATION_EXPECTED_CHANGED/);
});

void test('allocation export checks current context after actual XLSX serialization', async () => {
  const input = await allocationFixture('no-evidence');
  const result = (await replayAllocation(input)).result;
  const arrived = gate(), resume = gate();
  const serializer = new ExcelJS.Workbook().xlsx;
  const prototype = Object.getPrototypeOf(serializer) as typeof serializer;
  // Preserve the actual serializer and apply each workbook's original receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const original = prototype.writeBuffer;
  prototype.writeBuffer = async function (...args: Parameters<typeof original>) {
    const buffer = await original.apply(this, args);
    arrived.release();
    await resume.promise;
    return buffer;
  };
  try {
    const pending = exportAllocation(input, result);
    await arrived.promise;
    input.scope.account = 'CHANGED-AFTER-NATIVE-SERIALIZATION';
    resume.release();
    await assert.rejects(pending, /ALLOCATION_INPUT_CHANGED/);
  } finally {
    prototype.writeBuffer = original;
    resume.release();
  }
});

void test('allocation save checks current context after its native restore validation', async () => {
  const input = await allocationFixture('no-evidence');
  const arrived = gate(), resume = gate();
  // Preserve the native digest identity; the wrapper forwards its exact receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const original = crypto.subtle.digest;
  let calls = 0;
  crypto.subtle.digest = async function (...args: Parameters<typeof original>) {
    const digest = await original.apply(this, args);
    if (++calls === 4) { arrived.release(); await resume.promise; }
    return digest;
  };
  try {
    const pending = saveAllocation(input);
    await arrived.promise;
    input.scope.account = 'CHANGED-DURING-RESTORE';
    resume.release();
    await assert.rejects(pending, /ALLOCATION_INPUT_CHANGED/);
  } finally {
    crypto.subtle.digest = original;
    resume.release();
  }
});

void test('allocation cancellation precedes cache cloning and large decision metadata is refused', async () => {
  const input = await allocationFixture('no-evidence');
  Object.defineProperty(input.files[0], 'sheets', { get() { throw Error('Cache must not be cloned'); } });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(replayAllocation(input, cancelled.signal), /ALLOCATION_CANCELLED/);
  assert.equal((await replayAllocation(input)).result.events.length, 0);
  const large = await allocationFixture('no-evidence');
  large.scope.account = 'x'.repeat(9 * 1024 * 1024);
  await assert.rejects(replayAllocation(large), /ALLOCATION_INPUT_BUDGET/);
});

void test('pre-code handoff money truth uses independent minor-unit conservation and whole-decision undo', () => {
  for (const id of ['H4', 'H5', 'H8']) {
    const c = truth.requirements.find((r) => r.id === id)!;
    const active = c.allocate!.filter((_, index) => index !== c.undoDecisionIndex);
    const total = active.reduce((n, amount) => n + BigInt(amount), 0n);
    assert.equal(BigInt(c.paymentAvailable!) - total, BigInt(c.paymentRemaining!));
    assert.equal(BigInt(c.invoiceAvailable!) - total, BigInt(c.invoiceRemaining!));
    if (c.nextAllocate) assert.ok(BigInt(c.nextAllocate) > BigInt(c.paymentRemaining!));
  }
});
