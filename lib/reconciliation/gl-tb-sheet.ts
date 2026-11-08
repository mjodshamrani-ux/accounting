import { glTbStrip } from '../alignment-strip.ts';
import { stripView } from '../alignment-strip-view.ts';
import { alignmentStripCopy } from '../i18n/alignment-strip.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import {
  BALANCE_FIELDS,
  GL_SCOPE_FIELDS,
  type GlTbInput,
  type GlTbResult,
} from './gl-tb.ts';
import { exportGlTb } from './gl-tb-io.ts';
import {
  addReconciliationSheet,
  composeSheet,
  sheetLanguage,
  type ReconciliationSheet,
  type SheetCell,
} from './reconciliation-sheet.ts';

/**
 * The GL/TB reconciliation sheet (UX-6(a)): what the result says on the
 * screen, in the interface's language, from the result the export has just
 * replayed and found equal. Every figure is a field of that result; nothing
 * is added or subtracted here.
 */
export function glTbSheet(
  result: GlTbResult,
  language: 'ar' | 'en',
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)],
    t = w.glTb;
  // The two fixed scope values as the scope card names them.
  const scopeText = (key: (typeof GL_SCOPE_FIELDS)[number]) => {
    const value = result.scope[key];
    return key === 'currencyBasis' && value === 'functional'
      ? t.functionalLabel
      : key === 'postingStatus' && value === 'posted'
        ? t.postedLabel
        : value;
  };
  const amount = (minor: number | null | undefined): SheetCell =>
    minor === null || minor === undefined
      ? { text: t.missing, style: 'value' }
      : { minor, decimals: result.decimals };
  return composeSheet(language, {
    title: t.title,
    sections: [
      {
        kind: 'pairs',
        title: w.scope,
        evidence: 'Summary',
        rows: GL_SCOPE_FIELDS.map((key) => ({
          label: t.fields[key],
          value: { text: scopeText(key), style: 'value' },
        })),
      },
      {
        kind: 'sources',
        title: w.sources,
        evidence: 'Sources',
        sources: result.sources.map((s, side) => ({
          role: t.sides[side as 0 | 1],
          name: s.name,
          hash: s.hash,
        })),
      },
      {
        kind: 'strip',
        title: w.alignment,
        cells: stripView(glTbStrip(result), alignmentStripCopy[language], {
          name: (key) => t.components[key as keyof typeof t.components] ?? key,
          state: t.status[result.status],
        }),
        decimals: result.decimals,
        more: result.missing.map((k, i) => ({
          label: i ? '' : t.missing,
          value: t.missingLabels[k],
        })),
      },
      {
        kind: 'table',
        title: t.balances,
        evidence: 'Balances',
        head: [t.component, t.gl, t.tb, t.difference],
        rows: BALANCE_FIELDS.map((f) => [
          { text: t.components[f], style: 'label' },
          amount(result.gl?.[f]),
          amount(result.tb?.[f]),
          amount(result.differences?.[f]),
        ]),
      },
      { kind: 'signature' },
      { kind: 'claim', text: t.claim, evidence: 'Summary' },
    ],
  });
}

/**
 * The GL/TB workpaper as the worker hands it to the page: the evidence as
 * the existing export writes it, after it has replayed the sources and found
 * the result equal, then the reconciliation sheet first. The language is
 * checked before any work is done.
 */
export async function exportGlTbWorkpaper(
  state: GlTbInput,
  result: GlTbResult,
  lang: unknown,
): Promise<ArrayBuffer> {
  const language = sheetLanguage(lang);
  const evidence = await exportGlTb(state, result);
  return addReconciliationSheet(evidence, glTbSheet(result, language));
}
