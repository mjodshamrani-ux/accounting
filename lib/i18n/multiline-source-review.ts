const demoSources = {
  en: 'Invoice number: INV-412\nPurchase order: PO-999\nDue date: 2026-10-15\nQuantity: 99\nUnit price: 0.01 SAR\nSubtotal: 100.00 SAR\nVAT: 15.00 SAR\nIssue date: 2026-09-12\nInvoice total: SAR 115.00\n',
  ar: 'رقم أمر الشراء: PO-777\nتاريخ الاستحقاق: 2026-10-16\nالكمية: 50\nسعر الوحدة: 2.00 ريال سعودي\nالمجموع الفرعي: 100.00 ريال سعودي\nضريبة القيمة المضافة: 15.00 ريال سعودي\nرقم الفاتورة: INV-413\nتاريخ الإصدار: 2026-09-13\nإجمالي الفاتورة: ريال سعودي 115.00\n',
};
export function multilineSourceReviewDemo(lang: 'ar' | 'en'): string {
  return demoSources[lang];
}

const copy = {
  toggle: ['مراجعة تفسير المصدر', 'Source interpretation review'],
  intro: [
    'مراجعة محدودة لفاتورة نصية واحدة بعملة الريال السعودي. ينتج التطبيق نسخة CSV مشتقة للتطوير بعد قرار مراجعة منفصل.',
    'A bounded review of one text invoice in Saudi riyals. Apply produces a derived development CSV after a separate review decision.',
  ],
  boundary: [
    'هذه مراجعة لتفسير المصدر، وليست اعتماداً مالياً أو نتيجة مطابقة. يبقى الملف المشتق منفصلاً عن ملفات المقارنة.',
    'This reviews source interpretation and grants no financial approval or reconciliation result. The derived file remains separate from comparison sources.',
  ],
  bounds: [
    'ملف TXT بترميز UTF-8 حتى 8192 بايتاً. يلزم رقم فاتورة وتاريخ إصدار وإجمالي موجب صريح بعملة SAR، بأسطر مسماة عربية أو إنجليزية. تاريخ الاستحقاق وأمر الشراء والكمية وسعر الوحدة لا يحلّون محل هذه الحقول.',
    'UTF-8 TXT up to 8192 bytes. Requires a supplied invoice number, issue date and positive SAR total in labeled Arabic or English lines. Due date, purchase order, quantity and unit price do not replace these fields.',
  ],
  file: ['اختر نص الفاتورة الأصلي', 'Choose original invoice text'],
  demo: [
    'افتح مثالاً اصطناعياً لمراجعة المصدر',
    'Open a synthetic source review example',
  ],
  synthetic: [
    'مثال اصطناعي؛ ليس دليلاً أو مراجعة بشرية ميدانية.',
    'Synthetic example; no field evidence or human trial.',
  ],
  empty: [
    'اختر ملفاً نصياً أو افتح المثال الاصطناعي.',
    'Choose a text file or open the synthetic example.',
  ],
  reading: [
    'جار قراءة المصدر؛ لم يُسجَّل قرار مراجعة.',
    'Reading the source; no review decision recorded.',
  ],
  candidate: [
    'تفسير مرشح يحتاج إلى مراجعتك',
    'Candidate interpretation needs your review',
  ],
  question: [
    'يلزم توضيح أدوار الفاتورة قبل التطبيق.',
    'Invoice roles need clarification before Apply.',
  ],
  abstain: [
    'تعذرت قراءة هذا النص ضمن الأسرة المحددة.',
    'This text cannot be read within the bounded family.',
  ],
  approved: [
    'قُبل تفسير المصدر فقط بقرار المراجع المسجل.',
    'Source interpretation accepted by the recorded reviewer decision only.',
  ],
  rejected: [
    'رفض المراجع تفسير المصدر؛ التطبيق غير متاح.',
    'Reviewer rejected the interpretation; Apply is unavailable.',
  ],
  applying: [
    'جار إعادة القراءة والتحقق من الملف المشتق.',
    'Rereading and checking the derived file.',
  ],
  applied: [
    'جهزت نسخة CSV مشتقة للتطوير؛ لم تُحمَّل في المقارنة.',
    'Derived development CSV is ready; it has not been loaded into comparison.',
  ],
  original: [
    'النص الأصلي مع استشهادات القيمة والدور',
    'Original text with value and role citations',
  ],
  value: ['القيمة الحرفية', 'Literal value'],
  role: ['تسمية الدور', 'Role label'],
  include: ['إدراج الحقل', 'Include field'],
  fields: ['حقول التفسير المرشح', 'Candidate interpretation fields'],
  incomplete: [
    'أعد إدراج الحقول الأربعة الصريحة لتقديمها للمراجعة.',
    'Include all four explicit fields to submit them for review.',
  ],
  evidence: ['أدلة المصدر', 'Source evidence'],
  hash: ['بصمة بايتات المصدر الأصلي', 'Original source byte hash'],
  revision: ['نسخة قراءة المصدر', 'Source reading version'],
  spans: [
    'مواضع القيمة والدور في النص',
    'Value and role positions in the text',
  ],
  reread: ['أعد قراءة المصدر', 'Read source again'],
  clear: ['إلغاء المراجعة', 'Cancel review'],
  reviewer: ['اسم المراجع أو تسميته', 'Reviewer name or label'],
  rationale: ['تعليل قرار المراجعة', 'Review decision rationale'],
  acknowledge: [
    'راجعت القيم المظللة وتسميات أدوارها في النص الأصلي.',
    'I inspected the highlighted values and their role labels in the original text.',
  ],
  accept: ['قبول تفسير المصدر', 'Accept source interpretation'],
  reject: ['رفض تفسير المصدر', 'Reject source interpretation'],
  apply: ['تطبيق على نسخة CSV مشتقة', 'Apply to a derived CSV'],
  download: ['تنزيل CSV مشتق للتطوير', 'Download development derived CSV'],
  result: [
    'القراءة المثبتة للنسخة المشتقة',
    'Verified reading of the derived copy',
  ],
  minor: ['المبلغ بوحداته الصغرى من القارئ', 'Reader amount in minor units'],
  editInvalidation: [
    'تغيير النص أو إعادة قراءته أو اختيار الحقول أو بيانات المراجع يلغي القرار السابق.',
    'Changing the text, rereading it, changing field selection or reviewer details revokes the previous decision.',
  ],
} as const;
const names = {
  date: ['تاريخ الإصدار', 'Issue date'],
  reference: ['رقم الفاتورة', 'Invoice number'],
  amount: ['إجمالي الفاتورة', 'Invoice total'],
  currency: ['عملة الإجمالي', 'Total currency'],
} as const;
const reasons: Record<string, [string, string]> = {
  'missing-role': [
    'دور فاتورة أساسي مفقود. قدم تاريخ إصدار ورقم فاتورة وإجمالياً صريحاً.',
    'A required invoice role is missing. Supply an explicit issue date, invoice number and total.',
  ],
  'competing-role': [
    'ورد أكثر من دور أساسي أو إجمالي؛ يلزم توضيح المصدر.',
    'Competing required roles or totals need source clarification.',
  ],
  'unsupported-line': [
    'يتضمن النص سطراً أو مسافات غير معترف بها. استخدم الأسطر المسماة المدعومة.',
    'The text contains an unrecognized line or spacing. Use supported labeled lines.',
  ],
  'unsupported-currency': [
    'يتضمن النص عملة غير مدعومة أو عملات متعددة.',
    'The text contains an unsupported currency or multiple currencies.',
  ],
  'invalid-date': [
    'تاريخ غير صالح أو خارج النطاق 1900–2100.',
    'A date is invalid or outside 1900–2100.',
  ],
  'invalid-value': [
    'قيمة غير صالحة ضمن صيغ الحقول المحددة.',
    'A value does not match the bounded field formats.',
  ],
  'invalid-encoding': [
    'يجب تقديم بايتات UTF-8 صالحة.',
    'Supply valid UTF-8 bytes.',
  ],
  'source-bound': [
    'النص يتجاوز حدود الحجم أو الأسطر أو الترميز المسموح.',
    'The text exceeds the permitted size, line or encoding bounds.',
  ],
  'file-type': ['اختر ملفاً بامتداد TXT.', 'Choose a TXT file.'],
  'file-read': [
    'تعذرت قراءة الملف؛ اختره من جديد.',
    'The file could not be read; choose it again.',
  ],
  'replay-refused': [
    'رفض القارئ النسخة المشتقة؛ أعد قراءة المصدر ومراجعته.',
    'The reader refused the derived copy; reread and review the source.',
  ],
};
export function multilineSourceReviewCopy(lang: 'ar' | 'en') {
  const index = lang === 'ar' ? 0 : 1;
  return {
    ...(Object.fromEntries(
      Object.entries(copy).map(([key, values]) => [key, values[index]]),
    ) as Record<keyof typeof copy, string>),
    field: (field: keyof typeof names) => names[field][index],
    reason: (reason: string) =>
      (reasons[reason] ?? reasons['file-read'])[index],
  };
}
