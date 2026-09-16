import {
  latinDigits,
  money,
  normalizeReference,
  parseDate,
  safeSum,
} from './core.ts';
import type { Comparison, Transaction } from './types.ts';

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
  'voucherReference',
  'poReference',
  'bankReference',
  'receiptReference',
  'referenceEvidenceIssues',
  'sourcePage',
];
const sameTransactionEvidence = (a: Transaction, b: Transaction) =>
  transactionEvidenceFields.every(
    (field) => JSON.stringify(a[field]) === JSON.stringify(b[field]),
  );

// Case members are display copies, never the authority for proposal amounts.
// Check conservation and provenance before resolving IDs from canonical sources.
function proposalEvidence(result: Comparison) {
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
    failure('سجل قرارات المراجعة غير صالح؛ أعد المصالحة');
  if (
    !result.scope.confirmed ||
    !/^[A-Z]{3}$/.test(result.scope.currency) ||
    ![0, 2, 3].includes(result.scope.decimals) ||
    !Number.isInteger(result.scope.dateWindow) ||
    result.scope.dateWindow < 0 ||
    result.scope.dateWindow > 7
  )
    failure('نطاق النتيجة غير صالح؛ أعد المصالحة');
  const cutoff = parseDate(result.scope.cutoff, 'ymd');
  for (const [source, side] of [
    [result.supplier, 'supplier'],
    [result.ledger, 'ledger'],
  ] as const) {
    if (source.errors.length || !source.transactions.length)
      failure('قراءة المصدر غير مكتملة؛ صحح أخطاء القراءة قبل فحص اقتراح AI');
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
        failure('هوية أو تاريخ أو مبلغ حركة المصدر غير متسق؛ أعد المصالحة');
      if (t.currency !== undefined && t.currency !== result.scope.currency)
        failure('عملة حركة المصدر لا تطابق نطاق النتيجة');
      safeSum([t.amount]);
      canonical.set(t.id, t);
    }
    if (safeSum(source.transactions.map((t) => t.amount)) !== source.total)
      failure('إجمالي المصدر لا يطابق حركاته الحالية؛ أعد المصالحة');
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
      failure('حالة المصالحة غير صالحة أو مكررة؛ أعد المصالحة');
    caseIds.add(c.caseId);
    casesById.set(c.caseId, c);
    const members = [...c.supplierMembers, ...c.ledgerMembers];
    if (!members.length || c.sourceTrace.length !== members.length)
      failure('سجل مصدر الحالة غير مكتمل؛ أعد المصالحة');
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
            'عضو حالة غائب أو مكرر أو قديم بالنسبة للمصدر الحالي؛ أعد المصالحة',
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
        failure('دليل صف المصدر لا يطابق أعضاء الحالة؛ أعد المصالحة');
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
      failure('أرقام الحالة لا تطابق حركات المصدر الحالية؛ أعد المصالحة');
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
    failure('سجل المطابقات غير مكتمل؛ أعد المصالحة');
  return { canonical, reviewable };
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
    return rejected('يسمح بمعرفات المصدر فقط؛ لا مبالغ أو أوامر أو نصوص اعتماد');
  if (
    ![p.supplierIds, p.ledgerIds].every(
      (v) =>
        Array.isArray(v) &&
        v.length >= 1 &&
        v.length <= 10 &&
        v.every((id) => typeof id === 'string'),
    )
  )
    return rejected('يلزم من حركة إلى عشر حركات لكل طرف');
  const ids = [...(p.supplierIds as string[]), ...(p.ledgerIds as string[])];
  if (new Set(ids).size !== ids.length)
    return rejected('حركة مكررة في الاقتراح');
  let evidence: ReturnType<typeof proposalEvidence>;
  try {
    evidence = proposalEvidence(result);
  } catch (error) {
    return rejected(
      error instanceof Error && !(error instanceof TypeError)
        ? error.message
        : 'بنية النتيجة الحالية غير صالحة؛ أعد المصالحة',
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
      'حركة غير موجودة أو مستخدمة؛ أعد التحقق من النتيجة الحالية',
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
  if (proposed.some((t) => t.referenceEvidenceIssues?.length))
    return rejected(
      'دليل المرجع أو نوع المستند غير متحقق؛ راجع صفوف المصدر قبل اختبار الفرضية',
    );
  const types = new Set(
    proposed
      .map((t) => t.documentType)
      .filter((type) => type && type !== 'Unknown'),
  );
  if (types.size > 1)
    return rejected('أنواع المستندات متعارضة؛ تساوي المبلغ لا يثبت الربط');
  const orders = new Set(proposed.map((t) => t.poReference).filter(Boolean));
  if (orders.size > 1)
    return rejected('أوامر الشراء الصريحة متعارضة؛ يلزم دليل خارجي لتفسيرها');
  if (
    proposed.some((t) => !t.amount) ||
    new Set(proposed.map((t) => Math.sign(t.amount))).size > 1
  )
    return rejected(
      'إشارات المبالغ غير متسقة أو توجد حركة صفرية؛ لا تُختزل بالمقاصة',
    );
  const dates = proposed.map((t) => Date.parse(t.date));
  if (
    (Math.max(...dates) - Math.min(...dates)) / 86400000 >
    result.scope.dateWindow
  )
    return rejected('فارق تواريخ الحركات يتجاوز نافذة المقارنة المؤكدة');
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
      'المرجع مكرر؛ لا يجوز اختيار جزء من مجموعة ملتبسة وإخفاء بقية أعضائها',
    );
  let difference: number;
  try {
    difference = safeSum([
      ...(p.supplierIds as string[]).map((id) => a.get(id)!.amount),
      ...(p.ledgerIds as string[]).map((id) => -b.get(id)!.amount),
    ]);
  } catch {
    return rejected(
      'فرق الاقتراح يتجاوز حدود الحساب الآمن؛ لا يمكن إثباته داخل المحرك',
    );
  }
  return {
    status: 'needs-review' as const,
    difference,
    sourceIds: ids,
    reason:
      difference === 0
        ? 'تحقق تساوي المجموع الموقّع فقط. لا يثبت علاقة المستندات؛ الاقتراح لا ينشئ مطابقة.'
        : 'المبالغ الموقّعة لا تتساوى؛ لا يمكن اعتماد مطابقة.',
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
    (h) => `${h}؛ استدلال لفظي غير مثبت ولا يغيّر الإشارة أو التصنيف.`,
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
  const q = latinDigits(question).trim();
  const all = [...result.supplier.transactions, ...result.ledger.transactions];
  const references = (t: Transaction) =>
    [
      t.reference,
      t.documentReference,
      t.voucherReference,
      t.poReference,
      t.bankReference,
      t.receiptReference,
    ]
      .filter((value): value is string => !!value)
      .map((value) => latinDigits(value.trim()));
  const requested = (q.match(/[\p{L}\p{N}][\p{L}\p{N}_:/.-]*/gu) ?? []).filter(
    (token) =>
      token.length >= 4 && /\p{L}/u.test(token) && /\p{N}/u.test(token),
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
          reference.length >= 4 && containsExactIdentifier(q, reference),
      ),
  );
}

export function explainResult(
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
      text: 'لم أجد المرجع المطلوب كاملًا في النتيجة الحالية. اختر الحركة من الجدول أو تحقق من المرجع؛ لن أستبدله بمرجع مشابه.',
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
        lines.push('باقية للمراجعة؛ لا توجد مطابقة معتمدة لهذه الحركة.');
        lines.push(
          ...result.diagnostics
            .filter((d) => d.transactionIds.includes(t.id))
            .slice(0, 5)
            .map((d) => d.message),
        );
        if (
          !t.normalizedReference ||
          !/\p{L}/u.test(t.normalizedReference) ||
          !/\d/.test(t.normalizedReference) ||
          t.normalizedReference.length < 4
        )
          lines.push('المرجع لا يستوفي شرط المرجع القوي المختلط.');
        if (!t.amount) lines.push('الحركة الصفرية لا تطابق آليًا.');
        if (result.rejectedPairs.some((pair) => pair.split('|').includes(t.id)))
          lines.push('يوجد رابط فكه المراجع؛ لا يعاد تلقائيًا.');
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
        'يوجد أكثر من عشر حركات لهذا المرجع؛ اختر صفًا محددًا من المراجعة.',
      );
    return {
      kind: 'transaction',
      text: lines.join('\n'),
      sourceIds: [...refs],
    };
  }
  if (/فرق|difference|balance|رصيد|أرصدة|ارصدة/iu.test(q)) {
    const b = result.bridge;
    if (!b)
      return {
        kind: 'difference',
        text:
          'لا أستطيع إثبات فرق أرصدة مشترك: اتساق الأرصدة أو تغطية الفترات غير متحقق. المتاح مقارنة الحركات فقط.\n' +
          result.diagnostics
            .filter((d) => !d.transactionIds.length)
            .map((d) => d.message)
            .join('\n'),
        sourceIds: [],
      };
    return {
      kind: 'difference',
      text: [
        `فرق الأرصدة الفعلي (المورد ناقص الدفتر): ${fmt(b.delta)}. هذا الرقم من النتيجة؛ لا أعتمد رقمًا واردًا في السؤال.`,
        `رصيد المورد ${fmt(result.supplier.closing!)}؛ رصيد الدفتر ${fmt(result.ledger.closing!)}.`,
        `الجسر من المورد إلى الدفتر: ${fmt(result.supplier.closing!)} + (${fmt(b.openingAdjustment)} فرق الافتتاح) + (${fmt(b.itemAdjustment)} صافي آثار الحالات) = ${fmt(b.adjusted)}.`,
        `الباقي الحسابي ${fmt(b.residual)}؛ توجد ${result.supplierOnly.length + result.ledgerOnly.length} حركة دون مقابل. الصفر لا يثبت أسباب الفروق أو اكتمال التسوية.`,
        `${result.caseCounts.needsReviewCases} حالات تحتاج مراجعة. ${result.balanceComparable ? 'تغطية الفترة مؤكدة من المستخدم.' : 'معادلة الأرصدة متحققة؛ تأكيد اكتمال تغطية الفترة من المستخدم معلق.'}`,
        'راجع حالات فروق المبالغ والحركات دون مقابل؛ مرشح الدفعة ذو أثر صفري يبقى للمراجعة.',
      ].join('\n'),
      sourceIds: result.cases
        .filter((c) => c.bridgeEffect !== 0 || c.reviewRequired)
        .flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)),
    };
  }
  if (/أراجع|اراجع|next|review|ابدأ|ابدا/iu.test(q))
    return {
      kind: 'next',
      text: [
        `ابدأ بتحذيرات المصادر (${result.supplier.warnings.length + result.ledger.warnings.length}) ثم التكرارات المحتملة (${result.ambiguousIds.length} حركة).`,
        `راجع ${result.caseCounts.needsReviewCases} حالات تحتاج مراجعة، و${result.caseCounts.unmatchedCases} حالات غير مطابقة.`,
        'افتح «فحص» لتجد صف المصدر والإشارة والمرجع وأسباب المنع. تحقق من المستندات الخارجية قبل أي قرار يدوي.',
      ].join('\n'),
      sourceIds: result.ambiguousIds,
    };
  if (/تأكد|التأكد|تحقق|وصل|نتيجة|checks|result|explain/iu.test(q))
    return {
      kind: 'checks',
      text: [
        `استُخدمت ${result.supplier.transactions.length} حركة مورد و${result.ledger.transactions.length} حركة دفتر؛ استُبعد ${result.supplier.excluded.length + result.ledger.excluded.length} صف مع سبب (يشمل العناوين والفراغات).`,
        `${result.caseCounts.autoMatchedCases} حالات مطابقة آلية فردية أو تجميعية بأدلة المرجع والمبلغ الموقّع والتاريخ؛ ${result.caseCounts.matchedSourceRows} صف مصدر داخل المطابقات.`,
        `${result.matches.filter((m) => m.kind === 'manual').length} قرار يدوي؛ تأكيد المستخدم ليس إثباتًا من المحرك.`,
        'لم يتحقق النظام من أصالة المستندات أو شمول الملفين للنظام المحاسبي أو السبب الاقتصادي للفروق. تأكيد النطاق والتغطية مصدره المستخدم.',
        ...result.diagnostics
          .filter((d) => !d.transactionIds.length)
          .map((d) => d.message),
      ].join('\n'),
      sourceIds: [],
    };
  return {
    kind: 'unsupported',
    text: 'لم أحدد سؤالًا تدعمه أدلة النتيجة. اسأل عن فرق الأرصدة، ما لم يتم التأكد منه، أو ماذا تراجع الآن. لسؤال عن فاتورة اختر «اشرح هذه الحركة» أو اكتب مرجعها الأصلي. هذا مساعد قواعد محلي، وليس نموذج AI توليديًا، ولا يقدم فتوى محاسبية عامة.',
    sourceIds: [],
  };
}
