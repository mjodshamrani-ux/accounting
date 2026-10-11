import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { bankFixture } from '../audit/bank/fixtures.ts';
import {
  balanceFixture,
  balanceTruth,
} from '../audit/bank-balance/fixtures.ts';
import {
  adjustmentFixture,
  adjustmentTruth,
} from '../audit/bank-adjustment/fixtures.ts';
import { reconcileBank } from '../lib/reconciliation/bank.ts';
import {
  reconcileBankAdjustments,
  type BankAdjustmentInput,
  type AdjustmentEvent,
} from '../lib/reconciliation/bank-adjustment.ts';
import {
  replayBank,
  saveBank,
  restoreBank,
  exportBank,
} from '../lib/reconciliation/bank-io.ts';
import {
  replayBankBalances,
  saveBankBalances,
  restoreBankBalances,
  exportBankBalances,
} from '../lib/reconciliation/bank-balance-io.ts';
import {
  replayBankAdjustments,
  saveBankAdjustments,
  restoreBankAdjustments,
  exportBankAdjustments,
} from '../lib/reconciliation/bank-adjustment-io.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  csvBytes,
  withdrawalDeposit,
  nativeFile,
} from './helpers/bank-wd-fixtures.ts';
function event(
  state: BankAdjustmentInput,
  type: AdjustmentEvent['type'],
  itemIds: string[],
  id: string,
): AdjustmentEvent {
  return {
    id,
    type,
    itemIds,
    context: reconcileBankAdjustments(state).context,
    at: '2026-10-10T12:00:00.000Z',
    reference: 'Synthetic frozen original truth',
    note: 'Complete lifecycle from all six original sources reviewed',
  };
}
async function wdAdjustment(name: string, native = false) {
  const state = await adjustmentFixture(name);
  state.balance.bank = await withdrawalDeposit(state.balance.bank);
  if (native) {
    state.balance.bank.files = (await Promise.all(
      state.balance.bank.files.map(nativeFile),
    )) as BankAdjustmentInput['balance']['bank']['files'];
    // All events depend on original hashes; rebind the synthetic actions below.
    assert.equal(state.balance.bank.events.length, 0);
    state.balance.files = (await Promise.all(
      state.balance.files.map(nativeFile),
    )) as BankAdjustmentInput['balance']['files'];
    state.files = (await Promise.all(
      state.files.map(nativeFile),
    )) as BankAdjustmentInput['files'];
  }
  return state;
}
async function load(data: ArrayBuffer) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(data);
  return b;
}
function embedded(book: ExcelJS.Workbook, name: string) {
  const rows = book
    .getWorksheet(name)!
    .getRows(2, book.getWorksheet(name)!.rowCount - 1)!;
  return Uint8Array.from(
    Buffer.from(rows.map((r) => {
      const value = r.getCell(2).value;
      assert.equal(typeof value, 'string');
      return value as string;
    }).join(''), 'base64'),
  ).buffer;
}
void test('WD B1 replays originals, distinct inactive evidence, compatibility schema, stale export and session tampering', async () => {
  const canonical = await bankFixture('outgoing-fees');
  const state = await withdrawalDeposit(canonical);
  const { result } = await replayBank(state);
  const forged = structuredClone(state);
  forged.files[1].sheets[0].rows[1][16] = '123456.00';
  assert.deepEqual((await replayBank(forged)).result, result);
  const saved = await saveBank(forged),
    restored = await restoreBank(saved);
  assert.deepEqual(restored.result, result);
  assert.equal(
    result.records.some(
      (r) => r.withdrawalDeposit?.deposit.state === 'blank-inactive',
    ),
    true,
  );
  assert.equal(
    result.records.some(
      (r) => r.withdrawalDeposit?.deposit.state === 'explicit-zero-inactive',
    ),
    true,
  );
  const exported = await exportBank(restored.state, result),
    wd = await load(exported);
  const cells = wd.getWorksheet('Withdrawal Deposit evidence')!;
  assert.equal(cells.rowCount, result.records.length * 2 + 1);
  const sources = wd.getWorksheet('Sources')!;
  for (const side of [0, 1]) {
    const chunks: string[] = [];
    sources.eachRow((r, i) => {
      if (i > 1 && r.getCell(1).value === side) {
        const value = r.getCell(5).value;
        assert.equal(typeof value, 'string');
        chunks.push(value as string);
      }
    });
    assert.deepEqual(
      Buffer.from(chunks.join(''), 'base64'),
      Buffer.from(state.files[side].original!),
    );
  }
  const legacy = await load(
    await exportBank(canonical, reconcileBank(canonical)),
  );
  assert.equal(legacy.getWorksheet('Withdrawal Deposit evidence'), undefined);
  assert.equal(
    legacy.getWorksheet('Movements')!.getRow(1).getCell(8).value,
    'Cash direction',
  );
  assert.equal(
    legacy.getWorksheet('Movements')!.getRow(1).getCell(14).value,
    'Amount minor units',
  );
  assert.deepEqual(
    (await restoreBank(await saveBank(canonical))).result,
    reconcileBank(canonical),
  );
  const stale = structuredClone(result);
  stale.records[0].signed += 1;
  await assert.rejects(() => exportBank(state, stale), /BANK_STALE_RESULT/);
  const p = JSON.parse(new TextDecoder().decode(saved));
  for (const mutate of [
    (v: typeof p) => {
      v.files[0].sha256 = '0'.repeat(64);
    },
    (v: typeof p) => {
      v.files[0].data = btoa('alternate-source');
    },
    (v: typeof p) => {
      v.result = result;
    },
    (v: typeof p) => {
      v.readings[0].family = 'bank-cash-movements-1';
    },
  ]) {
    const bad = structuredClone(p);
    mutate(bad);
    await assert.rejects(() =>
      restoreBank(new TextEncoder().encode(JSON.stringify(bad)).buffer),
    );
  }
});
void test('WD nested B2 original replay preserves independently frozen bridges, missing and error nulls, sessions and child exports', async () => {
  for (const c of balanceTruth.cases) {
    const state = await balanceFixture(c.name);
    state.bank = await withdrawalDeposit(state.bank);
    if (c.reject) {
      await assert.rejects(
        () => replayBankBalances(state),
        new RegExp(c.reject),
      );
      continue;
    }
    const fresh = await replayBankBalances(state),
      r = fresh.result;
    assert.equal(r.status, c.status, c.name);
    assert.deepEqual(
      r.components.map(
        ({
          side: _side,
          openingIds: _o,
          movementIds: _m,
          closingIds: _c,
          ...v
        }) => v,
      ),
      c.components,
      c.name,
    );
    assert.deepEqual(r.differences, c.differences, c.name);
    const restored = await restoreBankBalances(await saveBankBalances(state));
    assert.deepEqual(restored.result, r);
    const book = await load(await exportBankBalances(restored.state, r));
    const child = await load(embedded(book, 'Movement workpaper'));
    assert.ok(child.getWorksheet('Withdrawal Deposit evidence'));
    assert.equal(
      child.getWorksheet('Movements')!.rowCount,
      r.bank.records.length + 1,
    );
  }
});
void test('WD actual B2.2 six-source lifecycle uses frozen independent endpoint truths for current signs, carry, clearing, accept reject undo and refusal gates', async () => {
  fixtureLoop: for (const c of adjustmentTruth.cases) {
    const state = await wdAdjustment(c.name);
    let r = (await replayBankAdjustments(state)).result;
    if (!c.invalid) {
      for (const [index, type] of c.actions.entries())
        for (const l of r.lifecycles) {
          state.events.push(event(state, type, l.itemIds, `${index}-${l.id}`));
          try {
            r = (await replayBankAdjustments(state)).result;
          } catch (error) {
            if (!c.reject) throw error;
            assert.match(String(error), new RegExp(c.reject));
            continue fixtureLoop;
          }
        }
    }
    if (c.reject) {
      await assert.rejects(
        () => replayBankAdjustments(state),
        new RegExp(c.reject),
      );
      continue;
    }
    assert.equal(r.status, c.status, c.name);
    assert.deepEqual(
      r.balance.components.map((v) => v.residual),
      c.residual,
      c.name,
    );
    for (const e of r.endpoints) {
      assert.deepEqual([e.rawBank, e.rawCash], c.raw[e.point], c.name);
      assert.deepEqual(
        [e.bankAdjustment, e.cashAdjustment],
        c.invalid ? [null, null] : c.adjustments[e.point],
        c.name,
      );
      assert.deepEqual(
        [e.adjustedBank, e.adjustedCash],
        c.invalid ? [null, null] : c.adjusted[e.point],
        c.name,
      );
      assert.equal(
        e.difference,
        c.invalid ? null : c.differences[e.point],
        c.name,
      );
    }
    const restored = await restoreBankAdjustments(
      await saveBankAdjustments(state),
    );
    assert.deepEqual(restored.result, r, c.name);
    const book = await load(await exportBankAdjustments(restored.state, r));
    assert.ok(book.getWorksheet('B1 Withdrawal Deposit evidence'));
    const balance = await load(embedded(book, 'Balance workpaper'));
    const movement = await load(embedded(balance, 'Movement workpaper'));
    assert.ok(movement.getWorksheet('Withdrawal Deposit evidence'));
    assert.equal(
      book.getWorksheet('Events')!.rowCount,
      state.events.length + 1,
    );
  }
});
void test('WD actual native six originals pass source replay, persisted lifecycle and readable nested export without CSV-only support claims', async () => {
  for (const name of [
    'closing-outflow',
    'closing-inflow',
    'old-carried',
    'old-cleared',
    'old-correction-carried',
  ]) {
    const state = await wdAdjustment(name, true);
    const initial = (await replayBankAdjustments(state)).result;
    for (const l of initial.lifecycles)
      state.events.push(event(state, 'accept', l.itemIds, `native-${l.id}`));
    const r = (await replayBankAdjustments(state)).result;
    assert.equal(r.status, 'reconciled-with-evidence', name);
    const c = adjustmentTruth.cases.find(
      (x: { name: string }) => x.name === name,
    );
    assert.deepEqual(
      r.endpoints.map((e) => e.difference),
      [c.differences.opening, c.differences.closing],
    );
    const restored = await restoreBankAdjustments(
      await saveBankAdjustments(state),
    );
    assert.deepEqual(restored.result, r);
    assert.equal(
      (await load(await exportBankAdjustments(state, r))).getWorksheet(
        'B1 Withdrawal Deposit evidence',
      )!.rowCount,
      r.balance.bank.records.length * 2 + 1,
    );
  }
});
void test('WD B2.2 forged caches at all six sources, stale events/context/source hashes and null bridges cannot produce a download', async () => {
  const state = await wdAdjustment('old-carried');
  const initial = reconcileBankAdjustments(state);
  state.events = [
    event(state, 'accept', initial.lifecycles[0].itemIds, 'complete'),
  ];
  const r = (await replayBankAdjustments(state)).result;
  for (let layer = 0; layer < 6; layer++) {
    const forged = structuredClone(state);
    const files = [
      ...forged.balance.bank.files,
      ...forged.balance.files,
      ...forged.files,
    ];
    files[layer].sheets[0].rows[0][0] = 'forged header';
    assert.deepEqual((await replayBankAdjustments(forged)).result, r);
    files[layer].sha256 = '0'.repeat(64);
    await assert.rejects(() => saveBankAdjustments(forged), /SOURCE_HASH/);
  }
  for (const type of ['accept', 'reject', 'undo'] as const) {
    const bad = structuredClone(state);
    bad.events = [
      {
        ...event(state, type, initial.lifecycles[0].itemIds, 'bad'),
        context: r.context + 'different-family',
      },
    ];
    await assert.rejects(() => replayBankAdjustments(bad), /EVENT/);
  }
  const incomplete = structuredClone(state);
  incomplete.events[0].itemIds.pop();
  await assert.rejects(() => replayBankAdjustments(incomplete), /EVENT/);
  const stale = structuredClone(r);
  stale.endpoints[0].difference = 99;
  await assert.rejects(
    () => exportBankAdjustments(state, stale),
    /STALE_EXPORT/,
  );
  const corrupt = await wdAdjustment('old-carried');
  const rows = structuredClone(corrupt.balance.bank.files[0].sheets[0].rows);
  const invalid = [...rows[0]].map(() => '');
  invalid[0] = 'broken-late-row';
  rows.push(invalid);
  corrupt.balance.bank.files[0] = await readFile(
    'late-error.csv',
    csvBytes(rows),
  );
  const invalidResult = (await replayBankAdjustments(corrupt)).result;
  assert.equal(invalidResult.status, 'source-error');
  assert.ok(
    invalidResult.balance.components.every(
      (v) => v.movement === null && v.residual === null,
    ),
  );
  assert.deepEqual(invalidResult.balance.differences, {
    opening: null,
    closing: null,
  });
  assert.ok(
    invalidResult.endpoints.every(
      (v) => v.adjustedBank === null && v.adjustedCash === null,
    ),
  );
});
