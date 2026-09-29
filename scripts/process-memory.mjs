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
      rss <= 0
    )
      throw new Error('Incomplete or invalid Chromium PID/RSS sample');
    seen.add(id);
    bytes += rss * 1024;
    if (!Number.isSafeInteger(bytes))
      throw new Error('Chromium RSS exceeds the safe integer range');
  }
  if (seen.size !== expected.size)
    throw new Error('Missing Chromium process in RSS sample');
  return bytes;
}
