import { financialStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';
import {
  FINANCIAL_SCOPE_FIELDS,
  type FinancialInput,
  type FinancialResult,
} from './tb-financial.ts';
import { exportFinancialPosition } from './tb-financial-io.ts';

// The value each one-option scope field takes in this family, which the
// scope card names in words (UX-5(d)).
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
  closingBasis: 'post-closing',
} as const;

/**
 * The trial balance and financial position sheet (UX-6(c)): what the result
 * says on the screen, in the interface's language, from the result the
 * export has just replayed with its decisions and found equal. The scope in
 * the card's words; the four sources; the strip; the completeness
 * attestation with the reviewer's reference and reason; the trial balance's
 * three figures; the financial position by basis; each statement line with
 * its class, its state and the difference the engine computed; each
 * recorded decision with the line, its time, the evidence reference and the
 * reason given. Every figure is a field of that result; nothing is added or
 * subtracted here.
 */
export function financialSheet(
  result: FinancialResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.financial;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const money = (minor: number): SheetCell => ({
    minor,
    decimals: result.decimals,
  });
  // A difference the engine does not compute, as the screen's amount writes
  // it.
  const difference = (minor: number | null): SheetCell =>
    minor === null ? value('—') : money(minor);
  const scopeText = (key: (typeof FINANCIAL_SCOPE_FIELDS)[number]) => {
    const v = result.scope[key];
    return key in ONLY && v === ONLY[key as keyof typeof ONLY]
      ? t.only[key as keyof typeof ONLY]
      : v;
  };
  const position = result.grandTotals;
  // The position by basis, a row for each figure.
  const figures = position
    ? (
        [
          ['assets', t.assets],
          ['liabilities', t.liabilities],
          ['equity', t.equity],
          ['equation', t.positionEquation],
        ] as const
      ).map(([key, label]): SheetCell[] => [
        { text: label, style: 'label' },
        money(position.calculated[key]),
        money(position.reported[key]),
      ])
    : [];
  return composeSheet(language, {
    title: t.trialBalanceAndFinancialPosition,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: FINANCIAL_SCOPE_FIELDS.map((key, i) => ({
          label: t.scope[i],
          value: value(scopeText(key)),
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Sources',
        sources: result.sources.map((s, i) => ({
          role: t.roles[i],
          name: s.name,
          hash: s.hash,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(financialStrip(result), alignmentStripCopy[language], {
          state: t.status[result.status],
        }),
        decimals: result.decimals,
      },
      {
        // The reviewer's attestation that the supplied inventory is
        // complete, which every accepted line needs; written once given.
        kind: 'pairs',
        title: t.suppliedInventoryAttestation,
        evidence: 'Summary',
        rows: result.completeness.confirmed
          ? [
              {
                label: t.attestationReference,
                value: value(result.completeness.reference),
              },
              {
                label: t.attestationReason,
                value: value(result.completeness.note),
              },
            ]
          : [],
      },
      {
        kind: 'pairs',
        title: t.roles[0],
        evidence: 'Summary',
        rows: result.tb
          ? [result.tb.debit, result.tb.credit, result.tb.residual].map(
              (minor, i) => ({
                label: t.trialBalanceFigures[i],
                value: money(minor),
              }),
            )
          : [],
      },
      {
        // The screen's table by basis, turned so that each figure has a row
        // of its own in four columns; its figures print on one page.
        kind: 'table',
        title: t.tableNames.position,
        evidence: 'Grand totals',
        head: [t.basis, t.lineFigures[0], t.lineFigures[1]],
        ...(figures.length ? { blocks: [figures.length] } : {}),
        rows: figures,
      },
      {
        // Each statement line by its number, as the decisions and the
        // evidence name it, with its class, its state and the difference.
        kind: 'table',
        title: t.statementLines,
        evidence: 'Lines',
        head: [t.line, t.class, t.state, t.lineFigures[2]],
        rows: result.lines.map((l) => [
          value(l.lineId),
          value(t.categories[l.category]),
          value(t.status[l.review]),
          difference(l.difference),
        ]),
      },
      {
        // Each recorded decision as its button names it, with the line and
        // its time, then the evidence reference and the reason given.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t.decisionLabels[e.type]), value(e.lineId), value(e.at)],
          [null, value(e.reference), value(e.note)],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The financial position workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the four
 * originals with the decisions and found the result equal, then the
 * reconciliation sheet first. The language is refused before any work.
 */
export async function exportFinancialWorkpaper(
  state: FinancialInput,
  result: FinancialResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportFinancialPosition(state, result);
  return addReconciliationSheet(evidence, financialSheet(result, language));
}
