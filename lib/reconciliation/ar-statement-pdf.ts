// ar-statement-pdf-1, reading part: a customer statement as the company
// prints it, read into its document header, its sections and their lines.
// The proposed contract and the sealed cases are in
// audit/ar-statement-foundation. Nothing here selects the confirmed scope or
// matches anything against a ledger.
//
// A section starts at a complete header (Customer ID, Account, Currency,
// Period), continues on a page that repeats that header in every field, and
// ends at a header that differs in any field. A line takes its scope only
// from its own section's header. The columns of a section come from its own
// column heading line, in any order, from the declared vocabulary; values are
// placed by the heading edges as in the bank statement reader. Labels and
// headings are compared exactly; a line that fits no declared form is an
// error with its page and line, kept with every other line.
import { currencyPrecision } from './currency-precision.ts';
import {
  columnOf,
  fitted,
  latinDigits,
  linesOf,
  normal,
  partsOf,
  readingOrder,
  squeeze,
  statementDate,
  textOf,
  type Columns,
  type Piece,
} from './bank-statement-native.ts';
import type { ArKind } from './ar.ts';
import type { NativePdfWordSource } from './pdf-native-source.ts';

export const AR_STATEMENT_PDF = 'ar-statement-pdf-1';

export type ArStatementRole =
  | 'date'
  | 'type'
  | 'document'
  | 'related'
  | 'description'
  | 'original'
  | 'open'
  | 'balance';
export type ArStatementScope = {
  customer: string;
  account: string;
  currency: string;
  start: string;
  end: string;
};
export type ArStatementDetail = {
  kind: ArKind;
  document: string;
  date: string;
  /** Minor units of the original amount. */
  amount: number;
  related: string;
  description: string;
  /** As printed; descriptive only. */
  originalText: string;
  openText: string;
  balanceText: string;
};
export type ArStatementLine = {
  page: number;
  /** 1-based line on its page, top to bottom. */
  line: number;
  items: number[];
  kind:
    | 'document-header'
    | 'section-header'
    | 'column-headings'
    | 'section-total'
    | 'page-footer'
    | 'detail'
    | 'error';
  section?: number;
  code?: string;
  detail?: ArStatementDetail;
  text: string;
};
export type ArStatementSection = {
  /** Null when the header is incomplete or unreadable. */
  scope: ArStatementScope | null;
  name: string;
  pages: number[];
  header: { page: number; line: number };
};
export type ArStatementReading = {
  family: typeof AR_STATEMENT_PDF;
  sha256: string;
  layout: 'en' | 'ar';
  document: { entity?: string; ledger?: string };
  sections: ArStatementSection[];
  lines: ArStatementLine[];
  errors: { code: string; page: number; line: number }[];
};

export class ArStatementReadError extends Error {
  readonly code: string;
  readonly page: number;
  readonly line: number;
  constructor(code: string, page: number, line: number, detail: string) {
    super(`AR_PDF_${code}: page ${page} line ${line}: ${detail}`);
    this.code = code;
    this.page = page;
    this.line = line;
  }
}

