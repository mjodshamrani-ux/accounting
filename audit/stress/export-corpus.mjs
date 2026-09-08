import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeSource, compare } from '../../lib/reconciliation/core.ts';
import { exportWorkbook } from '../../lib/reconciliation/io.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
await mkdir('audit/stress/workbooks', { recursive: true });
const manifest = [];
for (const decimals of [0, 2, 3])
  for (const language of ['ar', 'en', 'mixed'])
    for (const mode of ['signed', 'split']) {
      const currency = decimals === 0 ? 'JPY' : decimals === 2 ? 'SAR' : 'KWD';
      const scope = {
        supplier: 'مورد Supplier',
        entity: 'Entity جهة',
        account: 'AP',
        currency,
        decimals,
        cutoff: '2026-08-31',
        dateWindow: 2,
        confirmed: true,
        coverageConfirmed: false,
      };
      const amount = (n) => {
        const s = Math.abs(n)
          .toString()
          .padStart(decimals + 1, '0');
        return (
          (n < 0 ? '-' : '') +
          (decimals ? s.slice(0, -decimals) + '.' + s.slice(-decimals) : s)
        );
      };
      const originals = [1, -1, 0, 123456, -987654, 99999999999999];
      const rows = originals.map((n, i) => [
        '2026-08-01',
        `${language === 'ar' ? 'فاتورة' : 'INV'}-${i + 100}`,
        amount(n),
        n >= 0 ? amount(n) : '',
        n < 0 ? amount(-n) : '',
        `العربية English ${i} =SUM(A1:A2)`,
      ]);
      const ledger = rows.map((r) => [...r]);
      ledger[3][1] = 'OTHER-900';
      const source = (rs) => ({
        name: 'source.csv',
        sheets: [
          {
            name: 'Data بيانات',
            rows: [
              ['date', 'reference', 'amount', 'debit', 'credit', 'description'],
              ...rs,
            ],
            formulaRows: [],
            hiddenRows: [],
          },
        ],
      });
      const files = [source(rows), source(ledger)];
      const mapping = {
        ...defaultMapping(),
        date: 0,
        reference: 1,
        description: 5,
        mode,
        amount: 2,
        debit: 3,
        credit: 4,
      };
      const r = compare(
        normalizeSource(files[0], mapping, scope, 'supplier'),
        normalizeSource(files[1], mapping, scope, 'ledger'),
        scope,
      );
      const name = `${decimals}-${language}-${mode}.xlsx`;
      await writeFile(
        'audit/stress/workbooks/' + name,
        new Uint8Array(
          await exportWorkbook(r, files, {
            checked: false,
            name: 'مراجع Reviewer',
            notes: '@SUM(A1:A2)',
            events: [],
          }),
        ),
      );
      const ids = (side) =>
        originals.map((n, i) => ({
          id: `${side}:0:${i + 2}`,
          minor: String(n),
        }));
      manifest.push({
        name,
        decimals,
        expected: {
          'Supplier transactions': ids('supplier'),
          'Ledger transactions': ids('ledger'),
          'Supplier only': ids('supplier').filter((_, i) => [2, 3].includes(i)),
          'Ledger only': ids('ledger').filter((_, i) => [2, 3].includes(i)),
        },
        description: rows[0][5],
      });
    }
await writeFile(
  'audit/stress/workbooks/manifest.json',
  JSON.stringify(manifest, null, 2),
);
console.log(`${manifest.length} independent-check workbooks generated`);
