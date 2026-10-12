/** Synthetic seller documents; matching receipts never allocates them to invoices. */
import type { ArScope } from './ar.ts';
export const arScopeDemoScope: ArScope = {
  entity: 'Synthetic Seller',
  ledger: 'AR Book',
  customer: '00017',
  account: '1200',
  currency: 'SAR',
  start: '2026-10-01',
  end: '2026-10-31',
  confirmed: false,
};
export function arScopeDemo() {
  return [0, 1].map((side) => {
    const parent = side === 0 ? 'SCOPE-LEFT' : 'SCOPE-RIGHT';
    const scope = arScopeDemoScope;
    const rows = [
      ['AR_SCOPE', '1'],
      ['Scope ID', parent],
      [
        'Source role',
        side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
      ],
      ['Perspective', 'seller-receivable'],
      ['Amount basis', 'original-movement'],
      ['Entity', scope.entity],
      ['Ledger', scope.ledger],
      ['Customer', scope.customer],
      ['Account', scope.account],
      ['Currency', scope.currency],
      ['Period start', scope.start],
      ['Period end', scope.end],
      ['Scope reference', `Synthetic scope reference ${side}`],
      ['DETAILS'],
      [
        'Parent scope ID',
        'Posting ID',
        'Document type',
        'Own document number',
        'Posting date',
        'Original signed amount',
        'Related invoice',
        'Open balance',
        'Description',
      ],
      [
        parent,
        `${side}-P-I01`,
        'invoice',
        'I01',
        '2026-10-02',
        '100',
        '',
        side === 0 ? '40' : '75',
        'Synthetic invoice',
      ],
      [
        parent,
        `${side}-P-CN1`,
        'credit-note',
        'CN1',
        '2026-10-02',
        '-25',
        'I01',
        '0',
        'Synthetic credit note',
      ],
      [
        parent,
        `${side}-P-RC1`,
        'receipt',
        'RC1',
        '2026-10-02',
        '-40',
        'I01',
        '0',
        'Synthetic receipt, allocation unverified',
      ],
      ['END_DETAILS'],
    ];
    return {
      name:
        side === 0
          ? 'synthetic-ar-scope-ledger.csv'
          : 'synthetic-ar-scope-statement.csv',
      buffer: new TextEncoder().encode(
        rows.map((row) => row.join(',')).join('\n') + '\n',
      ).buffer,
    };
  });
}
