import {
  latinDigits,
  money,
  normalizeReference,
  parseDate,
  parseMoney,
  safeSum,
} from './core.ts';
import type { Comparison, Transaction } from './types.ts';
import { readingStatus } from './reading-issues.ts';
import {
  localizedReadErrors,
  unverifiedExclusions,
} from './localized-read-errors.ts';
import { shortDocumentCandidate } from './transaction-references.ts';

export type EvidenceAnswer = {
  kind: 'difference' | 'transaction' | 'checks' | 'next' | 'unsupported';
  text: string;
  sourceIds: string[];
};
const transactionEvidenceFields: (keyof Transaction)[] = [
  'id',
  'side',
  'row',
  'sheet',
  'date',
  'reference',
  'normalizedReference',
  'description',
  'amount',
  'amountMinor',
  'originalAmount',
  'currency',
  'documentType',
  'primaryReference',
  'documentReference',
  'documentNumberEvidence',
  'relatedInvoiceReference',
  'relatedInvoiceEvidence',
  'chosenReference',
  'chosenReferenceEvidence',
  'statedReference',
  'retainedEvidence',
  'voucherReference',
  'poReference',
  'bankReference',
  'receiptReference',
  'paymentIdentityFields',
  'referenceEvidenceIssues',
  'sourcePage',
];
const sameTransactionEvidence = (a: Transaction, b: Transaction) =>
  transactionEvidenceFields.every(
    (field) => JSON.stringify(a[field]) === JSON.stringify(b[field]),
  );

