import type { AllocationResult } from './reconciliation/allocation.ts';
import type { ArResult } from './reconciliation/ar.ts';
import type { BankResult } from './reconciliation/bank.ts';
import type { ClearingResult } from './reconciliation/clearing.ts';
import type { AssetResult } from './reconciliation/fixed-assets.ts';
import { BALANCE_FIELDS, type GlTbResult } from './reconciliation/gl-tb.ts';
import type { IntercompanyResult } from './reconciliation/intercompany.ts';
import type { StockResult } from './reconciliation/inventory-register.ts';
import type { GatewayResult } from './reconciliation/payment-gateway.ts';
import type { PayrollResult } from './reconciliation/payroll.ts';
import type { FinancialResult } from './reconciliation/tb-financial.ts';
import type { Comparison } from './reconciliation/types.ts';

/**
 * The alignment strip (UX-4): what the head of a result says in each
 * workspace, read from the engine result. Every number here is a field of
 * the result as the engine wrote it, or a count of items by a status the
 * engine, or a recorded decision, wrote. No amount is added, subtracted or
 * turned into a share here: a gap the engine does not compute is said to be
 * not computed. The design record is docs/audits/UX-4-ALIGNMENT-STRIP.ar.md.
 */

/** What the counted items are, in the workspace's words. */
export type StripUnit =
  | 'case'
  | 'document'
  | 'movement'
  | 'group'
  | 'link'
  | 'field'
  | 'pair'
  | 'account'
  | 'residual'
  | 'component'
  | 'comparison'
  | 'line';

/** Which two quantities a gap compares; a positive engine value means the
 * first is larger, as each engine defines it. */
export type StripBetween =
  | 'supplier-ledger'
  | 'ledger-tb'
  | 'register-gl'
  | 'payroll-gl'
  | 'payroll-bank'
  | 'computed-summary'
  | 'summary-bank'
  | 'calculated-reported'
  | 'debit-credit'
  | 'clearing-net';

export type StripReview =
  /** Items that wait for a person, and the reason the engine gives most
   * often among them (ties go to the first in the engine's order); and,
   * where the engine keeps them apart, the items left without a
   * counterpart. */
  | { kind: 'count'; count: number; reason: string | null; alone?: number }
  /** One decision for the whole result. */
  | { kind: 'whole'; review: 'needs-review' | 'accepted' | 'rejected' }
  /** No decision is recorded in this workspace; its status says what needs
   * a look. */
  | { kind: 'state'; status: string };

/** One difference the engine wrote: its name as the workspace labels it, and
 * its value as signed by the engine. */
export type StripGapItem = {
  name: string;
  between: StripBetween;
  minor: number;
};

export type StripGap =
  /** The differences the engine computed: how many it compared, and those
   * that are not zero, in its order. */
  | { kind: 'figures'; compared: number; items: StripGapItem[] }
  /** The engine computes no gap for this comparison. */
  | { kind: 'not-computed' }
  /** The engine computes it, but not for this result: its status says why. */
  | { kind: 'blocked'; status: string };

export type AlignmentStrip = {
  /** Each record's own total, where the engine gives one. */
  totals: [number | null, number | null] | null;
  agreed: { count: number; of: number | null; unit: StripUnit };
  review: StripReview;
  gap: StripGap;
};

/** The reason given most often, ties to the first in order; null when none. */
export function mostFrequent(reasons: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: string | null = null,
    most = 0;
  for (const [reason, n] of counts)
    if (n > most) {
      best = reason;
      most = n;
    }
  return best;
}

const count = <T>(items: readonly T[], test: (item: T) => boolean) =>
  items.reduce((n, item) => (test(item) ? n + 1 : n), 0);

/** Differences as the engine wrote them: compared are those it computed,
 * listed are those that are not zero. */
function figures(
  values: readonly {
    name: string;
    between: StripBetween;
    minor: number | null;
  }[],
): StripGap {
  const computed = values.filter(
    (v): v is StripGapItem => typeof v.minor === 'number',
  );
  return {
    kind: 'figures',
    compared: computed.length,
    items: computed.filter((v) => v.minor !== 0),
  };
}

