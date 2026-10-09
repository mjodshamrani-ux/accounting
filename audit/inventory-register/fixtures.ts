import { readFile } from 'node:fs/promises';
import { readStockFile } from '../../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_ROLES,
  type StockInput,
} from '../../lib/reconciliation/inventory-register.ts';
export async function stockFixture(name = 'independent-units-positive') {
  const root = new URL(`./cases/${name}/`, import.meta.url),
    truth = JSON.parse(await readFile(new URL('expected.json', root), 'utf8'));
  const files = await Promise.all(
    [0, 1, 2, 3].map(async (i) =>
      readStockFile(
        `source-${i}.csv`,
        new Uint8Array(await readFile(new URL(`source-${i}.csv`, root))).buffer,
      ),
    ),
  );
  const state: StockInput = {
    files: [files[0], files[1], files[2], files[3]],
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: { ...truth.scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  return { state, truth };
}
