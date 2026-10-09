import source0 from '../../audit/intercompany/frozen/pending-0.csv?raw';
import source1 from '../../audit/intercompany/frozen/pending-1.csv?raw';
import source2 from '../../audit/intercompany/frozen/pending-2.csv?raw';
import source3 from '../../audit/intercompany/frozen/pending-3.csv?raw';
export const intercompanyDemo = [source0, source1, source2, source3];
export const intercompanyDemoScope = {
  entityA: 'Synthetic Entity A',
  entityB: 'Synthetic Entity B',
  ledgerA: 'Book A',
  ledgerB: 'Book B',
  accountA: '001',
  accountB: '901',
  dimensionsA: 'department=01',
  dimensionsB: 'department=09',
  currency: 'SAR',
  currencyBasis: 'functional',
  fxPolicy: 'same-currency-no-conversion',
  postingStatus: 'posted',
  postingLayer: 'actual',
  start: '2026-09-01',
  end: '2026-09-30',
  asOf: '2026-09-30',
  policyVersion: 'IC-1',
};
