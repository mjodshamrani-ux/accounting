import { assetCSV } from './fixed-assets-csv.ts';
import { validateCellText } from './io.ts';
import {
  FA_SECTIONS_ROLES,
  assetSectionsPlaces,
  refuseAssetSections,
  reviewAssetSections,
  type AssetSectionsInput,
} from './fixed-assets-sections.ts';
import type { SourceFile } from './types.ts';

export type AssetSectionsSnapshot = {
  name: string;
  sha256: string;
  original: ArrayBuffer;
};
export type AssetSectionsReplayInput = Omit<AssetSectionsInput, 'files'> & {
  files: AssetSectionsSnapshot[];
};

const hex = async (bytes: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');

const CAPACITY_ERRORS = new Set([
  'ASSET_SOURCE_LIMIT',
  'ASSET_CELL_LIMIT',
  'ASSET_SOURCE_CAPACITY',
]);

/** The contract code for an error assetCSV threw on these bytes. Its own
 * errors are named. The decoder's and the code point check's are not, so the
 * bytes are checked again for those two causes. Any other error is a defect,
 * not a refusal of the file: it is thrown on, never read as SOURCE. */
export function assetSectionsReadCode(
  error: unknown,
  original: ArrayBuffer,
): 'SOURCE' | 'CAPACITY' {
  const message = error instanceof Error ? error.message : '';
  if (CAPACITY_ERRORS.has(message)) return 'CAPACITY';
  if (message === 'ASSET_CSV') return 'SOURCE';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(original);
  } catch {
    return 'SOURCE';
  }
  try {
    validateCellText(text);
  } catch {
    return 'SOURCE';
  }
  throw error;
}

/** The family reads CSV as the long asset family does (assetCSV): strict
 * UTF-8 whose decoder drops one leading byte order mark, the XML-forbidden
 * code points refused, comma cells with quotes only at a cell's start, a
 * blank line a record of no cells. An empty file or one it cannot decode,
 * a stray or unclosed quote, or a forbidden code point is SOURCE; more than
 * 8 MiB, 20,001 records, 100 cells in a record or 32,767 code units in a
 * cell is CAPACITY. Anything else the reader throws is thrown on. */
export function assetSectionsCSV(original: ArrayBuffer): string[][] {
  if (!original.byteLength) refuseAssetSections('SOURCE');
  try {
    return assetCSV(original);
  } catch (error) {
    return refuseAssetSections(assetSectionsReadCode(error, original));
  }
}

export async function readAssetSectionsFile(
  name: string,
  original: ArrayBuffer,
): Promise<SourceFile> {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 255 ||
    !/\.csv$/i.test(name) ||
    !(original instanceof ArrayBuffer)
  )
    refuseAssetSections('SOURCE');
  const snapshot = original.slice(0);
  const rows = assetSectionsCSV(snapshot);
  return {
    name,
    original: snapshot,
    sha256: await hex(snapshot),
    sheets: [{ name: 'CSV', rows, formulaRows: [], hiddenRows: [] }],
  };
}

/** Re-read every file from its bytes in role order and review them: READING
 * and SCOPE first, then each file (SOURCE, CAPACITY, and SOURCE_HASH when its
 * bytes are not the hash it came with), then the review. */
export async function replayAssetSections(input: AssetSectionsReplayInput) {
  const snapshot = {
    files: Array.isArray(input?.files)
      ? input.files.map((f) => ({
          name: f?.name,
          sha256: f?.sha256,
          original:
            f?.original instanceof ArrayBuffer ? f.original.slice(0) : null,
        }))
      : null,
    readings: structuredClone(input?.readings),
    scope: structuredClone(input?.scope),
  };
  assetSectionsPlaces(snapshot.readings, snapshot.scope);
  if (!snapshot.files || snapshot.files.length !== FA_SECTIONS_ROLES.length)
    refuseAssetSections('SOURCE');
  const files: SourceFile[] = [];
  for (const f of snapshot.files) {
    if (!f.original) refuseAssetSections('SOURCE');
    const file = await readAssetSectionsFile(f.name as string, f.original);
    if (file.sha256 !== f.sha256) refuseAssetSections('SOURCE_HASH');
    files.push(file);
  }
  const state: AssetSectionsInput = {
    files,
    readings: snapshot.readings,
    scope: snapshot.scope,
  };
  return { state, result: reviewAssetSections(state) };
}
