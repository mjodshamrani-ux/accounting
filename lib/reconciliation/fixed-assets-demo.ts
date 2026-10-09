import register from '../../audit/fixed-assets/cases/three-components-positive/source-0.csv?raw';
import mapping from '../../audit/fixed-assets/cases/three-components-positive/source-1.csv?raw';
import evidence from '../../audit/fixed-assets/cases/three-components-positive/source-2.csv?raw';
import gl from '../../audit/fixed-assets/cases/three-components-positive/source-3.csv?raw';
import type { AssetScope } from './fixed-assets';
export const assetDemo = [register, mapping, evidence, gl];
export const assetDemoScope: AssetScope = {
  entity: 'Synthetic Asset Owner',
  assetLedger: 'ASSET-BOOK',
  glLedger: 'GL-BOOK',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-09-30',
  chartVersion: 'CHART-1',
  mapVersion: 'MAP-1',
  componentPolicyVersion: 'provided-components-1',
  assetAccountSetVersion: 'ASSET-SET-1',
  confirmed: true,
};
