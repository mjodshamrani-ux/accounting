/**
 * Words of the reconciliation sheet (UX-6), small enough for the worker to
 * carry. The strip's words come from its own catalogue
 * (`./alignment-strip.ts`); each workspace's words here repeat the screen's
 * exactly, and `tests/reconciliation-sheet.test.ts` holds them equal to the
 * interface's catalogues, so the sheet and the screen say the same thing.
 */
export type ReconciliationSheetCopy = {
  name: string;
  scope: string;
  sources: string;
  fingerprint: string;
  alignment: string;
  signature: string;
  prepared: string;
  reviewed: string;
  date: string;
  claim: string;
  /** Beside a section: the evidence sheet its values stand in. */
  evidence: string;
  /** Between a count and what it is counted among, as the strip writes
   * them in one phrase («6 من 6»), here each in its own cell. */
  of: string;
  /** Over the recorded decisions: what was decided. */
  decisions: string;
  decision: string;
  clearing: {
    title: string;
    upload: string;
    entity: string;
    ledger: string;
    account: string;
    currency: string;
    start: string;
    end: string;
    results: string;
    valid: string;
    cleared: string;
    errors: string;
    review: string;
    members: string;
    reference: string;
    net: string;
    basis: string;
    note: string;
    missing: string;
    reason: Record<
      | 'reference-zero'
      | 'residual'
      | 'unverified-reference-role'
      | 'missing-reference'
      | 'source-errors'
      | 'group-limit'
      | 'human-decision'
      | 'reopened',
      string
    >;
    /** The engine's claim as the evidence's Summary sheet writes it
     * («Economic coverage»), in the interface's language. */
    claim: string;
  };
  glTb: {
    title: string;
    fields: Record<
      | 'entity'
      | 'ledger'
      | 'account'
      | 'dimensions'
      | 'currency'
      | 'currencyBasis'
      | 'postingStatus'
      | 'postingLayer'
      | 'start'
      | 'end',
      string
    >;
    functionalLabel: string;
    postedLabel: string;
    sides: [string, string];
    status: Record<
      'consistent' | 'difference' | 'inconsistent' | 'missing' | 'source-error',
      string
    >;
    components: Record<
      | 'openingDebit'
      | 'openingCredit'
      | 'periodDebit'
      | 'periodCredit'
      | 'closingDebit'
      | 'closingCredit',
      string
    >;
    component: string;
    gl: string;
    tb: string;
    difference: string;
    balances: string;
    missing: string;
    missingLabels: Record<
      | 'gl-opening'
      | 'gl-closing'
      | 'tb-balance'
      | 'tb-opening'
      | 'tb-period'
      | 'tb-closing',
      string
    >;
    /** The engine's claim as the evidence's Summary sheet writes it, in the
     * interface's language; the English is the evidence's words exactly. */
    claim: string;
  };
};

export const reconciliationSheetCopy: Record<
  'ar' | 'en',
  ReconciliationSheetCopy
