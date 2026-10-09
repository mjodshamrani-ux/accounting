import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
  Transaction,
} from './types.ts';
import { safeSum } from './core.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import {
  hasUnsafeReferenceText,
  isUnsafeReferenceText,
  transactionReferences,
} from './transaction-references.ts';

export const INVOICE_GROUP_SEARCH_VERSION = 'INVOICE_GROUP_SEARCH_V1';
export type InvoiceGroupSearchLimits = {
  physicalRows: number;
  members: number;
  candidates: number;
  expansions: number;
};
export const INVOICE_GROUP_SEARCH_LIMITS: Readonly<InvoiceGroupSearchLimits> =
  Object.freeze({
    physicalRows: 40000,
    members: 16,
    candidates: 256,
    expansions: 50000,
  });
export type InvoiceIdentityObservation = { role: string; value: string };
export type InvoicePhysicalMember = {
  sheet: string;
  row: number;
  disposition: 'movement' | 'non-movement' | 'excluded' | 'error' | 'unknown';
  transactionId?: string;
  identities: InvoiceIdentityObservation[];
};
export type InvoiceSearchSource = {
  side: 'supplier' | 'ledger';
  sourceHash: string;
  readingBindingValid?: boolean;
  sourceWideIdentityUncertainty?: boolean;
  sheets: { sheet: string; rowCount: number }[];
  transactions: Transaction[];
  physicalRows: InvoicePhysicalMember[];
};
export type InvoiceGroupSearchInput = {
  sources: [InvoiceSearchSource, InvoiceSearchSource];
  scope: Scope;
  limits?: Partial<typeof INVOICE_GROUP_SEARCH_LIMITS>;
};
export type InvoiceGroupSearchReason =
  | 'scope-unverified'
  | 'physical-membership-incomplete'
  | 'unknown-membership'
  | 'identity-competition'
  | 'duplicate-invoice-members'
  | 'invalid-invoice-member'
  | 'date-outside-scope'
  | 'amount-mismatch'
  | 'missing-counterpart'
  | 'resource-limit'
  | 'same-source';
export type InvoiceGroupCandidate = {
  id: string;
  invoice: string;
  selectedReference: string;
  status: 'candidate' | 'needs-review';
  reasons: InvoiceGroupSearchReason[];
  supplierIds: string[];
  ledgerIds: string[];
  supplierTotalMinor: number | null;
  ledgerTotalMinor: number | null;
  competingRows: {
    side: 'supplier' | 'ledger';
    sheet: string;
    row: number;
    transactionId?: string;
    identities: InvoiceIdentityObservation[];
  }[];
  evidence: {
    rule: typeof INVOICE_GROUP_SEARCH_VERSION;
    scope: {
      entity: string;
      account: string;
      supplier: string;
      currency: string;
      cutoff: string;
    };
    members: {
      id: string;
      side: 'supplier' | 'ledger';
      sourceHash: string;
      sheet: string;
      row: number;
      date: string;
      amountMinor: number | null;
      invoiceHeader: string;
      invoiceColumn: number;
      selectedHeader?: string;
      selectedColumn?: number;
    }[];
    relation: 'group-equivalence';
    pairwiseAllocation: false;
  };
};
export type InvoiceGroupSearchResult = {
  version: typeof INVOICE_GROUP_SEARCH_VERSION;
  status: 'complete' | 'needs-review';
  searchComplete: boolean;
  candidates: InvoiceGroupCandidate[];
  matches: [];
  reasons: InvoiceGroupSearchReason[];
  counters: { physicalRows: number; candidates: number; expansions: number };
};
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const literal = (value: string | undefined) => (value ?? '').trim();
const observations = (t: Partial<Transaction>): InvoiceIdentityObservation[] =>
  [
    ['own-document', t.documentReference],
    ['selected-document', t.chosenReference],
    ['related-invoice', t.relatedInvoiceReference],
    ['stated-reference', t.statedReference],
    ['voucher', t.voucherReference],
    ['purchase-order', t.poReference],
    ['bank', t.bankReference],
    ['receipt', t.receiptReference],
  ].flatMap(([role, value]) =>
    value && !isUnsafeReferenceText(value)
      ? [{ role: role!, value: literal(value) }]
      : [],
  );

