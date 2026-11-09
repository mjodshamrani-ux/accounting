import { assetStrip } from '../alignment-strip.ts';
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
  ASSET_COMPONENTS,
  ASSET_FIELDS,
  type AssetInput,
  type AssetResult,
} from './fixed-assets.ts';
import { exportAsset } from './fixed-assets-io.ts';

// The value each one-option scope field takes in this family, which the
// scope card names in words (UX-5(d)).
const ONLY = {
  currencyBasis: 'functional',
  postingStatus: 'posted',
} as const;

/**
 * The fixed-assets sheet (UX-6(c)): what the result says on the screen, in
 * the interface's language, from the result the export has just replayed
 * with its decisions and found equal. The scope in the card's words; the
 * four sources; the strip and the result's state under it; the supplied
 * asset attestation with the reviewer's reference and explanation; the
 * component totals as the screen's table has them; each comparison by
 * account and component, the screen's six columns as one block; each
 * recorded decision with its time, the reference and the explanation given.
 * Every figure is a field of that result; nothing is added or subtracted
 * here. The sources are the four files the replay read, each by its name and
 * the SHA-256 of its bytes, which the replay has checked.
 */
export function fixedAssetsSheet(
  result: AssetResult,
  sources: readonly { name: string; sha256?: string }[],
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.fixedAssets;
  const value = (text: string): SheetCell => ({ text, style: 'value' });
  const label = (text: string): SheetCell => ({ text, style: 'label' });
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
  // A component in the screen's word, or its key where it has none, as the
  // strip on the screen names it.
  const component = (key: string) =>
    (t.components as Record<string, string>)[key] ?? key;
  const scopeText = (key: (typeof ASSET_FIELDS)[number]) => {
    const v = result.scope[key];
    return key in ONLY && v === ONLY[key as keyof typeof ONLY]
      ? t.only[key as keyof typeof ONLY]
      : v;
  };
  const totals = result.totals;
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: ASSET_FIELDS.map((key, i) => ({
          label: t.scope[i],
          value: value(scopeText(key)),
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Sources',
        sources: sources.map((s, i) => ({
          role: t.roles[i],
          name: s.name,
          hash: s.sha256!,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(assetStrip(result), alignmentStripCopy[language], {
          name: component,
          state: status(result.status),
        }),
        decimals: result.decimals,
        // The result's state, as the screen's heading over the strip writes
        // it: the strip counts comparisons, and says it only when none has
        // a difference computed.
        more: [
          {
            label: alignmentStripCopy[language].state,
            value: status(result.status),
          },
        ],
      },
      {
        // The reviewer's attestation that the supplied assets are complete,
        // which an approval needs; written once given.
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
        // The screen's table: its three headings and its four rows, one
        // block; none when a source holds an error.
        kind: 'table',
        title: t.tableNames.totals,
        evidence: 'Summary',
        head: t.totals,
        blocks: totals ? [4] : [],
        rows: totals
          ? [...ASSET_COMPONENTS, 'carrying' as const].map((k) => [
              value(t.components[k]),
              money(totals.register[k]),
              money(totals.gl[k]),
            ])
          : [],
      },
      {
        // Each comparison as the screen's row has it: the account and its
        // complete dimensions, then its component in the screen's word, then
        // its three figures each by the screen's heading, one block; "—"
        // where the engine computes no figure.
        kind: 'table',
        title: t.tableNames.comparisons,
        evidence: 'Component comparisons',
        head: [],
        blocks: result.comparisons.map(() => 5),
        rows: result.comparisons.flatMap((c) => [
          [value(c.account), value(c.dimensions || '—')],
          [label(t.comparisons[2]), value(component(c.component))],
          [label(t.comparisons[3]), figure(c.register)],
          [label(t.comparisons[4]), figure(c.gl)],
          [label(t.comparisons[5]), figure(c.difference)],
        ]),
      },
      {
        // Each recorded decision as its button names it, with its time,
        // then the reference and the explanation given.
        kind: 'table',
        title: w.decisions,
        evidence: 'Events',
        head: [],
        blocks: result.events.map(() => 2),
        rows: result.events.flatMap((e) => [
          [value(t[e.type]), value(e.at)],
          [null, value(e.reference), value(e.note)],
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

// The four files by name and SHA-256, owned before the first await, as the
// replay owns them.
const ownSources = (files: readonly { name: string; sha256?: string }[]) =>
  files.map((f) => ({ name: f.name, sha256: f.sha256 }));

/**
 * The fixed-assets workpaper as the worker hands it to the page: the
 * evidence as the existing export writes it, after it has replayed the four
 * originals with the decisions and found the result equal, then the
 * reconciliation sheet first. The language is refused before any work.
 */
export async function exportAssetWorkpaper(
  state: AssetInput,
  result: AssetResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const sources = ownSources(state.files),
    owned = structuredClone(result);
  const evidence = await exportAsset(state, result);
  return addReconciliationSheet(
    evidence,
    fixedAssetsSheet(owned, sources, language),
  );
}
