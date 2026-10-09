import register from '../../audit/inventory-register/cases/independent-units-positive/source-0.csv?raw';
import mapping from '../../audit/inventory-register/cases/independent-units-positive/source-1.csv?raw';
import evidence from '../../audit/inventory-register/cases/independent-units-positive/source-2.csv?raw';
import gl from '../../audit/inventory-register/cases/independent-units-positive/source-3.csv?raw';
import type { StockScope } from './inventory-register';
export const stockDemo = [register, mapping, evidence, gl];
export const stockDemoScope: StockScope = {
  entity: 'Synthetic Stock Owner',
  inventoryLedger: 'STOCK-BOOK',
  glLedger: 'GL-BOOK',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-09-30',
  chartVersion: 'CHART-1',
  mapVersion: 'MAP-1',
  valuationPolicyVersion: 'provided-posted-values-1',
  inventoryAccountSetVersion: 'INV-SET-1',
  confirmed: true,
};
