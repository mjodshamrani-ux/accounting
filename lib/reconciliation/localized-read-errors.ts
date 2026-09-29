import { headerLabels, headerCellIssues } from './header-view.ts';
import { normalizeReference } from './core.ts';
import { usableDiscriminator } from './document-pairs.ts';
import { summaryLabel } from './row-labels.ts';
import type { transactionReferences } from './transaction-references.ts';
import type {
  Mapping,
  SheetData,
  SourceReadError,
  SourceResult,
  Transaction,
} from './types.ts';

type References = ReturnType<typeof transactionReferences>;
type IdentityEvidence = Partial<Transaction>;
const fields = [
  'reference',
  'primaryReference',
  'documentReference',
  'chosenReference',
  'statedReference',
  'voucherReference',
  'poReference',
  'bankReference',
  'receiptReference',
] as const;

/** A deliberately conservative collision key, never positive match evidence.
 * Cross-role and normalized lookalikes must still obstruct a proposed proof. */
export function referenceEnvelopeKeys(evidence: IdentityEvidence): string[] {
  const values = fields.map((field) => evidence[field]);
  for (const item of evidence.retainedEvidence ?? [])
    if (item.field !== 'documentTypeLabel') values.push(item.value);
  return [
    ...new Set(
      values.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const key = normalizeReference(value);
        return key ? [`identity:${key}`] : [];
      }),
    ),
  ].sort();
}

/** Capture identities before parsing dates or amounts. The row may fail its
 * finances, but only a complete, structurally sound reference reading can
 * prove that its possible competitors are confined to these keys. */
export function safeReferenceEnvelope(
  sheet: SheetData,
  mapping: Mapping,
  row: string[],
  rn: number,
  references: References,
): SourceReadError['isolation'] {
  const header = headerLabels(sheet, mapping.header);
  if (
    !header ||
    sheet.rowIssues?.[rn]?.length ||
    sheet.rowIssues?.[mapping.header + 1]?.length ||
    sheet.hiddenRows.includes(rn) ||
    row.slice(header.length).some((value) => value.trim()) ||
    (!sheet.cellIssues &&
      (sheet.formulaRows.includes(rn) ||
        sheet.formulaRows.includes(mapping.header + 1))) ||
    references.referenceEvidenceIssues.length ||
    summaryLabel.test(references.primaryReference.split(/[:：]/u)[0].trim()) ||
    !usableDiscriminator(references.primaryReference)
  )
    return;
  // The same header labels in different columns explicitly contradict the
  // current mapping. A word such as "Amount" is not a safely isolated row ID.
  if (
    row.length === header.length &&
    header.some((cell) => cell.trim() === row[0]?.trim())
  ) {
    const sortedHeader = header.map((cell) => cell.trim()).sort();
    if (
      row
        .map((value) => value.trim())
        .sort()
        .every((value, i) => value === sortedHeader[i])
    )
      return;
  }
  // A manually selected helper is retained as conflict evidence, but it cannot
  // make an otherwise unidentified failed row safe to isolate.
  const referenceLike = (value: string) =>
    /\p{L}/u.test(value) && /\p{Nd}/u.test(value);
  const roleProven =
    !!references.documentReference ||
    (!!references.chosenReferenceEvidence &&
      normalizeReference(references.primaryReference).length >= 4 &&
      referenceLike(references.primaryReference)) ||
    !!references.paymentIdentityFields.length;
  if (!roleProven) return;
  if (mapping.reference >= 0) {
    if (headerCellIssues(sheet, mapping.header, mapping.reference).length)
      return;
    for (const key of [`${rn}:${mapping.reference + 1}`])
      if (
        sheet.cellIssues?.[key]?.length ||
        sheet.referenceIssues?.[key]?.length
      )
        return;
  }
  // Preserve EVERY literal cell as a potential competitor. The spelling of a
  // failed amount/date cannot distinguish corruption from a displaced ID.
  // These are negative keys only, never repaired financial or identity facts.
  const keys = [
    ...new Set([
      ...referenceEnvelopeKeys(references),
      ...row.flatMap((value) => referenceEnvelopeKeys({ reference: value })),
    ]),
  ].sort();
  return keys.length ? { rule: 'SAFE_REFERENCE_ENVELOPE_V1', keys } : undefined;
}

export function balanceOnlyError(error: SourceReadError): boolean {
  return error.row === 0 && error.scope === 'balance';
}

/** Scope observations must include failed movements: a bad amount cannot hide
 * a second vendor/account/currency. These are row addresses, not transactions. */
export function sourceRowsForScope(source: SourceResult) {
  const rows = new Map<number, { row: number; sourcePage?: number }>();
  for (const row of [...source.transactions, ...source.errors])
    if (row.row > 0)
      rows.set(row.row, {
        row: row.row,
        ...(row.sourcePage ? { sourcePage: row.sourcePage } : {}),
      });
  return [...rows.values()];
}

/** Propagate taint through all original identity memberships, before manual,
 * rejected, financial or date filtering. A failed row never becomes a
 * Transaction, contributes money to a total, or supplies matching authority. */
export function localizedReadErrors(
  supplier: SourceResult,
  ledger: SourceResult,
) {
  const errors = [...supplier.errors, ...ledger.errors].filter(
    (error) => !balanceOnlyError(error),
  );
  const wildcard = errors.some(
    (error) =>
      error.row <= 0 ||
      error.isolation?.rule !== 'SAFE_REFERENCE_ENVELOPE_V1' ||
      !Array.isArray(error.isolation.keys) ||
      !error.isolation.keys.length ||
      error.isolation.keys.some(
        (key) => typeof key !== 'string' || !/^identity:.+$/u.test(key),
      ),
  );
  const taintedIds = new Set<string>();
  if (wildcard)
    return {
      wildcard,
      taintedIds,
      canMatch: (_rows: readonly Transaction[]) => false,
    };
  if (!errors.length)
    return {
      wildcard,
      taintedIds,
      canMatch: (_rows: readonly Transaction[]) => true,
    };
  const rows = [...supplier.transactions, ...ledger.transactions];
  const nodes = [
    ...rows.map(referenceEnvelopeKeys),
    ...errors.map((error) => error.isolation!.keys),
  ];
  const byKey = new Map<string, number[]>();
  nodes.forEach((keys, node) => {
    for (const key of keys) {
      const members = byKey.get(key) ?? [];
      members.push(node);
      byKey.set(key, members);
    }
  });
  const queue = errors.map((_, i) => rows.length + i);
  const visited = new Set(queue);
  const expanded = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node < rows.length) taintedIds.add(rows[node].id);
    for (const key of nodes[node]) {
      if (expanded.has(key)) continue;
      expanded.add(key);
      for (const member of byKey.get(key) ?? [])
        if (!visited.has(member)) {
          visited.add(member);
          queue.push(member);
        }
    }
  }
  return {
    wildcard,
    taintedIds,
    canMatch: (members: readonly Transaction[]) =>
      members.every((row) => !taintedIds.has(row.id)),
  };
}
