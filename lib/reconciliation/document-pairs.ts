import type { SourceResult, Transaction } from './types.ts';

export const DOCUMENT_PAIR_RULE = 'EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1';

const strongDiscriminator = (t: Transaction) => {
  const value = t.chosenReference ?? '';
  return (
    t.chosenReferenceEvidence?.role === 'document-reference' &&
    value.length >= 4 &&
    /\p{L}/u.test(value) &&
    /\p{Nd}/u.test(value) &&
    value !== t.reference &&
    !t.referenceEvidenceIssues?.length
  );
};

const index = (rows: Transaction[], key: (t: Transaction) => string) => {
  const result = new Map<string, Transaction[]>();
  for (const t of rows) {
    const k = key(t);
    const bucket = result.get(k) ?? [];
    bucket.push(t);
    result.set(k, bucket);
  }
  return result;
};

/** Identity certificates only. Amount/date/conflict/decision guards still run
 * in compare. Read the entire original buckets before any row is consumed:
 * a different amount, a distant date or a manual/rejected decision must never
 * make a repeated discriminator appear unique. This is not subset summation. */
export function certifiedDocumentPairs(
  supplier: SourceResult,
  ledger: SourceResult,
): [Transaction, Transaction][] {
  if (supplier.errors.length || ledger.errors.length) return [];
  const a = index(supplier.transactions, (t) => t.normalizedReference);
  const b = index(ledger.transactions, (t) => t.normalizedReference);
  const excludedValues = new Set(
    [...supplier.excluded, ...ledger.excluded].flatMap((e) =>
      e.values.map((v) => v.trim()).filter(Boolean),
    ),
  );
  const pairs: [Transaction, Transaction][] = [];
  for (const [primary, left] of a) {
    const right = b.get(primary);
    if (!right || (left.length === 1 && right.length === 1)) continue;
    const document = left[0].documentReference;
    // A missing/unsafe discriminator in the same document bucket is an
    // unresolved competitor, not evidence of a different identity. Include
    // normalized-primary collisions, but require literal identity equality.
    if (
      !document ||
      excludedValues.has(document) ||
      ![...left, ...right].every(
        (t) =>
          t.documentReference === document &&
          t.reference === document &&
          t.documentType !== 'Payment' &&
          t.documentType !== 'Journal' &&
          strongDiscriminator(t) &&
          !excludedValues.has(t.chosenReference!),
      )
    )
      continue;
    const leftByReference = index(left, (t) => t.chosenReference!);
    const rightByReference = index(right, (t) => t.chosenReference!);
    for (const [reference, candidates] of leftByReference) {
      const counterparts = rightByReference.get(reference);
      if (candidates.length === 1 && counterparts?.length === 1)
        pairs.push([candidates[0], counterparts[0]]);
    }
  }
  return pairs;
}
