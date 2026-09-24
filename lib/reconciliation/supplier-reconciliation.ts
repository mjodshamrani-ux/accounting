import { compare, normalizeSource } from './core.ts';
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

/** The one recompute of a supplier reconciliation from its sources: read the
 * supplier statement, then the ledger, then match them. Comparing, restoring a
 * session and re-proving an export all come through here, so they cannot drift
 * apart. Every entry gate stays with its caller and runs before this. */
export function reconcileSupplierStatement(
  input: SupplierReconciliationInput,
  observe?: (stage: SupplierReconciliationStage) => void,
): { a: SourceResult; b: SourceResult; result: Comparison } {
  const { files, mappings, scope } = input;
  const a = normalizeSource(files[0], mappings[0], scope, 'supplier');
  const b = normalizeSource(files[1], mappings[1], scope, 'ledger');
  observe?.('normalizePairMs');
  const result = compare(a, b, scope, input.decisions, input.rejected);
  observe?.('matchingMs');
  return { a, b, result };
}
