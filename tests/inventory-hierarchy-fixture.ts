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
import { STOCK_HIERARCHY_FAMILY } from '../lib/reconciliation/inventory-hierarchy-sections.ts';
const dir = mkdtempSync(path.join(tmpdir(), 'tarasuf-inv1d-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const suite = path.resolve(
  import.meta.dirname,
  '../audit/inventory-hierarchy-sections',
);
execFileSync(process.env.PYTHON ?? 'python3', [
  '-B',
  path.join(suite, 'generate.py'),
  '--output-dir',
  dir,
]);
export const oracle = JSON.parse(
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, 'oracle.py'), '--root', dir],
    { encoding: 'utf8' },
  ),
);
export const hierarchyScope: StockInput['scope'] = {
  entity: 'Synthetic INV1D Owner',
  inventoryLedger: 'STOCK-HIER',
  glLedger: 'GL-HIER',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-10-31',
  chartVersion: 'CHART-H',
  mapVersion: 'MAP-H',
  valuationPolicyVersion: 'SUPPLIED-H',
  inventoryAccountSetVersion: 'SET-H',
  confirmed: true,
};
export async function hierarchyInput(code: string): Promise<StockInput> {
  const entry = JSON.parse(
    readFileSync(path.join(dir, 'corpus.json'), 'utf8'),
  ).cases.find((x: { id: string }) => x.id === 'INV1D-' + code);
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
      family: i === 0 ? STOCK_HIERARCHY_FAMILY : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: { ...hierarchyScope },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
