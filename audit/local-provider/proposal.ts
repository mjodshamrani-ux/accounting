// Experimental evidence adapter only. It is not imported by the website.
import {
  buildImportProposalContext,
  verifyImportProposal,
} from '../../lib/reconciliation/import-proposals.ts';
import type { ImportProposalContext, ImportProposalField } from '../../lib/reconciliation/import-proposals.ts';
import type { Mapping, SourceFile } from '../../lib/reconciliation/types.ts';

export type ColumnRequest = {
  context: ImportProposalContext;
  readingSnapshot: string;
  data: string;
  allowed: ImportProposalField[];
};
const snapshot = (file: SourceFile, mapping: Mapping) => JSON.stringify({ file, mapping });
export function makeColumnRequest(file: SourceFile, mapping: Mapping): ColumnRequest | null {
  const context = buildImportProposalContext(file, mapping);
  if (!context) return null;
  const allowed = context.unresolvedFields.filter(field => mapping.mode === 'signed'
    ? field !== 'debit' && field !== 'credit' : field !== 'amount');
  const data = JSON.stringify({
    mode: mapping.mode, allowed,
    columns: context.columns.map(c => ({
      index: c.index,
      header: { id: `r${c.header.row}c${c.header.column}`, text: c.header.text, truncated: c.header.truncated },
      samples: c.samples.map(s => ({ id: `r${s.row}c${s.column}`, text: s.text, truncated: s.truncated })),
      issueCount: c.issueCount,
    })),
  });
  if (new TextEncoder().encode(data).byteLength > 8192) return null;
  return { context, readingSnapshot: snapshot(file, mapping), data, allowed };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every(k => typeof k === 'string' &&
      Object.getOwnPropertyDescriptor(value, k)?.enumerable === true &&
      'value' in Object.getOwnPropertyDescriptor(value, k)!);
}
/** A binding and shape check; even a valid result is ONLY needs-review. */
export function bindColumnProposal(file: SourceFile, mapping: Mapping, request: ColumnRequest, raw: string) {
  if (snapshot(file, mapping) !== request.readingSnapshot ||
    JSON.stringify(buildImportProposalContext(file, mapping)) !== JSON.stringify(request.context))
    return { kind: 'rejected' as const, reason: 'stale-source' };
  if (new TextEncoder().encode(raw).byteLength > 4096)
    return { kind: 'rejected' as const, reason: 'oversized-output' };
  let output: unknown;
  try { output = JSON.parse(raw); } catch { return { kind: 'rejected' as const, reason: 'invalid-json' }; }
  if (!record(output) || Object.keys(output).length !== 2 ||
    !record(output.columns) || !record(output.citations) ||
    Object.keys(output).some(k => !['columns', 'citations'].includes(k)))
    return { kind: 'rejected' as const, reason: 'invalid-schema' };
  const fields = Object.keys(output.columns);
  if (Object.keys(output.citations).length !== fields.length ||
    Object.keys(output.citations).some(k => !fields.includes(k)))
    return { kind: 'rejected' as const, reason: 'citation-keys' };
  if (!fields.length) return { kind: 'abstained' as const };
  for (const field of fields) {
    const index = output.columns[field];
    if (!request.allowed.includes(field as ImportProposalField) ||
      typeof index !== 'number' || !Number.isSafeInteger(index) ||
      index < 0 || index >= request.context.columns.length)
      return { kind: 'rejected' as const, reason: 'unknown-role-or-column' };
    const header = request.context.columns[index].header;
    if (header.truncated || output.citations[field] !== `r${header.row}c${header.column}`)
      return { kind: 'rejected' as const, reason: 'unproven-citation' };
  }
  const context = request.context;
  const verified = verifyImportProposal(file, mapping, {
    sourceHash: context.sourceHash, sheet: context.sheet, header: context.header,
    baseline: context.baseline, columns: output.columns,
  });
  return verified.ok
    ? { kind: 'needs-review' as const, verified }
    : { kind: 'rejected' as const, reason: verified.code };
}
