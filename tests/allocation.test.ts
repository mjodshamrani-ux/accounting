import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileAllocation,
  type AllocationEvent,
} from '../lib/reconciliation/allocation.ts';
import {
  replayAllocation,
  saveAllocation,
  restoreAllocation,
  exportAllocation,
} from '../lib/reconciliation/allocation-io.ts';
import {
  allocationFixture,
  allocationTruth,
  fixtureEvent,
  finishedFixture,
} from '../audit/allocation/fixtures.ts';

void test('allocation: all 22 frozen contracts conserve value and reject decisions atomically', async () => {
  for (const c of allocationTruth.cases) {
    const state = await allocationFixture(c.name),
      before = JSON.stringify(state.files);
    let result = reconcileAllocation(state);
    assert.equal(result.status, c.status, c.name);
    for (const [index, action] of c.actions.entries()) {
      const event = fixtureEvent(action, result),
        previous = structuredClone(result);
      if (action.reject) {
        assert.throws(
          () =>
            reconcileAllocation({ ...state, events: [...state.events, event] }),
          /ALLOCATION_/,
          c.name,
        );
        assert.deepEqual(reconcileAllocation(state), previous);
      } else {
        state.events.push(event);
        result = reconcileAllocation(state);
      }
      assert.deepEqual(result.activeDecisions, c.history[index].active, c.name);
    }
    if (c.balances)
      for (const i of result.items) {
        const b = result.balances.find((b) => b.id === i.id)!;
        assert.deepEqual(
          [b.original, b.available, b.allocated, b.remaining],
          c.balances[`${i.side}:${i.reference}`],
          c.name,
        );
        assert.equal(b.allocated + b.remaining, b.available);
      }
    assert.deepEqual(
      result.links.map((l) => [
        result.items.find((i) => i.id === l.paymentId)!.reference,
        result.items.find((i) => i.id === l.invoiceId)!.reference,
        l.amount,
      ]),
      c.links,
    );
    assert.equal(
      JSON.stringify(state.files),
      before,
      'source amounts unchanged',
    );
  }
});
void test('allocation: proof membership and exact amount cannot be replaced by equal-money alternatives', async () => {
  const s = await allocationFixture('one-to-many'),
    r = reconcileAllocation(s),
    e = fixtureEvent({ type: 'remittance', id: 'D1', proofs: ['R1'] }, r);
  assert.equal(e.type, 'allocate');
  if (e.type !== 'allocate') return;
  for (const edit of [
    (x: typeof e) => {
      x.links[0].invoiceId = r.items.find((i) => i.reference === 'I2')!.id;
    },
    (x: typeof e) => {
      x.links[0].amount = 35000;
    },
    (x: typeof e) => {
      x.links[0].basis.reference = 'R2';
    },
    (x: typeof e) => {
      x.links[0].basis.proofId = 'unknown';
    },
  ]) {
    const bad = structuredClone(e);
    edit(bad);
    assert.throws(() => reconcileAllocation({ ...s, events: [bad] }), /PROOF/);
  }
  const many = await allocationFixture('many-to-one'),
    mr = reconcileAllocation(many),
    me = fixtureEvent({ type: 'remittance', id: 'D1', proofs: ['R1'] }, mr);
  if (me.type === 'allocate') {
    me.links[0].paymentId = mr.items.find((i) => i.reference === 'P2')!.id;
    assert.throws(
      () => reconcileAllocation({ ...many, events: [me] }),
      /PROOF/,
    );
  }
  const duplicate = structuredClone(e);
  duplicate.links.push(structuredClone(duplicate.links[0]));
  assert.throws(
    () => reconcileAllocation({ ...s, events: [duplicate] }),
    /PROOF/,
  );
});
void test('allocation: human evidence, positive money, complete scope, IDs and device time are mandatory', async () => {
  const s = await allocationFixture('no-evidence'),
    r = reconcileAllocation(s),
    e = fixtureEvent(
      { type: 'human', id: 'D1', links: [['P1', 'I1', 100]] },
      r,
    );
  if (e.type !== 'allocate') return;
  for (const edit of [
    (x: typeof e) => {
      x.links[0].basis.reason = '';
    },
    (x: typeof e) => {
      x.links[0].basis.reference = '';
    },
    (x: typeof e) => {
      x.links[0].basis.proofId = 'fake';
    },
    (x: typeof e) => {
      x.links[0].amount = 0;
    },
    (x: typeof e) => {
      x.links[0].amount = 0.1;
    },
    (x: typeof e) => {
      x.links[0].paymentId = x.links[0].invoiceId;
    },
    (x: typeof e) => {
      x.context = 'STALE';
    },
    (x: typeof e) => {
      x.at = '2026-02-30T00:00:00.000Z';
    },
    (x: typeof e) => {
      x.note = '';
    },
  ]) {
    const bad = structuredClone(e);
    edit(bad);
    assert.throws(
      () => reconcileAllocation({ ...s, events: [bad] }),
      /ALLOCATION_/,
    );
  }
  assert.throws(() => reconcileAllocation({ ...s, events: [e, e] }), /EVENT/);
  assert.throws(
    () =>
      reconcileAllocation({ ...s, scope: { ...s.scope, confirmed: false } }),
    /SCOPE/,
  );
  assert.throws(
    () =>
      reconcileAllocation({
        ...s,
        readings: s.readings.map((v) => ({
          ...v,
          confirmed: false,
        })) as typeof s.readings,
      }),
    /READING/,
  );
});
void test('allocation: errors prevent all decisions while retaining original inventory', async () => {
  const s = await allocationFixture('currency-mismatch'),
    r = reconcileAllocation(s);
  assert.equal(r.status, 'source-error');
  assert.ok(r.inventory.some((i) => i.kind === 'error'));
  const clean = await allocationFixture('no-evidence'),
    e = fixtureEvent(
      { type: 'human', id: 'D1', links: [['P1', 'I1', 100]] },
      reconcileAllocation(clean),
    );
  assert.throws(
    () => reconcileAllocation({ ...s, events: [{ ...e, context: r.context }] }),
    /SOURCE_ERRORS/,
  );
});
void test('allocation: native numeric/date XLSX preserves capacities, guards formulas hiding and identities', async () => {
  const s = await allocationFixture('one-to-many');
  for (const side of [0, 1, 2] as const) {
    const b = new ExcelJS.Workbook(),
      w = b.addWorksheet('Native');
    w.addRows(s.files[side].sheets[0].rows);
    for (let r = 2; r <= w.rowCount; r++)
      for (let c = 1; c <= w.columnCount; c++) {
        const cell = w.getCell(r, c),
          h = w.getCell(1, c).text;
        if (/amount$/i.test(h)) {
          cell.value = Number(cell.value);
          cell.numFmt = '0.00';
        }
        if (/date$/i.test(h)) {
          cell.value = new Date(cell.text + 'T00:00:00.000Z');
          cell.numFmt = 'yyyy-mm-dd';
        }
      }
    s.files[side] = await readFile(
      `native-${side}.xlsx`,
      new Uint8Array(await b.xlsx.writeBuffer()).buffer,
    );
  }
  let r = reconcileAllocation(s);
  assert.equal(r.status, 'ready');
  s.events.push(
    fixtureEvent(
      { type: 'remittance', id: 'D1', proofs: ['R1', 'R2', 'R3'] },
      r,
    ),
  );
  r = reconcileAllocation(s);
  await assert.doesNotReject(async () => {
    const restored = await restoreAllocation(await saveAllocation(s));
    assert.deepEqual(restored.result, r);
    assert.ok((await exportAllocation(s, r)).byteLength);
  }, 'The known-valid native originals must save, restore and export without trusting cached tables.');
  for (const field of ['formula', 'hidden', 'identity-format', 'precision']) {
    const input = await allocationFixture('one-to-many'),
      b = new ExcelJS.Workbook(),
      w = b.addWorksheet('Unsafe');
    w.addRows(input.files[0].sheets[0].rows);
    if (field === 'formula')
      w.getCell(2, 11).value = { formula: '1000', result: 1000 };
    if (field === 'hidden') w.getRow(2).hidden = true;
    if (field === 'identity-format') {
      w.getCell(2, 1).value = 1;
      w.getCell(2, 1).numFmt = '0.00';
    }
    if (field === 'precision') w.getCell(2, 11).value = 1000.001;
    input.files[0] = await readFile(
      'unsafe.xlsx',
      new Uint8Array(await b.xlsx.writeBuffer()).buffer,
    );
    assert.equal(reconcileAllocation(input).status, 'source-error', field);
  }
});
void test('allocation: all native header issues are guarded before blank classification', async () => {
  const s = await allocationFixture('one-to-many'),
    b = new ExcelJS.Workbook(),
    w = b.addWorksheet('Unsafe');
  w.addRows(s.files[0].sheets[0].rows);
  w.getCell(1, 12).value = { formula: '"Payment ID"' };
  s.files[0] = await readFile(
    'header.xlsx',
    new Uint8Array(await b.xlsx.writeBuffer()).buffer,
  );
  assert.throws(() => reconcileAllocation(s), /COLUMNS/);
  const good = await allocationFixture('no-evidence'),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Unsafe');
  sheet.addRows(good.files[2].sheets[0].rows);
  sheet.getCell(2, 11).value = { formula: '400' };
  good.files[2] = await readFile(
    'blank-formula.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.equal(reconcileAllocation(good).status, 'source-error');
});
void test('allocation: original replay rejects cache forgery, stale exports and old-source decisions', async () => {
  const { state: s, result: r } = await finishedFixture(
    allocationTruth.cases.find((c) => c.name === 'partial')!,
  );
  const forged = structuredClone(s);
  forged.files[0].sheets[0].rows[1][9] = '700';
  assert.deepEqual((await replayAllocation(forged)).result, r);
  const session = await saveAllocation(s),
    restored = await restoreAllocation(session);
  assert.deepEqual(restored.result, r);
  await assert.rejects(
    exportAllocation(s, { ...r, balances: [] }),
    /STALE_RESULT/,
  );
  const p = JSON.parse(new TextDecoder().decode(session));
  p.result = r;
  await assert.rejects(
    restoreAllocation(new TextEncoder().encode(JSON.stringify(p)).buffer),
    /SESSION/,
  );
  delete p.result;
  p.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    restoreAllocation(new TextEncoder().encode(JSON.stringify(p)).buffer),
    /HASH/,
  );
  const old = structuredClone(s);
  old.scope = { ...old.scope, party: 'Other' };
  assert.throws(() => reconcileAllocation(old), /SOURCE_ERRORS/);
  const changed = structuredClone(s);
  changed.readings[0].sheet = 1;
  changed.files[0].sheets.push(structuredClone(changed.files[0].sheets[0]));
  assert.throws(() => reconcileAllocation(changed), /EVENT/);
});
void test('allocation: undo preserves history and never allows undoing an undo', async () => {
  const s = await allocationFixture('undo'),
    c = allocationTruth.cases.find((c) => c.name === 'undo')!;
  for (const action of c.actions.slice(0, 2))
    s.events.push(fixtureEvent(action, reconcileAllocation(s)));
  const r = reconcileAllocation(s);
  assert.equal(r.links.length, 0);
  assert.equal(r.events.length, 2);
  assert.ok(r.balances.every((b) => b.allocated === 0));
  const undo: AllocationEvent = {
    type: 'undo',
    id: 'U2',
    context: r.context,
    at: '2026-10-06T18:00:00.000Z',
    note: 'Synthetic undo',
    target: 'U1',
  };
  assert.throws(
    () => reconcileAllocation({ ...s, events: [...s.events, undo] }),
    /UNDO/,
  );
});

