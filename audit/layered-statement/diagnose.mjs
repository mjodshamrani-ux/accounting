/** Baseline product observation for a separately frozen synthetic source. */
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../../lib/reconciliation/core.ts';
import { selectImportMapping } from '../../lib/reconciliation/import-selection.ts';

const folder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'frozen',
);
const scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP-714',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const input = async (name, side, forceColumns = false) => {
  const bytes = new Uint8Array(await readBytes(path.join(folder, name)));
  const file = await readFile(name, bytes.buffer);
  const selection = selectImportMapping(file, side);
  const base = {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sheets: file.sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows.length,
    })),
    selectionKind: selection.kind,
  };
  const statementSheet = file.sheets.findIndex(
    (sheet) => sheet.name === 'Statement',
  );
  const mapping = forceColumns
    ? {
        ...inferMapping(file, statementSheet, 3),
        date: 0,
        reference: 1,
        debit: 2,
        credit: 3,
        mode: 'split',
      }
    : selection.kind === 'choose-sheet'
      ? inferMapping(file, statementSheet)
      : selection.mapping;
  if (selection.kind === 'choose-sheet') base.assistedSheetChoice = 'Statement';
  if (forceColumns)
    base.assistedColumnChoice =
      'Date=A, Document No=B, Debit=C, Credit=D; header row=4';
  base.selectedSheet = file.sheets[mapping.sheet]?.name;
  base.selectedHeader = mapping.header;
  base.inferredMapping = {
    mode: mapping.mode,
    date: mapping.date,
    reference: mapping.reference,
    amount: mapping.amount,
    debit: mapping.debit,
    credit: mapping.credit,
  };
  let result;
  try {
    result = normalizeSource(file, mapping, scope, side);
  } catch (error) {
    return { base, result: null, error: String(error) };
  }
  base.transactions = result.transactions.map((t) => ({
    row: t.row,
    reference: t.reference,
    amountMinor: t.amountMinor ?? t.amount,
  }));
  base.excluded = result.excluded.map((item) => ({
    row: item.row,
    reason: item.reason,
  }));
  base.errors = result.errors.map((item) => ({
    row: item.row,
    reason: item.reason,
  }));
  return { base, result };
};

const report = {
  schema: 'tarasuf-F02-baseline-observation-1',
  engineVersion: '0.3.21-experimental',
  contractSha256:
    '88c68039bc4b6f38e2e7ca36471b278047e22fec77a5eb0f305c84a4b77938c2',
  note: 'Diagnostic run after freezing the contract; failure is retained, not reclassified as a pass.',
  cases: [],
};
const ledger = await input('ledger-plain.csv', 'ledger');
for (const variant of [
  'supplier-layered-proven.xlsx',
  'supplier-layered-conflict.xlsx',
]) {
  try {
    const supplier = await input(variant, 'supplier');
    const item = {
      variant,
      supplier: supplier.base,
      ledger: ledger.base,
      error: supplier.error ?? null,
    };
    if (supplier.result && ledger.result) {
      const compared = compare(supplier.result, ledger.result, scope);
      item.cases = compared.cases.map((c) => ({
        status: c.status,
        classification: c.classification,
        rule: c.matchingRule,
        supplierRows: c.supplierMembers.map((t) => t.row),
        ledgerRows: c.ledgerMembers.map((t) => t.row),
        supplierTotalMinor: c.supplierTotal,
        ledgerTotalMinor: c.ledgerTotal,
      }));
    }
    const assisted = await input(variant, 'supplier', true);
    item.assistedAttempt = {
      supplier: assisted.base,
      error: assisted.error ?? null,
    };
    if (assisted.result && ledger.result) {
      const compared = compare(assisted.result, ledger.result, scope);
      item.assistedAttempt.cases = compared.cases.map((c) => ({
        status: c.status,
        classification: c.classification,
        supplierRows: c.supplierMembers.map((t) => t.row),
        ledgerRows: c.ledgerMembers.map((t) => t.row),
      }));
    }
    report.cases.push(item);
  } catch (error) {
    report.cases.push({ variant, error: String(error) });
  }
}
console.log(JSON.stringify(report, null, 2));
