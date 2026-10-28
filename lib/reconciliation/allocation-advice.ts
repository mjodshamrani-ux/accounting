import type { AllocationResult } from './allocation.ts';

/** Proposed review of a remittance advice beside allocation-snapshot-1
 * (audit/allocation-advice-foundation/contract.json). It reads the family's
 * own result and never decides: no line is chosen, dropped or merged. */
export const ALLOCATION_ADVICE_VERSION = 'allocation-advice-review-1';
export const ADVICE_REASONS = [
  'OVER_PAYMENT',
  'OVER_INVOICE',
  'COMPETES_PAYMENT',
  'COMPETES_INVOICE',
  'TWIN',
] as const;
export type AdviceReason = (typeof ADVICE_REASONS)[number];
export type AdviceLine = {
  id: string;
  row: number;
  reference: string;
  payment: string;
  invoice: string;
  amount: number;
  status: 'allocated' | 'fits' | 'review';
  reasons: AdviceReason[];
  /** The line's payment and invoice, as indexes into `items`. */
  items: [number, number];
  /** Index into `twins`, or -1 when no other line has the same payment,
   * invoice and amount. */
  twinGroup: number;
};
export type AdviceItem = {
  id: string;
  side: 0 | 1;
  row: number;
  reference: string;
  available: number;
  allocated: number;
  remaining: number;
  advised: number;
  excess: number;
  /** Rows of the open lines naming the item. */
  open: number[];
};
/** Competitors and twins are kept once per item and per group of identical
 * lines, not once per line: one payment advised in 20,000 lines would
 * otherwise list 20,000 competitors for each of them. `competitorsOf` and
 * `twinsOf` give a line's own lists. */
export type AllocationAdviceReview = {
  version: typeof ALLOCATION_ADVICE_VERSION;
  context: string;
  decimals: number;
  lines: AdviceLine[];
  items: AdviceItem[];
  twins: number[][];
};

export function refuseAdvice(code: string): never {
  throw new Error(`ALLOCATION_ADVICE_${code}`);
}

const byRow = (a: number, b: number) => a - b;

/** Other open lines on a payment or invoice of the line whose open advice
 * exceeds its remaining capacity, by row. An allocated line competes with
 * none. */
export function competitorsOf(
  review: AllocationAdviceReview,
  line: AdviceLine,
): number[] {
  if (line.status === 'allocated') return [];
  const out = new Set<number>();
  for (const index of line.items) {
    const item = review.items[index];
    if (item.excess > 0)
      for (const row of item.open) if (row !== line.row) out.add(row);
  }
  return [...out].sort(byRow);
}

/** Other lines with the same payment, invoice and amount, by row. */
export function twinsOf(
  review: AllocationAdviceReview,
  line: AdviceLine,
): number[] {
  return line.twinGroup < 0
    ? []
    : review.twins[line.twinGroup].filter((row) => row !== line.row);
}

export function reviewAllocationAdvice(
  result: AllocationResult,
): AllocationAdviceReview {
  // A source error anywhere refuses the review, as the family refuses every
  // decision then (A6).
  if (result.status !== 'ready') refuseAdvice('SOURCE_ERRORS');
  const balance = new Map(result.balances.map((b) => [b.id, b]));
  const index = new Map(
    result.items.map((i, n) => [`${i.side}:${i.reference}`, n]),
  );
  const used = new Set(
    result.links
      .filter((l) => l.basis.kind === 'remittance')
      .map((l) => l.basis.proofId),
  );
  const items = result.items.map((i): AdviceItem => {
    const b = balance.get(i.id)!;
    return {
      id: i.id,
      side: i.side,
      row: i.row,
      reference: i.reference,
      available: b.available,
      allocated: b.allocated,
      remaining: b.remaining,
      advised: 0,
      excess: 0,
      open: [],
    };
  });
  const groups = new Map<string, number[]>();
  const placed = result.proofs.map((p) => {
    const at: [number, number] = [
      index.get(`0:${p.payment}`)!,
      index.get(`1:${p.invoice}`)!,
    ];
    const key = JSON.stringify([p.payment, p.invoice, p.amount]);
    const rows = groups.get(key);
    if (rows) rows.push(p.row);
    else groups.set(key, [p.row]);
    if (!used.has(p.id))
      for (const n of at) {
        items[n].advised += p.amount;
        items[n].open.push(p.row);
      }
    return { p, at, key };
  });
  for (const item of items)
    item.excess = Math.max(0, item.advised - item.remaining);
  const twins: number[][] = [],
    group = new Map<string, number>();
  for (const [key, rows] of groups)
    if (rows.length > 1) {
      group.set(key, twins.length);
      twins.push(rows.sort(byRow));
    }
  const lines = placed.map(({ p, at, key }): AdviceLine => {
    const base = {
      id: p.id,
      row: p.row,
      reference: p.reference,
      payment: p.payment,
      invoice: p.invoice,
      amount: p.amount,
      items: at,
      twinGroup: group.get(key) ?? -1,
    };
    if (used.has(p.id)) return { ...base, status: 'allocated', reasons: [] };
    const [pay, inv] = at.map((n) => items[n]);
    const over = [p.amount > pay.remaining, p.amount > inv.remaining];
    const crowded = [pay.excess > 0, inv.excess > 0];
    const reasons: AdviceReason[] = [];
    if (over[0]) reasons.push('OVER_PAYMENT');
    if (over[1]) reasons.push('OVER_INVOICE');
    if (crowded[0] && !over[0]) reasons.push('COMPETES_PAYMENT');
    if (crowded[1] && !over[1]) reasons.push('COMPETES_INVOICE');
    if (base.twinGroup >= 0) reasons.push('TWIN');
    return { ...base, status: reasons.length ? 'review' : 'fits', reasons };
  });
  return {
    version: ALLOCATION_ADVICE_VERSION,
    context: result.context,
    decimals: result.decimals,
    lines,
    items,
    twins,
  };
}
