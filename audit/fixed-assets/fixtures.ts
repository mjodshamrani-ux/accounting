import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assetCSV } from '../../lib/reconciliation/fixed-assets-csv.ts';
import {
  ASSET_ROLES,
  ASSET_VERSION,
  type AssetInput,
} from '../../lib/reconciliation/fixed-assets.ts';
export async function assetFixture(name = 'three-components-positive') {
  const root = new URL(`./cases/${name}/`, import.meta.url);
  const truth = JSON.parse(
    await readFile(new URL('expected.json', root), 'utf8'),
  );
  const files = await Promise.all(
    [0, 1, 2, 3].map(async (i) => {
      const original = new Uint8Array(
        await readFile(new URL(`source-${i}.csv`, root)),
      ).buffer;
      return {
        name: `source-${i}.csv`,
        original,
        sha256: createHash('sha256')
          .update(new Uint8Array(original))
          .digest('hex'),
        sheets: [
          {
            name: 'CSV',
            rows: assetCSV(original),
            hiddenRows: [],
            formulaRows: [],
          },
        ],
      };
    }),
  );
  const state: AssetInput = {
    files: [files[0], files[1], files[2], files[3]],
    scope: { ...truth.scope, confirmed: true },
    readings: ASSET_ROLES.map((role) => ({
      role,
      sheet: 0,
      family: ASSET_VERSION,
      confirmed: true,
    })) as AssetInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  return { state, truth };
}
