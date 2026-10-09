import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  BANK_VERSION,
  BANK_ROLES,
  reconcileBank,
  type BankInput,
  type BankResult,
  type BankEvent,
} from '../../lib/reconciliation/bank.ts';
const root = new URL('./frozen/', import.meta.url);
export type BankFixtureAction = {
  type: 'accept' | 'undo';
  bank: string[];
  cash: string[];
  reject?: boolean;
  expectedStatus?: string;
};
export type BankFixtureCase = {
  name: string;
  files: { file: string; sha256: string }[];
  records: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  groups: {
    key: string;
    bank: string[];
    cash: string[];
    bankMinor: number;
    cashMinor: number;
    deltaMinor: number;
    status: string;
    reason: string;
    eligible: boolean;
  }[];
  actions: BankFixtureAction[];
  timingItems: Record<string, unknown>[];
  sourceError: boolean;
};
export const bankTruth = JSON.parse(
  await fsRead(new URL('expected.json', root), 'utf8'),
) as { scope: BankInput['scope']; cases: BankFixtureCase[] };
export async function bankFixture(name = 'outgoing-fees'): Promise<BankInput> {
  const c = bankTruth.cases.find((c) => c.name === name)!;
  const files = [];
  for (const f of c.files)
    files.push(
      await readFile(
        f.file,
        new Uint8Array(await fsRead(new URL(f.file, root))).buffer,
      ),
    );
  return {
    files: files as BankInput['files'],
    readings: BANK_ROLES.map((role) => ({
      role,
      sheet: 0,
      family: BANK_VERSION,
      perspective: 'company-cash',
      confirmed: true,
    })) as BankInput['readings'],
    scope: { ...bankTruth.scope, confirmed: true },
    events: [],
  };
}
export function bankEvent(
  a: BankFixtureAction,
  r: BankResult,
  id = 'D1',
): BankEvent {
  const find = (side: 0 | 1, ref: string) =>
    r.inventory.find(
      (i) => i.side === side && i.row > 1 && i.values[0] === ref,
    )!.id;
  return {
    id,
    type: a.type,
    context: r.context,
    at: '2026-10-06T18:40:00.000Z',
    reference: 'Synthetic reviewed evidence',
    note: 'Synthetic bank movement review only',
    bankIds: a.bank.map((ref) => find(0, ref)),
    cashIds: a.cash.map((ref) => find(1, ref)),
  };
}
export async function finishedBank(c: BankFixtureCase) {
  const state = await bankFixture(c.name);
  for (const [i, a] of c.actions.entries())
    if (!a.reject)
      state.events.push(bankEvent(a, reconcileBank(state), `D${i + 1}`));
  return { state, result: reconcileBank(state) };
}
