// Arabic in the engine and interface source that is deliberately not given an
// English form, by reason. Everything else the engine writes is a message the
// interface can show, and must have an entry in lib/i18n/engine-catalog.ts.
export const NOT_SHOWN: Record<string, string[]> = {
  // The synthetic sample documents are data, like the accountant's own files:
  // their descriptions, headings and party names are never translated.
  sampleData: [
    'التاريخ',
    'المرجع',
    'الوصف',
    'المبلغ',
    'العملة',
    'توريد مواد — مثال',
    'فاتورة خدمات — مثال',
    'دفعة مسجلة لدى الطرفين',
    'إشعار دائن يحتاج متابعة',
    'فاتورة بمبلغ مختلف',
    'فاتورة لم يوجد مقابلها',
    'مرجع مكرر في المصدر',
    'بند مكرر محتمل — لا يحذف',
    'فرق مبلغ يحتاج تحقق',
    'فاتورة مسجلة بالدفتر فقط',
    'أحد المرشحين لمطابقة غامضة',
    'شركة المثال للتوريد (اصطناعية)',
    'شركة التدريب (اصطناعية)',
    'حساب تجريبي 1001',
  ],
  // Headings the engine looks for when it reads a statement. They describe the
  // source file, not the interface, and must match Arabic documents.
  sourceVocabulary: [
    'المورد',
    'اسم المورد',
    'العميل',
    'اسم العميل',
    'الكيان القانوني',
    'المنشأة المشترية',
    'حساب المورد',
    'رقم حساب المورد',
    'حساب العميل',
    'رقم حساب العميل',
    'رمز المورد',
    'حساب مراقبة الموردين',
    'العملة',
    'عملة الكشف',
    'تاريخ القطع',
    'نهاية الفترة',
    'تاريخ نهاية الفترة',
    'حتى تاريخ',
    'الفترة',
    'فترة الكشف',
    'فترة التقرير',
    // Sheets and headings of an exported Tarasuf workpaper, recognised when a
    // workpaper is uploaded again.
    'صف المصدر',
    'عمود ${…}',
    'الرمز',
    'التفسير',
    'حركات المصدر',
    'الحقل',
    'القيمة',
    // Prefixes the engine uses to recognise its own reading notes.
    'نص يعبر حد عمود؛',
    'خلية مدمجة في ',
  ],
  // The exported workpaper is an Arabic audit record that an independent
  // verifier reads back; its headings are content, not interface.
  workpaper: [
    'Field / الحقل',
    'Value / القيمة',
    'الطرف',
    'سبب الاستبعاد',
    'المحتوى',
    'تحذيرات المورد',
    'تحذيرات الدفتر',
    'حفظ البيانات',
    'تُحفظ البيانات في ملف Excel الذي يختار المستخدم تصديره، ولا تُحفظ على خادم.',
    'صف الاستخراج',
    'صفحة PDF',
    'المحتوى المستخرج',
    'عمود المصدر',
    'نص القارئ',
    'ترتيب الحروف في المصدر',
    'القيمة المستخدمة',
    'قاعدة التحقق',
    'صف العنوان المدمج',
    'سطر العنوان الأصلي',
    'نص العنوان الأصلي',
    'المعرف',
    'الورقة',
    'المرجع الأصلي',
    'المرجع الموحد',
    'المبلغ الموحد',
    'المبلغ الأصلي',
    'صفحة PDF الأصلية',
  ],
  // Questions the optional on-device model is routed to. They select an
  // answer; the reader never sees them.
  assistantRouting: [
    'فرق الأرصدة',
    'ما الذي لم يتم التأكد منه؟',
    'ماذا أراجع الآن؟',
    'شرح',
  ],
  // The note recorded in the audit trail when a comparison runs. It is saved
  // in the session file and the workpaper, which stay in Arabic.
  auditRecord: [
    'تأكيد الإعدادات وتشغيل المقارنة: حتى ${…}، ${…}، فرق الأيام المسموح ${…}',
  ],
};
