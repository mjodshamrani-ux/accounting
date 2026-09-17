import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { explainResult } from '@/lib/reconciliation/assistant';
import { money } from '@/lib/reconciliation/core';
import type { Comparison, Decision } from '@/lib/reconciliation/types';
export function TransactionReview({
  result,
  id,
  busy,
  onClose,
  onLink,
  onUnlink,
  onReview,
}: {
  result: Comparison;
  id: string;
  busy: boolean;
  onClose: () => void;
  onLink: (d: Decision) => void;
  onUnlink: (supplierId: string, ledgerId: string, note: string) => void;
  onReview: (id: string, note: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [candidate, setCandidate] = useState(''),
    [note, setNote] = useState('');
  const all = [...result.supplier.transactions, ...result.ledger.transactions];
  const tx = all.find((t) => t.id === id);
  if (!tx) return null;
  const match = result.matches.find(
    (m) =>
      (m.supplierIds ?? [m.supplierId]).includes(id) ||
      (m.ledgerIds ?? [m.ledgerId]).includes(id),
  );
  const candidates = result.cases
    .filter((c) => c.status !== 'Matched')
    .flatMap((c) =>
      tx.side === 'supplier' ? c.ledgerMembers : c.supplierMembers,
    )
    .filter(
      (t) =>
        !query ||
        `${t.reference} ${t.description} ${t.row}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 50);
  const chosen = candidates.find((t) => t.id === candidate);
  const explanation = explainResult(result, 'شرح', id);
  return (
    <section className="review-detail stack" aria-label="مراجعة الحركة">
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2>
          مراجعة الحركة <bdi>{tx.reference || `صف ${tx.row}`}</bdi>
        </h2>
        <Button variant="ghost" onClick={onClose}>
          إغلاق المراجعة
        </Button>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {explanation.text}
      </p>
      <p>
        المبلغ في الملف الأصلي: <bdi>{tx.originalAmount}</bdi> · معرّف الصف:{' '}
        <bdi>{tx.id}</bdi>
        {tx.sourcePage && <> · الصفحة في ملف PDF: {tx.sourcePage}</>}
      </p>
      {!match && (
        <>
          <p className="muted">
            نعرض حتى 50 نتيجة من الملف الآخر. ظهور حركة هنا لا يعني أنها مطابقة،
            ولا يمكن تأكيد الربط إذا اختلف المبلغ.
          </p>
          <Input
            aria-label="البحث عن حركة مقابلة"
            placeholder="ابحث بالمرجع أو الوصف أو رقم الصف في الملف الآخر"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCandidate('');
            }}
          />
          <Select
            value={candidate}
            onValueChange={(v) => setCandidate(String(v))}
          >
            <SelectTrigger aria-label="الحركة المقابلة">
              <SelectValue placeholder="اختر حركة من الملف الآخر" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.reference || 'بدون مرجع'} ·{' '}
                  {money(t.amount, result.scope.decimals)} · صف {t.row}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen && (
            <p className={chosen.amount === tx.amount ? 'muted' : 'notice'}>
              {chosen.date} · {chosen.description} ·{' '}
              {chosen.amount === tx.amount
                ? 'المبلغان متساويان. تأكيد الربط يحتاج دليلًا محاسبيًا.'
                : 'المبلغان مختلفان، لذلك لا يمكن ربط الحركتين.'}
            </p>
          )}
        </>
      )}
      <Textarea
        aria-label="سبب القرار"
        placeholder="اكتب دليل الربط أو سبب المراجعة أو فك الربط"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="actions">
        {match ? (
          <Button
            variant="outline"
            disabled={busy || !note.trim()}
            onClick={() => onUnlink(match.supplierId, match.ledgerId, note)}
          >
            فك الربط وإعادته للمراجعة
          </Button>
        ) : (
          <>
            <Button
              disabled={
                busy || !chosen || chosen.amount !== tx.amount || !note.trim()
              }
              onClick={() =>
                onLink({
                  supplierId: tx.side === 'supplier' ? tx.id : chosen!.id,
                  ledgerId: tx.side === 'ledger' ? tx.id : chosen!.id,
                  note,
                })
              }
            >
              تأكيد الربط يدويًا
            </Button>
            <Button
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() => {
                onReview(id, note);
                setNote('');
              }}
            >
              تسجيل مراجعة دون مطابقة
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
