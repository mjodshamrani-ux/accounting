import { compare } from './core.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import type {
  Comparison,
  Decision,
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
} from './types.ts';

export type SupplierReconciliationInput = {
  files: readonly [SourceFile, SourceFile];
  mappings: readonly [Mapping, Mapping];
  scope: Scope;
  decisions?: Decision[];
  rejected?: string[];
};
export type SupplierReconciliationStage = 'normalizePairMs' | 'matchingMs';

/** The one recompute of a supplier reconciliation from its sources: check and
 * normalise the supplier statement and the ledger through the shared source
 * boundary (formats, then direction, then normalisation), then match them.
 * Comparing, restoring a session and re-proving an export all come through
 * here, so they cannot drift apart. The readings it returns are the proven
 * ones the result was computed from. */
export function reconcileSupplierStatement(
  input: SupplierReconciliationInput,
  observe?: (stage: SupplierReconciliationStage) => void,
): {
  a: SourceResult;
  b: SourceResult;
  result: Comparison;
  mappings: [Mapping, Mapping];
} {
  const { scope } = input;
  const prepared = prepareVerifiedSources(input.files, input.mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const [a, b] = prepared.sources;
  observe?.('normalizePairMs');
  const result = compare(a, b, scope, input.decisions, input.rejected);
  observe?.('matchingMs');
  return { a, b, result, mappings: prepared.mappings as [Mapping, Mapping] };
}
