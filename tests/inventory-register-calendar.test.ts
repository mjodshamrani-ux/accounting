import test from 'node:test';
import assert from 'node:assert/strict';
import { stockFixture } from '../audit/inventory-register/fixtures.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  reconcileStock,
  type StockEvent,
} from '../lib/reconciliation/inventory-register.ts';
void test('inventory public IO rejects Gregorian year zero in scope, evidence and event; year 0001 and 9999 retain whole decision/session/export', async () => {
  const dated = async (year: string) => {
    const { state } = await stockFixture();
    state.scope.asOf = year + '-09-30';
    for (let i = 0; i < 4; i++)
      state.files[i] = await readStockFile(
        state.files[i].name,
        new TextEncoder().encode(
          new TextDecoder()
            .decode(state.files[i].original)
            .replaceAll('2026-', year + '-'),
        ).buffer,
      );
    return state;
  };
  const zero = await dated('0000');
  await assert.rejects(replayStock(zero), /VALIDITY/);
  await assert.rejects(saveStock(zero), /VALIDITY/);
  const { state } = await stockFixture(),
    r = reconcileStock(state);
  const event: StockEvent = {
    id: 'calendar',
    type: 'reject',
    memberIds: r.memberIds,
    context: r.context,
    at: '0000-10-07T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic full inventory scope',
  };
  await assert.rejects(replayStock({ ...state, events: [event] }), /EVENT/);
  const bad = (await stockFixture()).state;
  const rows = structuredClone(bad.files[2].sheets[0].rows),
    column = rows[0].indexOf('Valid from');
  rows[1][column] = '0000-01-01';
  const csv =
    rows
      .map((row) =>
        row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
      )
      .join('\n') + '\n';
  bad.files[2] = await readStockFile(
    bad.files[2].name,
    new TextEncoder().encode(csv).buffer,
  );
  const blocked = await replayStock(bad);
  assert.equal(blocked.result.financial, 'source-error');
  assert.equal(blocked.result.totals, null);
  assert.ok(blocked.result.issues.some((v) => v.code === 'VALIDITY'));
  for (const year of ['0001', '9999']) {
    const positive = await dated(year);
    positive.completeness = {
      confirmed: true,
      reference: 'SYN-COMPLETE',
      note: 'Synthetic calendar boundary',
    };
    const current = await replayStock(positive);
    assert.equal(current.result.financial, 'ready');
    positive.events = [
      {
        ...event,
        id: 'calendar-' + year,
        type: 'accept',
        context: current.result.context,
        memberIds: current.result.memberIds,
        at: year + '-10-07T00:00:00.000Z',
      },
    ];
    const accepted = await replayStock(positive);
    assert.equal(accepted.result.status, 'consistent-with-evidence');
    const restored = await restoreStock(await saveStock(positive));
    assert.deepEqual(restored.result, accepted.result);
    assert.ok((await exportStock(positive, accepted.result)).byteLength > 0);
  }
});
