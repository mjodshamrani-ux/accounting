import { normalizeReference } from './core.ts';
import type { SourceResult, Transaction } from './types.ts';

export type PaymentIdentityClaim = {
  field: 'bankReference' | 'receiptReference';
  value: string;
  members: Transaction[];
};
export type PaymentComponent = {
  supplier: Transaction[];
  ledger: Transaction[];
  claims: PaymentIdentityClaim[];
  completeClaims: PaymentIdentityClaim[];
  competing: boolean;
  excluded: boolean;
};

/** Membership, not a financial solver. Every original identity occurrence is
 * indexed before type/date/amount/safety/decisions are considered. Inferred
 * values can obstruct a claim but never supply explicit role provenance.
 * Connected components are linear in source occurrences; we neither enumerate
 * subsets nor maximize matched rows to manufacture a unique interpretation. */
export function paymentIdentityComponents(
  supplier: SourceResult,
  ledger: SourceResult,
): PaymentComponent[] {
  const rows = [...supplier.transactions, ...ledger.transactions];
  const byId = new Map(rows.map((t) => [t.id, t]));
  const parent = new Map(rows.map((t) => [t.id, t.id]));
  const rank = new Map<string, number>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (id !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    let x = find(a),
      y = find(b);
    if (x === y) return;
    if ((rank.get(x) ?? 0) < (rank.get(y) ?? 0)) [x, y] = [y, x];
    parent.set(y, x);
    if ((rank.get(x) ?? 0) === (rank.get(y) ?? 0))
      rank.set(x, (rank.get(x) ?? 0) + 1);
  };
  const claims = new Map<string, PaymentIdentityClaim>();
  const primary = new Map<string, Transaction[]>();
  for (const t of rows) {
    const bucket = primary.get(t.normalizedReference) ?? [];
    bucket.push(t);
    primary.set(t.normalizedReference, bucket);
    for (const field of ['bankReference', 'receiptReference'] as const) {
      const value = t[field];
      if (!value) continue;
      const key = JSON.stringify([field, value]);
      const claim = claims.get(key) ?? { field, value, members: [] };
      claim.members.push(t);
      claims.set(key, claim);
    }
  }
  // An inferred PAY/document value is not a second receipt claim. It only
  // joins an identity that an explicit column states somewhere in the source.
  // Otherwise a fallback on blank cells could manufacture a rival subset.
  for (const [key, claim] of claims)
    if (
      !claim.members.some((t) => t.paymentIdentityFields?.includes(claim.field))
    )
      claims.delete(key);
  const linkedPrimary = new Set<string>();
  for (const claim of claims.values()) {
    for (const t of claim.members) union(claim.members[0].id, t.id);
    // A row carrying the identity only as its primary reference is still a
    // possible missing member. Keep normalized collisions as blockers too.
    // This is negative evidence, never authority to add a member to a match.
    const normalized = normalizeReference(claim.value);
    const related = primary.get(normalized) ?? [];
    if (related.length) {
      union(claim.members[0].id, related[0].id);
      // Join a normalization-collision bucket once, not once per spelling.
      if (!linkedPrimary.has(normalized)) {
        for (const t of related) union(related[0].id, t.id);
        linkedPrimary.add(normalized);
      }
    }
  }
  const components = new Map<
    string,
    { rows: Transaction[]; claims: PaymentIdentityClaim[] }
  >();
  for (const t of rows) {
    const root = find(t.id);
    const component = components.get(root) ?? { rows: [], claims: [] };
    component.rows.push(byId.get(t.id)!);
    components.set(root, component);
  }
  for (const claim of claims.values())
    components.get(find(claim.members[0].id))!.claims.push(claim);
  const excluded = new Set(
    [...supplier.excluded, ...ledger.excluded]
      .filter((row) => row.kind !== 'non-movement')
      .flatMap((r) => r.values.map((v) => v.trim()).filter(Boolean)),
  );
  return [...components.values()]
    .filter(
      (c) =>
        c.claims.length && c.rows.some((t) => t.documentType === 'Payment'),
    )
    .map((c) => {
      const a = c.rows.filter((t) => t.side === 'supplier');
      const b = c.rows.filter((t) => t.side === 'ledger');
      const cross = c.claims.filter(
        (claim) =>
          claim.members.some((t) => t.side === 'supplier') &&
          claim.members.some((t) => t.side === 'ledger'),
      );
      const completeClaims = cross.filter(
        (claim) => claim.members.length === c.rows.length,
      );
      return {
        supplier: a,
        ledger: b,
        claims: c.claims,
        completeClaims,
        // A one-sided annotation contained in a complete identity is not an
        // alternative pairing. Any outside member expands this component and
        // prevents that identity being complete. Cross-side partial claims
        // are competing interpretations even when their amounts do not tie.
        competing:
          !!(a.length && b.length) &&
          (!completeClaims.length ||
            cross.some((claim) => claim.members.length !== c.rows.length)),
        excluded: c.claims.some((claim) => excluded.has(claim.value)),
      };
    });
}
