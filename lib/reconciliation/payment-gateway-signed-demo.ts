import transactions from '../../audit/payment-gateway-signed/fixtures/sar-mixed/0.csv?raw';
import fees from '../../audit/payment-gateway-signed/fixtures/sar-mixed/1.csv?raw';
import settlement from '../../audit/payment-gateway-signed/fixtures/sar-mixed/2.csv?raw';
import payout from '../../audit/payment-gateway-signed/fixtures/sar-mixed/3.csv?raw';
import type { GatewayScope } from './payment-gateway';
export const gatewaySignedDemo = [transactions, fees, settlement, payout];
export const gatewaySignedDemoScope: GatewayScope = {
  entity: 'Synthetic Example Entity',
  gateway: 'Synthetic Gateway',
  merchantAccount: '00017',
  bankAccount: '00029',
  dimensions: 'region=TEST;channel=synthetic',
  currency: 'SAR',
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  start: '2026-10-01',
  end: '2026-10-05',
  asOf: '2026-10-05',
  policyVersion: 'synthetic-policy-1',
  batchId: 'SYNTH-BATCH-01',
  confirmed: true,
};
