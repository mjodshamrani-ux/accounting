import { reconcileBank } from '../../lib/reconciliation/bank.ts';
import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  bankDemoScope,
  bankDemoReadings,
} from '../../lib/reconciliation/bank-demo.ts';
import {
  BANK_BALANCE_VERSION,
  BANK_BALANCE_ROLES,
} from '../../lib/reconciliation/bank-balance.ts';
import {
  ADJUSTMENT_VERSION,
  ADJUSTMENT_ROLES,
  reconcileBankAdjustments,
  type BankAdjustmentInput,
} from '../../lib/reconciliation/bank-adjustment.ts';
const root = new URL('./frozen/', import.meta.url);
export const adjustmentTruth = JSON.parse(
  await fsRead(new URL('expected.json', root), 'utf8'),
);
export async function adjustmentFixture(
  name = 'closing-outflow',
): Promise<BankAdjustmentInput> {
  const c = adjustmentTruth.cases.find(
      (x: { name: string }) => x.name === name,
    ),
    files = [];
  for (const f of c.files)
    files.push(
      await readFile(
        f.file,
        new Uint8Array(await fsRead(new URL(f.file, root))).buffer,
      ),
    );
  const state: BankAdjustmentInput = {
    balance: {
      bank: {
        files: [files[0], files[1]],
        readings: structuredClone(bankDemoReadings),
        scope: { ...bankDemoScope },
        events: [],
      },
      files: [files[2], files[3]],
      readings: BANK_BALANCE_ROLES.map((role) => ({
        sheet: 0,
        role,
        family: BANK_BALANCE_VERSION,
        perspective: 'company-cash',
        confirmed: true,
      })) as BankAdjustmentInput['balance']['readings'],
      coverage: {
        basis: 'movement-date',
        boundary: 'end-of-day',
        openingAsOf: adjustmentTruth.openingAsOf,
        closingAsOf: adjustmentTruth.closingAsOf,
        confirmed: true,
      },
    },
    files: [files[4], files[5]],
    readings: ADJUSTMENT_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ADJUSTMENT_VERSION,
      perspective: 'company-cash',
      confirmed: true,
    })) as BankAdjustmentInput['readings'],
    completeness: {
      confirmed: true,
      reference: 'SYNTHETIC coverage',
      note: 'Provided source inventory and both endpoints reviewed; no field validation',
    },
    events: [],
  };
  for (const type of c.bankActions ?? []) {
    const r = reconcileBank(state.balance.bank),
      g = r.cases[0];
    state.balance.bank.events.push({
      id: 'original-bank-undo',
      type,
      context: r.context,
      at: '2026-10-06T09:00:00.000Z',
      reference: 'SYNTHETIC original undo',
      note: 'Original B1 paired group undone',
      bankIds: g.bankIds,
      cashIds: g.cashIds,
    });
  }
  return state;
}
export async function finishedAdjustment(name = 'closing-outflow') {
  let state = await adjustmentFixture(name),
    result = reconcileBankAdjustments(state);
  const c = adjustmentTruth.cases.find(
    (x: { name: string }) => x.name === name,
  );
  if (!c.invalid)
    for (const [index, type] of c.actions.entries())
      for (const lifecycle of result.lifecycles) {
        state = {
          ...state,
          events: [
            ...state.events,
            {
              id: `${index}-${lifecycle.id}`,
              type,
              context: result.context,
              at: `2026-10-06T10:${String(index).padStart(2, '0')}:00.000Z`,
              reference: 'SYNTHETIC approval',
              note: 'Complete original lifecycle and evidence reviewed',
              itemIds: lifecycle.itemIds,
            },
          ],
        };
        result = reconcileBankAdjustments(state);
      }
  return { state, result };
}
