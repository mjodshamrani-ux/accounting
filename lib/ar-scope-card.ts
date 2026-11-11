import type { SourceFile } from './reconciliation/types.ts';
import type { ArReading } from './reconciliation/ar.ts';
import { isArScopeReading } from './reconciliation/ar-scope-details.ts';

/**
 * What the card «ما فهمناه من ملفاتك» (UX-5(d)) reads of the receivables
 * scope, side by side, as each side's reader reads it; nothing here is
 * read by the engine, which compares every row or scope line with the
 * scope the accountant confirms, as before.
 *
 * - A table read row by row (ar-limited-1) writes the scope on every row,
 *   in the columns the accountant maps: the card reads a field from the
 *   column mapped to it, and from no column when it is left unmapped.
 *   Neither period date is a column of this family.
 * - A file with a scope block (ar-scope-details-1) states its scope once,
 *   in the key rows between its AR_SCOPE and DETAILS markers, the period
 *   included: the card reads that block. A key written twice is not read.
 * - A printed statement (ar-statement-pdf-1) is read by the worker at the
 *   run, not before: it states nothing to the card.
 */
export const AR_CARD_FIELDS = [
  'entity',
  'ledger',
  'customer',
  'account',
  'currency',
  'start',
  'end',
] as const;
export type ArCardField = (typeof AR_CARD_FIELDS)[number];
/** The scope keys of the block family, which name the fields on the card. */
export const AR_CARD_HEADERS: Record<ArCardField, string> = {
  entity: 'Entity',
  ledger: 'Ledger',
  customer: 'Customer',
  account: 'Account',
  currency: 'Currency',
  start: 'Period start',
  end: 'Period end',
};
const ROW_FIELDS = ['entity', 'ledger', 'customer', 'account', 'currency'];

export type ArSideReading = 'rows' | 'block' | 'printed' | 'none';

const isPrinted = (reading: ArReading) =>
  (reading as { family?: string }).family === 'ar-statement-pdf-1';

export function arCardKind(
  file: SourceFile | null,
  reading: ArReading,
): ArSideReading {
  if (!file) return 'none';
  if (isPrinted(reading)) return 'printed';
  return isArScopeReading(reading) ? 'block' : 'rows';
}

/** Per field, the column a table read row by row names for it, or null. */
export function arCardHeaders(
  file: SourceFile | null,
  reading: ArReading,
): Partial<Record<ArCardField, string | null>> {
  const none = Object.fromEntries(AR_CARD_FIELDS.map((k) => [k, null]));
  if (arCardKind(file, reading) !== 'rows') return none;
  const header = file!.sheets?.[reading.sheet]?.rows[0] ?? [];
  return Object.fromEntries(
    AR_CARD_FIELDS.map((k) => {
      const at = ROW_FIELDS.includes(k)
        ? (reading as Record<string, unknown>)[k]
        : -1;
      return [
        k,
        typeof at === 'number' && at >= 0 && header[at]?.trim()
          ? header[at].trim()
          : null,
      ];
    }),
  );
}

/** The scope a file with a scope block states once, or null. */
export function arCardBlock(
  file: SourceFile | null,
  reading: ArReading,
): Partial<Record<ArCardField, string>> | null {
  if (arCardKind(file, reading) !== 'block') return null;
  const rows = file!.sheets?.[reading.sheet]?.rows ?? [];
  if (rows[0]?.[0] !== 'AR_SCOPE') return null;
  const seen = new Map<string, string>(),
    twice = new Set<string>();
  for (const values of rows.slice(1)) {
    if (!values.some((v) => v.trim())) continue;
    if (values[0] === 'DETAILS') break;
    const key = values[0];
    if (seen.has(key)) twice.add(key);
    else seen.set(key, values[1] ?? '');
  }
  const block: Partial<Record<ArCardField, string>> = {};
  for (const k of AR_CARD_FIELDS) {
    const key = AR_CARD_HEADERS[k];
    if (seen.has(key) && !twice.has(key)) block[k] = seen.get(key)!;
  }
  return block;
}
