// The 100 challenge specifications of the hard-case campaign, as data. Each
// entry records where the idea comes from and how this campaign executes it.
// `status` never counts a rejection of an unimplemented capability as coverage:
//   executable       — generated scenarios through the product supplier path
//                       (see scenarios.mjs `template`), before/after measured;
//   fixed-test        — a fixed test in tests/hard-cases.test.ts;
//   experimental      — a prototype exists on a spike branch only (not product);
//   no-product-path   — no path in the product; product coverage is zero;
//   deferred          — possible in the product path but not built this round.
// Provenance: owner-interview (relayed by the owner), repository-code,
// external-docs (the vendor documents cited in the campaign brief), counter-case
// (designed against the engine). No case is attributed to a real company.
const E = (id, title, provenance, status, detail = {}) => ({
  id,
  title,
  provenance,
  status,
  ...detail,
});
const g = (template, expect) => ({ template, expect, path: 'supplier' });

export const CATALOG = [
  // ---------------------------------------------------------------- grouping
  E(
    'G01',
    'دفعة واحدة في عدة أسطر',
    'owner-interview',
    'executable',
    g('G01-payment-1n', 'auto with explicit identity; review otherwise'),
  ),
  E(
    'G02',
    'التجميع في الاتجاه المعاكس',
    'counter-case',
    'executable',
    g('G02-payment-n1', 'same as G01, mirrored'),
  ),
  E(
    'G03',
    'تجزئة الطرفين N:M',
    'external-docs',
    'executable',
    g('G03-payment-nm', 'no approval: N:M has no product path'),
  ),
  E(
    'G04',
    'مجموع صحيح دون هوية',
    'owner-interview',
    'executable',
    g('G04-sum-no-identity', 'no approval'),
  ),
  E(
    'G05',
    'مجموعات منافسة',
    'counter-case',
    'executable',
    g('G05-competing-sums', 'no approval'),
  ),
  E(
    'G06',
    'جزء مفقود',
    'counter-case',
    'executable',
    g('G06-missing-part', 'difference visible, no approval'),
  ),
  E(
    'G07',
    'عضو زائد',
    'counter-case',
    'executable',
    g('G07-extra-member', 'difference visible, no approval'),
  ),
  E(
    'G08',
    'تواريخ أجزاء مختلفة',
    'counter-case',
    'executable',
    g(
      'G08-two-dates',
      'auto only with explicit identity inside the date window',
    ),
  ),
  E(
    'G09',
    'أجزاء متساوية مقابل تكرار',
    'counter-case',
    'executable',
    g(
      'G09-equal-parts',
      'auto with distinct entry ids; review for a duplicated line',
    ),
  ),
  E(
    'G10',
    'الحدود والاكتمال',
    'repository-code',
    'executable',
    g('G10-excluded-member', 'review when a member is excluded'),
  ),
  // --------------------------------------------------------------- references
  E(
    'R01',
    'المرجع المختار ورقم القيد',
    'repository-code',
    'executable',
    g(
      'R01-voucher-and-reference',
      'keep both values; match on the shared invoice reference',
    ),
  ),
  E(
    'R02',
    'حفظ Batch',
    'repository-code',
    'executable',
    g('R02-batch-kept', 'batch kept with its source; not acceptance evidence'),
  ),
  E(
    'R03',
    'عدة أنواع للمراجع',
    'counter-case',
    'executable',
    g(
      'R03-reference-types',
      'invoice number decides; a shared PO alone does not',
    ),
  ),
  E(
    'R04',
    'أصفار بادئة',
    'external-docs',
    'executable',
    g('R04-leading-zeros', 'no approval without proven equivalence'),
  ),
  E(
    'R05',
    'معرف طويل',
    'external-docs',
    'executable',
    g('R05-long-numeric', 'full text kept; auto when identical'),
  ),
  E(
    'R06',
    'تشابه لا يساوي هوية',
    'counter-case',
    'executable',
    g('R06-lookalike', 'no approval'),
  ),
  E(
    'R07',
    'مرجع داخل بيان طويل',
    'counter-case',
    'executable',
    g('R07-reference-in-text', 'no approval from description text'),
  ),
  E('R08', 'مرجع مقطوع', 'counter-case', 'deferred', {
    reason:
      'needs a renderer that splits a reference across rows; not built this round',
  }),
  E('R09', 'تكرار الرقم عبر الجهات', 'counter-case', 'deferred', {
    reason:
      'scope is one supplier per run; cross-entity reuse needs two runs, not measured here',
  }),
  E(
    'R10',
    'مرجع فارغ أو تالف',
    'counter-case',
    'executable',
    g('R10-placeholders', 'placeholders never link rows'),
  ),
  // ---------------------------------------------------------- types and codes
  E(
    'T01',
    'مسميات مفهومة مكافئة',
    'counter-case',
    'executable',
    g(
      'T01-type-synonyms',
      'documented invoice labels classify as Invoice, text kept',
    ),
  ),
  E('T02', 'قبض ودفع من منظورين', 'counter-case', 'no-product-path', {
    reason:
      'no customer or bank path; sign perspective is fixed by the supplier path',
  }),
  E('T03', 'كود موثق في ملف تعريف', 'external-docs', 'no-product-path', {
    reason: 'no scoped code-definition mechanism exists',
  }),
  E('T04', 'الكود نفسه بمعنيين', 'external-docs', 'no-product-path', {
    reason: 'no scoped code-definition mechanism exists',
  }),
  E(
    'T05',
    'كود جديد',
    'counter-case',
    'executable',
    g('T05-unknown-code', 'stays unknown, no approval'),
  ),
  E(
    'T06',
    'تعارض التصنيف',
    'counter-case',
    'executable',
    g('T06-type-conflict', 'conflict shown, no approval'),
  ),
  E('T07', 'تغير نسخة التقرير', 'counter-case', 'no-product-path', {
    reason: 'no report templates with versions exist',
  }),
  E(
    'T08',
    'الوصف وحده',
    'counter-case',
    'executable',
    g('T08-description-only', 'review suggestion at most'),
  ),
  E('T09', 'تأكيد حالة بعينها', 'owner-interview', 'deferred', {
    reason:
      'manual decisions are 1:1 in the product; N-row decisions need a new decision shape (see spike e34f8d9)',
  }),
  E('T10', 'تعريف ناقص السياق', 'counter-case', 'no-product-path', {
    reason: 'no code-definition mechanism exists',
  }),
  // --------------------------------------------------------------- allocation
  ...['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'].map(
    (id, i) =>
      E(
        id,
        [
          'تخصيص موثق 1:N',
          'تخصيص N:1',
          'تسديد جزئي',
          'دفعة غير مخصصة بالكامل',
          'الأصل مختلف عن المتبقي',
          'تجاوز المتاح',
          'تكرار الطلب أو إعادة التشغيل',
          'إشعار لدفعة أخرى',
          'مطابقة نسختي الدفعة',
          'تغيير أو إلغاء القرار',
        ][i],
        'counter-case',
        ['A07', 'A10'].includes(id) ? 'no-product-path' : 'experimental',
        {
          reason: ['A07', 'A10'].includes(id)
            ? 'no allocation path; the spike ledger has no decision identity or withdrawal'
            : 'prototype on spike/payment-allocation (e34f8d9); no product path',
        },
      ),
  ),
  // ------------------------------------------------------------- bank
  ...['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map(
    (id, i) =>
      E(
        id,
        [
          'إجمالي وصافي ورسوم موثقة',
          'فرق بلا سبب مثبت',
          'تسوية مجمعة تشمل مردودات',
          'عكس وإعادة تسجيل',
          'دفعة مرتجعة',
          'فرق توقيت',
          'تاريخ العملية والقيمة والترحيل',
          'تحويل بين حسابين بنكيين',
          'عملات وأسس مبلغ مختلفة',
          'كشفان متداخلان أو غير مكتملين',
        ][i],
        'external-docs',
        'no-product-path',
        { reason: 'no bank reconciliation path; a bank is not a supplier' },
      ),
  ),
  // ---------------------------------------------------- source meaning, balances
  E('Q01', 'حركات مقابل بنود مفتوحة', 'repository-code', 'deferred', {
    reason:
      'mixed report types are refused or guarded by the reader; not re-measured this round',
  }),
  E('Q02', 'أصل ومتبقٍ ومدفوع', 'repository-code', 'experimental', {
    reason: 'reader keeps one quantity; shown on spike/payment-allocation',
  }),
  E('Q03', 'رصيد جارٍ داخل جدول الحركات', 'repository-code', 'deferred', {
    reason:
      'running balance is refused as an amount by the reader; existing tests cover it',
  }),
  ...['Q04', 'Q05', 'Q06', 'Q07', 'Q08'].map((id, i) =>
    E(
      id,
      [
        'ميزان: بداية ونشاط ونهاية',
        'صافٍ متساوٍ ونشاط مختلف',
        'صفر وفراغ ومفقود',
        'رصيد قائم بلا حركة',
        'حساب مفقود من أحد الطرفين',
      ][i],
      'counter-case',
      'experimental',
      {
        reason:
          'prototype on spike/gl-trial-balance (dba761c); no product path',
      },
    ),
  ),
  E('Q09', 'تعارض نطاق', 'repository-code', 'deferred', {
    reason:
      'scope conflicts are covered by the reader and existing tests; not re-measured',
  }),
  E('Q10', 'دليل نطاق غير متاح', 'counter-case', 'no-product-path', {
    reason: 'ledger and posting status have no evidence in the model',
  }),
  // ---------------------------------------------------- numbers, dates, text
  E(
    'N01',
    'أرقام عربية ولاتينية',
    'counter-case',
    'executable',
    g('N01-arabic-digits', 'same value read'),
  ),
  E(
    'N02',
    'فاصل ملتبس',
    'repository-code',
    'executable',
    g('N02-ambiguous-number', 'stop until answered; auto once answered'),
  ),
  E('N03', 'تنسيقات مختلطة', 'counter-case', 'deferred', {
    reason: 'covered by the format guard tests; no new scenario built',
  }),
  E(
    'N04',
    'الإشارة وأشكال السالب',
    'counter-case',
    'executable',
    g('N04-parentheses', 'sign kept'),
  ),
  E(
    'N05',
    'دقة العملة',
    'counter-case',
    'executable',
    g('N05-precision', '0 and 3 places exact'),
  ),
  E('N06', 'القيمة المخزنة والعرض', 'repository-code', 'deferred', {
    reason: 'covered by existing XLSX format tests',
  }),
  E(
    'N07',
    'تاريخ ملتبس',
    'counter-case',
    'executable',
    g('N07-ambiguous-date', 'stop until answered'),
  ),
  E(
    'N08',
    'تاريخ غير صالح',
    'counter-case',
    'executable',
    g('N08-invalid-date', 'read error, no silent date'),
  ),
  E('N09', 'تواريخ Excel التسلسلية', 'external-docs', 'deferred', {
    reason: 'covered by existing date1904 tests',
  }),
  E('N10', 'محارف خفية واتجاه نص', 'counter-case', 'deferred', {
    reason: 'not built this round',
  }),
  // ---------------------------------------------------- XLSX / CSV
  E(
    'F01',
    'تبديل الأعمدة',
    'counter-case',
    'executable',
    g('F01-column-order', 'same meaning'),
  ),
  E('F02', 'عناوين متعددة الطبقات', 'counter-case', 'deferred', {
    reason: 'renderer does not write merged multi-row headings',
  }),
  E(
    'F03',
    'ترويسات وإجماليات متكررة',
    'counter-case',
    'executable',
    g('F03-structure-rows', 'no double count'),
  ),
  E('F04', 'صفوف وأعمدة مخفية', 'repository-code', 'deferred', {
    reason: 'covered by existing hidden-row tests',
  }),
  E('F05', 'صيغ وقيم مخزنة', 'repository-code', 'deferred', {
    reason: 'covered by existing formula tests',
  }),
  E(
    'F06',
    'مصنف متعدد الأوراق',
    'counter-case',
    'executable',
    g('F06-extra-sheet', 'source sheet chosen, no merge'),
  ),
  E(
    'F07',
    'CSV بفواصل داخل النص',
    'counter-case',
    'executable',
    g('F07-delimiters', 'cells and rows kept'),
  ),
  E('F08', 'ترميز الملف', 'counter-case', 'deferred', {
    reason: 'not built this round',
  }),
  E(
    'F09',
    'ملف ناقص أو عنوان مكرر',
    'counter-case',
    'executable',
    g('F09-missing-amount', 'stop'),
  ),
  E(
    'F10',
    'تلف وحجم وحدود',
    'counter-case',
    'executable',
    g('F10-corrupt', 'stop'),
  ),
  // ---------------------------------------------------- PDF
  E('P01', 'صف عملية متعدد الأسطر', 'external-docs', 'deferred', {
    reason: 'PDF runs cover multi-page statements; multi-line cells not built',
  }),
  E('P02', 'حد الصفحة', 'external-docs', 'executable', {
    path: 'supplier',
    template: 'final PDF layouts (multi-page)',
    expect: 'no loss or duplicate at page breaks',
  }),
  E('P03', 'أعمدة تتغير مواضعها', 'external-docs', 'deferred', {
    reason: 'covered by existing PDF column tests',
  }),
  E('P04', 'عربية وإنجليزية معًا', 'counter-case', 'deferred', {
    reason: 'the independent PDF writer does not render Arabic; not claimed',
  }),
  ...['P05', 'P06', 'P07', 'P08', 'P09', 'P10'].map((id, i) =>
    E(
      id,
      [
        'طبقة نص غير موثوقة',
        'مرجع منقسم إلى قطع',
        'صفحة ناقصة',
        'جدولان في صفحة',
        'صور ممسوحة غير واضحة',
        'ملف مختلط',
      ][i],
      'external-docs',
      'deferred',
      {
        reason:
          'existing PDF diagnosis tests cover parts; not re-measured this round',
      },
    ),
  ),
  // ---------------------------------------------------- system
  E('S01', 'عدم توافق المدخلات', 'repository-code', 'fixed-test', {
    test: 'tests/hard-cases.test.ts',
  }),
  E('S02', 'تغيير إعدادات القراءة', 'repository-code', 'deferred', {
    reason: 'covered by recompute-parity and source-preparation tests',
  }),
  E('S03', 'دليل اتجاه غير مثبت', 'repository-code', 'deferred', {
    reason: 'covered by source-preparation tests (16 fault combinations)',
  }),
  E('S04', 'جلسة أو نتيجة معدلة', 'repository-code', 'deferred', {
    reason: 'covered by recompute-parity tests',
  }),
  E('S05', 'مسار مباشر مقابل العامل', 'repository-code', 'deferred', {
    reason: 'covered by recompute-parity tests',
  }),
  E('S06', 'تصدير غير آمن أو غير متطابق', 'counter-case', 'fixed-test', {
    test: 'tests/hard-cases.test.ts',
  }),
  E('S07', 'تلاعب النص بالمساعد', 'repository-code', 'deferred', {
    reason: 'covered by assistant-adversarial tests',
  }),
  E('S08', 'إعادة رفع الملف', 'counter-case', 'fixed-test', {
    test: 'tests/hard-cases.test.ts',
  }),
  E('S09', 'أحجام وأدلة كثيفة', 'counter-case', 'fixed-test', {
    test: 'audit/hard-cases/scale.mjs',
  }),
  E('S10', 'إلغاء أو مهلة أو عطل', 'repository-code', 'deferred', {
    reason: 'worker cancellation is not exercised in Node tests',
  }),
];
if (CATALOG.length !== 100 || new Set(CATALOG.map((c) => c.id)).size !== 100)
  throw new Error(
    `catalogue must hold 100 unique entries, has ${CATALOG.length}`,
  );