/** The supplier page has no words for its case classifications yet, so its
 * strip gives the count without a main reason; wording them is an accounting
 * decision of its own (docs/audits/UX-4-ALIGNMENT-STRIP.ar.md). */
export function supplierStrip(
  result: Pick<Comparison, 'caseCounts' | 'bridge'>,
): AlignmentStrip {
  return {
    totals: null,
    agreed: {
      count:
        result.caseCounts.autoMatchedCases + result.caseCounts.manualMatches,
      of: null,
      unit: 'case',
    },
    review: {
      kind: 'count',
      count: result.caseCounts.needsReviewCases,
      reason: null,
      alone: result.caseCounts.unmatchedCases,
    },
    gap: result.bridge
      ? figures([
          {
            name: 'closing',
            between: 'supplier-ledger',
            minor: result.bridge.delta,
          },
        ])
      : { kind: 'not-computed' },
  };
}

export function arStrip(
  result: Pick<ArResult, 'cases' | 'totals'>,
): AlignmentStrip {
  const waiting = result.cases.filter((c) => c.status === 'review');
  return {
    totals: result.totals,
    agreed: {
      count: count(result.cases, (c) => c.status === 'matched'),
      of: null,
      unit: 'document',
    },
    review: {
      kind: 'count',
      count: waiting.length,
      reason: mostFrequent(waiting.map((c) => c.reason)),
    },
    gap: { kind: 'not-computed' },
  };
}

export function bankStrip(result: Pick<BankResult, 'cases'>): AlignmentStrip {
  const waiting = result.cases.filter(
    (c) => c.status === 'needs-review' || c.status === 'source-error',
  );
  return {
    totals: null,
    agreed: {
      count: count(
        result.cases,
        (c) => c.status === 'matched-evidence' || c.status === 'matched-manual',
      ),
      of: null,
      unit: 'case',
    },
    review: {
      kind: 'count',
      count: waiting.length,
      reason: mostFrequent(waiting.map((c) => c.reason)),
    },
    gap: { kind: 'not-computed' },
  };
}

export function clearingStrip(
  result: Pick<ClearingResult, 'cases' | 'total'>,
): AlignmentStrip {
  const waiting = result.cases.filter((c) => c.status === 'review');
  return {
    totals: null,
    agreed: {
      count: count(result.cases, (c) => c.status === 'cleared'),
      of: null,
      unit: 'group',
    },
    review: {
      kind: 'count',
      count: waiting.length,
      reason: mostFrequent(waiting.map((c) => c.reason)),
    },
    gap: figures([
      { name: 'account-net', between: 'clearing-net', minor: result.total },
    ]),
  };
}

export function allocationStrip(
  result: Pick<AllocationResult, 'links' | 'status'>,
): AlignmentStrip {
  return {
    totals: null,
    agreed: { count: result.links.length, of: null, unit: 'link' },
    review: { kind: 'state', status: result.status },
    gap: { kind: 'not-computed' },
  };
}

export function glTbStrip(
  result: Pick<GlTbResult, 'differences' | 'status'>,
): AlignmentStrip {
  const differences = result.differences;
  return {
    totals: null,
    agreed: {
      count: differences
        ? count(BALANCE_FIELDS, (f) => differences[f] === 0)
        : 0,
      of: differences ? BALANCE_FIELDS.length : null,
      unit: 'field',
    },
    review: { kind: 'state', status: result.status },
    gap: differences
      ? figures(
          BALANCE_FIELDS.map((f) => ({
            name: f,
            between: 'ledger-tb' as const,
            minor: differences[f],
          })),
        )
      : { kind: 'blocked', status: result.status },
  };
}

export function intercompanyStrip(
  result: Pick<IntercompanyResult, 'pairs' | 'status'>,
): AlignmentStrip {
  const waiting = result.pairs.filter((p) => p.review === 'needs-review');
  return {
    totals: null,
    agreed: {
      count: count(result.pairs, (p) => p.status === 'ready'),
      of: result.pairs.length,
      unit: 'pair',
    },
    review: {
      kind: 'count',
      count: waiting.length,
      reason: mostFrequent(waiting.map((p) => p.status)),
    },
    gap: { kind: 'not-computed' },
  };
}

