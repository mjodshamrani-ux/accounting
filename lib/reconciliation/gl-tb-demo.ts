import {
  GL_HEADERS,
  TB_HEADERS,
  GL_TB_VERSION,
  type GlTbScope,
  type GlTbReading,
} from './gl-tb.ts';
export const glDemoScope: GlTbScope = {
  entity: 'Synthetic Entity',
  ledger: 'Primary Book',
  account: '1100',
  dimensions: 'CostCentre=CC01|Department=D01',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
export const glDemoReadings: [GlTbReading, GlTbReading] = [
  { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
  { sheet: 0, role: 'trial-balance', family: GL_TB_VERSION, confirmed: true },
];
export function glTbDemo() {
  const s = glDemoScope,
    meta = [
      s.entity,
      s.ledger,
      s.account,
      s.dimensions,
      s.currency,
      s.currencyBasis,
      s.postingStatus,
      s.postingLayer,
      s.start,
      s.end,
    ];
  const rows = [
    [
      GL_HEADERS,
      ['G-OPEN', 'opening', s.start, ...meta, '1000', '0'],
      ['G-D1', 'movement', '2026-09-15', ...meta, '300', '0'],
      ['G-C1', 'movement', '2026-09-16', ...meta, '0', '100'],
      ['G-CLOSE', 'closing', s.end, ...meta, '1200', '0'],
    ],
    [
      TB_HEADERS,
      ['T-SNAPSHOT', ...meta, '1000', '0', '300', '100', '1200', '0'],
    ],
  ];
  return rows.map((table, side) => ({
    name: side === 0 ? 'synthetic-gl.csv' : 'synthetic-tb.csv',
    buffer: new TextEncoder().encode(
      table.map((r) => r.join(',')).join('\n') + '\n',
    ).buffer,
  }));
}
