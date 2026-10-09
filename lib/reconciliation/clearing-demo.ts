import type { ClearingReading, ClearingScope } from './clearing.ts';
export const clearingDemo = `Posting ID,Clearing Reference,Date,Amount,Account,Currency,Description
P001,C001,2026-09-01,1000.00,2150,SAR,Invoice
P002,C001,2026-09-02,-600.00,2150,SAR,Payment part one
P003,C001,2026-09-03,-400.00,2150,SAR,Payment part two
P004,C002,2026-09-04,-500.00,2150,SAR,Reversal
P005,C002,2026-09-04,500.00,2150,SAR,Original posting
P006,,2026-09-05,75.00,2150,SAR,No relationship evidence
P007,,2026-09-05,-75.00,2150,SAR,No relationship evidence
P008,C003,2026-09-06,100.00,2150,SAR,Unresolved debit
P009,C003,2026-09-07,-90.00,2150,SAR,Unresolved credit
`;
export const clearingDemoReading: ClearingReading = {
  sheet: 0,
  header: 0,
  posting: 0,
  reference: 1,
  date: 2,
  amount: 3,
  debit: -1,
  credit: -1,
  account: 4,
  currency: 5,
  description: 6,
  mode: 'signed',
};
export const clearingDemoScope: ClearingScope = {
  entity: 'Synthetic Entity',
  ledger: 'Synthetic Ledger',
  account: '2150',
  currency: 'SAR',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
