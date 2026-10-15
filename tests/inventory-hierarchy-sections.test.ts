import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hierarchyInput, oracle } from './inventory-hierarchy-fixture.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import { reconcileStock } from '../lib/reconciliation/inventory-register.ts';
import { stockHierarchyCitationRows } from '../lib/reconciliation/inventory-hierarchy-evidence.ts';
import {
  isInventoryHierarchy,
  inventoryHierarchyScope,
} from '../lib/reconciliation/inventory-hierarchy-sections.ts';
for (const truth of oracle.cases) {
  void test('INV-1D financial and source ownership ' + truth.id, async () => {
    const input = await hierarchyInput(truth.id.slice(6));
    const checked = await replayStock(input),
      r = checked.result;
    assert.equal(r.financial, truth.financial, JSON.stringify(r.issues));
    assert.equal(r.review, 'needs-review');
    assert.ok(isInventoryHierarchy(input.files[0]));
    assert.deepEqual(
      inventoryHierarchyScope(input.files[0]),
      Object.fromEntries(
        Object.entries(input.scope).filter(([k]) => k !== 'confirmed'),
      ),
    );
    if (truth.financial === 'source-error') {
      assert.equal(r.totals, null);
      assert.ok(r.issues.length);
      for (const c of r.comparisons)
        for (const [k, v] of Object.entries(c))
          if (k.endsWith('Minor')) assert.equal(v, null);
    } else {
      assert.deepEqual(r.totals, truth.totals);
      assert.deepEqual(
        r.comparisons.map((c) => [
          c.account,
          c.dimensions,
          c.registerMinor,
          c.debitMinor,
          c.creditMinor,
          c.glMinor,
          c.differenceMinor,
        ]),
        truth.comparisons,
      );
      assert.deepEqual(
        r.records[0].map((v) => v.values),
        truth.facts.map((v: { values: unknown }) => v.values),
      );
      assert.equal(r.hierarchyEvidence!.records.length, 5);
      for (const e of r.hierarchyEvidence!.records) {
        assert.equal(
          e.derivedDimensions,
          e.parent.key +
            '=' +
            e.parent.value.raw +
            ';batch=' +
            e.batch.value.raw,
        );
        assert.ok(
          e.parent.value.row < e.batch.value.row &&
            e.batch.value.row < e.row &&
            e.row < e.batchEnd!.row &&
            e.batchEnd!.row <= e.parentEnd!.row,
        );
        assert.deepEqual(JSON.parse(e.recordId).slice(4), [e.row]);
        for (const c of [
          e.parent.label,
          e.parent.value,
          e.batch.label,
          e.batch.value,
          e.parentEnd!,
          e.batchEnd!,
        ]) {
          assert.ok(c.row <= checked.state.files[0].sheets[0].rows.length);
          assert.equal(
            c.raw,
            checked.state.files[0].sheets[0].rows[c.row - 1][c.column - 1],
          );
          assert.notEqual(c.raw, '');
        }
        for (const [field, c] of Object.entries(e.fields)) {
          assert.equal(c.sourceHash, input.files[0].sha256);
          assert.equal(
            c.raw,
            checked.state.files[0].sheets[0].rows[c.row - 1][c.column - 1],
          );
          assert.equal(e.headers[field].raw, field);
          assert.ok(e.headers[field].row < e.row);
        }
      }
      const citations = stockHierarchyCitationRows(r.hierarchyEvidence!);
      assert.ok(citations.some((c) => c[9] === 'dimension-value'));
      assert.ok(citations.some((c) => c[9] === 'boundary'));
      const restored = await restoreStock(await saveStock(checked.state));
      assert.deepEqual(restored.result, r);
      await exportStock(restored.state, restored.result);
    }
    assert.equal(new Set(r.memberIds).size, r.memberIds.length);
    for (const f of checked.state.files)
      assert.equal(
        f.sha256,
        createHash('sha256').update(new Uint8Array(f.original!)).digest('hex'),
      );
  });
}
void test('INV-1D parent switch drops old batch and detail header; an unknown row drops batch authority', async () => {
  const a = (await replayStock(await hierarchyInput('N03'))).result;
  assert.ok(!a.records[0].some((r) => r.values[0] === '9'));
  const b = (await replayStock(await hierarchyInput('N08'))).result;
  assert.ok(
    !b.records[0].some(
      (r) => r.values[0] === '009' && r.values[1] === 'warehouse=W1;batch=B7',
    ),
  );
});
void test('INV-1D equal sums retain wrong dimension differences and cannot be accepted', async () => {
  const input = await hierarchyInput('N01');
  input.completeness = {
    confirmed: true,
    reference: 'SYN',
    note: 'Synthetic source coverage',
  };
  const a = await replayStock(input);
  assert.deepEqual(a.result.totals, { registerMinor: 225000, glMinor: 225000 });
  assert.deepEqual(
    a.result.comparisons.map((c) => c.differenceMinor).sort((a, b) => a! - b!),
    [-20000, 0, 0, 0, 20000],
  );
  a.state.events = [
    {
      id: 'invalid',
      type: 'accept',
      context: a.result.context,
      memberIds: a.result.memberIds,
      at: '2026-11-01T00:00:00.000Z',
      reference: 'SYN',
      note: 'Invalid difference approval',
    },
  ];
  assert.throws(() => reconcileStock(a.state));
});
void test('INV-1D accept, undo and native restoration retain exact original bytes and dimensions', async () => {
  for (const code of ['P01', 'P04']) {
    const input = await hierarchyInput(code);
    input.completeness = {
      confirmed: true,
      reference: 'SYN',
      note: 'Synthetic source coverage',
    };
    const a = await replayStock(input);
    assert.equal(a.result.financial, 'ready', JSON.stringify(a.result.issues));
    a.state.events = [
      {
        id: 'INV1D-ACCEPT',
        type: 'accept',
        context: a.result.context,
        memberIds: a.result.memberIds,
        at: '2026-11-01T00:00:00.000Z',
        reference: 'SYN-INV1D',
        note: 'Synthetic independent source review',
      },
    ];
    const accepted = await replayStock(a.state);
    assert.equal(accepted.result.review, 'accepted');
    const restored = await restoreStock(await saveStock(accepted.state));
    assert.deepEqual(restored.result, accepted.result);
    for (let i = 0; i < 4; i++)
      assert.deepEqual(
        restored.state.files[i].original,
        a.state.files[i].original,
      );
    accepted.state.events.push({
      ...accepted.state.events[0],
      id: 'INV1D-UNDO',
      type: 'undo',
      at: '2026-11-01T00:01:00.000Z',
    });
    const undone = await replayStock(accepted.state);
    assert.equal(undone.result.review, 'needs-review');
    assert.deepEqual(undone.result.records, accepted.result.records);
  }
});

