import type { AlignmentStrip } from './alignment-strip.ts';
import type { AlignmentStripCopy } from './i18n/alignment-strip.ts';

/**
 * What each cell of the alignment strip says, in the workspace's words: its
 * label, its value and the notes beside it. The strip on the screen
 * (components/alignment-strip.tsx) and the reconciliation sheet (UX-6) both
 * read it, so the two say the same thing. Values stay apart from the words
 * around them: a count is a number, an amount is the engine's minor units,
 * and a note is a word with, where the strip gives one, what it says.
 */
export type StripValue =
  | { kind: 'text'; text: string }
  /** A count, and where the strip says it, how many it is counted among. */
  | { kind: 'count'; count: number; of?: number }
  /** An amount as the engine signed it, in minor units. */
  | { kind: 'amount'; minor: number };

/** A note: a word alone, or a word and its value. */
export type StripNote = { text: string; value?: string | number };

export type StripCellView = {
  cell: 'agreed' | 'review' | 'gap';
  label: string;
  value: StripValue;
  notes: StripNote[];
};

export type StripWords = {
  /** An engine reason in the workspace's words. */
  reason?: (code: string) => string;
  /** A compared item (component, account, field) in the workspace's words. */
  name?: (key: string) => string;
  /** The workspace's words for the result's status, where the strip says it. */
  state?: string;
};

export function stripView(
  strip: AlignmentStrip,
  c: AlignmentStripCopy,
  { reason = (code) => code, name = (key) => key, state }: StripWords = {},
): [StripCellView, StripCellView, StripCellView] {
  const itemName = (key: string) => c.names[key] ?? name(key);

  const agreed: StripCellView = {
    cell: 'agreed',
    label: c.agreed,
    value:
      strip.agreed.of === null
        ? { kind: 'count', count: strip.agreed.count }
        : { kind: 'count', count: strip.agreed.count, of: strip.agreed.of },
    notes: [{ text: c.units[strip.agreed.unit] }],
  };

  const review = strip.review;
  const reviewCell: StripCellView = {
    cell: 'review',
    label: review.kind === 'state' ? c.state : c.review,
    value:
      review.kind === 'count'
        ? { kind: 'count', count: review.count }
        : {
            kind: 'text',
            text:
              review.kind === 'whole'
                ? c.whole[review.review][0]
                : (state ?? review.status),
          },
    notes:
      review.kind === 'count'
        ? [
            ...(review.reason !== null && review.count > 0
              ? [{ text: c.mainReason, value: reason(review.reason) }]
              : []),
            ...(review.alone !== undefined
              ? [{ text: c.alone, value: review.alone }]
              : []),
          ]
        : review.kind === 'whole'
          ? [{ text: c.whole[review.review][1] }]
          : [],
  };

  const gap = strip.gap;
  const first = gap.kind === 'figures' ? gap.items[0] : undefined;
  const gapCell: StripCellView = {
    cell: 'gap',
    label: c.gap,
    value: first
      ? { kind: 'amount', minor: first.minor }
      : {
          kind: 'text',
          text:
            gap.kind === 'figures'
              ? c.noDifference
              : gap.kind === 'not-computed'
                ? c.notComputed
                : c.blocked,
        },
    notes:
      gap.kind === 'figures'
        ? first
          ? [
              { text: itemName(first.name), value: c.between[first.between] },
              ...(gap.items.length > 1
                ? [{ text: c.moreDifferences, value: gap.items.length - 1 }]
                : []),
            ]
          : [{ text: c.compared, value: gap.compared }]
        : gap.kind === 'not-computed'
          ? [{ text: c.notComputedNote }]
          : [{ text: state ?? gap.status }],
  };

  return [agreed, reviewCell, gapCell];
}

/** A value as the strip writes it in a sentence; an amount is written by the
 * caller, which knows its precision and how to isolate it. */
export function stripValueText(
  value: StripValue,
  c: AlignmentStripCopy,
  amount: (minor: number) => string,
) {
  return value.kind === 'text'
    ? value.text
    : value.kind === 'count'
      ? value.of === undefined
        ? String(value.count)
        : c.of(value.count, value.of)
      : amount(value.minor);
}

/** The notes as the strip writes them beside a value. */
export const stripNoteText = (notes: readonly StripNote[]) =>
  notes
    .map((n) => (n.value === undefined ? n.text : `${n.text}: ${n.value}`))
    .join(' · ');
