import {
  ALLOCATION_HEADERS,
  ALLOCATION_ROLES,
  ALLOCATION_VERSION,
  type AllocationInput,
} from './allocation.ts';
export const allocationDemoScope: AllocationInput['scope'] = {
  entity: 'Synthetic Buyer',
  ledger: 'Primary Book',
  party: 'Supplier S01',
  account: '2100',
  currency: 'SAR',
  cutoff: '2026-09-30',
  basis: 'before-proposed-allocation',
  confirmed: true,
};
export const allocationDemoReadings = ALLOCATION_ROLES.map((role) => ({
  sheet: 0,
  role,
  family: ALLOCATION_VERSION,
  confirmed: true,
})) as AllocationInput['readings'];
export function allocationDemo() {
  const s = allocationDemoScope,
    m = [s.entity, s.ledger, s.party, s.account, s.currency, s.cutoff, s.basis];
  const rows = [
    [ALLOCATION_HEADERS[0], ['P1', '2026-09-20', ...m, '1000', '1000']],
    [
      ALLOCATION_HEADERS[1],
      ...[
        ['I1', '400'],
        ['I2', '350'],
        ['I3', '250'],
      ].map(([r, n]) => [r, '2026-08-15', ...m, n, n]),
    ],
    [
      ALLOCATION_HEADERS[2],
      ...[
        ['R1', 'I1', '400'],
        ['R2', 'I2', '350'],
        ['R3', 'I3', '250'],
      ].map(([r, i, n]) => [r, ...m, 'P1', i, n]),
    ],
  ];
  return rows.map((table, side) => ({
    name: `synthetic-allocation-${side}.csv`,
    buffer: new TextEncoder().encode(
      table.map((r) => r.join(',')).join('\n') + '\n',
    ).buffer,
  }));
}
