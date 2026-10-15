import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readStockFile } from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_ROLES,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import { STOCK_COLUMN_FAMILY } from '../lib/reconciliation/inventory-column-hierarchy.ts';
const dir = mkdtempSync(path.join(tmpdir(), 'tarasuf-inv1e-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const suite = path.resolve(
  import.meta.dirname,
  '../audit/inventory-column-hierarchy',
);
execFileSync(process.env.PYTHON ?? 'python3', [
  '-B',
  path.join(suite, 'generate.py'),
  '--output-dir',
  dir,
  '--include-layout-controls',
  '--negative-layout-controls',
]);
export const oracle = JSON.parse(
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, 'oracle.py'), '--root', dir],
    { encoding: 'utf8' },
  ),
);
export const columnScope: StockInput['scope'] = {
  entity: 'Synthetic INV1E Owner',
  inventoryLedger: 'STOCK-COLUMN',
  glLedger: 'GL-COLUMN',
  currency: 'KWD',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-10-31',
  chartVersion: 'CHART-E',
  mapVersion: 'MAP-E',
  valuationPolicyVersion: 'SUPPLIED-E',
  inventoryAccountSetVersion: 'SET-E',
  confirmed: true,
};
export async function columnInput(code: string): Promise<StockInput> {
  const entry = JSON.parse(
    readFileSync(path.join(dir, 'corpus.json'), 'utf8'),
  ).cases.find((x: { id: string }) => x.id === 'INV1E-' + code);
  const files = await Promise.all(
    entry.files.map(async (p: string) => {
      const b = readFileSync(path.join(dir, p));
      return readStockFile(path.basename(p), Uint8Array.from(b).buffer);
    }),
  );
  return {
    files: files as StockInput['files'],
    readings: STOCK_ROLES.map((role, i) => ({
      role,
      sheet: 0,
      family: i === 0 ? STOCK_COLUMN_FAMILY : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: { ...columnScope },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
