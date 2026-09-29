import { money, parseDate, safeSum } from './core.ts';
import {
  DOCUMENT_LABELS,
  hasUnsafeReferenceText,
} from './transaction-references.ts';
import {
  certifiedDocumentPartitions,
  DOCUMENT_PAIR_RULE,
  usableDiscriminator,
} from './document-pairs.ts';
import { paymentIdentityComponents } from './payment-components.ts';
import { localizedReadErrors } from './localized-read-errors.ts';
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
export const MAX_AUTOMATIC_GROUP_MEMBERS = 100;
const exactRef = (a: Transaction, b: Transaction) =>
  strong(a.normalizedReference) &&
  a.normalizedReference === b.normalizedReference &&
  a.reference.trim() === b.reference.trim();
// Description text is never positive matching evidence. An explicit leading
// document label can nevertheless contradict another document's declared role.
// The same documented vocabulary as the Type column, as a leading label.
const descriptionLabels = (['Credit Note', 'Invoice', 'Payment'] as const).map(
  (role) =>
    [
      role,
      new RegExp(`^${DOCUMENT_LABELS[role]}(?=\\s|[:：-]|$)`, 'i'),
    ] as const,
);
const descriptionTypeHint = (value: string): Transaction['documentType'] => {
  const text = value.trim().normalize('NFKC').replace(/\s+/g, ' ');
  return descriptionLabels.find(([, label]) => label.test(text))?.[0];
};
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
  if (a.documentType === 'Payment' && b.documentType === 'Payment')
    for (const field of ['bankReference', 'receiptReference'] as const)
      if (
        a.paymentIdentityFields?.includes(field) &&
        b.paymentIdentityFields?.includes(field) &&
        a[field] &&
        b[field] &&
        a[field] !== b[field]
      )
        conflicts.push(
          `تعارض هوية الدفعة (${field}): ${a[field]} / ${b[field]}`,
        );
  const hintedA = descriptionTypeHint(a.description),
    hintedB = descriptionTypeHint(b.description);
  const declared = (t: Transaction) =>
    t.documentType === 'Unknown' ? undefined : t.documentType;
  if (
    (hintedA && declared(a) && hintedA !== declared(a)) ||
    (hintedB && declared(b) && hintedB !== declared(b)) ||
    ((hintedA || declared(a)) &&
      (hintedB || declared(b)) &&
      (hintedA || declared(a)) !== (hintedB || declared(b)))
  )
    conflicts.push(
      'توجد تسميات صريحة متعارضة لنوع المستند في الحقول أو بداية الوصف. الوصف لا يثبت المطابقة، لكن التعارض يمنع اعتمادها آليًا.',
    );
  return conflicts;
}
/** Conflicts that stop an automatic match but leave the accountant free to
 * confirm the rows by hand: documents matched on another identity must not
 * name different documents in the column the accountant chose as the
 * reference. Payments and journals are exempt: their parts carry their own
 * voucher-like references, and a payment is proven by its bank or receipt
 * identity instead. */
