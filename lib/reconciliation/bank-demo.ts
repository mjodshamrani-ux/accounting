import {
  BANK_HEADERS,
  BANK_ROLES,
  BANK_VERSION,
  type BankScope,
  type BankInput,
} from './bank.ts';
export const bankDemoScope: BankScope = {
  entity: 'Synthetic Cash Owner',
  ledger: 'Primary Book',
  account: 'BANK-001',
  currency: 'SAR',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
export const bankDemoReadings = BANK_ROLES.map((role) => ({
  role,
  sheet: 0,
  family: BANK_VERSION,
  perspective: 'company-cash',
  confirmed: true,
})) as BankInput['readings'];
export function bankDemo() {
  const meta = [
    'Synthetic Cash Owner',
    'Primary Book',
    'BANK-001',
    'SAR',
    '2026-09-01',
    '2026-09-30',
  ];
  const row = (
    id: string,
    role: string,
    amount: string,
    parent = '',
    side = 0,
  ) => [
    id,
    'S1',
    '2026-09-15',
    '2026-09-16',
    'outflow',
    role,
    parent,
    '',
    'outgoing-inclusive',
    side ? 'posted' : 'booked',
    ...meta,
    amount,
  ];
  return [
    [row('B1', 'settlement', '1017.25')],
    [
      row('L1', 'principal', '1000', '', 1),
      row('F1', 'fee', '15', 'L1', 1),
      row('T1', 'fee-tax', '2.25', 'L1', 1),
    ],
  ].map((rows, side) => ({
    name: `outgoing-fees-${side}.csv`,
    buffer: new TextEncoder().encode(
      [BANK_HEADERS, ...rows].map((r) => r.join(',')).join('\n') + '\n',
    ).buffer,
  }));
}
