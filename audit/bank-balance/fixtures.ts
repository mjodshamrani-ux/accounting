import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../../lib/reconciliation/io.ts';
import { finishedBank, bankTruth } from '../bank/fixtures.ts';
import {
  BANK_BALANCE_VERSION,
  BANK_BALANCE_ROLES,
  type BankBalanceInput,
  type BankBalanceRecord,
  type BankBalanceComponent,
} from '../../lib/reconciliation/bank-balance.ts';
const root = new URL('./frozen/', import.meta.url);
export type BalanceFixtureCase = {
  name: string;
  bankCase: string;
  files: { file: string; sha256: string }[];
  records: Pick<
    BankBalanceRecord,
    'side' | 'row' | 'reference' | 'kind' | 'asOf' | 'amount'
  >[];
  inventory: { side: number; row: number; kind: string }[];
  missing: [number, string][];
  components: Pick<
    BankBalanceComponent,
    'opening' | 'closing' | 'movement' | 'residual'
  >[];
  differences: { opening: number | null; closing: number | null };
  status: string;
  reject?: string;
  timingItems: number;
  bankTruth: {
    sha256: string;
    case: string;
    records: Record<string, unknown>[];
    groups: unknown[];
    actions: unknown[];
    timingItems: unknown[];
    sourceError: boolean;
  };
};
export const balanceTruth = JSON.parse(
  await fsRead(new URL('expected.json', root), 'utf8'),
) as {
  version: string;
  openingAsOf: string;
  closingAsOf: string;
  cases: BalanceFixtureCase[];
};
export async function balanceFixture(
  name = 'balanced',
): Promise<BankBalanceInput> {
  const c = balanceTruth.cases.find((c) => c.name === name)!;
  const { state: bank } = await finishedBank(
    bankTruth.cases.find((b) => b.name === c.bankCase)!,
  );
  const files = [];
  for (const f of c.files)
    files.push(
      await readFile(
        f.file,
        new Uint8Array(await fsRead(new URL(f.file, root))).buffer,
      ),
    );
  return {
    bank,
    files: files as BankBalanceInput['files'],
    readings: BANK_BALANCE_ROLES.map((role) => ({
      role,
      sheet: 0,
      family: BANK_BALANCE_VERSION,
      perspective: 'company-cash',
      confirmed: true,
    })) as BankBalanceInput['readings'],
    coverage: {
      basis: 'movement-date',
      boundary: 'end-of-day',
      openingAsOf: balanceTruth.openingAsOf,
      closingAsOf: balanceTruth.closingAsOf,
      confirmed: true,
    },
  };
}
