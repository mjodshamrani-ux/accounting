// ar-statement-pdf-1, scope part: the confirmed scope chosen from a customer
// statement's sections, every printed line kept in the inventory, and every
// reading or selection error turned into a source issue that blocks the pair.
// The proposed contract and the sealed cases are in
// audit/ar-statement-foundation; the matching itself is the AR engine's.
//
// The compared lines are those of the one section whose header equals the
// confirmed customer, account, currency and period, under a document header
// equal to the confirmed entity and ledger. A section with a readable header
// for another scope is out of scope: its lines are kept, never members and
// never errors (owner decision D1). No section with the confirmed scope is
// AR_PDF_SCOPE_NOT_FOUND; the confirmed scope heading two separate sections is
// AR_PDF_SCOPE_REPEATED (D2). In both cases nothing of the statement is compared.
import { arIssueCategory } from './ar-scope-details.ts';
import type { ArInventory, ArRow, ArScope } from './ar.ts';
import type { ArSourceIssue } from './ar-scope-details.ts';
import {
  AR_STATEMENT_PDF,
  type ArStatementReading,
  type ArStatementScope,
} from './ar-statement-pdf.ts';

/** The printed statement side of a comparison: the file and its reading. */
export type ArStatementFile = {
  kind: 'ar-statement-pdf';
  name: string;
  sha256: string;
  reading: ArStatementReading;
};
export type ArStatementSummary = {
  family: typeof AR_STATEMENT_PDF;
  layout: ArStatementReading['layout'];
  document: ArStatementReading['document'];
  sections: {
    scope: ArStatementScope | null;
    name: string;
    pages: number[];
    header: { page: number; line: number };
    /** Detail lines read in the section. */
    lines: number;
    compared: boolean;
  }[];
  /** The compared section, when exactly one has the confirmed scope. */
  compared: number | null;
  /** Detail lines that are not compared: other sections, or every section
   * when the confirmed scope was not found once. */
  outOfScopeLines: number;
};

const classification: Record<
  ArStatementReading['lines'][number]['kind'],
  NonNullable<ArInventory['classification']>
> = {
  'document-header': 'document-header',
  'section-header': 'scope-header',
  'column-headings': 'detail-header',
  'section-total': 'section-total',
  'page-footer': 'page-footer',
  detail: 'detail',
  error: 'error',
};

