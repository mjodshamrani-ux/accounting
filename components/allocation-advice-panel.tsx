import { useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { allocationAdviceCopy } from '@/lib/i18n/allocation-advice';
import { workerTask } from '@/lib/reconciliation/client';
import { Amount } from '@/components/amount';
import type {
  AllocationInput,
  AllocationResult,
} from '@/lib/reconciliation/allocation';
import {
  competitorsOf,
  twinsOf,
  type AllocationAdviceReview,
} from '@/lib/reconciliation/allocation-advice';

const PAGE = 50;

function Pager({
  name,
  page,
  pages,
  onPage,
}: {
  name: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { lang } = useI18n();
  const copy = allocationAdviceCopy[lang];
  if (pages <= 1) return null;
  return (
    <nav className="clearing-actions" data-advice-pager={name}>
      <Button
        variant="outline"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        {copy.previous}
      </Button>
      <output>{copy.page(page + 1, pages)}</output>
      <Button
        variant="outline"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        {copy.next}
      </Button>
    </nav>
  );
}

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
  const linePages = review ? Math.ceil(review.lines.length / PAGE) : 0,
    itemPages = review ? Math.ceil(review.items.length / PAGE) : 0;
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
          <div className="clearing-scroll">
            <table>
              <thead>
                <tr>
                  {copy.lineHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.lines
                  .slice(linePage * PAGE, (linePage + 1) * PAGE)
                  .map((l) => {
                    const competitors = competitorsOf(review, l),
                      twins = twinsOf(review, l);
                    return (
                      <tr
                        key={l.id}
                        data-advice-line={JSON.stringify([
                          l.row,
                          l.status,
                          l.reasons,
                          competitors,
                          twins,
                        ])}
                      >
                        <td>{l.row}</td>
                        <td>
                          <bdi>{l.reference}</bdi>
                        </td>
                        <td>
                          <bdi>
                            {l.payment} → {l.invoice}
                          </bdi>
                        </td>
                        <td>{amount(l.amount)}</td>
                        <td data-advice-status>{copy.status[l.status]}</td>
                        <td data-advice-reasons>
                          {l.reasons.map((code) => (
                            <p key={code}>
                              {copy.reasons[code]} ({code})
                            </p>
                          ))}
                        </td>
                        <td data-advice-competitors>
                          {copy.rows(competitors)}
                        </td>
                        <td data-advice-twins>{copy.rows(twins)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <Pager
            name="lines"
            page={linePage}
            pages={linePages}
            onPage={setLinePage}
          />
          <h3>{copy.itemsTitle}</h3>
          <div className="clearing-scroll">
            <table>
              <thead>
                <tr>
                  {copy.itemHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.items
                  .slice(itemPage * PAGE, (itemPage + 1) * PAGE)
                  .map((i) => (
                    <tr
                      key={i.id}
                      data-advice-item={JSON.stringify([
                        i.side,
                        i.reference,
                        i.remaining,
                        i.advised,
                        i.excess,
                      ])}
                    >
                      <td>{copy.sides[i.side]}</td>
                      <td>
                        <bdi>{i.reference}</bdi>
                      </td>
                      <td>{amount(i.available)}</td>
                      <td>{amount(i.allocated)}</td>
                      <td>{amount(i.remaining)}</td>
                      <td>{amount(i.advised)}</td>
                      <td>{amount(i.excess)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager
            name="items"
            page={itemPage}
            pages={itemPages}
            onPage={setItemPage}
          />
        </>
      )}
    </section>
  );
}
