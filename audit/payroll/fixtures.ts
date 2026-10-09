import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { payrollCSV } from '../../lib/reconciliation/payroll-csv.ts';
import {
  PAYROLL_ROLES,
  PAYROLL_VERSION,
  type PayrollInput,
} from '../../lib/reconciliation/payroll.ts';
export async function payrollFixture(
  name = 'seven-components-and-bank-positive',
) {
  const root = new URL(`./cases/${name}/`, import.meta.url);
  const truth = JSON.parse(
    await readFile(new URL('expected.json', root), 'utf8'),
  );
  const files = await Promise.all(
    [0, 1, 2, 3, 4].map(async (i) => {
      const original = new Uint8Array(
        await readFile(new URL(`source-${i}.csv`, root)),
      ).buffer;
      return {
        name: `source-${i}.csv`,
        original,
        sha256: createHash('sha256')
          .update(new Uint8Array(original))
          .digest('hex'),
        sheets: [
          {
            name: 'CSV',
            rows: payrollCSV(original),
            hiddenRows: [],
            formulaRows: [],
          },
        ],
      };
    }),
  );
  const state: PayrollInput = {
    files: [files[0], files[1], files[2], files[3], files[4]],
    scope: { ...truth.scope, confirmed: true },
    readings: PAYROLL_ROLES.map((role) => ({
      role,
      sheet: 0,
      family: PAYROLL_VERSION,
      confirmed: true,
    })) as PayrollInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  return { state, truth };
}
