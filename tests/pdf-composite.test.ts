import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as readBytes } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import type { Mapping, Scope } from '../lib/reconciliation/types.ts';
import * as composite from '../audit/hard-cases/pdf-composite.mjs';

const { compositeCase } = composite as unknown as {
  compositeCase: (
    pattern: string,
    variant: string,
    seed: number,
  ) => { ledgerCsv: string };
};

// Real statements printed by Chromium (audit/hard-cases/pdf-composite.mjs,
// seed 1), kept as fixtures: failures found by the V1.1 composite PDF round.
const scope: Scope = {
  supplier: 'S',
  entity: 'E',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const fixture = async (name: string) => {
  const bytes = await readBytes(
    new URL(`./fixtures/pdf-composite/${name}.pdf`, import.meta.url),
  );
  return readFile(
    `${name}.pdf`,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    undefined,
    true,
  );
};

test('carried-forward lines between pages are structure, not dates or transactions', async () => {
  // Before: "Carried forward" was not a known summary label, so its empty date
  // failed the date-format check and the whole statement was refused.
  const c = compositeCase('REPEAT', 'resolvable', 1);
  const pdf = await fixture('PDFC-REPEAT-resolvable-1');
  const ledger = await readFile(
    'ledger.csv',
    new TextEncoder().encode(c.ledgerCsv).buffer as ArrayBuffer,
  );
  const mappings = [
    { ...selectImportMapping(pdf, 'supplier').mapping, pdfReviewed: true },
    {
      ...selectImportMapping(ledger, 'ledger').mapping,
      reference: 1,
    },
  ] as [Mapping, Mapping];
  let result!: ReturnType<typeof reconcileSupplierStatement>['result'];
  assert.doesNotThrow(() => {
    result = reconcileSupplierStatement({
      files: [pdf, ledger],
      mappings,
      scope,
    }).result;
  }, 'the statement is not refused');
  assert.equal(result.supplier.transactions.length, 9);
  assert.equal(result.caseCounts.autoMatchedCases, 9);
  assert.ok(
    result.supplier.excluded.some((e) => /Carried forward/.test(e.reason)),
  );
});

test('a table rule at a page break does not make black text count as hidden', async () => {
  // Before: the cut row's bottom border grazing the last text line was taken
  // as a grey background, and the whole file was refused as low-contrast.
  const pdf = await fixture('PDFC-CROSSPAGE-resolvable-1');
  assert.equal(pdf.sheets.length, 1);
  assert.ok(pdf.sheets[0].rows.some((r) => r.join(' ').includes('INV-L177')));
});
