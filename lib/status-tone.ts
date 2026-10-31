/** The tone of a status badge (UX-3): one language for the status a
 * workspace shows, read from the engine's own status, with no new status
 * layer. Only a status the engine, or a recorded human decision, settles as
 * agreeing takes the agreed tone; a status that waits for a person is
 * review. */
export type StatusTone =
  | 'agreed'
  | 'suggestion'
  | 'review'
  | 'difference'
  | 'held'
  | 'neutral';

export const STATUS_TONES: readonly StatusTone[] = [
  'agreed',
  'suggestion',
  'review',
  'difference',
  'held',
  'neutral',
];

/** Receivables: a document pair the engine matched, or a person confirmed. */
export const arCaseTone = (status: 'matched' | 'review'): StatusTone =>
  status === 'matched' ? 'agreed' : 'review';

/** Clearing: a group cleared by its explicit reference or a decision. */
export const clearingGroupTone = (status: 'cleared' | 'review'): StatusTone =>
  status === 'cleared' ? 'agreed' : 'review';

/** Bank: a whole case matched by explicit source identity or by a person;
 * a source error cannot be judged. */
export const bankCaseTone = {
  'matched-evidence': 'agreed',
  'matched-manual': 'agreed',
  'needs-review': 'review',
  'source-error': 'held',
} as const satisfies Record<string, StatusTone>;

/** Supplier: the word the review list shows for a case. A match, automatic
 * or confirmed by a person, is agreed; a suggested group is a suggestion;
 * an amount difference is a difference; every other case waits for review. */
export const supplierCaseTone = {
  auto: 'agreed',
  manual: 'agreed',
  amountVariance: 'difference',
  paymentCandidate: 'suggestion',
  rejected: 'review',
  needsReview: 'review',
  unmatched: 'review',
} as const satisfies Record<string, StatusTone>;
