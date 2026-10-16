export const inventoryPdfCopy = {
  ar: {
    detected: 'سجل PDF نصي مع مصادر الصفحات والحقول',
    original: 'تنزيل PDF الأصلي',
    exportNote: 'ملف Excel يتضمن الأصول وأدلة المراجعة كاملة',
    preview: 'النص ومواقع المصدر',
    previewHeaders: ['الصفحة', 'السطر', 'الدور', 'النص الأصلي'],
    fields: 'مصادر حقول PDF',
    fieldsHeaders: [
      'معرف السجل',
      'الصفحة',
      'السطر',
      'صف المصدر',
      'الحقل',
      'النص الأصلي',
    ],
    links: 'روابط الخريطة والسياسة والأستاذ',
    linkHeaders: ['معرف السجل', 'دور المصدر', 'معرف العضو', 'دليل الربط مكتمل'],
    controls: 'مجاميع الصفحات والتقرير',
    controlHeaders: [
      'نوع المجموع',
      'الصفحة',
      'المبلغ المقدم بوحدات صغرى',
      'المبلغ المحسوب بوحدات صغرى',
    ],
    diagnostics: 'ملاحظات قراءة PDF',
    diagnosticHeaders: ['الصفحة', 'السطر', 'رمز الملاحظة'],
    page: 'الصفحة',
    failed: 'لم تكتمل العملية ولم تصدر نتيجة جديدة راجع المصدر أو أعد المحاولة',
  },
  en: {
    detected: 'Native-text PDF register with page and field sources',
    original: 'Download original PDF',
    exportNote:
      'Excel includes the complete source originals and review evidence',
    preview: 'Source text and locations',
    previewHeaders: ['Page', 'Line', 'Role', 'Original text'],
    fields: 'PDF field sources',
    fieldsHeaders: [
      'Record ID',
      'Page',
      'Line',
      'Source row',
      'Field',
      'Original text',
    ],
    links: 'Mapping policy and GL links',
    linkHeaders: [
      'Register ID',
      'Source role',
      'Member ID',
      'Link evidence complete',
    ],
    controls: 'Page and report totals',
    controlHeaders: [
      'Total kind',
      'Page',
      'Supplied minor',
      'Calculated minor',
    ],
    diagnostics: 'PDF reading observations',
    diagnosticHeaders: ['Page', 'Line', 'Issue code'],
    page: 'Page',
    failed:
      'Processing did not finish and no new result was issued. Review the source or try again.',
  },
};
const reasons: Record<string, [string, string]> = {
  PAGE_SEQUENCE: [
    'تسلسل الصفحات ناقص أو مكرر',
    'The page sequence is incomplete or duplicated',
  ],
  CONTINUATION: [
    'دليل استمرار القسم بين الصفحات غير مكتمل',
    'Section continuation evidence is incomplete',
  ],
  MISSING_FIELD: [
    'حقل لازم مفقود من السجل',
    'A required register field is missing',
  ],
  UNCLASSIFIED_ROW: [
    'سطر لم يحسم دوره في المصدر',
    'A source line has an unresolved role',
  ],
  REPORT_END: ['نهاية التقرير غير مثبتة', 'The report ending is not evidenced'],
  PAGE_TOTAL: [
    'إجمالي الصفحة لا يطابق تفاصيلها',
    'The page total differs from its details',
  ],
  REPORT_TOTAL: [
    'إجمالي التقرير لا يطابق تفاصيله',
    'The report total differs from its details',
  ],
  SCOPE_CONFLICT: ['تعارض في نطاق المصدر', 'Source scope values conflict'],
  PRECISION: [
    'الكمية لا تتفق مع الدقة المقدمة',
    'The quantity does not follow its supplied precision',
  ],
  HEADER_DIMENSIONS: [
    'أبعاد رأس القسم غير مكتملة',
    'Section header dimensions are incomplete',
  ],
  REPORT_ID: [
    'هوية التقرير تتغير بين الصفحات',
    'Report identity changes between pages',
  ],
  LITERAL_GAP: [
    'المسافة المرئية لا تثبت حروف الحقل',
    'Visual spacing does not prove literal field text',
  ],
};
export function inventoryPdfIssue(lang: 'ar' | 'en', code: string) {
  const reason = reasons[code]?.[lang === 'ar' ? 0 : 1];
  return reason ? reason + ' · ' + code : code;
}
