/** Optional local measurement. This record grants no accounting authority.
 * Foreground time is a timer measurement, not proof of human attention. */
export const REVIEW_IDLE_MS = 30_000;
export const REVIEW_EVENT_LIMIT = 10_000;
export type ReviewStage = 'values' | 'table' | 'context';
export type PauseReason = 'manual' | 'idle' | 'hidden' | 'processing';
export type EffortAction =
  | { type: 'activity'; action: 'click' | 'change' }
  | { type: 'pause'; reason: PauseReason }
  | { type: 'resume' }
  | { type: 'stage'; stage: ReviewStage }
  | { type: 'rework'; enabled: boolean }
  | { type: 'finish'; reason: 'user' | 'event-limit' };
export type EffortEvent = Readonly<EffortAction & { atMs: number }>;
export type ReviewEffort = Readonly<{
  kind: 'review-effort';
  version: 1;
  sourceSha256: string;
  sample: 'development' | 'field-self-declared';
  startedAt: string;
  idleAfterMs: typeof REVIEW_IDLE_MS;
  events: readonly EffortEvent[];
}>;
const stages: ReviewStage[] = ['values', 'table', 'context'];
const reasons: PauseReason[] = ['manual', 'idle', 'hidden', 'processing'];
function invalid(): never {
  throw new Error('review-effort');
}
function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
function validEvent(value: unknown): value is EffortEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (!Number.isSafeInteger(e.atMs) || Number(e.atMs) < 0) return false;
  switch (e.type) {
    case 'activity':
      return (
        exact(e, ['type', 'action', 'atMs']) &&
        typeof e.action === 'string' &&
        ['click', 'change'].includes(e.action)
      );
    case 'pause':
      return (
        exact(e, ['type', 'reason', 'atMs']) &&
        reasons.includes(e.reason as PauseReason)
      );
    case 'resume':
      return exact(e, ['type', 'atMs']);
    case 'stage':
      return (
        exact(e, ['type', 'stage', 'atMs']) &&
        stages.includes(e.stage as ReviewStage)
      );
    case 'rework':
      return (
        exact(e, ['type', 'enabled', 'atMs']) && typeof e.enabled === 'boolean'
      );
    case 'finish':
      return (
        exact(e, ['type', 'reason', 'atMs']) &&
        typeof e.reason === 'string' &&
        ['user', 'event-limit'].includes(e.reason)
      );
    default:
      return false;
  }
}
export function summarizeReviewEffort(record: ReviewEffort) {
  if (
    !exact(record, [
      'kind',
      'version',
      'sourceSha256',
      'sample',
      'startedAt',
      'idleAfterMs',
      'events',
    ]) ||
    record.kind !== 'review-effort' ||
    record.version !== 1 ||
    typeof record.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
    !['development', 'field-self-declared'].includes(record.sample) ||
    typeof record.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    new Date(record.startedAt).toISOString() !== record.startedAt ||
    record.idleAfterMs !== REVIEW_IDLE_MS ||
    !Array.isArray(record.events) ||
    record.events.length > REVIEW_EVENT_LIMIT
  )
    invalid();
  let atMs = 0,
    lastActivityMs = 0,
    stage: ReviewStage = 'values',
    rework = false;
  let paused: PauseReason | null = null,
    finished = false;
  const firstMs = { values: 0, table: 0, context: 0 },
    reworkMs = { values: 0, table: 0, context: 0 },
    pausedMs = { manual: 0, idle: 0, hidden: 0, processing: 0 },
    actions = { click: 0, change: 0 };
  let resumes = 0;
  for (const e of record.events) {
    if (!validEvent(e) || finished || e.atMs < atMs) invalid();
    if (!paused && e.atMs > lastActivityMs + REVIEW_IDLE_MS) invalid();
    const duration = e.atMs - atMs;
    if (paused) pausedMs[paused] += duration;
    else (rework ? reworkMs : firstMs)[stage] += duration;
    switch (e.type) {
      case 'pause':
        if (
          paused ||
          (e.reason === 'idle' && e.atMs !== lastActivityMs + REVIEW_IDLE_MS)
        )
          invalid();
        paused = e.reason;
        break;
      case 'resume':
        if (!paused) invalid();
        paused = null;
        lastActivityMs = e.atMs;
        resumes++;
        break;
      case 'activity':
        if (paused) invalid();
        actions[e.action]++;
        lastActivityMs = e.atMs;
        break;
      case 'stage':
        stage = e.stage;
        if (!paused) lastActivityMs = e.atMs;
        break;
      case 'rework':
        rework = e.enabled;
        if (!paused) lastActivityMs = e.atMs;
        break;
      case 'finish':
        finished = true;
        break;
    }
    atMs = e.atMs;
  }
  const activeMs =
    Object.values(firstMs).reduce((a, b) => a + b, 0) +
    Object.values(reworkMs).reduce((a, b) => a + b, 0);
  return {
    atMs,
    lastActivityMs,
    stage,
    rework,
    paused,
    finished,
    firstMs,
    reworkMs,
    pausedMs,
    activeMs,
    actions,
    resumes,
  };
}
function freeze(record: ReviewEffort): ReviewEffort {
  record.events.forEach(Object.freeze);
  Object.freeze(record.events);
  return Object.freeze(record);
}
export function startReviewEffort(
  sourceSha256: string,
  sample: ReviewEffort['sample'],
  startedAt: string,
): ReviewEffort {
  const record: ReviewEffort = {
    kind: 'review-effort',
    version: 1,
    sourceSha256,
    sample,
    startedAt,
    idleAfterMs: REVIEW_IDLE_MS,
    events: [],
  };
  summarizeReviewEffort(record);
  return freeze(record);
}
/** Inserts inactivity at the actual deadline, even after a throttled timer.
 * A delayed click never silently resumes measurement. */
export function advanceReviewEffort(
  record: ReviewEffort,
  atMs: number,
  action?: EffortAction,
): ReviewEffort {
  const state = summarizeReviewEffort(record);
  if (!Number.isSafeInteger(atMs) || atMs < state.atMs || state.finished)
    invalid();
  const events = [...record.events];
  const deadline = state.lastActivityMs + REVIEW_IDLE_MS;
  if (events.length >= REVIEW_EVENT_LIMIT - 1) {
    events.push({
      type: 'finish',
      reason: 'event-limit',
      atMs: state.paused ? atMs : Math.min(atMs, deadline),
    });
    const next = { ...record, events };
    summarizeReviewEffort(next);
    return freeze(next);
  }
  if (!state.paused && atMs >= deadline)
    events.push({ type: 'pause', reason: 'idle', atMs: deadline });
  const paused = state.paused || events.at(-1)?.type === 'pause';
  if (events.length >= REVIEW_EVENT_LIMIT - 1) {
    events.push({ type: 'finish', reason: 'event-limit', atMs });
  } else if (
    action &&
    !(paused && (action.type === 'activity' || action.type === 'pause'))
  ) {
    events.push({ ...action, atMs });
  }
  const next = { ...record, events };
  summarizeReviewEffort(next);
  return freeze(next);
}
export function saveReviewEffort(record: ReviewEffort): string {
  if (!summarizeReviewEffort(record).finished) invalid();
  return JSON.stringify(record, null, 2);
}
export function restoreReviewEffort(json: string): ReviewEffort {
  if (json.length > 2_000_000) invalid();
  const record = JSON.parse(json) as ReviewEffort;
  if (!summarizeReviewEffort(record).finished) invalid();
  return freeze(record);
}
