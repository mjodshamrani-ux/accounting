import { allocationStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import {
  ALLOCATION_SCOPE_FIELDS,
  type AllocationInput,
  type AllocationResult,
} from './allocation.ts';
import { exportAllocation } from './allocation-io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
  type SheetSection,
} from './reconciliation-sheet.ts';

/**
 * The payment allocation reconciliation sheet (UX-6(b)): what the result says
 * on the screen, in the interface's language, from the result the export has
 * just replayed and found equal, and the decisions recorded with their
 * reasons. The value ledger is written side by side as the screen's identity
 * says it, allocated and remaining against what is available, each item by
 * its own reference; each active allocation with its basis, its reference
 * and its reason, then the payment and the invoice it joins, each with the
 * amount it takes from that side; each dated decision with its number, its
 * time and the reason given, an undo with the decision it undoes. Every
 * figure is a field of that result; nothing is added or subtracted here.
 */
export function allocationSheet(
  result: AllocationResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.allocation;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const money = (minor: number): SheetCell => ({
    minor,
    decimals: result.decimals,
  });
  const item = new Map(result.items.map((i) => [i.id, i]));
  const balance = new Map(result.balances.map((b) => [b.id, b]));
  // The value ledger of one side, as the screen's table lists it.
  const ledger = (side: 0 | 1): SheetSection => ({
    kind: 'table',
    title: t.sides[side],
    evidence: 'Value ledger',
    head: [t.ownReference, t.available, t.allocated, t.remaining],
    rows: result.items
      .filter((i) => i.side === side)
      .map((i) => {
        const b = balance.get(i.id)!;
        return [
          value(i.reference),
          money(b.available),
          money(b.allocated),
          money(b.remaining),
        ];
      }),
  });
  return composeSheet(language, {
    title: t.paymentAllocation,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: ALLOCATION_SCOPE_FIELDS.map((field, i) => ({
          label: t.fields[i],
          value: value(result.scope[field]),
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Sources',
        sources: result.sources.map((s, side) => ({
          role: t.sides[side],
          name: s.name,
          hash: s.hash,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(
          allocationStrip(result),
          alignmentStripCopy[language],
          {
            state: result.status === 'ready' ? t.ready : t.sourceError,
          },
        ),
        decimals: result.decimals,
      },
      ledger(0),
      ledger(1),
      {
        // Each active allocation as the screen lists it: its basis, the
        // basis's reference and reason, then the payment and the invoice it
        // joins, each with the amount it takes from that side. It stays on
        // one printed page.
        kind: 'table',
        title: t.activeAllocations,
        evidence: 'Active links',
        head: [],
        blocks: result.links.map(() => 3),
        rows: result.links.flatMap((l) => [
          [
            value(t.basisTypes[l.basis.kind]),
            value(l.basis.reference),
            value(l.basis.reason),
          ],
          [
            null,
            value(t.sides[0]),
            money(l.amount),
            value(item.get(l.paymentId)!.reference),
          ],
          [
            null,
            value(t.sides[1]),
            money(l.amount),
            value(item.get(l.invoiceId)!.reference),
          ],
        ]),
      },
      {
        // Each dated decision as the screen lists it: what it did, its
        // number and time, then the reason given, an undo with the decision
        // it undoes as the screen points to it.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t.eventTypes[e.type]), value(e.id), value(e.at)],
          [
            null,
            e.type === 'undo' ? value(`→ ${e.target}`) : null,
            value(e.note),
          ],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The payment allocation workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the
 * sources and the decisions and found the result equal, then the
 * reconciliation sheet first.
 */
export async function exportAllocationWorkpaper(
  state: AllocationInput,
  result: AllocationResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportAllocation(state, result);
  return addReconciliationSheet(evidence, allocationSheet(result, language));
}
