import { useId, useState } from 'react';
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
import { useI18n } from '@/lib/i18n/context';
import { decisionPlatformCopy } from '@/lib/i18n/decision-platform';
import { useDecisionFocus } from '@/components/decision-platform';
import { invoiceOverlapIntegratedCopy } from '@/lib/i18n/invoice-overlap-review';
export function TransactionReview({
  result,
  id,
  busy,
  onClose,
  onLink,
  onUnlink,
  onReview,
  onGroupReview,
  reviewed = false,
}: {
  result: Comparison;
  id: string;
  busy: boolean;
  reviewed?: boolean;
  onClose: () => void;
  onLink: (d: Decision) => void;
  onUnlink: (supplierId: string, ledgerId: string, note: string) => void;
  onReview: (id: string, note: string) => void;
  onGroupReview?: () => void;
}) {
  const { t: m, engineText, lang } = useI18n();
  const [query, setQuery] = useState(''),
    [candidate, setCandidate] = useState(''),
    [note, setNote] = useState('');
  // The sentence under the decisions says which are open and what the
  // others wait for; a recorded review is shown, and takes the focus (UX-3).
  const hint = useId(),
    reviewLine = useId();
  const settle = useDecisionFocus();
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
  // With a transaction id the engine explains that transaction; the wording of
  // the question does not change the answer.
  const explanation = explainResult(result, m.assistant.presets.explain, id);
  const r = m.transactionReview;
  const linkReady = !!chosen && chosen.amount === tx.amount;
  const hintKey = !note.trim()
    ? 'reason'
    : match
      ? 'unlink'
      : linkReady
        ? 'both'
        : 'link';
  const hintText =
    hintKey === 'reason'
      ? decisionPlatformCopy[lang].reason(r.noteLabel)
      : hintKey === 'unlink'
        ? decisionPlatformCopy[lang].review.opens(r.unlink)
        : hintKey === 'both'
          ? r.hint.both(r.link, r.reviewOnly)
          : r.hint.link(r.reviewOnly, r.link);
  return (
    <section className="review-detail stack" aria-label={m.transactionReview.region}>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2>
          {m.transactionReview.heading}{' '}
          <bdi>{tx.reference || m.transactionReview.row(tx.row)}</bdi>
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {m.transactionReview.close}
        </Button>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {engineText(explanation.text)}
      </p>
      <p>
        {m.transactionReview.originalAmount}
        <bdi>{tx.originalAmount}</bdi>
        {m.transactionReview.rowId} <bdi>{tx.id}</bdi>
        {tx.sourcePage && <>{m.transactionReview.pdfPage(tx.sourcePage)}</>}
      </p>
      {!match && (
        <>
          <p className="muted">{m.transactionReview.candidatesNote}</p>
          <Input
            aria-label={m.transactionReview.searchLabel}
            placeholder={m.transactionReview.searchPlaceholder}
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
            <SelectTrigger aria-label={m.transactionReview.counterpartLabel}>
              <SelectValue placeholder={m.transactionReview.counterpartPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.reference || m.transactionReview.noReference} ·{' '}
                  {money(t.amount, result.scope.decimals)}
                  {m.transactionReview.candidateRow(t.row)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen && (
            <p className={chosen.amount === tx.amount ? 'muted' : 'notice'}>
              {chosen.date} · {chosen.description} ·{' '}
              {chosen.amount === tx.amount
                ? m.transactionReview.amountsEqual
                : m.transactionReview.amountsDiffer}
            </p>
          )}
        </>
      )}
      {reviewed && (
        <p className="muted" id={reviewLine} tabIndex={-1} data-decision-state>
          {m.app.results.reviewedStillOpen}
        </p>
      )}
      <Textarea
        aria-label={m.transactionReview.noteLabel}
        aria-describedby={match?.reviewedAggregate ? undefined : hint}
        placeholder={m.transactionReview.notePlaceholder}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="actions">
        {match?.reviewedAggregate ? (
          <Button variant="outline" disabled={busy || !onGroupReview} onClick={onGroupReview}>
            {invoiceOverlapIntegratedCopy(lang).wholeComponentUndo}
          </Button>
        ) : match ? (
          <Button
            variant="outline"
            aria-describedby={hint}
            disabled={busy || !note.trim()}
            onClick={() => onUnlink(match.supplierId, match.ledgerId, note)}
          >
            {m.transactionReview.unlink}
          </Button>
        ) : (
          <>
            <Button
              aria-describedby={hint}
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
              {m.transactionReview.link}
            </Button>
            <Button
              variant="outline"
              aria-describedby={hint}
              disabled={busy || !note.trim()}
              onClick={() => {
                onReview(id, note);
                setNote('');
                settle(reviewLine);
              }}
            >
              {m.transactionReview.reviewOnly}
            </Button>
          </>
        )}
      </div>
      {!match?.reviewedAggregate && (
        <p id={hint} className="decision-hint" data-decision-hint={hintKey}>
          {hintText}
        </p>
      )}
    </section>
  );
}
