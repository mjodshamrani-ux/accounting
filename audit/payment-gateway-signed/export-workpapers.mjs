// UX-6(c): the page's workpaper for a signed-kind batch, as the worker hands
// it, beside the evidence alone and the session it replays, for the signed
// checker's sheet-first test (test_sheet_first.py). Synthetic only.
//
//   node --experimental-strip-types audit/payment-gateway-signed/export-workpapers.mjs <dir>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gatewayCase } from '../reconciliation-sheet/gateway-cases.ts';
import {
  exportGateway,
  saveGateway,
} from '../../lib/reconciliation/payment-gateway-io.ts';
import { exportGatewayWorkpaper } from '../../lib/reconciliation/payment-gateway-sheet.ts';

const out = process.argv[2];
if (!out) throw Error('an output folder is required');
await mkdir(out, { recursive: true });
const { state, result } = await gatewayCase('signed-sar-mixed');
await writeFile(
  path.join(out, 'session.json'),
  new Uint8Array(await saveGateway(state)),
);
await writeFile(
  path.join(out, 'evidence.xlsx'),
  new Uint8Array(await exportGateway(state, result)),
);
for (const lang of ['ar', 'en'])
  await writeFile(
    path.join(out, `workpaper-${lang}.xlsx`),
    new Uint8Array(await exportGatewayWorkpaper(state, result, lang)),
  );
console.log(JSON.stringify({ out, case: 'signed-sar-mixed' }));