export function automaticConflicts(a: Transaction, b: Transaction): string[] {
  const conflicts = identityConflicts(a, b);
  if (hasUnsafeReferenceText(a) || hasUnsafeReferenceText(b))
    conflicts.push(
      'توجد قيمة مرجعية تشبه صيغة أو خطأ جدول بيانات. يلزم الرجوع إلى المصدر قبل اعتماد المطابقة آليًا.',
    );
  const document = (t: Transaction) =>
    t.documentType !== 'Payment' && t.documentType !== 'Journal';
  if (
    document(a) &&
    document(b) &&
    a.chosenReference &&
    b.chosenReference &&
    a.chosenReference.trim() !== b.chosenReference.trim()
  )
    conflicts.push(
      `المرجعان المختاران مختلفان: ${a.chosenReference} / ${b.chosenReference}`,
    );
  // An unselected Reference column is still evidence. Do not let agreement
  // on Document No erase an explicit conflict elsewhere in the source. This
  // guard only vetoes automatic document matches; it supplies no identity.
  if (
    document(a) &&
    document(b) &&
    a.statedReference &&
    b.statedReference &&
    a.statedReference.trim() !== b.statedReference.trim() &&
    !(
      a.statedReference === a.chosenReference &&
      b.statedReference === b.chosenReference
    )
  )
    conflicts.push(
      `قيم عمود المرجع مختلفة: ${a.statedReference} / ${b.statedReference}`,
    );
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
    // Different free-text descriptions never establish distinct posting lines.
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
  rule: string,
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
          ...(rule === DOCUMENT_PAIR_RULE ||
          rule === 'EXACT_DOCUMENT_REFERENCE_SUBGROUP_TOTAL_V1'
            ? [t.chosenReference ?? '']
            : []),
          ...(rule.startsWith('PAYMENT_') ||
          rule === 'EXPLICIT_PAYMENT_COMPLETE_GROUP_TOTAL_V2'
            ? [t.receiptReference ?? '']
            : []),
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
  // Set when both sides are one source: every case stays for review.
  sameSource?: string,
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
    const baseId = identifier(classification, a, b, rule);
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
  // Inspect every original payment identity before accepting an exact pair.
  // No decision, amount or date filter may erase a competing membership.
  const paymentComponents = paymentIdentityComponents(supplier, ledger);
  const readErrors = localizedReadErrors(supplier, ledger);
  const hasExcludedMovement = [...supplier.excluded, ...ledger.excluded].some(
    (row) => row.kind !== 'non-movement',
  );
  const blockedPaymentRows = new Set(
    paymentComponents
      .filter((c) => c.competing || c.excluded)
      .flatMap((c) => [...c.supplier, ...c.ledger].map((t) => t.id)),
  );
  const groupedPaymentRows = new Set(
    paymentComponents
      .filter((c) => c.supplier.length + c.ledger.length > 2)
      .flatMap((c) =>
        [...c.supplier, ...c.ledger]
          .filter((t) => t.documentType === 'Payment')
          .map((t) => t.id),
      ),
  );
  for (const m of exactMatches) {
    if (
      m.kind === 'auto' &&
      (!readErrors.canMatch([byId.get(m.supplierId)!, byId.get(m.ledgerId)!]) ||
        blockedPaymentRows.has(m.supplierId) ||
        blockedPaymentRows.has(m.ledgerId) ||
        groupedPaymentRows.has(m.supplierId) ||
        groupedPaymentRows.has(m.ledgerId))
    )
      continue;
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
  }
  const refA = groupBy(supplier.transactions, (t) => t.normalizedReference),
    refB = groupBy(ledger.transactions, (t) => t.normalizedReference);
  const free = (rows: Transaction[]) => rows.every((t) => !used.has(t.id));
  const supplierIds = new Set(supplier.transactions.map((t) => t.id));
  const ledgerIds = new Set(ledger.transactions.map((t) => t.id));
  const rejectedBySupplier = new Map<string, Set<string>>();
  for (const token of rejected) {
    // Normal source IDs contain no pipe, but direct-source callers can supply
    // one. Keep every valid split so indexing preserves the old literal
    // `${supplierId}|${ledgerId}` membership semantics, including collisions.
    for (
      let separator = token.indexOf('|');
      separator >= 0;
      separator = token.indexOf('|', separator + 1)
    ) {
      const supplierId = token.slice(0, separator);
      const ledgerId = token.slice(separator + 1);
      if (!supplierIds.has(supplierId) || !ledgerIds.has(ledgerId)) continue;
      const targets = rejectedBySupplier.get(supplierId) ?? new Set<string>();
      targets.add(ledgerId);
      rejectedBySupplier.set(supplierId, targets);
    }
  }
  const rejectedGroup = (a: Transaction[], b: Transaction[]) => {
    if (!rejectedBySupplier.size) return false;
    const members = new Set(b.map((t) => t.id));
    return a.some((s) => {
      const targets = rejectedBySupplier.get(s.id);
      if (!targets) return false;
      for (const id of targets) if (members.has(id)) return true;
      return false;
    });
  };
  for (const component of paymentComponents) {
    const all = [...component.supplier, ...component.ledger];
    if (
      (!component.competing && !component.excluded) ||
      !all.some((t) => !used.has(t.id))
    )
      continue;
    const a = component.supplier.filter((t) => !used.has(t.id));
    const b = component.ledger.filter((t) => !used.has(t.id));
    add(
      'AMBIGUOUS_CANDIDATE',
      'Needs Review',
      a,
      b,
      'PAYMENT_IDENTITY_COMPONENT_REVIEW_V1',
      [
        component.competing
          ? 'تربط مراجع الدفعة مجموعات مختلفة أو تترك عضوًا محتملًا بلا دليل. لم تُعتمد أي مجموعة تلقائيًا؛ تساوي أحد المجاميع لا يحسم العلاقة.'
          : 'يوجد صف مستبعد يحمل إحدى هويات الدفعة؛ لم يثبت اكتمال المجموعة.',
        ...component.claims.slice(0, 8).map(
          (claim) =>
            `هوية ${claim.field}: ${claim.value}؛ صفوف المورد ${
              claim.members
                .filter((t) => t.side === 'supplier')
                .map((t) => t.row)
                .join(', ') || '—'
            }؛ صفوف الدفتر ${
              claim.members
                .filter((t) => t.side === 'ledger')
                .map((t) => t.row)
                .join(', ') || '—'
            }.`,
        ),
        ...(component.claims.length > 8
          ? [
              `فُحصت ${component.claims.length} هوية في هذا المكوّن؛ يعرض الملخص أول 8 هويات، وتبقى كل الصفوف وأدلتها في التفاصيل.`,
            ]
          : []),
        ...(all.some((t) => used.has(t.id))
          ? [
              'قرار يدوي استخدم بعض أعضاء المكوّن. بقيت عضويتهم الأصلية ضمن فحص المنافسين؛ لا يثبت استهلاكهم تفرد الباقي.',
            ]
          : []),
      ],
    );
  }

  // Complete explicit groups extend payment matching to N:M and to a shared
  // receipt whose members legitimately use different primary fields. Legacy
  // 1:N primary buckets retain their existing financial proof below.
  for (const component of paymentComponents) {
    const a = component.supplier,
      b = component.ledger;
    const members = [...a, ...b];
    if (!a.length || !b.length || members.length <= 2 || !free(members))
      continue;
    const legacyBucket =
      (a.length === 1 || b.length === 1) &&
      strong(a[0].normalizedReference) &&
      members.every(
        (t) => t.normalizedReference === a[0].normalizedReference,
      ) &&
      refA.get(a[0].normalizedReference)?.length === a.length &&
      refB.get(a[0].normalizedReference)?.length === b.length;
    if (legacyBucket) continue;
    const identity = component.completeClaims.find(
      (claim) =>
        usableDiscriminator(claim.value) &&
        members.every(
          (t) =>
            t.paymentIdentityFields?.includes(claim.field) &&
            t[claim.field] === claim.value,
        ),
    );
    const duplicatePosting = [a, b].some(
      (rows) => new Set(rows.map(postingIdentity)).size !== rows.length,
    );
    const dates = members.map((t) => {
      try {
        return parseDate(t.date, 'ymd') === t.date ? Date.parse(t.date) : NaN;
      } catch {
        return NaN;
      }
    });
    const span = (Math.max(...dates) - Math.min(...dates)) / 86400000;
    const failures = [
      ...(!readErrors.canMatch(members)
        ? ['قراءة المصدر غير مكتملة؛ لا يمكن إثبات عضوية المجموعة.']
        : []),
      ...(!identity
        ? ['لم تثبت هوية بنكية أو هوية إيصال صريحة مشتركة لكل أعضاء المجموعة.']
        : []),
      ...(Math.max(a.length, b.length) > MAX_AUTOMATIC_GROUP_MEMBERS
        ? [
            `حجم المجموعة يتجاوز حد الاعتماد الآلي (${MAX_AUTOMATIC_GROUP_MEMBERS} حركة لكل طرف). لم يكتمل فحص اعتماد المجموعة؛ بقيت كل الصفوف للمراجعة.`,
          ]
        : []),
      ...(members.some(
        (t) =>
          t.documentType !== 'Payment' ||
          t.referenceEvidenceIssues?.length ||
          hasUnsafeReferenceText(t),
      )
        ? ['نوع الدفعة أو دليلها المرجعي غير متحقق في أحد الأعضاء.']
        : []),
      ...(members.some(
        (t) =>
          (t.currency ?? scope.currency) !== scope.currency ||
          !t.amount ||
          Math.sign(t.amount) !== Math.sign(a[0].amount),
      )
        ? ['العملة أو الإشارة أو المبلغ الصفري يمنع إثبات مجموعة دفعة واحدة.']
        : []),
      ...(!(span <= scope.dateWindow)
        ? [
            'مدى تواريخ المجموعة يتجاوز فرق الأيام المسموح أو يحتوي تاريخًا غير صالح.',
          ]
        : []),
      ...(duplicatePosting
        ? ['توجد قيود متكررة داخل أحد الطرفين؛ لم يثبت أنها حركات مستقلة.']
        : []),
      ...((['bankReference', 'receiptReference', 'poReference'] as const).some(
        (field) =>
          new Set(
            members
              .filter(
                (t) =>
                  field === 'poReference' ||
                  t.paymentIdentityFields?.includes(field),
              )
              .map((t) => t[field])
              .filter(Boolean),
          ).size > 1,
      )
        ? ['توجد هويات بنكية أو إيصالات أو أوامر شراء متعارضة داخل المجموعة.']
        : []),
      ...[...new Set(members.flatMap((t) => automaticConflicts(a[0], t)))],
      ...(safeSum(a.map((t) => t.amount)) !== safeSum(b.map((t) => t.amount))
        ? ['مجموعا الدفعة بإشارتهما مختلفان؛ لم تُعتمد المطابقة.']
        : []),
      ...(rejectedGroup(a, b)
        ? ['رفض المراجع رابطًا داخل المجموعة؛ أُوقف اعتماد المجموعة كاملة.']
        : []),
    ];
    if (failures.length) {
      add(
        'AMBIGUOUS_CANDIDATE',
        'Needs Review',
        a,
        b,
        'PAYMENT_GROUP_PROOF_INCOMPLETE_V1',
        failures,
      );
      continue;
    }
    add(
      a.length === 1
        ? 'EXACT_1_TO_MANY'
        : b.length === 1
          ? 'EXACT_MANY_TO_1'
          : 'EXACT_MANY_TO_MANY',
      'Matched',
      a,
      b,
      'EXPLICIT_PAYMENT_COMPLETE_GROUP_TOTAL_V2',
      [
        `مطابقة مجموعتين كاملتين بهوية ${identity!.field}: ${identity!.value}؛ ${a.length} حركة مورد و${b.length} حركة دفتر؛ إجمالي كل طرف ${money(safeSum(a.map((t) => t.amount)), scope.decimals)} ${scope.currency}.`,
        'هذه النتيجة تثبت تكافؤ مجموعتي الدفعة، ولا تثبت مقابلة كل صف بصف معين أو تخصيص الدفعة لفواتير. استُخدم جميع أعضاء الهوية في المصدرين، وفُحصت الهويات المتداخلة قبل الاعتماد، دون البحث عن مجموعات جزئية.',
      ],
    );
  }
  const paymentIdentityIndex = new Map<string, Transaction[]>();
  const groupReviewEvidence = new Map<string, string[]>();
  for (const t of [...supplier.transactions, ...ledger.transactions])
    for (const field of ['bankReference', 'receiptReference'] as const) {
      const value = t[field];
      if (!value) continue;
      const key = `${field}\u0000${value}`;
      const bucket = paymentIdentityIndex.get(key) ?? [];
      bucket.push(t);
      paymentIdentityIndex.set(key, bucket);
    }
  const excludedIdentities = new Set(
    [...supplier.excluded, ...ledger.excluded]
      .filter((row) => row.kind !== 'non-movement')
      .flatMap((row) =>
        row.values.map((value) => value.trim()).filter(Boolean),
      ),
  );
  const groupCandidates = [...refA].map(([ref, a]) => ({
    ref,
    a,
    b: refB.get(ref) ?? [],
    partition: false,
  }));
  const wholeCandidates = new Map(
    groupCandidates.map((candidate) => [candidate.ref, candidate]),
  );
  // All partitions are certified from the original document bucket, before
  // exact siblings are consumed. A manual/rejected row cannot create one.
  for (const [a, b] of certifiedDocumentPartitions(supplier, ledger)) {
    if (a.length === 1 && b.length === 1) continue;
    if (
      refA.get(a[0].normalizedReference)?.length === a.length &&
      refB.get(b[0].normalizedReference)?.length === b.length
    ) {
      wholeCandidates.get(a[0].normalizedReference)!.partition = true;
      continue;
    }
    groupCandidates.push({
      ref: a[0].normalizedReference,
      a,
      b,
      partition: true,
    });
  }
  for (const { ref, a, b, partition } of groupCandidates) {
    if (
      !readErrors.canMatch([...a, ...b]) ||
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
    if (group.length > MAX_AUTOMATIC_GROUP_MEMBERS) continue;
    const sameType =
      single.documentType &&
      single.documentType !== 'Unknown' &&
      group.every((t) => t.documentType === single.documentType);
    const members = [...a, ...b];
    const paymentIdentity =
      single.documentType === 'Payment'
        ? (['bankReference', 'receiptReference'] as const).find((field) => {
            const value = single[field];
            return (
              !!value &&
              strong(value) &&
              members.every(
                (t) =>
                  t.paymentIdentityFields?.includes(field) &&
                  t[field] === value,
              ) &&
              paymentIdentityIndex.get(`${field}\u0000${value}`)?.length ===
                members.length
            );
          })
        : undefined;
    const paymentIdentityConflict =
      single.documentType === 'Payment' &&
      (['bankReference', 'receiptReference'] as const).some(
        (field) =>
          new Set(
            members
              .filter((t) => t.paymentIdentityFields?.includes(field))
              .map((t) => t[field])
              .filter(Boolean),
          ).size > 1,
      );
    const voucher = group[0].voucherReference;
    const sharedVoucher =
      !!voucher && group.every((t) => t.voucherReference === voucher);
    const sharedPO =
      !!single.poReference &&
      group.every((t) => t.poReference === single.poReference);
    const sameGroupDate = group.every((t) => t.date === group[0].date);
    // Parts of one payment may post on neighbouring days. That is accepted
    // only when an explicit bank or receipt identity, held by every member and
    // by no other row, ties them together, and the grouped side spans no more
    // than the allowed date difference. Invoice groups keep one date.
    const groupSpan =
      (Math.max(...group.map((t) => Date.parse(t.date))) -
        Math.min(...group.map((t) => Date.parse(t.date)))) /
      86400000;
    const groupDatesProven =
      sameGroupDate ||
      (single.documentType === 'Payment' &&
        !!paymentIdentity &&
        groupSpan <= scope.dateWindow);
    const conflictingPO =
      new Set([single, ...group].map((t) => t.poReference).filter(Boolean))
        .size > 1;
    const conflictingVoucher =
      new Set(group.map((t) => t.voucherReference).filter(Boolean)).size > 1;
    const duplicatePosting =
      new Set(group.map(postingIdentity)).size !== group.length;
    const equal =
      safeSum(a.map((t) => t.amount)) === safeSum(b.map((t) => t.amount));
    groupReviewEvidence.set(ref, [
      ...new Set(group.flatMap((t) => automaticConflicts(single, t))),
      ...(single.documentType === 'Payment' && !paymentIdentity
        ? [
            'لم تثبت هوية دفعة واحدة من عمود مرجع بنكي أو رقم إيصال صريح ومشترك في جميع الحركات. المرجع العام وتساوي المجموع لا يثبتان أن الصفوف أجزاء دفعة واحدة.',
          ]
        : []),
      ...(paymentIdentityConflict
        ? ['توجد مراجع بنكية أو أرقام إيصالات صريحة متعارضة داخل المجموعة.']
        : []),
      ...(duplicatePosting
        ? [
            'توجد أسطر متساوية في المبلغ والتاريخ وهوية القيد؛ اختلاف الوصف وحده لا يثبت أنها أسطر مستقلة.',
          ]
        : []),
      ...(!groupDatesProven
        ? ['حركات الطرف المجمع ليست في تاريخ واحد؛ لم تثبت وحدة المجموعة.']
        : []),
      ...(conflictingPO
        ? ['تذكر حركات المجموعة أوامر شراء مختلفة؛ لا يثبت ذلك أنها مستند واحد.']
        : []),
      ...(members.some((t) => excludedIdentities.has(t.reference))
        ? [
            'يوجد صف مستبعد يحمل هوية المجموعة نفسها؛ يلزم التحقق من اكتمال أجزائها.',
          ]
        : []),
    ]);
    if (
      ![...a, ...b].some((t) => t.referenceEvidenceIssues?.length) &&
      group.every((t) => exactRef(single, t) && compatible(single, t, scope)) &&
      group.every((t) => automaticConflicts(single, t).length === 0) &&
      sameType &&
      !paymentIdentityConflict &&
      groupDatesProven &&
      !conflictingPO &&
      (single.documentType === 'Payment' ||
        !conflictingVoucher ||
        (partition && sharedPO)) &&
      !duplicatePosting &&
      !members.some((t) => excludedIdentities.has(t.reference)) &&
      (single.documentType === 'Payment'
        ? !!paymentIdentity
        : sharedPO || sharedVoucher) &&
      equal &&
      !rejectedGroup(a, b)
    ) {
      add(
        oneToMany ? 'EXACT_1_TO_MANY' : 'EXACT_MANY_TO_1',
        'Matched',
        a,
        b,
        partition
          ? 'EXACT_DOCUMENT_REFERENCE_SUBGROUP_TOTAL_V1'
          : paymentIdentity && !sameGroupDate
            ? 'EXPLICIT_PAYMENT_IDENTITY_GROUP_DATE_SPAN_V1'
            : paymentIdentity
              ? 'EXPLICIT_PAYMENT_IDENTITY_GROUP_TOTAL_V1'
              : 'EXACT_REFERENCE_GROUP_TOTAL_V1',
        [
          ...(partition
            ? [
                `تحدد هوية المستند ${single.documentReference} والمرجع المختار ${single.chosenReference} جميع أعضاء هذه المجموعة داخل المستند. فُحصت المراجع الأصلية قبل استهلاك أي صف؛ تساوي المبالغ وحده لم يحدد الأعضاء.`,
              ]
            : []),
          `مطابقة تجميعية مثبتة: المرجع ${single.reference} مطابق؛ ${a.length} حركة مورد و${b.length} حركة دفتر؛ إجمالي كل طرف ${money(safeSum(a.map((t) => t.amount)), scope.decimals)} ${scope.currency}.`,
          paymentIdentity && !sameGroupDate
            ? `مطابقة دفعة بين الكشفين وليست تخصيصًا لفواتير. هوية ${paymentIdentity === 'bankReference' ? 'التحويل البنكي' : 'الإيصال'} ${single[paymentIdentity]} واردة في عمود صريح لكل عضو ولا يحملها أي صف آخر. نوع المستند دفعة في الطرفين، وحركات الطرف المجمع موزعة على تواريخ لا يتجاوز مداها ${groupSpan} يوم ضمن فرق الأيام المسموح، والإشارة والعملة متسقتان. شملت المقارنة كامل مجموعة الهوية دون صف مستبعد أو هوية منافسة؛ لم يُبحث عن مجموعات جزئية.`
            : paymentIdentity
              ? `مطابقة دفعة بين الكشفين وليست تخصيصًا لفواتير. هوية ${paymentIdentity === 'bankReference' ? 'التحويل البنكي' : 'الإيصال'} ${single[paymentIdentity]} واردة في عمود صريح لكل عضو. نوع المستند دفعة في الطرفين، وحركات الطرف المجمع في تاريخ واحد ضمن فرق الأيام المسموح، والإشارة والعملة متسقتان. شملت المقارنة كامل مجموعة الهوية دون صف مستبعد أو هوية منافسة؛ لم يُبحث عن مجموعات جزئية.`
              : `نوع المستند ${single.documentType} متسق، وجميع حركات المجموعة في تاريخ واحد ضمن فرق الأيام المسموح للمطابقة؛ ${sharedPO ? `أمر شراء مشترك ${single.poReference}` : ''}${sharedPO && sharedVoucher ? '؛ ' : ''}${sharedVoucher ? `سند المجموعة ${voucher}` : ''}. المجموعة كاملة وفريدة، ولم يُبحث عن مجموعات جزئية.`,
        ],
      );
    }
  }
  for (const [ref, a] of refA) {
    const b = refB.get(ref) ?? [];
    if (a.length !== 1 || b.length !== 1 || !free(a) || !free(b)) continue;
    const s = a[0],
      l = b[0];
    if (hasExcludedMovement && !readErrors.canMatch([s, l])) {
      add(
        'AMBIGUOUS_CANDIDATE',
        'Needs Review',
        a,
        b,
        'SOURCE_MEMBERSHIP_UNVERIFIED_V1',
        [
          'لم تكتمل قراءة هوية المجموعة في المصدر؛ راجع الصفوف المستبعدة وملاحظات القراءة قبل اعتماد الربط.',
        ],
      );
      continue;
    }
    const conflicts = automaticConflicts(s, l);
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
    // The same reference, amount and date, held back only by what the rows
    // do not prove (an unverified type, an order-only identity, no chosen
    // reference column): shown together for review with the reasons, never
    // left as two unrelated rows and never approved.
    const unverified = [
      ...new Set([
        ...(s.referenceEvidenceIssues ?? []),
        ...(l.referenceEvidenceIssues ?? []),
      ]),
    ];
    if (
      exactRef(s, l) &&
      compatible(s, l, scope) &&
      s.amount === l.amount &&
      unverified.length &&
      !rejectedGroup(a, b)
    ) {
      add(
        'AMBIGUOUS_CANDIDATE',
        'Needs Review',
        a,
        b,
        'EXACT_REFERENCE_EVIDENCE_UNVERIFIED_V1',
        [
          'المرجع والمبلغ والتاريخ متطابقة، لكن دليل المستند غير متحقق. لم تُعتمد المطابقة.',
          ...unverified,
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
      supplier.errors.length ||
      ledger.errors.length ||
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
          ...(Math.max(a0.length, b0.length) > MAX_AUTOMATIC_GROUP_MEMBERS
            ? [
                `حجم المجموعة يتجاوز حد الاعتماد الآلي (${MAX_AUTOMATIC_GROUP_MEMBERS} حركة في الطرف المجمع). لم يكتمل تقييم اعتماد هذه المجموعة؛ بقيت كل صفوفها للمراجعة.`,
              ]
            : []),
          'المرجع متكرر، والمجموعة الكاملة لا تستوفي أدلة المطابقة التجميعية الفريدة. لن يختار المحرك مجموعة جزئية تلقائيًا.',
          ...(groupReviewEvidence.get(ref) ?? []),
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
  if (sameSource)
    for (const c of cases)
      if (c.status === 'Matched') {
        c.status = 'Needs Review';
        c.reviewRequired = true;
        c.evidence = [sameSource, ...c.evidence];
      }
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
      const prior =
        c.classification === 'EXACT_1_TO_1'
          ? originalMatchesBySupplier.get(c.supplierMembers[0].id)
          : undefined;
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
