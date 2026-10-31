import { useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { allocationAdviceCopy } from '@/lib/i18n/allocation-advice';
import { workerTask } from '@/lib/reconciliation/client';
import { Amount } from '@/components/amount';
import { RecordRows, RecordTable } from '@/components/record-table';
import type {
  AllocationInput,
  AllocationResult,
} from '@/lib/reconciliation/allocation';
import {
  competitorsOf,
  twinsOf,
  type AllocationAdviceReview,
} from '@/lib/reconciliation/allocation-advice';

/** allocation-advice-review-1 beside allocation-snapshot-1: review only. The
 * parent remounts this panel whenever its files, readings, scope or
 * decisions change, so a shown review always belongs to the inputs on
 * screen. */
export function AllocationAdvicePanel({
  input,
  disabled,
  run,
}: {
  input: () => AllocationInput;
  disabled: boolean;
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}) {
  const { lang } = useI18n();
  const copy = allocationAdviceCopy[lang];
  const [review, setReview] = useState<AllocationAdviceReview | null>(null),
    [refused, setRefused] = useState(''),
    [linePage, setLinePage] = useState(0),
    [itemPage, setItemPage] = useState(0);
  const show = () =>
    run(async (signal) => {
      setReview(null);
      setRefused('');
      const owned = structuredClone(input());
      try {
        const reply = await workerTask<{
          state: AllocationInput;
          result: AllocationResult;
          review: AllocationAdviceReview;
        }>('allocation-advice-review', owned, signal);
        if (signal.aborted) return;
        setLinePage(0);
        setItemPage(0);
        setReview(reply.review);
      } catch (error) {
        const code = /^ALLOCATION_ADVICE_([A-Z_]+)$/.exec(
          String((error as Error).message),
        )?.[1];
        if (!code || code === 'WORKER_BINDING') throw error;
        setRefused(code);
      }
    });
  const amount = (minor: number) => (
    <Amount minor={minor} decimals={review?.decimals ?? 2} />
  );
  const counts = review
    ? {
        fits: review.lines.filter((l) => l.status === 'fits').length,
        review: review.lines.filter((l) => l.status === 'review').length,
        allocated: review.lines.filter((l) => l.status === 'allocated').length,
      }
    : null;
  const reasonCounts = review
    ? Object.keys(copy.reasons)
        .map(
          (code) =>
            [
              code,
              review.lines.filter((l) => (l.reasons as string[]).includes(code))
                .length,
            ] as const,
        )
        .filter(([, n]) => n)
    : [];
  return (
    <section
      className="surface pad stack"
      data-allocation-advice
      data-advice-state={review ? 'shown' : refused ? 'refused' : 'idle'}
    >
      <h2>{copy.title}</h2>
      <p>{copy.intro}</p>
      <p>{copy.limits}</p>
      <Button disabled={disabled} onClick={() => void show()}>
        {copy.check}
      </Button>
      {refused && (
        <p role="alert" data-advice-refused={refused}>
          {copy.refused}: {copy.refusals[refused] ?? refused} ({refused})
        </p>
      )}
      {review && counts && (
        <>
          <p
            data-advice-summary={JSON.stringify([
              review.lines.length,
              counts.fits,
              counts.review,
              counts.allocated,
            ])}
          >
            {copy.summary(
              review.lines.length,
              counts.fits,
              counts.review,
              counts.allocated,
            )}
          </p>
          {reasonCounts.length > 0 && (
            <section>
              <h3>{copy.byReason}</h3>
              <ul>
                {reasonCounts.map(([code, n]) => (
                  <li key={code} data-advice-reason={code} data-count={n}>
                    {copy.reasons[code]} ({code}): {n}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h3>{copy.linesTitle}</h3>
          <RecordRows
            label={copy.linesTitle}
            headers={copy.lineHeaders}
            page={linePage}
            onPage={setLinePage}
            pager={{ 'data-advice-pager': 'lines' }}
            rows={review.lines.map((l) => {
              // Worked out for the rows of the page shown, once each.
              let competitors: number[] | undefined,
                twins: number[] | undefined;
              return {
                line: l,
                competitors: () => (competitors ??= competitorsOf(review, l)),
                twins: () => (twins ??= twinsOf(review, l)),
              };
            })}
            cells={({ line: l, competitors, twins }) => [
              l.row,
              <bdi key="reference">{l.reference}</bdi>,
              <bdi key="pair">
                {l.payment} → {l.invoice}
              </bdi>,
              amount(l.amount),
              <span key="status" data-advice-status>
                {copy.status[l.status]}
              </span>,
              <div key="reasons" data-advice-reasons>
                {l.reasons.map((code) => (
                  <p key={code}>
                    {copy.reasons[code]} ({code})
                  </p>
                ))}
              </div>,
              <span key="competitors" data-advice-competitors>
                {copy.rows(competitors())}
              </span>,
              <span key="twins" data-advice-twins>
                {copy.rows(twins())}
              </span>,
            ]}
            mark={({ line: l, competitors, twins }) => ({
              'data-advice-line': JSON.stringify([
                l.row,
                l.status,
                l.reasons,
                competitors(),
                twins(),
              ]),
            })}
          />
          <h3>{copy.itemsTitle}</h3>
          <RecordTable
            label={copy.itemsTitle}
            headers={copy.itemHeaders}
            page={itemPage}
            onPage={setItemPage}
            pager={{ 'data-advice-pager': 'items' }}
            rows={review.items.map((i) => [
              copy.sides[i.side],
              <bdi key="reference">{i.reference}</bdi>,
              amount(i.available),
              amount(i.allocated),
              amount(i.remaining),
              amount(i.advised),
              amount(i.excess),
            ])}
            marks={review.items.map((i) => ({
              'data-advice-item': JSON.stringify([
                i.side,
                i.reference,
                i.remaining,
                i.advised,
                i.excess,
              ]),
            }))}
          />
        </>
      )}
    </section>
  );
}