void test('allocation: another payment of the same capacity cannot borrow remittance evidence', async () => {
  const s = await allocationFixture('one-to-many');
  const rows = structuredClone(s.files[0].sheets[0].rows);
  rows.push([...rows[1]]);
  rows[2][0] = 'P2';
  s.files[0] = await readFile(
    'two-payments.csv',
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const r = reconcileAllocation(s),
    e = fixtureEvent({ type: 'remittance', id: 'D1', proofs: ['R1'] }, r);
  if (e.type !== 'allocate') return;
  e.links[0].paymentId = r.items.find((i) => i.reference === 'P2')!.id;
  assert.throws(() => reconcileAllocation({ ...s, events: [e] }), /PROOF/);
});

void test('allocation: a damaged unrelated row blocks approval of otherwise valid members', async () => {
  const s = await allocationFixture('one-to-many');
  const rows = structuredClone(s.files[1].sheets[0].rows),
    extra = [...rows[1]];
  extra[0] = 'I-BAD';
  extra[6] = 'USD';
  rows.push(extra);
  s.files[1] = await readFile(
    'damaged-invoices.csv',
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const r = reconcileAllocation(s);
  assert.equal(r.status, 'source-error');
  const e = fixtureEvent({ type: 'remittance', id: 'D1', proofs: ['R1'] }, r);
  assert.throws(
    () => reconcileAllocation({ ...s, events: [e] }),
    /SOURCE_ERRORS/,
  );
});

void test('allocation: 20k source capacity retains every item and source cell without allocating it', async () => {
  const s = await allocationFixture('no-evidence'),
    head = s.files[1].sheets[0].rows[0],
    line = s.files[1].sheets[0].rows[1];
  const rows = [
    head,
    ...Array.from({ length: 19999 }, (_, i) => {
      const r = [...line];
      r[0] = `I-${i}`;
      return r;
    }),
  ];
  s.files[1] = await readFile(
    'capacity.csv',
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
  const result = reconcileAllocation(s);
  assert.equal(result.status, 'ready');
  assert.equal(result.items.filter((i) => i.side === 1).length, 19999);
  assert.equal(result.inventory.filter((i) => i.side === 1).length, 20000);
  assert.equal(result.links.length, 0);
  assert.ok(
    result.balances.every(
      (b) => b.allocated === 0 && b.remaining === b.available,
    ),
  );
  assert.ok(result.items.every((i) => i.traces.length === 2));
});

void test('allocation: a cached formula header remains inadmissible even when its text names the expected role', async () => {
  const s = await allocationFixture('one-to-many'),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Unsafe');
  sheet.addRows(s.files[0].sheets[0].rows);
  sheet.getCell(1, 1).value = { formula: '"Payment ID"', result: 'Payment ID' };
  s.files[0] = await readFile(
    'formula-header.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.throws(() => reconcileAllocation(s), /COLUMNS/);
});

void test('allocation: non-visible reasons and unexpected event fields never become human evidence', async () => {
  const s = await allocationFixture('no-evidence'),
    r = reconcileAllocation(s),
    e = fixtureEvent(
      { type: 'human', id: 'D1', links: [['P1', 'I1', 100]] },
      r,
    );
  if (e.type !== 'allocate') return;
  for (const value of [
    '\u200b',
    'reason\nline',
    ' reason ',
    'x'.repeat(2001),
  ]) {
    const bad = structuredClone(e);
    bad.links[0].basis.reason = value;
    assert.throws(() => reconcileAllocation({ ...s, events: [bad] }), /TEXT/);
  }
  const bad = { ...e, result: 'approved' } as unknown as AllocationEvent;
  assert.throws(() => reconcileAllocation({ ...s, events: [bad] }), /EVENT/);
  e.links[0].basis.kind = 'external-confirmation';
  const approved = reconcileAllocation({ ...s, events: [e] });
  assert.equal(approved.links[0].basis.kind, 'external-confirmation');
  assert.equal(reconcileAllocation(s).links.length, 0);
});
