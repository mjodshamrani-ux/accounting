// Learned INV-1F originals: lifecycle regression, not a fresh layout/holdout.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  STOCK_PDF_LIFECYCLE_VERSION,
  type StockPdfState,
} from '../../lib/reconciliation/inventory-pdf-request.ts';
import type {
  StockPdfReplay,
  StockEvent,
} from '../../lib/reconciliation/inventory-register.ts';
export const pdfScope = {
  entity: 'Synthetic INV1F Owner',
  inventoryLedger: 'STOCK-PDF',
  glLedger: 'GL-PDF',
  currency: 'KWD',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-10-31',
  chartVersion: 'CHART-F',
  mapVersion: 'MAP-F',
  valuationPolicyVersion: 'SUPPLIED-F',
  inventoryAccountSetVersion: 'SET-F',
  confirmed: true,
};
export const g3Contract = JSON.parse(
  await readFile(
    new URL(
      '../../audit/inventory-pdf-accounting/contract.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
export async function pdfLifecycleFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tarasuf-g4-'));
  execFileSync(
    process.env.PYTHON ?? 'python3',
    [
      '-B',
      new URL(
        '../../audit/inventory-pdf-foundation/generate.py',
        import.meta.url,
      ).pathname,
      '--output-dir',
      root,
      '--include-scope-controls',
    ],
    { timeout: 30000 },
  );
  const manifest = JSON.parse(
    await readFile(
      new URL(
        '../../audit/inventory-pdf-foundation/INPUT-MANIFEST.v2.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  for (const f of manifest.files) {
    const b = await readFile(path.join(root, f.path));
    assert.equal(b.length, f.bytes);
    assert.equal(createHash('sha256').update(b).digest('hex'), f.sha256);
  }
  return {
    root,
    async input(code = 'P02'): Promise<StockPdfState> {
      const files = await Promise.all(
        ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv'].map(
          async (name) => {
            const b = await readFile(path.join(root, 'INV1F-' + code, name));
            return {
              name,
              sha256: createHash('sha256').update(b).digest('hex'),
              original: Uint8Array.from(b).buffer,
            };
          },
        ),
      );
      return {
        version: STOCK_PDF_LIFECYCLE_VERSION,
        files: files as StockPdfState['files'],
        scope: { ...pdfScope },
        completeness: { confirmed: false, reference: '', note: '' },
        events: [],
      };
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}
export function pdfDecision(
  r: StockPdfReplay,
  type: StockEvent['type'],
  id = 'decision-1',
  at = '2026-10-16T09:00:00.000Z',
): StockEvent {
  return {
    id,
    type,
    at,
    context: r.result.context,
    memberIds: [...r.result.memberIds],
    reference: 'Synthetic source review',
    note: 'All supplied scope reviewed',
  };
}
