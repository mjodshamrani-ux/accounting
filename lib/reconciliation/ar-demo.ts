import type { ArReading, ArScope } from './ar.ts';
export const arDemoScope: ArScope = {
  entity: 'Synthetic Seller',
  ledger: 'AR Book',
  customer: 'C0001',
  account: '1200',
  currency: 'SAR',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
export const arDemoReadings: [ArReading, ArReading] = [0, 1].map((side) => ({
  sheet: 0,
  header: 0,
  posting: 0,
  kind: 1,
  document: 2,
  date: 3,
  amount: 4,
  entity: 5,
  ledger: 6,
  customer: 7,
  account: 8,
  currency: 9,
  related: 10,
  description: 11,
  role: side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
})) as [ArReading, ArReading];
const header =
  'Posting ID,Document type,Own document number,Posting date,Original signed amount,Entity,Ledger,Customer,Account,Currency,Related invoice,Description';
export function arDemo() {
  return [0, 1].map((side) => ({
    name:
      side === 0
        ? 'synthetic-ar-ledger.csv'
        : 'synthetic-customer-statement.csv',
    buffer: new TextEncoder().encode(
      [
        header,
        ...[
          ['invoice', 'I001', '100', ''],
          ['credit-note', 'CN001', '-25', 'I001'],
          ['receipt', 'RC001', '-40', 'I001'],
        ].map(([kind, doc, value, related], index) =>
          [
            `${side === 0 ? 'L' : 'S'}00${index + 1}`,
            kind,
            doc,
            '2026-09-15',
            value,
            'Synthetic Seller',
            'AR Book',
            'C0001',
            '1200',
            'SAR',
            related,
            'Synthetic development',
          ].join(','),
        ),
      ].join('\n') + '\n',
    ).buffer,
  }));
}
