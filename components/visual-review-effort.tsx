import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n/context';
import { Button } from './ui/button';
import {
  startReviewEffort,
  advanceReviewEffort,
  summarizeReviewEffort,
  saveReviewEffort,
  type ReviewEffort,
  type EffortAction,
  type ReviewStage,
} from '@/lib/review-effort';

/** Optional measurement for this image only; no persistence or network sink. */
export function VisualReviewEffort({
  sourceSha256,
  disabled,
  children,
}: {
  sourceSha256: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n(),
    v = t.reviewEffort;
  const [sample, setSample] = useState<ReviewEffort['sample'] | ''>('');
  const [record, setRecord] = useState<ReviewEffort | null>(null);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState(false);
  const current = useRef<ReviewEffort | null>(null),
    origin = useRef(0);
  const now = useCallback(
    () => Math.max(0, Math.floor(performance.now() - origin.current)),
    [],
  );
  const emit = useCallback(
    (action?: EffortAction) => {
      const r = current.current;
      if (!r || summarizeReviewEffort(r).finished) return;
      try {
        const at = now(),
          next = advanceReviewEffort(r, at, action);
        current.current = next;
        setRecord(next);
        setClock(at);
      } catch {
        setError(true);
      }
    },
    [now],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden || !document.hasFocus())
        emit({ type: 'pause', reason: 'hidden' });
    };
    const blur = () => emit({ type: 'pause', reason: 'hidden' });
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    const timer = window.setInterval(() => emit(), 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
    };
  }, [emit]);
  useEffect(() => {
    if (disabled) emit({ type: 'pause', reason: 'processing' });
  }, [disabled, emit]);
  useEffect(() => {
    const root = document.getElementById('visual-reader');
    const activity = (event: Event) => {
      if (
        !disabled &&
        event.target instanceof Element &&
        !event.target.closest('[data-review-effort-controls]')
      )
        emit({
          type: 'activity',
          action: event.type === 'click' ? 'click' : 'change',
        });
    };
    // Includes selecting words/crops above the value editor. No values or
    // element identifiers enter the record. Native input counts field events.
    root?.addEventListener('click', activity, true);
    root?.addEventListener('input', activity, true);
    return () => {
      root?.removeEventListener('click', activity, true);
      root?.removeEventListener('input', activity, true);
    };
  }, [disabled, emit]);
  const state = record ? summarizeReviewEffort(record) : null;
  const lastEvent = record?.events.at(-1);
  const totals =
    record && state
      ? state.finished
        ? state
        : summarizeReviewEffort(
            advanceReviewEffort(record, Math.max(clock, state.atMs), {
              type: 'finish',
              reason: 'user',
            }),
          )
      : null;
  const controlsDisabled = disabled || !state || state.finished || error;
  const seconds = (ms: number) => Math.floor(ms / 1000);
  function download() {
    if (!record || error) return;
    try {
      const url = URL.createObjectURL(
        new Blob([saveReviewEffort(record)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `tarasuf-review-effort-${sourceSha256.slice(0, 8)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="stack visual-review-effort-wrap">
      <details
        className="surface pad stack visual-review-effort"
        data-review-effort-controls="true"
      >
        <summary>{v.title}</summary>
        <p>{v.intro}</p>
        <p className="hint">{v.limits}</p>
        <label className="field">
          {v.sample}
          <select
            aria-label={v.sample}
            value={sample}
            disabled={!!record || disabled}
            onChange={(e) => setSample(e.target.value as typeof sample)}
          >
            <option value="">{v.choose}</option>
            <option value="development">{v.development}</option>
            <option value="field-self-declared">{v.field}</option>
          </select>
        </label>
        {!record && (
          <Button
            disabled={!sample || disabled}
            onClick={() => {
              if (!sample || document.hidden || !document.hasFocus()) return;
              origin.current = performance.now();
              const next = startReviewEffort(
                sourceSha256,
                sample,
                new Date().toISOString(),
              );
              current.current = next;
              setRecord(next);
              setClock(0);
              setError(false);
            }}
          >
            {v.start}
          </Button>
        )}
        {state && (
          <>
            <output>
              {state.finished
                ? v.finished
                : state.paused
                  ? v.paused[state.paused]
                  : v.running}
            </output>
            <label className="field">
              {v.stage}
              <select
                aria-label={v.stage}
                value={state.stage}
                disabled={controlsDisabled}
                onChange={(e) =>
                  emit({ type: 'stage', stage: e.target.value as ReviewStage })
                }
              >
                {(['values', 'table', 'context'] as const).map((s) => (
                  <option key={s} value={s}>
                    {v.stages[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.rework}
                disabled={controlsDisabled}
                onChange={(e) =>
                  emit({ type: 'rework', enabled: e.target.checked })
                }
              />
              {v.rework}
            </label>
            <div className="visual-crop-actions">
              <Button
                variant="outline"
                disabled={controlsDisabled}
                onClick={() => {
                  if (state.paused) {
                    if (!document.hidden && document.hasFocus())
                      emit({ type: 'resume' });
                  } else emit({ type: 'pause', reason: 'manual' });
                }}
              >
                {state.paused ? v.resume : v.pause}
              </Button>
              <Button
                variant="outline"
                disabled={!state || state.finished || error}
                onClick={() => emit({ type: 'finish', reason: 'user' })}
              >
                {v.finish}
              </Button>
              <Button
                variant="outline"
                disabled={!state.finished || error}
                onClick={download}
              >
                {v.export}
              </Button>
            </div>
            {totals && (
              <ul>
                <li>{v.active(seconds(totals.activeMs))}</li>
                <li>
                  {v.reworked(
                    seconds(
                      Object.values(totals.reworkMs).reduce((a, b) => a + b, 0),
                    ),
                  )}
                </li>
                <li>
                  {v.stopped(
                    seconds(
                      Object.values(totals.pausedMs).reduce((a, b) => a + b, 0),
                    ),
                  )}
                </li>
                <li>
                  {v.actions(
                    totals.actions.click,
                    totals.actions.change,
                    totals.resumes,
                  )}
                </li>
              </ul>
            )}
            {lastEvent?.type === 'finish' &&
              lastEvent.reason === 'event-limit' && <p>{v.limit}</p>}
            {(state.finished || error) && (
              <Button
                variant="outline"
                onClick={() => {
                  current.current = null;
                  setRecord(null);
                  setClock(0);
                  setError(false);
                  setSample('');
                }}
              >
                {v.newMeasurement}
              </Button>
            )}
          </>
        )}
        {error && <p role="alert">{v.failed}</p>}
      </details>
      {children}
    </div>
  );
}
