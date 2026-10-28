import { useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { clearingGroupsCopy } from '@/lib/i18n/clearing-groups';
import { workerTask } from '@/lib/reconciliation/client';
import { money } from '@/lib/reconciliation/core';
import type { SourceFile } from '@/lib/reconciliation/types';
import type {
  ClearingReading,
  ClearingScope,
} from '@/lib/reconciliation/clearing';
import type {
  ClearingGroupsInput,
  ClearingGroupsResult,
} from '@/lib/reconciliation/clearing-groups';

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
  const copy = clearingGroupsCopy[lang];
  if (pages <= 1) return null;
  return (
    <nav className="clearing-actions" data-groups-pager={name}>
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

/** clearing-groups-1 beside clearing-1: review only. The parent remounts this
 * panel whenever the file, its reading or its scope changes, so a shown
 * result always belongs to the inputs on screen. */
export function ClearingGroupsPanel({
  file,
  reading,
  scope,
  disabled,
  run,
}: {
  file: SourceFile;
  reading: ClearingReading;
  scope: ClearingScope;
  disabled: boolean;
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}) {
  const { lang } = useI18n();
  const copy = clearingGroupsCopy[lang];
  const [result, setResult] = useState<ClearingGroupsResult | null>(null),
    [refused, setRefused] = useState(''),
    [groupPage, setGroupPage] = useState(0),
    [faultyPage, setFaultyPage] = useState(0);
  const show = () =>
    run(async (signal) => {
      setResult(null);
      setRefused('');
      try {
        const reply = await workerTask<{
          state: ClearingGroupsInput;
          result: ClearingGroupsResult;
        }>('clearing-groups-reconcile', { file, reading, scope }, signal);
        if (signal.aborted) return;
        setGroupPage(0);
        setFaultyPage(0);
        setResult(reply.result);
      } catch (error) {
        const code = /^CLEARING_GROUPS_([A-Z_]+)$/.exec(
          String((error as Error).message),
        )?.[1];
        if (!code) throw error;
        setRefused(code);
      }
    });
  const amount = (minor: number) => money(minor, result?.decimals ?? 2);
  const reasonCounts = result
    ? Object.entries(copy.reasons)
        .map(
          ([code]) =>
            [
              code,
              result.groups.filter((g) =>
                (g.reasons as string[]).includes(code),
              ).length,
            ] as const,
        )
        .filter(([, n]) => n)
    : [];
  const groupPages = result ? Math.ceil(result.groups.length / PAGE) : 0,
    faultyPages = result ? Math.ceil(result.faulty.length / PAGE) : 0;
  return (
    <section
      className="surface pad stack"
      data-clearing-groups
      data-groups-state={result ? 'shown' : refused ? 'refused' : 'idle'}
    >
      <h2>{copy.title}</h2>
      <p>{copy.intro}</p>
      <p>{copy.limits}</p>
      <Button disabled={disabled} onClick={() => void show()}>
        {copy.check}
      </Button>
      {refused && (
        <p role="alert" data-groups-refused={refused}>
          {copy.refused}: {copy.refusals[refused] ?? refused} ({refused})
        </p>
      )}
      {result && (
        <>
          <p
            data-groups-summary={JSON.stringify([
              result.groups.length,
              result.groups.filter((g) => g.status === 'cleared').length,
              result.faulty.length,
              result.faulty.filter((f) => f.isolated).length,
            ])}
          >
            {copy.summary(
              result.groups.length,
              result.groups.filter((g) => g.status === 'cleared').length,
              result.faulty.length,
              result.faulty.filter((f) => f.isolated).length,
            )}
          </p>
          {reasonCounts.length > 0 && (
            <section>
              <h3>{copy.byReason}</h3>
              <ul>
                {reasonCounts.map(([code, n]) => (
                  <li key={code} data-groups-reason={code} data-count={n}>
                    {copy.reasons[code]} ({code}): {n}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h3>{copy.groupsTitle}</h3>
          <div className="clearing-scroll">
            <table>
              <thead>
                <tr>
                  {copy.groupHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.groups
                  .slice(groupPage * PAGE, (groupPage + 1) * PAGE)
                  .map((g) => (
                    <tr
                      key={g.id}
                      data-group={JSON.stringify([
                        g.reference,
                        g.members.map((m) => [
                          m.row,
                          m.posting,
                          m.amount,
                          m.basis,
                        ]),
                        g.net,
                        g.status,
                        g.reasons,
                        g.connected.map((c) => [c.row, c.code]),
                        g.duplicates,
                      ])}
                    >
                      <td>
                        <bdi>{g.reference || copy.noReference}</bdi>
                      </td>
                      <td>
                        <ul>
                          {g.members.map((m) => (
                            <li key={m.row}>
                              <bdi>
                                {copy.member(
                                  m.row,
                                  m.posting,
                                  amount(m.amount),
                                )}
                              </bdi>
                            </li>
                          ))}
                        </ul>
                        {g.duplicates.map((rows) => (
                          <p key={rows.join(',')}>{copy.duplicates(rows)}</p>
                        ))}
                      </td>
                      <td>
                        <bdi>{amount(g.net)}</bdi>
                      </td>
                      <td>{copy.status[g.status]}</td>
                      <td data-group-reasons>
                        {g.reasons.map((code) => (
                          <p key={code}>
                            {copy.reasons[code]} ({code})
                          </p>
                        ))}
                      </td>
                      <td>
                        {g.connected.map((c) => (
                          <p key={c.row}>{copy.heldBy(c.row, c.code)}</p>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager
            name="groups"
            page={groupPage}
            pages={groupPages}
            onPage={setGroupPage}
          />
          <h3>{copy.faultyTitle}</h3>
          {result.faulty.length ? (
            <div className="clearing-scroll">
              <table>
                <thead>
                  <tr>
                    {copy.faultyHeaders.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.faulty
                    .slice(faultyPage * PAGE, (faultyPage + 1) * PAGE)
                    .map((f) => (
                      <tr
                        key={f.row}
                        data-faulty={JSON.stringify([
                          f.row,
                          f.code,
                          f.isolated,
                        ])}
                      >
                        <td>{f.row}</td>
                        <td>
                          {copy.codes[f.code]} ({f.code})
                        </td>
                        <td>{copy.isolated[String(f.isolated)]}</td>
                        <td>
                          <bdi>{f.values.join(' | ')}</bdi>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{copy.noFaulty}</p>
          )}
          <Pager
            name="faulty"
            page={faultyPage}
            pages={faultyPages}
            onPage={setFaultyPage}
          />
          {result.blank.length > 0 && (
            <p data-groups-blank={JSON.stringify(result.blank)}>
              {copy.blank(result.blank)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
