import { money, safeSum } from './core.ts';
import type {
  CaseCounts,
  Match,
  ReconciliationCase,
  Scope,
  SourceResult,
  Transaction,
} from './types.ts';

const gap = (a: Transaction, b: Transaction) =>
  Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86400000;
const strong = (r: string) => r.length >= 4 && /\p{L}/u.test(r) && /\d/.test(r);
const exactRef = (a: Transaction, b: Transaction) =>
  strong(a.normalizedReference) &&
  a.normalizedReference === b.normalizedReference &&
  a.reference.trim() === b.reference.trim();
export function identityConflicts(a: Transaction, b: Transaction): string[] {
  const conflicts: string[] = [];
  if (
    a.documentType &&
    b.documentType &&
    a.documentType !== 'Unknown' &&
    b.documentType !== 'Unknown' &&
    a.documentType !== b.documentType
  )
    conflicts.push(
      `نوعا المستند مختلفان: ${a.documentType} / ${b.documentType}`,
    );
  if (a.poReference && b.poReference && a.poReference !== b.poReference)
    conflicts.push(`أمرا الشراء مختلفان: ${a.poReference} / ${b.poReference}`);
  return conflicts;
}
const compatible = (a: Transaction, b: Transaction, scope: Scope) =>
  (a.currency ?? scope.currency) === (b.currency ?? scope.currency) &&
  gap(a, b) <= scope.dateWindow &&
  Math.sign(a.amount) === Math.sign(b.amount) &&
  a.amount !== 0;
const groupBy = (rows: Transaction[], by: (t: Transaction) => string) => {
  const map = new Map<string, Transaction[]>();
  for (const row of rows) {
    const k = by(row);
    const values = map.get(k) ?? [];
    values.push(row);
    map.set(k, values);
  }
  return map;
};
const postingIdentity = (t: Transaction) =>
  JSON.stringify([
    t.date,
    t.reference,
    t.amount,
    t.description.trim(),
    t.documentType,
    t.voucherReference,
    t.poReference,
    t.bankReference,
    t.receiptReference,
    t.documentReference,
    t.currency,
  ]);
