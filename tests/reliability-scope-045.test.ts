import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import type { Scope } from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Example supplier',
  entity: 'Example entity',
  account: 'AP-17',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
async function source(
  side: 'supplier' | 'ledger',
  {
    title = 'Transaction statement',
    account = 'AP-17',
    accountLabel = 'Account',
    description = 'Invoice services',
    currency = 'SAR',
  } = {},
) {
  const csv = `${title}\nCurrency: ${currency}\nDate,Reference,Description,Amount,${accountLabel}\n2026-07-10,INV-778,${description},125.00,${account}\n`;
  // Each side is its own file; the ledger's export ends with a line break.
  const file = await readFile(
    `${side}.csv`,
    new TextEncoder().encode(side === 'ledger' ? csv + '\n' : csv).buffer,
  );
  return normalizeSource(file, inferMapping(file), scope, side);
}
test('declared aging cannot be accepted by choosing the transactions default', async () => {
  for (const title of [
    'Aging report',
    'Supplier - Aging report',
    'Accounts payable aging report',
    'تقرير أعمار الديون',
  ]) {
    const a = await source('supplier', { title }),
      b = await source('ledger');
    assert.ok(
      a.errors.some((e) => e.row === 0 && /أعمار/.test(e.message)),
      title,
    );
    const r = compare(a, b, scope);
    assert.equal(r.matches.length, 0);
    assert.equal(r.bridge, null);
  }
  const a = await source('supplier', {
      description: 'Aging report consultancy fee',
    }),
    b = await source('ledger', { description: 'Aging report consultancy fee' });
  assert.equal(
    compare(a, b, scope).matches.length,
    1,
    'An invoice description is not a report title',
  );
});
test('generic accounts cannot be merged merely because reference and amount agree', async () => {
  const a = await source('supplier'),
    b = await source('ledger', { account: 'AP-98' });
  assert.ok(b.errors.some((e) => e.row === 0));
  assert.throws(() => compare(a, b, scope), /الحساب/);
  assert.equal(compare(a, await source('ledger'), scope).matches.length, 1);
  // Explicitly different roles remain distinct; a customer ID is not the vendor ID.
  const customer = await source('supplier', {
    account: 'CLIENT-5',
    accountLabel: 'Customer Account',
  });
  const vendor = await source('ledger', {
    account: 'VENDOR-9',
    accountLabel: 'Vendor Code',
  });
  assert.equal(compare(customer, vendor, scope).matches.length, 1);
});
test('source-level currency conflicts never relabel a foreign transaction as the scope currency', async () => {
  const a = await source('supplier', { currency: 'USD' });
  assert.equal(a.transactions.length, 0);
  assert.ok(a.errors.some((e) => e.row > 0 && /عملة المصدر/.test(e.message)));
  assert.ok(a.excluded.length + a.errors.filter((e) => e.row > 0).length >= 4);
});
test('an explicitly balanced empty period can be compared but an unproven empty file cannot', async () => {
  const csv =
    'Period: 2026-07-01 to 2026-07-31\nDate,Reference,Description,Amount\n,,Opening balance,0.00\n2026-08-01,INV-799,Invoice after cutoff,80.00\n,,Closing balance,0.00';
  const file = await readFile(
    'empty-period.csv',
    new TextEncoder().encode(csv).buffer,
  );
  const a = normalizeSource(file, inferMapping(file), scope, 'supplier');
  const b = await source('ledger');
  const result = compare(a, b, scope);
  assert.equal(result.matches.length, 0);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].classification, 'LEDGER_ONLY');
  assert.ok(a.excluded.some((e) => e.values.includes('INV-799')));
  assert.throws(
    () =>
      compare({ ...a, metadata: { ...a.metadata!, periodEnd: '' } }, b, scope),
    /حركات كافية/,
  );
  assert.throws(
    () =>
      compare(
        { ...a, errors: [{ row: 4, message: 'unreadable row' }] },
        b,
        scope,
      ),
    /حركات كافية/,
  );
});
