import type { AllocationInput } from './allocation.ts';
import { refuseAdvice, reviewAllocationAdvice } from './allocation-advice.ts';
import { replayAllocation } from './allocation-io.ts';
import { MAX_ROWS } from './types.ts';

/** The reader's own ceiling, by its exact message: a sheet holds more rows
 * than MAX_ROWS lines and the header. */
const readerCeiling = `الحد ${MAX_ROWS} حركة تقريبًا مع صفوف العناوين`;

/** The family's replay from native bytes, then the review. A refusal by the
 * family keeps its code; any other reader failure is SOURCE. */
export async function replayAllocationAdvice(
  input: AllocationInput,
  signal?: AbortSignal,
) {
  let replay: Awaited<ReturnType<typeof replayAllocation>>;
  try {
    replay = await replayAllocation(input, signal);
  } catch (error) {
    const message = String((error as Error).message);
    if (message.startsWith('ALLOCATION_'))
      refuseAdvice(message.slice('ALLOCATION_'.length));
    refuseAdvice(message === readerCeiling ? 'ROWS' : 'SOURCE');
  }
  return {
    state: replay.state,
    result: replay.result,
    review: reviewAllocationAdvice(replay.result),
  };
}
