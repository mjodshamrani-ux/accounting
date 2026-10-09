import transactions from '../../audit/payment-gateway/frozen/pending-0.csv?raw';
import fees from '../../audit/payment-gateway/frozen/pending-1.csv?raw';
import settlement from '../../audit/payment-gateway/frozen/pending-2.csv?raw';
import payout from '../../audit/payment-gateway/frozen/pending-3.csv?raw';
import type { GatewayScope } from './payment-gateway';
export const gatewayDemo = [transactions, fees, settlement, payout];
export const gatewayDemoScope: GatewayScope = {
  entity: 'Synthetic Merchant',
  gateway: 'Gateway example',
  merchantAccount: '001',
  bankAccount: 'BANK-01',
  dimensions: 'department=01',
  currency: 'SAR',
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  start: '2026-09-01',
  end: '2026-09-30',
  asOf: '2026-09-30',
  policyVersion: 'PG-1',
  batchId: 'BATCH-001',
  confirmed: true,
};
