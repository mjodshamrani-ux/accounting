import { gatewayStrip } from '../alignment-strip.ts';
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
  PG_SCOPE_FIELDS,
  type GatewayInput,
  type GatewayResult,
} from './payment-gateway.ts';
import { exportGateway } from './payment-gateway-io.ts';

// The value each one-option scope field takes in this family, which the
// scope card names in words (UX-5(d)).
const ONLY = {
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
} as const;

/**
 * The payment gateway sheet (UX-6(c)): what the result says on the screen,
 * in the interface's language, from the result the export has just replayed
 * with its decisions and found equal. The scope in the card's words; the
 * four sources; the strip and the result's state under it; the supplied
 * batch inventory attestation with the reviewer's reference and
 * explanation; the calculated totals as the screen's table has them; the
 * five residuals, each by its word; each recorded decision with the batch,
 * its time, the reference and the explanation given. Every figure is a
 * field of that result; nothing is added or subtracted here.
 */
export function gatewaySheet(
  result: GatewayResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.gateway;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const money = (minor: number): SheetCell => ({
    minor,
    decimals: result.decimals,
  });
  // A state in the screen's words, or the engine's code where it has none,
  // as the screen writes it.
  const status = (code: string) =>
    (t.status as Record<string, string>)[code] ?? code;
  const scopeText = (key: (typeof PG_SCOPE_FIELDS)[number]) => {
    const v = result.scope[key];
    return key in ONLY && v === ONLY[key as keyof typeof ONLY]
      ? t.only[key as keyof typeof ONLY]
      : v;
  };
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: PG_SCOPE_FIELDS.map((key, i) => ({
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
        cells: stripView(gatewayStrip(result), alignmentStripCopy[language], {
          state: status(result.status),
        }),
        decimals: result.decimals,
        // The result's state, as the screen's heading over the strip writes
        // it: the strip counts residuals, and says it only when none is
        // computed.
        more: [
          {
            label: alignmentStripCopy[language].state,
            value: status(result.status),
          },
        ],
      },
      {
        // The reviewer's attestation that the supplied batch inventory is
        // complete, which an approval needs; written once given.
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
        // The screen's table: its four headings and its one row, printed on
        // one page; none when a source holds an error.
        kind: 'table',
        title: t.tableNames.totals,
        evidence: 'Totals',
        head: t.totals,
        rows: result.totals ? [result.totals.map(money)] : [],
      },
      {
        // The five residuals, each by its word on the screen; the strip
        // writes the first alone. The screen's table has five columns, so
        // each residual has a row of its own.
        kind: 'pairs',
        title: t.tableNames.residuals,
        evidence: 'Residuals',
        rows: (result.residuals ?? []).map((minor, i) => ({
          label: t.residuals[i],
          value: money(minor),
        })),
      },
      {
        // Each recorded decision as its button names it, with the batch and
        // its time, then the reference and the explanation given.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t[e.type]), value(e.batchId), value(e.at)],
          [null, value(e.reference), value(e.note)],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The payment gateway workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the four
 * originals with the decisions and found the result equal, then the
 * reconciliation sheet first. The language is refused before any work.
 */
export async function exportGatewayWorkpaper(
  state: GatewayInput,
  result: GatewayResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportGateway(state, result);
  return addReconciliationSheet(evidence, gatewaySheet(result, language));
}
