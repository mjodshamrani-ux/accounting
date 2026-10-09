import { safeSum } from './core.ts';
import { hasUnsafeReferenceText } from './transaction-references.ts';
import { searchInvoiceGroups } from './invoice-group-search.ts';
import type {
  InvoiceGroupCandidate,
  InvoiceGroupSearchReason,
  InvoiceSearchSource,
} from './invoice-group-search.ts';
import type { Scope, Transaction } from './types.ts';

export const INVOICE_OVERLAP_SEARCH_VERSION = 'INVOICE_OVERLAP_SEARCH_V1';
export type InvoiceOverlapLimits = {
  physicalRows: number;
  componentRows: number;
  candidates: number;
  expansions: number;
};
export const INVOICE_OVERLAP_LIMITS: Readonly<InvoiceOverlapLimits> =
  Object.freeze({
    physicalRows: 40000,
    componentRows: 16,
    candidates: 256,
    expansions: 50000,
  });
export type InvoiceOverlapReason =
  | Exclude<InvoiceGroupSearchReason, 'amount-mismatch' | 'missing-counterpart'>
  | 'invalid-revision'
  | 'overlapping-candidates'
  | 'unread-competitor'
  | 'cancelled';
export const INVOICE_OVERLAP_HARD_REASONS: readonly InvoiceOverlapReason[] =
  Object.freeze([
    'scope-unverified',
    'invalid-revision',
    'physical-membership-incomplete',
    'unknown-membership',
    'duplicate-invoice-members',
    'invalid-invoice-member',
    'date-outside-scope',
    'same-source',
    'resource-limit',
    'unread-competitor',
    'cancelled',
  ]);
export type InvoiceOverlapRow = {
  key: string;
  side: 'supplier' | 'ledger';
  sourceHash: string;
  sheet: string;
  row: number;
  transactionId?: string;
  disposition: InvoiceSearchSource['physicalRows'][number]['disposition'];
  identities: InvoiceSearchSource['physicalRows'][number]['identities'];
  amountMinor: number | null;
  date: string | null;
  invoice: string;
  selectedReference: string;
};
export type InvoiceOverlapCandidate = {
  id: string;
  componentId: string;
  invoice: string;
  selectedReference: string;
  supplierIds: string[];
  ledgerIds: string[];
  rowKeys: string[];
  totalMinor: number;
  status: 'candidate' | 'needs-review';
  reasons: InvoiceOverlapReason[];
  competingCandidateIds: string[];
  evidence: InvoiceGroupCandidate['evidence'] & {
    searchRule: typeof INVOICE_OVERLAP_SEARCH_VERSION;
    membershipBasis: 'explicit-own-invoice-and-selected-document';
    residualRowKeys: string[];
  };
};
export type InvoiceOverlapComponent = {
  id: string;
  invoice: string;
  selectedReference: string;
  rowKeys: string[];
  candidateRowKeys: string[];
  residualRowKeys: string[];
  candidateIds: string[];
  conflictingCandidateIds: string[];
  competingRows: InvoiceGroupCandidate['competingRows'];
  reasons: InvoiceOverlapReason[];
  complete: boolean;
  status: 'candidate' | 'needs-review';
};
export type InvoiceOverlapCounters = {
  physicalRows: number;
  expansions: number;
  candidates: number;
  components: number;
};
export type InvoiceOverlapProgress = {
  phase: 'inventory' | 'subsets' | 'components';
  counters: InvoiceOverlapCounters;
};
export type InvoiceOverlapSearchInput = {
  sources: [InvoiceSearchSource, InvoiceSearchSource];
  scope: Scope;
  revision: string;
  limits?: Partial<InvoiceOverlapLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: InvoiceOverlapProgress) => void;
};
export type InvoiceOverlapSearchResult = {
  version: typeof INVOICE_OVERLAP_SEARCH_VERSION;
  snapshotKey: string;
  revision: string;
  searchComplete: boolean;
  status: 'complete' | 'needs-review';
  reasons: InvoiceOverlapReason[];
  candidates: InvoiceOverlapCandidate[];
  components: InvoiceOverlapComponent[];
  rows: InvoiceOverlapRow[];
  unmatchedRows: InvoiceOverlapRow[];
  counters: InvoiceOverlapCounters;
  matches: [];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v: string | undefined) => (v ?? '').trim();
export const invoiceOverlapRowKey = (side: 'supplier' | 'ledger', id: string) =>
  `${side}:${id}`;
