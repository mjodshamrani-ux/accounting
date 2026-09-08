import { latinDigits, money, normalizeReference, safeSum } from './core.ts';
import type { Comparison, Transaction } from './types.ts';

export type EvidenceAnswer = {
  kind: 'difference' | 'transaction' | 'checks' | 'next' | 'unsupported';
  text: string;
  sourceIds: string[];
};
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
  const a = new Map(result.supplierOnly.map((t) => [t.id, t]));
  const b = new Map(result.ledgerOnly.map((t) => [t.id, t]));
  if (
    !(p.supplierIds as string[]).every((id) => a.has(id)) ||
    !(p.ledgerIds as string[]).every((id) => b.has(id))
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
  const difference = safeSum([
    ...(p.supplierIds as string[]).map((id) => a.get(id)!.amount),
    ...(p.ledgerIds as string[]).map((id) => -b.get(id)!.amount),
  ]);
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
    : all.filter(
        (t) =>
          containsExactIdentifier(q, t.id) ||
          (t.reference.trim().length >= 4 &&
            containsExactIdentifier(q, latinDigits(t.reference.trim()))),
      );
  const requested = (q.match(/[\p{L}\p{N}][\p{L}\p{N}_:/.-]*/gu) ?? []).filter(
    (token) =>
      token.length >= 4 && /\p{L}/u.test(token) && /\p{N}/u.test(token),
  );
  if (
    !selectedId &&
    requested.some(
      (token) =>
        !all.some(
          (t) => t.id === token || latinDigits(t.reference.trim()) === token,
        ),
    )
  )
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
        `الجسر من المورد إلى الدفتر: ${fmt(result.supplier.closing!)} + (${fmt(b.openingAdjustment)} فرق الافتتاح) + (${fmt(b.itemAdjustment)} صافي البنود دون مقابل) = ${fmt(b.adjusted)}.`,
        `الباقي الحسابي ${fmt(b.residual)}؛ توجد ${result.supplierOnly.length + result.ledgerOnly.length} حركة دون مقابل. الصفر لا يثبت أسباب الفروق أو اكتمال التسوية.`,
        'راجع بنود المورد والدفتر دون مقابل في ورقة العمل؛ لا يمكن استنتاج السبب المحاسبي من المجموع وحده.',
      ].join('\n'),
      sourceIds: [...result.supplierOnly, ...result.ledgerOnly].map(
        (t) => t.id,
      ),
    };
  }
  if (/أراجع|اراجع|next|review|ابدأ|ابدا/iu.test(q))
    return {
      kind: 'next',
      text: [
        `ابدأ بتحذيرات المصادر (${result.supplier.warnings.length + result.ledger.warnings.length}) ثم التكرارات المحتملة (${result.ambiguousIds.length} حركة).`,
        `راجع ${result.supplierOnly.length} حركة لدى المورد و${result.ledgerOnly.length} حركة لدى الدفتر دون مقابل.`,
        'افتح «فحص» لتجد صف المصدر والإشارة والمرجع وأسباب المنع. تحقق من المستندات الخارجية قبل أي قرار يدوي.',
      ].join('\n'),
      sourceIds: result.ambiguousIds,
    };
  if (/تأكد|التأكد|تحقق|وصل|نتيجة|checks|result|explain/iu.test(q))
    return {
      kind: 'checks',
      text: [
        `استُخدمت ${result.supplier.transactions.length} حركة مورد و${result.ledger.transactions.length} حركة دفتر؛ استُبعد ${result.supplier.excluded.length + result.ledger.excluded.length} صف مع سبب (يشمل العناوين والفراغات).`,
        `${result.matches.filter((m) => m.kind === 'auto').length} مطابقة آلية بمرجع أصلي مطابق غير مكرر ومبلغ موقّع متساوٍ وتاريخ ضمن ${result.scope.dateWindow} أيام.`,
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
