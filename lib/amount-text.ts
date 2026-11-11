// What an amount or a quantity reads on screen: the engine's integer at the
// precision it carries, grouped, with the minus first. Display only; nothing
// here sums, rounds or parses. A value the formatter cannot place exactly is
// shown as it came rather than approximated.
import { money } from './reconciliation/core.ts';

export function scaledText(
  value: number | string | null | undefined,
  places: number,
): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isInteger(places) || places < 0) return String(value);
  if (typeof value === 'string')
    return /^-?\d+$/u.test(value) ? integerText(value, places) : value;
  return Number.isSafeInteger(value) ? money(value, places) : String(value);
}

// An integer kept as a decimal string, as some engines return amounts beyond
// the safe range; placed digit by digit, never through a float.
function integerText(value: string, places: number) {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value)
    .replace(/^0+(?=\d)/u, '')
    .padStart(places + 1, '0');
  const whole = (places ? digits.slice(0, -places) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    ',',
  );
  return `${negative ? '-' : ''}${whole}${places ? `.${digits.slice(-places)}` : ''}`;
}
