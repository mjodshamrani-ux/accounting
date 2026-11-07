import type { StripBetween, StripUnit } from '../alignment-strip.ts';

/**
 * Words of the alignment strip (UX-4). Counts stand after a label, as the
 * rest of the interface writes them, so no plural form is guessed. A gap is
 * the engine's signed amount, and its direction is the subtraction the
 * engine defines, written out; never "higher", which credit balances turn
 * around, and never an arrow, which the page direction turns around.
 */
export type AlignmentStripCopy = {
  name: string;
  agreed: string;
  review: string;
  /** In place of `review` where no decision is recorded in the workspace. */
  state: string;
  gap: string;
  units: Record<StripUnit, string>;
  of: (count: number, of: number) => string;
  mainReason: string;
  alone: string;
  whole: Record<'needs-review' | 'accepted' | 'rejected', [string, string]>;
  noDifference: string;
  compared: string;
  moreDifferences: string;
  notComputed: string;
  notComputedNote: string;
  blocked: string;
  between: Record<StripBetween, string>;
  names: Record<string, string>;
  /** One sentence for a screen reader, in the order the strip is read. */
  sentence: (parts: {
    sides: string;
    agreed: string;
    reviewLabel: string;
    review: string;
    gap: string;
  }) => string;
};

export const alignmentStripCopy: Record<'ar' | 'en', AlignmentStripCopy> = {
  ar: {
    name: 'شريط التراصف',
    agreed: 'تراصف',
    review: 'ينتظر قرارك',
    state: 'حالة النتيجة',
    gap: 'الفجوة',
    units: {
      case: 'حالات متطابقة',
      document: 'مستندات متطابقة',
      movement: 'حركات متطابقة',
      group: 'مجموعات صافيها صفر',
      link: 'روابط بقرار',
      field: 'حقول بلا فرق',
      pair: 'أزواج بلا باقٍ',
      account: 'حسابات بلا فرق',
      residual: 'بواقٍ صفرية',
      component: 'مكونات بلا فرق',
      comparison: 'مقارنات بلا فرق',
      line: 'بنود بلا فرق',
    },
    of: (count, of) => `${count} من ${of}`,
    mainReason: 'السبب الغالب',
    alone: 'بلا مقابل',
    whole: {
      'needs-review': ['النتيجة كلها', 'تنتظر قبولك أو رفضك'],
      accepted: ['لا شيء', 'قُبلت النتيجة بقرار مسجل'],
      rejected: ['لا شيء', 'رُفضت النتيجة بقرار مسجل'],
    },
    noDifference: 'لا فرق',
    compared: 'فيما قورن',
    moreDifferences: 'فروق أخرى في الجدول تحته',
    notComputed: 'لا يحسبها المحرك',
    notComputedNote: 'في هذه المقارنة',
    blocked: 'لم تُحسب',
    between: {
      'supplier-ledger': 'إقفال كشف المورد ناقص إقفال الدفتر',
      'ledger-tb': 'الأستاذ ناقص الميزان',
      'register-gl': 'السجل ناقص الأستاذ',
      'payroll-gl': 'المسير ناقص الأستاذ',
      'payroll-bank': 'صافي المسير ناقص الصرف البنكي',
      'computed-summary': 'المحسوب ناقص الملخص',
      'summary-bank': 'صافي الملخص ناقص إيداع البنك',
      'calculated-reported': 'المحسوب ناقص المقدم',
      'debit-credit': 'المدين ناقص الدائن',
      'clearing-net': 'المدين ناقص الدائن',
    },
    names: {
      closing: 'رصيد الإقفال',
      'account-net': 'صافي الحساب',
      net: 'الصافي',
      bank: 'الصرف البنكي',
      'trial-balance': 'الميزان',
      gross: 'المبيعات',
      refunds: 'المرتجعات',
      fees: 'الرسوم',
      payout: 'الإيداع',
    },
    sentence: ({ sides, agreed, reviewLabel, review, gap }) =>
      `${sides}. تراصف: ${agreed}. ${reviewLabel}: ${review}. الفجوة: ${gap}.`,
  },
  en: {
    name: 'Alignment strip',
    agreed: 'Aligned',
    review: 'Awaits your decision',
    state: 'Result status',
    gap: 'Gap',
    units: {
      case: 'Matched cases',
      document: 'Matched documents',
      movement: 'Matched movements',
      group: 'Groups that net to zero',
      link: 'Links by decision',
      field: 'Fields with no difference',
      pair: 'Pairs with no residual',
      account: 'Accounts with no difference',
      residual: 'Residuals at zero',
      component: 'Components with no difference',
      comparison: 'Comparisons with no difference',
      line: 'Lines with no difference',
    },
    of: (count, of) => `${count} of ${of}`,
    mainReason: 'Main reason',
    alone: 'Without a counterpart',
    whole: {
      'needs-review': ['Whole result', 'Waits for you to accept or reject it'],
      accepted: ['Nothing', 'Accepted by a recorded decision'],
      rejected: ['Nothing', 'Rejected by a recorded decision'],
    },
    noDifference: 'No difference',
    compared: 'In what was compared',
    moreDifferences: 'Other differences in the table below',
    notComputed: 'Not computed by the engine',
    notComputedNote: 'for this comparison',
    blocked: 'Not computed',
    between: {
      'supplier-ledger': 'Statement closing minus ledger closing',
      'ledger-tb': 'GL minus TB',
      'register-gl': 'Register minus GL',
      'payroll-gl': 'Register minus GL',
      'payroll-bank': 'Register net minus bank outflow',
      'computed-summary': 'Calculated minus summary',
      'summary-bank': 'Summary net minus bank credit',
      'calculated-reported': 'Calculated minus reported',
      'debit-credit': 'Debit minus credit',
      'clearing-net': 'Debit minus credit',
    },
    names: {
      closing: 'Closing balance',
      'account-net': 'Account net',
      net: 'Net',
      bank: 'Bank outflow',
      'trial-balance': 'Trial balance',
      gross: 'Gross sales',
      refunds: 'Refunds',
      fees: 'Fees',
      payout: 'Bank credit',
    },
    sentence: ({ sides, agreed, reviewLabel, review, gap }) =>
      `${sides}. Aligned: ${agreed}. ${reviewLabel}: ${review}. Gap: ${gap}.`,
  },
};
