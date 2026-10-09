import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  ALLOCATION_VERSION,
  ALLOCATION_ROLES,
  reconcileAllocation,
  type AllocationInput,
  type AllocationEvent,
  type AllocationResult,
} from '../../lib/reconciliation/allocation.ts';
export type FixtureAction = {
  type: string;
  id: string;
  proofs?: string[];
  target?: string;
  links?: [string, string, number][];
  reject?: boolean;
};
export type FixtureCase = {
  name: string;
  files: { file: string; sha256: string }[];
  status: string;
  actions: FixtureAction[];
  balances: Record<string, number[]> | null;
  links: [string, string, number][];
  history: { accepted: boolean; active: string[] }[];
};
const root = new URL('./frozen/', import.meta.url);
export const allocationTruth = JSON.parse(
  await fsRead(new URL('expected.json', root), 'utf8'),
) as { scope: AllocationInput['scope']; cases: FixtureCase[] };
export async function allocationFixture(
  name = 'one-to-many',
): Promise<AllocationInput> {
  const c = allocationTruth.cases.find((c) => c.name === name)!;
  const files = [];
  for (const f of c.files)
    files.push(
      await readFile(
        f.file,
        new Uint8Array(await fsRead(new URL(f.file, root))).buffer,
      ),
    );
  return {
    files: files as AllocationInput['files'],
    readings: ALLOCATION_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: ALLOCATION_VERSION,
      confirmed: true,
    })) as AllocationInput['readings'],
    scope: { ...allocationTruth.scope, confirmed: true },
    events: [],
  };
}
export function fixtureEvent(
  a: FixtureAction,
  r: AllocationResult,
): AllocationEvent {
  const base = {
    id: a.id,
    context: r.context,
    at: '2026-10-06T18:00:00.000Z',
    note: 'Synthetic frozen allocation decision',
  };
  if (a.type === 'undo') return { ...base, type: 'undo', target: a.target! };
  const itemId = (side: number, reference: string) =>
    r.items.find((i) => i.side === side && i.reference === reference)!.id;
  return {
    ...base,
    type: 'allocate',
    links:
      a.type === 'remittance'
        ? a.proofs!.map((ref) => {
            const p = r.proofs.find((p) => p.reference === ref)!;
            return {
              paymentId: itemId(0, p.payment),
              invoiceId: itemId(1, p.invoice),
              amount: p.amount,
              basis: {
                kind: 'remittance',
                reference: p.reference,
                reason:
                  'Synthetic advice explicitly names the payment invoice and amount',
                proofId: p.id,
              },
            };
          })
        : a.links!.map(([p, i, amount]) => ({
            paymentId: itemId(0, p),
            invoiceId: itemId(1, i),
            amount: amount * 100,
            basis: {
              kind: 'accountant-review',
              reference: `Synthetic review ${a.id}`,
              reason: 'Synthetic accountant instruction for this payment only',
              proofId: '',
            },
          })),
  };
}
export async function finishedFixture(c: FixtureCase) {
  const state = await allocationFixture(c.name);
  for (const a of c.actions)
    if (!a.reject) {
      const r = reconcileAllocation(state);
      state.events.push(fixtureEvent(a, r));
    }
  return { state, result: reconcileAllocation(state) };
}