> = {
  ar: {
    name: 'ورقة التسوية',
    scope: 'النطاق',
    sources: 'المصادر',
    fingerprint: 'البصمة SHA-256',
    alignment: 'التراصف',
    signature: 'التوقيع',
    prepared: 'أعدّه',
    reviewed: 'راجعه',
    date: 'التاريخ',
    claim: 'ما يثبته المحرك',
    evidence: 'في الأدلة',
    of: 'من',
    decisions: 'القرارات المسجلة',
    decision: 'القرار',
    clearing: {
      title: 'مقاصة داخل حساب واحد',
      upload: 'ملف حركات المقاصة',
      entity: 'الكيان',
      ledger: 'الدفتر',
      account: 'الحساب',
      currency: 'العملة',
      start: 'بداية الفترة',
      end: 'نهاية الفترة',
      results: 'نتيجة المقاصة',
      valid: 'حركات صالحة',
      cleared: 'حركات مسوّاة',
      errors: 'أخطاء قراءة',
      review: 'تحتاج مراجعة',
      members: 'الأعضاء',
      reference: 'مرجع المقاصة',
      net: 'الصافي',
      basis: 'الدليل',
      note: 'سبب قرار المراجعة',
      missing: 'بلا مرجع مقاصة',
      reason: {
        'reference-zero': 'مرجع كامل وصافي صفر',
        residual: 'حزمة المرجع غير متعادلة؛ لا اختيار لجزء منها',
        'unverified-reference-role':
          'رأس العمود لا يثبت دور مرجع المقاصة؛ يحتاج قرارًا بشريًا',
        'missing-reference': 'غياب دليل العلاقة؛ المبلغ وحده لا يكفي',
        'source-errors': 'أخطاء المصدر تمنع الاعتماد',
        'group-limit': 'المجموعة تتجاوز 100 عضو',
        'human-decision': 'أعضاء متعادلة بقرار بشري مسجل',
        reopened: 'أُلغي الاعتماد وبقيت المجموعة للمراجعة',
      },
      claim:
        'لم يُتحقق منه استقلالًا؛ مقاصة الحركات ليست إثباتًا لاكتمال فترة الحساب',
    },
    glTb: {
      title: 'اتساق الأستاذ وميزان المراجعة',
      fields: {
        entity: 'الكيان',
        ledger: 'الدفتر',
        account: 'الحساب',
        dimensions: 'الأبعاد الكاملة',
        currency: 'العملة',
        currencyBasis: 'أساس العملة',
        postingStatus: 'حالة الترحيل',
        postingLayer: 'طبقة الترحيل',
        start: 'بداية الفترة',
        end: 'نهاية الفترة',
      },
      functionalLabel: 'وظيفية',
      postedLabel: 'مرحّلة',
      sides: ['تفاصيل الأستاذ وأرصدته', 'مصدر ميزان المراجعة'],
      status: {
        consistent: 'متسق ضمن النطاق المعلن',
        difference: 'فروق مستقلة في المكونات',
        inconsistent: 'جسر الرصيد المستقل غير متسق',
        missing: 'دليل رصيد مطلوب مفقود',
        'source-error': 'أخطاء المصدر تمنع الاعتماد',
      },
      components: {
        openingDebit: 'الافتتاح المدين',
        openingCredit: 'الافتتاح الدائن',
        periodDebit: 'مدين الفترة',
        periodCredit: 'دائن الفترة',
        closingDebit: 'الختام المدين',
        closingCredit: 'الختام الدائن',
      },
      component: 'المكون',
      gl: 'الأستاذ',
      tb: 'ميزان المراجعة',
      difference: 'الأستاذ ناقص الميزان',
      balances: 'الأستاذ وميزان المراجعة حسب المكون',
      missing: 'مفقود',
      missingLabels: {
        'gl-opening': 'افتتاح الأستاذ',
        'gl-closing': 'ختام الأستاذ',
        'tb-balance': 'حساب ميزان المراجعة',
        'tb-opening': 'افتتاح الميزان',
        'tb-period': 'مدين ودائن فترة الميزان',
        'tb-closing': 'ختام الميزان',
      },
      claim:
        'اتساق داخلي في النطاق المعلن؛ ولم يُتحقق من أصالة المصدر ولا من الاكتمال الاقتصادي',
    },
  },
  en: {
    name: 'Reconciliation sheet',
    scope: 'Scope',
    sources: 'Sources',
    fingerprint: 'SHA-256 fingerprint',
    alignment: 'Alignment',
    signature: 'Sign-off',
    prepared: 'Prepared by',
    reviewed: 'Reviewed by',
    date: 'Date',
    claim: 'What the engine establishes',
    evidence: 'In the evidence',
    of: 'of',
    decisions: 'Recorded decisions',
    decision: 'Decision',
    clearing: {
      title: 'Single-account clearing',
      upload: 'Clearing movements file',
      entity: 'Entity',
      ledger: 'Ledger',
      account: 'Account',
      currency: 'Currency',
      start: 'Period start',
      end: 'Period end',
      results: 'Clearing result',
      valid: 'Valid movements',
      cleared: 'Cleared movements',
      errors: 'Reading errors',
      review: 'Needs review',
      members: 'Members',
      reference: 'Clearing reference',
      net: 'Net',
      basis: 'Evidence',
      note: 'Review decision reason',
      missing: 'No clearing reference',
      reason: {
        'reference-zero': 'Whole reference offsets to zero',
        residual: 'Reference bucket does not offset; no subset is selected',
        'unverified-reference-role':
          'Column header does not establish a clearing-reference role; a human decision is needed',
        'missing-reference':
          'Relationship evidence is missing; amount alone is insufficient',
        'source-errors': 'Source errors block approval',
        'group-limit': 'Group exceeds 100 members',
        'human-decision': 'Offsetting members with a recorded human decision',
        reopened: 'Approval cancelled; group remains for review',
      },
      claim:
        'Not independently verified; clearing of movements is not proof that the account period is complete.',
    },
    glTb: {
      title: 'GL and trial balance consistency',
      fields: {
        entity: 'Entity',
        ledger: 'Ledger',
        account: 'Account',
        dimensions: 'Complete dimensions',
        currency: 'Currency',
        currencyBasis: 'Currency basis',
        postingStatus: 'Posting status',
        postingLayer: 'Posting layer',
        start: 'Period start',
        end: 'Period end',
      },
      functionalLabel: 'Functional',
      postedLabel: 'Posted',
      sides: ['GL detail and balances', 'Trial balance source'],
      status: {
        consistent: 'Consistent in the declared scope',
        difference: 'Separate component differences',
        inconsistent: 'Independent balance bridge is inconsistent',
        missing: 'Required balance evidence is missing',
        'source-error': 'Source errors block approval',
      },
      components: {
        openingDebit: 'Opening debit',
        openingCredit: 'Opening credit',
        periodDebit: 'Period debit',
        periodCredit: 'Period credit',
        closingDebit: 'Closing debit',
        closingCredit: 'Closing credit',
      },
      component: 'Component',
      gl: 'GL',
      tb: 'Trial balance',
      difference: 'GL minus TB',
      balances: 'GL and trial balance by component',
      missing: 'Missing',
      missingLabels: {
        'gl-opening': 'GL opening balance',
        'gl-closing': 'GL closing balance',
        'tb-balance': 'Trial balance account',
        'tb-opening': 'TB opening balance',
        'tb-period': 'TB period debit and credit',
        'tb-closing': 'TB closing balance',
      },
      claim:
        'Internal consistency in the declared scope; source authenticity and economic completeness unverified',
    },
  },
};
