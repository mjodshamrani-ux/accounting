// What an amount or a quantity reads on screen: the engine's integer at the
// precision it carries, grouped, with the minus first. Display only; nothing
// here sums, rounds or parses. A value the formatter cannot place exactly is
// shown as it came rather than approximated.
import { money } from './reconciliation/core.ts';

export function scaledText(
  value: number | null | undefined,
  places: number,
): string {
  if (value === null || value === undefined) return '—';
  return Number.isSafeInteger(value) && Number.isInteger(places) && places >= 0
    ? money(value, places)
    : String(value);
}