/** Inventory is derived from every physical row of the selected native sheet,
 * including malformed/excluded movements. The existing verified boundary
 * re-reads current native rows; cached readings supply no positive authority.
 * Native binary replay/hash verification is the caller's preceding boundary. */
export function invoiceGroupSourcesFromVerifiedReading(
  files: [SourceFile, SourceFile],
  mappings: [Mapping, Mapping],
  readings: [SourceResult, SourceResult],
  scope: Scope,
): [InvoiceSearchSource, InvoiceSearchSource] {
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  return files.map((file, index) => {
    const mapping = fresh.mappings[index],
      reading = fresh.sources[index],
      cached = readings[index],
      sheet = file.sheets[mapping.sheet];
    const side = index === 0 ? ('supplier' as const) : ('ledger' as const);
    if (!sheet)
      return {
        side,
        sourceHash: '',
        sheets: [],
        transactions: reading.transactions,
        physicalRows: [],
      };
    const byRow = new Map(reading.transactions.map((t) => [t.row, t]));
    const excluded = new Map(reading.excluded.map((t) => [t.row, t]));
    const errors = new Set(reading.errors.map((t) => t.row));
    return {
      side,
      sourceHash:
        reading.sourceHash ?? file.sha256 ?? reading.sourceOrigin ?? '',
      readingBindingValid:
        JSON.stringify([
          reading.transactions,
          reading.excluded,
          reading.errors,
          reading.mapping,
          reading.sourceOrigin,
        ]) ===
        JSON.stringify([
          cached.transactions,
          cached.excluded,
          cached.errors,
          cached.mapping,
          cached.sourceOrigin,
        ]),
      sourceWideIdentityUncertainty: reading.errors.some(
        (error) => error.row === 0 && error.scope !== 'balance',
      ),
      sheets: [{ sheet: sheet.name, rowCount: sheet.rows.length }],
      transactions: reading.transactions,
      physicalRows: sheet.rows.map((cells, i) => {
        const row = i + 1,
          t = byRow.get(row),
          exclusion = excluded.get(row);
        const references = transactionReferences(sheet, mapping, cells, row);
        return {
          sheet: sheet.name,
          row,
          disposition: t
            ? ('movement' as const)
            : errors.has(row)
              ? ('error' as const)
              : exclusion
                ? exclusion.kind === 'non-movement'
                  ? ('non-movement' as const)
                  : ('excluded' as const)
                : row <= mapping.header + 1 || cells.every((c) => !c.trim())
                  ? ('non-movement' as const)
                  : ('unknown' as const),
          transactionId: t?.id,
          identities: observations({
            ...references,
            chosenReference: cells[mapping.reference] ?? '',
          }),
        };
      }),
    };
  }) as [InvoiceSearchSource, InvoiceSearchSource];
}

