// UX-6(c), payroll: the cases the reconciliation sheet is held to, shared by
// its unit tests and its case exporter. Synthetic only: every frozen case of
// the family (every state the engine gives, source errors and missing
// evidence among them, and three precisions), the positive one with its
// payroll and payout attested and each decision in turn, and one built here
// with fifteen decisions so the sheet runs over a page.
import { readFile } from 'node:fs/promises';
import { payrollFixture } from '../payroll/fixtures.ts';
import type {
  PayrollEvent,
  PayrollInput,
  PayrollResult,
} from '../../lib/reconciliation/payroll.ts';
import { replayPayroll } from '../../lib/reconciliation/payroll-io.ts';

export type PayrollCase = { state: PayrollInput; result: PayrollResult };

/** The frozen cases of the family, by name. */
export const payrollFrozenNames = (
  JSON.parse(
    await readFile(new URL('../payroll/cases.json', import.meta.url), 'utf8'),
  ) as { name: string }[]
).map((c) => c.name);

const ATTESTED = {
  confirmed: true,
  reference: 'Synthetic payroll completeness reference',
  note: 'Synthetic: every supplied employee, mapping, policy, GL entry and the bank payout reviewed',
};

/** A decision on the whole scope as the result now stands. */
function decision(
  result: PayrollResult,
  type: PayrollEvent['type'],
  n: number,
): PayrollEvent {
  return {
    id: `E-${n + 1}`,
    type,
    memberIds: [...result.memberIds],
    context: result.context,
    at: `2026-10-09T00:00:00.${String(n).padStart(3, '0')}Z`,
    reference: 'Synthetic payroll review',
    note: `Synthetic: the whole payroll scope reviewed, ${type}`,
  };
}

/** The decided stories built here, by name. */
export const payrollStories: Record<string, readonly PayrollEvent['type'][]> = {
  attested: [],
  accepted: ['accept'],
  rejected: ['reject'],
  undone: ['accept', 'undo'],
  // The whole scope approved, undone, rejected and undone again, three
  // times over, then approved, undone and approved again: fifteen
  // decisions, each with its reason.
  'many-decisions': [
    'accept',
    'undo',
    'reject',
    'undo',
    'accept',
    'undo',
    'reject',
    'undo',
    'accept',
    'undo',
    'reject',
    'undo',
    'accept',
    'undo',
    'accept',
  ],
};

/**
 * A case by name: a story built here on the positive case, or a frozen case
 * by its own name. Each result is the one the export replays and finds
 * equal.
 */
export async function payrollCase(name: string): Promise<PayrollCase> {
  if (name in payrollStories) {
    const { state } = await payrollFixture();
    state.completeness = { ...ATTESTED };
    let { result } = await replayPayroll(state);
    for (const type of payrollStories[name]) {
      state.events = [
        ...state.events,
        decision(result, type, state.events.length),
      ];
      ({ result } = await replayPayroll(state));
    }
    return { state, result };
  }
  const { state } = await payrollFixture(name);
  return { state, result: (await replayPayroll(state)).result };
}
