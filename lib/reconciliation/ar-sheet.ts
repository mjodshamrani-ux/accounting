import { arStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import type { ArInput, ArResult } from './ar.ts';
import { exportAr } from './ar-io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';

/**
 * The customer AR reconciliation sheet (UX-6(b)): what the result says on
 * the screen, in the interface's language, from the result the export has
 * just replayed and found equal, and the decisions recorded with their
 * reasons. Each document left for review is written as the screen lists it:
 * its type, its number and its reason, then each of its movements with the
 * record it comes from, its original signed amount and its date. Every
 * figure is a field of that result or a count of its items; nothing is added
 * or subtracted here.
 */
export function arSheet(
  state: ArInput,
  result: ArResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.receivables;
  const reason = (code: string) =>
    (t.reason as Record<string, string>)[code] ?? code;
  const kind = (code: string) =>
    (t.kind as Record<string, string>)[code] ?? code;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const row = new Map(result.rows.map((r) => [r.id, r]));
  const owner = new Map(
    result.cases.flatMap((c) => c.ids.map((id) => [id, c] as const)),
  );
  const total = (minor: number | null): SheetCell =>
    minor === null
      ? value(t.unavailableTotal)
      : { minor, decimals: result.decimals, start: true };
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: (
          [
            [t.fields.entity, result.scope.entity],
            [t.fields.ledger, result.scope.ledger],
            [t.fields.customer, result.scope.customer],
            [t.fields.account, result.scope.account],
            [t.fields.currency, result.scope.currency],
            [t.start, result.scope.start],
            [t.end, result.scope.end],
          ] as const
        ).map(([label, text]) => ({ label, value: value(text) })),
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
        cells: stripView(arStrip(result), alignmentStripCopy[language], {
          reason,
        }),
        decimals: result.decimals,
        // Each record's own total, as the strip draws it at either end.
        totals: result.totals.map((minor, side) => ({
          label: t.sides[side],
          value: total(minor),
        })),
      },
      {
        // The figures the screen shows beside the strip.
        kind: 'pairs',
        title: t.results,
        evidence: 'Summary',
        rows: [
          { label: t.valid, value: { count: result.rows.length } },
          {
            label: t.errors,
            value: {
              count: result.inventory.filter((i) => i.kind === 'error').length,
            },
          },
        ],
      },
      {
        // What the engine left for a person, each document as the screen
        // lists it: its type, number and reason, then its movements.
        kind: 'table',
        title: t.review,
        evidence: 'Cases',
        head: [],
        rows: result.cases
          .filter((c) => c.status === 'review')
          .flatMap((c) => [
            [value(kind(c.kind)), value(c.document), value(reason(c.reason))],
            ...c.ids.map((id): SheetCell[] => {
              const r = row.get(id)!;
              return [
                null,
                value(t.sides[r.side]),
                { minor: r.amount, decimals: result.decimals },
                value(r.date),
              ];
            }),
          ]),
      },
      {
        // Each recorded decision with the reason the reviewer gave; what it
        // did is said in the words the screen gives the reason it leaves.
        kind: 'table',
        title: w.decisions,
        evidence: 'Decisions',
        head: [w.decision, t.fields.kind, t.fields.document, t.note],
        rows: state.events.map((event) => {
          const target = owner.get(event.ids[0]);
          const first = row.get(event.ids[0]);
          return [
            value(
              reason(
                event.action === 'accept' ? 'human-confirmation' : 'reopened',
              ),
            ),
            value(kind(target?.kind ?? first?.kind ?? '')),
            value(target?.document ?? first?.document ?? ''),
            value(event.note),
          ];
        }),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The AR workpaper as the worker hands it to the page: the evidence as the
 * existing export writes it, after it has replayed the sources and the
 * decisions and found the result equal, then the reconciliation sheet first.
 */
export async function exportArWorkpaper(
  state: ArInput,
  result: ArResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportAr(state, result);
  return addReconciliationSheet(evidence, arSheet(state, result, language));
}
