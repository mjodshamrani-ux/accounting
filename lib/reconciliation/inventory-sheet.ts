import { stockStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { inventoryPdfWorkbookLabel } from '../i18n/inventory-pdf-workbook.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';
import {
  STOCK_FIELDS,
  type StockInput,
  type StockResult,
} from './inventory-register.ts';
import { exportStock } from './inventory-register-io.ts';
import { exportStockPdf } from './inventory-pdf-workbook.ts';
import {
  snapshotStockPdfRequest,
  type StockPdfExportRequest,
} from './inventory-pdf-request.ts';

// The value each one-option scope field takes in this family, which the
// scope card names in words (UX-5(d)).
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
} as const;

/**
 * The inventory sheet (UX-6(c)): what the result says on the screen, in the
 * interface's language, from the result the export has just replayed with
 * its decisions and found equal. The scope in the card's words; the four
 * sources; the strip and the result's state under it; the supplied
 * inventory attestation with the reviewer's reference and explanation; the
 * register value against the GL as the screen's table has it; each
 * account's comparison, the screen's seven columns as one block; each
 * recorded decision with its time, the reference and the explanation
 * given. Every figure is a field of that result; nothing is added or
 * subtracted here. The sources are the four files the replay read, each by
 * its name and the SHA-256 of its bytes, which the replay has checked. Each
 * section names the evidence sheet behind it as the workpaper names it:
 * the Arabic printed-register workpaper names its sheets in Arabic.
 */
export function inventorySheet(
  result: StockResult,
  sources: readonly { name: string; sha256?: string }[],
  language: 'ar' | 'en',
  named: (sheet: string) => string = (sheet) => sheet,
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.inventory;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const money = (minor: number): SheetCell => ({
    minor,
    decimals: result.decimals,
  });
  // A figure the engine does not compute, as the screen writes it.
  const figure = (minor: number | null | undefined): SheetCell =>
    minor === null || minor === undefined ? value('—') : money(minor);
  // A state in the screen's words, or the engine's code where it has none,
  // as the screen writes it.
  const status = (code: string) =>
    (t.status as Record<string, string>)[code] ?? code;
  const scopeText = (key: (typeof STOCK_FIELDS)[number]) => {
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
        evidence: named('Summary'),
        rows: STOCK_FIELDS.map((key, i) => ({
          label: t.scope[i],
          value: value(scopeText(key)),
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: named('Sources'),
        sources: sources.map((s, i) => ({
          role: t.roles[i],
          name: s.name,
          hash: s.sha256!,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(stockStrip(result), alignmentStripCopy[language], {
          state: status(result.status),
        }),
        decimals: result.decimals,
        // The result's state, as the screen's heading over the strip writes
        // it: the strip counts accounts, and says it only when none is
        // compared.
        more: [
          {
            label: alignmentStripCopy[language].state,
            value: status(result.status),
          },
        ],
      },
      {
        // The reviewer's attestation that the supplied inventory is
        // complete, which an approval needs; written once given.
        kind: 'pairs',
        title: t.completenessTitle,
        evidence: named('Summary'),
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
        // The screen's table: its two headings and its one row; none when
        // a source holds an error.
        kind: 'table',
        title: t.tableNames.totals,
        evidence: named('Summary'),
        head: t.totals,
        rows: result.totals
          ? [[money(result.totals.registerMinor), money(result.totals.glMinor)]]
          : [],
      },
      {
        // Each account as the screen's row has it: the account and its
        // complete dimensions, then its five figures each by the screen's
        // heading, one block; "—" where the engine computes no figure.
        kind: 'table',
        title: t.tableNames.comparisons,
        evidence: named('Account comparisons'),
        head: [],
        blocks: result.comparisons.map(() => 6),
        rows: result.comparisons.flatMap((c) => [
          [value(c.account), value(c.dimensions || '—')],
          [{ text: t.comparisons[2], style: 'label' }, figure(c.registerMinor)],
          [{ text: t.comparisons[3], style: 'label' }, figure(c.debitMinor)],
          [{ text: t.comparisons[4], style: 'label' }, figure(c.creditMinor)],
          [{ text: t.comparisons[5], style: 'label' }, figure(c.glMinor)],
          [
            { text: t.comparisons[6], style: 'label' },
            figure(c.differenceMinor),
          ],
        ]),
      },
      {
        // Each recorded decision as its button names it, with its time,
        // then the reference and the explanation given.
        kind: 'table',
        title: w.decisions,
        evidence: named('Events'),
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t[e.type]), value(e.at)],
          [null, value(e.reference), value(e.note)],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: named('Summary') },
    ],
  });
}

// The four files by name and SHA-256, owned before the first await, as the
// replay owns them.
const ownSources = (files: readonly { name: string; sha256?: string }[]) =>
  files.map((f) => ({ name: f.name, sha256: f.sha256 }));

/**
 * The inventory workpaper as the worker hands it to the page: the evidence
 * as the existing export writes it, after it has replayed the four
 * originals with the decisions and found the result equal, then the
 * reconciliation sheet first. The language is refused before any work.
 */
export async function exportStockWorkpaper(
  state: StockInput,
  result: StockResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const sources = ownSources(state.files),
    owned = structuredClone(result);
  const evidence = await exportStock(state, result);
  return addReconciliationSheet(
    evidence,
    inventorySheet(owned, sources, language),
  );
}

/**
 * The same for the printed register: the PDF evidence workbook as its
 * export writes it, in the language its request names, then the sheet in
 * that language, naming the evidence sheets as that workbook does. A
 * request without one is refused before any work.
 */
export async function exportStockPdfWorkpaper(
  payload: StockPdfExportRequest,
): Promise<ArrayBuffer> {
  const captured = snapshotStockPdfRequest(
    'stock-pdf-export',
    payload,
  ) as StockPdfExportRequest;
  const language = sheetLanguage(captured.language);
  // The rule the evidence writer names its sheets by.
  const arabic = language === 'ar' && !!captured.result.pdfEvidence;
  const evidence = await exportStockPdf(captured);
  return addReconciliationSheet(
    evidence,
    inventorySheet(
      captured.result,
      ownSources(captured.state.files),
      language,
      arabic ? inventoryPdfWorkbookLabel : undefined,
    ),
  );
}