const physicalKey = (side: 'supplier' | 'ledger', sheet: string, row: number) =>
  `${side}:physical:${JSON.stringify([sheet, row])}`;
const selectedPart = (t: Transaction) =>
  t.chosenReferenceEvidence?.role === 'document-reference' &&
  text(t.chosenReference) !== text(t.documentReference)
    ? text(t.chosenReference)
    : '';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => cmp(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Exhaustive bounded candidate generation within an explicit identity relation.
 * Financial approval is owned by the separately verified atomic review layer.
 * The caller must first replay native original bytes; source caches alone are
 * not an authorization boundary. Own a clone before the first event-loop yield. */
export async function searchInvoiceOverlaps(
  input: InvoiceOverlapSearchInput,
): Promise<InvoiceOverlapSearchResult> {
  const signal = input.signal,
    onProgress = input.onProgress;
  const owned = structuredClone({
    sources: input.sources,
    scope: input.scope,
    revision: input.revision,
    limits: input.limits,
  });
  const limits: InvoiceOverlapLimits = { ...INVOICE_OVERLAP_LIMITS };
  for (const key of Object.keys(limits) as (keyof InvoiceOverlapLimits)[]) {
    const v = owned.limits?.[key];
    if (v !== undefined && Number.isSafeInteger(v) && v > 0)
      limits[key] = Math.min(limits[key], v);
  }
  // Canonical source order, member order and identity order do not carry decisions.
  for (const source of owned.sources) {
    source.transactions.sort((a, b) => cmp(a.id, b.id));
    source.sheets.sort((a, b) => cmp(a.sheet, b.sheet));
    source.physicalRows.sort((a, b) => cmp(a.sheet, b.sheet) || a.row - b.row);
    for (const row of source.physicalRows)
      row.identities.sort(
        (a, b) => cmp(a.role, b.role) || cmp(a.value, b.value),
      );
  }
  const snapshotKey = canonical({
    version: INVOICE_OVERLAP_SEARCH_VERSION,
    revision: owned.revision,
    scope: owned.scope,
    sources: owned.sources,
    limits,
  });
  const counters: InvoiceOverlapCounters = {
    physicalRows: 0,
    expansions: 0,
    candidates: 0,
    components: 0,
  };
  const reasons = new Set<InvoiceOverlapReason>();
  const candidates: InvoiceOverlapCandidate[] = [],
    components: InvoiceOverlapComponent[] = [];
  const byKey = new Map<string, Transaction>();
  for (const source of owned.sources)
    for (const t of source.transactions)
      byKey.set(invoiceOverlapRowKey(source.side, t.id), t);
  const rows: InvoiceOverlapRow[] = owned.sources.flatMap((source) =>
    source.physicalRows.map((row) => {
      const t = row.transactionId
        ? byKey.get(invoiceOverlapRowKey(source.side, row.transactionId))
        : undefined;
      return {
        key:
          row.disposition === 'movement' && row.transactionId
            ? invoiceOverlapRowKey(source.side, row.transactionId)
            : physicalKey(source.side, row.sheet, row.row),
        side: source.side,
        sourceHash: source.sourceHash,
        sheet: row.sheet,
        row: row.row,
        transactionId: row.transactionId,
        disposition: row.disposition,
        identities: row.identities,
        amountMinor: Number.isSafeInteger(t?.amountMinor)
          ? t!.amountMinor!
          : null,
        date: t?.date ?? null,
        invoice: text(t?.documentReference),
        selectedReference: t ? selectedPart(t) : '',
      };
    }),
  );
  let interrupted = false,
    chargedSinceYield = 0;
  const finish = (): InvoiceOverlapSearchResult => {
    if (interrupted) {
      for (const candidate of candidates) {
        candidate.status = 'needs-review';
        candidate.reasons = [
          ...new Set([...candidate.reasons, ...reasons]),
        ].sort(cmp);
      }
      for (const component of components) {
        component.complete = false;
        component.status = 'needs-review';
        component.reasons = [
          ...new Set([...component.reasons, ...reasons]),
        ].sort(cmp);
      }
    }
    const used = new Set(candidates.flatMap((c) => c.rowKeys));
    return {
      version: INVOICE_OVERLAP_SEARCH_VERSION,
      snapshotKey,
      revision: owned.revision,
      searchComplete: !interrupted,
      status:
        interrupted ||
        reasons.size ||
        components.some((c) => c.status === 'needs-review')
          ? 'needs-review'
          : 'complete',
      reasons: [...reasons].sort(cmp),
      candidates,
      components,
      rows,
      unmatchedRows: rows.filter(
        (row) => row.disposition !== 'non-movement' && !used.has(row.key),
      ),
      counters: { ...counters },
      matches: [],
    };
  };
  const checkpoint = async (
    phase: InvoiceOverlapProgress['phase'],
    charge = 1,
  ): Promise<boolean> => {
    if (signal?.aborted) {
      reasons.add('cancelled');
      interrupted = true;
      return false;
    }
    if (counters.expansions + charge > limits.expansions) {
      reasons.add('resource-limit');
      interrupted = true;
      return false;
    }
    counters.expansions += charge;
    chargedSinceYield += charge;
    if (chargedSinceYield >= 256) {
      onProgress?.({ phase, counters: { ...counters } });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      chargedSinceYield = 0;
      if (signal?.aborted) {
        reasons.add('cancelled');
        interrupted = true;
        return false;
      }
    }
    return true;
  };
  if (typeof owned.revision !== 'string' || !owned.revision.trim())
    reasons.add('invalid-revision');
  if (owned.sources.some((source) => source.readingBindingValid !== true))
    reasons.add('physical-membership-incomplete');
  if (
    rows.length > limits.physicalRows ||
    owned.sources.some(
      (source) => source.transactions.length > limits.physicalRows,
    )
  ) {
    reasons.add('resource-limit');
    interrupted = true;
    return finish();
  }
  for (const row of rows) {
    if (!(await checkpoint('inventory'))) return finish();
    counters.physicalRows++;
    if (row.identities.length > 12) {
      reasons.add('resource-limit');
      interrupted = true;
      return finish();
    }
  }
  // Reuse the accepted physical/role/scope guards, not its all-member amount
  // equality or complete-group financial decision. It never produces matches.
  const guarded = searchInvoiceGroups({
    sources: owned.sources,
    scope: owned.scope,
    limits: {
      physicalRows: limits.physicalRows,
      members: limits.componentRows,
      candidates: limits.candidates,
      expansions: INVOICE_OVERLAP_LIMITS.expansions,
    },
  });
  for (const reason of guarded.reasons)
    if (reason !== 'amount-mismatch' && reason !== 'missing-counterpart')
      reasons.add(reason);
  if (!guarded.searchComplete) {
    reasons.add('resource-limit');
    interrupted = true;
    return finish();
  }
  if (signal?.aborted) {
    reasons.add('cancelled');
    interrupted = true;
    return finish();
  }
  type Domain = {
    group: InvoiceGroupCandidate;
    rowKeys: string[];
    candidates: InvoiceOverlapCandidate[];
    reasons: Set<InvoiceOverlapReason>;
  };
  const domains: Domain[] = [];
  for (const group of guarded.candidates) {
    const groupReasons = new Set<InvoiceOverlapReason>([
      ...reasons,
      ...(group.reasons.filter(
        (r) => r !== 'amount-mismatch' && r !== 'missing-counterpart',
      ) as InvoiceOverlapReason[]),
    ]);
    if (
      group.competingRows.some(
        (c) =>
          !c.transactionId ||
          owned.sources[c.side === 'supplier' ? 0 : 1].physicalRows.some(
            (r) =>
              r.sheet === c.sheet &&
              r.row === c.row &&
              r.disposition !== 'movement',
          ),
      )
    )
      groupReasons.add('unread-competitor');
    for (const competitor of group.competingRows) {
      const transaction = competitor.transactionId
        ? byKey.get(
            invoiceOverlapRowKey(competitor.side, competitor.transactionId),
          )
        : undefined;
      if (!transaction) continue;
      if (
        !transaction.documentType ||
        transaction.documentType === 'Unknown' ||
        transaction.referenceEvidenceIssues?.length ||
        hasUnsafeReferenceText(transaction) ||
        !Number.isSafeInteger(transaction.amountMinor) ||
        transaction.amount !== transaction.amountMinor ||
        transaction.currency !== owned.scope.currency
      )
        groupReasons.add('unread-competitor');
      const date = transaction.date;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date ||
        date > owned.scope.cutoff
      )
        groupReasons.add('date-outside-scope');
      if (
        (transaction.documentType === 'Invoice' &&
          !(transaction.amountMinor! > 0)) ||
        ((transaction.documentType === 'Payment' ||
          transaction.documentType === 'Credit Note') &&
          !(transaction.amountMinor! < 0))
      )
        groupReasons.add('invalid-invoice-member');
    }
    const groupRows = group.evidence.members
      .map((member) => byKey.get(invoiceOverlapRowKey(member.side, member.id)))
      .filter((t): t is Transaction => !!t);
    // Repeated local posting identity is not independent evidence of two lines.
    const vouchers = new Set<string>();
    for (const t of groupRows)
      if (text(t.voucherReference)) {
        const key = canonical([t.side, text(t.voucherReference)]);
        if (vouchers.has(key)) groupReasons.add('duplicate-invoice-members');
        vouchers.add(key);
      }
    const allKeys = groupRows
      .map((t) => invoiceOverlapRowKey(t.side, t.id))
      .sort(cmp);
    const domain: Domain = {
      group,
      rowKeys: allKeys,
      candidates: [],
      reasons: groupReasons,
    };
    domains.push(domain);
    if (allKeys.length > limits.componentRows) {
      reasons.add('resource-limit');
      interrupted = true;
      break;
    }
    const supplier = groupRows
      .filter((t) => t.side === 'supplier')
      .sort((a, b) => cmp(a.id, b.id));
    const ledger = groupRows
      .filter((t) => t.side === 'ledger')
      .sort((a, b) => cmp(a.id, b.id));
    type Subset = {
      members: Transaction[];
      keys: string[];
      sum: number | null;
    };
    const subsets = async (
      members: Transaction[],
    ): Promise<Subset[] | null> => {
      const values: Subset[] = [];
      for (let mask = 1; mask < 2 ** members.length; mask++) {
        if (!(await checkpoint('subsets'))) return null;
        const selected = members.filter((_, i) => Boolean(mask & (2 ** i)));
        let sum: number | null = null;
        if (selected.every((t) => Number.isSafeInteger(t.amountMinor)))
          try {
            sum = safeSum(selected.map((t) => t.amountMinor!));
          } catch {
            /* Preserve original rows; unsafe totals cannot become candidates. */
          }
        values.push({
          members: selected,
          keys: selected.map((t) => invoiceOverlapRowKey(t.side, t.id)),
          sum,
        });
      }
      return values;
    };
    const a = await subsets(supplier);
    if (!a) break;
    const b = await subsets(ledger);
    if (!b) break;
    // Arithmetic indexes filter an already-proved identity relation. Keep every
    // membership at a subtotal; choosing the first would erase alternatives.
    const ledgerBySum = new Map<number, Subset[]>();
    for (const subset of b) {
      if (!(await checkpoint('subsets'))) break;
      if (subset.sum !== null && subset.sum > 0) {
        const alternatives = ledgerBySum.get(subset.sum) ?? [];
        alternatives.push(subset);
        ledgerBySum.set(subset.sum, alternatives);
      }
    }
    if (interrupted) break;
    for (const sa of a) {
      if (!(await checkpoint('subsets'))) break;
      for (const sb of sa.sum !== null ? (ledgerBySum.get(sa.sum) ?? []) : []) {
        if (!(await checkpoint('subsets'))) break;
        if (
          sa.sum === null ||
          sb.sum === null ||
          sa.sum <= 0 ||
          sa.sum !== sb.sum
        )
          continue;
        if (candidates.length >= limits.candidates) {
          reasons.add('resource-limit');
          interrupted = true;
          break;
        }
        const supplierIds = sa.members.map((t) => t.id),
          ledgerIds = sb.members.map((t) => t.id),
          rowKeys = [...sa.keys, ...sb.keys].sort(cmp);
        const id = `${INVOICE_OVERLAP_SEARCH_VERSION}:candidate:${canonical([group.invoice, group.selectedReference, supplierIds, ledgerIds])}`;
        const memberKeys = new Set(rowKeys);
        const candidate: InvoiceOverlapCandidate = {
          id,
          componentId: '',
          invoice: group.invoice,
          selectedReference: group.selectedReference,
          supplierIds,
          ledgerIds,
          rowKeys,
          totalMinor: sa.sum,
          status: groupReasons.size ? 'needs-review' : 'candidate',
          reasons: [...groupReasons].sort(cmp),
          competingCandidateIds: [],
          evidence: {
            ...structuredClone(group.evidence),
            members: group.evidence.members.filter((m) =>
              memberKeys.has(invoiceOverlapRowKey(m.side, m.id)),
            ),
            searchRule: INVOICE_OVERLAP_SEARCH_VERSION,
            membershipBasis: 'explicit-own-invoice-and-selected-document',
            residualRowKeys: allKeys.filter((k) => !memberKeys.has(k)),
          },
        };
        candidates.push(candidate);
        domain.candidates.push(candidate);
        counters.candidates = candidates.length;
      }
      if (interrupted) break;
    }
    if (interrupted) break;
  }
  // Construct connected components of candidates through shared source rows.
  // Never solve by forcing every row into a candidate or maximizing coverage.
  for (const domain of domains) {
    const remaining = new Set(domain.candidates.map((c) => c.id));
    const componentsInDomain: InvoiceOverlapComponent[] = [];
    const candidatesById = new Map(domain.candidates.map((c) => [c.id, c]));
    const atRow = new Map<string, string[]>();
    for (const candidate of domain.candidates)
      for (const row of candidate.rowKeys) {
        if (!(await checkpoint('components'))) return finish();
        const list = atRow.get(row) ?? [];
        list.push(candidate.id);
        atRow.set(row, list);
      }
    const seeds = domain.candidates.length
      ? domain.candidates.map((c) => c.id)
      : [''];
    for (const seed of seeds) {
      if (seed && !remaining.has(seed)) continue;
      const members: InvoiceOverlapCandidate[] = [],
        queue = seed ? [seed] : [];
      while (queue.length) {
        if (!(await checkpoint('components'))) return finish();
        const id = queue.pop()!;
        if (!remaining.delete(id)) continue;
        const candidate = candidatesById.get(id)!;
        members.push(candidate);
        for (const row of candidate.rowKeys)
          for (const next of atRow.get(row) ?? []) {
            if (!(await checkpoint('components'))) return finish();
            if (remaining.has(next)) queue.push(next);
          }
      }
      members.sort((a, b) => cmp(a.id, b.id));
      const candidateRowKeys = [
        ...new Set(members.flatMap((c) => c.rowKeys)),
      ].sort(cmp);
      const competitorKeys = domain.group.competingRows.map((c) =>
        c.transactionId
          ? invoiceOverlapRowKey(c.side, c.transactionId)
          : physicalKey(c.side, c.sheet, c.row),
      );
      const rowKeys = [...new Set([...domain.rowKeys, ...competitorKeys])].sort(
        cmp,
      );
      const residualRowKeys = domain.rowKeys.filter(
        (key) => !candidateRowKeys.includes(key),
      );
      const componentReasons = new Set(domain.reasons);
      const conflictingCandidateIds = new Set<string>();
      for (const candidate of members) {
        const ownRows = new Set(candidate.rowKeys);
        const conflicts: string[] = [];
        for (const other of members) {
          if (!(await checkpoint('components'))) return finish();
          if (
            other.id !== candidate.id &&
            other.rowKeys.some((row) => ownRows.has(row))
          )
            conflicts.push(other.id);
        }
        conflicts.sort(cmp);
        candidate.competingCandidateIds = conflicts;
        if (conflicts.length) {
          componentReasons.add('overlapping-candidates');
          conflictingCandidateIds.add(candidate.id);
        }
      }
      if (rowKeys.length > limits.componentRows) {
        componentReasons.add('resource-limit');
        reasons.add('resource-limit');
        interrupted = true;
      }
      const id = `${INVOICE_OVERLAP_SEARCH_VERSION}:component:${canonical([domain.group.invoice, domain.group.selectedReference, rowKeys])}`;
      const component: InvoiceOverlapComponent = {
        id,
        invoice: domain.group.invoice,
        selectedReference: domain.group.selectedReference,
        rowKeys,
        candidateRowKeys,
        residualRowKeys,
        candidateIds: members.map((c) => c.id),
        conflictingCandidateIds: [...conflictingCandidateIds].sort(cmp),
        competingRows: structuredClone(domain.group.competingRows),
        reasons: [...componentReasons].sort(cmp),
        complete: !interrupted,
        status:
          componentReasons.size || !members.length
            ? 'needs-review'
            : 'candidate',
      };
      for (const candidate of members) {
        candidate.componentId = id;
        candidate.reasons = [
          ...new Set([...candidate.reasons, ...componentReasons]),
        ].sort(cmp);
        candidate.status = candidate.reasons.length
          ? 'needs-review'
          : 'candidate';
      }
      components.push(component);
      componentsInDomain.push(component);
      counters.components = components.length;
    }
    // Components generated from a truncated set remain explicitly incomplete.
    if (interrupted)
      for (const component of componentsInDomain) component.complete = false;
  }
  onProgress?.({ phase: 'components', counters: { ...counters } });
  if (signal?.aborted) {
    reasons.add('cancelled');
    interrupted = true;
  }
  return finish();
}
