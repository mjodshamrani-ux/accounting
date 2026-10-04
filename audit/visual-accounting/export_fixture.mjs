import { readFile as fsRead, writeFile, mkdir } from 'node:fs/promises';
import { readFile, exportWorkbook } from '../../lib/reconciliation/io.ts';
import { visualAccountingMapping } from '../../lib/reconciliation/visual-accounting-source.ts';
import { reconcileSupplierStatement } from '../../lib/reconciliation/supplier-reconciliation.ts';
import {
  saveSession,
  restoreSession,
} from '../../lib/reconciliation/session.ts';
const dir = process.argv[2] ?? 'work/visual-accounting';
const supplier = await readFile(
  'statement.tarasuf-reviewed.json',
  new Uint8Array(await fsRead(`${dir}/statement.tarasuf-reviewed.json`)).buffer,
);
const ledger = await readFile(
  'ledger.csv',
  new Uint8Array(await fsRead(`${dir}/ledger.csv`)).buffer,
);
const c = supplier.visual.context;
const scope = {
  supplier: c.supplier,
  entity: c.entity,
  account: c.account,
  currency: c.currency,
  decimals: c.decimals,
  cutoff: c.cutoff,
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const sm = visualAccountingMapping(supplier),
  lm = { ...sm, reference: 0, date: 1, amount: 2, currencyColumn: 3 };
delete lm.formatChoice;
const state = {
  files: [supplier, ledger],
  mappings: [sm, lm],
  scope,
  decisions: [],
  rejected: [],
  events: [],
  review: { checked: false, name: '', notes: '' },
};
const result = reconcileSupplierStatement(state).result;
await mkdir(dir, { recursive: true });
await writeFile(
  `${dir}/direct.xlsx`,
  new Uint8Array(await exportWorkbook(result, state.files, state.review)),
);
const session = await saveSession(state);
await writeFile(`${dir}/session.json`, new Uint8Array(session));
const restored = await restoreSession(session);
await writeFile(
  `${dir}/restored.xlsx`,
  new Uint8Array(
    await exportWorkbook(restored.result, restored.files, restored.review),
  ),
);
await writeFile(
  `${dir}/observations.json`,
  JSON.stringify(
    {
      matches: result.matches.length,
      supplierErrors: result.supplier.errors.length,
      ledgerOnly: result.ledgerOnly.length,
      supplierTotal: result.supplier.total,
      balanceValid: result.supplier.balanceValid,
    },
    null,
    2,
  ) + '\n',
);
