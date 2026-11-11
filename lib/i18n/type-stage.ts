import type { ReconciliationDomain } from '@/lib/i18n/reconciliation-directory';

/**
 * The type stage (UX-7): the two papers of the intro wear the roles of the
 * chosen reconciliation type. Each role is named as the workspace names its
 * own file input, and accepts what that input accepts, in the order the
 * workspace shows its main sources. A unit test holds every name to the
 * workspace copy and a browser check holds names and formats to the inputs
 * as drawn, so the stage and the upload cards say the same words. The names
 * are repeated here, not imported, so the intro does not load the copy of
 * every workspace.
 */
export type StageRole = { name: string; accept: string };

const both = '.csv,.xlsx';

export const typeStageRoles: Record<
  'ar' | 'en',
  Record<ReconciliationDomain, StageRole[]>
> = {
  ar: {
    supplier: [
      { name: 'كشف المورد', accept: '.xlsx,.csv,.pdf' },
      { name: 'تقرير الحسابات الدائنة', accept: '.xlsx,.csv,.pdf' },
    ],
    ar: [
      { name: 'سجل ذمم العملاء', accept: both },
      { name: 'كشف العميل الصادر عن الشركة', accept: '.csv,.xlsx,.pdf' },
    ],
    intercompany: [
      { name: 'دفتر المنشأة اليسرى', accept: both },
      { name: 'دفتر المنشأة اليمنى', accept: both },
    ],
    bank: [
      { name: 'كشف البنك', accept: both },
      { name: 'دفتر النقدية', accept: both },
    ],
    clearing: [{ name: 'ملف حركات المقاصة', accept: both }],
    allocation: [
      { name: 'الدفعات المتاحة', accept: both },
      { name: 'الفواتير المفتوحة', accept: both },
    ],
    gateway: [
      { name: 'مبيعات ومرتجعات البوابة', accept: both },
      { name: 'ملخص تسوية البوابة', accept: both },
    ],
    'gl-tb': [
      { name: 'تفاصيل الأستاذ وأرصدته', accept: both },
      { name: 'مصدر ميزان المراجعة', accept: both },
    ],
    'tb-financial': [
      { name: 'ميزان المراجعة', accept: both },
      { name: 'قائمة المركز المالي', accept: both },
    ],
    stock: [
      { name: 'سجل المخزون المرحل', accept: '.csv,.xlsx,.pdf' },
      { name: 'أرصدة مخزون الأستاذ المحددة', accept: '.csv' },
    ],
    assets: [
      { name: 'سجل مكونات الأصول المرحل', accept: '.csv' },
      { name: 'أرصدة مكونات الأصول في الأستاذ المحددة', accept: '.csv' },
    ],
    payroll: [
      { name: 'مسير الموظفين المرحل', accept: '.csv' },
      { name: 'قيود الرواتب والصرف المرحلة المحددة', accept: '.csv' },
    ],
  },
  en: {
    supplier: [
      { name: 'Supplier statement', accept: '.xlsx,.csv,.pdf' },
      { name: 'Accounts payable report', accept: '.xlsx,.csv,.pdf' },
    ],
    ar: [
      { name: 'Company AR ledger', accept: both },
      { name: 'Company-issued customer statement', accept: '.csv,.xlsx,.pdf' },
    ],
    intercompany: [
      { name: 'Left entity ledger', accept: both },
      { name: 'Right entity ledger', accept: both },
    ],
    bank: [
      { name: 'Bank statement', accept: both },
      { name: 'Cashbook', accept: both },
    ],
    clearing: [{ name: 'Clearing movements file', accept: both }],
    allocation: [
      { name: 'Available payments', accept: both },
      { name: 'Open invoices', accept: both },
    ],
    gateway: [
      { name: 'Gateway sales and refunds', accept: both },
      { name: 'Gateway settlement summary', accept: both },
    ],
    'gl-tb': [
      { name: 'GL detail and balances', accept: both },
      { name: 'Trial balance source', accept: both },
    ],
    'tb-financial': [
      { name: 'Trial balance', accept: both },
      { name: 'Financial position', accept: both },
    ],
    stock: [
      { name: 'Posted inventory register', accept: '.csv,.xlsx,.pdf' },
      { name: 'Selected inventory GL balances', accept: '.csv' },
    ],
    assets: [
      { name: 'Posted asset component register', accept: '.csv' },
      { name: 'Selected asset GL balances', accept: '.csv' },
    ],
    payroll: [
      { name: 'Posted employee payroll register', accept: '.csv' },
      {
        name: 'Selected posted payroll and disbursement GL entries',
        accept: '.csv',
      },
    ],
  },
};

/** The formats of an input as its upload card writes them: "CSV / XLSX". */
export function acceptFormats(accept: string | undefined) {
  return (accept ?? '')
    .split(',')
    .map((format) => format.trim().replace(/^\./, '').toUpperCase())
    .filter(Boolean)
    .join(' / ');
}
