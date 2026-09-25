// EXPERIMENT ONLY — architecture spike: payment allocation / application.
// Not a product feature, not imported by lib/, not part of `pnpm test`.
//
// The question is not "does this row match that row" but "how much of this
// payment belongs to each invoice, and what is left". A payment row may take
// part in several allocations, so the invariant here is on money, not rows:
// for every item, allocated + remaining = available, and no unit of money is
// allocated twice. Amounts are minor units of one currency.
import {
  normalizeReference,
  parseMoney,
} from '../../lib/reconciliation/core.ts';
import type {
  SourceFile,
  SourceResult,
  Transaction,
} from '../../lib/reconciliation/types.ts';

export type SourceTrace = {
  source: string;
  sheet: string;
  row: number;
  /** The amount cell as written in the source. */
  text: string;
};
export type AllocatableItem = {
  id: string;
  kind: 'payment' | 'invoice';
  currency: string;
  reference: string;
  date: string;
  /** What may be allocated in this run: for an open item its remaining
   * amount, for a payment its full amount. Never changed by allocating. */
  availableMinor: number;
  trace: SourceTrace;
};

/** One line of a remittance advice: this much of this payment settles that
 * invoice. The only automatic basis in this experiment. */
export type RemittanceLine = {
  paymentReference: string;
  invoiceReference: string;
  amountMinor: number;
  trace: SourceTrace;
};
export type AllocationBasis =
  | { type: 'document'; line: RemittanceLine }
  | { type: 'external-confirmation'; reference: string; reason: string }
  | { type: 'accountant-review'; reference: string; reason: string };
export type Allocation = {
  paymentId: string;
  invoiceId: string;
  amountMinor: number;
  basis: AllocationBasis;
};
/** Same economic payment in two sources. It moves no money. */
export type MatchRelation = {
  itemId: string;
  counterpartId: string;
  basis: string;
};

/** Items from a normalised source the production reader already produced. */
export function itemsFrom(
  source: SourceResult,
  kind: AllocatableItem['kind'],
): AllocatableItem[] {
  return source.transactions.map((t: Transaction) => ({
    id: t.id,
    kind,
    currency: t.currency ?? '',
    reference: t.normalizedReference,
    date: t.date,
    availableMinor: Math.abs(t.amount),
    trace: {
      source: source.sourceName,
      sheet: t.sheet,
      row: t.row,
      text: t.originalAmount,
    },
  }));
}

/** A remittance advice: Payment Ref, Invoice No, Amount Applied. References
 * are normalised as the production reader normalises them. */
export function readRemittance(
  file: SourceFile,
  header: number,
  decimals: 0 | 2 | 3,
): RemittanceLine[] {
  const sheet = file.sheets[0];
  return sheet.rows.slice(header + 1).flatMap((cells, i) =>
    cells.every((c) => !c.trim())
      ? []
      : [
          {
            paymentReference: normalizeReference(cells[0]),
            invoiceReference: normalizeReference(cells[1]),
            amountMinor: parseMoney(cells[2], 'dot', decimals),
            trace: {
              source: file.name,
              sheet: sheet.name,
              row: header + i + 2,
              text: cells[2],
            },
          },
        ],
  );
}