export function arStatementSide(file: ArStatementFile, scope: ArScope) {
  const { reading, sha256 } = file;
  const place = (p: { page: number; line: number }) => `${p.page}:${p.line}`;
  const inventoryId = (p: { page: number; line: number }) =>
    `1:${sha256}:pdf:inventory:${place(p)}`;
  const wanted: ArStatementScope = {
    customer: scope.customer,
    account: scope.account,
    currency: scope.currency,
    start: scope.start,
    end: scope.end,
  };
  const sameDocument =
    reading.document.entity === scope.entity &&
    reading.document.ledger === scope.ledger;
  const chosen = reading.sections.flatMap((s, i) =>
    sameDocument &&
    s.scope &&
    (Object.keys(wanted) as (keyof ArStatementScope)[]).every(
      (k) => s.scope![k] === wanted[k],
    )
      ? [i]
      : [],
  );
  const compared = chosen.length === 1 ? chosen[0] : null;

  // Every reported error is a source issue on its own line. A line refused
  // because its section's header or columns could not be read joins the
  // issue that explains it, so one cause is counted once.
  const issues: ArSourceIssue[] = [];
  const issueAt = new Map<string, ArSourceIssue>();
  for (const e of reading.errors) {
    const issue: ArSourceIssue = {
      side: 1,
      code: e.code,
      category: arIssueCategory(e.code),
      inventoryIds: [inventoryId(e)],
    };
    issues.push(issue);
    issueAt.set(`${e.code}@${place(e)}`, issue);
  }
  const codesAt = new Map<string, string[]>();
  for (const e of reading.errors)
    codesAt.set(place(e), [...(codesAt.get(place(e)) ?? []), e.code]);

  const rows: ArRow[] = [];
  const inventory: ArInventory[] = [];
  const detailsIn = reading.sections.map(() => 0);
  let lastColumns: ArSourceIssue | undefined;
  let outOfScopeLines = 0;
  for (const [index, line] of reading.lines.entries()) {
    const id = inventoryId(line);
    const pdf = {
      page: line.page,
      line: line.line,
      items: line.items,
      kind: line.kind,
      ...(line.section === undefined ? {} : { section: line.section }),
    };
    const base = {
      side: 1 as const,
      row: index + 1,
      values: [line.text],
      inventoryId: id,
      pdf,
    };
    const codes = codesAt.get(place(line)) ?? [];
    if (line.kind === 'column-headings')
      lastColumns = codes.includes('AR_PDF_COLUMNS')
        ? issueAt.get(`AR_PDF_COLUMNS@${place(line)}`)
        : undefined;
    if (line.kind === 'error' && !codes.includes(line.code!)) {
      const owner =
        line.code === 'AR_PDF_HEADER' && line.section !== undefined
          ? issueAt.get(
              `AR_PDF_HEADER@${place(reading.sections[line.section].header)}`,
            )
          : line.code === 'AR_PDF_COLUMNS'
            ? lastColumns
            : undefined;
      if (owner) owner.inventoryIds.push(id);
      else
        issues.push({
          side: 1,
          code: line.code!,
          category: arIssueCategory(line.code!),
          inventoryIds: [id],
        });
      codes.push(line.code!);
    }
    if (codes.length) {
      inventory.push({
        ...base,
        kind: 'error',
        error: codes[0],
        errors: codes,
        classification: classification[line.kind],
      });
      continue;
    }
    if (line.kind !== 'detail') {
      inventory.push({
        ...base,
        kind: 'header',
        classification: classification[line.kind],
      });
      continue;
    }
    detailsIn[line.section!]++;
    if (line.section !== compared) {
      outOfScopeLines++;
      inventory.push({
        ...base,
        kind: 'out-of-scope',
        classification: 'out-of-scope',
      });
      continue;
    }
    const d = line.detail!;
    rows.push({
      id: `1:${sha256}:pdf:${place(line)}`,
      side: 1,
      row: index + 1,
      posting: place(line),
      kind: d.kind,
      document: d.document,
      date: d.date,
      amount: d.amount,
      related: d.related,
      relatedEvidence: d.related ? [d.related] : [],
      description: d.description,
      originalRaw: d.originalText,
      ...(d.openText
        ? {
            openBalanceRaw: d.openText,
            openBalanceRole: 'descriptive-unverified' as const,
          }
        : {}),
      pdf: { page: line.page, line: line.line, items: line.items },
    });
    inventory.push({ ...base, kind: 'movement', classification: 'detail' });
  }

  const headerIds = (sections: number[]) =>
    sections.map((i) => inventoryId(reading.sections[i].header));
  if (chosen.length > 1)
    issues.push({
      side: 1,
      code: 'AR_PDF_SCOPE_REPEATED',
      category: arIssueCategory('AR_PDF_SCOPE_REPEATED'),
      inventoryIds: headerIds(chosen),
    });
  else if (
    !chosen.length &&
    reading.sections.every((s) => s.scope) &&
    !reading.errors.some((e) => e.code === 'AR_PDF_DOCUMENT_HEADER')
  )
    issues.push({
      side: 1,
      code: 'AR_PDF_SCOPE_NOT_FOUND',
      category: arIssueCategory('AR_PDF_SCOPE_NOT_FOUND'),
      // No printed line is at fault: the scope is simply not there.
      inventoryIds: [],
    });
  const byId = new Map(inventory.map((i) => [i.inventoryId!, i]));
  for (const issue of issues)
    for (const ref of issue.inventoryIds) {
      const item = byId.get(ref)!;
      if (item.kind === 'error') continue;
      item.kind = 'error';
      item.error = issue.code;
      item.errors = [issue.code];
    }

  const summary: ArStatementSummary = {
    family: AR_STATEMENT_PDF,
    layout: reading.layout,
    document: { ...reading.document },
    sections: reading.sections.map((s, i) => ({
      scope: s.scope && { ...s.scope },
      name: s.name,
      pages: [...s.pages],
      header: { ...s.header },
      lines: detailsIn[i],
      compared: i === compared,
    })),
    compared,
    outOfScopeLines,
  };
  // A total is shown only for one compared section whose structure was read.
  // A failed selection always carries its own AR_PDF_ issue.
  const structural = issues.some((i) => i.code.startsWith('AR_PDF_'));
  return { rows, inventory, issues, summary, structural };
}
