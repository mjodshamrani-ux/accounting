import type { Lang } from './language';
const copy = {
  ar: {
    open: 'بدء تخصيص دفعات مستقل',
    requiresSources: 'تحتاج الإحالة إلى ملفي مصدر مرفوعين ومحفوظين ببصماتهما. يمكنك الدخول مباشرة إلى تخصيص الدفعات من قائمة المجالات.',
    title: 'سياق إحالة إلى تخصيص مستقل',
    intro:
      'الأسماء والبصمات التالية تخص مصادر المقارنة، وهي سياق للمراجعة فقط. لم تُنقل ملفات أو مبالغ أو حركات أو قرارات اعتماد إلى سجل التخصيص.',
    nextStep:
      'ارفع أصول الدفعات المتاحة والفواتير المفتوحة وإشعار التخصيص، ثم راجع معنى اللقطة والقراءات والنطاق قبل اتخاذ قرار جديد.',
    provenance:
      'قيم النطاق المعروضة تلميحات غير مؤكدة. دفتر الأستاذ فارغ ويتطلب تحديداً مستقلاً. هذه الإحالة لا تثبت مبلغاً متاحاً أو رصيد فاتورة مفتوحاً.',
    cancel: 'إلغاء العملية الجارية',
  },
  en: {
    open: 'Start independent payment allocation',
    requiresSources: 'This handoff needs two uploaded source files with retained fingerprints. You can open payment allocation directly from the domain menu.',
    title: 'Context for an independent allocation workflow',
    intro:
      'These names and hashes identify comparison sources for review context only. No files, amounts, movements or approval decisions were transferred into the allocation ledger.',
    nextStep:
      'Upload the original available payments, open invoices and remittance advice, then review the snapshot meaning, readings and scope before making a new decision.',
    provenance:
      'The displayed scope values are unconfirmed hints. The ledger is blank and requires an independent choice. This handoff establishes no available payment amount or open invoice capacity.',
    cancel: 'Cancel current operation',
  },
};
export const allocationWorkflowHandoffCopy = (lang: Lang) => copy[lang];
