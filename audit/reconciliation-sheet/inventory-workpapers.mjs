// UX-6(c): an inventory workpaper as the worker hands it to the page, in
// Arabic and in English, beside the evidence alone, for the inventory
// readers' set-aside test (test_set_aside.py). The positive case attested
// and approved; synthetic only.
//
//   node --experimental-strip-types audit/reconciliation-sheet/inventory-workpapers.mjs <dir>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inventoryCase } from './inventory-cases.ts';
import { exportStock } from '../../lib/reconciliation/inventory-register-io.ts';
import { exportStockWorkpaper } from '../../lib/reconciliation/inventory-sheet.ts';

const out = process.argv[2];
if (!out) throw Error('an output folder is required');
await mkdir(out, { recursive: true });
const { state, result } = await inventoryCase('accepted');
await writeFile(
  path.join(out, 'evidence.xlsx'),
  new Uint8Array(await exportStock(state, result)),
);
for (const lang of ['ar', 'en'])
  await writeFile(
    path.join(out, `workpaper-${lang}.xlsx`),
    new Uint8Array(await exportStockWorkpaper(state, result, lang)),
  );
console.log(JSON.stringify({ out, case: 'accepted', status: result.status }));
