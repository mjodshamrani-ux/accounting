import type { SourceResult, Transaction } from './types.ts';
import {
  DOCUMENT_LABELS,
  hasUnsafeReferenceText,
} from './transaction-references.ts';
import { summaryLabel } from './row-labels.ts';

export const DOCUMENT_PAIR_RULE = 'EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1';

const categoryLabels = Object.values(DOCUMENT_LABELS).map(
  (pattern) => new RegExp(`^(?:${pattern})$`, 'iu'),
);
const nonIdentityLabel =
  /^(?:n[/.]?a\.?|not (?:available|applicable|provided)|none|null|unknown|undefined|missing|tbd|pending|no ref(?:erence)?|total|sub ?total|grand total|summary|balance|(?:opening|closing|running|brought forward|carried forward) balance|balance (?:brought forward|carried forward)|debit|credit|dr|cr|بدون(?: مرجع)?|غير (?:متوفر|متاح|معروف)|لا يوجد|[إا]جمالي(?: الحساب)?|(?:ال)?مجموع|(?:ال)?رصيد(?: (?:الافتتاحي|الختامي|افتتاحي|ختامي|مرحل))?|مدين|دائن)$/iu;
const usableDiscriminator = (value: string) => {
  // This spelling check rejects known non-identities only. Identity equality
  // below ALWAYS uses the original literal text. A digit, alphabetic or Arabic
  // code needs no Latin letter+digit shape inside an already proven document.
  const label = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return (
    /[\p{L}\p{Nd}]/u.test(label) &&
    !/^[0٠۰\s.,٬٫+()\-]+$/u.test(label) &&
    !nonIdentityLabel.test(label) &&
    !summaryLabel.test(label) &&
    !categoryLabels.some((pattern) => pattern.test(label))
  );
};
const strongDiscriminator = (t: Transaction) => {
  const value = t.chosenReference ?? '';
  return (
    t.chosenReferenceEvidence?.role === 'document-reference' &&
    usableDiscriminator(value) &&
    !hasUnsafeReferenceText(t) &&
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
export function certifiedDocumentPartitions(
  supplier: SourceResult,
  ledger: SourceResult,
): [Transaction[], Transaction[]][] {
  if (supplier.errors.length || ledger.errors.length) return [];
  const a = index(supplier.transactions, (t) => t.normalizedReference);
  const b = index(ledger.transactions, (t) => t.normalizedReference);
  const excludedValues = new Set(
    [...supplier.excluded, ...ledger.excluded].flatMap((e) =>
      e.values.map((v) => v.trim()).filter(Boolean),
    ),
  );
  const partitions: [Transaction[], Transaction[]][] = [];
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
      if (counterparts) partitions.push([candidates, counterparts]);
    }
  }
  return partitions;
}

export function certifiedDocumentPairs(
  supplier: SourceResult,
  ledger: SourceResult,
): [Transaction, Transaction][] {
  const pairs: [Transaction, Transaction][] = [];
  for (const [candidates, counterparts] of certifiedDocumentPartitions(
    supplier,
    ledger,
  ))
    if (candidates.length === 1 && counterparts?.length === 1)
      pairs.push([candidates[0], counterparts[0]]);
  return pairs;
}
