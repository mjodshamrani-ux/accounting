import { scaledText } from '@/lib/amount-text';

/**
 * A money amount as the accountant reads it: major units at the currency's
 * precision, grouped, in its own left-to-right run so the minus stays before
 * the digits inside Arabic text, and never wrapped. The engine keeps integer
 * minor units; they stay in a data attribute for checks and are never shown.
 */
export function Amount({
  minor,
  decimals,
}: {
  minor: number | null | undefined;
  decimals: number;
}) {
  if (minor === null || minor === undefined) return <>—</>;
  return (
    <bdi dir="ltr" className="tarasuf-amount" data-amount-minor={minor}>
      {scaledText(minor, decimals)}
    </bdi>
  );
}

/**
 * Labelled amounts in one line, each with its own name, instead of a list of
 * names and a list of numbers joined by slashes. A difference names its
 * direction in its label.
 */
export function Figures({
  items,
  decimals,
}: {
  items: readonly (readonly [
    label: string,
    minor: number | null | undefined,
  ])[];
  decimals: number;
}) {
  return (
    <span className="tarasuf-figures">
      {items.map(([label, minor]) => (
        <span key={label} className="tarasuf-figure">
          {label} <Amount minor={minor} decimals={decimals} />
        </span>
      ))}
    </span>
  );
}

/**
 * A quantity the engine keeps as a scaled integer with its own precision,
 * read as a decimal number in its own left-to-right run. It is not money and
 * carries no currency; its unit sits in its own column.
 */
export function Quantity({
  scaled,
  precision,
}: {
  scaled: number | null | undefined;
  precision: number;
}) {
  if (scaled === null || scaled === undefined) return <>—</>;
  return (
    <bdi dir="ltr" className="tarasuf-amount" data-quantity-scaled={scaled}>
      {scaledText(scaled, precision)}
    </bdi>
  );
}