// The declared wording, English and Arabic. Labels and headings are never
// matched approximately; another wording is added here with its evidence.
const TITLES = ['Statement of account', 'كشف حساب'];
const LABELS: Record<string, 'entity' | 'ledger' | HeaderField | 'total'> = {
  'Issued by': 'entity',
  'صادر عن': 'entity',
  Ledger: 'ledger',
  الدفتر: 'ledger',
  'Customer ID': 'customer',
  'رقم العميل': 'customer',
  'Customer name': 'name',
  'اسم العميل': 'name',
  Account: 'account',
  الحساب: 'account',
  Currency: 'currency',
  العملة: 'currency',
  Period: 'period',
  الفترة: 'period',
  'Section total': 'total',
  'إجمالي القسم': 'total',
};
type HeaderField = 'customer' | 'name' | 'account' | 'currency' | 'period';
export const AR_STATEMENT_HEADINGS: Record<string, ArStatementRole> = {
  Date: 'date',
  التاريخ: 'date',
  Type: 'type',
  النوع: 'type',
  'Document No': 'document',
  'رقم المستند': 'document',
  'Related invoice': 'related',
  'الفاتورة المرتبطة': 'related',
  Description: 'description',
  البيان: 'description',
  'Original amount': 'original',
  'المبلغ الأصلي': 'original',
  'Open amount': 'open',
  'المبلغ المفتوح': 'open',
  Balance: 'balance',
  الرصيد: 'balance',
};
const REQUIRED: ArStatementRole[] = ['date', 'type', 'document', 'original'];
const KINDS: Record<string, ArKind> = {
  invoice: 'invoice',
  'credit-note': 'credit-note',
  receipt: 'receipt',
  فاتورة: 'invoice',
  'إشعار دائن': 'credit-note',
  قبض: 'receipt',
};
const PAGE = /^(?:Page (\d+) of (\d+)|صفحة (\d+) من (\d+))$/u;
const HEADINGS = new Map(
  Object.entries(AR_STATEMENT_HEADINGS).map(([h, role]) => [squeeze(h), role]),
);
const LONGEST = Math.max(...[...HEADINGS.keys()].map((h) => h.length));

/** A labelled line, label first in reading order. In a right-to-left
 * statement a left-to-right value can come first, its colon after it:
 * «Synthetic Seller Co :صادر عن» is read as label «صادر عن» and value
 * «Synthetic Seller Co». A left-to-right statement has no such form. */
function labelled(text: string, rtl: boolean) {
  for (const [label, field] of Object.entries(LABELS)) {
    if (text.startsWith(`${label}:`))
      return { field, value: normal(text.slice(label.length + 1)) };
    if (rtl && (text.endsWith(`:${label}`) || text.endsWith(`: ${label}`)))
      return {
        field,
        value: normal(text.slice(0, text.lastIndexOf(':'))),
      };
  }
  return undefined;
}

