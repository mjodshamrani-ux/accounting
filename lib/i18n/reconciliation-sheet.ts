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
  receivables: {
    title: string;
    sides: [string, string];
    unavailableTotal: string;
    start: string;
    end: string;
    results: string;
    valid: string;
    errors: string;
    review: string;
    note: string;
    fields: Record<
      | 'entity'
      | 'ledger'
      | 'customer'
      | 'account'
      | 'currency'
      | 'kind'
      | 'document'
      | 'date',
      string
    >;
    kind: Record<'invoice' | 'credit-note' | 'receipt' | 'scope', string>;
    reason: Record<
      | 'exact-own-document'
      | 'source-errors'
      | 'empty-source'
      | 'duplicate-document'
      | 'missing-counterpart'
      | 'amount-difference'
      | 'date-difference'
      | 'related-conflict'
      | 'unverified-document-role'
      | 'reopened'
      | 'human-confirmation',
      string
    >;
    /** The engine's claim as the evidence's Summary sheet writes it
     * («Economic coverage»), in the interface's language. */
    claim: string;
  };
  bank: {
    title: string;
    sides: [string, string];
    fields: Record<
      'entity' | 'ledger' | 'account' | 'currency' | 'start' | 'end',
      string
    >;
    /** The result's state, as the screen's heading writes it. */
    status: Record<
      'empty' | 'movements-consistent' | 'needs-review' | 'source-error',
      string
    >;
    caseStatus: Record<
      'matched-evidence' | 'matched-manual' | 'needs-review' | 'source-error',
      string
    >;
    reasons: Record<
      | 'explicit-identity'
      | 'human-review'
      | 'undone'
      | 'source-error'
      | 'missing-identity'
      | 'missing-counterpart'
      | 'member-limit'
      | 'policy-members'
      | 'reversal-origin-conflict'
      | 'incomplete-reversal'
      | 'amount-difference'
      | 'timing-review',
      string
    >;
    caseKinds: Record<'reference' | 'missing' | 'human', string>;
    difference: string;
    members: string;
    reference: string;
    reason: string;
    /** The engine's claim as the evidence's Summary sheet writes it
     * («Claim»), in the interface's language. */
    claim: string;
  };
  allocation: {
    paymentAllocation: string;
    sides: [string, string, string];
    /** The scope's fields, in ALLOCATION_SCOPE_FIELDS order. */
    fields: string[];
    eventTypes: Record<'allocate' | 'undo', string>;
    basisTypes: Record<
      'remittance' | 'external-confirmation' | 'accountant-review',
      string
    >;
    ready: string;
    sourceError: string;
    ownReference: string;
    available: string;
    allocated: string;
    remaining: string;
    activeAllocations: string;
    /** The engine's claim as the evidence's Summary sheet writes it
     * («Claim»), in the interface's language. */
    claim: string;
  };
  supplier: {
    title: string;
    /** The two sources as the page names them. */
    sides: [string, string];
    /** A transaction's side as the results table names it. */
    sideShort: Record<'supplier' | 'ledger', string>;
    fields: Record<
      'supplier' | 'entity' | 'account' | 'currency' | 'cutoff',
      string
    >;
    /** A case's state as the results table writes it. */
    status: Record<
      | 'auto'
      | 'manual'
      | 'amountVariance'
      | 'paymentCandidate'
      | 'rejected'
      | 'needsReview'
      | 'unmatched',
      string
    >;
    reviewedStillOpen: string;
    unmatched: string;
    noReference: string;
    reference: string;
    reason: string;
    balances: Record<
      | 'heading'
      | 'supplierBalance'
      | 'ledgerBalance'
      | 'notAvailable'
      | 'balanceCheck'
      | 'consistentConfirmed'
      | 'consistentUnconfirmed'
      | 'notProven'
      | 'openingAdjustment'
      | 'itemAdjustment'
      | 'adjusted'
      | 'residual',
      string
    >;
    /** A source built with no original file, as the evidence says it. */
    noOriginal: string;
    /** The engine's claim as the evidence's Summary sheet writes it
     * («Workbook Mode»), whole or partial, in the interface's language;
     * the English is the evidence's words exactly. */
    claim: Record<'verified' | 'partial', string>;
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
  /** The trial balance and financial position sheet (UX-6(c)), in the
   * workspace's own words (the screen's catalogue, held equal by a test). */
  financial: {
    trialBalanceAndFinancialPosition: string;
    /** The twelve scope fields, in the engine's order. */
    scope: string[];
    /** The one value each of these fields takes in this family. */
    only: Record<'currencyBasis' | 'postingStatus' | 'closingBasis', string>;
    roles: string[];
    status: Record<
      | 'source-error'
      | 'missing'
      | 'inconsistent'
      | 'difference'
      | 'needs-review'
      | 'consistent-with-evidence'
      | 'blocked'
      | 'accepted'
      | 'rejected',
      string
    >;
    suppliedInventoryAttestation: string;
    attestationReference: string;
    attestationReason: string;
    trialBalanceFigures: string[];
    tableNames: Record<'byClass' | 'position', string>;
    basis: string;
    assets: string;
    liabilities: string;
    equity: string;
    positionEquation: string;
    lineFigures: string[];
    statementLines: string;
    line: string;
    class: string;
    state: string;
    categories: Record<
      | 'current-asset'
      | 'noncurrent-asset'
      | 'current-liability'
      | 'noncurrent-liability'
      | 'equity',
      string
    >;
    decisionLabels: Record<'accept' | 'reject' | 'undo', string>;
    decisionReference: string;
    decisionReason: string;
    /** The engine's claim as the evidence's Summary sheet writes it, in the
     * interface's language; the English is the evidence's words exactly. */
    claim: string;
  };
  /** The intercompany sheet (UX-6(c)), in the workspace's own words (the
   * screen's catalogue, held equal key by key by a test). */
  intercompany: {
    title: string;
    /** The seventeen scope fields, in the engine's order. */
    scope: string[];
    /** The one value each of these fields takes in this family. */
    only: Record<'currencyBasis' | 'fxPolicy' | 'postingStatus', string>;
    roles: string[];
    status: Record<
      | 'source-error'
      | 'missing'
      | 'difference'
      | 'needs-review'
      | 'consistent-with-evidence'
      | 'blocked'
      | 'ready'
      | 'timing-evidence'
      | 'accepted'
      | 'rejected',
      string
    >;
    completenessTitle: string;
    completeReference: string;
    completeNote: string;
    tableNames: { totals: string };
    totals: string[];
    pairs: string;
    residualFigures: string[];
    accept: string;
    reject: string;
    undo: string;
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
    receivables: {
      title: 'مستندات ذمم العملاء',
      sides: ['سجل ذمم العملاء', 'كشف العميل الصادر عن الشركة'],
      unavailableTotal: 'غير متاح بسبب عيب المصدر',
      start: 'بداية الفترة',
      end: 'نهاية الفترة',
      results: 'نتيجة مقارنة مستندات ذمم العملاء',
      valid: 'الحركات الصالحة',
      errors: 'أخطاء القراءة',
      review: 'للمراجعة',
      note: 'سبب مراجعة المستند',
      fields: {
        entity: 'الكيان',
        ledger: 'الدفتر',
        customer: 'معرف العميل',
        account: 'الحساب',
        currency: 'العملة',
        kind: 'نوع المستند',
        document: 'رقم المستند الأصلي',
        date: 'تاريخ الترحيل',
      },
      kind: {
        invoice: 'فاتورة',
        'credit-note': 'إشعار دائن',
        receipt: 'قبض',
        scope: 'النطاق',
      },
      reason: {
        'exact-own-document':
          'اتفق المستند الأصلي الفريد والنوع والتاريخ والمبلغ الموقع',
        'source-errors': 'أخطاء القراءة تمنع الاعتماد',
        'empty-source': 'لا توجد تفاصيل للمقارنة؛ لا يثبت ذلك اكتمال الكشف',
        'duplicate-document': 'هوية المستند لها حركات متنافسة',
        'missing-counterpart': 'لا نظير بنفس المستند الأصلي والنوع',
        'amount-difference': 'اختلف المبلغ الأصلي الموقع',
        'date-difference': 'اختلف تاريخ الترحيل',
        'related-conflict': 'تعارض دليل الفاتورة المرتبطة',
        'unverified-document-role':
          'العنوان المختار لا يثبت دور رقم المستند الأصلي',
        reopened: 'أُلغي الاعتماد وبقي زوج المستندات للمراجعة',
        'human-confirmation': 'نظير دقيق مع تأكيد بشري مسجل',
      },
      claim:
        'لم يُتحقق منه استقلالًا؛ مقارنة المستندات ليست تخصيصًا للمقبوضات ولا تسوية للأرصدة ولا إثباتًا للاكتمال',
    },
    bank: {
      title: 'حركات البنك ودفتر النقدية',
      sides: ['كشف البنك', 'دفتر النقدية'],
      fields: {
        entity: 'الكيان',
        ledger: 'الدفتر',
        account: 'حساب البنك',
        currency: 'العملة',
        start: 'بداية الفترة',
        end: 'نهاية الفترة',
      },
      status: {
        empty: 'لا حركات صالحة',
        'movements-consistent': 'تطابقت الحركات المقدمة؛ إقفال الأرصدة منفصل',
        'needs-review': 'حالات الحركات تحتاج مراجعة',
        'source-error': 'أخطاء المصدر تحجب كل اعتماد',
      },
      caseStatus: {
        'matched-evidence': 'مطابقة بهوية مصدر صريحة',
        'matched-manual': 'مطابقة بمراجعة بشرية موثقة',
        'needs-review': 'تحتاج مراجعة',
        'source-error': 'خطأ مصدر',
      },
      reasons: {
        'explicit-identity': 'هوية مصدر صريحة كاملة',
        'human-review': 'مراجعة بشرية موثقة',
        undone: 'ألغيت؛ تحتاج مراجعة',
        'source-error': 'أخطاء المصدر تحجب الاعتماد',
        'missing-identity': 'هوية التسوية غائبة',
        'missing-counterpart': 'طرف المقارنة غائب',
        'member-limit': 'المجموعة الكاملة تتجاوز حد الأعضاء',
        'policy-members': 'تعارض سياسة المصدر أو أدوار الأعضاء الكاملة',
        'reversal-origin-conflict': 'أصول العكس تعود إلى تسويات مختلفة',
        'incomplete-reversal': 'عضوية عكس المجموعة الأصلية ناقصة',
        'amount-difference': 'فرق قيمة',
        'timing-review': 'تاريخ الحركة أو القيمة يحتاج مراجعة',
      },
      caseKinds: {
        reference: 'هوية تسوية صريحة',
        missing: 'هوية غائبة',
        human: 'ربط بشري لحركة مقابل حركة',
      },
      difference: 'البنك ناقص الدفتر',
      members: 'الأعضاء الكاملة',
      reference: 'مرجع الدليل',
      reason: 'سبب القرار أو الإلغاء',
      claim:
        'مقارنة حركات فقط؛ لا جسر للرصيد الافتتاحي أو الختامي، ولا ترحيل في نظام المنشأة، ولا ضمان لأصالة المصدر أو اكتمال الفترة',
    },
    allocation: {
      paymentAllocation: 'تخصيص الدفعات',
      sides: ['الدفعات المتاحة', 'الفواتير المفتوحة', 'إشعار التخصيص المقترح'],
      fields: [
        'الكيان',
        'الدفتر',
        'المورد',
        'حساب الذمة',
        'العملة',
        'تاريخ اللقطة',
        'أساس اللقطة',
      ],
      eventTypes: {
        allocate: 'تخصيص',
        undo: 'إلغاء',
      },
      basisTypes: {
        remittance: 'إشعار تخصيص',
        'external-confirmation': 'تأكيد خارجي',
        'accountant-review': 'مراجعة محاسب',
      },
      ready: 'جاهز للمراجعة؛ لا اعتماد تلقائي',
      sourceError: 'أخطاء المصدر تمنع التخصيص',
      ownReference: 'رقم المستند',
      available: 'المتاح',
      allocated: 'المخصص',
      remaining: 'المتبقي',
      activeAllocations: 'التخصيصات النشطة',
      claim:
        'تخصيص مقترح على المتاح المعلن قبل التخصيص؛ لا ترحيل في نظام المنشأة، ولا ضمان لأصالة المصدر',
    },
    supplier: {
      title: 'تسوية الموردين',
      sides: ['كشف المورد', 'تقرير الحسابات الدائنة'],
      sideShort: { supplier: 'المورد', ledger: 'الدفتر' },
      fields: {
        supplier: 'المورد',
        entity: 'الجهة القانونية',
        account: 'الحساب',
        currency: 'العملة',
        cutoff: 'تاريخ المقارنة',
      },
      status: {
        auto: 'مطابقة آلية',
        manual: 'تأكيد يدوي',
        amountVariance: 'فرق مبلغ',
        paymentCandidate: 'مجموعة مقترحة للمطابقة',
        rejected: 'اقتراح مرفوض',
        needsReview: 'يحتاج مراجعة',
        unmatched: 'غير مطابق',
      },
      reviewedStillOpen: 'تمت مراجعته وما زال غير مطابق',
      unmatched: 'دون مقابل',
      noReference: 'بلا مرجع',
      reference: 'المرجع',
      reason: 'سبب القرار',
      balances: {
        heading: 'الأرصدة وحالة التسوية',
        supplierBalance: 'رصيد المورد',
        ledgerBalance: 'رصيد الدفتر',
        notAvailable: 'غير متاح',
        balanceCheck: 'التحقق من الأرصدة',
        consistentConfirmed: 'الأرصدة متسقة حسابيًا وتغطية الفترة مؤكدة',
        consistentUnconfirmed: 'الأرصدة متسقة حسابيًا وتغطية الفترة تحتاج تأكيدك',
        notProven: 'لم نتمكن من إثبات اتساق الأرصدة',
        openingAdjustment: 'فرق افتتاحي لم يُثبت سببه',
        itemAdjustment: 'صافي أثر حركات التسوية',
        adjusted: 'الرصيد المعدل حسابيًا',
        residual: 'الفرق المتبقي حسابيًا',
      },
      noOriginal: 'لا ملف أصلي',
      claim: {
        verified: 'لقطة محاسبية متحقق منها للمراجعة؛ لا تعني إعلان تسوية كاملة',
        partial:
          'لقطة جزئية للحركات للمراجعة. ملاحظات القراءة ما زالت مفتوحة؛ والمجاميع تشمل الحركات المعالجة وحدها. ليست تسوية مكتملة',
      },
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
    financial: {
      trialBalanceAndFinancialPosition: 'ميزان المراجعة والمركز المالي',
      scope: [
        'المنشأة',
        'الدفتر',
        'العملة',
        'أساس العملة',
        'حالة الترحيل',
        'طبقة الترحيل',
        'بداية الفترة',
        'نهاية الفترة',
        'تاريخ القائمة',
        'نسخة دليل الحسابات',
        'نسخة الربط',
        'أساس الإقفال',
      ],
      only: {
        currencyBasis: 'وظيفية',
        postingStatus: 'مرحّلة',
        closingBasis: 'بعد الإقفال',
      },
      roles: [
        'ميزان المراجعة',
        'الربط المقترح',
        'دليل العرض المستقل',
        'قائمة المركز المالي',
      ],
      status: {
        'source-error': 'خطأ مصدر',
        missing: 'دليل أو ربط ناقص',
        inconsistent: 'معادلات غير متسقة',
        difference: 'فروق بنود',
        'needs-review': 'يحتاج مراجعة',
        'consistent-with-evidence': 'متسق مع الأدلة المقدمة',
        blocked: 'محجوب',
        accepted: 'معتمد بالدليل',
        rejected: 'مرفوض',
      },
      suppliedInventoryAttestation: 'إقرار اكتمال الجرد المقدم',
      attestationReference: 'مرجع الإقرار',
      attestationReason: 'سبب الإقرار',
      trialBalanceFigures: [
        'مدين الميزان',
        'دائن الميزان',
        'الفرق، المدين ناقص الدائن',
      ],
      tableNames: {
        byClass: 'حسب الأساس والفئة',
        position: 'المركز المالي حسب الأساس',
      },
      basis: 'الأساس',
      assets: 'الأصول',
      liabilities: 'الالتزامات',
      equity: 'حقوق الملكية',
      positionEquation: 'معادلة المركز',
      lineFigures: ['المحسوب', 'المقدم', 'الفرق، المحسوب ناقص المقدم'],
      statementLines: 'بنود القائمة',
      line: 'البند',
      class: 'الصنف',
      state: 'الحالة',
      categories: {
        'current-asset': 'أصول متداولة',
        'noncurrent-asset': 'أصول غير متداولة',
        'current-liability': 'التزامات متداولة',
        'noncurrent-liability': 'التزامات غير متداولة',
        equity: 'حقوق الملكية',
      },
      decisionLabels: {
        accept: 'اعتمد البند كاملًا',
        reject: 'ارفض البند كاملًا',
        undo: 'ألغ القرار',
      },
      decisionReference: 'مرجع القرار',
      decisionReason: 'سبب القرار',
      claim:
        'اتساق مع أدلة العرض المقدمة والمؤكدة وحدها؛ لا رأي في أصالة المصدر ولا في اكتمال نظام الموارد ولا في العرض العادل ولا في الامتثال للمعايير المحاسبية',
    },
    intercompany: {
      title: 'أدلة معاملات المنشآت المنفصلة',
      scope: [
        'المنشأة اليسرى',
        'المنشأة اليمنى',
        'الدفتر الأيسر',
        'الدفتر الأيمن',
        'الحساب الأيسر',
        'الحساب الأيمن',
        'الأبعاد الكاملة اليسرى',
        'الأبعاد الكاملة اليمنى',
        'العملة',
        'أساس العملة',
        'سياسة التحويل',
        'حالة الترحيل',
        'طبقة الترحيل',
        'بداية الفترة',
        'نهاية الفترة',
        'التاريخ المرجعي',
        'إصدار السياسة',
      ],
      only: {
        currencyBasis: 'وظيفية',
        fxPolicy: 'العملة نفسها بلا تحويل',
        postingStatus: 'مرحّلة',
      },
      roles: [
        'دفتر المنشأة اليسرى',
        'دفتر المنشأة اليمنى',
        'أدلة العلاقة المستقلة',
        'أدلة التوقيت المستقلة',
      ],
      status: {
        'source-error': 'أدلة المصدر غير صالحة',
        missing: 'أدلة مطلوبة ناقصة',
        difference: 'فرق معاملة قائم',
        'needs-review': 'تلزم مراجعة الأزواج كاملة',
        'consistent-with-evidence': 'متسق ضمن الأدلة المؤكدة',
        blocked: 'محجوب',
        ready: 'جاهز للمراجعة',
        'timing-evidence': 'تفسير توقيت؛ النظير خارج هذه الفترة',
        accepted: 'معتمد',
        rejected: 'مرفوض',
      },
      completenessTitle: 'جرد المعاملات المورّدة',
      completeReference: 'مرجع اكتمال معاملات المنشآت',
      completeNote: 'تفسير اكتمال معاملات المنشآت',
      tableNames: { totals: 'المدين والدائن والصافي لكل طرف' },
      totals: ['الطرف', 'المدين', 'الدائن', 'الصافي'],
      pairs: 'أزواج المعاملات',
      residualFigures: [
        'صافي اليسار',
        'صافي اليمين',
        'المتبقي، صافي اليسار زائد صافي اليمين',
      ],
      accept: 'اعتمد الزوج كاملًا',
      reject: 'ارفض الزوج كاملًا',
      undo: 'تراجع عن قرار الزوج',
      claim:
        'اتساق معاملات الدفترين المتبادلة المورّدة مع أدلة العلاقة المؤكدة وحدها؛ لا رأي في ترحيل ولا حذف ولا توحيد ولا في أصالة المصدر ولا في اكتمال نظام الموارد',
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
    receivables: {
      title: 'Customer AR documents',
      sides: ['Company AR ledger', 'Company-issued customer statement'],
      unavailableTotal: 'Unavailable because of a source defect',
      start: 'Period start',
      end: 'Period end',
      results: 'AR document comparison result',
      valid: 'Valid movements',
      errors: 'Reading errors',
      review: 'Needs review',
      note: 'Document review reason',
      fields: {
        entity: 'Entity',
        ledger: 'Ledger',
        customer: 'Customer ID',
        account: 'Account',
        currency: 'Currency',
        kind: 'Document type',
        document: 'Own document number',
        date: 'Posting date',
      },
      kind: {
        invoice: 'Invoice',
        'credit-note': 'Credit note',
        receipt: 'Receipt',
        scope: 'Scope',
      },
      reason: {
        'exact-own-document':
          'Unique own document, type, date and signed amount agree',
        'source-errors': 'Reading errors block approval',
        'empty-source':
          'No details to compare; this does not prove statement completeness',
        'duplicate-document': 'Document identity has competing movements',
        'missing-counterpart':
          'No counterpart with the same own document and type',
        'amount-difference': 'Original signed amounts differ',
        'date-difference': 'Posting dates differ',
        'related-conflict': 'Related invoice evidence conflicts',
        'unverified-document-role':
          'Selected header does not establish the own document role',
        reopened: 'Approval cancelled; document pair remains for review',
        'human-confirmation':
          'Exact correspondence with recorded human confirmation',
      },
      claim:
        'Not independently verified. Document comparison is not receipt allocation, balance reconciliation or proof of completeness.',
    },
    bank: {
      title: 'Bank and cashbook movements',
      sides: ['Bank statement', 'Cashbook'],
      fields: {
        entity: 'Entity',
        ledger: 'Ledger',
        account: 'Bank account',
        currency: 'Currency',
        start: 'Period start',
        end: 'Period end',
      },
      status: {
        empty: 'No valid movements',
        'movements-consistent':
          'Supplied movements matched; balance closure remains separate',
        'needs-review': 'Movement cases need review',
        'source-error': 'Source errors block all approval',
      },
      caseStatus: {
        'matched-evidence': 'Matched by explicit source identity',
        'matched-manual': 'Matched by documented human review',
        'needs-review': 'Needs review',
        'source-error': 'Source error',
      },
      reasons: {
        'explicit-identity': 'Explicit complete source identity',
        'human-review': 'Documented human review',
        undone: 'Undone; requires review',
        'source-error': 'Source errors block approval',
        'missing-identity': 'No settlement identity',
        'missing-counterpart': 'Missing counterpart',
        'member-limit': 'Complete group exceeds member limit',
        'policy-members': 'Policy or complete member roles conflict',
        'reversal-origin-conflict':
          'Reversal origins name different settlements',
        'incomplete-reversal':
          'Original group reversal membership is incomplete',
        'amount-difference': 'Amount difference',
        'timing-review': 'Movement or value dates require review',
      },
      caseKinds: {
        reference: 'Explicit settlement identity',
        missing: 'Missing identity',
        human: 'Human one-to-one pairing',
      },
      difference: 'Bank minus cashbook',
      members: 'Complete members',
      reference: 'Evidence reference',
      reason: 'Decision or undo reason',
      claim:
        'Movement comparison only; no opening/closing balance bridge, ERP posting, source authenticity or period completeness assurance',
    },
    allocation: {
      paymentAllocation: 'Payment allocation',
      sides: ['Available payments', 'Open invoices', 'Proposed remittance'],
      fields: [
        'Entity',
        'Ledger',
        'Supplier',
        'Payable account',
        'Currency',
        'Snapshot date',
        'Snapshot basis',
      ],
      eventTypes: {
        allocate: 'allocate',
        undo: 'undo',
      },
      basisTypes: {
        remittance: 'remittance',
        'external-confirmation': 'external confirmation',
        'accountant-review': 'accountant review',
      },
      ready: 'Ready for review; no automatic allocation',
      sourceError: 'Source errors block allocation',
      ownReference: 'Own reference',
      available: 'Available',
      allocated: 'Allocated',
      remaining: 'Remaining',
      activeAllocations: 'Active allocations',
      claim:
        'Proposed allocation against declared pre-allocation capacities; no ERP posting or source authenticity assurance',
    },
    supplier: {
      title: 'Supplier reconciliation',
      sides: ['Supplier statement', 'Accounts payable report'],
      sideShort: { supplier: 'Supplier', ledger: 'AP ledger' },
      fields: {
        supplier: 'Supplier',
        entity: 'Legal entity',
        account: 'Account',
        currency: 'Currency',
        cutoff: 'Cut-off date',
      },
      status: {
        auto: 'Automatic match',
        manual: 'Manual confirmation',
        amountVariance: 'Amount difference',
        paymentCandidate: 'Suggested group for matching',
        rejected: 'Rejected suggestion',
        needsReview: 'Needs Review',
        unmatched: 'Unmatched',
      },
      reviewedStillOpen: 'Reviewed, still unmatched',
      unmatched: 'Unmatched',
      noReference: 'No reference',
      reference: 'Reference',
      reason: 'Reason for the decision',
      balances: {
        heading: 'Balances and reconciliation status',
        supplierBalance: 'Supplier balance',
        ledgerBalance: 'AP ledger balance',
        notAvailable: 'Not available',
        balanceCheck: 'Balance check',
        consistentConfirmed:
          'The balances are arithmetically consistent and period coverage is confirmed',
        consistentUnconfirmed:
          'The balances are arithmetically consistent; period coverage needs your confirmation',
        notProven: 'We could not establish that the balances are consistent',
        openingAdjustment: 'Opening difference with no established cause',
        itemAdjustment: 'Net effect of reconciling items',
        adjusted: 'Arithmetically adjusted balance',
        residual: 'Remaining arithmetic difference',
      },
      noOriginal: 'No original file',
      claim: {
        verified:
          'Verified accounting snapshot for review; not a declaration of full reconciliation.',
        partial:
          'Partial transaction snapshot for review. Reading issues remain open; totals cover processed transactions only. Not a complete reconciliation.',
      },
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
    financial: {
      trialBalanceAndFinancialPosition: 'Trial balance and financial position',
      scope: [
        'Entity',
        'Ledger',
        'Currency',
        'Currency basis',
        'Posting status',
        'Posting layer',
        'Period start',
        'Period end',
        'As of',
        'Chart version',
        'Map version',
        'Closing basis',
      ],
      only: {
        currencyBasis: 'Functional',
        postingStatus: 'Posted',
        closingBasis: 'Post-closing',
      },
      roles: [
        'Trial balance',
        'Proposed mapping',
        'Independent presentation evidence',
        'Financial position',
      ],
      status: {
        'source-error': 'Source evidence is invalid',
        missing: 'Evidence or mapping is missing',
        inconsistent: 'The statement equations do not hold',
        difference: 'Line differences remain',
        'needs-review': 'Needs review',
        'consistent-with-evidence': 'Consistent with the evidence provided',
        blocked: 'Blocked',
        accepted: 'Accepted on evidence',
        rejected: 'Rejected',
      },
      suppliedInventoryAttestation: 'Supplied inventory attestation',
      attestationReference: 'Attestation reference',
      attestationReason: 'Attestation reason',
      trialBalanceFigures: [
        'Trial balance debit',
        'Trial balance credit',
        'Residual, debit minus credit',
      ],
      tableNames: {
        byClass: 'By basis and class',
        position: 'Financial position by basis',
      },
      basis: 'Basis',
      assets: 'Assets',
      liabilities: 'Liabilities',
      equity: 'Equity',
      positionEquation: 'Position equation',
      lineFigures: [
        'Calculated',
        'Reported',
        'Difference, calculated minus reported',
      ],
      statementLines: 'Statement lines',
      line: 'Line',
      class: 'Class',
      state: 'State',
      categories: {
        'current-asset': 'Current assets',
        'noncurrent-asset': 'Noncurrent assets',
        'current-liability': 'Current liabilities',
        'noncurrent-liability': 'Noncurrent liabilities',
        equity: 'Equity',
      },
      decisionLabels: {
        accept: 'Accept whole line',
        reject: 'Reject whole line',
        undo: 'Undo decision',
      },
      decisionReference: 'Decision reference',
      decisionReason: 'Decision reason',
      claim:
        'Consistency with supplied confirmed presentation evidence only; no source authenticity, ERP completeness, fair-presentation or accounting-standards compliance opinion',
    },
    intercompany: {
      title: 'Intercompany transaction evidence',
      scope: [
        'Left entity',
        'Right entity',
        'Left ledger',
        'Right ledger',
        'Left account',
        'Right account',
        'Left complete dimensions',
        'Right complete dimensions',
        'Currency',
        'Currency basis',
        'FX policy',
        'Posting status',
        'Posting layer',
        'Period start',
        'Period end',
        'As of',
        'Policy version',
      ],
      only: {
        currencyBasis: 'Functional',
        fxPolicy: 'Same currency, no conversion',
        postingStatus: 'Posted',
      },
      roles: [
        'Left entity ledger',
        'Right entity ledger',
        'Independent relationship evidence',
        'Independent timing evidence',
      ],
      status: {
        'source-error': 'Source evidence is invalid',
        missing: 'Required evidence is missing',
        difference: 'A transaction difference remains',
        'needs-review': 'Whole pair review required',
        'consistent-with-evidence': 'Consistent within confirmed evidence',
        blocked: 'Blocked',
        ready: 'Ready for review',
        'timing-evidence':
          'Timing explanation; counterpart remains outside this period',
        accepted: 'Accepted',
        rejected: 'Rejected',
      },
      completenessTitle: 'Supplied transaction inventory',
      completeReference: 'Intercompany completeness reference',
      completeNote: 'Intercompany completeness explanation',
      tableNames: { totals: 'Debit, credit and net by side' },
      totals: ['Side', 'Debit', 'Credit', 'Net'],
      pairs: 'Counterpart pairs',
      residualFigures: [
        'Left net',
        'Right net',
        'Residual, left net plus right net',
      ],
      accept: 'Approve whole pair',
      reject: 'Reject whole pair',
      undo: 'Undo pair decision',
      claim:
        'Consistency of supplied reciprocal ledger transactions with confirmed relationship evidence only; no posting, elimination, consolidation, source authenticity or ERP completeness opinion',
    },
  },
};