function identifier(
  classification: string,
  a: Transaction[],
  b: Transaction[],
) {
  const identity = (rows: Transaction[]) =>
    rows
      .map((t) =>
        [
          t.date,
          t.reference,
          t.amount,
          t.voucherReference ?? '',
          t.poReference ?? '',
          t.bankReference ?? '',
        ].join('|'),
      )
      .sort();
  const text = JSON.stringify([classification, identity(a), identity(b)]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return `CASE-${hash.toString(16).padStart(8, '0').toUpperCase()}`;
}

export function buildReconciliationCases(
  supplier: SourceResult,
  ledger: SourceResult,
  scope: Scope,
  exactMatches: Match[],
  rejectedPairs: string[],
) {
  const cases: ReconciliationCase[] = [],
    used = new Set<string>(),
    caseIds = new Set<string>();
  const rejected = new Set(rejectedPairs);
  const byId = new Map(
    [...supplier.transactions, ...ledger.transactions].map((t) => [t.id, t]),
  );
  if (byId.size !== supplier.transactions.length + ledger.transactions.length)
    throw new Error('معرف صف المصدر مكرر');
  const add = (
    classification: ReconciliationCase['classification'],
    status: ReconciliationCase['status'],
    a: Transaction[],
    b: Transaction[],
    rule: string,
    evidence: string[],
    match?: Match,
  ) => {
    const members = [...a, ...b];
    if (!members.length || members.some((t) => used.has(t.id)))
      throw new Error('صف المصدر مستخدم في أكثر من حالة');
    const supplierTotal = safeSum(a.map((t) => t.amount)),
      ledgerTotal = safeSum(b.map((t) => t.amount));
    const baseId = identifier(classification, a, b);
    let caseId = baseId,
      suffix = 1;
    while (caseIds.has(caseId)) caseId = `${baseId}-${++suffix}`;
    caseIds.add(caseId);
    const c: ReconciliationCase = {
      caseId,
      classification,
      status,
      supplierMembers: a,
      ledgerMembers: b,
      supplierTotal,
      ledgerTotal,
      variance: safeSum([supplierTotal, -ledgerTotal]),
      bridgeEffect: safeSum([ledgerTotal, -supplierTotal]),
      matchingRule: rule,
      evidence,
      reviewRequired: status !== 'Matched',
      sourceTrace: members.map((t) => ({
        sourceRowId: t.id,
        side: t.side,
        sheet: t.sheet,
        row: t.row,
        ...(t.sourcePage ? { page: t.sourcePage } : {}),
      })),
      ...(match?.kind === 'manual'
        ? { reviewerDecision: 'Accepted' as const, reviewerReason: match.note }
        : {}),
      ...(status === 'Rejected'
        ? {
            reviewerDecision: 'Rejected' as const,
            reviewerReason: 'رفض المراجع هذا الربط في سجل قرارات الجلسة',
          }
        : {}),
    };
    cases.push(c);
    members.forEach((t) => used.add(t.id));
    return c;
  };
  for (const m of exactMatches)
    add(
      'EXACT_1_TO_1',
      'Matched',
      [byId.get(m.supplierId)!],
      [byId.get(m.ledgerId)!],
      m.kind === 'manual'
        ? 'MANUAL_REVIEW'
        : (m.evidence?.rule ?? 'EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2'),
      [m.reason],
      m,
    );
  const refA = groupBy(supplier.transactions, (t) => t.normalizedReference),
    refB = groupBy(ledger.transactions, (t) => t.normalizedReference);
  const complete = !supplier.errors.length && !ledger.errors.length;
  const free = (rows: Transaction[]) => rows.every((t) => !used.has(t.id));
  const rejectedGroup = (a: Transaction[], b: Transaction[]) =>
    a.some((s) => b.some((l) => rejected.has(`${s.id}|${l.id}`)));
  for (const [ref, a] of refA) {
    const b = refB.get(ref) ?? [];
    if (
      !complete ||
      !strong(ref) ||
      !b.length ||
      !free(a) ||
      !free(b) ||
      (a.length === 1 && b.length === 1)
    )
      continue;
    // Whole reference buckets only: never solve unrelated or competing subsets.
    const oneToMany = a.length === 1 && b.length > 1,
      manyToOne = b.length === 1 && a.length > 1;
    if (!oneToMany && !manyToOne) continue;
    const single = oneToMany ? a[0] : b[0],
      group = oneToMany ? b : a;
    const sameType =
      single.documentType &&
      single.documentType !== 'Unknown' &&
      single.documentType !== 'Payment' &&
      group.every((t) => t.documentType === single.documentType);
    const voucher = group[0].voucherReference;
    const sharedVoucher =
      !!voucher && group.every((t) => t.voucherReference === voucher);
    const sharedPO =
      !!single.poReference &&
      group.every((t) => t.poReference === single.poReference);
    const sameGroupDate = group.every((t) => t.date === group[0].date);
    const conflictingPO =
      new Set([single, ...group].map((t) => t.poReference).filter(Boolean))
        .size > 1;
    const conflictingVoucher =
      new Set(group.map((t) => t.voucherReference).filter(Boolean)).size > 1;
    const duplicatePosting =
      new Set(group.map(postingIdentity)).size !== group.length;
    const equal =
      safeSum(a.map((t) => t.amount)) === safeSum(b.map((t) => t.amount));
    if (
      ![...a, ...b].some((t) => t.referenceEvidenceIssues?.length) &&
      group.every((t) => exactRef(single, t) && compatible(single, t, scope)) &&
      sameType &&
      sameGroupDate &&
      !conflictingPO &&
      !conflictingVoucher &&
      !duplicatePosting &&
      (sharedPO || sharedVoucher) &&
      equal &&
      !rejectedGroup(a, b)
    ) {
      add(
        oneToMany ? 'EXACT_1_TO_MANY' : 'EXACT_MANY_TO_1',
        'Matched',
        a,
        b,
        'EXACT_REFERENCE_GROUP_TOTAL_V1',
        [
          `مطابقة تجميعية مثبتة: المرجع ${single.reference} مطابق؛ ${a.length} حركة مورد و${b.length} حركة دفتر؛ إجمالي كل طرف ${money(safeSum(a.map((t) => t.amount)), scope.decimals)} ${scope.currency}.`,
          `نوع المستند ${single.documentType} متسق، وجميع حركات المجموعة في تاريخ واحد ضمن فرق الأيام المسموح للمطابقة؛ ${sharedPO ? `أمر شراء مشترك ${single.poReference}` : ''}${sharedPO && sharedVoucher ? '؛ ' : ''}${sharedVoucher ? `سند المجموعة ${voucher}` : ''}. المجموعة كاملة وفريدة، ولم يُبحث عن مجموعات جزئية.`,
        ],
      );
    }
  }
  for (const [ref, a] of refA) {
    const b = refB.get(ref) ?? [];
    if (a.length !== 1 || b.length !== 1 || !free(a) || !free(b)) continue;
    const s = a[0],
      l = b[0];
    const conflicts = identityConflicts(s, l);
    if (
      exactRef(s, l) &&
      compatible(s, l, scope) &&
      conflicts.length &&
      !rejectedGroup(a, b)
    ) {
      add(
        'AMBIGUOUS_CANDIDATE',
        'Needs Review',
        a,
        b,
        'CONTRADICTORY_DOCUMENT_EVIDENCE',
        [
          'المرجع متطابق، لكن أدلة المستند متعارضة. لم تُعتمد المطابقة.',
          ...conflicts,
        ],
      );
      continue;
    }
    if (
      exactRef(s, l) &&
      compatible(s, l, scope) &&
      s.amount !== l.amount &&
      !rejectedGroup(a, b)
    )
      add(
        'AMOUNT_VARIANCE',
        'Needs Review',
        a,
        b,
        'EXACT_REFERENCE_AMOUNT_VARIANCE_V1',
        [
          `مقابل محدد بالمرجع ${s.reference} والتاريخ؛ فرق المبلغ ${money(safeSum([s.amount, -l.amount]), scope.decimals)} ${scope.currency}. يلزم تفسير الفرق وإرفاق ما يدعمه من مستندات. لم تُعتمد مطابقة.`,
        ],
      );
  }
  const allAmountsA = groupBy(supplier.transactions, (t) => String(t.amount)),
    allAmountsB = groupBy(ledger.transactions, (t) => String(t.amount));
  const paymentA = groupBy(
    supplier.transactions.filter((t) => t.documentType === 'Payment'),
    (t) => String(t.amount),
  );
  const paymentB = groupBy(
    ledger.transactions.filter((t) => t.documentType === 'Payment'),
    (t) => String(t.amount),
  );
  const bankDescription = (t: Transaction) =>
    /\bbank\s+transfer\b|\bbank\s+(?:settlement|payment)\b|\bsettlement\b.*\bbank\b|تحويل\s+(?:بنكي|مصرفي)|سداد\s+(?:بنكي|مصرفي)/iu.test(
      t.description,
    );
  const references = (t: Transaction) =>
    [
      t.documentReference,
      t.voucherReference,
      t.poReference,
      t.bankReference,
      t.receiptReference,
      t.primaryReference,
    ].filter(Boolean);
  for (const [amount, a] of paymentA) {
    const b = paymentB.get(amount) ?? [];
    if (
      !complete ||
      a.length !== 1 ||
      b.length !== 1 ||
      allAmountsA.get(amount)?.length !== 1 ||
      allAmountsB.get(amount)?.length !== 1 ||
      !free(a) ||
      !free(b)
    )
      continue;
    const s = a[0],
      l = b[0];
    if (
      !compatible(s, l, scope) ||
      !bankDescription(s) ||
      !bankDescription(l) ||
      references(s).some((r) => references(l).includes(r))
    )
      continue;
    const denied = rejectedGroup(a, b);
    add(
      denied ? 'REJECTED_CANDIDATE' : 'PAYMENT_CANDIDATE',
      denied ? 'Rejected' : 'Needs Review',
      a,
      b,
      'UNIQUE_PAYMENT_AMOUNT_DATE_REVIEW_V1',
      [
        `اقتراح ربط دفعة: المبلغ بإشارته ${money(s.amount, scope.decimals)} ${scope.currency} فريد بين الحركات في كل طرف، ونوع المستند دفعة (Payment) في الطرفين، وفارق التاريخ ${gap(s, l)} يوم.`,
        'يشير الوصف في الطرفين إلى تحويل بنكي، لكن المراجع مختلفة ولا يوجد مرجع مشترك. تساوي المبلغ لا يثبت صحة الربط، ويلزم اعتماد المراجع.',
      ],
    );
  }
  // Repeated references left after grouping are review cases, not false matches.
  for (const [ref, a0] of refA) {
    const b0 = refB.get(ref) ?? [];
    const a = a0.filter((t) => !used.has(t.id)),
      b = b0.filter((t) => !used.has(t.id));
    if (!strong(ref) || !a.length || !b.length) continue;
    if (a0.length > 1 || b0.length > 1)
      add(
        'AMBIGUOUS_CANDIDATE',
        'Needs Review',
        a,
        b,
        'REFERENCE_GROUP_NOT_PROVEN',
        [
          'المرجع متكرر، والمجموعة الكاملة لا تستوفي أدلة المطابقة التجميعية الفريدة. لن يختار المحرك مجموعة جزئية تلقائيًا.',
          safeSum(a.map((t) => t.amount)) === safeSum(b.map((t) => t.amount))
            ? 'المجموع متساوٍ، لكنه لا يثبت هوية الحركات ضمن المجموعة.'
            : 'مجموع الطرفين مختلف. راجع حركات المجموعة ومبالغها.',
        ],
      );
  }
  // A review decision rejects an edge; it does not choose a pairing among
  // overlapping edges. Only isolated eligible edges can own a rejected case.
  const eligibleRejections: [Transaction, Transaction][] = [];
  const rejectionDegree = new Map<string, number>();
  for (const pair of rejected) {
    const [supplierId, ledgerId] = pair.split('|');
    const s = byId.get(supplierId),
      l = byId.get(ledgerId);
    if (
      s?.side !== 'supplier' ||
      l?.side !== 'ledger' ||
      used.has(s.id) ||
      used.has(l.id) ||
      s.amount !== l.amount
    )
      continue;
    eligibleRejections.push([s, l]);
    for (const t of [s, l])
      rejectionDegree.set(t.id, (rejectionDegree.get(t.id) ?? 0) + 1);
  }
  for (const [s, l] of eligibleRejections)
    if (rejectionDegree.get(s.id) === 1 && rejectionDegree.get(l.id) === 1)
      add(
        'REJECTED_CANDIDATE',
        'Rejected',
        [s],
        [l],
        'REVIEWER_REJECTED_PAIR',
        ['رفض المراجع هذا الربط. لا تُعتمد المطابقة رغم تساوي المبلغ.'],
      );
  for (const s of supplier.transactions)
    if (!used.has(s.id))
      add(
        'SUPPLIER_ONLY',
        'Unmatched',
        [s],
        [],
        'NO_VIABLE_LEDGER_COUNTERPART',
        [
          `مستند المورد ${s.reference || `صف ${s.row}`} بمبلغ ${money(s.amount, scope.decimals)} ${scope.currency}: لا يوجد مقابل دفتر يستوفي قواعد المطابقة أو حالة مراجعة مثبتة.`,
        ],
      );
  for (const l of ledger.transactions)
    if (!used.has(l.id))
      add(
        'LEDGER_ONLY',
        'Unmatched',
        [],
        [l],
        'NO_VIABLE_SUPPLIER_COUNTERPART',
        [
          `مستند الدفتر ${l.reference || `صف ${l.row}`} بمبلغ ${money(l.amount, scope.decimals)} ${scope.currency}: لا يوجد مقابل مورد يستوفي قواعد المطابقة أو حالة مراجعة مثبتة.`,
        ],
      );
  if (used.size !== byId.size)
    throw new Error('لم تُحفظ جميع صفوف المصدر داخل حالات التسوية');
  const count = (status: ReconciliationCase['status']) =>
    cases.filter((c) => c.status === status);
  const rowCount = (items: ReconciliationCase[]) =>
    items.reduce(
      (n, c) => n + c.supplierMembers.length + c.ledgerMembers.length,
      0,
    );
  const caseCounts: CaseCounts = {
    autoMatchedCases: count('Matched').filter(
      (c) => c.matchingRule !== 'MANUAL_REVIEW',
    ).length,
    matchedSourceRows: rowCount(count('Matched')),
    needsReviewCases: count('Needs Review').length,
    needsReviewSourceRows: rowCount(count('Needs Review')),
    unmatchedCases: count('Unmatched').length,
    unmatchedSourceRows: rowCount(count('Unmatched')),
    manualMatches: count('Matched').filter(
      (c) => c.matchingRule === 'MANUAL_REVIEW',
    ).length,
    rejectedCandidates: count('Rejected').length,
  };
  const originalMatchesBySupplier = new Map(
    exactMatches.map((m) => [m.supplierId, m]),
  );
  const matches = cases
    .filter((c) => c.status === 'Matched')
    .map((c) => {
      const prior = originalMatchesBySupplier.get(c.supplierMembers[0].id);
      return {
        ...(prior ?? {
          supplierId: c.supplierMembers[0].id,
          ledgerId: c.ledgerMembers[0].id,
          kind: 'auto' as const,
          reason: c.evidence.join('\n'),
        }),
        caseId: c.caseId,
        supplierIds: c.supplierMembers.map((t) => t.id),
        ledgerIds: c.ledgerMembers.map((t) => t.id),
      };
    });
  return { cases, caseCounts, matches };
}
