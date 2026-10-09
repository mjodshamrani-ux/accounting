import type { Scope, SourceFile } from './types.ts';

export type AllocationWorkflowHandoff = Readonly<{
  version: 'ALLOCATION_WORKFLOW_CONTEXT_V1';
  revision: string;
  authority: 'workflow-context-only';
  sourceReferences: readonly Readonly<{ name: string; sha256: string }>[];
  scopeHints: Readonly<{
    entity: string;
    party: string;
    account: string;
    currency: string;
    cutoff: string;
    confirmed: false;
  }>;
}>;

/** Context for fresh navigation only. No source rows, capacity or decision can
 * cross the supplier-comparison/payment-allocation authority boundary here. */
export function createAllocationWorkflowHandoff(
  files: readonly [SourceFile, SourceFile],
  scope: Scope,
  revision: string,
): AllocationWorkflowHandoff {
  if (!Array.isArray(files) || files.length !== 2 ||
      typeof revision !== 'string' || !revision.trim() || revision.length > 200 ||
      files.some((f) => !f || typeof f.name !== 'string' || !f.name.trim() ||
        f.name.length > 255 || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)))
    throw Error('ALLOCATION_HANDOFF_CONTEXT');
  const fields = [scope?.entity, scope?.supplier, scope?.account, scope?.currency, scope?.cutoff];
  if (fields.some((value) => typeof value !== 'string' || value.length > 1000))
    throw Error('ALLOCATION_HANDOFF_SCOPE');
  return {
    version: 'ALLOCATION_WORKFLOW_CONTEXT_V1',
    revision,
    authority: 'workflow-context-only',
    sourceReferences: files.map((f) => ({ name: f.name, sha256: f.sha256! })),
    scopeHints: { entity: scope.entity, party: scope.supplier, account: scope.account,
      currency: scope.currency, cutoff: scope.cutoff, confirmed: false },
  };
}
