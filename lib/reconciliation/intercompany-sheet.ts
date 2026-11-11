import { intercompanyStrip } from '../alignment-strip.ts';
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
  IC_SCOPE_FIELDS,
  type IntercompanyInput,
  type IntercompanyResult,
} from './intercompany.ts';
import { exportIntercompany } from './intercompany-io.ts';

// The value each one-option scope field takes in this family, which the
// scope card names in words (UX-5(d)).
const ONLY = {
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
} as const;

/**
 * The intercompany sheet (UX-6(c)): what the result says on the screen, in
 * the interface's language, from the result the export has just replayed
 * with its decisions and found equal. The scope in the card's words; the
 * four sources; the strip; the supplied inventory attestation with the
 * reviewer's reference and explanation; debit, credit and net by side; each
 * counterpart pair as the screen draws it, its relation, state and review,
 * then its two nets and the residual; each recorded decision with the
 * relation, its time, the reference and the explanation given. Every figure
 * is a field of that result; nothing is added or subtracted here.
 */
export function intercompanySheet(
  result: IntercompanyResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.intercompany;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const money = (minor: number): SheetCell => ({
    minor,
    decimals: result.decimals,
  });
  // A figure the engine does not compute, as the screen's amount writes it.
  const figure = (minor: number | null | undefined): SheetCell =>
    minor === null || minor === undefined ? value('—') : money(minor);
  // A state in the screen's words, or the engine's code where it has none,
  // as the screen writes it.
  const status = (code: string) =>
    (t.status as Record<string, string>)[code] ?? code;
  const scopeText = (key: (typeof IC_SCOPE_FIELDS)[number]) => {
    const v = result.scope[key];
    return key in ONLY && v === ONLY[key as keyof typeof ONLY]
      ? t.only[key as keyof typeof ONLY]
      : v;
  };
  // Debit, credit and net by side, as the screen's table has them.
  const sides = (result.totals ?? []).map((s, i): SheetCell[] => [
    { text: t.roles[i], style: 'label' },
    money(s.debit),
    money(s.credit),
    money(s.net),
  ]);
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: IC_SCOPE_FIELDS.map((key, i) => ({
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
        cells: stripView(
          intercompanyStrip(result),
          alignmentStripCopy[language],
          { reason: status, state: status(result.status) },
        ),
        decimals: result.decimals,
        // The result's state, as the screen's heading over the strip writes
        // it: the strip counts pairs, and evidence missing outside every pair
        // is said by the state alone.
        more: [
          {
            label: alignmentStripCopy[language].state,
            value: status(result.status),
          },
        ],
      },
      {
        // The reviewer's attestation that the supplied inventory is
        // complete, which every approved pair needs; written once given.
        kind: 'pairs',
        title: t.completenessTitle,
        evidence: 'Summary',
        rows: result.completeness.confirmed
          ? [
              {
                label: t.completeReference,
                value: value(result.completeness.reference),
              },
              {
                label: t.completeNote,
                value: value(result.completeness.note),
              },
            ]
          : [],
      },
      {
        // The screen's table, its two sides printed on one page.
        kind: 'table',
        title: t.tableNames.totals,
        evidence: 'Totals',
        head: t.totals,
        ...(sides.length ? { blocks: [sides.length] } : {}),
        rows: sides,
      },
      {
        // Each counterpart pair as the screen draws it: its heading's
        // relation, state and review, then its figures, each by its word.
        kind: 'table',
        title: t.pairs,
        evidence: 'Pairs',
        head: [],
        blocks: result.pairs.map(() => 4),
        rows: result.pairs.flatMap((p) => [
          [
            value(p.relationId),
            value(status(p.status)),
            value(status(p.review)),
          ],
          [null, value(t.residualFigures[0]), figure(p.left?.net)],
          [null, value(t.residualFigures[1]), figure(p.right?.net)],
          [null, value(t.residualFigures[2]), figure(p.residual)],
        ]),
      },
      {
        // Each recorded decision as its button names it, with the relation
        // and its time, then the reference and the explanation given.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t[e.type]), value(e.relationId), value(e.at)],
          [null, value(e.reference), value(e.note)],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The intercompany workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the four
 * originals with the decisions and found the result equal, then the
 * reconciliation sheet first. The language is refused before any work.
 */
export async function exportIntercompanyWorkpaper(
  state: IntercompanyInput,
  result: IntercompanyResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportIntercompany(state, result);
  return addReconciliationSheet(evidence, intercompanySheet(result, language));
}
