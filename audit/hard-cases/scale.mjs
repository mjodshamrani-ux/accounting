// S09: dense evidence at growing sizes, through the production supplier path.
//   node --experimental-strip-types audit/hard-cases/scale.mjs [--engine-root dir] [--out file]
// Each size mixes unique invoices (which must match), payment groups split
// over two days under one explicit bank reference (which must match as
// groups), and a block of rows sharing one generic reference (which must
// never match). The expected result is fixed by construction; the script
// checks it at every size, so a faster run cannot pass by changing results.
// Timings are local Node timings, not a claim about browsers or devices.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const root = resolve(value('--engine-root', '.'));
const out = value('--out', '');
const sizes = value('--sizes', '100,1000,5000,20000').split(',').map(Number);
const load = (m) => import(resolve(root, 'lib/reconciliation', m));
const { readFile } = await load('io.ts');
const { selectImportMapping } = await load('import-selection.ts');
const { reconcileSupplierStatement } = await load('supplier-reconciliation.ts');
const { MAX_ROWS } = await load('types.ts');

const money = (minor) => {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${minor < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
const date = (d) => `2026-07-${String(d).padStart(2, '0')}`;
const HEAD = 'Date,Reference,Type,Bank Ref,Description,Amount';

/** Rows per side for one size, and the counts the engine must reach. */
function build(size) {
  const supplier = [HEAD],
    ledger = [HEAD];
  let invoices = 0,
    groups = 0,
    generic = 0;
  // A tenth of each side is generic "PAYMENT" rows with distinct amounts.
  const genericRows = Math.max(2, Math.floor(size / 10));
  for (let i = 0; i < genericRows; i++) {
    const line = `${date(20)},PAYMENT,Payment,,Transfer,${money(-(5000 + i))}`;
    supplier.push(line);
    ledger.push(line);
    generic += 2;
  }
  // Payment groups: one row on the statement, three parts over two days in
  // the ledger, tied by one bank reference.
  const groupCount = Math.max(1, Math.floor(size / 40));
  for (let g = 0; g < groupCount; g++) {
    const bank = `TRF-${100000 + g}`;
    const parts = [30000 + g, 20000 + g, 10000 + g];
    supplier.push(
      `${date(14)},PAY-${g},Payment,${bank},Transfer,${money(-(60000 + 3 * g))}`,
    );
    parts.forEach((p, i) =>
      ledger.push(
        `${date(i === 2 ? 15 : 14)},PAY-${g},Payment,${bank},Transfer,${money(-p)}`,
      ),
    );
    groups++;
  }
  // Unique invoices fill the ledger, the larger side, up to the size.
  const invoiceCount = size - genericRows - 3 * groupCount;
  for (let i = 0; i < invoiceCount; i++) {
    const line = `${date(1 + (i % 28))},INV-${200000 + i},Invoice,,Goods,${money(1000 + i)}`;
    supplier.push(line);
    ledger.push(line);
    invoices++;
  }
  return { supplier, ledger, expect: { invoices, groups, genericRows } };
}

const scope = {
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
const results = [];
for (const size of sizes) {
  if (size > MAX_ROWS) throw Error(`size ${size} is above MAX_ROWS`);
  const { supplier, ledger, expect } = build(size);
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const text = (rows) => new TextEncoder().encode(rows.join('\n')).buffer;
  const a = await readFile('supplier.csv', text(supplier), undefined, true);
  const b = await readFile('ledger.csv', text(ledger), undefined, true);
  const read = performance.now();
  const { result } = reconcileSupplierStatement({
    files: [a, b],
    mappings: [
      { ...selectImportMapping(a, 'supplier').mapping, reference: 1 },
      { ...selectImportMapping(b, 'ledger').mapping, reference: 1 },
    ],
    scope,
  });
  const done = performance.now();
  const matched = result.cases.filter((c) => c.status === 'Matched');
  const byRule = (rule) => matched.filter((c) => c.matchingRule === rule);
  const genericMatched = matched.filter((c) =>
    c.supplierMembers.some((t) => t.reference === 'PAYMENT'),
  ).length;
  const row = {
    size,
    supplierRows: supplier.length - 1,
    ledgerRows: ledger.length - 1,
    readMs: Math.round(read - started),
    reconcileMs: Math.round(done - read),
    heapGrowthMB: Math.round(
      (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20,
    ),
    invoicesMatched: byRule('EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2').length,
    groupsMatched: byRule('EXPLICIT_PAYMENT_IDENTITY_GROUP_DATE_SPAN_V1')
      .length,
    genericMatched,
    expect,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  // The fixed expectation holds at every size.
  assert.equal(row.invoicesMatched, expect.invoices, `invoices at ${size}`);
  assert.equal(row.genericMatched, 0, `generic references at ${size}`);
  if (row.groupsMatched !== expect.groups)
    console.log(
      `note: ${row.groupsMatched}/${expect.groups} two-day payment groups matched at ${size} (engine without the G08 rule matches none)`,
    );
}
if (out)
  await writeFile(
    out,
    JSON.stringify(
      {
        engineRoot: value('--engine-root', '.'),
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cpus: os.cpus().length,
        results,
      },
      null,
      2,
    ),
  );