// Case members are display copies, never the authority for proposal amounts.
// Check conservation and provenance before resolving IDs from canonical sources.
function proposalEvidence(result: Comparison, allowPartialExplanation = false) {
  const canonical = new Map<string, Transaction>();
  const reviewable = new Set<string>();
  const caseRows = new Set<string>();
  const matchedRows = new Set<string>();
  const failure = (reason: string): never => {
    throw new Error(reason);
  };
  if (
    !Array.isArray(result.rejectedPairs) ||
    result.rejectedPairs.some((pair) => typeof pair !== 'string')
  )
    failure('سجل قرارات المراجعة غير صالح؛ أعد التسوية');
  if (
    !result.scope.confirmed ||
    !/^[A-Z]{3}$/.test(result.scope.currency) ||
    ![0, 2, 3].includes(result.scope.decimals) ||
    !Number.isInteger(result.scope.dateWindow) ||
    result.scope.dateWindow < 0 ||
    result.scope.dateWindow > 7
  )
    failure('نطاق النتيجة غير صالح؛ أعد التسوية');
  const cutoff = parseDate(result.scope.cutoff, 'ymd');
  for (const [source, side] of [
    [result.supplier, 'supplier'],
    [result.ledger, 'ledger'],
  ] as const) {
    if (
      !allowPartialExplanation &&
      (source.errors.length || !source.transactions.length)
    )
      failure(
        'قراءة المصدر غير مكتملة. صحح أخطاء القراءة قبل فحص اقتراح الذكاء الاصطناعي.',
      );
    for (const t of source.transactions) {
      if (
        !t.id ||
        canonical.has(t.id) ||
        t.side !== side ||
        !Number.isInteger(t.row) ||
        t.row < 1 ||
        !t.sheet ||
        t.id !== `${side}:${source.mapping.sheet}:${t.row}` ||
        parseDate(t.date, 'ymd') !== t.date ||
        t.date > cutoff ||
        normalizeReference(t.reference) !== t.normalizedReference ||
        (t.documentType !== undefined &&
          !['Invoice', 'Credit Note', 'Payment', 'Journal', 'Unknown'].includes(
            t.documentType,
          )) ||
        (t.referenceEvidenceIssues !== undefined &&
          (!Array.isArray(t.referenceEvidenceIssues) ||
            t.referenceEvidenceIssues.some(
              (issue) => typeof issue !== 'string',
            ))) ||
        (t.amountMinor !== undefined && t.amountMinor !== t.amount)
      )
        failure(
          'توجد بيانات غير متسقة في معرّف حركة المصدر أو تاريخها أو مبلغها. أعد التسوية.',
        );
      if (
        t.retainedEvidence !== undefined &&
        (!Array.isArray(t.retainedEvidence) ||
          t.retainedEvidence.some(
            (e) =>
              !e ||
              ![
                'mappedReference',
                'statedReference',
                'batch',
                'documentTypeLabel',
                'unverifiedCreditNoteNumber',
              ].includes(e.field) ||
              typeof e.header !== 'string' ||
              typeof e.value !== 'string',
          ))
      )
        failure('الدليل المحفوظ لا يطابق بنية سجل المحرك؛ أعد التسوية');
      if (t.currency !== undefined && t.currency !== result.scope.currency)
        failure('عملة حركة المصدر لا تطابق نطاق النتيجة');
      safeSum([t.amount]);
      canonical.set(t.id, t);
    }
    if (safeSum(source.transactions.map((t) => t.amount)) !== source.total)
      failure('إجمالي المصدر لا يطابق حركاته الحالية؛ أعد التسوية');
  }
  const caseIds = new Set<string>();
  const casesById = new Map<string, Comparison['cases'][number]>();
  for (const c of result.cases) {
    if (
      !c.caseId ||
      caseIds.has(c.caseId) ||
      !['Matched', 'Needs Review', 'Unmatched', 'Rejected'].includes(
        c.status,
      ) ||
      c.reviewRequired !== (c.status !== 'Matched')
    )
      failure('توجد حالة تسوية غير صالحة أو مكررة. أعد التسوية.');
    caseIds.add(c.caseId);
    casesById.set(c.caseId, c);
    const members = [...c.supplierMembers, ...c.ledgerMembers];
    if (!members.length || c.sourceTrace.length !== members.length)
      failure('سجل مصدر الحالة غير مكتمل؛ أعد التسوية');
    const traceIds = new Set<string>();
    for (const [rows, side] of [
      [c.supplierMembers, 'supplier'],
      [c.ledgerMembers, 'ledger'],
    ] as const) {
      for (const member of rows) {
        const t = canonical.get(member.id);
        if (
          !t ||
          member.side !== side ||
          caseRows.has(member.id) ||
          !sameTransactionEvidence(t, member)
        )
          failure(
            'إحدى حركات الحالة غائبة أو مكررة أو لا تطابق المصدر الحالي. أعد التسوية.',
          );
        caseRows.add(member.id);
        if (c.status === 'Needs Review' || c.status === 'Unmatched')
          reviewable.add(member.id);
        if (c.status === 'Matched') matchedRows.add(member.id);
      }
    }
    const memberIds = new Set(members.map((t) => t.id));
    for (const trace of c.sourceTrace) {
      const t = canonical.get(trace.sourceRowId);
      if (
        !t ||
        !memberIds.has(trace.sourceRowId) ||
        traceIds.has(trace.sourceRowId) ||
        trace.side !== t.side ||
        trace.sheet !== t.sheet ||
        trace.row !== t.row ||
        trace.page !== t.sourcePage
      )
        failure('بيانات تتبّع صف المصدر لا تطابق حركات الحالة. أعد التسوية.');
      traceIds.add(trace.sourceRowId);
    }
    const a = safeSum(
      c.supplierMembers.map((t) => canonical.get(t.id)!.amount),
    );
    const b = safeSum(c.ledgerMembers.map((t) => canonical.get(t.id)!.amount));
    if (
      a !== c.supplierTotal ||
      b !== c.ledgerTotal ||
      safeSum([a, -b]) !== c.variance ||
      safeSum([b, -a]) !== c.bridgeEffect ||
      (c.status === 'Matched' && a !== b)
    )
      failure('أرقام الحالة لا تطابق حركات المصدر الحالية؛ أعد التسوية');
  }
  if (caseRows.size !== canonical.size)
    failure('لا تظهر جميع حركات المصدر مرة واحدة في النتيجة الحالية');
  const matchRows = new Set<string>();
  for (const match of result.matches) {
    const matchCase = match.caseId ? casesById.get(match.caseId) : undefined;
    const a = match.supplierIds ?? [match.supplierId],
      b = match.ledgerIds ?? [match.ledgerId];
    if (
      !matchCase ||
      matchCase.status !== 'Matched' ||
      !a.includes(match.supplierId) ||
      !b.includes(match.ledgerId) ||
      JSON.stringify([...a].sort()) !==
        JSON.stringify(matchCase.supplierMembers.map((t) => t.id).sort()) ||
      JSON.stringify([...b].sort()) !==
        JSON.stringify(matchCase.ledgerMembers.map((t) => t.id).sort())
    )
      failure('سجل المطابقات لا يطابق حالات النتيجة الحالية');
    for (const id of [...a, ...b]) {
      if (!matchedRows.has(id) || matchRows.has(id))
        failure('سجل المطابقات لا يطابق حالات النتيجة الحالية');
      matchRows.add(id);
    }
  }
  if (matchRows.size !== matchedRows.size)
    failure('سجل المطابقات غير مكتمل؛ أعد التسوية');
  return { canonical, reviewable };
}

