import { normalizeSource } from './core.ts';
import { assertInputFormats } from './input-readiness.ts';
import { inferStatementDirection } from './statement-direction.ts';
import type { Mapping, Scope, SourceFile, SourceResult } from './types.ts';

// The boundary every reconciliation shares before its own matching: the
// sources are already read (SourceFile); here each reading is checked and the
// sources are normalised. Nothing after normalisation belongs here.

/** A reading must be an object before any gate can look inside it. */
function assertReading(mapping: Mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Error('إعدادات قراءة المصدر غير صالحة');
}

/** Moved unchanged from io.ts (which still re-exports it); only its first
 * check is now shared with prepareVerifiedSources. */
export function verifyDirectionEvidence(
  file: SourceFile,
  mapping: Mapping,
  decimals: number,
): Mapping {
  assertReading(mapping);
  if (mapping.directionEvidence === undefined) return mapping;
  const claimed = mapping.directionEvidence;
  const proven = inferStatementDirection(file, mapping, decimals);
  if (
    !claimed ||
    typeof claimed !== 'object' ||
    Array.isArray(claimed) ||
    !proven ||
    claimed.multiplier !== proven.multiplier ||
    mapping.multiplier !== proven.multiplier ||
    claimed.balanceColumn !== proven.balanceColumn ||
    claimed.checkedRows !== proven.checkedRows
  )
    throw new Error(
      'دليل اتجاه المدين والدائن لا يطابق المصدر. أعد التحقق من اتجاه المبالغ.',
    );
  return { ...mapping, directionEvidence: proven };
}

export type SourceRole = 'supplier' | 'ledger';

/** Check and normalise the sources of one reconciliation, in a fixed order:
 * 1. every reading is an object;
 * 2. the amount and date formats of every source (assertInputFormats);
 * 3. every claimed debit/credit direction, re-proved from its own source;
 * 4. normalisation of each source under its proven reading.
 * All sources pass a gate before any source meets the next one, so which
 * refusal is reported does not depend on which source carries it. The
 * direction proof reads dates and amounts with the reading's formats, so it
 * only runs once those formats have passed their guard. */
export function prepareVerifiedSources(
  files: readonly SourceFile[],
  mappings: readonly Mapping[],
  scope: Scope,
  roles: readonly SourceRole[],
): { mappings: Mapping[]; sources: SourceResult[] } {
  roles.forEach((_, i) => assertReading(mappings[i]));
  assertInputFormats(files, mappings, scope);
  const proven = roles.map((_, i) =>
    verifyDirectionEvidence(files[i], mappings[i], scope.decimals),
  );
  return {
    mappings: proven,
    sources: roles.map((role, i) =>
      normalizeSource(files[i], proven[i], scope, role),
    ),
  };
}
