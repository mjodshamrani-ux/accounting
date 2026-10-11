import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assetCSV } from '../../lib/reconciliation/fixed-assets-csv.ts';
import {
  ASSET_ROLES,
  ASSET_VERSION,
  ASSET_LONG_FAMILY,
  type AssetInput,
} from '../../lib/reconciliation/fixed-assets.ts';
export const assetLongRoot = new URL(
  '../../audit/fixed-assets-long/',
  import.meta.url,
);
export const assetLongHash = (b: Uint8Array) =>
  createHash('sha256').update(b).digest('hex');
export function assetLongSource(name: string, original: ArrayBuffer) {
  return {
    name,
    original,
    sha256: assetLongHash(new Uint8Array(original)),
    sheets: [
      {
        name: 'CSV',
        rows: assetCSV(original),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
}
export async function assetLongFixture(
  name = '01-two-assets-separated',
): Promise<AssetInput> {
  const root = new URL(`frozen/${name}/`, assetLongRoot),
    metadata = JSON.parse(await readFile(new URL('case.json', root), 'utf8'));
  const files = await Promise.all(
    [0, 1, 2, 3].map(async (source) => {
      const original = new Uint8Array(
        await readFile(new URL(`source-${source}.csv`, root)),
      ).buffer;
      return assetLongSource(`source-${source}.csv`, original);
    }),
  );
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope: metadata.scope,
    readings: ASSET_ROLES.map((role, source) => ({
      role,
      sheet: 0,
      confirmed: true,
      family: source === 0 ? ASSET_LONG_FAMILY : ASSET_VERSION,
    })) as AssetInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
export function editAssetLongRows(
  input: AssetInput,
  source: number,
  edit: (rows: string[][]) => void,
) {
  const rows = structuredClone(input.files[source].sheets[0].rows);
  edit(rows);
  const field = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  input.files[source] = assetLongSource(
    `edited-${source}.csv`,
    new TextEncoder().encode(
      rows.map((row) => row.map(field).join(',')).join('\n') + '\n',
    ).buffer,
  );
}
