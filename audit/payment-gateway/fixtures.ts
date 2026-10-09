import { readFile as fsRead } from 'node:fs/promises';
import { readGatewayFile } from '../../lib/reconciliation/payment-gateway-source.ts';
import {
  reconcileGateway,
  type GatewayInput,
  type GatewayEvent,
  type GatewayResult,
} from '../../lib/reconciliation/payment-gateway.ts';
export type GatewayTruth = {
  name: string;
  scope: Omit<GatewayInput['scope'], 'confirmed'>;
  complete: boolean;
  status: string;
  actions: GatewayEvent['type'][];
  files: { file: string; sha256: string }[];
  expected?: Pick<
    GatewayResult,
    | 'records'
    | 'issues'
    | 'missing'
    | 'cells'
    | 'inventory'
    | 'totals'
    | 'residuals'
    | 'financial'
  >;
};
export const gatewayTruth = JSON.parse(
  await fsRead(new URL('./frozen/expected.json', import.meta.url), 'utf8'),
) as { version: string; cases: GatewayTruth[] };
const roles = ['transactions', 'fee-evidence', 'settlement', 'payout'] as const;
export async function gatewayFixture(name: string): Promise<GatewayInput> {
  const c = gatewayTruth.cases.find((c) => c.name === name)!;
  const files = await Promise.all(
    c.files.map(async (f) => {
      const data = await fsRead(new URL('./frozen/' + f.file, import.meta.url));
      const file = await readGatewayFile(f.file, Uint8Array.from(data).buffer);
      if (file.sha256 !== f.sha256) throw Error('Frozen bytes changed');
      return file;
    }),
  );
  return {
    files: files as GatewayInput['files'],
    readings: roles.map((role) => ({
      sheet: 0,
      role,
      family: gatewayTruth.version,
      confirmed: true,
    })) as GatewayInput['readings'],
    scope: { ...c.scope, confirmed: true },
    completeness: {
      confirmed: c.complete,
      reference: c.complete ? 'Synthetic supplied inventory' : '',
      note: c.complete
        ? 'All supplied transactions and independently evidenced fees reviewed'
        : '',
    },
    events: [],
  };
}
export async function finishedGateway(name: string) {
  const state = await gatewayFixture(name),
    c = gatewayTruth.cases.find((c) => c.name === name)!;
  // Expected context and physical membership come from immutable independent
  // CSV truth, never from the result being checked.
  const members = c
    .expected!.inventory.filter(
      (r) =>
        r.row > 1 &&
        c.expected!.cells.some(
          (cell) =>
            cell.source === r.source && cell.row === r.row && cell.text.trim(),
        ),
    )
    .map((r) =>
      JSON.stringify([
        gatewayTruth.version,
        r.source,
        c.files[r.source].sha256,
        0,
        r.row,
      ]),
    );
  const context = JSON.stringify([
    gatewayTruth.version,
    c.files.map((f) => f.sha256),
    state.readings,
    state.scope,
    state.completeness,
  ]);
  state.events = c.actions.map((type, i) => ({
    id: 'E-' + (i + 1),
    type,
    batchId: c.scope.batchId,
    memberIds: [...members],
    context,
    at: '2026-10-07T00:00:00.000Z',
    reference: 'Independent synthetic review',
    note: 'All original records including any malformed contender',
  }));
  return { state, result: reconcileGateway(state) };
}
