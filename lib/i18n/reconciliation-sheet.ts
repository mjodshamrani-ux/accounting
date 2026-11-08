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
