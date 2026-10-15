import test from 'node:test';
import assert from 'node:assert/strict';
import { columnInput, oracle } from './inventory-column-fixture.ts';
import {
  replayStock,
  saveStock,
  restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  isInventoryColumnHierarchy,
  inventoryColumnScope,
  STOCK_COLUMN_FAMILY,
} from '../lib/reconciliation/inventory-column-hierarchy.ts';
for (const truth of oracle.cases.filter((c: { id: string }) =>
  /^INV1E-[CD]/.test(c.id),
)) {
  void test(
    'INV-1E money, quantity, dimension and membership ' + truth.id,
    async () => {
      const input = await columnInput(truth.id.slice(6));
      const checked = await replayStock(input),
        r = checked.result;
      assert.equal(r.financial, truth.financial, JSON.stringify(r.issues));
      assert.equal(r.review, 'needs-review');
      if (truth.financial === 'source-error') {
        assert.equal(r.totals, null);
        assert.ok(r.issues.length);
        for (const c of r.comparisons)
          for (const [k, v] of Object.entries(c))
            if (k.endsWith('Minor')) assert.equal(v, null);
      } else {
        assert.ok(isInventoryColumnHierarchy(input.files[0]));
        assert.deepEqual(
          inventoryColumnScope(input.files[0]),
          Object.fromEntries(
            Object.entries(input.scope).filter(([k]) => k !== 'confirmed'),
          ),
        );
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
          r.records[0].map((r) => r.values),
          truth.facts.map((f: { values: unknown }) => f.values),
        );
        assert.equal(r.columnEvidence!.records.length, 6);
        for (const [n, e] of r.columnEvidence!.records.entries()) {
          const f = truth.facts[n];
          assert.deepEqual(JSON.parse(e.recordId), [
            STOCK_COLUMN_FAMILY,
            0,
            input.files[0].sha256,
            0,
            e.row,
            e.column,
          ]);
          assert.deepEqual(
            [e.parent.value.row, e.parent.value.column, e.parent.value.raw],
            f.parent,
          );
          assert.deepEqual(
            [e.batch.value.row, e.batch.value.column, e.batch.value.raw],
            f.batch,
          );
          assert.deepEqual([e.axis.row, e.axis.column, e.axis.raw], f.axis);
          assert.equal(e.panelEnd.row, f.panelEnd);
          assert.equal(e.derivedDimensions, f.values[1]);
          for (const [k, pair] of Object.entries(e.fields))
            for (const role of ['value', 'role'] as const)
              assert.deepEqual(
                [pair[role].row, pair[role].column, pair[role].raw],
                f.fields[k][role],
              );
        }
        for (const link of truth.links) {
          const mapping = r.records[1].find((r) => r.row === link.mappingRow)!;
          const policy = r.records[2].find((r) => r.row === link.policyRow)!;
          assert.equal(mapping.values[0], link.mapping);
          assert.equal(policy.values[0], link.policy);
          assert.deepEqual(mapping.values.slice(1, 3), link.key);
          assert.deepEqual(mapping.values.slice(3, 5), link.account);
        }
        assert.deepEqual(
          (await restoreStock(await saveStock(checked.state))).result,
          r,
        );
      }
      assert.equal(new Set(r.memberIds).size, r.memberIds.length);
    },
  );
}
