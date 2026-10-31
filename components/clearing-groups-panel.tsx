import { useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { clearingGroupsCopy } from '@/lib/i18n/clearing-groups';
import { workerTask } from '@/lib/reconciliation/client';
import { Amount } from '@/components/amount';
import { RecordRows } from '@/components/record-table';
import type { SourceFile } from '@/lib/reconciliation/types';
import type {
  ClearingReading,
  ClearingScope,
} from '@/lib/reconciliation/clearing';
import type {
  ClearingGroupsInput,
  ClearingGroupsResult,
} from '@/lib/reconciliation/clearing-groups';

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
  const amount = (minor: number) => (
    <Amount minor={minor} decimals={result?.decimals ?? 2} />
  );
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
          <RecordRows
            label={copy.groupsTitle}
            headers={copy.groupHeaders}
            page={groupPage}
            onPage={setGroupPage}
            pager={{ 'data-groups-pager': 'groups' }}
            rows={result.groups}
            mark={(g) => ({
              'data-group': JSON.stringify([
                g.reference,
                g.members.map((m) => [m.row, m.posting, m.amount, m.basis]),
                g.net,
                g.status,
                g.reasons,
                g.connected.map((c) => [c.row, c.code]),
                g.duplicates,
              ]),
            })}
            cells={(g) => [
              <bdi key="reference">{g.reference || copy.noReference}</bdi>,
              <div key="members">
                <ul>
                  {g.members.map((m) => (
                    <li key={m.row}>
                      <bdi>{copy.member(m.row, m.posting)}</bdi>
                      {' · '}
                      {amount(m.amount)}
                    </li>
                  ))}
                </ul>
                {g.duplicates.map((rows) => (
                  <p key={rows.join(',')}>{copy.duplicates(rows)}</p>
                ))}
              </div>,
              amount(g.net),
              copy.status[g.status],
              <div key="reasons" data-group-reasons>
                {g.reasons.map((code) => (
                  <p key={code}>
                    {copy.reasons[code]} ({code})
                  </p>
                ))}
              </div>,
              <div key="held">
                {g.connected.map((c) => (
                  <p key={c.row}>{copy.heldBy(c.row, c.code)}</p>
                ))}
              </div>,
            ]}
          />
          <h3>{copy.faultyTitle}</h3>
          {result.faulty.length ? (
            <RecordRows
              label={copy.faultyTitle}
              headers={copy.faultyHeaders}
              page={faultyPage}
              onPage={setFaultyPage}
              pager={{ 'data-groups-pager': 'faulty' }}
              rows={result.faulty}
              mark={(f) => ({
                'data-faulty': JSON.stringify([f.row, f.code, f.isolated]),
              })}
              cells={(f) => [
                f.row,
                `${copy.codes[f.code]} (${f.code})`,
                copy.isolated[String(f.isolated)],
                f.values.join(' | '),
              ]}
            />
          ) : (
            <p>{copy.noFaulty}</p>
          )}
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
