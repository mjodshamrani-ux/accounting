// V1.1 coverage matrix: one row per original catalogue ID (catalog.mjs keeps
// the IDs and titles of TARASUF-HARD-CASES-CAMPAIGN.ar.md; nothing is merged
// or renamed). Each row answers the five questions of the V1.1 brief:
//   test     what exercises it:
//              scenario       generated supplier-path cases (scenarios.mjs)
//              composite-pdf  printed PDFs verified independently (pdf-composite.mjs)
//              fixed-test     a named test in tests/
//              existing-tests older product tests, not re-measured in V1.1
//              spike          a prototype on a spike branch, not the product
//              none           nothing
//   proves   capability     the required judgement itself (which may be a
//                           required refusal, e.g. G04 "no approval")
//            safe-refusal   only that an unbuilt capability does no harm
//            not-measured   nothing measured in this round
//   product  production | experimental (spike only) | unimplemented |
//            unverified (untested: whether the product handles it is unknown)
//   scope    full | partial | none — against the original input and judgement
//   gap      the parts of the original specification left untested
// Unaided versus assisted is not written here: coverage-report.mjs reads it
// from the measured summaries, per template.
import { CATALOG } from './catalog.mjs';

const R = (id, test, proves, product, scope, gap, templates = []) => ({
  id,
  test,
  proves,
  product,
  scope,
  gap,
  templates,
});
const spikeA =
  'نموذج على spike/payment-allocation (e34f8d9) فقط؛ لا مسار تخصيص في المنتج ولا قياس له هنا.';
const bank = 'لا مسار تسوية بنكية في المنتج؛ البنك ليس موردًا. لا اختبار.';
const tb =
  'نموذج على spike/gl-trial-balance (dba761c) فقط؛ لا نموذج أرصدة في المنتج.';
const old = 'اختبارات قائمة من جولات سابقة؛ لم يُعد قياسها في V1.1.';

