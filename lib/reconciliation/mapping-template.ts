import { MAX_ROWS, MAX_SHEETS } from './types.ts';
import type { Mapping } from './types.ts';

const columns = [
  'sheet',
  'header',
  'date',
  'reference',
  'description',
  'amount',
  'debit',
  'credit',
  'currencyColumn',
] as const;
type ColumnLayout = Pick<Mapping, (typeof columns)[number] | 'mode'>;
export type MappingTemplate = {
  format: 'tarasuf-column-template';
  version: 2;
  columns: ColumnLayout;
};

/** Templates carry positions only. Dates, signs, balances and source proofs
 * belong to the current document and must never be inherited from another. */
export function mappingTemplate(value: unknown): MappingTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.format !== undefined && input.format !== 'tarasuf-column-template')
    return null;
  const source =
    input.format === 'tarasuf-column-template'
      ? input.version === 2
        ? input.columns
        : undefined
      : input;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return null;
  const fields = source as Record<string, unknown>;
  if (fields.mode !== 'signed' && fields.mode !== 'split') return null;
  const layout: Record<string, unknown> = { mode: fields.mode };
  for (const key of columns) {
    const value = fields[key];
    const minimum = key === 'sheet' || key === 'header' ? 0 : -1;
    const maximum =
      key === 'sheet' ? MAX_SHEETS - 1 : key === 'header' ? MAX_ROWS + 29 : 99;
    if (
      !Number.isInteger(value) ||
      (value as number) < minimum ||
      (value as number) > maximum
    )
      return null;
    layout[key] = value;
  }
  return {
    format: 'tarasuf-column-template',
    version: 2,
    columns: layout as ColumnLayout,
  };
}

export function readMappingTemplate(
  raw: string | null,
): MappingTemplate | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    return mappingTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Only extraction positions are restored. Existing source-specific approvals
 * are invalidated; the UI re-infers formats/sign evidence from the current file. */
export function templatePatch(template: MappingTemplate): Partial<Mapping> {
  const checked = mappingTemplate(template);
  if (!checked) throw new Error('قالب الأعمدة غير صالح');
  return {
    ...checked.columns,
    directionEvidence: undefined,
    opening: '',
    closing: '',
    periodStart: '',
    excluded: {},
    pdfReviewed: false,
    // A choice answers one document's ambiguity. A template carries positions
    // between documents, so it must never carry that answer with them.
    formatChoice: undefined,
  };
}

type TemplateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function migrateMappingTemplates(storage: TemplateStorage): void {
  for (const side of [0, 1]) {
    const key = `mizan.mapping.${side}.v1`;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const safe = readMappingTemplate(raw);
    if (!safe) storage.removeItem(key);
    else if (raw !== JSON.stringify(safe))
      storage.setItem(key, JSON.stringify(safe));
  }
}
