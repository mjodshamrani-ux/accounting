import test from 'node:test';
import assert from 'node:assert/strict';
import { pngFixture, draftFixture } from './visual-evidence-fixture.ts';
import {
  createVisualReview,
  editVisualRegion,
  confirmVisualRegion,
  type VisualReview,
} from '../lib/reconciliation/visual-review.ts';
import {
  createVisualTable,
  editVisualTableRow,
  tableCellCandidates,
  confirmVisualTableCoverage,
  confirmVisualTableExclusion,
  saveVisualTable,
  restoreVisualTable,
  visualTableCounts,
  type TableGrid,
  type VisualTable,
} from '../lib/reconciliation/visual-table.ts';
import { assertNativeAccountingSource } from '../lib/reconciliation/source-boundary.ts';

const at = '2026-10-03T10:00:00.000Z';
const grid: TableGrid = {
  region: { x0: 0, y0: 0, x1: 80, y1: 60 },
  rowCuts: [0, 20, 40, 60],
  columnCuts: [0, 20, 40, 60, 80],
  roles: ['reference', 'date', 'amount', 'balance'],
};
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type TamperedTable = Mutable<VisualTable> & {
  image: Mutable<Extract<VisualReview, { version: 2 }>>;
};
async function imageFixture(): Promise<VisualReview> {
  const image = pngFixture(),
    draft = structuredClone(draftFixture(image.bytes));
  (draft.pages[0].words as unknown[]) = [];
  let r = await createVisualReview(draft, image.bytes);
  for (const [i, role, literal] of [
    [0, 'reference', 'INV-001'],
    [1, 'date', '2026-08-31'],
    [2, 'amount', '-٢٥٠٫٠٠'],
    [3, 'amount', '٩٩٩٩٫٠٠'],
  ] as const) {
    r = editVisualRegion(r, `region:${i + 1}`, role, literal, {
      x0: i * 20 + 1,
      y0: 2,
      x1: i * 20 + 19,
      y1: 18,
    });
    r = await confirmVisualRegion(r, `region:${i + 1}`, at);
  }
  return r;
}
async function classified() {
  let t = await createVisualTable(await imageFixture(), grid);
  t = editVisualTableRow(t, 0, {
    disposition: 'movement',
    note: '',
    cells: ['region:1', 'region:2', 'region:3', 'region:4'],
  });
  t = editVisualTableRow(t, 1, {
    disposition: 'unreadable',
    note: 'Unreadable amount in original',
    cells: grid.roles.map(() => null),
  });
  t = editVisualTableRow(t, 2, {
    disposition: 'non-movement',
    note: 'Printed closing total',
    cells: grid.roles.map(() => null),
  });
  return confirmVisualTableExclusion(t, 2, at);
}
void test('complete row inventory retains unreadable rows and separates movement amounts from running balances', async () => {
  const t = await confirmVisualTableCoverage(await classified(), at);
  assert.deepEqual(visualTableCounts(t), {
    movements: 1,
    excluded: 1,
    unreadable: 1,
    unclassified: 0,
    missingCells: 0,
    uncheckedExclusions: 0,
    unassignedCrops: 0,
  });
  assert.equal(t.status, 'table-evidence-only');
  assert.equal(t.rows[1].disposition, 'unreadable');
  assert.ok(t.coverage);
  assert.equal('sheets' in t, false);
  assert.deepEqual(await restoreVisualTable(await saveVisualTable(t)), t);
  assert.ok(Object.isFrozen(t.rows[0].cells));
  assert.ok(Object.isFrozen(t.grid.rowCuts));
});
void test('missing cells and untouched rows cannot be mistaken for complete values', async () => {
  const fresh = await createVisualTable(await imageFixture(), grid);
  assert.equal(visualTableCounts(fresh).unclassified, 3);
  await assert.rejects(confirmVisualTableCoverage(fresh, at));
  let t = await classified();
  t = editVisualTableRow(t, 0, {
    disposition: 'movement',
    note: '',
    cells: ['region:1', 'region:2', null, 'region:4'],
  });
  await assert.rejects(confirmVisualTableCoverage(t, at));
  assert.equal(visualTableCounts(t).unassignedCrops, 1);
  assert.equal(visualTableCounts(t).missingCells, 1);
  assert.equal(t.rows[0].cells[2], null);
});
void test('geometry covers every vertical and horizontal band exactly once and rejects gaps, zero bands and limits', async () => {
  const image = await imageFixture();
  const invalid = [
    { ...grid, rowCuts: [1, 20, 40, 60] },
    { ...grid, rowCuts: [0, 20, 40, 59] },
    { ...grid, rowCuts: [0, 20, 20, 60] },
    { ...grid, rowCuts: [0, 40, 20, 60] },
    { ...grid, rowCuts: [0, 20.5, 60] },
    { ...grid, columnCuts: [0, 20, 40, 60, 81] },
    { ...grid, roles: ['reference', 'date', 'balance', 'currency'] },
    { ...grid, roles: ['reference', 'date', 'amount', 'amount'] },
    { ...grid, rowCuts: Array.from({ length: 202 }, (_, i) => i) },
    { ...grid, region: { ...grid.region, x1: 81 } },
  ];
  for (const g of invalid)
    await assert.rejects(createVisualTable(image, g as TableGrid));
});
void test('amount-vs-balance swaps, wrong row, wrong role, unknown or unreviewed region and double assignment are rejected', async () => {
  const image = await imageFixture(),
    t = await createVisualTable(image, grid);
  assert.deepEqual(
    tableCellCandidates(t, 0, 2).map((c) => c.id),
    ['region:3'],
  );
  for (const cells of [
    ['region:1', 'region:2', 'region:4', 'region:3'],
    ['region:1', 'region:2', 'region:1', 'region:4'],
    ['region:1', 'region:2', 'region:99', 'region:4'],
  ])
    assert.throws(() =>
      editVisualTableRow(t, 0, { disposition: 'movement', note: '', cells }),
    );
  assert.throws(() =>
    editVisualTableRow(t, 1, {
      disposition: 'movement',
      note: '',
      cells: ['region:1', null, null, null],
    }),
  );
  const edited = editVisualRegion(image, 'region:3', 'amount', '٢٥٠٫٠٠', {
    x0: 41,
    y0: 2,
    x1: 59,
    y1: 18,
  });
  const changed = await createVisualTable(edited, grid);
  assert.deepEqual(tableCellCandidates(changed, 0, 2), []);
});
void test('a crop reaching into another column or another row cannot be assigned even if its literal was reviewed', async () => {
  let image = await imageFixture();
  image = editVisualRegion(image, 'region:3', 'amount', '-٢٥٠٫٠٠', {
    x0: 40,
    y0: 2,
    x1: 61,
    y1: 21,
  });
  image = await confirmVisualRegion(image, 'region:3', at);
  const t = await createVisualTable(image, grid);
  assert.deepEqual(tableCellCandidates(t, 0, 2), []);
});
void test('exclusions require a reason and their own source-bound review; unreadable rows cannot acquire exclusion proof', async () => {
  const t = await createVisualTable(await imageFixture(), grid);
  for (const disposition of ['non-movement', 'unreadable'] as const)
    assert.throws(() =>
      editVisualTableRow(t, 1, {
        disposition,
        note: '',
        cells: grid.roles.map(() => null),
      }),
    );
  let pending = editVisualTableRow(t, 0, {
    disposition: 'non-movement',
    note: 'Total',
    cells: grid.roles.map(() => null),
  });
  pending = editVisualTableRow(pending, 1, {
    disposition: 'unreadable',
    note: 'Damaged',
    cells: grid.roles.map(() => null),
  });
  pending = editVisualTableRow(pending, 2, {
    disposition: 'movement',
    note: '',
    cells: grid.roles.map(() => null),
  });
  await assert.rejects(confirmVisualTableCoverage(pending, at));
  await assert.rejects(confirmVisualTableExclusion(pending, 1, at));
  const reviewed = await confirmVisualTableExclusion(pending, 0, at);
  assert.ok((await confirmVisualTableCoverage(reviewed, at)).coverage);
});
void test('row changes revoke inventory proof and the changed exclusion, while source or geometry changes create a fresh inventory', async () => {
  const t = await confirmVisualTableCoverage(await classified(), at);
  const changed = editVisualTableRow(t, 2, {
    disposition: 'non-movement',
    note: 'Opening total',
    cells: grid.roles.map(() => null),
  });
  assert.equal(changed.coverage, null);
  assert.equal(changed.rows[2].review, null);
  const fresh = await createVisualTable(t.image, {
    ...grid,
    rowCuts: [0, 30, 60],
  });
  assert.notEqual(fresh.revision, t.revision);
  assert.equal(fresh.coverage, null);
  assert.equal(visualTableCounts(fresh).unclassified, 2);
  const altered = editVisualRegion(t.image, 'region:3', 'amount', '٢٥٠٫٠٠', {
    x0: 41,
    y0: 2,
    x1: 59,
    y1: 18,
  });
  const newImage = await createVisualTable(altered, grid);
  assert.notEqual(newImage.revision, t.revision);
  assert.equal(visualTableCounts(newImage).unclassified, 3);
});
void test('restore rejects changed rows, grid, cells, source, raw observations, fingerprints, missing rows and added authority', async () => {
  const t = await confirmVisualTableCoverage(await classified(), at);
  const mutate: ((p: TamperedTable) => unknown)[] = [
    (p) => p.rows.pop(),
    (p) => p.rows.push(p.rows[0]),
    (p) => (p.rows[1].disposition = 'non-movement'),
    (p) => (p.rows[0].cells[2] = 'region:4'),
    (p) => (p.rows[2].note = 'Opening total'),
    (p) => (p.rows[2].review!.fingerprint = '0'.repeat(64)),
    (p) => (p.coverage!.fingerprint = '0'.repeat(64)),
    (p) => (p.coverage!.checkedAt = '2026-02-30T00:00:00.000Z'),
    (p) => p.grid.rowCuts[1]++,
    (p) => p.grid.roles.reverse(),
    (p) => (p.image.regions[2].value = '٢٥٠٫٠٠'),
    (p) => (p.image.source.sha256 = '0'.repeat(64)),
    (p) => Reflect.set(p, 'status', 'approved'),
    (p) => Object.assign(p, { sheets: [] }),
    (p) => (p.rows[0].id = 'row:2'),
    (p) => Object.assign(p.rows[0], { approved: true }),
  ];
  for (const change of mutate) {
    const p = structuredClone(t) as TamperedTable;
    change(p);
    await assert.rejects(restoreVisualTable(encode(p)));
  }
});
void test('empty pending inventory is explicitly serializable without acquiring completeness or financial authority', async () => {
  const t = await createVisualTable(await imageFixture(), grid);
  assert.deepEqual(await restoreVisualTable(await saveVisualTable(t)), t);
  assert.equal(t.coverage, null);
  for (const p of [
    t,
    {
      ...t,
      sheets: [{ rows: [['INV-001', '250']] }],
      original: new ArrayBuffer(0),
    },
  ])
    assert.throws(() => assertNativeAccountingSource(p));
});
void test('caller changes across an async create cannot rewrite the geometry; plain copied table objects are not registered', async () => {
  const image = await imageFixture(),
    input = structuredClone(grid);
  const pending = createVisualTable(image, input);
  (input.rowCuts as number[])[1] = 19;
  const t = await pending;
  assert.equal(t.grid.rowCuts[1], 20);
  assert.throws(() => visualTableCounts(structuredClone(t)));
  await assert.rejects(createVisualTable(structuredClone(image), grid));
  await assert.rejects(saveVisualTable(structuredClone(t)));
});
void test('getters and sparse arrays are rejected before execution and invalid receipts cannot use non-canonical dates', async () => {
  const image = await imageFixture();
  let calls = 0;
  const injected = { ...grid };
  Object.defineProperty(injected, 'rowCuts', {
    enumerable: true,
    get() {
      calls++;
      return grid.rowCuts;
    },
  });
  await assert.rejects(createVisualTable(image, injected));
  assert.equal(calls, 0);
  const sparse = [0, 20, 60];
  Reflect.deleteProperty(sparse, '1');
  await assert.rejects(createVisualTable(image, { ...grid, rowCuts: sparse }));
  await assert.rejects(
    confirmVisualTableCoverage(await classified(), '2026-02-30T00:00:00.000Z'),
  );
});
