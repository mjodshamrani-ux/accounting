import {
  latinDigits,
  parseDate,
  structuralSummaryLabel,
  nonFinancialFooter,
} from './core.ts';
import type { Mapping, Scope, SourceFile, SheetData } from './types.ts';
import { headerMatches, normalizeHeaderLabel } from './header-labels.ts';

export type ScopeSuggestionField =
  | 'supplier'
  | 'entity'
  | 'account'
  | 'currency'
  | 'cutoff';
export type ScopeEvidence = {
  value: string;
  rawValue: string;
  label: string;
  sourceName: string;
  side: 'supplier' | 'ledger';
  sheet: string;
  row: number;
  column: number;
  kind: 'label' | 'header' | 'column';
  checkedRows?: number;
};
export type ScopeSuggestion = {
  status: 'suggested' | 'missing' | 'conflict';
  value?: string;
  evidence: ScopeEvidence[];
  issues: string[];
};
export type ScopeSuggestions = {
  values: Partial<Pick<Scope, ScopeSuggestionField>>;
  fields: Record<ScopeSuggestionField, ScopeSuggestion>;
};

const fields: ScopeSuggestionField[] = [
  'supplier',
  'entity',
  'account',
  'currency',
  'cutoff',
];
const labels: Record<ScopeSuggestionField | 'period', string[]> = {
  supplier: [
    'supplier',
    'supplier name',
    'vendor',
    'vendor name',
    'المورد',
    'اسم المورد',
  ],
  entity: [
    'customer',
    'customer name',
    'legal entity',
    'buyer',
    'buyer name',
    'العميل',
    'اسم العميل',
    'الكيان القانوني',
    'المنشأة المشترية',
  ],
  account: [
    'supplier account',
    'supplier account no.',
    'supplier account number',
    'vendor account',
    'customer account',
    'customer a/c',
    'supplier a/c',
    'customer account no.',
    'customer account number',
    'حساب المورد',
    'رقم حساب المورد',
    'حساب العميل',
    'رقم حساب العميل',
  ],
  currency: ['currency', 'statement currency', 'العملة', 'عملة الكشف'],
  cutoff: [
    'cut-off',
    'cutoff',
    'cut-off date',
    'cutoff date',
    'as of',
    'statement as of',
    'period end',
    'statement period end',
    'تاريخ القطع',
    'نهاية الفترة',
    'تاريخ نهاية الفترة',
    'حتى تاريخ',
  ],
  period: [
    'period',
    'statement period',
    'reporting period',
    'الفترة',
    'فترة الكشف',
    'فترة التقرير',
  ],
};
const clean = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const key = (value: string) => clean(value).toLowerCase();
const labelEntries = Object.entries(labels).flatMap(([field, names]) =>
  names.map((label) => ({
    field: field as ScopeSuggestionField | 'period',
    label,
  })),
);
const getLabel = (value: string) => {
  const normalized = key(value.replace(/[:：]\s*$/, ''));
  return labelEntries.find((entry) => entry.label === normalized);
};
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inlineLabels = labelEntries
  .map(({ label }) => escapeRegex(label))
  .sort((a, b) => b.length - a.length)
  .join('|');

function metadataParts(cell: string): { label: string; value: string }[] {
  const text = clean(cell);
  // Start at an explicit label. A report title or descriptive sentence is not metadata.
  const pattern = new RegExp(
    `(?:^|\\s+|\\s*[|;]\\s*)(${inlineLabels})\\s*[:：]\\s*`,
    'giu',
  );
  const matches = [...text.matchAll(pattern)];
  if (!matches.length || matches[0].index !== 0) return [];
  return matches.flatMap((match, index) => {
    const value = text
      .slice(
        match.index! + match[0].length,
        matches[index + 1]?.index ?? text.length,
      )
      .replace(/[|;]\s*$/, '')
      .trim();
    // Unknown nested labels cannot silently become part of a legal name or account.
    return value && !/[:：]/.test(value) ? [{ label: match[1], value }] : [];
  });
}

function trustedCell(
  sheet: SheetData,
  row: number,
  column: number,
  allowMetadataSpan = false,
): boolean {
  const oneBased = row + 1;
  return (
    !sheet.hiddenRows.includes(oneBased) &&
    !(!sheet.cellIssues && sheet.formulaRows.includes(oneBased)) &&
    !(sheet.rowIssues?.[String(oneBased)] ?? []).some(
      (issue) =>
        !allowMetadataSpan ||
        issue !==
          'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع',
    ) &&
    !sheet.cellIssues?.[`${oneBased}:${column + 1}`]?.length
  );
}

