// bank-tolerance-1 (proposed): a tolerance the accountant declares on one
// bank statement period, by the contract in
// audit/bank-tolerance-foundation/contract.json. The lifecycle settles the
// period (bank-statement-lifecycle.ts); this module checks the policy against
// the statement currency and finds the pairs it tolerates.
//
// Only a pair the matching already ties by one explicit shared reference, with
// the same direction, dates within the window and an amount difference of at
// most perItem, is eligible. When the eligible differences of the period add
// up, never netted, to more than perPeriod, none is tolerated. A tolerated
// pair keeps both amounts and its difference; nothing here changes an amount,
// makes or moves a member, decides a case or hides a difference.
import { currencyPrecision } from './currency-precision.ts';
import type { StatementMatchResult } from './bank-statement-match.ts';
import type { DeclaredTolerance } from './bank-statement-request.ts';

export const BANK_TOLERANCE_FAMILY = 'bank-tolerance-1';
/** In the order they are checked; a policy is refused by the first it breaks. */
export const TOLERANCE_RULES = [
  'CURRENCY',
  'PER_ITEM',
  'PER_PERIOD',
  'NOTE',
] as const;
export type ToleranceRule = (typeof TOLERANCE_RULES)[number];
export const TOLERANCE_NOTE_LIMIT = 200;
/** A policy the contract admits, in minor units of the statement currency. */
export type TolerancePolicy = {
  perItem: number;
  perPeriod: number;
  note: string;
};
/** An eligible pair: its case, members and amounts, and the difference
 * statement minus cashbook in minor units. */
export type TolerancePair = {
  case: string;
  statement: string;
  cashbook: string;
  amounts: { statement: number; cashbook: number; difference: number };
};
/** What the policy did to the period. */
export type StatementTolerance = {
  family: typeof BANK_TOLERANCE_FAMILY;
  policy: TolerancePolicy;
  /** Every eligible pair, in case order, tolerated or not. */
  eligible: TolerancePair[];
  /** The sum of their absolute differences, never netted. */
  sum: number;
  /** sum > perPeriod: none of them is tolerated. */
  exceeded: boolean;
};

export class ToleranceRefused extends Error {
  readonly rule: ToleranceRule;
  constructor(rule: ToleranceRule) {
    super(`BANK_STATEMENT_TOLERANCE: ${rule}`);
    this.rule = rule;
  }
}

/** The declared policy as the contract admits it for this currency, or the
 * first rule it breaks. */
export function tolerancePolicy(
  declared: DeclaredTolerance,
  currency: string,
): TolerancePolicy {
  const exponent = currencyPrecision(currency);
  // A currency without a minor unit has no tolerance.
  if (!exponent) throw new ToleranceRefused('CURRENCY');
  const { perItem, perPeriod, note } = declared;
  const major = 10 ** exponent;
  if (
    typeof perItem !== 'number' ||
    !Number.isSafeInteger(perItem) ||
    perItem < 1 ||
    perItem >= major
  )
    throw new ToleranceRefused('PER_ITEM');
  if (
    typeof perPeriod !== 'number' ||
    !Number.isSafeInteger(perPeriod) ||
    perPeriod < perItem ||
    perPeriod >= 100 * major
  )
    throw new ToleranceRefused('PER_PERIOD');
  // One line of visible text, as a book balance's note.
  if (
    typeof note !== 'string' ||
    !note.trim() ||
    note.length > TOLERANCE_NOTE_LIMIT ||
    /[\p{Cc}\p{Cf}]/u.test(note)
  )
    throw new ToleranceRefused('NOTE');
  return { perItem, perPeriod, note };
}

const dayNumber = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/** The eligible pairs among the period's cases, and whether their sum is
 * within perPeriod. Reads the cases; changes nothing. */
export function toleratedPairs(
  cases: readonly {
    id: string;
    kind: string;
    reason: string;
    statement: readonly string[];
    cashbook: readonly string[];
  }[],
  match: StatementMatchResult,
  policy: TolerancePolicy,
): StatementTolerance {
  const movements = new Map(match.movements.map((m) => [m.id, m]));
  const entries = new Map(match.cashbook.map((e) => [e.id, e]));
  const eligible: TolerancePair[] = [];
  for (const c of cases) {
    if (
      c.kind !== 'review' ||
      c.reason !== 'amount-difference' ||
      c.statement.length !== 1 ||
      c.cashbook.length !== 1
    )
      continue;
    const s = movements.get(c.statement[0])!;
    const e = entries.get(c.cashbook[0])!;
    const difference = s.amount - e.amount;
    if (
      s.direction !== e.direction ||
      Math.abs(dayNumber(s.date) - dayNumber(e.date)) >
        match.policy.dateWindowDays ||
      Math.abs(difference) > policy.perItem
    )
      continue;
    eligible.push({
      case: c.id,
      statement: s.id,
      cashbook: e.id,
      amounts: { statement: s.amount, cashbook: e.amount, difference },
    });
  }
  const sum = eligible.reduce((t, p) => t + Math.abs(p.amounts.difference), 0);
  return {
    family: BANK_TOLERANCE_FAMILY,
    policy,
    eligible,
    sum,
    exceeded: sum > policy.perPeriod,
  };
}
