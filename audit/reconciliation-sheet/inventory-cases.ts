// UX-6(c), inventory: the cases the reconciliation sheet is held to, shared
// by its unit tests and its case exporter. Synthetic only: every frozen case
// of the posted register family (every state the engine gives, a source
// error among them), the positive one with its inventory attested and each
// decision in turn, one built here with fifteen decisions so the sheet runs
// over a page, and the printed register's (PDF) frozen cases, whose Arabic
// workpaper names its evidence sheets in Arabic.
import { readFile } from 'node:fs/promises';
import { stockFixture } from '../inventory-register/fixtures.ts';
import {
  reconcileStock,
  replayStockPdfOriginals,
  type StockEvent,
  type StockInput,
  type StockResult,
} from '../../lib/reconciliation/inventory-register.ts';
import type { StockPdfState } from '../../lib/reconciliation/inventory-pdf-request.ts';
import {
  g3Contract,
  pdfDecision,
  pdfLifecycleFixture,
} from '../../tests/helpers/inventory-pdf-lifecycle-fixture.ts';

export type InventoryCase = { state: StockInput; result: StockResult };
/** A printed register's case: its state holds the PDF and its reading. */
export type InventoryPdfCase = { state: StockPdfState; result: StockResult };

/** The frozen cases of the posted register family, by name. */
export const inventoryFrozenNames = (
  JSON.parse(
    await readFile(
      new URL('../inventory-register/cases.json', import.meta.url),
      'utf8',
    ),
  ) as { case: string }[]
).map((c) => c.case);

const ATTESTED = {
  confirmed: true,
  reference: 'Synthetic inventory count reference',
  note: 'Synthetic: every supplied register row, mapping, policy and GL account reviewed',
};

/** A decision on the whole scope as the result now stands. */
function decision(
  result: StockResult,
  type: StockEvent['type'],
  n: number,
): StockEvent {
  return {
    id: `E-${n + 1}`,
    type,
    memberIds: [...result.memberIds],
    context: result.context,
    at: `2026-10-09T00:00:00.${String(n).padStart(3, '0')}Z`,
    reference: 'Synthetic inventory review',
    note: `Synthetic: the whole inventory scope reviewed, ${type}`,
  };
}

/** The positive case attested, then the decisions given in turn. */
async function decided(types: readonly StockEvent['type'][]) {
  const { state } = await stockFixture('independent-units-positive');
  state.completeness = { ...ATTESTED };
  let result = reconcileStock(state);
  for (const type of types) {
    state.events = [
      ...state.events,
      decision(result, type, state.events.length),
    ];
    result = reconcileStock(state);
  }
  return { state, result };
}

/** The decided stories built here, by name. */
export const inventoryStories: Record<string, readonly StockEvent['type'][]> = {
  attested: [],
  accepted: ['accept'],
  rejected: ['reject'],
  undone: ['accept', 'undo'],
  // The whole scope approved, undone, rejected and undone again, three
  // times over, then approved, undone and approved again: fifteen
  // decisions, each with its reason.
  'long-decisions': [
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

/** A case by name: a story built here, or a frozen case's own name. */
export async function inventoryCase(name: string): Promise<InventoryCase> {
  if (name in inventoryStories) return decided(inventoryStories[name]);
  const { state } = await stockFixture(name);
  return { state, result: reconcileStock(state) };
}

/** The printed register's frozen codes, each state the PDF engine gives. */
export const inventoryPdfCodes = [
  ...g3Contract.ready,
  ...g3Contract.difference,
  ...g3Contract.missing,
  ...Object.keys(g3Contract.sourceErrors),
];

/**
 * The printed register's cases, `pdf-<code>` as the frozen originals read,
 * and `pdf-<code>-accepted` attested and approved, each handed to `visit`
 * while the fixture that writes the PDFs is open.
 */
export async function withInventoryPdfCases(
  visit: (name: string, value: InventoryPdfCase) => Promise<void>,
) {
  const fixture = await pdfLifecycleFixture();
  try {
    for (const code of inventoryPdfCodes) {
      const state = await fixture.input(code);
      const first = await replayStockPdfOriginals(state);
      await visit(`pdf-${code}`, { state, result: first.result });
      if (!g3Contract.ready.includes(code)) continue;
      state.completeness = { ...ATTESTED };
      const attested = await replayStockPdfOriginals(state);
      state.events = [pdfDecision(attested, 'accept', 'E-1')];
      const accepted = await replayStockPdfOriginals(state);
      await visit(`pdf-${code}-accepted`, {
        state,
        result: accepted.result,
      });
    }
  } finally {
    await fixture.close();
  }
}
