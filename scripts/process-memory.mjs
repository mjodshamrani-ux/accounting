/** Sum RSS only when ps returned exactly the processes requested from Chromium.
 * A process disappearing between CDP and ps invalidates that sample; it must
 * not make an incomplete measurement look like a memory improvement.
 * @param {number[]} expectedIds
 * @param {string} stdout
 */
export function processRssBytes(expectedIds, stdout) {
  const expected = new Set(expectedIds);
  if (
    !expected.size ||
    expected.size !== expectedIds.length ||
    expectedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error('Invalid Chromium process identifiers');
  const seen = new Set();
  const zeroRssIds = [];
  let bytes = 0;
  for (const line of stdout.trim().split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2 || fields.some((field) => !/^\d+$/.test(field)))
      throw new Error('Invalid Chromium PID/RSS sample');
    const [id, rss] = fields.map(Number);
    if (
      !expected.has(id) ||
      seen.has(id) ||
      !Number.isSafeInteger(rss) ||
      rss < 0
    )
      throw new Error('Incomplete or invalid Chromium PID/RSS sample');
    seen.add(id);
    if (rss === 0) zeroRssIds.push(id);
    bytes += rss * 1024;
    if (!Number.isSafeInteger(bytes))
      throw new Error('Chromium RSS exceeds the safe integer range');
  }
  const missingIds = expectedIds.filter((id) => !seen.has(id));
  if (missingIds.length || zeroRssIds.length)
    throw Object.assign(
      new Error(
        missingIds.length
          ? 'Missing Chromium process in RSS sample'
          : 'Zero Chromium RSS is an unavailable measurement',
      ),
      {
        code: missingIds.length
          ? 'MISSING_CHROMIUM_PROCESS'
          : 'ZERO_CHROMIUM_RSS',
        missingIds,
        zeroRssIds,
        unavailableIds: [...missingIds, ...zeroRssIds],
      },
    );
  return bytes;
}

/** A partial sample still fails. One fresh sample is allowed only when an
 * auxiliary process is proved dead by both CDP and the OS. Live or accounting
 * renderer/worker processes must never disappear from an accepted sample. */
export async function sampleProcessRss({
  listProcesses,
  readRss,
  isAlive,
  onAttempt = (attempt) => void attempt,
  timeoutMs = 5000,
}) {
  let active = true;
  const emit = (attempt) => {
    if (active) onAttempt(attempt);
  };
  try {
    return await withinMemoryDeadline(async () => {
      const validate = (info) => {
        if (
          !Array.isArray(info) ||
          !info.length ||
          info.length > 1000 ||
          info.some(
            (p) =>
              !Number.isSafeInteger(p.id) ||
              p.id <= 0 ||
              typeof p.type !== 'string',
          ) ||
          new Set(info.map((p) => p.id)).size !== info.length
        )
          throw Error('Invalid Chromium process list');
        return info;
      };
      const attempts = [];
      const measure = async (info) => {
        const attempt = {
          requestedProcesses: info.map(({ id, type }) => ({ id, type })),
          stdout: '',
          status: 'pending',
        };
        attempts.push(attempt);
        emit(structuredClone(attempt));
        try {
          attempt.stdout = await readRss(info.map((p) => p.id));
          const rssBytes = processRssBytes(
            info.map((p) => p.id),
            attempt.stdout,
          );
          attempt.status = 'complete';
          emit(structuredClone(attempt));
          return { rssBytes, attempts };
        } catch (error) {
          attempt.status = 'failed';
          attempt.error = error.message;
          attempt.missingIds = error.missingIds ?? [];
          attempt.zeroRssIds = error.zeroRssIds ?? [];
          emit(structuredClone(attempt));
          throw error;
        }
      };
      const initial = validate(await listProcesses());
      try {
        return await measure(initial);
      } catch (error) {
        const unavailableIds = error.unavailableIds ?? error.missingIds;
        if (
          !['MISSING_CHROMIUM_PROCESS', 'ZERO_CHROMIUM_RSS'].includes(
            error.code,
          ) ||
          !Array.isArray(unavailableIds) ||
          !unavailableIds.length ||
          unavailableIds.some((id) =>
            /browser|renderer|worker|gpu/i.test(
              initial.find((p) => p.id === id).type,
            ),
          )
        )
          throw error;
        const fresh = validate(await listProcesses());
        const freshIds = new Set(fresh.map((p) => p.id));
        const osChecks = unavailableIds.map((id) => ({
          id,
          alive: isAlive(id),
        }));
        attempts.at(-1).qualification = {
          unavailableIds,
          freshProcesses: fresh,
          osChecks,
          permitsRetry: false,
        };
        emit(structuredClone(attempts.at(-1)));
        // A live missing process or a second disappearance earns no retry.
        if (
          unavailableIds.some((id) => freshIds.has(id)) ||
          osChecks.some(({ alive }) => alive !== false) ||
          initial.some(
            (p) => !unavailableIds.includes(p.id) && !freshIds.has(p.id),
          )
        )
          throw error;
        attempts.at(-1).qualification.permitsRetry = true;
        emit(structuredClone(attempts.at(-1)));
        return measure(fresh);
      }
    }, timeoutMs);
  } finally {
    active = false;
  }
}

/** Require a full sample interval inside a real dispatched export operation. */
export function exportMemorySamples(samples, actions) {
  return samples.filter((sample) =>
    actions.some(
      (action) =>
        action.action === 'export' &&
        action.ok === true &&
        Number.isFinite(action.startedEpochMs) &&
        Number.isFinite(action.endedEpochMs) &&
        action.endedEpochMs >= action.startedEpochMs &&
        Number.isFinite(sample.hostSampleStartedEpochMs) &&
        Number.isFinite(sample.hostSampleEndedEpochMs) &&
        sample.hostSampleEndedEpochMs >= sample.hostSampleStartedEpochMs &&
        sample.hostSampleStartedEpochMs >= action.startedEpochMs &&
        sample.hostSampleEndedEpochMs <= action.endedEpochMs,
    ),
  );
}

/** A stuck CDP/ps sample must not prevent browser cleanup or report creation.
 * The operation must only return data: late settlement must not mutate a report.
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
export async function withinMemoryDeadline(operation, timeoutMs = 5000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid memory measurement deadline');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Chromium memory measurement timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