export const COVERAGE = [
  // ---------------------------------------------------------------- grouping
  R(
    'G01',
    'scenario',
    'capability',
    'production',
    'partial',
    'اتساق النطاق (الكيان والعملة) داخل المجموعة غير مولَّد؛ المقيس الهوية الصريحة وغيابها وتعارضها.',
    ['G01-payment-1n', 'C03-voucher-with-group'],
  ),
  R(
    'G02',
    'scenario',
    'capability',
    'production',
    'partial',
    'يُقاس كل اتجاه منفردًا؛ لا مقارنة آلية بين نتيجتي G01 وG02 للحقيقة نفسها.',
    ['G02-payment-n1'],
  ),
  R(
    'G03',
    'scenario',
    'safe-refusal',
    'unimplemented',
    'none',
    'قدرة N:M نفسها غير منفذة ولا مختبرة؛ عدم اعتماد N:M رفض آمن وليس دعمًا.',
    ['G03-payment-nm'],
  ),
  R('G04', 'scenario', 'capability', 'production', 'full', '—', [
    'G04-sum-no-identity',
  ]),
  R(
    'G05',
    'scenario',
    'capability',
    'production',
    'partial',
    'المجموعتان المتنافستان في اليوم نفسه؛ لم يُولَّد إغراء أقرب تاريخ أو ترتيب الصفوف صراحةً.',
    ['G05-competing-sums'],
  ),
  R(
    'G06',
    'scenario',
    'capability',
    'production',
    'partial',
    'لا صف غريب بقيمة الجزء المفقود خارج المجموعة يغري بالاستكمال.',
    ['G06-missing-part'],
  ),
  R(
    'G07',
    'scenario',
    'capability',
    'production',
    'partial',
    'السطر الزائد مقيس؛ الأجزاء المتعارضة داخل المجموعة مقيسة في G01/G02 (conflicting-identity) لا هنا.',
    ['G07-extra-member'],
  ),
  R('G08', 'scenario', 'capability', 'production', 'full', '—', [
    'G08-two-dates',
    'C02-two-dates-repeated-headers',
    'H01-two-day-vendor-payments',
  ]),
  R('G09', 'scenario', 'capability', 'production', 'full', '—', [
    'G09-equal-parts',
  ]),
  R(
    'G10',
    'scenario',
    'capability',
    'production',
    'partial',
    'مجموعة عند حد الحجم وأخرى تتجاوزه غير مولَّدتين؛ المقيس عضو مستبعد بتاريخ بعد القطع.',
    ['G10-excluded-member'],
  ),
  // --------------------------------------------------------------- references
  R('R01', 'scenario', 'capability', 'production', 'full', '—', [
    'R01-voucher-and-reference',
    'H06-kept-evidence-arabic',
  ]),
  R(
    'R02',
    'scenario',
    'capability',
    'production',
    'full',
    'Batch محفوظ بمصدره؛ واختياره مرجعًا مرفوض دليلًا (tests/reference-interactions.test.ts).',
    ['R02-batch-kept', 'H06-kept-evidence-arabic'],
  ),
  R(
    'R03',
    'scenario',
    'capability',
    'production',
    'partial',
    'فاتورة وأمر شراء وقيد في الصف نفسه؛ الإيصال ومرجع البنك معهما في الصف نفسه غير مولَّدين.',
    [
      'R03-reference-types',
      'G11-invoice-lines',
      'H03-document-no-vs-chosen-reference',
      'H05-order-number-as-document',
    ],
  ),
  R(
    'R04',
    'scenario',
    'capability',
    'production',
    'partial',
    'حالة التصدير التي تثبت تكافؤ 000123 و123 غير مولَّدة؛ المقيس عدم الاعتماد دون إثبات.',
    ['R04-leading-zeros'],
  ),
  R(
    'R05',
    'scenario',
    'capability',
    'production',
    'partial',
    'النسخة الرقمية التي فقدت دقتها قبل الاستيراد غير مولَّدة.',
    ['R05-long-numeric'],
  ),
  R(
    'R06',
    'scenario',
    'capability',
    'production',
    'partial',
    'الشرطة وحالة الأحرف مقيستان؛ INV-01 مقابل INV-001 غير مولَّد.',
    ['R06-lookalike'],
  ),
  R(
    'R07',
    'scenario',
    'safe-refusal',
    'unimplemented',
    'partial',
    'استخراج مرشح من البيان بموضعه ونوعه غير منفذ؛ المقيس أن البيان لا يعتمد دليلًا.',
    ['R07-reference-in-text'],
  ),
  R(
    'R08',
    'composite-pdf',
    'safe-refusal',
    'unimplemented',
    'partial',
    'الضم البنيوي لمرجع منقسم على سطرين غير منفذ في PDF (يتوقف)؛ فقد البادئة في تصدير CSV/XLSX غير مولَّد.',
  ),
  R(
    'R09',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'النطاق مورد واحد في كل تشغيل؛ تكرار الرقم عبر جهات أو سنوات غير مختبر.',
  ),
  R(
    'R10',
    'scenario',
    'capability',
    'production',
    'partial',
    'N/A فقط؛ الخلايا الفارغة والصفر وNOTPROVIDED والأحرف التالفة غير مولَّدة في هذه الحملة.',
    ['R10-placeholders'],
  ),
  // ---------------------------------------------------------- types and codes
  R(
    'T01',
    'scenario',
    'capability',
    'production',
    'partial',
    'التوحيد بمفردات ثابتة في المنتج (DOCUMENT_LABELS)، لا بتوثيق تقرير بعينه؛ النص الأصلي محفوظ.',
    [
      'T01-type-synonyms',
      'C01-group-with-type-synonym',
      'H02-arabic-invoice-lines',
    ],
  ),
  R(
    'T02',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا مسار عملاء أو بنوك؛ اتجاه الإشارة ثابت في مسار الموردين.',
  ),
  R(
    'T03',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا قاموس أكواد خاص بالجهة أو التقرير؛ لا يُدّعى حل أكواد الجهات.',
  ),
  R(
    'T04',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا قاموس أكواد خاص بالجهة؛ انتقال المعنى بين الجهات غير مختبر.',
  ),
  R(
    'T05',
    'scenario',
    'capability',
    'production',
    'full',
    'الكود المجهول يبقى مجهولًا (tests/reference-interactions.test.ts أيضًا).',
    ['T05-unknown-code'],
  ),
  R(
    'T06',
    'scenario',
    'capability',
    'production',
    'full',
    'ومعه: Type = Invoice مع بيان يبدأ Tax Credit Note أو Vendor Payment (tests/reference-interactions.test.ts).',
    ['T06-type-conflict', 'H04-description-role'],
  ),
  R(
    'T07',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا قوالب تقارير بإصدارات.',
  ),
  R('T08', 'scenario', 'capability', 'production', 'full', '—', [
    'T08-description-only',
  ]),
  R(
    'T09',
    'spike',
    'not-measured',
    'experimental',
    'none',
    'قرارات المنتج اليدوية 1:1؛ قرار على عدة أسطر نموذج على spike (e34f8d9) فقط.',
  ),
  R(
    'T10',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا آلية تعريف أكواد.',
  ),
  // --------------------------------------------------------------- allocation
  ...['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'].map(
    (id) =>
      ['A07', 'A10'].includes(id)
        ? R(
            id,
            'none',
            'not-measured',
            'unimplemented',
            'none',
            id === 'A07'
              ? 'لا هوية قرار أو سياسة إعادة تطبيق، ولا في النموذج.'
              : 'لا سحب قرار تخصيص، ولا في النموذج.',
          )
        : R(id, 'spike', 'not-measured', 'experimental', 'none', spikeA),
  ),
  // -------------------------------------------------------------------- bank
  ...['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map(
    (id) => R(id, 'none', 'not-measured', 'unimplemented', 'none', bank),
  ),
  // ---------------------------------------------------- source meaning, balances
  R('Q01', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'Q02',
    'spike',
    'not-measured',
    'experimental',
    'none',
    'القارئ يحفظ كمية واحدة؛ الثلاثة معًا نموذج على spike فقط.',
  ),
  R('Q03', 'existing-tests', 'not-measured', 'production', 'partial', old),
  ...['Q04', 'Q05', 'Q06', 'Q07', 'Q08'].map((id) =>
    R(id, 'spike', 'not-measured', 'experimental', 'none', tb),
  ),
  R('Q09', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'Q10',
    'none',
    'not-measured',
    'unimplemented',
    'none',
    'لا دليل Ledger أو حالة ترحيل في النموذج.',
  ),
  // ---------------------------------------------------- numbers, dates, text
  R(
    'N01',
    'scenario',
    'capability',
    'production',
    'partial',
    'CSV/XLSX مقيسان؛ في PDF (نمط ARABIC) يتوقف المنتج: رفض آمن لا قراءة.',
    ['N01-arabic-digits'],
  ),
  R(
    'N02',
    'scenario',
    'capability',
    'production',
    'full',
    'يتوقف دون مساعدة، ويُقرأ بعد اختيار معلن.',
    ['N02-ambiguous-number'],
  ),
  R('N03', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'N04',
    'scenario',
    'capability',
    'production',
    'partial',
    'الأقواس فقط؛ DR/CR والناقص اللاحق وصيغة غير مفهومة غير مولَّدة.',
    ['N04-parentheses'],
  ),
  R(
    'N05',
    'scenario',
    'capability',
    'production',
    'partial',
    '0 و3 منازل؛ حدود overflow والقيم القريبة من أصغر وحدة غير مولَّدة.',
    ['N05-precision'],
  ),
  R('N06', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'N07',
    'scenario',
    'capability',
    'production',
    'full',
    'يتوقف دون مساعدة، ويُقرأ بعد اختيار معلن.',
    ['N07-ambiguous-date'],
  ),
  R(
    'N08',
    'scenario',
    'capability',
    'production',
    'partial',
    '30 فبراير فقط؛ قيمة تاريخ ناقصة غير مولَّدة.',
    ['N08-invalid-date'],
  ),
  R('N09', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'N10',
    'none',
    'not-measured',
    'unverified',
    'none',
    'محارف خفية واتجاه نص في المراجع غير مولَّدة.',
  ),
  // ---------------------------------------------------- XLSX / CSV
  R('F01', 'scenario', 'capability', 'production', 'full', '—', [
    'F01-column-order',
  ]),
  R(
    'F02',
    'none',
    'not-measured',
    'unverified',
    'none',
    'العارض لا يكتب عناوين مدمجة متعددة الصفوف.',
  ),
  R(
    'F03',
    'scenario',
    'capability',
    'production',
    'partial',
    'CSV/XLSX مقيسة؛ في PDF (نمط REPEAT) تُقرأ الحالتان القابلة للحل والمتعارضة ويتوقف المنتج في «غير الكافية».',
    ['F03-structure-rows', 'C02-two-dates-repeated-headers'],
  ),
  R('F04', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R('F05', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R('F06', 'scenario', 'capability', 'production', 'full', '—', [
    'F06-extra-sheet',
  ]),
  R(
    'F07',
    'scenario',
    'capability',
    'production',
    'partial',
    'الفاصلة المنقوطة والفواصل المقتبسة؛ Tab والأسطر الجديدة داخل الخلية غير مولَّدة.',
    ['F07-delimiters'],
  ),
  R(
    'F08',
    'none',
    'not-measured',
    'unverified',
    'none',
    'BOM والترميز غير المدعوم غير مولَّدين.',
  ),
  R(
    'F09',
    'scenario',
    'capability',
    'production',
    'partial',
    'عمود المبلغ المفقود فقط؛ عدد أعمدة غير متسق وعنوان دليل مكرر غير مولَّدين.',
    ['F09-missing-amount'],
  ),
  R(
    'F10',
    'scenario',
    'capability',
    'production',
    'partial',
    'ملف تالف فقط؛ الملف المشفر والأرشيف فوق الحدود غير مولَّدين هنا.',
    ['F10-corrupt'],
  ),
  // ---------------------------------------------------- PDF
  R(
    'P01',
    'composite-pdf',
    'safe-refusal',
    'unimplemented',
    'partial',
    'الضم البنيوي لصف متعدد الأسطر غير منفذ؛ في SPLITREF وCROSSPAGE يتوقف المنتج ولا يخترع عملية.',
  ),
  R(
    'P02',
    'composite-pdf',
    'safe-refusal',
    'unimplemented',
    'partial',
    'كشف متعدد الصفحات بصفوف كاملة يُقرأ (final-b)؛ عملية تنقسم بين صفحتين (CROSSPAGE، مثبت انقسامها في الملف) يتوقف عندها المنتج: رفض آمن، لا حل.',
  ),
  R(
    'P03',
    'composite-pdf',
    'capability',
    'production',
    'partial',
    'ترويسات متكررة (REPEAT) مقيسة؛ عدم توريث موافقة قديمة إلى استخراج جديد في اختبارات قائمة لم يُعد قياسها.',
  ),
  R(
    'P04',
    'composite-pdf',
    'safe-refusal',
    'unimplemented',
    'partial',
    'ملفات عربية مثبتة مستقلًا ومعاينة بصريًا؛ المنتج يتوقف (فصل محارف RTL ودمج أعمدة): لا قراءة.',
  ),
  R(
    'P05',
    'existing-tests',
    'not-measured',
    'production',
    'partial',
    'اختبارات قائمة لطبقة النص؛ أضيف في V1.1 اختبار عكسي للخطوط الرفيعة فقط.',
  ),
  R(
    'P06',
    'existing-tests',
    'not-measured',
    'production',
    'partial',
    'قطع المرجع على مستوى المحارف لم يُولَّد؛ SPLITREF انقسام على سطرين لا قطع محارف.',
  ),
  R(
    'P07',
    'composite-pdf',
    'safe-refusal',
    'unimplemented',
    'partial',
    'المنتج لا يعلن الاكتمال (لا يتحقق حساب الرصيد)، لكنه لا يكتشف الصفحة الناقصة أو المكررة من ترقيم الصفحات.',
  ),
  R(
    'P08',
    'none',
    'not-measured',
    'unverified',
    'none',
    'جدولان في صفحة غير مولَّدين؛ TWOREF عمودا مرجع لا جدولان.',
  ),
  R(
    'P09',
    'existing-tests',
    'not-measured',
    'experimental',
    'partial',
    'لا ملفات ممسوحة في V1.1؛ OCR لا يعتمد آليًا.',
  ),
  R('P10', 'existing-tests', 'not-measured', 'production', 'partial', old),
  // ---------------------------------------------------- system
  R('S01', 'fixed-test', 'capability', 'production', 'full', '—'),
  R('S02', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R('S03', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'S04',
    'existing-tests',
    'not-measured',
    'production',
    'partial',
    'فحص من الأصول في اختبارات قائمة؛ في V1.1 رفض الجلسات السابقة للإصدار 0.3.16 فقط.',
  ),
  R('S05', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'S06',
    'fixed-test',
    'capability',
    'production',
    'partial',
    'بوابة الانتقال بين الإصدارات تتحقق مستقلًا من الخلايا؛ نص يبدأ بعلامة صيغة في اختبارات قائمة.',
  ),
  R('S07', 'existing-tests', 'not-measured', 'production', 'partial', old),
  R(
    'S08',
    'fixed-test',
    'capability',
    'production',
    'partial',
    'الملف نفسه باسم آخر أو تعيين آخر أو استعادة مقيس (tests/same-source.test.ts)؛ نسختان متداخلتان من التقرير في ملفين مختلفين لا تُكشفان.',
  ),
  R(
    'S09',
    'fixed-test',
    'capability',
    'production',
    'partial',
    'audit/hard-cases/scale.mjs من V1؛ لم يُعد تشغيله في V1.1.',
  ),
  R(
    'S10',
    'none',
    'not-measured',
    'unverified',
    'none',
    'إلغاء العامل غير ممارس في اختبارات Node.',
  ),
];

const ids = CATALOG.map((c) => c.id);
if (COVERAGE.length !== ids.length || COVERAGE.some((c, i) => c.id !== ids[i]))
  throw new Error('coverage must list every catalogue ID, in catalogue order');