export function stockStrip(
  result: Pick<StockResult, 'comparisons' | 'totals' | 'review' | 'status'>,
): AlignmentStrip {
  const blocked = result.comparisons.every((c) => c.differenceMinor === null);
  return {
    totals: result.totals
      ? [result.totals.registerMinor, result.totals.glMinor]
      : null,
    agreed: {
      count: count(result.comparisons, (c) => c.differenceMinor === 0),
      of: result.comparisons.length,
      unit: 'account',
    },
    review: { kind: 'whole', review: result.review },
    gap: blocked
      ? { kind: 'blocked', status: result.status }
      : figures(
          result.comparisons.map((c) => ({
            name: c.dimensions ? `${c.account} · ${c.dimensions}` : c.account,
            between: 'register-gl' as const,
            minor: c.differenceMinor,
          })),
        ),
  };
}

/** The gateway's five residuals, in the engine's order: four totals worked
 * out from the transactions and fees against the settlement summary, then
 * the summary's payout against the bank. */
export const GATEWAY_RESIDUALS = [
  'gross',
  'refunds',
  'fees',
  'net',
  'payout',
] as const;

export function gatewayStrip(
  result: Pick<GatewayResult, 'residuals' | 'review' | 'status'>,
): AlignmentStrip {
  const residuals = result.residuals;
  return {
    totals: null,
    agreed: {
      count: residuals ? count(residuals, (n) => n === 0) : 0,
      of: residuals ? residuals.length : null,
      unit: 'residual',
    },
    review: { kind: 'whole', review: result.review },
    gap: residuals
      ? figures(
          residuals.map((minor, i) => ({
            name: GATEWAY_RESIDUALS[i],
            between:
              i < 4 ? ('computed-summary' as const) : ('summary-bank' as const),
            minor,
          })),
        )
      : { kind: 'blocked', status: result.status },
  };
}

export function payrollStrip(
  result: Pick<
    PayrollResult,
    'comparisons' | 'bankComparison' | 'review' | 'status'
  >,
): AlignmentStrip {
  const values = [
    ...result.comparisons.map((c) => ({
      name: c.component as string,
      between: 'payroll-gl' as const,
      minor: c.difference,
    })),
    {
      name: 'bank',
      between: 'payroll-bank' as const,
      minor: result.bankComparison.difference,
    },
  ];
  const computed = values.filter((v) => v.minor !== null);
  return {
    totals: null,
    agreed: {
      count: count(values, (v) => v.minor === 0),
      of: values.length,
      unit: 'comparison',
    },
    review: { kind: 'whole', review: result.review },
    gap: computed.length
      ? figures(values)
      : { kind: 'blocked', status: result.status },
  };
}

export function assetStrip(
  result: Pick<AssetResult, 'comparisons' | 'review' | 'status'>,
): AlignmentStrip {
  const computed = result.comparisons.filter((c) => c.difference !== null);
  return {
    totals: null,
    agreed: {
      count: count(result.comparisons, (c) => c.difference === 0),
      of: result.comparisons.length,
      unit: 'component',
    },
    review: { kind: 'whole', review: result.review },
    gap: computed.length
      ? figures(
          result.comparisons.map((c) => ({
            name: c.component as string,
            between: 'register-gl' as const,
            minor: c.difference,
          })),
        )
      : { kind: 'blocked', status: result.status },
  };
}

export function financialStrip(
  result: Pick<FinancialResult, 'lines' | 'tb' | 'status'>,
): AlignmentStrip {
  const values = [
    ...(result.tb
      ? [
          {
            name: 'trial-balance',
            between: 'debit-credit' as const,
            minor: result.tb.residual,
          },
        ]
      : []),
    ...result.lines.map((l) => ({
      name: l.label,
      between: 'calculated-reported' as const,
      minor: l.difference,
    })),
  ];
  const computed = values.filter((v) => v.minor !== null);
  return {
    totals: null,
    agreed: {
      count: count(values, (v) => v.minor === 0),
      of: values.length,
      unit: 'comparison',
    },
    review: {
      kind: 'count',
      count: count(result.lines, (l) => l.review === 'needs-review'),
      reason: null,
    },
    gap: computed.length
      ? figures(values)
      : { kind: 'blocked', status: result.status },
  };
}
