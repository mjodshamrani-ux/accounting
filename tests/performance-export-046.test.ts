// The bounded benchmark verifier must detect corruption independently of the
// production exporter. Mutations touch OOXML cells after a genuine small export.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import {
  inferMapping,
  normalizeSource,
  compare,
} from '../lib/reconciliation/core.ts';
import type { Scope } from '../lib/reconciliation/types.ts';
import { verifyPerformanceExport } from '../scripts/verify-performance-export.mjs';

const headers = [
  'Date',
  'Document No',
  'Document Type',
  'Voucher No',
  'PO No',
  'Bank Reference',
  'Description',
  'Amount',
  'Currency',
];
const sources = [
  {
    rows: [
      [
        '2026-07-14',
        'INV-90123',
        'Invoice',
        'AP-90123',
        'PO-90123',
        '',
        'Office materials',
        '1100.00',
        'SAR',
      ],
      [
        '2026-07-15',
        'CN-90456',
        'Credit Note',
        'AP-90456',
        'PO-90456',
        '',
        'Returned materials',
        '-200.00',
        'SAR',
      ],
      [
        '2026-07-16',
        'PAY-90789',
        'Payment',
        '',
        '',
        'BANK-00090789',
        'Supplier payment',
        '-300.00',
        'SAR',
      ],
    ],
  },
  {
    rows: [
      [
        '2026-07-14',
        'INV-90123',
        'Invoice',
        'AP-90123',
        'PO-90123',
        '',
        'Office materials',
        '1100.00',
        'SAR',
      ],
      [
        '2026-07-15',
        'CN-90456',
        'Credit Note',
        'AP-90456',
        'PO-90456',
        '',
        'Returned materials',
        '-200.00',
        'SAR',
      ],
      [
        '2026-07-16',
        'PV-90999',
        'Payment',
        '',
        '',
        'BANK-00090789',
        'Payment voucher',
        '-300.00',
        'SAR',
      ],
    ],
  },
];
const totals = [60000, 60000]; // Hand-calculated minor units, not engine totals.
const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const fixturePromise = (async () => {
  const files = await Promise.all(
    sources.map((s, i) =>
      readFile(
        `synthetic-${i}.csv`,
        new TextEncoder().encode(
          [headers, ...s.rows].map((row) => row.join(',')).join('\r\n'),
        ).buffer,
      ),
    ),
  );
  const normalized = files.map((file, i) =>
    normalizeSource(
      file,
      inferMapping(file),
      scope,
      i === 0 ? 'supplier' : 'ledger',
    ),
  );
  assert.deepEqual(
    normalized.map((s) => s.errors),
    [[], []],
  );
  const result = compare(normalized[0], normalized[1], scope);
  assert.equal(result.matches.length, 3);
  return exportWorkbook(result, [files[0], files[1]], {
    checked: false,
    name: '',
    notes: '',
  });
})();

async function corrupt(sheetName: string, mutate: (xml: string) => string) {
  const zip = await JSZip.loadAsync(await fixturePromise);
  const workbook = await zip.file('xl/workbook.xml')!.async('string');
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const id = new RegExp(
    `<sheet\\b[^>]*name="${escaped}"[^>]*r:id="([^"]+)"`,
  ).exec(workbook)?.[1];
  assert.ok(id, 'named transaction sheet must exist');
  const relationships = await zip
    .file('xl/_rels/workbook.xml.rels')!
    .async('string');
  const target = new RegExp(
    `<Relationship\\b[^>]*Id="${id}"[^>]*Target="([^"]+)"`,
  ).exec(relationships)?.[1];
  assert.ok(target, 'transaction relationship must exist');
  const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
  const original = await zip.file(path)!.async('string'),
    changed = mutate(original);
  assert.notEqual(
    changed,
    original,
    'the intended corruption must actually modify the workbook',
  );
  zip.file(path, changed);
  return zip.generateAsync({ type: 'uint8array' });
}
function replaceCell(xml: string, address: string, body: string, type = 'n') {
  const pattern = new RegExp(`<c\\b[^>]*r="${address}"[^>]*>[\\s\\S]*?<\\/c>`);
  assert.match(xml, pattern, `required cell ${address}`);
  return xml.replace(pattern, `<c r="${address}" t="${type}">${body}</c>`);
}

test('bounded performance export verifier accepts native dates, negative credits and explicit payment bank identity', async () => {
  const result = await verifyPerformanceExport(
    await fixturePromise,
    sources,
    totals,
  );
  assert.deepEqual(result, {
    sourceRows: [3, 3],
    amountsReferencesAndDates: true,
  });
});

test('bounded performance export verifier detects a reversed amount sign', async () => {
  const bytes = await corrupt('Supplier transactions', (xml) =>
    replaceCell(xml, 'H2', '<v>-1100</v>'),
  );
  await assert.rejects(verifyPerformanceExport(bytes, sources, totals));
});

test('bounded performance export verifier detects a forged reference despite unchanged financial totals', async () => {
  const bytes = await corrupt('Ledger transactions', (xml) =>
    replaceCell(xml, 'E4', '<is><t>BANK-WRONG-00090789</t></is>', 'inlineStr'),
  );
  await assert.rejects(verifyPerformanceExport(bytes, sources, totals));
});

test('bounded performance export verifier detects a native Excel date shifted by one day', async () => {
  const expectedSerial =
    (Date.UTC(2026, 6, 14) - Date.UTC(1899, 11, 30)) / 86400000;
  const bytes = await corrupt('Supplier transactions', (xml) =>
    replaceCell(xml, 'D2', `<v>${expectedSerial + 1}</v>`),
  );
  await assert.rejects(verifyPerformanceExport(bytes, sources, totals));
});

test('bounded performance export verifier detects a missing exported row', async () => {
  const bytes = await corrupt('Ledger transactions', (xml) =>
    xml.replace(/<row\b[^>]*r="4"[^>]*>[\s\S]*?<\/row>/, ''),
  );
  await assert.rejects(verifyPerformanceExport(bytes, sources, totals));
});

test('bounded performance export verifier rejects a formula even with its original correct cached amount', async () => {
  const bytes = await corrupt('Supplier transactions', (xml) =>
    replaceCell(xml, 'H2', '<f>-1100</f><v>1100</v>'),
  );
  await assert.rejects(
    verifyPerformanceExport(bytes, sources, totals),
    /Source text became formula/,
  );
});