// Canonical processed rows remain the authority for a partial explanation.
// This is a consistency gate, not authentication of the underlying documents.
// A model cannot use an inconsistent display copy as its evidence window.
export function hasVerifiedExplanationEvidence(result: Comparison): boolean {
  try {
    const { canonical } = proposalEvidence(result, true);
    const counts = {
      autoMatchedCases: 0,
      matchedSourceRows: 0,
      needsReviewCases: 0,
      needsReviewSourceRows: 0,
      unmatchedCases: 0,
      unmatchedSourceRows: 0,
      manualMatches: 0,
      rejectedCandidates: 0,
    };
    const unmatched = {
      supplier: new Set<string>(),
      ledger: new Set<string>(),
    };
    for (const c of result.cases) {
      const rows = c.supplierMembers.length + c.ledgerMembers.length;
      if (c.status === 'Matched') {
        counts.matchedSourceRows += rows;
        if (c.matchingRule === 'MANUAL_REVIEW') counts.manualMatches++;
        else counts.autoMatchedCases++;
      } else if (c.status === 'Needs Review') {
        counts.needsReviewCases++;
        counts.needsReviewSourceRows += rows;
      } else if (c.status === 'Unmatched') {
        counts.unmatchedCases++;
        counts.unmatchedSourceRows += rows;
        for (const t of c.supplierMembers) unmatched.supplier.add(t.id);
        for (const t of c.ledgerMembers) unmatched.ledger.add(t.id);
      } else counts.rejectedCandidates++;
    }
    if (
      Object.entries(counts).some(
        ([key, n]) => result.caseCounts[key as keyof typeof counts] !== n,
      )
    )
      return false;
    for (const [rows, side] of [
      [result.supplierOnly, 'supplier'],
      [result.ledgerOnly, 'ledger'],
    ] as const) {
      if (
        rows.length !== unmatched[side].size ||
        new Set(rows.map((t) => t.id)).size !== rows.length
      )
        return false;
      if (
        rows.some(
          (t) =>
            !unmatched[side].has(t.id) ||
            !sameTransactionEvidence(t, canonical.get(t.id)!),
        )
      )
        return false;
    }
    if (result.ambiguousIds.some((id) => !canonical.has(id))) return false;
    const b = result.bridge,
      s = result.supplier,
      l = result.ledger;
    if (b) {
      if (
        [s, l].some(
          (source) =>
            source.errors.length ||
            unverifiedExclusions(source).length ||
            source.closing === null ||
            (source.balanceArithmeticStatus
              ? source.balanceArithmeticStatus !== 'BALANCE_ARITHMETIC_VERIFIED'
              : !source.balanceValid),
        )
      )
        return false;
      for (const source of [s, l]) {
        if (source.mapping.reportType === 'open-items') {
          if (source.total !== source.closing) return false;
        } else if (
          source.opening === null ||
          safeSum([source.opening, source.total]) !== source.closing
        )
          return false;
      }
      const start = (source: typeof s) =>
        source.mapping.periodStart || source.metadata?.periodStart || '';
      const end = (source: typeof s) =>
        source.metadata?.periodEnd || result.scope.cutoff;
      if (
        s.mapping.reportType !== 'open-items' &&
        (!start(s) ||
          start(s) !== start(l) ||
          end(s) !== result.scope.cutoff ||
          end(l) !== result.scope.cutoff)
      )
        return false;
      const opening =
        s.mapping.reportType === 'transactions'
          ? safeSum([l.opening!, -s.opening!])
          : 0;
      const items = safeSum(result.cases.map((c) => c.bridgeEffect));
      const adjusted = safeSum([s.closing!, opening, items]);
      if (
        b.delta !== safeSum([s.closing!, -l.closing!]) ||
        b.openingAdjustment !== opening ||
        b.itemAdjustment !== items ||
        b.adjusted !== adjusted ||
        b.residual !== safeSum([adjusted, -l.closing!])
      )
        return false;
    }
    if (
      result.balanceComparable !==
      !!(
        b &&
        s.balanceValid &&
        l.balanceValid &&
        result.scope.coverageConfirmed
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
// No model text, claimed numbers or confidence scores can enter the ledger.
// A future local model may only propose IDs; this boundary accepts unknown input.
export function verifyHypothesis(result: Comparison, input: unknown) {
  const rejected = (reason: string) => ({
    status: 'rejected' as const,
    reason,
    difference: null,
    sourceIds: [] as string[],
  });
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return rejected('بنية اقتراح غير صالحة');
  const p = input as Record<string, unknown>;
  if (Object.keys(p).sort().join(',') !== 'ledgerIds,supplierIds')
    return rejected(
      'يقبل الاقتراح معرّفات حركات المصدر فقط، دون مبالغ أو أوامر أو نصوص لاعتماد المطابقة.',
    );
  if (
    ![p.supplierIds, p.ledgerIds].every(
      (v) =>
        Array.isArray(v) &&
        v.length >= 1 &&
        v.length <= 10 &&
        v.every((id) => typeof id === 'string'),
    )
  )
    return rejected('اختر من حركة واحدة إلى عشر حركات لكل طرف.');
  const ids = [...(p.supplierIds as string[]), ...(p.ledgerIds as string[])];
  if (new Set(ids).size !== ids.length)
    return rejected('حركة مكررة في الاقتراح');
  let evidence: ReturnType<typeof proposalEvidence>;
  let integrity: ReturnType<typeof localizedReadErrors>;
  try {
    evidence = proposalEvidence(result);
    integrity = localizedReadErrors(result.supplier, result.ledger);
  } catch (error) {
    return rejected(
      error instanceof Error && !(error instanceof TypeError)
        ? error.message
        : 'بنية النتيجة الحالية غير صالحة؛ أعد التسوية',
    );
  }
  const a = new Map(result.supplier.transactions.map((t) => [t.id, t]));
  const b = new Map(result.ledger.transactions.map((t) => [t.id, t]));
  if (
    !(p.supplierIds as string[]).every(
      (id) => a.has(id) && evidence.reviewable.has(id),
    ) ||
    !(p.ledgerIds as string[]).every(
      (id) => b.has(id) && evidence.reviewable.has(id),
    )
  )
    return rejected(
      'إحدى الحركات غير موجودة أو مستخدمة في مطابقة أخرى. أعد التحقق من النتيجة الحالية.',
    );
  if (
    (p.supplierIds as string[]).some((s) =>
      (p.ledgerIds as string[]).some((l) =>
        result.rejectedPairs.includes(`${s}|${l}`),
      ),
    )
  )
    return rejected('الرابط مرفوض من المراجع');
  const proposed = ids.map((id) => evidence.canonical.get(id)!);
  if (!integrity.canMatch(proposed))
    return rejected(
      'تتداخل هوية الاقتراح مع صف مستبعد أو غير مقروء؛ راجع اكتمال المجموعة أولًا.',
    );
  const types = new Set(
    proposed
      .map((t) => t.documentType)
      .filter((type) => type && type !== 'Unknown'),
  );
  if (types.size > 1)
    return rejected(
      'أنواع المستندات متعارضة. تساوي المبلغ وحده لا يثبت صحة الربط.',
    );
  if (proposed.some((t) => t.referenceEvidenceIssues?.length))
    return rejected(
      'دليل المرجع أو نوع المستند غير متحقق. راجع صفوف المصدر قبل فحص الاقتراح.',
    );
  const relatedCreditInvoices = new Set(
    proposed
      .filter((t) => t.documentType === 'Credit Note')
      .map((t) => t.relatedInvoiceReference)
      .filter(Boolean),
  );
  if (relatedCreditInvoices.size > 1)
    return rejected(
      'أرقام الفواتير المرتبطة بالإشعار الدائن مختلفة. راجع الأصل قبل الربط.',
    );
  const orders = new Set(proposed.map((t) => t.poReference).filter(Boolean));
  if (orders.size > 1)
    return rejected(
      'أرقام أوامر الشراء المذكورة صراحةً مختلفة. يلزم مستند خارجي يفسر هذا الاختلاف.',
    );
  if (
    proposed.some((t) => !t.amount) ||
    new Set(proposed.map((t) => Math.sign(t.amount))).size > 1
  )
    return rejected(
      'تختلف إشارات المبالغ أو توجد حركة بمبلغ صفر. لا يمكن إثبات الربط بمقاصة هذه الحركات.',
    );
  const dates = proposed.map((t) => Date.parse(t.date));
  if (
    (Math.max(...dates) - Math.min(...dates)) / 86400000 >
    result.scope.dateWindow
  )
    return rejected('فارق تواريخ الحركات يتجاوز فرق الأيام المسموح للمطابقة.');
  const proposedIds = new Set(ids);
  if (
    proposed.some((t) =>
      [...evidence.canonical.values()].some(
        (other) =>
          other.side === t.side &&
          other.normalizedReference &&
          other.normalizedReference === t.normalizedReference &&
          !proposedIds.has(other.id),
      ),
    )
  )
    return rejected(
      'المرجع مكرر. لا يمكن اختيار جزء من مجموعة ملتبسة وتجاهل بقية حركاتها.',
    );
  let difference: number;
  try {
    difference = safeSum([
      ...(p.supplierIds as string[]).map((id) => a.get(id)!.amount),
      ...(p.ledgerIds as string[]).map((id) => -b.get(id)!.amount),
    ]);
  } catch {
    return rejected(
      'فرق الاقتراح يتجاوز حدود الحساب الآمن، لذلك لا يمكن للمحرك التحقق منه.',
    );
  }
  return {
    status: 'needs-review' as const,
    difference,
    sourceIds: ids,
    reason:
      difference === 0
        ? 'تحقق تساوي مجموع المبالغ مع إشاراتها فقط. هذا لا يثبت علاقة المستندات، والاقتراح لا ينشئ مطابقة.'
        : 'المبالغ لا تتساوى عند احتساب إشاراتها. لا يمكن اعتماد مطابقة.',
  };
}

export function localDescriptionHints(t: Transaction): string[] {
  const hints: string[] = [];
  if (/payment|دفعة|سداد|دفع/iu.test(t.description))
    hints.push('قد يشير الوصف إلى دفعة');
  if (/credit\s*note|إشعار دائن|اشعار دائن/iu.test(t.description))
    hints.push('قد يشير الوصف إلى إشعار دائن');
  if (/retention|محتجز|احتجاز/iu.test(t.description))
    hints.push('قد يشير الوصف إلى مبلغ محتجز');
  return hints.map(
    (h) =>
      `${h}. هذا تفسير محتمل للوصف، ولم يُثبت. لا يغيّر إشارة المبلغ أو تصنيف الحركة.`,
  );
}

export function containsExactIdentifier(
  question: string,
  identifier: string,
): boolean {
  if (!identifier) return false;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Punctuation within document identifiers is significant; substring matches are unsafe.
  return new RegExp(
    `(?<![\\p{L}\\p{N}_:/.-])${escaped}(?![\\p{L}\\p{N}_:/.-])`,
    'u',
  ).test(question);
}

// Shared by rule explanations and model routing: an unknown literal reference
// must never be substituted, and an ambiguous reference is never a row choice.
export function resolveQuestionReferences(
  result: Comparison,
  question: string,
): Transaction[] | null {
  if (!hasVerifiedExplanationEvidence(result)) return null;
  const q = latinDigits(question).trim();
  const all = [...result.supplier.transactions, ...result.ledger.transactions];
  const references = (t: Transaction) =>
    [
      t.reference,
      t.documentReference,
      t.relatedInvoiceReference,
      t.chosenReference,
      t.statedReference,
      t.voucherReference,
      t.poReference,
      t.bankReference,
      t.receiptReference,
      ...(t.retainedEvidence ?? [])
        .filter((e) => e.field !== 'documentTypeLabel')
        .map((e) => e.value),
    ]
      .filter((value): value is string => !!value)
      .map((value) => latinDigits(value.trim()));
  const requested = (q.match(/[\p{L}\p{N}][\p{L}\p{N}_:/.-]*/gu) ?? []).filter(
    (token) =>
      token.length >= 2 &&
      /\p{L}/u.test(token) &&
      /\p{N}/u.test(token) &&
      // Keep an unknown numeric scientific notation in the amount parser,
      // where it is rejected; never route 2e2 to an unrelated document.
      (!/^\d+[eE]\d+$/u.test(token) ||
        all.some((t) => references(t).includes(token))),
  );
  if (
    requested.some(
      (token) =>
        !all.some((t) => t.id === token || references(t).includes(token)),
    )
  )
    return null;
  return all.filter(
    (t) =>
      containsExactIdentifier(q, t.id) ||
      references(t).some(
        (reference) =>
          (reference.length >= 4 ||
            (reference.length >= 2 &&
              /\p{L}/u.test(reference) &&
              /\p{N}/u.test(reference))) &&
          containsExactIdentifier(q, reference),
      ),
  );
}

function requestedVariance(
  question: string,
  decimals: number,
  currency: string,
):
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'amount'; value: number } {
  const amounts = [...question.matchAll(/[+−()-]*\d[\d.,٬٫+−()-]*/gu)];
  if (!amounts.length) return { kind: 'absent' };
  const invalid = {
    kind: 'invalid' as const,
    reason:
      'لم أستطع تحديد قيمة فرق واحدة دون التباس. اكتب مبلغًا واحدًا بفواصل واضحة مع إشارته، أو اكتب مرجع الحالة. لن أختار فرقًا آخر بدلًا منه.',
  };
  if (amounts.length !== 1) return invalid;
  const token = amounts[0];
  const before = question.slice(0, token.index).trimEnd();
  const after = question.slice(token.index! + token[0].length).trimStart();
  if (
    /^[%٪]/u.test(after) ||
    /(?:percent|percentage|نسبة|بالمئة|بالمائة)/iu.test(question)
  )
    return invalid;
  const currencyCodes = new Set([
    currency,
    ...(typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('currency')
      : ['SAR', 'USD', 'EUR', 'GBP', 'AED', 'KWD', 'BHD', 'OMR', 'QAR', 'JPY']),
  ]);
  const codes = [
    /(?:^|\s)([A-Za-z]{3})$/u.exec(before)?.[1],
    /^([A-Za-z]{3})(?:\s|$|[?؟])/u.exec(after)?.[1],
  ]
    .filter(
      (code): code is string =>
        !!code &&
        (code === code.toUpperCase() || currencyCodes.has(code.toUpperCase())),
    )
    .map((code) => code.toUpperCase());
  if (codes.some((code) => code !== currency))
    return {
      kind: 'invalid',
      reason:
        'عملة المبلغ المطلوب تختلف عن عملة النتيجة الحالية. لن أحوّل العملة أو أختار فرقًا بعملة أخرى.',
    };
  const values = new Set<number>();
  for (const format of ['dot', 'comma'] as const) {
    try {
      values.add(parseMoney(token[0], format, decimals));
    } catch {
      /* The question never grants authority to guess a separator. */
    }
  }
  return values.size === 1
    ? { kind: 'amount', value: [...values][0] }
    : invalid;
}

export function explainResult(
  result: Comparison,
  question: string,
  selectedId?: string,
): EvidenceAnswer {
  if (!hasVerifiedExplanationEvidence(result))
    return {
      kind: 'unsupported',
      text: 'لا أستطيع شرح هذه النتيجة لأن بياناتها غير مكتملة أو غير متسقة مع سجل المحرك. أعد المقارنة من الملفات الأصلية.',
      sourceIds: [],
    };
  const answer = explainResultDetails(result, question, selectedId);
  const reading = readingStatus([result.supplier, result.ledger]);
  if (!reading.partial) return answer;
  return {
    ...answer,
    text: `نتيجة جزئية: الحركات المعالجة ${reading.processedRows}؛ الصفوف التي تحتاج مراجعة القراءة ${reading.unreadRows}؛ ملاحظات الأرصدة ${reading.balanceIssues}؛ ملاحظات المصدر أو النطاق ${reading.sourceIssues}. الأرقام تخص الحركات المقروءة فقط ولا تثبت اكتمال التسوية.\n${answer.text}`,
  };
}

function explainResultDetails(
  result: Comparison,
  question: string,
  selectedId?: string,
): EvidenceAnswer {
  if (question.length > 500)
    return {
      kind: 'unsupported',
      text: 'اختصر السؤال إلى 500 حرف.',
      sourceIds: [],
    };
  const q = latinDigits(question).trim();
  const fmt = (n: number) =>
    `${money(n, result.scope.decimals)} ${result.scope.currency}`;
  const all = [...result.supplier.transactions, ...result.ledger.transactions];
  // Only explicit IDs or literal references resolve a document; never fuzzy-select one.
  const selected = selectedId
    ? all.filter((t) => t.id === selectedId)
    : resolveQuestionReferences(result, question);
  if (selected === null)
    return {
      kind: 'unsupported',
      text: 'لم أجد المرجع المطلوب كاملًا في النتيجة الحالية. اختر الحركة من الجدول أو تحقق من كتابة المرجع. لن أستبدله بمرجع مشابه.',
      sourceIds: [],
    };
  const describe = (t: Transaction) =>
    `${t.side === 'supplier' ? 'المورد' : 'الدفتر'}: ${t.sheet}، صف ${t.row}، مرجع «${t.reference || 'بلا مرجع'}»، ${t.date}، ${fmt(t.amount)}`;
  if (selectedId || selected.length) {
    if (!selected.length)
      return {
        kind: 'unsupported',
        text: 'الحركة غير موجودة في النتيجة الحالية. اخترها من المراجعة.',
        sourceIds: [],
      };
    const chosen = selected.slice(0, 10);
    const lines: string[] = [];
    const refs = new Set<string>();
    for (const t of chosen) {
      refs.add(t.id);
      lines.push(describe(t));
      for (const e of t.retainedEvidence ?? [])
        lines.push(
          `دليل محفوظ «${e.value}» من عمود «${e.header}». حفظه للتدقيق لا يجعله وحده إثباتًا للمطابقة.`,
        );
      if (t.relatedInvoiceReference)
        lines.push(
          `الفاتورة المرتبطة «${t.relatedInvoiceReference}» من عمود «${t.relatedInvoiceEvidence?.header ?? 'غير متحقق'}». هذا الرقم لا يثبت هوية الإشعار أو الدفعة أو القيد.`,
        );
      const reconciliationCase = result.cases.find((c) =>
        c.sourceTrace.some((trace) => trace.sourceRowId === t.id),
      );
      if (reconciliationCase) {
        lines.push(
          `حالة ${reconciliationCase.caseId}: ${reconciliationCase.classification} — ${reconciliationCase.status}.`,
        );
        lines.push(...reconciliationCase.evidence);
        for (const diagnostic of result.diagnostics.filter(
          (d) =>
            d.transactionIds.includes(t.id) &&
            d.code !== reconciliationCase.classification,
        )) {
          lines.push(diagnostic.message);
          diagnostic.transactionIds.forEach((id) => refs.add(id));
        }
        lines.push(
          `مجموع المورد ${fmt(reconciliationCase.supplierTotal)}؛ مجموع الدفتر ${fmt(reconciliationCase.ledgerTotal)}؛ الفرق ${fmt(reconciliationCase.variance)}؛ أثر الجسر ${fmt(reconciliationCase.bridgeEffect)}.`,
        );
        for (const member of [
          ...reconciliationCase.supplierMembers,
          ...reconciliationCase.ledgerMembers,
        ]) {
          refs.add(member.id);
          if (member.id !== t.id) lines.push(`عضو الحالة: ${describe(member)}`);
        }
        continue;
      }
      const match = result.matches.find(
        (m) => m.supplierId === t.id || m.ledgerId === t.id,
      );
      if (match) {
        lines.push(
          `${match.kind === 'auto' ? 'مطابقة بقواعد المحرك' : 'قرار يدوي للمحاسب'}: ${match.reason}`,
        );
        const other = all.find(
          (v) =>
            v.id ===
            (t.side === 'supplier' ? match.ledgerId : match.supplierId),
        )!;
        refs.add(other.id);
        lines.push(`المقابل: ${describe(other)}`);
      } else {
        lines.push('هذه الحركة تحتاج إلى مراجعة، ولا توجد لها مطابقة معتمدة.');
        lines.push(
          ...result.diagnostics
            .filter((d) => d.transactionIds.includes(t.id))
            .slice(0, 5)
            .map((d) => d.message),
        );
        if (
          !shortDocumentCandidate(t) &&
          (!t.normalizedReference ||
            !/\p{L}/u.test(t.normalizedReference) ||
            !/\d/.test(t.normalizedReference) ||
            t.normalizedReference.length < 4)
        )
          lines.push(
            'المرجع وحده لا يستوفي شروط المطابقة الآلية. المرجع القصير يحتاج رقم مستند ونوع فاتورة أو إشعار دائن صريحين في الملفين، مع تاريخ مطابق ودون حركة منافسة.',
          );
        if (!t.amount) lines.push('لا يطابق المحرك تلقائيًا حركة مبلغها صفر.');
        if (result.rejectedPairs.some((pair) => pair.split('|').includes(t.id)))
          lines.push(
            'فكّ المراجع أحد الروابط لهذه الحركة، ولن يعيده المحرك تلقائيًا.',
          );
        lines.push(...localDescriptionHints(t));
        const counterparts = (
          t.side === 'supplier' ? result.ledgerOnly : result.supplierOnly
        )
          .filter(
            (v) =>
              normalizeReference(v.reference) === t.normalizedReference &&
              t.normalizedReference,
          )
          .slice(0, 3);
        for (const other of counterparts) {
          const h = verifyHypothesis(result, {
            supplierIds: [t.side === 'supplier' ? t.id : other.id],
            ledgerIds: [t.side === 'ledger' ? t.id : other.id],
          });
          refs.add(other.id);
          lines.push(
            `مرشح للمراجعة: ${describe(other)}. ${h.reason}${h.difference === null ? '' : ` الفرق (المورد ناقص الدفتر): ${fmt(h.difference)}.`}`,
          );
        }
      }
    }
    if (selected.length > 10)
      lines.push(
        'يرتبط بهذا المرجع أكثر من عشر حركات. اختر صفًا محددًا من صفحة المراجعة.',
      );
    return {
      kind: 'transaction',
      text: lines.join('\n'),
      sourceIds: [...refs],
    };
  }
  if (
    /فرق|فروق|difference|variance|discrepancy|balance|رصيد|أرصدة|ارصدة/iu.test(
      q,
    )
  ) {
    const caseLines: string[] = [];
    const caseIds = new Set<string>();
    if (/فرق|فروق|difference|variance|discrepancy/iu.test(q)) {
      const amount = requestedVariance(
        q,
        result.scope.decimals,
        result.scope.currency,
      );
      if (amount.kind === 'invalid')
        return { kind: 'difference', text: amount.reason, sourceIds: [] };
      if (amount.kind === 'amount') {
        let evidence: ReturnType<typeof proposalEvidence>;
        try {
          evidence = proposalEvidence(result);
        } catch {
          return {
            kind: 'difference',
            text: 'لا أستطيع نسبة المبلغ إلى حالة موثقة لأن النتيجة الحالية غير مكتملة أو غير متسقة مع المصدر. صحح القراءة وأعد التسوية أولًا.',
            sourceIds: [],
          };
        }
        const related = result.cases.filter(
          (c) => c.reviewRequired && c.variance === amount.value,
        );
        if (!related.length)
          caseLines.push(
            'لا توجد حالة فرق معلّقة بهذه القيمة وإشارتها في النتيجة الحالية. لن أستبدلها بحالة تحمل مبلغًا آخر.',
          );
        else {
          caseLines.push(
            'الحالات التالية تحمل فرق الحركات المطلوب، محسوبًا بطرح الدفتر من المورد. هذا مستقل عن فرق الأرصدة الختامية. أثر الجسر يعرض أثر الحالة على الانتقال من رصيد المورد إلى رصيد الدفتر، بإشارة معاكسة.',
          );
          for (const c of related) {
            caseLines.push(
              `حالة ${c.caseId}: ${c.classification} — ${c.status}. مجموع المورد ${fmt(c.supplierTotal)}؛ مجموع الدفتر ${fmt(c.ledgerTotal)}؛ فرق الحركات ${fmt(c.variance)}؛ أثر الجسر ${fmt(c.bridgeEffect)}.`,
            );
            for (const trace of c.sourceTrace) {
              const t = evidence.canonical.get(trace.sourceRowId)!;
              caseIds.add(t.id);
              caseLines.push(
                `المصدر: ${describe(t)}${t.sourcePage ? `، صفحة ${t.sourcePage}` : ''}.`,
              );
            }
          }
          caseLines.push(
            'تطابق قيمة الفرق يحدد حالات للفحص فقط. لا يثبت أن الحالة سبب فرق الأرصدة، ولا يثبت السبب الاقتصادي. راجع مستندات هذه الحالات. لم تُنشأ مطابقة ولم يُخفَ أي فرق.',
          );
        }
      }
    }
    const b = result.bridge;
    if (!b)
      return {
        kind: 'difference',
        text:
          (caseLines.length ? caseLines.join('\n') + '\n' : '') +
          'لا أستطيع إثبات فرق أرصدة مشترك: اتساق الأرصدة أو تغطية الفترات غير متحقق. المتاح مقارنة الحركات فقط.\n' +
          result.diagnostics
            .filter((d) => !d.transactionIds.length)
            .map((d) => d.message)
            .join('\n'),
        sourceIds: [...caseIds],
      };
    return {
      kind: 'difference',
      text: [
        ...caseLines,
        `فرق الأرصدة الفعلي (المورد ناقص الدفتر): ${fmt(b.delta)}. هذا الرقم من النتيجة الفعلية، وليس من المبلغ المذكور في السؤال.`,
        `رصيد المورد ${fmt(result.supplier.closing!)}؛ رصيد الدفتر ${fmt(result.ledger.closing!)}.`,
        `حساب الانتقال من رصيد المورد إلى رصيد الدفتر: ${fmt(result.supplier.closing!)} + (${fmt(b.openingAdjustment)} فرق الافتتاح) + (${fmt(b.itemAdjustment)} صافي آثار الحالات) = ${fmt(b.adjusted)}.`,
        `الفرق المتبقي حسابيًا: ${fmt(b.residual)}. عدد الحركات دون مقابل: ${result.supplierOnly.length + result.ledgerOnly.length}. الصفر لا يثبت أسباب الفروق أو اكتمال التسوية.`,
        `عدد الحالات التي تحتاج إلى مراجعة: ${result.caseCounts.needsReviewCases}. ${result.balanceComparable ? 'تغطية الفترة مؤكدة من المستخدم.' : 'معادلة الأرصدة متحققة، لكن المستخدم لم يؤكد بعد اكتمال تغطية الفترة.'}`,
        'راجع فروق المبالغ والحركات التي لا مقابل لها. يبقى اقتراح ربط الدفعة للمراجعة حتى إن كان أثره الحسابي صفرًا.',
      ].join('\n'),
      sourceIds: [
        ...new Set([
          ...caseIds,
          ...result.cases
            .filter((c) => c.bridgeEffect !== 0 || c.reviewRequired)
            .flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)),
        ]),
      ],
    };
  }
  if (/أراجع|اراجع|next|review|ابدأ|ابدا/iu.test(q))
    return {
      kind: 'next',
      text: [
        ...(readingStatus([result.supplier, result.ledger]).partial
          ? [
              'راجع ملاحظات القراءة أولًا. لم تُحوّل القيم غير المقروءة إلى أصفار أو حركات مالية.',
              ...(
                [
                  ['المورد', result.supplier],
                  ['الدفتر', result.ledger],
                ] as const
              )
                .flatMap(([label, source]) =>
                  source.errors.map((error) =>
                    error.row > 0
                      ? error.sourcePage
                        ? `${label}: صفحة PDF ${error.sourcePage}، صف ${error.row} — ${error.message}`
                        : `${label}: صف ${error.row} — ${error.message}`
                      : error.scope === 'balance'
                        ? `${label}: الأرصدة المدخلة — ${error.message}`
                        : `${label}: المصدر أو النطاق — ${error.message}`,
                  ),
                )
                .slice(0, 10),
              'تجد جميع الملاحظات والقيم الأصلية في تفاصيل ملاحظات القراءة وورقة العمل.',
            ]
          : []),
        `ابدأ بمراجعة تحذيرات المصادر ثم التكرارات المحتملة، إن وُجدت. عدد التحذيرات: ${result.supplier.warnings.length + result.ledger.warnings.length}. عدد الحركات المحتمل تكرارها: ${result.ambiguousIds.length}.`,
        `عدد الحالات التي تحتاج إلى مراجعة: ${result.caseCounts.needsReviewCases}. عدد الحالات غير المطابقة: ${result.caseCounts.unmatchedCases}.`,
        'افتح «تفاصيل الحالة» للاطلاع على صف المصدر وإشارة المبلغ والمرجع وأسباب عدم المطابقة. تحقق من المستندات الخارجية قبل اتخاذ أي قرار يدوي.',
      ].join('\n'),
      sourceIds: result.ambiguousIds,
    };
  if (/تأكد|التأكد|تحقق|وصل|نتيجة|checks|result|explain/iu.test(q))
    return {
      kind: 'checks',
      text: [
        `عدد حركات المورد المستخدمة: ${result.supplier.transactions.length}. عدد حركات الدفتر المستخدمة: ${result.ledger.transactions.length}. عدد الصفوف المستبعدة مع توثيق السبب: ${result.supplier.excluded.length + result.ledger.excluded.length} (يشمل العناوين والصفوف الفارغة).`,
        `عدد حالات المطابقة الآلية، الفردية أو التجميعية: ${result.caseCounts.autoMatchedCases}. قواعدها تعتمد على المرجع والمبلغ بإشارته والتاريخ. عدد صفوف المصدر الداخلة في المطابقات: ${result.caseCounts.matchedSourceRows}.`,
        `عدد القرارات اليدوية: ${result.matches.filter((m) => m.kind === 'manual').length}. تأكيد المستخدم ليس إثباتًا من المحرك.`,
        'لم يتحقق النظام من أصالة المستندات أو شمول الملفين للنظام المحاسبي أو السبب الاقتصادي للفروق. تأكيد النطاق والتغطية مصدره المستخدم.',
        ...result.diagnostics
          .filter((d) => !d.transactionIds.length)
          .map((d) => d.message),
      ].join('\n'),
      sourceIds: [],
    };
  return {
    kind: 'unsupported',
    text: 'لم أجد في النتيجة ما يتيح الإجابة عن هذا السؤال. يمكنك السؤال عن فرق الأرصدة، أو ما لم يُتحقق منه، أو ما ينبغي مراجعته الآن. للسؤال عن فاتورة، اختر «اشرح هذه الحركة» أو اكتب مرجعها الأصلي. يعمل هذا المساعد محليًا بقواعد محددة، وليس نموذج ذكاء اصطناعي توليديًا، ولا يقدم رأيًا محاسبيًا عامًا.',
    sourceIds: [],
  };
}
