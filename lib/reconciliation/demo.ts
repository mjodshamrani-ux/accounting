import type { SourceFile, Scope, Mapping } from './types.ts';
import { defaultMapping } from './types.ts';
const header = ['التاريخ', 'المرجع', 'الوصف', 'المبلغ', 'العملة'];
export const demoFiles: [SourceFile, SourceFile] = [
  {
    name: 'supplier-demo.csv',
    sheets: [
      {
        name: 'CSV',
        formulaRows: [],
        hiddenRows: [],
        rows: [
          header,
          ['2026-08-03', 'INV-001', 'توريد مواد — مثال', '12500', 'SAR'],
          ['2026-08-08', 'INV-002', 'فاتورة خدمات — مثال', '7300', 'SAR'],
          ['2026-08-12', 'PAY-101', 'دفعة مسجلة لدى الطرفين', '-5000', 'SAR'],
          ['2026-08-15', 'CN-010', 'إشعار دائن يحتاج متابعة', '-1000', 'SAR'],
          ['2026-08-19', 'INV-003', 'فاتورة بمبلغ مختلف', '4200', 'SAR'],
          ['2026-08-22', 'INV-004', 'فاتورة لم يوجد مقابلها', '3500', 'SAR'],
          ['2026-08-24', 'INV-005', 'مرجع مكرر في المصدر', '2000', 'SAR'],
          ['2026-08-24', 'INV-005', 'بند مكرر محتمل — لا يحذف', '2000', 'SAR'],
        ],
      },
    ],
  },
  {
    name: 'ledger-demo.csv',
    sheets: [
      {
        name: 'CSV',
        formulaRows: [],
        hiddenRows: [],
        rows: [
          header,
          ['2026-08-04', 'INV001', 'توريد مواد — مثال', '12500', 'SAR'],
          ['2026-08-08', 'INV-002', 'فاتورة خدمات — مثال', '7300', 'SAR'],
          ['2026-08-12', 'PAY-101', 'دفعة مسجلة لدى الطرفين', '-5000', 'SAR'],
          ['2026-08-19', 'INV-003', 'فرق مبلغ يحتاج تحقق', '4000', 'SAR'],
          ['2026-08-25', 'INV-006', 'فاتورة مسجلة بالدفتر فقط', '1200', 'SAR'],
          [
            '2026-08-24',
            'INV-005',
            'أحد المرشحين لمطابقة غامضة',
            '2000',
            'SAR',
          ],
        ],
      },
    ],
  },
];
export const demoScope: Scope = {
  supplier: 'شركة المثال للتوريد (اصطناعية)',
  entity: 'شركة التدريب (اصطناعية)',
  account: 'حساب تجريبي 1001',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: false,
  coverageConfirmed: false,
};
export const demoMappings: [Mapping, Mapping] = ['45500', '42000'].map(
  (closing) => ({
    ...defaultMapping(),
    date: 0,
    reference: 1,
    description: 2,
    amount: 3,
    currencyColumn: 4,
    periodStart: '2026-08-01',
    opening: '20000',
    closing,
  }),
) as [Mapping, Mapping];
