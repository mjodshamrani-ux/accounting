// UX-6(c), fixed assets: the cases the reconciliation sheet is held to,
// shared by its unit tests and its case exporter. Synthetic only: every
// frozen case of the flat family (every state the engine gives, source
// errors and missing evidence among them, and three precisions), every
// frozen case of the long family (components in rows), the flat positive one
// with its assets attested and each decision in turn, one built here with
// fifteen decisions so the sheet runs over a page, and the long positive one
// attested and approved.
import { readdir, readFile } from 'node:fs/promises';
import { assetFixture } from '../fixed-assets/fixtures.ts';
import { assetLongFixture } from '../../tests/helpers/fixed-assets-long-fixtures.ts';
import type {
  AssetEvent,
  AssetInput,
  AssetResult,
} from '../../lib/reconciliation/fixed-assets.ts';
import { replayAsset } from '../../lib/reconciliation/fixed-assets-io.ts';

export type FixedAssetsCase = { state: AssetInput; result: AssetResult };

/** The frozen cases of the flat family, by name. */
export const assetFrozenNames = (
  JSON.parse(
    await readFile(
      new URL('../fixed-assets/cases.json', import.meta.url),
      'utf8',
    ),
  ) as { name: string }[]
).map((c) => c.name);

/** The frozen cases of the long family, each as `long-<name>`. */
export const assetLongNames = (
  await readdir(new URL('../fixed-assets-long/frozen/', import.meta.url), {
    withFileTypes: true,
  })
)
  .filter((d) => d.isDirectory())
  .map((d) => `long-${d.name}`)
  .sort();

const ATTESTED = {
  confirmed: true,
  reference: 'Synthetic asset completeness reference',
  note: 'Synthetic: every supplied asset, mapping, policy and GL account reviewed',
};

/** A decision on the whole scope as the result now stands. */
function decision(
  result: AssetResult,
  type: AssetEvent['type'],
  n: number,
): AssetEvent {
  return {
    id: `E-${n + 1}`,
    type,
    memberIds: [...result.memberIds],
    context: result.context,
    at: `2026-10-09T00:00:00.${String(n).padStart(3, '0')}Z`,
    reference: 'Synthetic asset review',
    note: `Synthetic: the whole asset scope reviewed, ${type}`,
  };
}

/** A positive case attested, then the decisions given in turn. */
async function decided(
  state: AssetInput,
  types: readonly AssetEvent['type'][],
): Promise<FixedAssetsCase> {
  state.completeness = { ...ATTESTED };
  let { result } = await replayAsset(state);
  for (const type of types) {
    state.events = [
      ...state.events,
      decision(result, type, state.events.length),
    ];
    ({ result } = await replayAsset(state));
  }
  return { state, result };
}

/** The decided stories built here, by name. */
export const assetStories: Record<string, readonly AssetEvent['type'][]> = {
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
  // The long family's positive case, attested and approved.
  'long-accepted': ['accept'],
};

/**
 * A case by name: a story built here, `long-<name>` for a frozen case of the
 * long family, or a frozen case of the flat family by its own name. Each
 * result is the one the export replays and finds equal.
 */
export async function fixedAssetsCase(name: string): Promise<FixedAssetsCase> {
  if (name === 'long-accepted')
    return decided(await assetLongFixture(), assetStories[name]);
  if (name in assetStories)
    return decided((await assetFixture()).state, assetStories[name]);
  const state = name.startsWith('long-')
    ? await assetLongFixture(name.slice(5))
    : (await assetFixture(name)).state;
  return { state, result: (await replayAsset(state)).result };
}