function isoDate(text: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(latinDigits(normal(text)));
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}`
    ? `${m[1]}-${m[2]}-${m[3]}`
    : undefined;
}

/** The scope a header proves, or null. */
function headerScope(
  fields: Partial<Record<HeaderField, string>>,
  layout: 'en' | 'ar',
): ArStatementScope | null {
  const { customer, account, currency, period } = fields;
  if (!customer || !account || !currency || !period) return null;
  if (currencyPrecision(currency) === undefined) return null;
  const m = /^(\S+)\s+(?:to|إلى)\s+(\S+)$/u.exec(period);
  if (!m) return null;
  const dates = [m[1], m[2]].map(
    (d) =>
      statementDate([d], layout) ??
      (layout === 'ar' ? undefined : isoDate(d)),
  );
  if (dates.some((d) => !d)) return null;
  // In a right-to-left line the two dates can arrive in either order.
  const [start, end] = (dates as string[]).sort();
  return {
    customer,
    account: latinDigits(account),
    currency,
    start,
    end,
  };
}

/** Printed amount: optional minus, thousands groups when separated, exactly
 * the currency's decimals. Zero is not an amount. */
function amountOf(text: string, decimals: number): number | undefined {
  const t = latinDigits(normal(text));
  const m = new RegExp(
    `^(-?)(\\d{1,3}(?:,\\d{3})+|\\d+)${decimals ? `\\.(\\d{${decimals}})` : ''}$`,
    'u',
  ).exec(t);
  if (!m) return undefined;
  const value = Number(m[2].replace(/,/gu, '') + (m[3] ?? ''));
  if (!Number.isSafeInteger(value) || value === 0) return undefined;
  return m[1] ? -value : value;
}

/** A heading line: its words in reading order are declared headings, the
 * first at least. Unknown words make it a heading line that is refused. */
function headingUnits(pieces: Piece[], direction: 'ltr' | 'rtl') {
  const words = readingOrder(pieces, direction);
  const units: { role?: ArStatementRole; pieces: Piece[] }[] = [];
  for (let i = 0; i < words.length; ) {
    let found: { role: ArStatementRole; n: number } | undefined;
    for (let n = words.length - i; n >= 1 && !found; n--) {
      const text = squeeze(textOf(words.slice(i, i + n), direction));
      if (text.length > LONGEST) continue;
      const role = HEADINGS.get(text);
      if (role) found = { role, n };
    }
    if (!found && !units.length) return undefined;
    units.push(
      found
        ? { role: found.role, pieces: words.slice(i, i + found.n) }
        : { pieces: [words[i]] },
    );
    i += found?.n ?? 1;
  }
  return units;
}

export function readArStatementPdf(
  source: NativePdfWordSource,
): ArStatementReading {
  if (source.readingIssues.length)
    throw new ArStatementReadError(
      'READING',
      source.readingIssues[0].page,
      source.readingIssues[0].line,
      source.readingIssues[0].reasons.join('; '),
    );
  const firstLine = linesOf(source.pages[0]?.tokens ?? [])[0];
  const title = firstLine
    ? normal(textOf(firstLine.tokens.flatMap(partsOf), 'ltr'))
    : '';
  const layout = /\p{Script=Arabic}/u.test(title) ? 'ar' : 'en';
  const direction = layout === 'ar' ? 'rtl' : 'ltr';
  const document: ArStatementReading['document'] = {};
  const sections: ArStatementSection[] = [];
  const lines: ArStatementLine[] = [];
  const errors: ArStatementReading['errors'] = [];
  let pending:
    | {
        fields: Partial<Record<HeaderField, string>>;
        at: { page: number; line: number };
        bad: boolean;
      }
    | undefined;
  let section: number | undefined;
  let key = '';
  let columns:
    | { geometry: Columns; roles: (ArStatementRole | undefined)[] }
    | undefined;
  const error = (code: string, page: number, line: number) =>
    errors.push({ code, page, line });

  for (const page of source.pages) {
    for (const [index, line] of linesOf(page.tokens).entries()) {
      const at = { page: page.page, line: index + 1 };
      const items = line.tokens.map((t) => t.item).sort((a, b) => a - b);
      const words = line.tokens.flatMap(partsOf);
      const text = textOf(words, direction);
      const push = (entry: Omit<ArStatementLine, 'page' | 'line' | 'items' | 'text'>) =>
        lines.push({ ...at, items, text, ...entry });
      if (TITLES.map(squeeze).includes(squeeze(text))) {
        push({ kind: 'document-header' });
        continue;
      }
      const label = labelled(text, direction === 'rtl');
      if (label?.field === 'entity' || label?.field === 'ledger') {
        const field = label.field;
        if (document[field] !== undefined && document[field] !== label.value)
          error('AR_PDF_DOCUMENT_HEADER', at.page, at.line);
        document[field] ??= label.value;
        push({ kind: 'document-header' });
        continue;
      }
      if (label?.field === 'total') {
        push({ kind: 'section-total', section });
        continue;
      }
      if (label) {
        const field = label.field as HeaderField;
        if (field === 'customer' || !pending)
          pending = { fields: {}, at, bad: false };
        if (pending.fields[field] !== undefined) pending.bad = true;
        pending.fields[field] = label.value;
        push({ kind: 'section-header' });
        continue;
      }
      if (PAGE.test(latinDigits(text))) {
        push({ kind: 'page-footer' });
        continue;
      }
      const units = headingUnits(words, direction);
      if (units) {
        const roles = units.map((u) => u.role);
        const known = roles.filter((r): r is ArStatementRole => !!r);
        const geometry: Columns = {
          direction,
          start: units.map((u) =>
            direction === 'ltr'
              ? Math.min(...u.pieces.map((p) => p.x0))
              : Math.max(...u.pieces.map((p) => p.x1)),
          ),
          spans: units.map((u) => ({
            x0: Math.min(...u.pieces.map((p) => p.x0)),
            x1: Math.max(...u.pieces.map((p) => p.x1)),
          })),
        };
        columns = { geometry, roles };
        if (
          known.length !== roles.length ||
          new Set(known).size !== known.length ||
          REQUIRED.some((r) => !known.includes(r))
        ) {
          error('AR_PDF_COLUMNS', at.page, at.line);
          columns = undefined;
        }
        push({ kind: 'column-headings' });
        if (pending) {
          const scope = pending.bad ? null : headerScope(pending.fields, layout);
          if (!scope) error('AR_PDF_HEADER', pending.at.page, pending.at.line);
          const next = JSON.stringify(
            (['customer', 'name', 'account', 'currency', 'period'] as const).map(
              (f) => pending!.fields[f] ?? null,
            ),
          );
          if (section !== undefined && next === key && scope) {
            if (!sections[section].pages.includes(page.page))
              sections[section].pages.push(page.page);
          } else {
            sections.push({
              scope,
              name: pending.fields.name ?? '',
              pages: [page.page],
              header: pending.at,
            });
            section = sections.length - 1;
            key = next;
          }
          pending = undefined;
        }
        continue;
      }
      // A detail line.
      if (section === undefined) {
        error('AR_PDF_ORPHAN_LINE', at.page, at.line);
        push({ kind: 'error', code: 'AR_PDF_ORPHAN_LINE' });
        continue;
      }
      const s = sections[section];
      const refuse = (code: string, report = true) => {
        if (report) error(code, at.page, at.line);
        push({ kind: 'error', code, section });
      };
      if (!s.scope) {
        refuse('AR_PDF_HEADER', false);
        continue;
      }
      if (!columns) {
        refuse('AR_PDF_COLUMNS', false);
        continue;
      }
      const cells = new Map<ArStatementRole, Piece[]>();
      let outside = false;
      for (const t of line.tokens)
        for (const p of fitted(columns.geometry, t)) {
          const col = columnOf(columns.geometry, p);
          const role = col === undefined ? undefined : columns.roles[col];
          if (!role) outside = true;
          else cells.set(role, [...(cells.get(role) ?? []), p]);
        }
      if (outside) {
        refuse('AR_PDF_LINE');
        continue;
      }
      const cell = (role: ArStatementRole) =>
        normal(textOf(cells.get(role) ?? [], direction));
      const kind = KINDS[cell('type')];
      if (!kind) {
        refuse('AR_KIND');
        continue;
      }
      const documentNo = cell('document');
      if (!documentNo) {
        refuse('AR_DOCUMENT');
        continue;
      }
      const datePieces = cells.get('date') ?? [];
      const date =
        datePieces.length === 1
          ? statementDate(datePieces[0].readings, layout)
          : statementDate([cell('date').replace(/\s+/gu, '')], layout);
      if (!date) {
        refuse('AR_DATE');
        continue;
      }
      if (date < s.scope.start || date > s.scope.end) {
        refuse('AR_PERIOD');
        continue;
      }
      const original = cell('original');
      if (!original) {
        refuse(cell('open') ? 'AR_ORIGINAL_MISSING' : 'AR_AMOUNT');
        continue;
      }
      const amount = amountOf(original, currencyPrecision(s.scope.currency)!);
      if (amount === undefined) {
        refuse('AR_AMOUNT');
        continue;
      }
      if (kind === 'invoice' ? amount < 0 : amount > 0) {
        refuse('AR_DIRECTION');
        continue;
      }
      push({
        kind: 'detail',
        section,
        detail: {
          kind,
          document: documentNo,
          date,
          amount,
          related: cell('related'),
          description: cell('description'),
          originalText: original,
          openText: cell('open'),
          balanceText: cell('balance'),
        },
      });
    }
  }
  if (pending) error('AR_PDF_HEADER', pending.at.page, pending.at.line);
  return {
    family: AR_STATEMENT_PDF,
    sha256: source.sha256,
    layout,
    document,
    sections,
    lines,
    errors,
  };
}
