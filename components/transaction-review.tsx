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
    (m) => m.supplierId === id || m.ledgerId === id,
  );
  const candidates = (
    tx.side === 'supplier' ? result.ledgerOnly : result.supplierOnly
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
    <section className="review-detail stack" aria-label="فحص الحركة">
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2>
          فحص الحركة · <bdi>{tx.reference || `صف ${tx.row}`}</bdi>
        </h2>
        <Button variant="ghost" onClick={onClose}>
          إغلاق الفحص
        </Button>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {explanation.text}
      </p>
      <p>
        قيمة المصدر: <bdi>{tx.originalAmount}</bdi> · معرف الصف:{' '}
        <bdi>{tx.id}</bdi>
        {tx.sourcePage && <> · صفحة PDF الأصلية: {tx.sourcePage}</>}
      </p>
      {!match && (
        <>
          <p className="muted">
            المرشح لا يعني مطابقة. أول 50 نتيجة بحث من الطرف الآخر؛ لا يسمح باعتماد
            مبالغ مختلفة.
          </p>
          <Input
            aria-label="البحث عن مقابل"
            placeholder="مرجع أو وصف أو صف في الطرف الآخر"
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
              <SelectValue placeholder="اختر حركة مقابلة" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.reference || 'بلا مرجع'} ·{' '}
                  {money(t.amount, result.scope.decimals)} · صف {t.row}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen && (
            <p className={chosen.amount === tx.amount ? 'muted' : 'notice'}>
              {chosen.date} · {chosen.description} ·{' '}
              {chosen.amount === tx.amount
                ? 'المبلغ متساوٍ؛ يلزم دليل محاسبي للربط.'
                : 'المبلغ مختلف؛ الربط غير مسموح.'}
            </p>
          )}
        </>
      )}
      <Textarea
        aria-label="سبب القرار"
        placeholder="وثّق المستند أو سبب المراجعة أو فك الرابط"
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
              تسجيل مراجعة الاستثناء دون مطابقته
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