/** Candidate evidence only. No match/approval mutation or amount-only subset search. */
export function searchInvoiceGroups(
  input: InvoiceGroupSearchInput,
): InvoiceGroupSearchResult {
  const reasons = new Set<InvoiceGroupSearchReason>();
  const candidates: InvoiceGroupCandidate[] = [];
  const counters = { physicalRows: 0, candidates: 0, expansions: 0 };
  const limits = { ...INVOICE_GROUP_SEARCH_LIMITS };
  for (const name of Object.keys(limits) as (keyof typeof limits)[]) {
    const configured = input.limits?.[name];
    // Callers can reduce a cap, never silently increase this version's bounds.
    if (
      configured !== undefined &&
      Number.isSafeInteger(configured) &&
      configured > 0
    )
      limits[name] = Math.min(limits[name], configured);
  }
  const finish = (complete: boolean): InvoiceGroupSearchResult => ({
    version: INVOICE_GROUP_SEARCH_VERSION,
    status:
      !complete ||
      reasons.size ||
      candidates.some((c) => c.status === 'needs-review')
        ? 'needs-review'
        : 'complete',
    searchComplete: complete,
    candidates,
    matches: [],
    reasons: [...reasons].sort(),
    counters,
  });
  const scope = input.scope;
  const validDate = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d;
  if (
    !scope.confirmed ||
    !scope.coverageConfirmed ||
    ![scope.entity, scope.account, scope.supplier, scope.currency].every((v) =>
      literal(v),
    ) ||
    !validDate(scope.cutoff)
  )
    reasons.add('scope-unverified');
  if (
    input.sources[0].side !== 'supplier' ||
    input.sources[1].side !== 'ledger'
  )
    reasons.add('physical-membership-incomplete');
  if (
    input.sources[0].sourceHash &&
    input.sources[0].sourceHash === input.sources[1].sourceHash
  )
    reasons.add('same-source');
  const groups = new Map<
    string,
    { invoice: string; selected: string; rows: Transaction[] }
  >();
  if (
    input.sources.some(
      (source) => source.transactions.length > limits.physicalRows,
    ) ||
    input.sources.reduce((n, source) => n + source.physicalRows.length, 0) >
      limits.physicalRows
  ) {
    reasons.add('resource-limit');
    return finish(false);
  }
  const physical: {
    source: InvoiceSearchSource;
    row: InvoicePhysicalMember;
  }[] = [];
  const tokenIndex = new Map<string, typeof physical>();
  const transactions = new Map<string, Transaction>();
  let exhausted = false;
  for (const source of input.sources) {
    if (source.sourceWideIdentityUncertainty) reasons.add('unknown-membership');
    const coords = new Set<string>(),
      ids = new Set<string>();
    const manifests = new Map(source.sheets.map((s) => [s.sheet, s.rowCount]));
    if (
      source.readingBindingValid === false ||
      !source.sourceHash ||
      !source.sheets.length ||
      manifests.size !== source.sheets.length ||
      source.sheets.some(
        (s) => !Number.isSafeInteger(s.rowCount) || s.rowCount < 0,
      )
    )
      reasons.add('physical-membership-incomplete');
    for (const t of source.transactions) {
      const id = `${source.side}:${t.id}`;
      if (transactions.has(id) || t.side !== source.side)
        reasons.add('physical-membership-incomplete');
      transactions.set(id, t);
    }
    for (const row of source.physicalRows) {
      if (
        ++counters.physicalRows > limits.physicalRows ||
        ++counters.expansions > limits.expansions
      ) {
        exhausted = true;
        break;
      }
      const coord = JSON.stringify([row.sheet, row.row]);
      if (
        coords.has(coord) ||
        !Number.isSafeInteger(row.row) ||
        row.row < 1 ||
        row.row > (manifests.get(row.sheet) ?? -1)
      )
        reasons.add('physical-membership-incomplete');
      coords.add(coord);
      const entry = { source, row };
      physical.push(entry);
      if (row.identities.length > 12) {
        exhausted = true;
        break;
      }
      const tokens = new Set(
        row.identities
          .filter((i) => literal(i.value) && !isUnsafeReferenceText(i.value))
          .map((i) => literal(i.value)),
      );
      for (const token of tokens) {
        const entries = tokenIndex.get(token) ?? [];
        entries.push(entry);
        tokenIndex.set(token, entries);
      }
      if (
        row.disposition !== 'non-movement' &&
        row.disposition !== 'movement' &&
        !tokens.size
      )
        reasons.add('unknown-membership');
      if (row.disposition === 'movement') {
        const t = transactions.get(`${source.side}:${row.transactionId}`);
        if (
          !t ||
          ids.has(t.id) ||
          t.row !== row.row ||
          t.sheet !== row.sheet ||
          !observations(t).every((i) =>
            row.identities.some(
              (p) => p.role === i.role && literal(p.value) === i.value,
            ),
          )
        )
          reasons.add('physical-membership-incomplete');
        if (t) ids.add(t.id);
      }
    }
    if (exhausted) break;
    if (
      coords.size !== source.sheets.reduce((n, s) => n + s.rowCount, 0) ||
      ids.size !== source.transactions.length
    )
      reasons.add('physical-membership-incomplete');
    for (const t of source.transactions) {
      const invoice = literal(t.documentReference);
      if (!invoice || !t.documentNumberEvidence || t.documentType !== 'Invoice')
        continue;
      const selected =
        literal(t.chosenReference) !== invoice &&
        t.chosenReferenceEvidence?.role === 'document-reference'
          ? literal(t.chosenReference)
          : '';
      const key = JSON.stringify([invoice, selected]);
      const group = groups.get(key) ?? { invoice, selected, rows: [] };
      group.rows.push(t);
      groups.set(key, group);
    }
  }
  if (exhausted) {
    reasons.add('resource-limit');
    return finish(false);
  }
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    if (candidates.length >= limits.candidates) {
      exhausted = true;
      break;
    }
    const issues = new Set<InvoiceGroupSearchReason>(reasons);
    const rows = group.rows.toSorted((a, b) =>
      compareText(
        `${a.side}:${a.sheet}:${a.row}:${a.id}`,
        `${b.side}:${b.sheet}:${b.row}:${b.id}`,
      ),
    );
    if (rows.length > limits.members) {
      issues.add('resource-limit');
      exhausted = true;
    }
    const ids = new Set(rows.map((t) => `${t.side}:${t.id}`));
    const competitors: InvoiceGroupCandidate['competingRows'] = [];
    const entries = new Set([
      ...(tokenIndex.get(group.invoice) ?? []),
      ...(group.selected ? (tokenIndex.get(group.selected) ?? []) : []),
    ]);
    for (const entry of entries) {
      if (++counters.expansions > limits.expansions) {
        exhausted = true;
        issues.add('resource-limit');
        break;
      }
      const { source, row } = entry;
      if (
        row.disposition === 'non-movement' ||
        (row.transactionId && ids.has(`${source.side}:${row.transactionId}`))
      )
        continue;
      const other = row.transactionId
        ? transactions.get(`${source.side}:${row.transactionId}`)
        : undefined;
      // Distinct explicit selected identities prove independent invoice parts.
      const isolatedSibling =
        group.selected &&
        other?.documentType === 'Invoice' &&
        literal(other.documentReference) === group.invoice &&
        other.chosenReferenceEvidence?.role === 'document-reference' &&
        literal(other.chosenReference) &&
        literal(other.chosenReference) !== group.selected &&
        literal(other.chosenReference) !== group.invoice &&
        !other.referenceEvidenceIssues?.length &&
        !hasUnsafeReferenceText(other) &&
        Number.isSafeInteger(other.amountMinor) &&
        other.amountMinor! > 0 &&
        other.amount === other.amountMinor &&
        other.currency === scope.currency &&
        validDate(other.date) &&
        other.date <= scope.cutoff &&
        !row.identities.some(
          (identity) => literal(identity.value) === group.selected,
        ) &&
        !row.identities.some(
          (identity) =>
            literal(identity.value) === group.invoice &&
            !['own-document', 'selected-document', 'stated-reference'].includes(
              identity.role,
            ),
        );
      if (isolatedSibling) continue;
      competitors.push({
        side: source.side,
        sheet: row.sheet,
        row: row.row,
        transactionId: row.transactionId,
        identities: row.identities,
      });
    }
    if (competitors.length) issues.add('identity-competition');
    const duplicateSignatures = new Set<string>();
    for (const t of rows) {
      const signature = JSON.stringify([
        t.side,
        t.date,
        t.amountMinor,
        literal(t.documentReference),
        literal(t.chosenReference),
        literal(t.voucherReference),
      ]);
      if (duplicateSignatures.has(signature))
        issues.add('duplicate-invoice-members');
      duplicateSignatures.add(signature);
      if (
        !Number.isSafeInteger(t.amountMinor) ||
        t.amountMinor! <= 0 ||
        t.amount !== t.amountMinor ||
        t.currency !== scope.currency ||
        t.referenceEvidenceIssues?.length ||
        hasUnsafeReferenceText(t) ||
        literal(t.primaryReference) !== group.invoice ||
        (literal(t.chosenReference) &&
          literal(t.chosenReference) !== group.invoice &&
          !group.selected) ||
        (t.relatedInvoiceReference &&
          literal(t.relatedInvoiceReference) !== group.invoice)
      )
        issues.add('invalid-invoice-member');
      if (!validDate(t.date) || t.date > scope.cutoff)
        issues.add('date-outside-scope');
    }
    const supplier = rows.filter((t) => t.side === 'supplier'),
      ledger = rows.filter((t) => t.side === 'ledger');
    const total = (members: Transaction[]) => {
      if (members.some((t) => !Number.isSafeInteger(t.amountMinor)))
        return null;
      try {
        return safeSum(members.map((t) => t.amountMinor!));
      } catch {
        return null;
      }
    };
    const supplierTotalMinor = total(supplier),
      ledgerTotalMinor = total(ledger);
    if (!supplier.length || !ledger.length) issues.add('missing-counterpart');
    if (supplierTotalMinor === null || ledgerTotalMinor === null)
      issues.add('invalid-invoice-member');
    if (supplierTotalMinor !== ledgerTotalMinor) issues.add('amount-mismatch');
    candidates.push({
      id: `${INVOICE_GROUP_SEARCH_VERSION}:${key}`,
      invoice: group.invoice,
      selectedReference: group.selected,
      status: issues.size ? 'needs-review' : 'candidate',
      reasons: [...issues].sort(),
      supplierIds: supplier.map((t) => t.id),
      ledgerIds: ledger.map((t) => t.id),
      supplierTotalMinor,
      ledgerTotalMinor,
      competingRows: competitors.toSorted((a, b) =>
        compareText(
          `${a.side}:${a.sheet}:${a.row}`,
          `${b.side}:${b.sheet}:${b.row}`,
        ),
      ),
      evidence: {
        rule: INVOICE_GROUP_SEARCH_VERSION,
        scope: {
          entity: scope.entity,
          account: scope.account,
          supplier: scope.supplier,
          currency: scope.currency,
          cutoff: scope.cutoff,
        },
        members: rows.map((t) => ({
          id: t.id,
          side: t.side,
          sourceHash: input.sources[t.side === 'supplier' ? 0 : 1].sourceHash,
          sheet: t.sheet,
          row: t.row,
          date: t.date,
          amountMinor: Number.isSafeInteger(t.amountMinor)
            ? t.amountMinor!
            : null,
          invoiceHeader: t.documentNumberEvidence!.header,
          invoiceColumn: t.documentNumberEvidence!.column,
          selectedHeader: group.selected
            ? t.chosenReferenceEvidence?.header
            : undefined,
          selectedColumn: group.selected
            ? t.chosenReferenceEvidence?.column
            : undefined,
        })),
        relation: 'group-equivalence',
        pairwiseAllocation: false,
      },
    });
  }
  counters.candidates = candidates.length;
  if (exhausted) {
    reasons.add('resource-limit');
    // Never present a truncated enumeration as an isolated/unique candidate.
    for (const candidate of candidates) {
      candidate.status = 'needs-review';
      if (!candidate.reasons.includes('resource-limit'))
        candidate.reasons.push('resource-limit');
      candidate.reasons.sort();
    }
  }
  return finish(!exhausted);
}