function metadataEnd(
  file: SourceFile,
  mapping: Mapping,
  sheet: SheetData,
): number {
  if (mapping.header > 0) return Math.min(mapping.header, sheet.rows.length);
  // Before PDF column boundaries are chosen, a complete table header is one cell.
  // This narrow boundary is used only to find labeled metadata above the table.
  if (!file.pdf || file.pdf.cuts.length || mapping.header !== 0) return 0;
  const boundary = sheet.rows.slice(0, 40).findIndex((row) => {
    const cells = row.filter((cell) => cell.trim());
    if (cells.length !== 1) return false;
    const text = clean(cells[0]);
    return (
      /^(?:date|transaction date|posting date|التاريخ|تاريخ الحركة)\s/i.test(
        text,
      ) &&
      /(?:reference|document no\.?|invoice no\.?|المرجع|رقم المستند|رقم الفاتورة)/i.test(
        text,
      ) &&
      /(?:\bamount\b|\bdebit\b|\bcredit\b|المبلغ|مدين|دائن)/i.test(text)
    );
  });
  return boundary > 0 ? boundary : 0;
}

function normalizedValue(
  field: ScopeSuggestionField | 'period',
  raw: string,
  mapping: Mapping,
): string | null {
  const value = clean(raw);
  if (!value || value.length > 250) return null;
  if (field === 'currency')
    return /^[A-Z]{3}$/i.test(value) ? value.toUpperCase() : null;
  const explicitDate = (text: string): string => {
    const candidates = new Set<string>();
    for (const format of ['ymd', 'dmy', 'mdy'] as const) {
      try {
        candidates.add(parseDate(text, format));
      } catch {
        /* not a supported date */
      }
    }
    if (candidates.size !== 1) throw new Error('Ambiguous date metadata');
    return [...candidates][0];
  };
  if (field === 'period') {
    const period = latinDigits(value).replace(/^from\s+|^من\s+/i, '');
    const pieces = period.split(
      /\s+(?:to|until|through|إلى|الى|حتى|[-–—])\s+/i,
    );
    if (pieces.length !== 2) return null;
    try {
      const start = explicitDate(pieces[0]);
      const end = explicitDate(pieces[1]);
      return start <= end ? end : null;
    } catch {
      return null;
    }
  }
  if (field === 'cutoff') {
    try {
      return explicitDate(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** Suggestions never restore confirmations, infer identities from file names, or change engine decisions. */
export function inferScopeSuggestions(
  files: readonly [SourceFile | null, SourceFile | null],
  mappings: readonly [Mapping, Mapping],
): ScopeSuggestions {
  const empty = (): ScopeSuggestion => ({
    status: 'missing',
    evidence: [],
    issues: [],
  });
  const result: ScopeSuggestions = {
    values: {},
    fields: {
      supplier: empty(),
      entity: empty(),
      account: empty(),
      currency: empty(),
      cutoff: empty(),
    },
  };
  const blocked = new Set<ScopeSuggestionField>();
  files.forEach((file, sideIndex) => {
    if (!file) return;
    const mapping = mappings[sideIndex];
    const sheet = file.sheets[mapping.sheet];
    if (!sheet || mapping.header < 0 || !Number.isInteger(mapping.header))
      return;
    const evidence = (
      field: ScopeSuggestionField,
      value: string,
      rawValue: string,
      label: string,
      row: number,
      column: number,
      kind: ScopeEvidence['kind'],
    ): ScopeEvidence => ({
      value,
      rawValue,
      label,
      sourceName: file.name,
      side: sideIndex === 0 ? 'supplier' : 'ledger',
      sheet: sheet.name,
      row: row + 1,
      column: column + 1,
      kind,
    });
    const addLabel = (
      label: string,
      rawValue: string,
      row: number,
      column: number,
    ) => {
      const found = getLabel(label);
      if (!found) return;
      const field = found.field === 'period' ? 'cutoff' : found.field;
      const value = normalizedValue(found.field, rawValue, mapping);
      if (value === null) {
        blocked.add(field);
        result.fields[field].issues.push(
          `تعذر تفسير ${label} في ${file.name}، ${sheet.name}، صف ${row + 1}.`,
        );
        return;
      }
      result.fields[field].evidence.push(
        evidence(field, value, rawValue, label, row, column, 'label'),
      );
    };
    for (let row = 0; row < metadataEnd(file, mapping, sheet); row++) {
      const cells = sheet.rows[row];
      for (let column = 0; column < cells.length; column++) {
        if (!trustedCell(sheet, row, column, !!file.pdf)) continue;
        const cell = cells[column];
        const parts = metadataParts(cell);
        if (parts.length) {
          parts.forEach((part) =>
            addLabel(part.label, part.value, row, column),
          );
          continue;
        }
        const label = getLabel(cell);
        if (!label) continue;
        const next = column + 1;
        if (
          !cells[next]?.trim() ||
          !trustedCell(sheet, row, next, !!file.pdf) ||
          getLabel(cells[next]) ||
          metadataParts(cells[next]).length
        )
          continue;
        addLabel(cell, cells[next], row, next);
      }
    }

    const amountColumns =
      mapping.mode === 'signed'
        ? [mapping.amount]
        : [mapping.debit, mapping.credit];
    for (const column of new Set(amountColumns.filter((index) => index >= 0))) {
      if (!trustedCell(sheet, mapping.header, column)) continue;
      const raw = sheet.rows[mapping.header]?.[column] ?? '';
      const currencyLabel =
        /^(?:amount|signed amount|outstanding|remaining|debit|credit|المبلغ|المتبقي|الرصيد المتبقي|مدين|دائن)\s*\([A-Z]{3}\)$/i;
      const match = /\(([A-Z]{3})\)/i.exec(normalizeHeaderLabel(raw));
      if (match && headerMatches(currencyLabel, raw))
        result.fields.currency.evidence.push(
          evidence(
            'currency',
            match[1].toUpperCase(),
            raw,
            raw,
            mapping.header,
            column,
            'header',
          ),
        );
    }
    if (mapping.currencyColumn < 0) return;
    const column = mapping.currencyColumn;
    const codes = new Map<string, ScopeEvidence>();
    let complete = true;
    let count = 0;
    for (let row = mapping.header + 1; row < sheet.rows.length; row++) {
      const cells = sheet.rows[row];
      if (
        !cells.some((cell) => cell.trim()) ||
        mapping.excluded[String(row + 1)]?.trim()
      )
        continue;
      const header = sheet.rows[mapping.header];
      const isRepeatedHeader =
        cells.length === header.length &&
        cells.every((cell, i) => cell.trim() === header[i].trim());
      const isFooter = nonFinancialFooter(cells);
      const isStructural =
        isRepeatedHeader ||
        isFooter ||
        !!structuralSummaryLabel(
          cells,
          mapping,
          header,
          row === mapping.header + 1,
        );
      // Safe structural rows do not assert a transaction currency. Never skip
      // an unreadable/hidden row or erase an explicit contradictory code.
      const safeFooter =
        isFooter &&
        !sheet.hiddenRows.includes(row + 1) &&
        !sheet.formulaRows.includes(row + 1) &&
        !(sheet.rowIssues?.[String(row + 1)] ?? []).some(
          (issue) =>
            issue !==
            'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع',
        ) &&
        cells.every(
          (_, i) =>
            !(sheet.cellIssues?.[`${row + 1}:${i + 1}`] ?? []).some(
              (issue) => !issue.startsWith('خلية مدمجة في '),
            ) && !sheet.referenceIssues?.[`${row + 1}:${i + 1}`]?.length,
        );
      if (
        isStructural &&
        (safeFooter || cells.every((_, i) => trustedCell(sheet, row, i)))
      ) {
        const raw = cells[column]?.trim() ?? '';
        if (isRepeatedHeader || !raw) continue;
      }
      count++;
      const raw = cells[column] ?? '';
      const code = normalizedValue('currency', raw, mapping);
      if (!code || !trustedCell(sheet, row, column)) {
        complete = false;
        continue;
      }
      if (!codes.has(code))
        codes.set(
          code,
          evidence(
            'currency',
            code,
            raw,
            sheet.rows[mapping.header]?.[column] ?? 'Currency',
            row,
            column,
            'column',
          ),
        );
    }
    if (!complete) {
      blocked.add('currency');
      result.fields.currency.issues.push(
        `عمود العملة غير مكتمل أو يتضمن قيمة غير موثوقة في ${file.name}، ${sheet.name}.`,
      );
    }
    codes.forEach((item) => {
      item.checkedRows = count;
      result.fields.currency.evidence.push(item);
    });
  });
  for (const field of fields) {
    const item = result.fields[field];
    const distinct = new Map<string, string>();
    for (const evidence of item.evidence) {
      const identity =
        field === 'account' ? clean(evidence.value) : key(evidence.value);
      if (!distinct.has(identity)) distinct.set(identity, evidence.value);
    }
    if (distinct.size > 1) item.status = 'conflict';
    else if (distinct.size === 1 && !blocked.has(field)) {
      item.status = 'suggested';
      item.value = distinct.values().next().value!;
      result.values[field] = item.value;
    }
  }
  return result;
}

/** The latest date present in either mapped date column, or '' when none parses.
 * Used only as a default cut-off. Rows after the cut-off are excluded, so the
 * latest observed date excludes nothing: it is a starting point the accountant
 * narrows, never a claim about where the statement period ends.
 */
export function latestSourceDate(
  files: [SourceFile | null, SourceFile | null],
  mappings: [Mapping, Mapping],
): string {
  let latest = '';
  files.forEach((file, index) => {
    const mapping = mappings[index];
    const sheet = file?.sheets[mapping.sheet];
    if (!sheet || mapping.date < 0 || !Number.isInteger(mapping.header)) return;
    for (let row = mapping.header + 1; row < sheet.rows.length; row++) {
      if (mapping.excluded[String(row + 1)]?.trim()) continue;
      const text = (sheet.rows[row][mapping.date] ?? '').trim();
      if (!text) continue;
      try {
        const date = parseDate(text, mapping.dateFormat);
        if (date > latest) latest = date;
      } catch {
        // An unreadable cell is not evidence of a date; the row is reported later.
      }
    }
  });
  return latest;
}
