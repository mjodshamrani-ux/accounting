export type ReconciliationDomain =
  | 'supplier' | 'clearing' | 'ar' | 'gl-tb' | 'allocation' | 'bank'
  | 'tb-financial' | 'intercompany' | 'gateway' | 'stock' | 'assets' | 'payroll';

export const reconciliationDirectoryCopy = {
  ar: {
    title: 'اختر نوع التسوية',
    supplierTitle: 'تسوية الموردين',
    intro: 'تراصف تجمع مسارات تسوية محاسبية محلية. اختر المسار المناسب، ثم راجع أدوار المصادر والنطاق قبل المقارنة.',
    boundary: 'المسارات متاحة ضمن عقود مصادر محددة. النتيجة لا تثبت أصالة المصدر أو اكتمال السجلات، والمساعد لا يمنح اعتمادًا ماليًا.',
    waiting: 'انتظر جاهزية أدوات العمل أو انتهاء العملية الحالية قبل فتح مسار.',
    supplier: ['حركات المورد ومجموعات مثبتة مع أصل كل نتيجة.', 'تساوي المبلغ وحده لا يثبت هوية المستند؛ التخصيص الجزئي مسار مستقل.'],
    clearing: ['حركات داخل حساب واحد بعلاقة مرجع أو قرار موثق.', 'صفر صافي الحساب لا يثبت اكتمال المقاصة.'],
    ar: ['مقارنة سجل ذمم العملاء بكشف الشركة البائعة.', 'لا تخصيص قبض على فاتورة، ولا قلب إشارات مسار الموردين.'],
    'gl-tb': ['افتتاح وحركة وختام ومكونات مدين ودائن مستقلة.', 'حساب وأبعاد وفترة وطبقة ترحيل وعملة معلنة؛ لا طي المكونات إلى صافي.'],
    allocation: ['أصل القيمة والمتاح والمخصص والمتبقي بأدلة مستقلة.', 'لا نقل أموال أو قرارات من مقارنة المورد، ولا ترحيل.'],
    bank: ['حركات بنك، ثم مسار مستقل للأرصدة وبنود التسوية.', 'لا بند موازن مولد من الفرق، ولا إثبات أصالة البنك.'],
    'tb-financial': ['اتساق عرض ميزان المراجعة والمركز المالي المقدم.', 'ليس شهادة عدالة القوائم أو اكتمالها.'],
    intercompany: ['حركة مثبتة بهوية الطرفين ونطاقها.', 'تساوي مجموع الطرفين وحده لا يمنح اعتمادًا.'],
    gateway: ['دفعة كاملة وإجمالي وصافي ورسوم مثبتة.', 'لا اختلاق رسوم أو اعتماد دفعة ناقصة.'],
    stock: ['مقارنة سجل مخزون مرحّل بالأستاذ.', 'لا احتساب FIFO أو تكلفة، ولا إثبات ملكية المخزون.'],
    assets: ['مقارنة مكونات الأصول المقدمة بالأستاذ.', 'لا توليد سياسة استهلاك أو حسابها بدل المصدر.'],
    payroll: ['مسير مقدم ومكوناته والأستاذ ودليل صرف بنكي مستقل.', 'لا حساب ضرائب أو تنفيذ تحويل أو إثبات قبض الموظفين.'],
  },
  en: {
    title: 'Choose a reconciliation type',
    supplierTitle: 'Supplier reconciliation',
    intro: 'Tarasuf brings together local accounting reconciliation workflows. Choose a workflow, then review source roles and scope before comparing.',
    boundary: 'Workflows support specific source contracts. Results do not prove source authenticity or record completeness, and the assistant grants no financial approval.',
    waiting: 'Wait for the tools to be ready or the current operation to finish before opening a workflow.',
    supplier: ['Supplier movements and proven groups with original source evidence.', 'Equal amounts alone do not prove document identity; partial allocation is separate.'],
    clearing: ['Single-account movements with a reference relationship or documented decision.', 'A zero account net does not prove complete clearing.'],
    ar: ['Compare customer receivables with the selling company’s statement.', 'No receipt allocation to invoices or reversal of supplier-workflow signs.'],
    'gl-tb': ['Independent opening, movement, closing, debit and credit components.', 'A declared account, dimensions, period, posting layer and currency; no netting away components.'],
    allocation: ['Original value, capacity, allocated amount and remainder with separate evidence.', 'No transfer of money or decisions from supplier comparison, and no posting.'],
    bank: ['Bank movements and a separate balance and reconciliation-item workflow.', 'No balancing item invented from a difference or proof of bank authenticity.'],
    'tb-financial': ['Consistency of the supplied trial balance and financial-position presentation.', 'No opinion on financial-statement fairness or completeness.'],
    intercompany: ['Movements with proven identities and scope for both parties.', 'Equal party totals alone grant no approval.'],
    gateway: ['A complete batch with evidenced gross, net and fees.', 'No invented fees or approval of an incomplete batch.'],
    stock: ['Compare a posted inventory register with the GL.', 'No FIFO, cost calculation or proof of inventory ownership.'],
    assets: ['Compare supplied fixed-asset components with the GL.', 'No creation or calculation of a depreciation policy in place of source evidence.'],
    payroll: ['Supplied payroll components, GL and independent bank payout evidence.', 'No tax calculation, transfer execution or proof that employees received payment.'],
  },
};
