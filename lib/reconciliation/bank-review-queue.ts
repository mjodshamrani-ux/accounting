// bank-review-queue-1 (proposed): the review queue of a bank statement
// period, by the contract in audit/bank-review-foundation/contract.json. The
// lifecycle settles the period and stays the authority on every decision
// (bank-statement-lifecycle.ts); this module only reads its result.
//
// The queue holds every review case still needing a decision, exceptions
// before suggestions, then by impact. Cases share a group only when they
// share their reason, their members' directions, their shape and, for a date
// gap, its days. A group decision is the single decisions it stands for, one
// per case, so the session records nothing new. The queue never decides,
// never changes a reason, an amount or a member, and never hides a case.
import type { ReviewReason } from './bank-statement-match.ts';
import type { BankStatementResult } from './bank-statement-lifecycle.ts';
import type { StatementDecision } from './bank-statement-request.ts';

export const BANK_REVIEW_QUEUE_FAMILY = 'bank-review-queue-1';
/** The order of reasons when impact and members tie. */
export const REVIEW_REASON_ORDER = [
  'direction-conflict',
  'amount-difference',
  'duplicate-reference',
  'ambiguous-amount-date',
  'date-gap',
  'amount-date-suggestion',
] as const satisfies readonly ReviewReason[];
/** Reasons an accountant may accept as they stand. */
const SUGGESTIONS: ReadonlySet<string> = new Set<ReviewReason>([
  'date-gap',
  'amount-date-suggestion',
]);
export type ReviewQueueCase = {
  case: string;
  statement: string[];
  cashbook: string[];
  /** Minor units: the larger of the two sides' totals. */
  impact: number;
};
export type ReviewQueueGroup = {
  signature: string;
  reason: ReviewReason;
  class: 'exception' | 'suggestion';
  direction: 'in' | 'out' | 'in+out';
  /** The number of statement and cashbook members of each case. */
  statement: number;
  cashbook: number;
  /** Days between the movement and the entry of a date-gap case. */
  gap?: number;
  cases: ReviewQueueCase[];
  impact: number;
  members: number;
  offers: { accept: boolean; reject: boolean };
};

const day = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) /
  86_400_000;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The groups of the review cases needing a decision, in the contract's
 * order. A held statement, and a period with none, has an empty queue. */
export function reviewQueue(result: BankStatementResult): ReviewQueueGroup[] {
  if (result.status === 'held') return [];
  const movements = new Map(result.match.movements.map((m) => [m.id, m]));
  const entries = new Map(result.match.cashbook.map((e) => [e.id, e]));
  const groups = new Map<string, ReviewQueueGroup>();
  for (const c of result.cases) {
    if (c.kind !== 'review' || c.status !== 'needs-review') continue;
    const reason = c.reason as ReviewReason;
    const s = c.statement.map((id) => movements.get(id)!);
    const e = c.cashbook.map((id) => entries.get(id)!);
    const directions = [...new Set([...s, ...e].map((x) => x.direction))].sort(
      byText,
    );
    const gap =
      reason === 'date-gap'
        ? Math.abs(day(s[0].date) - day(e[0].date))
        : undefined;
    const signature = [
      reason,
      directions.join('+'),
      `${s.length}:${e.length}`,
      gap ?? '',
    ].join('|');
    let g = groups.get(signature);
    if (!g) {
      g = {
        signature,
        reason,
        class: SUGGESTIONS.has(reason) ? 'suggestion' : 'exception',
        direction: directions.join('+') as ReviewQueueGroup['direction'],
        statement: s.length,
        cashbook: e.length,
        ...(gap === undefined ? {} : { gap }),
        cases: [],
        impact: 0,
        members: 0,
        offers: { accept: false, reject: false },
      };
      groups.set(signature, g);
    }
    const total = (xs: { amount: number }[]) =>
      xs.reduce((n, x) => n + x.amount, 0);
    g.cases.push({
      case: c.id,
      statement: [...c.statement],
      cashbook: [...c.cashbook],
      impact: Math.max(total(s), total(e)),
    });
  }
  const queue = [...groups.values()];
  for (const g of queue) {
    g.cases.sort(
      (a, b) =>
        b.impact - a.impact ||
        Number(a.case.slice(1)) - Number(b.case.slice(1)),
    );
    g.impact = Math.max(...g.cases.map((c) => c.impact));
    g.members = g.cases.reduce(
      (n, c) => n + c.statement.length + c.cashbook.length,
      0,
    );
    g.offers = {
      accept: g.cases.length >= 2 && g.class === 'suggestion',
      reject: g.cases.length >= 2,
    };
  }
  const rank = (g: ReviewQueueGroup) => (g.class === 'exception' ? 0 : 1);
  return queue.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.impact - a.impact ||
      b.members - a.members ||
      REVIEW_REASON_ORDER.indexOf(a.reason) -
        REVIEW_REASON_ORDER.indexOf(b.reason) ||
      byText(a.signature, b.signature),
  );
}

/** Which group decisions the lifecycle would take on this group, given a
 * note. */
export function groupActions(g: ReviewQueueGroup, note: string) {
  const noted = !!note.trim();
  return { accept: noted && g.offers.accept, reject: noted && g.offers.reject };
}

/** The single decisions a group decision stands for: one per case of the
 * group as the result has it now, in the group's case order, each with its
 * exact members and the result's context, and the same type, note and time.
 * Null when the result has no such group or the group does not offer it. */
export function groupDecisions(
  result: BankStatementResult,
  signature: string,
  type: 'accept' | 'reject',
  note: string,
  id: (index: number) => string,
  at: string,
): StatementDecision[] | null {
  const g = reviewQueue(result).find((x) => x.signature === signature);
  if (!g || !groupActions(g, note)[type]) return null;
  return g.cases.map((c, i) => ({
    id: id(i),
    type,
    context: result.context,
    at,
    case: c.case,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    note: note.trim(),
  }));
}