void test('INV-1D implicit parent boundary cannot inherit a prior batch when its new child header is absent', async () => {
  const input = await hierarchyInput('P05');
  const raw = new TextDecoder().decode(input.files[0].original!);
  assert.ok(raw.includes('Warehouse,W2\nBatch,B7\n'));
  input.files[0] = await readStockFile(
    'register.csv',
    new TextEncoder().encode(
      raw.replace('Warehouse,W2\nBatch,B7\n', 'Warehouse,W2\n'),
    ).buffer,
  );
  const r = (await replayStock(input)).result;
  assert.equal(r.financial, 'source-error');
  assert.ok(!r.records[0].some((v) => v.values[0] === '9'));
});
void test('INV-1D duplicate zero item in the same dimension cannot disappear behind balanced totals', async () => {
  const input = await hierarchyInput('P01');
  const raw = new TextDecoder().decode(input.files[0].original!);
  const line = '00,0,EA,0,0.00,VAL-Z';
  assert.ok(raw.includes(line));
  input.files[0] = await readStockFile(
    'register.csv',
    new TextEncoder().encode(raw.replace(line, line + '\n' + line)).buffer,
  );
  const r = (await replayStock(input)).result;
  assert.equal(r.financial, 'source-error');
  assert.ok(r.issues.some((i) => i.code === 'DUPLICATE'));
});
void test('INV-1D explicit batch end prevents a detail row from borrowing a closed child scope', async () => {
  const r = (await replayStock(await hierarchyInput('N07'))).result;
  assert.equal(r.financial, 'source-error');
  assert.equal(r.records[0].filter((v) => v.values[0] === '0009').length, 1);
});
void test('INV-1D Plant is a distinct explicit dimension key, never a guessed Warehouse alias', async () => {
  const input = await hierarchyInput('P01');
  input.files = (await Promise.all(
    input.files.map((f) =>
      readStockFile(
        f.name,
        new TextEncoder().encode(
          new TextDecoder()
            .decode(f.original!)
            .replaceAll('Warehouse', 'Plant')
            .replaceAll('warehouse', 'plant'),
        ).buffer,
      ),
    ),
  )) as typeof input.files;
  const r = (await replayStock(input)).result;
  assert.equal(r.financial, 'ready');
  assert.deepEqual(r.totals, { registerMinor: 225000, glMinor: 225000 });
  assert.ok(
    r.records[0].every((v) => (v.values[1] as string).startsWith('plant=')),
  );
});
void test('INV-1D repeated header between two children owns the later child without changing financial membership', async () => {
  const input = await hierarchyInput('P01'),
    raw = new TextDecoder().decode(input.files[0].original!),
    line = '009,2.50,KG,2,600.00,VAL-B';
  assert.ok(raw.includes(line));
  const changed = raw.replace(
    line,
    'Item ID,Quantity,Unit,Quantity precision,Posted value,Valuation reference\n' +
      line,
  );
  input.files[0] = await readStockFile(
    'register.csv',
    new TextEncoder().encode(changed).buffer,
  );
  const r = (await replayStock(input)).result;
  assert.equal(r.financial, 'ready');
  assert.deepEqual(
    r.records[0].map((v) => v.values),
    oracle.cases
      .find((c: { id: string }) => c.id === 'INV1D-P01')
      .facts.map((f: { values: unknown }) => f.values),
  );
  const [first, second] = r.hierarchyEvidence!.records;
  assert.notEqual(first.headers['Item ID'].row, second.headers['Item ID'].row);
  assert.equal(second.headers['Item ID'].row, second.row - 1);
  assert.equal(first.batch.value.row, second.batch.value.row);
});
