import { bankStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import type { BankInput, BankResult } from './bank.ts';
import { exportBank } from './bank-io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';

/**
 * The bank movements reconciliation sheet (UX-6(b)): what the result says on
 * the screen, in the interface's language, from the result the export has
 * just replayed and found equal, and the decisions recorded with their
 * reasons. Each case left for review is written as the screen lists it: its
 * kind, its settlement identity where it has one and its reason, the bank
 * minus cashbook difference the engine computed, then each of its complete
 * members with its side, its signed amount and its own reference. Every
 * figure is a field of that result or a count of its items; nothing is added
 * or subtracted here.
 */
export function bankMovementsSheet(
  state: BankInput,
  result: BankResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.bank;
  const reason = (code: string) =>
    (t.reasons as Record<string, string>)[code] ?? code;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const record = new Map(result.records.map((r) => [r.id, r]));
  // A member named as the screen names it: by its own reference.
  const names = (ids: readonly string[]) =>
    ids.map((id) => record.get(id)?.reference ?? id).join(' · ');
  // What the strip counts as waiting: a case that needs review, and one a
  // source error holds.
  const waiting = result.cases.filter(
    (c) => c.status === 'needs-review' || c.status === 'source-error',
  );
  const member = (id: string): SheetCell[] => {
    const r = record.get(id)!;
    return [
      null,
      value(t.sides[r.side]),
      { minor: r.signed, decimals: result.decimals },
      value(r.reference),
    ];
  };
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
            [t.fields.account, result.scope.account],
            [t.fields.currency, result.scope.currency],
            [t.fields.start, result.scope.start],
            [t.fields.end, result.scope.end],
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
        cells: stripView(bankStrip(result), alignmentStripCopy[language], {
          reason,
        }),
        decimals: result.decimals,
      },
      {
        // What the engine left for a person, each case as the screen lists
        // it: its kind, its settlement identity and its reason, the
        // difference the engine computed, then its complete members.
        kind: 'table',
        title: t.caseStatus['needs-review'],
        evidence: 'Groups',
        head: [],
        // Each case stays on one printed page with its members.
        blocks: waiting.map((c) => 2 + c.bankIds.length + c.cashIds.length),
        rows: waiting.flatMap((c) => [
          [
            value(t.caseKinds[c.kind]),
            c.kind === 'reference' ? value(c.key) : null,
            value(reason(c.reason)),
          ],
          [
            null,
            value(t.difference),
            { minor: c.deltaMinor, decimals: result.decimals },
          ],
          ...c.bankIds.map(member),
          ...c.cashIds.map(member),
        ]),
      },
      {
        // Each recorded decision with the reference and the reason the
        // reviewer gave; what it did is said in the words the screen gives
        // the reason it leaves.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [w.decision, t.members, t.reference, t.reason],
        rows: state.events.map((event) => [
          value(reason(event.type === 'accept' ? 'human-review' : 'undone')),
          value(`${names(event.bankIds)} · ${names(event.cashIds)}`),
          value(event.reference),
          value(event.note),
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The bank movements workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the
 * sources and the decisions and found the result equal, then the
 * reconciliation sheet first.
 */
export async function exportBankWorkpaper(
  state: BankInput,
  result: BankResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportBank(state, result);
  return addReconciliationSheet(
    evidence,
    bankMovementsSheet(state, result, language),
  );
}
