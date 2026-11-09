// UX-6(c), payment gateways: the cases the reconciliation sheet is held to,
// shared by its unit tests and its case exporter. Synthetic only: the frozen
// PG cases with the decisions their stories record, the declared JPY and KWD
// precision contracts, the signed-kind bundles, and one batch built here
// with fifteen decisions so the sheet runs over a page.
import { readFile } from 'node:fs/promises';
import {
  finishedGateway,
  gatewayFixture,
  gatewayTruth,
} from '../payment-gateway/fixtures.ts';
import { readGatewayFile } from '../../lib/reconciliation/payment-gateway-source.ts';
import {
  PG_ROLES,
  reconcileGateway,
  type GatewayInput,
  type GatewayResult,
} from '../../lib/reconciliation/payment-gateway.ts';

export type GatewayCase = { state: GatewayInput; result: GatewayResult };

/** The frozen cases the engine accepts; a refused one has no result. */
export const gatewayFrozenNames = gatewayTruth.cases
  .filter((c) => !c.status.startsWith('throws:'))
  .map((c) => c.name);

const currency = JSON.parse(
  await readFile(
    new URL(
      '../payment-gateway/currency-contracts/expected.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  cases: {
    name: string;
    scope: Omit<GatewayInput['scope'], 'confirmed'>;
    files: { file: string; sha256: string }[];
    error: string | null;
  }[];
};
/** The declared precision contracts the engine accepts (JPY, KWD). */
export const gatewayCurrencyNames = currency.cases
  .filter((c) => !c.error)
  .map((c) => c.name);

/** The signed-kind bundles the sheet is held to: three decimals, and SAR. */
export const gatewaySignedNames = ['kwd-three-decimal', 'sar-mixed'];

/**
 * A case by name: `currency-<code>`, `signed-<bundle>`, `long-decisions`,
 * or a frozen case's own name.
 */
export async function gatewayCase(name: string): Promise<GatewayCase> {
  if (name.startsWith('currency-')) {
    const c = currency.cases.find((c) => c.name === name.slice(9))!;
    const state = await gatewayFixture('pending');
    state.scope = { ...c.scope, confirmed: true };
    for (let i = 0; i < 4; i++) {
      const bytes = await readFile(
        new URL('../payment-gateway/' + c.files[i].file, import.meta.url),
      );
      state.files[i] = await readGatewayFile(
        c.files[i].file.split('/').at(-1)!,
        Uint8Array.from(bytes).buffer,
      );
      if (state.files[i].sha256 !== c.files[i].sha256)
        throw Error('Frozen bytes changed');
    }
    return { state, result: reconcileGateway(state) };
  }
  if (name.startsWith('signed-')) {
    const dir = new URL(
      `../payment-gateway-signed/fixtures/${name.slice(7)}/`,
      import.meta.url,
    );
    const bundle = JSON.parse(
      await readFile(new URL('bundle.json', dir), 'utf8'),
    );
    const files = await Promise.all(
      bundle.files.map(async (file: string) =>
        readGatewayFile(
          file,
          Uint8Array.from(await readFile(new URL(file, dir))).buffer,
        ),
      ),
    );
    const state: GatewayInput = {
      files: [files[0], files[1], files[2], files[3]],
      readings: PG_ROLES.map((role, i) => ({
        role,
        sheet: 0,
        family: bundle.readings[i],
        confirmed: true,
      })) as GatewayInput['readings'],
      scope: { ...bundle.scope, confirmed: true },
      completeness: {
        confirmed: true,
        reference: 'Independent synthetic source inventory',
        note: 'Not field evidence',
      },
      events: [],
    };
    return { state, result: reconcileGateway(state) };
  }
  if (name === 'long-decisions') {
    // The whole batch approved, undone, rejected and undone again, three
    // times over, then approved, undone and approved again: fifteen
    // decisions, each with its reason.
    const { state } = await finishedGateway('pending');
    let result = reconcileGateway(state);
    const types = [
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
    ] as const;
    for (const type of types) {
      const n = state.events.length;
      state.events = [
        ...state.events,
        {
          id: `E-${n + 1}`,
          type,
          batchId: state.scope.batchId,
          memberIds: [...result.memberIds],
          context: result.context,
          at: `2026-10-07T00:00:00.${String(n).padStart(3, '0')}Z`,
          reference: 'Synthetic second review',
          note: `Synthetic: the whole batch reviewed again, ${type}`,
        },
      ];
      result = reconcileGateway(state);
    }
    return { state, result };
  }
  return finishedGateway(name);
}
