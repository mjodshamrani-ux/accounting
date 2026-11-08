import { clearingStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import type { ClearingInput, ClearingResult } from './clearing.ts';
import { exportClearing } from './clearing-io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
} from './reconciliation-sheet.ts';

/**
 * The clearing reconciliation sheet (UX-6(b)): what the result says on the
 * screen, in the interface's language, from the result the export has just
 * replayed and found equal, and the decisions recorded with their reasons.
 * Every figure is a field of that result or a count of its items; nothing is
 * added or subtracted here.
 */
export function clearingSheet(
  state: ClearingInput,
  result: ClearingResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.clearing;
  const posting = new Map(result.rows.map((row) => [row.id, row.posting]));
  const members = (ids: readonly string[]) =>
    ids.map((id) => posting.get(id) ?? id).join(', ');
  const reason = (code: string) =>
    (t.reason as Record<string, string>)[code] ?? code;
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: (
          [
            [t.entity, result.scope.entity],
            [t.ledger, result.scope.ledger],
            [t.account, result.scope.account],
            [t.currency, result.scope.currency],
            [t.start, result.scope.start],
            [t.end, result.scope.end],
          ] as const
        ).map(([label, value]) => ({
          label,
          value: { text: value, style: 'value' },
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Summary',
        sources: [
          { role: t.upload, name: state.file.name, hash: result.sourceHash },
        ],
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(clearingStrip(result), alignmentStripCopy[language], {
          reason,
        }),
        decimals: result.decimals,
      },
      {
        // The figures the screen shows beside the strip.
        kind: 'pairs',
        title: t.results,
        evidence: 'Summary',
        rows: [
          { label: t.valid, value: { count: result.rows.length } },
          {
            label: t.cleared,
            value: {
              count: result.cases
                .filter((c) => c.status === 'cleared')
                .reduce((n, c) => n + c.ids.length, 0),
            },
          },
          {
            label: t.errors,
            value: {
              count: result.inventory.filter((r) => r.kind === 'error')
                .length,
            },
          },
        ],
      },
      {
        // What the engine left for a person, each group with its net as the
        // engine signed it and the reason it gives.
        kind: 'table',
        title: t.review,
        evidence: 'Cases',
        head: [t.members, t.reference, t.net, t.basis],
        rows: result.cases
          .filter((c) => c.status === 'review')
          .map((c) => [
            { text: members(c.ids), style: 'value' },
            { text: c.reference || t.missing, style: 'value' },
            { minor: c.net, decimals: result.decimals },
            { text: reason(c.reason), style: 'value' },
          ]),
      },
      {
        // Each recorded decision with the reason the reviewer gave; what it
        // did is said in the words the screen gives the reason it leaves.
        kind: 'table',
        title: w.decisions,
        evidence: 'Decisions',
        head: [w.decision, t.members, t.note],
        rows: state.events.map((event) => [
          {
            text: reason(
              event.action === 'clear' ? 'human-decision' : 'reopened',
            ),
            style: 'value',
          },
          { text: members(event.ids), style: 'value' },
          { text: event.note, style: 'value' },
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The clearing workpaper as the worker hands it to the page: the evidence as
 * the existing export writes it, after it has replayed the source and the
 * decisions and found the result equal, then the reconciliation sheet first.
 */
export async function exportClearingWorkpaper(
  state: ClearingInput,
  result: ClearingResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportClearing(state, result);
  return addReconciliationSheet(
    evidence,
    clearingSheet(state, result, language),
  );
}
