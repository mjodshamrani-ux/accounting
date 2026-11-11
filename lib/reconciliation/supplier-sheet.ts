import { supplierStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import { exportWorkbook } from './io.ts';
import { readingStatus } from './reading-issues.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';
import type {
  Comparison,
  ReconciliationCase,
  SourceFile,
  Transaction,
} from './types.ts';

type Review = Parameters<typeof exportWorkbook>[2];

/**
 * The supplier reconciliation sheet (UX-6(b)): what the result says on the
 * screen, in the interface's language, from the result the export has just
 * recomputed from the original sources and found equal, and the decisions
 * recorded with their reasons. Each case the review tab lists is written as
 * the results table writes it: its state in the table's word, then each of
 * its members with its side, its signed amount and its reference; each case
 * the unmatched tab lists is one row, as the table writes it. Every figure is
 * a field of that result or a count of its items; nothing is added or
 * subtracted here.
 */
export function supplierSheet(
  result: Comparison,
  files: readonly SourceFile[],
  review: Review,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.supplier,
    b = t.balances;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const decimals = result.scope.decimals;
  const amount = (minor: number, start?: true): SheetCell => ({
    minor,
    decimals,
    ...(start ? { start } : {}),
  });
  const s = result.supplier,
    l = result.ledger;
  const reading = readingStatus([s, l]);
  const transaction = new Map(
    [...s.transactions, ...l.transactions].map((tx) => [tx.id, tx]),
  );
  // A transaction named as the results table names it: by its reference.
  const reference = (tx: Transaction) => tx.reference || t.noReference;
  // A case's state in the word the results table gives it.
  const state = (c: ReconciliationCase) =>
    t.status[
      c.classification === 'AMOUNT_VARIANCE'
        ? 'amountVariance'
        : c.classification === 'PAYMENT_CANDIDATE'
          ? 'paymentCandidate'
          : c.status === 'Rejected'
            ? 'rejected'
            : c.status === 'Needs Review'
              ? 'needsReview'
              : 'unmatched'
    ];
  // What the review tab lists, as the evidence's Needs Review sheet does.
  const waiting = result.cases.filter(
    (c) => c.status === 'Needs Review' || c.status === 'Rejected',
  );
  const unmatched = result.cases.filter((c) => c.status === 'Unmatched');
  // The scope as the evidence's Summary writes it; a field it leaves empty
  // is not written.
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(result.scope.cutoff)
    ? result.scope.cutoff
    : '';
  const scope = (
    [
      [
        t.fields.supplier,
        result.scope.supplier ||
          s.metadata?.supplierName ||
          l.metadata?.supplierName ||
          '',
      ],
      [
        t.fields.entity,
        result.scope.entity ||
          s.metadata?.entityName ||
          l.metadata?.entityName ||
          '',
      ],
      [
        t.fields.account,
        l.metadata?.apControlAccount ||
          s.metadata?.apControlAccount ||
          result.scope.account,
      ],
      [t.fields.currency, result.scope.currency],
      [t.fields.cutoff, cutoff],
    ] as const
  ).filter(([, text]) => text);
  const balance = (minor: number | null): SheetCell =>
    minor === null ? value(b.notAvailable) : amount(minor, true);
  const bridge = result.bridge;
  // A decision is said in the word the screen gives the state it leaves.
  const decided = {
    link: t.status.manual,
    unlink: t.status.rejected,
    review: t.reviewedStillOpen,
  } as const;
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: scope.map(([label, text]) => ({ label, value: value(text) })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Export Metadata',
        sources: [0, 1].map((side) => ({
          role: t.sides[side],
          name: files[side].name,
          hash: files[side].sha256 ?? t.noOriginal,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(supplierStrip(result), alignmentStripCopy[language]),
        decimals,
      },
      {
        // The balances as the workpaper step writes them, where it does.
        kind: 'pairs',
        title: b.heading,
        evidence: 'Reconciliation Bridge',
        rows:
          result.scope.coverageConfirmed || bridge
            ? [
                { label: b.supplierBalance, value: balance(s.closing) },
                { label: b.ledgerBalance, value: balance(l.closing) },
                {
                  label: b.balanceCheck,
                  value: value(
                    bridge
                      ? result.balanceComparable
                        ? b.consistentConfirmed
                        : b.consistentUnconfirmed
                      : b.notProven,
                  ),
                },
                ...(bridge
                  ? [
                      {
                        label: b.openingAdjustment,
                        value: amount(bridge.openingAdjustment, true),
                      },
                      {
                        label: b.itemAdjustment,
                        value: amount(bridge.itemAdjustment, true),
                      },
                      {
                        label: b.adjusted,
                        value: amount(bridge.adjusted, true),
                      },
                      {
                        label: b.residual,
                        value: amount(bridge.residual, true),
                      },
                    ]
                  : []),
              ]
            : [],
      },
      {
        // What the review tab lists, each case with its members.
        kind: 'table',
        title: t.status.needsReview,
        evidence: 'Needs Review',
        head: [],
        // Each case stays on one printed page with its members.
        blocks: waiting.map(
          (c) => c.supplierMembers.length + c.ledgerMembers.length,
        ),
        rows: waiting.flatMap((c) =>
          [...c.supplierMembers, ...c.ledgerMembers].map(
            (tx, i): SheetCell[] => [
              i ? null : value(state(c)),
              value(t.sideShort[tx.side]),
              amount(tx.amount),
              value(reference(tx)),
            ],
          ),
        ),
      },
      {
        // What the unmatched tab lists, one row a case, as the table writes
        // it: its first member, with the case's amount.
        kind: 'table',
        title: t.unmatched,
        evidence: 'Unmatched',
        head: [],
        rows: unmatched.map((c) => {
          const tx = c.supplierMembers[0] ?? c.ledgerMembers[0];
          return [
            value(tx.date),
            value(t.sideShort[tx.side]),
            amount(c.supplierMembers.length ? c.supplierTotal : c.ledgerTotal),
            value(reference(tx)),
          ];
        }),
      },
      {
        // Each recorded decision, its members by their references and the
        // reason the reviewer gave; running the comparison is not one.
        kind: 'table',
        title: w.decisions,
        evidence: 'Review History',
        head: [w.decision, t.reference, t.reason],
        rows: (review.events ?? []).flatMap((event) =>
          event.action === 'compare'
            ? []
            : [
                [
                  value(decided[event.action]),
                  value(
                    event.ids
                      .map((id) => {
                        const tx = transaction.get(id);
                        return tx ? reference(tx) : id;
                      })
                      .join(' · '),
                  ),
                  value(event.note),
                ],
              ],
        ),
      },
      { kind: 'signature' },
      {
        kind: 'claim',
        text: reading.partial ? t.claim.partial : t.claim.verified,
        evidence: 'Summary',
      },
    ],
  });
}

/**
 * The supplier workpaper as the worker hands it to the page: the evidence as
 * the existing export writes it, after it has re-read both originals,
 * recomputed the comparison and found the result equal, then the
 * reconciliation sheet first. The language is refused before anything else.
 */
export async function exportSupplierWorkpaper(
  result: Comparison,
  files: [SourceFile, SourceFile],
  review: Review,
  lang: unknown,
  observeStage?: (stage: string, milliseconds: number) => void,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportWorkbook(result, files, review, observeStage);
  return addReconciliationSheet(
    evidence,
    supplierSheet(result, files, review, language),
  );
}
