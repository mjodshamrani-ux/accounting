import { Amount } from '@/components/amount';
import type { AlignmentStrip as Strip } from '@/lib/alignment-strip';
import { scaledText } from '@/lib/amount-text';
import { alignmentStripCopy } from '@/lib/i18n/alignment-strip';
import { useI18n } from '@/lib/i18n/context';
import './alignment-strip.css';

/**
 * The head of a result (UX-4): the records the engine compared at its ends,
 * and between them what aligned, what awaits a decision and the gap, each
 * as the engine wrote it (lib/alignment-strip.ts). The drawn strip is hidden
 * from assistive technology, which reads one sentence with the same words
 * and numbers instead. No success mark, no share and no colour that says a
 * result is right: the review and gap cells take their tone only when they
 * are not zero.
 */
const MARK = '\u0001';
/** The sentence with each marked amount in its own left-to-right run. */
const isolated = (sentence: string) =>
  sentence.split(MARK).map((part, i) =>
    i % 2 ? (
      <bdi key={i} dir="ltr">
        {part}
      </bdi>
    ) : (
      part
    ),
  );

export function AlignmentStrip({
  strip,
  sides,
  decimals,
  reason = (code) => code,
  name = (key) => key,
  state,
}: {
  strip: Strip;
  /** The records the engine compares, as the workspace names them. */
  sides: readonly [string] | readonly [string, string];
  decimals: number;
  /** An engine reason in the workspace's words. */
  reason?: (code: string) => string;
  /** A compared item (component, account, field) in the workspace's words. */
  name?: (key: string) => string;
  /** The workspace's words for the result's status, where the strip says it. */
  state?: string;
}) {
  const { lang } = useI18n();
  const c = alignmentStripCopy[lang];
  const itemName = (key: string) => c.names[key] ?? name(key);
  // An amount inside the sentence keeps its own left-to-right run, as it does
  // where it is drawn: marked here, isolated when the sentence is written.
  const money = (minor: number) =>
    `${MARK}${scaledText(minor, decimals)}${MARK}`;

  const agreedValue =
    strip.agreed.of === null
      ? String(strip.agreed.count)
      : c.of(strip.agreed.count, strip.agreed.of);
  const agreedNote = c.units[strip.agreed.unit];

  const review = strip.review;
  const reviewValue =
    review.kind === 'count'
      ? String(review.count)
      : review.kind === 'whole'
        ? c.whole[review.review][0]
        : (state ?? review.status);
  const reviewNote =
    review.kind === 'count'
      ? [
          review.reason !== null && review.count > 0
            ? `${c.mainReason}: ${reason(review.reason)}`
            : null,
          review.alone !== undefined ? `${c.alone}: ${review.alone}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : review.kind === 'whole'
        ? c.whole[review.review][1]
        : '';
  const waiting =
    review.kind === 'count'
      ? review.count > 0
      : review.kind === 'whole' && review.review === 'needs-review';

  const gap = strip.gap;
  const first = gap.kind === 'figures' ? gap.items[0] : undefined;
  const gapNote =
    gap.kind === 'figures'
      ? first
        ? [
            `${itemName(first.name)}: ${c.between[first.between]}`,
            gap.items.length > 1
              ? `${c.moreDifferences}: ${gap.items.length - 1}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : `${c.compared}: ${gap.compared}`
      : gap.kind === 'not-computed'
        ? c.notComputedNote
        : (state ?? gap.status);
  const gapText =
    gap.kind === 'figures'
      ? first
        ? money(first.minor)
        : c.noDifference
      : gap.kind === 'not-computed'
        ? c.notComputed
        : c.blocked;

  // Each record's own total, where the engine gives one.
  const total = (i: number) => {
    const minor = strip.totals?.[i];
    return minor === undefined ? undefined : minor;
  };
  const reviewLabel = review.kind === 'state' ? c.state : c.review;
  const sentence = c.sentence({
    reviewLabel,
    sides: sides
      .map((side, i) => {
        const minor = total(i);
        return minor === undefined
          ? side
          : `${side}: ${minor === null ? '—' : money(minor)}`;
      })
      .join(' · '),
    agreed: `${agreedValue} (${agreedNote})`,
    review: reviewNote ? `${reviewValue} (${reviewNote})` : reviewValue,
    gap: `${gapText} (${gapNote})`,
  });

  return (
    <section
      className="alignment-strip"
      aria-label={c.name}
      data-alignment-strip
      data-sides={sides.length}
    >
      <p className="alignment-strip__sentence" data-strip-sentence>
        {isolated(sentence)}
      </p>
      <div className="alignment-strip__drawn" aria-hidden="true">
        <Paper side={0} name={sides[0]} minor={total(0)} decimals={decimals} />
        <div className="alignment-strip__cells">
          <div
            className="alignment-strip__cell"
            data-strip-cell="agreed"
            data-count={strip.agreed.count}
            data-of={strip.agreed.of ?? undefined}
          >
            <span className="alignment-strip__label">{c.agreed}</span>
            <strong className="alignment-strip__value">
              <bdi>{agreedValue}</bdi>
            </strong>
            <span className="alignment-strip__note">{agreedNote}</span>
          </div>
          <div
            className="alignment-strip__cell"
            data-strip-cell="review"
            data-kind={review.kind}
            data-count={review.kind === 'count' ? review.count : undefined}
            data-reason={
              review.kind === 'count' ? (review.reason ?? undefined) : undefined
            }
            data-tone={waiting ? 'review' : 'neutral'}
          >
            <span className="alignment-strip__label">{reviewLabel}</span>
            <strong
              className="alignment-strip__value"
              data-text={review.kind === 'count' ? undefined : ''}
            >
              <bdi>{reviewValue}</bdi>
            </strong>
            {reviewNote && (
              <span className="alignment-strip__note">{reviewNote}</span>
            )}
          </div>
          <div
            className="alignment-strip__cell"
            data-strip-cell="gap"
            data-kind={gap.kind}
            data-compared={gap.kind === 'figures' ? gap.compared : undefined}
            data-differences={
              gap.kind === 'figures' ? gap.items.length : undefined
            }
            data-name={first?.name}
            data-tone={first ? 'difference' : 'neutral'}
          >
            <span className="alignment-strip__label">{c.gap}</span>
            <strong
              className="alignment-strip__value"
              data-text={first ? undefined : ''}
              data-quiet={gap.kind === 'figures' ? undefined : ''}
            >
              {first ? (
                <Amount minor={first.minor} decimals={decimals} />
              ) : (
                gapText
              )}
            </strong>
            <span className="alignment-strip__note">{gapNote}</span>
          </div>
        </div>
        {sides[1] !== undefined && (
          <Paper
            side={1}
            name={sides[1]}
            minor={total(1)}
            decimals={decimals}
          />
        )}
      </div>
    </section>
  );
}

/** One end of the strip: a record as the workspace names it, drawn as the
 * corner of a sheet from the upload cards, with its own total under its name
 * where the engine gives one. */
function Paper({
  side,
  name,
  minor,
  decimals,
}: {
  side: 0 | 1;
  name: string;
  minor: number | null | undefined;
  decimals: number;
}) {
  return (
    <div className="alignment-strip__paper" data-strip-side={side}>
      <span className="alignment-strip__role">{name}</span>
      {minor !== undefined && (
        <span className="alignment-strip__total" data-strip-total>
          <Amount minor={minor} decimals={decimals} />
        </span>
      )}
    </div>
  );
}