export class AllocationLedger {
  readonly items: ReadonlyMap<string, AllocatableItem>;
  readonly allocations: Allocation[] = [];
  readonly currency: string;
  constructor(items: AllocatableItem[], currency: string) {
    this.currency = currency;
    this.items = new Map(
      items.map((item) => [
        item.id,
        Object.freeze({ ...item, trace: Object.freeze({ ...item.trace }) }),
      ]),
    );
    if (this.items.size !== items.length) throw new Error('duplicate item');
  }
  allocated(id: string) {
    return this.allocations
      .filter((a) => a.paymentId === id || a.invoiceId === id)
      .reduce((total, a) => total + a.amountMinor, 0);
  }
  remaining(id: string) {
    return this.items.get(id)!.availableMinor - this.allocated(id);
  }
  /** Apply one decision (one or more allocations) all or nothing. */
  apply(proposed: Allocation[]) {
    const pending = new Map<string, number>();
    for (const a of proposed) {
      const payment = this.items.get(a.paymentId);
      const invoice = this.items.get(a.invoiceId);
      if (payment?.kind !== 'payment' || invoice?.kind !== 'invoice')
        throw new Error('allocation refused: unknown payment or invoice');
      if (!Number.isInteger(a.amountMinor) || a.amountMinor <= 0)
        throw new Error('allocation refused: the amount must be positive');
      if (
        payment.currency !== this.currency ||
        invoice.currency !== this.currency
      )
        throw new Error('allocation refused: outside the confirmed currency');
      checkBasis(a, payment, invoice);
      for (const id of [a.paymentId, a.invoiceId]) {
        const total = (pending.get(id) ?? 0) + a.amountMinor;
        if (total > this.remaining(id))
          throw new Error(
            `allocation refused: ${id} has ${this.remaining(id)} available`,
          );
        pending.set(id, total);
      }
    }
    this.allocations.push(...proposed);
  }
  balances() {
    return new Map(
      [...this.items.keys()].map((id) => [
        id,
        {
          available: this.items.get(id)!.availableMinor,
          allocated: this.allocated(id),
          remaining: this.remaining(id),
        },
      ]),
    );
  }
}

/** The basis must name what it relates, and a document basis must agree
 * with the items it links. Free text on its own proves nothing. */
function checkBasis(
  a: Allocation,
  payment: AllocatableItem,
  invoice: AllocatableItem,
) {
  const basis = a.basis;
  if (basis.type === 'document') {
    const line = basis.line;
    if (
      line.paymentReference !== payment.reference ||
      line.invoiceReference !== invoice.reference ||
      line.amountMinor !== a.amountMinor
    )
      throw new Error(
        'allocation refused: the document does not state this allocation',
      );
    return;
  }
  if (!basis.reference.trim() || !basis.reason.trim())
    throw new Error(
      'allocation refused: a human basis needs its reference and a reason',
    );
}

/** Allocations from a remittance advice: each line must name one payment and
 * one invoice exactly, by their references. */
export function allocateFromRemittance(
  ledger: AllocationLedger,
  lines: RemittanceLine[],
) {
  const byReference = (kind: AllocatableItem['kind'], reference: string) => {
    const found = [...ledger.items.values()].filter(
      (item) => item.kind === kind && item.reference === reference,
    );
    if (found.length !== 1)
      throw new Error(
        `remittance refused: ${reference} names ${found.length} ${kind}s`,
      );
    return found[0];
  };
  ledger.apply(
    lines.map((line) => ({
      paymentId: byReference('payment', line.paymentReference).id,
      invoiceId: byReference('invoice', line.invoiceReference).id,
      amountMinor: line.amountMinor,
      basis: { type: 'document', line },
    })),
  );
}

/** A question for the reviewer, never an allocation: one open invoice whose
 * remaining amount equals the payment's, dated within the window. No sums of
 * several invoices are ever searched. */
export function suggestions(ledger: AllocationLedger, windowDays: number) {
  const days = (a: string, b: string) =>
    Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  const open = (kind: AllocatableItem['kind']) =>
    [...ledger.items.values()].filter(
      (item) => item.kind === kind && ledger.remaining(item.id) > 0,
    );
  return open('payment').flatMap((payment) => {
    const same = open('invoice').filter(
      (invoice) =>
        ledger.remaining(invoice.id) === ledger.remaining(payment.id) &&
        days(invoice.date, payment.date) <= windowDays,
    );
    return same.length === 1
      ? [
          {
            paymentId: payment.id,
            invoiceId: same[0].id,
            status: 'needs-review' as const,
          },
        ]
      : [];
  });
}

/** A view for review: payments and invoices joined by their allocations. It
 * is derived from the ledger and owns nothing. */
export function allocationGroups(ledger: AllocationLedger) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    return p === id ? id : find(p);
  };
  for (const a of ledger.allocations)
    parent.set(find(a.invoiceId), find(a.paymentId));
  const groups = new Map<string, Set<string>>();
  for (const a of ledger.allocations)
    for (const id of [a.paymentId, a.invoiceId]) {
      const root = find(id);
      groups.set(root, (groups.get(root) ?? new Set()).add(id));
    }
  return [...groups.values()].map((ids) => [...ids].sort());
}
